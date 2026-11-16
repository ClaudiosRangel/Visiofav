/**
 * Catálogo do orçamento gráfico (spec orcamento-grafico-cadastros-relacoes, Req 5).
 *
 * Devolve já filtrado o que pode aparecer para um produto e para um tipo de plano,
 * a partir da tabela genérica RelacaoCadastroGrafico. Regras:
 *  - somente registros ATIVOS e da empresa informada (empresaId explícito em toda query);
 *  - atividades ordenadas pela `ordem` da relação (roteiro importado); sem ordem, por nome;
 *  - atividades de acondicionamento separadas das demais atividades de produto.
 *
 * As funções de ordenação/separação no topo são PURAS (sem Prisma) e testáveis.
 */
import { prisma } from '../../../lib/prisma'

// ─── Funções puras ──────────────────────────────────────────────────────────

export interface RelacaoOrdenavel {
  idDestino: string
  ordem: number | null
  padrao?: boolean
}

function compararTexto(a: string, b: string): number {
  return a.localeCompare(b, 'pt-BR', { sensitivity: 'base' })
}

/**
 * Ordena as entidades pela `ordem` das relações. Sem ordem (null) vai depois das
 * que têm, em ordem alfabética. Entidades sem relação correspondente são
 * descartadas (ex.: inativas ou de outra empresa já filtradas na consulta).
 * Relações duplicadas para o mesmo destino usam a primeira.
 */
export function ordenarPorRelacao<T extends { id: string }>(
  entidades: readonly T[],
  relacoes: readonly RelacaoOrdenavel[],
  nomeDe: (e: T) => string,
): Array<T & { ordem: number | null; padrao: boolean }> {
  const porDestino = new Map<string, RelacaoOrdenavel>()
  for (const r of relacoes) {
    if (!porDestino.has(r.idDestino)) porDestino.set(r.idDestino, r)
  }
  const resultado: Array<T & { ordem: number | null; padrao: boolean }> = []
  for (const e of entidades) {
    const rel = porDestino.get(e.id)
    if (!rel) continue
    resultado.push({ ...e, ordem: rel.ordem ?? null, padrao: rel.padrao ?? false })
  }
  return resultado.sort((a, b) => {
    if (a.ordem !== null && b.ordem !== null && a.ordem !== b.ordem) return a.ordem - b.ordem
    if (a.ordem !== null && b.ordem === null) return -1
    if (a.ordem === null && b.ordem !== null) return 1
    return compararTexto(nomeDe(a), nomeDe(b))
  })
}

export type GrupoAtividade = 'ACONDICIONAMENTO' | 'ATIVIDADES'

/**
 * Regra única de grupo da atividade no catálogo (usada pelas duas rotas):
 * ACONDICIONAMENTO quando a flag do cadastro da atividade é verdadeira OU existe
 * a relação PRODUTO → ACONDICIONAMENTO; caso contrário, ATIVIDADES.
 */
export function classificarGrupoAtividade(entrada: {
  flagAcondicionamento: boolean
  temRelacaoAcondicionamento: boolean
}): GrupoAtividade {
  return entrada.flagAcondicionamento || entrada.temRelacaoAcondicionamento
    ? 'ACONDICIONAMENTO'
    : 'ATIVIDADES'
}

export interface AtividadeSeparavel {
  id: string
  acondicionamento: boolean
}

/**
 * Separa as atividades de acondicionamento das demais. Uma atividade é de
 * acondicionamento quando está no conjunto vindo da relação PRODUTO→ACONDICIONAMENTO
 * OU quando tem a marca `acondicionamento`. Mantém a ordem de entrada em cada grupo
 * e não repete a mesma atividade nos dois grupos.
 */
export function separarAcondicionamento<T extends AtividadeSeparavel>(
  atividades: readonly T[],
  idsAcondicionamento: ReadonlySet<string> = new Set(),
): { atividades: T[]; acondicionamento: T[] } {
  const acondicionamento: T[] = []
  const demais: T[] = []
  const vistos = new Set<string>()
  for (const a of atividades) {
    if (vistos.has(a.id)) continue
    vistos.add(a.id)
    const grupo = classificarGrupoAtividade({
      flagAcondicionamento: a.acondicionamento,
      temRelacaoAcondicionamento: idsAcondicionamento.has(a.id),
    })
    if (grupo === 'ACONDICIONAMENTO') acondicionamento.push(a)
    else demais.push(a)
  }
  return { atividades: demais, acondicionamento }
}

// ─── Acesso a dados ─────────────────────────────────────────────────────────

export class CatalogoError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message)
    this.name = 'CatalogoError'
  }
}

type Db = typeof prisma

async function relacoesDe(
  db: Db,
  empresaId: string,
  tipoOrigem: string,
  idOrigem: string,
  tipoDestino: string,
): Promise<RelacaoOrdenavel[]> {
  const rows = await db.relacaoCadastroGrafico.findMany({
    where: { empresaId, tipoOrigem, idOrigem, tipoDestino },
    orderBy: { ordem: 'asc' },
    select: { idDestino: true, ordem: true, padrao: true },
  })
  return rows
}

const ids = (rels: readonly RelacaoOrdenavel[]): string[] => rels.map((r) => r.idDestino)

async function buscarAtividades(db: Db, empresaId: string, idsAtv: string[]) {
  if (idsAtv.length === 0) return []
  return db.acabamentoGrafico.findMany({
    where: { empresaId, status: true, id: { in: idsAtv } },
    select: {
      id: true,
      codigo: true,
      nome: true,
      tipoAtividade: true,
      planoProduto: true,
      naturezaCusto: true,
      exigeRestricao: true,
      acondicionamento: true,
      textoProposta: true,
      exibirNomePlano: true,
    },
  })
}

/** Catálogo por produto: planos, atividades de produto, acondicionamento, itens diversos e defaults. */
export async function obterCatalogoProduto(empresaId: string, produtoId: string, db: Db = prisma) {
  const produto = await db.produtoGrafico.findFirst({
    where: { id: produtoId, empresaId, status: true },
  })
  if (!produto) throw new CatalogoError(404, 'Produto não encontrado')

  const [relPlanos, relAtividades, relAcond, relItens] = await Promise.all([
    relacoesDe(db, empresaId, 'PRODUTO', produtoId, 'PLANO'),
    relacoesDe(db, empresaId, 'PRODUTO', produtoId, 'ATIVIDADE'),
    relacoesDe(db, empresaId, 'PRODUTO', produtoId, 'ACONDICIONAMENTO'),
    relacoesDe(db, empresaId, 'PRODUTO', produtoId, 'ITEM_DIVERSO'),
  ])

  const idsAtividades = [...new Set([...ids(relAtividades), ...ids(relAcond)])]
  const [planos, atividadesBrutas, itens, defaults] = await Promise.all([
    ids(relPlanos).length
      ? db.tipoPlanoGrafico.findMany({
          where: { empresaId, status: true, id: { in: ids(relPlanos) } },
        })
      : Promise.resolve([]),
    buscarAtividades(db, empresaId, idsAtividades),
    ids(relItens).length
      ? db.itemDiversoGrafico.findMany({
          where: { empresaId, status: true, id: { in: ids(relItens) } },
        })
      : Promise.resolve([]),
    db.defaultProdutoPlano.findMany({ where: { empresaId, produtoId } }),
  ])

  // Ordem das atividades: relação de atividade; as só de acondicionamento entram com a ordem dela.
  const ordenadas = ordenarPorRelacao(atividadesBrutas, [...relAtividades, ...relAcond], (a) => a.nome)
  const { atividades, acondicionamento } = separarAcondicionamento(ordenadas, new Set(ids(relAcond)))

  return {
    produto,
    planos: ordenarPorRelacao(planos, relPlanos, (p) => p.nome),
    atividades,
    acondicionamento,
    itensDiversos: ordenarPorRelacao(itens, relItens, (i) => i.nome),
    defaults,
  }
}

/**
 * Catálogo por tipo de plano (e produto opcional): atividades do plano com
 * restrições e materiais permitidos, coberturas, suportes e itens diversos automáticos.
 * Com `produtoId`, marca como `preMarcada` as atividades do default do produto neste plano.
 */
export async function obterCatalogoPlano(
  empresaId: string,
  planoId: string,
  produtoId?: string,
  db: Db = prisma,
) {
  const plano = await db.tipoPlanoGrafico.findFirst({
    where: { id: planoId, empresaId, status: true },
  })
  if (!plano) throw new CatalogoError(404, 'Tipo de plano não encontrado')

  let preMarcadas = new Set<string>()
  let idsAcondicionamentoProduto = new Set<string>()
  let defaultProduto: Awaited<ReturnType<Db['defaultProdutoPlano']['findFirst']>> = null
  if (produtoId) {
    const produto = await db.produtoGrafico.findFirst({
      where: { id: produtoId, empresaId, status: true },
      select: { id: true },
    })
    if (!produto) throw new CatalogoError(404, 'Produto não encontrado')
    idsAcondicionamentoProduto = new Set(
      ids(await relacoesDe(db, empresaId, 'PRODUTO', produtoId, 'ACONDICIONAMENTO')),
    )
    defaultProduto = await db.defaultProdutoPlano.findFirst({
      where: { empresaId, produtoId, tipoPlanoId: planoId },
    })
    const lista = defaultProduto?.atividadesPreMarcadas
    if (Array.isArray(lista)) preMarcadas = new Set(lista.filter((x): x is string => typeof x === 'string'))
  }

  const [relAtv, relCob, relSup, relItens] = await Promise.all([
    relacoesDe(db, empresaId, 'PLANO', planoId, 'ATIVIDADE'),
    relacoesDe(db, empresaId, 'PLANO', planoId, 'COBERTURA_TINTA'),
    relacoesDe(db, empresaId, 'PLANO', planoId, 'SUPORTE'),
    relacoesDe(db, empresaId, 'PLANO', planoId, 'ITEM_DIVERSO'),
  ])

  const atividadesBrutas = await buscarAtividades(db, empresaId, ids(relAtv))
  const idsAtv = atividadesBrutas.map((a) => a.id)

  const [restricoes, relMateriais, coberturas, suportes, itens] = await Promise.all([
    idsAtv.length
      ? db.restricaoAcabamento.findMany({
          where: { empresaId, acabamentoGraficoId: { in: idsAtv } },
          orderBy: { nome: 'asc' },
        })
      : Promise.resolve([]),
    idsAtv.length
      ? db.relacaoCadastroGrafico.findMany({
          where: {
            empresaId,
            tipoOrigem: 'ATIVIDADE',
            idOrigem: { in: idsAtv },
            tipoDestino: 'MATERIAL',
          },
          orderBy: { ordem: 'asc' },
          select: { idOrigem: true, idDestino: true, ordem: true, padrao: true },
        })
      : Promise.resolve([]),
    ids(relCob).length
      ? db.coberturaTinta.findMany({ where: { empresaId, ativo: true, id: { in: ids(relCob) } } })
      : Promise.resolve([]),
    ids(relSup).length
      ? db.suporteGrafico.findMany({ where: { empresaId, status: true, id: { in: ids(relSup) } } })
      : Promise.resolve([]),
    ids(relItens).length
      ? db.itemDiversoGrafico.findMany({
          where: { empresaId, status: true, automatico: true, id: { in: ids(relItens) } },
        })
      : Promise.resolve([]),
  ])

  const idsMateriais = [...new Set(relMateriais.map((r) => r.idDestino))]
  const materiais = idsMateriais.length
    ? await db.materialAcabamento.findMany({
        where: { empresaId, ativo: true, id: { in: idsMateriais } },
      })
    : []

  const atividades = ordenarPorRelacao(atividadesBrutas, relAtv, (a) => a.nome).map((a) => {
    const relsDaAtividade = relMateriais.filter((r) => r.idOrigem === a.id)
    return {
      ...a,
      grupo: classificarGrupoAtividade({
        flagAcondicionamento: a.acondicionamento,
        temRelacaoAcondicionamento: idsAcondicionamentoProduto.has(a.id),
      }),
      preMarcada: preMarcadas.has(a.id) || a.padrao,
      restricoes: restricoes.filter((r) => r.acabamentoGraficoId === a.id),
      materiais: ordenarPorRelacao(materiais, relsDaAtividade, (m) => m.nome),
    }
  })

  return {
    plano,
    defaultProduto,
    // `atividades` continua com TODAS (formato atual); `grupo` por item e a lista
    // `acondicionamento` (subconjunto) são acréscimos.
    atividades,
    acondicionamento: atividades.filter((a) => a.grupo === 'ACONDICIONAMENTO'),
    coberturas: ordenarPorRelacao(coberturas, relCob, (c) => c.nome),
    suportes: ordenarPorRelacao(suportes, relSup, (s) => s.descricao),
    itensDiversosAutomaticos: ordenarPorRelacao(itens, relItens, (i) => i.nome),
  }
}
