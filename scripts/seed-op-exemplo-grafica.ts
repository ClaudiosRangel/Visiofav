/**
 * Script de seed: Cria uma OP de exemplo baseada na OP 2.682 da Carton Wega
 * (indústria gráfica de embalagens).
 *
 * Uso: npx tsx scripts/seed-op-exemplo-grafica.ts
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // Busca empresa existente
  const empresa = await prisma.empresa.findFirst()
  if (!empresa) { console.error('❌ Nenhuma empresa cadastrada'); return }

  const empresaId = empresa.id
  console.log(`✓ Empresa: ${empresa.razaoSocial} (${empresaId})`)

  // =========================================================================
  // 1. CADASTRO DO CLIENTE
  // =========================================================================
  const cliente = await prisma.cliente.upsert({
    where: { empresaId_cpfCnpj: { empresaId, cpfCnpj: '33000167000101' } },
    create: {
      empresaId,
      razaoSocial: 'COMPACTOR INDUSTRIA E COMERCIO LTDA',
      nomeFantasia: 'COMPACTOR',
      cpfCnpj: '33000167000101',
      cidade: 'São Gonçalo',
      uf: 'RJ',
    },
    update: {},
  })
  console.log(`✓ Cliente: ${cliente.nomeFantasia} (${cliente.id})`)

  // =========================================================================
  // 2. CADASTRO DOS PRODUTOS
  // =========================================================================

  // Produto acabado (embalagem)
  const produtoAcabado = await prisma.produto.upsert({
    where: { empresaId_codigo: { empresaId, codigo: 'CX-P50-ESF07' } },
    create: {
      empresaId,
      codigo: 'CX-P50-ESF07',
      nome: 'CAIXA P/50 ESF. 07 VERDE CARTO - Cartucho',
      unidade: 'UN',
      classificacaoPcp: 'PRODUTO_ACABADO',
      tipoFisico: 'UNIDADE_PADRAO',
    },
    update: { classificacaoPcp: 'PRODUTO_ACABADO', tipoFisico: 'UNIDADE_PADRAO' },
  })

  // Matéria-prima: Papel Cartão
  const papelCartao = await prisma.produto.upsert({
    where: { empresaId_codigo: { empresaId, codigo: 'STORA-TRAMB-240' } },
    create: {
      empresaId,
      codigo: 'STORA-TRAMB-240',
      nome: 'Stora Trambrite 240g - Bobina 101,6cm',
      unidade: 'KG',
      classificacaoPcp: 'MATERIA_PRIMA',
      tipoFisico: 'FISICO_LINEAR',
    },
    update: { classificacaoPcp: 'MATERIA_PRIMA', tipoFisico: 'FISICO_LINEAR' },
  })

  // Tinta CMYK (Escala)
  const tintaCmyk = await prisma.produto.upsert({
    where: { empresaId_codigo: { empresaId, codigo: 'TINTA-CMYK-ESC' } },
    create: {
      empresaId,
      codigo: 'TINTA-CMYK-ESC',
      nome: 'Tinta Escala CMYK (Offset)',
      unidade: 'KG',
      classificacaoPcp: 'INSUMO',
      tipoFisico: 'LIQUIDO',
    },
    update: { classificacaoPcp: 'INSUMO', tipoFisico: 'LIQUIDO' },
  })

  // Tinta Pantone
  const tintaPantone = await prisma.produto.upsert({
    where: { empresaId_codigo: { empresaId, codigo: 'TINTA-PAN-CF01' } },
    create: {
      empresaId,
      codigo: 'TINTA-PAN-CF01',
      nome: 'Pantone 01 - PRETO COMP. CF01',
      unidade: 'KG',
      classificacaoPcp: 'INSUMO',
      tipoFisico: 'LIQUIDO',
    },
    update: { classificacaoPcp: 'INSUMO', tipoFisico: 'LIQUIDO' },
  })

  // Chapas CTP
  const chapas = await prisma.produto.upsert({
    where: { empresaId_codigo: { empresaId, codigo: 'CHAPA-CTP-CD' } },
    create: {
      empresaId,
      codigo: 'CHAPA-CTP-CD',
      nome: 'Chapa CTP - Heidelberg CD',
      unidade: 'PC',
      classificacaoPcp: 'INSUMO',
      tipoFisico: 'UNIDADE_PADRAO',
    },
    update: { classificacaoPcp: 'INSUMO', tipoFisico: 'UNIDADE_PADRAO' },
  })

  // Cola
  const cola = await prisma.produto.upsert({
    where: { empresaId_codigo: { empresaId, codigo: 'COLA-BRANCA-146' } },
    create: {
      empresaId,
      codigo: 'COLA-BRANCA-146',
      nome: 'Cola Branca (146 mm)',
      unidade: 'KG',
      classificacaoPcp: 'INSUMO',
      tipoFisico: 'LIQUIDO',
    },
    update: { classificacaoPcp: 'INSUMO', tipoFisico: 'LIQUIDO' },
  })

  // Verniz
  const verniz = await prisma.produto.upsert({
    where: { empresaId_codigo: { empresaId, codigo: 'VERNIZ-DAGUA-F100' } },
    create: {
      empresaId,
      codigo: 'VERNIZ-DAGUA-F100',
      nome: "Verniz Base D'Água Brilho (F100)",
      unidade: 'KG',
      classificacaoPcp: 'INSUMO',
      tipoFisico: 'LIQUIDO',
    },
    update: { classificacaoPcp: 'INSUMO', tipoFisico: 'LIQUIDO' },
  })

  // Caixa de expedição
  const caixaExp = await prisma.produto.upsert({
    where: { empresaId_codigo: { empresaId, codigo: 'CX-PADRAO-500' } },
    create: {
      empresaId,
      codigo: 'CX-PADRAO-500',
      nome: 'Caixa Padrão com 500 un',
      unidade: 'UN',
      classificacaoPcp: 'EMBALAGEM',
      tipoFisico: 'UNIDADE_PADRAO',
    },
    update: { classificacaoPcp: 'EMBALAGEM', tipoFisico: 'UNIDADE_PADRAO' },
  })

  console.log('✓ Produtos cadastrados (7 itens)')

  // =========================================================================
  // 3. CENTRO DE PRODUÇÃO (Máquinas)
  // =========================================================================
  const heidelberg = await prisma.centroProducao.upsert({
    where: { empresaId_codigo: { empresaId, codigo: 'HEID-CD-5C' } },
    create: { empresaId, codigo: 'HEID-CD-5C', descricao: 'Heidelberg CD 5 Cores', tipo: 'MAQUINA', capacidadeHora: 8000 },
    update: {},
  })

  const bobstE = await prisma.centroProducao.upsert({
    where: { empresaId_codigo: { empresaId, codigo: 'BOBST-E' } },
    create: { empresaId, codigo: 'BOBST-E', descricao: 'Bobst E (Corte e Vinco)', tipo: 'MAQUINA', capacidadeHora: 5000 },
    update: {},
  })

  const aft70 = await prisma.centroProducao.upsert({
    where: { empresaId_codigo: { empresaId, codigo: 'AFT70' } },
    create: { empresaId, codigo: 'AFT70', descricao: 'AFT70 (Coladeira) Fundo Automático Normal', tipo: 'MAQUINA', capacidadeHora: 6000 },
    update: {},
  })

  const cortadeira = await prisma.centroProducao.upsert({
    where: { empresaId_codigo: { empresaId, codigo: 'CORT-GDE' } },
    create: { empresaId, codigo: 'CORT-GDE', descricao: 'Cortadeira (Grande)', tipo: 'MAQUINA', capacidadeHora: 10000 },
    update: {},
  })

  console.log('✓ Centros de produção cadastrados (4 máquinas)')

  // =========================================================================
  // 4. ESTRUTURA DE PRODUTO (BOM)
  // =========================================================================
  const estrutura = await prisma.estruturaProduto.upsert({
    where: { empresaId_produtoId_versao: { empresaId, produtoId: produtoAcabado.id, versao: 1 } },
    create: {
      empresaId,
      produtoId: produtoAcabado.id,
      versao: 1,
      descricao: 'BOM Caixa P/50 ESF.07 - Carton Wega',
      rendimento: 1,
      status: 'ATIVA',
      itens: {
        create: [
          { produtoComponenteId: papelCartao.id, quantidade: 438.01, unidadeMedida: 'KG', percentualPerda: 10, quantidadeLiquida: 481.81, sequencia: 1, tipoComponente: 'MATERIA_PRIMA', aproveitamento: 8, perdaFixaAcerto: 50 },
          { produtoComponenteId: tintaCmyk.id, quantidade: 2.84, unidadeMedida: 'KG', percentualPerda: 5, quantidadeLiquida: 2.98, sequencia: 2, tipoComponente: 'INSUMO', coberturaPercent: 65 },
          { produtoComponenteId: tintaPantone.id, quantidade: 1.30, unidadeMedida: 'KG', percentualPerda: 5, quantidadeLiquida: 1.37, sequencia: 3, tipoComponente: 'INSUMO', coberturaPercent: 35 },
          { produtoComponenteId: chapas.id, quantidade: 5, unidadeMedida: 'PC', percentualPerda: 0, quantidadeLiquida: 5, sequencia: 4, tipoComponente: 'INSUMO' },
          { produtoComponenteId: cola.id, quantidade: 0.89, unidadeMedida: 'KG', percentualPerda: 5, quantidadeLiquida: 0.93, sequencia: 5, tipoComponente: 'INSUMO' },
          { produtoComponenteId: verniz.id, quantidade: 5.48, unidadeMedida: 'KG', percentualPerda: 5, quantidadeLiquida: 5.75, sequencia: 6, tipoComponente: 'INSUMO' },
          { produtoComponenteId: caixaExp.id, quantidade: 41, unidadeMedida: 'UN', percentualPerda: 0, quantidadeLiquida: 41, sequencia: 7, tipoComponente: 'EMBALAGEM' },
        ],
      },
    },
    update: {},
  })
  console.log(`✓ Estrutura (BOM) criada com 7 componentes`)

  // =========================================================================
  // 5. ROTEIRO DE PRODUÇÃO
  // =========================================================================
  const roteiro = await prisma.roteiroProducao.upsert({
    where: { empresaId_produtoId_versao: { empresaId, produtoId: produtoAcabado.id, versao: 1 } },
    create: {
      empresaId,
      produtoId: produtoAcabado.id,
      versao: 1,
      descricao: 'Roteiro Caixa Cartucho - Offset + Corte + Colagem',
      status: 'ATIVO',
      etapas: {
        create: [
          { sequencia: 1, descricao: 'Impressão Offset Plana - Heidelberg CD 5cores', centroProducaoId: heidelberg.id, tempoSetupMinutos: 125, tempoOperacaoMinutos: 0.05, tempoEsperaMinutos: 0, tempoTotalMinutos: 125 },
          { sequencia: 2, descricao: 'Verniz / Heidelberg CD 5cores', centroProducaoId: heidelberg.id, tempoSetupMinutos: 0, tempoOperacaoMinutos: 0.02, tempoEsperaMinutos: 15, tempoTotalMinutos: 15 },
          { sequencia: 3, descricao: 'Corte e Vinco - Bobst E (Faca Nova: Matriz 2536B)', centroProducaoId: bobstE.id, tempoSetupMinutos: 150, tempoOperacaoMinutos: 0.04, tempoEsperaMinutos: 0, tempoTotalMinutos: 150 },
          { sequencia: 4, descricao: 'Cortadeira (Grande) - 3.030 folhas 101,6 x 71,0 cm', centroProducaoId: cortadeira.id, tempoSetupMinutos: 15, tempoOperacaoMinutos: 0.01, tempoEsperaMinutos: 0, tempoTotalMinutos: 15 },
          { sequencia: 5, descricao: 'Destacar', centroProducaoId: cortadeira.id, tempoSetupMinutos: 0, tempoOperacaoMinutos: 0.02, tempoEsperaMinutos: 0, tempoTotalMinutos: 0 },
          { sequencia: 6, descricao: 'Fundo Automático Normal - AFT70 (Coladeira)', centroProducaoId: aft70.id, tempoSetupMinutos: 90, tempoOperacaoMinutos: 0.03, tempoEsperaMinutos: 0, tempoTotalMinutos: 90 },
          { sequencia: 7, descricao: 'Colagem: caixa 030 com 500 un / Embalagem', centroProducaoId: aft70.id, tempoSetupMinutos: 0, tempoOperacaoMinutos: 0.01, tempoEsperaMinutos: 0, tempoTotalMinutos: 0 },
        ],
      },
    },
    update: {},
  })
  console.log(`✓ Roteiro criado com 7 etapas`)

  // =========================================================================
  // 6. ORDEM DE PRODUÇÃO (OP 2.682)
  // =========================================================================
  const ultimaOp = await prisma.ordemProducao.findFirst({ where: { empresaId }, orderBy: { numero: 'desc' } })
  const numero = (ultimaOp?.numero ?? 2681) + 1

  const op = await prisma.ordemProducao.create({
    data: {
      empresaId,
      numero,
      produtoId: produtoAcabado.id,
      estruturaProdutoId: estrutura.id,
      quantidade: 16400,
      quantidadeExcedente: 1840,
      unidadeMedida: 'UN',
      dataEntregaPrevista: new Date('2026-05-04'),
      prioridade: 'ALTA',
      clienteId: cliente.id,
      lote: '1052019',
      cor: 'CMYK: 4+V (5 cores) + Pantone PRETO COMP CF01',
      observacoes: 'Formato Final: 76x76x146mm | Montagem 4x2 (8 peças/folha) | Tiragem: 2.530 folhas | Serviço Alteração (16421) / Novo (17060) (17064) | Seguir contratual',
      status: 'PLANEJADA',
    },
  })
  console.log(`✓ OP #${numero} criada (${Number(op.quantidade)} + ${Number(op.quantidadeExcedente)} excedente)`)

  // =========================================================================
  // 7. VARIAÇÕES (3 cores/modelos na mesma OP)
  // =========================================================================
  await prisma.variacaoOrdemProducao.createMany({
    data: [
      { ordemProducaoId: op.id, codigoProduto: '16421', descricao: 'CAIXA P/50 ESF. 07 VERDE CARTO', quantidade: 6900, cor: 'VERDE', sequencia: 1 },
      { ordemProducaoId: op.id, codigoProduto: '17060', descricao: 'PARA 50 ESF. 07 AZUL', quantidade: 6900, cor: 'AZUL', sequencia: 2 },
      { ordemProducaoId: op.id, codigoProduto: '17064', descricao: 'PARA 50 ESF. 07 AZUL - NAUTICO', quantidade: 4600, cor: 'AZUL NAUTICO', sequencia: 3 },
    ],
  })
  console.log('✓ 3 variações cadastradas (Verde, Azul, Azul Náutico)')

  // =========================================================================
  // 8. PROGRAMAÇÃO DE ENTREGAS PARCIAIS
  // =========================================================================
  await prisma.programacaoEntrega.createMany({
    data: [
      { ordemProducaoId: op.id, dataEntrega: new Date('2026-05-04'), quantidade: 6900, codigoPedido: '1052019' },
      { ordemProducaoId: op.id, dataEntrega: new Date('2026-05-04'), quantidade: 6900, codigoPedido: '4402' },
      { ordemProducaoId: op.id, dataEntrega: new Date('2026-05-04'), quantidade: 4600, codigoPedido: '4485' },
    ],
  })
  console.log('✓ 3 entregas programadas (04/05/2026)')

  // =========================================================================
  // 9. LOG
  // =========================================================================
  const admin = await prisma.usuario.findFirst()
  if (admin) {
    await prisma.logOrdemProducao.create({
      data: { ordemProducaoId: op.id, statusAnterior: '', statusNovo: 'PLANEJADA', usuarioId: admin.id, observacao: 'OP criada via seed (exemplo Carton Wega OP 2.682)' },
    })
  }

  console.log('\n🎉 Seed completo! OP de exemplo da indústria gráfica de embalagens criada.')
  console.log(`   Acesse: /pcp/ordens-producao para visualizar.`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
