import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { validarShelfLife } from './shelf-life.service'
import { calcularOcupacaoNivel } from '../endereco/ocupacao-nivel.service'
import { validarCapacidadeNivel } from '../endereco/validador-capacidade-nivel.service'
import { selecionarSkuMaster, type SkuInfo } from '../enderecamento-inteligente/conversor-unidade.service'
import { calcularDistribuicao, calcularCapacidadePalete, type EnderecoComCapacidade } from '../enderecamento-inteligente/motor-distribuicao.service'

/**
 * Parseia data no formato DD/MM/AAAA (brasileiro) ou ISO (AAAA-MM-DD).
 * Retorna Date válido ou null se não conseguir parsear.
 */
function parseDateBR(value: string | null | undefined): Date | null {
  if (!value) return null
  // Formato DD/MM/AAAA
  const brMatch = value.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
  if (brMatch) {
    const [, dia, mes, ano] = brMatch
    return new Date(Number(ano), Number(mes) - 1, Number(dia))
  }
  // Formato ISO AAAA-MM-DD ou AAAA-MM-DDTHH:mm:ss
  const isoDate = new Date(value)
  if (!isNaN(isoDate.getTime())) return isoDate
  return null
}

function getHojeRange() {
  const hojeStr = new Date().toISOString().split('T')[0]
  const hojeUtc = new Date(hojeStr + 'T00:00:00.000Z')
  const amanhaUtc = new Date(hojeStr + 'T00:00:00.000Z')
  amanhaUtc.setUTCDate(amanhaUtc.getUTCDate() + 1)
  return { hojeUtc, amanhaUtc }
}

const conferirItemSchema = z.object({
  itemNotaEntradaId: z.string().uuid(),
  quantidadeConferida: z.number().min(0),
  lote: z.string().optional(),
  validade: z.string().optional(),
  observacao: z.string().optional(),
})

const conferirTodosSchema = z.object({
  itens: z.array(z.object({
    itemNotaEntradaId: z.string().uuid(),
    quantidadeConferida: z.number().min(0),
    lote: z.string().optional(),
    validade: z.string().optional(),
  })),
})

const enderecamentoItemSchema = z.object({
  itemNotaEntradaId: z.string().uuid(),
  enderecoId: z.string().uuid(),
  quantidade: z.number().positive(),
  lote: z.string().optional(),
})

export async function conferenciaEntradaRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // GET /config — retorna configuração de conferência
  app.get('/config', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const params = await prisma.parametro.findMany({
      where: { empresaId: user.empresaId, chave: { in: ['WMS_CONF_TIPO', 'WMS_CONF_DISPOSITIVO'] } },
    })
    const config: Record<string, string> = {}
    for (const p of params) config[p.chave] = p.valor
    return {
      tipoConferencia: config['WMS_CONF_TIPO'] || 'CEGA', // CEGA ou NORMAL
      dispositivo: config['WMS_CONF_DISPOSITIVO'] || 'DIGITACAO', // DIGITACAO ou COLETOR
    }
  })

  // POST /conferir-por-barras/:notaId — conferir item por código de barras (para coletor/app)
  // O coletor escaneia o código de barras do produto e informa a quantidade
  app.post('/conferir-por-barras/:notaId', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { notaId } = z.object({ notaId: z.string().uuid() }).parse(request.params)
    const body = z.object({
      codigoProduto: z.string().min(1),
      quantidade: z.number().positive(),
      lote: z.string().optional(),
      validade: z.string().optional(),
    }).parse(request.body)

    // Verificar pendências logísticas — bloqueia conferência
    const pendenciasLogisticas = await prisma.pendenciaLogistica.count({
      where: { notaEntradaId: notaId, status: 'PENDENTE', empresaId: user.empresaId },
    })
    if (pendenciasLogisticas > 0) {
      return reply.status(422).send({
        message: `Conferência bloqueada: ${pendenciasLogisticas} pendência(s) logística(s) não resolvida(s).`,
        bloqueio: 'PENDENCIA_LOGISTICA',
      })
    }

    const nota = await prisma.notaEntrada.findUnique({ where: { id: notaId }, include: { itens: true } })
    if (!nota) return reply.status(404).send({ message: 'Nota não encontrada' })

    // Buscar item pelo código do produto
    const item = nota.itens.find((i) => i.codigoProduto === body.codigoProduto)
    if (!item) return reply.status(404).send({ message: `Produto ${body.codigoProduto} não encontrado nesta nota` })

    // Validação de Shelf Life
    if (body.validade) {
      const produto = await prisma.produto.findFirst({
        where: { empresaId: user.empresaId, codigo: body.codigoProduto },
        select: { shelfLifeMinimo: true, nome: true },
      })
      if (produto && produto.shelfLifeMinimo) {
        const resultado = validarShelfLife({
          shelfLifeMinimo: produto.shelfLifeMinimo,
          dataValidade: parseDateBR(body.validade)!,
          dataAtual: new Date(),
          produtoNome: produto.nome,
        })
        if (!resultado.aprovado) {
          return reply.status(422).send({
            message: resultado.mensagem,
            bloqueio: 'SHELF_LIFE',
            diasRestantes: resultado.diasRestantes,
            dataMinima: resultado.dataMinima,
          })
        }
      }
    }

    const quantidadeNota = Number(item.quantidade)
    const divergencia = body.quantidade - quantidadeNota
    const status = divergencia === 0 ? 'CONFORME' : 'DIVERGENTE'

    await prisma.itemNotaEntrada.update({
      where: { id: item.id },
      data: {
        lote: body.lote || item.lote,
        validade: body.validade ? parseDateBR(body.validade)! : item.validade,
      },
    })

    return {
      itemId: item.id,
      descricao: item.descricao,
      codigoProduto: item.codigoProduto,
      quantidadeNota,
      quantidadeConferida: body.quantidade,
      divergencia,
      status,
      tipoDivergencia: divergencia > 0 ? 'EXCESSO' : divergencia < 0 ? 'FALTA' : null,
    }
  })

  // GET /notas-pendentes — notas pendentes + em conferência
  app.get('/notas-pendentes', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const notas = await prisma.notaEntrada.findMany({
      where: { status: { in: ['PENDENTE', 'EM_CONFERENCIA'] } },
      orderBy: { criadoEm: 'desc' },
      include: { itens: true },
    })

    // Verificar pendências logísticas para cada nota
    const data = await Promise.all(notas.map(async (n) => {
      const pendenciasCount = await prisma.pendenciaLogistica.count({
        where: { notaEntradaId: n.id, status: 'PENDENTE', empresaId: user.empresaId },
      })
      return {
        ...n,
        itens: n.itens.map((item) => ({
          id: item.id,
          item: item.item,
          descricao: item.descricao,
          codigoProduto: item.codigoProduto,
          unidade: item.unidade,
        })),
        pendenciasLogisticas: pendenciasCount,
        bloqueada: pendenciasCount > 0,
      }
    }))

    return {
      data,
      total: notas.length,
    }
  })

  // GET /:notaId — detalhe da nota com itens e resultado da conferência
  app.get('/:notaId', async (request, reply) => {
    const { notaId } = z.object({ notaId: z.string().uuid() }).parse(request.params)
    const nota = await prisma.notaEntrada.findUnique({
      where: { id: notaId },
      include: { itens: true },
    })
    if (!nota) return reply.status(404).send({ message: 'Nota não encontrada' })
    return nota
  })

  // POST /iniciar/:notaId — iniciar conferência (PENDENTE → EM_CONFERENCIA)
  app.post('/iniciar/:notaId', async (request, reply) => {
    const { notaId } = z.object({ notaId: z.string().uuid() }).parse(request.params)
    const nota = await prisma.notaEntrada.findUnique({ where: { id: notaId }, include: { itens: true } })
    if (!nota) return reply.status(404).send({ message: 'Nota não encontrada' })

    if (!['PENDENTE', 'EM_CONFERENCIA'].includes(nota.status)) {
      return reply.status(422).send({ message: `Nota em status ${nota.status}, não pode iniciar conferência` })
    }

    // Validar que a nota tem itens
    if (nota.itens.length === 0) {
      return reply.status(422).send({ message: 'Esta nota não possui itens. Adicione itens à nota antes de iniciar a conferência.' })
    }

    // Verificar pendências logísticas — bloqueia conferência se houver pendências
    const user = request.user as { id: string; nome: string; empresaId: string }
    const pendenciasLogisticas = await prisma.pendenciaLogistica.count({
      where: { notaEntradaId: notaId, status: 'PENDENTE', empresaId: user.empresaId },
    })

    if (pendenciasLogisticas > 0) {
      return reply.status(422).send({
        message: `Esta nota possui ${pendenciasLogisticas} pendência(s) logística(s) não resolvida(s). Configure o SKU e/ou dados logísticos dos produtos antes de iniciar a conferência.`,
        pendenciasLogisticas,
        bloqueio: 'PENDENCIA_LOGISTICA',
      })
    }

    await prisma.notaEntrada.update({ where: { id: notaId }, data: { status: 'EM_CONFERENCIA' } })

    const funcionario = await prisma.funcionario.findFirst({
      where: { OR: [{ usuarioId: user.id }, { nome: { contains: user.nome, mode: 'insensitive' } }] },
    })

    if (funcionario) {
      const osConferencia = await prisma.ordemServicoWms.findFirst({
        where: { empresaId: user.empresaId, notaEntradaId: notaId, operacao: 'CONFERENCIA', status: { in: ['ABERTO', 'EXECUTANDO'] } },
      })
      if (osConferencia) {
        // Vincular funcionário e iniciar OS
        const jaVinculado = await prisma.osFuncionarioWms.findFirst({
          where: { ordemServicoId: osConferencia.id, funcionarioId: funcionario.id },
        })
        if (!jaVinculado) {
          await prisma.osFuncionarioWms.create({
            data: { ordemServicoId: osConferencia.id, funcionarioId: funcionario.id, horaInicio: new Date() },
          })
        }
        await prisma.ordemServicoWms.update({
          where: { id: osConferencia.id },
          data: { status: 'EXECUTANDO', funcionarioId: funcionario.id, horaInicio: osConferencia.horaInicio || new Date() },
        })
      }
    }

    // Atualizar agenda para CONFERINDO
    if (nota.fornecedorDoc) {
      const { hojeUtc, amanhaUtc } = getHojeRange()
      const fornecedor = await prisma.fornecedor.findFirst({
        where: { empresaId: user.empresaId, cnpj: nota.fornecedorDoc },
        select: { id: true },
      })
      if (fornecedor) {
        const agenda = await prisma.agendaWms.findFirst({
          where: {
            empresaId: user.empresaId, fornecedorId: fornecedor.id,
            dataPrevista: { gte: hojeUtc, lt: amanhaUtc },
            status: 'NA_DOCA',
          },
          orderBy: { criadoEm: 'desc' },
        })
        if (agenda) {
          await prisma.agendaWms.update({ where: { id: agenda.id }, data: { status: 'CONFERINDO' } })
        }
      }
    }

    // Retornar itens para conferência cega (sem mostrar qtd esperada)
    // Buscar shelfLifeMinimo dos produtos para alerta no frontend
    const codigosProduto = nota.itens.map(i => i.codigoProduto).filter(Boolean) as string[]
    const produtosShelfLife = codigosProduto.length > 0
      ? await prisma.produto.findMany({
          where: { empresaId: user.empresaId, codigo: { in: codigosProduto } },
          select: { codigo: true, shelfLifeMinimo: true },
        })
      : []
    const shelfLifeMap = new Map(produtosShelfLife.map(p => [p.codigo, p.shelfLifeMinimo]))

    return {
      nota: { id: nota.id, numero: nota.numero, serie: nota.serie, fornecedor: nota.fornecedor, fornecedorDoc: nota.fornecedorDoc, status: 'EM_CONFERENCIA' },
      itens: nota.itens.map((item) => ({
        id: item.id,
        item: item.item,
        descricao: item.descricao,
        codigoProduto: item.codigoProduto,
        unidade: item.unidade,
        // Conferência cega: NÃO mostra quantidade esperada
        lote: item.lote,
        shelfLifeMinimo: item.codigoProduto ? shelfLifeMap.get(item.codigoProduto) ?? null : null,
      })),
    }
  })

  // POST /conferir-item — conferir um item individualmente
  app.post('/conferir-item', async (request, reply) => {
    const userConf = request.user as { id: string; empresaId: string }
    const body = conferirItemSchema.parse(request.body)
    const item = await prisma.itemNotaEntrada.findUnique({ where: { id: body.itemNotaEntradaId } })
    if (!item) return reply.status(404).send({ message: 'Item não encontrado' })

    // Verificar pendências logísticas
    const pendenciasCount = await prisma.pendenciaLogistica.count({
      where: { notaEntradaId: item.notaEntradaId, status: 'PENDENTE', empresaId: userConf.empresaId },
    })
    if (pendenciasCount > 0) {
      return reply.status(422).send({
        message: `Conferência bloqueada: ${pendenciasCount} pendência(s) logística(s) não resolvida(s).`,
        bloqueio: 'PENDENCIA_LOGISTICA',
      })
    }

    // Validação de Shelf Life
    if (body.validade && item.codigoProduto) {
      const produto = await prisma.produto.findFirst({
        where: { empresaId: userConf.empresaId, codigo: item.codigoProduto },
        select: { shelfLifeMinimo: true, nome: true },
      })
      if (produto && produto.shelfLifeMinimo) {
        const resultado = validarShelfLife({
          shelfLifeMinimo: produto.shelfLifeMinimo,
          dataValidade: parseDateBR(body.validade)!,
          dataAtual: new Date(),
          produtoNome: produto.nome,
        })
        if (!resultado.aprovado) {
          return reply.status(422).send({
            message: resultado.mensagem,
            bloqueio: 'SHELF_LIFE',
            diasRestantes: resultado.diasRestantes,
            dataMinima: resultado.dataMinima,
          })
        }
      }
    }

    const quantidadeNota = Number(item.quantidade)
    const divergencia = body.quantidadeConferida - quantidadeNota
    const status = divergencia === 0 ? 'CONFORME' : 'DIVERGENTE'
    const tipoDivergencia = divergencia > 0 ? 'EXCESSO' : divergencia < 0 ? 'FALTA' : null

    await prisma.itemNotaEntrada.update({
      where: { id: body.itemNotaEntradaId },
      data: {
        lote: body.lote || item.lote,
        validade: body.validade ? parseDateBR(body.validade)! : item.validade,
      },
    })

    return {
      itemId: item.id,
      descricao: item.descricao,
      codigoProduto: item.codigoProduto,
      quantidadeNota,
      quantidadeConferida: body.quantidadeConferida,
      divergencia,
      status,
      tipoDivergencia,
    }
  })

  // POST /conferir-todos/:notaId — conferir todos os itens de uma vez
  app.post('/conferir-todos/:notaId', async (request, reply) => {
    const userConf2 = request.user as { id: string; empresaId: string }
    const { notaId } = z.object({ notaId: z.string().uuid() }).parse(request.params)
    const body = conferirTodosSchema.parse(request.body)

    // Verificar pendências logísticas
    const pendenciasCount2 = await prisma.pendenciaLogistica.count({
      where: { notaEntradaId: notaId, status: 'PENDENTE', empresaId: userConf2.empresaId },
    })
    if (pendenciasCount2 > 0) {
      return reply.status(422).send({
        message: `Conferência bloqueada: ${pendenciasCount2} pendência(s) logística(s) não resolvida(s).`,
        bloqueio: 'PENDENCIA_LOGISTICA',
      })
    }

    const nota = await prisma.notaEntrada.findUnique({ where: { id: notaId }, include: { itens: true } })
    if (!nota) return reply.status(404).send({ message: 'Nota não encontrada' })

    const resultados = []
    let temDivergencia = false
    const falhasShelfLife: Array<{ itemId: string; descricao: string; mensagem: string }> = []

    for (const conferido of body.itens) {
      const item = nota.itens.find((i) => i.id === conferido.itemNotaEntradaId)
      if (!item) continue

      // Validação de Shelf Life por item
      if (conferido.validade && item.codigoProduto) {
        const produto = await prisma.produto.findFirst({
          where: { empresaId: userConf2.empresaId, codigo: item.codigoProduto },
          select: { shelfLifeMinimo: true, nome: true },
        })
        if (produto && produto.shelfLifeMinimo) {
          const resultado = validarShelfLife({
            shelfLifeMinimo: produto.shelfLifeMinimo,
            dataValidade: parseDateBR(conferido.validade)!,
            dataAtual: new Date(),
            produtoNome: produto.nome,
          })
          if (!resultado.aprovado) {
            falhasShelfLife.push({
              itemId: item.id,
              descricao: item.descricao,
              mensagem: resultado.mensagem!,
            })
            continue // Skip this item
          }
        }
      }

      const quantidadeNota = Number(item.quantidade)
      const divergencia = conferido.quantidadeConferida - quantidadeNota
      const status = divergencia === 0 ? 'CONFORME' : 'DIVERGENTE'
      if (divergencia !== 0) temDivergencia = true

      await prisma.itemNotaEntrada.update({
        where: { id: item.id },
        data: {
          lote: conferido.lote || item.lote,
          validade: conferido.validade ? parseDateBR(conferido.validade)! : item.validade,
        },
      })

      resultados.push({
        itemId: item.id,
        descricao: item.descricao,
        quantidadeNota,
        quantidadeConferida: conferido.quantidadeConferida,
        divergencia,
        status,
        tipoDivergencia: divergencia > 0 ? 'EXCESSO' : divergencia < 0 ? 'FALTA' : null,
      })
    }

    return {
      notaId,
      temDivergencia,
      totalItens: resultados.length,
      conformes: resultados.filter((r) => r.status === 'CONFORME').length,
      divergentes: resultados.filter((r) => r.status === 'DIVERGENTE').length,
      itens: resultados,
      falhasShelfLife: falhasShelfLife.length > 0 ? falhasShelfLife : undefined,
    }
  })

  // POST /confirmar/:notaId — aprovar conferência (com ou sem divergência)
  // Body opcional: { acaoDivergencia: 'APROVAR' | 'GERAR_DEVOLUCAO', observacao: string }
  app.post('/confirmar/:notaId', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { notaId } = z.object({ notaId: z.string().uuid() }).parse(request.params)

    const bodySchema = z.object({
      acaoDivergencia: z.enum(['APROVAR', 'GERAR_DEVOLUCAO']).optional().default('APROVAR'),
      observacao: z.string().optional(),
    }).optional()
    const body = bodySchema.parse(request.body) || { acaoDivergencia: 'APROVAR' }

    const nota = await prisma.notaEntrada.findUnique({ where: { id: notaId }, include: { itens: true } })
    if (!nota) return reply.status(404).send({ message: 'Nota não encontrada' })

    await prisma.$transaction(async (tx) => {
      await tx.notaEntrada.update({
        where: { id: notaId },
        data: { status: 'CONFERIDA' },
      })

      // Fechar OS de conferência e criar OS de endereçamento
      const osConferencia = await tx.ordemServicoWms.findFirst({
        where: { empresaId: user.empresaId, notaEntradaId: notaId, operacao: 'CONFERENCIA', status: { in: ['ABERTO', 'EXECUTANDO'] } },
      })
      if (osConferencia) {
        await tx.ordemServicoWms.update({
          where: { id: osConferencia.id },
          data: { status: 'CONCLUIDO', horaFim: new Date() },
        })
      }

      // Criar OS de Endereçamento
      const ultimaOs = await tx.ordemServicoWms.findFirst({
        where: { empresaId: user.empresaId },
        orderBy: { numero: 'desc' },
        select: { numero: true },
      })
      await tx.ordemServicoWms.create({
        data: {
          empresaId: user.empresaId,
          numero: (ultimaOs?.numero ?? 0) + 1,
          tipo: 'ENTRADA',
          operacao: 'ENDERECAMENTO',
          status: 'ABERTO',
          notaEntradaId: notaId,
          agendaWmsId: osConferencia?.agendaWmsId || null,
        },
      })

      // Atualizar agenda WMS para CONFERIDO
      if (nota.fornecedorDoc) {
        const { hojeUtc, amanhaUtc } = getHojeRange()
        const fornecedor = await tx.fornecedor.findFirst({
          where: { empresaId: user.empresaId, cnpj: nota.fornecedorDoc },
          select: { id: true },
        })
        if (fornecedor) {
          const agenda = await tx.agendaWms.findFirst({
            where: {
              empresaId: user.empresaId, fornecedorId: fornecedor.id,
              dataPrevista: { gte: hojeUtc, lt: amanhaUtc },
              status: { in: ['NA_DOCA', 'CONFERINDO'] },
            },
            orderBy: { criadoEm: 'desc' },
          })
          if (agenda) {
            await tx.agendaWms.update({ where: { id: agenda.id }, data: { status: 'CONFERIDO' } })
          }
        }
      }
    })

    return { message: 'Conferência confirmada — OS de endereçamento criada' }
  })

  // POST /rejeitar/:notaId — rejeitar conferência (volta para recontar)
  app.post('/rejeitar/:notaId', async (request, reply) => {
    const { notaId } = z.object({ notaId: z.string().uuid() }).parse(request.params)
    const bodySchema = z.object({ motivo: z.string().optional() }).optional()
    const body = bodySchema.parse(request.body)

    const nota = await prisma.notaEntrada.findUnique({ where: { id: notaId } })
    if (!nota) return reply.status(404).send({ message: 'Nota não encontrada' })

    // Rejeitar = volta para PENDENTE para recontar
    await prisma.notaEntrada.update({
      where: { id: notaId },
      data: { status: 'PENDENTE' },
    })

    return { message: 'Conferência rejeitada — nota voltou para recontagem' }
  })

  // GET /notas-conferidas — notas conferidas pendentes de endereçamento
  app.get('/notas-conferidas', async () => {
    const notas = await prisma.notaEntrada.findMany({
      where: { status: 'CONFERIDA' },
      orderBy: { criadoEm: 'desc' },
      include: { itens: true },
    })
    return {
      data: notas.map((n) => ({
        ...n,
        itens: n.itens.map((item) => ({
          id: item.id,
          item: item.item,
          descricao: item.descricao,
          codigoProduto: item.codigoProduto,
          unidade: item.unidade,
          quantidade: Number(item.quantidade),
        })),
      })),
      total: notas.length,
    }
  })

  // GET /notas-enderecadas — notas já endereçadas
  app.get('/notas-enderecadas', async () => {
    const notas = await prisma.notaEntrada.findMany({
      where: { status: 'ENDERECADA' },
      orderBy: { criadoEm: 'desc' },
      include: { itens: true },
    })
    return {
      data: notas.map((n) => ({
        ...n,
        itens: n.itens.map((item) => ({
          id: item.id,
          item: item.item,
          descricao: item.descricao,
          codigoProduto: item.codigoProduto,
          unidade: item.unidade,
          quantidade: Number(item.quantidade),
        })),
      })),
      total: notas.length,
    }
  })

  // GET /notas-conferidas-e-enderecadas — todas as notas conferidas + endereçadas (para aba Conferidas)
  app.get('/notas-conferidas-todas', async () => {
    const notas = await prisma.notaEntrada.findMany({
      where: { status: { in: ['CONFERIDA', 'ENDERECADA'] } },
      orderBy: { criadoEm: 'desc' },
      include: { itens: true },
    })
    return {
      data: notas.map((n) => ({
        ...n,
        itens: n.itens.map((item) => ({
          id: item.id,
          item: item.item,
          descricao: item.descricao,
          codigoProduto: item.codigoProduto,
          unidade: item.unidade,
          quantidade: Number(item.quantidade),
        })),
      })),
      total: notas.length,
    }
  })

  // POST /enderecamento-automatico/:notaId
  app.post('/enderecamento-automatico/:notaId', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { notaId } = z.object({ notaId: z.string().uuid() }).parse(request.params)
    const body = z.object({ confirmar: z.boolean().default(false) }).parse(request.body || {})

    const nota = await prisma.notaEntrada.findUnique({ where: { id: notaId }, include: { itens: true } })
    if (!nota) return reply.status(404).send({ message: 'Nota não encontrada' })
    if (nota.status !== 'CONFERIDA') return reply.status(422).send({ message: 'Nota não está conferida' })

    const resultados: any[] = []

    // Calcular distribuição para cada item
    const distribuicoes: any[] = []

    for (const item of nota.itens) {
      const produto = await prisma.produto.findFirst({
        where: { empresaId: user.empresaId, codigo: item.codigoProduto || '' },
      })
      if (!produto) continue

      const skusRaw = await prisma.sku.findMany({
        where: { produtoId: produto.id },
        orderBy: { sequencia: 'asc' },
      })

      const skus: SkuInfo[] = skusRaw.map((s) => ({
        id: s.id, sequencia: s.sequencia, qtdEmbalagem: s.qtdEmbalagem, lastro: s.lastro, camada: s.camada,
      }))

      let skuMaster: SkuInfo | null = null
      try { skuMaster = selecionarSkuMaster(skus) } catch { /* sem SKU master */ }

      const quantidade = Number(item.quantidade)

      if (!skuMaster) {
        // Fallback: tudo em um endereço
        const enderecoLivre = await prisma.endereco.findFirst({
          where: { tipo: { in: ['ARMAZENAGEM', 'LIVRE'] }, status: true, saldos: { none: { quantidade: { gt: 0 } } } },
          orderBy: [{ codigoRua: 'asc' }, { codigoPredio: 'asc' }, { codigoNivel: 'asc' }, { codigoApto: 'asc' }],
        })
        if (enderecoLivre) {
          distribuicoes.push({
            produto: produto.nome, produtoId: produto.id, lote: item.lote, validade: item.validade,
            alocacoes: [{ enderecoId: enderecoLivre.id, enderecoCompleto: enderecoLivre.enderecoCompleto, quantidadeAlocada: quantidade }],
          })
        }
        continue
      }

      const capacidadePalete = calcularCapacidadePalete(skuMaster.lastro, skuMaster.camada, null)

      const enderecosLivres = await prisma.endereco.findMany({
        where: { tipo: { in: ['ARMAZENAGEM', 'LIVRE'] }, status: true, saldos: { none: { quantidade: { gt: 0 } } } },
        orderBy: [{ codigoRua: 'asc' }, { codigoPredio: 'asc' }, { codigoNivel: 'asc' }, { codigoApto: 'asc' }],
      })

      const enderecosComCapacidade: EnderecoComCapacidade[] = enderecosLivres.map((e) => ({
        id: e.id, enderecoCompleto: e.enderecoCompleto ?? '', rua: e.codigoRua ?? '',
        predio: e.codigoPredio ?? '', nivel: e.codigoNivel ?? '', apartamento: e.codigoApto ?? '',
        capacidadePalete, saldoAtual: 0, disponivel: capacidadePalete,
      }))

      const distribuicao = calcularDistribuicao({ quantidade, enderecosOrdenados: enderecosComCapacidade })

      distribuicoes.push({
        produto: produto.nome, produtoId: produto.id, lote: item.lote, validade: item.validade,
        alocacoes: distribuicao.alocacoes, quantidadeRestante: distribuicao.quantidadeRestante, completa: distribuicao.completa,
      })
    }

    // Se não é confirmação, retornar apenas a simulação
    if (!body.confirmar) {
      return { simulacao: true, distribuicoes }
    }

    // Confirmar: gravar no banco
    await prisma.$transaction(async (tx) => {
      for (const dist of distribuicoes) {
        for (const alocacao of dist.alocacoes) {
          await tx.saldoEndereco.create({
            data: { enderecoId: alocacao.enderecoId, produtoId: dist.produtoId, quantidade: alocacao.quantidadeAlocada, lote: dist.lote || undefined, validade: dist.validade || undefined },
          })
          resultados.push({ produto: dist.produto, quantidade: alocacao.quantidadeAlocada, endereco: alocacao.enderecoCompleto })
        }
        const totalAlocado = dist.alocacoes.reduce((acc: number, a: any) => acc + a.quantidadeAlocada, 0)
        if (totalAlocado > 0) {
          await tx.estoque.upsert({
            where: { empresaId_produtoId: { empresaId: user.empresaId, produtoId: dist.produtoId } },
            update: { quantidade: { increment: totalAlocado } },
            create: { empresaId: user.empresaId, produtoId: dist.produtoId, quantidade: totalAlocado },
          })
        }
      }

      await tx.notaEntrada.update({ where: { id: notaId }, data: { status: 'ENDERECADA' } })

      const osEnd = await tx.ordemServicoWms.findFirst({
        where: { notaEntradaId: notaId, operacao: 'ENDERECAMENTO', status: { in: ['ABERTO', 'EXECUTANDO'] } },
        orderBy: { criadoEm: 'desc' },
      })
      if (osEnd) {
        const horaFim = new Date()
        await tx.ordemServicoWms.update({ where: { id: osEnd.id }, data: { status: 'CONCLUIDO', horaInicio: osEnd.horaInicio || horaFim, horaFim } })
      }
    })

    return { message: 'Endereçamento automático concluído', itens: resultados }
  })

  // POST /enderecamento-manual
  app.post('/enderecamento-manual', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = enderecamentoItemSchema.parse(request.body)

    const item = await prisma.itemNotaEntrada.findUnique({ where: { id: body.itemNotaEntradaId } })
    if (!item) return reply.status(404).send({ message: 'Item não encontrado' })

    const endereco = await prisma.endereco.findUnique({ where: { id: body.enderecoId } })
    if (!endereco) return reply.status(404).send({ message: 'Endereço não encontrado' })

    const produto = await prisma.produto.findFirst({
      where: { empresaId: user.empresaId, codigo: item.codigoProduto || '' },
    })
    if (!produto) return reply.status(404).send({ message: 'Produto não encontrado' })

    // Validate level capacity for manual addressing
    if (endereco.estruturaId && endereco.codigoNivel) {
      const capacidadeNivel = await prisma.capacidadeNivel.findFirst({
        where: { estruturaId: endereco.estruturaId, codigoNivel: endereco.codigoNivel, status: true },
      })
      if (capacidadeNivel) {
        const enderecosNivel = await prisma.endereco.findMany({
          where: { estruturaId: endereco.estruturaId, codigoNivel: endereco.codigoNivel, status: true },
          select: { id: true },
        })
        const enderecoIdsNivel = enderecosNivel.map((e) => e.id)
        const saldosNivel = await prisma.saldoEndereco.findMany({
          where: { enderecoId: { in: enderecoIdsNivel }, quantidade: { gt: 0 } },
        })
        const saldosComSku = await Promise.all(
          saldosNivel.map(async (s) => {
            const sku = await prisma.sku.findFirst({
              where: { produtoId: s.produtoId },
              select: { pesoBruto: true, volume: true },
            })
            return {
              quantidade: Number(s.quantidade),
              pesoBruto: sku?.pesoBruto ? Number(sku.pesoBruto) : null,
              volume: sku?.volume ? Number(sku.volume) : null,
            }
          })
        )
        const ocupacaoAtual = calcularOcupacaoNivel(saldosComSku)
        const skuIncoming = await prisma.sku.findFirst({
          where: { produtoId: produto.id },
          select: { pesoBruto: true, volume: true },
        })
        const pesoIncoming = (skuIncoming?.pesoBruto ? Number(skuIncoming.pesoBruto) : 0) * body.quantidade
        const volumeIncoming = (skuIncoming?.volume ? Number(skuIncoming.volume) : 0) * body.quantidade

        const validacaoNivel = validarCapacidadeNivel({
          config: {
            pesoMaximo: capacidadeNivel.pesoMaximo ? Number(capacidadeNivel.pesoMaximo) : null,
            volumeMaximo: capacidadeNivel.volumeMaximo ? Number(capacidadeNivel.volumeMaximo) : null,
            paletesMaximo: capacidadeNivel.paletesMaximo,
          },
          ocupacaoAtual,
          pesoIncoming,
          volumeIncoming,
          paletesIncoming: 1,
        })

        if (!validacaoNivel.permitido) {
          return reply.status(422).send({ message: validacaoNivel.motivo })
        }
      }
    }

    await prisma.$transaction(async (tx) => {
      const saldoExistente = await tx.saldoEndereco.findFirst({
        where: { enderecoId: body.enderecoId, produtoId: produto.id },
      })

      if (saldoExistente) {
        await tx.saldoEndereco.update({ where: { id: saldoExistente.id }, data: { quantidade: { increment: body.quantidade } } })
      } else {
        await tx.saldoEndereco.create({
          data: { enderecoId: body.enderecoId, produtoId: produto.id, quantidade: body.quantidade, lote: body.lote || undefined },
        })
      }

      await tx.estoque.upsert({
        where: { empresaId_produtoId: { empresaId: user.empresaId, produtoId: produto.id } },
        update: { quantidade: { increment: body.quantidade } },
        create: { empresaId: user.empresaId, produtoId: produto.id, quantidade: body.quantidade },
      })
    })

    return { message: 'Item endereçado', endereco: endereco.enderecoCompleto, quantidade: body.quantidade }
  })

  // GET /enderecos-livres
  app.get('/enderecos-livres', async () => {
    const enderecos = await prisma.endereco.findMany({
      where: { tipo: 'ARMAZENAGEM', status: true },
      orderBy: [{ codigoRua: 'asc' }, { codigoPredio: 'asc' }, { codigoNivel: 'asc' }, { codigoApto: 'asc' }],
      include: { saldos: { where: { quantidade: { gt: 0 } }, select: { quantidade: true } } },
    })

    return enderecos.map((e) => ({
      id: e.id,
      enderecoCompleto: e.enderecoCompleto,
      rua: e.codigoRua,
      predio: e.codigoPredio,
      nivel: e.codigoNivel,
      apto: e.codigoApto,
      ocupado: e.saldos.length > 0,
      quantidadeTotal: e.saldos.reduce((s, sal) => s + Number(sal.quantidade), 0),
    }))
  })
}

