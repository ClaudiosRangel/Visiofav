import type { Prisma } from '@prisma/client'
import { prisma } from '../../../lib/prisma'
import { HierarquiaError, naoEncontrado, paraNumero, type DbClient } from './hierarquia-common'
import {
  escolherReferencia,
  formarLinhaTiragem,
  numerarOrdem,
  type ContextoPrecoTiragem,
  type CustosBrutosTiragem,
  type EntradaTiragem,
  type LinhaTiragem,
} from './tiragens-item-puro'

/**
 * Várias tiragens por item (spec orcamento-grafico-tiragens-por-item, tarefa 2).
 *
 * - A lista de tiragens é do ITEM e vale para todos os planos; `calcularNaTiragem` devolve os custos
 *   JÁ SOMADOS dos planos naquela quantidade (o chamador usa o motor, ou o custo ancorado do cálculo
 *   de origem). Este serviço não chama `calcularOrcamentoGrafico` nem `ancorarCustoCalcgraf`.
 * - A linha de referência (ordem 0) é espelhada em `ItemOrcamentoGrafico.quantidade/custoProducao/
 *   valorTotal/margemSelecionada`; assim pedido, relatórios e ancoragem existentes seguem iguais.
 *   Para item ancorado, `calcularNaTiragem` deve devolver o custo ancorado na quantidade de origem,
 *   senão o espelho sobrescreveria o valor real do cálculo.
 * - `empresaId` explícito em toda consulta (SUPER_ADMIN não passa por `prismaScoped`).
 */

/** O que o chamador devolve para UMA tiragem. */
export interface CalculoDaTiragem {
  /** Custos já somados sobre os planos (ou do item achatado). */
  bruto: CustosBrutosTiragem
  /** Margem, CEV, créditos e encargo do item (os mesmos que o motor usou). */
  ctx: ContextoPrecoTiragem
  /**
   * Valor total real do cálculo de origem (item ancorado). Quando presente, a linha usa esse valor
   * e não o recalculado, para o valor do Calcgraf não ser sobrescrito.
   */
  valorAncorado?: number | null
}

export interface CalcularLinhasArgs {
  /** Já validadas por `validarTiragens` (ordem crescente). */
  tiragens: readonly number[]
  /** Quantidade atual do item; vira a referência se estiver na lista. */
  quantidadeAtual?: number | null
  calcularNaTiragem: (quantidade: number) => Promise<CalculoDaTiragem>
  /** Decisões já tomadas por tiragem (valor digitado ou faixa); mantidas no recálculo. */
  entradas?: ReadonlyMap<number, EntradaTiragem>
}

/** Calcula as linhas de todas as tiragens (em sequência: o motor é síncrono e a lista tem no máximo 20). */
export async function calcularLinhasTiragem(args: CalcularLinhasArgs): Promise<LinhaTiragem[]> {
  const referencia = escolherReferencia(args.tiragens, args.quantidadeAtual)
  const linhas: Array<Omit<LinhaTiragem, 'ordem'>> = []
  for (const quantidade of args.tiragens) {
    const calc = await args.calcularNaTiragem(quantidade)
    const decisao = args.entradas?.get(quantidade)
    // Decisão do usuário vence a âncora; sem decisão, a âncora (valor real do Calcgraf) vence o cálculo.
    const entrada: EntradaTiragem | undefined =
      decisao?.valorInformado != null || decisao?.margemPerc != null
        ? decisao
        : calc.valorAncorado != null && calc.valorAncorado > 0
          ? { ...decisao, valorInformado: calc.valorAncorado }
          : decisao
    linhas.push(formarLinhaTiragem(quantidade, calc.bruto, calc.ctx, entrada))
  }
  return numerarOrdem(linhas, referencia)
}

interface LinhaPersistida {
  quantidade: number
  valorTotal: unknown
  margemPerc: unknown
  faixaMargem: number | null
  valorInformado: boolean
}

/**
 * Decisões do usuário que sobrevivem a um recálculo: valor digitado e faixa escolhida. A margem
 * padrão (markup do item) NÃO é preservada, para acompanhar mudanças na margem do item.
 */
export function entradasDasLinhas(existentes: readonly LinhaPersistida[]): Map<number, EntradaTiragem> {
  const mapa = new Map<number, EntradaTiragem>()
  for (const l of existentes) {
    if (l.valorInformado) {
      mapa.set(l.quantidade, { valorInformado: paraNumero(l.valorTotal) })
    } else if (l.faixaMargem !== null && l.faixaMargem !== undefined) {
      mapa.set(l.quantidade, { margemPerc: paraNumero(l.margemPerc), faixaMargem: l.faixaMargem })
    }
  }
  return mapa
}

export interface RecalcularTiragensArgs {
  empresaId: string
  itemId: string
  /**
   * Lista nova (já validada). `undefined` = manter as quantidades das linhas existentes (se não
   * houver linhas, o item é de uma tiragem só e nada é feito). `[]` = remover as linhas.
   */
  tiragens?: readonly number[]
  /** Quantidade atual do item (referência preferida). */
  quantidadeAtual?: number | null
  calcularNaTiragem: (quantidade: number) => Promise<CalculoDaTiragem>
  db?: typeof prisma
}

/**
 * Recalcula e grava as tiragens do item, mantendo as decisões do usuário (valor digitado e faixa).
 * Devolve as linhas gravadas, ou `null` quando o item não usa várias tiragens.
 */
export async function recalcularTiragensDoItem(args: RecalcularTiragensArgs): Promise<LinhaTiragem[] | null> {
  const db = args.db ?? prisma
  const existentes = await db.itemTiragemOrcamentoGrafico.findMany({
    where: { itemId: args.itemId, empresaId: args.empresaId },
    orderBy: { ordem: 'asc' },
  })
  if (args.tiragens !== undefined && args.tiragens.length === 0) {
    await gravarTiragensDoItem(args.empresaId, args.itemId, [], db)
    return []
  }
  const quantidades = args.tiragens ?? existentes.map((l) => l.quantidade).sort((a, b) => a - b)
  if (quantidades.length === 0) return null
  const referenciaAtual = args.quantidadeAtual ?? existentes.find((l) => l.ordem === 0)?.quantidade ?? null
  const linhas = await calcularLinhasTiragem({
    tiragens: quantidades,
    quantidadeAtual: referenciaAtual,
    calcularNaTiragem: args.calcularNaTiragem,
    entradas: entradasDasLinhas(existentes),
  })
  await gravarTiragensDoItem(args.empresaId, args.itemId, linhas, db)
  return linhas
}

/**
 * Registra a decisão do usuário numa tiragem JÁ existente (valor digitado OU margem/faixa) sem
 * recalcular; o chamador roda `recalcularTiragensDoItem` em seguida. Tiragem inexistente = 404.
 */
export async function definirEntradaTiragem(
  empresaId: string,
  itemId: string,
  quantidade: number,
  entrada: { valorTotal?: number | null; margemPerc?: number | null; faixaMargem?: number | null; limpar?: boolean },
  db: typeof prisma = prisma,
): Promise<LinhaTiragem> {
  const linha = await db.itemTiragemOrcamentoGrafico.findFirst({ where: { itemId, empresaId, quantidade } })
  if (!linha) throw naoEncontrado()
  const informado = entrada.valorTotal != null && entrada.valorTotal > 0
  const limpar = entrada.limpar === true
  if (!limpar && !informado && entrada.margemPerc == null) {
    throw new HierarquiaError(400, 'Informe o valor total ou a margem da tiragem.')
  }
  const ctx = linha.contexto as unknown as ContextoPrecoTiragem | null
  if (!ctx || !ctx.margem) {
    throw new HierarquiaError(409, 'Recalcule o item antes de editar esta tiragem.')
  }
  const bruto: CustosBrutosTiragem = {
    materialDireto: paraNumero(linha.materialDireto) ?? 0,
    custoTransformacao: paraNumero(linha.custoTransformacao) ?? 0,
    servicoExterno: paraNumero(linha.servicoExterno) ?? 0,
  }
  let nova: LinhaTiragem
  try {
    nova = {
      ...formarLinhaTiragem(
        quantidade,
        bruto,
        ctx,
        limpar
          ? {}
          : informado
          ? { valorInformado: entrada.valorTotal as number }
          : { margemPerc: entrada.margemPerc as number, faixaMargem: entrada.faixaMargem ?? 1 },
      ),
      ordem: linha.ordem,
    }
  } catch (err) {
    // Margem + CEV >= 100% não forma preço (erro do motor): devolve como 400 legível.
    throw new HierarquiaError(400, err instanceof Error ? err.message : 'Margem inválida para esta tiragem.')
  }
  await db.$transaction(async (tx) => {
    await tx.itemTiragemOrcamentoGrafico.updateMany({ where: { id: linha.id, empresaId }, data: dadosDaLinha(nova) })
    if (nova.ordem === 0) await espelharReferencia(tx, empresaId, itemId, nova)
  })
  return nova
}

/** `margemSelecionada` do item é Decimal(5,2): limita ao intervalo representável. */
function margemParaItem(m: number): number {
  return Math.max(-999.99, Math.min(999.99, Math.round(m * 100) / 100))
}

/** Campos persistidos de uma linha de tiragem (usado ao criar e ao atualizar). */
function dadosDaLinha(l: LinhaTiragem) {
  return {
    ordem: l.ordem,
    custoProducao: l.custoProducao,
    materialDireto: l.materialDireto,
    custoTransformacao: l.custoTransformacao,
    servicoExterno: l.servicoExterno,
    margemPerc: l.margemPerc,
    faixaMargem: l.faixaMargem,
    valorTotal: l.valorTotal,
    valorInformado: l.valorInformado,
    cmValor: l.cmValor,
    cmPerc: l.cmPerc,
    contexto: l.contexto as unknown as Prisma.InputJsonValue,
  }
}

/** Espelha a tiragem de referência (ordem 0) nos campos do item. */
async function espelharReferencia(
  tx: Prisma.TransactionClient,
  empresaId: string,
  itemId: string,
  ref: LinhaTiragem,
): Promise<void> {
  await tx.itemOrcamentoGrafico.updateMany({
    where: { id: itemId, empresaId },
    data: {
      quantidade: ref.quantidade,
      custoProducao: ref.custoProducao,
      valorTotal: ref.valorTotal,
      margemSelecionada: margemParaItem(ref.margemPerc),
    },
  })
}

/** Lê as linhas de tiragem do item (ordem 0 primeiro). Item de outra empresa ou inexistente = 404. */
export async function lerTiragensDoItem(db: DbClient, empresaId: string, itemId: string) {
  const item = await db.itemOrcamentoGrafico.findFirst({ where: { id: itemId, empresaId }, select: { id: true } })
  if (!item) throw naoEncontrado()
  return db.itemTiragemOrcamentoGrafico.findMany({
    where: { itemId, empresaId },
    orderBy: { ordem: 'asc' },
  })
}

/**
 * Substitui as linhas de tiragem do item pelas informadas e espelha a referência no item.
 * Lista vazia remove as linhas (o item volta ao comportamento de uma tiragem só).
 * Tudo numa transação: falha em qualquer passo não deixa o item pela metade.
 */
export async function gravarTiragensDoItem(
  empresaId: string,
  itemId: string,
  linhas: readonly LinhaTiragem[],
  db: typeof prisma = prisma,
): Promise<void> {
  const item = await db.itemOrcamentoGrafico.findFirst({ where: { id: itemId, empresaId }, select: { id: true } })
  if (!item) throw naoEncontrado()

  await db.$transaction(async (tx) => {
    await tx.itemTiragemOrcamentoGrafico.deleteMany({
      where: { itemId, empresaId, quantidade: { notIn: linhas.map((l) => l.quantidade) } },
    })
    for (const l of linhas) {
      const dados = dadosDaLinha(l)
      await tx.itemTiragemOrcamentoGrafico.upsert({
        where: { itemId_quantidade: { itemId, quantidade: l.quantidade } },
        create: { itemId, empresaId, quantidade: l.quantidade, ...dados },
        update: dados,
      })
    }
    const ref = linhas.find((l) => l.ordem === 0)
    if (ref) await espelharReferencia(tx, empresaId, itemId, ref)
  })
}

