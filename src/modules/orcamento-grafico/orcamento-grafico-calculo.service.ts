// Motor de cálculo de orçamento gráfico — serviço puro (sem dependências de banco)

import { calcularConsumoTinta } from './consumo-tinta'
import { calcularCustoTransformacao, type AtividadeCT } from './custo-transformacao'

// ============================================================================
// INTERFACES
// ============================================================================

// ── Acabamentos: tipos do contrato (paridade Calcgraf — spec acabamentos) ──
//
// O campo `ParamsOrcamento.acabamentos` aceita DOIS formatos no mesmo array:
//   (a) LEGADO — item sem `naturezaCusto` (caminho de cálculo atual).
//   (b) RICO   — item com discriminante `naturezaCusto`, com campos próprios
//                por natureza (hora-máquina/material kg/material un/custo fixo).
//
// NOTA (TASK 1.1): este arquivo define apenas o CONTRATO/tipos. A LÓGICA de
// cálculo dos itens ricos é das tasks 1.2/1.3 — por ora, itens ricos são
// IGNORADOS no cálculo (apenas os itens legados seguem o fluxo atual).

/** Natureza de custo de um item de acabamento rico. */
export type AcabNaturezaCusto = 'HORA_MAQUINA' | 'MATERIAL_KG' | 'MATERIAL_UN' | 'CUSTO_FIXO'

/** Item de acabamento LEGADO (compatibilidade — caminho de cálculo atual). */
export interface ItemAcabamentoLegado {
  tipo: string
  custoHora: number
  velocidade: number
  setupMinutos: number
  custoMaterialM2?: number
  custoMaterialUn?: number
}

/** Item de acabamento RICO — discriminado por `naturezaCusto`. */
export type ItemAcabamentoRico =
  | {
      naturezaCusto: 'HORA_MAQUINA'
      nome: string
      custoHora: number
      producaoHora?: number
      unidadeBase?: 'FOLHA' | 'PRODUTO'
      quantAcertos?: number
      tempoPorAcertoMin?: number
      tempoPrimeiroAcertoMin?: number
      ocorrencias?: number
      /**
       * Tempos DIRETOS em horas (paridade exata com o pré-cálculo Calcgraf, que
       * exibe acerto/produção em hh:mm). Quando presentes, o custo do centro é
       * `(tempoFixoHoras + tempoVarHoras) × custoHora`, ignorando
       * producaoHora/acertos (que são a forma derivada). Aditivo — sem eles,
       * o cálculo derivado atual continua valendo.
       */
      tempoFixoHoras?: number
      tempoVarHoras?: number
    }
  | { naturezaCusto: 'MATERIAL_KG'; nome: string; variavelKg: number; precoKg: number }
  | { naturezaCusto: 'MATERIAL_UN'; nome: string; variavelUn: number; precoUn: number }
  | { naturezaCusto: 'CUSTO_FIXO'; nome: string; valorFixo: number }

/** Um item de acabamento pode ser legado OU rico (union no mesmo array). */
export type ItemAcabamento = ItemAcabamentoLegado | ItemAcabamentoRico

/** Type guard: `true` quando o item é rico (tem o discriminante). */
export function isAcabamentoRico(acab: ItemAcabamento): acab is ItemAcabamentoRico {
  return 'naturezaCusto' in acab
}

export interface ParamsOrcamento {
  tipoEmbalagem: {
    formulaLargura: string
    formulaAltura: string
    abaColagemMm: number
    sangriaMm: number
    pincaMm: number
    // Parâmetros customizados do tipo (ex.: FUNDO, DOBRA) com seus defaults.
    // Usados nas fórmulas de planificação quando não vierem em `medidas`.
    parametros?: Array<{ nome: string; default?: number }>
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
    // ── Paridade Calcgraf (aditivo) ──
    /** Minutos de acerto por cor (impressão offset). Se presente, o CT da
     * impressão usa o modelo calibrado: fixo = cores × acertoPorCorMin + setup. */
    acertoPorCorMin?: number
    /** Nº de cores da impressão (para o acerto por cor). Default = cores.length. */
    numCoresImpressao?: number
  }
  cores: Array<{
    nome: string
    tipo: 'CMYK' | 'PANTONE'
    coberturaPercent: number
    precoKg: number
    rendimentoM2Kg: number
    /** Densidade da tinta (SPANKS). Opcional; default 1,0 (preto) / 1,3 (process). */
    densidade?: number
  }>
  /**
   * Aproveitamento (peças por folha) INFORMADO manualmente — override do encaixe
   * geométrico. O Calcgraf usa a faca/imposição real (ex.: TR 2x2 = 4 peças);
   * o encaixe geométrico do Vizor pode divergir. Quando `aproveitamentoManual`
   * > 0, o motor usa esse valor em `folhasNecessarias = ceil(quantidade / aprov)`
   * no lugar do calculado. Aditivo: ausente → encaixe geométrico (atual).
   */
  aproveitamentoManual?: number
  /** Coeficiente de tinta do suporte (fator Stock SPANKS). Se presente, a tinta
   * usa o modelo calibrado SPANKS em vez de rendimentoM2Kg. */
  coefTintaSuporte?: number
  /** Partida de consumo de tinta (kg) por cor — modelo SPANKS. Default 0,2. */
  partidaConsumoTintaKg?: number
  /**
   * Acabamentos do orçamento. Aceita itens LEGADOS (sem `naturezaCusto`) e
   * itens RICOS (com `naturezaCusto`) no mesmo array. Ver `ItemAcabamento`.
   */
  acabamentos: Array<ItemAcabamento>
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
  // ── Paridade Calcgraf (todos opcionais/aditivos) ─────────────────────────
  /** Serviços terceirizados (entram no Custo de Produção). */
  servicosExternos?: Array<{ descricao: string; valor: number }>
  /** Custos avulsos lançados no cálculo (entram no Material Direto). */
  itensDiversos?: Array<{ descricao: string; valor: number }>
  /** Materiais fornecidos pelo cliente — NÃO cobrados (deduzidos do MD). */
  itensFornecidos?: Array<{ descricao: string; valor: number }>
  /** Créditos fiscais que reduzem o custo total (ex.: Cr.IPI). */
  creditosFiscais?: number
  /** Encargo financeiro (%) somado ao custo total (ex.: C.Finan 0,13%). */
  encargoFinanceiroPerc?: number
  /**
   * CEV (Custos de Venda) detalhado como no Calcgraf. Se ausente, é derivado de
   * `margem` (impostos+comissao+despAdm) para compatibilidade.
   */
  cev?: {
    icms: number
    juros: number
    pisCofins: number
    comissoes: number
  }
}

export interface ResultadoOrcamento {
  planificacao: { larguraMm: number; alturaMm: number }
  encaixe: ResultadoEncaixe
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
  // ── Paridade Calcgraf (aditivo) — decomposição estilo memória de cálculo ──
  materialDireto: number
  custoTransformacao: number
  servicoExterno: number
  custoProducao: number // = MD + CT + SE
  cevPerc: number
  cevValor: number
  contribuicaoMarginalValor: number
  contribuicaoMarginalPerc: number
  /** Origem do modelo de cálculo por componente (paridade Calcgraf vs legado). */
  modeloCalculo?: {
    tinta: 'CALIBRADO' | 'LEGADO'
    maquina: 'CALIBRADO' | 'LEGADO'
  }
  // ── Acabamentos ricos (paridade Calcgraf) — preenchidos nas tasks 1.2/1.3 ──
  /**
   * Bloco MAT.ACABAMENTO — materiais de acabamento (kg/un/fixo) que entram no
   * Material Direto. Preenchido em 1.2 (ausente enquanto não houver itens ricos).
   */
  matAcabamento?: {
    custoTotal: number
    itens: Array<{
      nome: string
      natureza: string
      fixo: number
      variavel: number
      unitario: number
      subtotal: number
    }>
  }
  /**
   * Cadeia de centros de acabamento (hora-máquina) que entra no Custo de
   * Transformação. Preenchido em 1.3 (ausente enquanto não houver itens ricos).
   */
  acabamentosCentros?: {
    custoTotal: number
    detalhePorEtapa: Array<{ etapa: string; setupMin: number; operacaoMin: number; custo: number }>
  }
}

// Interfaces auxiliares para funções individuais
export interface ResultadoEncaixe {
  aproveitamento: number
  folhasNecessarias: number
  percentAproveitamentoFolha: number
  orientacao: 'NORMAL' | 'ROTACIONADA'
  // Layout do encaixe (para desenho/visualização). Dimensões em mm.
  layout?: {
    folhaLarguraMm: number
    folhaAlturaMm: number
    pincaMm: number
    colunas: number
    linhas: number
    pecaLarguraMm: number // já com sangria, na orientação escolhida
    pecaAlturaMm: number
  }
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

  // Dimensões da peça (com sangria) e grade na orientação escolhida.
  const rotacionada = orientacao === 'ROTACIONADA'
  const pecaLarguraLayout = rotacionada ? pecaAltura : pecaLargura
  const pecaAlturaLayout = rotacionada ? pecaLargura : pecaAltura
  const colunas = rotacionada ? colsRotacionada : colsNormal
  const linhas = rotacionada ? rowsRotacionada : rowsNormal

  // % de aproveitamento da folha (área das peças / área total da folha)
  const areaPecas = aproveitamento * pecaLargura * pecaAltura
  const areaFolha = folha.larguraMm * folha.alturaMm
  const percentAproveitamentoFolha = (areaPecas / areaFolha) * 100

  return {
    aproveitamento,
    folhasNecessarias: 0, // será calculado em calcularPapel com base na quantidade
    percentAproveitamentoFolha: Math.round(percentAproveitamentoFolha * 100) / 100,
    orientacao,
    layout: {
      folhaLarguraMm: folha.larguraMm,
      folhaAlturaMm: folha.alturaMm,
      pincaMm,
      colunas: Math.max(0, colunas),
      linhas: Math.max(0, linhas),
      pecaLarguraMm: Math.round(pecaLarguraLayout * 100) / 100,
      pecaAlturaMm: Math.round(pecaAlturaLayout * 100) / 100,
    },
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
 * Forma o preço de venda pelo MÉTODO DIVISOR ÚNICO (gross-up), igual ao
 * Calcgraf (ver docs/calcgraf-formulas-decompostas.md):
 *
 *   Preço = Custo Total / (1 − (Margem% + CEV%)/100)
 *
 * onde CEV% = impostos + comissão + desp. administrativas (agrupados como
 * Custos de Venda) e Margem% = markup (lucro). Confirmado nos golden cases:
 * 7.310,24 / (1 − 0,30 − 0,1825) = 14.128 ✓.
 *
 * Mantida a assinatura `(custoTotal, ParamsMargem)` por compatibilidade — o
 * markup entra NO divisor (não mais por fora), alinhando ao Calcgraf.
 */
export function formarPrecoVenda(custoTotal: number, margem: ParamsMargem): number {
  const { impostos, comissao, despAdm, markup } = margem

  // CEV = custos de venda; Margem = markup (lucro). Ambos entram no divisor.
  const fatorTotal = (impostos + comissao + despAdm + markup) / 100

  if (fatorTotal >= 1) {
    throw new Error(
      `Margem (${markup}%) + CEV (impostos ${impostos}% + comissão ${comissao}% + desp.adm ${despAdm}%) ` +
      `= ${(fatorTotal * 100).toFixed(1)}% — não pode ser ≥ 100%`,
    )
  }

  const precoVenda = custoTotal / (1 - fatorTotal)
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
  // Montar variáveis para o avaliador. Ordem de precedência (menor → maior):
  //   defaults dos parâmetros customizados do tipo (ex.: FUNDO, DOBRA)
  //   → ABA/SANGRIA/PINCA do tipo → medidas informadas pelo usuário.
  // Sem os defaults dos parâmetros, fórmulas que os referenciam (ex.: SACOLA:
  // "A + FUNDO + DOBRA + SANGRIA*2") quebravam o avaliador (erro 500).
  const defaultsParametros: Record<string, number> = {}
  for (const p of tipoEmbalagem.parametros ?? []) {
    if (p && typeof p.default === 'number') {
      defaultsParametros[p.nome.toUpperCase()] = p.default
    }
  }

  const variaveisFormula: Record<string, number> = {
    ...defaultsParametros,
    ABA: tipoEmbalagem.abaColagemMm,
    SANGRIA: tipoEmbalagem.sangriaMm,
    PINCA: tipoEmbalagem.pincaMm,
    ...medidas,
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

  // Aproveitamento efetivo: override manual (imposição real/faca) quando
  // informado e > 0; senão o calculado geometricamente. Reflete também no
  // objeto `encaixe` para a tela mostrar o valor usado.
  const aproveitamentoEfetivo =
    params.aproveitamentoManual && params.aproveitamentoManual > 0
      ? Math.floor(params.aproveitamentoManual)
      : encaixe.aproveitamento
  encaixe.aproveitamento = aproveitamentoEfetivo

  // Calcular folhas necessárias baseado na quantidade e aproveitamento
  const folhasNecessarias = Math.ceil(quantidade / aproveitamentoEfetivo)
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

  // 4. Calcular tinta — CALIBRADO (SPANKS) se coefTintaSuporte presente, senão LEGADO
  const larguraM = maquinaImpressao.formatoLargura / 1000
  const alturaM = maquinaImpressao.formatoAltura / 1000
  const areaImpressaM2 = folhasBrutas * larguraM * alturaM
  let resultadoTinta: ResultadoTinta
  let modeloTinta: 'CALIBRADO' | 'LEGADO'
  if (params.coefTintaSuporte && params.coefTintaSuporte > 0 && cores.length > 0) {
    // Modelo SPANKS: uma passagem por cor; cobertura e densidade por cor.
    const partida = params.partidaConsumoTintaKg ?? 0.2
    const detalhePorCor: Array<{ cor: string; consumoKg: number; custo: number }> = []
    let custoTotalTinta = 0
    for (const cor of cores) {
      const r = calcularConsumoTinta({
        coefSuporte: params.coefTintaSuporte,
        fatorProcesso: 0.5, // offset
        areaM2: areaImpressaM2,
        lados: 1,
        cobertura: cor.coberturaPercent / 100,
        // Densidade: default 1,0 (valor que calibrou no 15185 — ver
        // docs/calcgraf-consumo-tinta.md). Override opcional por cor/tinta.
        densidade: cor.densidade ?? 1.0,
        cores: 1, // partida por cor (1 cor por iteração)
        ocorrencias: 1,
        precoKg: cor.precoKg,
        partidaConsumoKg: partida,
      })
      detalhePorCor.push({ cor: cor.nome, consumoKg: r.consumoTotalKg, custo: r.custo })
      custoTotalTinta += r.custo
    }
    resultadoTinta = { custoTotal: Math.round(custoTotalTinta * 100) / 100, detalhePorCor }
    modeloTinta = 'CALIBRADO'
  } else {
    resultadoTinta = calcularTinta({
      folhasBrutas,
      larguraMm: maquinaImpressao.formatoLargura,
      alturaMm: maquinaImpressao.formatoAltura,
      cores,
    })
    modeloTinta = 'LEGADO'
  }

  // 5. Calcular máquinas (impressão como etapa principal)
  // CALIBRADO (acerto por cor) se acertoPorCorMin presente, senão LEGADO.
  let resultadoMaquinas: ResultadoMaquinas
  let modeloMaquina: 'CALIBRADO' | 'LEGADO'
  if (maquinaImpressao.acertoPorCorMin && maquinaImpressao.acertoPorCorMin > 0) {
    const numCores = maquinaImpressao.numCoresImpressao ?? cores.length
    const atividadeImpressao: AtividadeCT = {
      nome: 'Impressão',
      impressao: true,
      custoHora: maquinaImpressao.custoHora,
      producaoHora: maquinaImpressao.velocidade,
      unidadesProcessadas: folhasBrutas,
      cores: numCores,
      acertoPorCorMin: maquinaImpressao.acertoPorCorMin,
      tempoPrimeiroAcertoMin: maquinaImpressao.setupMinutos || 0,
    }
    const ct = calcularCustoTransformacao([atividadeImpressao], quantidade)
    const det = ct.detalhe[0]
    resultadoMaquinas = {
      custoTotal: ct.custoTotal,
      detalhePorEtapa: [{
        etapa: 'Impressão',
        setupMin: det ? det.tempoFixoMin : 0,
        operacaoMin: det ? Math.round(det.tempoVarHoras * 60 * 100) / 100 : 0,
        custo: ct.custoTotal,
      }],
    }
    modeloMaquina = 'CALIBRADO'
  } else {
    const etapasMaquina = [
      {
        nome: 'Impressão',
        velocidade: maquinaImpressao.velocidade,
        custoHora: maquinaImpressao.custoHora,
        setupMinutos: maquinaImpressao.setupMinutos,
        usaFolhas: true,
      },
    ]
    resultadoMaquinas = calcularMaquinas({
      folhasBrutas,
      quantidade,
      etapas: etapasMaquina,
    })
    modeloMaquina = 'LEGADO'
  }

  // 6. Calcular acabamentos
  // TASK 1.1 (contrato): o array `acabamentos` pode conter itens LEGADOS e
  // RICOS. Nesta task apenas os LEGADOS seguem o cálculo atual (comportamento
  // idêntico). Os itens ricos (com `naturezaCusto`) são tratados em 1.2/1.3.
  const acabamentosLegados: ItemAcabamentoLegado[] = acabamentos.filter(
    (a): a is ItemAcabamentoLegado => !isAcabamentoRico(a),
  )
  const resultadoAcabamentos = calcularAcabamentos({
    folhasBrutas,
    quantidade,
    acabamentos: acabamentosLegados,
    larguraMm: maquinaImpressao.formatoLargura,
    alturaMm: maquinaImpressao.formatoAltura,
  })

  // 6.1 — Bloco MAT.ACABAMENTO (TASK 1.2): materiais de acabamento RICOS que
  // entram no MATERIAL DIRETO. Três naturezas (ver golden 15.235):
  //   • MATERIAL_KG: subtotal = variavelKg × precoKg  (ex.: Cola, Verniz)
  //   • MATERIAL_UN: subtotal = variavelUn × precoUn  (ex.: Caixa Padrão)
  //   • CUSTO_FIXO : subtotal = valorFixo (NÃO escala com tiragem; ex.: FACA NOVA)
  // Os itens HORA_MAQUINA NÃO entram aqui (são da cadeia de centros no CT —
  // task 1.3); por ora são ignorados neste bloco.
  const acabamentosRicos: ItemAcabamentoRico[] = acabamentos.filter(isAcabamentoRico)
  const arred2 = (x: number) => Math.round(x * 100) / 100
  const matAcabamentoItens: Array<{
    nome: string
    natureza: string
    fixo: number
    variavel: number
    unitario: number
    subtotal: number
  }> = []
  for (const acab of acabamentosRicos) {
    if (acab.naturezaCusto === 'MATERIAL_KG') {
      const subtotal = arred2(acab.variavelKg * acab.precoKg)
      matAcabamentoItens.push({
        nome: acab.nome,
        natureza: 'MATERIAL_KG',
        fixo: 0,
        variavel: acab.variavelKg,
        unitario: acab.precoKg,
        subtotal,
      })
    } else if (acab.naturezaCusto === 'MATERIAL_UN') {
      const subtotal = arred2(acab.variavelUn * acab.precoUn)
      matAcabamentoItens.push({
        nome: acab.nome,
        natureza: 'MATERIAL_UN',
        fixo: 0,
        variavel: acab.variavelUn,
        unitario: acab.precoUn,
        subtotal,
      })
    } else if (acab.naturezaCusto === 'CUSTO_FIXO') {
      const subtotal = arred2(acab.valorFixo)
      matAcabamentoItens.push({
        nome: acab.nome,
        natureza: 'CUSTO_FIXO',
        fixo: subtotal,
        variavel: 0,
        unitario: 0,
        subtotal,
      })
    }
    // HORA_MAQUINA: ignorado aqui (task 1.3, Custo de Transformação).
  }
  const matAcabamentoCustoTotal = arred2(matAcabamentoItens.reduce((s, i) => s + i.subtotal, 0))
  // Só expõe o bloco quando houver itens de material (preserva resultado atual
  // de orçamentos sem acabamentos ricos — matAcabamento fica `undefined`).
  const matAcabamento =
    matAcabamentoItens.length > 0
      ? { custoTotal: matAcabamentoCustoTotal, itens: matAcabamentoItens }
      : undefined

  // 6.2 — CADEIA DE CENTROS DE ACABAMENTO (TASK 1.3): acabamentos RICOS do tipo
  // HORA_MAQUINA que entram no CUSTO DE TRANSFORMAÇÃO (CT), ao lado da impressão.
  // Cada centro vira uma `AtividadeCT` (impressao:false) e a cadeia é calculada
  // com o MESMO módulo calibrado da impressão (`calcularCustoTransformacao`),
  // garantindo uma única fonte de verdade para o CT.
  //
  //   • unidadesProcessadas = unidadeBase==='FOLHA' ? folhasBrutas : quantidade
  //   • setup/produção seguem a fórmula do Calcgraf (quantAcertos × tempoPorAcerto
  //     + tempoPrimeiroAcerto; produção = unidades / producaoHora).
  //
  // Quando NÃO há acabamentos HORA_MAQUINA ricos, `acabamentosCentros` fica
  // `undefined` e o `custoTransformacao` permanece idêntico ao de hoje
  // (não-regressão — ver aditividade da task 1.4).
  const centrosHoraMaquina = acabamentosRicos.filter(
    (a): a is Extract<ItemAcabamentoRico, { naturezaCusto: 'HORA_MAQUINA' }> =>
      a.naturezaCusto === 'HORA_MAQUINA',
  )

  let acabamentosCentros:
    | {
        custoTotal: number
        detalhePorEtapa: Array<{ etapa: string; setupMin: number; operacaoMin: number; custo: number }>
      }
    | undefined
  if (centrosHoraMaquina.length > 0) {
    const detalhePorEtapa: Array<{ etapa: string; setupMin: number; operacaoMin: number; custo: number }> = []
    let somaCusto = 0
    for (const a of centrosHoraMaquina) {
      // MODO DIRETO (paridade exata Calcgraf): tempos fixo/var em horas vindos
      // do pré-cálculo (hh:mm). custo = (tempoFixoH + tempoVarH) × custoHora.
      if (a.tempoFixoHoras != null || a.tempoVarHoras != null) {
        const tf = a.tempoFixoHoras ?? 0
        const tv = a.tempoVarHoras ?? 0
        const custo = Math.round((tf + tv) * a.custoHora * 100) / 100
        detalhePorEtapa.push({
          etapa: a.nome,
          setupMin: Math.round(tf * 60 * 100) / 100,
          operacaoMin: Math.round(tv * 60 * 100) / 100,
          custo,
        })
        somaCusto += custo
      } else {
        // MODO DERIVADO: reusa o módulo calibrado (produção = unidades/producaoHora;
        // acerto = quantAcertos × tempoPorAcerto + tempoPrimeiroAcerto).
        const ct = calcularCustoTransformacao(
          [
            {
              nome: a.nome,
              impressao: false,
              custoHora: a.custoHora,
              producaoHora: a.producaoHora ?? 0,
              unidadesProcessadas: a.unidadeBase === 'FOLHA' ? folhasBrutas : quantidade,
              quantAcertos: a.quantAcertos,
              tempoPorAcertoMin: a.tempoPorAcertoMin,
              tempoPrimeiroAcertoMin: a.tempoPrimeiroAcertoMin,
              ocorrencias: a.ocorrencias,
            },
          ],
          quantidade,
        )
        const d = ct.detalhe[0]
        detalhePorEtapa.push({
          etapa: a.nome,
          setupMin: d ? d.tempoFixoMin : 0,
          operacaoMin: d ? Math.round(d.tempoVarHoras * 60 * 100) / 100 : 0,
          custo: ct.custoTotal,
        })
        somaCusto += ct.custoTotal
      }
    }
    acabamentosCentros = { custoTotal: Math.round(somaCusto * 100) / 100, detalhePorEtapa }
  }
  const acabamentosCentrosCustoTotal = acabamentosCentros?.custoTotal ?? 0

  // 7. Decomposição de custo estilo Calcgraf (ver docs/calcgraf-formulas-decompostas.md)
  const somaExtras = (arr?: Array<{ valor: number }>) => (arr ?? []).reduce((s, i) => s + (i.valor || 0), 0)
  const totalItensDiversos = somaExtras(params.itensDiversos)
  const totalItensFornecidos = somaExtras(params.itensFornecidos)
  const totalServicoExterno = somaExtras(params.servicosExternos)

  // Material Direto = papel + tinta + MAT.ACABAMENTO + itens diversos − itens
  // fornecidos (cliente). O bloco MAT.ACABAMENTO (task 1.2) é SOMADO ao MD de
  // forma explícita; quando não há acabamentos ricos de material,
  // matAcabamentoCustoTotal = 0 e o MD fica idêntico ao de hoje (não-regressão).
  const materialDireto = Math.max(
    0,
    resultadoPapel.custo +
      resultadoTinta.custoTotal +
      matAcabamentoCustoTotal +
      totalItensDiversos -
      totalItensFornecidos,
  )
  // Custo de Transformação = impressão (máquinas) + acabamentos LEGADOS +
  // cadeia de centros de acabamento RICOS (task 1.3). O acabamento legado
  // continua somado (não quebra orçamentos atuais); a cadeia rica é aditiva e
  // vale 0 quando não há itens HORA_MAQUINA ricos (não-regressão).
  const custoTransformacao =
    resultadoMaquinas.custoTotal + resultadoAcabamentos.custoTotal + acabamentosCentrosCustoTotal
  const servicoExterno = totalServicoExterno

  // Custo de Produção = MD + CT + SE
  const custoProducao = materialDireto + custoTransformacao + servicoExterno
  // Custo Total = Custo Produção − créditos fiscais + encargo financeiro%
  const creditos = params.creditosFiscais ?? 0
  const encFinPerc = params.encargoFinanceiroPerc ?? 0
  const custoTotal = custoProducao - creditos + custoProducao * (encFinPerc / 100)

  const custoTotalArredondado = Math.round(custoTotal * 100) / 100

  // 8. CEV (Custos de Venda) — detalhado se vier, senão derivado da margem (compat)
  const cevPerc = params.cev
    ? params.cev.icms + params.cev.juros + params.cev.pisCofins + params.cev.comissoes
    : margem.impostos + margem.comissao + margem.despAdm

  // 9. Preço de venda (divisor único: Margem + CEV). Se `cev` veio, usa CEV
  // detalhado + markup; senão usa os campos atuais de `margem` (compat total).
  const margemParaPreco: ParamsMargem = params.cev
    ? { impostos: params.cev.icms + params.cev.juros + params.cev.pisCofins, comissao: params.cev.comissoes, despAdm: 0, markup: margem.markup }
    : margem
  const precoVenda = formarPrecoVenda(custoTotalArredondado, margemParaPreco)
  const precoUnitario = Math.round((precoVenda / quantidade) * 10000) / 10000 // 4 casas

  const cevValor = Math.round(precoVenda * (cevPerc / 100) * 100) / 100

  // 10. Margem real e Contribuição Marginal
  const margemReal = precoVenda > 0
    ? Math.round(((precoVenda - custoTotalArredondado) / precoVenda) * 10000) / 100
    : 0

  // CM$ = Preço − custos variáveis (Material Direto variável + CEV$). Aproxima o
  // conceito Calcgraf: contribuição = preço menos o que varia com a venda.
  const custosVariaveis = materialDireto + cevValor
  const contribuicaoMarginalValor = Math.round((precoVenda - custosVariaveis) * 100) / 100
  const contribuicaoMarginalPerc = precoVenda > 0
    ? Math.round((contribuicaoMarginalValor / precoVenda) * 10000) / 100
    : 0

  // 11. Breakdown percentual de custos
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
    // paridade Calcgraf
    materialDireto: Math.round(materialDireto * 100) / 100,
    custoTransformacao: Math.round(custoTransformacao * 100) / 100,
    servicoExterno: Math.round(servicoExterno * 100) / 100,
    custoProducao: Math.round(custoProducao * 100) / 100,
    cevPerc,
    cevValor,
    contribuicaoMarginalValor,
    contribuicaoMarginalPerc,
    modeloCalculo: { tinta: modeloTinta, maquina: modeloMaquina },
    // Bloco MAT.ACABAMENTO (task 1.2) — presente só quando há materiais ricos.
    matAcabamento,
    // Cadeia de centros de acabamento no CT (task 1.3) — presente só quando há
    // acabamentos HORA_MAQUINA ricos; senão `undefined` (não-regressão).
    acabamentosCentros,
  }
}
