import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { FichaService } from './ficha.service'
import type {
  OndaComItens,
  OndaComVolumes,
  CarregamentoComVolumes,
  NotaComItens,
  ConferenciaComItens,
  ItemSeparacaoComRelacoes,
} from './ficha.service'
import crypto from 'node:crypto'

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

const idParamsSchema = z.object({ id: z.string().uuid() })

const criarFichaSchema = z.object({
  tipo: z.enum(['SEPARACAO', 'EMBALAGEM', 'CARREGAMENTO', 'ENDERECAMENTO', 'CONFERENCIA']),
  referenciaId: z.string().uuid(),
  ordemServicoId: z.string().uuid().optional(),
})

const confirmarFichaSchema = z.object({
  dadosConfirmados: z.record(z.string(), z.string()),
  origemDados: z.enum(['MANUAL', 'OCR', 'SCANNER']),
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function gerarCodigoBarras(tipo: string): string {
  const timestamp = Date.now().toString(36).toUpperCase()
  const random = crypto.randomBytes(3).toString('hex').toUpperCase()
  return `${tipo}-${timestamp}-${random}`
}

/**
 * Enriquece itens de separação com dados de produto e endereço de origem,
 * já que ItemSeparacao não possui relação direta no Prisma para esses campos.
 */
async function enriquecerItensSeparacao(
  itens: Array<{ produtoId: string; enderecoOrigemId: string; [k: string]: any }>,
): Promise<ItemSeparacaoComRelacoes[]> {
  const produtoIds = [...new Set(itens.map((i) => i.produtoId))]
  const enderecoIds = [...new Set(itens.map((i) => i.enderecoOrigemId))]

  const [produtos, enderecos] = await Promise.all([
    prisma.produto.findMany({
      where: { id: { in: produtoIds } },
      select: { id: true, codigo: true, nome: true, unidade: true },
    }),
    prisma.endereco.findMany({
      where: { id: { in: enderecoIds } },
      select: { id: true, enderecoCompleto: true },
    }),
  ])

  const produtoMap = new Map(produtos.map((p) => [p.id, p]))
  const enderecoMap = new Map(enderecos.map((e) => [e.id, e]))

  return itens.map((item) => ({
    ...item,
    produto: produtoMap.get(item.produtoId) ?? null,
    enderecoOrigem: enderecoMap.get(item.enderecoOrigemId) ?? null,
  })) as ItemSeparacaoComRelacoes[]
}

/**
 * Busca e monta OndaComItens para geração de HTML de separação.
 */
async function buscarOndaComItens(referenciaId: string, empresaId: string): Promise<OndaComItens | null> {
  const onda = await prisma.ondaSeparacao.findFirst({
    where: { id: referenciaId, empresaId },
    include: {
      ordens: {
        include: { itens: true },
      },
    },
  })
  if (!onda) return null

  const ordensEnriquecidas = await Promise.all(
    onda.ordens.map(async (ordem) => ({
      ...ordem,
      itens: await enriquecerItensSeparacao(ordem.itens),
    })),
  )

  return { ...onda, ordens: ordensEnriquecidas } as OndaComItens
}

/**
 * Busca e monta OndaComVolumes para geração de HTML de embalagem.
 */
async function buscarOndaComVolumes(referenciaId: string, empresaId: string): Promise<OndaComVolumes | null> {
  const onda = await prisma.ondaSeparacao.findFirst({
    where: { id: referenciaId, empresaId },
    include: {
      volumes: {
        include: {
          itens: {
            include: { itemSeparacao: true },
          },
        },
      },
    },
  })
  if (!onda) return null

  // Enriquecer itens de separação dentro dos volumes
  const volumesEnriquecidos = await Promise.all(
    onda.volumes.map(async (vol) => {
      const itensEnriquecidos = await Promise.all(
        vol.itens.map(async (iv) => {
          if (!iv.itemSeparacao) return { ...iv, itemSeparacao: null }
          const [enriquecido] = await enriquecerItensSeparacao([iv.itemSeparacao])
          return { ...iv, itemSeparacao: enriquecido }
        }),
      )
      return { ...vol, itens: itensEnriquecidos }
    }),
  )

  return { ...onda, volumes: volumesEnriquecidos } as OndaComVolumes
}

/**
 * Busca e monta CarregamentoComVolumes para geração de HTML de carregamento.
 */
async function buscarCarregamentoComVolumes(referenciaId: string, empresaId: string): Promise<CarregamentoComVolumes | null> {
  const carregamento = await prisma.carregamento.findFirst({
    where: { id: referenciaId, empresaId },
    include: {
      volumes: {
        include: {
          volume: {
            include: {
              itens: {
                include: { itemSeparacao: true },
              },
            },
          },
        },
      },
    },
  })
  if (!carregamento) return null

  // Buscar doca e transportadora manualmente (sem relação direta no Prisma)
  const [doca, transportadora] = await Promise.all([
    prisma.doca.findUnique({
      where: { id: carregamento.docaId },
      select: { id: true, descricao: true },
    }),
    carregamento.transportadoraId
      ? prisma.transportadora.findUnique({
          where: { id: carregamento.transportadoraId },
          select: { id: true, razaoSocial: true, cnpj: true },
        })
      : null,
  ])

  // Enriquecer itens de separação dentro dos volumes do carregamento
  const volumesEnriquecidos = await Promise.all(
    carregamento.volumes.map(async (cv) => {
      const itensEnriquecidos = await Promise.all(
        cv.volume.itens.map(async (iv) => {
          if (!iv.itemSeparacao) return { ...iv, itemSeparacao: null }
          const [enriquecido] = await enriquecerItensSeparacao([iv.itemSeparacao])
          return { ...iv, itemSeparacao: enriquecido }
        }),
      )
      return { ...cv, volume: { ...cv.volume, itens: itensEnriquecidos } }
    }),
  )

  return { ...carregamento, volumes: volumesEnriquecidos, doca, transportadora } as CarregamentoComVolumes
}

/**
 * Busca NotaComItens para geração de HTML de endereçamento.
 */
async function buscarNotaComItens(referenciaId: string): Promise<NotaComItens | null> {
  const nota = await prisma.notaEntrada.findFirst({
    where: { id: referenciaId },
    include: { itens: true },
  })
  return nota as NotaComItens | null
}

/**
 * Busca ConferenciaComItens para geração de HTML de conferência.
 */
async function buscarConferenciaComItens(referenciaId: string): Promise<ConferenciaComItens | null> {
  const conferencia = await prisma.conferenciaSaida.findFirst({
    where: { id: referenciaId },
    include: {
      itens: {
        include: { itemSeparacao: true },
      },
    },
  })
  if (!conferencia) return null

  // Enriquecer itens de separação
  const itensEnriquecidos = await Promise.all(
    conferencia.itens.map(async (ic) => {
      if (!ic.itemSeparacao) return { ...ic, itemSeparacao: null }
      const [enriquecido] = await enriquecerItensSeparacao([ic.itemSeparacao])
      return { ...ic, itemSeparacao: enriquecido }
    }),
  )

  return { ...conferencia, itens: itensEnriquecidos } as ConferenciaComItens
}

/**
 * Gera HTML para uma ficha com base no tipo e referenciaId.
 * Retorna null se a referência não for encontrada.
 */
async function gerarHtmlPorTipo(
  fichaService: FichaService,
  tipo: string,
  referenciaId: string,
  empresaId: string,
): Promise<{ html: string } | { erro: string }> {
  switch (tipo) {
    case 'SEPARACAO': {
      const onda = await buscarOndaComItens(referenciaId, empresaId)
      if (!onda) return { erro: 'Onda de separação não encontrada' }
      return { html: fichaService.gerarHtmlSeparacao(onda) }
    }
    case 'EMBALAGEM': {
      const onda = await buscarOndaComVolumes(referenciaId, empresaId)
      if (!onda) return { erro: 'Onda de separação não encontrada' }
      return { html: fichaService.gerarHtmlEmbalagem(onda) }
    }
    case 'CARREGAMENTO': {
      const carregamento = await buscarCarregamentoComVolumes(referenciaId, empresaId)
      if (!carregamento) return { erro: 'Carregamento não encontrado' }
      return { html: fichaService.gerarHtmlCarregamento(carregamento) }
    }
    case 'ENDERECAMENTO': {
      const nota = await buscarNotaComItens(referenciaId)
      if (!nota) return { erro: 'Nota de entrada não encontrada' }
      return { html: fichaService.gerarHtmlEnderecamento(nota) }
    }
    case 'CONFERENCIA': {
      // Primeiro tentar como ConferenciaSaida
      const conferencia = await buscarConferenciaComItens(referenciaId)
      if (conferencia) return { html: fichaService.gerarHtmlConferencia(conferencia) }
      // Fallback: tentar como NotaEntrada (conferência de entrada)
      const nota = await buscarNotaComItens(referenciaId)
      if (nota) return { html: fichaService.gerarHtmlEnderecamento(nota) }
      return { erro: 'Conferência não encontrada' }
    }
    default:
      return { erro: 'Tipo de ficha inválido' }
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function fichaOperacionalRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  const fichaService = new FichaService()

  // POST / — Gerar ficha operacional
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = criarFichaSchema.parse(request.body)

    // Validar que a referência existe gerando o HTML
    const resultado = await gerarHtmlPorTipo(fichaService, body.tipo, body.referenciaId, user.empresaId)
    if ('erro' in resultado) return reply.status(404).send({ message: resultado.erro })

    const codigoBarras = gerarCodigoBarras(body.tipo)

    const ficha = await prisma.fichaOperacional.create({
      data: {
        empresaId: user.empresaId,
        tipo: body.tipo,
        referenciaId: body.referenciaId,
        ordemServicoId: body.ordemServicoId,
        codigoBarras,
        status: 'GERADA',
      },
    })

    return reply.status(201).send(ficha)
  })

  // GET /:id — Retorna dados da ficha com status OCR
  app.get('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const ficha = await prisma.fichaOperacional.findFirst({
      where: { id, empresaId: user.empresaId },
    })

    if (!ficha) return reply.status(404).send({ message: 'Ficha operacional não encontrada' })

    return {
      ...ficha,
      dadosOcr: ficha.dadosOcr ? JSON.parse(ficha.dadosOcr) : null,
    }
  })

  // GET /:id/html — Retorna HTML renderizado para impressão
  app.get('/:id/html', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const ficha = await prisma.fichaOperacional.findFirst({
      where: { id, empresaId: user.empresaId },
    })

    if (!ficha) return reply.status(404).send({ message: 'Ficha operacional não encontrada' })

    const resultado = await gerarHtmlPorTipo(fichaService, ficha.tipo, ficha.referenciaId, user.empresaId)
    if ('erro' in resultado) return reply.status(404).send({ message: resultado.erro })

    // Atualizar status para IMPRESSA se ainda GERADA
    if (ficha.status === 'GERADA') {
      await prisma.fichaOperacional.update({
        where: { id: ficha.id },
        data: { status: 'IMPRESSA' },
      })
    }

    reply.header('Content-Type', 'text/html; charset=utf-8')
    return reply.send(resultado.html)
  })

  // GET /:id/zpl — Retorna ZPL para impressora térmica
  app.get('/:id/zpl', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const ficha = await prisma.fichaOperacional.findFirst({
      where: { id, empresaId: user.empresaId },
    })

    if (!ficha) return reply.status(404).send({ message: 'Ficha operacional não encontrada' })

    const zpl = fichaService.gerarZplFicha(ficha)

    // Atualizar status para IMPRESSA se ainda GERADA
    if (ficha.status === 'GERADA') {
      await prisma.fichaOperacional.update({
        where: { id: ficha.id },
        data: { status: 'IMPRESSA' },
      })
    }

    reply.header('Content-Type', 'text/plain; charset=utf-8')
    return reply.send(zpl)
  })

  // PATCH /:id/confirmar — Confirmar dados da ficha (pós-OCR ou manual)
  app.patch('/:id/confirmar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const body = confirmarFichaSchema.parse(request.body)

    const ficha = await prisma.fichaOperacional.findFirst({
      where: { id, empresaId: user.empresaId },
    })

    if (!ficha) return reply.status(404).send({ message: 'Ficha operacional não encontrada' })

    if (ficha.status === 'CONFIRMADA') {
      return reply.status(422).send({ message: 'Ficha já confirmada' })
    }

    const fichaAtualizada = await prisma.fichaOperacional.update({
      where: { id: ficha.id },
      data: {
        status: 'CONFIRMADA',
        origemDados: body.origemDados,
        dadosOcr: JSON.stringify(body.dadosConfirmados),
      },
    })

    return fichaAtualizada
  })
}
