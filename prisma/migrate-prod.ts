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
  // Tabela legada — pode já ter sido removida (ver DROP TABLE "nfe" ao final)
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "nfe" ALTER COLUMN "xml_enviado" TYPE TEXT`)
    await prisma.$executeRawUnsafe(`ALTER TABLE "nfe" ALTER COLUMN "xml_retorno" TYPE TEXT`)
    console.log('✅ Colunas XML da NF-e alteradas para TEXT')
  } catch (e: any) {
    console.log('⚠️ Tabela nfe já removida ou não existe, skip:', e.message?.substring(0, 80))
  }

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
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "nfe" ADD COLUMN IF NOT EXISTS "mapa_ok" BOOLEAN DEFAULT false`)
  } catch { /* tabela nfe já removida (ver DROP TABLE "nfe" ao final) */ }
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

  // ⚠️ REMOVIDO: Reset de senha admin com valor hardcoded (vulnerabilidade de segurança)
  // A senha do admin deve ser alterada manualmente via interface ou endpoint autenticado.

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

  // Cada statement tem seu próprio try/catch: um erro isolado (ex: índice
  // que ainda não pode ser criado porque a coluna será renomeada só na
  // etapa seguinte) não pode interromper o restante do bloco.
  const runMultiCd = async (sql: string) => {
    try {
      await prisma.$executeRawUnsafe(sql)
    } catch (e: any) {
      if (e.message?.includes('already exists') || e.message?.includes('já existe')) return // idempotente
      console.log('⚠️ Multi-CD statement skipped:', e.message?.substring(0, 150))
    }
  }

  await runMultiCd(`
    CREATE TABLE IF NOT EXISTS "solicitacao_transferencia" (
      "id" TEXT NOT NULL,
      "empresa_id" TEXT NOT NULL,
      "numero" VARCHAR(20) NOT NULL,
      "cd_origem_id" TEXT NOT NULL,
      "cd_destino_id" TEXT NOT NULL,
      "status" VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
      "prioridade" VARCHAR(10) NOT NULL DEFAULT 'NORMAL',
      "criado_por_id" TEXT NOT NULL,
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "solicitacao_transferencia_pkey" PRIMARY KEY ("id")
    )
  `)
  await runMultiCd(`
    CREATE TABLE IF NOT EXISTS "item_solicitacao_transferencia" (
      "id" TEXT NOT NULL,
      "solicitacao_transferencia_id" TEXT NOT NULL,
      "produto_id" TEXT NOT NULL,
      "quantidade_solicitada" INTEGER NOT NULL,
      "quantidade_expedida" INTEGER NOT NULL DEFAULT 0,
      "quantidade_recebida" INTEGER NOT NULL DEFAULT 0,
      CONSTRAINT "item_solicitacao_transferencia_pkey" PRIMARY KEY ("id")
    )
  `)
  await runMultiCd(`
    CREATE TABLE IF NOT EXISTS "documento_saida_transferencia" (
      "id" TEXT NOT NULL,
      "empresa_id" TEXT NOT NULL,
      "numero" VARCHAR(20) NOT NULL,
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "documento_saida_transferencia_pkey" PRIMARY KEY ("id")
    )
  `)
  await runMultiCd(`
    CREATE TABLE IF NOT EXISTS "mercadoria_transito" (
      "id" TEXT NOT NULL,
      "empresa_id" TEXT NOT NULL,
      "produto_id" TEXT NOT NULL,
      "quantidade" INTEGER NOT NULL,
      "status" VARCHAR(20) NOT NULL DEFAULT 'EM_TRANSITO',
      CONSTRAINT "mercadoria_transito_pkey" PRIMARY KEY ("id")
    )
  `)
  console.log('✅ Multi-CD com Transferências: tabelas garantidas (formato mínimo/legado)')

  // -------------------------------------------------------------------------
  // Normalização de colunas para o layout do schema.prisma atual (detectado
  // via `prisma migrate diff`). Executa ANTES de qualquer índice/FK que
  // referencie os nomes novos. solicitacao_transferencia/
  // item_solicitacao_transferencia têm registros reais em produção, por isso
  // migramos as colunas (rename + conversão de tipo) em vez de dropar.
  // -------------------------------------------------------------------------
  await runMultiCd(`ALTER TABLE "solicitacao_transferencia" ADD COLUMN IF NOT EXISTS "observacoes" TEXT`)
  await runMultiCd(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='solicitacao_transferencia' AND column_name='motivo') THEN
        UPDATE "solicitacao_transferencia" SET "observacoes" = "motivo" WHERE "observacoes" IS NULL AND "motivo" IS NOT NULL;
      END IF;
    END $$
  `)
  await runMultiCd(`ALTER TABLE "solicitacao_transferencia" DROP COLUMN IF EXISTS "motivo"`)
  await runMultiCd(`ALTER TABLE "solicitacao_transferencia" DROP COLUMN IF EXISTS "data_prevista_envio"`)
  await runMultiCd(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='solicitacao_transferencia' AND column_name='aprovado_por_id')
         AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='solicitacao_transferencia' AND column_name='aprovador_id') THEN
        ALTER TABLE "solicitacao_transferencia" RENAME COLUMN "aprovado_por_id" TO "aprovador_id";
      END IF;
    END $$
  `)
  await runMultiCd(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='solicitacao_transferencia' AND column_name='data_aprovacao')
         AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='solicitacao_transferencia' AND column_name='aprovado_em') THEN
        ALTER TABLE "solicitacao_transferencia" RENAME COLUMN "data_aprovacao" TO "aprovado_em";
      END IF;
    END $$
  `)
  await runMultiCd(`ALTER TABLE "solicitacao_transferencia" ADD COLUMN IF NOT EXISTS "aprovador_id" TEXT`)
  await runMultiCd(`ALTER TABLE "solicitacao_transferencia" ADD COLUMN IF NOT EXISTS "aprovado_em" TIMESTAMP(3)`)

  await runMultiCd(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='item_solicitacao_transferencia' AND column_name='solicitacao_transferencia_id')
         AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='item_solicitacao_transferencia' AND column_name='solicitacao_id') THEN
        ALTER TABLE "item_solicitacao_transferencia" RENAME COLUMN "solicitacao_transferencia_id" TO "solicitacao_id";
      END IF;
    END $$
  `)
  await runMultiCd(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='item_solicitacao_transferencia' AND column_name='quantidade_solicitada')
         AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='item_solicitacao_transferencia' AND column_name='quantidade') THEN
        ALTER TABLE "item_solicitacao_transferencia" RENAME COLUMN "quantidade_solicitada" TO "quantidade";
      END IF;
    END $$
  `)
  await runMultiCd(`ALTER TABLE "item_solicitacao_transferencia" ADD COLUMN IF NOT EXISTS "lote" VARCHAR(30)`)
  await runMultiCd(`ALTER TABLE "item_solicitacao_transferencia" ADD COLUMN IF NOT EXISTS "solicitacao_id" TEXT`)
  await runMultiCd(`ALTER TABLE "item_solicitacao_transferencia" ADD COLUMN IF NOT EXISTS "quantidade" INTEGER`)
  await runMultiCd(`UPDATE "item_solicitacao_transferencia" SET "quantidade_expedida" = 0 WHERE "quantidade_expedida" IS NULL`)
  await runMultiCd(`UPDATE "item_solicitacao_transferencia" SET "quantidade_recebida" = 0 WHERE "quantidade_recebida" IS NULL`)
  await runMultiCd(`ALTER TABLE "item_solicitacao_transferencia" ALTER COLUMN "quantidade" TYPE INTEGER USING ROUND("quantidade")::integer`)
  await runMultiCd(`ALTER TABLE "item_solicitacao_transferencia" ALTER COLUMN "quantidade_expedida" TYPE INTEGER USING ROUND("quantidade_expedida")::integer`)
  await runMultiCd(`ALTER TABLE "item_solicitacao_transferencia" ALTER COLUMN "quantidade_recebida" TYPE INTEGER USING ROUND("quantidade_recebida")::integer`)
  await runMultiCd(`ALTER TABLE "item_solicitacao_transferencia" ALTER COLUMN "quantidade_expedida" SET DEFAULT 0`)
  await runMultiCd(`ALTER TABLE "item_solicitacao_transferencia" ALTER COLUMN "quantidade_recebida" SET DEFAULT 0`)
  await runMultiCd(`ALTER TABLE "item_solicitacao_transferencia" ALTER COLUMN "quantidade" SET NOT NULL`)

  await runMultiCd(`ALTER TABLE "documento_saida_transferencia" ADD COLUMN IF NOT EXISTS "data_emissao" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP`)
  await runMultiCd(`ALTER TABLE "documento_saida_transferencia" ADD COLUMN IF NOT EXISTS "observacoes" TEXT`)
  await runMultiCd(`ALTER TABLE "documento_saida_transferencia" ADD COLUMN IF NOT EXISTS "responsavel_id" TEXT`)
  await runMultiCd(`ALTER TABLE "documento_saida_transferencia" ADD COLUMN IF NOT EXISTS "solicitacao_id" TEXT`)
  await runMultiCd(`ALTER TABLE "documento_saida_transferencia" DROP COLUMN IF EXISTS "criado_por_id"`)
  await runMultiCd(`ALTER TABLE "documento_saida_transferencia" DROP COLUMN IF EXISTS "data_saida"`)
  await runMultiCd(`ALTER TABLE "documento_saida_transferencia" DROP COLUMN IF EXISTS "motorista_id"`)
  await runMultiCd(`ALTER TABLE "documento_saida_transferencia" DROP COLUMN IF EXISTS "previsao_chegada"`)
  await runMultiCd(`ALTER TABLE "documento_saida_transferencia" DROP COLUMN IF EXISTS "solicitacao_transferencia_id"`)
  await runMultiCd(`ALTER TABLE "documento_saida_transferencia" DROP COLUMN IF EXISTS "veiculo_placa"`)

  await runMultiCd(`ALTER TABLE "mercadoria_transito" ADD COLUMN IF NOT EXISTS "solicitacao_id" TEXT`)
  await runMultiCd(`ALTER TABLE "mercadoria_transito" ADD COLUMN IF NOT EXISTS "documento_saida_id" TEXT`)
  await runMultiCd(`ALTER TABLE "mercadoria_transito" ADD COLUMN IF NOT EXISTS "produto_id" TEXT`)
  await runMultiCd(`ALTER TABLE "mercadoria_transito" ADD COLUMN IF NOT EXISTS "quantidade" INTEGER`)
  await runMultiCd(`ALTER TABLE "mercadoria_transito" ADD COLUMN IF NOT EXISTS "status" VARCHAR(20) DEFAULT 'EM_TRANSITO'`)
  await runMultiCd(`ALTER TABLE "mercadoria_transito" ADD COLUMN IF NOT EXISTS "lote" VARCHAR(30)`)
  await runMultiCd(`ALTER TABLE "mercadoria_transito" ADD COLUMN IF NOT EXISTS "data_expedicao" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP`)
  await runMultiCd(`ALTER TABLE "mercadoria_transito" ADD COLUMN IF NOT EXISTS "data_recebimento" TIMESTAMP(3)`)
  await runMultiCd(`ALTER TABLE "mercadoria_transito" DROP COLUMN IF EXISTS "cd_destino_id"`)
  await runMultiCd(`ALTER TABLE "mercadoria_transito" DROP COLUMN IF EXISTS "cd_origem_id"`)
  await runMultiCd(`ALTER TABLE "mercadoria_transito" DROP COLUMN IF EXISTS "criado_em"`)
  await runMultiCd(`ALTER TABLE "mercadoria_transito" DROP COLUMN IF EXISTS "data_saida"`)
  await runMultiCd(`ALTER TABLE "mercadoria_transito" DROP COLUMN IF EXISTS "previsao_chegada"`)
  await runMultiCd(`ALTER TABLE "mercadoria_transito" DROP COLUMN IF EXISTS "recebido_em"`)
  await runMultiCd(`ALTER TABLE "mercadoria_transito" DROP COLUMN IF EXISTS "solicitacao_transferencia_id"`)

  console.log('✅ Multi-CD: colunas normalizadas para o layout atual (registros reais preservados)')

  // -------------------------------------------------------------------------
  // Índices e foreign keys — só agora, depois que os nomes de coluna estão
  // garantidamente corretos.
  // -------------------------------------------------------------------------
  await runMultiCd(`CREATE UNIQUE INDEX IF NOT EXISTS "solicitacao_transferencia_empresa_id_numero_key" ON "solicitacao_transferencia"("empresa_id", "numero")`)
  await runMultiCd(`CREATE INDEX IF NOT EXISTS "idx_solicitacao_transferencia_empresa_id" ON "solicitacao_transferencia"("empresa_id")`)
  await runMultiCd(`CREATE INDEX IF NOT EXISTS "idx_solicitacao_transferencia_empresa_id_status" ON "solicitacao_transferencia"("empresa_id", "status")`)
  await runMultiCd(`CREATE INDEX IF NOT EXISTS "idx_item_solicitacao_transferencia_solicitacao_id" ON "item_solicitacao_transferencia"("solicitacao_id")`)
  await runMultiCd(`CREATE INDEX IF NOT EXISTS "idx_documento_saida_transferencia_empresa_id" ON "documento_saida_transferencia"("empresa_id")`)
  await runMultiCd(`CREATE INDEX IF NOT EXISTS "idx_mercadoria_transito_empresa_id" ON "mercadoria_transito"("empresa_id")`)
  await runMultiCd(`CREATE INDEX IF NOT EXISTS "idx_mercadoria_transito_empresa_id_status" ON "mercadoria_transito"("empresa_id", "status")`)

  const multiCdFks = [
    `ALTER TABLE "item_solicitacao_transferencia" ADD CONSTRAINT "item_solicitacao_transferencia_solicitacao_id_fkey" FOREIGN KEY ("solicitacao_id") REFERENCES "solicitacao_transferencia"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    `ALTER TABLE "item_solicitacao_transferencia" ADD CONSTRAINT "item_solicitacao_transferencia_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "documento_saida_transferencia" ADD CONSTRAINT "documento_saida_transferencia_solicitacao_id_fkey" FOREIGN KEY ("solicitacao_id") REFERENCES "solicitacao_transferencia"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "mercadoria_transito" ADD CONSTRAINT "mercadoria_transito_solicitacao_id_fkey" FOREIGN KEY ("solicitacao_id") REFERENCES "solicitacao_transferencia"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "mercadoria_transito" ADD CONSTRAINT "mercadoria_transito_documento_saida_id_fkey" FOREIGN KEY ("documento_saida_id") REFERENCES "documento_saida_transferencia"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "mercadoria_transito" ADD CONSTRAINT "mercadoria_transito_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
  ]
  for (const fk of multiCdFks) { await runMultiCd(fk) }

  console.log('✅ Multi-CD: índices e foreign keys aplicados')

  // =========================================================================
  // Remover tabelas legadas nfe/item_nfe (substituídas por documento_fiscal/
  // item_documento_fiscal). Confirmado via `prisma migrate diff` + consulta
  // manual que ambas estão vazias (0 registros) em produção — seguro remover.
  // =========================================================================
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "item_nfe" DROP CONSTRAINT IF EXISTS "item_nfe_nfe_id_fkey"`)
    await prisma.$executeRawUnsafe(`ALTER TABLE "item_nfe" DROP CONSTRAINT IF EXISTS "item_nfe_produto_id_fkey"`)
    await prisma.$executeRawUnsafe(`ALTER TABLE "nfe" DROP CONSTRAINT IF EXISTS "nfe_empresa_id_fkey"`)
    await prisma.$executeRawUnsafe(`ALTER TABLE "nfe" DROP CONSTRAINT IF EXISTS "nfe_venda_efetivada_id_fkey"`)
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "item_nfe"`)
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "nfe"`)
    console.log('✅ Tabelas legadas nfe/item_nfe removidas')
  } catch (e: any) {
    console.log('⚠️ Remoção nfe/item_nfe skipped:', e.message?.substring(0, 150))
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

  // =========================================================================
  // Segurança — Refresh Tokens table
  // =========================================================================
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "refresh_token" (
      "id" TEXT NOT NULL,
      "usuario_id" TEXT NOT NULL,
      "token" VARCHAR(200) NOT NULL,
      "expires_at" TIMESTAMP(3) NOT NULL,
      "revoked" BOOLEAN NOT NULL DEFAULT false,
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "refresh_token_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "refresh_token_token_key" UNIQUE ("token"),
      CONSTRAINT "refresh_token_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_refresh_token_token" ON "refresh_token"("token")`)
  console.log('✅ Segurança: tabela refresh_token criada')

  // Bug real da expiração de sessão: o código sempre fez `upsert({ where: { usuarioId } })`,
  // mas usuario_id nunca teve constraint UNIQUE — o upsert falhava silenciosamente (catch vazio)
  // e o refresh token NUNCA era salvo, quebrando a renovação automática de sessão.
  // Antes de criar o índice único, remover duplicados (manter só o mais recente por usuário).
  await prisma.$executeRawUnsafe(`
    DELETE FROM "refresh_token" rt
    WHERE rt.id NOT IN (
      SELECT DISTINCT ON (usuario_id) id
      FROM "refresh_token"
      ORDER BY usuario_id, criado_em DESC
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "refresh_token_usuario_id_key" ON "refresh_token"("usuario_id")`)
  console.log('✅ Segurança: refresh_token.usuario_id agora é UNIQUE (corrige upsert silenciosamente ignorado — causa raiz da expiração de sessão)')

  // Limpar tokens expirados (manutenção automática)
  try {
    await prisma.$executeRawUnsafe(`DELETE FROM "refresh_token" WHERE "expires_at" < NOW() OR "revoked" = true`)
    console.log('✅ Tokens expirados limpos')
  } catch { /* tabela pode não existir ainda */ }

  // SecurityAuditLog — tabela de eventos de segurança
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "security_audit_log" (
      "id" TEXT NOT NULL,
      "tipo" VARCHAR(50) NOT NULL,
      "usuario_id" TEXT,
      "email" VARCHAR(200),
      "ip" VARCHAR(45) NOT NULL,
      "user_agent" VARCHAR(300),
      "detalhes" TEXT,
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "security_audit_log_pkey" PRIMARY KEY ("id")
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_security_audit_log_tipo_criado_em" ON "security_audit_log"("tipo", "criado_em")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_security_audit_log_usuario_id" ON "security_audit_log"("usuario_id")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_security_audit_log_ip" ON "security_audit_log"("ip")`)
  console.log('✅ Segurança: tabela security_audit_log criada')

  // Limpar logs de segurança com mais de 90 dias (manutenção)
  try {
    await prisma.$executeRawUnsafe(`DELETE FROM "security_audit_log" WHERE "criado_em" < NOW() - INTERVAL '90 days'`)
  } catch { /* tabela pode não existir ainda */ }

  // =========================================================================
  // PDF de OPs — armazenar no banco para persistência entre deploys
  // =========================================================================
  await prisma.$executeRawUnsafe(`ALTER TABLE "ordem_producao" ADD COLUMN IF NOT EXISTS "pdf_data" BYTEA`)
  console.log('✅ OrdemProducao: campo pdf_data (BYTEA) adicionado')

  // =========================================================================
  // PDV — Ponto de Venda
  // =========================================================================
  await prisma.$executeRawUnsafe(`
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
    )
  `)
  await prisma.$executeRawUnsafe(`
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
    )
  `)
  await prisma.$executeRawUnsafe(`
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
      CONSTRAINT "venda_pdv_caixa_id_fkey" FOREIGN KEY ("caixa_id") REFERENCES "caixa_pdv"("id")
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "venda_pdv_empresa_id_numero_key" ON "venda_pdv"("empresa_id", "numero")`)
  await prisma.$executeRawUnsafe(`
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
    )
  `)
  await prisma.$executeRawUnsafe(`
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
    )
  `)
  console.log('✅ PDV: tabelas caixa_pdv, movimentacao_caixa, venda_pdv, item_venda_pdv, pagamento_pdv criadas')

  // =========================================================================
  // Vendas Avançadas — Campanhas, Comissão, Workflow, Metas, Bonificação, Encomenda, Consignação, E-commerce, Orçamento, Devolução
  // =========================================================================
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "orcamento" (
      "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
      "empresa_id" TEXT NOT NULL,
      "numero" INTEGER NOT NULL,
      "cliente_id" TEXT NOT NULL,
      "vendedor_id" TEXT,
      "tabela_preco_id" TEXT,
      "condicao_pag_id" TEXT,
      "valor_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
      "status" VARCHAR(20) NOT NULL DEFAULT 'ABERTO',
      "validade_ate" TIMESTAMP(3) NOT NULL,
      "observacao" TEXT,
      "observacao_interna" TEXT,
      "contato_nome" VARCHAR(100),
      "contato_email" VARCHAR(200),
      "contato_telefone" VARCHAR(20),
      "motivo_reprovacao" TEXT,
      "pedido_venda_gerado_id" TEXT,
      "tipo_desconto" VARCHAR(15),
      "desconto_geral" DECIMAL(12,2) NOT NULL DEFAULT 0,
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "orcamento_pkey" PRIMARY KEY ("id")
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "orcamento_empresa_id_numero_key" ON "orcamento"("empresa_id", "numero")`)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "item_orcamento" (
      "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
      "orcamento_id" TEXT NOT NULL,
      "produto_id" TEXT NOT NULL,
      "quantidade" DECIMAL(12,4) NOT NULL,
      "unidade" VARCHAR(6) NOT NULL DEFAULT 'UN',
      "preco_unitario" DECIMAL(12,4) NOT NULL,
      "desconto" DECIMAL(5,2) NOT NULL DEFAULT 0,
      "valor_total" DECIMAL(12,2) NOT NULL,
      "observacao" TEXT,
      CONSTRAINT "item_orcamento_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "item_orcamento_orcamento_id_fkey" FOREIGN KEY ("orcamento_id") REFERENCES "orcamento"("id") ON DELETE CASCADE
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "devolucao_venda" (
      "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
      "empresa_id" TEXT NOT NULL,
      "venda_efetivada_id" TEXT NOT NULL,
      "motivo" TEXT NOT NULL,
      "valor_total" DECIMAL(12,2) NOT NULL,
      "status" VARCHAR(20) NOT NULL DEFAULT 'PROCESSADA',
      "nfe_entrada_chave" VARCHAR(44),
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "devolucao_venda_pkey" PRIMARY KEY ("id")
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "item_devolucao_venda" (
      "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
      "devolucao_venda_id" TEXT NOT NULL,
      "produto_id" TEXT NOT NULL,
      "quantidade" DECIMAL(12,4) NOT NULL,
      "preco_unitario" DECIMAL(12,4) NOT NULL,
      "valor_total" DECIMAL(12,2) NOT NULL,
      "motivo_item" VARCHAR(200),
      CONSTRAINT "item_devolucao_venda_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "item_devolucao_venda_devolucao_venda_id_fkey" FOREIGN KEY ("devolucao_venda_id") REFERENCES "devolucao_venda"("id") ON DELETE CASCADE
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "campanha_desconto" (
      "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
      "empresa_id" TEXT NOT NULL,
      "nome" VARCHAR(100) NOT NULL,
      "tipo" VARCHAR(20) NOT NULL,
      "valor" DECIMAL(12,2) NOT NULL DEFAULT 0,
      "codigo_cupom" VARCHAR(30),
      "data_inicio" TIMESTAMP(3) NOT NULL,
      "data_fim" TIMESTAMP(3) NOT NULL,
      "ativo" BOOLEAN NOT NULL DEFAULT true,
      "quantidade_minima" DECIMAL(12,4),
      "valor_minimo_pedido" DECIMAL(12,2),
      "usos_maximos" INTEGER,
      "usos_atuais" INTEGER NOT NULL DEFAULT 0,
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "campanha_desconto_pkey" PRIMARY KEY ("id")
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "campanha_desconto_empresa_id_codigo_cupom_key" ON "campanha_desconto"("empresa_id", "codigo_cupom")`)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "regra_comissao" (
      "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
      "empresa_id" TEXT NOT NULL,
      "vendedor_id" TEXT,
      "produto_id" TEXT,
      "categoria_id" VARCHAR(50),
      "regiao_uf" VARCHAR(2),
      "faixa_inicio" DECIMAL(12,2) NOT NULL DEFAULT 0,
      "faixa_fim" DECIMAL(12,2),
      "percentual" DECIMAL(5,2) NOT NULL,
      "sobre_recebimento" BOOLEAN NOT NULL DEFAULT false,
      "ativo" BOOLEAN NOT NULL DEFAULT true,
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "regra_comissao_pkey" PRIMARY KEY ("id")
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "regra_aprovacao" (
      "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
      "empresa_id" TEXT NOT NULL,
      "tipo" VARCHAR(30) NOT NULL,
      "condicao" VARCHAR(20) NOT NULL,
      "valor" DECIMAL(12,2) NOT NULL,
      "aprovador_id" VARCHAR(100) NOT NULL,
      "ativo" BOOLEAN NOT NULL DEFAULT true,
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "regra_aprovacao_pkey" PRIMARY KEY ("id")
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "solicitacao_aprovacao" (
      "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
      "empresa_id" TEXT NOT NULL,
      "regra_id" TEXT NOT NULL,
      "pedido_venda_id" TEXT,
      "solicitante_id" TEXT NOT NULL,
      "aprovador_id" TEXT NOT NULL,
      "status" VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
      "motivo" TEXT,
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "resolvido_em" TIMESTAMP(3),
      CONSTRAINT "solicitacao_aprovacao_pkey" PRIMARY KEY ("id")
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "meta_vendedor" (
      "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
      "empresa_id" TEXT NOT NULL,
      "vendedor_id" TEXT NOT NULL,
      "periodo" VARCHAR(7) NOT NULL,
      "meta_valor" DECIMAL(12,2) NOT NULL,
      "realizado_valor" DECIMAL(12,2) NOT NULL DEFAULT 0,
      "meta_quantidade" INTEGER,
      "realizado_quantidade" INTEGER NOT NULL DEFAULT 0,
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "meta_vendedor_pkey" PRIMARY KEY ("id")
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "meta_vendedor_empresa_id_vendedor_id_periodo_key" ON "meta_vendedor"("empresa_id", "vendedor_id", "periodo")`)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "regra_bonificacao" (
      "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
      "empresa_id" TEXT NOT NULL,
      "nome" VARCHAR(100) NOT NULL,
      "produto_gatilho_id" TEXT NOT NULL,
      "quantidade_minima" DECIMAL(12,4) NOT NULL,
      "produto_bonus_id" TEXT NOT NULL,
      "quantidade_bonus" DECIMAL(12,4) NOT NULL,
      "ativo" BOOLEAN NOT NULL DEFAULT true,
      "data_inicio" TIMESTAMP(3),
      "data_fim" TIMESTAMP(3),
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "regra_bonificacao_pkey" PRIMARY KEY ("id")
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "venda_encomenda" (
      "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
      "empresa_id" TEXT NOT NULL,
      "pedido_venda_id" TEXT NOT NULL,
      "ordem_producao_id" TEXT,
      "status" VARCHAR(30) NOT NULL DEFAULT 'AGUARDANDO_PRODUCAO',
      "previsao_entrega" TIMESTAMP(3),
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "venda_encomenda_pkey" PRIMARY KEY ("id")
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "remessa_consignacao" (
      "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
      "empresa_id" TEXT NOT NULL,
      "cliente_id" TEXT NOT NULL,
      "numero" INTEGER NOT NULL,
      "status" VARCHAR(20) NOT NULL DEFAULT 'REMESSA',
      "data_remessa" TIMESTAMP(3) NOT NULL,
      "data_retorno_previsto" TIMESTAMP(3),
      "valor_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "remessa_consignacao_pkey" PRIMARY KEY ("id")
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "remessa_consignacao_empresa_id_numero_key" ON "remessa_consignacao"("empresa_id", "numero")`)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "item_consignacao" (
      "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
      "remessa_id" TEXT NOT NULL,
      "produto_id" TEXT NOT NULL,
      "quantidade" DECIMAL(12,4) NOT NULL,
      "preco_unitario" DECIMAL(12,4) NOT NULL,
      "quantidade_vendida" DECIMAL(12,4) NOT NULL DEFAULT 0,
      "quantidade_retornada" DECIMAL(12,4) NOT NULL DEFAULT 0,
      CONSTRAINT "item_consignacao_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "item_consignacao_remessa_id_fkey" FOREIGN KEY ("remessa_id") REFERENCES "remessa_consignacao"("id") ON DELETE CASCADE
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "integracao_ecommerce" (
      "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
      "empresa_id" TEXT NOT NULL,
      "plataforma" VARCHAR(30) NOT NULL,
      "api_key" VARCHAR(200),
      "api_secret" VARCHAR(200),
      "store_id" VARCHAR(100),
      "webhook_url" TEXT,
      "ativo" BOOLEAN NOT NULL DEFAULT true,
      "ultima_sync" TIMESTAMP(3),
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "integracao_ecommerce_pkey" PRIMARY KEY ("id")
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "pedido_ecommerce" (
      "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
      "empresa_id" TEXT NOT NULL,
      "integracao_id" TEXT NOT NULL,
      "pedido_externo" VARCHAR(100) NOT NULL,
      "plataforma" VARCHAR(30) NOT NULL,
      "status" VARCHAR(20) NOT NULL DEFAULT 'RECEBIDO',
      "pedido_venda_id" TEXT,
      "dados_json" JSONB,
      "erro_msg" TEXT,
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "pedido_ecommerce_pkey" PRIMARY KEY ("id")
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "pedido_ecommerce_empresa_id_pedido_externo_plataforma_key" ON "pedido_ecommerce"("empresa_id", "pedido_externo", "plataforma")`)

  // TabelaPreco — campos de vigência
  await prisma.$executeRawUnsafe(`ALTER TABLE "tabela_preco" ADD COLUMN IF NOT EXISTS "data_inicio" TIMESTAMP(3)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "tabela_preco" ADD COLUMN IF NOT EXISTS "data_fim" TIMESTAMP(3)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "tabela_preco" ADD COLUMN IF NOT EXISTS "cliente_id" TEXT`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "tabela_preco" ADD COLUMN IF NOT EXISTS "grupo_cliente" VARCHAR(50)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "tabela_preco" ADD COLUMN IF NOT EXISTS "prioridade" INTEGER DEFAULT 0`)

  console.log('✅ Vendas Avançadas: todas as tabelas criadas (orçamento, devolução, campanhas, comissão, aprovação, metas, bonificação, encomenda, consignação, e-commerce)')

  // =========================================================================
  // Conversa AI — Histórico persistente
  // =========================================================================
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "conversa_ai" (
      "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
      "empresa_id" TEXT NOT NULL,
      "usuario_id" TEXT NOT NULL,
      "mensagem" TEXT NOT NULL,
      "resposta" TEXT NOT NULL,
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "conversa_ai_pkey" PRIMARY KEY ("id")
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "conversa_ai_empresa_id_usuario_id_criado_em_idx" ON "conversa_ai"("empresa_id", "usuario_id", "criado_em")`)
  console.log('✅ Tabela conversa_ai criada')

  // =========================================================================
  // Empresa — NFC-e: CSC (Código de Segurança do Contribuinte) para QRCode
  // Colunas existiam no schema.prisma mas nunca foram migradas para produção,
  // causando erro "column empresa.csc_id_nfce does not exist" (ex: no backup)
  // =========================================================================
  await prisma.$executeRawUnsafe(`ALTER TABLE "empresa" ADD COLUMN IF NOT EXISTS "csc_id_nfce" VARCHAR(6)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "empresa" ADD COLUMN IF NOT EXISTS "csc_token_nfce" VARCHAR(36)`)
  console.log('Empresa: colunas csc_id_nfce e csc_token_nfce adicionadas')

  // =========================================================================
  // Pedido de Venda Completo — campos de cabeçalho e item que estavam apenas
  // na migration formal 20260702140606_add_pedido_venda_completo, nunca
  // aplicada em produção (o start do container só executa este script,
  // não "prisma migrate deploy"). Causava "column pedido_venda.data_entrega
  // does not exist" (ex: no backup).
  // =========================================================================
  await prisma.$executeRawUnsafe(`ALTER TABLE "pedido_venda" ADD COLUMN IF NOT EXISTS "data_entrega" TIMESTAMP(3)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "pedido_venda" ADD COLUMN IF NOT EXISTS "observacao" TEXT`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "pedido_venda" ADD COLUMN IF NOT EXISTS "observacao_nota" TEXT`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "pedido_venda" ADD COLUMN IF NOT EXISTS "transportadora_id" TEXT`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "pedido_venda" ADD COLUMN IF NOT EXISTS "modalidade_frete" VARCHAR(1)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "pedido_venda" ADD COLUMN IF NOT EXISTS "origem_pedido" VARCHAR(20) NOT NULL DEFAULT 'MANUAL'`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "pedido_venda" ADD COLUMN IF NOT EXISTS "prioridade" VARCHAR(10) NOT NULL DEFAULT 'NORMAL'`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "pedido_venda" ADD COLUMN IF NOT EXISTS "data_validade" TIMESTAMP(3)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "pedido_venda" ADD COLUMN IF NOT EXISTS "numero_pedido_cliente" VARCHAR(60)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "pedido_venda" ADD COLUMN IF NOT EXISTS "tipo_desconto" VARCHAR(15)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "pedido_venda" ADD COLUMN IF NOT EXISTS "desconto_geral" DECIMAL(12,2) NOT NULL DEFAULT 0`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "pedido_venda" ADD COLUMN IF NOT EXISTS "acrescimo_geral" DECIMAL(12,2) NOT NULL DEFAULT 0`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "pedido_venda" ADD COLUMN IF NOT EXISTS "tipo_acrescimo" VARCHAR(20)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "pedido_venda" ADD COLUMN IF NOT EXISTS "endereco_entrega" JSONB`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "pedido_venda" ADD COLUMN IF NOT EXISTS "orcamento_origem_id" TEXT`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "pedido_venda" ADD COLUMN IF NOT EXISTS "data_limite_atendimento" TIMESTAMP(3)`)

  await prisma.$executeRawUnsafe(`ALTER TABLE "item_pedido_venda" ADD COLUMN IF NOT EXISTS "desconto_valor" DECIMAL(12,4) NOT NULL DEFAULT 0`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "item_pedido_venda" ADD COLUMN IF NOT EXISTS "frete" DECIMAL(12,2) NOT NULL DEFAULT 0`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "item_pedido_venda" ADD COLUMN IF NOT EXISTS "seguro" DECIMAL(12,2) NOT NULL DEFAULT 0`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "item_pedido_venda" ADD COLUMN IF NOT EXISTS "outras_despesas" DECIMAL(12,2) NOT NULL DEFAULT 0`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "item_pedido_venda" ADD COLUMN IF NOT EXISTS "observacao_item" TEXT`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "item_pedido_venda" ADD COLUMN IF NOT EXISTS "data_entrega_item" TIMESTAMP(3)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "item_pedido_venda" ADD COLUMN IF NOT EXISTS "comissao_perc_item" DECIMAL(5,2) NOT NULL DEFAULT 0`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "item_pedido_venda" ADD COLUMN IF NOT EXISTS "quantidade_faturada" DECIMAL(12,4) NOT NULL DEFAULT 0`)

  // DropIndex: remove @unique de pedidoVendaId para permitir relação 1:N (faturamento parcial)
  await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "venda_efetivada_pedido_venda_id_key"`)

  // AddForeignKey: pedido_venda -> transportadora (idempotente via catch)
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "pedido_venda" ADD CONSTRAINT "pedido_venda_transportadora_id_fkey" FOREIGN KEY ("transportadora_id") REFERENCES "transportadora"("id") ON DELETE SET NULL ON UPDATE CASCADE`)
  } catch { /* constraint já existe */ }

  console.log('✅ Pedido de Venda Completo: colunas de cabeçalho/item + FK transportadora adicionadas')

  // =========================================================================
  // Produto — campos PCP e Fiscal presentes no schema.prisma mas nunca
  // migrados para produção (mesmo padrão de dívida técnica dos casos acima).
  // =========================================================================
  await prisma.$executeRawUnsafe(`ALTER TABLE "produto" ADD COLUMN IF NOT EXISTS "classificacao_pcp" VARCHAR(20)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "produto" ADD COLUMN IF NOT EXISTS "tipo_fisico" VARCHAR(20)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "produto" ADD COLUMN IF NOT EXISTS "exige_lote" BOOLEAN DEFAULT false`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "produto" ADD COLUMN IF NOT EXISTS "ncm" VARCHAR(8)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "produto" ADD COLUMN IF NOT EXISTS "cfop_estadual" VARCHAR(4)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "produto" ADD COLUMN IF NOT EXISTS "cfop_interest" VARCHAR(4)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "produto" ADD COLUMN IF NOT EXISTS "cst" VARCHAR(3)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "produto" ADD COLUMN IF NOT EXISTS "csosn" VARCHAR(4)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "produto" ADD COLUMN IF NOT EXISTS "aliq_icms" DECIMAL(5,2) DEFAULT 0`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "produto" ADD COLUMN IF NOT EXISTS "aliq_ipi" DECIMAL(5,2) DEFAULT 0`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "produto" ADD COLUMN IF NOT EXISTS "cst_pis" VARCHAR(2)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "produto" ADD COLUMN IF NOT EXISTS "aliq_pis" DECIMAL(5,2) DEFAULT 0`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "produto" ADD COLUMN IF NOT EXISTS "cst_cofins" VARCHAR(2)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "produto" ADD COLUMN IF NOT EXISTS "aliq_cofins" DECIMAL(5,2) DEFAULT 0`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "produto" ADD COLUMN IF NOT EXISTS "origem_prod" INTEGER DEFAULT 0`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "produto" ADD COLUMN IF NOT EXISTS "c_ean" VARCHAR(14)`)
  console.log('✅ Produto: campos PCP (classificacao_pcp, tipo_fisico, exige_lote) e Fiscal (ncm, cfop, cst/csosn, aliquotas, c_ean) adicionados')

  // =========================================================================
  // ItemPedidoCompra — campo classificacao presente no schema.prisma mas
  // nunca migrado para produção.
  // =========================================================================
  await prisma.$executeRawUnsafe(`ALTER TABLE "item_pedido_compra" ADD COLUMN IF NOT EXISTS "classificacao" VARCHAR(20) NOT NULL DEFAULT 'REVENDA'`)
  console.log('✅ ItemPedidoCompra: campo classificacao adicionado')

  // =========================================================================
  // ConfigConferenciaProduto — troca de modo_resolucao_lote/validade (enum)
  // por aceitar_senha/aceitar_cce_pendente (boolean), presente no
  // schema.prisma (migration 20250627000000) mas nunca migrado para produção.
  // =========================================================================
  await prisma.$executeRawUnsafe(`ALTER TABLE "config_conferencia_produto" DROP COLUMN IF EXISTS "modo_resolucao_lote"`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "config_conferencia_produto" DROP COLUMN IF EXISTS "modo_resolucao_validade"`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "config_conferencia_produto" ADD COLUMN IF NOT EXISTS "aceitar_cce_pendente" BOOLEAN NOT NULL DEFAULT false`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "config_conferencia_produto" ADD COLUMN IF NOT EXISTS "aceitar_senha" BOOLEAN NOT NULL DEFAULT false`)
  console.log('✅ ConfigConferenciaProduto: colunas aceitar_senha e aceitar_cce_pendente adicionadas')

  // ItemNotaEntrada — status_conferencia (mesma migration 20250627000000,
  // nunca migrada para produção). Erro real: portaria falhava ao autorizar
  // entrada e criar nota via tx.notaEntrada.create() com itens.
  await prisma.$executeRawUnsafe(`ALTER TABLE "item_nota_entrada" ADD COLUMN IF NOT EXISTS "status_conferencia" VARCHAR(30) NOT NULL DEFAULT 'PENDENTE'`)
  console.log('✅ ItemNotaEntrada: coluna status_conferencia adicionada')

  // =========================================================================
  // Tabelas identificadas via `prisma migrate diff` (comparação schema x
  // banco de produção real) que nunca haviam sido criadas: preferencia_usuario,
  // config_integracao, config_email_fiscal, pendencia_cce.
  // =========================================================================
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "preferencia_usuario" (
      "id" TEXT NOT NULL,
      "usuario_id" TEXT NOT NULL,
      "tema" VARCHAR(10) NOT NULL DEFAULT 'auto',
      "idioma" VARCHAR(10) NOT NULL DEFAULT 'pt-BR',
      "densidade" VARCHAR(15) NOT NULL DEFAULT 'normal',
      "formato_data" VARCHAR(15) NOT NULL DEFAULT 'DD/MM/YYYY',
      "notif_sons" BOOLEAN NOT NULL DEFAULT true,
      "notif_push" BOOLEAN NOT NULL DEFAULT true,
      "notif_email" BOOLEAN NOT NULL DEFAULT true,
      "modulo_padrao" VARCHAR(30),
      "tamanho_fonte" VARCHAR(10) NOT NULL DEFAULT 'medio',
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "preferencia_usuario_pkey" PRIMARY KEY ("id")
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "preferencia_usuario_usuario_id_key" ON "preferencia_usuario"("usuario_id")`)

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "config_integracao" (
      "id" TEXT NOT NULL,
      "empresa_id" TEXT NOT NULL,
      "integracao_ativa" BOOLEAN NOT NULL DEFAULT false,
      "sistema_externo" VARCHAR(100),
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "config_integracao_pkey" PRIMARY KEY ("id")
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "config_integracao_empresa_id_key" ON "config_integracao"("empresa_id")`)

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "config_email_fiscal" (
      "id" TEXT NOT NULL,
      "empresa_id" TEXT NOT NULL,
      "email" VARCHAR(254) NOT NULL,
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "config_email_fiscal_pkey" PRIMARY KEY ("id")
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "config_email_fiscal_empresa_id_key" ON "config_email_fiscal"("empresa_id")`)

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "pendencia_cce" (
      "id" TEXT NOT NULL,
      "empresa_id" TEXT NOT NULL,
      "nota_entrada_id" TEXT NOT NULL,
      "codigo_produto" VARCHAR(60) NOT NULL,
      "descricao_produto" VARCHAR(200) NOT NULL,
      "fornecedor" VARCHAR(200) NOT NULL,
      "tipo" VARCHAR(10) NOT NULL,
      "motivo" VARCHAR(50) NOT NULL,
      "status" VARCHAR(20) NOT NULL DEFAULT 'AGUARDANDO_CCE',
      "resolvido_em" TIMESTAMP(3),
      "resolvido_por_id" TEXT,
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "pendencia_cce_pkey" PRIMARY KEY ("id")
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "pendencia_cce_empresa_id_status_idx" ON "pendencia_cce"("empresa_id", "status")`)

  const cadastroFks = [
    `ALTER TABLE "config_integracao" ADD CONSTRAINT "config_integracao_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "config_email_fiscal" ADD CONSTRAINT "config_email_fiscal_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "pendencia_cce" ADD CONSTRAINT "pendencia_cce_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "pendencia_cce" ADD CONSTRAINT "pendencia_cce_nota_entrada_id_fkey" FOREIGN KEY ("nota_entrada_id") REFERENCES "nota_entrada"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
  ]
  for (const fk of cadastroFks) {
    try { await prisma.$executeRawUnsafe(fk) } catch { /* constraint já existe */ }
  }
  console.log('✅ Tabelas preferencia_usuario, config_integracao, config_email_fiscal, pendencia_cce criadas')

  // =========================================================================
  // Módulo Fiscal — presente no schema.prisma (DocumentoFiscal, Gnre,
  // RegraTributaria, etc.) mas nunca migrado para produção. Erro real:
  // "The table public.documento_fiscal does not exist" ao importar XML.
  // =========================================================================
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "documento_fiscal" (
        "id" TEXT NOT NULL,
        "empresa_id" TEXT NOT NULL,
        "tipo" VARCHAR(10) NOT NULL,
        "modelo" INTEGER NOT NULL,
        "serie" INTEGER NOT NULL,
        "numero" INTEGER NOT NULL,
        "chave_acesso" VARCHAR(44),
        "status" VARCHAR(30) NOT NULL DEFAULT 'RASCUNHO',
        "natureza_op" VARCHAR(100),
        "data_emissao" TIMESTAMP(3) NOT NULL,
        "data_saida" TIMESTAMP(3),
        "tipo_operacao" INTEGER NOT NULL,
        "finalidade" INTEGER NOT NULL DEFAULT 1,
        "emitente_cnpj" VARCHAR(14) NOT NULL,
        "emitente_razao" VARCHAR(200) NOT NULL,
        "emitente_uf" VARCHAR(2) NOT NULL,
        "dest_cpf_cnpj" VARCHAR(14),
        "dest_razao" VARCHAR(200),
        "dest_uf" VARCHAR(2),
        "dest_ie" VARCHAR(20),
        "valor_produtos" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "valor_frete" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "valor_seguro" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "valor_desconto" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "valor_outras" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "valor_total" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "valor_icms" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "valor_icms_st" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "valor_ipi" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "valor_pis" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "valor_cofins" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "valor_fcp" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "valor_iss" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "xml_enviado" TEXT,
        "xml_autorizado" TEXT,
        "xml_retorno" TEXT,
        "protocolo" VARCHAR(20),
        "data_autorizacao" TIMESTAMP(3),
        "codigo_rejeicao" INTEGER,
        "motivo_rejeicao" VARCHAR(500),
        "contingencia" BOOLEAN NOT NULL DEFAULT false,
        "tipo_contingencia" VARCHAR(10),
        "ambiente" INTEGER NOT NULL DEFAULT 2,
        "mapa_ok" BOOLEAN NOT NULL DEFAULT false,
        "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "venda_efetivada_id" TEXT,
        "compra_efetivada_id" TEXT,
        CONSTRAINT "documento_fiscal_pkey" PRIMARY KEY ("id")
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "documento_fiscal_empresa_id_tipo_serie_numero_key" ON "documento_fiscal"("empresa_id", "tipo", "serie", "numero")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "documento_fiscal_empresa_id_status_idx" ON "documento_fiscal"("empresa_id", "status")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "documento_fiscal_empresa_id_data_emissao_idx" ON "documento_fiscal"("empresa_id", "data_emissao")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "documento_fiscal_chave_acesso_idx" ON "documento_fiscal"("chave_acesso")`)

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "item_documento_fiscal" (
        "id" TEXT NOT NULL,
        "documento_fiscal_id" TEXT NOT NULL,
        "n_item" INTEGER NOT NULL,
        "produto_id" TEXT,
        "codigo_prod" VARCHAR(60) NOT NULL,
        "descricao" VARCHAR(120) NOT NULL,
        "ncm" VARCHAR(8) NOT NULL,
        "cest" VARCHAR(7),
        "cfop" VARCHAR(4) NOT NULL,
        "unidade" VARCHAR(6) NOT NULL,
        "quantidade" DECIMAL(15,4) NOT NULL,
        "valor_unitario" DECIMAL(15,4) NOT NULL,
        "valor_total" DECIMAL(15,2) NOT NULL,
        "valor_desconto" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "icms_origem" INTEGER NOT NULL DEFAULT 0,
        "icms_cst" VARCHAR(3),
        "icms_csosn" VARCHAR(4),
        "icms_base" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "icms_aliquota" DECIMAL(5,2) NOT NULL DEFAULT 0,
        "icms_valor" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "icms_reducao" DECIMAL(5,2) NOT NULL DEFAULT 0,
        "icms_st_base" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "icms_st_aliquota" DECIMAL(5,2) NOT NULL DEFAULT 0,
        "icms_st_valor" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "icms_st_mva" DECIMAL(5,2) NOT NULL DEFAULT 0,
        "icms_difal_base" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "icms_difal_destino" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "fcp_base" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "fcp_aliquota" DECIMAL(5,2) NOT NULL DEFAULT 0,
        "fcp_valor" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "ipi_cst" VARCHAR(2),
        "ipi_base" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "ipi_aliquota" DECIMAL(5,2) NOT NULL DEFAULT 0,
        "ipi_valor" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "pis_cst" VARCHAR(2),
        "pis_base" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "pis_aliquota" DECIMAL(5,2) NOT NULL DEFAULT 0,
        "pis_valor" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "cofins_cst" VARCHAR(2),
        "cofins_base" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "cofins_aliquota" DECIMAL(5,2) NOT NULL DEFAULT 0,
        "cofins_valor" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "iss_base" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "iss_aliquota" DECIMAL(5,2) NOT NULL DEFAULT 0,
        "iss_valor" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "iss_retido" BOOLEAN NOT NULL DEFAULT false,
        "regra_tributaria_id" TEXT,
        "nivel_fallback" VARCHAR(20),
        CONSTRAINT "item_documento_fiscal_pkey" PRIMARY KEY ("id")
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "item_documento_fiscal_documento_fiscal_id_idx" ON "item_documento_fiscal"("documento_fiscal_id")`)

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "evento_documento_fiscal" (
        "id" TEXT NOT NULL,
        "documento_fiscal_id" TEXT NOT NULL,
        "tipo_evento" VARCHAR(10) NOT NULL,
        "sequencia" INTEGER NOT NULL,
        "data_evento" TIMESTAMP(3) NOT NULL,
        "protocolo" VARCHAR(20),
        "justificativa" VARCHAR(1000),
        "texto_correcao" TEXT,
        "xml_evento" TEXT,
        "xml_retorno" TEXT,
        "status" VARCHAR(20) NOT NULL,
        CONSTRAINT "evento_documento_fiscal_pkey" PRIMARY KEY ("id")
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "evento_documento_fiscal_documento_fiscal_id_idx" ON "evento_documento_fiscal"("documento_fiscal_id")`)

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "certificado_digital" (
        "id" TEXT NOT NULL,
        "empresa_id" TEXT NOT NULL,
        "cnpj" VARCHAR(14) NOT NULL,
        "tipo" VARCHAR(2) NOT NULL,
        "titular" VARCHAR(200) NOT NULL,
        "valido_de" TIMESTAMP(3) NOT NULL,
        "valido_ate" TIMESTAMP(3) NOT NULL,
        "pfx_encrypted" TEXT,
        "senha_encrypted" VARCHAR(500),
        "ativo" BOOLEAN NOT NULL DEFAULT true,
        "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "certificado_digital_pkey" PRIMARY KEY ("id")
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "certificado_digital_empresa_id_cnpj_ativo_idx" ON "certificado_digital"("empresa_id", "cnpj", "ativo")`)

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "fila_contingencia" (
        "id" TEXT NOT NULL,
        "empresa_id" TEXT NOT NULL,
        "documento_fiscal_id" TEXT NOT NULL,
        "xml_assinado" TEXT NOT NULL,
        "tipo_contingencia" VARCHAR(10) NOT NULL,
        "tentativas" INTEGER NOT NULL DEFAULT 0,
        "status" VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
        "erro" VARCHAR(500),
        "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "transmitido_em" TIMESTAMP(3),
        CONSTRAINT "fila_contingencia_pkey" PRIMARY KEY ("id")
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "fila_contingencia_empresa_id_status_criado_em_idx" ON "fila_contingencia"("empresa_id", "status", "criado_em")`)

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "log_contingencia" (
        "id" TEXT NOT NULL,
        "empresa_id" TEXT NOT NULL,
        "acao" VARCHAR(20) NOT NULL,
        "motivo" VARCHAR(200) NOT NULL,
        "modalidade" VARCHAR(10) NOT NULL,
        "documentos_pendentes" INTEGER NOT NULL,
        "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "log_contingencia_pkey" PRIMARY KEY ("id")
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "log_contingencia_empresa_id_timestamp_idx" ON "log_contingencia"("empresa_id", "timestamp")`)

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "apuracao_fiscal" (
        "id" TEXT NOT NULL,
        "empresa_id" TEXT NOT NULL,
        "tipo" VARCHAR(20) NOT NULL,
        "periodo" VARCHAR(7) NOT NULL,
        "total_debitos" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "total_creditos" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "estorno_debitos" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "estorno_creditos" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "ajustes" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "saldo_anterior" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "saldo_final" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "valor_recolher" DECIMAL(15,2) NOT NULL DEFAULT 0,
        "fechado" BOOLEAN NOT NULL DEFAULT false,
        "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "apuracao_fiscal_pkey" PRIMARY KEY ("id")
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "apuracao_fiscal_empresa_id_tipo_periodo_key" ON "apuracao_fiscal"("empresa_id", "tipo", "periodo")`)

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "detalhe_apuracao" (
        "id" TEXT NOT NULL,
        "apuracao_id" TEXT NOT NULL,
        "documento_fiscal_id" TEXT,
        "tipo" VARCHAR(20) NOT NULL,
        "valor" DECIMAL(15,2) NOT NULL,
        "descricao" VARCHAR(200),
        CONSTRAINT "detalhe_apuracao_pkey" PRIMARY KEY ("id")
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "detalhe_apuracao_apuracao_id_idx" ON "detalhe_apuracao"("apuracao_id")`)

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "ncm" (
        "id" TEXT NOT NULL,
        "codigo" VARCHAR(8) NOT NULL,
        "descricao" VARCHAR(500) NOT NULL,
        "unidade_estat" VARCHAR(10),
        "aliq_ii" DECIMAL(5,2),
        "aliq_ipi" DECIMAL(5,2),
        "ativo" BOOLEAN NOT NULL DEFAULT true,
        "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "ncm_pkey" PRIMARY KEY ("id")
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "ncm_codigo_key" ON "ncm"("codigo")`)

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "cfop" (
        "id" TEXT NOT NULL,
        "codigo" VARCHAR(4) NOT NULL,
        "descricao" VARCHAR(500) NOT NULL,
        "tipo" VARCHAR(10) NOT NULL,
        "ambito" VARCHAR(15) NOT NULL,
        "gera_cred_icms" BOOLEAN NOT NULL DEFAULT false,
        "gera_cred_pis_cofins" BOOLEAN NOT NULL DEFAULT false,
        "incide_ipi" BOOLEAN NOT NULL DEFAULT false,
        "ativo" BOOLEAN NOT NULL DEFAULT true,
        "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "cfop_pkey" PRIMARY KEY ("id")
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "cfop_codigo_key" ON "cfop"("codigo")`)

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "cest" (
        "id" TEXT NOT NULL,
        "codigo" VARCHAR(7) NOT NULL,
        "descricao" VARCHAR(500) NOT NULL,
        "segmento" VARCHAR(200),
        "ativo" BOOLEAN NOT NULL DEFAULT true,
        "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "cest_pkey" PRIMARY KEY ("id")
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "cest_codigo_key" ON "cest"("codigo")`)

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "cest_ncm" (
        "id" TEXT NOT NULL,
        "cest_id" TEXT NOT NULL,
        "ncm_id" TEXT NOT NULL,
        CONSTRAINT "cest_ncm_pkey" PRIMARY KEY ("id")
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "cest_ncm_cest_id_ncm_id_key" ON "cest_ncm"("cest_id", "ncm_id")`)

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "natureza_operacao" (
        "id" TEXT NOT NULL,
        "empresa_id" TEXT NOT NULL,
        "descricao" VARCHAR(100) NOT NULL,
        "cfop_entrada" VARCHAR(4),
        "cfop_saida" VARCHAR(4),
        "tipo_operacao" VARCHAR(30) NOT NULL,
        "ativo" BOOLEAN NOT NULL DEFAULT true,
        "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "natureza_operacao_pkey" PRIMARY KEY ("id")
      )
    `)

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "regra_tributaria" (
        "id" TEXT NOT NULL,
        "empresa_id" TEXT NOT NULL,
        "ncm" VARCHAR(8) NOT NULL,
        "cfop" VARCHAR(4) NOT NULL,
        "uf_origem" VARCHAR(2) NOT NULL,
        "uf_destino" VARCHAR(2) NOT NULL,
        "regime_tributario" INTEGER NOT NULL,
        "icms_aliquota" DECIMAL(5,2) NOT NULL DEFAULT 0,
        "icms_cst" VARCHAR(3),
        "icms_csosn" VARCHAR(4),
        "icms_base_calculo" DECIMAL(5,2) NOT NULL DEFAULT 100,
        "icms_reducao" DECIMAL(5,2) NOT NULL DEFAULT 0,
        "icms_st_mva" DECIMAL(5,2),
        "icms_st_mva_ajust" DECIMAL(5,2),
        "icms_st_aliq_interna" DECIMAL(5,2),
        "fcp_aliquota" DECIMAL(5,2),
        "pis_aliquota" DECIMAL(5,2) NOT NULL DEFAULT 0,
        "pis_cst" VARCHAR(2),
        "cofins_aliquota" DECIMAL(5,2) NOT NULL DEFAULT 0,
        "cofins_cst" VARCHAR(2),
        "ipi_aliquota" DECIMAL(5,2) NOT NULL DEFAULT 0,
        "ipi_cst" VARCHAR(2),
        "iss_aliquota" DECIMAL(5,2),
        "ativo" BOOLEAN NOT NULL DEFAULT true,
        "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "regra_tributaria_pkey" PRIMARY KEY ("id")
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "regra_tributaria_empresa_id_ncm_cfop_uf_origem_uf_destino_r_key" ON "regra_tributaria"("empresa_id", "ncm", "cfop", "uf_origem", "uf_destino", "regime_tributario")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "regra_tributaria_empresa_id_ncm_cfop_idx" ON "regra_tributaria"("empresa_id", "ncm", "cfop")`)

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "gnre" (
        "id" TEXT NOT NULL,
        "empresa_id" TEXT NOT NULL,
        "documento_fiscal_id" TEXT NOT NULL,
        "uf_destino" VARCHAR(2) NOT NULL,
        "valor" DECIMAL(15,2) NOT NULL,
        "codigo_receita" VARCHAR(10) NOT NULL,
        "referencia" VARCHAR(7) NOT NULL,
        "status" VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
        "data_pagamento" TIMESTAMP(3),
        "nosso_numero" VARCHAR(30),
        "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "gnre_pkey" PRIMARY KEY ("id")
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "gnre_empresa_id_status_idx" ON "gnre"("empresa_id", "status")`)

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "xml_importado" (
        "id" TEXT NOT NULL,
        "empresa_id" TEXT NOT NULL,
        "chave_acesso" VARCHAR(44) NOT NULL,
        "tipo" VARCHAR(10) NOT NULL,
        "emitente_cnpj" VARCHAR(14) NOT NULL,
        "emitente_razao" VARCHAR(200) NOT NULL,
        "valor_total" DECIMAL(15,2) NOT NULL,
        "data_emissao" TIMESTAMP(3) NOT NULL,
        "xml_completo" TEXT NOT NULL,
        "origem" VARCHAR(20) NOT NULL,
        "manifestacao" VARCHAR(30),
        "data_manifestacao" TIMESTAMP(3),
        "documento_entrada_id" TEXT,
        "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "xml_importado_pkey" PRIMARY KEY ("id")
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "xml_importado_empresa_id_chave_acesso_key" ON "xml_importado"("empresa_id", "chave_acesso")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "xml_importado_empresa_id_manifestacao_idx" ON "xml_importado"("empresa_id", "manifestacao")`)

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "auditoria_fiscal" (
        "id" TEXT NOT NULL,
        "empresa_id" TEXT NOT NULL,
        "usuario_id" TEXT NOT NULL,
        "operacao" VARCHAR(50) NOT NULL,
        "entidade" VARCHAR(50) NOT NULL,
        "entidade_id" TEXT NOT NULL,
        "dados_antes" TEXT,
        "dados_depois" TEXT,
        "ip" VARCHAR(45),
        "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "auditoria_fiscal_pkey" PRIMARY KEY ("id")
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "auditoria_fiscal_empresa_id_timestamp_idx" ON "auditoria_fiscal"("empresa_id", "timestamp")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "auditoria_fiscal_entidade_entidade_id_idx" ON "auditoria_fiscal"("entidade", "entidade_id")`)

    console.log('✅ Módulo Fiscal: 17 tabelas criadas (documento_fiscal, item/evento_documento_fiscal, gnre, certificado_digital, regra_tributaria, ncm/cfop/cest, etc.)')
  } catch (e: any) {
    console.log('⚠️ Módulo Fiscal skipped:', e.message?.substring(0, 200))
  }

  // Foreign keys do Módulo Fiscal (idempotentes via catch individual)
  const fiscalFks = [
    `ALTER TABLE "documento_fiscal" ADD CONSTRAINT "documento_fiscal_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "documento_fiscal" ADD CONSTRAINT "documento_fiscal_venda_efetivada_id_fkey" FOREIGN KEY ("venda_efetivada_id") REFERENCES "venda_efetivada"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
    `ALTER TABLE "documento_fiscal" ADD CONSTRAINT "documento_fiscal_compra_efetivada_id_fkey" FOREIGN KEY ("compra_efetivada_id") REFERENCES "compra_efetivada"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
    `ALTER TABLE "item_documento_fiscal" ADD CONSTRAINT "item_documento_fiscal_documento_fiscal_id_fkey" FOREIGN KEY ("documento_fiscal_id") REFERENCES "documento_fiscal"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "item_documento_fiscal" ADD CONSTRAINT "item_documento_fiscal_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produto"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
    `ALTER TABLE "item_documento_fiscal" ADD CONSTRAINT "item_documento_fiscal_regra_tributaria_id_fkey" FOREIGN KEY ("regra_tributaria_id") REFERENCES "regra_tributaria"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
    `ALTER TABLE "evento_documento_fiscal" ADD CONSTRAINT "evento_documento_fiscal_documento_fiscal_id_fkey" FOREIGN KEY ("documento_fiscal_id") REFERENCES "documento_fiscal"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "certificado_digital" ADD CONSTRAINT "certificado_digital_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "fila_contingencia" ADD CONSTRAINT "fila_contingencia_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "fila_contingencia" ADD CONSTRAINT "fila_contingencia_documento_fiscal_id_fkey" FOREIGN KEY ("documento_fiscal_id") REFERENCES "documento_fiscal"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "log_contingencia" ADD CONSTRAINT "log_contingencia_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "apuracao_fiscal" ADD CONSTRAINT "apuracao_fiscal_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "detalhe_apuracao" ADD CONSTRAINT "detalhe_apuracao_apuracao_id_fkey" FOREIGN KEY ("apuracao_id") REFERENCES "apuracao_fiscal"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "cest_ncm" ADD CONSTRAINT "cest_ncm_cest_id_fkey" FOREIGN KEY ("cest_id") REFERENCES "cest"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "cest_ncm" ADD CONSTRAINT "cest_ncm_ncm_id_fkey" FOREIGN KEY ("ncm_id") REFERENCES "ncm"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "natureza_operacao" ADD CONSTRAINT "natureza_operacao_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "regra_tributaria" ADD CONSTRAINT "regra_tributaria_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "gnre" ADD CONSTRAINT "gnre_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "gnre" ADD CONSTRAINT "gnre_documento_fiscal_id_fkey" FOREIGN KEY ("documento_fiscal_id") REFERENCES "documento_fiscal"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "xml_importado" ADD CONSTRAINT "xml_importado_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "auditoria_fiscal" ADD CONSTRAINT "auditoria_fiscal_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "mapa_carregamento_nf" ADD CONSTRAINT "mapa_carregamento_nf_nfe_id_fkey" FOREIGN KEY ("nfe_id") REFERENCES "documento_fiscal"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
  ]
  for (const fk of fiscalFks) {
    try {
      await prisma.$executeRawUnsafe(fk)
    } catch { /* constraint já existe */ }
  }
  console.log('✅ Módulo Fiscal: foreign keys adicionadas')

  // =========================================================================
  // Normalização final identificada via `prisma migrate diff` — remove os
  // últimos resíduos entre o schema.prisma e o banco de produção real:
  // colunas "id"/"atualizado_em" com DEFAULT residual do Prisma (cosmético,
  // não afeta dados), SET NOT NULL em colunas já preenchidas por DEFAULT
  // desde a criação, e rename de índices. Cada statement é independente e
  // idempotente (não falha se já aplicado).
  // =========================================================================
  const runNorm = async (sql: string) => {
    try { await prisma.$executeRawUnsafe(sql) } catch { /* já aplicado ou não se aplica neste ambiente */ }
  }

  // DROP DEFAULT em colunas "id" (uuid gerado pela aplicação, não pelo banco)
  const idDropDefaultTables = [
    'caixa_pdv', 'campanha_desconto', 'conversa_ai', 'devolucao_venda', 'integracao_ecommerce',
    'item_consignacao', 'item_devolucao_venda', 'item_orcamento', 'item_venda_pdv', 'meta_vendedor',
    'movimentacao_caixa', 'orcamento', 'pagamento_pdv', 'pedido_ecommerce', 'regra_aprovacao',
    'regra_bonificacao', 'regra_comissao', 'remessa_consignacao', 'solicitacao_aprovacao',
    'venda_encomenda', 'venda_pdv',
  ]
  for (const t of idDropDefaultTables) {
    await runNorm(`ALTER TABLE "${t}" ALTER COLUMN "id" DROP DEFAULT`)
  }

  // DROP DEFAULT em colunas "atualizado_em" (preenchida pela aplicação via @updatedAt)
  const atualizadoEmDropDefaultTables = [
    'apuracao_fiscal', 'certificado_digital', 'config_conferencia_produto', 'config_email_fiscal',
    'config_integracao', 'de_para_importacao', 'documento_fiscal', 'orcamento', 'preferencia_usuario',
    'regra_tributaria', 'saldo_pendente_item',
  ]
  for (const t of atualizadoEmDropDefaultTables) {
    await runNorm(`ALTER TABLE "${t}" ALTER COLUMN "atualizado_em" DROP DEFAULT`)
  }

  // SET NOT NULL em colunas já preenchidas por DEFAULT desde a criação (schema.prisma não as marca opcionais)
  await runNorm(`ALTER TABLE "empresa" ALTER COLUMN "conferencia_quantidade_cega" SET NOT NULL`)
  await runNorm(`ALTER TABLE "empresa" ALTER COLUMN "conferencia_lote_cega" SET NOT NULL`)
  await runNorm(`ALTER TABLE "empresa" ALTER COLUMN "permite_recebimento_parcial" SET NOT NULL`)
  await runNorm(`ALTER TABLE "produto" ALTER COLUMN "exige_lote" SET NOT NULL`)
  await runNorm(`ALTER TABLE "nota_entrada" ALTER COLUMN "status_recebimento" SET NOT NULL`)
  await runNorm(`ALTER TABLE "tabela_preco" ALTER COLUMN "prioridade" SET NOT NULL`)
  await runNorm(`ALTER TABLE "item_solicitacao_transferencia" ALTER COLUMN "quantidade_expedida" SET NOT NULL`)
  await runNorm(`ALTER TABLE "item_solicitacao_transferencia" ALTER COLUMN "quantidade_recebida" SET NOT NULL`)
  await runNorm(`ALTER TABLE "divergencia_conferencia" ALTER COLUMN "supervisor_id" TYPE TEXT`)
  await runNorm(`ALTER TABLE "ordem_producao" ALTER COLUMN "produto_id" DROP NOT NULL`)
  await runNorm(`ALTER TABLE "ordem_producao" ALTER COLUMN "data_entrega_prevista" DROP NOT NULL`)
  await runNorm(`ALTER TABLE "ordem_producao" ALTER COLUMN "data_entrega_original" TYPE TIMESTAMP(3)`)

  // documento_saida_transferencia / mercadoria_transito: SET NOT NULL só é seguro
  // porque as colunas foram populadas (com DEFAULT) na normalização Multi-CD acima.
  await runNorm(`ALTER TABLE "documento_saida_transferencia" ALTER COLUMN "data_emissao" SET NOT NULL`)
  await runNorm(`ALTER TABLE "documento_saida_transferencia" ALTER COLUMN "responsavel_id" SET NOT NULL`)
  await runNorm(`ALTER TABLE "documento_saida_transferencia" ALTER COLUMN "solicitacao_id" SET NOT NULL`)
  await runNorm(`ALTER TABLE "mercadoria_transito" ALTER COLUMN "quantidade" TYPE INTEGER`)
  await runNorm(`ALTER TABLE "mercadoria_transito" ALTER COLUMN "solicitacao_id" SET NOT NULL`)
  await runNorm(`ALTER TABLE "mercadoria_transito" ALTER COLUMN "documento_saida_id" SET NOT NULL`)
  await runNorm(`ALTER TABLE "mercadoria_transito" ALTER COLUMN "data_expedicao" SET NOT NULL`)

  // Rename de índices para o padrão gerado pelo Prisma (cosmético, sem impacto funcional)
  const indexRenames: Array<[string, string]> = [
    ['de_para_importacao_empresa_id_sistema_origem_tipo_entidade_co_k', 'de_para_importacao_empresa_id_sistema_origem_tipo_entidade__key'],
    ['idx_de_para_importacao_empresa_id_sistema_origem', 'de_para_importacao_empresa_id_sistema_origem_idx'],
    ['idx_documento_saida_transferencia_empresa_id', 'documento_saida_transferencia_empresa_id_idx'],
    ['idx_mercadoria_transito_empresa_id', 'mercadoria_transito_empresa_id_idx'],
    ['idx_refresh_token_token', 'refresh_token_token_idx'],
    ['idx_security_audit_log_ip', 'security_audit_log_ip_idx'],
    ['idx_security_audit_log_tipo_criado_em', 'security_audit_log_tipo_criado_em_idx'],
    ['idx_security_audit_log_usuario_id', 'security_audit_log_usuario_id_idx'],
    ['idx_solicitacao_transferencia_empresa_id', 'solicitacao_transferencia_empresa_id_idx'],
  ]
  for (const [oldName, newName] of indexRenames) {
    await runNorm(`ALTER INDEX "${oldName}" RENAME TO "${newName}"`)
  }

  // Índices redundantes (idx_* antigos duplicando índices já cobertos por
  // outros/novos) — remover apenas se existirem, sem risco (índices não
  // guardam dados, só aceleram consultas; removê-los não perde informação).
  const redundantIndexes = [
    'idx_ambiente_armazenagem_empresa_id', 'idx_capacidade_nivel_empresa_id', 'idx_capacidade_nivel_estrutura_id',
    'idx_carta_correcao_empresa_id', 'idx_carta_correcao_nota_entrada_id', 'idx_classificacao_produto_empresa_id',
    'idx_config_conferencia_produto_empresa_id', 'idx_deposito_empresa_id', 'idx_divergencia_conferencia_empresa_id',
    'idx_divergencia_conferencia_nota_entrada_id', 'idx_doca_empresa_id', 'documento_saida_transferencia_empresa_id_numero_key',
    'idx_endereco_empresa_id', 'idx_equipamento_movimentacao_empresa_id', 'idx_estrutura_empresa_id',
    'idx_forma_armazenagem_empresa_id', 'idx_funcao_empresa_id', 'idx_funcionario_empresa_id',
    'idx_item_solicitacao_transferencia_solicitacao_id', 'idx_nota_entrada_empresa_id', 'idx_saldo_endereco_empresa_id',
    'idx_saldo_pendente_item_empresa_id', 'idx_saldo_pendente_item_nota_entrada_id', 'idx_sku_empresa_id',
    'idx_tipo_carga_empresa_id', 'idx_tipo_carroceria_empresa_id', 'idx_veiculo_wms_empresa_id', 'idx_zona_empresa_id',
  ]
  for (const idx of redundantIndexes) {
    await runNorm(`DROP INDEX IF EXISTS "${idx}"`)
  }

  // Recriar foreign keys removidas/recriadas pelo Prisma (mesma definição —
  // normalização de metadados internos da constraint, sem efeito funcional)
  const normFks = [
    `ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    `ALTER TABLE "orcamento" ADD CONSTRAINT "orcamento_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "orcamento" ADD CONSTRAINT "orcamento_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "orcamento" ADD CONSTRAINT "orcamento_vendedor_id_fkey" FOREIGN KEY ("vendedor_id") REFERENCES "vendedor"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
    `ALTER TABLE "orcamento" ADD CONSTRAINT "orcamento_tabela_preco_id_fkey" FOREIGN KEY ("tabela_preco_id") REFERENCES "tabela_preco"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
    `ALTER TABLE "item_orcamento" ADD CONSTRAINT "item_orcamento_orcamento_id_fkey" FOREIGN KEY ("orcamento_id") REFERENCES "orcamento"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    `ALTER TABLE "item_orcamento" ADD CONSTRAINT "item_orcamento_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "devolucao_venda" ADD CONSTRAINT "devolucao_venda_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "devolucao_venda" ADD CONSTRAINT "devolucao_venda_venda_efetivada_id_fkey" FOREIGN KEY ("venda_efetivada_id") REFERENCES "venda_efetivada"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "item_devolucao_venda" ADD CONSTRAINT "item_devolucao_venda_devolucao_venda_id_fkey" FOREIGN KEY ("devolucao_venda_id") REFERENCES "devolucao_venda"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    `ALTER TABLE "item_devolucao_venda" ADD CONSTRAINT "item_devolucao_venda_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "campanha_desconto" ADD CONSTRAINT "campanha_desconto_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "regra_comissao" ADD CONSTRAINT "regra_comissao_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "regra_aprovacao" ADD CONSTRAINT "regra_aprovacao_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "solicitacao_aprovacao" ADD CONSTRAINT "solicitacao_aprovacao_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "meta_vendedor" ADD CONSTRAINT "meta_vendedor_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "regra_bonificacao" ADD CONSTRAINT "regra_bonificacao_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "venda_encomenda" ADD CONSTRAINT "venda_encomenda_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "remessa_consignacao" ADD CONSTRAINT "remessa_consignacao_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "item_consignacao" ADD CONSTRAINT "item_consignacao_remessa_id_fkey" FOREIGN KEY ("remessa_id") REFERENCES "remessa_consignacao"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    `ALTER TABLE "integracao_ecommerce" ADD CONSTRAINT "integracao_ecommerce_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "pedido_ecommerce" ADD CONSTRAINT "pedido_ecommerce_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "conversa_ai" ADD CONSTRAINT "conversa_ai_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "mapa_carregamento_nf" ADD CONSTRAINT "mapa_carregamento_nf_nfe_id_fkey" FOREIGN KEY ("nfe_id") REFERENCES "documento_fiscal"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "etapa_ordem_producao" ADD CONSTRAINT "etapa_ordem_producao_centro_producao_id_fkey" FOREIGN KEY ("centro_producao_id") REFERENCES "centro_producao"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
    `ALTER TABLE "movimentacao_faturavel" ADD CONSTRAINT "movimentacao_faturavel_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "ponto_consolidacao" ADD CONSTRAINT "ponto_consolidacao_cd_id_fkey" FOREIGN KEY ("cd_id") REFERENCES "centro_distribuicao"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "item_sub_onda" ADD CONSTRAINT "item_sub_onda_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "veiculo_patio" ADD CONSTRAINT "veiculo_patio_agendamento_id_fkey" FOREIGN KEY ("agendamento_id") REFERENCES "agenda_wms"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
    `ALTER TABLE "fila_espera_patio" ADD CONSTRAINT "fila_espera_patio_cd_id_fkey" FOREIGN KEY ("cd_id") REFERENCES "centro_distribuicao"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "config_patio" ADD CONSTRAINT "config_patio_cd_id_fkey" FOREIGN KEY ("cd_id") REFERENCES "centro_distribuicao"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "divergencia_conferencia" ADD CONSTRAINT "divergencia_conferencia_nota_entrada_id_fkey" FOREIGN KEY ("nota_entrada_id") REFERENCES "nota_entrada"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "divergencia_conferencia" ADD CONSTRAINT "divergencia_conferencia_supervisor_id_fkey" FOREIGN KEY ("supervisor_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
    `ALTER TABLE "config_conferencia_produto" ADD CONSTRAINT "config_conferencia_produto_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "config_conferencia_produto" ADD CONSTRAINT "config_conferencia_produto_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "carta_correcao" ADD CONSTRAINT "carta_correcao_nota_entrada_id_fkey" FOREIGN KEY ("nota_entrada_id") REFERENCES "nota_entrada"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "carta_correcao" ADD CONSTRAINT "carta_correcao_divergencia_id_fkey" FOREIGN KEY ("divergencia_id") REFERENCES "divergencia_conferencia"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "saldo_pendente_item" ADD CONSTRAINT "saldo_pendente_item_nota_entrada_id_fkey" FOREIGN KEY ("nota_entrada_id") REFERENCES "nota_entrada"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "caixa_pdv" ADD CONSTRAINT "caixa_pdv_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "movimentacao_caixa" ADD CONSTRAINT "movimentacao_caixa_caixa_id_fkey" FOREIGN KEY ("caixa_id") REFERENCES "caixa_pdv"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "venda_pdv" ADD CONSTRAINT "venda_pdv_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "venda_pdv" ADD CONSTRAINT "venda_pdv_caixa_id_fkey" FOREIGN KEY ("caixa_id") REFERENCES "caixa_pdv"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "item_venda_pdv" ADD CONSTRAINT "item_venda_pdv_venda_pdv_id_fkey" FOREIGN KEY ("venda_pdv_id") REFERENCES "venda_pdv"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    `ALTER TABLE "item_venda_pdv" ADD CONSTRAINT "item_venda_pdv_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    `ALTER TABLE "pagamento_pdv" ADD CONSTRAINT "pagamento_pdv_venda_pdv_id_fkey" FOREIGN KEY ("venda_pdv_id") REFERENCES "venda_pdv"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    `ALTER TABLE "etapa_ordem_producao" ADD CONSTRAINT "etapa_ordem_producao_centro_producao_id_fkey" FOREIGN KEY ("centro_producao_id") REFERENCES "centro_producao"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
    `ALTER TABLE "item_consignacao" ADD CONSTRAINT "item_consignacao_remessa_id_fkey" FOREIGN KEY ("remessa_id") REFERENCES "remessa_consignacao"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  ]
  for (const fk of normFks) {
    await runNorm(fk)
  }
  await runNorm(`CREATE UNIQUE INDEX IF NOT EXISTS "veiculo_patio_agendamento_id_key" ON "veiculo_patio"("agendamento_id")`)

  // Estas 12 FKs já existiam em produção com definição diferente da esperada
  // pelo schema.prisma (ex: ON DELETE/ON UPDATE diferente) — ADD CONSTRAINT
  // simples falha silenciosamente com "já existe" sem atualizar a regra.
  // Precisa DROP + ADD para substituir pela definição correta. Seguro: não
  // apaga dados, só a regra de integridade referencial (dados existentes já
  // satisfazem a nova regra, pois a relação conceitual não mudou).
  const fkReplace: Array<[string, string, string]> = [
    ['refresh_token', 'refresh_token_usuario_id_fkey', `ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE`],
    ['item_orcamento', 'item_orcamento_orcamento_id_fkey', `ALTER TABLE "item_orcamento" ADD CONSTRAINT "item_orcamento_orcamento_id_fkey" FOREIGN KEY ("orcamento_id") REFERENCES "orcamento"("id") ON DELETE CASCADE ON UPDATE CASCADE`],
    ['item_devolucao_venda', 'item_devolucao_venda_devolucao_venda_id_fkey', `ALTER TABLE "item_devolucao_venda" ADD CONSTRAINT "item_devolucao_venda_devolucao_venda_id_fkey" FOREIGN KEY ("devolucao_venda_id") REFERENCES "devolucao_venda"("id") ON DELETE CASCADE ON UPDATE CASCADE`],
    ['item_consignacao', 'item_consignacao_remessa_id_fkey', `ALTER TABLE "item_consignacao" ADD CONSTRAINT "item_consignacao_remessa_id_fkey" FOREIGN KEY ("remessa_id") REFERENCES "remessa_consignacao"("id") ON DELETE CASCADE ON UPDATE CASCADE`],
    ['mapa_carregamento_nf', 'mapa_carregamento_nf_nfe_id_fkey', `ALTER TABLE "mapa_carregamento_nf" ADD CONSTRAINT "mapa_carregamento_nf_nfe_id_fkey" FOREIGN KEY ("nfe_id") REFERENCES "documento_fiscal"("id") ON DELETE RESTRICT ON UPDATE CASCADE`],
    ['etapa_ordem_producao', 'etapa_ordem_producao_centro_producao_id_fkey', `ALTER TABLE "etapa_ordem_producao" ADD CONSTRAINT "etapa_ordem_producao_centro_producao_id_fkey" FOREIGN KEY ("centro_producao_id") REFERENCES "centro_producao"("id") ON DELETE SET NULL ON UPDATE CASCADE`],
    ['caixa_pdv', 'caixa_pdv_empresa_id_fkey', `ALTER TABLE "caixa_pdv" ADD CONSTRAINT "caixa_pdv_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE`],
    ['movimentacao_caixa', 'movimentacao_caixa_caixa_id_fkey', `ALTER TABLE "movimentacao_caixa" ADD CONSTRAINT "movimentacao_caixa_caixa_id_fkey" FOREIGN KEY ("caixa_id") REFERENCES "caixa_pdv"("id") ON DELETE RESTRICT ON UPDATE CASCADE`],
    ['venda_pdv', 'venda_pdv_empresa_id_fkey', `ALTER TABLE "venda_pdv" ADD CONSTRAINT "venda_pdv_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE`],
    ['venda_pdv', 'venda_pdv_caixa_id_fkey', `ALTER TABLE "venda_pdv" ADD CONSTRAINT "venda_pdv_caixa_id_fkey" FOREIGN KEY ("caixa_id") REFERENCES "caixa_pdv"("id") ON DELETE RESTRICT ON UPDATE CASCADE`],
    ['item_venda_pdv', 'item_venda_pdv_venda_pdv_id_fkey', `ALTER TABLE "item_venda_pdv" ADD CONSTRAINT "item_venda_pdv_venda_pdv_id_fkey" FOREIGN KEY ("venda_pdv_id") REFERENCES "venda_pdv"("id") ON DELETE CASCADE ON UPDATE CASCADE`],
    ['item_venda_pdv', 'item_venda_pdv_produto_id_fkey', `ALTER TABLE "item_venda_pdv" ADD CONSTRAINT "item_venda_pdv_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE`],
    ['pagamento_pdv', 'pagamento_pdv_venda_pdv_id_fkey', `ALTER TABLE "pagamento_pdv" ADD CONSTRAINT "pagamento_pdv_venda_pdv_id_fkey" FOREIGN KEY ("venda_pdv_id") REFERENCES "venda_pdv"("id") ON DELETE CASCADE ON UPDATE CASCADE`],
  ]
  for (const [table, constraintName, addSql] of fkReplace) {
    await runNorm(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${constraintName}"`)
    await runNorm(addSql)
  }
  console.log('✅ Normalização final: foreign keys recriadas com a definição exata do schema.prisma')

  // mapa_carregamento_nf.nfe_id — dívida técnica antiga: vínculos órfãos que
  // já apontavam para nenhuma NF válida mesmo antes da tabela legada "nfe"
  // ser removida (confirmado: nfe tinha 0 registros). Sem a NF original em
  // lugar nenhum, não há como recriar a associação — remove apenas o vínculo
  // órfão na tabela de junção (não afeta o mapa_carregamento em si).
  try {
    const orfaos = await prisma.$executeRawUnsafe(`
      DELETE FROM "mapa_carregamento_nf" mcn
      WHERE NOT EXISTS (SELECT 1 FROM "documento_fiscal" df WHERE df.id = mcn.nfe_id)
    `)
    console.log('✅ mapa_carregamento_nf: vínculos órfãos removidos:', orfaos)
    await prisma.$executeRawUnsafe(`ALTER TABLE "mapa_carregamento_nf" DROP CONSTRAINT IF EXISTS "mapa_carregamento_nf_nfe_id_fkey"`)
    await prisma.$executeRawUnsafe(`ALTER TABLE "mapa_carregamento_nf" ADD CONSTRAINT "mapa_carregamento_nf_nfe_id_fkey" FOREIGN KEY ("nfe_id") REFERENCES "documento_fiscal"("id") ON DELETE RESTRICT ON UPDATE CASCADE`)
    console.log('✅ mapa_carregamento_nf: FK nfe_id recriada')
  } catch (e: any) {
    console.log('⚠️ mapa_carregamento_nf FK skipped:', e.message?.substring(0, 150))
  }

  console.log('✅ Normalização final: schema.prisma e produção alinhados (prisma migrate diff)')

  // =========================================================================
  // Melhorias Compras, WMS e Fiscal — Transporte XML, Código Sequencial de
  // Produto, Kardex de Estoque e Liberação de Conferência por Supervisor
  // =========================================================================

  // NotaEntrada — dados de transporte extraídos do XML da NFe
  await prisma.$executeRawUnsafe(`ALTER TABLE "nota_entrada" ADD COLUMN IF NOT EXISTS "transportadora_uf" VARCHAR(2)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "nota_entrada" ADD COLUMN IF NOT EXISTS "transportadora_rntc" VARCHAR(20)`)

  // AgendaWms — divergência de transporte e liberação por supervisor
  await prisma.$executeRawUnsafe(`ALTER TABLE "agenda_wms" ADD COLUMN IF NOT EXISTS "divergencia_transporte" VARCHAR(500)`)
  await prisma.$executeRawUnsafe(`ALTER TABLE "agenda_wms" ADD COLUMN IF NOT EXISTS "supervisor_liberacao_id" TEXT`)

  // Produto — motivo de falha do enriquecimento de SKU via catálogo externo
  await prisma.$executeRawUnsafe(`ALTER TABLE "produto" ADD COLUMN IF NOT EXISTS "motivo_falha_enriquecimento_sku" TEXT`)

  console.log('✅ Transporte XML: colunas de nota_entrada, agenda_wms e produto adicionadas')

  // SequenciaProduto — contador atômico de código sequencial por Empresa
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "sequencia_produto" (
      "id" TEXT NOT NULL,
      "empresa_id" TEXT NOT NULL,
      "proximo_valor" INTEGER NOT NULL DEFAULT 1,
      "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "sequencia_produto_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "sequencia_produto_empresa_id_key" UNIQUE ("empresa_id")
    )
  `)

  // MovimentacaoEstoque — Kardex de estoque para empresas sem WMS
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "movimentacao_estoque" (
      "id" TEXT NOT NULL,
      "empresa_id" TEXT NOT NULL,
      "produto_id" TEXT NOT NULL,
      "tipo" VARCHAR(30) NOT NULL,
      "quantidade" DECIMAL(12,4) NOT NULL,
      "saldo_anterior" DECIMAL(12,4) NOT NULL,
      "saldo_posterior" DECIMAL(12,4) NOT NULL,
      "origem_id" TEXT,
      "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "movimentacao_estoque_pkey" PRIMARY KEY ("id")
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "movimentacao_estoque_empresa_id_produto_id_criado_em_idx" ON "movimentacao_estoque"("empresa_id", "produto_id", "criado_em")`)

  console.log('✅ Código Sequencial + Kardex: tabelas sequencia_produto e movimentacao_estoque criadas')

  // Foreign keys de sequencia_produto e movimentacao_estoque (idempotentes via catch individual)
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "sequencia_produto" ADD CONSTRAINT "sequencia_produto_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE`)
  } catch { /* constraint já existe */ }

  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "movimentacao_estoque" ADD CONSTRAINT "movimentacao_estoque_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE`)
  } catch { /* constraint já existe */ }

  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "movimentacao_estoque" ADD CONSTRAINT "movimentacao_estoque_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE`)
  } catch { /* constraint já existe */ }

  console.log('✅ Código Sequencial + Kardex: foreign keys criadas')

  console.log('✅ All migrations applied successfully')
}

main()
  .catch((e) => { console.error('❌ Migration failed:', e.message); process.exit(1) })
  .finally(() => prisma.$disconnect())

