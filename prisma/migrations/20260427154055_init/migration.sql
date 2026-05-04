-- CreateTable
CREATE TABLE "centro_distribuicao" (
    "id" TEXT NOT NULL,
    "codigo" SERIAL NOT NULL,
    "descricao" VARCHAR(100) NOT NULL,
    "status" BOOLEAN NOT NULL DEFAULT true,
    "logradouro" VARCHAR(200),
    "numero" VARCHAR(20),
    "complemento" VARCHAR(100),
    "bairro" VARCHAR(100),
    "cidade" VARCHAR(100),
    "uf" VARCHAR(2),
    "cep" VARCHAR(10),
    "telefone" VARCHAR(20),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "usuario" VARCHAR(50),

    CONSTRAINT "centro_distribuicao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deposito" (
    "id" TEXT NOT NULL,
    "codigo" SERIAL NOT NULL,
    "descricao" VARCHAR(100) NOT NULL,
    "status" BOOLEAN NOT NULL DEFAULT true,
    "logradouro" VARCHAR(200),
    "numero" VARCHAR(20),
    "complemento" VARCHAR(100),
    "bairro" VARCHAR(100),
    "cidade" VARCHAR(100),
    "uf" VARCHAR(2),
    "cep" VARCHAR(10),
    "telefone1" VARCHAR(20),
    "telefone2" VARCHAR(20),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "usuario" VARCHAR(50),
    "centro_distribuicao_id" TEXT NOT NULL,

    CONSTRAINT "deposito_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zona" (
    "id" TEXT NOT NULL,
    "codigo" SERIAL NOT NULL,
    "descricao" VARCHAR(100) NOT NULL,
    "status" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "usuario" VARCHAR(50),

    CONSTRAINT "zona_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estrutura" (
    "id" TEXT NOT NULL,
    "codigo" SERIAL NOT NULL,
    "descricao" VARCHAR(100) NOT NULL,
    "tipo" VARCHAR(50) NOT NULL,
    "status" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "usuario" VARCHAR(50),

    CONSTRAINT "estrutura_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forma_armazenagem" (
    "id" TEXT NOT NULL,
    "codigo" SERIAL NOT NULL,
    "descricao" VARCHAR(100) NOT NULL,
    "status" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "forma_armazenagem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ambiente_armazenagem" (
    "id" TEXT NOT NULL,
    "codigo" SERIAL NOT NULL,
    "descricao" VARCHAR(100) NOT NULL,
    "temperatura" VARCHAR(50),
    "status" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ambiente_armazenagem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classificacao_produto" (
    "id" TEXT NOT NULL,
    "codigo" SERIAL NOT NULL,
    "descricao" VARCHAR(100) NOT NULL,
    "status" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "classificacao_produto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "endereco" (
    "id" TEXT NOT NULL,
    "codigo" SERIAL NOT NULL,
    "codigoDeposito" VARCHAR(5) NOT NULL,
    "codigoZona" VARCHAR(5) NOT NULL,
    "codigoRua" VARCHAR(5) NOT NULL,
    "codigoPredio" VARCHAR(5) NOT NULL,
    "codigoNivel" VARCHAR(5) NOT NULL,
    "codigoApto" VARCHAR(5) NOT NULL,
    "enderecoCompleto" VARCHAR(50) NOT NULL,
    "tipo" VARCHAR(30) NOT NULL DEFAULT 'ARMAZENAGEM',
    "estado" VARCHAR(20) NOT NULL DEFAULT 'LIVRE',
    "status" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "usuario" VARCHAR(50),
    "centro_distribuicao_id" TEXT NOT NULL,
    "deposito_id" TEXT NOT NULL,
    "zona_id" TEXT,
    "estrutura_id" TEXT,
    "forma_armazenagem_id" TEXT,
    "ambiente_armazenagem_id" TEXT,
    "classificacao_produto_id" TEXT,

    CONSTRAINT "endereco_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "produto" (
    "id" TEXT NOT NULL,
    "codigo" SERIAL NOT NULL,
    "descricao" VARCHAR(200) NOT NULL,
    "codigoBarra" VARCHAR(50),
    "unidade" VARCHAR(10) NOT NULL,
    "validade" INTEGER DEFAULT 0,
    "vidaUtilPerc" DOUBLE PRECISION DEFAULT 0,
    "saldoMin" DOUBLE PRECISION DEFAULT 0,
    "saldoMax" DOUBLE PRECISION DEFAULT 0,
    "curvaAbc" VARCHAR(1),
    "status" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "usuario" VARCHAR(50),
    "centro_distribuicao_id" TEXT NOT NULL,
    "classificacao_produto_id" TEXT,

    CONSTRAINT "produto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sku" (
    "id" TEXT NOT NULL,
    "sequencia" INTEGER NOT NULL,
    "descricao" VARCHAR(100),
    "codigoBarra" VARCHAR(50),
    "unidade" VARCHAR(10) NOT NULL,
    "qtdEmbalagem" INTEGER NOT NULL DEFAULT 1,
    "largura" DOUBLE PRECISION DEFAULT 0,
    "altura" DOUBLE PRECISION DEFAULT 0,
    "comprimento" DOUBLE PRECISION DEFAULT 0,
    "volume" DOUBLE PRECISION DEFAULT 0,
    "pesoLiquido" DOUBLE PRECISION DEFAULT 0,
    "pesoBruto" DOUBLE PRECISION DEFAULT 0,
    "pesoPalete" DOUBLE PRECISION DEFAULT 0,
    "lastro" INTEGER DEFAULT 0,
    "camada" INTEGER DEFAULT 0,
    "tipoPalete" VARCHAR(50),
    "status" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "produto_id" TEXT NOT NULL,

    CONSTRAINT "sku_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dados_logisticos" (
    "id" TEXT NOT NULL,
    "enderecoArmazenagem" VARCHAR(50),
    "qtdMaxArmazenagem" DOUBLE PRECISION DEFAULT 0,
    "qtdMinArmazenagem" DOUBLE PRECISION DEFAULT 0,
    "enderecoPicking" VARCHAR(50),
    "qtdMaxPicking" DOUBLE PRECISION DEFAULT 0,
    "qtdMinPicking" DOUBLE PRECISION DEFAULT 0,
    "pontoReposicao" DOUBLE PRECISION DEFAULT 0,
    "sequenciaExpedicao" INTEGER DEFAULT 0,
    "leadTime" INTEGER DEFAULT 0,
    "loteMinimo" DOUBLE PRECISION DEFAULT 0,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "produto_id" TEXT NOT NULL,

    CONSTRAINT "dados_logisticos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funcao" (
    "id" TEXT NOT NULL,
    "codigo" SERIAL NOT NULL,
    "descricao" VARCHAR(100) NOT NULL,
    "status" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funcao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funcionario" (
    "id" TEXT NOT NULL,
    "codigo" SERIAL NOT NULL,
    "nome" VARCHAR(150) NOT NULL,
    "matricula" VARCHAR(30),
    "tipo" VARCHAR(30) NOT NULL,
    "situacao" VARCHAR(20) NOT NULL DEFAULT 'ATIVO',
    "presente" BOOLEAN NOT NULL DEFAULT false,
    "status" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "usuario" VARCHAR(50),
    "centro_distribuicao_id" TEXT NOT NULL,

    CONSTRAINT "funcionario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funcionario_funcao" (
    "funcionario_id" TEXT NOT NULL,
    "funcao_id" TEXT NOT NULL,

    CONSTRAINT "funcionario_funcao_pkey" PRIMARY KEY ("funcionario_id","funcao_id")
);

-- CreateTable
CREATE TABLE "equipamento_movimentacao" (
    "id" TEXT NOT NULL,
    "codigo" SERIAL NOT NULL,
    "descricao" VARCHAR(100) NOT NULL,
    "tipo" VARCHAR(50) NOT NULL,
    "patrimonio" VARCHAR(30),
    "status" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equipamento_movimentacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tipo_carroceria" (
    "id" TEXT NOT NULL,
    "codigo" SERIAL NOT NULL,
    "descricao" VARCHAR(100) NOT NULL,
    "status" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tipo_carroceria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tipo_carga" (
    "id" TEXT NOT NULL,
    "codigo" SERIAL NOT NULL,
    "descricao" VARCHAR(100) NOT NULL,
    "status" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tipo_carga_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "veiculo" (
    "id" TEXT NOT NULL,
    "codigo" SERIAL NOT NULL,
    "descricao" VARCHAR(100) NOT NULL,
    "placa" VARCHAR(10) NOT NULL,
    "marca" VARCHAR(50),
    "modelo" VARCHAR(50),
    "ano" INTEGER,
    "status" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "tipo_carroceria_id" TEXT,

    CONSTRAINT "veiculo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doca" (
    "id" TEXT NOT NULL,
    "codigo" SERIAL NOT NULL,
    "descricao" VARCHAR(100) NOT NULL,
    "tipo" VARCHAR(30) NOT NULL,
    "estado" VARCHAR(20) NOT NULL DEFAULT 'LIVRE',
    "comprimentoMax" DOUBLE PRECISION DEFAULT 0,
    "status" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "centro_distribuicao_id" TEXT NOT NULL,
    "deposito_id" TEXT NOT NULL,

    CONSTRAINT "doca_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registro_veiculo" (
    "id" TEXT NOT NULL,
    "data_entrada" TIMESTAMP(3) NOT NULL,
    "data_saida" TIMESTAMP(3),
    "motorista" VARCHAR(150),
    "docMotorista" VARCHAR(20),
    "observacao" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PATIO',
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "usuario" VARCHAR(50),
    "veiculo_id" TEXT NOT NULL,

    CONSTRAINT "registro_veiculo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agenda_recebimento" (
    "id" TEXT NOT NULL,
    "data_inicio" TIMESTAMP(3) NOT NULL,
    "horaInicio" VARCHAR(5) NOT NULL,
    "data_fim" TIMESTAMP(3) NOT NULL,
    "horaFim" VARCHAR(5) NOT NULL,
    "fornecedor" VARCHAR(200),
    "fornecedorDoc" VARCHAR(20),
    "qtdPaletes" INTEGER DEFAULT 0,
    "qtdCaixas" INTEGER DEFAULT 0,
    "qtdRhPalete" INTEGER DEFAULT 0,
    "qtdRhCaixa" INTEGER DEFAULT 0,
    "status" VARCHAR(20) NOT NULL DEFAULT 'AGENDADO',
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "usuario" VARCHAR(50),
    "centro_distribuicao_id" TEXT NOT NULL,
    "doca_id" TEXT NOT NULL,

    CONSTRAINT "agenda_recebimento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nota_entrada" (
    "id" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "serie" VARCHAR(5),
    "documento" VARCHAR(50),
    "fornecedor" VARCHAR(200),
    "fornecedorDoc" VARCHAR(20),
    "transportadora" VARCHAR(200),
    "data_emissao" TIMESTAMP(3),
    "data_entrada" TIMESTAMP(3),
    "tipo" VARCHAR(30) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "usuario" VARCHAR(50),

    CONSTRAINT "nota_entrada_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_nota_entrada" (
    "id" TEXT NOT NULL,
    "item" INTEGER NOT NULL,
    "descricao" VARCHAR(200) NOT NULL,
    "codigoProduto" VARCHAR(30),
    "unidade" VARCHAR(10) NOT NULL,
    "quantidade" DOUBLE PRECISION NOT NULL,
    "lote" VARCHAR(30),
    "validade" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "nota_entrada_id" TEXT NOT NULL,

    CONSTRAINT "item_nota_entrada_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conferencia" (
    "id" TEXT NOT NULL,
    "codigo" SERIAL NOT NULL,
    "tipo" VARCHAR(30) NOT NULL,
    "data_inicio" TIMESTAMP(3) NOT NULL,
    "horaInicio" VARCHAR(5) NOT NULL,
    "data_fim" TIMESTAMP(3),
    "horaFim" VARCHAR(5),
    "status" VARCHAR(20) NOT NULL DEFAULT 'EM_ANDAMENTO',
    "observacao" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "usuario" VARCHAR(50),
    "nota_entrada_id" TEXT NOT NULL,
    "conferente_id" TEXT NOT NULL,

    CONSTRAINT "conferencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_conferencia" (
    "id" TEXT NOT NULL,
    "item" INTEGER NOT NULL,
    "quantidade" DOUBLE PRECISION NOT NULL,
    "lote" VARCHAR(30),
    "validade" TIMESTAMP(3),
    "divergencia" DOUBLE PRECISION DEFAULT 0,
    "observacao" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "conferencia_id" TEXT NOT NULL,
    "produto_id" TEXT NOT NULL,

    CONSTRAINT "item_conferencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ordem_servico" (
    "id" TEXT NOT NULL,
    "numero" SERIAL NOT NULL,
    "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hora" VARCHAR(5) NOT NULL,
    "tipo" VARCHAR(30) NOT NULL,
    "tipo_operacao" VARCHAR(30) NOT NULL,
    "tipo_movimento" VARCHAR(20),
    "status" VARCHAR(20) NOT NULL DEFAULT 'ABERTO',
    "num_documento" VARCHAR(30),
    "observacao" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "usuario" VARCHAR(50),
    "centro_distribuicao_id" TEXT NOT NULL,

    CONSTRAINT "ordem_servico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "os_funcionario" (
    "id" TEXT NOT NULL,
    "data_inicio" TIMESTAMP(3),
    "data_fim" TIMESTAMP(3),
    "status" VARCHAR(20) NOT NULL DEFAULT 'ATRIBUIDO',
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ordem_servico_id" TEXT NOT NULL,
    "funcionario_id" TEXT NOT NULL,

    CONSTRAINT "os_funcionario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimento" (
    "id" TEXT NOT NULL,
    "item" INTEGER NOT NULL,
    "quantidade" DOUBLE PRECISION NOT NULL,
    "lote" VARCHAR(30),
    "validade" TIMESTAMP(3),
    "saldo_origem_antes" DOUBLE PRECISION DEFAULT 0,
    "saldo_origem_depois" DOUBLE PRECISION DEFAULT 0,
    "saldo_destino_antes" DOUBLE PRECISION DEFAULT 0,
    "saldo_destino_depois" DOUBLE PRECISION DEFAULT 0,
    "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hora" VARCHAR(5) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
    "enderecado" BOOLEAN NOT NULL DEFAULT false,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "ordem_servico_id" TEXT NOT NULL,
    "produto_id" TEXT NOT NULL,
    "sku_id" TEXT,
    "origem_id" TEXT,
    "destino_id" TEXT,
    "funcionario_id" TEXT,

    CONSTRAINT "movimento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saldo_endereco" (
    "id" TEXT NOT NULL,
    "quantidade" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lote" VARCHAR(30),
    "validade" TIMESTAMP(3),
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "endereco_id" TEXT NOT NULL,
    "produto_id" TEXT NOT NULL,

    CONSTRAINT "saldo_endereco_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_ordem_servico" (
    "id" TEXT NOT NULL,
    "acao" VARCHAR(100) NOT NULL,
    "descricao" TEXT,
    "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuario" VARCHAR(50),
    "ordem_servico_id" TEXT NOT NULL,

    CONSTRAINT "log_ordem_servico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mapa_carregamento" (
    "id" TEXT NOT NULL,
    "numero" SERIAL NOT NULL,
    "data_emissao" TIMESTAMP(3) NOT NULL,
    "data_fechamento" TIMESTAMP(3),
    "placa" VARCHAR(10),
    "motorista" VARCHAR(150),
    "status" VARCHAR(20) NOT NULL DEFAULT 'ABERTO',
    "km_saida" DOUBLE PRECISION DEFAULT 0,
    "km_chegada" DOUBLE PRECISION DEFAULT 0,
    "observacao" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "usuario" VARCHAR(50),

    CONSTRAINT "mapa_carregamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parametro" (
    "id" TEXT NOT NULL,
    "nome" VARCHAR(100) NOT NULL,
    "valor" VARCHAR(500),
    "valor_default" VARCHAR(500),
    "descricao" VARCHAR(200),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "centro_distribuicao_id" TEXT NOT NULL,

    CONSTRAINT "parametro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuario" (
    "id" TEXT NOT NULL,
    "nome" VARCHAR(150) NOT NULL,
    "email" VARCHAR(200) NOT NULL,
    "senha" VARCHAR(200) NOT NULL,
    "perfil" VARCHAR(30) NOT NULL DEFAULT 'OPERADOR',
    "status" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usuario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "centro_distribuicao_codigo_key" ON "centro_distribuicao"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "deposito_centro_distribuicao_id_codigo_key" ON "deposito"("centro_distribuicao_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "estrutura_codigo_key" ON "estrutura"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "forma_armazenagem_codigo_key" ON "forma_armazenagem"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "ambiente_armazenagem_codigo_key" ON "ambiente_armazenagem"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "classificacao_produto_codigo_key" ON "classificacao_produto"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "endereco_centro_distribuicao_id_enderecoCompleto_key" ON "endereco"("centro_distribuicao_id", "enderecoCompleto");

-- CreateIndex
CREATE UNIQUE INDEX "produto_centro_distribuicao_id_codigo_key" ON "produto"("centro_distribuicao_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "sku_produto_id_sequencia_key" ON "sku"("produto_id", "sequencia");

-- CreateIndex
CREATE UNIQUE INDEX "dados_logisticos_produto_id_key" ON "dados_logisticos"("produto_id");

-- CreateIndex
CREATE UNIQUE INDEX "funcao_codigo_key" ON "funcao"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "funcionario_centro_distribuicao_id_codigo_key" ON "funcionario"("centro_distribuicao_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "equipamento_movimentacao_codigo_key" ON "equipamento_movimentacao"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "tipo_carroceria_codigo_key" ON "tipo_carroceria"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "tipo_carga_codigo_key" ON "tipo_carga"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "veiculo_codigo_key" ON "veiculo"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "doca_centro_distribuicao_id_codigo_key" ON "doca"("centro_distribuicao_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "item_nota_entrada_nota_entrada_id_item_key" ON "item_nota_entrada"("nota_entrada_id", "item");

-- CreateIndex
CREATE UNIQUE INDEX "item_conferencia_conferencia_id_item_key" ON "item_conferencia"("conferencia_id", "item");

-- CreateIndex
CREATE UNIQUE INDEX "movimento_ordem_servico_id_item_key" ON "movimento"("ordem_servico_id", "item");

-- CreateIndex
CREATE UNIQUE INDEX "saldo_endereco_endereco_id_produto_id_lote_key" ON "saldo_endereco"("endereco_id", "produto_id", "lote");

-- CreateIndex
CREATE UNIQUE INDEX "parametro_centro_distribuicao_id_nome_key" ON "parametro"("centro_distribuicao_id", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "usuario_email_key" ON "usuario"("email");

-- AddForeignKey
ALTER TABLE "deposito" ADD CONSTRAINT "deposito_centro_distribuicao_id_fkey" FOREIGN KEY ("centro_distribuicao_id") REFERENCES "centro_distribuicao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "endereco" ADD CONSTRAINT "endereco_centro_distribuicao_id_fkey" FOREIGN KEY ("centro_distribuicao_id") REFERENCES "centro_distribuicao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "endereco" ADD CONSTRAINT "endereco_deposito_id_fkey" FOREIGN KEY ("deposito_id") REFERENCES "deposito"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "endereco" ADD CONSTRAINT "endereco_zona_id_fkey" FOREIGN KEY ("zona_id") REFERENCES "zona"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "endereco" ADD CONSTRAINT "endereco_estrutura_id_fkey" FOREIGN KEY ("estrutura_id") REFERENCES "estrutura"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "endereco" ADD CONSTRAINT "endereco_forma_armazenagem_id_fkey" FOREIGN KEY ("forma_armazenagem_id") REFERENCES "forma_armazenagem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "endereco" ADD CONSTRAINT "endereco_ambiente_armazenagem_id_fkey" FOREIGN KEY ("ambiente_armazenagem_id") REFERENCES "ambiente_armazenagem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "endereco" ADD CONSTRAINT "endereco_classificacao_produto_id_fkey" FOREIGN KEY ("classificacao_produto_id") REFERENCES "classificacao_produto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produto" ADD CONSTRAINT "produto_centro_distribuicao_id_fkey" FOREIGN KEY ("centro_distribuicao_id") REFERENCES "centro_distribuicao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produto" ADD CONSTRAINT "produto_classificacao_produto_id_fkey" FOREIGN KEY ("classificacao_produto_id") REFERENCES "classificacao_produto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sku" ADD CONSTRAINT "sku_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dados_logisticos" ADD CONSTRAINT "dados_logisticos_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funcionario" ADD CONSTRAINT "funcionario_centro_distribuicao_id_fkey" FOREIGN KEY ("centro_distribuicao_id") REFERENCES "centro_distribuicao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funcionario_funcao" ADD CONSTRAINT "funcionario_funcao_funcionario_id_fkey" FOREIGN KEY ("funcionario_id") REFERENCES "funcionario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funcionario_funcao" ADD CONSTRAINT "funcionario_funcao_funcao_id_fkey" FOREIGN KEY ("funcao_id") REFERENCES "funcao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "veiculo" ADD CONSTRAINT "veiculo_tipo_carroceria_id_fkey" FOREIGN KEY ("tipo_carroceria_id") REFERENCES "tipo_carroceria"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doca" ADD CONSTRAINT "doca_centro_distribuicao_id_fkey" FOREIGN KEY ("centro_distribuicao_id") REFERENCES "centro_distribuicao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doca" ADD CONSTRAINT "doca_deposito_id_fkey" FOREIGN KEY ("deposito_id") REFERENCES "deposito"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registro_veiculo" ADD CONSTRAINT "registro_veiculo_veiculo_id_fkey" FOREIGN KEY ("veiculo_id") REFERENCES "veiculo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agenda_recebimento" ADD CONSTRAINT "agenda_recebimento_centro_distribuicao_id_fkey" FOREIGN KEY ("centro_distribuicao_id") REFERENCES "centro_distribuicao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agenda_recebimento" ADD CONSTRAINT "agenda_recebimento_doca_id_fkey" FOREIGN KEY ("doca_id") REFERENCES "doca"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_nota_entrada" ADD CONSTRAINT "item_nota_entrada_nota_entrada_id_fkey" FOREIGN KEY ("nota_entrada_id") REFERENCES "nota_entrada"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conferencia" ADD CONSTRAINT "conferencia_nota_entrada_id_fkey" FOREIGN KEY ("nota_entrada_id") REFERENCES "nota_entrada"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conferencia" ADD CONSTRAINT "conferencia_conferente_id_fkey" FOREIGN KEY ("conferente_id") REFERENCES "funcionario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_conferencia" ADD CONSTRAINT "item_conferencia_conferencia_id_fkey" FOREIGN KEY ("conferencia_id") REFERENCES "conferencia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_conferencia" ADD CONSTRAINT "item_conferencia_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordem_servico" ADD CONSTRAINT "ordem_servico_centro_distribuicao_id_fkey" FOREIGN KEY ("centro_distribuicao_id") REFERENCES "centro_distribuicao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "os_funcionario" ADD CONSTRAINT "os_funcionario_ordem_servico_id_fkey" FOREIGN KEY ("ordem_servico_id") REFERENCES "ordem_servico"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "os_funcionario" ADD CONSTRAINT "os_funcionario_funcionario_id_fkey" FOREIGN KEY ("funcionario_id") REFERENCES "funcionario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimento" ADD CONSTRAINT "movimento_ordem_servico_id_fkey" FOREIGN KEY ("ordem_servico_id") REFERENCES "ordem_servico"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimento" ADD CONSTRAINT "movimento_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimento" ADD CONSTRAINT "movimento_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "sku"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimento" ADD CONSTRAINT "movimento_origem_id_fkey" FOREIGN KEY ("origem_id") REFERENCES "endereco"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimento" ADD CONSTRAINT "movimento_destino_id_fkey" FOREIGN KEY ("destino_id") REFERENCES "endereco"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimento" ADD CONSTRAINT "movimento_funcionario_id_fkey" FOREIGN KEY ("funcionario_id") REFERENCES "funcionario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saldo_endereco" ADD CONSTRAINT "saldo_endereco_endereco_id_fkey" FOREIGN KEY ("endereco_id") REFERENCES "endereco"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saldo_endereco" ADD CONSTRAINT "saldo_endereco_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_ordem_servico" ADD CONSTRAINT "log_ordem_servico_ordem_servico_id_fkey" FOREIGN KEY ("ordem_servico_id") REFERENCES "ordem_servico"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parametro" ADD CONSTRAINT "parametro_centro_distribuicao_id_fkey" FOREIGN KEY ("centro_distribuicao_id") REFERENCES "centro_distribuicao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
