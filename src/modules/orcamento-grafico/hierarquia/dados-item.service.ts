import { prisma } from '../../../lib/prisma'
import { naoEncontrado, paraNumero, type DbClient } from './hierarquia-common'

/**
 * GET /:id/itens/:itemId/dados-item (Fase 1) — DTO do Painel_Dados_Item (somente leitura).
 *
 * A estrutura (plano único × multi-plano) sai da regra de cadastro `some(fixo)` sobre os
 * tipos de plano PERMITIDOS ao produto (relação PRODUTO → PLANO). Nunca por nome/código.
 * A mesma regra é validada contra `vetores-layout.json` (igual ao front).
 * Não chama o motor.
 */

export type EstruturaItem = 'PLANO_UNICO' | 'MULTI_PLANO'

export interface SecaoDadosItemDTO {
  chave: string
  titulo: string
  /** Vazio ⇒ o front mostra "Sem informação cadastrada.". */
  linhas: string[]
}

export interface DadosItemPainelDTO {
  itemId: string
  estrutura: EstruturaItem
  /** Planos persistidos do item (informa dado legado em plano único). */
  planosPersistidos: number
  secoes: SecaoDadosItemDTO[]
}

// ─── Regra pura de estrutura ────────────────────────────────────────────────

export interface TipoPlanoParaEstrutura {
  id: string
  fixo: boolean
}

/** Regra R8.4: plano único ⇔ algum tipo de plano permitido é `fixo`. Produto sem tipos ⇒ multi-plano. */
export function resolverEstrutura(tiposPlano: readonly TipoPlanoParaEstrutura[]): {
  estrutura: EstruturaItem
  tipoPlanoFixoId: string | null
} {
  const fixo = tiposPlano.find((t) => t.fixo === true)
  return fixo
    ? { estrutura: 'PLANO_UNICO', tipoPlanoFixoId: fixo.id }
    : { estrutura: 'MULTI_PLANO', tipoPlanoFixoId: null }
}

// ─── Formatação (texto pronto para o painel) ────────────────────────────────

/** 12,5 → "12,5"; 12 → "12"; no máximo 2 casas, vírgula decimal. */
export function fmtNumero(n: number): string {
  const r = Math.round((n + Number.EPSILON) * 100) / 100
  return String(r).replace('.', ',')
}

function lista(json: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(json)) return []
  return json.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x))
}

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function dimensoes(l: unknown, a: unknown): string | null {
  const nl = paraNumero(l)
  const na = paraNumero(a)
  if (nl === null || na === null || (nl === 0 && na === 0)) return null
  return `${fmtNumero(nl)} x ${fmtNumero(na)} mm`
}

function coresTexto(numCores: unknown, cores: unknown): string | null {
  const nomes = lista(cores).map((c) => texto(c.nome)).filter((x): x is string => !!x)
  const n = paraNumero(numCores) ?? nomes.length
  if (n <= 0 && nomes.length === 0) return null
  return nomes.length ? `${n} cor(es): ${nomes.join(', ')}` : `${n} cor(es)`
}

/** Linha de formato do item a partir das medidas persistidas (colunas achatadas). */
function formatoItem(item: {
  comprimentoMm: unknown
  larguraMm: unknown
  alturaMm: unknown
}): string | null {
  const c = paraNumero(item.comprimentoMm)
  const l = paraNumero(item.larguraMm)
  const a = paraNumero(item.alturaMm)
  const partes = [c, l, a].filter((x): x is number => x !== null && x > 0)
  if (partes.length === 0) return null
  return `${partes.map(fmtNumero).join(' x ')} mm`
}

// ─── Serviço ────────────────────────────────────────────────────────────────

export async function obterDadosItem(
  orcamentoId: string,
  itemId: string,
  empresaId: string,
  db: DbClient = prisma,
): Promise<DadosItemPainelDTO> {
  // Filho filtrado pelo pai e pela empresa: id + orcamentoId + empresaId.
  const item = await db.itemOrcamentoGrafico.findFirst({
    where: { id: itemId, orcamentoId, empresaId },
    select: {
      id: true,
      produtoGraficoId: true,
      papelId: true,
      papelDescricao: true,
      gramatura: true,
      numCores: true,
      cores: true,
      acabamentosRicos: true,
      itensDiversos: true,
      qtdModelos: true,
      comprimentoMm: true,
      larguraMm: true,
      alturaMm: true,
      formatoCorteLarguraMm: true,
      formatoCorteAlturaMm: true,
      processoImpressao: true,
      fabricante: true,
      planos: {
        orderBy: { sequencia: 'asc' },
        select: {
          id: true,
          nome: true,
          especificacao: true,
          tipoPlanoId: true,
          suporteId: true,
          gramatura: true,
          formatoLarguraMm: true,
          formatoAlturaMm: true,
          numCores: true,
          cores: true,
          acabamentosRicos: true,
        },
      },
    },
  })
  if (!item) throw naoEncontrado()

  // Tipos de plano permitidos ao produto (cadastro manda).
  let tiposPermitidos: TipoPlanoParaEstrutura[] = []
  if (item.produtoGraficoId) {
    const rels = await db.relacaoCadastroGrafico.findMany({
      where: { empresaId, tipoOrigem: 'PRODUTO', idOrigem: item.produtoGraficoId, tipoDestino: 'PLANO' },
      select: { idDestino: true },
    })
    const idsTipos = rels.map((r) => r.idDestino)
    if (idsTipos.length) {
      const tipos = await db.tipoPlanoGrafico.findMany({
        where: { empresaId, status: true, id: { in: idsTipos } },
        select: { id: true, fixo: true },
      })
      tiposPermitidos = tipos
    }
  }
  const { estrutura } = resolverEstrutura(tiposPermitidos)

  // Nomes resolvidos (suportes de plano e atividades), sempre com empresaId explícito.
  const idsSuporte = [...new Set(item.planos.map((p) => p.suporteId).filter((x): x is string => !!x))]
  const acabItem = lista(item.acabamentosRicos)
  const acabPlanos = item.planos.flatMap((p) => lista(p.acabamentosRicos))
  const idsAcab = [
    ...new Set(
      [...acabItem, ...acabPlanos].map((a) => texto(a.acabamentoId)).filter((x): x is string => !!x),
    ),
  ]
  const [suportes, atividades] = await Promise.all([
    idsSuporte.length
      ? db.suporteGrafico.findMany({ where: { id: { in: idsSuporte }, empresaId }, select: { id: true, descricao: true } })
      : Promise.resolve([]),
    idsAcab.length
      ? db.acabamentoGrafico.findMany({ where: { id: { in: idsAcab }, empresaId }, select: { id: true, nome: true } })
      : Promise.resolve([]),
  ])
  const nomeSuporte = new Map(suportes.map((s) => [s.id, s.descricao]))
  const nomeAtividade = new Map(atividades.map((a) => [a.id, a.nome]))

  const nomesAcabamentos = (itens: Array<Record<string, unknown>>): string[] =>
    itens
      .map((a) => {
        const nome = texto(a.nome) ?? (texto(a.acabamentoId) ? nomeAtividade.get(String(a.acabamentoId)) ?? null : null)
        if (!nome) return null
        const extras = [texto(a.restricaoNome), texto(a.materialNome)].filter((x): x is string => !!x)
        return extras.length ? `${nome} (${extras.join(', ')})` : nome
      })
      .filter((x): x is string => !!x)

  const itensDiversos = lista(item.itensDiversos)
    .map((d) => {
      const desc = texto(d.descricao)
      if (!desc) return null
      const q = paraNumero(d.quantidade)
      return q !== null && q > 0 ? `${desc} (${fmtNumero(q)})` : desc
    })
    .filter((x): x is string => !!x)

  const planosPersistidos = item.planos.length
  let secoes: SecaoDadosItemDTO[]

  if (estrutura === 'MULTI_PLANO') {
    const modelos = paraNumero(item.qtdModelos)
    const geral = [
      formatoItem(item) ? `Formato: ${formatoItem(item)}` : null,
      // Modelos não informado (nulo ou 0) é exibido como 1.
      `Modelos: ${fmtNumero(modelos !== null && modelos > 0 ? modelos : 1)}`,
    ].filter((x): x is string => !!x)

    const linhasPlanos = item.planos.map((p) => {
      const partes = [
        p.suporteId && nomeSuporte.get(p.suporteId) ? `Suporte: ${nomeSuporte.get(p.suporteId)}` : null,
        coresTexto(p.numCores, p.cores) ? `Cores: ${coresTexto(p.numCores, p.cores)}` : null,
        dimensoes(p.formatoLarguraMm, p.formatoAlturaMm) ? `Formato: ${dimensoes(p.formatoLarguraMm, p.formatoAlturaMm)}` : null,
        nomesAcabamentos(lista(p.acabamentosRicos)).length
          ? `Acabamentos: ${nomesAcabamentos(lista(p.acabamentosRicos)).join(', ')}`
          : null,
      ].filter((x): x is string => !!x)
      const esp = p.especificacao as { somenteExibicao?: unknown } | null | undefined
      const rotulo = esp && esp.somenteExibicao === true ? `${p.nome} (somente leitura)` : p.nome
      return partes.length ? `${rotulo} — ${partes.join(' · ')}` : rotulo
    })

    secoes = [
      { chave: 'especificacoes-gerais', titulo: 'Especificações Gerais', linhas: geral },
      { chave: 'tipos-plano', titulo: 'Tipos de Plano', linhas: linhasPlanos },
      { chave: 'acabamentos-produto', titulo: 'Acabamentos', linhas: nomesAcabamentos(acabItem) },
      { chave: 'itens-diversos', titulo: 'Itens Diversos', linhas: itensDiversos },
    ]
  } else {
    const formato = [
      formatoItem(item) ? `Formato: ${formatoItem(item)}` : null,
      dimensoes(item.formatoCorteLarguraMm, item.formatoCorteAlturaMm)
        ? `Formato de corte: ${dimensoes(item.formatoCorteLarguraMm, item.formatoCorteAlturaMm)}`
        : null,
    ].filter((x): x is string => !!x)

    const gram = paraNumero(item.gramatura)
    const suporte = texto(item.papelDescricao)
      ? [`${texto(item.papelDescricao)}${gram !== null && gram > 0 ? ` — ${fmtNumero(gram)} g/m²` : ''}`]
      : []

    secoes = [
      { chave: 'formato', titulo: 'Formato', linhas: formato },
      { chave: 'suporte', titulo: 'Suporte', linhas: suporte },
      { chave: 'cores', titulo: 'Cores', linhas: [coresTexto(item.numCores, item.cores)].filter((x): x is string => !!x) },
      { chave: 'acabamento', titulo: 'Acabamento', linhas: nomesAcabamentos(acabItem) },
      { chave: 'itens-diversos', titulo: 'Itens Diversos', linhas: itensDiversos },
    ]
  }

  return { itemId: item.id, estrutura, planosPersistidos, secoes }
}
