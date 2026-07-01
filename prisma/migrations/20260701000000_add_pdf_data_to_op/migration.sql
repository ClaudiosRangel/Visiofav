-- AlterTable: Adiciona coluna pdf_data (bytea) para armazenar PDF no banco
-- Resolve problema de perda de PDFs em deploys no Render (filesystem efêmero)
ALTER TABLE "ordem_producao" ADD COLUMN "pdf_data" BYTEA;
