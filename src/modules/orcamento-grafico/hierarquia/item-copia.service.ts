import { Prisma } from '@prisma/client'
import { prisma } from '../../../lib/prisma'
import { criarCalculoCopiaTx } from '../calculo-grafico/calculo-copia.service'
import { consolidarOrcamento, type FechamentoItem } from '../orcamento-grafico-consolidacao.service'
import { naoEncontrado, paraNumero, type DbClient } from './hierarquia-common'
import { ITEM_SELECT_HIDRATACAO, anexarAproveitamentoManual } from './item-select'

/**
 * Item: leitura hidratada (GET /:id/itens/:itemId) e cópia sem recálculo
 * (POST /:id/itens/:itemId/copiar). Spec orcamento-grafico-hierarquia-item-plano, tarefa 3.8.
 *
 * A cópia NÃO chama o motor nem `ancorarCustoCalcgraf`: copia os valores persistidos
 * (inclusive resultadoCalculo, custoProducao, valorTotal, margemSelecionada e
 * calculoGraficoOrigemId, de modo que a âncora acompanha a cópia). O custo do item
 * copiado é idêntico ao do original.
 */

export interface CopiarItemRespostaDTO {
  itemId: string
  sequencia: number
  planosCopiados: number
}

/** Item hidratado (select compartilhado + aproveitamentoManual por SQL). */
export async function obterItemHidratado(
  orcamentoId: string,
  itemId: string,
  empresaId: string,
  db: DbClient = prisma,
) {
  // Filho filtrado pelo pai e pela empresa.
  const item = await db.itemOrcamentoGrafico.findFirst({
    where: { id: itemId, orcamentoId, empresaId },
    select: ITEM_SELECT_HIDRATACAO,
  })
  if (!item) throw naoEncontrado()
  const lista = [item] as Array<{ id: string; aproveitamentoManual?: unknown }>
  await anexarAproveitamentoManual(lista)
  return item as typeof item & { aproveitamentoManual: number | null }
}

function jsonNullable(v: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return v === null || v === undefined ? Prisma.DbNull : (v as Prisma.InputJsonValue)
}

/** Reescreve `selecaoId` das linhas de origem SELECAO usando o mapa antigo → novo. */
export function remapearSelecaoIds(materiais: unknown, mapa: ReadonlyMap<string, string>): unknown {
  if (!Array.isArray(materiais)) return materiais
  return materiais.map((linha) => {
    if (linha && typeof linha === 'object' && !Array.isArray(linha)) {
      const l = linha as Record<string, unknown>
      if (l.origem === 'SELECAO' && typeof l.selecaoId === 'string' && mapa.has(l.selecaoId)) {
        return { ...l, selecaoId: mapa.get(l.selecaoId) }
      }
    }
    return linha
  })
}

async function reconsolidar(tx: DbClient, orcamentoId: string, empresaId: string): Promise<void> {
  const itens = await tx.itemOrcamentoGrafico.findMany({
    where: { orcamentoId, empresaId },
    select: { custoProducao: true, valorTotal: true, margemSelecionada: true },
  })
  const fechamentos: FechamentoItem[] = itens.map((i) => {
    const margem = i.margemSelecionada != null ? Number(i.margemSelecionada) : 0
    return {
      custoProducao: i.custoProducao != null ? Number(i.custoProducao) : 0,
      valorTotalPorMargem: { [String(margem)]: i.valorTotal != null ? Number(i.valorTotal) : 0 },
      margemSelecionada: margem,
    }
  })
  const c = consolidarOrcamento(fechamentos)
  await tx.orcamentoGrafico.update({
    where: { id: orcamentoId, empresaId },
    data: {
      custoProducaoConsolidado: c.custoProducaoConsolidado,
      valorTotalConsolidado: c.valorTotalConsolidado,
    },
  })
}

async function copiarUmaVez(
  tx: Prisma.TransactionClient,
  orcamentoId: string,
  itemId: string,
  empresaId: string,
  usuarioId: string | null = null,
): Promise<CopiarItemRespostaDTO> {
  const orc = await tx.orcamentoGrafico.findFirst({ where: { id: orcamentoId, empresaId }, select: { id: true } })
  if (!orc) throw naoEncontrado()

  // select explícito (sem o binário de encaixe).
  const o = await tx.itemOrcamentoGrafico.findFirst({
    where: { id: itemId, orcamentoId, empresaId },
    select: ITEM_SELECT_HIDRATACAO,
  })
  if (!o) throw naoEncontrado()

  const planos = await tx.planoCalculoGrafico.findMany({
    where: { itemId, empresaId },
    orderBy: { sequencia: 'asc' },
  })

  // sequencia = max+1 (mesma regra do POST /:id/itens).
  const ultimo = await tx.itemOrcamentoGrafico.findFirst({
    where: { orcamentoId, empresaId },
    orderBy: { sequencia: 'desc' },
    select: { sequencia: true },
  })
  const sequencia = (ultimo?.sequencia ?? 0) + 1

  // aproveitamento_manual fica fora do client Prisma → SQL raw (parametrizado).
  const linhasAprov = await tx.$queryRawUnsafe<Array<{ aproveitamento_manual: unknown }>>(
    `SELECT aproveitamento_manual FROM item_orcamento_grafico WHERE id = $1 AND empresa_id = $2`,
    itemId,
    empresaId,
  )
  const aproveitamento = paraNumero(linhasAprov?.[0]?.aproveitamento_manual)

  // Seleções de material (por item e por plano) serão recriadas depois dos ids novos.
  const selecoes = await tx.selecaoMaterialAcabamento.findMany({ where: { empresaId, itemId } })

  // Cálculo próprio do item (itens antigos podem não ter): copia para um CalculoGrafico novo
  // (número = max+1 da empresa, mesmo lock do calculo-copia.service) na MESMA transação.
  // Falha aqui reverte item, planos e o número consumido.
  const proprio = await tx.itemOrcamentoGrafico.findFirst({
    where: { id: itemId, orcamentoId, empresaId },
    select: { calculoGraficoId: true },
  })
  let calculoNovoId: string | null = null
  if (proprio?.calculoGraficoId) {
    const calcOrigem = await tx.calculoGrafico.findFirst({
      where: { id: proprio.calculoGraficoId, empresaId },
    })
    if (calcOrigem) {
      const novoCalc = await criarCalculoCopiaTx(tx, calcOrigem, { empresaId, usuarioId, modo: 'PADRAO' })
      calculoNovoId = novoCalc.id
    }
  }

  const criado = await tx.itemOrcamentoGrafico.create({
    data: {
      orcamentoId,
      empresaId,
      sequencia,
      tipoEmbalagemId: o.tipoEmbalagemId,
      descricao: o.descricao,
      medidas: (o.medidas ?? {}) as Prisma.InputJsonValue,
      papelId: o.papelId,
      papelDescricao: o.papelDescricao,
      suporteId: o.suporteId,
      gramatura: o.gramatura,
      numCores: o.numCores,
      cores: jsonNullable(o.cores),
      maquinaId: o.maquinaId,
      matrizQuantidade: o.matrizQuantidade,
      matrizPrecoUnitario: o.matrizPrecoUnitario,
      tintaModo: o.tintaModo,
      tintaConsumoKg: o.tintaConsumoKg,
      acabamentosRicos: jsonNullable(o.acabamentosRicos),
      materiaisAcabamento: jsonNullable(o.materiaisAcabamento), // reescrito abaixo com os novos selecaoId
      materialMicroonduladoId: o.materialMicroonduladoId,
      modeloFacaId: o.modeloFacaId,
      itensDiversos: jsonNullable(o.itensDiversos),
      itensFornecidos: jsonNullable(o.itensFornecidos),
      camposLivres: jsonNullable(o.camposLivres),
      preImpressao: jsonNullable(o.preImpressao),
      quantidade: o.quantidade,
      resultadoCalculo: jsonNullable(o.resultadoCalculo),
      margemSelecionada: o.margemSelecionada,
      custoProducao: o.custoProducao,
      valorTotal: o.valorTotal,
      pendente: o.pendente,
      siglaAcabado: o.siglaAcabado,
      tributacao: o.tributacao,
      processoImpressao: o.processoImpressao,
      coberturaTintaTexto: o.coberturaTintaTexto,
      fabricante: o.fabricante,
      microondulado: o.microondulado,
      fornecido: o.fornecido,
      qtdModelos: o.qtdModelos,
      arte: o.arte,
      observacao: o.observacao,
      observacaoAreasOp: o.observacaoAreasOp,
      conteudoVolume: o.conteudoVolume,
      acondicionamento: jsonNullable(o.acondicionamento),
      comprimentoMm: o.comprimentoMm,
      larguraMm: o.larguraMm,
      alturaMm: o.alturaMm,
      abaColaMm: o.abaColaMm,
      abaFechamentoMm: o.abaFechamentoMm,
      fibra: o.fibra,
      montagemLinhas: o.montagemLinhas,
      montagemColunas: o.montagemColunas,
      formatoSupLarguraMm: o.formatoSupLarguraMm,
      formatoSupAlturaMm: o.formatoSupAlturaMm,
      formatoCorteLarguraMm: o.formatoCorteLarguraMm,
      formatoCorteAlturaMm: o.formatoCorteAlturaMm,
      ajusteCorteMicroMm: o.ajusteCorteMicroMm,
      suporteProducaoId: o.suporteProducaoId,
      calculoGraficoOrigemId: o.calculoGraficoOrigemId, // a âncora acompanha a cópia
      ...(calculoNovoId ? { calculoGraficoId: calculoNovoId } : {}),
      produtoGraficoId: o.produtoGraficoId,
    },
    select: { id: true },
  })

  if (aproveitamento !== null) {
    await tx.$executeRawUnsafe(
      `UPDATE item_orcamento_grafico SET aproveitamento_manual = $1::numeric WHERE id = $2 AND empresa_id = $3`,
      aproveitamento,
      criado.id,
      empresaId,
    )
  }

  // Planos com ids novos e os mesmos valores.
  const mapaPlano = new Map<string, string>()
  for (const p of planos) {
    const novo = await tx.planoCalculoGrafico.create({
      data: {
        itemId: criado.id,
        empresaId,
        sequencia: p.sequencia,
        nome: p.nome,
        suporteId: p.suporteId,
        suporteProducaoId: p.suporteProducaoId,
        gramatura: p.gramatura,
        formatoLarguraMm: p.formatoLarguraMm,
        formatoAlturaMm: p.formatoAlturaMm,
        preImpressao: jsonNullable(p.preImpressao),
        numCores: p.numCores,
        cores: jsonNullable(p.cores),
        maquinaId: p.maquinaId,
        acabamentosRicos: jsonNullable(p.acabamentosRicos),
        resultadoCalculo: jsonNullable(p.resultadoCalculo),
        custoSuporte: p.custoSuporte,
        custoImpressao: p.custoImpressao,
        custoAcabamento: p.custoAcabamento,
        tipoPlanoId: p.tipoPlanoId,
      },
      select: { id: true },
    })
    mapaPlano.set(p.id, novo.id)
  }

  // Seleções de material: novas linhas e reescrita de selecaoId no JSON do item.
  const mapaSelecao = new Map<string, string>()
  for (const s of selecoes) {
    const nova = await tx.selecaoMaterialAcabamento.create({
      data: {
        empresaId,
        itemId: criado.id,
        planoId: s.planoId ? (mapaPlano.get(s.planoId) ?? null) : null,
        acabamentoId: s.acabamentoId,
        materialId: s.materialId,
        restricaoId: s.restricaoId,
        tipoParam: s.tipoParam,
        param1: s.param1,
        param2: s.param2,
        consumo: s.consumo,
        unidadeConsumo: s.unidadeConsumo,
        valorUnitario: s.valorUnitario,
        custo: s.custo,
        aplicaNoPreco: s.aplicaNoPreco,
        situacaoParametro: s.situacaoParametro,
      },
      select: { id: true },
    })
    mapaSelecao.set(s.id, nova.id)
  }
  if (mapaSelecao.size > 0 && o.materiaisAcabamento != null) {
    await tx.itemOrcamentoGrafico.update({
      where: { id: criado.id, empresaId },
      data: { materiaisAcabamento: jsonNullable(remapearSelecaoIds(o.materiaisAcabamento, mapaSelecao)) },
    })
  }

  await reconsolidar(tx, orcamentoId, empresaId)

  return { itemId: criado.id, sequencia, planosCopiados: planos.length }
}

function ehColisaoUnica(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === 'P2002'
}

/**
 * Copia o item (sem recálculo) numa $transaction. Em colisão de unicidade da
 * sequência (P2002) repete a operação no máximo uma vez; falha reverte tudo.
 */
export async function copiarItem(
  orcamentoId: string,
  itemId: string,
  empresaId: string,
  db: typeof prisma = prisma,
  usuarioId: string | null = null,
): Promise<CopiarItemRespostaDTO> {
  const executar = () =>
    db.$transaction((tx) => copiarUmaVez(tx, orcamentoId, itemId, empresaId, usuarioId), { timeout: 30000 })
  try {
    return await executar()
  } catch (err) {
    if (ehColisaoUnica(err)) return executar()
    throw err
  }
}
