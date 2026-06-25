import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'

const TABELAS_POR_MODULO: Record<string, string[]> = {
  pcp: [
    'apontamento_etapa',
    'apontamento_producao',
    'log_ordem_producao',
    'item_liberacao',
    'liberacao_material',
    'variacao_ordem_producao',
    'programacao_entrega',
    'etapa_ordem_producao',
    'item_ordem_producao',
    'ordem_producao',
    'item_estrutura',
    'estrutura_produto',
    'etapa_roteiro',
    'roteiro_producao',
    'recurso_producao',
    'centro_producao',
    'turno_producao',
    'de_para_importacao',
  ],
  wms: [
    'carregamento_volume',
    'carregamento',
    'item_volume',
    'volume',
    'item_conferencia_saida',
    'conferencia_saida',
    'item_separacao',
    'ordem_separacao',
    'onda_pedido',
    'onda_separacao',
    'os_funcionario_wms',
    'ordem_servico_wms',
    'item_inventario',
    'inventario',
    'log_movimentacao',
    'saldo_endereco',
    'item_nota_entrada',
    'nota_entrada',
    'pendencia_logistica',
    'ficha_operacional',
  ],
  vendas: [
    'item_pedido_venda',
    'pedido_venda',
    'venda_efetivada',
    'condicao_pagamento',
    'tabela_preco',
  ],
  compras: [
    'item_devolucao_compra',
    'devolucao_compra',
    'item_pedido_compra',
    'pedido_compra',
    'compra_efetivada',
  ],
  financeiro: [
    'conta_pagar',
    'conta_receber',
  ],
  fiscal: [
    'item_nfe',
    'nfe',
    'nfe_cte_referencia',
    'cte',
  ],
}

const limparSchema = z.object({
  modulos: z.array(z.enum(['pcp', 'wms', 'vendas', 'compras', 'financeiro', 'fiscal'])).min(1),
})

/**
 * Rotas administrativas — operações destrutivas protegidas por autenticação + perfil ADMIN
 */
export async function adminPcpRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  /**
   * DELETE /api/admin/limpar-dados
   * Limpa tabelas dos módulos selecionados (TRUNCATE CASCADE)
   * Requer perfil SUPER_ADMIN ou ADMIN
   */
  app.delete('/limpar-dados', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }

    // Verificar perfil admin
    const usuario = await prisma.usuario.findUnique({
      where: { id: user.id },
      select: { perfil: true },
    })

    if (!usuario || !['SUPER_ADMIN', 'ADMIN'].includes(usuario.perfil)) {
      return reply.status(403).send({ message: 'Apenas administradores podem limpar dados' })
    }

    const { modulos } = limparSchema.parse(request.body)

    const resultado: { modulo: string; tabela: string; status: string }[] = []

    for (const modulo of modulos) {
      const tabelas = TABELAS_POR_MODULO[modulo] || []
      for (const tabela of tabelas) {
        try {
          await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${tabela}" CASCADE`)
          resultado.push({ modulo, tabela, status: 'ok' })
        } catch (e: any) {
          resultado.push({ modulo, tabela, status: `erro: ${e.message?.substring(0, 80)}` })
        }
      }
    }

    return reply.send({
      message: `Limpeza concluída para módulos: ${modulos.join(', ')}`,
      modulosLimpos: modulos,
      detalhes: resultado,
    })
  })
}
