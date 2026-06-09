-- CreateTable
CREATE TABLE "portal_usuario" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "nome" VARCHAR(150) NOT NULL,
    "email" VARCHAR(200) NOT NULL,
    "senha_hash" TEXT NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'ATIVO',
    "ultimo_acesso" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portal_usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solicitacao_expedicao_portal" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "portal_usuario_id" TEXT NOT NULL,
    "numero" VARCHAR(20) NOT NULL,
    "observacao" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "solicitacao_expedicao_portal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_solicitacao_expedicao_portal" (
    "id" TEXT NOT NULL,
    "solicitacao_id" TEXT NOT NULL,
    "produto_id" TEXT NOT NULL,
    "quantidade" DECIMAL(12,4) NOT NULL,
    "quantidade_atendida" DECIMAL(12,4),

    CONSTRAINT "item_solicitacao_expedicao_portal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notificacao_portal" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "portal_usuario_id" TEXT,
    "tipo" VARCHAR(30) NOT NULL,
    "titulo" VARCHAR(200) NOT NULL,
    "mensagem" TEXT NOT NULL,
    "lida" BOOLEAN NOT NULL DEFAULT false,
    "enviada_email" BOOLEAN NOT NULL DEFAULT false,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notificacao_portal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "portal_usuario_empresa_id_email_key" ON "portal_usuario"("empresa_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "solicitacao_expedicao_portal_empresa_id_numero_key" ON "solicitacao_expedicao_portal"("empresa_id", "numero");

-- CreateIndex
CREATE INDEX "notificacao_portal_empresa_id_cliente_id_lida_idx" ON "notificacao_portal"("empresa_id", "cliente_id", "lida");

-- AddForeignKey
ALTER TABLE "solicitacao_expedicao_portal" ADD CONSTRAINT "solicitacao_expedicao_portal_portal_usuario_id_fkey" FOREIGN KEY ("portal_usuario_id") REFERENCES "portal_usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_solicitacao_expedicao_portal" ADD CONSTRAINT "item_solicitacao_expedicao_portal_solicitacao_id_fkey" FOREIGN KEY ("solicitacao_id") REFERENCES "solicitacao_expedicao_portal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacao_portal" ADD CONSTRAINT "notificacao_portal_portal_usuario_id_fkey" FOREIGN KEY ("portal_usuario_id") REFERENCES "portal_usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
