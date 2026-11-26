import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../../lib/prisma'
import { custoDaTiragem, margemMinimaPerc, margemSobrePreco, situacaoMargem } from '../margem-minima'
import { verificarPermissaoComercial } from '../permissoes-comercial.routes'
import { HierarquiaError, MSG_NAO_ENCONTRADO, paramsItemSchema } from './hierarquia-common'
import { definirEntradaTiragem } from './tiragens-item.service'

/**
 * Rotas das tiragens do item (spec orcamento-grafico-tiragens-por-item, tarefa 3).
 *
 *  - GET `/:id/itens/:itemId/tiragens`: linhas de tiragem do item (ordem 0 = referência), sem o
 *    contexto interno de preço, com a margem sobre o preço e a situação frente à margem mínima.
 *    Item sem linhas devolve `[]`.
 *  - PUT `/:id/itens/:itemId/tiragens/:quantidade`: o usuário define o VALOR (total ou unitário; a margem
 *    é calculada de volta) ou a MARGEM (valor refeito). Valor digitado e "voltar ao cálculo" exigem a
 *    permissão `podeAlterarValorUnitario` e ficam no log (spec orcamento-prazos-cliente-margem R5).
 *    Não recalcula custo: usa os custos e o contexto gravados na linha. Atualiza o consolidado.
 *
 * A lista de tiragens e o recálculo de custo ficam em PUT/POST do item (`tiragens` no corpo) e nas rotas
 * de plano. `empresaId` explícito em toda consulta; item de outra empresa responde 404.
 */
export interface DepsRotasTiragens {
  /** Reconsolida o cabeçalho do orçamento (função do arquivo de rotas principal). */
  reconsolidarOrcamento: (orcamentoId: string, empresaId: string) => Promise<void>
  /**
   * Cria a linha de tiragem do item que ainda não tem nenhuma (item de uma tiragem só, como os
   * puxados de um cálculo existente), na quantidade atual do item, para o Fechamento poder editar
   * margem e valor unitário. Usa o mesmo recálculo das tiragens (com a âncora do cálculo de origem).
   */
  criarTiragemUnica?: (orcamentoId: string, itemId: string, empresaId: string, quantidade: number) => Promise<void>
}

/**
 * Item em RASCUNHO sem nenhuma linha de tiragem e com quantidade: cria a linha única. Falha não
 * impede a leitura (a tela mostra o aviso de "sem tiragens", como antes).
 */
async function garantirTiragemUnica(
  deps: DepsRotasTiragens,
  orcamentoId: string,
  itemId: string,
  empresaId: string,
  log: FastifyInstance['log'],
): Promise<void> {
  if (!deps.criarTiragemUnica) return
  const existe = await prisma.itemTiragemOrcamentoGrafico.findFirst({ where: { itemId, empresaId }, select: { id: true } })
  if (existe) return
  const item = await prisma.itemOrcamentoGrafico.findFirst({
    where: { id: itemId, orcamentoId, empresaId, orcamento: { empresaId, status: 'RASCUNHO' } },
    select: { quantidade: true },
  })
  const quantidade = Number(item?.quantidade ?? 0)
  if (!Number.isInteger(quantidade) || quantidade <= 0) return
  try {
    await deps.criarTiragemUnica(orcamentoId, itemId, empresaId, quantidade)
  } catch (err) {
    log.warn({ err, orcamentoId, itemId }, 'não foi possível criar a tiragem única do item')
  }
}

const paramsTiragemSchema = paramsItemSchema.extend({
  quantidade: z.coerce.number().int().positive(),
})

const corpoTiragemSchema = z
  .object({
    valorTotal: z.number().positive().optional(),
    /** Valor unitário digitado; o total = unitário × quantidade da tiragem. */
    valorUnitario: z.number().positive().optional(),
    margemPerc: z.number().min(-1000).max(1000).optional(),
    faixaMargem: z.number().int().min(0).max(2).optional(),
    /** true = descarta valor/margem digitados e volta ao valor calculado. */
    limpar: z.boolean().optional(),
  })
  .refine(
    (c) => c.limpar === true || c.valorTotal !== undefined || c.valorUnitario !== undefined || c.margemPerc !== undefined,
    { message: 'Informe o valor (total ou unitário) ou a margem da tiragem.' },
  )

const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100

interface LinhaComCusto {
  contexto?: unknown
  custoProducao?: unknown
  valorTotal?: unknown
}

/** Linha sem o contexto interno de preço, com a margem sobre o preço e a situação. */
function paraResposta<T extends LinhaComCusto>(linha: T, minima: number) {
  const { contexto, ...resto } = linha
  const custo = custoDaTiragem(Number(linha.custoProducao) || 0, contexto)
  const margemSobre = margemSobrePreco(Number(linha.valorTotal), custo)
  return { ...resto, margemSobrePreco: margemSobre, margemMinima: minima, situacaoMargem: situacaoMargem(margemSobre, minima) }
}

export function registrarRotasTiragens(app: FastifyInstance, deps: DepsRotasTiragens): void {
  app.get('/:id/itens/:itemId/tiragens', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id, itemId } = paramsItemSchema.parse(request.params)
    const item = await prisma.itemOrcamentoGrafico.findFirst({
      where: { id: itemId, orcamentoId: id, empresaId: user.empresaId },
      select: { id: true },
    })
    if (!item) return reply.status(404).send({ message: MSG_NAO_ENCONTRADO })
    await garantirTiragemUnica(deps, id, itemId, user.empresaId, request.log)
    const [linhas, minima] = await Promise.all([
      prisma.itemTiragemOrcamentoGrafico.findMany({
        where: { itemId, empresaId: user.empresaId },
        orderBy: { ordem: 'asc' },
      }),
      margemMinimaPerc(user.empresaId),
    ])
    return linhas.map((l) => paraResposta(l, minima))
  })

  app.put('/:id/itens/:itemId/tiragens/:quantidade', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string; perfil?: string; nome?: string }
    const { id, itemId, quantidade } = paramsTiragemSchema.parse(request.params)
    const corpo = corpoTiragemSchema.parse(request.body)
    const item = await prisma.itemOrcamentoGrafico.findFirst({
      where: { id: itemId, orcamentoId: id, empresaId: user.empresaId },
      select: { id: true },
    })
    if (!item) return reply.status(404).send({ message: MSG_NAO_ENCONTRADO })
    await garantirTiragemUnica(deps, id, itemId, user.empresaId, request.log)

    const valorTotalDigitado =
      corpo.valorUnitario !== undefined ? r2(corpo.valorUnitario * quantidade) : corpo.valorTotal
    const mexeNoValor = valorTotalDigitado !== undefined || corpo.limpar === true
    if (
      mexeNoValor &&
      !(await verificarPermissaoComercial(user.empresaId, user.id, user.perfil, 'podeAlterarValorUnitario'))
    ) {
      return reply.status(403).send({ message: 'Sem permissão para alterar o valor unitário do orçamento.', code: 'SEM_PERMISSAO_VALOR' })
    }

    const anterior = mexeNoValor
      ? await prisma.itemTiragemOrcamentoGrafico.findFirst({
          where: { itemId, empresaId: user.empresaId, quantidade },
          select: { valorTotal: true, custoProducao: true, contexto: true },
        })
      : null
    try {
      const linha = await definirEntradaTiragem(user.empresaId, itemId, quantidade, {
        valorTotal: valorTotalDigitado ?? null,
        margemPerc: corpo.margemPerc ?? null,
        faixaMargem: corpo.faixaMargem ?? null,
        limpar: corpo.limpar === true,
      })
      await deps.reconsolidarOrcamento(id, user.empresaId)
      const minima = await margemMinimaPerc(user.empresaId)
      const resposta = paraResposta(linha, minima)

      if (mexeNoValor) {
        const custoAntes = custoDaTiragem(Number(anterior?.custoProducao) || 0, anterior?.contexto)
        const usuario = user.nome
          ? user.nome
          : (await prisma.usuario.findFirst({ where: { id: user.id }, select: { nome: true } }))?.nome ?? null
        await prisma.logValorOrcamentoGrafico.create({
          data: {
            empresaId: user.empresaId,
            orcamentoId: id,
            itemId,
            quantidade,
            valorAnterior: anterior?.valorTotal != null ? Number(anterior.valorTotal) : null,
            valorNovo: Number(linha.valorTotal),
            margemAnterior: margemSobrePreco(Number(anterior?.valorTotal), custoAntes),
            margemNova: resposta.margemSobrePreco,
            margemMinima: minima,
            abaixoMargem: resposta.situacaoMargem === 'ABAIXO',
            acao: corpo.limpar === true ? 'LIMPAR' : 'VALOR',
            usuarioId: user.id,
            usuarioNome: usuario ? usuario.slice(0, 160) : null,
          },
        })
      }
      return resposta
    } catch (err) {
      if (err instanceof HierarquiaError) return reply.status(err.statusCode).send({ message: err.message })
      throw err
    }
  })
}
