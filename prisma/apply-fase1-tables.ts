import { PrismaClient } from '@prisma/client'

async function main() {
  const p = new PrismaClient()
  console.log('🏗️  Aplicando tabelas Fase 1 em produção...\n')

  const sqls = [
    // Cross-Docking
    `CREATE TABLE IF NOT EXISTS "cross_dock_item" (
      "id" TEXT NOT NULL, "empresa_id" TEXT NOT NULL, "nota_entrada_id" TEXT NOT NULL,
      "item_nota_entrada_id" TEXT NOT NULL, "pedido_venda_id" TEXT NOT NULL,
      "produto_id" TEXT NOT NULL, "quantidade" DECIMAL(12,4) NOT NULL,
      "tipo" VARCHAR(20) NOT NULL, "status" VARCHAR(20) NOT NULL DEFAULT 'IDENTIFICADO',
      "staging_endereco_id" TEXT, "doca_saida_id" TEXT, "ordem_servico_id" TEXT,
      "justificativa" TEXT, "criado_por_id" TEXT NOT NULL,
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "expedido_em" TIMESTAMP(3),
      CONSTRAINT "cross_dock_item_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE INDEX IF NOT EXISTS "cross_dock_item_empresa_id_status_idx" ON "cross_dock_item"("empresa_id", "status")`,
    `CREATE INDEX IF NOT EXISTS "cross_dock_item_pedido_venda_id_idx" ON "cross_dock_item"("pedido_venda_id")`,
    `CREATE INDEX IF NOT EXISTS "cross_dock_item_nota_entrada_id_idx" ON "cross_dock_item"("nota_entrada_id")`,

    `CREATE TABLE IF NOT EXISTS "staging_area" (
      "id" TEXT NOT NULL, "empresa_id" TEXT NOT NULL, "endereco_id" TEXT NOT NULL,
      "doca_id" TEXT NOT NULL, "nome" VARCHAR(50) NOT NULL,
      "capacidade" INTEGER NOT NULL DEFAULT 100, "ativo" BOOLEAN NOT NULL DEFAULT true,
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "staging_area_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "staging_area_empresa_id_endereco_id_key" ON "staging_area"("empresa_id", "endereco_id")`,

    // Logística Reversa
    `CREATE TABLE IF NOT EXISTS "autorizacao_retorno" (
      "id" TEXT NOT NULL, "empresa_id" TEXT NOT NULL, "numero" VARCHAR(20) NOT NULL,
      "cliente_id" TEXT NOT NULL, "nfe_origem_id" TEXT NOT NULL,
      "motivo" VARCHAR(100) NOT NULL, "observacao" TEXT, "data_limite" TIMESTAMP(3),
      "status" VARCHAR(20) NOT NULL DEFAULT 'ABERTA', "criado_por_id" TEXT NOT NULL,
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "recebido_em" TIMESTAMP(3), "concluido_em" TIMESTAMP(3),
      CONSTRAINT "autorizacao_retorno_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "autorizacao_retorno_empresa_id_numero_key" ON "autorizacao_retorno"("empresa_id", "numero")`,
    `CREATE INDEX IF NOT EXISTS "autorizacao_retorno_empresa_id_status_idx" ON "autorizacao_retorno"("empresa_id", "status")`,
    `CREATE INDEX IF NOT EXISTS "autorizacao_retorno_cliente_id_idx" ON "autorizacao_retorno"("cliente_id")`,

    `CREATE TABLE IF NOT EXISTS "item_autorizacao_retorno" (
      "id" TEXT NOT NULL, "autorizacao_retorno_id" TEXT NOT NULL, "produto_id" TEXT NOT NULL,
      "quantidade" DECIMAL(12,4) NOT NULL, "quantidade_recebida" DECIMAL(12,4),
      "condicao" VARCHAR(20), "disposicao" VARCHAR(30), "parecer_inspecao" TEXT,
      "fotos" TEXT[] DEFAULT ARRAY[]::TEXT[], "inspecionado_por_id" TEXT, "inspecionado_em" TIMESTAMP(3),
      CONSTRAINT "item_autorizacao_retorno_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "item_autorizacao_retorno_autorizacao_retorno_id_fkey" FOREIGN KEY ("autorizacao_retorno_id") REFERENCES "autorizacao_retorno"("id") ON DELETE CASCADE
    )`,

    // KPI/SLA
    `CREATE TABLE IF NOT EXISTS "regra_kpi" (
      "id" TEXT NOT NULL, "empresa_id" TEXT NOT NULL, "nome" VARCHAR(100) NOT NULL,
      "descricao" TEXT, "entidade" VARCHAR(30) NOT NULL, "condicao" VARCHAR(30) NOT NULL,
      "threshold" DECIMAL(12,4) NOT NULL, "unidade" VARCHAR(20) NOT NULL,
      "janela_minutos" INTEGER, "cooldown_minutos" INTEGER NOT NULL DEFAULT 30,
      "severidade" VARCHAR(20) NOT NULL DEFAULT 'WARNING',
      "acoes" TEXT[] DEFAULT ARRAY[]::TEXT[], "destinatarios" TEXT[] DEFAULT ARRAY[]::TEXT[],
      "ativo" BOOLEAN NOT NULL DEFAULT true, "criado_por_id" TEXT NOT NULL,
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "regra_kpi_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE INDEX IF NOT EXISTS "regra_kpi_empresa_id_ativo_idx" ON "regra_kpi"("empresa_id", "ativo")`,

    `CREATE TABLE IF NOT EXISTS "alerta_kpi" (
      "id" TEXT NOT NULL, "empresa_id" TEXT NOT NULL, "regra_kpi_id" TEXT NOT NULL,
      "severidade" VARCHAR(20) NOT NULL, "valor_atual" DECIMAL(12,4) NOT NULL,
      "threshold" DECIMAL(12,4) NOT NULL, "entidade_id" VARCHAR(36),
      "mensagem" TEXT NOT NULL, "status" VARCHAR(20) NOT NULL DEFAULT 'ABERTO',
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "resolvido_em" TIMESTAMP(3),
      CONSTRAINT "alerta_kpi_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "alerta_kpi_regra_kpi_id_fkey" FOREIGN KEY ("regra_kpi_id") REFERENCES "regra_kpi"("id")
    )`,
    `CREATE INDEX IF NOT EXISTS "alerta_kpi_empresa_id_status_idx" ON "alerta_kpi"("empresa_id", "status")`,
    `CREATE INDEX IF NOT EXISTS "alerta_kpi_regra_kpi_id_idx" ON "alerta_kpi"("regra_kpi_id")`,

    `CREATE TABLE IF NOT EXISTS "historico_regra_kpi" (
      "id" TEXT NOT NULL, "regra_kpi_id" TEXT NOT NULL, "usuario_id" TEXT NOT NULL,
      "campo" VARCHAR(50) NOT NULL, "valor_anterior" TEXT, "valor_novo" TEXT,
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "historico_regra_kpi_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "historico_regra_kpi_regra_kpi_id_fkey" FOREIGN KEY ("regra_kpi_id") REFERENCES "regra_kpi"("id")
    )`,

    `CREATE TABLE IF NOT EXISTS "snapshot_kpi" (
      "id" TEXT NOT NULL, "empresa_id" TEXT NOT NULL, "indicador" VARCHAR(50) NOT NULL,
      "valor" DECIMAL(12,4) NOT NULL, "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "snapshot_kpi_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE INDEX IF NOT EXISTS "snapshot_kpi_empresa_id_indicador_criado_em_idx" ON "snapshot_kpi"("empresa_id", "indicador", "criado_em")`,

    // Dock Scheduling
    `ALTER TABLE "agenda_wms" ADD COLUMN IF NOT EXISTS "hora_chegada_real" TIMESTAMP(3)`,
    `ALTER TABLE "agenda_wms" ADD COLUMN IF NOT EXISTS "tempo_perm_doca_min" INTEGER`,

    `CREATE TABLE IF NOT EXISTS "bloqueio_slot_doca" (
      "id" TEXT NOT NULL, "empresa_id" TEXT NOT NULL, "doca_id" TEXT NOT NULL,
      "data_inicio" TIMESTAMP(3) NOT NULL, "data_fim" TIMESTAMP(3) NOT NULL,
      "motivo" VARCHAR(200) NOT NULL, "criado_por_id" TEXT NOT NULL,
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "bloqueio_slot_doca_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE INDEX IF NOT EXISTS "bloqueio_slot_doca_empresa_id_doca_id_data_inicio_data_fim_idx" ON "bloqueio_slot_doca"("empresa_id", "doca_id", "data_inicio", "data_fim")`,

    `CREATE TABLE IF NOT EXISTS "config_doca" (
      "id" TEXT NOT NULL, "empresa_id" TEXT NOT NULL,
      "hora_abertura_op" VARCHAR(5) NOT NULL, "hora_fechamento_op" VARCHAR(5) NOT NULL,
      "buffer_minutos" INTEGER NOT NULL DEFAULT 15, "tolerancia_atraso" INTEGER NOT NULL DEFAULT 30,
      CONSTRAINT "config_doca_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "config_doca_empresa_id_key" ON "config_doca"("empresa_id")`,

    // Etiquetas ZPL
    `CREATE TABLE IF NOT EXISTS "template_etiqueta" (
      "id" TEXT NOT NULL, "empresa_id" TEXT NOT NULL, "nome" VARCHAR(100) NOT NULL,
      "tipo" VARCHAR(20) NOT NULL, "codigo_zpl" TEXT NOT NULL,
      "largura_mm" INTEGER NOT NULL, "altura_mm" INTEGER NOT NULL,
      "versao" INTEGER NOT NULL DEFAULT 1, "ativo" BOOLEAN NOT NULL DEFAULT true,
      "criado_por_id" TEXT NOT NULL,
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "template_etiqueta_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE INDEX IF NOT EXISTS "template_etiqueta_empresa_id_tipo_idx" ON "template_etiqueta"("empresa_id", "tipo")`,

    `CREATE TABLE IF NOT EXISTS "versao_template_etiqueta" (
      "id" TEXT NOT NULL, "template_etiqueta_id" TEXT NOT NULL,
      "versao" INTEGER NOT NULL, "codigo_zpl" TEXT NOT NULL, "criado_por_id" TEXT NOT NULL,
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "versao_template_etiqueta_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "versao_template_etiqueta_template_etiqueta_id_fkey" FOREIGN KEY ("template_etiqueta_id") REFERENCES "template_etiqueta"("id")
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "versao_template_etiqueta_template_etiqueta_id_versao_key" ON "versao_template_etiqueta"("template_etiqueta_id", "versao")`,

    `CREATE TABLE IF NOT EXISTS "impressora_rede" (
      "id" TEXT NOT NULL, "empresa_id" TEXT NOT NULL, "nome" VARCHAR(100) NOT NULL,
      "modelo" VARCHAR(20) NOT NULL, "ip" VARCHAR(45) NOT NULL,
      "porta" INTEGER NOT NULL DEFAULT 9100, "localizacao" VARCHAR(100),
      "zona_id" TEXT, "status" VARCHAR(20) NOT NULL DEFAULT 'OFFLINE',
      "ultimo_check" TIMESTAMP(3), "ativo" BOOLEAN NOT NULL DEFAULT true,
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "impressora_rede_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "impressora_rede_empresa_id_ip_porta_key" ON "impressora_rede"("empresa_id", "ip", "porta")`,

    `CREATE TABLE IF NOT EXISTS "fila_impressao" (
      "id" TEXT NOT NULL, "empresa_id" TEXT NOT NULL, "template_id" TEXT NOT NULL,
      "impressora_id" TEXT NOT NULL, "dados_variaveis" JSONB NOT NULL,
      "quantidade" INTEGER NOT NULL DEFAULT 1, "prioridade" VARCHAR(10) NOT NULL DEFAULT 'NORMAL',
      "status" VARCHAR(20) NOT NULL DEFAULT 'PENDENTE', "tentativas" INTEGER NOT NULL DEFAULT 0,
      "erro" TEXT, "operacao" VARCHAR(30), "referencia_id" TEXT,
      "solicitado_por_id" TEXT NOT NULL,
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "processado_em" TIMESTAMP(3),
      CONSTRAINT "fila_impressao_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE INDEX IF NOT EXISTS "fila_impressao_empresa_id_status_prioridade_idx" ON "fila_impressao"("empresa_id", "status", "prioridade")`,
  ]

  let ok = 0, skip = 0, fail = 0
  for (const sql of sqls) {
    try {
      await p.$executeRawUnsafe(sql)
      ok++
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
  console.log(`✅ Fase 1 aplicada: ${ok} criados, ${skip} já existiam, ${fail} falharam`)
}

main()
