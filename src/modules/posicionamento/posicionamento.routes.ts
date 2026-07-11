import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'

const querySchema = z.object({
  depositoId: z.string().uuid().optional(),
  zonaId: z.string().uuid().optional(),
  rua: z.string().optional(),
  produtoId: z.string().uuid().optional(),
})

export async function posicionamentoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // GET /mapa — retorna mapa visual do armazém (endereços com ocupação)
  app.get('/mapa', async (request) => {
    const query = querySchema.parse(request.query)
    const user = request.user as { id: string; empresaId?: string }

    // Segurança: isolar por tenant — sem isso, o mapa do armazém exibiria
    // endereços/saldos de TODAS as empresas cadastradas no banco.
    const where: any = {}
    if (user.empresaId) where.empresaId = user.empresaId
    if (query.depositoId) where.depositoId = query.depositoId
    if (query.zonaId) where.zonaId = query.zonaId
    if (query.rua) where.codigoRua = query.rua

    // Se filtro por produto, buscar apenas endereços que tenham saldo desse produto
    if (query.produtoId) {
      where.saldos = { some: { produtoId: query.produtoId, quantidade: { gt: 0 } } }
    }

    const saldoWhere: any = { quantidade: { gt: 0 } }
    if (query.produtoId) saldoWhere.produtoId = query.produtoId

    const enderecos = await prisma.endereco.findMany({
      where,
      orderBy: [{ codigoRua: 'asc' }, { codigoPredio: 'asc' }, { codigoNivel: 'asc' }, { codigoApto: 'asc' }],
      include: {
        saldos: {
          where: saldoWhere,
          include: { produto: { select: { id: true, nome: true, descricao: true, codigo: true } } },
        },
      },
    })

    // Agrupar por rua → prédio → nível → apto
    const mapa: Record<string, Record<string, Array<{
      nivel: string
      apto: string
      enderecoId: string
      enderecoCompleto: string
      tipo: string
      ocupacao: 'LIVRE' | 'PARCIAL' | 'CHEIO' | 'BLOQUEADO'
      produtos: Array<{ id: string; codigo: string; descricao: string; quantidade: number }>
      totalQuantidade: number
    }>>> = {}

    for (const end of enderecos) {
      const rua = end.codigoRua || '001'
      const predio = end.codigoPredio || '001'

      if (!mapa[rua]) mapa[rua] = {}
      if (!mapa[rua][predio]) mapa[rua][predio] = []

      const produtos = end.saldos.map((s: any) => ({
        id: s.produto?.id || s.produtoId,
        codigo: s.produto?.codigo || '',
        descricao: s.produto?.nome || s.produto?.descricao || '',
        quantidade: Number(s.quantidade),
      }))

      const totalQuantidade = produtos.reduce((s, p) => s + p.quantidade, 0)

      // Calcular capacidade para determinar se é PARCIAL ou CHEIO
      let capacidadePalete = 0
      if (produtos.length > 0) {
        // Buscar SKU do primeiro produto para calcular capacidade
        const primeiroProdutoId = end.saldos[0]?.produto?.id || end.saldos[0]?.produtoId
        if (primeiroProdutoId) {
          const skuProd = await prisma.sku.findFirst({
            where: { produtoId: primeiroProdutoId, lastro: { not: null }, camada: { not: null } },
            orderBy: { sequencia: 'desc' },
            select: { lastro: true, camada: true },
          })
          if (skuProd?.lastro && skuProd?.camada) {
            capacidadePalete = skuProd.lastro * skuProd.camada
          }
        }
      }
      // Fallback: capacidade da estrutura
      if (capacidadePalete === 0 && end.estruturaId) {
        const estrutura = await prisma.estrutura.findUnique({ where: { id: end.estruturaId }, select: { capacidade: true } })
        if (estrutura?.capacidade) capacidadePalete = Number(estrutura.capacidade)
      }

      let ocupacao: 'LIVRE' | 'PARCIAL' | 'CHEIO' | 'BLOQUEADO' = 'LIVRE'
      if (end.tipo === 'BLOQUEADO') ocupacao = 'BLOQUEADO'
      else if (totalQuantidade > 0 && capacidadePalete > 0 && totalQuantidade >= capacidadePalete) ocupacao = 'CHEIO'
      else if (totalQuantidade > 0) ocupacao = 'PARCIAL'

      mapa[rua][predio].push({
        nivel: end.codigoNivel || '001',
        apto: end.codigoApto || '001',
        enderecoId: end.id,
        enderecoCompleto: end.enderecoCompleto || '',
        tipo: end.tipo || 'ARMAZENAGEM',
        ocupacao,
        areaArmazenagem: (end as any).areaArmazenagem === 'PICKING'
          ? 'PICKING'
          : (end as any).areaArmazenagem === 'PULMAO'
            ? 'PULMAO'
            : ((end.codigoNivel === '001' || end.codigoNivel === '01' || end.codigoNivel === '1') ? 'PICKING' : 'PULMAO'),
        produtos,
        totalQuantidade,
      })
    }

    // Estatísticas
    const totalEnderecos = enderecos.length
    const livres = enderecos.filter((e) => !e.saldos.some((s: any) => Number(s.quantidade) > 0) && e.tipo !== 'BLOQUEADO').length
    const ocupados = enderecos.filter((e) => e.saldos.some((s: any) => Number(s.quantidade) > 0)).length
    const bloqueados = enderecos.filter((e) => e.tipo === 'BLOQUEADO').length

    return {
      mapa,
      estatisticas: {
        totalEnderecos,
        livres,
        ocupados,
        bloqueados,
        percentualOcupacao: totalEnderecos > 0 ? Math.round((ocupados / totalEnderecos) * 100) : 0,
      },
      ruas: Object.keys(mapa).sort(),
    }
  })

  // GET /saldo-enderecado — consulta saldo por endereço (tabela detalhada)
  app.get('/saldo-enderecado', async (request) => {
    const { produtoId } = z.object({ produtoId: z.string().uuid().optional() }).parse(request.query)
    const user = request.user as { id: string; empresaId?: string }

    // Segurança: isolar por tenant, via relação com o Endereco da empresa
    // (SaldoEndereco não possui empresaId próprio no schema).
    const where: any = { quantidade: { gt: 0 } }
    if (produtoId) where.produtoId = produtoId
    if (user.empresaId) where.endereco = { empresaId: user.empresaId }

    const saldos = await prisma.saldoEndereco.findMany({
      where,
      orderBy: { atualizadoEm: 'desc' },
      include: {
        produto: { select: { id: true, nome: true, descricao: true, codigo: true } },
        endereco: { select: { id: true, enderecoCompleto: true, codigoRua: true, codigoPredio: true, codigoNivel: true, codigoApto: true } },
      },
    })

    return { data: saldos, total: saldos.length }
  })

  // GET /estado-enderecos — resumo de estados dos endereços
  app.get('/estado-enderecos', async (request) => {
    const user = request.user as { id: string; empresaId?: string }
    // Segurança: isolar por tenant — sem isso, retornaria endereços de todas as empresas.
    const where: any = {}
    if (user.empresaId) where.empresaId = user.empresaId

    const enderecos = await prisma.endereco.findMany({
      where,
      select: { id: true, enderecoCompleto: true, tipo: true, codigoRua: true, codigoPredio: true, codigoNivel: true, codigoApto: true },
      orderBy: [{ codigoRua: 'asc' }, { codigoPredio: 'asc' }, { codigoNivel: 'asc' }, { codigoApto: 'asc' }],
    })

    return { data: enderecos, total: enderecos.length }
  })

  // PATCH /estado-enderecos/:id — alterar estado de um endereço
  app.patch('/estado-enderecos/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const { tipo } = z.object({ tipo: z.string() }).parse(request.body)

    const user = request.user as { id: string; empresaId?: string }
    // Segurança: isolar por tenant — evita alterar Endereco de outra Empresa.
    const endereco = user.empresaId
      ? await prisma.endereco.findFirst({ where: { id, empresaId: user.empresaId } })
      : await prisma.endereco.findUnique({ where: { id } })
    if (!endereco) return reply.status(404).send({ message: 'Endereço não encontrado' })

    const atualizado = await prisma.endereco.update({ where: { id }, data: { tipo } })
    return atualizado
  })
}
