-- AlterTable: Add new fields to pedido_venda
ALTER TABLE "pedido_venda"
ADD COLUMN "data_entrega" TIMESTAMP(3),
ADD COLUMN "observacao" TEXT,
ADD COLUMN "observacao_nota" TEXT,
ADD COLUMN "transportadora_id" TEXT,
ADD COLUMN "modalidade_frete" VARCHAR(1),
ADD COLUMN "origem_pedido" VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
ADD COLUMN "prioridade" VARCHAR(10) NOT NULL DEFAULT 'NORMAL',
ADD COLUMN "data_validade" TIMESTAMP(3),
ADD COLUMN "numero_pedido_cliente" VARCHAR(60),
ADD COLUMN "tipo_desconto" VARCHAR(15),
ADD COLUMN "desconto_geral" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "acrescimo_geral" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "tipo_acrescimo" VARCHAR(20),
ADD COLUMN "endereco_entrega" JSONB,
ADD COLUMN "orcamento_origem_id" TEXT,
ADD COLUMN "data_limite_atendimento" TIMESTAMP(3);

-- AlterTable: Add new fields to item_pedido_venda
ALTER TABLE "item_pedido_venda"
ADD COLUMN "desconto_valor" DECIMAL(12,4) NOT NULL DEFAULT 0,
ADD COLUMN "frete" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "seguro" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "outras_despesas" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "observacao_item" TEXT,
ADD COLUMN "data_entrega_item" TIMESTAMP(3),
ADD COLUMN "comissao_perc_item" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN "quantidade_faturada" DECIMAL(12,4) NOT NULL DEFAULT 0;

-- DropIndex: Remove @unique from pedidoVendaId to allow 1:N relation
DROP INDEX IF EXISTS "venda_efetivada_pedido_venda_id_key";

-- AddForeignKey: pedido_venda -> transportadora
ALTER TABLE "pedido_venda" ADD CONSTRAINT "pedido_venda_transportadora_id_fkey" FOREIGN KEY ("transportadora_id") REFERENCES "transportadora"("id") ON DELETE SET NULL ON UPDATE CASCADE;
