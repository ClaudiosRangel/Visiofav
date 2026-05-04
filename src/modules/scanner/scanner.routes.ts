import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { ValidacaoLocalizacaoService } from './validacao-localizacao.service'
import { registrarAudit } from '../auditoria/auditoria.routes'

// ---------------------------------------------------------------------------
// Zod Schemas — Validação
// ---------------------------------------------------------------------------

const validarLocalizacaoSchema = z.object({
  ordemServicoId: z.string().uuid(),
  barcodeEscaneado: z.string().min(1),
  enderecoEsperadoId: z.string().uuid(),
})

const validarProdutoSchema = z.object({
  barcodeEscaneado: z.string().min(1),
  itemSeparacaoId: z.string().uuid(),
})

// ---------------------------------------------------------------------------
// Zod Schemas — Confirmação
// ---------------------------------------------------------------------------

const confirmarSeparacaoSchema = z.object({
  itemSeparacaoId: z.string().uuid(),
  barcodeEscaneado: z.string().min(1),
  quantidadeSeparada: z.number().positive(),
  motivoDivergencia: z
    .enum(['PRODUTO_NAO_ENCONTRADO', 'QUANTIDADE_INSUFICIENTE', 'AVARIA'])
    .optional(),
})

const confirmarEmbalagemSchema = z.object({
  volumeId: z.string().uuid(),
  barcodeEscaneado: z.string().min(1),
  quantidade: z.number().positive(),
})

const confirmarCarregamentoSchema = z.object({
  carregamentoId: z.string().uuid(),
  barcodeVolume: z.string().min(1),
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Busca produto pelo barcode escaneado.
 * Procura primeiro pelo campo codigoBarra no Sku, depois pelo campo codigo no Produto.
 * Retorna o Produto encontrado ou null.
 */
async function buscarProdutoPorBarcode(barcodeEscaneado: string) {
  // 1. Buscar por EAN no Sku (codigoBarra)
  const sku = await prisma.sku.findFirst({
    where: { codigoBarra: barcodeEscaneado },
    select: { produtoId: true },
  })

  if (sku) {
    return prisma.produto.findUnique({
      where: { id: sku.produtoId },
      select: { id: true, nome: true, codigo: true, cEAN: true },
    })
  }

  // 2. Buscar por código do Produto
  const produto = await prisma.produto.findFirst({
    where: { codigo: barcodeEscaneado },
    select: { id: true, nome: true, codigo: true, cEAN: true },
  })

  return produto
}

/**
 * Busca o EAN principal de um produto a partir dos Skus vinculados.
 */
async function buscarEanProduto(produtoId: string): Promise<string | null> {
  const sku = await prisma.sku.findFirst({
    where: { produtoId, codigoBarra: { not: null } },
    select: { codigoBarra: true },
    orderBy: { sequencia: 'asc' },
  })
  return sku?.codigoBarra ?? null
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function scannerRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  const validacaoLocalizacaoService = new ValidacaoLocalizacaoService()

  // ==========================================================================
  // VALIDAÇÃO
  // ==========================================================================

  // POST /validar-localizacao — Valida barcode de endereço vs esperado
  app.post('/validar-localizacao', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = validarLocalizacaoSchema.parse(request.body)

    const resultado = await validacaoLocalizacaoService.validar(
      body.barcodeEscaneado,
      body.enderecoEsperadoId,
      body.ordemServicoId,
      user.empresaId,
      user.id,
    )

    return resultado
  })

  // POST /validar-produto — Valida barcode de produto vs item esperado
  app.post('/validar-produto', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = validarProdutoSchema.parse(request.body)

    // Buscar o ItemSeparacao para obter o produtoId esperado
    const itemSeparacao = await prisma.itemSeparacao.findUnique({
      where: { id: body.itemSeparacaoId },
      select: { id: true, produtoId: true },
    })

    if (!itemSeparacao) {
      return reply.status(404).send({ message: 'Item de separação não encontrado' })
    }

    // Buscar dados do produto esperado
    const produtoEsperado = await prisma.produto.findUnique({
      where: { id: itemSeparacao.produtoId },
      select: { id: true, nome: true, codigo: true, cEAN: true },
    })

    if (!produtoEsperado) {
      return reply.status(404).send({ message: 'Produto esperado não encontrado' })
    }

    // Buscar EAN do produto via Sku
    const ean = await buscarEanProduto(produtoEsperado.id)

    // Buscar produto pelo barcode escaneado
    const produtoEscaneado = await buscarProdutoPorBarcode(body.barcodeEscaneado)

    const valido = produtoEscaneado?.id === produtoEsperado.id

    return {
      valido,
      produtoEsperado: {
        id: produtoEsperado.id,
        nome: produtoEsperado.nome,
        codigo: produtoEsperado.codigo,
        ean: ean ?? produtoEsperado.cEAN ?? null,
      },
      barcodeEscaneado: body.barcodeEscaneado,
      mensagem: valido
        ? undefined
        : `Produto incorreto. Esperado: ${produtoEsperado.codigo} - ${produtoEsperado.nome}`,
    }
  })

  // ==========================================================================
  // CONFIRMAÇÃO
  // ==========================================================================

  // POST /confirmar-separacao — Confirma item separado via scanner
  app.post('/confirmar-separacao', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = confirmarSeparacaoSchema.parse(request.body)

    // Buscar o ItemSeparacao
    const itemSeparacao = await prisma.itemSeparacao.findUnique({
      where: { id: body.itemSeparacaoId },
      select: {
        id: true,
        produtoId: true,
        quantidadeSolicitada: true,
        quantidadeSeparada: true,
        status: true,
      },
    })

    if (!itemSeparacao) {
      return reply.status(404).send({ message: 'Item de separação não encontrado' })
    }

    // Validar que o barcode corresponde ao produto do item
    const produtoEscaneado = await buscarProdutoPorBarcode(body.barcodeEscaneado)

    if (!produtoEscaneado || produtoEscaneado.id !== itemSeparacao.produtoId) {
      return reply.status(422).send({
        message: 'Barcode escaneado não corresponde ao produto esperado para este item',
      })
    }

    // Se quantidade separada < solicitada, exigir motivo de divergência
    const quantidadeSolicitada = Number(itemSeparacao.quantidadeSolicitada)
    if (body.quantidadeSeparada < quantidadeSolicitada && !body.motivoDivergencia) {
      return reply.status(422).send({
        message:
          'Quantidade separada menor que a solicitada. Informe o motivo da divergência (PRODUTO_NAO_ENCONTRADO, QUANTIDADE_INSUFICIENTE ou AVARIA)',
      })
    }

    // Determinar status do item
    const status =
      body.quantidadeSeparada >= quantidadeSolicitada ? 'SEPARADO' : 'SEPARADO_PARCIAL'

    // Atualizar ItemSeparacao
    const itemAtualizado = await prisma.itemSeparacao.update({
      where: { id: body.itemSeparacaoId },
      data: {
        quantidadeSeparada: body.quantidadeSeparada,
        separadoEm: new Date(),
        status,
        motivoDivergencia: body.motivoDivergencia ?? null,
      },
    })

    // Registrar auditoria
    await registrarAudit(user.empresaId, user.id, {
      entidade: 'SEPARACAO',
      entidadeId: body.itemSeparacaoId,
      acao: 'ATUALIZAR',
      descricao: `Item separado via scanner: ${body.quantidadeSeparada}/${quantidadeSolicitada}${body.motivoDivergencia ? ` (${body.motivoDivergencia})` : ''}`,
      dados: {
        itemSeparacaoId: body.itemSeparacaoId,
        barcodeEscaneado: body.barcodeEscaneado,
        quantidadeSeparada: body.quantidadeSeparada,
        quantidadeSolicitada,
        status,
        motivoDivergencia: body.motivoDivergencia,
      },
    })

    return itemAtualizado
  })

  // POST /confirmar-embalagem — Vincula item ao volume via scanner
  app.post('/confirmar-embalagem', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = confirmarEmbalagemSchema.parse(request.body)

    // Buscar o volume para obter a ondaSeparacaoId
    const volume = await prisma.volume.findUnique({
      where: { id: body.volumeId },
      select: { id: true, ondaSeparacaoId: true },
    })

    if (!volume) {
      return reply.status(404).send({ message: 'Volume não encontrado' })
    }

    // Buscar produto pelo barcode escaneado
    const produtoEscaneado = await buscarProdutoPorBarcode(body.barcodeEscaneado)

    if (!produtoEscaneado) {
      return reply.status(422).send({
        message: 'Produto não encontrado para o barcode escaneado',
      })
    }

    // Validar que o produto pertence à mesma OndaSeparacao do volume
    // Buscar itens de separação da onda que correspondem ao produto escaneado
    const itemSeparacao = await prisma.itemSeparacao.findFirst({
      where: {
        produtoId: produtoEscaneado.id,
        ordemSeparacao: {
          ondaSeparacaoId: volume.ondaSeparacaoId,
        },
      },
      select: { id: true, produtoId: true },
    })

    if (!itemSeparacao) {
      return reply.status(422).send({
        message:
          'Produto não pertence à mesma onda de separação do volume. Verifique o volume ou o produto escaneado.',
      })
    }

    // Criar ItemVolume vinculando o item ao volume
    const itemVolume = await prisma.itemVolume.create({
      data: {
        volumeId: body.volumeId,
        itemSeparacaoId: itemSeparacao.id,
        quantidade: body.quantidade,
      },
    })

    // Registrar auditoria
    await registrarAudit(user.empresaId, user.id, {
      entidade: 'VOLUME',
      entidadeId: body.volumeId,
      acao: 'ATUALIZAR',
      descricao: `Item embalado via scanner: produto ${produtoEscaneado.codigo} vinculado ao volume`,
      dados: {
        volumeId: body.volumeId,
        itemSeparacaoId: itemSeparacao.id,
        produtoId: produtoEscaneado.id,
        barcodeEscaneado: body.barcodeEscaneado,
        quantidade: body.quantidade,
      },
    })

    return itemVolume
  })

  // POST /confirmar-carregamento — Confirma volume carregado via scanner
  app.post('/confirmar-carregamento', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = confirmarCarregamentoSchema.parse(request.body)

    // Buscar o volume pelo barcode (código do volume)
    // O barcode do volume é o campo `codigo` do Volume, convertido para string
    const volumeCode = parseInt(body.barcodeVolume, 10)

    let carregamentoVolume: {
      id: string
      carregamentoId: string
      volumeId: string
      sequencia: number
      carregadoEm: Date | null
      volume: { id: string; codigo: number; ondaSeparacaoId: string }
    } | null = null

    if (!isNaN(volumeCode)) {
      // Buscar CarregamentoVolume pelo código numérico do volume
      carregamentoVolume = await prisma.carregamentoVolume.findFirst({
        where: {
          carregamentoId: body.carregamentoId,
          volume: { codigo: volumeCode },
        },
        include: {
          volume: { select: { id: true, codigo: true, ondaSeparacaoId: true } },
        },
      })
    }

    // Se não encontrou por código numérico, tentar pelo ID do volume
    if (!carregamentoVolume) {
      carregamentoVolume = await prisma.carregamentoVolume.findFirst({
        where: {
          carregamentoId: body.carregamentoId,
          volumeId: body.barcodeVolume,
        },
        include: {
          volume: { select: { id: true, codigo: true, ondaSeparacaoId: true } },
        },
      })
    }

    if (!carregamentoVolume) {
      return reply.status(422).send({
        message:
          'Volume não pertence a este carregamento. Verifique o código do volume e o carregamento.',
      })
    }

    // Verificar se já foi carregado
    if (carregamentoVolume.carregadoEm) {
      return reply.status(422).send({
        message: `Volume ${carregamentoVolume.volume.codigo} já foi carregado em ${carregamentoVolume.carregadoEm.toISOString()}`,
      })
    }

    // Verificar sequência — encontrar o próximo volume esperado na sequência
    const proximoNaSequencia = await prisma.carregamentoVolume.findFirst({
      where: {
        carregamentoId: body.carregamentoId,
        carregadoEm: null,
      },
      orderBy: { sequencia: 'asc' },
      select: { id: true, sequencia: true, volumeId: true },
    })

    let avisoSequencia: string | undefined
    if (
      proximoNaSequencia &&
      proximoNaSequencia.id !== carregamentoVolume.id
    ) {
      avisoSequencia = `Volume fora de sequência. Sequência esperada: ${proximoNaSequencia.sequencia}. Sequência deste volume: ${carregamentoVolume.sequencia}.`
    }

    // Registrar timestamp de carregamento
    const carregamentoVolumeAtualizado = await prisma.carregamentoVolume.update({
      where: { id: carregamentoVolume.id },
      data: { carregadoEm: new Date() },
    })

    // Registrar auditoria
    await registrarAudit(user.empresaId, user.id, {
      entidade: 'CARREGAMENTO',
      entidadeId: body.carregamentoId,
      acao: 'ATUALIZAR',
      descricao: `Volume ${carregamentoVolume.volume.codigo} carregado via scanner${avisoSequencia ? ' (fora de sequência)' : ''}`,
      dados: {
        carregamentoId: body.carregamentoId,
        volumeId: carregamentoVolume.volumeId,
        volumeCodigo: carregamentoVolume.volume.codigo,
        sequencia: carregamentoVolume.sequencia,
        barcodeVolume: body.barcodeVolume,
        foraDeSequencia: !!avisoSequencia,
      },
    })

    return {
      ...carregamentoVolumeAtualizado,
      volumeCodigo: carregamentoVolume.volume.codigo,
      avisoSequencia,
    }
  })
}
