import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { agregarContagensPorNivel, type NivelParaAgregacao } from './hierarquia-analitica.service'

/**
 * Relatório de distribuição de produtos por nível da Hierarquia Mercadológica
 * (Fase 2). Conta produtos por folha e agrega subindo a árvore (função pura
 * `agregarContagensPorNivel`), com totais com/sem hierarquia. Exportação CSV.
 *
 * Prefixo registrado no server.ts: /api/hierarquia-mercadologica/relatorio.
 * Isolamento multi-tenant com filtro EXPLÍCITO por empresaId (não confiar só
 * no prismaScoped, que faz bypass para SUPER_ADMIN).
 */

function getEmpresaId(request: any): string | undefined {
  return (request.user as { empresaId?: string } | undefined)?.empresaId
}

interface LinhaDistribuicao {
  id: string
  tipo: string
  codigo: string
  codigoHierarquico: string
  descricao: string
  contagem: number
}

interface Distribuicao {
  niveis: LinhaDistribuicao[]
  totalComHierarquia: number
  totalSemHierarquia: number
  totalGeral: number
}

/**
 * Calcula a distribuição por nível para a empresa. Todo o cálculo é concluído
 * antes de retornar — ou volta completo, ou lança (a rota responde 500 sem
 * contagens parciais, Req 2.8).
 */
async function calcularDistribuicao(empresaId: string): Promise<Distribuicao> {
  // Todos os níveis da empresa (inclusive os sem produto — Req 2.4).
  const niveis = await prisma.nivelMercadologico.findMany({
    where: { empresaId },
    select: { id: true, tipo: true, codigo: true, codigoHierarquico: true, descricao: true },
    orderBy: [{ codigoHierarquico: 'asc' }],
  })

  // Contagem por folha (GROUP BY familiaId), só produtos com hierarquia da empresa.
  const grupos = await prisma.produto.groupBy({
    by: ['familiaId'],
    where: { empresaId, familiaId: { not: null } },
    _count: { _all: true },
  })
  const contagensPorFolha: Record<string, number> = {}
  for (const g of grupos) {
    if (g.familiaId) contagensPorFolha[g.familiaId] = g._count._all
  }

  const porNivel = agregarContagensPorNivel(
    niveis as NivelParaAgregacao[],
    contagensPorFolha,
  )

  const totalComHierarquia = await prisma.produto.count({ where: { empresaId, familiaId: { not: null } } })
  const totalSemHierarquia = await prisma.produto.count({ where: { empresaId, familiaId: null } })

  return {
    niveis: niveis.map((n) => ({
      id: n.id,
      tipo: n.tipo,
      codigo: n.codigo,
      codigoHierarquico: n.codigoHierarquico,
      descricao: n.descricao,
      contagem: porNivel[n.id] ?? 0,
    })),
    totalComHierarquia,
    totalSemHierarquia,
    totalGeral: totalComHierarquia + totalSemHierarquia,
  }
}

/** Serializa a distribuição em CSV (com BOM UTF-8, aberto nativamente pelo Excel). */
function distribuicaoParaCsv(d: Distribuicao): string {
  const escape = (v: string | number) => {
    const s = String(v)
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const linhas: string[] = []
  linhas.push(['Tipo', 'Codigo Hierarquico', 'Descricao', 'Produtos'].join(';'))
  for (const n of d.niveis) {
    linhas.push([escape(n.tipo), escape(n.codigoHierarquico), escape(n.descricao), n.contagem].join(';'))
  }
  linhas.push('')
  linhas.push(['Total com hierarquia', '', '', d.totalComHierarquia].join(';'))
  linhas.push(['Total sem hierarquia', '', '', d.totalSemHierarquia].join(';'))
  linhas.push(['Total geral', '', '', d.totalGeral].join(';'))
  return '\uFEFF' + linhas.join('\r\n')
}

export async function hierarquiaRelatorioRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // GET /distribuicao — contagem por nível + totais.
  app.get('/distribuicao', async (request, reply) => {
    const empresaId = getEmpresaId(request)
    if (!empresaId) return reply.status(400).send({ message: 'Empresa não selecionada' })
    try {
      return await calcularDistribuicao(empresaId)
    } catch (err: any) {
      request.log.error({ err }, 'Falha ao gerar relatório de distribuição')
      return reply.status(500).send({ message: 'Não foi possível gerar o relatório de distribuição.' })
    }
  })

  // GET /distribuicao/export — exporta a distribuição (CSV; xlsx abre o CSV).
  app.get('/distribuicao/export', async (request, reply) => {
    const empresaId = getEmpresaId(request)
    if (!empresaId) return reply.status(400).send({ message: 'Empresa não selecionada' })
    const { formato } = z.object({
      formato: z.enum(['csv', 'xlsx']).default('csv'),
    }).parse(request.query)

    try {
      const d = await calcularDistribuicao(empresaId)
      const csv = distribuicaoParaCsv(d)
      // xlsx: entregamos CSV com BOM (o Excel abre nativamente). Uma exportação
      // .xlsx binária exigiria uma dependência de planilha ainda não adotada.
      const ext = formato === 'xlsx' ? 'xls' : 'csv'
      reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="distribuicao-hierarquia.${ext}"`)
      return reply.send(csv)
    } catch (err: any) {
      request.log.error({ err }, 'Falha ao exportar relatório de distribuição')
      return reply.status(500).send({ message: 'Não foi possível exportar o relatório.' })
    }
  })
}
