-- Adicionar campo tipo_maquina ao centro_producao
ALTER TABLE "centro_producao" ADD COLUMN IF NOT EXISTS "tipo_maquina" VARCHAR(20);

-- Migração de dados existentes: classificar centros por keyword matching (case-insensitive)
-- Idempotente: só processa registros onde tipo = 'MAQUINA' AND tipo_maquina IS NULL

UPDATE centro_producao
SET tipo_maquina = 'IMPRESSAO'
WHERE tipo = 'MAQUINA'
  AND tipo_maquina IS NULL
  AND (
    descricao ILIKE '%impress%'
    OR descricao ILIKE '%heidelberg%'
    OR descricao ILIKE '%offset%'
  );

UPDATE centro_producao
SET tipo_maquina = 'CORTADEIRA'
WHERE tipo = 'MAQUINA'
  AND tipo_maquina IS NULL
  AND (
    descricao ILIKE '%corta%'
    OR descricao ILIKE '%cortadeira%'
    OR descricao ILIKE '%makpel%'
    OR descricao ILIKE '%guilhotina%'
  );

UPDATE centro_producao
SET tipo_maquina = 'ACABAMENTO'
WHERE tipo = 'MAQUINA'
  AND tipo_maquina IS NULL
  AND (
    descricao ILIKE '%bobst%'
    OR descricao ILIKE '%aft%'
    OR descricao ILIKE '%colagem%'
    OR descricao ILIKE '%verniz%'
    OR descricao ILIKE '%acabamento%'
    OR descricao ILIKE '%dobra%'
    OR descricao ILIKE '%cola%'
  );
