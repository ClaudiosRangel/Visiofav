/**
 * Seed de demonstração — Fase 1 Profissionalização WMS
 *
 * Cria dados de exemplo para os 5 módulos da Fase 1:
 * - 2 Staging Areas vinculadas a docas existentes
 * - 3 Regras de KPI (pedido > 120min, ocupação > 85%, separação > 60min)
 * - 4 Templates padrão de etiquetas ZPL (via criarTemplatesPadrao)
 * - 1 Configuração de doca (06:00–22:00, buffer 15min, tolerância 30min)
 *
 * Execução:
 *   npx tsx prisma/seed-fase1-demo.ts
 *
 * Pré-requisitos:
 *   - Banco de dados com schema aplicado (npx prisma db push)
 *   - Pelo menos 1 empresa, 1 usuário, 2 docas e 2 endereços cadastrados
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seed Fase 1 — Profissionalização WMS')

  // Buscar dados base necessários
  const empresa = await prisma.empresa.findFirst()
  if (!empresa) {
    throw new Error('Nenhuma empresa encontrada. Cadastre uma empresa antes de rodar este seed.')
  }
  const empresaId = empresa.id

  const usuario = await prisma.usuario.findFirst({ where: { perfil: 'SUPER_ADMIN' } })
  if (!usuario) {
    throw new Error('Nenhum usuário SUPER_ADMIN encontrado.')
  }
  const userId = usuario.id

  const docas = await prisma.doca.findMany({ where: { empresaId }, take: 2 })
  if (docas.length < 2) {
    console.warn('⚠ Menos de 2 docas encontradas. Staging areas não serão criadas.')
  }

  const enderecos = await prisma.endereco.findMany({ where: { empresaId }, take: 2 })
  if (enderecos.length < 2) {
    console.warn('⚠ Menos de 2 endereços encontrados. Staging areas não serão criadas.')
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Staging Areas (Cross-Dock)
  // ─────────────────────────────────────────────────────────────────────────────
  if (docas.length >= 2 && enderecos.length >= 2) {
    console.log('  📦 Criando 2 staging areas...')
    for (let i = 0; i < 2; i++) {
      await prisma.stagingArea.upsert({
        where: { empresaId_enderecoId: { empresaId, enderecoId: enderecos[i].id } },
        update: {},
        create: {
          empresaId,
          enderecoId: enderecos[i].id,
          docaId: docas[i].id,
          nome: `Staging ${i + 1} - Doca ${docas[i].nome || docas[i].id.slice(0, 8)}`,
          capacidade: 100,
          ativo: true,
        },
      })
    }
    console.log('  ✓ Staging areas criadas')
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Regras de KPI
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('  📊 Criando 3 regras de KPI...')

  const regrasKpi = [
    {
      nome: 'Pedido aguardando mais de 120 minutos',
      descricao: 'Alerta quando um pedido de venda está CONFIRMADO ou EM_SEPARAÇÃO por mais de 2 horas sem conclusão.',
      entidade: 'PEDIDO',
      condicao: 'TEMPO_EXCEDIDO',
      threshold: 120,
      unidade: 'MINUTOS',
      janelaMinutos: null,
      cooldownMinutos: 30,
      severidade: 'WARNING',
      acoes: ['NOTIFICACAO_APP'],
      destinatarios: [],
    },
    {
      nome: 'Ocupação acima de 85%',
      descricao: 'Alerta quando a porcentagem de endereços ocupados no armazém ultrapassa 85%.',
      entidade: 'OCUPACAO',
      condicao: 'PERCENTUAL_ACIMA',
      threshold: 85,
      unidade: 'PERCENTUAL',
      janelaMinutos: null,
      cooldownMinutos: 60,
      severidade: 'CRITICAL',
      acoes: ['NOTIFICACAO_APP', 'EMAIL'],
      destinatarios: [],
    },
    {
      nome: 'Separação parada há mais de 60 minutos',
      descricao: 'Alerta quando uma onda de separação está PENDENTE ou EM_SEPARAÇÃO por mais de 1 hora.',
      entidade: 'SEPARACAO',
      condicao: 'TEMPO_EXCEDIDO',
      threshold: 60,
      unidade: 'MINUTOS',
      janelaMinutos: null,
      cooldownMinutos: 15,
      severidade: 'WARNING',
      acoes: ['NOTIFICACAO_APP'],
      destinatarios: [],
    },
  ]

  for (const regra of regrasKpi) {
    await prisma.regraKpi.create({
      data: {
        empresaId,
        nome: regra.nome,
        descricao: regra.descricao,
        entidade: regra.entidade,
        condicao: regra.condicao,
        threshold: regra.threshold,
        unidade: regra.unidade,
        janelaMinutos: regra.janelaMinutos,
        cooldownMinutos: regra.cooldownMinutos,
        severidade: regra.severidade,
        acoes: regra.acoes,
        destinatarios: regra.destinatarios,
        ativo: true,
        criadoPorId: userId,
      },
    })
  }
  console.log('  ✓ Regras de KPI criadas')

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Templates padrão de etiquetas ZPL
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('  🏷️  Criando templates padrão de etiquetas...')

  const { etiquetasZplService } = await import('../src/modules/etiquetas-zpl/etiquetas-zpl.service')
  const criados = await etiquetasZplService.criarTemplatesPadrao(empresaId, userId)
  console.log(`  ✓ ${criados.length} templates de etiquetas criados`)

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. Configuração de Doca (Dock Scheduling)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('  🚛 Criando configuração de doca...')

  await prisma.configDoca.upsert({
    where: { empresaId },
    update: {},
    create: {
      empresaId,
      horaAberturaOp: '06:00',
      horaFechamentoOp: '22:00',
      bufferMinutos: 15,
      toleranciaAtraso: 30,
    },
  })
  console.log('  ✓ Configuração de doca criada (06:00–22:00, buffer 15min, tolerância 30min)')

  console.log('')
  console.log('✅ Seed Fase 1 concluído com sucesso!')
}

main()
  .catch((e) => {
    console.error('❌ Erro no seed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
