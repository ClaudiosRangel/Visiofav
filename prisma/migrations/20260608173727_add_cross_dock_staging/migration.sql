-- CreateTable
CREATE TABLE "cross_dock_item" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "nota_entrada_id" TEXT NOT NULL,
    "item_nota_entrada_id" TEXT NOT NULL,
    "pedido_venda_id" TEXT NOT NULL,
    "produto_id" TEXT NOT NULL,
    "quantidade" DECIMAL(12,4) NOT NULL,
    "tipo" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'IDENTIFICADO',
    "staging_endereco_id" TEXT,
    "doca_saida_id" TEXT,
    "ordem_servico_id" TEXT,
    "justificativa" TEXT,
    "criado_por_id" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "expedido_em" TIMESTAMP(3),

    CONSTRAINT "cross_dock_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staging_area" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "endereco_id" TEXT NOT NULL,
    "doca_id" TEXT NOT NULL,
    "nome" VARCHAR(50) NOT NULL,
    "capacidade" INTEGER NOT NULL DEFAULT 100,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staging_area_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cross_dock_item_empresa_id_status_idx" ON "cross_dock_item"("empresa_id", "status");

-- CreateIndex
CREATE INDEX "cross_dock_item_pedido_venda_id_idx" ON "cross_dock_item"("pedido_venda_id");

-- CreateIndex
CREATE INDEX "cross_dock_item_nota_entrada_id_idx" ON "cross_dock_item"("nota_entrada_id");

-- CreateIndex
CREATE UNIQUE INDEX "staging_area_empresa_id_endereco_id_key" ON "staging_area"("empresa_id", "endereco_id");
