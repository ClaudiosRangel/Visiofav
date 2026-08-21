// Motor de cálculo de orçamento gráfico — serviço puro (sem dependências de banco)

// ============================================================================
// INTERFACES
// ============================================================================

export interface ParamsOrcamento {
  tipoEmbalagem: {
    formulaLargura: string
    formulaAltura: string
    abaColagemMm: number
    sangriaMm: number
    pincaMm: number
  }
  medidas: Record<string, number> // ex: {L: 80, A: 150, P: 40}
  papel: { gramatura: number; precoKg: number }
  maquinaImpressao: {
    velocidade: number
    custoHora: number
    formatoLargura: number
    formatoAltura: number
    pinca: number
    setupMinutos: number
  }
  cores: Array<{
    nome: string
    tipo: 'CMYK' | 'PANTONE'
    coberturaPercent: number
    precoKg: number
    rendimentoM2Kg: number
  }>
  acabamentos: Array<{
    tipo: string
    custoHora: number
    velocidade: number
    setupMinutos: number
    custoMaterialM2?: number
    custoMaterialUn?: number
  }>
  quantidade: number
  perdas: {
    impressaoPercent: number
    impressaoFixaFolhas: number
    corteVincoPercent: number
    colagemPercent: number
  }
  margem: {
    impostos: number
    comissao: number
    despAdm: number
    markup: number
  }
}

export interface ResultadoOrcamento {
  planificacao: { larguraMm: number; alturaMm: number }
  encaixe: {
    aproveitamento: number
    folhasNecessarias: number
    percentAproveitamentoFolha: number
    orientacao: 'NORMAL' | 'ROTACIONADA'
  }
  papel: { pesoKg: number; custo: number }
  tinta: {
    custoTotal: number
    detalhePorCor: Array<{ cor: string; consumoKg: number; custo: number }>
  }
  maquinas: {
    custoTotal: number
    detalhePorEtapa: Array<{ etapa: string; setupMin: number; operacaoMin: number; custo: number }>
  }
  acabamentos: {
    custoTotal: number
    detalhePorAcabamento: Array<{ tipo: string; custo: number }>
  }
  custoTotal: number
  precoVenda: number
  precoUnitario: number
  margemReal: number
  breakdown: {
    papelPercent: number
    tintaPercent: number
    maquinaPercent: number
    acabamentoPercent: number
  }
}

// Interfaces auxiliares para funções individuais
export interface ResultadoEncaixe {
  aproveitamento: number
  folhasNecessarias: number
  percentAproveitamentoFolha: number
  orientacao: 'NORMAL' | 'ROTACIONADA'
}

export interface ResultadoPapel {
  pesoKg: number
  custo: number
  folhasBrutas: number
}

export interface ResultadoTinta {
  custoTotal: number
  detalhePorCor: Array<{ cor: string; consumoKg: number; custo: number }>
}

export interface ResultadoMaquinas {
  custoTotal: number
  detalhePorEtapa: Array<{ etapa: string; setupMin: number; operacaoMin: number; custo: number }>
}

export interface ResultadoAcabamentos {
  custoTotal: number
  detalhePorAcabamento: Array<{ tipo: string; custo: number }>
}

// ============================================================================
// 2.8 — AVALIADOR DE FÓRMULAS (expressões matemáticas seguras)
// ============================================================================

type TokenType = 'NUMBER' | 'VARIABLE' | 'OPERATOR' | 'LPAREN' | 'RPAREN'

interface Token {
  type: TokenType
  value: string
}

/**
 * Tokeniza uma expressão matemática em tokens seguros.
 * Suporta: números (inteiros e decimais), variáveis alfanuméricas,
 * operadores (+, -, *, /), e parênteses.
 */
function tokenizar(expressao: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const expr = expressao.trim()

  while (i < expr.length) {
    const ch = expr[i]

    // Ignorar espaços
    if (ch === ' ' || ch === '\t') {
      i++
      continue
    }

    // Números (inteiros e decimais)
    if (ch >= '0' && ch <= '9') {
      let num = ''
      while (i < expr.length && ((expr[i] >= '0' && expr[i] <= '9') || expr[i] === '.')) {
        num += expr[i]
        i++
      }
      tokens.push({ type: 'NUMBER', value: num })
      continue
    }

    // Variáveis (letras, dígitos, underscores — inicia com letra ou _)
    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_') {
      let name = ''
      while (
        i < expr.length &&
        ((expr[i] >= 'a' && expr[i] <= 'z') ||
          (expr[i] >= 'A' && expr[i] <= 'Z') ||
          (expr[i] >= '0' && expr[i] <= '9') ||
          expr[i] === '_')
      ) {
        name += expr[i]
        i++
      }
      tokens.push({ type: 'VARIABLE', value: name })
      continue
    }

    // Operadores
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      tokens.push({ type: 'OPERATOR', value: ch })
      i++
      continue
    }

    // Parênteses
    if (ch === '(') {
      tokens.push({ type: 'LPAREN', value: '(' })
      i++
      continue
    }
    if (ch === ')') {
      tokens.push({ type: 'RPAREN', value: ')' })
      i++
      continue
    }

    throw new Error(`Caractere inválido na fórmula: '${ch}' na posição ${i}`)
  }

  return tokens
}

/**
 * Parser recursivo descendente para expressões matemáticas.
 * Gramática:
 *   expr     → term (('+' | '-') term)*
 *   term     → unary (('*' | '/') unary)*
 *   unary    → ('-')? primary
 *   primary  → NUMBER | VARIABLE | '(' expr ')'
 */
class Parser {
  private tokens: Token[]
  private pos: number
  private variaveis: Record<string, number>

  constructor(tokens: Token[], variaveis: Record<string, number>) {
    this.tokens = tokens
    this.pos = 0
    this.variaveis = variaveis
  }

  parse(): number {
    const result = this.parseExpr()
    if (this.pos < this.tokens.length) {
      throw new Error(`Token inesperado: '${this.tokens[this.pos].value}' na posição ${this.pos}`)
    }
    return result
  }

  private peek(): Token | null {
    return this.pos < this.tokens.length ? this.tokens[this.pos] : null
  }

  private consume(): Token {
    if (this.pos >= this.tokens.length) {
      throw new Error('Fim inesperado da expressão')
    }
    return this.tokens[this.pos++]
  }

  private parseExpr(): number {
    let left = this.parseTerm()

    while (this.peek()?.type === 'OPERATOR' && (this.peek()!.value === '+' || this.peek()!.value === '-')) {
      const op = this.consume().value
      const right = this.parseTerm()
      if (op === '+') left += right
      else left -= right
    }

    return left
  }

  private parseTerm(): number {
    let left = this.parseUnary()

    while (this.peek()?.type === 'OPERATOR' && (this.peek()!.value === '*' || this.peek()!.value === '/')) {
      const op = this.consume().value
      const right = this.parseUnary()
      if (op === '*') left *= right
      else {
        if (right === 0) throw new Error('Divisão por zero na fórmula')
        left /= right
      }
    }

    return left
  }

  private parseUnary(): number {
    if (this.peek()?.type === 'OPERATOR' && this.peek()!.value === '-') {
      this.consume()
      return -this.parsePrimary()
    }
    // Suportar '+' unário
    if (this.peek()?.type === 'OPERATOR' && this.peek()!.value === '+') {
      this.consume()
      return this.parsePrimary()
    }
    return this.parsePrimary()
  }

  private parsePrimary(): number {
    const token = this.peek()

    if (!token) {
      throw new Error('Fim inesperado da expressão — esperava número ou variável')
    }

    if (token.type === 'NUMBER') {
      this.consume()
      const val = parseFloat(token.value)
      if (isNaN(val)) throw new Error(`Número inválido: '${token.value}'`)
      return val
    }

    if (token.type === 'VARIABLE') {
      this.consume()
      const varName = token.value.toUpperCase()
      if (!(varName in this.variaveis)) {
        throw new Error(`Variável não definida: '${token.value}' — variáveis disponíveis: ${Object.keys(this.variaveis).join(', ')}`)
      }
      return this.variaveis[varName]
    }

    if (token.type === 'LPAREN') {
      this.consume() // consome '('
      const result = this.parseExpr()
      const closing = this.peek()
      if (!closing || closing.type !== 'RPAREN') {
        throw new Error('Parêntese de fechamento esperado')
      }
      this.consume() // consome ')'
      return result
    }

    throw new Error(`Token inesperado: '${token.value}' (tipo: ${token.type})`)
  }
}

/**
 * Avalia uma expressão matemática de forma segura (sem eval).
 * Suporta: +, -, *, /, parênteses, e variáveis nomeadas.
 *
 * Exemplo:
 *   avaliarFormula("2*L + 2*P + ABA", { L: 80, P: 40, ABA: 15 })
 *   // → 255
 */
export function avaliarFormula(formula: string, variaveis: Record<string, number>): number {
  if (!formula || formula.trim().length === 0) {
    throw new Error('Fórmula vazia')
  }

  // Normalizar variáveis para uppercase (as fórmulas podem usar case misto)
  const variaveisNorm: Record<string, number> = {}
  for (const [key, val] of Object.entries(variaveis)) {
    variaveisNorm[key.toUpperCase()] = val
  }

  const tokens = tokenizar(formula)
  if (tokens.length === 0) {
    throw new Error('Fórmula sem conteúdo válido')
  }

  const parser = new Parser(tokens, variaveisNorm)
  return parser.parse()
}

// ============================================================================
// 2.2 — CÁLCULO DE ENCAIXE (IMPOSIÇÃO)
// ============================================================================

interface ParamsEncaixe {
  planificacao: { larguraMm: number; alturaMm: number }
  folha: { larguraMm: number; alturaMm: number }
  sangriaMm: number
  pincaMm: number
  respeitarFibra?: boolean
}

/**
 * Calcula o encaixe (imposição) de peças na folha de impressão.
 * Testa orientação normal e rotacionada 90°, retornando a melhor.
 * Considera sangria ao redor de cada peça e pinça no gripper.
 */
export function calcularEncaixe(params: ParamsEncaixe): ResultadoEncaixe {
  const { planificacao, folha, sangriaMm, pincaMm, respeitarFibra } = params

  // Dimensões da peça com sangria
  const pecaLargura = planificacao.larguraMm + 2 * sangriaMm
  const pecaAltura = planificacao.alturaMm + 2 * sangriaMm

  // Área útil da folha (descontando pinça na borda do gripper)
  const folhaLarguraUtil = folha.larguraMm - pincaMm
  const folhaAlturaUtil = folha.alturaMm

  // Orientação NORMAL
  const colsNormal = Math.floor(folhaLarguraUtil / pecaLargura)
  const rowsNormal = Math.floor(folhaAlturaUtil / pecaAltura)
  const aproveitamentoNormal = colsNormal * rowsNormal

  // Orientação ROTACIONADA (90°) — troca largura e altura da peça
  const colsRotacionada = Math.floor(folhaLarguraUtil / pecaAltura)
  const rowsRotacionada = Math.floor(folhaAlturaUtil / pecaLargura)
  const aproveitamentoRotacionada = colsRotacionada * rowsRotacionada

  // Se respeitarFibra, só usa orientação normal
  let aproveitamento: number
  let orientacao: 'NORMAL' | 'ROTACIONADA'

  if (respeitarFibra) {
    aproveitamento = aproveitamentoNormal
    orientacao = 'NORMAL'
  } else if (aproveitamentoRotacionada > aproveitamentoNormal) {
    aproveitamento = aproveitamentoRotacionada
    orientacao = 'ROTACIONADA'
  } else {
    aproveitamento = aproveitamentoNormal
    orientacao = 'NORMAL'
  }

  // Proteção: aproveitamento mínimo 1
  if (aproveitamento < 1) {
    aproveitamento = 1
  }

  // % de aproveitamento da folha (área das peças / área total da folha)
  const areaPecas = aproveitamento * pecaLargura * pecaAltura
  const areaFolha = folha.larguraMm * folha.alturaMm
  const percentAproveitamentoFolha = (areaPecas / areaFolha) * 100

  return {
    aproveitamento,
    folhasNecessarias: 0, // será calculado em calcularPapel com base na quantidade
    percentAproveitamentoFolha: Math.round(percentAproveitamentoFolha * 100) / 100,
    orientacao,
  }
}

// ============================================================================
// 2.3 — CÁLCULO DE PAPEL
// ============================================================================

interface ParamsPapel {
  folhasNecessarias: number // ceil(quantidade / aproveitamento) + perda fixa
  larguraMm: number
  alturaMm: number
  gramaturaGm2: number
  precoKg: number
  perdaPercent: number
  perdaFixaFolhas: number
}

/**
 * Calcula peso e custo do papel.
 * folhasBrutas = folhasNecessarias * (1 + perdaPercent/100)
 * peso = folhasBrutas * (largura_m * altura_m * gramatura / 1000)
 * custo = peso * precoKg
 */
export function calcularPapel(params: ParamsPapel): ResultadoPapel {
  const { folhasNecessarias, larguraMm, alturaMm, gramaturaGm2, precoKg, perdaPercent, perdaFixaFolhas } = params

  const folhasComPerdaFixa = folhasNecessarias + perdaFixaFolhas
  const folhasBrutas = Math.ceil(folhasComPerdaFixa * (1 + perdaPercent / 100))

  // Converter mm para metros
  const larguraM = larguraMm / 1000
  const alturaM = alturaMm / 1000

  // Peso em kg: área em m² * gramatura (g/m²) / 1000 (g → kg) * qtd folhas
  const pesoKg = folhasBrutas * larguraM * alturaM * gramaturaGm2 / 1000

  const custo = pesoKg * precoKg

  return {
    pesoKg: Math.round(pesoKg * 1000) / 1000, // 3 casas decimais
    custo: Math.round(custo * 100) / 100, // 2 casas decimais
    folhasBrutas,
  }
}

// ============================================================================
// 2.4 — CÁLCULO DE TINTA
// ============================================================================

interface ParamsTinta {
  folhasBrutas: number
  larguraMm: number
  alturaMm: number
  cores: Array<{
    nome: string
    tipo: 'CMYK' | 'PANTONE'
    coberturaPercent: number
    precoKg: number
    rendimentoM2Kg: number
  }>
}

/**
 * Calcula o consumo e custo de tinta por cor.
 * Para cada cor:
 *   area = folhasBrutas * largura_m * altura_m
 *   consumo = area * (cobertura/100) / rendimento
 *   custo = consumo * preco
 */
export function calcularTinta(params: ParamsTinta): ResultadoTinta {
  const { folhasBrutas, larguraMm, alturaMm, cores } = params

  const larguraM = larguraMm / 1000
  const alturaM = alturaMm / 1000
  const areaTotal = folhasBrutas * larguraM * alturaM

  const detalhePorCor: Array<{ cor: string; consumoKg: number; custo: number }> = []
  let custoTotal = 0

  for (const cor of cores) {
    const consumoKg = areaTotal * (cor.coberturaPercent / 100) / cor.rendimentoM2Kg
    const custo = consumoKg * cor.precoKg

    detalhePorCor.push({
      cor: cor.nome,
      consumoKg: Math.round(consumoKg * 1000) / 1000,
      custo: Math.round(custo * 100) / 100,
    })

    custoTotal += custo
  }

  return {
    custoTotal: Math.round(custoTotal * 100) / 100,
    detalhePorCor,
  }
}

// ============================================================================
// 2.5 — CÁLCULO DE MÁQUINAS
// ============================================================================

interface ParamsMaquinas {
  folhasBrutas: number
  quantidade: number
  etapas: Array<{
    nome: string
    velocidade: number // folhas/hora ou unidades/hora
    custoHora: number
    setupMinutos: number
    usaFolhas?: boolean // se true, usa folhasBrutas; se false, usa quantidade
  }>
}

/**
 * Calcula custo de máquina por etapa (setup + operação × custo/hora).
 * tempo = setupMinutos + (unidades / (velocidade/60))
 * custo = (tempo/60) * custoHora
 */
export function calcularMaquinas(params: ParamsMaquinas): ResultadoMaquinas {
  const { folhasBrutas, quantidade, etapas } = params

  const detalhePorEtapa: Array<{ etapa: string; setupMin: number; operacaoMin: number; custo: number }> = []
  let custoTotal = 0

  for (const etapa of etapas) {
    const unidades = etapa.usaFolhas !== false ? folhasBrutas : quantidade
    // velocidade está em unidades/hora → dividir por 60 para unidades/minuto
    const velocidadeMinuto = etapa.velocidade / 60
    const operacaoMin = velocidadeMinuto > 0 ? unidades / velocidadeMinuto : 0
    const tempoTotalMin = etapa.setupMinutos + operacaoMin
    const custo = (tempoTotalMin / 60) * etapa.custoHora

    detalhePorEtapa.push({
      etapa: etapa.nome,
      setupMin: etapa.setupMinutos,
      operacaoMin: Math.round(operacaoMin * 100) / 100,
      custo: Math.round(custo * 100) / 100,
    })

    custoTotal += custo
  }

  return {
    custoTotal: Math.round(custoTotal * 100) / 100,
    detalhePorEtapa,
  }
}

// ============================================================================
// 2.6 — CÁLCULO DE ACABAMENTOS
// ============================================================================

interface ParamsAcabamentos {
  folhasBrutas: number
  quantidade: number
  acabamentos: Array<{
    tipo: string
    custoHora: number
    velocidade: number // folhas/hora ou unidades/hora
    setupMinutos: number
    custoMaterialM2?: number // para verniz UV, laminação
    custoMaterialUn?: number // para hot stamping
  }>
  larguraMm: number
  alturaMm: number
}

/**
 * Calcula o custo de acabamentos (corte/vinco, colagem, verniz, laminação, etc.)
 * Cada acabamento: setup + (unidades / velocidade) × custoHora + custo material
 *
 * Tipos que usam folhasBrutas: CORTE_VINCO, VERNIZ_UV, LAMINACAO
 * Tipos que usam quantidade: COLAGEM, HOT_STAMPING, DESTACAR
 */
export function calcularAcabamentos(params: ParamsAcabamentos): ResultadoAcabamentos {
  const { folhasBrutas, quantidade, acabamentos, larguraMm, alturaMm } = params

  const detalhePorAcabamento: Array<{ tipo: string; custo: number }> = []
  let custoTotal = 0

  const larguraM = larguraMm / 1000
  const alturaM = alturaMm / 1000

  for (const acab of acabamentos) {
    // Determina se o acabamento trabalha por folha ou por unidade
    const tipoUpper = acab.tipo.toUpperCase()
    const usaFolhas = tipoUpper.includes('CORTE') || tipoUpper.includes('VINCO') ||
      tipoUpper.includes('VERNIZ') || tipoUpper.includes('LAMINAC')
    const unidades = usaFolhas ? folhasBrutas : quantidade

    // Custo de tempo de máquina
    const velocidadeMinuto = acab.velocidade / 60
    const operacaoMin = velocidadeMinuto > 0 ? unidades / velocidadeMinuto : 0
    const tempoTotalMin = acab.setupMinutos + operacaoMin
    const custoTempo = (tempoTotalMin / 60) * acab.custoHora

    // Custo de material (área ou unitário)
    let custoMaterial = 0
    if (acab.custoMaterialM2 && acab.custoMaterialM2 > 0) {
      const areaTotal = folhasBrutas * larguraM * alturaM
      custoMaterial = areaTotal * acab.custoMaterialM2
    } else if (acab.custoMaterialUn && acab.custoMaterialUn > 0) {
      custoMaterial = quantidade * acab.custoMaterialUn
    }

    const custoAcabamento = custoTempo + custoMaterial

    detalhePorAcabamento.push({
      tipo: acab.tipo,
      custo: Math.round(custoAcabamento * 100) / 100,
    })

    custoTotal += custoAcabamento
  }

  return {
    custoTotal: Math.round(custoTotal * 100) / 100,
    detalhePorAcabamento,
  }
}

// ============================================================================
// 2.7 — FORMAÇÃO DE PREÇO DE VENDA
// ============================================================================

interface ParamsMargem {
  impostos: number   // %
  comissao: number   // %
  despAdm: number    // %
  markup: number     // %
}

/**
 * Forma o preço de venda a partir do custo total.
 * Fórmula: precoVenda = custoTotal / (1 - impostos/100 - comissao/100 - despAdm/100) * (1 + markup/100)
 *
 * A primeira parte (divisão) "embutir" os custos percentuais no preço (método divisor),
 * e o markup é aplicado sobre esse resultado como margem de lucro.
 */
export function formarPrecoVenda(custoTotal: number, margem: ParamsMargem): number {
  const { impostos, comissao, despAdm, markup } = margem

  const somaDespesasPercent = (impostos + comissao + despAdm) / 100

  // Proteção: se a soma de despesas >= 100%, o divisor fica 0 ou negativo
  if (somaDespesasPercent >= 1) {
    throw new Error(
      `Soma de impostos (${impostos}%) + comissão (${comissao}%) + desp. administrativas (${despAdm}%) ` +
      `= ${(somaDespesasPercent * 100).toFixed(1)}% — não pode ser ≥ 100%`,
    )
  }

  const precoBase = custoTotal / (1 - somaDespesasPercent)
  const precoVenda = precoBase * (1 + markup / 100)

  return Math.round(precoVenda * 100) / 100
}

// ============================================================================
// 2.1 — FUNÇÃO PRINCIPAL: calcularOrcamentoGrafico
// ============================================================================

/**
 * Motor principal de cálculo de orçamento gráfico.
 * Orquestra todas as etapas: planificação → encaixe → papel → tinta → máquinas → acabamentos → preço.
 */
export function calcularOrcamentoGrafico(params: ParamsOrcamento): ResultadoOrcamento {
  const {
    tipoEmbalagem,
    medidas,
    papel,
    maquinaImpressao,
    cores,
    acabamentos,
    quantidade,
    perdas,
    margem,
  } = params

  // 1. Avaliar fórmulas de planificação
  // Montar variáveis para o avaliador: medidas + valores do tipo de embalagem
  const variaveisFormula: Record<string, number> = {
    ...medidas,
    ABA: tipoEmbalagem.abaColagemMm,
    SANGRIA: tipoEmbalagem.sangriaMm,
    PINCA: tipoEmbalagem.pincaMm,
  }

  const planificacaoLargura = avaliarFormula(tipoEmbalagem.formulaLargura, variaveisFormula)
  const planificacaoAltura = avaliarFormula(tipoEmbalagem.formulaAltura, variaveisFormula)

  const planificacao = {
    larguraMm: Math.round(planificacaoLargura * 100) / 100,
    alturaMm: Math.round(planificacaoAltura * 100) / 100,
  }

  // 2. Calcular encaixe (imposição)
  const encaixe = calcularEncaixe({
    planificacao,
    folha: {
      larguraMm: maquinaImpressao.formatoLargura,
      alturaMm: maquinaImpressao.formatoAltura,
    },
    sangriaMm: tipoEmbalagem.sangriaMm,
    pincaMm: maquinaImpressao.pinca,
  })

  // Calcular folhas necessárias baseado na quantidade e aproveitamento
  const folhasNecessarias = Math.ceil(quantidade / encaixe.aproveitamento)
  encaixe.folhasNecessarias = folhasNecessarias

  // 3. Calcular papel
  const resultadoPapel = calcularPapel({
    folhasNecessarias,
    larguraMm: maquinaImpressao.formatoLargura,
    alturaMm: maquinaImpressao.formatoAltura,
    gramaturaGm2: papel.gramatura,
    precoKg: papel.precoKg,
    perdaPercent: perdas.impressaoPercent,
    perdaFixaFolhas: perdas.impressaoFixaFolhas,
  })

  const { folhasBrutas } = resultadoPapel

  // 4. Calcular tinta
  const resultadoTinta = calcularTinta({
    folhasBrutas,
    larguraMm: maquinaImpressao.formatoLargura,
    alturaMm: maquinaImpressao.formatoAltura,
    cores,
  })

  // 5. Calcular máquinas (impressão como etapa principal)
  const etapasMaquina = [
    {
      nome: 'Impressão',
      velocidade: maquinaImpressao.velocidade,
      custoHora: maquinaImpressao.custoHora,
      setupMinutos: maquinaImpressao.setupMinutos,
      usaFolhas: true,
    },
  ]
  const resultadoMaquinas = calcularMaquinas({
    folhasBrutas,
    quantidade,
    etapas: etapasMaquina,
  })

  // 6. Calcular acabamentos
  const resultadoAcabamentos = calcularAcabamentos({
    folhasBrutas,
    quantidade,
    acabamentos,
    larguraMm: maquinaImpressao.formatoLargura,
    alturaMm: maquinaImpressao.formatoAltura,
  })

  // 7. Somar custos
  const custoTotal =
    resultadoPapel.custo +
    resultadoTinta.custoTotal +
    resultadoMaquinas.custoTotal +
    resultadoAcabamentos.custoTotal

  const custoTotalArredondado = Math.round(custoTotal * 100) / 100

  // 8. Formar preço de venda
  const precoVenda = formarPrecoVenda(custoTotalArredondado, margem)
  const precoUnitario = Math.round((precoVenda / quantidade) * 10000) / 10000 // 4 casas

  // 9. Calcular margem real (% do preço de venda que é lucro líquido)
  // Margem real = (precoVenda - custoTotal) / precoVenda * 100
  const margemReal = precoVenda > 0
    ? Math.round(((precoVenda - custoTotalArredondado) / precoVenda) * 10000) / 100
    : 0

  // 10. Breakdown percentual de custos
  const breakdown = {
    papelPercent: custoTotalArredondado > 0 ? Math.round((resultadoPapel.custo / custoTotalArredondado) * 10000) / 100 : 0,
    tintaPercent: custoTotalArredondado > 0 ? Math.round((resultadoTinta.custoTotal / custoTotalArredondado) * 10000) / 100 : 0,
    maquinaPercent: custoTotalArredondado > 0 ? Math.round((resultadoMaquinas.custoTotal / custoTotalArredondado) * 10000) / 100 : 0,
    acabamentoPercent: custoTotalArredondado > 0 ? Math.round((resultadoAcabamentos.custoTotal / custoTotalArredondado) * 10000) / 100 : 0,
  }

  return {
    planificacao,
    encaixe,
    papel: { pesoKg: resultadoPapel.pesoKg, custo: resultadoPapel.custo },
    tinta: resultadoTinta,
    maquinas: resultadoMaquinas,
    acabamentos: resultadoAcabamentos,
    custoTotal: custoTotalArredondado,
    precoVenda,
    precoUnitario,
    margemReal,
    breakdown,
  }
}
