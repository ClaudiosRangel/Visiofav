import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🔄 Applying production migrations...')

  // Usuario table - senha_alterada flag
  await prisma.$executeRawUnsafe(`ALTER TABLE "usuario" ADD COLUMN IF NOT EXISTS "senha_alterada" BOOLEAN DEFAULT false`)

  // Endereco table - new columns
  await prisma.$executeRawUnsafe(`ALTER TABLE "endereco" ADD COLUMN IF NOT EXISTS "codigo_barras" VARCHAR(30)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "endereco" ADD COLUMN IF NOT EXISTS "area_armazenagem" VARCHAR(20)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "endereco" ADD COLUMN IF NOT EXISTS "forma_armazenagem_id" TEXT`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "endereco" ADD COLUMN IF NOT EXISTS "ambiente_armazenagem_id" TEXT`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "endereco" ADD COLUMN IF NOT EXISTS "classificacao_produto_id" TEXT`)

  // Estrutura table - capacity fields
  await prisma.$executeRawUnsafe(`ALTER TABLE "estrutura" ADD COLUMN IF NOT EXISTS "capacidade" DECIMAL(10,3)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "estrutura" ADD COLUMN IF NOT EXISTS "largura" DECIMAL(10,3)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "estrutura" ADD COLUMN IF NOT EXISTS "altura" DECIMAL(10,3)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "estrutura" ADD COLUMN IF NOT EXISTS "comprimento" DECIMAL(10,3)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "estrutura" ADD COLUMN IF NOT EXISTS "cubagem" DECIMAL(10,6)`)

  // Doca table - codigo column
  await prisma.$executeRawUnsafe(`ALTER TABLE "doca" ADD COLUMN IF NOT EXISTS "codigo" SERIAL`)

  // Equipamento table - codigo column
  await prisma.$executeRawUnsafe(`ALTER TABLE "equipamento_movimentacao" ADD COLUMN IF NOT EXISTS "codigo" SERIAL`)

  // Funcionario table - codigo column
  await prisma.$executeRawUnsafe(`ALTER TABLE "funcionario" ADD COLUMN IF NOT EXISTS "codigo" SERIAL`)

  // Funcionario table - usuario_id column (direct link to usuario)
  await prisma.$executeRawUnsafe(`ALTER TABLE "funcionario" ADD COLUMN IF NOT EXISTS "usuario_id" TEXT`)

  // Estrutura table - codigo column
  await prisma.$executeRawUnsafe(`ALTER TABLE "estrutura" ADD COLUMN IF NOT EXISTS "codigo" SERIAL`)

  // Multi-tenant: Add empresa_id to WMS tables
  const tenantTables = [
    'deposito', 'zona', 'estrutura', 'endereco', 'funcionario', 'doca',
    'equipamento_movimentacao', 'funcao', 'forma_armazenagem',
    'ambiente_armazenagem', 'classificacao_produto', 'tipo_carroceria',
    'tipo_carga', 'veiculo_wms', 'nota_entrada', 'saldo_endereco', 'sku',
  ]

  for (const table of tenantTables) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "empresa_id" TEXT`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_${table}_empresa_id" ON "${table}"("empresa_id")`)
  }
  console.log('✅ Multi-tenant: empresa_id columns and indexes added')

  // Multi-tenant: Backfill empresa_id with default empresa
  const defaultEmpresa = await prisma.empresa.findFirst({ select: { id: true } })
  if (defaultEmpresa) {
    for (const table of tenantTables) {
      await prisma.$executeRawUnsafe(
        `UPDATE "${table}" SET "empresa_id" = '${defaultEmpresa.id}' WHERE "empresa_id" IS NULL`
      )
    }
    console.log('✅ Multi-tenant: backfill complete with empresa', defaultEmpresa.id)
  }

  // Pendencia Logistica table (SKU / Dados Logísticos validation)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "pendencia_logistica" (
      "id" TEXT NOT NULL,
      "empresa_id" TEXT NOT NULL,
      "nota_entrada_id" TEXT NOT NULL,
      "item_nota_entrada_id" TEXT,
      "codigo_produto" VARCHAR(60),
      "descricao_produto" VARCHAR(200),
      "fornecedor" VARCHAR(200),
      "fornecedor_doc" VARCHAR(20),
      "tipo" VARCHAR(30) NOT NULL,
      "status" VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
      "resolvido_por_id" TEXT,
      "resolvido_em" TIMESTAMP(3),
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "pendencia_logistica_pkey" PRIMARY KEY ("id")
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "pendencia_logistica_empresa_id_status_idx" ON "pendencia_logistica"("empresa_id", "status")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "pendencia_logistica_nota_entrada_id_idx" ON "pendencia_logistica"("nota_entrada_id")`)
  console.log('✅ Pendencia Logistica table created')

  // ItemPedidoVenda - add unidade and desconto columns
  await prisma.$executeRawUnsafe(`ALTER TABLE "item_pedido_venda" ADD COLUMN IF NOT EXISTS "unidade" VARCHAR(6) DEFAULT 'UN'`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "item_pedido_venda" ADD COLUMN IF NOT EXISTS "desconto" DECIMAL(5,2) DEFAULT 0`)
  console.log('✅ ItemPedidoVenda: unidade and desconto columns added')

  // Limpar OS órfãs de ondas canceladas
  try {
    const osCanceladas = await prisma.$executeRawUnsafe(`
      UPDATE "ordem_servico_wms" 
      SET "status" = 'REJEITADO', "hora_fim" = NOW(), "observacao" = 'Onda cancelada - limpeza automática'
      WHERE "operacao" = 'SEPARACAO' 
        AND "status" IN ('ABERTO', 'EXECUTANDO')
        AND "onda_separacao_id" IN (
          SELECT "id" FROM "onda_separacao" WHERE "status" = 'CANCELADA'
        )
    `)
    console.log('✅ OS órfãs de ondas canceladas limpas:', osCanceladas)
  } catch (e: any) {
    console.log('⚠️ Limpeza OS órfãs skipped:', e.message)
  }

  // Corrigir tipo das colunas XML na tabela nfe (VARCHAR → TEXT)
  await prisma.$executeRawUnsafe(`ALTER TABLE "nfe" ALTER COLUMN "xml_enviado" TYPE TEXT`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "nfe" ALTER COLUMN "xml_retorno" TYPE TEXT`)
  console.log('✅ Colunas XML da NF-e alteradas para TEXT')

  // Tabelas de Roteirização e Montagem de Carga
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "rota" (
      "id" TEXT NOT NULL,
      "empresa_id" TEXT NOT NULL,
      "codigo" VARCHAR(20) NOT NULL,
      "descricao" VARCHAR(200) NOT NULL,
      "transportadora_id" TEXT,
      "status" BOOLEAN NOT NULL DEFAULT true,
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "rota_pkey" PRIMARY KEY ("id")
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "rota_empresa_id_codigo_key" ON "rota"("empresa_id", "codigo")`)

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "mapa_carregamento" (
      "id" TEXT NOT NULL,
      "empresa_id" TEXT NOT NULL,
      "numero" INTEGER NOT NULL,
      "rota_id" TEXT,
      "veiculo_placa" VARCHAR(10) NOT NULL,
      "motorista" VARCHAR(200),
      "motorista_cpf" VARCHAR(14),
      "observacoes" TEXT,
      "status" VARCHAR(30) NOT NULL DEFAULT 'AGUARDANDO_SEPARACAO',
      "motivo_cancelamento" TEXT,
      "criado_por_id" TEXT NOT NULL,
      "cancelado_por_id" TEXT,
      "fechado_por_id" TEXT,
      "emissao_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "finalizado_em" TIMESTAMP(3),
      "cancelado_em" TIMESTAMP(3),
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "mapa_carregamento_pkey" PRIMARY KEY ("id")
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "mapa_carregamento_empresa_id_numero_key" ON "mapa_carregamento"("empresa_id", "numero")`)

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "mapa_carregamento_nf" (
      "id" TEXT NOT NULL,
      "mapa_carregamento_id" TEXT NOT NULL,
      "nfe_id" TEXT NOT NULL,
      "status_entrega" VARCHAR(20),
      "motivo_devolucao" TEXT,
      CONSTRAINT "mapa_carregamento_nf_pkey" PRIMARY KEY ("id")
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "mapa_carregamento_nf_mapa_carregamento_id_nfe_id_key" ON "mapa_carregamento_nf"("mapa_carregamento_id", "nfe_id")`)

  // Campos novos em tabelas existentes
  await prisma.$executeRawUnsafe(`ALTER TABLE "cliente" ADD COLUMN IF NOT EXISTS "rota_id" TEXT`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "pedido_venda" ADD COLUMN IF NOT EXISTS "rota_id" TEXT`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "carregamento" ADD COLUMN IF NOT EXISTS "motorista" VARCHAR(200)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "carregamento" ADD COLUMN IF NOT EXISTS "motorista_cpf" VARCHAR(14)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "carregamento" ADD COLUMN IF NOT EXISTS "rota_id" TEXT`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "carregamento" ADD COLUMN IF NOT EXISTS "motivo_cancelamento" TEXT`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "carregamento" ADD COLUMN IF NOT EXISTS "cancelado_por_id" TEXT`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "carregamento" ADD COLUMN IF NOT EXISTS "cancelado_em" TIMESTAMP(3)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "carregamento" ADD COLUMN IF NOT EXISTS "em_carregamento_em" TIMESTAMP(3)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "nfe" ADD COLUMN IF NOT EXISTS "mapa_ok" BOOLEAN DEFAULT false`)
  console.log('✅ Tabelas de Roteirização e Montagem de Carga criadas')

  // Resolver pendências logísticas de produtos que já têm SKU/dados logísticos configurados
  try {
    // Resolver pendências SKU onde o produto já tem SKU
    await prisma.$executeRawUnsafe(`
      UPDATE "pendencia_logistica" SET "status" = 'RESOLVIDA', "resolvido_em" = NOW()
      WHERE "status" = 'PENDENTE' AND "tipo" = 'SKU'
      AND "codigo_produto" IN (
        SELECT p."codigo" FROM "produto" p
        INNER JOIN "sku" s ON s."produto_id" = p."id"
      )
    `)
    // Resolver pendências DADOS_LOGISTICOS onde o produto já tem dados
    await prisma.$executeRawUnsafe(`
      UPDATE "pendencia_logistica" SET "status" = 'RESOLVIDA', "resolvido_em" = NOW()
      WHERE "status" = 'PENDENTE' AND "tipo" = 'DADOS_LOGISTICOS'
      AND "codigo_produto" IN (
        SELECT p."codigo" FROM "produto" p
        INNER JOIN "dados_logisticos_armazenagem" d ON d."produto_id" = p."id"
      )
    `)
    console.log('✅ Pendências logísticas resolvidas para produtos já configurados')
  } catch (e: any) {
    console.log('⚠️ Resolução pendências skipped:', e.message)
  }

  // Atualizar senha do admin para 987123
  try {
    const bcrypt = await import('bcryptjs')
    const bcryptLib = bcrypt.default || bcrypt
    const novaSenhaHash = await bcryptLib.hash('987123', 10)
    const admin = await prisma.usuario.findUnique({ where: { email: 'admin@visiofab.com' } })
    if (admin) {
      await prisma.usuario.update({
        where: { id: admin.id },
        data: { senha: novaSenhaHash },
      })
      console.log('✅ Admin password updated')
    }
  } catch (e: any) {
    console.log('⚠️ Admin password update skipped:', e.message)
  }

  // Produto - campo imagem_url
  await prisma.$executeRawUnsafe(`ALTER TABLE "produto" ADD COLUMN IF NOT EXISTS "imagem_url" TEXT`)
  console.log('✅ Produto: campo imagem_url adicionado')

  // ItemPedidoCompra - campo unidade
  await prisma.$executeRawUnsafe(`ALTER TABLE "item_pedido_compra" ADD COLUMN IF NOT EXISTS "unidade" VARCHAR(6) DEFAULT 'UN'`)
  console.log('✅ ItemPedidoCompra: campo unidade adicionado')

  // Shelf Life Mínimo no Produto
  await prisma.$executeRawUnsafe(`ALTER TABLE "produto" ADD COLUMN IF NOT EXISTS "shelf_life_minimo" INTEGER`)
  console.log('✅ Produto: campo shelf_life_minimo adicionado')

  // Curva ABC no Produto
  await prisma.$executeRawUnsafe(`ALTER TABLE "produto" ADD COLUMN IF NOT EXISTS "curva_abc" VARCHAR(1)`)
  console.log('✅ Produto: campo curva_abc adicionado')

  // Capacidade por Nível de Estrutura
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "capacidade_nivel" (
      "id" TEXT NOT NULL,
      "empresa_id" TEXT NOT NULL,
      "estrutura_id" TEXT NOT NULL,
      "codigo_nivel" VARCHAR(10) NOT NULL,
      "peso_maximo" DECIMAL(12,3),
      "volume_maximo" DECIMAL(12,6),
      "paletes_maximo" INTEGER,
      "status" BOOLEAN NOT NULL DEFAULT true,
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "capacidade_nivel_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "capacidade_nivel_estrutura_id_codigo_nivel_key" UNIQUE ("estrutura_id", "codigo_nivel")
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_capacidade_nivel_empresa_id" ON "capacidade_nivel"("empresa_id")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_capacidade_nivel_estrutura_id" ON "capacidade_nivel"("estrutura_id")`)
  console.log('✅ Tabela capacidade_nivel criada')

  // De-Para Produto Fornecedor table
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "depara_produto_fornecedor" (
      "id" TEXT NOT NULL,
      "empresa_id" TEXT NOT NULL,
      "fornecedor_id" TEXT NOT NULL,
      "codigo_produto_fornecedor" VARCHAR(60) NOT NULL,
      "descricao_fornecedor" VARCHAR(200),
      "produto_id" TEXT NOT NULL,
      "sku_id" TEXT,
      "unidade_fornecedor" VARCHAR(6) NOT NULL,
      "fator_conversao" DECIMAL(12,4) NOT NULL DEFAULT 1,
      "c_ean" VARCHAR(14),
      "c_ean_trib" VARCHAR(14),
      "status" BOOLEAN NOT NULL DEFAULT true,
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "depara_produto_fornecedor_pkey" PRIMARY KEY ("id")
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "depara_produto_fornecedor_empresa_id_fornecedor_id_codigo_pr_key" ON "depara_produto_fornecedor"("empresa_id", "fornecedor_id", "codigo_produto_fornecedor")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "depara_produto_fornecedor_empresa_id_fornecedor_id_idx" ON "depara_produto_fornecedor"("empresa_id", "fornecedor_id")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "depara_produto_fornecedor_produto_id_idx" ON "depara_produto_fornecedor"("produto_id")`)
  console.log('✅ De-Para Produto Fornecedor table created')

  // Formato de Endereço de Armazém
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "formato_endereco" (
      "id" TEXT NOT NULL,
      "nome" VARCHAR(100) NOT NULL,
      "descricao" VARCHAR(255),
      "segmentos" JSONB NOT NULL,
      "empresa_id" TEXT,
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "status" BOOLEAN NOT NULL DEFAULT true,
      CONSTRAINT "formato_endereco_pkey" PRIMARY KEY ("id")
    )
  `)
  await prisma.$executeRawUnsafe(`ALTER TABLE "deposito" ADD COLUMN IF NOT EXISTS "formato_endereco_id" TEXT`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "zona" ADD COLUMN IF NOT EXISTS "formato_endereco_id" TEXT`)
  console.log('✅ Tabela formato_endereco criada + colunas FK em deposito/zona')

  // Seed dos formatos pré-configurados
  try {
    const formatosPreConfigurados = [
      { nome: 'Porta-palete (6 seg)', descricao: 'Formato legado completo com 6 segmentos', segmentos: [{ nome: 'Depósito', campoFisico: 'codigoDeposito', ordem: 1, numerico: true },{ nome: 'Zona', campoFisico: 'codigoZona', ordem: 2, numerico: true },{ nome: 'Rua', campoFisico: 'codigoRua', ordem: 3, numerico: true },{ nome: 'Prédio', campoFisico: 'codigoPredio', ordem: 4, numerico: true },{ nome: 'Nível', campoFisico: 'codigoNivel', ordem: 5, numerico: true },{ nome: 'Apto', campoFisico: 'codigoApto', ordem: 6, numerico: true }] },
      { nome: 'Picking de chão', descricao: 'Formato para áreas de picking com 2 segmentos', segmentos: [{ nome: 'Zona', campoFisico: 'codigoZona', ordem: 1, numerico: true },{ nome: 'Posição', campoFisico: 'codigoRua', ordem: 2, numerico: true }] },
      { nome: 'Flow rack', descricao: 'Formato para flow racks com 2 segmentos', segmentos: [{ nome: 'Corredor', campoFisico: 'codigoRua', ordem: 1, numerico: true },{ nome: 'Posição', campoFisico: 'codigoPredio', ordem: 2, numerico: true }] },
      { nome: 'Blocado', descricao: 'Formato para áreas blocadas com 3 segmentos', segmentos: [{ nome: 'Zona', campoFisico: 'codigoZona', ordem: 1, numerico: true },{ nome: 'Fileira', campoFisico: 'codigoRua', ordem: 2, numerico: true },{ nome: 'Coluna', campoFisico: 'codigoPredio', ordem: 3, numerico: true }] },
      { nome: 'Doca', descricao: 'Formato para docas com 1 segmento', segmentos: [{ nome: 'Código', campoFisico: 'codigoRua', ordem: 1, numerico: true, prefixo: 'DOCA' }] },
      { nome: 'Área de avaria', descricao: 'Formato para áreas de avaria com 1 segmento', segmentos: [{ nome: 'Código', campoFisico: 'codigoRua', ordem: 1, numerico: true, prefixo: 'AVARIA' }] },
    ]

    const empresas = await prisma.empresa.findMany({ select: { id: true } })
    for (const empresa of empresas) {
      for (const fmt of formatosPreConfigurados) {
        const existing = await prisma.formatoEndereco.findFirst({ where: { nome: fmt.nome, empresaId: empresa.id } })
        if (!existing) {
          await prisma.formatoEndereco.create({ data: { nome: fmt.nome, descricao: fmt.descricao, segmentos: fmt.segmentos, empresaId: empresa.id } })
        }
      }
    }
    console.log('✅ 6 formatos de endereço pré-configurados criados para todas as empresas')
  } catch (e: any) {
    console.log('⚠️ Seed formatos de endereço skipped:', e.message)
  }

  // =========================================================================
  // Conferência Avançada — novos campos e tabelas
  // =========================================================================

  // Empresa — configurações de conferência
  await prisma.$executeRawUnsafe(`ALTER TABLE "empresa" ADD COLUMN IF NOT EXISTS "conferencia_quantidade_cega" BOOLEAN DEFAULT false`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "empresa" ADD COLUMN IF NOT EXISTS "conferencia_lote_cega" BOOLEAN DEFAULT false`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "empresa" ADD COLUMN IF NOT EXISTS "permite_recebimento_parcial" BOOLEAN DEFAULT false`)

  // Produto — controle de lote
  await prisma.$executeRawUnsafe(`ALTER TABLE "produto" ADD COLUMN IF NOT EXISTS "exige_lote" BOOLEAN DEFAULT false`)

  // NotaEntrada — status de recebimento parcial
  await prisma.$executeRawUnsafe(`ALTER TABLE "nota_entrada" ADD COLUMN IF NOT EXISTS "status_recebimento" VARCHAR(30) DEFAULT 'PENDENTE'`)

  // DivergenciaConferencia table
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "divergencia_conferencia" (
      "id" TEXT NOT NULL,
      "empresa_id" TEXT NOT NULL,
      "nota_entrada_id" TEXT NOT NULL,
      "item_nota_entrada_id" TEXT NOT NULL,
      "tipo" VARCHAR(30) NOT NULL,
      "quantidade_esperada" DECIMAL(12,4),
      "quantidade_conferida" DECIMAL(12,4),
      "lote_esperado" VARCHAR(30),
      "lote_conferido" VARCHAR(30),
      "validade_esperada" TIMESTAMP(3),
      "validade_conferida" TIMESTAMP(3),
      "status" VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
      "observacao" TEXT,
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "divergencia_conferencia_pkey" PRIMARY KEY ("id")
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_divergencia_conferencia_empresa_id" ON "divergencia_conferencia"("empresa_id")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_divergencia_conferencia_nota_entrada_id" ON "divergencia_conferencia"("nota_entrada_id")`)

  // CartaCorrecao table
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "carta_correcao" (
      "id" TEXT NOT NULL,
      "empresa_id" TEXT NOT NULL,
      "nota_entrada_id" TEXT NOT NULL,
      "divergencia_id" TEXT NOT NULL,
      "chave_nfe" VARCHAR(44) NOT NULL,
      "sequencia_evento" INTEGER NOT NULL,
      "texto_correcao" TEXT NOT NULL,
      "xml_enviado" TEXT,
      "xml_retorno" TEXT,
      "protocolo" VARCHAR(20),
      "status" VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
      "motivo_rejeicao" TEXT,
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "carta_correcao_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "carta_correcao_divergencia_id_key" UNIQUE ("divergencia_id")
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_carta_correcao_empresa_id" ON "carta_correcao"("empresa_id")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_carta_correcao_nota_entrada_id" ON "carta_correcao"("nota_entrada_id")`)

  // SaldoPendenteItem table
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "saldo_pendente_item" (
      "id" TEXT NOT NULL,
      "empresa_id" TEXT NOT NULL,
      "nota_entrada_id" TEXT NOT NULL,
      "item_nota_entrada_id" TEXT NOT NULL,
      "quantidade_nf" DECIMAL(12,4) NOT NULL,
      "quantidade_recebida" DECIMAL(12,4) NOT NULL,
      "saldo_pendente" DECIMAL(12,4) NOT NULL,
      "status" VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "saldo_pendente_item_pkey" PRIMARY KEY ("id")
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_saldo_pendente_item_empresa_id" ON "saldo_pendente_item"("empresa_id")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_saldo_pendente_item_nota_entrada_id" ON "saldo_pendente_item"("nota_entrada_id")`)

  console.log('✅ Conferência Avançada: tabelas e colunas criadas')

  // =========================================================================
  // Divergência Lote/Validade — ConfigConferenciaProduto + supervisor_id
  // =========================================================================

  // ConfigConferenciaProduto table
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "config_conferencia_produto" (
      "id" TEXT NOT NULL,
      "empresa_id" TEXT NOT NULL,
      "produto_id" TEXT NOT NULL,
      "modo_resolucao_lote" VARCHAR(20) NOT NULL DEFAULT 'BLOQUEAR',
      "modo_resolucao_validade" VARCHAR(20) NOT NULL DEFAULT 'BLOQUEAR',
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "config_conferencia_produto_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "config_conferencia_produto_empresa_id_produto_id_key" UNIQUE ("empresa_id", "produto_id")
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_config_conferencia_produto_empresa_id" ON "config_conferencia_produto"("empresa_id")`)

  // DivergenciaConferencia — supervisor_id column
  await prisma.$executeRawUnsafe(`ALTER TABLE "divergencia_conferencia" ADD COLUMN IF NOT EXISTS "supervisor_id" VARCHAR(36)`)

  console.log('✅ Divergência Lote/Validade: tabela config_conferencia_produto e coluna supervisor_id criadas')

  // =========================================================================
  // WMS Fase 2 — Multi-CD com Transferências: tabelas de transferência
  // =========================================================================

  try {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "solicitacao_transferencia" (
      "id" TEXT NOT NULL,
      "empresa_id" TEXT NOT NULL,
      "numero" VARCHAR(20) NOT NULL,
      "cd_origem_id" TEXT NOT NULL,
      "cd_destino_id" TEXT NOT NULL,
      "status" VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
      "prioridade" VARCHAR(10) NOT NULL DEFAULT 'NORMAL',
      "observacoes" TEXT,
      "aprovador_id" TEXT,
      "aprovado_em" TIMESTAMP(3),
      "criado_por_id" TEXT NOT NULL,
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "solicitacao_transferencia_pkey" PRIMARY KEY ("id")
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "solicitacao_transferencia_empresa_id_numero_key" ON "solicitacao_transferencia"("empresa_id", "numero")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_solicitacao_transferencia_empresa_id" ON "solicitacao_transferencia"("empresa_id")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_solicitacao_transferencia_empresa_id_status" ON "solicitacao_transferencia"("empresa_id", "status")`)

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "item_solicitacao_transferencia" (
      "id" TEXT NOT NULL,
      "solicitacao_id" TEXT NOT NULL,
      "produto_id" TEXT NOT NULL,
      "quantidade" INTEGER NOT NULL,
      "quantidade_expedida" INTEGER NOT NULL DEFAULT 0,
      "quantidade_recebida" INTEGER NOT NULL DEFAULT 0,
      "lote" VARCHAR(30),
      CONSTRAINT "item_solicitacao_transferencia_pkey" PRIMARY KEY ("id")
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_item_solicitacao_transferencia_solicitacao_id" ON "item_solicitacao_transferencia"("solicitacao_id")`)

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "documento_saida_transferencia" (
      "id" TEXT NOT NULL,
      "empresa_id" TEXT NOT NULL,
      "solicitacao_id" TEXT NOT NULL,
      "numero" VARCHAR(20) NOT NULL,
      "data_emissao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "responsavel_id" TEXT NOT NULL,
      "observacoes" TEXT,
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "documento_saida_transferencia_pkey" PRIMARY KEY ("id")
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_documento_saida_transferencia_empresa_id" ON "documento_saida_transferencia"("empresa_id")`)

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "mercadoria_transito" (
      "id" TEXT NOT NULL,
      "empresa_id" TEXT NOT NULL,
      "solicitacao_id" TEXT NOT NULL,
      "documento_saida_id" TEXT NOT NULL,
      "produto_id" TEXT NOT NULL,
      "quantidade" INTEGER NOT NULL,
      "lote" VARCHAR(30),
      "data_expedicao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "data_recebimento" TIMESTAMP(3),
      "status" VARCHAR(20) NOT NULL DEFAULT 'EM_TRANSITO',
      CONSTRAINT "mercadoria_transito_pkey" PRIMARY KEY ("id")
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_mercadoria_transito_empresa_id" ON "mercadoria_transito"("empresa_id")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_mercadoria_transito_empresa_id_status" ON "mercadoria_transito"("empresa_id", "status")`)

  // Garantir colunas caso tabela já existisse sem elas (cenário de re-deploy)
  await prisma.$executeRawUnsafe(`ALTER TABLE "mercadoria_transito" ADD COLUMN IF NOT EXISTS "solicitacao_id" TEXT`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "mercadoria_transito" ADD COLUMN IF NOT EXISTS "documento_saida_id" TEXT`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "mercadoria_transito" ADD COLUMN IF NOT EXISTS "produto_id" TEXT`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "mercadoria_transito" ADD COLUMN IF NOT EXISTS "quantidade" INTEGER`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "mercadoria_transito" ADD COLUMN IF NOT EXISTS "lote" VARCHAR(30)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "mercadoria_transito" ADD COLUMN IF NOT EXISTS "data_expedicao" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "mercadoria_transito" ADD COLUMN IF NOT EXISTS "data_recebimento" TIMESTAMP(3)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "mercadoria_transito" ADD COLUMN IF NOT EXISTS "status" VARCHAR(20) DEFAULT 'EM_TRANSITO'`)

  console.log('✅ Multi-CD com Transferências: tabelas criadas')
  } catch (e: any) {
    console.log('⚠️ Multi-CD Transferências skipped:', e.message?.substring(0, 100))
  }

  // =========================================================================
  // PCP — Programação por Máquina: novos campos
  // =========================================================================
  await prisma.$executeRawUnsafe(`ALTER TABLE "etapa_ordem_producao" ADD COLUMN IF NOT EXISTS "posicao_fila" INTEGER`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "ordem_producao" ADD COLUMN IF NOT EXISTS "data_entrega_original" TIMESTAMP`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "ordem_producao" ADD COLUMN IF NOT EXISTS "vezes_postergada" INTEGER NOT NULL DEFAULT 0`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "ordem_producao" ADD COLUMN IF NOT EXISTS "referencia_externa" VARCHAR(50)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "ordem_producao" ADD COLUMN IF NOT EXISTS "origem_importacao" VARCHAR(30)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "ordem_producao" ADD COLUMN IF NOT EXISTS "criado_por_id" TEXT`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "ordem_producao" ADD COLUMN IF NOT EXISTS "quantidade_excedente" DECIMAL(12,4) DEFAULT 0`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "ordem_producao" ADD COLUMN IF NOT EXISTS "grupo_op_id" TEXT`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "item_ordem_producao" ADD COLUMN IF NOT EXISTS "descricao_externa" VARCHAR(300)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "item_ordem_producao" ADD COLUMN IF NOT EXISTS "tipo_material" VARCHAR(30)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "item_ordem_producao" ADD COLUMN IF NOT EXISTS "empresa_id" TEXT`)
  // Corrigir constraint de produto_componente_id para nullable
  await prisma.$executeRawUnsafe(`ALTER TABLE "item_ordem_producao" ALTER COLUMN "produto_componente_id" DROP NOT NULL`)
  // Corrigir constraint de centro_producao_id para nullable (importação OP sem vínculo de máquina)
  await prisma.$executeRawUnsafe(`ALTER TABLE "etapa_ordem_producao" ALTER COLUMN "centro_producao_id" DROP NOT NULL`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "etapa_ordem_producao" ADD COLUMN IF NOT EXISTS "quantidade_prevista" DECIMAL(12,4) DEFAULT 0`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "etapa_ordem_producao" ADD COLUMN IF NOT EXISTS "quantidade_produzida_etapa" DECIMAL(12,4) DEFAULT 0`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "etapa_ordem_producao" ADD COLUMN IF NOT EXISTS "quantidade_perda_etapa" DECIMAL(12,4) DEFAULT 0`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "etapa_ordem_producao" ADD COLUMN IF NOT EXISTS "observacao_operador" TEXT`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "etapa_ordem_producao" ADD COLUMN IF NOT EXISTS "funcionario_id" TEXT`)

  // Tabela de_para_importacao (mapeamento de importação PDF)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "de_para_importacao" (
      "id" TEXT NOT NULL,
      "empresa_id" TEXT NOT NULL,
      "sistema_origem" VARCHAR(50) NOT NULL,
      "tipo_entidade" VARCHAR(30) NOT NULL,
      "codigo_externo" VARCHAR(100) NOT NULL,
      "nome_externo" VARCHAR(200) NOT NULL,
      "entidade_interna_id" TEXT NOT NULL,
      "status" VARCHAR(20) NOT NULL DEFAULT 'ATIVO',
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "de_para_importacao_pkey" PRIMARY KEY ("id")
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "de_para_importacao_empresa_id_sistema_origem_tipo_entidade_co_key" ON "de_para_importacao"("empresa_id", "sistema_origem", "tipo_entidade", "codigo_externo")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_de_para_importacao_empresa_id_sistema_origem" ON "de_para_importacao"("empresa_id", "sistema_origem")`)

  console.log('✅ PCP Programação: campos posicao_fila, data_entrega_original, vezes_postergada + tabela de_para_importacao')

  // =========================================================================
  // PCP — Classificação Tipo Máquina: campo tipo_maquina no centro_producao
  // =========================================================================
  await prisma.$executeRawUnsafe(`ALTER TABLE "centro_producao" ADD COLUMN IF NOT EXISTS "tipo_maquina" VARCHAR(20)`)

  // Migração de dados: classificar centros existentes por keyword matching (idempotente)
  await prisma.$executeRawUnsafe(`
    UPDATE centro_producao SET tipo_maquina = 'IMPRESSAO'
    WHERE tipo = 'MAQUINA' AND tipo_maquina IS NULL
    AND (descricao ILIKE '%impress%' OR descricao ILIKE '%heidelberg%' OR descricao ILIKE '%offset%')
  `)
  await prisma.$executeRawUnsafe(`
    UPDATE centro_producao SET tipo_maquina = 'CORTADEIRA'
    WHERE tipo = 'MAQUINA' AND tipo_maquina IS NULL
    AND (descricao ILIKE '%corta%' OR descricao ILIKE '%cortadeira%' OR descricao ILIKE '%makpel%' OR descricao ILIKE '%guilhotina%')
  `)
  await prisma.$executeRawUnsafe(`
    UPDATE centro_producao SET tipo_maquina = 'ACABAMENTO'
    WHERE tipo = 'MAQUINA' AND tipo_maquina IS NULL
    AND (descricao ILIKE '%bobst%' OR descricao ILIKE '%aft%' OR descricao ILIKE '%colagem%' OR descricao ILIKE '%verniz%' OR descricao ILIKE '%acabamento%' OR descricao ILIKE '%dobra%' OR descricao ILIKE '%cola%')
  `)
  console.log('✅ PCP Classificação Tipo Máquina: campo tipo_maquina + dados migrados')

  // =========================================================================
  // PCP — Ordenação de Grupos: campo posicao no centro_producao
  // =========================================================================
  await prisma.$executeRawUnsafe(`ALTER TABLE "centro_producao" ADD COLUMN IF NOT EXISTS "posicao" INTEGER NOT NULL DEFAULT 0`)

  // Backfill: atribuir posições sequenciais para centros existentes (por empresa, ordenados por codigo)
  await prisma.$executeRawUnsafe(`
    WITH ranked AS (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY empresa_id ORDER BY codigo ASC) - 1 AS nova_posicao
      FROM centro_producao
    )
    UPDATE centro_producao
    SET posicao = ranked.nova_posicao
    FROM ranked
    WHERE centro_producao.id = ranked.id AND centro_producao.posicao = 0
  `)
  console.log('✅ PCP Ordenação: campo posicao + backfill sequencial')

  console.log('✅ All migrations applied successfully')
}

main()
  .catch((e) => { console.error('❌ Migration failed:', e.message); process.exit(1) })
  .finally(() => prisma.$disconnect())
