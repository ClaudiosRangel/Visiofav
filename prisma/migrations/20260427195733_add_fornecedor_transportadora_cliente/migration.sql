-- CreateTable
CREATE TABLE "fornecedor" (
    "id" TEXT NOT NULL,
    "codigo" SERIAL NOT NULL,
    "razao_social" VARCHAR(200) NOT NULL,
    "cnpj" VARCHAR(20),
    "contato" VARCHAR(100),
    "telefone" VARCHAR(20),
    "email" VARCHAR(200),
    "status" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fornecedor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transportadora" (
    "id" TEXT NOT NULL,
    "codigo" SERIAL NOT NULL,
    "razao_social" VARCHAR(200) NOT NULL,
    "cnpj" VARCHAR(20),
    "telefone" VARCHAR(20),
    "email" VARCHAR(200),
    "status" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transportadora_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cliente" (
    "id" TEXT NOT NULL,
    "codigo" SERIAL NOT NULL,
    "razao_social" VARCHAR(200) NOT NULL,
    "cnpj_cpf" VARCHAR(20),
    "contato" VARCHAR(100),
    "telefone" VARCHAR(20),
    "email" VARCHAR(200),
    "status" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cliente_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fornecedor_codigo_key" ON "fornecedor"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "transportadora_codigo_key" ON "transportadora"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "cliente_codigo_key" ON "cliente"("codigo");
