/**
 * Financeiro D3 (Folha) — núcleo puro de parsing/cálculo da folha de pagamento.
 * Sem I/O, sem Prisma, sem LLM. Testável (unit + property-based).
 *
 * O Vizor NÃO calcula folha (INSS/IRRF/FGTS/férias) — ele lança o RESULTADO
 * consolidado vindo do sistema de folha. Este módulo interpreta o CSV de
 * resultado e faz os cálculos determinísticos de líquido/totais.
 */

const TOLERANCIA = 0.01

/** Arredonda para 2 casas (centavos), evitando ruído de ponto flutuante. */
function centavos(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100
}

/** Líquido de um item: proventos − descontos, nunca negativo. */
export function calcularLiquido(proventos: number, descontos: number): number {
  const p = Number.isFinite(proventos) ? proventos : 0
  const d = Number.isFinite(descontos) ? descontos : 0
  return centavos(Math.max(0, p - d))
}

/** Totais de uma folha a partir dos itens (líquido) e encargos (valor). */
export function calcularTotaisFolha(
  itens: { liquido: number }[],
  encargos: { valor: number }[],
): { totalLiquido: number; totalEncargos: number; totalGeral: number } {
  const totalLiquido = centavos(itens.reduce((s, i) => s + (Number(i.liquido) || 0), 0))
  const totalEncargos = centavos(encargos.reduce((s, e) => s + (Number(e.valor) || 0), 0))
  return { totalLiquido, totalEncargos, totalGeral: centavos(totalLiquido + totalEncargos) }
}

export interface LinhaFolha {
  identificador: string // CPF (só dígitos) ou matrícula
  proventos: number
  descontos: number
  liquido: number
  divergencia: boolean // |proventos - descontos - liquido| > 0.01
}

/** Converte um valor monetário em texto BR/US para número. */
function parseValor(txt: string): number {
  if (!txt) return 0
  let s = txt.trim().replace(/[R$\s]/g, '')
  // Formato BR: 1.234,56 → remove pontos de milhar, vírgula vira ponto
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  const v = Number(s)
  return Number.isFinite(v) ? v : 0
}

/** Normaliza um cabeçalho de coluna (sem acento, minúsculo, sem espaços). */
function normalizarCabecalho(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '')
}

/** Detecta o separador do CSV (',' ou ';') pela primeira linha. */
function detectarSeparador(primeiraLinha: string): string {
  const virgulas = (primeiraLinha.match(/,/g) || []).length
  const pontoVirgula = (primeiraLinha.match(/;/g) || []).length
  return pontoVirgula > virgulas ? ';' : ','
}

/**
 * Interpreta um CSV de resultado de folha. Cabeçalho flexível — aceita colunas
 * (em qualquer ordem): cpf|matricula (identificador), proventos, descontos,
 * liquido. Se o líquido não vier, é derivado de proventos − descontos.
 * Retorna as linhas válidas e uma lista de erros (não lança).
 */
export function parsearCsvFolha(conteudo: string): { linhas: LinhaFolha[]; erros: string[] } {
  const erros: string[] = []
  const texto = (conteudo ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  if (!texto) {
    return { linhas: [], erros: ['Arquivo vazio. Esperado CSV com colunas: cpf ou matricula, proventos, descontos, liquido.'] }
  }

  const linhasBrutas = texto.split('\n').filter((l) => l.trim().length > 0)
  if (linhasBrutas.length < 2) {
    return { linhas: [], erros: ['CSV sem dados. Informe o cabeçalho e ao menos uma linha de funcionário.'] }
  }

  const sep = detectarSeparador(linhasBrutas[0])
  const cabecalhos = linhasBrutas[0].split(sep).map(normalizarCabecalho)

  const idxIdentificador = cabecalhos.findIndex((c) => c === 'cpf' || c === 'matricula' || c === 'identificador')
  const idxProventos = cabecalhos.findIndex((c) => c === 'proventos' || c === 'provento' || c === 'vencimentos')
  const idxDescontos = cabecalhos.findIndex((c) => c === 'descontos' || c === 'desconto')
  const idxLiquido = cabecalhos.findIndex((c) => c === 'liquido' || c === 'liquidoapagar' || c === 'valor')

  if (idxIdentificador === -1) {
    return { linhas: [], erros: ['CSV inválido: não encontrei coluna de identificação (cpf ou matricula).'] }
  }
  if (idxProventos === -1 && idxLiquido === -1) {
    return { linhas: [], erros: ['CSV inválido: informe ao menos "proventos" ou "liquido".'] }
  }

  const linhas: LinhaFolha[] = []
  for (let i = 1; i < linhasBrutas.length; i++) {
    const cols = linhasBrutas[i].split(sep)
    const identificadorBruto = (cols[idxIdentificador] ?? '').trim()
    if (!identificadorBruto) {
      erros.push(`Linha ${i + 1}: identificador (cpf/matricula) vazio — ignorada.`)
      continue
    }
    // CPF vem só com dígitos; matrícula fica como está.
    const soDigitos = identificadorBruto.replace(/\D/g, '')
    const identificador = soDigitos.length === 11 ? soDigitos : identificadorBruto

    const proventos = idxProventos !== -1 ? parseValor(cols[idxProventos]) : 0
    const descontos = idxDescontos !== -1 ? parseValor(cols[idxDescontos]) : 0
    const liquidoInformado = idxLiquido !== -1 ? parseValor(cols[idxLiquido]) : NaN

    const liquidoCalculado = calcularLiquido(proventos, descontos)
    const liquido = Number.isFinite(liquidoInformado) && idxLiquido !== -1 ? centavos(liquidoInformado) : liquidoCalculado
    const divergencia = idxLiquido !== -1 && idxProventos !== -1
      ? Math.abs(proventos - descontos - liquido) > TOLERANCIA
      : false

    linhas.push({ identificador, proventos: centavos(proventos), descontos: centavos(descontos), liquido, divergencia })
  }

  if (linhas.length === 0) {
    erros.push('Nenhuma linha de funcionário válida encontrada no CSV.')
  }
  return { linhas, erros }
}
