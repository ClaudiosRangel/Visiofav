-- AlterTable: Adicionar coordenadas geográficas na tabela empresa
ALTER TABLE "empresa" ADD COLUMN "latitude" DECIMAL(10,7);
ALTER TABLE "empresa" ADD COLUMN "longitude" DECIMAL(10,7);

-- AlterTable: Adicionar coordenadas geográficas na tabela cliente
ALTER TABLE "cliente" ADD COLUMN "latitude" DECIMAL(10,7);
ALTER TABLE "cliente" ADD COLUMN "longitude" DECIMAL(10,7);

-- AlterTable: Adicionar campos de sequência de entrega na tabela mapa_carregamento
ALTER TABLE "mapa_carregamento" ADD COLUMN "distancia_total_km" DECIMAL(10,2);
ALTER TABLE "mapa_carregamento" ADD COLUMN "sequencia_valida" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: Adicionar campos de sequência de entrega na tabela mapa_carregamento_nf
ALTER TABLE "mapa_carregamento_nf" ADD COLUMN "ordem_entrega" INTEGER;
ALTER TABLE "mapa_carregamento_nf" ADD COLUMN "distancia_parcial_km" DECIMAL(10,2);
