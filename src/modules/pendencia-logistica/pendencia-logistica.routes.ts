import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'

export async function pendenciaLogisticaRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // GET / — lista pendências logísticas (com filtro por status)
  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const q = z.object({
      status: z.enum(['PENDENTE', 'RESOLVIDA']).optional(),
      notaEntradaId: z.string().uuid().optional(),
    }).parse(request.query)

    const where: any = { empresaId: user.empresaId }
    if (q.status) where.status = q.status
    if (q.notaEntradaId) where.notaEntradaId = q.notaEntradaId

    const pendencias = await prisma.pendenciaLogistica.findMany({
      where,
      orderBy: { criadoEm: 'desc' },
    })

    // Enriquecer com dados da nota
    const enriched = await Promise.all(pendencias.map(async (p) => {
      const nota = await prisma.notaEntrada.findUnique({
        where: { id: p.notaEntradaId },
        select: { numero: true, fornecedor: true, fornecedorDoc: true, status: true },
      })
      return { ...p, notaEntrada: nota }
    }))

    const totalPendentes = enriched.filter((p) => p.status === 'PENDENTE').length

    return { data: enriched, total: enriched.length, totalPendentes }
  })

  // GET /count — retorna apenas a contagem de pendências ativas (para o botão flutuante)
  app.get('/count', async (request) => {
    const user = request.user as { id: string; empresaId: string }

    const count = await prisma.pendenciaLogistica.count({
      where: { empresaId: user.empresaId, status: 'PENDENTE' },
    })

    return { count }
  })

  // GET /:id — detalhe de uma pendência
  app.get('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const pendencia = await prisma.pendenciaLogistica.findFirst({
      where: { id, empresaId: user.empresaId },
    })

    if (!pendencia) return reply.status(404).send({ message: 'Pendência não encontrada' })

    // Buscar nota e item
    const nota = await prisma.notaEntrada.findUnique({
      where: { id: pendencia.notaEntradaId },
      include: { itens: true },
    })

    return { ...pendencia, notaEntrada: nota }
  })

  // POST /resolver/:id — resolver pendência (configurar SKU ou dados logísticos)
  app.post('/resolver/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const bodySchema = z.object({
      // Para resolver pendência de SKU
      sku: z.object({
        unidade: z.string().min(1),
        qtdEmbalagem: z.number().int().positive().default(1),
        codigoBarra: z.string().optional(),
        largura: z.number().optional(),
        altura: z.number().optional(),
        comprimento: z.number().optional(),
        pesoLiquido: z.number().optional(),
        pesoBruto: z.number().optional(),
      }).optional(),
      // Para resolver pendência de dados logísticos
      dadosLogisticos: z.object({
        tipoNorma: z.enum(['FEFO', 'FIFO', 'LIFO']).default('FEFO'),
        enderecoFixoId: z.string().uuid().optional(),
        fixo: z.boolean().default(false),
      }).optional(),
    })

    const body = bodySchema.parse(request.body)

    const pendencia = await prisma.pendenciaLogistica.findFirst({
      where: { id, empresaId: user.empresaId, status: 'PENDENTE' },
    })

    if (!pendencia) return reply.status(404).send({ message: 'Pendência não encontrada ou já resolvida' })

    // Buscar produto pelo código
    let produto = null
    if (pendencia.codigoProduto) {
      produto = await prisma.produto.findFirst({
        where: { codigo: pendencia.codigoProduto, empresaId: user.empresaId },
      })
    }

    if (!produto) {
      return reply.status(422).send({ message: 'Produto não encontrado no cadastro. Cadastre o produto primeiro.' })
    }

    await prisma.$transaction(async (tx) => {
      // Resolver pendência de SKU
      if (pendencia.tipo === 'SKU' && body.sku) {
        // Verificar se já existe SKU para o produto
        const skuExistente = await tx.sku.findFirst({
          where: { produtoId: produto!.id },
          orderBy: { sequencia: 'desc' },
        })

        const seq = skuExistente ? skuExistente.sequencia + 1 : 1

        await tx.sku.create({
          data: {
            produtoId: produto!.id,
            sequencia: seq,
            unidade: body.sku.unidade,
            qtdEmbalagem: body.sku.qtdEmbalagem,
            codigoBarra: body.sku.codigoBarra,
            largura: body.sku.largura,
            altura: body.sku.altura,
            comprimento: body.sku.comprimento,
            pesoLiquido: body.sku.pesoLiquido,
            pesoBruto: body.sku.pesoBruto,
            empresaId: user.empresaId,
          },
        })
      }

      // Resolver pendência de dados logísticos
      if (pendencia.tipo === 'DADOS_LOGISTICOS' && body.dadosLogisticos) {
        const dlExistente = await tx.dadosLogisticosArmazenagem.findFirst({
          where: { produtoId: produto!.id },
          orderBy: { sequencia: 'desc' },
        })

        const seq = dlExistente ? dlExistente.sequencia + 1 : 1

        // Buscar SKU seq
        const sku = await tx.sku.findFirst({
          where: { produtoId: produto!.id },
          orderBy: { sequencia: 'asc' },
        })

        await tx.dadosLogisticosArmazenagem.create({
          data: {
            produtoId: produto!.id,
            skuSeq: sku?.sequencia ?? 1,
            sequencia: seq,
            tipoNorma: body.dadosLogisticos.tipoNorma,
            enderecoFixoId: body.dadosLogisticos.enderecoFixoId,
            fixo: body.dadosLogisticos.fixo,
          },
        })
      }

      // Marcar pendência como resolvida
      await tx.pendenciaLogistica.update({
        where: { id },
        data: {
          status: 'RESOLVIDA',
          resolvidoPorId: user.id,
          resolvidoEm: new Date(),
        },
      })
    })

    // Verificar se todas as pendências da nota foram resolvidas
    const pendenciasRestantes = await prisma.pendenciaLogistica.count({
      where: { notaEntradaId: pendencia.notaEntradaId, status: 'PENDENTE' },
    })

    return {
      message: 'Pendência resolvida com sucesso',
      pendenciasRestantes,
      liberadaParaConferencia: pendenciasRestantes === 0,
    }
  })

  // POST /verificar-nota/:notaEntradaId — verifica se uma nota tem pendências logísticas
  // Usado internamente para bloquear conferência
  app.get('/verificar-nota/:notaEntradaId', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const { notaEntradaId } = z.object({ notaEntradaId: z.string().uuid() }).parse(request.params)

    const pendencias = await prisma.pendenciaLogistica.findMany({
      where: { empresaId: user.empresaId, notaEntradaId, status: 'PENDENTE' },
    })

    return {
      temPendencia: pendencias.length > 0,
      totalPendencias: pendencias.length,
      pendencias: pendencias.map((p) => ({
        id: p.id,
        tipo: p.tipo,
        codigoProduto: p.codigoProduto,
        descricaoProduto: p.descricaoProduto,
      })),
    }
  })
}

/**
 * Analisa os itens de uma nota e cria pendências logísticas para itens sem SKU.
 * Chamado quando a portaria autoriza a entrada do veículo.
 */
export async function analisarPendenciasLogisticas(
  empresaId: string,
  notaEntradaId: string,
): Promise<{ pendenciasCriadas: number; itensAnalisados: number }> {
  const nota = await prisma.notaEntrada.findUnique({
    where: { id: notaEntradaId },
    include: { itens: true },
  })

  if (!nota || nota.itens.length === 0) {
    return { pendenciasCriadas: 0, itensAnalisados: 0 }
  }

  let pendenciasCriadas = 0

  for (const item of nota.itens) {
    if (!item.codigoProduto) continue

    const produto = await prisma.produto.findFirst({
      where: { codigo: item.codigoProduto, empresaId },
    })

    if (!produto) continue

    // Verificar se tem SKU configurado
    const sku = await prisma.sku.findFirst({
      where: { produtoId: produto.id },
    })

    if (!sku) {
      const jaExiste = await prisma.pendenciaLogistica.findFirst({
        where: { notaEntradaId, codigoProduto: item.codigoProduto, tipo: 'SKU', status: 'PENDENTE' },
      })
      if (!jaExiste) {
        await prisma.pendenciaLogistica.create({
          data: {
            empresaId,
            notaEntradaId,
            itemNotaEntradaId: item.id,
            codigoProduto: item.codigoProduto,
            descricaoProduto: item.descricao,
            fornecedor: nota.fornecedor,
            fornecedorDoc: nota.fornecedorDoc,
            tipo: 'SKU',
            status: 'PENDENTE',
          },
        })
        pendenciasCriadas++
      }
    }

    // Verificar se tem dados logísticos de armazenagem configurados
    const dadosLogisticos = await prisma.dadosLogisticosArmazenagem.findFirst({
      where: { produtoId: produto.id },
    })

    if (!dadosLogisticos) {
      const jaExiste = await prisma.pendenciaLogistica.findFirst({
        where: { notaEntradaId, codigoProduto: item.codigoProduto, tipo: 'DADOS_LOGISTICOS', status: 'PENDENTE' },
      })
      if (!jaExiste) {
        await prisma.pendenciaLogistica.create({
          data: {
            empresaId,
            notaEntradaId,
            itemNotaEntradaId: item.id,
            codigoProduto: item.codigoProduto,
            descricaoProduto: item.descricao,
            fornecedor: nota.fornecedor,
            fornecedorDoc: nota.fornecedorDoc,
            tipo: 'DADOS_LOGISTICOS',
            status: 'PENDENTE',
          },
        })
        pendenciasCriadas++
      }
    }
  }

  return { pendenciasCriadas, itensAnalisados: nota.itens.length }
}

/**
 * Verifica e resolve pendências automaticamente quando SKU ou dados logísticos são configurados.
 * Deve ser chamado após salvar SKU ou DadosLogisticosArmazenagem.
 */
export async function resolverPendenciasAutomaticamente(produtoId: string, empresaId: string): Promise<number> {
  // Buscar o produto para pegar o código
  const produto = await prisma.produto.findFirst({
    where: { id: produtoId, empresaId },
    select: { codigo: true, id: true },
  })

  if (!produto) return 0

  let resolvidas = 0

  // Verificar se agora tem SKU → resolver pendências de SKU
  const sku = await prisma.sku.findFirst({ where: { produtoId } })
  if (sku) {
    const pendenciasSku = await prisma.pendenciaLogistica.findMany({
      where: { codigoProduto: produto.codigo, tipo: 'SKU', status: 'PENDENTE', empresaId },
    })
    for (const p of pendenciasSku) {
      await prisma.pendenciaLogistica.update({
        where: { id: p.id },
        data: { status: 'RESOLVIDA', resolvidoEm: new Date() },
      })
      resolvidas++
    }
  }

  // Verificar se agora tem dados logísticos → resolver pendências de DADOS_LOGISTICOS
  const dadosLog = await prisma.dadosLogisticosArmazenagem.findFirst({ where: { produtoId } })
  if (dadosLog) {
    const pendenciasDL = await prisma.pendenciaLogistica.findMany({
      where: { codigoProduto: produto.codigo, tipo: 'DADOS_LOGISTICOS', status: 'PENDENTE', empresaId },
    })
    for (const p of pendenciasDL) {
      await prisma.pendenciaLogistica.update({
        where: { id: p.id },
        data: { status: 'RESOLVIDA', resolvidoEm: new Date() },
      })
      resolvidas++
    }
  }

  return resolvidas
}
