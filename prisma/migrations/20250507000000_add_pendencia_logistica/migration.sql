-- CreateTable
CREATE TABLE "pendencia_logistica" (
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
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pendencia_logistica_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pendencia_logistica_empresa_id_status_idx" ON "pendencia_logistica"("empresa_id", "status");

-- CreateIndex
CREATE INDEX "pendencia_logistica_nota_entrada_id_idx" ON "pendencia_logistica"("nota_entrada_id");
