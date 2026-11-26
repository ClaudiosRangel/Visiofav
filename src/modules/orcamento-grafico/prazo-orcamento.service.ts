/**
 * Prazo de pagamento do orçamento gráfico (spec orcamento-prazos-cliente-margem, R1/R4/R6).
 *
 * - Com o orçamento calculado, o prazo fica travado no Pedido/Proposta e no Portal; só muda no
 *   orçamento (RASCUNHO), e trocar exige recalcular (`precisaRecalcular`).
 * - Prazo com mais de uma parcela só vale se o valor total ≥ `orc.valorMinimoParcelamento`.
 * - Histórico de prazos do cliente vem dos documentos (orçamentos, pedidos/propostas, solicitações).
 * empresaId EXPLÍCITO em toda query.
 */
import { prisma } from '../../lib/prisma'

export class PrazoOrcamentoError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code: string,
  ) {
    super(message)
  }
}

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

// ─── Regras puras ───────────────────────────────────────────────────────────

/** O orçamento tem preço calculado (cabeçalho ou algum item). */
export function orcamentoTemCalculo(
  orc: { precoVenda?: unknown; valorTotalConsolidado?: unknown },
  itens: ReadonlyArray<{ valorTotal?: unknown }> = [],
): boolean {
  const pos = (v: unknown) => Number(v) > 0
  return pos(orc.precoVenda) || pos(orc.valorTotalConsolidado) || itens.some((i) => pos(i.valorTotal))
}

/** Valor total do orçamento para as regras de pagamento (consolidado, senão cabeçalho). */
export function valorTotalDoOrcamento(orc: { precoVenda?: unknown; valorTotalConsolidado?: unknown }): number {
  const c = Number(orc.valorTotalConsolidado)
  if (c > 0) return c
  const p = Number(orc.precoVenda)
  return p > 0 ? p : 0
}

/**
 * Regra (b): prazo parcelado só com valor total ≥ mínimo. Mínimo 0/ausente = sem limite; 1 parcela
 * sempre vale. Devolve a mensagem de erro, ou null quando está ok.
 */
export function validarParcelamento(valorTotal: number, parcelas: number, minimo: number): string | null {
  if (!(parcelas > 1) || !(minimo > 0)) return null
  if (valorTotal >= minimo) return null
  return `Parcelamento só a partir de ${brl(minimo)} (valor atual ${brl(valorTotal)}). Escolha um prazo de pagamento em uma vez.`
}

export interface UsoPrazo {
  prazoId: string | null
  descricao: string
  data: Date
  origem: 'ORCAMENTO' | 'PEDIDO_PROPOSTA' | 'PORTAL'
}

export interface LinhaHistoricoPrazo {
  prazoId: string | null
  descricao: string
  vezes: number
  ultimaVez: string
  origens: Array<UsoPrazo['origem']>
}

/** Agrupa os usos por prazo; ordena pelo mais usado e, no empate, pelo mais recente. */
export function agruparHistoricoPrazos(usos: readonly UsoPrazo[]): LinhaHistoricoPrazo[] {
  const mapa = new Map<string, LinhaHistoricoPrazo & { ultima: number }>()
  for (const u of usos) {
    const descricao = u.descricao.trim()
    if (!u.prazoId && !descricao) continue
    const chave = u.prazoId ?? `t:${descricao.toLowerCase()}`
    const t = u.data.getTime()
    const atual = mapa.get(chave)
    if (!atual) {
      mapa.set(chave, { prazoId: u.prazoId, descricao, vezes: 1, ultimaVez: u.data.toISOString(), ultima: t, origens: [u.origem] })
      continue
    }
    atual.vezes++
    if (!atual.origens.includes(u.origem)) atual.origens.push(u.origem)
    if (t > atual.ultima) {
      atual.ultima = t
      atual.ultimaVez = u.data.toISOString()
      if (descricao) atual.descricao = descricao
    }
  }
  return [...mapa.values()]
    .sort((a, b) => b.vezes - a.vezes || b.ultima - a.ultima)
    .map(({ ultima: _u, ...l }) => l)
}

// ─── Leitura de configuração ────────────────────────────────────────────────

export async function valorMinimoParcelamento(empresaId: string): Promise<number> {
  const p = await prisma.parametro.findFirst({
    where: { empresaId, chave: 'orc.valorMinimoParcelamento' },
    select: { valor: true },
  })
  const n = Number(String(p?.valor ?? '').replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : 0
}

async function prazoDaEmpresa(empresaId: string, prazoId: string) {
  const prazo = await prisma.condicaoPagamentoComercial.findFirst({
    where: { id: prazoId, empresaId },
    select: { id: true, descricao: true, dias: true, parcelas: true },
  })
  if (!prazo) throw new PrazoOrcamentoError(400, 'Prazo de pagamento não encontrado no cadastro.', 'PRAZO_INVALIDO')
  return prazo
}

/** Confere a regra de parcelamento para um orçamento (usado em Enviar/Aprovar). */
export async function conferirParcelamentoDoOrcamento(empresaId: string, orcamentoId: string): Promise<void> {
  const orc = await prisma.orcamentoGrafico.findFirst({
    where: { id: orcamentoId, empresaId },
    select: { prazoPagamentoId: true, precoVenda: true, valorTotalConsolidado: true },
  })
  if (!orc?.prazoPagamentoId) return
  const prazo = await prisma.condicaoPagamentoComercial.findFirst({
    where: { id: orc.prazoPagamentoId, empresaId },
    select: { parcelas: true },
  })
  if (!prazo) return
  const erro = validarParcelamento(valorTotalDoOrcamento(orc), prazo.parcelas, await valorMinimoParcelamento(empresaId))
  if (erro) throw new PrazoOrcamentoError(400, erro, 'PARCELAMENTO_ABAIXO_MINIMO')
}

/**
 * Condição de pagamento de Vendas (da tabela de preço) com as mesmas parcelas do prazo do orçamento,
 * para o Pedido de Venda gerado na aprovação. Prefere a sem acréscimo/desconto. Sem par → null.
 */
export async function condicaoVendaDoPrazoDoOrcamento(
  empresaId: string,
  orcamentoId: string,
  tabelaPrecoId: string,
): Promise<string | null> {
  const orc = await prisma.orcamentoGrafico.findFirst({
    where: { id: orcamentoId, empresaId },
    select: { prazoPagamentoId: true },
  })
  if (!orc?.prazoPagamentoId) return null
  const prazo = await prisma.condicaoPagamentoComercial.findFirst({
    where: { id: orc.prazoPagamentoId, empresaId },
    select: { parcelas: true },
  })
  if (!prazo) return null
  const candidatas = await prisma.condicaoPagamento.findMany({
    where: { tabelaPrecoId, parcelas: prazo.parcelas, tabelaPreco: { empresaId } },
    select: { id: true, percentual: true },
  })
  if (candidatas.length === 0) return null
  candidatas.sort((a, b) => Math.abs(Number(a.percentual)) - Math.abs(Number(b.percentual)))
  return candidatas[0].id
}

// ─── Travamento no Pedido/Proposta e no Portal ──────────────────────────────

async function orcamentoCalculado(empresaId: string, orcamentoId: string | null | undefined) {
  if (!orcamentoId) return null
  const orc = await prisma.orcamentoGrafico.findFirst({
    where: { id: orcamentoId, empresaId },
    select: { id: true, numero: true, precoVenda: true, valorTotalConsolidado: true },
  })
  if (!orc) return null
  const itens = await prisma.itemOrcamentoGrafico.findMany({
    where: { orcamentoId: orc.id, empresaId },
    select: { valorTotal: true },
  })
  return orcamentoTemCalculo(orc, itens) ? orc : null
}

/** Mensagem do travamento (mesma no back e na tela). */
export function mensagemPrazoTravado(numero: number): string {
  return `O prazo de pagamento foi definido no orçamento nº ${numero}. Para alterar, troque o prazo no orçamento e recalcule.`
}

/**
 * Situação do prazo de um Pedido/Proposta: travado quando o orçamento vinculado já tem cálculo.
 * Usado pela tela (exibir o campo bloqueado) e pela gravação (recusar a troca).
 */
export async function situacaoPrazoDoPedido(empresaId: string, pedidoPropostaId: string) {
  const p = await prisma.pedidoProposta.findFirst({
    where: { id: pedidoPropostaId, empresaId },
    select: { orcamentoGraficoId: true },
  })
  const orc = await orcamentoCalculado(empresaId, p?.orcamentoGraficoId)
  return orc ? { travado: true, orcamentoNumero: orc.numero, motivo: mensagemPrazoTravado(orc.numero) } : { travado: false }
}

/** Recusa a troca de prazo no Pedido/Proposta quando o orçamento vinculado tem cálculo. */
export async function garantirPrazoLivreNoPedido(
  empresaId: string,
  pedidoPropostaId: string,
  novo: { prazoPagamentoId?: string | null; prazoPagamento?: string | null },
): Promise<void> {
  if (novo.prazoPagamentoId === undefined && novo.prazoPagamento === undefined) return
  const atual = await prisma.pedidoProposta.findFirst({
    where: { id: pedidoPropostaId, empresaId },
    select: { prazoPagamentoId: true, prazoPagamento: true, orcamentoGraficoId: true },
  })
  if (!atual) return
  const mudouId = novo.prazoPagamentoId !== undefined && (novo.prazoPagamentoId ?? null) !== (atual.prazoPagamentoId ?? null)
  const mudouTexto =
    novo.prazoPagamento !== undefined && (novo.prazoPagamento ?? '').trim() !== (atual.prazoPagamento ?? '').trim()
  if (!mudouId && !mudouTexto) return
  const orc = await orcamentoCalculado(empresaId, atual.orcamentoGraficoId)
  if (orc) throw new PrazoOrcamentoError(409, mensagemPrazoTravado(orc.numero), 'PRAZO_TRAVADO')
}

/** Recusa a troca de prazo na solicitação do Portal quando o orçamento vinculado tem cálculo. */
export async function garantirPrazoLivreNaSolicitacao(
  empresaId: string,
  solicitacaoId: string,
  novoPrazo: string | null | undefined,
): Promise<void> {
  if (novoPrazo === undefined) return
  const s = await prisma.solicitacaoOrcamentoRep.findFirst({
    where: { id: solicitacaoId, empresaId },
    select: { prazoPagamento: true, orcamentoGraficoId: true },
  })
  if (!s || (novoPrazo ?? '').trim() === (s.prazoPagamento ?? '').trim()) return
  const orc = await orcamentoCalculado(empresaId, s.orcamentoGraficoId)
  if (orc) throw new PrazoOrcamentoError(409, mensagemPrazoTravado(orc.numero), 'PRAZO_TRAVADO')
}

// ─── Troca do prazo no orçamento ────────────────────────────────────────────

export interface ResultadoTrocaPrazo {
  prazoPagamentoId: string | null
  prazoPagamento: string | null
  precisaRecalcular: boolean
}

/**
 * Troca o prazo do orçamento (só RASCUNHO). Com o orçamento já calculado, marca "precisa recalcular"
 * e volta a etapa VALIDAR/VALIDADO para EM_CALCULO. Reflete o prazo no Pedido/Proposta e na
 * solicitação do Portal vinculados.
 */
export async function trocarPrazoDoOrcamento(
  empresaId: string,
  orcamentoId: string,
  prazoId: string | null,
): Promise<ResultadoTrocaPrazo> {
  const orc = await prisma.orcamentoGrafico.findFirst({
    where: { id: orcamentoId, empresaId },
    select: {
      id: true,
      status: true,
      etapaCalculo: true,
      prazoPagamentoId: true,
      prazoPagamento: true,
      precisaRecalcular: true,
      precoVenda: true,
      valorTotalConsolidado: true,
      pedidoPropostaId: true,
    },
  })
  if (!orc) throw new PrazoOrcamentoError(404, 'Orçamento não encontrado.', 'NAO_ENCONTRADO')
  if (orc.status !== 'RASCUNHO') {
    throw new PrazoOrcamentoError(409, 'O prazo só pode ser alterado com o orçamento em rascunho.', 'ORCAMENTO_NAO_RASCUNHO')
  }

  const prazo = prazoId ? await prazoDaEmpresa(empresaId, prazoId) : null
  if ((prazo?.id ?? null) === (orc.prazoPagamentoId ?? null)) {
    return { prazoPagamentoId: orc.prazoPagamentoId, prazoPagamento: orc.prazoPagamento, precisaRecalcular: orc.precisaRecalcular }
  }

  const itens = await prisma.itemOrcamentoGrafico.findMany({
    where: { orcamentoId: orc.id, empresaId },
    select: { valorTotal: true },
  })
  const calculado = orcamentoTemCalculo(orc, itens)
  if (prazo && calculado) {
    const erro = validarParcelamento(valorTotalDoOrcamento(orc), prazo.parcelas, await valorMinimoParcelamento(empresaId))
    if (erro) throw new PrazoOrcamentoError(400, erro, 'PARCELAMENTO_ABAIXO_MINIMO')
  }

  const precisaRecalcular = calculado || orc.precisaRecalcular
  const etapa =
    calculado && (orc.etapaCalculo === 'VALIDAR' || orc.etapaCalculo === 'VALIDADO') ? 'EM_CALCULO' : orc.etapaCalculo
  const texto = prazo?.descricao ?? null

  await prisma.$transaction(async (tx) => {
    await tx.orcamentoGrafico.update({
      where: { id: orc.id },
      data: {
        prazoPagamentoId: prazo?.id ?? null,
        prazoPagamento: texto,
        precisaRecalcular,
        etapaCalculo: etapa,
        ...(calculado ? { prazoAlteradoEm: new Date() } : {}),
      },
    })
    if (orc.pedidoPropostaId) {
      await tx.pedidoProposta.updateMany({
        where: { id: orc.pedidoPropostaId, empresaId },
        data: { prazoPagamentoId: prazo?.id ?? null, prazoPagamento: texto ? texto.slice(0, 60) : null } as never,
      })
    }
    await tx.solicitacaoOrcamentoRep.updateMany({
      where: { orcamentoGraficoId: orc.id, empresaId },
      data: { prazoPagamento: texto ? texto.slice(0, 60) : null },
    })
  })

  return { prazoPagamentoId: prazo?.id ?? null, prazoPagamento: texto, precisaRecalcular }
}

/** Ainda precisa recalcular: algum item foi gravado antes da troca de prazo. */
export function aindaPrecisaRecalcular(
  prazoAlteradoEm: Date | null | undefined,
  itens: ReadonlyArray<{ atualizadoEm: Date }>,
): boolean {
  if (!prazoAlteradoEm) return false
  return itens.some((i) => i.atualizadoEm.getTime() < prazoAlteradoEm.getTime())
}

type DbLeituraEscrita = Pick<typeof prisma, 'orcamentoGrafico' | 'itemOrcamentoGrafico'>

/**
 * Reavalia "precisa recalcular" depois que itens são gravados: desliga quando todos os itens foram
 * gravados depois da troca de prazo (ou não há mais itens). Sem a marca ligada, não faz nada.
 */
export async function reavaliarPrecisaRecalcular(
  empresaId: string,
  orcamentoId: string,
  db: DbLeituraEscrita = prisma,
): Promise<void> {
  const orc = await db.orcamentoGrafico.findFirst({
    where: { id: orcamentoId, empresaId },
    select: { precisaRecalcular: true, prazoAlteradoEm: true },
  })
  if (!orc?.precisaRecalcular) return
  const itens = await db.itemOrcamentoGrafico.findMany({
    where: { orcamentoId, empresaId },
    select: { atualizadoEm: true },
  })
  if (aindaPrecisaRecalcular(orc.prazoAlteradoEm, itens)) return
  await db.orcamentoGrafico.updateMany({
    where: { id: orcamentoId, empresaId },
    data: { precisaRecalcular: false },
  })
}

/** Recusa Enviar/Validar enquanto o orçamento precisa ser recalculado. */
export async function garantirOrcamentoRecalculado(empresaId: string, orcamentoId: string): Promise<void> {
  const orc = await prisma.orcamentoGrafico.findFirst({
    where: { id: orcamentoId, empresaId },
    select: { precisaRecalcular: true },
  })
  if (orc?.precisaRecalcular) {
    throw new PrazoOrcamentoError(
      409,
      'O prazo de pagamento mudou: recalcule os itens do orçamento antes de continuar.',
      'PRECISA_RECALCULAR',
    )
  }
}

// ─── Histórico de prazos do cliente ─────────────────────────────────────────

/** Histórico de prazos do cliente + o prazo padrão (mais usado; empate: o mais recente). */
export async function historicoPrazosCliente(empresaId: string, clienteId: string) {
  const [orcs, pedidos, solicitacoes] = await Promise.all([
    prisma.orcamentoGrafico.findMany({
      where: { empresaId, clienteId, OR: [{ prazoPagamentoId: { not: null } }, { prazoPagamento: { not: null } }] },
      select: { prazoPagamentoId: true, prazoPagamento: true, pedidoPropostaId: true, criadoEm: true },
    }),
    prisma.pedidoProposta.findMany({
      where: { empresaId, clienteId, OR: [{ prazoPagamentoId: { not: null } }, { prazoPagamento: { not: null } }] } as never,
      select: { id: true, prazoPagamentoId: true, prazoPagamento: true, orcamentoGraficoId: true, criadoEm: true } as never,
    }) as unknown as Promise<
      Array<{ id: string; prazoPagamentoId: string | null; prazoPagamento: string | null; orcamentoGraficoId: string | null; criadoEm: Date }>
    >,
    prisma.solicitacaoOrcamentoRep.findMany({
      where: { empresaId, clienteId, prazoPagamento: { not: null } },
      select: { prazoPagamento: true, orcamentoGraficoId: true, criadoEm: true },
    }),
  ])

  // Um mesmo negócio não conta duas vezes: o orçamento vale; o pedido/solicitação só sem orçamento.
  const usos: UsoPrazo[] = [
    ...orcs.map((o) => ({ prazoId: o.prazoPagamentoId, descricao: o.prazoPagamento ?? '', data: o.criadoEm, origem: 'ORCAMENTO' as const })),
    ...pedidos
      .filter((p) => !p.orcamentoGraficoId)
      .map((p) => ({ prazoId: p.prazoPagamentoId, descricao: p.prazoPagamento ?? '', data: p.criadoEm, origem: 'PEDIDO_PROPOSTA' as const })),
    ...solicitacoes
      .filter((s) => !s.orcamentoGraficoId)
      .map((s) => ({ prazoId: null, descricao: s.prazoPagamento ?? '', data: s.criadoEm, origem: 'PORTAL' as const })),
  ]

  // Usos só com texto: casa com o cadastro pela descrição, para somar com os que têm id.
  const textos = [...new Set(usos.filter((u) => !u.prazoId && u.descricao.trim()).map((u) => u.descricao.trim()))]
  if (textos.length > 0) {
    const cadastro = await prisma.condicaoPagamentoComercial.findMany({
      where: { empresaId, descricao: { in: textos } },
      select: { id: true, descricao: true },
    })
    const porTexto = new Map(cadastro.map((c) => [c.descricao.trim().toLowerCase(), c.id]))
    for (const u of usos) if (!u.prazoId) u.prazoId = porTexto.get(u.descricao.trim().toLowerCase()) ?? null
  }

  const historico = agruparHistoricoPrazos(usos)
  const padrao = historico.find((h) => h.prazoId) ?? null

  // Pedido de Venda usa a condição da tabela de preço (outro cadastro): histórico próprio.
  const vendas = await prisma.pedidoVenda.findMany({
    where: { empresaId, clienteId, condicaoPagId: { not: null } },
    select: { condicaoPagId: true, criadoEm: true },
  })
  const condicoes = vendas.length
    ? await prisma.condicaoPagamento.findMany({
        where: { id: { in: [...new Set(vendas.map((v) => v.condicaoPagId as string))] }, tabelaPreco: { empresaId } },
        select: { id: true, formaPagamento: true, parcelas: true, tabelaPrecoId: true },
      })
    : []
  const porId = new Map(condicoes.map((c) => [c.id, c]))
  const historicoVendas = agruparHistoricoPrazos(
    vendas
      .filter((v) => porId.has(v.condicaoPagId as string))
      .map((v) => {
        const c = porId.get(v.condicaoPagId as string)!
        return { prazoId: c.id, descricao: `${c.formaPagamento} ${c.parcelas}x`, data: v.criadoEm, origem: 'PEDIDO_PROPOSTA' as const }
      }),
  ).map((h) => ({ condicaoPagId: h.prazoId, descricao: h.descricao, vezes: h.vezes, ultimaVez: h.ultimaVez, tabelaPrecoId: porId.get(h.prazoId as string)?.tabelaPrecoId ?? null }))

  return {
    historico,
    padrao: padrao ? { prazoId: padrao.prazoId, descricao: padrao.descricao } : null,
    vendas: historicoVendas,
    padraoVendas: historicoVendas[0] ?? null,
  }
}
