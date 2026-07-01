/**
 * Validador Estrutural SPED
 *
 * Verifica a integridade estrutural de arquivos SPED gerados,
 * impedindo disponibilização se inconsistente.
 *
 * Validações:
 * - Presença de blocos obrigatórios (0, C, D, E, G, H, K, 1, 9)
 * - Sequência pai-filho de registros (ex: C100 antes de C170)
 * - Totalização do Bloco 9 consistente com contagem real
 * - Campos obrigatórios preenchidos
 *
 * @see Requirements 14.5, 14.6
 */

export interface ResultadoValidacao {
  valido: boolean
  erros: string[]
}

/**
 * Blocos obrigatórios para o SPED Fiscal (EFD ICMS/IPI)
 */
const BLOCOS_OBRIGATORIOS_EFD = ['0', 'C', 'D', 'E', 'G', 'H', 'K', '1', '9']

/**
 * Mapa de registros filhos para cada registro pai.
 * Os filhos devem aparecer imediatamente após o pai, antes de outro registro do mesmo nível.
 */
const HIERARQUIA_REGISTROS: Record<string, string[]> = {
  // Bloco 0
  '0000': [],
  '0001': [],
  '0005': [],
  '0100': [],
  '0150': ['0175'],
  '0190': [],
  '0200': ['0205', '0206', '0210', '0220'],
  '0300': ['0305', '0400'],
  '0450': [],
  '0460': [],
  '0500': [],
  '0600': [],
  // Bloco C
  'C001': [],
  'C100': ['C101', 'C105', 'C110', 'C111', 'C112', 'C113', 'C114', 'C115', 'C116', 'C120', 'C130', 'C140', 'C141', 'C160', 'C165', 'C170', 'C171', 'C172', 'C173', 'C174', 'C175', 'C176', 'C177', 'C178', 'C179', 'C180', 'C181', 'C185', 'C186', 'C190', 'C191', 'C195', 'C197'],
  'C170': ['C171', 'C172', 'C173', 'C174', 'C175', 'C176', 'C177', 'C178', 'C179'],
  'C190': ['C191', 'C195', 'C197'],
  'C195': ['C197'],
  'C300': ['C310', 'C320', 'C321'],
  'C320': ['C321'],
  'C400': ['C405', 'C410', 'C420', 'C425', 'C460', 'C470', 'C490'],
  'C405': ['C410', 'C420', 'C425', 'C460', 'C470', 'C490'],
  'C460': ['C470'],
  'C500': ['C510', 'C590'],
  'C600': ['C601', 'C610', 'C690'],
  'C700': ['C790', 'C791'],
  'C790': ['C791'],
  'C800': ['C850', 'C855', 'C860'],
  'C860': ['C890', 'C895'],
  // Bloco D
  'D001': [],
  'D100': ['D101', 'D110', 'D120', 'D130', 'D140', 'D150', 'D160', 'D161', 'D162', 'D170', 'D180', 'D190', 'D195', 'D197'],
  'D110': ['D120'],
  'D190': ['D195', 'D197'],
  'D195': ['D197'],
  'D300': ['D301', 'D310'],
  'D350': ['D355', 'D360', 'D365', 'D370', 'D390'],
  'D355': ['D360', 'D365', 'D370', 'D390'],
  'D365': ['D370'],
  'D500': ['D510', 'D530', 'D590'],
  'D600': ['D610', 'D690'],
  'D700': ['D730', 'D731', 'D735', 'D737', 'D750', 'D760', 'D761'],
  // Bloco E
  'E001': [],
  'E100': ['E110'],
  'E110': ['E111', 'E112', 'E113', 'E115', 'E116'],
  'E111': ['E112', 'E113'],
  'E200': ['E210'],
  'E210': ['E220', 'E230', 'E240', 'E250'],
  'E220': ['E230', 'E240'],
  'E300': ['E310'],
  'E310': ['E311', 'E312', 'E313', 'E316'],
  'E500': ['E510', 'E520'],
  'E520': ['E530'],
  // Bloco G
  'G001': [],
  'G110': ['G125', 'G126', 'G130'],
  'G125': ['G126', 'G130'],
  'G130': ['G140'],
  // Bloco H
  'H001': [],
  'H005': ['H010', 'H020', 'H030'],
  'H010': ['H020', 'H030'],
  // Bloco K
  'K001': [],
  'K100': ['K200', 'K210', 'K215', 'K220', 'K230', 'K235', 'K250', 'K255', 'K260', 'K265', 'K270', 'K275', 'K280', 'K290', 'K291', 'K292', 'K300', 'K301', 'K302'],
  'K210': ['K215'],
  'K230': ['K235'],
  'K250': ['K255'],
  'K260': ['K265'],
  'K270': ['K275'],
  'K290': ['K291', 'K292'],
  'K300': ['K301', 'K302'],
  // Bloco 1
  '1001': [],
  '1010': [],
  '1100': ['1105'],
  '1200': ['1210'],
  '1300': ['1310'],
  '1310': ['1320'],
  '1350': ['1360', '1370'],
  '1390': ['1391'],
  '1400': [],
  '1500': ['1510'],
  '1600': [],
  '1700': ['1710'],
  '1800': [],
  '1900': ['1910', '1920', '1921', '1922', '1923', '1925', '1926'],
  '1910': ['1920', '1921', '1922', '1923', '1925', '1926'],
  '1920': ['1921', '1922', '1923', '1925', '1926'],
}

/**
 * Registros que possuem campos obrigatórios com posição conhecida.
 * Formato: { [tipoRegistro]: posições (0-indexed) dos campos obrigatórios após o tipo }
 * Posição 0 = primeiro campo após o tipo do registro.
 * 
 * Nota: Apenas campos incondicionalmente obrigatórios conforme Guia Prático EFD.
 * Campos condicionalmente obrigatórios (dependem de valores de outros campos)
 * não são incluídos aqui.
 */
const CAMPOS_OBRIGATORIOS: Record<string, number[]> = {
  // 0000: COD_VER(0), COD_FIN(1), DT_INI(2), DT_FIN(3), NOME(4), CNPJ(5), UF(6)
  // Campos como IM(10), SUFRAMA(11) são opcionais
  '0000': [0, 1, 2, 3, 4, 5, 6], // COD_VER, COD_FIN, DT_INI, DT_FIN, NOME, CNPJ, UF
  '0001': [0],                // IND_MOV
  '0990': [0],                // QTD_LIN
  'C001': [0],                // IND_MOV
  'C990': [0],                // QTD_LIN
  'D001': [0],                // IND_MOV
  'D990': [0],                // QTD_LIN
  'E001': [0],                // IND_MOV
  'E990': [0],                // QTD_LIN
  'G001': [0],                // IND_MOV
  'G990': [0],                // QTD_LIN
  'H001': [0],                // IND_MOV
  'H990': [0],                // QTD_LIN
  'K001': [0],                // IND_MOV
  'K990': [0],                // QTD_LIN
  '1001': [0],                // IND_MOV
  '1990': [0],                // QTD_LIN
  '9001': [0],                // IND_MOV
  '9900': [0, 1],             // REG_BLC, QTD_REG_BLC
  '9990': [0],                // QTD_LIN_9
  '9999': [0],                // QTD_LIN
}

/**
 * Parse do conteúdo de um arquivo SPED em linhas/registros.
 * O arquivo pode vir como Buffer em ISO-8859-1.
 */
function parseLinhas(conteudo: Buffer): string[][] {
  const text = conteudo.toString('latin1')
  const linhas = text.split('\r\n').filter(l => l.length > 0)

  return linhas.map(linha => {
    // Formato: |TIPO|campo1|campo2|...|
    // Remove pipes inicial e final, depois split
    const stripped = linha.startsWith('|') ? linha.slice(1) : linha
    const trimmed = stripped.endsWith('|') ? stripped.slice(0, -1) : stripped
    return trimmed.split('|')
  })
}

/**
 * Extrai o bloco de um tipo de registro.
 * Ex: 'C100' → 'C', '0000' → '0', '9999' → '9', '1001' → '1'
 */
function extrairBloco(tipo: string): string {
  if (tipo.length === 0) return ''
  return tipo[0]
}

/**
 * Valida presença de todos os blocos obrigatórios.
 * Um bloco é considerado presente se tiver ao menos um registro de abertura (XXX1) e encerramento (XXX0).
 */
function validarBlocosObrigatorios(registros: string[][], erros: string[]): void {
  const blocosPresentes = new Set<string>()

  for (const campos of registros) {
    const tipo = campos[0]
    if (tipo) {
      blocosPresentes.add(extrairBloco(tipo))
    }
  }

  for (const bloco of BLOCOS_OBRIGATORIOS_EFD) {
    if (!blocosPresentes.has(bloco)) {
      erros.push(`Bloco obrigatório '${bloco}' ausente no arquivo SPED`)
    }
  }
}

/**
 * Determina quais registros podem ser pais de um determinado tipo.
 * Retorna os tipos que listam `tipo` como filho.
 */
function obterPaisPossiveis(tipo: string): string[] {
  const pais: string[] = []
  for (const [pai, filhos] of Object.entries(HIERARQUIA_REGISTROS)) {
    if (filhos.includes(tipo)) {
      pais.push(pai)
    }
  }
  return pais
}

/**
 * Valida a sequência pai-filho dos registros.
 * Um registro filho só pode aparecer após seu respectivo pai.
 */
function validarSequenciaPaiFilho(registros: string[][], erros: string[]): void {
  // Pilha de registros "pais" ativos no contexto atual
  const pilhaPais: string[] = []

  for (let i = 0; i < registros.length; i++) {
    const campos = registros[i]
    const tipo = campos[0]
    if (!tipo) continue

    // Registros de abertura (XX01) e encerramento (XX90/XX99) são nível raiz
    if (tipo.endsWith('001') || tipo.endsWith('990') || tipo.endsWith('999') || tipo === '0000') {
      pilhaPais.length = 0
      continue
    }

    // Verifica se este registro é um filho conhecido (deve ter um pai)
    const paisPossiveis = obterPaisPossiveis(tipo)

    if (paisPossiveis.length > 0) {
      // Este registro EXIGE um pai — verifica se algum está na pilha
      let paiEncontrado = false

      for (let j = pilhaPais.length - 1; j >= 0; j--) {
        const paiNaPilha = pilhaPais[j]
        if (paisPossiveis.includes(paiNaPilha)) {
          // Encontrou pai válido, trunca a pilha até esse nível + 1
          pilhaPais.length = j + 1
          paiEncontrado = true
          break
        }
      }

      if (!paiEncontrado) {
        const blocoAtual = extrairBloco(tipo)
        const paisDoMesmoBloco = paisPossiveis.filter(p => extrairBloco(p) === blocoAtual)
        if (paisDoMesmoBloco.length > 0) {
          erros.push(
            `Linha ${i + 1}: Registro '${tipo}' encontrado sem registro pai esperado (${paisDoMesmoBloco.join(' ou ')})`
          )
        }
      }
    } else {
      // Registro não é filho de ninguém — é um pai de nível superior, reseta pilha
      pilhaPais.length = 0
    }

    // Se o registro pode ser pai de outros, adiciona à pilha
    if (HIERARQUIA_REGISTROS[tipo] !== undefined && HIERARQUIA_REGISTROS[tipo].length > 0) {
      pilhaPais.push(tipo)
    }
  }
}

/**
 * Valida a totalização do Bloco 9.
 * Cada registro 9900 declara uma contagem por tipo de registro.
 * Essas contagens devem bater com a contagem real.
 */
function validarBloco9(registros: string[][], erros: string[]): void {
  // Conta registros reais por tipo
  const contagemReal = new Map<string, number>()
  for (const campos of registros) {
    const tipo = campos[0]
    if (!tipo) continue
    contagemReal.set(tipo, (contagemReal.get(tipo) ?? 0) + 1)
  }

  // Coleta declarações do Bloco 9 (registros 9900)
  const declaracoes9900 = new Map<string, number>()
  for (const campos of registros) {
    if (campos[0] === '9900' && campos.length >= 3) {
      const tipoDeclarado = campos[1]
      const qtdDeclarada = parseInt(campos[2], 10)
      if (!isNaN(qtdDeclarada)) {
        declaracoes9900.set(tipoDeclarado, qtdDeclarada)
      }
    }
  }

  // Verifica se declarações batem com contagem real
  for (const [tipo, qtdDeclarada] of declaracoes9900) {
    const qtdReal = contagemReal.get(tipo) ?? 0
    if (qtdReal !== qtdDeclarada) {
      erros.push(
        `Bloco 9: Registro '9900' declara ${qtdDeclarada} ocorrências de '${tipo}', mas encontradas ${qtdReal}`
      )
    }
  }

  // Verifica se todos os tipos de registro existentes estão declarados no Bloco 9
  for (const [tipo, qtdReal] of contagemReal) {
    if (!declaracoes9900.has(tipo) && qtdReal > 0) {
      erros.push(
        `Bloco 9: Tipo de registro '${tipo}' aparece ${qtdReal} vez(es) no arquivo, mas não está declarado no Bloco 9 (falta 9900)`
      )
    }
  }

  // Valida registro 9990 (total de linhas do Bloco 9)
  for (const campos of registros) {
    if (campos[0] === '9990' && campos.length >= 2) {
      const totalDeclarado = parseInt(campos[1], 10)
      // Conta registros do Bloco 9
      let totalBloco9 = 0
      for (const r of registros) {
        if (r[0] && extrairBloco(r[0]) === '9') {
          totalBloco9++
        }
      }
      if (!isNaN(totalDeclarado) && totalDeclarado !== totalBloco9) {
        erros.push(
          `Bloco 9: Registro '9990' declara ${totalDeclarado} linhas no Bloco 9, mas encontradas ${totalBloco9}`
        )
      }
      break
    }
  }

  // Valida registro 9999 (total geral de linhas do arquivo)
  for (const campos of registros) {
    if (campos[0] === '9999' && campos.length >= 2) {
      const totalDeclarado = parseInt(campos[1], 10)
      if (!isNaN(totalDeclarado) && totalDeclarado !== registros.length) {
        erros.push(
          `Bloco 9: Registro '9999' declara ${totalDeclarado} linhas totais, mas o arquivo contém ${registros.length}`
        )
      }
      break
    }
  }
}

/**
 * Valida que campos obrigatórios estão preenchidos.
 */
function validarCamposObrigatorios(registros: string[][], erros: string[]): void {
  for (let i = 0; i < registros.length; i++) {
    const campos = registros[i]
    const tipo = campos[0]
    if (!tipo) continue

    const posicoes = CAMPOS_OBRIGATORIOS[tipo]
    if (!posicoes) continue

    for (const pos of posicoes) {
      // pos é relativo aos campos após o tipo (campo[0] = tipo, campo[1] = primeiro dado)
      const valorIndex = pos + 1
      if (valorIndex >= campos.length || campos[valorIndex] === undefined || campos[valorIndex].trim() === '') {
        erros.push(
          `Linha ${i + 1}: Registro '${tipo}' possui campo obrigatório vazio na posição ${pos + 1}`
        )
      }
    }
  }
}

/**
 * Valida a estrutura de um arquivo SPED.
 *
 * @param conteudo - Buffer com o conteúdo do arquivo SPED em ISO-8859-1
 * @returns Resultado da validação com lista de erros encontrados
 */
export function validarEstruturaSPED(conteudo: Buffer): ResultadoValidacao {
  const erros: string[] = []

  // Parse do arquivo
  const registros = parseLinhas(conteudo)

  if (registros.length === 0) {
    return { valido: false, erros: ['Arquivo SPED vazio ou sem registros válidos'] }
  }

  // 1. Verificar presença de blocos obrigatórios
  validarBlocosObrigatorios(registros, erros)

  // 2. Verificar sequência pai-filho de registros
  validarSequenciaPaiFilho(registros, erros)

  // 3. Verificar totalização do Bloco 9
  validarBloco9(registros, erros)

  // 4. Verificar campos obrigatórios preenchidos
  validarCamposObrigatorios(registros, erros)

  return {
    valido: erros.length === 0,
    erros,
  }
}
