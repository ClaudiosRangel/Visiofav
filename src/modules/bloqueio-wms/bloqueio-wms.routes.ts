/**
 * Rotas do módulo de Bloqueio Hierárquico, Quarentena, Compatibilidade,
 * Picking Dinâmico e Mudança de Picking (DE/PARA).
 *
 * Implementa RF001 (Transit Point), RF004 (Compatibilidade), RF009 (Picking),
 * RF011 (Pulmão Misto), RF012 (Bloqueios) do documento de requisitos.
 */

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import {
  criarBloqueio,
  liberarBloqueio,
  verificarBloqueio,
  listarBloqueiosAtivos,
} from './bloqueio-hierarquico.service'
import {
  liberarPickingsDinamicosZerados,
  criarMudancaPicking,
  executarMudancaPicking,
  cancelarMudancaPicking,
} from './picking-dinamico.service'
import {
  validarCompatibilidadeArea,
  validarLimitePulmaoMisto,
} from './compatibilidade-area.service'

// ── Schemas Zod ────────────────────────────────────────────────────────

const criarBloqueioSchema = z.object({
  nivel: z.enum(['DEPOSITO', 'ZONA', 'RUA', 'PREDIO', 'NIVEL', 'PRODUTO', 'LOTE']),
  depositoId: z.string().uuid().optional(),
  zonaId: z.string().uuid().optional(),
  rua: z.string().optional(),
  predio: z.string().optional(),
  codigoNivel: z.string().optional(),
  produtoId: z.string().uuid().optional(),
  lote: z.string().optional(),
  motivo: z.string().min(3, 'Motivo deve ter no mínimo 3 caracteres'),
  tipo: z.enum(['MANUTENCAO', 'INVENTARIO', 'QUARENTENA', 'RECALL', 'AVARIA', 'OUTRO']),
})

const liberarBloqueioSchema = z.object({
  bloqueioId: z.string().uuid(),
})

const verificarBloqueioSchema = z.object({
  enderecoId: z.string().uuid(),
  produtoId: z.string().uuid().optional(),
  lote: z.string().optional(),
})

const mudancaPickingSchema = z.object({
  produtoId: z.string().uuid(),
  enderecoOrigemId: z.string().uuid(),
  enderecoDestinoId: z.string().uuid(),
  observacao: z.string().optional(),
})

const bloquearLoteSchema = z.object({
  produtoId: z.string().uuid(),
  lote: z.string().min(1),
  motivo: z.string().min(3),
})

const quarentenaEnderecoSchema = z.object({
  enderecoId: z.string().uuid(),
  quarentena: z.boolean(),
  motivo: z.string().optional(),
})

// ── Rotas ──────────────────────────────────────────────────────────────

export async function bloqueioWmsRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // ═══════════════════════════════════════════════════════════════════════
  // BLOQUEIO HIERÁRQUICO
  // ═══════════════════════════════════════════════════════════════════════

  // POST /bloqueios — criar bloqueio hierárquico
  app.post('/bloqueios', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = criarBloqueioSchema.parse(request.body)

    const bloqueio = await criarBloqueio({
      empresaId: user.empresaId,
      ...body,
      bloqueadoPorId: user.id,
    })

    return reply.status(201).send(bloqueio)
  })

  // DELETE /bloqueios/:id — liberar bloqueio
  app.delete('/bloqueios/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const bloqueio = await liberarBloqueio({ bloqueioId: id, liberadoPorId: user.id })
    return bloqueio
  })

  // GET /bloqueios — listar bloqueios ativos
  app.get('/bloqueios', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    return listarBloqueiosAtivos(user.empresaId)
  })

  // POST /bloqueios/verificar — verificar se posição está bloqueada
  app.post('/bloqueios/verificar', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const body = verificarBloqueioSchema.parse(request.body)

    return verificarBloqueio({
      empresaId: user.empresaId,
      enderecoId: body.enderecoId,
      produtoId: body.produtoId,
      lote: body.lote,
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // QUARENTENA
  // ═══════════════════════════════════════════════════════════════════════

  // PATCH /quarentena/endereco — marcar/desmarcar endereço como quarentena
  app.patch('/quarentena/endereco', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = quarentenaEnderecoSchema.parse(request.body)

    const endereco = await prisma.endereco.findFirst({
      where: { id: body.enderecoId, empresaId: user.empresaId },
    })
    if (!endereco) return reply.status(404).send({ message: 'Endereço não encontrado' })

    await prisma.endereco.update({
      where: { id: body.enderecoId },
      data: {
        quarentena: body.quarentena,
        motivoBloqueio: body.quarentena ? (body.motivo || 'Quarentena') : null,
      },
    })

    return { message: body.quarentena ? 'Endereço em quarentena' : 'Quarentena removida' }
  })

  // PATCH /quarentena/zona/:id — marcar/desmarcar zona como quarentena
  app.patch('/quarentena/zona/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const { quarentena, motivo } = z.object({ quarentena: z.boolean(), motivo: z.string().optional() }).parse(request.body)

    const zona = await prisma.zona.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!zona) return reply.status(404).send({ message: 'Zona não encontrada' })

    // Atualizar a zona
    await prisma.zona.update({
      where: { id },
      data: { quarentena, motivoBloqueio: quarentena ? (motivo || 'Quarentena') : null },
    })

    // Propagar para todos os endereços da zona
    await prisma.endereco.updateMany({
      where: { zonaId: id, empresaId: user.empresaId },
      data: { quarentena },
    })

    return { message: quarentena ? 'Zona em quarentena' : 'Quarentena da zona removida' }
  })

  // ═══════════════════════════════════════════════════════════════════════
  // BLOQUEIO POR LOTE (RECALL)
  // ═══════════════════════════════════════════════════════════════════════

  // POST /bloqueios/lote — bloquear um lote específico em todos os endereços
  app.post('/bloqueios/lote', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = bloquearLoteSchema.parse(request.body)

    // Bloquear todos os saldos desse lote/produto.
    // Inclui saldos legados com empresa_id NULL (o endereçamento antigo
    // criava SaldoEndereco sem empresaId) — mesma tolerância usada pelo
    // saldo-consolidado.service.ts (OR: [{empresaId}, {empresaId: null}]).
    // Sem isso, o bloqueio não casava as posições e retornava 0 posições.
    const resultado = await prisma.saldoEndereco.updateMany({
      where: {
        produtoId: body.produtoId,
        lote: body.lote,
        OR: [{ empresaId: user.empresaId }, { empresaId: null }],
      },
      data: { bloqueado: true, motivoBloqueioLote: body.motivo },
    })

    // Também criar bloqueio hierárquico para rastreabilidade
    await criarBloqueio({
      empresaId: user.empresaId,
      nivel: 'LOTE',
      produtoId: body.produtoId,
      lote: body.lote,
      motivo: body.motivo,
      tipo: 'RECALL',
      bloqueadoPorId: user.id,
    })

    return reply.status(201).send({
      message: `Lote ${body.lote} bloqueado em ${resultado.count} posição(ões)`,
      posicoesBloqueadas: resultado.count,
    })
  })

  // DELETE /bloqueios/lote — liberar um lote
  app.delete('/bloqueios/lote', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const { produtoId, lote } = z.object({ produtoId: z.string().uuid(), lote: z.string() }).parse(request.query)

    // Libera as posições do lote. Inclui saldos legados com empresa_id NULL
    // (mesma tolerância do bloqueio acima) para não deixar posição bloqueada
    // remanescente quando o saldo foi criado sem empresaId.
    await prisma.saldoEndereco.updateMany({
      where: {
        produtoId,
        lote,
        bloqueado: true,
        OR: [{ empresaId: user.empresaId }, { empresaId: null }],
      },
      data: { bloqueado: false, motivoBloqueioLote: null },
    })

    // Liberar bloqueio hierárquico correspondente
    const bloqueioLote = await prisma.bloqueioHierarquico.findFirst({
      where: { empresaId: user.empresaId, nivel: 'LOTE', produtoId, lote, ativo: true },
    })
    if (bloqueioLote) {
      await liberarBloqueio({ bloqueioId: bloqueioLote.id, liberadoPorId: user.id })
    }

    return { message: `Lote ${lote} liberado` }
  })

  // ═══════════════════════════════════════════════════════════════════════
  // PICKING DINÂMICO
  // ═══════════════════════════════════════════════════════════════════════

  // POST /picking/liberar-dinamicos — liberar pickings dinâmicos zerados
  app.post('/picking/liberar-dinamicos', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    return liberarPickingsDinamicosZerados(user.empresaId)
  })

  // ═══════════════════════════════════════════════════════════════════════
  // MUDANÇA DE PICKING (DE/PARA)
  // ═══════════════════════════════════════════════════════════════════════

  // POST /picking/mudanca — solicitar mudança DE/PARA
  app.post('/picking/mudanca', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = mudancaPickingSchema.parse(request.body)

    const mudanca = await criarMudancaPicking({
      empresaId: user.empresaId,
      ...body,
      solicitadoPorId: user.id,
    })

    return reply.status(201).send(mudanca)
  })

  // PATCH /picking/mudanca/:id/executar — executar a mudança
  app.patch('/picking/mudanca/:id/executar', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    return executarMudancaPicking(id, user.id)
  })

  // PATCH /picking/mudanca/:id/cancelar — cancelar a mudança
  app.patch('/picking/mudanca/:id/cancelar', async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    return cancelarMudancaPicking(id)
  })

  // GET /picking/mudancas — listar mudanças
  app.get('/picking/mudancas', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const { status } = z.object({ status: z.string().optional() }).parse(request.query)

    const where: any = { empresaId: user.empresaId }
    if (status) where.status = status

    return prisma.mudancaPicking.findMany({
      where,
      orderBy: { solicitadoEm: 'desc' },
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // COMPATIBILIDADE E PULMÃO MISTO
  // ═══════════════════════════════════════════════════════════════════════

  // POST /compatibilidade/verificar — verificar se produto é compatível com endereço
  app.post('/compatibilidade/verificar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = z.object({
      produtoId: z.string().uuid(),
      enderecoId: z.string().uuid(),
    }).parse(request.body)

    // Buscar dados do produto
    const produto = await prisma.produto.findFirst({
      where: { id: body.produtoId, empresaId: user.empresaId },
      select: { classificacaoArmazenagemId: true, ambienteExigido: true },
    })
    if (!produto) return reply.status(404).send({ message: 'Produto não encontrado' })

    // Buscar dados do endereço
    const endereco = await prisma.endereco.findFirst({
      where: { id: body.enderecoId },
      select: {
        classificacaoProdutoId: true,
        ambienteArmazenagemId: true,
        ambienteArmazenagem: { select: { temperatura: true } },
        maxSkusMisto: true,
      },
    })
    if (!endereco) return reply.status(404).send({ message: 'Endereço não encontrado' })

    // Verificar compatibilidade de área
    const compatibilidade = validarCompatibilidadeArea(
      {
        classificacaoArmazenagemId: produto.classificacaoArmazenagemId ?? null,
        ambienteExigido: produto.ambienteExigido ?? null,
      },
      {
        classificacaoProdutoId: endereco.classificacaoProdutoId,
        ambienteArmazenagemId: endereco.ambienteArmazenagemId,
        ambienteTemperatura: endereco.ambienteArmazenagem?.temperatura ?? null,
      },
    )

    // Verificar limite de pulmão misto
    if (endereco.maxSkusMisto) {
      const saldos = await prisma.saldoEndereco.findMany({
        where: { enderecoId: body.enderecoId, quantidade: { gt: 0 } },
        select: { produtoId: true },
        distinct: ['produtoId'],
      })
      const produtosExistentes = saldos.map((s) => s.produtoId)

      const limiteMisto = validarLimitePulmaoMisto(
        endereco.maxSkusMisto,
        produtosExistentes,
        body.produtoId,
      )

      if (!limiteMisto.permitido) {
        return {
          compativel: false,
          motivos: [...compatibilidade.motivos, limiteMisto.motivo!],
        }
      }
    }

    return compatibilidade
  })

  // ═══════════════════════════════════════════════════════════════════════
  // CLASSIFICAÇÃO ABC AUTOMÁTICA
  // ═══════════════════════════════════════════════════════════════════════

  // POST /classificacao-abc/calcular — calcula e atualiza a curva ABC de todos os produtos
  app.post('/classificacao-abc/calcular', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const { faixaA, faixaB } = z.object({
      faixaA: z.number().min(1).max(100).default(80),
      faixaB: z.number().min(1).max(100).default(95),
    }).parse(request.body || {})

    // Buscar vendas por produto (últimos 12 meses) via raw query para contornar limitação do groupBy
    const dataInicio = new Date()
    dataInicio.setMonth(dataInicio.getMonth() - 12)

    const vendas: Array<{ produto_id: string; total: number }> = await prisma.$queryRaw`
      SELECT ipv."produto_id", SUM(ipv."valor_total")::float as total
      FROM "item_pedido_venda" ipv
      INNER JOIN "pedido_venda" pv ON pv."id" = ipv."pedido_venda_id"
      WHERE pv."empresa_id" = ${user.empresaId}
        AND pv."criado_em" >= ${dataInicio}
        AND pv."status" IN ('CONFIRMADO', 'EFETIVADO')
      GROUP BY ipv."produto_id"
      ORDER BY total DESC
    `

    if (vendas.length === 0) return { message: 'Nenhuma venda no período', atualizados: 0 }

    // Calcular total geral
    const totalGeral = vendas.reduce((acc, v) => acc + (v.total ?? 0), 0)
    if (totalGeral === 0) return { message: 'Valor total zero', atualizados: 0 }

    // Classificar
    let acumulado = 0
    let atualizados = 0

    for (const venda of vendas) {
      const valor = venda.total ?? 0
      acumulado += valor
      const percentual = (acumulado / totalGeral) * 100

      let curva: string
      if (percentual <= faixaA) curva = 'A'
      else if (percentual <= faixaB) curva = 'B'
      else curva = 'C'

      await prisma.produto.update({
        where: { id: venda.produto_id },
        data: { curvaAbc: curva },
      })
      atualizados++
    }

    // Produtos sem venda = C
    await prisma.produto.updateMany({
      where: {
        empresaId: user.empresaId,
        id: { notIn: vendas.map((v) => v.produto_id) },
        curvaAbc: { not: 'C' },
      },
      data: { curvaAbc: 'C' },
    })

    return { message: 'Classificação ABC calculada', atualizados, faixaA, faixaB }
  })
}
