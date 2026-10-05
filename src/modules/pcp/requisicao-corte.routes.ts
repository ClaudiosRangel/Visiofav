import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { gerarPdfRequisicaoCorte } from './requisicao-corte-pdf.service'

/**
 * Rotas da Requisição de Corte de Cartão (RC) — formulário FO-002/PCP.
 * Spec: pcp-planos-frente-costa-rc (Fase A).
 *
 * Módulo independente: NÃO toca OP/etapas. Isolamento multi-tenant por
 * `empresaId` explícito em TODA query (não confia só em prismaScoped — ver
 * steering ATENCAO-pontos-verificar.md §2.1 sobre bypass de SUPER_ADMIN).
 *
 * Numeração: `NN/AAAA` sequencial por empresa + ano corrente.
 */
export async function requisicaoCorteRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('PCP'))

  // ---------------------------------------------------------------------------
  // GET /requisicoes-corte — Lista (filtro por empresa, busca por numero/produto)
  // ---------------------------------------------------------------------------
  app.get('/requisicoes-corte', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const query = z
      .object({
        busca: z.string().optional(),
        status: z.string().optional(),
        page: z.coerce.number().int().positive().optional().default(1),
        limit: z.coerce.number().int().positive().max(100).optional().default(50),
      })
      .parse(request.query)

    const where: any = { empresaId: user.empresaId }
    if (query.status) where.status = query.status
    if (query.busca) {
      where.OR = [
        { numero: { contains: query.busca, mode: 'insensitive' } },
        { nomeProduto: { contains: query.busca, mode: 'insensitive' } },
        { nomeServico: { contains: query.busca, mode: 'insensitive' } },
        { requisitante: { contains: query.busca, mode: 'insensitive' } },
      ]
    }

    const [data, total] = await Promise.all([
      prisma.requisicaoCorte.findMany({
        where,
        orderBy: { criadoEm: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.requisicaoCorte.count({ where }),
    ])

    return { data, total, page: query.page, limit: query.limit }
  })

  // ---------------------------------------------------------------------------
  // GET /requisicoes-corte/:id — Detalhe
  // ---------------------------------------------------------------------------
  app.get('/requisicoes-corte/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const rc = await prisma.requisicaoCorte.findFirst({
      where: { id, empresaId: user.empresaId },
    })
    if (!rc) return reply.status(404).send({ message: 'Requisição de corte não encontrada' })
    return rc
  })

  // ---------------------------------------------------------------------------
  // POST /requisicoes-corte — Cria (numero auto NN/AAAA por empresa/ano)
  // ---------------------------------------------------------------------------
  app.post('/requisicoes-corte', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }

    const body = bodySchema.parse(request.body)

    // Validar OP (se informada) pertence à empresa
    if (body.ordemProducaoId) {
      const op = await prisma.ordemProducao.findFirst({
        where: { id: body.ordemProducaoId, empresaId: user.empresaId },
        select: { id: true },
      })
      if (!op) return reply.status(400).send({ message: 'Ordem de produção informada não existe nesta empresa.' })
    }

    const numero = await proximoNumeroRc(user.empresaId)

    // Posição no fim da fila de RCs na fila da empresa (entra por último).
    const maxPos = await prisma.requisicaoCorte.aggregate({
      where: { empresaId: user.empresaId, status: { in: ['ABERTA', 'EM_CORTE'] } },
      _max: { posicaoFila: true },
    })

    const rc = await prisma.requisicaoCorte.create({
      data: {
        empresaId: user.empresaId,
        numero,
        posicaoFila: (maxPos._max.posicaoFila || 0) + 1,
        ordemProducaoId: body.ordemProducaoId ?? undefined,
        dataSolicitacao: body.dataSolicitacao ? new Date(body.dataSolicitacao) : new Date(),
        dataCorte: body.dataCorte ? new Date(body.dataCorte) : undefined,
        requisitante: body.requisitante,
        fabricanteCartao: body.fabricanteCartao,
        fornecedor: body.fornecedor ?? undefined,
        larguraBobinaCm: body.larguraBobinaCm ?? undefined,
        gramaturaG: body.gramaturaG ?? undefined,
        tamanhoCorteCm: body.tamanhoCorteCm ?? undefined,
        formatoCorte: body.formatoCorte ?? undefined,
        qtdFolhasCortadeira: body.qtdFolhasCortadeira ?? undefined,
        textoGuilhotina: body.textoGuilhotina ?? undefined,
        qtdFolhasGuilhotina: body.qtdFolhasGuilhotina ?? undefined,
        nomeProduto: body.nomeProduto,
        nomeServico: body.nomeServico,
        pesoKg: body.pesoKg ?? undefined,
        instrucoesRefile: body.instrucoesRefile ?? undefined,
        status: body.status ?? 'ABERTA',
        criadoPorId: user.id,
      },
    })

    return reply.status(201).send(rc)
  })

  // ---------------------------------------------------------------------------
  // PUT /requisicoes-corte/:id — Edita
  // ---------------------------------------------------------------------------
  app.put('/requisicoes-corte/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = bodySchema.parse(request.body)

    const existe = await prisma.requisicaoCorte.findFirst({
      where: { id, empresaId: user.empresaId },
      select: { id: true },
    })
    if (!existe) return reply.status(404).send({ message: 'Requisição de corte não encontrada' })

    if (body.ordemProducaoId) {
      const op = await prisma.ordemProducao.findFirst({
        where: { id: body.ordemProducaoId, empresaId: user.empresaId },
        select: { id: true },
      })
      if (!op) return reply.status(400).send({ message: 'Ordem de produção informada não existe nesta empresa.' })
    }

    const rc = await prisma.requisicaoCorte.update({
      where: { id },
      data: {
        ordemProducaoId: body.ordemProducaoId ?? null,
        dataSolicitacao: body.dataSolicitacao ? new Date(body.dataSolicitacao) : undefined,
        dataCorte: body.dataCorte ? new Date(body.dataCorte) : null,
        requisitante: body.requisitante,
        fabricanteCartao: body.fabricanteCartao,
        fornecedor: body.fornecedor ?? null,
        larguraBobinaCm: body.larguraBobinaCm ?? null,
        gramaturaG: body.gramaturaG ?? null,
        tamanhoCorteCm: body.tamanhoCorteCm ?? null,
        formatoCorte: body.formatoCorte ?? null,
        qtdFolhasCortadeira: body.qtdFolhasCortadeira ?? null,
        textoGuilhotina: body.textoGuilhotina ?? null,
        qtdFolhasGuilhotina: body.qtdFolhasGuilhotina ?? null,
        nomeProduto: body.nomeProduto,
        nomeServico: body.nomeServico,
        pesoKg: body.pesoKg ?? null,
        instrucoesRefile: body.instrucoesRefile ?? null,
        status: body.status ?? undefined,
      },
    })

    return rc
  })

  // ---------------------------------------------------------------------------
  // DELETE /requisicoes-corte/:id — Exclui
  // ---------------------------------------------------------------------------
  app.delete('/requisicoes-corte/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const existe = await prisma.requisicaoCorte.findFirst({
      where: { id, empresaId: user.empresaId },
      select: { id: true },
    })
    if (!existe) return reply.status(404).send({ message: 'Requisição de corte não encontrada' })

    await prisma.requisicaoCorte.delete({ where: { id } })
    return reply.status(204).send()
  })

  // ---------------------------------------------------------------------------
  // PATCH /requisicoes-corte/:id/iniciar — Marca como EM_CORTE (continua na fila)
  // ---------------------------------------------------------------------------
  app.patch('/requisicoes-corte/:id/iniciar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const existe = await prisma.requisicaoCorte.findFirst({
      where: { id, empresaId: user.empresaId },
      select: { id: true },
    })
    if (!existe) return reply.status(404).send({ message: 'Requisição de corte não encontrada' })

    const rc = await prisma.requisicaoCorte.update({
      where: { id },
      data: { status: 'EM_CORTE' },
    })
    return rc
  })

  // ---------------------------------------------------------------------------
  // PATCH /requisicoes-corte/:id/concluir — Marca como CORTADA (sai da fila)
  // ---------------------------------------------------------------------------
  app.patch('/requisicoes-corte/:id/concluir', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const existe = await prisma.requisicaoCorte.findFirst({
      where: { id, empresaId: user.empresaId },
      select: { id: true },
    })
    if (!existe) return reply.status(404).send({ message: 'Requisição de corte não encontrada' })

    const rc = await prisma.requisicaoCorte.update({
      where: { id },
      data: { status: 'CORTADA', dataCorte: new Date(), posicaoFila: null },
    })
    return rc
  })

  // ---------------------------------------------------------------------------
  // PATCH /requisicoes-corte/:id/reabrir — Volta para ABERTA (reentra na fila)
  // ---------------------------------------------------------------------------
  app.patch('/requisicoes-corte/:id/reabrir', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const existe = await prisma.requisicaoCorte.findFirst({
      where: { id, empresaId: user.empresaId },
      select: { id: true },
    })
    if (!existe) return reply.status(404).send({ message: 'Requisição de corte não encontrada' })

    const maxPos = await prisma.requisicaoCorte.aggregate({
      where: { empresaId: user.empresaId, status: { in: ['ABERTA', 'EM_CORTE'] } },
      _max: { posicaoFila: true },
    })

    const rc = await prisma.requisicaoCorte.update({
      where: { id },
      data: { status: 'ABERTA', posicaoFila: (maxPos._max.posicaoFila || 0) + 1 },
    })
    return rc
  })

  // ---------------------------------------------------------------------------
  // PATCH /requisicoes-corte/reordenar — Renumera posicaoFila (1..N) na ordem
  // recebida. Mesma mecânica de PATCH /etapas/reordenar.
  // ---------------------------------------------------------------------------
  app.patch('/requisicoes-corte/reordenar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = z.object({ ids: z.array(z.string().uuid()) }).parse(request.body)

    // Garante que todas as RCs pertencem à empresa antes de reordenar.
    const rcs = await prisma.requisicaoCorte.findMany({
      where: { id: { in: body.ids }, empresaId: user.empresaId },
      select: { id: true },
    })
    const validos = new Set(rcs.map((r) => r.id))

    let pos = 1
    for (const id of body.ids) {
      if (!validos.has(id)) continue
      await prisma.requisicaoCorte.update({ where: { id }, data: { posicaoFila: pos++ } })
    }
    return reply.send({ message: 'Fila de RCs reordenada', total: pos - 1 })
  })

  // ---------------------------------------------------------------------------
  // GET /requisicoes-corte/:id/pdf — Gera o PDF da 1ª via
  // Aceita token via query param (abrir em nova aba do navegador sem header
  // Authorization), mesmo padrão de GET /op-pdf/:opId.
  // ---------------------------------------------------------------------------
  app.get('/requisicoes-corte/:id/pdf', { onRequest: [], preHandler: [] }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const query = request.query as any
    const token = query.token as string | undefined

    let user: { id: string; empresaId: string } | null = null
    if (token) {
      try {
        const decoded = app.jwt.verify(token) as any
        user = { id: decoded.sub || decoded.id, empresaId: decoded.empresaId }
      } catch {
        return reply.status(401).send({ message: 'Token inválido' })
      }
    } else {
      user = (request.user as { id: string; empresaId: string }) || null
    }
    if (!user) return reply.status(401).send({ message: 'Não autenticado' })

    const rc = await prisma.requisicaoCorte.findFirst({
      where: { id, empresaId: user.empresaId },
    })
    if (!rc) return reply.status(404).send({ message: 'Requisição de corte não encontrada' })

    const empresa = await prisma.empresa.findUnique({
      where: { id: user.empresaId },
      select: { razaoSocial: true, nomeFantasia: true, logo: true },
    })

    const pdfBuffer = await gerarPdfRequisicaoCorte(rc, empresa)

    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="RC-${rc.numero.replace('/', '-')}.pdf"`)
      .send(pdfBuffer)
  })
}

// =============================================================================
// Schema de validação (compartilhado entre POST e PUT)
// =============================================================================
const bodySchema = z.object({
  ordemProducaoId: z.string().uuid().optional().nullable(),
  dataSolicitacao: z.string().optional(),
  dataCorte: z.string().optional().nullable(),
  requisitante: z.string().min(1, 'Requisitante é obrigatório').max(120),
  fabricanteCartao: z.string().min(1, 'Fabricante/Cartão é obrigatório').max(120),
  fornecedor: z.string().max(120).optional().nullable(),
  larguraBobinaCm: z.number().nonnegative().optional().nullable(),
  gramaturaG: z.number().nonnegative().optional().nullable(),
  tamanhoCorteCm: z.number().nonnegative().optional().nullable(),
  formatoCorte: z.string().max(60).optional().nullable(),
  qtdFolhasCortadeira: z.number().int().nonnegative().optional().nullable(),
  textoGuilhotina: z.string().max(120).optional().nullable(),
  qtdFolhasGuilhotina: z.number().int().nonnegative().optional().nullable(),
  nomeProduto: z.string().min(1, 'Nome do produto é obrigatório').max(200),
  nomeServico: z.string().min(1, 'Nome do serviço é obrigatório').max(200),
  pesoKg: z.number().nonnegative().optional().nullable(),
  instrucoesRefile: z.string().optional().nullable(),
  status: z.enum(['ABERTA', 'CORTADA', 'CANCELADA']).optional(),
})

// =============================================================================
// Numeração NN/AAAA sequencial por empresa + ano corrente.
// Busca a maior RC do ano da empresa, extrai o prefixo e soma 1. Começa em
// 1/AAAA. Mesmo espírito do proximoNumero usado em OP/avulsas.
// =============================================================================
async function proximoNumeroRc(empresaId: string): Promise<string> {
  const ano = new Date().getFullYear()
  const sufixo = `/${ano}`

  const doAno = await prisma.requisicaoCorte.findMany({
    where: { empresaId, numero: { endsWith: sufixo } },
    select: { numero: true },
  })

  let maior = 0
  for (const r of doAno) {
    const m = r.numero.match(/^(\d+)\//)
    if (m) maior = Math.max(maior, parseInt(m[1], 10))
  }

  return `${maior + 1}${sufixo}`
}
