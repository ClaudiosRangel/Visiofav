-- AlterTable: Add capacity fields to estrutura
ALTER TABLE "estrutura" ADD COLUMN "capacidade" DECIMAL(10,3);
ALTER TABLE "estrutura" ADD COLUMN "largura" DECIMAL(10,3);
ALTER TABLE "estrutura" ADD COLUMN "altura" DECIMAL(10,3);
ALTER TABLE "estrutura" ADD COLUMN "comprimento" DECIMAL(10,3);
ALTER TABLE "estrutura" ADD COLUMN "cubagem" DECIMAL(10,6);

-- AlterTable: Add codigo_barras and area_armazenagem to endereco
-- Note: forma_armazenagem_id, ambiente_armazenagem_id, classificacao_produto_id already exist from init migration
ALTER TABLE "endereco" ADD COLUMN IF NOT EXISTS "codigo_barras" VARCHAR(30);
ALTER TABLE "endereco" ADD COLUMN IF NOT EXISTS "area_armazenagem" VARCHAR(20);
