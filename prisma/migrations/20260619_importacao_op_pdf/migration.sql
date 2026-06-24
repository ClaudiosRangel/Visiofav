-- Campos adicionais na OrdemProducao para suporte a importação de OP externa
ALTER TABLE "ordem_producao" ADD COLUMN IF NOT EXISTS "referencia_externa" VARCHAR(50);
ALTER TABLE "ordem_producao" ADD COLUMN IF NOT EXISTS "origem_importacao" VARCHAR(30);
ALTER TABLE "ordem_producao" ADD COLUMN IF NOT EXISTS "criado_por_id" VARCHAR(255);

-- Campos adicionais no ItemOrdemProducao para materiais sem vínculo
ALTER TABLE "item_ordem_producao" ADD COLUMN IF NOT EXISTS "descricao_externa" VARCHAR(300);
ALTER TABLE "item_ordem_producao" ADD COLUMN IF NOT EXISTS "tipo_material" VARCHAR(30);

-- Tornar produto_componente_id nullable (para itens importados sem vínculo)
ALTER TABLE "item_ordem_producao" ALTER COLUMN "produto_componente_id" DROP NOT NULL;

-- Tornar centro_producao_id nullable na etapa (para etapas importadas sem vínculo)
ALTER TABLE "etapa_ordem_producao" ALTER COLUMN "centro_producao_id" DROP NOT NULL;

-- Tornar data_entrega_prevista nullable na OP (pode não vir no PDF)
ALTER TABLE "ordem_producao" ALTER COLUMN "data_entrega_prevista" DROP NOT NULL;

-- Tabela De/Para para mapeamento de códigos externos
CREATE TABLE IF NOT EXISTS "de_para_importacao" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "empresa_id" VARCHAR(255) NOT NULL,
    "sistema_origem" VARCHAR(50) NOT NULL,
    "tipo_entidade" VARCHAR(30) NOT NULL,
    "codigo_externo" VARCHAR(100) NOT NULL,
    "nome_externo" VARCHAR(200) NOT NULL,
    "entidade_interna_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ATIVO',
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "de_para_importacao_pkey" PRIMARY KEY ("id")
);

-- Índice único para evitar duplicatas no De/Para
CREATE UNIQUE INDEX IF NOT EXISTS "de_para_importacao_empresa_sistema_tipo_codigo_key"
    ON "de_para_importacao"("empresa_id", "sistema_origem", "tipo_entidade", "codigo_externo");

-- Índice para busca rápida
CREATE INDEX IF NOT EXISTS "de_para_importacao_empresa_sistema_idx"
    ON "de_para_importacao"("empresa_id", "sistema_origem");
