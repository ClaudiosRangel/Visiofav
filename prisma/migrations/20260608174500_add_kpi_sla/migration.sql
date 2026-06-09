-- CreateTable
CREATE TABLE "regra_kpi" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "nome" VARCHAR(100) NOT NULL,
    "descricao" TEXT,
    "entidade" VARCHAR(30) NOT NULL,
    "condicao" VARCHAR(30) NOT NULL,
    "threshold" DECIMAL(12,4) NOT NULL,
    "unidade" VARCHAR(20) NOT NULL,
    "janela_minutos" INTEGER,
    "cooldown_minutos" INTEGER NOT NULL DEFAULT 30,
    "severidade" VARCHAR(20) NOT NULL DEFAULT 'WARNING',
    "acoes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "destinatarios" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_por_id" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "regra_kpi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerta_kpi" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "regra_kpi_id" TEXT NOT NULL,
    "severidade" VARCHAR(20) NOT NULL,
    "valor_atual" DECIMAL(12,4) NOT NULL,
    "threshold" DECIMAL(12,4) NOT NULL,
    "entidade_id" VARCHAR(36),
    "mensagem" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ABERTO',
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvido_em" TIMESTAMP(3),

    CONSTRAINT "alerta_kpi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "historico_regra_kpi" (
    "id" TEXT NOT NULL,
    "regra_kpi_id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "campo" VARCHAR(50) NOT NULL,
    "valor_anterior" TEXT,
    "valor_novo" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historico_regra_kpi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "snapshot_kpi" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "indicador" VARCHAR(50) NOT NULL,
    "valor" DECIMAL(12,4) NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "snapshot_kpi_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "regra_kpi_empresa_id_ativo_idx" ON "regra_kpi"("empresa_id", "ativo");

-- CreateIndex
CREATE INDEX "alerta_kpi_empresa_id_status_idx" ON "alerta_kpi"("empresa_id", "status");

-- CreateIndex
CREATE INDEX "alerta_kpi_regra_kpi_id_idx" ON "alerta_kpi"("regra_kpi_id");

-- CreateIndex
CREATE INDEX "snapshot_kpi_empresa_id_indicador_criado_em_idx" ON "snapshot_kpi"("empresa_id", "indicador", "criado_em");

-- AddForeignKey
ALTER TABLE "alerta_kpi" ADD CONSTRAINT "alerta_kpi_regra_kpi_id_fkey" FOREIGN KEY ("regra_kpi_id") REFERENCES "regra_kpi"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historico_regra_kpi" ADD CONSTRAINT "historico_regra_kpi_regra_kpi_id_fkey" FOREIGN KEY ("regra_kpi_id") REFERENCES "regra_kpi"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
