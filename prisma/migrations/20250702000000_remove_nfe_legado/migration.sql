-- DropForeignKey
ALTER TABLE "item_nfe" DROP CONSTRAINT IF EXISTS "item_nfe_nfe_id_fkey";

-- DropForeignKey
ALTER TABLE "item_nfe" DROP CONSTRAINT IF EXISTS "item_nfe_produto_id_fkey";

-- DropForeignKey
ALTER TABLE "nfe" DROP CONSTRAINT IF EXISTS "nfe_empresa_id_fkey";

-- DropForeignKey
ALTER TABLE "nfe" DROP CONSTRAINT IF EXISTS "nfe_venda_efetivada_id_fkey";

-- DropTable
DROP TABLE IF EXISTS "item_nfe";

-- DropTable
DROP TABLE IF EXISTS "nfe";
