import { PrismaClient } from '@prisma/client'

async function main() {
  const p = new PrismaClient()
  
  const sqls = [
    // Produto - campos PCP e novos
    `ALTER TABLE "produto" ADD COLUMN IF NOT EXISTS "classificacao_pcp" VARCHAR(20)`,
    `ALTER TABLE "produto" ADD COLUMN IF NOT EXISTS "tipo_fisico" VARCHAR(20)`,
    `ALTER TABLE "produto" ADD COLUMN IF NOT EXISTS "shelf_life_minimo" INTEGER`,
    `ALTER TABLE "produto" ADD COLUMN IF NOT EXISTS "curva_abc" VARCHAR(1)`,
    `ALTER TABLE "produto" ADD COLUMN IF NOT EXISTS "imagem_url" TEXT`,
    // Estrutura - campos capacidade
    `ALTER TABLE "estrutura" ADD COLUMN IF NOT EXISTS "capacidade" DECIMAL(10,3)`,
    `ALTER TABLE "estrutura" ADD COLUMN IF NOT EXISTS "largura" DECIMAL(10,3)`,
    `ALTER TABLE "estrutura" ADD COLUMN IF NOT EXISTS "altura" DECIMAL(10,3)`,
    `ALTER TABLE "estrutura" ADD COLUMN IF NOT EXISTS "comprimento" DECIMAL(10,3)`,
    `ALTER TABLE "estrutura" ADD COLUMN IF NOT EXISTS "cubagem" DECIMAL(10,6)`,
    // Capacidade por nivel
    `CREATE TABLE IF NOT EXISTS "capacidade_nivel" (
      "id" TEXT NOT NULL, "empresa_id" TEXT NOT NULL, "estrutura_id" TEXT NOT NULL,
      "codigo_nivel" VARCHAR(10) NOT NULL, "peso_maximo" DECIMAL(12,3),
      "volume_maximo" DECIMAL(12,6), "paletes_maximo" INTEGER, "status" BOOLEAN NOT NULL DEFAULT true,
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "capacidade_nivel_pkey" PRIMARY KEY ("id")
    )`,
    // Formato Endereco
    `CREATE TABLE IF NOT EXISTS "formato_endereco" (
      "id" TEXT NOT NULL, "nome" VARCHAR(100) NOT NULL, "descricao" VARCHAR(255),
      "segmentos" JSONB NOT NULL, "empresa_id" TEXT, "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "status" BOOLEAN NOT NULL DEFAULT true,
      CONSTRAINT "formato_endereco_pkey" PRIMARY KEY ("id")
    )`,
    // Deposito + Zona formato_endereco_id
    `ALTER TABLE "deposito" ADD COLUMN IF NOT EXISTS "formato_endereco_id" TEXT`,
    `ALTER TABLE "zona" ADD COLUMN IF NOT EXISTS "formato_endereco_id" TEXT`,
    // Endereco - campos extras
    `ALTER TABLE "endereco" ADD COLUMN IF NOT EXISTS "endereco_completo" VARCHAR(60)`,
    `ALTER TABLE "endereco" ADD COLUMN IF NOT EXISTS "codigo_barras" VARCHAR(30)`,
    `ALTER TABLE "endereco" ADD COLUMN IF NOT EXISTS "area_armazenagem" VARCHAR(20)`,
    // DeparaProdutoFornecedor
    `CREATE TABLE IF NOT EXISTS "depara_produto_fornecedor" (
      "id" TEXT NOT NULL, "empresa_id" TEXT NOT NULL, "fornecedor_id" TEXT NOT NULL,
      "codigo_produto_fornecedor" VARCHAR(60) NOT NULL, "descricao_fornecedor" VARCHAR(200),
      "produto_id" TEXT NOT NULL, "sku_id" TEXT, "unidade_fornecedor" VARCHAR(6) NOT NULL,
      "fator_conversao" DECIMAL(12,4) NOT NULL DEFAULT 1, "c_ean" VARCHAR(14), "c_ean_trib" VARCHAR(14),
      "status" BOOLEAN NOT NULL DEFAULT true, "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "depara_produto_fornecedor_pkey" PRIMARY KEY ("id")
    )`,
    // Dados Logísticos tables
    `CREATE TABLE IF NOT EXISTS "dados_logisticos_armazenagem" (
      "id" TEXT NOT NULL, "produto_id" TEXT NOT NULL, "sku_seq" INTEGER NOT NULL,
      "sequencia" INTEGER NOT NULL, "endereco_fixo_id" TEXT, "tipo_norma" VARCHAR(10) NOT NULL DEFAULT 'FEFO',
      "pulmao_regulador" INTEGER NOT NULL DEFAULT 0, "nivel_min_pp" INTEGER NOT NULL DEFAULT 0,
      "nivel_max_pp" INTEGER NOT NULL DEFAULT 0, "nivel_max_blocado" INTEGER NOT NULL DEFAULT 0,
      "fixo" BOOLEAN NOT NULL DEFAULT false, "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "dados_logisticos_armazenagem_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE TABLE IF NOT EXISTS "dados_logisticos_picking" (
      "id" TEXT NOT NULL, "produto_id" TEXT NOT NULL, "sku_seq" INTEGER NOT NULL,
      "sequencia" INTEGER NOT NULL, "endereco_picking_id" TEXT, "tipo_picking" VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
      "capacidade" DECIMAL(12,4) NOT NULL DEFAULT 0, "ponto_reposicao" DECIMAL(12,4) NOT NULL DEFAULT 0,
      "ponto_reposicao_percent" DECIMAL(5,2) NOT NULL DEFAULT 0, "ponto_reposicao_dias" INTEGER NOT NULL DEFAULT 0,
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "dados_logisticos_picking_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE TABLE IF NOT EXISTS "dados_logisticos_expedicao" (
      "id" TEXT NOT NULL, "produto_id" TEXT NOT NULL, "sku_seq" INTEGER NOT NULL,
      "fracionado" BOOLEAN NOT NULL DEFAULT false, "absorbe_palete_fechado" BOOLEAN NOT NULL DEFAULT false,
      "absorbe_palete_fechado_cx" BOOLEAN NOT NULL DEFAULT false, "tipo_produto" VARCHAR(20),
      "tipo_carga_id" TEXT, "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "dados_logisticos_expedicao_pkey" PRIMARY KEY ("id")
    )`,
    // Nfe - campo mapaOk
    `ALTER TABLE "nfe" ADD COLUMN IF NOT EXISTS "mapa_ok" BOOLEAN NOT NULL DEFAULT false`,
    // Cliente - rotaId
    `ALTER TABLE "cliente" ADD COLUMN IF NOT EXISTS "rota_id" TEXT`,
  ]

  let ok = 0, skip = 0, fail = 0
  for (const sql of sqls) {
    try {
      await p.$executeRawUnsafe(sql)
      ok++
      console.log('✅', sql.substring(0, 70) + '...')
    } catch (e: any) {
      if (e.message?.includes('already exists')) {
        skip++
      } else {
        fail++
        console.log('❌', sql.substring(0, 60), '→', e.message?.substring(0, 100))
      }
    }
  }
  
  await p.$disconnect()
  console.log(`\n✅ Concluído: ${ok} aplicados, ${skip} já existiam, ${fail} falharam`)
}

main()
