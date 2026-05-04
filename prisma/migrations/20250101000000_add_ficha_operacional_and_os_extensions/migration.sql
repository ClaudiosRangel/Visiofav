-- AlterTable
ALTER TABLE "ordem_servico_wms" ADD COLUMN     "carregamento_id" TEXT,
ADD COLUMN     "onda_separacao_id" TEXT;

-- CreateTable
CREATE TABLE "sku" (
    "id" TEXT NOT NULL,
    "produto_id" TEXT NOT NULL,
    "sequencia" INTEGER NOT NULL,
    "descricao" VARCHAR(200),
    "codigo_barra" VARCHAR(30),
    "unidade" VARCHAR(6) NOT NULL,
    "qtd_embalagem" INTEGER NOT NULL DEFAULT 1,
    "largura" DECIMAL(10,3),
    "altura" DECIMAL(10,3),
    "comprimento" DECIMAL(10,3),
    "volume" DECIMAL(10,6),
    "peso_liquido" DECIMAL(10,3),
    "peso_bruto" DECIMAL(10,3),
    "peso_palete" DECIMAL(10,3),
    "lastro" INTEGER,
    "camada" INTEGER,
    "tipo_palete" VARCHAR(30),
    "status" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sku_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_movimentacao" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "produto_id" TEXT NOT NULL,
    "endereco_id" TEXT NOT NULL,
    "tipo" VARCHAR(30) NOT NULL,
    "quantidade" DECIMAL(12,4) NOT NULL,
    "saldo_anterior" DECIMAL(12,4) NOT NULL,
    "saldo_novo" DECIMAL(12,4) NOT NULL,
    "motivo" TEXT,
    "usuario_id" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "log_movimentacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventario" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "tipo" VARCHAR(20) NOT NULL DEFAULT 'GERAL',
    "status" VARCHAR(20) NOT NULL DEFAULT 'ABERTO',
    "zona_id" TEXT,
    "rua" VARCHAR(10),
    "observacao" TEXT,
    "criado_por_id" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluido_em" TIMESTAMP(3),

    CONSTRAINT "inventario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_inventario" (
    "id" TEXT NOT NULL,
    "inventario_id" TEXT NOT NULL,
    "endereco_id" TEXT NOT NULL,
    "produto_id" TEXT NOT NULL,
    "saldo_sistema" DECIMAL(12,4) NOT NULL,
    "saldo_contado" DECIMAL(12,4),
    "divergencia" DECIMAL(12,4),
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
    "ajuste_aplicado" BOOLEAN NOT NULL DEFAULT false,
    "contado_em" TIMESTAMP(3),

    CONSTRAINT "item_inventario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ficha_operacional" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "tipo" VARCHAR(20) NOT NULL,
    "referencia_id" TEXT NOT NULL,
    "ordem_servico_id" TEXT,
    "codigo_barras" VARCHAR(30) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'GERADA',
    "dados_ocr" TEXT,
    "origem_dados" VARCHAR(10),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ficha_operacional_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "entidade" VARCHAR(50) NOT NULL,
    "entidade_id" VARCHAR(36) NOT NULL,
    "acao" VARCHAR(30) NOT NULL,
    "descricao" TEXT NOT NULL,
    "dados" TEXT,
    "usuario_id" TEXT NOT NULL,
    "ip" VARCHAR(45),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dados_logisticos_armazenagem" (
    "id" TEXT NOT NULL,
    "produto_id" TEXT NOT NULL,
    "sku_seq" INTEGER NOT NULL,
    "sequencia" INTEGER NOT NULL,
    "endereco_fixo_id" TEXT,
    "tipoNorma" VARCHAR(10) NOT NULL DEFAULT 'FEFO',
    "pulmao_regulador" INTEGER NOT NULL DEFAULT 0,
    "nivel_min_pp" INTEGER NOT NULL DEFAULT 0,
    "nivel_max_pp" INTEGER NOT NULL DEFAULT 0,
    "nivel_max_blocado" INTEGER NOT NULL DEFAULT 0,
    "fixo" BOOLEAN NOT NULL DEFAULT false,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dados_logisticos_armazenagem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dados_logisticos_picking" (
    "id" TEXT NOT NULL,
    "produto_id" TEXT NOT NULL,
    "sku_seq" INTEGER NOT NULL,
    "sequencia" INTEGER NOT NULL,
    "endereco_picking_id" TEXT,
    "tipoPicking" VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
    "capacidade" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "ponto_reposicao" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "ponto_reposicao_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "ponto_reposicao_dias" INTEGER NOT NULL DEFAULT 0,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dados_logisticos_picking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dados_logisticos_expedicao" (
    "id" TEXT NOT NULL,
    "produto_id" TEXT NOT NULL,
    "sku_seq" INTEGER NOT NULL,
    "fracionado" BOOLEAN NOT NULL DEFAULT false,
    "absorbe_palete_fechado" BOOLEAN NOT NULL DEFAULT false,
    "absorbe_palete_fechado_cx" BOOLEAN NOT NULL DEFAULT false,
    "tipo_produto" VARCHAR(20),
    "tipo_carga_id" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dados_logisticos_expedicao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "log_movimentacao_empresa_id_criado_em_idx" ON "log_movimentacao"("empresa_id", "criado_em");

-- CreateIndex
CREATE INDEX "log_movimentacao_produto_id_idx" ON "log_movimentacao"("produto_id");

-- CreateIndex
CREATE INDEX "log_movimentacao_endereco_id_idx" ON "log_movimentacao"("endereco_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventario_empresa_id_numero_key" ON "inventario"("empresa_id", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "ficha_operacional_codigo_barras_key" ON "ficha_operacional"("codigo_barras");

-- CreateIndex
CREATE INDEX "ficha_operacional_empresa_id_tipo_idx" ON "ficha_operacional"("empresa_id", "tipo");

-- CreateIndex
CREATE INDEX "ficha_operacional_referencia_id_idx" ON "ficha_operacional"("referencia_id");

-- CreateIndex
CREATE INDEX "audit_log_empresa_id_criado_em_idx" ON "audit_log"("empresa_id", "criado_em");

-- CreateIndex
CREATE INDEX "audit_log_entidade_entidade_id_idx" ON "audit_log"("entidade", "entidade_id");

-- CreateIndex
CREATE INDEX "audit_log_usuario_id_idx" ON "audit_log"("usuario_id");

-- AddForeignKey
ALTER TABLE "ordem_servico_wms" ADD CONSTRAINT "ordem_servico_wms_onda_separacao_id_fkey" FOREIGN KEY ("onda_separacao_id") REFERENCES "onda_separacao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordem_servico_wms" ADD CONSTRAINT "ordem_servico_wms_carregamento_id_fkey" FOREIGN KEY ("carregamento_id") REFERENCES "carregamento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_inventario" ADD CONSTRAINT "item_inventario_inventario_id_fkey" FOREIGN KEY ("inventario_id") REFERENCES "inventario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ficha_operacional" ADD CONSTRAINT "ficha_operacional_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ficha_operacional" ADD CONSTRAINT "ficha_operacional_ordem_servico_id_fkey" FOREIGN KEY ("ordem_servico_id") REFERENCES "ordem_servico_wms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
