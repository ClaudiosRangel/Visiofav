import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'

const idParamsSchema = z.object({
  id: z.string().uuid(),
})

const estruturaBodySchema = z.object({
  produtoId: z.string().uuid(),
  versao: z.number().int().positive().optional().default(1),
  descricao: z.string().max(200).optional().nullable(),
  rendimento: z.number().positive().optional().default(1),
  status: z.enum(['ATIVA', 'INATIVA', 'RASCUNHO']).optional().default('RASCUNHO'),
})

const itemEstruturaBodySchema = z.object({
  produtoComponenteId: z.string().uuid(),
  quantidade: z.number().positive('Quantidade deve ser maior que zero'),
  unidadeMedida: z.string().min(1).max(10),
  percentualPerda: z.number().min(0).max(100).optional().default(0),
  sequencia: z.number().int().positive().optional().default(1),
  observacao: z.string().optional().nullable(),
  // Campos específicos indústria gráfica
  aproveitamento: z.number().int().positive().optional().nullable(),
  perdaFixaAcerto: z.number().min(0).optional().nullable(),
  coberturaPercent: z.number().min(0).max(100).optional().nullable(),
  tipoComponente: z.enum(['MATERIA_PRIMA', 'COMPONENTE', 'INSUMO', 'EMBALAGEM']).optional().nullable(),
})

const listQuerySchema = z.object({
  produtoId: z.string().uuid().optional(),
  status: z.enum(['ATIVA', 'INATIVA', 'RASCUNHO']).optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
})

export async function estruturaProdutoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('PCP'))

  /**
   * GET /api/estruturas-produto
   * Lista estruturas de produto com filtros.
   */
  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const { produtoId, status, page, limit } = listQuerySchema.parse(request.query)

    const where: any = { empresaId: user.empresaId }
    if (produtoId) where.produtoId = produtoId
    if (status) where.status = status

    const [data, total] = await Promise.all([
      prisma.estruturaProduto.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ produtoId: 'asc' }, { versao: 'desc' }],
        include: {
          itens: { orderBy: { sequencia: 'asc' } },
        },
      }),
      prisma.estruturaProduto.count({ where }),
    ])

    return { data, total, page, limit }
  })

  /**
   * GET /api/estruturas-produto/:id
   * Detalhe de uma estrutura com seus itens.
   */
  app.get('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const estrutura = await prisma.estruturaProduto.findFirst({
      where: { id, empresaId: user.empresaId },
      include: {
        itens: { orderBy: { sequencia: 'asc' } },
      },
    })

    if (!estrutura) {
      return reply.status(404).send({ message: 'Estrutura não encontrada' })
    }

    return estrutura
  })

  /**
   * POST /api/estruturas-produto
   * Cria uma nova estrutura de produto (BOM).
   */
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = estruturaBodySchema.parse(request.body)

    // Valida que o produto pertence à empresa
    const produto = await prisma.produto.findFirst({
      where: { id: body.produtoId, empresaId: user.empresaId },
    })

    if (!produto) {
      return reply.status(400).send({ message: 'Produto não encontrado nesta empresa' })
    }

    // Valida unicidade: apenas uma ATIVA por produto
    if (body.status === 'ATIVA') {
      const ativaExistente = await prisma.estruturaProduto.findFirst({
        where: { empresaId: user.empresaId, produtoId: body.produtoId, status: 'ATIVA' },
      })
      if (ativaExistente) {
        return reply.status(409).send({ message: 'Já existe uma estrutura ATIVA para este produto. Inative a atual antes de ativar outra.' })
      }
    }

    // Verifica duplicidade de versão
    const versaoExistente = await prisma.estruturaProduto.findUnique({
      where: {
        empresaId_produtoId_versao: {
          empresaId: user.empresaId,
          produtoId: body.produtoId,
          versao: body.versao,
        },
      },
    })

    if (versaoExistente) {
      return reply.status(409).send({ message: `Versão ${body.versao} já existe para este produto` })
    }

    const estrutura = await prisma.estruturaProduto.create({
      data: {
        empresaId: user.empresaId,
        produtoId: body.produtoId,
        versao: body.versao,
        descricao: body.descricao ?? undefined,
        rendimento: body.rendimento,
        status: body.status,
      },
    })

    return reply.status(201).send(estrutura)
  })

  /**
   * PUT /api/estruturas-produto/:id
   * Atualiza uma estrutura.
   */
  app.put('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = z.object({
      descricao: z.string().max(200).optional().nullable(),
      rendimento: z.number().positive().optional(),
      status: z.enum(['ATIVA', 'INATIVA', 'RASCUNHO']).optional(),
    }).parse(request.body)

    const estrutura = await prisma.estruturaProduto.findFirst({
      where: { id, empresaId: user.empresaId },
    })

    if (!estrutura) {
      return reply.status(404).send({ message: 'Estrutura não encontrada' })
    }

    // Valida unicidade de ATIVA
    if (body.status === 'ATIVA' && estrutura.status !== 'ATIVA') {
      const ativaExistente = await prisma.estruturaProduto.findFirst({
        where: { empresaId: user.empresaId, produtoId: estrutura.produtoId, status: 'ATIVA', id: { not: id } },
      })
      if (ativaExistente) {
        return reply.status(409).send({ message: 'Já existe uma estrutura ATIVA para este produto. Inative a atual antes.' })
      }
    }

    const atualizada = await prisma.estruturaProduto.update({
      where: { id },
      data: {
        descricao: body.descricao !== undefined ? body.descricao : undefined,
        rendimento: body.rendimento,
        status: body.status,
      },
    })

    return atualizada
  })

  /**
   * POST /api/estruturas-produto/:id/itens
   * Adiciona um item (componente) à estrutura.
   */
  app.post('/:id/itens', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = itemEstruturaBodySchema.parse(request.body)

    const estrutura = await prisma.estruturaProduto.findFirst({
      where: { id, empresaId: user.empresaId },
    })

    if (!estrutura) {
      return reply.status(404).send({ message: 'Estrutura não encontrada' })
    }

    // Valida referência circular direta
    if (body.produtoComponenteId === estrutura.produtoId) {
      return reply.status(400).send({ message: 'Um produto não pode ser componente de si mesmo (referência circular)' })
    }

    // Valida que o componente pertence à empresa
    const componente = await prisma.produto.findFirst({
      where: { id: body.produtoComponenteId, empresaId: user.empresaId },
    })

    if (!componente) {
      return reply.status(400).send({ message: 'Produto componente não encontrado nesta empresa' })
    }

    const quantidadeLiquida = body.quantidade * (1 + body.percentualPerda / 100)

    const item = await prisma.itemEstrutura.create({
      data: {
        estruturaProdutoId: id,
        produtoComponenteId: body.produtoComponenteId,
        quantidade: body.quantidade,
        unidadeMedida: body.unidadeMedida,
        percentualPerda: body.percentualPerda,
        quantidadeLiquida: Math.round(quantidadeLiquida * 10000) / 10000,
        sequencia: body.sequencia,
        observacao: body.observacao ?? undefined,
        aproveitamento: body.aproveitamento ?? undefined,
        perdaFixaAcerto: body.perdaFixaAcerto ?? undefined,
        coberturaPercent: body.coberturaPercent ?? undefined,
        tipoComponente: body.tipoComponente ?? undefined,
      },
    })

    return reply.status(201).send(item)
  })

  /**
   * PUT /api/estruturas-produto/:id/itens/:itemId
   * Atualiza um item da estrutura.
   */
  app.put('/:id/itens/:itemId', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const { itemId } = z.object({ itemId: z.string().uuid() }).parse(request.params)
    const body = itemEstruturaBodySchema.parse(request.body)

    const estrutura = await prisma.estruturaProduto.findFirst({
      where: { id, empresaId: user.empresaId },
    })

    if (!estrutura) {
      return reply.status(404).send({ message: 'Estrutura não encontrada' })
    }

    const itemExistente = await prisma.itemEstrutura.findFirst({
      where: { id: itemId, estruturaProdutoId: id },
    })

    if (!itemExistente) {
      return reply.status(404).send({ message: 'Item não encontrado nesta estrutura' })
    }

    if (body.produtoComponenteId === estrutura.produtoId) {
      return reply.status(400).send({ message: 'Um produto não pode ser componente de si mesmo (referência circular)' })
    }

    const quantidadeLiquida = body.quantidade * (1 + body.percentualPerda / 100)

    const atualizado = await prisma.itemEstrutura.update({
      where: { id: itemId },
      data: {
        produtoComponenteId: body.produtoComponenteId,
        quantidade: body.quantidade,
        unidadeMedida: body.unidadeMedida,
        percentualPerda: body.percentualPerda,
        quantidadeLiquida: Math.round(quantidadeLiquida * 10000) / 10000,
        sequencia: body.sequencia,
        observacao: body.observacao ?? undefined,
        aproveitamento: body.aproveitamento ?? undefined,
        perdaFixaAcerto: body.perdaFixaAcerto ?? undefined,
        coberturaPercent: body.coberturaPercent ?? undefined,
        tipoComponente: body.tipoComponente ?? undefined,
      },
    })

    return atualizado
  })

  /**
   * DELETE /api/estruturas-produto/:id/itens/:itemId
   * Remove um item da estrutura.
   */
  app.delete('/:id/itens/:itemId', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const { itemId } = z.object({ itemId: z.string().uuid() }).parse(request.params)

    const estrutura = await prisma.estruturaProduto.findFirst({
      where: { id, empresaId: user.empresaId },
    })

    if (!estrutura) {
      return reply.status(404).send({ message: 'Estrutura não encontrada' })
    }

    const item = await prisma.itemEstrutura.findFirst({
      where: { id: itemId, estruturaProdutoId: id },
    })

    if (!item) {
      return reply.status(404).send({ message: 'Item não encontrado nesta estrutura' })
    }

    await prisma.itemEstrutura.delete({ where: { id: itemId } })

    return reply.status(204).send()
  })

  /**
   * GET /api/estruturas-produto/:id/explodir
   * Explode a estrutura em todos os níveis (multinível), retornando apenas componentes folha.
   */
  app.get('/:id/explodir', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const { quantidade } = z.object({
      quantidade: z.coerce.number().positive().optional().default(1),
    }).parse(request.query)

    const estrutura = await prisma.estruturaProduto.findFirst({
      where: { id, empresaId: user.empresaId },
      include: { itens: { orderBy: { sequencia: 'asc' } } },
    })

    if (!estrutura) {
      return reply.status(404).send({ message: 'Estrutura não encontrada' })
    }

    const fatorBase = quantidade / Number(estrutura.rendimento)

    interface ComponenteExplodido {
      produtoId: string
      descricao: string
      unidadeMedida: string
      quantidadeTotal: number
      nivel: number
      caminho: string[]
    }

    const resultado: ComponenteExplodido[] = []
    const visitados = new Set<string>()

    async function explodir(
      estruturaId: string,
      fatorMultiplicador: number,
      nivel: number,
      caminho: string[],
    ) {
      const est = await prisma.estruturaProduto.findFirst({
        where: { id: estruturaId, empresaId: user.empresaId },
        include: { itens: { orderBy: { sequencia: 'asc' } } },
      })

      if (!est) return

      for (const item of est.itens) {
        const qtdNecessaria = Number(item.quantidadeLiquida) * fatorMultiplicador

        // Verifica se o componente tem estrutura própria (é intermediário)
        const estruturaFilha = await prisma.estruturaProduto.findFirst({
          where: {
            empresaId: user.empresaId,
            produtoId: item.produtoComponenteId,
            status: 'ATIVA',
          },
        })

        const produto = await prisma.produto.findFirst({
          where: { id: item.produtoComponenteId, empresaId: user.empresaId },
          select: { id: true, nome: true, codigo: true },
        })

        const descricao = produto ? `${produto.codigo} - ${produto.nome}` : item.produtoComponenteId
        const novoCaminho = [...caminho, descricao]

        if (estruturaFilha && !visitados.has(item.produtoComponenteId)) {
          // Componente intermediário — explodir recursivamente
          visitados.add(item.produtoComponenteId)
          const fatorFilho = qtdNecessaria / Number(estruturaFilha.rendimento)
          await explodir(estruturaFilha.id, fatorFilho, nivel + 1, novoCaminho)
          visitados.delete(item.produtoComponenteId)
        } else {
          // Componente folha (matéria-prima) — adicionar ao resultado
          const existente = resultado.find((r) => r.produtoId === item.produtoComponenteId)
          if (existente) {
            existente.quantidadeTotal += qtdNecessaria
          } else {
            resultado.push({
              produtoId: item.produtoComponenteId,
              descricao,
              unidadeMedida: item.unidadeMedida,
              quantidadeTotal: qtdNecessaria,
              nivel,
              caminho: novoCaminho,
            })
          }
        }
      }
    }

    await explodir(id, fatorBase, 1, [])

    // Arredonda quantidades
    const resultadoFinal = resultado.map((r) => ({
      ...r,
      quantidadeTotal: Math.round(r.quantidadeTotal * 10000) / 10000,
    }))

    return {
      estruturaId: id,
      produtoId: estrutura.produtoId,
      quantidadeSolicitada: quantidade,
      rendimento: Number(estrutura.rendimento),
      componentes: resultadoFinal,
      totalComponentes: resultadoFinal.length,
    }
  })

  /**
   * POST /api/estruturas-produto/:id/duplicar
   * Duplica uma estrutura para criar nova versão.
   */
  app.post('/:id/duplicar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const estrutura = await prisma.estruturaProduto.findFirst({
      where: { id, empresaId: user.empresaId },
      include: { itens: true },
    })

    if (!estrutura) {
      return reply.status(404).send({ message: 'Estrutura não encontrada' })
    }

    // Calcula próxima versão
    const ultimaVersao = await prisma.estruturaProduto.findFirst({
      where: { empresaId: user.empresaId, produtoId: estrutura.produtoId },
      orderBy: { versao: 'desc' },
      select: { versao: true },
    })

    const novaVersao = (ultimaVersao?.versao ?? 0) + 1

    const novaEstrutura = await prisma.estruturaProduto.create({
      data: {
        empresaId: user.empresaId,
        produtoId: estrutura.produtoId,
        versao: novaVersao,
        descricao: estrutura.descricao ? `${estrutura.descricao} (cópia)` : `Versão ${novaVersao}`,
        rendimento: estrutura.rendimento,
        status: 'RASCUNHO',
        itens: {
          create: estrutura.itens.map((item) => ({
            produtoComponenteId: item.produtoComponenteId,
            quantidade: item.quantidade,
            unidadeMedida: item.unidadeMedida,
            percentualPerda: item.percentualPerda,
            quantidadeLiquida: item.quantidadeLiquida,
            sequencia: item.sequencia,
            observacao: item.observacao,
          })),
        },
      },
      include: { itens: { orderBy: { sequencia: 'asc' } } },
    })

    return reply.status(201).send(novaEstrutura)
  })
}
