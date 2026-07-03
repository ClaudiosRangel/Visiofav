-- PDV Tables
CREATE TABLE IF NOT EXISTS "caixa_pdv" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "empresa_id" TEXT NOT NULL,
  "numero" INTEGER NOT NULL,
  "operador_id" TEXT NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'ABERTO',
  "valor_abertura" DECIMAL(12,2) NOT NULL,
  "valor_fechamento" DECIMAL(12,2),
  "valor_sistema" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "diferenca" DECIMAL(12,2),
  "aberto_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "fechado_em" TIMESTAMP(3),
  "observacao" TEXT,
  CONSTRAINT "caixa_pdv_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "caixa_pdv_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id")
);

CREATE TABLE IF NOT EXISTS "movimentacao_caixa" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "caixa_id" TEXT NOT NULL,
  "tipo" VARCHAR(20) NOT NULL,
  "valor" DECIMAL(12,2) NOT NULL,
  "motivo" VARCHAR(200) NOT NULL,
  "operador_id" TEXT NOT NULL,
  "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "movimentacao_caixa_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "movimentacao_caixa_caixa_id_fkey" FOREIGN KEY ("caixa_id") REFERENCES "caixa_pdv"("id")
);

CREATE TABLE IF NOT EXISTS "venda_pdv" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "empresa_id" TEXT NOT NULL,
  "caixa_id" TEXT NOT NULL,
  "numero" INTEGER NOT NULL,
  "cliente_id" TEXT,
  "cpf_cnpj_consumidor" VARCHAR(14),
  "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "desconto" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "acrescimo" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "valor_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "status" VARCHAR(20) NOT NULL DEFAULT 'EM_ANDAMENTO',
  "nfce_chave" VARCHAR(44),
  "nfce_numero" INTEGER,
  "troco" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finalizada_em" TIMESTAMP(3),
  CONSTRAINT "venda_pdv_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "venda_pdv_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id"),
  CONSTRAINT "venda_pdv_caixa_id_fkey" FOREIGN KEY ("caixa_id") REFERENCES "caixa_pdv"("id"),
  CONSTRAINT "venda_pdv_empresa_id_numero_key" UNIQUE ("empresa_id", "numero")
);

CREATE TABLE IF NOT EXISTS "item_venda_pdv" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "venda_pdv_id" TEXT NOT NULL,
  "produto_id" TEXT NOT NULL,
  "quantidade" DECIMAL(12,4) NOT NULL,
  "preco_unitario" DECIMAL(12,4) NOT NULL,
  "desconto" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "valor_total" DECIMAL(12,2) NOT NULL,
  "cancelado" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "item_venda_pdv_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "item_venda_pdv_venda_pdv_id_fkey" FOREIGN KEY ("venda_pdv_id") REFERENCES "venda_pdv"("id") ON DELETE CASCADE,
  CONSTRAINT "item_venda_pdv_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produto"("id")
);

CREATE TABLE IF NOT EXISTS "pagamento_pdv" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "venda_pdv_id" TEXT NOT NULL,
  "forma" VARCHAR(20) NOT NULL,
  "valor" DECIMAL(12,2) NOT NULL,
  "bandeira" VARCHAR(30),
  "nsu" VARCHAR(20),
  "autorizacao" VARCHAR(20),
  CONSTRAINT "pagamento_pdv_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pagamento_pdv_venda_pdv_id_fkey" FOREIGN KEY ("venda_pdv_id") REFERENCES "venda_pdv"("id") ON DELETE CASCADE
);
