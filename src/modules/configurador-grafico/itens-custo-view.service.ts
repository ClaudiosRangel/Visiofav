// Visão unificada de "itens de custo" por Origem — serviço PURO (sem Prisma).
//
// Em vez de espelhar o catálogo `Itc` do Calcgraf (2300+ linhas) num model novo,
// o Vizor DERIVA a lista de itens de custo dos cadastros que já existem
// (papel/tinta/máquina/acabamento), atribuindo a Origem e o grupo (MD/CT/SE)
// conforme a fonte. Spec configurador-grafico-calcgraf (Req 2).

/** Origens possíveis (paridade Itc.Origem do Calcgraf). */
export type OrigemCusto =
  | 'SUPORTE'
  | 'TINTA'
  | 'MAT.ACABAMENTO'
  | 'MATRIZ IMPRESSAO'
  | 'CENTRO DE CUSTO'
  | 'SERVICO EXTERNO'

export type GrupoCusto = 'MD' | 'CT' | 'SE'

export const ORIGENS_VALIDAS: readonly OrigemCusto[] = [
  'SUPORTE',
  'TINTA',
  'MAT.ACABAMENTO',
  'MATRIZ IMPRESSAO',
  'CENTRO DE CUSTO',
  'SERVICO EXTERNO',
]

/** Normaliza variações de escrita de Origem (acento/pontuação) para o canônico. */
function normalizarOrigem(origem: string): OrigemCusto | null {
  const u = (origem ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
  switch (u) {
    case 'SUPORTE':
      return 'SUPORTE'
    case 'TINTA':
      return 'TINTA'
    case 'MAT.ACABAMENTO':
    case 'MAT ACABAMENTO':
      return 'MAT.ACABAMENTO'
    case 'MATRIZ IMPRESSAO':
      return 'MATRIZ IMPRESSAO'
    case 'CENTRO DE CUSTO':
      return 'CENTRO DE CUSTO'
    case 'SERVICO EXTERNO':
      return 'SERVICO EXTERNO'
    default:
      return null
  }
}

export function origemValida(origem: string): boolean {
  return normalizarOrigem(origem) !== null
}

/**
 * Grupo de custo (MD/CT/SE) derivado da Origem (regra travada — mesma do
 * `decomposicao-stc.service.ts` e do de-para):
 * - CENTRO DE CUSTO → CT
 * - SERVIÇO EXTERNO → SE
 * - SUPORTE / TINTA / MAT.ACABAMENTO / MATRIZ IMPRESSÃO → MD
 */
export function grupoDaOrigem(origem: string): GrupoCusto {
  const o = normalizarOrigem(origem)
  if (o === 'CENTRO DE CUSTO') return 'CT'
  if (o === 'SERVICO EXTERNO') return 'SE'
  return 'MD'
}

/** Fonte (cadastro do Vizor) de onde o item de custo veio. */
export type FonteTipo = 'PAPEL' | 'TINTA' | 'ACABAMENTO' | 'CENTRO' | 'SERVICO'

/** Item cru vindo de um cadastro do Vizor, antes da unificação. */
export interface ItemCustoFonte {
  fonteTipo: FonteTipo
  id: string
  codigo?: string | null
  descricao: string
  valor?: number | null
  /** Para ACABAMENTO: 'MATERIAL' → MAT.ACABAMENTO; 'SERVICO' → SERVICO EXTERNO. */
  natureza?: string | null
}

/** Item de custo unificado exibido na visão. */
export interface ItemCustoView {
  fonteTipo: FonteTipo
  fonteId: string
  origem: OrigemCusto
  grupo: GrupoCusto
  codigo: string | null
  descricao: string
  valor: number | null
}

function origemDaFonte(item: ItemCustoFonte): OrigemCusto {
  switch (item.fonteTipo) {
    case 'PAPEL':
      return 'SUPORTE'
    case 'TINTA':
      return 'TINTA'
    case 'CENTRO':
      return 'CENTRO DE CUSTO'
    case 'SERVICO':
      return 'SERVICO EXTERNO'
    case 'ACABAMENTO':
      return (item.natureza ?? '').toUpperCase().includes('SERV')
        ? 'SERVICO EXTERNO'
        : 'MAT.ACABAMENTO'
  }
}

/**
 * Unifica itens de custo vindos dos vários cadastros numa única lista, com Origem
 * e grupo derivados. Puro — não acessa banco.
 */
export function montarItensCusto(fontes: ItemCustoFonte[]): ItemCustoView[] {
  return fontes.map((f) => {
    const origem = origemDaFonte(f)
    return {
      fonteTipo: f.fonteTipo,
      fonteId: f.id,
      origem,
      grupo: grupoDaOrigem(origem),
      codigo: f.codigo ?? null,
      descricao: f.descricao,
      valor: f.valor ?? null,
    }
  })
}
