-- CreateTable
CREATE TABLE "regra_onda" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "nome" VARCHAR(100) NOT NULL,
    "prioridade" INTEGER NOT NULL,
    "tipo" VARCHAR(30) NOT NULL,
    "parametros" JSONB NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "regra_onda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planejamento_onda" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "data_referencia" TIMESTAMP(3) NOT NULL,
    "status" VARCHAR(15) NOT NULL DEFAULT 'SIMULADO',
    "total_ondas" INTEGER NOT NULL,
    "total_pedidos" INTEGER NOT NULL,
    "total_itens" INTEGER NOT NULL,
    "gerado_em" TIMESTAMP(3) NOT NULL,
    "confirmado_por_id" TEXT,
    "confirmado_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "planejamento_onda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "simulacao_onda" (
    "id" TEXT NOT NULL,
    "planejamento_onda_id" TEXT NOT NULL,
    "onda_numero" INTEGER NOT NULL,
    "doca_id" TEXT,
    "rota_id" TEXT,
    "total_pedidos" INTEGER NOT NULL,
    "total_itens" INTEGER NOT NULL,
    "hora_inicio_estimada" TIMESTAMP(3) NOT NULL,
    "hora_fim_estimada" TIMESTAMP(3) NOT NULL,
    "carga_kg" DECIMAL(12,2),
    "volume_m3" DECIMAL(12,4),

    CONSTRAINT "simulacao_onda_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "regra_onda_empresa_id_ativo_idx" ON "regra_onda"("empresa_id", "ativo");

-- AddForeignKey
ALTER TABLE "simulacao_onda" ADD CONSTRAINT "simulacao_onda_planejamento_onda_id_fkey" FOREIGN KEY ("planejamento_onda_id") REFERENCES "planejamento_onda"("id") ON DELETE CASCADE ON UPDATE CASCADE;
