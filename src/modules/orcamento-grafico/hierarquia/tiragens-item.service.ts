import { prisma } from '../../../lib/prisma'
import { naoEncontrado, paraNumero, type DbClient } from './hierarquia-common'
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

export interface CalcularLinhasArgs {
  /** Já validadas por `validarTiragens` (ordem crescente). */
  tiragens: readonly number[]
  /** Quantidade atual do item; vira a referência se estiver na lista. */
  quantidadeAtual?: number | null
  calcularNaTiragem: (quantidade: number) => Promise<CustosBrutosTiragem>
  ctx: ContextoPrecoTiragem
  /** Decisões já tomadas por tiragem (valor digitado ou faixa); mantidas no recálculo. */
  entradas?: ReadonlyMap<number, EntradaTiragem>
}

/** Calcula as linhas de todas as tiragens (em sequência: o motor é síncrono e a lista tem no máximo 20). */
export async function calcularLinhasTiragem(args: CalcularLinhasArgs): Promise<LinhaTiragem[]> {
  const referencia = escolherReferencia(args.tiragens, args.quantidadeAtual)
  const linhas: Array<Omit<LinhaTiragem, 'ordem'>> = []
  for (const quantidade of args.tiragens) {
    const bruto = await args.calcularNaTiragem(quantidade)
    linhas.push(formarLinhaTiragem(quantidade, bruto, args.ctx, args.entradas?.get(quantidade)))
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

/** `margemSelecionada` do item é Decimal(5,2): limita ao intervalo representável. */
function margemParaItem(m: number): number {
  return Math.max(-999.99, Math.min(999.99, Math.round(m * 100) / 100))
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
      const dados = {
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
      }
      await tx.itemTiragemOrcamentoGrafico.upsert({
        where: { itemId_quantidade: { itemId, quantidade: l.quantidade } },
        create: { itemId, empresaId, quantidade: l.quantidade, ...dados },
        update: dados,
      })
    }
    const ref = linhas.find((l) => l.ordem === 0)
    if (ref) {
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
  })
}
