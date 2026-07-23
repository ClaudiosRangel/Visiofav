import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { extrairTextoPdf } from './importacao-op/pdf-extractor.service'
import { isGprintPdf, parseGprintPdf } from './importacao-op/parsers/gprint-parser'
import { getOpPdfPath, carregarOpPdf } from '../../lib/storage'
import { proximoNumeroOp } from '../ordem-producao/ordem-producao.service'

const idSchema = z.object({ id: z.string().uuid() })

export async function etapaOperacionalRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('PCP'))

  // =========================================================================
  // PATCH /api/pcp/etapas/reordenar — Reordena etapas na fila de uma máquina
  // =========================================================================
  app.patch('/etapas/reordenar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = z.object({
      centroProducaoId: z.string().uuid(),
      etapaIds: z.array(z.string().uuid()).min(1),
    }).parse(request.body)

    // Verify all etapas belong to this empresa and centro
    const etapas = await prisma.etapaOrdemProducao.findMany({
      where: {
        id: { in: body.etapaIds },
        centroProducaoId: body.centroProducaoId,
        ordemProducao: { empresaId: user.empresaId },
      },
    })

    if (etapas.length !== body.etapaIds.length) {
      return reply.status(400).send({ message: 'Uma ou mais etapas não pertencem ao centro informado' })
    }

    // Update posicaoFila for each etapa based on array order
    const updates = body.etapaIds.map((id, index) =>
      prisma.etapaOrdemProducao.update({ where: { id }, data: { posicaoFila: index + 1 } })
    )
    await prisma.$transaction(updates)

    return { success: true, reordenadas: body.etapaIds.length }
  })

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
  // DELETE /api/pcp/etapas/:id/reverter-parte — Remove parte desmembrada e soma qtd na irmã
  // =========================================================================
  app.delete('/etapas/:id/reverter-parte', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idSchema.parse(request.params)

    const etapa = await prisma.etapaOrdemProducao.findFirst({
      where: { id, ordemProducao: { empresaId: user.empresaId } },
    })
    if (!etapa) return reply.status(404).send({ message: 'Etapa não encontrada' })
    if (etapa.status !== 'PENDENTE') return reply.status(400).send({ message: 'Só é possível reverter etapas PENDENTES' })
    if (Number(etapa.quantidadePrevista) <= 0) return reply.status(400).send({ message: 'Esta etapa não é resultado de desmembramento' })

    // Buscar etapa "irmã" (mesma OP, quantidadePrevista > 0, diferente desta)
    const irma = await prisma.etapaOrdemProducao.findFirst({
      where: {
        ordemProducaoId: etapa.ordemProducaoId,
        id: { not: id },
        quantidadePrevista: { gt: 0 },
        status: 'PENDENTE',
      },
    })

    if (irma) {
      // Soma a quantidade na irmã
      await prisma.etapaOrdemProducao.update({
        where: { id: irma.id },
        data: { quantidadePrevista: Number(irma.quantidadePrevista) + Number(etapa.quantidadePrevista) },
      })
    }

    // Remove a etapa
    await prisma.etapaOrdemProducao.delete({ where: { id } })

    return { message: 'Parte removida', quantidadeDevolvida: Number(etapa.quantidadePrevista), etapaIrmaId: irma?.id || null }
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
  // PATCH /api/pcp/etapas/:id/observacao — Atualiza observação do operador (inline)
  // =========================================================================
  app.patch('/etapas/:id/observacao', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idSchema.parse(request.params)
    const body = z.object({ observacaoOperador: z.string().max(500) }).parse(request.body)

    const etapa = await prisma.etapaOrdemProducao.findFirst({
      where: { id, ordemProducao: { empresaId: user.empresaId } },
    })
    if (!etapa) return reply.status(404).send({ message: 'Etapa não encontrada' })

    const atualizada = await prisma.etapaOrdemProducao.update({
      where: { id },
      data: { observacaoOperador: body.observacaoOperador },
    })

    return { id: atualizada.id, observacaoOperador: atualizada.observacaoOperador }
  })

  // =========================================================================
  // DELETE /api/pcp/etapas/:id — Exclui etapa manual
  // =========================================================================
  app.delete('/etapas/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idSchema.parse(request.params)

    const etapa = await prisma.etapaOrdemProducao.findFirst({
      where: { id, ordemProducao: { empresaId: user.empresaId } },
    })
    if (!etapa) return reply.status(404).send({ message: 'Etapa não encontrada' })
    if (etapa.status !== 'PENDENTE') return reply.status(400).send({ message: 'Só é possível excluir etapas PENDENTES' })

    // Só permite excluir manuais ou desmembradas
    const isManual = etapa.descricao.includes('[MANUAL]') || etapa.descricao.startsWith('Lançamento manual')
    const isDesmembramento = Number(etapa.quantidadePrevista) > 0
    if (!isManual && !isDesmembramento) {
      return reply.status(400).send({ message: 'Só é possível excluir etapas adicionadas manualmente ou desmembradas' })
    }

    await prisma.etapaOrdemProducao.delete({ where: { id } })
    return { message: 'Etapa excluída' }
  })

  // =========================================================================
  // DELETE /api/pcp/etapas/:id/reverter-desmembramento — Remove parte desmembrada e soma quantidade na irmã
  // =========================================================================
  app.delete('/etapas/:id/reverter-desmembramento', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idSchema.parse(request.params)

    const etapa = await prisma.etapaOrdemProducao.findFirst({
      where: { id, ordemProducao: { empresaId: user.empresaId } },
    })
    if (!etapa) return reply.status(404).send({ message: 'Etapa não encontrada' })
    if (Number(etapa.quantidadePrevista) <= 0) {
      return reply.status(400).send({ message: 'Esta etapa não é um desmembramento' })
    }
    if (etapa.status !== 'PENDENTE') {
      return reply.status(400).send({ message: 'Só é possível reverter etapas PENDENTES' })
    }

    const quantidadeDevolvida = Number(etapa.quantidadePrevista)

    // Buscar etapas irmãs (mesma OP, mesmo centro, com quantidadePrevista > 0, exceto esta)
    const irmas = await prisma.etapaOrdemProducao.findMany({
      where: {
        ordemProducaoId: etapa.ordemProducaoId,
        id: { not: id },
        quantidadePrevista: { gt: 0 },
        status: 'PENDENTE',
      },
      orderBy: { sequencia: 'asc' },
    })

    if (irmas.length === 0) {
      return reply.status(400).send({ message: 'Não há etapa irmã para receber a quantidade. Não é possível reverter.' })
    }

    // Soma a quantidade na primeira etapa irmã encontrada
    const irmaDestino = irmas[0]
    await prisma.etapaOrdemProducao.update({
      where: { id: irmaDestino.id },
      data: { quantidadePrevista: Number(irmaDestino.quantidadePrevista) + quantidadeDevolvida },
    })

    // Remove a etapa excluída
    await prisma.etapaOrdemProducao.delete({ where: { id } })

    return { success: true, quantidadeDevolvida, etapaDestinoId: irmaDestino.id }
  })

  // =========================================================================
  // PATCH /api/pcp/programacao/postergar-entrega — Posterga data de entrega da OP
  // =========================================================================
  app.patch('/programacao/postergar-entrega', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = z.object({
      opId: z.string().uuid(),
      novaDataEntrega: z.string(),
    }).parse(request.body)

    const op = await prisma.ordemProducao.findFirst({
      where: { id: body.opId, empresaId: user.empresaId },
    })
    if (!op) return reply.status(404).send({ message: 'OP não encontrada' })

    // Se é a primeira postergação, salvar a data original
    const dataOriginal = op.dataEntregaOriginal || op.dataEntregaPrevista

    const atualizada = await prisma.ordemProducao.update({
      where: { id: body.opId },
      data: {
        dataEntregaPrevista: new Date(body.novaDataEntrega),
        dataEntregaOriginal: dataOriginal,
        vezesPostergada: (op.vezesPostergada || 0) + 1,
      },
    })

    return {
      id: atualizada.id,
      dataEntregaPrevista: atualizada.dataEntregaPrevista,
      dataEntregaOriginal: atualizada.dataEntregaOriginal,
      vezesPostergada: atualizada.vezesPostergada,
    }
  })

  // =========================================================================
  // POST /api/pcp/programacao/reextrair-pdf — Re-extrai Matriz e Formato do PDF salvo
  // =========================================================================
  app.post('/programacao/reextrair-pdf', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = z.object({ opId: z.string().uuid() }).parse(request.body)

    const op = await prisma.ordemProducao.findFirst({
      where: { id: body.opId, empresaId: user.empresaId },
      select: { id: true, numero: true, observacoes: true, referenciaExterna: true },
    })
    if (!op) return reply.status(404).send({ message: 'OP não encontrada' })

    // Importar o parser
    const buffer = await carregarOpPdf(op.id)

    if (!buffer) {
      return reply.status(404).send({ message: 'PDF não encontrado para esta OP. Reimporte o PDF.' })
    }

    const extracao = await extrairTextoPdf(buffer)

    if (!extracao.temTexto || !isGprintPdf(extracao.texto)) {
      return reply.status(422).send({ message: 'PDF não contém texto válido ou não é do sistema GPrint.' })
    }

    const dados = parseGprintPdf(extracao.texto)

    // Atualizar observações: remover tags antigas e adicionar novas
    let obsAtual = op.observacoes || ''
    obsAtual = obsAtual.replace(/\[Matriz\].*\n?/g, '').replace(/\[Formato\].*\n?/g, '').replace(/\[TipoOp\].*\n?/g, '').replace(/\[Cores\].*\n?/g, '').trim()

    const novasTags: string[] = []
    if (dados.observacoes.tipoOp) novasTags.push(`[TipoOp] ${dados.observacoes.tipoOp}`)
    if (dados.observacoes.matriz) novasTags.push(`[Matriz] ${dados.observacoes.matriz}`)
    if (dados.observacoes.formatoPlano) novasTags.push(`[Formato] ${dados.observacoes.formatoPlano}`)
    if (dados.observacoes.coresPlano) novasTags.push(`[Cores] ${dados.observacoes.coresPlano}`)

    const obsAtualizada = novasTags.length > 0
      ? obsAtual + '\n' + novasTags.join('\n')
      : obsAtual

    await prisma.ordemProducao.update({
      where: { id: op.id },
      data: { observacoes: obsAtualizada.trim() },
    })

    // Re-extrair materiais (papel, tintas/Pantone, verniz, cola, etc.) — corrige
    // dados perdidos por bugs antigos de extração de PDF (ex: Pantone não
    // reconhecido). Por segurança, só apaga/recria os itens se NENHUM material
    // já teve liberação ou consumo registrado — nesse caso a OP já está em
    // produção real e sobrescrever a lista mudaria histórico de rastreabilidade.
    let materiaisAtualizados = false
    let materiaisAvisos: string[] = []
    if (dados.materiais.length > 0) {
      const itensExistentes = await prisma.itemOrdemProducao.findMany({
        where: { ordemProducaoId: op.id },
        select: { id: true, produtoComponenteId: true, descricaoProduto: true, quantidadeLiberada: true, quantidadeConsumida: true },
      })

      const temMovimentacao = itensExistentes.some(
        (i) => Number(i.quantidadeLiberada) > 0 || Number(i.quantidadeConsumida) > 0,
      )

      if (temMovimentacao) {
        materiaisAvisos.push('Materiais não foram atualizados: já há liberação/consumo registrado para esta OP. Ajuste manualmente se necessário.')
      } else {
        // Preserva o vínculo com produto (produtoComponenteId) por descrição,
        // já que o novo parse não sabe a qual produto cadastrado cada material
        // corresponde — mantém o de/para já feito na importação original.
        const vinculoPorDescricao = new Map(itensExistentes.map((i) => [i.descricaoProduto, i.produtoComponenteId]))

        await prisma.itemOrdemProducao.deleteMany({ where: { ordemProducaoId: op.id } })

        for (const mat of dados.materiais) {
          await prisma.itemOrdemProducao.create({
            data: {
              ordemProducaoId: op.id,
              empresaId: user.empresaId,
              produtoComponenteId: vinculoPorDescricao.get(mat.descricao) ?? undefined,
              descricaoProduto: mat.descricao,
              descricaoExterna: mat.descricao,
              quantidade: mat.quantidade,
              unidadeMedida: mat.unidade,
              tipoMaterial: mat.tipo,
              status: 'PENDENTE',
            },
          })
        }
        materiaisAtualizados = true
      }
    }

    return {
      opNumero: op.referenciaExterna || op.numero,
      tipoOp: dados.observacoes.tipoOp || null,
      matriz: dados.observacoes.matriz || null,
      formato: dados.observacoes.formatoPlano || null,
      cores: dados.observacoes.coresPlano || null,
      atualizado: novasTags.length > 0 || materiaisAtualizados,
      materiaisAtualizados,
      totalMateriais: dados.materiais.length,
      avisos: materiaisAvisos,
    }
  })

  // =========================================================================
  // PATCH /api/pcp/etapas/:id/mover — Move etapa para outro centro de produção
  // =========================================================================
  app.patch('/etapas/:id/mover', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idSchema.parse(request.params)
    const body = z.object({ centroProducaoId: z.string().uuid() }).parse(request.body)

    const etapa = await prisma.etapaOrdemProducao.findFirst({
      where: { id, ordemProducao: { empresaId: user.empresaId } },
    })
    if (!etapa) return reply.status(404).send({ message: 'Etapa não encontrada' })

    // Verifica se o centro destino existe
    const centro = await prisma.centroProducao.findFirst({
      where: { id: body.centroProducaoId, empresaId: user.empresaId },
    })
    if (!centro) return reply.status(404).send({ message: 'Centro de destino não encontrado' })

    const atualizada = await prisma.etapaOrdemProducao.update({
      where: { id },
      data: { centroProducaoId: body.centroProducaoId },
    })

    return { id: atualizada.id, centroProducaoId: atualizada.centroProducaoId }
  })

  // =========================================================================
  // POST /api/pcp/etapas/adicionar-manual — Adiciona OP manualmente à fila de um centro
  // =========================================================================
  app.post('/etapas/adicionar-manual', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = z.object({
      opNumero: z.number(),
      centroProducaoId: z.string().uuid(),
      descricao: z.string().max(200).optional(),
    }).parse(request.body)

    // Find the OP
    const op = await prisma.ordemProducao.findFirst({
      where: { empresaId: user.empresaId, numero: body.opNumero },
      include: { itens: { where: { tipoMaterial: 'PAPEL' }, take: 1 } },
    })
    if (!op) return reply.status(404).send({ message: `OP #${body.opNumero} não encontrada` })

    // Find max sequencia for this OP
    const maxSeq = await prisma.etapaOrdemProducao.aggregate({
      where: { ordemProducaoId: op.id },
      _max: { sequencia: true },
    })

    // Get max posicaoFila for this centro
    const maxPos = await prisma.etapaOrdemProducao.aggregate({
      where: { centroProducaoId: body.centroProducaoId, status: { in: ['PENDENTE', 'EM_ANDAMENTO', 'PAUSADA'] } },
      _max: { posicaoFila: true },
    })

    const etapa = await prisma.etapaOrdemProducao.create({
      data: {
        ordemProducaoId: op.id,
        sequencia: (maxSeq._max.sequencia || 0) + 1,
        descricao: body.descricao ? `[MANUAL] ${body.descricao}` : `[MANUAL] Lançamento manual - OP #${body.opNumero}`,
        centroProducaoId: body.centroProducaoId,
        status: 'PENDENTE',
        posicaoFila: (maxPos._max.posicaoFila || 0) + 1,
      },
    })

    return reply.status(201).send(etapa)
  })

  // =========================================================================
  // POST /api/pcp/etapas/adicionar-avulsa — Cria uma OP avulsa (sem número de
  // fábrica, apenas referência AV-1, AV-2...) e já a adiciona à fila do centro
  // =========================================================================
  app.post('/etapas/adicionar-avulsa', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = z.object({
      centroProducaoId: z.string().uuid(),
      produtoId: z.string().uuid().optional().nullable(),
      clienteId: z.string().uuid().optional().nullable(),
      quantidade: z.number().positive('Quantidade deve ser maior que zero'),
      descricao: z.string().max(200).optional(),
    }).parse(request.body)

    const centro = await prisma.centroProducao.findFirst({
      where: { id: body.centroProducaoId, empresaId: user.empresaId },
    })
    if (!centro) return reply.status(404).send({ message: 'Centro de produção não encontrado' })

    // Gera a próxima referência avulsa sequencial (AV-1, AV-2, ...) por empresa,
    // olhando o maior sufixo numérico já usado em referenciaExterna com esse padrão.
    const avulsasExistentes = await prisma.ordemProducao.findMany({
      where: { empresaId: user.empresaId, origemImportacao: 'AVULSA' },
      select: { referenciaExterna: true },
    })
    let maiorSeq = 0
    for (const av of avulsasExistentes) {
      const m = av.referenciaExterna?.match(/^AV-(\d+)$/)
      if (m) maiorSeq = Math.max(maiorSeq, parseInt(m[1]))
    }
    const referenciaAvulsa = `AV-${maiorSeq + 1}`

    // A OP avulsa ainda precisa de um `numero` interno (constraint única da
    // tabela), mas ele nunca é exibido — a UI sempre usa referenciaExterna.
    const proximoNumero = await proximoNumeroOp(user.empresaId)

    const op = await prisma.ordemProducao.create({
      data: {
        empresaId: user.empresaId,
        numero: proximoNumero,
        referenciaExterna: referenciaAvulsa,
        origemImportacao: 'AVULSA',
        produtoId: body.produtoId ?? undefined,
        clienteId: body.clienteId ?? undefined,
        quantidade: body.quantidade,
        unidadeMedida: 'UN',
        status: 'PROGRAMADA',
        prioridade: 'NORMAL',
        dataEntregaPrevista: new Date(),
        dataEntregaOriginal: new Date(),
        observacoes: body.descricao ? `[Descricao] ${body.descricao}` : undefined,
        criadoPorId: user.id,
      },
    })

    // Get max posicaoFila for this centro
    const maxPos = await prisma.etapaOrdemProducao.aggregate({
      where: { centroProducaoId: body.centroProducaoId, status: { in: ['PENDENTE', 'EM_ANDAMENTO', 'PAUSADA'] } },
      _max: { posicaoFila: true },
    })

    const etapa = await prisma.etapaOrdemProducao.create({
      data: {
        ordemProducaoId: op.id,
        sequencia: 1,
        descricao: body.descricao || `Lançamento avulso ${referenciaAvulsa}`,
        centroProducaoId: body.centroProducaoId,
        status: 'PENDENTE',
        posicaoFila: (maxPos._max.posicaoFila || 0) + 1,
      },
    })

    return reply.status(201).send({ op, etapa, referenciaAvulsa })
  })

  // =========================================================================
  // DELETE /api/pcp/ordens-avulsas/:opId — Exclui uma OP avulsa (a qualquer momento)
  // =========================================================================
  app.delete('/ordens-avulsas/:opId', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { opId } = z.object({ opId: z.string().uuid() }).parse(request.params)

    const op = await prisma.ordemProducao.findFirst({
      where: { id: opId, empresaId: user.empresaId, origemImportacao: 'AVULSA' },
    })
    if (!op) return reply.status(404).send({ message: 'OP avulsa não encontrada' })

    // OP avulsa pode ser excluída a qualquer instante — remove dependências
    // em cascata (etapas, apontamentos, itens, logs) e a própria OP.
    await prisma.$transaction([
      prisma.apontamentoEtapa.deleteMany({ where: { etapaOrdemProducao: { ordemProducaoId: opId } } }),
      prisma.etapaOrdemProducao.deleteMany({ where: { ordemProducaoId: opId } }),
      prisma.itemOrdemProducao.deleteMany({ where: { ordemProducaoId: opId } }),
      prisma.logOrdemProducao.deleteMany({ where: { ordemProducaoId: opId } }),
      prisma.programacaoEntrega.deleteMany({ where: { ordemProducaoId: opId } }),
      prisma.ordemProducao.delete({ where: { id: opId } }),
    ])

    return { message: `OP avulsa ${op.referenciaExterna} excluída` }
  })

  // =========================================================================
  // GET /api/pcp/programacao/painel — Painel operacional completo
  // =========================================================================

  function extrairGramatura(desc: string): string | null {
    // Padrão "222g", "222g/m²", "300 g"
    const match = desc.match(/(\d{2,3})\s*g(?:\/m[²2])?/i)
    if (match) return `${match[1]}g/m²`
    // Padrão "Bobina 222" ou "Enzo 222" (número de 3 dígitos no contexto de papel)
    const matchBobina = desc.match(/(?:bobina|enzo|stora|suzano|klabin)\s+.*?(\d{3})\b/i)
    if (matchBobina) return `${matchBobina[1]}g/m²`
    return null
  }

  function extrairFormato(desc: string): string | null {
    // Padrão "66x96", "720 x 1000", "72,0 x 100,0"
    const match = desc.match(/([\d.,]+)\s*x\s*([\d.,]+)\s*(?:cm|mm)?/i)
    return match ? `${match[1]}x${match[2]}` : null
  }

  app.get('/programacao/painel', async (request) => {
    const user = request.user as { id: string; empresaId: string }

    const centros = await prisma.centroProducao.findMany({
      where: { empresaId: user.empresaId, status: true },
      orderBy: [{ posicao: 'asc' }, { codigo: 'asc' }],
    })

    const etapasAtivas = await prisma.etapaOrdemProducao.findMany({
      where: {
        ordemProducao: { empresaId: user.empresaId, status: { in: ['PROGRAMADA', 'LIBERADA', 'EM_PRODUCAO'] } },
        status: { in: ['PENDENTE', 'EM_ANDAMENTO', 'PAUSADA'] },
      },
      include: {
        ordemProducao: {
          select: {
            numero: true, produtoId: true, quantidade: true, unidadeMedida: true,
            prioridade: true, dataEntregaPrevista: true, dataEntregaOriginal: true, vezesPostergada: true,
            clienteId: true, observacoes: true, referenciaExterna: true, origemImportacao: true,
            itens: { where: { tipoMaterial: { in: ['PAPEL', 'TINTA', 'VERNIZ'] } } },
          },
        },
        centroProducao: { select: { id: true, codigo: true, descricao: true, tipoMaquina: true } },
      },
      orderBy: [{ posicaoFila: { sort: 'asc', nulls: 'last' } }, { ordemProducao: { prioridade: 'desc' } }, { sequencia: 'asc' }],
    })

    // Buscar nomes de clientes e produtos para exibição
    const clienteIds = [...new Set(etapasAtivas.map(e => e.ordemProducao.clienteId).filter(Boolean))] as string[]
    const produtoIds = [...new Set(etapasAtivas.map(e => e.ordemProducao.produtoId).filter(Boolean))] as string[]
    const clientes = clienteIds.length > 0 ? await prisma.cliente.findMany({ where: { id: { in: clienteIds } }, select: { id: true, razaoSocial: true, nomeFantasia: true } }) : []
    const produtos = produtoIds.length > 0 ? await prisma.produto.findMany({ where: { id: { in: produtoIds } }, select: { id: true, codigo: true, nome: true } }) : []
    const clienteMap = new Map(clientes.map(c => [c.id, c.nomeFantasia || c.razaoSocial]))
    const produtoMap = new Map(produtos.map(p => [p.id, `${p.codigo} - ${p.nome}`]))

    // Detecta "encomendado" em: observações da OP, descrição dos itens PAPEL, ou descricaoExterna
    function temMaterialEncomendado(e: typeof etapasAtivas[0]): boolean {
      if (e.ordemProducao.observacoes && /encomendad/i.test(e.ordemProducao.observacoes)) return true
      if (e.ordemProducao.itens?.some(item => /encomendad/i.test(item.descricaoProduto))) return true
      return false
    }

    // Extrai nome do cliente/produto das observações da OP (vem do PDF importado)
    function extrairClienteObs(obs: string | null): string | null {
      if (!obs) return null
      const m = obs.match(/\[Cliente\]\s*(.+?)(?:\n|$)/)
      return m ? m[1].trim() : null
    }
    function extrairProdutoObs(obs: string | null): string | null {
      if (!obs) return null
      const m = obs.match(/\[Produto\]\s*(.+?)(?:\n|$)/)
      return m ? m[1].trim() : null
    }
    function extrairTipoOpObs(obs: string | null): string | null {
      if (!obs) return null
      const m = obs.match(/\[TipoOp\]\s*(.+?)(?:\n|$)/)
      return m ? m[1].trim() : null
    }
    function extrairMatrizObs(obs: string | null): string | null {
      if (!obs) return null
      const m = obs.match(/\[Matriz\]\s*(.+?)(?:\n|$)/)
      return m ? m[1].trim() : null
    }
    function extrairFormatoObs(obs: string | null): string | null {
      if (!obs) return null
      const m = obs.match(/\[Formato\]\s*(.+?)(?:\n|$)/)
      return m ? m[1].trim() : null
    }

    // Extrai informações de Pantone dos itens de tinta
    function extrairCores(itens: Array<{ descricaoProduto: string; tipoMaterial: string | null }>, observacoes: string | null) {
      const tintas = itens.filter(i => i.tipoMaterial === 'TINTA')
      const vernizes = itens.filter(i => i.tipoMaterial === 'VERNIZ')
      const pantones: string[] = []
      let escala: string | null = null

      for (const tinta of tintas) {
        const desc = tinta.descricaoProduto
        // Detectar se é item de Escala pelo nome (começa com "Escala" ou contém "Escala")
        const isEscala = /^escala\b/i.test(desc.trim())
        // Extrair nome da cor do formato: "Pantone 01 (CW0122 - ROSA) (35%)" ou "Escala (CYMK) (65%)"
        const matchCor = desc.match(/\(([^)]+)\)\s*\(\d+%\)/)
        if (matchCor) {
          const corInfo = matchCor[1].trim()
          // Filtrar Escala/CMYK/CYMK — variações comuns de "CMYK" (CYMK, CMYK, C+M+Y+K, etc.)
          if (isEscala || /^C[YM][YM]K$/i.test(corInfo) || /^CMYK$/i.test(corInfo)) {
            escala = corInfo
          } else {
            pantones.push(corInfo)
          }
        } else if (isEscala) {
          // Escala sem formato de cor entre parênteses — ignorar
          escala = 'CMYK'
        }
      }

      // Qtd Cores: prioriza tag [Cores] das observações (ex: "5x0 +V+V"), senão calcula
      let qtdCores: string | null = null
      if (observacoes) {
        const matchCoresObs = observacoes.match(/\[Cores\]\s*(.+?)(?:\n|$)/)
        if (matchCoresObs) {
          qtdCores = matchCoresObs[1].trim().toUpperCase()
        }
      }
      if (!qtdCores && tintas.length > 0) {
        // Conta: escala (4 cores CMYK) + pantones = total
        const totalCores = (escala ? 4 : 0) + pantones.length
        // Detectar verniz: cada item de verniz adiciona "+V"
        const sufixoVerniz = vernizes.length > 0 ? ' ' + Array(vernizes.length).fill('+V').join('') : ''
        qtdCores = `${totalCores}X0${sufixoVerniz}`
      }
      // Fallback extra: extrair padrão NxN (+V...) das observações gerais (OPs importadas antes da tag [Cores])
      // Padrão de cores é sempre dígito pequeno x dígito (ex: "5x0", "6x0 +V+V") — diferente de formato (690 x 660)
      if (!qtdCores && observacoes) {
        const matchCoresTexto = observacoes.match(/\b(\d)\s*x\s*(\d)\s*(\+V[^\n]*)?/i)
        if (matchCoresTexto) {
          const coresStr = `${matchCoresTexto[1]}X${matchCoresTexto[2]}${matchCoresTexto[3] ? ' ' + matchCoresTexto[3].trim().toUpperCase() : ''}`
          qtdCores = coresStr
        }
      }

      return {
        pantone01: pantones[0] || null,
        pantone02: pantones[1] || null,
        pantone03: pantones[2] || null,
        qtdCores,
      }
    }

    // Agrupa por centro
    const painelPorCentro = centros.map(centro => {
      const etapasDoCentro = etapasAtivas.filter(e => e.centroProducaoId === centro.id)

      const emAndamento = etapasDoCentro.filter(e => e.status === 'EM_ANDAMENTO')
      const pausadas = etapasDoCentro.filter(e => e.status === 'PAUSADA')
      const pendentes = etapasDoCentro.filter(e => e.status === 'PENDENTE')

      return {
        centro: { id: centro.id, codigo: centro.codigo, descricao: centro.descricao, tipo: centro.tipo, tipoMaquina: centro.tipoMaquina },
        resumo: {
          emAndamento: emAndamento.length,
          pausadas: pausadas.length,
          pendentes: pendentes.length,
          total: etapasDoCentro.length,
        },
        etapas: etapasDoCentro.map(e => {
          const papel = e.ordemProducao.itens?.find(i => i.tipoMaterial === 'PAPEL') || null
          const cores = extrairCores(e.ordemProducao.itens || [], e.ordemProducao.observacoes)
          return {
            id: e.id,
            opId: e.ordemProducaoId,
            opNumero: e.ordemProducao.referenciaExterna || String(e.ordemProducao.numero),
            clienteNome: extrairClienteObs(e.ordemProducao.observacoes) || (e.ordemProducao.clienteId && clienteMap.get(e.ordemProducao.clienteId)) || null,
            produtoNome: extrairProdutoObs(e.ordemProducao.observacoes) || (e.ordemProducao.produtoId && produtoMap.get(e.ordemProducao.produtoId)) || null,
            descricao: e.descricao,
            status: e.status,
            sequencia: e.sequencia,
            posicaoFila: e.posicaoFila,
            isDesmembramento: Number(e.quantidadePrevista) > 0,
            isManual: e.descricao.includes('[MANUAL]') || e.descricao.startsWith('Lançamento manual'),
            isAvulsa: e.ordemProducao.origemImportacao === 'AVULSA',
            quantidade: Number(e.quantidadePrevista) > 0 ? Number(e.quantidadePrevista) : Number(e.ordemProducao.quantidade),
            unidade: e.ordemProducao.unidadeMedida,
            quantidadeProduzida: Number(e.quantidadeProduzida),
            quantidadePerda: Number(e.quantidadePerda),
            percentual: (Number(e.quantidadePrevista) > 0 ? Number(e.quantidadePrevista) : Number(e.ordemProducao.quantidade)) > 0
              ? Math.round((Number(e.quantidadeProduzida) / (Number(e.quantidadePrevista) > 0 ? Number(e.quantidadePrevista) : Number(e.ordemProducao.quantidade))) * 100)
              : 0,
            prioridade: e.ordemProducao.prioridade,
            dataEntrega: e.ordemProducao.dataEntregaPrevista,
            dataEntregaOriginal: e.ordemProducao.dataEntregaOriginal || e.ordemProducao.dataEntregaPrevista,
            vezesPostergada: e.ordemProducao.vezesPostergada || 0,
            funcionarioId: e.funcionarioId,
            dataInicioReal: e.dataInicioReal,
            observacoes: e.ordemProducao.observacoes,
            observacaoOperador: e.observacaoOperador || null,
            // Campos de material (Requisito 3)
            // Tiragem: prioriza valor explícito do PDF, senão calcula Quantidade/Montagem
            tiragem: (() => {
              const obs = e.ordemProducao.observacoes || ''
              const qtd = Number(e.quantidadePrevista) > 0 ? Number(e.quantidadePrevista) : Number(e.ordemProducao.quantidade)
              // Prioridade 1: tiragem explícita do PDF (tag [Tiragem]) — ignorar se < 10 (erro de parse)
              const matchTiragem = obs.match(/\[Tiragem\]\s*([\d.,]+)/)
              if (matchTiragem) {
                const val = parseFloat(matchTiragem[1].replace(/\./g, '').replace(',', '.'))
                if (val >= 10) return val
              }
              // Prioridade 2: calcular Quantidade / Montagem
              const matchMontagem = obs.match(/\[Montagem\]\s*(\d+)/)
              if (matchMontagem) {
                const aproveitamento = parseInt(matchMontagem[1])
                if (aproveitamento > 0) return Math.ceil(qtd / aproveitamento)
              }
              return qtd
            })(),
            materialPrincipal: papel?.descricaoProduto || null,
            gramatura: (papel ? extrairGramatura(papel.descricaoProduto) : null) || extrairGramatura(e.ordemProducao.observacoes || ''),
            formato: extrairFormatoObs(e.ordemProducao.observacoes) || (papel ? extrairFormato(papel.descricaoProduto) : null) || extrairFormato(e.ordemProducao.observacoes || ''),
            pesoKg: papel ? Number(papel.quantidade) : null,
            materialEncomendado: temMaterialEncomendado(e),
            tipoOp: extrairTipoOpObs(e.ordemProducao.observacoes),
            matriz: extrairMatrizObs(e.ordemProducao.observacoes),
            ...cores,
          }
        }),
      }
    })

    // OPs com material encomendado (aguardando cartão) — sempre exibir na aba CORTADEIRA
    // O cartão/bobina é sempre material da cortadeira, independente de qual etapa é a primeira
    const aguardandoCartao = etapasAtivas
      .filter(e => temMaterialEncomendado(e))
      .map(e => {
        const papel = e.ordemProducao.itens?.[0] || null
        // Extrair detalhes das bobinas (estoque vs encomendadas) das observações
        const bobinas: Array<{ descricao: string; kg: number; status: 'ESTOQUE' | 'ENCOMENDADO' }> = []
        if (e.ordemProducao.observacoes) {
          const matches = e.ordemProducao.observacoes.matchAll(/\[Bobina\]\s*(.+?)\s*(?:em estoque|encomendad[oa])\s*\(([\d.,]+)\s*kg\)/gi)
          for (const m of matches) {
            const isEncomendado = /encomendad/i.test(m[0])
            bobinas.push({
              descricao: m[1].trim(),
              kg: parseFloat(m[2].replace('.', '').replace(',', '.')),
              status: isEncomendado ? 'ENCOMENDADO' : 'ESTOQUE',
            })
          }
        }
        const kgEstoque = bobinas.filter(b => b.status === 'ESTOQUE').reduce((a, b) => a + b.kg, 0)
        const kgEncomendado = bobinas.filter(b => b.status === 'ENCOMENDADO').reduce((a, b) => a + b.kg, 0)

        return {
          id: e.id,
          opId: e.ordemProducaoId,
          opNumero: e.ordemProducao.referenciaExterna || String(e.ordemProducao.numero),
          descricao: e.descricao,
          cliente: extrairClienteObs(e.ordemProducao.observacoes) || (e.ordemProducao.clienteId ? clienteMap.get(e.ordemProducao.clienteId) || null : null),
          produto: extrairProdutoObs(e.ordemProducao.observacoes) || (e.ordemProducao.produtoId ? produtoMap.get(e.ordemProducao.produtoId) || null : null),
          quantidade: Number(e.ordemProducao.quantidade),
          unidade: e.ordemProducao.unidadeMedida,
          prioridade: e.ordemProducao.prioridade,
          dataEntrega: e.ordemProducao.dataEntregaPrevista,
          materialPrincipal: papel?.descricaoProduto || null,
          gramatura: papel ? extrairGramatura(papel.descricaoProduto) : null,
          formato: papel ? extrairFormato(papel.descricaoProduto) : null,
          pesoKg: papel ? Number(papel.quantidade) : null,
          observacoes: e.ordemProducao.observacoes,
          observacaoOperador: e.observacaoOperador || null,
          centroDescricao: e.centroProducao?.descricao || null,
          tipoMaquina: 'CORTADEIRA' as string | null, // Aguardando Cartão sempre pertence à Cortadeira
          bobinas,
          kgEstoque,
          kgEncomendado,
        }
      })
      // Deduplica por OP (pode ter múltiplas etapas da mesma OP)
      .filter((item, index, self) => self.findIndex(i => i.opNumero === item.opNumero) === index)

    return { centros: painelPorCentro, aguardandoCartao }
  })
}
