-- CreateTable
CREATE TABLE "template_etiqueta" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "nome" VARCHAR(100) NOT NULL,
    "tipo" VARCHAR(20) NOT NULL,
    "codigo_zpl" TEXT NOT NULL,
    "largura_mm" INTEGER NOT NULL,
    "altura_mm" INTEGER NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_por_id" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "template_etiqueta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "versao_template_etiqueta" (
    "id" TEXT NOT NULL,
    "template_etiqueta_id" TEXT NOT NULL,
    "versao" INTEGER NOT NULL,
    "codigo_zpl" TEXT NOT NULL,
    "criado_por_id" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "versao_template_etiqueta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "impressora_rede" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "nome" VARCHAR(100) NOT NULL,
    "modelo" VARCHAR(20) NOT NULL,
    "ip" VARCHAR(45) NOT NULL,
    "porta" INTEGER NOT NULL DEFAULT 9100,
    "localizacao" VARCHAR(100),
    "zona_id" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'OFFLINE',
    "ultimo_check" TIMESTAMP(3),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "impressora_rede_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fila_impressao" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "impressora_id" TEXT NOT NULL,
    "dados_variaveis" JSONB NOT NULL,
    "quantidade" INTEGER NOT NULL DEFAULT 1,
    "prioridade" VARCHAR(10) NOT NULL DEFAULT 'NORMAL',
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "erro" TEXT,
    "operacao" VARCHAR(30),
    "referencia_id" TEXT,
    "solicitado_por_id" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processado_em" TIMESTAMP(3),

    CONSTRAINT "fila_impressao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "template_etiqueta_empresa_id_tipo_idx" ON "template_etiqueta"("empresa_id", "tipo");

-- CreateIndex
CREATE UNIQUE INDEX "versao_template_etiqueta_template_etiqueta_id_versao_key" ON "versao_template_etiqueta"("template_etiqueta_id", "versao");

-- CreateIndex
CREATE UNIQUE INDEX "impressora_rede_empresa_id_ip_porta_key" ON "impressora_rede"("empresa_id", "ip", "porta");

-- CreateIndex
CREATE INDEX "fila_impressao_empresa_id_status_prioridade_idx" ON "fila_impressao"("empresa_id", "status", "prioridade");

-- AddForeignKey
ALTER TABLE "versao_template_etiqueta" ADD CONSTRAINT "versao_template_etiqueta_template_etiqueta_id_fkey" FOREIGN KEY ("template_etiqueta_id") REFERENCES "template_etiqueta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
