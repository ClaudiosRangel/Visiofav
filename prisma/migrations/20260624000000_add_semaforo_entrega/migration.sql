-- Semáforo de entrega: data original e contador de postergações
ALTER TABLE "ordem_producao" ADD COLUMN IF NOT EXISTS "data_entrega_original" TIMESTAMP;
ALTER TABLE "ordem_producao" ADD COLUMN IF NOT EXISTS "vezes_postergada" INTEGER NOT NULL DEFAULT 0;
