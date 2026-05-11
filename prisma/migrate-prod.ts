import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🔄 Applying production migrations...')

  // Usuario table - senha_alterada flag
  await prisma.$executeRawUnsafe(`ALTER TABLE "usuario" ADD COLUMN IF NOT EXISTS "senha_alterada" BOOLEAN DEFAULT false`)

  // Endereco table - new columns
  await prisma.$executeRawUnsafe(`ALTER TABLE "endereco" ADD COLUMN IF NOT EXISTS "codigo_barras" VARCHAR(30)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "endereco" ADD COLUMN IF NOT EXISTS "area_armazenagem" VARCHAR(20)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "endereco" ADD COLUMN IF NOT EXISTS "forma_armazenagem_id" TEXT`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "endereco" ADD COLUMN IF NOT EXISTS "ambiente_armazenagem_id" TEXT`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "endereco" ADD COLUMN IF NOT EXISTS "classificacao_produto_id" TEXT`)

  // Estrutura table - capacity fields
  await prisma.$executeRawUnsafe(`ALTER TABLE "estrutura" ADD COLUMN IF NOT EXISTS "capacidade" DECIMAL(10,3)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "estrutura" ADD COLUMN IF NOT EXISTS "largura" DECIMAL(10,3)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "estrutura" ADD COLUMN IF NOT EXISTS "altura" DECIMAL(10,3)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "estrutura" ADD COLUMN IF NOT EXISTS "comprimento" DECIMAL(10,3)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "estrutura" ADD COLUMN IF NOT EXISTS "cubagem" DECIMAL(10,6)`)

  // Doca table - codigo column
  await prisma.$executeRawUnsafe(`ALTER TABLE "doca" ADD COLUMN IF NOT EXISTS "codigo" SERIAL`)

  // Equipamento table - codigo column
  await prisma.$executeRawUnsafe(`ALTER TABLE "equipamento_movimentacao" ADD COLUMN IF NOT EXISTS "codigo" SERIAL`)

  // Funcionario table - codigo column
  await prisma.$executeRawUnsafe(`ALTER TABLE "funcionario" ADD COLUMN IF NOT EXISTS "codigo" SERIAL`)

  // Funcionario table - usuario_id column (direct link to usuario)
  await prisma.$executeRawUnsafe(`ALTER TABLE "funcionario" ADD COLUMN IF NOT EXISTS "usuario_id" TEXT`)

  // Estrutura table - codigo column
  await prisma.$executeRawUnsafe(`ALTER TABLE "estrutura" ADD COLUMN IF NOT EXISTS "codigo" SERIAL`)

  // Multi-tenant: Add empresa_id to WMS tables
  const tenantTables = [
    'deposito', 'zona', 'estrutura', 'endereco', 'funcionario', 'doca',
    'equipamento_movimentacao', 'funcao', 'forma_armazenagem',
    'ambiente_armazenagem', 'classificacao_produto', 'tipo_carroceria',
    'tipo_carga', 'veiculo_wms', 'nota_entrada', 'saldo_endereco', 'sku',
  ]

  for (const table of tenantTables) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "empresa_id" TEXT`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_${table}_empresa_id" ON "${table}"("empresa_id")`)
  }
  console.log('✅ Multi-tenant: empresa_id columns and indexes added')

  // Multi-tenant: Backfill empresa_id with default empresa
  const defaultEmpresa = await prisma.empresa.findFirst({ select: { id: true } })
  if (defaultEmpresa) {
    for (const table of tenantTables) {
      await prisma.$executeRawUnsafe(
        `UPDATE "${table}" SET "empresa_id" = '${defaultEmpresa.id}' WHERE "empresa_id" IS NULL`
      )
    }
    console.log('✅ Multi-tenant: backfill complete with empresa', defaultEmpresa.id)
  }

  // Pendencia Logistica table (SKU / Dados Logísticos validation)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "pendencia_logistica" (
      "id" TEXT NOT NULL,
      "empresa_id" TEXT NOT NULL,
      "nota_entrada_id" TEXT NOT NULL,
      "item_nota_entrada_id" TEXT,
      "codigo_produto" VARCHAR(60),
      "descricao_produto" VARCHAR(200),
      "fornecedor" VARCHAR(200),
      "fornecedor_doc" VARCHAR(20),
      "tipo" VARCHAR(30) NOT NULL,
      "status" VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
      "resolvido_por_id" TEXT,
      "resolvido_em" TIMESTAMP(3),
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "pendencia_logistica_pkey" PRIMARY KEY ("id")
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "pendencia_logistica_empresa_id_status_idx" ON "pendencia_logistica"("empresa_id", "status")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "pendencia_logistica_nota_entrada_id_idx" ON "pendencia_logistica"("nota_entrada_id")`)
  console.log('✅ Pendencia Logistica table created')

  // ItemPedidoVenda - add unidade and desconto columns
  await prisma.$executeRawUnsafe(`ALTER TABLE "item_pedido_venda" ADD COLUMN IF NOT EXISTS "unidade" VARCHAR(6) DEFAULT 'UN'`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "item_pedido_venda" ADD COLUMN IF NOT EXISTS "desconto" DECIMAL(5,2) DEFAULT 0`)
  console.log('✅ ItemPedidoVenda: unidade and desconto columns added')

  // Limpar OS órfãs de ondas canceladas
  try {
    const osCanceladas = await prisma.$executeRawUnsafe(`
      UPDATE "ordem_servico_wms" 
      SET "status" = 'REJEITADO', "hora_fim" = NOW(), "observacao" = 'Onda cancelada - limpeza automática'
      WHERE "operacao" = 'SEPARACAO' 
        AND "status" IN ('ABERTO', 'EXECUTANDO')
        AND "onda_separacao_id" IN (
          SELECT "id" FROM "onda_separacao" WHERE "status" = 'CANCELADA'
        )
    `)
    console.log('✅ OS órfãs de ondas canceladas limpas:', osCanceladas)
  } catch (e: any) {
    console.log('⚠️ Limpeza OS órfãs skipped:', e.message)
  }

  // Corrigir tipo das colunas XML na tabela nfe (VARCHAR → TEXT)
  await prisma.$executeRawUnsafe(`ALTER TABLE "nfe" ALTER COLUMN "xml_enviado" TYPE TEXT`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "nfe" ALTER COLUMN "xml_retorno" TYPE TEXT`)
  console.log('✅ Colunas XML da NF-e alteradas para TEXT')

  // Tabelas de Roteirização e Montagem de Carga
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "rota" (
      "id" TEXT NOT NULL,
      "empresa_id" TEXT NOT NULL,
      "codigo" VARCHAR(20) NOT NULL,
      "descricao" VARCHAR(200) NOT NULL,
      "transportadora_id" TEXT,
      "status" BOOLEAN NOT NULL DEFAULT true,
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "rota_pkey" PRIMARY KEY ("id")
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "rota_empresa_id_codigo_key" ON "rota"("empresa_id", "codigo")`)

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "mapa_carregamento" (
      "id" TEXT NOT NULL,
      "empresa_id" TEXT NOT NULL,
      "numero" INTEGER NOT NULL,
      "rota_id" TEXT,
      "veiculo_placa" VARCHAR(10) NOT NULL,
      "motorista" VARCHAR(200),
      "motorista_cpf" VARCHAR(14),
      "observacoes" TEXT,
      "status" VARCHAR(30) NOT NULL DEFAULT 'AGUARDANDO_SEPARACAO',
      "motivo_cancelamento" TEXT,
      "criado_por_id" TEXT NOT NULL,
      "cancelado_por_id" TEXT,
      "fechado_por_id" TEXT,
      "emissao_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "finalizado_em" TIMESTAMP(3),
      "cancelado_em" TIMESTAMP(3),
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "mapa_carregamento_pkey" PRIMARY KEY ("id")
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "mapa_carregamento_empresa_id_numero_key" ON "mapa_carregamento"("empresa_id", "numero")`)

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "mapa_carregamento_nf" (
      "id" TEXT NOT NULL,
      "mapa_carregamento_id" TEXT NOT NULL,
      "nfe_id" TEXT NOT NULL,
      "status_entrega" VARCHAR(20),
      "motivo_devolucao" TEXT,
      CONSTRAINT "mapa_carregamento_nf_pkey" PRIMARY KEY ("id")
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "mapa_carregamento_nf_mapa_carregamento_id_nfe_id_key" ON "mapa_carregamento_nf"("mapa_carregamento_id", "nfe_id")`)

  // Campos novos em tabelas existentes
  await prisma.$executeRawUnsafe(`ALTER TABLE "cliente" ADD COLUMN IF NOT EXISTS "rota_id" TEXT`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "pedido_venda" ADD COLUMN IF NOT EXISTS "rota_id" TEXT`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "carregamento" ADD COLUMN IF NOT EXISTS "motorista" VARCHAR(200)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "carregamento" ADD COLUMN IF NOT EXISTS "motorista_cpf" VARCHAR(14)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "carregamento" ADD COLUMN IF NOT EXISTS "rota_id" TEXT`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "carregamento" ADD COLUMN IF NOT EXISTS "motivo_cancelamento" TEXT`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "carregamento" ADD COLUMN IF NOT EXISTS "cancelado_por_id" TEXT`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "carregamento" ADD COLUMN IF NOT EXISTS "cancelado_em" TIMESTAMP(3)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "carregamento" ADD COLUMN IF NOT EXISTS "em_carregamento_em" TIMESTAMP(3)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "nfe" ADD COLUMN IF NOT EXISTS "mapa_ok" BOOLEAN DEFAULT false`)
  console.log('✅ Tabelas de Roteirização e Montagem de Carga criadas')

  // Resolver pendências logísticas de produtos que já têm SKU/dados logísticos configurados
  try {
    // Resolver pendências SKU onde o produto já tem SKU
    await prisma.$executeRawUnsafe(`
      UPDATE "pendencia_logistica" SET "status" = 'RESOLVIDA', "resolvido_em" = NOW()
      WHERE "status" = 'PENDENTE' AND "tipo" = 'SKU'
      AND "codigo_produto" IN (
        SELECT p."codigo" FROM "produto" p
        INNER JOIN "sku" s ON s."produto_id" = p."id"
      )
    `)
    // Resolver pendências DADOS_LOGISTICOS onde o produto já tem dados
    await prisma.$executeRawUnsafe(`
      UPDATE "pendencia_logistica" SET "status" = 'RESOLVIDA', "resolvido_em" = NOW()
      WHERE "status" = 'PENDENTE' AND "tipo" = 'DADOS_LOGISTICOS'
      AND "codigo_produto" IN (
        SELECT p."codigo" FROM "produto" p
        INNER JOIN "dados_logisticos_armazenagem" d ON d."produto_id" = p."id"
      )
    `)
    console.log('✅ Pendências logísticas resolvidas para produtos já configurados')
  } catch (e: any) {
    console.log('⚠️ Resolução pendências skipped:', e.message)
  }

  // Atualizar senha do admin para 987123
  try {
    const bcrypt = await import('bcryptjs')
    const bcryptLib = bcrypt.default || bcrypt
    const novaSenhaHash = await bcryptLib.hash('987123', 10)
    const admin = await prisma.usuario.findUnique({ where: { email: 'admin@visiofab.com' } })
    if (admin) {
      await prisma.usuario.update({
        where: { id: admin.id },
        data: { senha: novaSenhaHash },
      })
      console.log('✅ Admin password updated')
    }
  } catch (e: any) {
    console.log('⚠️ Admin password update skipped:', e.message)
  }

  // Produto - campo imagem_url
  await prisma.$executeRawUnsafe(`ALTER TABLE "produto" ADD COLUMN IF NOT EXISTS "imagem_url" TEXT`)
  console.log('✅ Produto: campo imagem_url adicionado')

  // ItemPedidoCompra - campo unidade
  await prisma.$executeRawUnsafe(`ALTER TABLE "item_pedido_compra" ADD COLUMN IF NOT EXISTS "unidade" VARCHAR(6) DEFAULT 'UN'`)
  console.log('✅ ItemPedidoCompra: campo unidade adicionado')

  // De-Para Produto Fornecedor table
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "depara_produto_fornecedor" (
      "id" TEXT NOT NULL,
      "empresa_id" TEXT NOT NULL,
      "fornecedor_id" TEXT NOT NULL,
      "codigo_produto_fornecedor" VARCHAR(60) NOT NULL,
      "descricao_fornecedor" VARCHAR(200),
      "produto_id" TEXT NOT NULL,
      "sku_id" TEXT,
      "unidade_fornecedor" VARCHAR(6) NOT NULL,
      "fator_conversao" DECIMAL(12,4) NOT NULL DEFAULT 1,
      "c_ean" VARCHAR(14),
      "c_ean_trib" VARCHAR(14),
      "status" BOOLEAN NOT NULL DEFAULT true,
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "depara_produto_fornecedor_pkey" PRIMARY KEY ("id")
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "depara_produto_fornecedor_empresa_id_fornecedor_id_codigo_pr_key" ON "depara_produto_fornecedor"("empresa_id", "fornecedor_id", "codigo_produto_fornecedor")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "depara_produto_fornecedor_empresa_id_fornecedor_id_idx" ON "depara_produto_fornecedor"("empresa_id", "fornecedor_id")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "depara_produto_fornecedor_produto_id_idx" ON "depara_produto_fornecedor"("produto_id")`)
  console.log('✅ De-Para Produto Fornecedor table created')

  console.log('✅ All migrations applied successfully')
}

main()
  .catch((e) => { console.error('❌ Migration failed:', e.message); process.exit(1) })
  .finally(() => prisma.$disconnect())
