/**
 * Resolução de Produto Gráfico e Tipo de Plano a partir do catálogo.
 * Funções PURAS (sem Prisma): operam sobre listas já carregadas e filtradas
 * por empresa pelo chamador. Nenhum nome de produto/linha é citado aqui; tudo
 * vem do cadastro. Spec orcamento-grafico-paridade-fluxo-legado (Req 6.1–6.3, 19.11).
 */

export type MotivoNaoResolvido = 'ZERO' | 'MULTIPLOS'

export interface ResolucaoCatalogo {
  id: string | null
  motivo?: MotivoNaoResolvido
}

/** Campos do cálculo usados na resolução do produto. */
export interface CalculoParaResolucao {
  tipoEmbalagemId?: string | null
  produto?: string | null
}

/** Subconjunto de `ProdutoGrafico` necessário. */
export interface ProdutoGraficoResolucao {
  id: string
  nome: string
  tipoEmbalagemId: string | null
  /** `status` do schema (true = ativo). Ausente é tratado como ativo. */
  status?: boolean
}

/** Subconjunto de `DefaultProdutoPlano` necessário. */
export interface DefaultProdutoPlanoResolucao {
  produtoId?: string
  tipoPlanoId: string
}

/** Subconjunto de `TipoPlanoGrafico` necessário. */
export interface TipoPlanoResolucao {
  id: string
  fixo: boolean
  status?: boolean
}

/** Minúsculo, sem acento e sem espaços nas pontas/duplicados. */
export function normalizarNome(valor: string | null | undefined): string {
  if (!valor) return ''
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function desfecho(candidatos: number): ResolucaoCatalogo['motivo'] {
  return candidatos === 0 ? 'ZERO' : 'MULTIPLOS'
}

/**
 * Candidatos = produtos ativos com o mesmo `tipoEmbalagemId` do cálculo.
 * Com mais de um, desempata pelo nome normalizado igual a `calc.produto`.
 * Resolvido somente com exatamente 1 candidato.
 */
export function resolverProdutoGrafico(
  calc: CalculoParaResolucao,
  produtosAtivos: ProdutoGraficoResolucao[],
): ResolucaoCatalogo {
  const tipoEmbalagemId = calc.tipoEmbalagemId ?? null
  if (!tipoEmbalagemId) return { id: null, motivo: 'ZERO' }

  const porEmbalagem = produtosAtivos.filter(
    (p) => p.status !== false && p.tipoEmbalagemId === tipoEmbalagemId,
  )
  if (porEmbalagem.length === 1) return { id: porEmbalagem[0].id }
  if (porEmbalagem.length === 0) return { id: null, motivo: 'ZERO' }

  const nomeCalc = normalizarNome(calc.produto)
  if (!nomeCalc) return { id: null, motivo: 'MULTIPLOS' }
  const porNome = porEmbalagem.filter((p) => normalizarNome(p.nome) === nomeCalc)
  if (porNome.length === 1) return { id: porNome[0].id }
  return { id: null, motivo: desfecho(porNome.length) }
}

/**
 * Candidatos = `DefaultProdutoPlano` do produto. 1 candidato → ele.
 * Mais de 1 → filtra `TipoPlanoGrafico.fixo`; se sobrar 1, ele. Senão não resolvido.
 * `defaults` pode conter linhas de outros produtos; só as do `produto` entram
 * (quando `produtoId` vem preenchido).
 */
export function resolverTipoPlano(
  produto: { id: string } | null | undefined,
  defaults: DefaultProdutoPlanoResolucao[],
  tiposPlano: TipoPlanoResolucao[],
): ResolucaoCatalogo {
  if (!produto) return { id: null, motivo: 'ZERO' }

  const idsDistintos = Array.from(
    new Set(
      defaults
        .filter((d) => d.produtoId === undefined || d.produtoId === produto.id)
        .map((d) => d.tipoPlanoId),
    ),
  )
  if (idsDistintos.length === 1) return { id: idsDistintos[0] }
  if (idsDistintos.length === 0) return { id: null, motivo: 'ZERO' }

  const fixos = tiposPlano.filter(
    (t) => t.fixo && t.status !== false && idsDistintos.includes(t.id),
  )
  if (fixos.length === 1) return { id: fixos[0].id }
  return { id: null, motivo: 'MULTIPLOS' }
}
