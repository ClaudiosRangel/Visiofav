/**
 * Rotas de catálogo do Portal do Representante.
 *
 * Fornece dados de referência (tipos de embalagem, acabamentos) para
 * que o representante preencha solicitações de orçamento com opções
 * do cadastro real da empresa.
 *
 * Rotas protegidas por `portalRepAuth`.
 */

import { FastifyInstance } from 'fastify'
import { prisma } from '../../../lib/prisma'
import { portalRepAuth } from '../auth/portal-rep-auth.middleware'

export async function portalRepCatalogoRoutes(app: FastifyInstance) {

  // GET /catalogo/tipos-embalagem — lista tipos de embalagem da empresa
  app.get('/tipos-embalagem', { preHandler: [portalRepAuth] }, async (request, reply) => {
    const { empresaId } = request.portalRepUser

    const tipos = await prisma.tipoEmbalagem.findMany({
      where: { empresaId, status: true },
      select: {
        id: true,
        codigo: true,
        descricao: true,
      },
      orderBy: { descricao: 'asc' },
    })

    return reply.status(200).send(tipos)
  })

  // GET /catalogo/acabamentos — lista acabamentos disponíveis (fixos + parametros-perda)
  app.get('/acabamentos', { preHandler: [portalRepAuth] }, async (request, reply) => {
    // Acabamentos são um catálogo fixo da indústria gráfica
    // mas podemos enriquecer com os processos cadastrados nos centros de produção
    const { empresaId } = request.portalRepUser

    // Buscar tipos de processo distintos (que representam acabamentos)
    const tiposProcesso = await prisma.tipoProcesso.findMany({
      where: { empresaId, status: true },
      select: { codigo: true, descricao: true },
      orderBy: { posicao: 'asc' },
    })

    // Combinar com acabamentos padrão da indústria
    const acabamentosPadrao = [
      { codigo: 'CORTE_VINCO', descricao: 'Corte e Vinco' },
      { codigo: 'COLAGEM', descricao: 'Colagem' },
      { codigo: 'VERNIZ_UV', descricao: 'Verniz UV' },
      { codigo: 'LAMINACAO_BOPP', descricao: 'Laminação BOPP' },
      { codigo: 'LAMINACAO_FOSCA', descricao: 'Laminação Fosca' },
      { codigo: 'HOT_STAMPING', descricao: 'Hot Stamping' },
      { codigo: 'RELEVO_SECO', descricao: 'Relevo Seco' },
      { codigo: 'VERNIZ_AQUOSO', descricao: 'Verniz Aquoso' },
      { codigo: 'PLASTIFICACAO', descricao: 'Plastificação' },
    ]

    // Mesclar: processos da empresa + padrão (sem duplicar por código)
    const codigos = new Set<string>()
    const resultado: Array<{ codigo: string; descricao: string }> = []

    for (const tp of tiposProcesso) {
      if (!codigos.has(tp.codigo)) {
        codigos.add(tp.codigo)
        resultado.push({ codigo: tp.codigo, descricao: tp.descricao })
      }
    }

    for (const ap of acabamentosPadrao) {
      if (!codigos.has(ap.codigo)) {
        codigos.add(ap.codigo)
        resultado.push(ap)
      }
    }

    return reply.status(200).send(resultado)
  })
}
