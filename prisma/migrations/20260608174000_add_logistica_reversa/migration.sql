-- CreateTable
CREATE TABLE "autorizacao_retorno" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "numero" VARCHAR(20) NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "nfe_origem_id" TEXT NOT NULL,
    "motivo" VARCHAR(100) NOT NULL,
    "observacao" TEXT,
    "data_limite" TIMESTAMP(3),
    "status" VARCHAR(20) NOT NULL DEFAULT 'ABERTA',
    "criado_por_id" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "recebido_em" TIMESTAMP(3),
    "concluido_em" TIMESTAMP(3),

    CONSTRAINT "autorizacao_retorno_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_autorizacao_retorno" (
    "id" TEXT NOT NULL,
    "autorizacao_retorno_id" TEXT NOT NULL,
    "produto_id" TEXT NOT NULL,
    "quantidade" DECIMAL(12,4) NOT NULL,
    "quantidade_recebida" DECIMAL(12,4),
    "condicao" VARCHAR(20),
    "disposicao" VARCHAR(30),
    "parecer_inspecao" TEXT,
    "fotos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "inspecionado_por_id" TEXT,
    "inspecionado_em" TIMESTAMP(3),

    CONSTRAINT "item_autorizacao_retorno_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "autorizacao_retorno_empresa_id_numero_key" ON "autorizacao_retorno"("empresa_id", "numero");

-- CreateIndex
CREATE INDEX "autorizacao_retorno_empresa_id_status_idx" ON "autorizacao_retorno"("empresa_id", "status");

-- CreateIndex
CREATE INDEX "autorizacao_retorno_cliente_id_idx" ON "autorizacao_retorno"("cliente_id");

-- AddForeignKey
ALTER TABLE "item_autorizacao_retorno" ADD CONSTRAINT "item_autorizacao_retorno_autorizacao_retorno_id_fkey" FOREIGN KEY ("autorizacao_retorno_id") REFERENCES "autorizacao_retorno"("id") ON DELETE CASCADE ON UPDATE CASCADE;
