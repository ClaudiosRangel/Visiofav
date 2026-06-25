import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../../lib/prisma'
import { authenticate } from '../../../middleware/authenticate'
import { moduloGuard } from '../../../middleware/modulo-guard'
import { extrairTextoPdf } from './pdf-extractor.service'
import { isGprintPdf, parseGprintPdf, DadosOpGprint } from './parsers/gprint-parser'
import * as fs from 'fs'
import * as path from 'path'

// Cache simples em memÃ³ria (TTL 30 min) para dados extraÃ­dos pendentes de confirmaÃ§Ã£o
const cacheImportacao = new Map<string, { dados: DadosOpGprint; pdfBuffer: Buffer; expira: number }>()

function limparCacheExpirado() {
  const agora = Date.now()
  for (const [key, val] of cacheImportacao) {
    if (val.expira < agora) cacheImportacao.delete(key)
  }
}

export async function importacaoOpRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('PCP'))

  // =========================================================================
  // POST /api/pcp/importar-op-pdf â€” Upload e preview dos dados extraÃ­dos
  // =========================================================================
  app.post('/importar-op-pdf', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }

    const file = await request.file()
    if (!file) {
      return reply.status(400).send({ message: 'Nenhum arquivo enviado. Envie um PDF via multipart/form-data.' })
    }

    if (!file.mimetype.includes('pdf')) {
      return reply.status(400).send({ message: 'Formato invÃ¡lido. Envie um arquivo PDF.' })
    }

    const buffer = await file.toBuffer()

    if (buffer.length > 10 * 1024 * 1024) {
      return reply.status(400).send({ message: 'Arquivo excede o limite de 10MB.' })
    }

    // Extrair texto do PDF
    let extracao
    try {
      extracao = await extrairTextoPdf(buffer)
    } catch (err: any) {
      return reply.status(400).send({ message: err.message })
    }

    if (!extracao.temTexto) {
      return reply.status(422).send({
        message: 'PDF nÃ£o contÃ©m texto extraÃ­vel. Use um PDF gerado digitalmente ou envie para OCR.',
      })
    }

    // Detectar sistema de origem e parsear
    let dadosExtraidos: DadosOpGprint

    if (isGprintPdf(extracao.texto)) {
      dadosExtraidos = parseGprintPdf(extracao.texto)
    } else {
      // Sistema nÃ£o identificado â€” retorna texto bruto
      return reply.status(200).send({
        sistemaOrigem: 'DESCONHECIDO',
        mensagem: 'Sistema de origem nÃ£o identificado automaticamente. Texto extraÃ­do para mapeamento manual.',
        textoExtraido: extracao.texto.substring(0, 5000),
        totalPaginas: extracao.totalPaginas,
      })
    }

    // Auto-match com entidades existentes
    const sugestoes = await buscarSugestoes(user.empresaId, dadosExtraidos)

    // Verificar se jÃ¡ existe OP com mesma referÃªncia
    let opDuplicada = null
    if (dadosExtraidos.cabecalho.numeroOp) {
      const existente = await prisma.ordemProducao.findFirst({
        where: { empresaId: user.empresaId, observacoes: { contains: dadosExtraidos.cabecalho.numeroOp } },
        select: { id: true, numero: true, status: true },
      })
      if (existente) {
        opDuplicada = existente
      }
    }

    // Salvar em cache para confirmaÃ§Ã£o posterior
    const importacaoId = crypto.randomUUID()
    limparCacheExpirado()
    cacheImportacao.set(importacaoId, { dados: dadosExtraidos, pdfBuffer: buffer, expira: Date.now() + 30 * 60 * 1000 })

    return reply.status(200).send({
      importacaoId,
      sistemaOrigem: dadosExtraidos.sistemaOrigem,
      confianca: dadosExtraidos.confianca,
      avisos: dadosExtraidos.avisos,
      opDuplicada,
      dadosExtraidos: {
        cabecalho: dadosExtraidos.cabecalho,
        materiais: dadosExtraidos.materiais,
        etapas: dadosExtraidos.etapas,
        cortadeira: dadosExtraidos.cortadeira,
        montagem: dadosExtraidos.montagem,
        observacoes: dadosExtraidos.observacoes,
        embalagem: dadosExtraidos.embalagem,
      },
      sugestoes,
    })
  })

  // =========================================================================
  // POST /api/pcp/importar-op-pdf/confirmar â€” Cria a OP no sistema
  // =========================================================================
  app.post('/importar-op-pdf/confirmar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }

    const bodySchema = z.object({
      importacaoId: z.string().uuid(),
      // Overrides do usuÃ¡rio (campos que ele corrigiu no preview)
      clienteId: z.string().uuid().optional().nullable(),
      produtoId: z.string().uuid().optional().nullable(),
      quantidade: z.number().positive().optional(),
      dataEntregaPrevista: z.string().optional(),
      prioridade: z.enum(['BAIXA', 'NORMAL', 'ALTA', 'URGENTE']).optional().default('NORMAL'),
      observacoes: z.string().optional(),
      // Mapeamento de materiais (Ã­ndice â†’ produtoId)
      materiaisVinculados: z.array(z.object({
        indice: z.number().int().min(0),
        produtoId: z.string().uuid().nullable(),
      })).optional(),
      // Mapeamento de centros (Ã­ndice etapa â†’ centroProducaoId)
      centrosVinculados: z.array(z.object({
        indice: z.number().int().min(0),
        centroProducaoId: z.string().uuid().nullable(),
        nomeEditado: z.string().optional(),
        tipoMaquina: z.enum(['IMPRESSAO', 'ACABAMENTO', 'CORTADEIRA', 'COLAGEM', 'VERNIZ']).optional(),
      })).optional(),
      // Se quer salvar De/Para para futuras importaÃ§Ãµes
      salvarDePara: z.boolean().optional().default(false),
    })

    const body = bodySchema.parse(request.body)

    // Buscar dados do cache
    const cached = cacheImportacao.get(body.importacaoId)
    if (!cached || cached.expira < Date.now()) {
      return reply.status(410).send({ message: 'Dados de importaÃ§Ã£o expirados. FaÃ§a upload do PDF novamente.' })
    }

    const dados = cached.dados

    // Consolidar observações — incluir cliente e produto do PDF para exibição
    const obsConsolidadas = [
      ...(dados.cabecalho.cliente ? [`[Cliente] ${dados.cabecalho.cliente}`] : []),
      ...(dados.cabecalho.descricao ? [`[Produto] ${dados.cabecalho.descricao}`] : []),
      ...(dados.montagem ? [`[Montagem] ${dados.montagem.aproveitamento}`] : []),
      ...(dados.observacoes.gerais || []),
      ...(dados.observacoes.producao || []),
      ...(dados.observacoes.bobinas.map(b => `[Bobina] ${b}`) || []),
    ].join('\n')

    // Verificar se já existe OP com mesmo número — se sim, ATUALIZAR em vez de criar nova
    let op: any
    let modoAtualizacao = false
    const numeroOriginal = dados.cabecalho.numeroOp ? parseInt(dados.cabecalho.numeroOp) : NaN

    if (!isNaN(numeroOriginal)) {
      const existe = await prisma.ordemProducao.findFirst({
        where: { empresaId: user.empresaId, numero: numeroOriginal },
      })

      if (existe) {
        // ATUALIZAR OP existente — preservar flag de "material recebido" (se não tem mais "encomendado" nas obs, manter)
        modoAtualizacao = true
        const obsExistentes = existe.observacoes || ''
        const materialJaRecebido = !(/encomendad/i.test(obsExistentes)) && /encomendad/i.test(obsConsolidadas)
        const novasObs = materialJaRecebido
          ? obsConsolidadas.replace(/\[Bobina\].*encomendad[oa].*\n?/gi, '') // preserva remoção anterior
          : (body.observacoes || obsConsolidadas)

        op = await prisma.ordemProducao.update({
          where: { id: existe.id },
          data: {
            quantidade: body.quantidade || dados.cabecalho.quantidade || Number(existe.quantidade),
            dataEntregaPrevista: body.dataEntregaPrevista ? new Date(body.dataEntregaPrevista) : (dados.cabecalho.programacaoEntrega?.[0]?.data ? parseDateBR(dados.cabecalho.programacaoEntrega[0].data) : existe.dataEntregaPrevista),
            clienteId: body.clienteId || existe.clienteId,
            prioridade: body.prioridade || existe.prioridade,
            observacoes: novasObs,
            referenciaExterna: dados.cabecalho.numeroOp || existe.referenciaExterna,
          },
        })

        // Limpar itens e etapas existentes para recriar com dados atualizados
        await prisma.apontamentoEtapa.deleteMany({ where: { etapaOrdemProducao: { ordemProducaoId: op.id } } })
        await prisma.etapaOrdemProducao.deleteMany({ where: { ordemProducaoId: op.id } })
        await prisma.itemOrdemProducao.deleteMany({ where: { ordemProducaoId: op.id } })
        await prisma.programacaoEntrega.deleteMany({ where: { ordemProducaoId: op.id } })
      }
    }

    if (!op) {
      // Criar nova OP
      let proximoNumero: number
      if (!isNaN(numeroOriginal)) {
        proximoNumero = numeroOriginal
      } else {
        const ultimaOp = await prisma.ordemProducao.findFirst({ where: { empresaId: user.empresaId }, orderBy: { numero: 'desc' }, select: { numero: true } })
        proximoNumero = (ultimaOp?.numero ?? 0) + 1
      }

      op = await prisma.ordemProducao.create({
        data: {
          numero: proximoNumero,
          empresaId: user.empresaId,
          produtoId: body.produtoId || null,
          quantidade: body.quantidade || dados.cabecalho.quantidade || 0,
          unidadeMedida: 'UN',
          status: 'PLANEJADA',
          prioridade: body.prioridade,
          dataEmissao: new Date(),
          dataEntregaPrevista: body.dataEntregaPrevista ? new Date(body.dataEntregaPrevista) : (dados.cabecalho.programacaoEntrega?.[0]?.data ? parseDateBR(dados.cabecalho.programacaoEntrega[0].data) : undefined),
          dataEntregaOriginal: body.dataEntregaPrevista ? new Date(body.dataEntregaPrevista) : (dados.cabecalho.programacaoEntrega?.[0]?.data ? parseDateBR(dados.cabecalho.programacaoEntrega[0].data) : undefined),
          clienteId: body.clienteId || undefined,
          lote: undefined,
          observacoes: body.observacoes || obsConsolidadas || undefined,
          referenciaExterna: dados.cabecalho.numeroOp || undefined,
          origemImportacao: 'PDF_GPRINT',
          criadoPorId: user.id,
        },
      })
    }

    // Salvar PDF em disco para visualização posterior
    if (cached.pdfBuffer) {
      const uploadsDir = path.join(process.cwd(), 'uploads', 'ops')
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true })
      fs.writeFileSync(path.join(uploadsDir, `${op.id}.pdf`), cached.pdfBuffer)
    }

    // Criar itens de material
    const itensMateriaisCriados = []
    for (let i = 0; i < dados.materiais.length; i++) {
      const mat = dados.materiais[i]
      const vinculo = body.materiaisVinculados?.find(v => v.indice === i)
      const produtoId = vinculo?.produtoId ?? null

      // Validar que produtoId existe antes de vincular
      let produtoIdValidado: string | null = null
      if (produtoId) {
        const produtoExiste = await prisma.produto.findUnique({ where: { id: produtoId }, select: { id: true } })
        if (produtoExiste) {
          produtoIdValidado = produtoId
        }
      }

      const item = await prisma.itemOrdemProducao.create({
        data: {
          ordemProducaoId: op.id,
          empresaId: user.empresaId,
          produtoComponenteId: produtoIdValidado ?? undefined,
          descricaoProduto: mat.descricao,
          descricaoExterna: mat.descricao,
          quantidade: mat.quantidade,
          unidadeMedida: mat.unidade,
          tipoMaterial: mat.tipo,
          status: 'PENDENTE',
        },
      })
      itensMateriaisCriados.push(item)
    }

    // Criar etapas do roteiro
    const etapasCriadas = []
    for (let i = 0; i < dados.etapas.length; i++) {
      const etapa = dados.etapas[i]
      const vinculoCentro = body.centrosVinculados?.find(v => v.indice === i)
      const centroId = vinculoCentro?.centroProducaoId ?? null

      // Validar que centroId existe no banco antes de usar
      let centroIdValidado: string | null = null
      if (centroId) {
        const centroExiste = await prisma.centroProducao.findUnique({ where: { id: centroId }, select: { id: true } })
        if (centroExiste) {
          centroIdValidado = centroId
        }
      }

      // Se não vinculou a centro existente mas tem nomeEditado, criar novo centro
      if (!centroIdValidado && vinculoCentro?.nomeEditado) {
        const nomeCentro = vinculoCentro.nomeEditado
        const codigoCentro = nomeCentro.substring(0, 20).toUpperCase().replace(/\s+/g, '_')

        // Verificar se já existe um centro com esse código para evitar duplicidade
        const centroExistente = await prisma.centroProducao.findFirst({
          where: { empresaId: user.empresaId, codigo: codigoCentro },
          select: { id: true },
        })

        if (centroExistente) {
          centroIdValidado = centroExistente.id
        } else {
          const novoCentro = await prisma.centroProducao.create({
            data: {
              empresaId: user.empresaId,
              codigo: codigoCentro,
              descricao: nomeCentro,
              tipo: 'MAQUINA',
              tipoMaquina: vinculoCentro.tipoMaquina ?? null,
            },
          })
          centroIdValidado = novoCentro.id
        }
      }

      const etapaCriada = await prisma.etapaOrdemProducao.create({
        data: {
          ordemProducaoId: op.id,
          sequencia: etapa.sequencia,
          descricao: etapa.descricao,
          centroProducaoId: centroIdValidado ?? undefined,
          tempoSetupMinutos: etapa.tempoFixoMin,
          tempoOperacaoCalculado: etapa.tempoVariavelMin,
          tempoEsperaMinutos: 0,
          status: 'PENDENTE',
        },
      })
      etapasCriadas.push(etapaCriada)
    }

    // Registrar log
    await prisma.logOrdemProducao.create({
      data: {
        ordemProducaoId: op.id,
        statusAnterior: '',
        statusNovo: 'PLANEJADA',
        usuarioId: user.id,
        observacao: modoAtualizacao
          ? `OP reimportada/atualizada via PDF do sistema GPrint. Referência externa: ${dados.cabecalho.numeroOp || 'N/A'}`
          : `OP importada via PDF do sistema GPrint. Referência externa: ${dados.cabecalho.numeroOp || 'N/A'}`,
      },
    })

    // Criar programação de entrega (se extraída do PDF)
    if (dados.cabecalho.programacaoEntrega?.length > 0) {
      for (const prog of dados.cabecalho.programacaoEntrega) {
        const dataEntrega = parseDateBR(prog.data)
        if (dataEntrega) {
          await prisma.programacaoEntrega.create({
            data: {
              ordemProducaoId: op.id,
              dataEntrega,
              quantidade: prog.quantidade,
              codigoPedido: dados.cabecalho.pedido || undefined,
              status: 'PENDENTE',
            },
          })
        }
      }
    }

    // Salvar De/Para se solicitado
    if (body.salvarDePara) {
      await salvarDeParaImportacao(user.empresaId, dados, body)
    }

    // Limpar cache
    cacheImportacao.delete(body.importacaoId)

    return reply.status(201).send({
      message: modoAtualizacao ? 'OP atualizada com sucesso (reimportação)' : 'OP importada com sucesso',
      modoAtualizacao,
      ordemProducao: {
        id: op.id,
        numero: op.numero,
        status: op.status,
        referenciaExterna: op.referenciaExterna,
      },
      materiais: itensMateriaisCriados.length,
      etapas: etapasCriadas.length,
    })
  })

  // =========================================================================
  // GET /api/pcp/de-para-importacao â€” Lista mapeamentos
  // =========================================================================
  app.get('/de-para-importacao', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const query = z.object({
      sistemaOrigem: z.string().optional(),
      tipoEntidade: z.string().optional(),
      page: z.coerce.number().int().positive().optional().default(1),
      limit: z.coerce.number().int().positive().max(100).optional().default(50),
    }).parse(request.query)

    const where: any = { empresaId: user.empresaId }
    if (query.sistemaOrigem) where.sistemaOrigem = query.sistemaOrigem
    if (query.tipoEntidade) where.tipoEntidade = query.tipoEntidade

    const [data, total] = await Promise.all([
      prisma.deParaImportacao.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { criadoEm: 'desc' },
      }),
      prisma.deParaImportacao.count({ where }),
    ])

    return { data, total, page: query.page, limit: query.limit }
  })

  // =========================================================================
  // POST /api/pcp/de-para-importacao â€” Criar mapeamento
  // =========================================================================
  app.post('/de-para-importacao', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = z.object({
      sistemaOrigem: z.string().min(1).max(50),
      tipoEntidade: z.enum(['CLIENTE', 'PRODUTO', 'MATERIAL', 'CENTRO_PRODUCAO']),
      codigoExterno: z.string().min(1).max(100),
      nomeExterno: z.string().min(1).max(200),
      entidadeInternaId: z.string().uuid(),
    }).parse(request.body)

    const dePara = await prisma.deParaImportacao.create({
      data: { ...body, empresaId: user.empresaId },
    })

    return reply.status(201).send(dePara)
  })

  // =========================================================================
  // DELETE /api/pcp/de-para-importacao/:id â€” Remover mapeamento
  // =========================================================================
  app.delete('/de-para-importacao/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    await prisma.deParaImportacao.deleteMany({ where: { id, empresaId: user.empresaId } })
    return reply.status(204).send()
  })
}

// ============================================================================
// FUNÃ‡Ã•ES AUXILIARES
// ============================================================================

async function buscarSugestoes(empresaId: string, dados: DadosOpGprint) {
  const sugestoes: {
    cliente: any | null
    produto: any | null
    materiais: Array<{ indice: number; sugestao: any | null }>
    centros: Array<{ indice: number; sugestao: any | null }>
  } = { cliente: null, produto: null, materiais: [], centros: [] }

  // Buscar cliente pelo cÃ³digo externo (De/Para) ou nome
  if (dados.cabecalho.codigoCliente) {
    // Primeiro: De/Para
    const dePara = await prisma.deParaImportacao.findFirst({
      where: { empresaId, sistemaOrigem: 'GPRINT', tipoEntidade: 'CLIENTE', codigoExterno: dados.cabecalho.codigoCliente },
    })
    if (dePara) {
      sugestoes.cliente = { id: dePara.entidadeInternaId, origem: 'de_para', codigoExterno: dados.cabecalho.codigoCliente }
    } else if (dados.cabecalho.cliente) {
      // Busca por nome (fuzzy)
      const cliente = await prisma.cliente.findFirst({
        where: { empresaId, OR: [{ razaoSocial: { contains: dados.cabecalho.cliente, mode: 'insensitive' } }, { nomeFantasia: { contains: dados.cabecalho.cliente, mode: 'insensitive' } }] },
        select: { id: true, razaoSocial: true, nomeFantasia: true },
      })
      if (cliente) sugestoes.cliente = { ...cliente, origem: 'fuzzy_match' }
    }
  }

  // Buscar produto acabado pelo cÃ³digo
  if (dados.cabecalho.codigoAcabado) {
    const produto = await prisma.produto.findFirst({
      where: { empresaId, codigo: dados.cabecalho.codigoAcabado },
      select: { id: true, codigo: true, nome: true },
    })
    if (produto) sugestoes.produto = { ...produto, origem: 'codigo_exato' }
  }

  // Buscar materiais
  for (let i = 0; i < dados.materiais.length; i++) {
    const mat = dados.materiais[i]
    // Primeiro: De/Para
    const deParaMat = await prisma.deParaImportacao.findFirst({
      where: { empresaId, sistemaOrigem: 'GPRINT', tipoEntidade: 'MATERIAL', codigoExterno: mat.descricao },
    })
    if (deParaMat) {
      const produto = await prisma.produto.findFirst({ where: { id: deParaMat.entidadeInternaId }, select: { id: true, codigo: true, nome: true } })
      sugestoes.materiais.push({ indice: i, sugestao: produto || null })
    } else {
      const produto = await prisma.produto.findFirst({
        where: { empresaId, OR: [{ nome: { contains: mat.descricao.substring(0, 20), mode: 'insensitive' } }, { codigo: { contains: mat.descricao.substring(0, 10), mode: 'insensitive' } }] },
        select: { id: true, codigo: true, nome: true },
      })
      sugestoes.materiais.push({ indice: i, sugestao: produto || null })
    }
  }

  // Buscar centros de produção para etapas
  for (let i = 0; i < dados.etapas.length; i++) {
    const etapa = dados.etapas[i]
    const nomeMaquina = etapa.maquina || etapa.descricao
    // Primeiro: De/Para
    const deParaCentro = await prisma.deParaImportacao.findFirst({
      where: { empresaId, sistemaOrigem: 'GPRINT', tipoEntidade: 'CENTRO_PRODUCAO', codigoExterno: nomeMaquina },
    })
    if (deParaCentro) {
      const centro = await prisma.centroProducao.findFirst({ where: { id: deParaCentro.entidadeInternaId }, select: { id: true, codigo: true, descricao: true, tipoMaquina: true } })
      sugestoes.centros.push({ indice: i, sugestao: centro || null })
    } else if (nomeMaquina) {
      const centro = await prisma.centroProducao.findFirst({
        where: { empresaId, OR: [{ descricao: { contains: nomeMaquina.substring(0, 15), mode: 'insensitive' } }, { codigo: { contains: nomeMaquina.substring(0, 10), mode: 'insensitive' } }] },
        select: { id: true, codigo: true, descricao: true, tipoMaquina: true },
      })
      sugestoes.centros.push({ indice: i, sugestao: centro || null })
    } else {
      sugestoes.centros.push({ indice: i, sugestao: null })
    }
  }

  return sugestoes
}

async function salvarDeParaImportacao(empresaId: string, dados: DadosOpGprint, body: any) {
  try {
    // Salvar cliente
    if (body.clienteId && dados.cabecalho.codigoCliente) {
      await prisma.deParaImportacao.upsert({
        where: { empresaId_sistemaOrigem_tipoEntidade_codigoExterno: { empresaId, sistemaOrigem: 'GPRINT', tipoEntidade: 'CLIENTE', codigoExterno: dados.cabecalho.codigoCliente } },
        create: { empresaId, sistemaOrigem: 'GPRINT', tipoEntidade: 'CLIENTE', codigoExterno: dados.cabecalho.codigoCliente, nomeExterno: dados.cabecalho.cliente || '', entidadeInternaId: body.clienteId },
        update: { entidadeInternaId: body.clienteId, nomeExterno: dados.cabecalho.cliente || '' },
      })
    }

    // Salvar produto acabado
    if (body.produtoId && dados.cabecalho.codigoAcabado) {
      await prisma.deParaImportacao.upsert({
        where: { empresaId_sistemaOrigem_tipoEntidade_codigoExterno: { empresaId, sistemaOrigem: 'GPRINT', tipoEntidade: 'PRODUTO', codigoExterno: dados.cabecalho.codigoAcabado } },
        create: { empresaId, sistemaOrigem: 'GPRINT', tipoEntidade: 'PRODUTO', codigoExterno: dados.cabecalho.codigoAcabado, nomeExterno: dados.cabecalho.descricao || '', entidadeInternaId: body.produtoId },
        update: { entidadeInternaId: body.produtoId, nomeExterno: dados.cabecalho.descricao || '' },
      })
    }

    // Salvar de-para de centros/máquinas
    if (body.centrosVinculados?.length > 0) {
      for (const vinculo of body.centrosVinculados) {
        if (!vinculo.centroProducaoId) continue
        const etapa = dados.etapas[vinculo.indice]
        if (!etapa) continue
        const nomeOriginal = etapa.maquina || etapa.descricao
        const nomeEditado = vinculo.nomeEditado || nomeOriginal
        // Salvar usando o nome original do PDF como código externo
        await prisma.deParaImportacao.upsert({
          where: { empresaId_sistemaOrigem_tipoEntidade_codigoExterno: { empresaId, sistemaOrigem: 'GPRINT', tipoEntidade: 'CENTRO_PRODUCAO', codigoExterno: nomeOriginal } },
          create: { empresaId, sistemaOrigem: 'GPRINT', tipoEntidade: 'CENTRO_PRODUCAO', codigoExterno: nomeOriginal, nomeExterno: nomeEditado, entidadeInternaId: vinculo.centroProducaoId },
          update: { entidadeInternaId: vinculo.centroProducaoId, nomeExterno: nomeEditado },
        })
      }
    }

    // Salvar de-para de materiais
    if (body.materiaisVinculados?.length > 0) {
      for (const vinculo of body.materiaisVinculados) {
        if (!vinculo.produtoId) continue
        const mat = dados.materiais[vinculo.indice]
        if (!mat) continue
        await prisma.deParaImportacao.upsert({
          where: { empresaId_sistemaOrigem_tipoEntidade_codigoExterno: { empresaId, sistemaOrigem: 'GPRINT', tipoEntidade: 'MATERIAL', codigoExterno: mat.descricao } },
          create: { empresaId, sistemaOrigem: 'GPRINT', tipoEntidade: 'MATERIAL', codigoExterno: mat.descricao, nomeExterno: mat.descricao, entidadeInternaId: vinculo.produtoId },
          update: { entidadeInternaId: vinculo.produtoId, nomeExterno: mat.descricao },
        })
      }
    }
  } catch {
    // Não bloqueia a criação da OP se De/Para falhar
  }
}


/**
 * Converte data brasileira (DD/MM/YY ou DD/MM/YYYY) para Date.
 */
function parseDateBR(dateStr: string): Date | undefined {
  if (!dateStr) return undefined
  const parts = dateStr.split('/')
  if (parts.length !== 3) return undefined
  const day = parseInt(parts[0])
  const month = parseInt(parts[1]) - 1
  let year = parseInt(parts[2])
  if (year < 100) year += 2000 // 26 → 2026
  const date = new Date(year, month, day)
  return isNaN(date.getTime()) ? undefined : date
}
