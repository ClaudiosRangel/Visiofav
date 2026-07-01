-- AlterTable
ALTER TABLE "documento_fiscal" ADD COLUMN "compra_efetivada_id" TEXT;

-- AddForeignKey
ALTER TABLE "documento_fiscal" ADD CONSTRAINT "documento_fiscal_compra_efetivada_id_fkey" FOREIGN KEY ("compra_efetivada_id") REFERENCES "compra_efetivada"("id") ON DELETE SET NULL ON UPDATE CASCADE;
