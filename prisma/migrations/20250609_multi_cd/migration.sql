-- CreateTable
CREATE TABLE "solicitacao_transferencia" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "numero" VARCHAR(20) NOT NULL,
    "cd_origem_id" TEXT NOT NULL,
    "cd_destino_id" TEXT NOT NULL,
    "motivo" VARCHAR(200) NOT NULL,
    "prioridade" VARCHAR(10) NOT NULL DEFAULT 'NORMAL',
    "data_prevista_envio" TIMESTAMP(3),
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
    "criado_por_id" TEXT NOT NULL,
    "aprovado_por_id" TEXT,
    "aprovado_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "solicitacao_transferencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_solicitacao_transferencia" (
    "id" TEXT NOT NULL,
    "solicitacao_transferencia_id" TEXT NOT NULL,
    "produto_id" TEXT NOT NULL,
    "quantidade_solicitada" DECIMAL(12,4) NOT NULL,
    "quantidade_expedida" DECIMAL(12,4),
    "quantidade_recebida" DECIMAL(12,4),

    CONSTRAINT "item_solicitacao_transferencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documento_saida_transferencia" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "solicitacao_transferencia_id" TEXT NOT NULL,
    "numero" VARCHAR(20) NOT NULL,
    "veiculo_placa" VARCHAR(10),
    "motorista_id" TEXT,
    "data_saida" TIMESTAMP(3) NOT NULL,
    "previsao_chegada" TIMESTAMP(3),
    "criado_por_id" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documento_saida_transferencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mercadoria_transito" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "solicitacao_transferencia_id" TEXT NOT NULL,
    "produto_id" TEXT NOT NULL,
    "quantidade" DECIMAL(12,4) NOT NULL,
    "cd_origem_id" TEXT NOT NULL,
    "cd_destino_id" TEXT NOT NULL,
    "data_saida" TIMESTAMP(3) NOT NULL,
    "previsao_chegada" TIMESTAMP(3),
    "status" VARCHAR(20) NOT NULL DEFAULT 'EM_TRANSITO',
    "recebido_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mercadoria_transito_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "solicitacao_transferencia_empresa_id_numero_key" ON "solicitacao_transferencia"("empresa_id", "numero");

-- CreateIndex
CREATE INDEX "solicitacao_transferencia_empresa_id_status_idx" ON "solicitacao_transferencia"("empresa_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "documento_saida_transferencia_solicitacao_transferencia_id_key" ON "documento_saida_transferencia"("solicitacao_transferencia_id");

-- CreateIndex
CREATE UNIQUE INDEX "documento_saida_transferencia_empresa_id_numero_key" ON "documento_saida_transferencia"("empresa_id", "numero");

-- CreateIndex
CREATE INDEX "mercadoria_transito_empresa_id_status_idx" ON "mercadoria_transito"("empresa_id", "status");

-- AddForeignKey
ALTER TABLE "item_solicitacao_transferencia" ADD CONSTRAINT "item_solicitacao_transferencia_solicitacao_transferencia_id_fkey" FOREIGN KEY ("solicitacao_transferencia_id") REFERENCES "solicitacao_transferencia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documento_saida_transferencia" ADD CONSTRAINT "documento_saida_transferencia_solicitacao_transferencia_id_fkey" FOREIGN KEY ("solicitacao_transferencia_id") REFERENCES "solicitacao_transferencia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
