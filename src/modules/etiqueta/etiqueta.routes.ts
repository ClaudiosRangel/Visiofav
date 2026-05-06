import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import bwipjs from 'bwip-js'

const tipoEtiquetaSchema = z.enum(['ENDERECO', 'PRODUTO', 'VOLUME', 'ENDERECO_LOTE'])

export async function etiquetaRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // GET /barcode/:code — gera imagem PNG de código de barras
  app.get('/barcode/:code', async (request, reply) => {
    const { code } = z.object({ code: z.string().min(1) }).parse(request.params)
    const { tipo } = z.object({ tipo: z.enum(['code128', 'ean13', 'qrcode', 'code39']).optional().default('code128') }).parse(request.query)

    try {
      const png = await bwipjs.toBuffer({
        bcid: tipo,
        text: code,
        scale: 3,
        height: 12,
        includetext: true,
        textxalign: 'center',
      })

      reply.header('Content-Type', 'image/png')
      reply.header('Cache-Control', 'public, max-age=86400')
      return reply.send(png)
    } catch (err: any) {
      return reply.status(400).send({ message: `Erro ao gerar código de barras: ${err.message}` })
    }
  })

  // GET /enderecos — lista endereços para impressão de etiquetas
  app.get('/enderecos', async (request) => {
    const q = z.object({
      depositoId: z.string().uuid().optional(),
      rua: z.string().optional(),
      limit: z.coerce.number().default(50),
    }).parse(request.query)

    const where: any = { status: true }
    if (q.rua) where.codigoRua = q.rua

    const enderecos = await prisma.endereco.findMany({
      where,
      take: q.limit,
      orderBy: [{ codigoRua: 'asc' }, { codigoPredio: 'asc' }, { codigoNivel: 'asc' }, { codigoApto: 'asc' }],
    })

    return {
      data: enderecos.map((e) => ({
        id: e.id,
        enderecoCompleto: e.enderecoCompleto,
        rua: e.codigoRua,
        predio: e.codigoPredio,
        nivel: e.codigoNivel,
        apto: e.codigoApto,
        tipo: e.tipo,
      })),
      total: enderecos.length,
    }
  })

  // GET /produtos — lista produtos para impressão de etiquetas
  app.get('/produtos', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const q = z.object({
      search: z.string().optional(),
      limit: z.coerce.number().default(50),
    }).parse(request.query)

    const where: any = { empresaId: user.empresaId, status: true }
    if (q.search) {
      where.OR = [
        { nome: { contains: q.search, mode: 'insensitive' } },
        { codigo: { contains: q.search, mode: 'insensitive' } },
      ]
    }

    const produtos = await prisma.produto.findMany({
      where,
      take: q.limit,
      orderBy: { nome: 'asc' },
    })

    return {
      data: produtos.map((p) => ({
        id: p.id,
        codigo: p.codigo,
        nome: p.nome,
        unidade: p.unidade,
        ean: p.cEAN,
      })),
      total: produtos.length,
    }
  })

  // GET /volumes — lista volumes para impressão de etiquetas
  app.get('/volumes', async (request) => {
    const q = z.object({
      ondaId: z.string().uuid().optional(),
      limit: z.coerce.number().default(50),
    }).parse(request.query)

    const where: any = {}
    if (q.ondaId) where.ondaSeparacaoId = q.ondaId

    const volumes = await prisma.volume.findMany({
      where,
      take: q.limit,
      orderBy: { criadoEm: 'desc' },
      include: { itens: true },
    })

    return {
      data: volumes.map((v) => ({
        id: v.id,
        codigo: v.codigo,
        tipo: v.tipo,
        peso: v.peso ? Number(v.peso) : null,
        status: v.status,
        totalItens: v.itens.length,
      })),
      total: volumes.length,
    }
  })

  // POST /gerar — gera dados para impressão em lote
  app.post('/gerar', async (request, reply) => {
    const body = z.object({
      tipo: tipoEtiquetaSchema,
      ids: z.array(z.string().uuid()).min(1),
      quantidade: z.number().int().positive().default(1), // cópias por etiqueta
    }).parse(request.body)

    const etiquetas: any[] = []

    if (body.tipo === 'ENDERECO') {
      const enderecos = await prisma.endereco.findMany({ where: { id: { in: body.ids } } })
      for (const e of enderecos) {
        for (let i = 0; i < body.quantidade; i++) {
          etiquetas.push({
            tipo: 'ENDERECO',
            codigo: e.enderecoCompleto,
            linha1: e.enderecoCompleto,
            linha2: `Rua ${e.codigoRua} | Prédio ${e.codigoPredio} | Nível ${e.codigoNivel}`,
            linha3: e.tipo,
            barcode: e.enderecoCompleto.replace(/[^A-Za-z0-9]/g, ''),
          })
        }
      }
    }

    if (body.tipo === 'PRODUTO') {
      const user = request.user as { id: string; empresaId: string }
      const produtos = await prisma.produto.findMany({ where: { id: { in: body.ids }, empresaId: user.empresaId } })
      for (const p of produtos) {
        for (let i = 0; i < body.quantidade; i++) {
          etiquetas.push({
            tipo: 'PRODUTO',
            codigo: p.cEAN || p.codigo,
            linha1: p.nome,
            linha2: `Cód: ${p.codigo} | Un: ${p.unidade}`,
            linha3: p.cEAN ? `EAN: ${p.cEAN}` : '',
            barcode: p.cEAN || p.codigo,
          })
        }
      }
    }

    if (body.tipo === 'VOLUME') {
      const volumes = await prisma.volume.findMany({ where: { id: { in: body.ids } }, include: { itens: true } })
      for (const v of volumes) {
        for (let i = 0; i < body.quantidade; i++) {
          etiquetas.push({
            tipo: 'VOLUME',
            codigo: v.codigo,
            linha1: `Volume: ${v.codigo}`,
            linha2: `Tipo: ${v.tipo} | Itens: ${v.itens.length}`,
            linha3: v.peso ? `Peso: ${Number(v.peso)} kg` : '',
            barcode: v.codigo,
          })
        }
      }
    }

    return { etiquetas, total: etiquetas.length }
  })

  // POST /gerar-zpl — gera etiquetas em formato ZPL (impressoras térmicas Zebra)
  app.post('/gerar-zpl', async (request, reply) => {
    const body = z.object({
      tipo: tipoEtiquetaSchema,
      ids: z.array(z.string().uuid()).min(1),
      quantidade: z.number().int().positive().default(1),
      larguraMm: z.number().default(100),
      alturaMm: z.number().default(50),
    }).parse(request.body)

    const zplEtiquetas: string[] = []

    if (body.tipo === 'ENDERECO') {
      const enderecos = await prisma.endereco.findMany({ where: { id: { in: body.ids } } })
      for (const e of enderecos) {
        for (let i = 0; i < body.quantidade; i++) {
          const barcode = (e.enderecoCompleto || '').replace(/[^A-Za-z0-9]/g, '')
          zplEtiquetas.push(
            `^XA\n` +
            `^PW${Math.round(body.larguraMm * 8)}^LL${Math.round(body.alturaMm * 8)}\n` +
            `^FO20,20^A0N,40,40^FD${e.enderecoCompleto}^FS\n` +
            `^FO20,70^A0N,25,25^FDRua ${e.codigoRua} | Predio ${e.codigoPredio} | Nivel ${e.codigoNivel}^FS\n` +
            `^FO20,110^A0N,20,20^FD${e.tipo}^FS\n` +
            `^FO20,150^BY2^BCN,60,Y,N,N^FD${barcode}^FS\n` +
            `^XZ`
          )
        }
      }
    }

    if (body.tipo === 'PRODUTO') {
      const user = request.user as { id: string; empresaId: string }
      const produtos = await prisma.produto.findMany({ where: { id: { in: body.ids }, empresaId: user.empresaId } })
      for (const p of produtos) {
        for (let i = 0; i < body.quantidade; i++) {
          const barcode = p.cEAN || p.codigo
          zplEtiquetas.push(
            `^XA\n` +
            `^PW${Math.round(body.larguraMm * 8)}^LL${Math.round(body.alturaMm * 8)}\n` +
            `^FO20,20^A0N,35,35^FD${(p.nome || '').substring(0, 30)}^FS\n` +
            `^FO20,60^A0N,25,25^FDCod: ${p.codigo} | Un: ${p.unidade}^FS\n` +
            `^FO20,100^BY2^BCN,60,Y,N,N^FD${barcode}^FS\n` +
            `^XZ`
          )
        }
      }
    }

    if (body.tipo === 'VOLUME') {
      const volumes = await prisma.volume.findMany({ where: { id: { in: body.ids } }, include: { itens: true } })
      for (const v of volumes) {
        for (let i = 0; i < body.quantidade; i++) {
          zplEtiquetas.push(
            `^XA\n` +
            `^PW${Math.round(body.larguraMm * 8)}^LL${Math.round(body.alturaMm * 8)}\n` +
            `^FO20,20^A0N,40,40^FDVolume: ${v.codigo}^FS\n` +
            `^FO20,70^A0N,25,25^FDTipo: ${v.tipo} | Itens: ${v.itens.length}^FS\n` +
            `^FO20,100^A0N,20,20^FDPeso: ${Number(v.pesoKg)} kg^FS\n` +
            `^FO20,140^BY2^BCN,60,Y,N,N^FD${String(v.codigo).padStart(8, '0')}^FS\n` +
            `^XZ`
          )
        }
      }
    }

    // Retornar como texto ZPL (pode ser enviado direto para impressora)
    if (zplEtiquetas.length === 0) {
      return reply.status(422).send({ message: 'Nenhuma etiqueta gerada' })
    }

    const zplCompleto = zplEtiquetas.join('\n')

    reply.header('Content-Type', 'text/plain')
    return reply.send(zplCompleto)
  })

  // ==========================================================================
  // POST /enderecos-html — Gera etiquetas HTML de endereços com código de barras (fonte 20)
  // Para impressão em impressora comum ou térmica via navegador
  // ==========================================================================
  app.post('/enderecos-html', async (request, reply) => {
    const body = z.object({
      ids: z.array(z.string().uuid()).min(1),
      quantidade: z.number().int().positive().default(1),
    }).parse(request.body)

    const enderecos = await prisma.endereco.findMany({
      where: { id: { in: body.ids } },
      orderBy: [{ codigoRua: 'asc' }, { codigoPredio: 'asc' }, { codigoNivel: 'asc' }, { codigoApto: 'asc' }],
    })

    if (enderecos.length === 0) {
      return reply.status(422).send({ message: 'Nenhum endereço encontrado' })
    }

    // Generate barcode images
    const barcodeCache = new Map<string, string>()
    for (const e of enderecos) {
      const code = (e.enderecoCompleto || '').replace(/[^A-Za-z0-9]/g, '')
      if (!barcodeCache.has(code)) {
        try {
          const png = await bwipjs.toBuffer({
            bcid: 'code128',
            text: code,
            scale: 4,
            height: 15,
            includetext: false,
          })
          barcodeCache.set(code, png.toString('base64'))
        } catch {
          barcodeCache.set(code, '')
        }
      }
    }

    const labelBlocks: string[] = []
    for (const e of enderecos) {
      for (let i = 0; i < body.quantidade; i++) {
        const code = (e.enderecoCompleto || '').replace(/[^A-Za-z0-9]/g, '')
        const barcodeBase64 = barcodeCache.get(code) ?? ''
        const barcodeImg = barcodeBase64
          ? `<img src="data:image/png;base64,${barcodeBase64}" style="width:100%;height:auto;max-height:20mm;" />`
          : ''

        labelBlocks.push(`
      <div class="label">
        <div class="address">${e.enderecoCompleto}</div>
        <div class="barcode-img">${barcodeImg}</div>
        <div class="barcode-text">${code}</div>
        <div class="detail">Rua ${e.codigoRua} | Prédio ${e.codigoPredio} | Nível ${e.codigoNivel} | Apto ${e.codigoApto}</div>
      </div>`)
      }
    }

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Etiquetas de Endereços</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; }
    .page {
      width: 210mm;
      padding: 8mm;
      display: flex;
      flex-wrap: wrap;
      gap: 4mm;
      justify-content: flex-start;
    }
    .label {
      width: 95mm;
      height: 45mm;
      border: 1px solid #000;
      padding: 3mm;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      page-break-inside: avoid;
      overflow: hidden;
    }
    .address {
      font-size: 20pt;
      font-weight: bold;
      text-align: center;
      margin-bottom: 2mm;
    }
    .barcode-img {
      text-align: center;
      margin: 2mm 0;
    }
    .barcode-img img {
      max-height: 15mm;
    }
    .barcode-text {
      font-size: 10pt;
      font-family: 'Courier New', monospace;
      text-align: center;
      letter-spacing: 1px;
    }
    .detail {
      font-size: 8pt;
      color: #555;
      text-align: center;
      margin-top: 1mm;
    }
    @media print {
      @page { size: A4; margin: 5mm; }
      body { -webkit-print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="page">
${labelBlocks.join('\n')}
  </div>
</body>
</html>`

    reply.header('Content-Type', 'text/html; charset=utf-8')
    return reply.send(html)
  })

  // ==========================================================================
  // GET /volume/:id/html — Generate HTML label for a volume
  // Task 12.1: Contains barcode, type, weight, item count, sales order number.
  // ==========================================================================
  app.get('/volume/:id/html', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const volume = await prisma.volume.findUnique({
      where: { id },
      include: { itens: true },
    })

    if (!volume) return reply.status(404).send({ message: 'Volume não encontrado' })

    // Fetch sales order data
    const pedido = await prisma.pedidoVenda.findUnique({
      where: { id: volume.pedidoVendaId },
      select: { numero: true },
    })

    const barcodeValue = String(volume.codigo).padStart(8, '0')

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Etiqueta Volume ${volume.codigo}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Courier New', Courier, monospace; padding: 10mm; }
    .label { border: 2px solid #000; padding: 12px; width: 100mm; }
    .title { font-size: 18px; font-weight: bold; text-align: center; margin-bottom: 8px; }
    .row { display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 13px; }
    .row .key { font-weight: bold; }
    .barcode-section { text-align: center; margin-top: 12px; padding-top: 8px; border-top: 1px dashed #999; }
    .barcode-text { font-family: 'Libre Barcode 128', 'Code 128', monospace; font-size: 40px; letter-spacing: 2px; }
    .barcode-value { font-size: 11px; color: #333; margin-top: 2px; }
    @media print { @page { margin: 5mm; } }
  </style>
</head>
<body>
  <div class="label">
    <div class="title">VOLUME ${volume.codigo}</div>
    <div class="row"><span class="key">Tipo:</span><span>${volume.tipo}</span></div>
    <div class="row"><span class="key">Peso:</span><span>${Number(volume.pesoKg).toFixed(3)} kg</span></div>
    <div class="row"><span class="key">Dimensões:</span><span>${Number(volume.comprimentoCm)}x${Number(volume.larguraCm)}x${Number(volume.alturaCm)} cm</span></div>
    <div class="row"><span class="key">Itens:</span><span>${volume.itens.length}</span></div>
    <div class="row"><span class="key">Pedido:</span><span>${pedido?.numero ?? '—'}</span></div>
    <div class="barcode-section">
      <div class="barcode-text">${barcodeValue}</div>
      <div class="barcode-value">${barcodeValue}</div>
    </div>
  </div>
</body>
</html>`

    reply.header('Content-Type', 'text/html; charset=utf-8')
    return reply.send(html)
  })

  // ==========================================================================
  // GET /volume/:id/zpl — Generate ZPL label for a volume
  // Task 12.1: Contains barcode, type, weight, item count, sales order number.
  // ==========================================================================
  app.get('/volume/:id/zpl', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const volume = await prisma.volume.findUnique({
      where: { id },
      include: { itens: true },
    })

    if (!volume) return reply.status(404).send({ message: 'Volume não encontrado' })

    // Fetch sales order data
    const pedido = await prisma.pedidoVenda.findUnique({
      where: { id: volume.pedidoVendaId },
      select: { numero: true },
    })

    const barcodeValue = String(volume.codigo).padStart(8, '0')

    const zpl = [
      '^XA',
      '^PW800^LL600',
      `^FO20,20^A0N,45,45^FDVOLUME ${volume.codigo}^FS`,
      `^FO20,75^GB760,2,2^FS`,
      `^FO20,90^A0N,30,30^FDTipo: ${volume.tipo}^FS`,
      `^FO20,130^A0N,30,30^FDPeso: ${Number(volume.pesoKg).toFixed(3)} kg^FS`,
      `^FO20,170^A0N,30,30^FDDim: ${Number(volume.comprimentoCm)}x${Number(volume.larguraCm)}x${Number(volume.alturaCm)} cm^FS`,
      `^FO20,210^A0N,30,30^FDItens: ${volume.itens.length}^FS`,
      `^FO20,250^A0N,30,30^FDPedido: ${pedido?.numero ?? '-'}^FS`,
      `^FO20,300^GB760,2,2^FS`,
      `^FO80,330^BY3^BCN,80,Y,N,N^FD${barcodeValue}^FS`,
      `^FO80,440^A0N,22,22^FD${barcodeValue}^FS`,
      `^FO20,480^A0N,18,18^FDVisioFab WMS^FS`,
      '^XZ',
    ].join('\n')

    reply.header('Content-Type', 'text/plain')
    return reply.send(zpl)
  })

  // ==========================================================================
  // POST /gerar-enderecamento — Generate HTML labels for addressed items
  // Task 4.1: A4 layout, Code128 barcode of address at top, product info in
  //           middle, quantity and lot/expiry at bottom. Returns text/html.
  // ==========================================================================
  app.post('/gerar-enderecamento', async (request, reply) => {
    const body = z.object({
      itens: z.array(z.object({
        enderecoCompleto: z.string().min(1),
        produtoCodigo: z.string().min(1),
        produtoNome: z.string().min(1),
        quantidade: z.number().positive(),
        lote: z.string().optional(),
        validade: z.string().optional(),
      })).min(1),
      quantidade: z.number().int().positive().default(1),
    }).parse(request.body)

    // Generate barcode PNG images as base64 for each unique address
    const barcodeCache = new Map<string, string>()
    for (const item of body.itens) {
      if (!barcodeCache.has(item.enderecoCompleto)) {
        try {
          const png = await bwipjs.toBuffer({
            bcid: 'code128',
            text: item.enderecoCompleto,
            scale: 3,
            height: 12,
            includetext: true,
            textxalign: 'center',
          })
          barcodeCache.set(item.enderecoCompleto, png.toString('base64'))
        } catch {
          barcodeCache.set(item.enderecoCompleto, '')
        }
      }
    }

    // Build label HTML blocks — repeat each label `quantidade` times
    const labelBlocks: string[] = []
    for (const item of body.itens) {
      for (let i = 0; i < body.quantidade; i++) {
        const barcodeBase64 = barcodeCache.get(item.enderecoCompleto) ?? ''
        const barcodeImg = barcodeBase64
          ? `<img src="data:image/png;base64,${barcodeBase64}" alt="${item.enderecoCompleto}" style="max-width:100%;height:auto;" />`
          : `<span class="barcode-fallback">${item.enderecoCompleto}</span>`

        const loteLine = item.lote ? `<span>Lote: ${item.lote}</span>` : ''
        const validadeLine = item.validade ? `<span>Val: ${item.validade}</span>` : ''

        labelBlocks.push(`
      <div class="label">
        <div class="barcode-section">
          ${barcodeImg}
          <div class="address-text">${item.enderecoCompleto}</div>
        </div>
        <div class="product-section">
          <div class="product-code">${item.produtoCodigo}</div>
          <div class="product-name">${item.produtoNome}</div>
        </div>
        <div class="detail-section">
          <span>Qtd: ${item.quantidade}</span>
          ${loteLine}
          ${validadeLine}
        </div>
      </div>`)
      }
    }

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Etiquetas de Endereçamento</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; }
    .page {
      width: 210mm;
      padding: 10mm;
      display: flex;
      flex-wrap: wrap;
      gap: 5mm;
      justify-content: flex-start;
    }
    .label {
      width: 95mm;
      height: 60mm;
      border: 1px solid #000;
      padding: 3mm;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      page-break-inside: avoid;
      overflow: hidden;
    }
    .barcode-section {
      text-align: center;
      padding-bottom: 2mm;
      border-bottom: 1px dashed #ccc;
    }
    .barcode-section img { max-height: 18mm; }
    .address-text {
      font-size: 11px;
      font-weight: bold;
      margin-top: 1mm;
    }
    .barcode-fallback {
      font-size: 14px;
      font-weight: bold;
      letter-spacing: 2px;
    }
    .product-section {
      text-align: center;
      padding: 2mm 0;
    }
    .product-code {
      font-size: 14px;
      font-weight: bold;
    }
    .product-name {
      font-size: 11px;
      color: #333;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .detail-section {
      display: flex;
      justify-content: space-around;
      font-size: 10px;
      border-top: 1px dashed #ccc;
      padding-top: 2mm;
    }
    @media print {
      @page { size: A4; margin: 5mm; }
      body { -webkit-print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="page">
${labelBlocks.join('\n')}
  </div>
</body>
</html>`

    reply.header('Content-Type', 'text/html; charset=utf-8')
    return reply.send(html)
  })

  // ==========================================================================
  // POST /gerar-enderecamento-zpl — Generate ZPL labels for addressed items
  // Task 4.2: ZPL II with ^BC Code128 barcode, ^PW and ^LL for 100×50mm at
  //           8 dots/mm. Returns text/plain.
  // ==========================================================================
  app.post('/gerar-enderecamento-zpl', async (request, reply) => {
    const body = z.object({
      itens: z.array(z.object({
        enderecoCompleto: z.string().min(1),
        produtoCodigo: z.string().min(1),
        produtoNome: z.string().min(1),
        quantidade: z.number().positive(),
        lote: z.string().optional(),
        validade: z.string().optional(),
      })).min(1),
      quantidade: z.number().int().positive().default(1),
      larguraMm: z.number().default(100),
      alturaMm: z.number().default(50),
    }).parse(request.body)

    const pw = Math.round(body.larguraMm * 8) // dots at 8 dots/mm
    const ll = Math.round(body.alturaMm * 8)

    const zplEtiquetas: string[] = []

    for (const item of body.itens) {
      for (let i = 0; i < body.quantidade; i++) {
        const barcodeValue = item.enderecoCompleto.replace(/[^A-Za-z0-9]/g, '')
        const produtoNomeTrunc = (item.produtoNome || '').substring(0, 30)

        let yPos = 20

        let zpl = `^XA\n`
        zpl += `^PW${pw}^LL${ll}\n`

        // Barcode Code128 at top
        zpl += `^FO20,${yPos}^BY2^BCN,50,Y,N,N^FD${barcodeValue}^FS\n`
        yPos += 80

        // Address text below barcode
        zpl += `^FO20,${yPos}^A0N,22,22^FD${item.enderecoCompleto}^FS\n`
        yPos += 30

        // Separator
        zpl += `^FO20,${yPos}^GB${pw - 40},1,1^FS\n`
        yPos += 10

        // Product code and name in middle
        zpl += `^FO20,${yPos}^A0N,28,28^FD${item.produtoCodigo}^FS\n`
        yPos += 35
        zpl += `^FO20,${yPos}^A0N,22,22^FD${produtoNomeTrunc}^FS\n`
        yPos += 30

        // Separator
        zpl += `^FO20,${yPos}^GB${pw - 40},1,1^FS\n`
        yPos += 10

        // Quantity, lot, expiry at bottom
        zpl += `^FO20,${yPos}^A0N,22,22^FDQtd: ${item.quantidade}^FS\n`

        if (item.lote) {
          zpl += `^FO300,${yPos}^A0N,22,22^FDLote: ${item.lote}^FS\n`
        }
        yPos += 28

        if (item.validade) {
          zpl += `^FO20,${yPos}^A0N,22,22^FDVal: ${item.validade}^FS\n`
        }

        zpl += `^XZ`
        zplEtiquetas.push(zpl)
      }
    }

    if (zplEtiquetas.length === 0) {
      return reply.status(422).send({ message: 'Nenhuma etiqueta gerada' })
    }

    const zplCompleto = zplEtiquetas.join('\n')

    reply.header('Content-Type', 'text/plain')
    return reply.send(zplCompleto)
  })
}
