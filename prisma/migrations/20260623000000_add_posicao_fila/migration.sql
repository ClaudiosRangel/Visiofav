-- AlterTable: add posicao_fila to etapa_ordem_producao for drag-and-drop reordering
ALTER TABLE "etapa_ordem_producao" ADD COLUMN IF NOT EXISTS "posicao_fila" INTEGER;
