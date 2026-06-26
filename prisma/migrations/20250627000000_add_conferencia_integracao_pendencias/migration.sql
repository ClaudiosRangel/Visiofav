-- AlterTable: Substituir campos enum por booleanos no config_conferencia_produto
ALTER TABLE "config_conferencia_produto" DROP COLUMN IF EXISTS "modo_resolucao_lote",
DROP COLUMN IF EXISTS "modo_resolucao_validade",
ADD COLUMN IF NOT EXISTS "aceitar_cce_pendente" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "aceitar_senha" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: Adicionar statusConferencia ao item_nota_entrada
ALTER TABLE "item_nota_entrada" ADD COLUMN IF NOT EXISTS "status_conferencia" VARCHAR(30) NOT NULL DEFAULT 'PENDENTE';

-- CreateTable: config_integracao
CREATE TABLE IF NOT EXISTS "config_integracao" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "integracao_ativa" BOOLEAN NOT NULL DEFAULT false,
    "sistema_externo" VARCHAR(100),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "config_integracao_pkey" PRIMARY KEY ("id")
);

-- CreateTable: config_email_fiscal
CREATE TABLE IF NOT EXISTS "config_email_fiscal" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "config_email_fiscal_pkey" PRIMARY KEY ("id")
);

-- CreateTable: pendencia_cce
CREATE TABLE IF NOT EXISTS "pendencia_cce" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "nota_entrada_id" TEXT NOT NULL,
    "codigo_produto" VARCHAR(60) NOT NULL,
    "descricao_produto" VARCHAR(200) NOT NULL,
    "fornecedor" VARCHAR(200) NOT NULL,
    "tipo" VARCHAR(10) NOT NULL,
    "motivo" VARCHAR(50) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'AGUARDANDO_CCE',
    "resolvido_em" TIMESTAMP(3),
    "resolvido_por_id" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pendencia_cce_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "config_integracao_empresa_id_key" ON "config_integracao"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "config_email_fiscal_empresa_id_key" ON "config_email_fiscal"("empresa_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pendencia_cce_empresa_id_status_idx" ON "pendencia_cce"("empresa_id", "status");

-- AddForeignKey
ALTER TABLE "config_integracao" ADD CONSTRAINT "config_integracao_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "config_email_fiscal" ADD CONSTRAINT "config_email_fiscal_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pendencia_cce" ADD CONSTRAINT "pendencia_cce_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pendencia_cce" ADD CONSTRAINT "pendencia_cce_nota_entrada_id_fkey" FOREIGN KEY ("nota_entrada_id") REFERENCES "nota_entrada"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
