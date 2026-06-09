-- CreateTable
CREATE TABLE "veiculo_patio" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "cd_id" TEXT NOT NULL,
    "placa" VARCHAR(10) NOT NULL,
    "motorista_nome" VARCHAR(150) NOT NULL,
    "motorista_documento" VARCHAR(20) NOT NULL,
    "transportadora_id" TEXT,
    "tipo_operacao" VARCHAR(20) NOT NULL,
    "agendamento_id" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'AGUARDANDO',
    "doca_id" TEXT,
    "entrada_em" TIMESTAMP(3) NOT NULL,
    "chamada_doca_em" TIMESTAMP(3),
    "chegada_doca_em" TIMESTAMP(3),
    "saida_em" TIMESTAMP(3),
    "tempo_perm_minutos" INTEGER,
    "criado_por_id" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "veiculo_patio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fila_espera_patio" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "cd_id" TEXT NOT NULL,
    "veiculo_id" TEXT NOT NULL,
    "posicao" INTEGER NOT NULL,
    "prioridade" INTEGER NOT NULL DEFAULT 0,
    "justificativa_prioridade" TEXT,
    "entrada_fila_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fila_espera_patio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chamada_doca" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "veiculo_id" TEXT NOT NULL,
    "doca_id" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'CHAMADO',
    "chamado_em" TIMESTAMP(3) NOT NULL,
    "atendido_em" TIMESTAMP(3),
    "cancelado_em" TIMESTAMP(3),
    "motivo_cancelamento" TEXT,
    "tempo_resposta_min" INTEGER,
    "chamado_por_id" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chamada_doca_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config_patio" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "cd_id" TEXT NOT NULL,
    "limite_perm_minutos" INTEGER NOT NULL DEFAULT 240,
    "alerta_perm_ativo" BOOLEAN NOT NULL DEFAULT true,
    "prioridade_agendado" INTEGER NOT NULL DEFAULT 10,
    "prioridade_descarga" INTEGER NOT NULL DEFAULT 5,
    "prioridade_carga" INTEGER NOT NULL DEFAULT 3,
    "prioridade_padrao" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "config_patio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "veiculo_patio_empresa_id_cd_id_status_idx" ON "veiculo_patio"("empresa_id", "cd_id", "status");

-- CreateIndex
CREATE INDEX "veiculo_patio_placa_idx" ON "veiculo_patio"("placa");

-- CreateIndex
CREATE UNIQUE INDEX "fila_espera_patio_veiculo_id_key" ON "fila_espera_patio"("veiculo_id");

-- CreateIndex
CREATE INDEX "fila_espera_patio_empresa_id_cd_id_prioridade_posicao_idx" ON "fila_espera_patio"("empresa_id", "cd_id", "prioridade", "posicao");

-- CreateIndex
CREATE INDEX "chamada_doca_empresa_id_status_idx" ON "chamada_doca"("empresa_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "config_patio_empresa_id_cd_id_key" ON "config_patio"("empresa_id", "cd_id");

-- AddForeignKey
ALTER TABLE "fila_espera_patio" ADD CONSTRAINT "fila_espera_patio_veiculo_id_fkey" FOREIGN KEY ("veiculo_id") REFERENCES "veiculo_patio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
