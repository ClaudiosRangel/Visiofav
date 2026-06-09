-- CreateTable
CREATE TABLE "contrato_armazenagem" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "data_inicio" TIMESTAMP(3) NOT NULL,
    "data_fim" TIMESTAMP(3) NOT NULL,
    "periodicidade" VARCHAR(20) NOT NULL DEFAULT 'MENSAL',
    "moeda" VARCHAR(3) NOT NULL DEFAULT 'BRL',
    "status" VARCHAR(20) NOT NULL DEFAULT 'ATIVO',
    "observacao" TEXT,
    "criado_por_id" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contrato_armazenagem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tarifa_contrato" (
    "id" TEXT NOT NULL,
    "contrato_id" TEXT NOT NULL,
    "tipo" VARCHAR(30) NOT NULL,
    "valor_unitario" DECIMAL(12,4) NOT NULL,
    "carencia_dias" INTEGER,
    "descricao" VARCHAR(200),

    CONSTRAINT "tarifa_contrato_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medicao_ocupacao" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "contrato_id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "data_medicao" TIMESTAMP(3) NOT NULL,
    "quantidade_pallets" INTEGER NOT NULL,
    "volume_m3" DECIMAL(12,4) NOT NULL,
    "posicoes_ocupadas" INTEGER NOT NULL,
    "detalhamento" JSONB,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medicao_ocupacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimentacao_faturavel" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "contrato_id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "tipo" VARCHAR(20) NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "produto_id" TEXT NOT NULL,
    "quantidade" DECIMAL(12,4) NOT NULL,
    "referencia_id" TEXT,
    "faturado" BOOLEAN NOT NULL DEFAULT false,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimentacao_faturavel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fatura_armazenagem" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "contrato_id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "numero" VARCHAR(20) NOT NULL,
    "periodo_inicio" TIMESTAMP(3) NOT NULL,
    "periodo_fim" TIMESTAMP(3) NOT NULL,
    "valor_total" DECIMAL(12,2) NOT NULL,
    "data_vencimento" TIMESTAMP(3) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'GERADA',
    "motivo_cancelamento" TEXT,
    "observacao" TEXT,
    "criado_por_id" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fatura_armazenagem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_fatura" (
    "id" TEXT NOT NULL,
    "fatura_id" TEXT NOT NULL,
    "tipo_tarifa" VARCHAR(30) NOT NULL,
    "descricao" VARCHAR(200) NOT NULL,
    "quantidade" DECIMAL(12,4) NOT NULL,
    "valor_unitario" DECIMAL(12,4) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "item_fatura_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contrato_armazenagem_empresa_id_status_idx" ON "contrato_armazenagem"("empresa_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tarifa_contrato_contrato_id_tipo_key" ON "tarifa_contrato"("contrato_id", "tipo");

-- CreateIndex
CREATE INDEX "medicao_ocupacao_empresa_id_contrato_id_data_medicao_idx" ON "medicao_ocupacao"("empresa_id", "contrato_id", "data_medicao");

-- CreateIndex
CREATE INDEX "movimentacao_faturavel_empresa_id_contrato_id_faturado_idx" ON "movimentacao_faturavel"("empresa_id", "contrato_id", "faturado");

-- CreateIndex
CREATE UNIQUE INDEX "fatura_armazenagem_empresa_id_numero_key" ON "fatura_armazenagem"("empresa_id", "numero");

-- CreateIndex
CREATE INDEX "fatura_armazenagem_empresa_id_status_idx" ON "fatura_armazenagem"("empresa_id", "status");

-- AddForeignKey
ALTER TABLE "tarifa_contrato" ADD CONSTRAINT "tarifa_contrato_contrato_id_fkey" FOREIGN KEY ("contrato_id") REFERENCES "contrato_armazenagem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medicao_ocupacao" ADD CONSTRAINT "medicao_ocupacao_contrato_id_fkey" FOREIGN KEY ("contrato_id") REFERENCES "contrato_armazenagem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fatura_armazenagem" ADD CONSTRAINT "fatura_armazenagem_contrato_id_fkey" FOREIGN KEY ("contrato_id") REFERENCES "contrato_armazenagem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_fatura" ADD CONSTRAINT "item_fatura_fatura_id_fkey" FOREIGN KEY ("fatura_id") REFERENCES "fatura_armazenagem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
