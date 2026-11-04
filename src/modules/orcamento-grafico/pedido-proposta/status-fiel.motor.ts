/**
 * Motor PURO do "status fiel" do Pedido/Proposta (RFQ).
 * Spec: comercial-pedido-status-fiel (Fundação / item 1 da §20.4 do doc-mestre).
 *
 * SEM Prisma, SEM IO, SEM relógio — só lógica determinística, testável com
 * fast-check. É a fonte da verdade de:
 *  - catálogo de Situacoes_Internas (12), seu Status_Macro, Setor e terminalidade
 *  - tabela de transições (AVANCO/RETORNO)
 *  - derivação do Tipo_Pedido a partir das Respostas_Pedido
 *  - caminho de pré-impressão e exigências por Tipo_Pedido
 *  - mapeamentos de/para o Estado_Legado (8 valores atuais)
 *
 * Convivência: o legado `pedido-proposta-estado.service.ts` continua intacto.
 * Este módulo opera sobre `Situacao` (granular), não sobre `EstadoLegado`.
 */

// ============================================================================
// Tipos e enums do domínio novo
// ============================================================================

export type Situacao =
  | 'TRIAGEM'
  | 'PRE_IMPRESSAO_EM_ANDAMENTO'
  | 'PRE_IMPRESSAO_AGUARDA_INFO'
  | 'ORCAMENTO_EM_ANDAMENTO'
  | 'PROPOSTA_ENVIADA_AGUARDA_CLIENTE'
  | 'APROVACAO_ARTE_PENDENTE'
  | 'PROVA_PENDENTE'
  | 'APROVADO'
  | 'EM_PRODUCAO'
  | 'FATURADO'
  | 'PERDIDO'
  | 'CANCELADO'

export type StatusMacro =
  | 'RECEBIDO'
  | 'EM_PRE_IMPRESSAO'
  | 'EM_ORCAMENTO'
  | 'EM_APROVACAO'
  | 'APROVADO'
  | 'EM_PRODUCAO'
  | 'FATURADO'
  | 'PERDIDO'
  | 'CANCELADO'

export type Setor =
  | 'PRE_IMPRESSAO'
  | 'ORCAMENTO'
  | 'COMERCIAL'
  | 'REPRESENTANTE'
  | 'CLIENTE'

export type TipoPedido = 'REPETICAO' | 'ALTERACAO' | 'PRODUTO_NOVO'

export type CaminhoPreImpressao = 'CONFERENCIA' | 'PARCIAL' | 'COMPLETA'

export type SituacaoCliente = 'NOVO' | 'EXISTENTE'
export type SituacaoFaca = 'NOVA' | 'EXISTENTE' | 'NAO_INFORMADA'
export type SituacaoArte =
  | 'CRIAR'
  | 'CLIENTE_ENVIA'
  | 'EXISTENTE_SEM_ALTERACAO'
  | 'EXISTENTE_COM_ALTERACAO'
  | 'NAO_INFORMADA'

export interface RespostasPedido {
  situacaoCliente?: SituacaoCliente | null
  situacaoFaca?: SituacaoFaca | null
  situacaoArte?: SituacaoArte | null
  exigeProva?: boolean | null
}

/** Os 8 valores legados de `PedidoProposta.estado`. */
export type EstadoLegado =
  | 'NOVO'
  | 'EM_ANALISE'
  | 'ENVIADO_ORCAMENTO'
  | 'ORCADO'
  | 'PROPOSTA_ENVIADA'
  | 'ACEITO'
  | 'PERDIDO'
  | 'CANCELADO'

export type Classe = 'AVANCO' | 'RETORNO'

export interface Transicao {
  de: Situacao
  para: Situacao
  classe: Classe
}

/** Erro padronizado do motor (statusCode + code para as rotas mapearem). */
export class StatusFielError extends Error {
  constructor(public statusCode: number, message: string, public code: string) {
    super(message)
    this.name = 'StatusFielError'
  }
}

// ============================================================================
// Catálogo de Situacoes_Internas (Status_Macro × Setor × terminal)
// ============================================================================

interface MetaSituacao {
  status: StatusMacro
  setor: Setor | null
  terminal: boolean
}

const CATALOGO: Record<Situacao, MetaSituacao> = {
  TRIAGEM: { status: 'RECEBIDO', setor: 'COMERCIAL', terminal: false },
  PRE_IMPRESSAO_EM_ANDAMENTO: { status: 'EM_PRE_IMPRESSAO', setor: 'PRE_IMPRESSAO', terminal: false },
  PRE_IMPRESSAO_AGUARDA_INFO: { status: 'EM_PRE_IMPRESSAO', setor: 'REPRESENTANTE', terminal: false },
  ORCAMENTO_EM_ANDAMENTO: { status: 'EM_ORCAMENTO', setor: 'ORCAMENTO', terminal: false },
  PROPOSTA_ENVIADA_AGUARDA_CLIENTE: { status: 'EM_APROVACAO', setor: 'CLIENTE', terminal: false },
  APROVACAO_ARTE_PENDENTE: { status: 'EM_APROVACAO', setor: 'CLIENTE', terminal: false },
  PROVA_PENDENTE: { status: 'EM_APROVACAO', setor: 'CLIENTE', terminal: false },
  APROVADO: { status: 'APROVADO', setor: 'COMERCIAL', terminal: false },
  EM_PRODUCAO: { status: 'EM_PRODUCAO', setor: null, terminal: false },
  FATURADO: { status: 'FATURADO', setor: null, terminal: true },
  PERDIDO: { status: 'PERDIDO', setor: null, terminal: true },
  CANCELADO: { status: 'CANCELADO', setor: null, terminal: true },
}

export const SITUACOES_VALIDAS = Object.keys(CATALOGO) as Situacao[]

export function statusMacroDe(situacao: Situacao): StatusMacro {
  return CATALOGO[situacao].status
}

export function setorDe(situacao: Situacao): Setor | null {
  return CATALOGO[situacao].setor
}

export function isTerminal(situacao: Situacao): boolean {
  return CATALOGO[situacao].terminal
}

// ============================================================================
// Mapeamento de/para o Estado_Legado (Req 4.1 / 13.2)
// ============================================================================

/** Situacao_Interna -> Estado_Legado equivalente (mantém `estado` coerente). */
export function estadoLegadoDe(situacao: Situacao): EstadoLegado {
  switch (situacao) {
    case 'TRIAGEM':
      return 'NOVO'
    case 'PRE_IMPRESSAO_EM_ANDAMENTO':
    case 'PRE_IMPRESSAO_AGUARDA_INFO':
      return 'EM_ANALISE'
    case 'ORCAMENTO_EM_ANDAMENTO':
      return 'ENVIADO_ORCAMENTO'
    case 'PROPOSTA_ENVIADA_AGUARDA_CLIENTE':
    case 'APROVACAO_ARTE_PENDENTE':
    case 'PROVA_PENDENTE':
      return 'PROPOSTA_ENVIADA'
    case 'APROVADO':
    case 'EM_PRODUCAO':
    case 'FATURADO':
      return 'ACEITO'
    case 'PERDIDO':
      return 'PERDIDO'
    case 'CANCELADO':
      return 'CANCELADO'
  }
}

/**
 * Estado_Legado -> Situacao_Interna para a migração dos pedidos atuais (Req 4.1).
 * `temPreImpressao` permite (futuramente) distinguir pedidos já em pré-impressão;
 * hoje a migração passa `false` e os pedidos EM_ANALISE viram pré-impressão em
 * andamento.
 */
export function situacaoDeEstadoLegado(
  estado: EstadoLegado,
  _temPreImpressao = false,
): Situacao {
  switch (estado) {
    case 'NOVO':
      return 'TRIAGEM'
    case 'EM_ANALISE':
      return 'PRE_IMPRESSAO_EM_ANDAMENTO'
    case 'ENVIADO_ORCAMENTO':
    case 'ORCADO':
      return 'ORCAMENTO_EM_ANDAMENTO'
    case 'PROPOSTA_ENVIADA':
      return 'PROPOSTA_ENVIADA_AGUARDA_CLIENTE'
    case 'ACEITO':
      return 'APROVADO'
    case 'PERDIDO':
      return 'PERDIDO'
    case 'CANCELADO':
      return 'CANCELADO'
  }
}

export const ESTADOS_LEGADOS_VALIDOS: EstadoLegado[] = [
  'NOVO',
  'EM_ANALISE',
  'ENVIADO_ORCAMENTO',
  'ORCADO',
  'PROPOSTA_ENVIADA',
  'ACEITO',
  'PERDIDO',
  'CANCELADO',
]

// ============================================================================
// Derivação do Tipo_Pedido (Req 1.4 / 1.5 / 1.6 / 1.16)
// ============================================================================

export interface DerivacaoTipo {
  tipo: TipoPedido
  /** true quando houve Respostas_Pedido incompletas (Classificacao_A_Confirmar). */
  aConfirmar: boolean
}

/**
 * Deriva o Tipo_Pedido a partir das Respostas_Pedido. Função pura e total:
 * toda combinação válida (incluindo nulos/NAO_INFORMADA) produz exatamente um
 * tipo. Ordem de avaliação (Req 1.4):
 *   a) Faca NOVA  OU Arte CRIAR                      -> PRODUTO_NOVO
 *   b) Arte EXISTENTE_COM_ALTERACAO | CLIENTE_ENVIA  -> ALTERACAO
 *   c) Faca EXISTENTE E Arte EXISTENTE_SEM_ALTERACAO -> REPETICAO
 *   d) senão (alguma NAO_INFORMADA)                  -> PRODUTO_NOVO + aConfirmar
 */
export function derivarTipoPedido(r: RespostasPedido): DerivacaoTipo {
  const faca = r.situacaoFaca ?? 'NAO_INFORMADA'
  const arte = r.situacaoArte ?? 'NAO_INFORMADA'

  // (a)
  if (faca === 'NOVA' || arte === 'CRIAR') {
    return { tipo: 'PRODUTO_NOVO', aConfirmar: false }
  }
  // (b)
  if (arte === 'EXISTENTE_COM_ALTERACAO' || arte === 'CLIENTE_ENVIA') {
    return { tipo: 'ALTERACAO', aConfirmar: false }
  }
  // (c)
  if (faca === 'EXISTENTE' && arte === 'EXISTENTE_SEM_ALTERACAO') {
    return { tipo: 'REPETICAO', aConfirmar: false }
  }
  // (d) — chegou aqui porque faca ou arte é NAO_INFORMADA e não decidiu por (a)
  return { tipo: 'PRODUTO_NOVO', aConfirmar: true }
}

// ============================================================================
// Caminho de pré-impressão e exigências por Tipo_Pedido (Req 2.1 / 2.11)
// ============================================================================

export function caminhoPreImpressao(tipo: TipoPedido): CaminhoPreImpressao {
  switch (tipo) {
    case 'REPETICAO':
      return 'CONFERENCIA'
    case 'ALTERACAO':
      return 'PARCIAL'
    case 'PRODUTO_NOVO':
      return 'COMPLETA'
  }
}

export interface Exigencias {
  /** Passagem por EM_PRE_IMPRESSAO antes de APROVADO (sempre true). */
  preImpressao: boolean
  /** Calculo_Pedido concluído antes de EM_APROVACAO por proposta (sempre true). */
  calculo: boolean
  /** Aprovacao_Arte_Cliente registrada antes de APROVADO (sempre true). */
  aprovacaoArte: boolean
  /** Prova aprovada pelo cliente antes de APROVADO — só quando Exige_Prova. */
  prova: boolean
}

/**
 * Exigências do caminho por Tipo_Pedido (Req 2.2/2.4/2.5/2.6). Nenhum tipo
 * dispensa pré-impressão, cálculo nem aprovação de arte do cliente; a prova só
 * é exigida quando `exigeProva` é verdadeiro.
 */
export function exigenciasDoTipo(_tipo: TipoPedido, exigeProva: boolean): Exigencias {
  return {
    preImpressao: true,
    calculo: true,
    aprovacaoArte: true,
    prova: exigeProva === true,
  }
}

// ============================================================================
// Heurística de Situacao_Faca a partir do texto legado de `matriz` (Req 4.5)
// ============================================================================

/** Normaliza: minúsculo, sem acento, espaços colapsados. */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Deriva Situacao_Faca do texto livre do campo `matriz` dos pedidos atuais
 * (Req 4.5). Determinística:
 *  - menção a faca nova               -> NOVA
 *  - menção a "casa/repetição/na wega" OU um código (M1, matriz 123, 2529B,
 *    sequência de 3+ dígitos)         -> EXISTENTE
 *  - vazio / genérico                 -> NAO_INFORMADA
 */
export function situacaoFacaDoTexto(matriz: string | null | undefined): SituacaoFaca {
  if (!matriz) return 'NAO_INFORMADA'
  const t = normalizar(matriz)
  if (t === '' || t === '-' || t === '--' || t === '**' || t === 'nao sei' || t === 'n/a' || t === 'na') {
    return 'NAO_INFORMADA'
  }
  // faca nova
  if (/\b(nova|novo|tudo novo|faca nova|criar)\b/.test(t)) {
    return 'NOVA'
  }
  // faca da casa / repetição / código de matriz
  const temCodigo = /\bm\s*\d+\b/.test(t) || /\bmatriz\s*\d+/.test(t) || /\d{3,}/.test(t) || /\d+[a-z]\b/.test(t)
  if (
    temCodigo ||
    /\b(casa|tem na casa|na casa|repeti|repeticao|repetição|na grafica|na gráfica|na wega|existente|mesma)\b/.test(t)
  ) {
    return 'EXISTENTE'
  }
  return 'NAO_INFORMADA'
}

// ============================================================================
// Conversão do tipoPedido legado (REPETICAO | MOSTRUARIO | NOVO) — Req 4.3
// ============================================================================

export interface ConversaoTipoLegado {
  tipo: TipoPedido
  exigeProva: boolean
  aConfirmar: boolean
}

/**
 * Converte o `tipoPedido` legado para o domínio novo (Req 4.3):
 *   REPETICAO  -> REPETICAO
 *   NOVO       -> PRODUTO_NOVO
 *   MOSTRUARIO -> PRODUTO_NOVO + exigeProva
 *   nulo/outro -> PRODUTO_NOVO + aConfirmar
 */
export function converterTipoLegado(tipoLegado: string | null | undefined): ConversaoTipoLegado {
  switch (tipoLegado) {
    case 'REPETICAO':
      return { tipo: 'REPETICAO', exigeProva: false, aConfirmar: false }
    case 'NOVO':
      return { tipo: 'PRODUTO_NOVO', exigeProva: false, aConfirmar: false }
    case 'MOSTRUARIO':
      return { tipo: 'PRODUTO_NOVO', exigeProva: true, aConfirmar: false }
    default:
      return { tipo: 'PRODUTO_NOVO', exigeProva: false, aConfirmar: true }
  }
}

// ============================================================================
// Tabela de transições (AVANCO / RETORNO) — Req 6.1
// ============================================================================

/**
 * Transições explícitas entre Situacoes_Internas. PERDIDO/CANCELADO não entram
 * aqui: são encerramentos gerados em código a partir de qualquer não-terminal
 * (ver `destinosTerminais` e `validarTransicao`).
 */
export const TRANSICOES: Transicao[] = [
  // avanços
  { de: 'TRIAGEM', para: 'PRE_IMPRESSAO_EM_ANDAMENTO', classe: 'AVANCO' },
  { de: 'TRIAGEM', para: 'ORCAMENTO_EM_ANDAMENTO', classe: 'AVANCO' },
  { de: 'PRE_IMPRESSAO_EM_ANDAMENTO', para: 'PRE_IMPRESSAO_AGUARDA_INFO', classe: 'AVANCO' },
  { de: 'PRE_IMPRESSAO_AGUARDA_INFO', para: 'PRE_IMPRESSAO_EM_ANDAMENTO', classe: 'AVANCO' },
  { de: 'PRE_IMPRESSAO_EM_ANDAMENTO', para: 'ORCAMENTO_EM_ANDAMENTO', classe: 'AVANCO' },
  { de: 'ORCAMENTO_EM_ANDAMENTO', para: 'PRE_IMPRESSAO_EM_ANDAMENTO', classe: 'AVANCO' },
  { de: 'PRE_IMPRESSAO_EM_ANDAMENTO', para: 'APROVACAO_ARTE_PENDENTE', classe: 'AVANCO' },
  { de: 'ORCAMENTO_EM_ANDAMENTO', para: 'PROPOSTA_ENVIADA_AGUARDA_CLIENTE', classe: 'AVANCO' },
  { de: 'PROPOSTA_ENVIADA_AGUARDA_CLIENTE', para: 'APROVACAO_ARTE_PENDENTE', classe: 'AVANCO' },
  { de: 'APROVACAO_ARTE_PENDENTE', para: 'PROVA_PENDENTE', classe: 'AVANCO' },
  { de: 'APROVACAO_ARTE_PENDENTE', para: 'APROVADO', classe: 'AVANCO' },
  { de: 'PROVA_PENDENTE', para: 'APROVADO', classe: 'AVANCO' },
  { de: 'APROVADO', para: 'EM_PRODUCAO', classe: 'AVANCO' },
  { de: 'EM_PRODUCAO', para: 'FATURADO', classe: 'AVANCO' },
  // retornos (devolver)
  { de: 'APROVACAO_ARTE_PENDENTE', para: 'PRE_IMPRESSAO_EM_ANDAMENTO', classe: 'RETORNO' },
  { de: 'PROVA_PENDENTE', para: 'PRE_IMPRESSAO_EM_ANDAMENTO', classe: 'RETORNO' },
  { de: 'PROPOSTA_ENVIADA_AGUARDA_CLIENTE', para: 'ORCAMENTO_EM_ANDAMENTO', classe: 'RETORNO' },
  { de: 'PROPOSTA_ENVIADA_AGUARDA_CLIENTE', para: 'PRE_IMPRESSAO_EM_ANDAMENTO', classe: 'RETORNO' },
  { de: 'ORCAMENTO_EM_ANDAMENTO', para: 'PRE_IMPRESSAO_AGUARDA_INFO', classe: 'RETORNO' },
  { de: 'PRE_IMPRESSAO_EM_ANDAMENTO', para: 'PRE_IMPRESSAO_AGUARDA_INFO', classe: 'RETORNO' },
]

/** Destinos de encerramento disponíveis a partir de qualquer não-terminal. */
const DESTINOS_TERMINAIS: Situacao[] = ['PERDIDO', 'CANCELADO']

/** Situacoes_Internas que exigem motivo (5..500) na transição (Req 6.7). */
const DESTINOS_COM_MOTIVO: Situacao[] = ['PERDIDO', 'CANCELADO']

/** Mapa Setor_Responsavel de destino -> Situacao_Interna de retorno (Req 7.5). */
export const SETOR_PARA_SITUACAO_RETORNO: Record<Setor, Situacao> = {
  PRE_IMPRESSAO: 'PRE_IMPRESSAO_EM_ANDAMENTO',
  ORCAMENTO: 'ORCAMENTO_EM_ANDAMENTO',
  REPRESENTANTE: 'PRE_IMPRESSAO_AGUARDA_INFO',
  CLIENTE: 'PROPOSTA_ENVIADA_AGUARDA_CLIENTE',
  COMERCIAL: 'TRIAGEM',
}

export const SETORES_VALIDOS: Setor[] = [
  'PRE_IMPRESSAO',
  'ORCAMENTO',
  'COMERCIAL',
  'REPRESENTANTE',
  'CLIENTE',
]

/**
 * Destino é compatível com o Tipo_Pedido/Caminho? Como todos os caminhos
 * (CONFERENCIA/PARCIAL/COMPLETA) percorrem as mesmas Situacoes_Internas da
 * Fundação (nenhum pula pré-impressão/orçamento), a compatibilidade é total
 * nesta spec. A função existe para a propriedade de invariante (P5) e para os
 * pilares futuros restringirem destinos por caminho sem mudar o contrato.
 */
export function destinoCompativelComTipo(_destino: Situacao, _tipo: TipoPedido): boolean {
  return true
}

/**
 * Transições permitidas a partir da situação atual, separadas por classe
 * (Req 6.9 / 6.15). Em situação terminal, ambas vazias.
 */
export function transicoesPermitidas(
  atual: Situacao,
  tipo: TipoPedido,
): { avanco: Situacao[]; retorno: Situacao[] } {
  if (isTerminal(atual)) return { avanco: [], retorno: [] }

  const avanco = TRANSICOES.filter(
    (t) => t.de === atual && t.classe === 'AVANCO' && destinoCompativelComTipo(t.para, tipo),
  ).map((t) => t.para)

  const retorno = TRANSICOES.filter(
    (t) => t.de === atual && t.classe === 'RETORNO' && destinoCompativelComTipo(t.para, tipo),
  ).map((t) => t.para)

  // encerramentos são sempre possíveis a partir de não-terminal (avanço)
  for (const term of DESTINOS_TERMINAIS) {
    if (!avanco.includes(term)) avanco.push(term)
  }

  return { avanco, retorno }
}

/** Classe de uma transição permitida (AVANCO/RETORNO) ou null se não existe. */
export function classeDaTransicao(atual: Situacao, destino: Situacao): Classe | null {
  if (DESTINOS_TERMINAIS.includes(destino)) return 'AVANCO'
  const t = TRANSICOES.find((x) => x.de === atual && x.para === destino)
  return t ? t.classe : null
}

/**
 * Valida a transição `atual -> destino` para um Pedido do `tipo`. Lança
 * `StatusFielError` com o código do requisito correspondente. Função pura.
 *
 * Precedência (Req 6.6): PEDIDO_TERMINAL antes de ESTADO_TRANSICAO_INVALIDA.
 * Motivo (Req 6.7/6.8): destinos PERDIDO/CANCELADO exigem 5..500 após trim.
 */
export function validarTransicao(
  atual: Situacao,
  destino: Situacao,
  tipo: TipoPedido,
  motivo?: string,
): void {
  // (6.6) pedido terminal não transiciona
  if (isTerminal(atual)) {
    throw new StatusFielError(409, 'Pedido em status terminal.', 'PEDIDO_TERMINAL')
  }

  // destino desconhecido
  if (!SITUACOES_VALIDAS.includes(destino)) {
    throw new StatusFielError(400, 'Situação de destino desconhecida.', 'ESTADO_TRANSICAO_INVALIDA')
  }

  // destino == atual é inválido (Req 6.3)
  if (destino === atual) {
    throw new StatusFielError(
      400,
      `Transição inválida (${atual} → ${destino}).`,
      'ESTADO_TRANSICAO_INVALIDA',
    )
  }

  const permitidas = transicoesPermitidas(atual, tipo)
  const todos = [...permitidas.avanco, ...permitidas.retorno]
  if (!todos.includes(destino)) {
    throw new StatusFielError(
      400,
      `Transição inválida (${atual} → ${destino}).`,
      'ESTADO_TRANSICAO_INVALIDA',
    )
  }

  // (6.7/6.8) motivo obrigatório para encerramentos
  if (DESTINOS_COM_MOTIVO.includes(destino)) {
    const limpo = (motivo ?? '').trim()
    if (limpo.length < 5 || limpo.length > 500) {
      throw new StatusFielError(
        400,
        'Informe um motivo entre 5 e 500 caracteres.',
        'MOTIVO_OBRIGATORIO',
      )
    }
  }
}

/**
 * Valida um Retorno "devolver para <setor>" (Req 7). Resolve o setor de destino
 * para a Situacao_Interna e aplica as regras de retorno. Lança StatusFielError:
 *   - PEDIDO_TERMINAL (409) se atual é terminal
 *   - MOTIVO_OBRIGATORIO (400) se motivo fora de 5..500 após trim
 *   - RETORNO_INVALIDO (400) se setor inválido, destino == setor atual, ou o
 *     par não consta como RETORNO permitido
 * Retorna a Situacao_Interna de destino quando válido.
 */
export function validarRetorno(
  atual: Situacao,
  setorDestino: Setor,
  motivo: string,
): Situacao {
  if (isTerminal(atual)) {
    throw new StatusFielError(409, 'Pedido em status terminal.', 'PEDIDO_TERMINAL')
  }

  const limpo = (motivo ?? '').trim()
  if (limpo.length < 5 || limpo.length > 500) {
    throw new StatusFielError(400, 'Informe um motivo entre 5 e 500 caracteres.', 'MOTIVO_OBRIGATORIO')
  }

  if (!SETORES_VALIDOS.includes(setorDestino)) {
    throw new StatusFielError(400, 'Setor de destino inválido.', 'RETORNO_INVALIDO')
  }

  // destino == setor responsável atual é inválido
  if (setorDe(atual) === setorDestino) {
    throw new StatusFielError(400, 'O pedido já está nesse setor.', 'RETORNO_INVALIDO')
  }

  const destino = SETOR_PARA_SITUACAO_RETORNO[setorDestino]

  // o par origem->destino precisa constar como RETORNO permitido
  const ehRetornoPermitido = TRANSICOES.some(
    (t) => t.de === atual && t.para === destino && t.classe === 'RETORNO',
  )
  if (!ehRetornoPermitido) {
    throw new StatusFielError(
      400,
      `Não é possível devolver para ${setorDestino} a partir da situação atual.`,
      'RETORNO_INVALIDO',
    )
  }

  return destino
}
