-- AlterTable
ALTER TABLE "agenda_wms" ADD COLUMN "hora_chegada_real" TIMESTAMP(3);
ALTER TABLE "agenda_wms" ADD COLUMN "tempo_perm_doca_min" INTEGER;

-- CreateTable
CREATE TABLE "bloqueio_slot_doca" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "doca_id" TEXT NOT NULL,
    "data_inicio" TIMESTAMP(3) NOT NULL,
    "data_fim" TIMESTAMP(3) NOT NULL,
    "motivo" VARCHAR(200) NOT NULL,
    "criado_por_id" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bloqueio_slot_doca_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config_doca" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "hora_abertura_op" VARCHAR(5) NOT NULL,
    "hora_fechamento_op" VARCHAR(5) NOT NULL,
    "buffer_minutos" INTEGER NOT NULL DEFAULT 15,
    "tolerancia_atraso" INTEGER NOT NULL DEFAULT 30,

    CONSTRAINT "config_doca_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bloqueio_slot_doca_empresa_id_doca_id_data_inicio_data_fim_idx" ON "bloqueio_slot_doca"("empresa_id", "doca_id", "data_inicio", "data_fim");

-- CreateIndex
CREATE UNIQUE INDEX "config_doca_empresa_id_key" ON "config_doca"("empresa_id");
