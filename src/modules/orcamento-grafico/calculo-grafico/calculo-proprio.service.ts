// Cálculo PRÓPRIO do item criado do zero (sem puxar cálculo).
//
// Spec: orcamento-grafico-paridade-fluxo-legado (paridade com o sistema de referência:
// todo item gravado tem um número de cálculo; enquanto não é calculado, a grade mostra
// "Não calculado").
//
// Regras:
//   - Criação (POST /:id/itens): dentro da MESMA transação do create do item, cria um
//     CalculoGrafico novo (número = max+1 da empresa sob `pg_advisory_xact_lock`, via
//     `proximoNumeroCalculo`), origem 'VIZOR', status 'RASCUNHO', `origemCopiaId` null,
//     engenharia espelhada do item, e grava `calculoGraficoId` no item. Falha reverte
//     tudo e não consome número.
//   - `calculoGraficoOrigemId` NUNCA é preenchido aqui: item do zero não tem âncora e
//     segue o motor normal.
//   - Sincronização (PUT /:id/itens/:itemId e POST /:id/itens/:itemId/calcular): passo
//     ADITIVO após gravar o item. Só para item SEM `calculoGraficoOrigemId`. Copia a
//     engenharia e o resultado já gravados no item para o cálculo próprio (status
//     'ATIVO' quando há resultado). Item antigo sem `calculoGraficoId` ganha o cálculo
//     próprio na primeira gravação.
//   - Não chama o motor (`calcularOrcamentoGrafico`) nem `ancorarCustoCalcgraf`; não
//     altera custo/valor do item.
//   - `empresaId` explícito em toda query.

import { Prisma } from '@prisma/client'
import { prisma } from '../../../lib/prisma'
import { proximoNumeroCalculo } from './calculo-copia.service'

type Tx = Prisma.TransactionClient
type Db = Tx | typeof prisma

/** Campos do item espelhados no cálculo próprio. */
export const SELECT_ITEM_ESPELHO = {
  id: true,
  orcamentoId: true,
  tipoEmbalagemId: true,
  descricao: true,
  medidas: true,
  papelId: true,
  papelDescricao: true,
  suporteId: true,
  gramatura: true,
  numCores: true,
  cores: true,
  maquinaId: true,
  matrizQuantidade: true,
  matrizPrecoUnitario: true,
  tintaModo: true,
  tintaConsumoKg: true,
  acabamentosRicos: true,
  modeloFacaId: true,
  montagemLinhas: true,
  montagemColunas: true,
  formatoCorteLarguraMm: true,
  formatoCorteAlturaMm: true,
  itensDiversos: true,
  itensFornecidos: true,
  camposLivres: true,
  quantidade: true,
  siglaAcabado: true,
  produtoGraficoId: true,
  resultadoCalculo: true,
  custoProducao: true,
  valorTotal: true,
  margemSelecionada: true,
  calculoGraficoId: true,
  calculoGraficoOrigemId: true,
} satisfies Prisma.ItemOrcamentoGraficoSelect

export type ItemEspelho = Prisma.ItemOrcamentoGraficoGetPayload<{ select: typeof SELECT_ITEM_ESPELHO }>

/** Dados do orçamento/catálogo que o cálculo guarda para busca na biblioteca. */
export interface ContextoCalculoProprio {
  clienteId: string | null
  clienteNome: string | null
  linhaProduto: string | null
  produto: string | null
}

/** Json? nulo precisa de `Prisma.DbNull`; valor presente passa direto. */
function json(v: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return v == null ? Prisma.DbNull : (v as Prisma.InputJsonValue)
}

function corta(v: string | null | undefined, max: number): string | null {
  if (v == null) return null
  const t = String(v)
  return t.length > max ? t.slice(0, max) : t
}

/** Item "calculado" ⇔ tem resultado, custo e valor gravados. */
export function itemTemResultado(item: Pick<ItemEspelho, 'resultadoCalculo' | 'custoProducao' | 'valorTotal'>): boolean {
  return item.resultadoCalculo != null && item.custoProducao != null && item.valorTotal != null
}

/** Item do zero ⇔ sem cálculo de origem (sem âncora). */
export function itemEhDoZero(item: { calculoGraficoOrigemId?: string | null }): boolean {
  return !item.calculoGraficoOrigemId
}

/**
 * Engenharia do cálculo a partir do item gravado (função pura). Não inclui número,
 * origem, status nem resultado.
 */
export function engenhariaDoItem(item: ItemEspelho, ctx: ContextoCalculoProprio, aproveitamentoManual?: number | null) {
  return {
    clienteId: ctx.clienteId,
    clienteNome: corta(ctx.clienteNome, 200),
    linhaProduto: corta(ctx.linhaProduto, 120),
    produto: corta(ctx.produto, 200),
    descricao: corta(item.descricao, 200),
    siglaAcabado: corta(item.siglaAcabado, 60),

    tipoEmbalagemId: item.tipoEmbalagemId,
    medidas: (item.medidas ?? {}) as Prisma.InputJsonValue,

    papelId: item.papelId,
    papelDescricao: corta(item.papelDescricao, 200),
    suporteId: item.suporteId,
    gramatura: item.gramatura,

    numCores: item.numCores,
    cores: json(item.cores),
    maquinaId: item.maquinaId,

    matrizQuantidade: item.matrizQuantidade,
    matrizPrecoUnitario: item.matrizPrecoUnitario,
    tintaModo: item.tintaModo,
    tintaConsumoKg: item.tintaConsumoKg,

    acabamentosRicos: json(item.acabamentosRicos),
    modeloFacaId: item.modeloFacaId,
    montagemLinhas: item.montagemLinhas,
    montagemColunas: item.montagemColunas,
    formatoCorteLarguraMm: item.formatoCorteLarguraMm,
    formatoCorteAlturaMm: item.formatoCorteAlturaMm,
    ...(aproveitamentoManual != null && aproveitamentoManual > 0 ? { aproveitamentoManual } : {}),

    itensDiversos: json(item.itensDiversos),
    itensFornecidos: json(item.itensFornecidos),
    camposLivres: json(item.camposLivres),

    quantidade: item.quantidade,
  }
}

/** Resultado gravado no item (foto do último cálculo). */
function resultadoDoItem(item: ItemEspelho) {
  return {
    resultadoCalculo: json(item.resultadoCalculo),
    custoProducao: item.custoProducao,
    valorTotal: item.valorTotal,
    margemSelecionada: item.margemSelecionada,
    dataCalculo: new Date(),
  }
}

/** Cliente do orçamento + nome do produto gráfico e da linha (empresaId explícito). */
export async function contextoDoItem(
  db: Db,
  empresaId: string,
  item: Pick<ItemEspelho, 'orcamentoId' | 'produtoGraficoId'>,
): Promise<ContextoCalculoProprio> {
  const orc = await db.orcamentoGrafico.findFirst({
    where: { id: item.orcamentoId, empresaId },
    select: { clienteId: true, clienteNome: true, linhaProdutoId: true },
  })
  const prod = item.produtoGraficoId
    ? await db.produtoGrafico.findFirst({
        where: { id: item.produtoGraficoId, empresaId },
        select: { nome: true, linhaProdutoId: true },
      })
    : null
  const linhaId = orc?.linhaProdutoId ?? prod?.linhaProdutoId ?? null
  const linha = linhaId
    ? await db.linhaProduto.findFirst({ where: { id: linhaId, empresaId }, select: { nome: true } })
    : null
  return {
    clienteId: orc?.clienteId ?? null,
    clienteNome: orc?.clienteNome ?? null,
    linhaProduto: linha?.nome ?? null,
    produto: prod?.nome ?? null,
  }
}

/**
 * Cria o cálculo próprio DENTRO da transação do chamador e grava `calculoGraficoId`
 * no item. Não abre transação: falha do chamador reverte tudo e devolve o número.
 *
 * @param comResultado copia o resultado do item e marca 'ATIVO' quando houver
 *   (usado na sincronização de item antigo). Na criação do item fica 'RASCUNHO'.
 */
export async function criarCalculoProprioTx(
  tx: Tx,
  params: {
    empresaId: string
    usuarioId: string | null
    item: ItemEspelho
    aproveitamentoManual?: number | null
    comResultado?: boolean
  },
): Promise<{ id: string; numero: number }> {
  const { empresaId, usuarioId, item, aproveitamentoManual, comResultado = false } = params
  const ctx = await contextoDoItem(tx, empresaId, item)
  const numero = await proximoNumeroCalculo(tx, empresaId)
  const ativo = comResultado && itemTemResultado(item)

  const calc = await tx.calculoGrafico.create({
    data: {
      empresaId,
      numero,
      numeroCalcgraf: null,
      origem: 'VIZOR',
      status: ativo ? 'ATIVO' : 'RASCUNHO',
      origemCopiaId: null,
      cancelado: false,
      ...engenhariaDoItem(item, ctx, aproveitamentoManual),
      ...(ativo ? resultadoDoItem(item) : {}),
      criadoPorId: usuarioId ?? undefined,
    },
    select: { id: true, numero: true },
  })

  await tx.itemOrcamentoGrafico.updateMany({
    where: { id: item.id, empresaId },
    data: { calculoGraficoId: calc.id },
  })

  return calc
}

export type AcaoSincronizacao = 'IGNORADO' | 'ATUALIZADO' | 'CRIADO'

/**
 * Passo aditivo após gravar/calcular o item: mantém o cálculo próprio do item do zero
 * em dia com a engenharia e o resultado gravados. Item com `calculoGraficoOrigemId`
 * (puxado/copiado de cálculo) é ignorado.
 */
export async function sincronizarCalculoProprio(params: {
  empresaId: string
  usuarioId: string | null
  itemId: string
  aproveitamentoManual?: number | null
}): Promise<{ acao: AcaoSincronizacao; calculoId?: string }> {
  const { empresaId, usuarioId, itemId, aproveitamentoManual } = params

  const item = await prisma.itemOrcamentoGrafico.findFirst({
    where: { id: itemId, empresaId },
    select: SELECT_ITEM_ESPELHO,
  })
  if (!item || !itemEhDoZero(item)) return { acao: 'IGNORADO' }

  const temResultado = itemTemResultado(item)

  if (item.calculoGraficoId) {
    const ctx = await contextoDoItem(prisma, empresaId, item)
    const r = await prisma.calculoGrafico.updateMany({
      where: { id: item.calculoGraficoId, empresaId },
      data: {
        ...engenhariaDoItem(item, ctx, aproveitamentoManual),
        ...(temResultado ? { ...resultadoDoItem(item), status: 'ATIVO' } : {}),
      },
    })
    if (r.count > 0) return { acao: 'ATUALIZADO', calculoId: item.calculoGraficoId }
    // Cálculo apontado não existe mais (ou é de outra empresa): cria um novo abaixo.
  }

  const calc = await prisma.$transaction(
    (tx) => criarCalculoProprioTx(tx, { empresaId, usuarioId, item, aproveitamentoManual, comResultado: true }),
    { timeout: 30000, maxWait: 10000 },
  )
  return { acao: 'CRIADO', calculoId: calc.id }
}
