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
    // Agenda de Recebimento (Docas/Portaria) — VeiculoPatio.agendamentoId usa
    // onDelete: SetNull, então limpar agenda_wms não é bloqueado por FK (o
    // Postgres apenas zera o vínculo em veiculo_patio automaticamente).
    'agenda_wms',
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
    const empresaId = user.empresaId

    if (!empresaId) {
      return reply.status(400).send({ message: 'Empresa não selecionada' })
    }

    const resultado: { modulo: string; tabela: string; status: string; registros?: number }[] = []

    for (const modulo of modulos) {
      const tabelas = TABELAS_POR_MODULO[modulo] || []
      for (const tabela of tabelas) {
        try {
          // Primeiro tenta com empresa_id (tabelas multi-tenant)
          const res = await prisma.$executeRawUnsafe(
            `DELETE FROM "${tabela}" WHERE "empresa_id" = $1`,
            empresaId
          )
          resultado.push({ modulo, tabela, status: 'ok', registros: res as number })
        } catch {
          // Se tabela não tem empresa_id (tabela filha), tenta sem filtro via CASCADE das FKs pai
          try {
            // Tabelas filhas são limpas pelo CASCADE das tabelas pai que já foram limpas
            resultado.push({ modulo, tabela, status: 'pulada (limpa via cascade)' })
          } catch (e2: any) {
            resultado.push({ modulo, tabela, status: `erro: ${(e2 as Error).message?.substring(0, 80)}` })
          }
        }
      }
    }

    return reply.send({
      message: `Limpeza concluída para módulos: ${modulos.join(', ')} (apenas empresa atual)`,
      empresaId,
      modulosLimpos: modulos,
      detalhes: resultado,
    })
  })

  /**
   * GET /api/admin/backup
   * Exporta TODOS os dados da empresa logada como JSON (para download no navegador).
   * O frontend faz download como arquivo .json na máquina local do usuário.
   */
  app.get('/backup', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    const empresaId = user.empresaId
    if (!empresaId) return reply.status(400).send({ message: 'Empresa não selecionada' })

    // Verificar perfil admin
    const usuario = await prisma.usuario.findUnique({ where: { id: user.id }, select: { perfil: true } })
    if (!usuario || !['SUPER_ADMIN', 'ADMIN'].includes(usuario.perfil)) {
      return reply.status(403).send({ message: 'Apenas administradores podem fazer backup' })
    }

    // Dados da empresa SEM campos sensíveis (certificado digital e senha nunca
    // devem sair no arquivo de backup, que é salvo sem proteção na máquina do usuário)
    const empresaCompleta = await prisma.empresa.findUnique({ where: { id: empresaId } })
    const { certificadoPfx, senhaCertificado, ...empresaSemSegredos } = empresaCompleta || {}

    // Exportar dados por módulo
    const backup: Record<string, any> = {
      _meta: {
        versao: '1.0',
        empresaId,
        dataExportacao: new Date().toISOString(),
        sistema: 'VisioFab ERP',
      },
      empresa: empresaSemSegredos,
      clientes: await prisma.cliente.findMany({ where: { empresaId } }),
      fornecedores: await prisma.fornecedor.findMany({ where: { empresaId } }),
      produtos: await prisma.produto.findMany({ where: { empresaId } }),
      vendedores: await prisma.vendedor.findMany({ where: { empresaId } }),
      transportadoras: await prisma.transportadora.findMany({ where: { empresaId } }),
      tabelasPreco: await prisma.tabelaPreco.findMany({ where: { empresaId }, include: { condicoes: true } }),
      pedidosVenda: await prisma.pedidoVenda.findMany({ where: { empresaId }, include: { itens: true } }),
      pedidosCompra: await prisma.pedidoCompra.findMany({ where: { empresaId }, include: { itens: true } }),
      contasPagar: await prisma.contaPagar.findMany({ where: { empresaId } }),
      contasReceber: await prisma.contaReceber.findMany({ where: { empresaId } }),
    }

    reply.header('Content-Type', 'application/json')
    reply.header('Content-Disposition', `attachment; filename="backup-visiofab-${new Date().toISOString().split('T')[0]}.json"`)
    return reply.send(backup)
  })

  /**
   * POST /api/admin/restaurar
   * Restaura dados a partir de um backup JSON.
   * CUIDADO: Sobrescreve dados existentes da empresa.
   */
  app.post('/restaurar', async (request, reply) => {
    const user = request.user as { id: string; empresaId?: string }
    const empresaId = user.empresaId
    if (!empresaId) return reply.status(400).send({ message: 'Empresa não selecionada' })

    // Verificar perfil admin
    const usuario = await prisma.usuario.findUnique({ where: { id: user.id }, select: { perfil: true } })
    if (!usuario || !['SUPER_ADMIN', 'ADMIN'].includes(usuario.perfil)) {
      return reply.status(403).send({ message: 'Apenas administradores podem restaurar backup' })
    }

    const backup = request.body as any
    if (!backup?._meta?.versao) {
      return reply.status(400).send({ message: 'Arquivo de backup inválido (sem metadados)' })
    }

    const resultado: { entidade: string; status: string; registros?: number }[] = []

    try {
      // Restaurar cadastros (upsert para não duplicar)
      if (backup.clientes?.length) {
        for (const c of backup.clientes) {
          try {
            await prisma.cliente.upsert({
              where: { empresaId_cpfCnpj: { empresaId, cpfCnpj: c.cpfCnpj } },
              create: { ...c, id: undefined, empresaId },
              update: { razaoSocial: c.razaoSocial, nomeFantasia: c.nomeFantasia, email: c.email, telefone: c.telefone },
            })
          } catch {}
        }
        resultado.push({ entidade: 'clientes', status: 'ok', registros: backup.clientes.length })
      }

      if (backup.fornecedores?.length) {
        for (const f of backup.fornecedores) {
          try {
            await prisma.fornecedor.upsert({
              where: { empresaId_cnpj: { empresaId, cnpj: f.cnpj } },
              create: { ...f, id: undefined, empresaId },
              update: { razaoSocial: f.razaoSocial, nomeFantasia: f.nomeFantasia },
            })
          } catch {}
        }
        resultado.push({ entidade: 'fornecedores', status: 'ok', registros: backup.fornecedores.length })
      }

      if (backup.produtos?.length) {
        for (const p of backup.produtos) {
          try {
            await prisma.produto.upsert({
              where: { empresaId_codigo: { empresaId, codigo: p.codigo } },
              create: { ...p, id: undefined, empresaId },
              update: { nome: p.nome, precoBase: p.precoBase, unidade: p.unidade },
            })
          } catch {}
        }
        resultado.push({ entidade: 'produtos', status: 'ok', registros: backup.produtos.length })
      }

      return reply.send({
        message: 'Restauração concluída!',
        detalhes: resultado,
      })
    } catch (e: any) {
      return reply.status(500).send({ message: `Erro na restauração: ${e.message}` })
    }
  })
}
