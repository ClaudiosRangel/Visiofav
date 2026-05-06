import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { ValidacaoLocalizacaoService } from '../scanner/validacao-localizacao.service'
import { registrarAudit } from '../auditoria/auditoria.routes'
import { FichaService } from '../ficha-operacional/ficha.service'
import { SugestaoEnderecoService } from './sugestao-endereco.service'
import { ValidadorCapacidade } from '../endereco/validador-capacidade.service'
import type { ItemNotaEntrada, Produto } from '@prisma/client'
import crypto from 'node:crypto'

const idParamsSchema = z.object({ id: z.string().uuid() })

const enderecamentoManualSchema = z.object({
  produtoId: z.string().uuid(),
  enderecoId: z.string().uuid(),
  quantidade: z.number().positive(),
  lote: z.string().optional(),
  validade: z.string().optional(),
  funcionarioId: z.string().uuid().optional(),
})

export async function enderecamentoWmsRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // GET /notas-conferidas — notas conferidas pendentes de endereçamento
  app.get('/notas-conferidas', async () => {
    const notas = await prisma.notaEntrada.findMany({
      where: { status: 'CONFERIDA' },
      orderBy: { criadoEm: 'desc' },
      include: { itens: true },
    })
    return notas
  })

  // POST /sugerir — endereçamento automático: sugere endereço para um produto
  app.post('/sugerir', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { produtoId, quantidade } = z.object({
      produtoId: z.string().uuid(),
      quantidade: z.number().positive(),
    }).parse(request.body)

    // Regra 1: Verificar se o produto já está em algum endereço (consolidar)
    const saldoExistente = await prisma.saldoEndereco.findFirst({
      where: { produtoId, quantidade: { gt: 0 } },
      include: { endereco: true },
      orderBy: { atualizadoEm: 'desc' },
    })

    if (saldoExistente) {
      return {
        sugestao: 'CONSOLIDAR',
        enderecoId: saldoExistente.enderecoId,
        enderecoCompleto: saldoExistente.endereco.enderecoCompleto,
        motivo: `Produto já existe neste endereço (saldo: ${Number(saldoExistente.quantidade)})`,
        rua: saldoExistente.endereco.codigoRua,
        predio: saldoExistente.endereco.codigoPredio,
        nivel: saldoExistente.endereco.codigoNivel,
        apto: saldoExistente.endereco.codigoApto,
      }
    }

    // Regra 2: Buscar endereço livre mais próximo (FIFO por rua/prédio)
    const enderecoLivre = await prisma.endereco.findFirst({
      where: {
        tipo: { in: ['ARMAZENAGEM', 'LIVRE'] },
        status: true,
        saldos: { none: { quantidade: { gt: 0 } } },
      },
      orderBy: [{ codigoRua: 'asc' }, { codigoPredio: 'asc' }, { codigoNivel: 'asc' }, { codigoApto: 'asc' }],
    })

    if (enderecoLivre) {
      return {
        sugestao: 'ENDERECO_LIVRE',
        enderecoId: enderecoLivre.id,
        enderecoCompleto: enderecoLivre.enderecoCompleto,
        motivo: 'Primeiro endereço livre disponível',
        rua: enderecoLivre.codigoRua,
        predio: enderecoLivre.codigoPredio,
        nivel: enderecoLivre.codigoNivel,
        apto: enderecoLivre.codigoApto,
      }
    }

    return reply.status(422).send({ message: 'Nenhum endereço disponível para armazenagem' })
  })

  // POST /confirmar — confirma endereçamento (manual ou automático)
  app.post('/confirmar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = enderecamentoManualSchema.parse(request.body)

    // Verificar se endereço existe
    const endereco = await prisma.endereco.findUnique({ where: { id: body.enderecoId }, include: { estrutura: true } })
    if (!endereco) return reply.status(404).send({ message: 'Endereço não encontrado' })

    // Verificar se produto existe
    const produto = await prisma.produto.findFirst({ where: { id: body.produtoId, empresaId: user.empresaId } })
    if (!produto) return reply.status(404).send({ message: 'Produto não encontrado' })

    // Validate capacity if address has an associated Estrutura
    if (endereco.estruturaId) {
      const validador = new ValidadorCapacidade()
      const capacityResult = await validador.validar({
        enderecoId: body.enderecoId,
        produtoId: body.produtoId,
        quantidade: body.quantidade,
      })
      if (!capacityResult.permitido) {
        return reply.status(422).send({ message: capacityResult.motivo || 'Capacidade excedida' })
      }
    }

    await prisma.$transaction(async (tx) => {
      // Upsert saldo no endereço
      const saldoExistente = await tx.saldoEndereco.findFirst({
        where: { enderecoId: body.enderecoId, produtoId: body.produtoId, lote: body.lote || null },
      })

      if (saldoExistente) {
        await tx.saldoEndereco.update({
          where: { id: saldoExistente.id },
          data: { quantidade: { increment: body.quantidade } },
        })
      } else {
        await tx.saldoEndereco.create({
          data: {
            enderecoId: body.enderecoId,
            produtoId: body.produtoId,
            quantidade: body.quantidade,
            lote: body.lote,
            validade: body.validade ? new Date(body.validade) : undefined,
          },
        })
      }

      // Atualizar estoque consolidado
      await tx.estoque.upsert({
        where: { empresaId_produtoId: { empresaId: user.empresaId, produtoId: body.produtoId } },
        update: { quantidade: { increment: body.quantidade } },
        create: { empresaId: user.empresaId, produtoId: body.produtoId, quantidade: body.quantidade },
      })

      // Atualizar tipo do endereço para ARMAZENAGEM se estava LIVRE
      if (endereco.tipo === 'LIVRE') {
        await tx.endereco.update({ where: { id: body.enderecoId }, data: { tipo: 'ARMAZENAGEM' } })
      }
    })

    return {
      message: 'Endereçamento confirmado',
      enderecoCompleto: endereco.enderecoCompleto,
      produto: produto.nome,
      quantidade: body.quantidade,
    }
  })

  // GET /enderecos-disponiveis — lista endereços disponíveis para endereçamento
  app.get('/enderecos-disponiveis', async (request) => {
    const { rua } = z.object({ rua: z.string().optional() }).parse(request.query)

    const where: any = {
      tipo: { in: ['ARMAZENAGEM', 'LIVRE'] },
      status: true,
    }
    if (rua) where.codigoRua = rua

    const enderecos = await prisma.endereco.findMany({
      where,
      orderBy: [{ codigoRua: 'asc' }, { codigoPredio: 'asc' }, { codigoNivel: 'asc' }, { codigoApto: 'asc' }],
      include: {
        saldos: { where: { quantidade: { gt: 0 } }, select: { produtoId: true, quantidade: true } },
      },
    })

    return enderecos.map((e) => ({
      id: e.id,
      enderecoCompleto: e.enderecoCompleto,
      rua: e.codigoRua,
      predio: e.codigoPredio,
      nivel: e.codigoNivel,
      apto: e.codigoApto,
      tipo: e.tipo,
      ocupado: e.saldos.length > 0,
      totalProdutos: e.saldos.length,
    }))
  })

  // ── Coletor mode: location validation by barcode ──────────────────────

  // Simple endpoint for app: scan barcode → find address
  const buscarEnderecoPorBarcodeSchema = z.object({
    barcode: z.string().min(1),
    notaEntradaId: z.string().uuid().optional(),
  })

  app.post('/buscar-endereco-barcode', async (request) => {
    const body = buscarEnderecoPorBarcodeSchema.parse(request.body)

    // Try to find address by enderecoCompleto (with or without separators)
    const barcodeClean = body.barcode.replace(/[^A-Za-z0-9]/g, '')

    // Search by exact match or by cleaned barcode
    let endereco = await prisma.endereco.findFirst({
      where: { enderecoCompleto: body.barcode, status: true },
    })

    if (!endereco) {
      // Try matching by removing separators from enderecoCompleto
      const allEnderecos = await prisma.endereco.findMany({
        where: { status: true, tipo: { in: ['ARMAZENAGEM', 'LIVRE'] } },
      })
      endereco = allEnderecos.find((e) =>
        (e.enderecoCompleto || '').replace(/[^A-Za-z0-9]/g, '') === barcodeClean
      ) || null
    }

    if (!endereco) {
      // Try by codigoBarras field
      endereco = await prisma.endereco.findFirst({
        where: { codigoBarras: body.barcode, status: true },
      })
    }

    if (endereco) {
      return {
        valido: true,
        endereco: { id: endereco.id, enderecoCompleto: endereco.enderecoCompleto },
      }
    }

    return {
      valido: false,
      mensagem: `Endereço não encontrado para o código: ${body.barcode}`,
    }
  })

  // Simple endpoint for app: scan product barcode → find product in nota
  const buscarProdutoPorBarcodeSchema = z.object({
    barcode: z.string().min(1),
    notaEntradaId: z.string().uuid(),
  })

  app.post('/buscar-produto-barcode', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = buscarProdutoPorBarcodeSchema.parse(request.body)

    const nota = await prisma.notaEntrada.findUnique({
      where: { id: body.notaEntradaId },
      include: { itens: true },
    })

    if (!nota) return reply.status(404).send({ message: 'Nota não encontrada' })

    // Try to find product by codigo or EAN
    let produto = await prisma.produto.findFirst({
      where: { empresaId: user.empresaId, codigo: body.barcode },
    })

    if (!produto) {
      produto = await prisma.produto.findFirst({
        where: { empresaId: user.empresaId, cEAN: body.barcode },
      })
    }

    if (!produto) {
      // Try matching item by codigoProduto
      const item = nota.itens.find((i) => i.codigoProduto === body.barcode)
      if (item?.codigoProduto) {
        produto = await prisma.produto.findFirst({
          where: { empresaId: user.empresaId, codigo: item.codigoProduto },
        })
      }
    }

    if (produto) {
      return {
        valido: true,
        produtoEsperado: { id: produto.id, nome: produto.nome, codigo: produto.codigo, ean: produto.cEAN },
        barcodeEscaneado: body.barcode,
      }
    }

    return {
      valido: false,
      produtoEsperado: null,
      barcodeEscaneado: body.barcode,
      mensagem: `Produto não encontrado para o código: ${body.barcode}`,
    }
  })

  const validarLocalizacaoEnderecamentoSchema = z.object({
    barcodeEscaneado: z.string().min(1),
    enderecoDestinoId: z.string().uuid(),
  })

  app.post('/validar-localizacao', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const body = validarLocalizacaoEnderecamentoSchema.parse(request.body)

    const validacaoService = new ValidacaoLocalizacaoService()
    const result = await validacaoService.validar(
      body.barcodeEscaneado,
      body.enderecoDestinoId,
      'enderecamento', // reference id
      user.empresaId,
      user.id,
    )

    return result
  })

  // ── Coletor mode: product barcode validation against nota de entrada item ──

  const validarProdutoEnderecamentoSchema = z.object({
    barcodeEscaneado: z.string().min(1),
    notaEntradaItemId: z.string().uuid(),
  })

  app.post('/validar-produto', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = validarProdutoEnderecamentoSchema.parse(request.body)

    // Buscar item da nota de entrada
    const item = await prisma.itemNotaEntrada.findUnique({
      where: { id: body.notaEntradaItemId },
      include: { produto: true },
    })

    if (!item) {
      return reply.status(404).send({ message: 'Item da nota de entrada não encontrado' })
    }

    // Buscar EAN do produto via Sku
    const sku = await prisma.sku.findFirst({
      where: { produtoId: item.produtoId },
      select: { ean: true },
    })

    const ean = sku?.ean || null
    const codigoProduto = item.produto?.codigo || ''

    const valido = body.barcodeEscaneado === ean || body.barcodeEscaneado === codigoProduto

    return {
      valido,
      produtoEsperado: {
        id: item.produtoId,
        nome: item.produto?.nome || '',
        codigo: codigoProduto,
        ean,
      },
      barcodeEscaneado: body.barcodeEscaneado,
      mensagem: valido ? undefined : `Produto incorreto. Esperado: ${item.produto?.nome || codigoProduto}`,
    }
  })

  // ── Confirmar endereçamento via coletor com log de movimentação ──────

  const confirmarColetorSchema = z.object({
    produtoId: z.string().uuid(),
    enderecoId: z.string().uuid(),
    quantidade: z.number().positive(),
    lote: z.string().optional(),
    validade: z.string().optional(),
  })

  app.post('/confirmar-coletor', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = confirmarColetorSchema.parse(request.body)

    const endereco = await prisma.endereco.findUnique({ where: { id: body.enderecoId }, include: { estrutura: true } })
    if (!endereco) return reply.status(404).send({ message: 'Endereço não encontrado' })

    const produto = await prisma.produto.findFirst({ where: { id: body.produtoId, empresaId: user.empresaId } })
    if (!produto) return reply.status(404).send({ message: 'Produto não encontrado' })

    // Validate capacity if address has an associated Estrutura
    if (endereco.estruturaId) {
      const validador = new ValidadorCapacidade()
      const capacityResult = await validador.validar({
        enderecoId: body.enderecoId,
        produtoId: body.produtoId,
        quantidade: body.quantidade,
      })
      if (!capacityResult.permitido) {
        return reply.status(422).send({ message: capacityResult.motivo || 'Capacidade excedida' })
      }
    }

    await prisma.$transaction(async (tx) => {
      // Upsert saldo no endereço
      const saldoExistente = await tx.saldoEndereco.findFirst({
        where: { enderecoId: body.enderecoId, produtoId: body.produtoId, lote: body.lote || null },
      })

      const saldoAnterior = saldoExistente ? Number(saldoExistente.quantidade) : 0
      const saldoNovo = saldoAnterior + body.quantidade

      if (saldoExistente) {
        await tx.saldoEndereco.update({
          where: { id: saldoExistente.id },
          data: { quantidade: { increment: body.quantidade } },
        })
      } else {
        await tx.saldoEndereco.create({
          data: {
            enderecoId: body.enderecoId,
            produtoId: body.produtoId,
            quantidade: body.quantidade,
            lote: body.lote,
            validade: body.validade ? new Date(body.validade) : undefined,
          },
        })
      }

      // Atualizar estoque consolidado
      await tx.estoque.upsert({
        where: { empresaId_produtoId: { empresaId: user.empresaId, produtoId: body.produtoId } },
        update: { quantidade: { increment: body.quantidade } },
        create: { empresaId: user.empresaId, produtoId: body.produtoId, quantidade: body.quantidade },
      })

      // Atualizar tipo do endereço para ARMAZENAGEM se estava LIVRE
      if (endereco.tipo === 'LIVRE') {
        await tx.endereco.update({ where: { id: body.enderecoId }, data: { tipo: 'ARMAZENAGEM' } })
      }

      // Registrar movimento no LogMovimentacao com tipo ENDERECAMENTO
      await tx.logMovimentacao.create({
        data: {
          empresaId: user.empresaId,
          produtoId: body.produtoId,
          enderecoId: body.enderecoId,
          tipo: 'ENDERECAMENTO',
          quantidade: body.quantidade,
          saldoAnterior,
          saldoNovo,
          motivo: `Endereçamento via coletor — ${endereco.enderecoCompleto}`,
          usuarioId: user.id,
        },
      })
    })

    // Registrar auditoria
    await registrarAudit(user.empresaId, user.id, {
      entidade: 'ENDERECAMENTO',
      entidadeId: body.enderecoId,
      acao: 'CONFIRMAR_COLETOR',
      detalhes: {
        produtoId: body.produtoId,
        enderecoId: body.enderecoId,
        quantidade: body.quantidade,
        enderecoCompleto: endereco.enderecoCompleto,
      },
    })

    return {
      message: 'Endereçamento confirmado via coletor',
      enderecoCompleto: endereco.enderecoCompleto,
      produto: produto.nome,
      quantidade: body.quantidade,
    }
  })

  // ── Ficha de endereçamento: gerar ficha com campos em branco ──────────

  const gerarFichaEnderecamentoSchema = z.object({
    notaEntradaId: z.string().uuid(),
  })

  app.post('/gerar-ficha', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = gerarFichaEnderecamentoSchema.parse(request.body)

    // Buscar nota de entrada com itens
    const nota = await prisma.notaEntrada.findFirst({
      where: { id: body.notaEntradaId },
      include: { itens: true },
    })

    if (!nota) return reply.status(404).send({ message: 'Nota de entrada não encontrada' })

    // Gerar código de barras único
    const codigoBarras = `END-${crypto.randomUUID().slice(0, 8).toUpperCase()}`

    // Criar ficha operacional
    const ficha = await prisma.fichaOperacional.create({
      data: {
        empresaId: user.empresaId,
        tipo: 'ENDERECAMENTO',
        referenciaId: body.notaEntradaId,
        codigoBarras,
        status: 'GERADA',
      },
    })

    return {
      id: ficha.id,
      codigoBarras: ficha.codigoBarras,
      tipo: ficha.tipo,
      status: ficha.status,
    }
  })

  // ── Ficha de endereçamento: HTML para impressão ──────────────────────

  app.get('/ficha/:id/html', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const ficha = await prisma.fichaOperacional.findFirst({
      where: { id, empresaId: user.empresaId, tipo: 'ENDERECAMENTO' },
    })

    if (!ficha) return reply.status(404).send({ message: 'Ficha não encontrada' })

    // Buscar nota de entrada com itens
    const nota = await prisma.notaEntrada.findFirst({
      where: { id: ficha.referenciaId },
      include: { itens: true },
    })

    if (!nota) return reply.status(404).send({ message: 'Nota de entrada não encontrada' })

    const fichaService = new FichaService()
    const html = fichaService.gerarHtmlEnderecamento(nota as any)

    // Atualizar status para IMPRESSA
    await prisma.fichaOperacional.update({
      where: { id: ficha.id },
      data: { status: 'IMPRESSA' },
    })

    reply.type('text/html').send(html)
  })

  // ── OCR processing for addressing sheet ──────────────────────────────

  const processarOcrEnderecamentoSchema = z.object({
    fichaId: z.string().uuid(),
    enderecos: z.array(z.object({
      itemId: z.string().uuid(),
      enderecoCompleto: z.string().min(1),
    })),
  })

  app.post('/processar-ocr', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = processarOcrEnderecamentoSchema.parse(request.body)

    const ficha = await prisma.fichaOperacional.findFirst({
      where: { id: body.fichaId, empresaId: user.empresaId, tipo: 'ENDERECAMENTO' },
    })

    if (!ficha) return reply.status(404).send({ message: 'Ficha não encontrada' })

    // Validate each address
    const resultados = []
    for (const item of body.enderecos) {
      const endereco = await prisma.endereco.findFirst({
        where: { enderecoCompleto: item.enderecoCompleto },
      })

      resultados.push({
        itemId: item.itemId,
        enderecoCompleto: item.enderecoCompleto,
        enderecoId: endereco?.id || null,
        valido: !!endereco,
        mensagem: endereco ? undefined : `Endereço "${item.enderecoCompleto}" não encontrado`,
      })
    }

    // Update ficha with OCR data
    await prisma.fichaOperacional.update({
      where: { id: ficha.id },
      data: {
        dadosOcr: JSON.stringify(resultados),
        status: 'DIGITALIZADA',
        origemDados: 'OCR',
      },
    })

    return { fichaId: ficha.id, resultados }
  })

  // ── Batch suggestion: suggest addresses for all items of a nota ──────

  const sugerirLoteQuerySchema = z.object({
    notaEntradaId: z.string().uuid(),
  })

  app.get('/sugerir-lote', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { notaEntradaId } = sugerirLoteQuerySchema.parse(request.query)

    // Validate nota exists and has status CONFERIDA
    const nota = await prisma.notaEntrada.findFirst({
      where: { id: notaEntradaId },
      include: { itens: true },
    })

    if (!nota) {
      return reply.status(404).send({ message: 'Nota de entrada não encontrada' })
    }

    if (nota.status !== 'CONFERIDA') {
      return reply.status(422).send({
        message: `Nota de entrada não está com status CONFERIDA (status atual: ${nota.status})`,
      })
    }

    // Map codigoProduto → Produto.id for each item
    const itensComProduto: Array<{ item: ItemNotaEntrada; produto: Produto | null }> = []
    for (const item of nota.itens) {
      let produto = null
      if (item.codigoProduto) {
        produto = await prisma.produto.findFirst({
          where: { codigo: item.codigoProduto, empresaId: user.empresaId },
        })
      }

      itensComProduto.push({
        item,
        produto,
      })
    }

    // Build input for sugerirLote
    const sugestaoService = new SugestaoEnderecoService()
    const itensParaSugestao = itensComProduto
      .filter((i) => i.produto !== null)
      .map((i) => ({
        itemId: i.item.id,
        produtoId: i.produto!.id,
        quantidade: Number(i.item.quantidade),
        lote: i.item.lote ?? undefined,
        validade: i.item.validade ?? undefined,
      }))

    const sugestoes = await sugestaoService.sugerirLote(itensParaSugestao, user.empresaId)

    // Build response
    const resultado = nota.itens.map((item) => {
      const produtoInfo = itensComProduto.find((i) => i.item.id === item.id)
      return {
        itemId: item.id,
        produtoId: produtoInfo?.produto?.id ?? null,
        produtoCodigo: item.codigoProduto ?? '',
        produtoNome: produtoInfo?.produto?.nome ?? item.descricao,
        quantidade: Number(item.quantidade),
        lote: item.lote ?? null,
        validade: item.validade?.toISOString() ?? null,
        sugestao: sugestoes.get(item.id) ?? null,
      }
    })

    return { sugestoes: resultado }
  })

  // ── Batch addressing confirmation ────────────────────────────────────

  const confirmarLoteSchema = z.object({
    notaEntradaId: z.string().uuid(),
    itens: z.array(
      z.object({
        itemNotaEntradaId: z.string().uuid(),
        produtoId: z.string().uuid(),
        enderecoId: z.string().uuid(),
        quantidade: z.number().positive(),
        lote: z.string().optional(),
        validade: z.string().optional(),
      }),
    ).min(1),
  })

  app.post('/confirmar-lote', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = confirmarLoteSchema.parse(request.body)

    // Validate nota exists
    const nota = await prisma.notaEntrada.findFirst({
      where: { id: body.notaEntradaId },
    })

    if (!nota) {
      return reply.status(404).send({ message: 'Nota de entrada não encontrada' })
    }

    const etiquetas: Array<{ itemId: string; enderecoCompleto: string; produtoNome: string; quantidade: number; lote: string | null; validade: string | null }> = []

    // Validate capacity for all items before starting the transaction
    const validador = new ValidadorCapacidade()
    for (const item of body.itens) {
      const enderecoCheck = await prisma.endereco.findUnique({
        where: { id: item.enderecoId },
        select: { estruturaId: true },
      })
      if (enderecoCheck?.estruturaId) {
        const capacityResult = await validador.validar({
          enderecoId: item.enderecoId,
          produtoId: item.produtoId,
          quantidade: item.quantidade,
        })
        if (!capacityResult.permitido) {
          return reply.status(422).send({ message: capacityResult.motivo || 'Capacidade excedida' })
        }
      }
    }

    await prisma.$transaction(async (tx) => {
      // 1. Validate all addresses exist and are available
      for (const item of body.itens) {
        const endereco = await tx.endereco.findFirst({
          where: {
            id: item.enderecoId,
            status: true,
            tipo: { in: ['ARMAZENAGEM', 'LIVRE'] },
          },
        })

        if (!endereco) {
          throw new Error(`Endereço ${item.enderecoId} não encontrado ou não disponível para armazenagem`)
        }
      }

      // 2. For each item: upsert SaldoEndereco, upsert Estoque, create LogMovimentacao
      for (const item of body.itens) {
        const endereco = await tx.endereco.findUnique({ where: { id: item.enderecoId } })
        const produto = await tx.produto.findFirst({ where: { id: item.produtoId, empresaId: user.empresaId } })

        if (!produto) {
          throw new Error(`Produto ${item.produtoId} não encontrado`)
        }

        // Upsert SaldoEndereco
        const saldoExistente = await tx.saldoEndereco.findFirst({
          where: { enderecoId: item.enderecoId, produtoId: item.produtoId, lote: item.lote || null },
        })

        const saldoAnterior = saldoExistente ? Number(saldoExistente.quantidade) : 0
        const saldoNovo = saldoAnterior + item.quantidade

        if (saldoExistente) {
          await tx.saldoEndereco.update({
            where: { id: saldoExistente.id },
            data: { quantidade: { increment: item.quantidade } },
          })
        } else {
          await tx.saldoEndereco.create({
            data: {
              enderecoId: item.enderecoId,
              produtoId: item.produtoId,
              quantidade: item.quantidade,
              lote: item.lote,
              validade: item.validade ? new Date(item.validade) : undefined,
            },
          })
        }

        // Upsert Estoque
        await tx.estoque.upsert({
          where: { empresaId_produtoId: { empresaId: user.empresaId, produtoId: item.produtoId } },
          update: { quantidade: { increment: item.quantidade } },
          create: { empresaId: user.empresaId, produtoId: item.produtoId, quantidade: item.quantidade },
        })

        // Create LogMovimentacao
        await tx.logMovimentacao.create({
          data: {
            empresaId: user.empresaId,
            produtoId: item.produtoId,
            enderecoId: item.enderecoId,
            tipo: 'ENDERECAMENTO',
            quantidade: item.quantidade,
            saldoAnterior,
            saldoNovo,
            motivo: `Endereçamento em lote — ${endereco?.enderecoCompleto ?? item.enderecoId}`,
            usuarioId: user.id,
          },
        })

        // Update address type if LIVRE
        if (endereco?.tipo === 'LIVRE') {
          await tx.endereco.update({ where: { id: item.enderecoId }, data: { tipo: 'ARMAZENAGEM' } })
        }

        etiquetas.push({
          itemId: item.itemNotaEntradaId,
          enderecoCompleto: endereco?.enderecoCompleto ?? '',
          produtoNome: produto.nome,
          quantidade: item.quantidade,
          lote: item.lote ?? null,
          validade: item.validade ?? null,
        })
      }

      // 3. Update NotaEntrada status to ENDERECADA
      await tx.notaEntrada.update({
        where: { id: body.notaEntradaId },
        data: { status: 'ENDERECADA' },
      })

      // 4. Close OrdemServicoWms (operacao=ENDERECAMENTO) with status CONCLUIDO
      const ordemServico = await tx.ordemServicoWms.findFirst({
        where: {
          notaEntradaId: body.notaEntradaId,
          operacao: 'ENDERECAMENTO',
          status: { not: 'CONCLUIDO' },
        },
      })

      if (ordemServico) {
        await tx.ordemServicoWms.update({
          where: { id: ordemServico.id },
          data: {
            status: 'CONCLUIDO',
            horaFim: new Date(),
          },
        })
      }
    })

    return {
      message: 'Endereçamento em lote confirmado',
      itensEnderecados: body.itens.length,
      etiquetas,
    }
  })

  // ── Addressing progress for a nota ───────────────────────────────────

  const progressoParamsSchema = z.object({
    notaEntradaId: z.string().uuid(),
  })

  app.get('/progresso/:notaEntradaId', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { notaEntradaId } = progressoParamsSchema.parse(request.params)

    // Fetch nota with items
    const nota = await prisma.notaEntrada.findFirst({
      where: { id: notaEntradaId },
      include: { itens: true },
    })

    if (!nota) {
      return reply.status(404).send({ message: 'Nota de entrada não encontrada' })
    }

    // For each item, check if a SaldoEndereco exists via Produto.codigo mapping
    const itensProgresso = []
    let itensEnderecados = 0

    for (const item of nota.itens) {
      let enderecoDestino: string | null = null
      let enderecado = false

      if (item.codigoProduto) {
        const produto = await prisma.produto.findFirst({
          where: { codigo: item.codigoProduto, empresaId: user.empresaId },
        })

        if (produto) {
          const saldo = await prisma.saldoEndereco.findFirst({
            where: { produtoId: produto.id, quantidade: { gt: 0 } },
            include: { endereco: true },
          })

          if (saldo) {
            enderecado = true
            enderecoDestino = saldo.endereco.enderecoCompleto ?? null
          }
        }
      }

      if (enderecado) itensEnderecados++

      itensProgresso.push({
        itemId: item.id,
        item: item.item,
        codigoProduto: item.codigoProduto ?? '',
        descricao: item.descricao,
        quantidade: Number(item.quantidade),
        lote: item.lote ?? null,
        validade: item.validade?.toISOString() ?? null,
        enderecoDestino,
        status: enderecado ? 'ENDERECADO' : 'PENDENTE',
      })
    }

    const totalItens = nota.itens.length
    const percentual = totalItens > 0 ? (itensEnderecados / totalItens) * 100 : 0

    return {
      notaEntradaId,
      totalItens,
      itensEnderecados,
      percentual,
      itens: itensProgresso,
    }
  })

  // ── Address validation ───────────────────────────────────────────────

  const validarEnderecoSchema = z.object({
    enderecoId: z.string().uuid(),
  })

  app.post('/validar-endereco', async (request) => {
    const body = validarEnderecoSchema.parse(request.body)

    const endereco = await prisma.endereco.findUnique({
      where: { id: body.enderecoId },
    })

    if (!endereco) {
      return {
        valido: false,
        mensagem: 'Endereço não encontrado',
      }
    }

    if (!endereco.status) {
      return {
        valido: false,
        endereco: {
          id: endereco.id,
          enderecoCompleto: endereco.enderecoCompleto,
          tipo: endereco.tipo,
          rua: endereco.codigoRua,
          predio: endereco.codigoPredio,
          nivel: endereco.codigoNivel,
        },
        mensagem: 'Endereço está inativo',
      }
    }

    if (!['ARMAZENAGEM', 'LIVRE'].includes(endereco.tipo)) {
      return {
        valido: false,
        endereco: {
          id: endereco.id,
          enderecoCompleto: endereco.enderecoCompleto,
          tipo: endereco.tipo,
          rua: endereco.codigoRua,
          predio: endereco.codigoPredio,
          nivel: endereco.codigoNivel,
        },
        mensagem: `Tipo de endereço "${endereco.tipo}" não é válido para armazenagem`,
      }
    }

    return {
      valido: true,
      endereco: {
        id: endereco.id,
        enderecoCompleto: endereco.enderecoCompleto,
        tipo: endereco.tipo,
        rua: endereco.codigoRua,
        predio: endereco.codigoPredio,
        nivel: endereco.codigoNivel,
      },
    }
  })
}
