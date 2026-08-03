-- AlterTable
ALTER TABLE "dados_logisticos_picking" ADD COLUMN IF NOT EXISTS "modo_abastecimento" VARCHAR(20) NOT NULL DEFAULT 'VERIFICAR_PK';
