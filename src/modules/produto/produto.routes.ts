import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { peekProximoCodigo, gerarProximoCodigo, CodigoSequencialEsgotadoError } from './codigo-sequencial.service'

export async function produtoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // GET /proximo-codigo — sugere o próximo código sequencial de Produto
  // (6 dígitos) para preenchimento automático no formulário. Não consome o
  // contador (só prévia); o código definitivo é resolvido no create.
  app.get('/proximo-codigo', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) return reply.status(400).send({ message: 'Empresa não selecionada' })
    const codigo = await peekProximoCodigo(prisma, user.empresaId)
    if (!codigo) return reply.status(409).send({ message: 'Faixa de códigos sequenciais esgotada' })
    return { codigo }
  })

  app.get('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    const q = z.object({
      page: z.coerce.number().default(1),
      limit: z.coerce.number().default(20),
      busca: z.string().optional(),
      search: z.string().optional(),
      status: z.string().optional(),
      // Hierarquia Mercadológica Fase 2 — filtro por qualquer nível da árvore.
      nivelId: z.string().uuid().optional(),
      semHierarquia: z.coerce.boolean().optional(),
    }).parse(request.query)

    const search = q.busca || q.search
    const where: any = {}
    if (user.empresaId) where.empresaId = user.empresaId
    if (search) {
      where.OR = [
        { nome: { contains: search, mode: 'insensitive' } },
        { codigo: { contains: search, mode: 'insensitive' } },
        { cEAN: { contains: search } },
      ]
    }
    if (q.status) where.status = q.status === 'true'

    // Filtro de hierarquia (Fase 2). "semHierarquia" tem prioridade e ignora
    // "nivelId" (Req 1.7). Sem nenhum dos dois, não filtra por hierarquia (Req 1.6).
    if (q.semHierarquia) {
      where.familiaId = null
    } else if (q.nivelId) {
      // Resolve o nível na própria empresa (isolamento explícito — Req 1.8/1.9).
      const nivel = await prisma.nivelMercadologico.findFirst({
        where: { id: q.nivelId, ...(user.empresaId ? { empresaId: user.empresaId } : {}) },
        select: { codigoHierarquico: true },
      })
      if (!nivel) {
        return reply.status(400).send({ message: 'Nível inválido para esta empresa.' })
      }
      // Todas as folhas (SUBCATEGORIA) descendentes do nível: o próprio código
      // ou qualquer código que comece por "<codigo>." (filtro por prefixo).
      const folhas = await prisma.nivelMercadologico.findMany({
        where: {
          ...(user.empresaId ? { empresaId: user.empresaId } : {}),
          tipo: 'SUBCATEGORIA',
          OR: [
            { codigoHierarquico: nivel.codigoHierarquico },
            { codigoHierarquico: { startsWith: `${nivel.codigoHierarquico}.` } },
          ],
        },
        select: { id: true },
      })
      where.familiaId = { in: folhas.map((f) => f.id) }
    }

    const [data, total] = await Promise.all([
      prisma.produto.findMany({ where, skip: (q.page - 1) * q.limit, take: q.limit, orderBy: { nome: 'asc' } }),
      prisma.produto.count({ where }),
    ])
    return { data, total }
  })

  app.get('/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const userForFind = request.user as { id: string; empresaId?: string }
    // Segurança: isolar por tenant — sem isso, um usuário poderia acessar
    // dados de Produto de outra Empresa apenas sabendo/adivinhando o id.
    const produto = userForFind.empresaId
      ? await prisma.produto.findFirst({ where: { id, empresaId: userForFind.empresaId } })
      : await prisma.produto.findUnique({ where: { id } })
    if (!produto) return reply.status(404).send({ message: 'Produto não encontrado' })

    // Incluir ConfigConferenciaProduto se existir
    const user = request.user as { id: string; empresaId?: string }
    let aceitarSenha = false
    let aceitarCcePendente = false
    if (user.empresaId) {
      const config = await prisma.configConferenciaProduto.findUnique({
        where: { empresaId_produtoId: { empresaId: user.empresaId, produtoId: id } },
      })
      if (config) {
        aceitarSenha = config.aceitarSenha
        aceitarCcePendente = config.aceitarCcePendente
      }
    }

    return {
      ...produto,
      aceitarSenha,
      aceitarCcePendente,
      toleranciaQuantidadePercentual: produto.toleranciaQuantidadePercentual != null ? Number(produto.toleranciaQuantidadePercentual) : null,
    }
  })

  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    const data = z.object({
      codigo: z.string().min(1),
      nome: z.string().min(1),
      descricao: z.string().optional(),
      unidade: z.string().default('UN'),
      precoBase: z.number().optional(),
      status: z.boolean().default(true),
      cEAN: z.string().optional(),
      ncm: z.string().optional(),
      cfopEstadual: z.string().optional(),
      cfopInterest: z.string().optional(),
      cst: z.string().optional(),
      csosn: z.string().optional(),
      aliqICMS: z.number().optional(),
      aliqIPI: z.number().optional(),
      cstPIS: z.string().optional(),
      aliqPIS: z.number().optional(),
      cstCOFINS: z.string().optional(),
      aliqCOFINS: z.number().optional(),
      origemProd: z.number().optional(),
      toleranciaQuantidadePercentual: z.number().min(0).max(100).nullable().optional(),
      // Regras de recebimento/armazenagem — permitem criar o produto já
      // configurado num único passo (usado pela suíte de QA e cadastros reais).
      exigeLote: z.boolean().optional(),
      shelfLifeMinimo: z.number().int().positive().nullable().optional(),
      curvaAbc: z.enum(['A', 'B', 'C']).nullable().optional(),
      ambienteExigido: z.enum(['SECO', 'REFRIGERADO', 'CONGELADO']).nullable().optional(),
      classificacaoArmazenagemId: z.string().uuid().nullable().optional(),
      // Hierarquia Mercadológica — vínculo ao nível folha (Subcategoria/Família).
      familiaId: z.string().uuid().nullable().optional(),
      // Atributos Logísticos e Shelf Life (spec atributos-logisticos-shelf-life).
      periculosidade: z.enum(['ISENTO', 'CARGA_GERAL', 'PERIGOSO', 'INFLAMAVEL']).nullable().optional(),
      shelfLifeTotalDias: z.number().int().positive().nullable().optional(),
      percentualVidaUtilMinimoRecebimento: z.number().min(0).max(100).nullable().optional(),
      diasQuarentenaVencimento: z.number().int().min(0).nullable().optional(),
    }).parse(request.body)

    if (!user.empresaId) return reply.status(400).send({ message: 'Empresa não selecionada' })
    const empresaId = user.empresaId

    // Validar que a Família informada existe, é do tipo SUBCATEGORIA (nível
    // folha) e pertence à mesma empresa (Req 3.3). null/ausente = sem vínculo.
    if (data.familiaId) {
      const familia = await prisma.nivelMercadologico.findFirst({
        where: { id: data.familiaId, empresaId },
        select: { tipo: true },
      })
      if (!familia) return reply.status(400).send({ message: 'Subcategoria/Família (nível mercadológico) não encontrada.' })
      if (familia.tipo !== 'SUBCATEGORIA') {
        return reply.status(400).send({ message: 'O vínculo mercadológico do produto deve ser um nível folha (Subcategoria/Família).' })
      }
    }

    // Correção do bug do código automático: o `GET /proximo-codigo` só faz peek
    // (não incrementa), e o create gravava o código sem NUNCA consumir o
    // contador — deixando o sequencial travado, gerando o mesmo número
    // repetidamente e permitindo duplicidade. Agora, quando o código enviado é
    // exatamente o próximo sequencial sugerido, o create consome o contador
    // atomicamente (gerarProximoCodigo) dentro de uma transação; se colidir,
    // avança para o próximo automaticamente. Código manual (diferente da
    // sugestão) é respeitado como está.
    try {
      const criado = await prisma.$transaction(async (tx) => {
        const proximoSugerido = await peekProximoCodigo(tx, empresaId)
        let codigoFinal = data.codigo

        if (proximoSugerido && data.codigo === proximoSugerido) {
          // Veio da sugestão automática → consome o contador de fato.
          codigoFinal = await gerarProximoCodigo(tx, empresaId)
          // Se o valor consumido já existir (colisão por estado inconsistente),
          // continua avançando até achar um livre dentro da faixa.
          // eslint-disable-next-line no-await-in-loop
          while (await tx.produto.findFirst({ where: { empresaId, codigo: codigoFinal }, select: { id: true } })) {
            codigoFinal = await gerarProximoCodigo(tx, empresaId)
          }
        }

        return tx.produto.create({ data: { ...data, codigo: codigoFinal, empresaId } })
      })
      return reply.status(201).send(criado)
    } catch (err: any) {
      if (err instanceof CodigoSequencialEsgotadoError) {
        return reply.status(409).send({ message: 'Faixa de códigos sequenciais de produto esgotada.' })
      }
      // Código duplicado (manual ou colisão): mensagem clara em vez de 500.
      if (err?.code === 'P2002') {
        return reply.status(409).send({ message: `Já existe um produto com o código "${data.codigo}" nesta empresa.` })
      }
      request.log.error({ err }, 'Falha ao criar produto')
      return reply.status(500).send({ message: `Falha ao criar produto: ${err?.message ?? 'erro desconhecido'}` })
    }
  })

  app.put('/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const userForUpdate = request.user as { id: string; empresaId?: string }
    if (userForUpdate.empresaId) {
      const existente = await prisma.produto.findFirst({ where: { id, empresaId: userForUpdate.empresaId } })
      if (!existente) return reply.status(404).send({ message: 'Produto não encontrado' })
    }
    const data = z.object({
      codigo: z.string().optional(),
      nome: z.string().optional(),
      descricao: z.string().optional(),
      unidade: z.string().optional(),
      precoBase: z.number().optional(),
      status: z.boolean().optional(),
      cEAN: z.string().optional(),
      ncm: z.string().optional(),
      cfopEstadual: z.string().optional(),
      cfopInterest: z.string().optional(),
      cst: z.string().optional(),
      csosn: z.string().optional(),
      aliqICMS: z.number().optional(),
      aliqIPI: z.number().optional(),
      cstPIS: z.string().optional(),
      aliqPIS: z.number().optional(),
      cstCOFINS: z.string().optional(),
      aliqCOFINS: z.number().optional(),
      origemProd: z.number().optional(),
      shelfLifeMinimo: z.number().int().positive().nullable().optional(),
      curvaAbc: z.enum(['A', 'B', 'C']).nullable().optional(),
      classificacaoPcp: z.enum(['MATERIA_PRIMA', 'INTERMEDIARIO', 'PRODUTO_ACABADO', 'EMBALAGEM', 'INSUMO']).nullable().optional(),
      tipoFisico: z.enum(['UNIDADE_PADRAO', 'FISICO_LINEAR', 'FISICO_SUPERFICIAL', 'LIQUIDO', 'PESO']).nullable().optional(),
      exigeLote: z.boolean().optional(),
      // Compatibilidade de área (RF004) — usados pelo motor de put-away RF008
      // para restringir os endereços elegíveis por ambiente/classificação.
      ambienteExigido: z.enum(['SECO', 'REFRIGERADO', 'CONGELADO']).nullable().optional(),
      classificacaoArmazenagemId: z.string().uuid().nullable().optional(),
      aceitarSenha: z.boolean().optional(),
      aceitarCcePendente: z.boolean().optional(),
      toleranciaQuantidadePercentual: z.number().min(0).max(100).nullable().optional(),
      // Hierarquia Mercadológica — vínculo ao nível folha (Família).
      familiaId: z.string().uuid().nullable().optional(),
      // Atributos Logísticos e Shelf Life (spec atributos-logisticos-shelf-life).
      periculosidade: z.enum(['ISENTO', 'CARGA_GERAL', 'PERIGOSO', 'INFLAMAVEL']).nullable().optional(),
      shelfLifeTotalDias: z.number().int().positive().nullable().optional(),
      percentualVidaUtilMinimoRecebimento: z.number().min(0).max(100).nullable().optional(),
      diasQuarentenaVencimento: z.number().int().min(0).nullable().optional(),
    }).parse(request.body)

    // Separar campos de ConfigConferenciaProduto dos campos do Produto
    const { aceitarSenha, aceitarCcePendente, ...produtoData } = data

    // Validar que a Família informada existe, é do tipo SUBCATEGORIA (nível
    // folha) e pertence à mesma empresa (Req 3.3). null limpa o vínculo.
    if (produtoData.familiaId) {
      const user = request.user as { empresaId?: string }
      const familia = await prisma.nivelMercadologico.findFirst({
        where: { id: produtoData.familiaId, ...(user.empresaId ? { empresaId: user.empresaId } : {}) },
        select: { tipo: true },
      })
      if (!familia) return reply.status(400).send({ message: 'Subcategoria/Família (nível mercadológico) não encontrada.' })
      if (familia.tipo !== 'SUBCATEGORIA') {
        return reply.status(400).send({ message: 'O vínculo mercadológico do produto deve ser um nível folha (Subcategoria/Família).' })
      }
    }

    const produtoAtualizado = await prisma.produto.update({ where: { id }, data: produtoData })

    // Salvar/atualizar ConfigConferenciaProduto se campos de bloqueio informados
    if (aceitarSenha !== undefined || aceitarCcePendente !== undefined) {
      const user = request.user as { id: string; empresaId?: string }
      if (user.empresaId) {
        await prisma.configConferenciaProduto.upsert({
          where: { empresaId_produtoId: { empresaId: user.empresaId, produtoId: id } },
          create: {
            empresaId: user.empresaId,
            produtoId: id,
            aceitarSenha: aceitarSenha ?? false,
            aceitarCcePendente: aceitarCcePendente ?? false,
          },
          update: {
            ...(aceitarSenha !== undefined && { aceitarSenha }),
            ...(aceitarCcePendente !== undefined && { aceitarCcePendente }),
          },
        })
      }
    }

    return produtoAtualizado
  })

  // POST /batch-shelf-life — atualização em lote do shelfLifeMinimo
  app.post('/batch-shelf-life', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) return reply.status(400).send({ message: 'Empresa não selecionada' })

    const body = z.object({
      itens: z.array(z.object({
        produtoId: z.string().uuid().optional(),
        codigo: z.string().optional(),
        shelfLifeMinimo: z.number().int().positive().nullable(),
      })).min(1, 'A lista de itens não pode ser vazia'),
    }).parse(request.body)

    const resultados: Array<{ produtoId?: string; codigo?: string; sucesso: boolean; erro?: string }> = []
    let sucessos = 0
    let falhas = 0

    for (const item of body.itens) {
      try {
        let produto = null

        if (item.produtoId) {
          produto = await prisma.produto.findFirst({
            where: { id: item.produtoId, empresaId: user.empresaId },
          })
        } else if (item.codigo) {
          produto = await prisma.produto.findFirst({
            where: { codigo: item.codigo, empresaId: user.empresaId },
          })
        }

        if (!produto) {
          falhas++
          resultados.push({
            produtoId: item.produtoId,
            codigo: item.codigo,
            sucesso: false,
            erro: `Produto não encontrado: ${item.produtoId || item.codigo}`,
          })
          continue
        }

        await prisma.produto.update({
          where: { id: produto.id },
          data: { shelfLifeMinimo: item.shelfLifeMinimo },
        })

        sucessos++
        resultados.push({
          produtoId: produto.id,
          codigo: produto.codigo,
          sucesso: true,
        })
      } catch (err: any) {
        falhas++
        resultados.push({
          produtoId: item.produtoId,
          codigo: item.codigo,
          sucesso: false,
          erro: err.message || 'Erro desconhecido',
        })
      }
    }

    return { total: body.itens.length, sucessos, falhas, resultados }
  })

  app.delete('/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const userForDelete = request.user as { id: string; empresaId?: string }
    if (userForDelete.empresaId) {
      const existente = await prisma.produto.findFirst({ where: { id, empresaId: userForDelete.empresaId } })
      if (!existente) return reply.status(404).send({ message: 'Produto não encontrado' })
    }
    await prisma.produto.delete({ where: { id } })
    return reply.status(204).send()
  })

  // POST /:id/imagem — Upload de imagem do produto (base64)
  app.post('/:id/imagem', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const user = request.user as { id: string; empresaId?: string }

    const data = await request.file()
    if (!data) return reply.status(400).send({ message: 'Nenhum arquivo enviado' })

    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
    if (!allowedMimes.includes(data.mimetype)) {
      return reply.status(400).send({ message: 'Formato inválido. Use JPEG, PNG, WebP ou GIF.' })
    }

    const buffer = await data.toBuffer()
    // Limitar a 2MB
    if (buffer.length > 2 * 1024 * 1024) {
      return reply.status(400).send({ message: 'Imagem muito grande. Máximo 2MB.' })
    }

    const base64 = `data:${data.mimetype};base64,${buffer.toString('base64')}`

    const produto = await prisma.produto.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!produto) return reply.status(404).send({ message: 'Produto não encontrado' })

    await prisma.produto.update({ where: { id }, data: { imagemUrl: base64 } })

    return { message: 'Imagem salva com sucesso', imagemUrl: base64 }
  })

  // DELETE /:id/imagem — Remover imagem do produto
  app.delete('/:id/imagem', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const user = request.user as { id: string; empresaId?: string }

    const produto = await prisma.produto.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!produto) return reply.status(404).send({ message: 'Produto não encontrado' })

    await prisma.produto.update({ where: { id }, data: { imagemUrl: null } })

    return reply.status(204).send()
  })

  // POST /recalcular-curva-abc — Recalcula curva ABC de todos os produtos
  app.post('/recalcular-curva-abc', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    if (!user.empresaId) return reply.status(400).send({ message: 'Empresa não selecionada' })

    const { calcularCurvaAbc } = await import('./curva-abc.service')
    const resultado = await calcularCurvaAbc(user.empresaId)

    return resultado
  })
}
