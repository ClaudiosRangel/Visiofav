-- AlterTable: Add mapa_ok column to documento_fiscal for WMS loading map feature
ALTER TABLE "documento_fiscal" ADD COLUMN "mapa_ok" BOOLEAN NOT NULL DEFAULT false;

-- Add FK from mapa_carregamento_nf.nfe_id to documento_fiscal.id
-- Note: This FK previously pointed to the legacy nfe table.
-- After data migration (migrar-nfe-legado.ts), the nfe_id column stores DocumentoFiscal IDs.
ALTER TABLE "mapa_carregamento_nf"
  ADD CONSTRAINT "mapa_carregamento_nf_nfe_id_fkey"
  FOREIGN KEY ("nfe_id") REFERENCES "documento_fiscal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
