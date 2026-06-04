import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'

const idSchema = z.object({ id: z.string().uuid() })

export async function etapaOperacionalRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('PCP'))

  // =========================================================================
  // PATCH /api/pcp/etapas/:id/iniciar — Operador inicia a etapa
  // =========================================================================
  app.patch('/etapas/:id/iniciar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idSchema.parse(request.params)
    const body = z.object({ funcionarioId: z.string().uuid().optional() }).parse(request.body)

    const etapa = await prisma.etapaOrdemProducao.findFirst({ where: { id } })
    if (!etapa) return reply.status(404).send({ message: 'Etapa não encontrada' })

    if (!['PENDENTE', 'PAUSADA'].includes(etapa.status)) {
      return reply.status(400).send({ message: `Etapa não pode ser iniciada. Status atual: ${etapa.status}` })
    }

    const agora = new Date()
    const atualizada = await prisma.etapaOrdemProducao.update({
      where: { id },
      data: {
        status: 'EM_ANDAMENTO',
        dataInicioReal: etapa.dataInicioReal || agora,
        funcionarioId: body.funcionarioId || user.id,
      },
    })

    // Registra apontamento de retomada se estava pausada
    if (etapa.status === 'PAUSADA') {
      await prisma.apontamentoEtapa.create({
        data: { etapaOrdemProducaoId: id, empresaId: user.empresaId, funcionarioId: body.funcionarioId, tipo: 'RETOMADA' },
      })
    }

    return atualizada
  })

  // =========================================================================
  // PATCH /api/pcp/etapas/:id/pausar — Pausa a etapa (parada de máquina)
  // =========================================================================
  app.patch('/etapas/:id/pausar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idSchema.parse(request.params)
    const body = z.object({
      motivoParada: z.enum(['MANUTENCAO', 'FALTA_MATERIAL', 'ACERTO_MAQUINA', 'TROCA_TURNO', 'OUTRO']),
      observacao: z.string().optional(),
    }).parse(request.body)

    const etapa = await prisma.etapaOrdemProducao.findFirst({ where: { id } })
    if (!etapa) return reply.status(404).send({ message: 'Etapa não encontrada' })

    if (etapa.status !== 'EM_ANDAMENTO') {
      return reply.status(400).send({ message: 'Só é possível pausar etapa em andamento' })
    }

    await prisma.etapaOrdemProducao.update({ where: { id }, data: { status: 'PAUSADA' } })

    await prisma.apontamentoEtapa.create({
      data: {
        etapaOrdemProducaoId: id,
        empresaId: user.empresaId,
        funcionarioId: etapa.funcionarioId,
        tipo: 'PARADA',
        motivoParada: body.motivoParada,
        observacao: body.observacao,
      },
    })

    return { message: 'Etapa pausada', motivo: body.motivoParada }
  })

  // =========================================================================
  // POST /api/pcp/etapas/:id/apontar — Registra produção parcial
  // =========================================================================
  app.post('/etapas/:id/apontar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idSchema.parse(request.params)
    const body = z.object({
      quantidadeProduzida: z.number().min(0).default(0),
      quantidadePerda: z.number().min(0).default(0),
      motivoPerda: z.enum(['ACERTO', 'REFUGO', 'DEFEITO', 'APARA']).optional(),
      funcionarioId: z.string().uuid().optional(),
      observacao: z.string().optional(),
    }).parse(request.body)

    const etapa = await prisma.etapaOrdemProducao.findFirst({ where: { id } })
    if (!etapa) return reply.status(404).send({ message: 'Etapa não encontrada' })

    if (!['EM_ANDAMENTO', 'PAUSADA'].includes(etapa.status)) {
      return reply.status(400).send({ message: 'Etapa precisa estar em andamento ou pausada para apontar' })
    }

    // Registra apontamento
    const apontamento = await prisma.apontamentoEtapa.create({
      data: {
        etapaOrdemProducaoId: id,
        empresaId: user.empresaId,
        funcionarioId: body.funcionarioId || etapa.funcionarioId,
        tipo: body.quantidadePerda > 0 ? 'PERDA' : 'PRODUCAO',
        quantidadeProduzida: body.quantidadeProduzida,
        quantidadePerda: body.quantidadePerda,
        motivoPerda: body.motivoPerda,
        observacao: body.observacao,
      },
    })

    // Atualiza totais na etapa
    await prisma.etapaOrdemProducao.update({
      where: { id },
      data: {
        quantidadeProduzida: { increment: body.quantidadeProduzida },
        quantidadePerda: { increment: body.quantidadePerda },
      },
    })

    return reply.status(201).send(apontamento)
  })

  // =========================================================================
  // PATCH /api/pcp/etapas/:id/concluir — Finaliza a etapa
  // =========================================================================
  app.patch('/etapas/:id/concluir', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idSchema.parse(request.params)

    const etapa = await prisma.etapaOrdemProducao.findFirst({
      where: { id },
      include: { ordemProducao: { select: { id: true, empresaId: true, produtoId: true, quantidade: true, numero: true, lote: true } } },
    })
    if (!etapa) return reply.status(404).send({ message: 'Etapa não encontrada' })

    if (!['EM_ANDAMENTO', 'PAUSADA'].includes(etapa.status)) {
      return reply.status(400).send({ message: 'Etapa precisa estar em andamento para concluir' })
    }

    const agora = new Date()
    const tempoRealMs = etapa.dataInicioReal ? agora.getTime() - new Date(etapa.dataInicioReal).getTime() : 0
    const tempoRealMin = Math.round(tempoRealMs / 60000)

    const atualizada = await prisma.etapaOrdemProducao.update({
      where: { id },
      data: { status: 'CONCLUIDA', dataFimReal: agora },
    })

    // Verifica se TODAS as etapas da OP estão concluídas → entrada de PA no WMS
    let entradaWms = null
    const todasEtapas = await prisma.etapaOrdemProducao.findMany({
      where: { ordemProducaoId: etapa.ordemProducaoId },
      select: { status: true },
    })

    const todasConcluidas = todasEtapas.every(e => e.status === 'CONCLUIDA')

    if (todasConcluidas) {
      try {
        const empresa = await prisma.empresa.findUnique({ where: { id: user.empresaId } })

        if (empresa?.usaWms) {
          // Cria Nota de Entrada tipo PRODUCAO (PA entra no estoque WMS)
          const ultimaNota = await prisma.notaEntrada.findFirst({
            where: { empresaId: user.empresaId },
            orderBy: { numero: 'desc' },
            select: { numero: true },
          })

          const produto = await prisma.produto.findFirst({
            where: { id: etapa.ordemProducao.produtoId },
            select: { codigo: true, nome: true, unidade: true },
          })

          const nota = await prisma.notaEntrada.create({
            data: {
              numero: (ultimaNota?.numero ?? 900000) + 1,
              serie: 'PRD',
              fornecedor: 'PRODUÇÃO INTERNA',
              fornecedorDoc: user.empresaId.substring(0, 14),
              dataEmissao: agora,
              dataEntrada: agora,
              tipo: 'PRODUCAO',
              status: 'PENDENTE',
              empresaId: user.empresaId,
              itens: {
                create: [{
                  item: 1,
                  descricao: `${produto?.codigo || ''} - ${produto?.nome || 'Produto Acabado'}`,
                  codigoProduto: produto?.codigo || '',
                  unidade: produto?.unidade || 'UN',
                  quantidade: Number(etapa.ordemProducao.quantidade),
                  lote: etapa.ordemProducao.lote || null,
                }],
              },
            },
          })

          entradaWms = { notaEntradaId: nota.id, numero: nota.numero, status: 'PENDENTE' }

          // Atualiza OP para CONCLUIDA
          await prisma.ordemProducao.update({
            where: { id: etapa.ordemProducaoId },
            data: { status: 'CONCLUIDA', dataFimReal: agora },
          })

          await prisma.logOrdemProducao.create({
            data: {
              ordemProducaoId: etapa.ordemProducaoId,
              statusAnterior: 'EM_PRODUCAO',
              statusNovo: 'CONCLUIDA',
              usuarioId: user.id,
              observacao: `Todas as etapas concluídas. Nota de entrada #${nota.numero} criada no WMS.`,
            },
          })
        }
      } catch (err) {
        console.error('[PCP→WMS] Erro ao criar entrada de PA:', err)
      }
    }

    return { ...atualizada, tempoRealMinutos: tempoRealMin, todasConcluidas, entradaWms }
  })

  // =========================================================================
  // POST /api/pcp/etapas/:id/desmembrar — Divide quantidade entre máquinas
  // =========================================================================
  app.post('/etapas/:id/desmembrar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idSchema.parse(request.params)
    const body = z.object({
      partes: z.array(z.object({
        centroProducaoId: z.string().uuid(),
        quantidade: z.number().positive(),
        observacao: z.string().optional(),
      })).min(2, 'Informe pelo menos 2 partes para desmembrar'),
    }).parse(request.body)

    const etapa = await prisma.etapaOrdemProducao.findFirst({
      where: { id },
      include: { ordemProducao: { select: { empresaId: true, quantidade: true } } },
    })

    if (!etapa) return reply.status(404).send({ message: 'Etapa não encontrada' })
    if (etapa.ordemProducao.empresaId !== user.empresaId) return reply.status(403).send({ message: 'Sem acesso' })

    if (etapa.status !== 'PENDENTE') {
      return reply.status(400).send({ message: 'Só é possível desmembrar etapas com status PENDENTE' })
    }

    // Valida que a soma das partes = quantidade da OP
    const somaPartes = body.partes.reduce((acc, p) => acc + p.quantidade, 0)
    const qtdOp = Number(etapa.ordemProducao.quantidade)

    if (Math.abs(somaPartes - qtdOp) > 0.01) {
      return reply.status(400).send({
        message: `A soma das partes (${somaPartes}) deve ser igual à quantidade da OP (${qtdOp})`,
      })
    }

    // Remove a etapa original
    await prisma.etapaOrdemProducao.delete({ where: { id } })

    // Cria as novas etapas (uma por parte)
    const novasEtapas = []
    for (let i = 0; i < body.partes.length; i++) {
      const parte = body.partes[i]

      // Busca nome do centro
      const centro = await prisma.centroProducao.findFirst({
        where: { id: parte.centroProducaoId, empresaId: user.empresaId },
        select: { codigo: true, descricao: true },
      })

      const nova = await prisma.etapaOrdemProducao.create({
        data: {
          ordemProducaoId: etapa.ordemProducaoId,
          sequencia: etapa.sequencia * 10 + i + 1, // ex: seq 3 vira 31, 32
          descricao: `${etapa.descricao} [${centro?.codigo || 'PARTE'}${i + 1}] (${parte.quantidade} un)`,
          centroProducaoId: parte.centroProducaoId,
          tempoSetupMinutos: Number(etapa.tempoSetupMinutos),
          tempoOperacaoCalculado: Math.round(Number(etapa.tempoOperacaoCalculado) * (parte.quantidade / qtdOp) * 100) / 100,
          tempoEsperaMinutos: Number(etapa.tempoEsperaMinutos),
          quantidadePrevista: parte.quantidade,
          status: 'PENDENTE',
          observacaoOperador: parte.observacao || null,
        },
      })

      novasEtapas.push(nova)
    }

    return reply.status(201).send({
      message: `Etapa desmembrada em ${novasEtapas.length} partes`,
      etapaOriginalId: id,
      novasEtapas: novasEtapas.map(e => ({ id: e.id, descricao: e.descricao, quantidade: Number(e.quantidadePrevista) })),
    })
  })

  // =========================================================================
  // GET /api/pcp/etapas/:id/apontamentos — Histórico de apontamentos
  // =========================================================================
  app.get('/etapas/:id/apontamentos', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idSchema.parse(request.params)

    const apontamentos = await prisma.apontamentoEtapa.findMany({
      where: { etapaOrdemProducaoId: id, empresaId: user.empresaId },
      orderBy: { dataHora: 'desc' },
    })

    const totais = {
      totalProduzido: apontamentos.reduce((acc, a) => acc + Number(a.quantidadeProduzida), 0),
      totalPerda: apontamentos.reduce((acc, a) => acc + Number(a.quantidadePerda), 0),
      totalParadas: apontamentos.filter(a => a.tipo === 'PARADA').length,
      tempoParadaTotal: apontamentos.reduce((acc, a) => acc + (a.tempoParadaMinutos || 0), 0),
    }

    return { etapaId: id, apontamentos, totais }
  })

  // =========================================================================
  // GET /api/pcp/programacao/painel — Painel operacional completo
  // =========================================================================
  app.get('/programacao/painel', async (request) => {
    const user = request.user as { id: string; empresaId: string }

    const centros = await prisma.centroProducao.findMany({
      where: { empresaId: user.empresaId, status: true },
      orderBy: { codigo: 'asc' },
    })

    const etapasAtivas = await prisma.etapaOrdemProducao.findMany({
      where: {
        ordemProducao: { empresaId: user.empresaId, status: { in: ['PROGRAMADA', 'LIBERADA', 'EM_PRODUCAO'] } },
        status: { in: ['PENDENTE', 'EM_ANDAMENTO', 'PAUSADA'] },
      },
      include: {
        ordemProducao: { select: { numero: true, produtoId: true, quantidade: true, unidadeMedida: true, prioridade: true, dataEntregaPrevista: true, clienteId: true, observacoes: true } },
        centroProducao: { select: { id: true, codigo: true, descricao: true } },
      },
      orderBy: [{ ordemProducao: { prioridade: 'desc' } }, { sequencia: 'asc' }],
    })

    // Agrupa por centro
    const painelPorCentro = centros.map(centro => {
      const etapasDoCentro = etapasAtivas.filter(e => e.centroProducaoId === centro.id)

      const emAndamento = etapasDoCentro.filter(e => e.status === 'EM_ANDAMENTO')
      const pausadas = etapasDoCentro.filter(e => e.status === 'PAUSADA')
      const pendentes = etapasDoCentro.filter(e => e.status === 'PENDENTE')

      return {
        centro: { id: centro.id, codigo: centro.codigo, descricao: centro.descricao, tipo: centro.tipo },
        resumo: {
          emAndamento: emAndamento.length,
          pausadas: pausadas.length,
          pendentes: pendentes.length,
          total: etapasDoCentro.length,
        },
        etapas: etapasDoCentro.map(e => ({
          id: e.id,
          opNumero: e.ordemProducao.numero,
          descricao: e.descricao,
          status: e.status,
          sequencia: e.sequencia,
          quantidade: Number(e.ordemProducao.quantidade),
          unidade: e.ordemProducao.unidadeMedida,
          quantidadeProduzida: Number(e.quantidadeProduzida),
          quantidadePerda: Number(e.quantidadePerda),
          percentual: Number(e.ordemProducao.quantidade) > 0 ? Math.round((Number(e.quantidadeProduzida) / Number(e.ordemProducao.quantidade)) * 100) : 0,
          prioridade: e.ordemProducao.prioridade,
          dataEntrega: e.ordemProducao.dataEntregaPrevista,
          funcionarioId: e.funcionarioId,
          dataInicioReal: e.dataInicioReal,
          observacoes: e.ordemProducao.observacoes,
        })),
      }
    })

    return { centros: painelPorCentro }
  })
}
