-- CreateTable
CREATE TABLE "previsao_demanda" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "produto_id" TEXT NOT NULL,
    "data_previsao" TIMESTAMP(3) NOT NULL,
    "quantidade_prevista" DECIMAL(12,4) NOT NULL,
    "quantidade_real" DECIMAL(12,4),
    "metodo" VARCHAR(20) NOT NULL,
    "horizonte" INTEGER NOT NULL,
    "confianca" DECIMAL(5,2) NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "previsao_demanda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classificacao_abc" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "produto_id" TEXT NOT NULL,
    "criterio" VARCHAR(20) NOT NULL,
    "classificacao" VARCHAR(1) NOT NULL,
    "valor" DECIMAL(14,4) NOT NULL,
    "percentual_acumulado" DECIMAL(5,2) NOT NULL,
    "periodo_inicio" TIMESTAMP(3) NOT NULL,
    "periodo_fim" TIMESTAMP(3) NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classificacao_abc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sugestao_slotting" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "produto_id" TEXT NOT NULL,
    "endereco_atual_id" TEXT,
    "endereco_sugerido_id" TEXT NOT NULL,
    "motivo" VARCHAR(200) NOT NULL,
    "prioridade" VARCHAR(10) NOT NULL,
    "score" DECIMAL(8,2) NOT NULL,
    "status" VARCHAR(15) NOT NULL DEFAULT 'PENDENTE',
    "aplicada_em" TIMESTAMP(3),
    "aplicada_por_id" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sugestao_slotting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config_previsao" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "periodo_historico_dias" INTEGER NOT NULL DEFAULT 90,
    "metodo_preferido" VARCHAR(20) NOT NULL DEFAULT 'MEDIA_MOVEL',
    "frequencia_atualizacao" VARCHAR(15) NOT NULL DEFAULT 'DIARIA',
    "estoque_seguranca_dias" INTEGER NOT NULL DEFAULT 7,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "config_previsao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "previsao_demanda_empresa_id_produto_id_data_previsao_idx" ON "previsao_demanda"("empresa_id", "produto_id", "data_previsao");

-- CreateIndex
CREATE UNIQUE INDEX "classificacao_abc_empresa_id_produto_id_criterio_periodo_ini_key" ON "classificacao_abc"("empresa_id", "produto_id", "criterio", "periodo_inicio");

-- CreateIndex
CREATE INDEX "sugestao_slotting_empresa_id_status_idx" ON "sugestao_slotting"("empresa_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "config_previsao_empresa_id_key" ON "config_previsao"("empresa_id");
