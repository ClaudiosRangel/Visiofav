/**
 * Divergência Lote/Validade Service — lógica pura para detecção de divergências,
 * resolução por modo e geração de texto CC-e.
 * Função pura — sem side-effects, sem I/O, sem Prisma.
 */

// ─── Tipos ─────────────────────────────────────────────────────────────────────

export type ModoResolucao = 'ACEITAR_CCE' | 'ACEITAR_SENHA' | 'ACEITAR_LIVRE' | 'BLOQUEAR'

export const MODOS_VALIDOS: ModoResolucao[] = [
  'ACEITAR_CCE',
  'ACEITAR_SENHA',
  'ACEITAR_LIVRE',
  'BLOQUEAR',
]

export interface DeteccaoDivergenciaInput {
  valorEsperado: string | null
  valorConferido: string | null
  exigeLote?: boolean
}

export interface DeteccaoDivergenciaResult {
  divergente: boolean
  tipo?: 'LOTE_DIVERGENTE' | 'VALIDADE_DIVERGENTE'
  valorEsperado: string | null
  valorConferido: string | null
}

export interface ResolucaoResult {
  permitido: boolean
  novoStatus: 'ACEITA' | 'PENDENTE' | 'PENDENTE_CCE'
  requerCCe: boolean
  mensagem: string
}

export interface TextoCCeLoteValidadeInput {
  tipo: 'LOTE_DIVERGENTE' | 'VALIDADE_DIVERGENTE'
  valorEsperado: string | null
  valorConferido: string | null
  descricaoProduto: string
}

// ─── Funções Puras ─────────────────────────────────────────────────────────────

/**
 * Valida se um modo informado é válido.
 */
export function isModoValido(modo: string): modo is ModoResolucao {
  return MODOS_VALIDOS.includes(modo as ModoResolucao)
}

/**
 * Detecta divergência de lote entre NF-e e valor conferido.
 * Só detecta se produto exige lote (exigeLote = true).
 * Retorna divergente=true se ambos valores são não-nulos, não-vazios e diferem.
 */
export function detectarDivergenciaLote(input: DeteccaoDivergenciaInput): DeteccaoDivergenciaResult {
  const { valorEsperado, valorConferido, exigeLote } = input

  // Se produto não exige lote, não há divergência a detectar
  if (!exigeLote) {
    return {
      divergente: false,
      valorEsperado,
      valorConferido,
    }
  }

  // Ambos devem ser não-nulos e não-vazios para haver divergência
  const esperadoPreenchido = valorEsperado !== null && valorEsperado.trim() !== ''
  const conferidoPreenchido = valorConferido !== null && valorConferido.trim() !== ''

  if (!esperadoPreenchido || !conferidoPreenchido) {
    return {
      divergente: false,
      valorEsperado,
      valorConferido,
    }
  }

  const divergente = valorEsperado!.trim() !== valorConferido!.trim()

  return {
    divergente,
    tipo: divergente ? 'LOTE_DIVERGENTE' : undefined,
    valorEsperado,
    valorConferido,
  }
}

/**
 * Detecta divergência de validade entre NF-e e valor conferido.
 * Compara datas ignorando horas (apenas dia).
 * Retorna divergente=true se dias diferem.
 */
export function detectarDivergenciaValidade(input: {
  validadeEsperada: Date | null
  validadeConferida: Date | null
}): DeteccaoDivergenciaResult {
  const { validadeEsperada, validadeConferida } = input

  // Se alguma data é nula, não há divergência a detectar
  if (validadeEsperada === null || validadeConferida === null) {
    return {
      divergente: false,
      valorEsperado: validadeEsperada ? validadeEsperada.toISOString() : null,
      valorConferido: validadeConferida ? validadeConferida.toISOString() : null,
    }
  }

  // Compara apenas ano/mês/dia, ignorando horas
  const esperadaDia = new Date(
    validadeEsperada.getFullYear(),
    validadeEsperada.getMonth(),
    validadeEsperada.getDate()
  ).getTime()

  const conferidaDia = new Date(
    validadeConferida.getFullYear(),
    validadeConferida.getMonth(),
    validadeConferida.getDate()
  ).getTime()

  const divergente = esperadaDia !== conferidaDia

  return {
    divergente,
    tipo: divergente ? 'VALIDADE_DIVERGENTE' : undefined,
    valorEsperado: validadeEsperada.toISOString(),
    valorConferido: validadeConferida.toISOString(),
  }
}

/**
 * Determina se a resolução é permitida e qual ação tomar conforme o modo.
 * Função pura — não faz I/O, não valida credenciais (isso é separado).
 */
export function resolverModo(modo: ModoResolucao): ResolucaoResult {
  switch (modo) {
    case 'ACEITAR_LIVRE':
      return {
        permitido: true,
        novoStatus: 'ACEITA',
        requerCCe: false,
        mensagem: 'Divergência aceita livremente',
      }

    case 'ACEITAR_SENHA':
      return {
        permitido: true,
        novoStatus: 'ACEITA',
        requerCCe: false,
        mensagem: 'Divergência aceita mediante autorização de supervisor',
      }

    case 'ACEITAR_CCE':
      return {
        permitido: true,
        novoStatus: 'PENDENTE_CCE',
        requerCCe: true,
        mensagem: 'Divergência aceita — CC-e será emitida automaticamente',
      }

    case 'BLOQUEAR':
      return {
        permitido: false,
        novoStatus: 'PENDENTE',
        requerCCe: false,
        mensagem: 'Produto não permite aceitação de divergência de lote/validade',
      }
  }
}

/**
 * Gera texto de correção para CC-e de divergência de lote ou validade.
 * O texto contém: tipo da correção, valor original e valor corrigido.
 */
export function gerarTextoCCeLoteValidade(input: TextoCCeLoteValidadeInput): string {
  const { tipo, valorEsperado, valorConferido, descricaoProduto } = input

  const tipoDescricao = tipo === 'LOTE_DIVERGENTE' ? 'lote' : 'validade'

  return (
    `Correção de ${tipoDescricao} do produto ${descricaoProduto}: ` +
    `valor original ${valorEsperado ?? '(vazio)'}, ` +
    `valor corrigido ${valorConferido ?? '(vazio)'}`
  )
}
