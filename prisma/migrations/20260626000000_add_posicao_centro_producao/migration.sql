-- Adicionar campo posicao ao centro_producao
ALTER TABLE "centro_producao" ADD COLUMN IF NOT EXISTS "posicao" INTEGER NOT NULL DEFAULT 0;

-- Backfill: atribuir posições sequenciais para centros existentes,
-- ordenados por codigo dentro de cada empresa (ROW_NUMBER - 1 para base 0)
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY empresa_id ORDER BY codigo ASC) - 1 AS nova_posicao
  FROM centro_producao
)
UPDATE centro_producao
SET posicao = ranked.nova_posicao
FROM ranked
WHERE centro_producao.id = ranked.id;
