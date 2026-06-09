-- CreateTable
CREATE TABLE "custo_operacao" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "tipo_operacao" VARCHAR(30) NOT NULL,
    "custo_mao_obra" DECIMAL(12,2) NOT NULL,
    "custo_equipamento" DECIMAL(12,2) NOT NULL,
    "custo_espaco" DECIMAL(12,2) NOT NULL,
    "custo_total" DECIMAL(12,2) NOT NULL,
    "quantidade_operacoes" INTEGER NOT NULL,
    "custo_unitario" DECIMAL(12,4) NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custo_operacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config_custo" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "custo_hora_operador" DECIMAL(10,2) NOT NULL,
    "custo_hora_equipamento" DECIMAL(10,2) NOT NULL,
    "custo_m2_mes" DECIMAL(10,2) NOT NULL,
    "depreciacao" DECIMAL(5,2) NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "config_custo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "snapshot_bi" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "indicador" VARCHAR(30) NOT NULL,
    "valor" DECIMAL(14,4) NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "snapshot_bi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerta_correlacao" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "tipo" VARCHAR(30) NOT NULL,
    "indicador1" VARCHAR(30) NOT NULL,
    "valor1" DECIMAL(14,4) NOT NULL,
    "indicador2" VARCHAR(30),
    "valor2" DECIMAL(14,4),
    "mensagem" TEXT NOT NULL,
    "severidade" VARCHAR(10) NOT NULL,
    "status" VARCHAR(15) NOT NULL DEFAULT 'ABERTO',
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvido_em" TIMESTAMP(3),

    CONSTRAINT "alerta_correlacao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "custo_operacao_empresa_id_data_tipo_operacao_key" ON "custo_operacao"("empresa_id", "data", "tipo_operacao");

-- CreateIndex
CREATE UNIQUE INDEX "config_custo_empresa_id_key" ON "config_custo"("empresa_id");

-- CreateIndex
CREATE INDEX "snapshot_bi_empresa_id_indicador_data_idx" ON "snapshot_bi"("empresa_id", "indicador", "data");

-- CreateIndex
CREATE INDEX "alerta_correlacao_empresa_id_status_idx" ON "alerta_correlacao"("empresa_id", "status");
