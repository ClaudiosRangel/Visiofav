-- AlterTable
ALTER TABLE "apontamento_etapa" ADD COLUMN     "apontamento_origem_id" TEXT,
ADD COLUMN     "autorizado_por_usuario_id" TEXT,
ADD COLUMN     "fonte_apontamento" VARCHAR(30) NOT NULL DEFAULT 'MANUAL_OPERADOR',
ADD COLUMN     "motivo_retroativo" TEXT,
ADD COLUMN     "parada_planejada" BOOLEAN,
ADD COLUMN     "quantidade_retrabalho" DECIMAL(12,4) NOT NULL DEFAULT 0,
ADD COLUMN     "setup_duracao_minutos" INTEGER,
ADD COLUMN     "setup_fim" TIMESTAMP(3),
ADD COLUMN     "setup_inicio" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "funcionario" ADD COLUMN     "pin_ativo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pin_hash" VARCHAR(200);

-- CreateTable
CREATE TABLE "pendencia_material" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "etapa_ordem_producao_id" TEXT NOT NULL,
    "apontamento_parada_id" TEXT,
    "descricao" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvida_em" TIMESTAMP(3),
    "resolvida_por_usuario_id" TEXT,

    CONSTRAINT "pendencia_material_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operador_ativo_etapa" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "etapa_ordem_producao_id" TEXT NOT NULL,
    "funcionario_id" TEXT NOT NULL,
    "entrada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "saida_em" TIMESTAMP(3),

    CONSTRAINT "operador_ativo_etapa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "etapa_autorizacao_sequencia" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "etapa_ordem_producao_id" TEXT NOT NULL,
    "etapa_bloqueadora_id" TEXT NOT NULL,
    "autorizado_por_usuario_id" TEXT NOT NULL,
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "etapa_autorizacao_sequencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessao_terminal" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "centro_producao_id" TEXT NOT NULL,
    "autenticada_por_usuario_id" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ATIVA',
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expira_em" TIMESTAMP(3) NOT NULL,
    "encerrada_em" TIMESTAMP(3),

    CONSTRAINT "sessao_terminal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pendencia_material_empresa_id_status_idx" ON "pendencia_material"("empresa_id", "status");

-- CreateIndex
CREATE INDEX "pendencia_material_etapa_ordem_producao_id_idx" ON "pendencia_material"("etapa_ordem_producao_id");

-- CreateIndex
CREATE INDEX "operador_ativo_etapa_etapa_ordem_producao_id_saida_em_idx" ON "operador_ativo_etapa"("etapa_ordem_producao_id", "saida_em");

-- CreateIndex
CREATE INDEX "etapa_autorizacao_sequencia_etapa_ordem_producao_id_idx" ON "etapa_autorizacao_sequencia"("etapa_ordem_producao_id");

-- CreateIndex
CREATE INDEX "sessao_terminal_empresa_id_status_idx" ON "sessao_terminal"("empresa_id", "status");

-- CreateIndex
CREATE INDEX "sessao_terminal_centro_producao_id_status_idx" ON "sessao_terminal"("centro_producao_id", "status");

-- CreateIndex
CREATE INDEX "apontamento_etapa_fonte_apontamento_idx" ON "apontamento_etapa"("fonte_apontamento");

-- CreateIndex
CREATE INDEX "apontamento_etapa_apontamento_origem_id_idx" ON "apontamento_etapa"("apontamento_origem_id");

-- AddForeignKey
ALTER TABLE "apontamento_etapa" ADD CONSTRAINT "apontamento_etapa_apontamento_origem_id_fkey" FOREIGN KEY ("apontamento_origem_id") REFERENCES "apontamento_etapa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessao_terminal" ADD CONSTRAINT "sessao_terminal_centro_producao_id_fkey" FOREIGN KEY ("centro_producao_id") REFERENCES "centro_producao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
