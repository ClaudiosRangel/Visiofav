-- CreateTable
CREATE TABLE "formato_endereco" (
    "id" TEXT NOT NULL,
    "nome" VARCHAR(100) NOT NULL,
    "descricao" VARCHAR(255),
    "segmentos" JSONB NOT NULL,
    "empresa_id" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "formato_endereco_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "deposito" ADD COLUMN "formato_endereco_id" TEXT;

-- AlterTable
ALTER TABLE "zona" ADD COLUMN "formato_endereco_id" TEXT;

-- AddForeignKey
ALTER TABLE "deposito" ADD CONSTRAINT "deposito_formato_endereco_id_fkey" FOREIGN KEY ("formato_endereco_id") REFERENCES "formato_endereco"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zona" ADD CONSTRAINT "zona_formato_endereco_id_fkey" FOREIGN KEY ("formato_endereco_id") REFERENCES "formato_endereco"("id") ON DELETE SET NULL ON UPDATE CASCADE;
