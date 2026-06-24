import { prisma } from '../src/lib/prisma'

async function limpar() {
  const tabelas = [
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
  ]

  for (const tabela of tabelas) {
    try {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${tabela}" CASCADE`)
      console.log(`✓ ${tabela}`)
    } catch (e: any) {
      console.log(`⚠ ${tabela}: ${e.message?.substring(0, 60)}`)
    }
  }

  console.log('\n✅ Todas as tabelas PCP limpas!')
  process.exit(0)
}

limpar()
