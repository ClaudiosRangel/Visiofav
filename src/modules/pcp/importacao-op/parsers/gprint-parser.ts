/**
 * Parser para PDFs de OP gerados pelo sistema GPrint (Calcograf).
 *
 * Layout típico do GPrint:
 * - Cabeçalho: empresa, OP, cliente, produto, descrição, formato, quantidade, pedido
 * - Programação de Entrega
 * - Materiais: papel (tipo, formato, gramatura, peso), tintas (CMYK + Pantone), vernizes, colas
 * - Impressão: tipo, máquina, tempos fixo/variável
 * - Acabamentos: lista de operações com tempos
 * - Cortadeira: detalhes de corte
 * - Observações
 * - Múltiplas vias (1ª via produção, 2ª via faturamento)
 */

// ============================================================================
// TIPOS
// ============================================================================

export interface DadosOpGprint {
  sistemaOrigem: 'GPRINT'
  cabecalho: CabecalhoOp
  materiais: MaterialOp[]
  etapas: EtapaOp[]
  cortadeira: CortadeiraOp | null
  montagem: MontagemOp | null
  tiragem: number | null
  observacoes: ObservacoesOp
  embalagem: EmbalagemOp | null
  confianca: number // 0-100%
  avisos: string[]
}

export interface CabecalhoOp {
  numeroOp: string | null
  revisao: string | null
  cliente: string | null
  codigoCliente: string | null
  produto: string | null
  descricao: string | null
  formatoFinal: string | null
  quantidade: number | null
  excedente: number | null
  pedido: string | null
  codigoAcabado: string | null
  vendedor: string | null
  calculo: string | null
  dataEmissao: string | null
  programacaoEntrega: ProgramacaoEntrega[]
}

export interface ProgramacaoEntrega {
  quantidade: number
  data: string
}

export interface MaterialOp {
  descricao: string
  quantidade: number
  unidade: string
  tipo: 'PAPEL' | 'TINTA' | 'VERNIZ' | 'COLA' | 'FACA' | 'OUTRO'
  detalhes?: {
    gramatura?: number
    larguraMm?: number
    comprimentoMm?: number
    aproveitamento?: number
    corPantone?: string
    percentual?: number
    tipoCor?: string // CMYK, PANTONE
  }
}

export interface EtapaOp {
  sequencia: number
  descricao: string
  tipo: 'IMPRESSAO' | 'ACABAMENTO' | 'CORTADEIRA' | 'COLAGEM' | 'VERNIZ' | 'OUTRO'
  maquina: string | null
  tempoFixoMin: number
  tempoVariavelMin: number
  detalhes: string | null
}

export interface CortadeiraOp {
  linhas: Array<{
    quantidade: number
    gramatura: number
    larguraCm: number
    comprimentoCm: number
    observacao: string | null
  }>
  totalFolhas: number
}

export interface MontagemOp {
  descricao: string
  aproveitamento: number
  quantidade: number
}

export interface ObservacoesOp {
  gerais: string[]
  producao: string[]
  bobinas: string[]
  expedicao: string[]
  tipoOp: string | null   // NOVO, REPETIÇÃO, ALTERAÇÃO, PILOTO, etc. (extraído de "Obs.: Serviço ...")
  matriz: string | null   // Ex: "1376B", "2529B - COM BRAILLE" (extraído da seção Acabamentos)
  formatoPlano: string | null // Ex: "600 x 910" (extraído de Form.Corte do Plano)
  coresPlano: string | null // Ex: "6x0", "5x0 +V" (extraído da coluna Cores do Plano)
}

export interface EmbalagemOp {
  tipoCaixa: string | null
  quantidadePorCaixa: number | null
  tipoColagem: string | null
  observacao: string | null
}

// ============================================================================
// DETECÇÃO DO SISTEMA
// ============================================================================

export function isGprintPdf(texto: string): boolean {
  return texto.includes('GPrint') || texto.includes('Calcograf') || texto.includes('Calcgraf') || texto.includes('Sistema Calcograf') || texto.includes('Sistema Calcgraf')
}

// ============================================================================
// PARSER PRINCIPAL
// ============================================================================

export function parseGprintPdf(texto: string): DadosOpGprint {
  const avisos: string[] = []
  let camposEncontrados = 0
  const camposTotal = 10 // campos obrigatórios esperados

  const cabecalho = extrairCabecalho(texto, avisos)
  if (cabecalho.numeroOp) camposEncontrados++
  if (cabecalho.cliente) camposEncontrados++
  if (cabecalho.produto || cabecalho.descricao) camposEncontrados++
  if (cabecalho.quantidade) camposEncontrados++
  if (cabecalho.pedido) camposEncontrados++

  const materiais = extrairMateriais(texto, avisos)
  if (materiais.length > 0) camposEncontrados += 2

  const etapas = extrairEtapas(texto, avisos)
  if (etapas.length > 0) camposEncontrados += 2

  const cortadeira = extrairCortadeira(texto)
  const montagem = extrairMontagem(texto)
  const tiragem = extrairTiragem(texto)
  const observacoes = extrairObservacoes(texto)
  const embalagem = extrairEmbalagem(texto)

  if (observacoes.gerais.length > 0 || observacoes.producao.length > 0) camposEncontrados++

  const confianca = Math.round((camposEncontrados / camposTotal) * 100)

  return {
    sistemaOrigem: 'GPRINT',
    cabecalho,
    materiais,
    etapas,
    cortadeira,
    montagem,
    tiragem,
    observacoes,
    embalagem,
    confianca,
    avisos,
  }
}

// ============================================================================
// EXTRAÇÃO DO CABEÇALHO
// ============================================================================

function extrairCabecalho(texto: string, avisos: string[]): CabecalhoOp {
  const cabecalho: CabecalhoOp = {
    numeroOp: null,
    revisao: null,
    cliente: null,
    codigoCliente: null,
    produto: null,
    descricao: null,
    formatoFinal: null,
    quantidade: null,
    excedente: null,
    pedido: null,
    codigoAcabado: null,
    vendedor: null,
    calculo: null,
    dataEmissao: null,
    programacaoEntrega: [],
  }

  // Número da OP: "O.P.: 2.849 R" ou "O.P.: 2849" ou "O.P.: 4/101"
  const matchOp = texto.match(/O\.P\.?:?\s*([\d.,/\-]+)\s*([A-Z])?/i)
  if (matchOp) {
    cabecalho.numeroOp = matchOp[1].replace(/\./g, '')
    cabecalho.revisao = matchOp[2] || null
  } else {
    avisos.push('Número da OP não encontrado')
  }

  // Cliente
  const matchCliente = texto.match(/Cliente:\s*(.+?)(?:\s{2,}|Cód|Fone|$)/i)
  if (matchCliente) {
    cabecalho.cliente = matchCliente[1].trim()
  }

  // Código do Cliente
  const matchCodCliente = texto.match(/Cód\.?\s*Cliente:?\s*(\d+)/i)
  if (matchCodCliente) {
    cabecalho.codigoCliente = matchCodCliente[1]
  }

  // Produto
  const matchProduto = texto.match(/Produto:\s*(.+?)(?:\s{2,}|Descrição|$)/i)
  if (matchProduto) {
    cabecalho.produto = matchProduto[1].trim()
  }

  // Descrição
  const matchDescricao = texto.match(/Descri[çc][ãa]o:\s*(.+?)(?:\s{2,}|Formato|$)/i)
  if (matchDescricao) {
    cabecalho.descricao = matchDescricao[1].trim()
  }

  // Formato Final
  const matchFormato = texto.match(/Formato\s*Final:?\s*([\d.,]+\s*x\s*[\d.,]+(?:\s*x?\s*[\d.,]+)?)\s*mm/i)
  if (matchFormato) {
    cabecalho.formatoFinal = matchFormato[1].trim()
  }

  // Quantidade
  const matchQtd = texto.match(/Quantidade:?\s*([\d.,]+)/i)
  if (matchQtd) {
    cabecalho.quantidade = parseNumero(matchQtd[1])
  } else {
    avisos.push('Quantidade não encontrada')
  }

  // Excedente
  const matchExcedente = texto.match(/\(excedente\)\s*([\d.,]+)/i) || texto.match(/excedente:?\s*([\d.,]+)/i)
  if (matchExcedente) {
    cabecalho.excedente = parseNumero(matchExcedente[1])
  }

  // Pedido
  const matchPedido = texto.match(/Pedido:?\s*([\d.,]+)/i)
  if (matchPedido) {
    cabecalho.pedido = matchPedido[1].replace(/\./g, '')
  }

  // Código Acabado
  const matchCodAcabado = texto.match(/C[óo]d\.?\s*Acabado:?\s*(\d+)/i)
  if (matchCodAcabado) {
    cabecalho.codigoAcabado = matchCodAcabado[1]
  }

  // Vendedor
  const matchVendedor = texto.match(/Vendedor:?\s*(.+?)(?:\s{2,}|Pedido|$)/i)
  if (matchVendedor) {
    cabecalho.vendedor = matchVendedor[1].trim()
  }

  // Cálculo
  const matchCalculo = texto.match(/C[áa]lculo:?\s*([\d.,]+)/i)
  if (matchCalculo) {
    cabecalho.calculo = matchCalculo[1]
  }

  // Programação de entrega:
  // Formato 1: "4590 - 1.200.000 para 06/07/26, 1.000.000 para 02/08/26"
  // Formato 2: "4617 - 01/07/26" (código - data, sem quantidade)
  const matchProgEntrega = texto.match(/Programa[çc][ãa]o\s*de\s*Entrega:?\s*(.+?)(?:\n|Material|Plano|$)/i)
  if (matchProgEntrega) {
    const progTexto = matchProgEntrega[1]
    // Formato 1: quantidade + "para" + data
    const partes = progTexto.matchAll(/([\d.,]+)\s*(?:para|p\/)\s*(\d{2}\/\d{2}\/\d{2,4})/gi)
    for (const parte of partes) {
      cabecalho.programacaoEntrega.push({
        quantidade: parseNumero(parte[1]),
        data: parte[2],
      })
    }
    // Formato 2 (fallback): código - data (sem "para")
    if (cabecalho.programacaoEntrega.length === 0) {
      const matchSimples = progTexto.match(/(\d{2}\/\d{2}\/\d{2,4})/)
      if (matchSimples) {
        cabecalho.programacaoEntrega.push({
          quantidade: cabecalho.quantidade || 0,
          data: matchSimples[1],
        })
      }
    }
  }

  return cabecalho
}

// ============================================================================
// EXTRAÇÃO DE MATERIAIS
// ============================================================================

function extrairMateriais(texto: string, avisos: string[]): MaterialOp[] {
  const materiais: MaterialOp[] = []

  // O PDF GPrint pode ter diferentes cabeçalhos de materiais:
  // "Materiais   Qtde." OU "Materiais   Quant.   Unid." OU "Materiais Diretos   Quant.   Unid."
  // Delimitador final: próxima seção conhecida ou nome da empresa repetida
  const secaoMateriais = texto.match(
    /Materiais(?:\s+Diretos)?\s+(?:Qtde\.|Quant\.?\s*Unid\.?)([\s\S]*?)(?=Obs\.\:|CARTON WEGA|Emitido\s*por|Reemitido|C[óo]d\.\s*do\s*cliente|Numero\s*do\s*pedido|O\.P\.:\s*[\d]|$)/i
  )
  if (!secaoMateriais) {
    avisos.push('Seção de materiais não encontrada')
    return materiais
  }

  const conteudo = secaoMateriais[1]

  // Estratégia 1: Formato tabular com nome + quantidade + unidade na mesma linha
  // Ex: "Stora Enzo Bobina 191   1.921,47   KG"
  const regexLinhaTabular = /^(.+?)\s{2,}([\d.,]+)\s{1,}(KG|PC|UN|LT|ML|M2?|CX|RSM|PÇ|PCS?)$/gim
  const matchesTabular = [...conteudo.matchAll(regexLinhaTabular)]

  if (matchesTabular.length > 0) {
    for (const m of matchesTabular) {
      let nome = m[1].trim()
      const qtd = parseNumero(m[2])
      let unid = m[3].toUpperCase()

      // Extrair detalhe de cor inline: "Escala (CMYK) (25%)" ou "Pantone 01 (CW030S- LARANJA) (70%)"
      // Manter a descrição completa com a informação de cor
      let corPantone: string | undefined
      let percentual: number | undefined
      let tipoCor: string | undefined
      let nomeParaTipo = nome // nome sem parenteses para classificar o tipo

      const matchCorInline = nome.match(/^(.+?)\s+\(([^)]+)\)\s*\((\d+)%\)$/)
      if (matchCorInline) {
        nomeParaTipo = matchCorInline[1].trim()
        const corInfo = matchCorInline[2].trim()
        percentual = parseFloat(matchCorInline[3])
        // Detectar CMYK/CYMK (variações comuns) ou nome "Escala"
        if (/^C[YM][YM]K$/i.test(corInfo) || /^escala$/i.test(nomeParaTipo)) {
          tipoCor = 'CMYK'
        } else {
          tipoCor = 'PANTONE'
          corPantone = corInfo
        }
        // nome continua com a info completa: "Escala (CMYK) (25%)"
      }

      // Ignorar linhas de header ou rodapé
      if (/^(Obs|Emitido|Reemitido|Caixa Padr|Seguir)/i.test(nomeParaTipo)) continue

      let tipo: MaterialOp['tipo'] = 'OUTRO'
      if (/cola/i.test(nomeParaTipo)) tipo = 'COLA'
      else if (/verniz|primer/i.test(nomeParaTipo)) tipo = 'VERNIZ'
      else if (/escala|pantone|tinta|cmyk/i.test(nomeParaTipo)) tipo = 'TINTA'
      else if (/faca|clich[eê]|destacador/i.test(nomeParaTipo)) tipo = 'FACA'
      else if (/bobina|stora|suzano|klabin|papel|micro\s*pardo|micro\s*maculado/i.test(nomeParaTipo)) tipo = 'PAPEL'
      else if (/^CD$/i.test(nomeParaTipo)) tipo = 'FACA'

      if (tipo === 'FACA') unid = 'UN'

      materiais.push({
        descricao: nome,
        quantidade: qtd,
        unidade: unid,
        tipo,
        detalhes: (tipoCor || corPantone || percentual) ? { tipoCor, corPantone, percentual } : undefined,
      })
    }

    if (materiais.length === 0) {
      avisos.push('Nenhum material encontrado no PDF')
    }
    return materiais
  }

  // Estratégia 2 (fallback): Formato separado — nomes, quantidades e unidades em blocos distintos
  // Extrair nomes dos materiais (linhas que não são números nem unidades)
  // Extrair detalhes de cor (linhas que começam com "(")
  // Extrair quantidades (números decimais)
  // Extrair unidades (KG, PC, UN, etc.)

  const linhas = conteudo.split(/\s{2,}|\n/).map(s => s.trim()).filter(s => s.length > 0)

  const nomes: string[] = []
  const detalhes: string[] = []
  const quantidades: number[] = []
  const unidades: string[] = []

  for (const linha of linhas) {
    // É unidade?
    if (/^(KG|PC|UN|LT|ML|M|M2|CX|RSM)$/i.test(linha)) {
      unidades.push(linha.toUpperCase())
      continue
    }
    // É número/quantidade?
    if (/^[\d.,]+$/.test(linha) && !linha.includes('/')) {
      quantidades.push(parseNumero(linha))
      continue
    }
    // É detalhe de cor? (começa com "(")
    if (/^\(/.test(linha)) {
      detalhes.push(linha)
      continue
    }
    // É nome de material (não é header, não é "Obs", não é data)
    if (linha.length > 2 && !/^(Materiais|Qtde|Quant|Unid|Obs|Emitido|Reemitido|Caixa Padr)/i.test(linha)) {
      nomes.push(linha)
    }
  }

  // Montar materiais pareando nomes com quantidades e unidades
  // Completar unidades faltantes com KG (padrão da indústria gráfica)
  while (unidades.length < nomes.length) unidades.push('KG')

  for (let i = 0; i < nomes.length; i++) {
    const nome = nomes[i]
    const qtd = quantidades[i] ?? 0
    let unid = unidades[i] ?? 'KG'

    let tipo: MaterialOp['tipo'] = 'OUTRO'
    if (/cola/i.test(nome)) tipo = 'COLA'
    else if (/verniz|primer/i.test(nome)) tipo = 'VERNIZ'
    else if (/escala|pantone|tinta|cmyk/i.test(nome)) tipo = 'TINTA'
    else if (/faca|clich[eê]|destacador/i.test(nome)) tipo = 'FACA'
    else if (/bobina|stora|suzano|klabin|papel|micro\s*pardo|micro\s*maculado/i.test(nome)) tipo = 'PAPEL'

    // Corrige unidade para FACA (sempre UN)
    if (tipo === 'FACA') unid = 'UN'

    // Buscar detalhe de cor associado (Escala → (CMYK)(60%), Pantone → (CW0288...))
    const detalhe = tipo === 'TINTA' && detalhes.length > 0 ? detalhes.shift() : undefined
    let corPantone: string | undefined
    let percentual: number | undefined
    let tipoCor: string | undefined
    let descricaoFinal = nome

    if (detalhe) {
      const matchCmyk = detalhe.match(/\(C[YM][YM]K\)\s*\((\d+)%\)/i)
      const matchPantone = detalhe.match(/\(([^)]+)\)\s*\((\d+)%\)/i)
      if (matchCmyk) {
        tipoCor = 'CMYK'
        percentual = parseFloat(matchCmyk[1])
      } else if (matchPantone) {
        tipoCor = 'PANTONE'
        corPantone = matchPantone[1]
        percentual = parseFloat(matchPantone[2])
      }
      // Incluir informação de cor na descrição
      descricaoFinal = `${nome} ${detalhe}`
    }

    materiais.push({
      descricao: descricaoFinal,
      quantidade: qtd,
      unidade: unid,
      tipo,
      detalhes: (tipoCor || corPantone || percentual) ? { tipoCor, corPantone, percentual } : undefined,
    })
  }

  if (materiais.length === 0) {
    avisos.push('Nenhum material encontrado no PDF')
  }

  return materiais
}

// ============================================================================
// EXTRAÇÃO DE ETAPAS
// ============================================================================

function extrairEtapas(texto: string, avisos: string[]): EtapaOp[] {
  const etapas: EtapaOp[] = []
  let seq = 1

  // Impressão — "Offset Plana Heidelberg CD 7cores   03:30   10:29"
  const matchImpressao = texto.match(/(Offset|Digital|Flexo|Rotativa)\s+(.+?)\s+(\d{2}:\d{2})\s+(\d{2}:\d{2})/i)
  if (matchImpressao) {
    etapas.push({
      sequencia: seq++,
      descricao: `Impressão - ${matchImpressao[1]} ${matchImpressao[2].trim()}`,
      tipo: 'IMPRESSAO',
      maquina: extrairNomeMaquina(`${matchImpressao[1]} ${matchImpressao[2]}`),
      tempoFixoMin: tempoParaMinutos(matchImpressao[3]),
      tempoVariavelMin: tempoParaMinutos(matchImpressao[4]),
      detalhes: null,
    })
  }

  // Acabamentos — cada etapa ocupa uma linha visual no PDF, no formato:
  //   "NOME  / DETALHE  HH:MM  HH:MM"
  // Quando o detalhe é longo, o PDF quebra em mais de uma linha visual (ex:
  // "Cortadeira (Grande) (Impressos)  / 13.640 folhas 65,8 x 121,0 cm -  00:15  05:23"
  // seguida de "entrando direto em máquina" na linha seguinte). Uma linha de
  // continuação não termina em dois tempos HH:MM — é reanexada à linha anterior
  // antes de extrair nome/detalhe/tempos.
  const secaoAcab = texto.match(/Acabamentos\s+Fixo\s+Vari[áa]vel([\s\S]*?)(?:Obs\.|Materiais)/i)
  if (secaoAcab) {
    const linhasBrutas = secaoAcab[1].split('\n').map((l) => l.trim()).filter((l) => l.length > 0)

    // Índice, no array `etapas`, da última etapa criada dentro desta seção —
    // usado para anexar linhas de continuação de detalhe (texto que quebrou
    // em mais de uma linha visual no PDF e não casa no padrão "nome + tempos").
    let ultimaEtapaIdx: number | null = null

    for (const linha of linhasBrutas) {
      if (/^Caixa\s*Padr/i.test(linha)) continue
      if (/^(Obs|Embalagem)/i.test(linha)) continue

      // Tempos podem ter 2 ou 3 dígitos de hora (ex: "133:20" = 133 minutos e
      // 20 segundos, ou "02:05"), então o padrão aceita \d{2,3} antes dos ":".
      const matchLinha = linha.match(/^(.+?)\s{2,}(\d{2,3}:\d{2})\s+(\d{2,3}:\d{2})\s*$/)
      if (!matchLinha) {
        // Não bate no padrão de etapa (nome + 2 tempos) — é continuação do
        // detalhe da última etapa já reconhecida nesta seção.
        if (ultimaEtapaIdx !== null) {
          const etapaAnterior = etapas[ultimaEtapaIdx]
          etapaAnterior.detalhes = etapaAnterior.detalhes ? `${etapaAnterior.detalhes} ${linha}` : linha
        }
        continue
      }

      const resto = matchLinha[1].trim()
      const tempoFixoMin = tempoParaMinutos(matchLinha[2])
      const tempoVariavelMin = tempoParaMinutos(matchLinha[3])

      // Nome = tudo antes da primeira "/"; detalhe = restante (pode ter mais "/")
      const partesBarra = resto.split(/\s*\/\s*/)
      const nome = partesBarra[0].trim()
      const detalhe = partesBarra.length > 1 ? partesBarra.slice(1).join(' / ').trim() : null

      if (nome.length <= 3) continue

      let tipo: EtapaOp['tipo'] = 'ACABAMENTO'
      if (/cortadeira|corte/i.test(nome)) tipo = 'CORTADEIRA'
      else if (/colagem|cola|coladeira/i.test(nome)) tipo = 'COLAGEM'
      else if (/verniz/i.test(nome)) tipo = 'VERNIZ'

      etapas.push({
        sequencia: seq++,
        descricao: nome,
        tipo,
        maquina: extrairNomeMaquina(nome),
        tempoFixoMin,
        tempoVariavelMin,
        detalhes: detalhe,
      })
      ultimaEtapaIdx = etapas.length - 1
    }
  }

  if (etapas.length === 0) {
    avisos.push('Nenhuma etapa de produção encontrada no PDF')
  }

  return etapas
}

// ============================================================================
// EXTRAÇÃO CORTADEIRA
// ============================================================================

function extrairCortadeira(texto: string): CortadeiraOp | null {
  const linhas: CortadeiraOp['linhas'] = []

  // Padrão: "86.200 folhas Stora Enzo 222g 72,0 x 100,0 cm - entrando direto em máquina"
  const matchesCort = texto.matchAll(/([\d.,]+)\s*folhas?\s*(.+?)\s*(\d{2,3})g?\s*([\d.,]+)\s*x\s*([\d.,]+)\s*cm\s*(?:-\s*(.+?))?(?:\n|$)/gi)
  for (const m of matchesCort) {
    linhas.push({
      quantidade: parseNumero(m[1]),
      gramatura: parseFloat(m[3]),
      larguraCm: parseNumero(m[4]),
      comprimentoCm: parseNumero(m[5]),
      observacao: m[6]?.trim() || null,
    })
  }

  // Total de folhas
  const matchTotal = texto.match(/Total:?\s*([\d.,]+)\s*folhas/i)
  const totalFolhas = matchTotal ? parseNumero(matchTotal[1]) : linhas.reduce((s, l) => s + l.quantidade, 0)

  return linhas.length > 0 ? { linhas, totalFolhas } : null
}

// ============================================================================
// EXTRAÇÃO TIRAGEM (do Plano)
// ============================================================================

function extrairTiragem(texto: string): number | null {
  // A tiragem está na tabela "Plano" do PDF, na coluna "Tiragem" após "Mont."
  // O texto pode vir com múltiplos planos lado a lado:
  //   "2x2  2x2  16.500  16.500  5x0 +V  0x0" (dois planos agrupados por coluna)
  // Ou sequencial: "7x3   115.239   5x0 +V+V" (um plano por vez)
  
  const secaoPlano = texto.match(/Mont\.\s+Tiragem\s+Cores([\s\S]*?)(?:Impressão|Obs\.|$)/i)
  if (secaoPlano) {
    const conteudo = secaoPlano[1]
    
    // Estratégia: encontrar todos os números no conteúdo e pegar o primeiro >= 100
    // que NÃO seja parte de um formato (NNN x NNN) e NÃO seja um formato como "600"
    // A tiragem é tipicamente > 1000 para gráfica industrial
    const numeros = conteudo.matchAll(/([\d.,]+)/g)
    for (const m of numeros) {
      const raw = m[1]
      // Ignorar se é parte de formato "NNN x NNN" (olhar contexto)
      const posInicio = m.index!
      const contextoAntes = conteudo.substring(Math.max(0, posInicio - 5), posInicio)
      const contextoDepois = conteudo.substring(posInicio + raw.length, posInicio + raw.length + 5)
      
      // Pular se parece dimensão (precedido/seguido por "x" com espaço)
      if (/x\s*$/.test(contextoAntes) || /^\s*x/.test(contextoDepois)) continue
      
      // Pular se é formato NxN (como 2x2, 5x0)
      if (/^\d+x\d+$/.test(raw)) continue
      
      const valor = parseNumero(raw)
      // Tiragem em gráfica é tipicamente > 1000 folhas
      if (valor >= 1000) return valor
    }
  }

  return null
}

// ============================================================================
// EXTRAÇÃO MONTAGEM
// ============================================================================

function extrairMontagem(texto: string): MontagemOp | null {
  // Padrão: "Montagem: Cartucho Super Fresh 90G Menta - (21) - 2.200.000 un"
  // Ou:     "Montagem: Cartucho Microondulado 30CM X 100CM (4) - 60.000 un"
  const match = texto.match(/Montagem:?\s*(.+?)\s*-?\s*\((\d+)\)\s*-\s*([\d.,]+)\s*(?:un|pç)/i)
  if (match) {
    return {
      descricao: match[1].trim(),
      aproveitamento: parseInt(match[2]),
      quantidade: parseNumero(match[3]),
    }
  }
  return null
}

// ============================================================================
// EXTRAÇÃO DE OBSERVAÇÕES
// ============================================================================

function extrairObservacoes(texto: string): ObservacoesOp {
  const obs: ObservacoesOp = { gerais: [], producao: [], bobinas: [], expedicao: [], tipoOp: null, matriz: null, formatoPlano: null, coresPlano: null }

  // Tipo OP: "Obs.: Serviço Novo" / "Serviço Repetição" / "Serviço Alteração" / "Serviço Piloto" etc.
  const matchTipoOp = texto.match(/Servi[çc]o\s+(Novo|Repeti[çc][ãa]o|Altera[çc][ãa]o|Piloto|Piloto\s*\/\s*Em\s*branco|[Vv]enda\s*de\s*cart[ãa]o)(?:\s*\/\s*(Novo|Repeti[çc][ãa]o|Altera[çc][ãa]o|Piloto))?/i)
  if (matchTipoOp) {
    let tipo = matchTipoOp[1].trim()
    if (matchTipoOp[2]) tipo += ' / ' + matchTipoOp[2].trim()
    obs.tipoOp = tipo.toUpperCase()
      .replace('REPETIÇÃO', 'REPETIÇÃO')
      .replace('REPETICAO', 'REPETIÇÃO')
      .replace('ALTERAÇÃO', 'ALTERAÇÃO')
      .replace('ALTERACAO', 'ALTERAÇÃO')
  }

  // Matriz: extrair do texto da seção de Acabamentos
  // Padrões: "/ Matriz: M2508", "/ Matriz 1376B", "/ Matriz 2529B - COM BRAILLE", "/ Matriz: M1376B - FACA NOVA"
  const matchMatriz = texto.match(/Matriz:?\s*(M?\d[\dA-Z]*(?:\s*[-–]\s*[A-Za-z\s]+)?)/i)
  if (matchMatriz) {
    obs.matriz = matchMatriz[1].trim().toUpperCase()
  } else {
    // Fallback: Buscar FACA no material como referência de matriz (ex: "2529B - COM BRAILLE")
    const matchFaca = texto.match(/(\d{3,5}[A-Z]?)\s*[-–]\s*(FACA NOVA|COM BRAILLE|SEM BRAILLE|NOVA)/i)
    if (matchFaca) {
      obs.matriz = `${matchFaca[1]} - ${matchFaca[2]}`.toUpperCase()
    }
  }

  // Formato do Plano: "Form.Corte" ou "Formato" na tabela do Plano — ex: "600 x 910", "500 x 970"
  // Prioridade 1: Form.Corte (formato da folha cortada) — números inteiros de 3+ dígitos
  const matchFormCorte = texto.match(/Form\.?\s*Corte:?\s*(\d{3,4})\s*x\s*(\d{3,4})/i)
  if (matchFormCorte) {
    obs.formatoPlano = `${matchFormCorte[1]} x ${matchFormCorte[2]}`
  } else {
    // Prioridade 2: Formato na tabela do Plano (próximo a "Material")
    const matchFormatoTab = texto.match(/Formato\s+([\d.]+)\s*x\s*([\d.]+)\s+(?:Quant|N|S)/i)
    if (matchFormatoTab) {
      obs.formatoPlano = `${matchFormatoTab[1]} x ${matchFormatoTab[2]}`
    } else {
      // Prioridade 3: qualquer "NNN x NNN" com dígitos >= 3 (formato de folha)
      const matchFormGenerico = texto.match(/(\d{3,4})\s*x\s*(\d{3,4})(?:\s|$)/i)
      if (matchFormGenerico) {
        obs.formatoPlano = `${matchFormGenerico[1]} x ${matchFormGenerico[2]}`
      }
    }
  }

  // Cores do Plano: "Cores" na tabela — ex: "6x0", "5x0 +V", "5x0+V+V"
  // Na seção entre Mont./Tiragem/Cores e Impressão, os dados vêm na ordem:
  //   Mont.(2x1)  Tiragem(40.000)  Cores(5x0 +V+V)  Máq.Impr.(Heidelberg...)
  // Cores é sempre NxN onde N é 1-9 e N2 é tipicamente 0 (impressão só frente)
  // Diferencia de Montagem (que tem padrões como 2x1, 4x2, 7x3 — N2 >= 1)
  const secaoCores = texto.match(/Mont\.\s+Tiragem\s+Cores([\s\S]*?)(?:Impressão|Obs\.|$)/i)
  if (secaoCores) {
    // Buscar padrão NxN com N2=0 seguido opcionalmente de +V (mais específico para cores)
    const matchCoresZero = secaoCores[1].match(/(\d)\s*x\s*0\s*(\+V[^a-z]*)?/i)
    if (matchCoresZero) {
      obs.coresPlano = `${matchCoresZero[1]}x0${matchCoresZero[2] ? ' ' + matchCoresZero[2].trim() : ''}`
    } else {
      // Fallback: buscar NxN com +V (se imprime frente e verso com verniz)
      const matchCoresComV = secaoCores[1].match(/(\d)\s*x\s*(\d)\s*(\+V[^a-z]+)/i)
      if (matchCoresComV) {
        obs.coresPlano = `${matchCoresComV[1]}x${matchCoresComV[2]} ${matchCoresComV[3].trim()}`
      }
    }
  }
  // Fallback: buscar na seção "Plano" após "Cores"
  if (!obs.coresPlano) {
    const matchCoresFallback = texto.match(/Cores\s+(\d+)\s*x\s*(\d+)\s*(\+V[^a-z]*)?/i)
    if (matchCoresFallback) {
      obs.coresPlano = `${matchCoresFallback[1]}x${matchCoresFallback[2]}${matchCoresFallback[3] ? ' ' + matchCoresFallback[3].trim() : ''}`
    }
  }

  // Obs gerais: "Obs.:   Serviço Novo" — captura só até próximo campo conhecido
  const matchObsGerais = texto.matchAll(/Obs\.?:?\s{1,5}([A-Z][^O][^\n]{2,40})(?=\s{2,}|Bobina|LXL|Montagem|Cortadeira|$)/gi)
  for (const m of matchObsGerais) {
    const val = m[1].trim()
    // Filtra textos que são dados de produção, não observações
    if (val.length > 2 && val.length < 80 &&
        !val.startsWith('Faturamento') &&
        !val.startsWith('Colagem') &&
        !/^\d/.test(val) &&
        !/Offset|Impressão|Heidelberg|Stora|CARTON|GPrint/i.test(val)) {
      obs.gerais.push(val)
    }
  }

  // Colagem como observação de embalagem
  const matchColagem = texto.match(/Colagem:\s*(.+?)(?=\s{2,}|Materiais|$)/i)
  if (matchColagem && matchColagem[1].trim().length < 50) {
    obs.gerais.push(`Colagem: ${matchColagem[1].trim()}`)
  }

  // Bobinas em estoque/encomendadas — formato: "Bobina Stora Enzo 222g - 72,0 cm em estoque (13.793,0 kg)"
  const matchBobinas = texto.matchAll(/Bobina\s+([\w\s]+\d+g\s*-\s*[\d.,]+\s*cm\s+(?:em estoque|encomendad[oa])\s*\([\d.,]+\s*kg\))/gi)
  for (const m of matchBobinas) {
    obs.bobinas.push(m[1].trim())
  }

  // Indicações de produção
  if (texto.includes('Seguir contratual')) {
    obs.producao.push('Seguir contratual')
  }

  // Expedição
  const matchExp = texto.match(/Faturamento:\s*([A-Za-z\s]+?)(?=\s{2,}|Cód|$)/i)
  if (matchExp) {
    obs.expedicao.push(`Faturamento: ${matchExp[1].trim()}`)
  }

  return obs
}

// ============================================================================
// EXTRAÇÃO DE EMBALAGEM
// ============================================================================

function extrairEmbalagem(texto: string): EmbalagemOp | null {
  // "Caixa Padrão com 900 / Embalagens" ou "Colagem: Caixa 011 com 900 un"
  const matchCaixa = texto.match(/Caixa\s*Padr[ãa]o?\s*(?:com)?\s*(\d+)/i)
  const matchColagem = texto.match(/Colagem:?\s*(.+?)(?:\n|$)/i)

  if (matchCaixa || matchColagem) {
    return {
      tipoCaixa: matchCaixa ? 'Caixa Padrão' : null,
      quantidadePorCaixa: matchCaixa ? parseInt(matchCaixa[1]) : null,
      tipoColagem: matchColagem ? matchColagem[1].trim() : null,
      observacao: null,
    }
  }
  return null
}

// ============================================================================
// UTILITÁRIOS
// ============================================================================

/**
 * Converte string numérica brasileira para number.
 * "18.419,87" → 18419.87
 * "2.200.000" → 2200000
 */
function parseNumero(str: string): number {
  if (!str) return 0
  const limpo = str.trim()

  // Se tem vírgula como decimal: "18.419,87" → remover pontos, trocar vírgula por ponto
  if (limpo.includes(',')) {
    return parseFloat(limpo.replace(/\./g, '').replace(',', '.'))
  }

  // Se só tem pontos como separador de milhar: "2.200.000"
  // Heurística: se o último grupo após ponto tem 3 dígitos, é milhar
  const partes = limpo.split('.')
  if (partes.length > 1 && partes[partes.length - 1].length === 3) {
    return parseFloat(limpo.replace(/\./g, ''))
  }

  return parseFloat(limpo) || 0
}

/**
 * Converte tempo "HH:MM" para minutos.
 */
function tempoParaMinutos(tempo: string): number {
  const partes = tempo.split(':')
  if (partes.length !== 2) return 0
  return parseInt(partes[0]) * 60 + parseInt(partes[1])
}

/**
 * Extrai nome da máquina de uma string descritiva.
 */
function extrairNomeMaquina(desc: string): string {
  // Tenta extrair nomes comuns de máquinas gráficas
  const maquinas = ['Heidelberg', 'KBA', 'Komori', 'Bobst', 'BOBST', 'AFT', 'Cortadeira']
  for (const m of maquinas) {
    if (desc.toLowerCase().includes(m.toLowerCase())) {
      // Pega o nome + modelo
      const regex = new RegExp(`(${m}[\\w\\s]*?\\d*)`, 'i')
      const match = desc.match(regex)
      return match ? match[1].trim() : m
    }
  }
  return desc.substring(0, 50).trim()
}
