/**
 * Cria na empresa "VisioFab Demo" (VisioFab Logística Ltda) um produto real da
 * Carton Wega com BOM (EstruturaProduto ATIVA), roteiro e atributos gráficos,
 * para testes do Orçamento Gráfico.
 *
 * Produto: "Caixa Garrafa Império Gold 210ml 610040039" (o mais recorrente na
 * Carton). Materiais extraídos do PDF de OP (ItemOrdemProducao).
 *
 * Idempotente: reexecutar não duplica (usa upsert/find por chaves naturais).
 *
 * Rodar: $env:DATABASE_URL="<prod>"; npx tsx scripts/seed-produto-carton-na-demo.ts
 */
import { PrismaClient, Prisma } from '@prisma/client'
const prisma = new PrismaClient()

const DEMO = '59512845-a692-4429-ace4-627566065fd4' // VisioFab Logística Ltda (CNPJ 12.345.678/0001-90)

const PRODUTO_CODIGO = '610040039'
const PRODUTO_NOME = 'Caixa Garrafa Império Gold 210ml'

// Materiais da BOM (do PDF da OP da Carton). Cada um vira um Produto-componente
// + um ItemEstrutura. IMPORTANTE: a BOM é POR UNIDADE do produto (o
// explodirBomParaOp multiplica pela quantidade da OP). Os valores do PDF eram
// totais para 130.000 un — aqui já divididos por 130.000 (consumo por peça).
const MATERIAIS = [
  { codigo: 'MP-PAPEL-STORA290', nome: 'Papel Stora Enzo 290g Bobina', tipo: 'PAPEL', qtd: 0.122902, un: 'KG', comp: 'MATERIA_PRIMA' },
  { codigo: 'MP-MICRO-PARDO245', nome: 'Micro Pardo Formato 245', tipo: 'PAPEL', qtd: 0.099960, un: 'KG', comp: 'MATERIA_PRIMA' },
  { codigo: 'MP-TINTA-CMYK', nome: 'Tinta Escala CMYK', tipo: 'TINTA', qtd: 0.000171, un: 'KG', comp: 'INSUMO', cobertura: 20 },
  { codigo: 'MP-TINTA-OURO', nome: 'Tinta Metálica Ouro (FUF3M00442)', tipo: 'TINTA', qtd: 0.000660, un: 'KG', comp: 'INSUMO', cobertura: 80 },
  { codigo: 'MP-PANTONE-OCRE', nome: 'Pantone Ocre (CW0249)', tipo: 'TINTA', qtd: 0.000084, un: 'KG', comp: 'INSUMO', cobertura: 10 },
  { codigo: 'MP-COLA-VEGETAL', nome: 'Cola Vegetal Acoplagem (F60)', tipo: 'COLA', qtd: 0.022032, un: 'KG', comp: 'INSUMO' },
  { codigo: 'MP-VERNIZ-AGUA', nome: "Verniz Base D'Água Brilho (F100)", tipo: 'VERNIZ', qtd: 0.001264, un: 'KG', comp: 'INSUMO' },
]

async function upsertProduto(codigo: string, nome: string, classificacao: string) {
  const existente = await prisma.produto.findFirst({ where: { empresaId: DEMO, codigo }, select: { id: true } })
  if (existente) return existente.id
  const p = await prisma.produto.create({
    data: { empresaId: DEMO, codigo, nome, unidade: 'UN', classificacaoPcp: classificacao, status: true },
    select: { id: true },
  })
  return p.id
}

async function main() {
  console.log('Empresa alvo: VisioFab Demo', DEMO)

  // 1. Produto acabado
  const produtoId = await upsertProduto(PRODUTO_CODIGO, PRODUTO_NOME, 'PRODUTO_ACABADO')
  console.log('Produto acabado:', PRODUTO_CODIGO, produtoId)

  // 2. Produtos-componente (materiais)
  const componenteIds: Record<string, string> = {}
  for (const m of MATERIAIS) {
    componenteIds[m.codigo] = await upsertProduto(m.codigo, m.nome, m.comp === 'MATERIA_PRIMA' ? 'MATERIA_PRIMA' : 'INSUMO')
  }
  console.log('Componentes criados:', Object.keys(componenteIds).length)

  // 3. EstruturaProduto ATIVA (BOM) — idempotente por [empresa, produto, versao]
  let estrutura = await prisma.estruturaProduto.findFirst({ where: { empresaId: DEMO, produtoId, versao: 1 }, select: { id: true } })
  if (!estrutura) {
    estrutura = await prisma.estruturaProduto.create({
      data: { empresaId: DEMO, produtoId, versao: 1, descricao: `BOM ${PRODUTO_NOME}`, rendimento: 1, status: 'ATIVA' },
      select: { id: true },
    })
  } else {
    await prisma.estruturaProduto.update({ where: { id: estrutura.id }, data: { status: 'ATIVA' } })
  }
  console.log('Estrutura (BOM) ATIVA:', estrutura.id)

  // 3.1 Itens da BOM (limpa e recria para refletir a lista atual)
  await prisma.itemEstrutura.deleteMany({ where: { estruturaProdutoId: estrutura.id } })
  let seq = 1
  for (const m of MATERIAIS) {
    const perda = 0
    await prisma.itemEstrutura.create({
      data: {
        estruturaProdutoId: estrutura.id,
        produtoComponenteId: componenteIds[m.codigo],
        quantidade: new Prisma.Decimal(m.qtd),
        unidadeMedida: m.un,
        percentualPerda: perda,
        quantidadeLiquida: new Prisma.Decimal(m.qtd),
        sequencia: seq++,
        tipoComponente: m.comp,
        coberturaPercent: m.cobertura != null ? new Prisma.Decimal(m.cobertura) : null,
      },
    })
  }
  console.log('Itens da BOM:', MATERIAIS.length)

  // 4. Atributos gráficos: TipoGramatura 290 + TipoFormato 207x164
  const grama = await prisma.tipoGramatura.upsert({
    where: { empresaId_codigo: { empresaId: DEMO, codigo: 'G290' } },
    update: {},
    create: { empresaId: DEMO, codigo: 'G290', descricao: '290 g/m²', valorGm2: new Prisma.Decimal(290) },
    select: { id: true },
  })
  const formato = await prisma.tipoFormato.upsert({
    where: { empresaId_codigo: { empresaId: DEMO, codigo: 'F207x164' } },
    update: {},
    create: { empresaId: DEMO, codigo: 'F207x164', descricao: 'Formato 207 x 164 mm', larguraMm: 207, alturaMm: 164 },
    select: { id: true },
  })
  await prisma.atributoGrafico.upsert({
    where: { empresaId_produtoId: { empresaId: DEMO, produtoId } },
    update: { tipoGramaturaId: grama.id, tipoFormatoId: formato.id },
    create: { empresaId: DEMO, produtoId, tipoGramaturaId: grama.id, tipoFormatoId: formato.id, tipoCoresIds: [] },
  })
  console.log('AtributoGrafico: gramatura 290 + formato 207x164')

  // 5. Roteiro ATIVO com etapas (Impressão → Corte/Vinco → Colagem)
  const centros = await prisma.centroProducao.findMany({
    where: { empresaId: DEMO, status: true },
    select: { id: true, codigo: true, tipoProcesso: { select: { codigo: true } } },
  })
  const acharCentro = (tp: string) => centros.find((c) => (c.tipoProcesso?.codigo || '').toUpperCase().includes(tp))
  const impressao = acharCentro('IMPRESS')
  const corte = acharCentro('CORTE') || acharCentro('CORTADEIRA')
  const colagem = acharCentro('COLAGEM')

  let roteiro = await prisma.roteiroProducao.findFirst({ where: { empresaId: DEMO, produtoId, versao: 1 }, select: { id: true } })
  if (!roteiro) {
    roteiro = await prisma.roteiroProducao.create({
      data: { empresaId: DEMO, produtoId, versao: 1, descricao: `Roteiro ${PRODUTO_NOME}`, status: 'ATIVO' },
      select: { id: true },
    })
  } else {
    await prisma.roteiroProducao.update({ where: { id: roteiro.id }, data: { status: 'ATIVO' } })
  }
  await prisma.etapaRoteiro.deleteMany({ where: { roteiroProducaoId: roteiro.id } })
  const etapas = [
    { seq: 1, desc: 'Impressão', centro: impressao, setup: 30, op: 0.05 },
    { seq: 2, desc: 'Corte e Vinco', centro: corte, setup: 20, op: 0.02 },
    { seq: 3, desc: 'Colagem', centro: colagem, setup: 15, op: 0.03 },
  ].filter((e) => e.centro)
  for (const e of etapas) {
    await prisma.etapaRoteiro.create({
      data: {
        roteiroProducaoId: roteiro.id,
        sequencia: e.seq,
        descricao: e.desc,
        centroProducaoId: e.centro!.id,
        tempoSetupMinutos: new Prisma.Decimal(e.setup),
        tempoOperacaoMinutos: new Prisma.Decimal(e.op),
        tempoTotalMinutos: new Prisma.Decimal(e.setup),
      },
    })
  }
  console.log('Roteiro ATIVO com etapas:', etapas.map((e) => e.desc).join(' → '))

  console.log('\n✅ Concluído. Produto de teste pronto na VisioFab Demo:')
  console.log(`   ${PRODUTO_CODIGO} - ${PRODUTO_NOME}  (BOM ATIVA + roteiro + atributos)`)
}
main().catch((e) => console.error('FALHOU:', e)).finally(() => prisma.$disconnect())
