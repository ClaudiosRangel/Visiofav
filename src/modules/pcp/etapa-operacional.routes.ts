import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { extrairTextoPdf } from './importacao-op/pdf-extractor.service'
import { isGprintPdf, parseGprintPdf } from './importacao-op/parsers/gprint-parser'
import { getOpPdfPath, carregarOpPdf } from '../../lib/storage'
import { proximoNumeroOp } from '../ordem-producao/ordem-producao.service'
import { reordenarFilaAutomaticamente } from './fila-ordenacao.service'
import {
  iniciarEtapa,
  pausarEtapa,
  apontarProducao,
  concluirEtapa,
  EtapaOperacionalError,
} from './etapa-operacional.service'

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
      // ID da etapa que o usuário efetivamente arrastou (dnd-kit `active.id`)
      // — só ela é marcada como `ordemManual=true` (posição fixa, sobrepõe
      // os critérios automáticos). As demais etapas apenas têm sua
      // `posicaoFila` atualizada para refletir o novo array, mas continuam
      // participando da ordenação automática normalmente quando uma nova
      // etapa entrar na fila. Opcional por compatibilidade com chamadas
      // antigas — se omitido, nenhuma etapa é marcada como manual.
      etapaMovidaId: z.string().uuid().optional(),
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

    // Update posicaoFila for each etapa based on array order.
    const updates = body.etapaIds.map((id, index) =>
      prisma.etapaOrdemProducao.update({
        where: { id },
        data: {
          posicaoFila: index + 1,
          ...(body.etapaMovidaId === id ? { ordemManual: true } : {}),
        },
      })
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

    try {
      return await iniciarEtapa(id, user.empresaId, body.funcionarioId || user.id)
    } catch (err) {
      if (err instanceof EtapaOperacionalError) {
        return reply.status(err.statusCode).send({ message: err.message })
      }
      throw err
    }
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

    try {
      return await pausarEtapa(id, user.empresaId, body)
    } catch (err) {
      if (err instanceof EtapaOperacionalError) {
        return reply.status(err.statusCode).send({ message: err.message })
      }
      throw err
    }
  })

  // =========================================================================
  // POST /api/pcp/etapas/:id/apontar — Registra produção parcial
  //
  // Aceita tanto JSON puro (Content-Type: application/json, sem foto — mantém
  // 100% compatível com chamadas antigas) quanto multipart/form-data (quando
  // o operador anexa a foto da contagem produzida). No multipart, os campos
  // numéricos chegam como string e precisam ser convertidos antes do parse.
  // =========================================================================
  app.post('/etapas/:id/apontar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idSchema.parse(request.params)

    const bodySchema = z.object({
      quantidadeProduzida: z.coerce.number().min(0).default(0),
      quantidadePerda: z.coerce.number().min(0).default(0),
      motivoPerda: z.enum(['ACERTO', 'REFUGO', 'DEFEITO', 'APARA']).optional(),
      funcionarioId: z.string().uuid().optional(),
      observacao: z.string().optional(),
    })

    let body: z.infer<typeof bodySchema>
    let fotoUrl: string | undefined

    if (request.isMultipart()) {
      const camposRecebidos: Record<string, string> = {}
      const parts = request.parts()
      for await (const part of parts) {
        if (part.type === 'file') {
          const allowedMimes = ['image/jpeg', 'image/png', 'image/webp']
          if (!allowedMimes.includes(part.mimetype)) {
            return reply.status(400).send({ message: 'Formato de foto inválido. Use JPEG, PNG ou WebP.' })
          }
          const buffer = await part.toBuffer()
          if (buffer.length > 5 * 1024 * 1024) {
            return reply.status(400).send({ message: 'Foto muito grande. Máximo 5MB.' })
          }
          fotoUrl = `data:${part.mimetype};base64,${buffer.toString('base64')}`
        } else {
          camposRecebidos[part.fieldname] = part.value as string
        }
      }
      body = bodySchema.parse(camposRecebidos)
    } else {
      body = bodySchema.parse(request.body)
    }

    try {
      const apontamento = await apontarProducao(id, user.empresaId, { ...body, fotoUrl })
      return reply.status(201).send(apontamento)
    } catch (err) {
      if (err instanceof EtapaOperacionalError) {
        return reply.status(err.statusCode).send({ message: err.message })
      }
      throw err
    }
  })

  // =========================================================================
  // PATCH /api/pcp/etapas/:id/concluir — Finaliza a etapa
  // =========================================================================
  app.patch('/etapas/:id/concluir', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idSchema.parse(request.params)

    try {
      return await concluirEtapa(id, user.empresaId, user.id)
    } catch (err) {
      if (err instanceof EtapaOperacionalError) {
        return reply.status(err.statusCode).send({ message: err.message })
      }
      throw err
    }
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

    const centroOrigemId = etapa.centroProducaoId

    // Etapa entra no centro destino como uma nova posição, sem posicionamento
    // manual prévio (mesmo que já tivesse sido arrastada no centro anterior)
    // — a reordenação automática decide onde ela entra na fila do destino.
    const atualizada = await prisma.etapaOrdemProducao.update({
      where: { id },
      data: { centroProducaoId: body.centroProducaoId, ordemManual: false },
    })

    // Reordena a fila do centro de destino (nº OP → data de entrega) e,
    // se havia um centro de origem diferente, também reordena a origem
    // (a saída da etapa pode ter deixado "buracos" nas posições manuais).
    await reordenarFilaAutomaticamente(body.centroProducaoId)
    if (centroOrigemId && centroOrigemId !== body.centroProducaoId) {
      await reordenarFilaAutomaticamente(centroOrigemId)
    }

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

    const descricaoEtapa = body.descricao ? `[MANUAL] ${body.descricao}` : `[MANUAL] Lançamento manual - OP #${body.opNumero}`

    // Guarda contra duplo clique/duplo submit (rede lenta, cliques repetidos):
    // já existe uma etapa manual idêntica (mesma OP + mesmo centro + mesma
    // descrição) ainda pendente/em fila? Se sim, não duplica — bug real
    // encontrado na OP 2898, grupo "Serviços Manuais - Produção" (duas
    // linhas idênticas na fila).
    const etapaDuplicada = await prisma.etapaOrdemProducao.findFirst({
      where: {
        ordemProducaoId: op.id,
        centroProducaoId: body.centroProducaoId,
        descricao: descricaoEtapa,
        status: { in: ['PENDENTE', 'EM_ANDAMENTO', 'PAUSADA'] },
      },
    })
    if (etapaDuplicada) {
      return reply.status(409).send({ message: `OP #${body.opNumero} já está na fila deste centro com a mesma descrição. Evite adicionar duplicado.` })
    }

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
        descricao: descricaoEtapa,
        centroProducaoId: body.centroProducaoId,
        status: 'PENDENTE',
        posicaoFila: (maxPos._max.posicaoFila || 0) + 1,
      },
    })

    // Reordena a fila automaticamente (nº OP → data de entrega), respeitando
    // as etapas já posicionadas manualmente pelo usuário.
    await reordenarFilaAutomaticamente(body.centroProducaoId)

    return reply.status(201).send(etapa)
  })

  // =========================================================================
  // POST /api/pcp/etapas/adicionar-avulsa — Cria uma OP avulsa (sem número de
  // fábrica, apenas referência AV-1, AV-2...) e já a adiciona à fila do centro
  // =========================================================================
  app.post('/etapas/adicionar-avulsa', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    let body: {
      centroProducaoId: string
      produtoId?: string | null
      produtoNomeLivre?: string | null
      clienteId?: string | null
      clienteNomeLivre?: string | null
      quantidade: number
      descricao?: string
    }
    try {
      body = z.object({
        centroProducaoId: z.string().uuid(),
        produtoId: z.string().uuid().optional().nullable(),
        // Descrição de produto sem cadastro formal — vira tag [Produto] nas
        // observações, mesmo padrão usado para clienteNomeLivre e na importação de PDF.
        produtoNomeLivre: z.string().max(200).optional().nullable(),
        clienteId: z.string().uuid().optional().nullable(),
        // Nome de cliente sem cadastro formal (a maioria das OPs importadas via
        // PDF só têm o nome extraído como texto, sem clienteId real) — vira tag
        // [Cliente] nas observações, mesmo padrão usado na importação de PDF.
        clienteNomeLivre: z.string().max(200).optional().nullable(),
        // Coluna no banco é Decimal(12,4) — máximo 8 dígitos inteiros (99.999.999)
        quantidade: z.number().positive('Quantidade deve ser maior que zero').max(99_999_999, 'Quantidade máxima permitida é 99.999.999'),
        descricao: z.string().max(200).optional(),
      }).parse(request.body)
    } catch (err: any) {
      if (err.name === 'ZodError') {
        const primeiraMsg = err.errors?.[0]?.message || 'Dados inválidos'
        return reply.status(400).send({ message: primeiraMsg, erros: err.errors })
      }
      throw err
    }

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

    const tagsObs: string[] = []
    if (body.clienteNomeLivre) tagsObs.push(`[Cliente] ${body.clienteNomeLivre.trim()}`)
    if (body.produtoNomeLivre) tagsObs.push(`[Produto] ${body.produtoNomeLivre.trim()}`)
    if (body.descricao) tagsObs.push(`[Descricao] ${body.descricao}`)

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
        observacoes: tagsObs.length > 0 ? tagsObs.join('\n') : undefined,
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

    // Reordena a fila automaticamente (nº OP → data de entrega), respeitando
    // as etapas já posicionadas manualmente pelo usuário.
    await reordenarFilaAutomaticamente(body.centroProducaoId)

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
  // GET /api/pcp/logs — Logs de auditoria do módulo PCP (só ADMIN)
  // =========================================================================
  app.get('/logs', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string; perfil: string }
    // Apenas ADMIN/SUPER_ADMIN pode acessar logs
    if (!['SUPER_ADMIN', 'ADMIN'].includes(user.perfil)) {
      return reply.status(403).send({ message: 'Apenas administradores podem acessar os logs' })
    }
    const query = z.object({
      opId: z.string().uuid().optional(),
      page: z.coerce.number().min(1).default(1),
      limit: z.coerce.number().min(1).max(100).default(50),
    }).parse(request.query)

    const where: any = {
      ordemProducao: { empresaId: user.empresaId },
    }
    if (query.opId) {
      where.ordemProducaoId = query.opId
    }

    const skip = (query.page - 1) * query.limit

    const [logs, total] = await Promise.all([
      prisma.logOrdemProducao.findMany({
        where,
        include: {
          ordemProducao: { select: { numero: true, referenciaExterna: true } },
        },
        orderBy: { criadoEm: 'desc' },
        skip,
        take: query.limit,
      }),
      prisma.logOrdemProducao.count({ where }),
    ])

    // Buscar nomes de usuários
    const usuarioIds = [...new Set(logs.map(l => l.usuarioId).filter(Boolean))]
    const usuarios = usuarioIds.length > 0
      ? await prisma.usuario.findMany({ where: { id: { in: usuarioIds } }, select: { id: true, nome: true } })
      : []
    const usuarioMap = new Map(usuarios.map(u => [u.id, u.nome]))

    return {
      data: logs.map(l => ({
        id: l.id,
        opNumero: l.ordemProducao.referenciaExterna || String(l.ordemProducao.numero),
        statusAnterior: l.statusAnterior,
        statusNovo: l.statusNovo,
        usuario: usuarioMap.get(l.usuarioId) || 'Sistema',
        observacao: l.observacao,
        criadoEm: l.criadoEm,
      })),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    }
  })

  // =========================================================================
  // GET /api/pcp/programacao/concluidas — Lista etapas CONCLUÍDAS por processo
  // (para visualização no painel de programação, com opção de retornar)
  // =========================================================================
  app.get('/programacao/concluidas', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const query = z.object({
      tipoProcessoId: z.string().uuid().optional(),
      limite: z.coerce.number().min(1).max(200).default(50),
    }).parse(request.query)

    const where: any = {
      status: 'CONCLUIDA',
      ordemProducao: { empresaId: user.empresaId },
    }

    // Filtrar por tipo de processo (via centro de produção)
    if (query.tipoProcessoId) {
      where.centroProducao = { tipoProcessoId: query.tipoProcessoId }
    }

    const etapas = await prisma.etapaOrdemProducao.findMany({
      where,
      include: {
        ordemProducao: {
          select: {
            id: true, numero: true, referenciaExterna: true, quantidade: true,
            unidadeMedida: true, prioridade: true, observacoes: true,
            clienteId: true, produtoId: true, dataEntregaPrevista: true,
          },
        },
        centroProducao: { select: { id: true, codigo: true, descricao: true, tipoProcessoId: true } },
      },
      orderBy: { dataFimReal: 'desc' },
      take: query.limite,
    })

    // Enriquecer com nomes de cliente/produto
    const clienteIds = [...new Set(etapas.map(e => e.ordemProducao.clienteId).filter(Boolean))] as string[]
    const produtoIds = [...new Set(etapas.map(e => e.ordemProducao.produtoId).filter(Boolean))] as string[]
    const clientes = clienteIds.length > 0 ? await prisma.cliente.findMany({ where: { id: { in: clienteIds } }, select: { id: true, razaoSocial: true, nomeFantasia: true } }) : []
    const produtos = produtoIds.length > 0 ? await prisma.produto.findMany({ where: { id: { in: produtoIds } }, select: { id: true, codigo: true, nome: true } }) : []
    const clienteMap = new Map(clientes.map(c => [c.id, c.nomeFantasia || c.razaoSocial]))
    const produtoMap = new Map(produtos.map(p => [p.id, `${p.codigo} - ${p.nome}`]))

    function extrairClienteObs2(obs: string | null): string | null {
      if (!obs) return null
      const m = obs.match(/\[Cliente\]\s*(.+?)(?:\n|$)/)
      return m ? m[1].trim() : null
    }
    function extrairProdutoObs2(obs: string | null): string | null {
      if (!obs) return null
      const m = obs.match(/\[Produto\]\s*(.+?)(?:\n|$)/)
      return m ? m[1].trim() : null
    }

    return etapas.map(e => ({
      id: e.id,
      opId: e.ordemProducao.id,
      opNumero: e.ordemProducao.referenciaExterna || String(e.ordemProducao.numero),
      cliente: extrairClienteObs2(e.ordemProducao.observacoes)
        || (e.ordemProducao.clienteId ? clienteMap.get(e.ordemProducao.clienteId) : null)
        || null,
      produto: extrairProdutoObs2(e.ordemProducao.observacoes)
        || (e.ordemProducao.produtoId ? produtoMap.get(e.ordemProducao.produtoId) : null)
        || null,
      descricao: e.descricao,
      sequencia: e.sequencia,
      quantidade: Number(e.ordemProducao.quantidade),
      quantidadeProduzida: Number(e.quantidadeProduzida),
      centroDescricao: e.centroProducao?.descricao || e.centroProducao?.codigo || '',
      dataFimReal: e.dataFimReal,
    }))
  })

  // =========================================================================
  // PATCH /api/pcp/etapas/:id/retornar — Retorna uma etapa CONCLUIDA para
  // a fila (status PENDENTE), exigindo autenticação de admin/supervisor
  // =========================================================================
  app.patch('/etapas/:id/retornar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string; perfil: string }
    const { id } = idSchema.parse(request.params)

    const body = z.object({
      emailAdmin: z.string().min(1),
      senhaAdmin: z.string().min(1),
    }).parse(request.body)

    // Verificar credenciais do admin/supervisor — busca por email exato ou por email contendo o texto
    let admin = await prisma.usuario.findFirst({ where: { email: body.emailAdmin } })
    if (!admin) {
      // Tentar busca parcial (ex: "admin" → "admin@visiofab.com")
      admin = await prisma.usuario.findFirst({
        where: { email: { contains: body.emailAdmin, mode: 'insensitive' } },
      })
    }
    if (!admin) {
      return reply.status(401).send({ message: 'Credenciais de administrador inválidas' })
    }
    const senhaValida = bcrypt.compareSync(body.senhaAdmin, admin.senha)
    if (!senhaValida) {
      return reply.status(401).send({ message: 'Credenciais de administrador inválidas' })
    }
    if (!['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR'].includes(admin.perfil)) {
      return reply.status(403).send({ message: 'Perfil não autorizado para esta operação' })
    }

    // Verificar que a etapa pertence à empresa e está CONCLUIDA
    const etapa = await prisma.etapaOrdemProducao.findFirst({
      where: { id, ordemProducao: { empresaId: user.empresaId }, status: 'CONCLUIDA' },
      include: { ordemProducao: { select: { id: true, numero: true, status: true, empresaId: true } } },
    })

    if (!etapa) {
      return reply.status(404).send({ message: 'Etapa concluída não encontrada' })
    }

    // Retornar a etapa para PENDENTE
    await prisma.etapaOrdemProducao.update({
      where: { id },
      data: {
        status: 'PENDENTE',
        dataFimReal: null,
        // Mover para o final da fila (posição alta)
        posicaoFila: 9999,
      },
    })

    // Se a OP estava CONCLUIDA (todas as etapas tinham sido concluídas),
    // retorná-la para EM_PRODUCAO
    if (etapa.ordemProducao.status === 'CONCLUIDA') {
      await prisma.ordemProducao.update({
        where: { id: etapa.ordemProducao.id },
        data: { status: 'EM_PRODUCAO', dataFimReal: null },
      })
    }

    // Log de auditoria
    await prisma.logOrdemProducao.create({
      data: {
        ordemProducaoId: etapa.ordemProducao.id,
        usuarioId: admin.id,
        statusAnterior: 'CONCLUIDA',
        statusNovo: 'PENDENTE',
        observacao: `Etapa retornada à fila por ${admin.nome} (${admin.email})`,
      },
    })

    return { message: 'Etapa retornada à fila com sucesso' }
  })

  // =========================================================================
  // GET /api/pcp/programacao/painel — Painel operacional completo
  // =========================================================================

  function extrairGramatura(desc: string): string | null {
    // Padrão "222g", "222g/m²", "300 g"
    const match = desc.match(/(\d{2,3})\s*g(?:\/m[²2])?/i)
    if (match) return `${match[1]}g/m²`
    // Padrão "Bobina 222" ou "Enzo 222" (número de 3 dígitos no contexto de papel)
    const matchBobina = desc.match(/(?:bobina|enzo|stora|suzano|klabin|accurate|billerud|silverpack|freeze|board)\s+.*?(\d{3})\b/i)
    if (matchBobina) return `${matchBobina[1]}g/m²`
    // Padrão genérico: nome termina com número de 3 dígitos (ex: "Accurate Freeze 290", "Micro Pardo Formato 245")
    const matchFinal = desc.match(/\s(\d{3})$/)
    if (matchFinal) return `${matchFinal[1]}g/m²`
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
      include: { tipoProcesso: { select: { id: true, codigo: true, descricao: true, posicao: true } } },
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
        centroProducao: { select: { id: true, codigo: true, descricao: true, tipoProcessoId: true, tipoProcesso: { select: { codigo: true } } } },
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
        // Detectar se é item Reativa
        const isReativa = /^reativa\b|reativa\)/i.test(desc.trim())
        if (isReativa) {
          // Inserir "REATIVA" no início dos pantones
          if (!pantones.includes('REATIVA')) pantones.unshift('REATIVA')
          continue
        }
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

    // IDs das OPs com material encomendado — essas etapas devem aparecer
    // SOMENTE na seção "Aguardando Cartão", não duplicadas nos centros normais.
    const opsComMaterialEncomendado = new Set(
      etapasAtivas.filter(e => temMaterialEncomendado(e)).map(e => e.ordemProducaoId)
    )

    // Agrupa por centro
    const painelPorCentro = centros.map(centro => {
      const etapasDoCentro = etapasAtivas.filter(e =>
        e.centroProducaoId === centro.id && !opsComMaterialEncomendado.has(e.ordemProducaoId)
      )

      const emAndamento = etapasDoCentro.filter(e => e.status === 'EM_ANDAMENTO')
      const pausadas = etapasDoCentro.filter(e => e.status === 'PAUSADA')
      const pendentes = etapasDoCentro.filter(e => e.status === 'PENDENTE')

      return {
        centro: {
          id: centro.id, codigo: centro.codigo, descricao: centro.descricao, tipo: centro.tipo,
          tipoProcessoId: centro.tipoProcessoId,
          tipoProcesso: { codigo: centro.tipoProcesso.codigo, descricao: centro.tipoProcesso.descricao, posicao: centro.tipoProcesso.posicao },
        },
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
          // "Aguardando Cartão" sempre pertence à categoria Cortadeira,
          // independente do centro real da etapa — usa o código do
          // TipoProcesso cadastrado como 'CORTADEIRA' para essa empresa.
          tipoProcessoCodigo: 'CORTADEIRA' as string | null,
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
