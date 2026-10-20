/**
 * Cria o ORÇAMENTO 7343 (RÓTULO P/ARAME FARPADO ELEFANTE 250M) na produção da
 * Carton Wega, a partir do cálculo REAL validado no golden `golden-7343.fixture`.
 *
 * Objetivo: deixar o cálculo 7343 VISÍVEL/clicável na tela do Vizor, com os
 * mesmos lançamentos e o Custo de Produção que o Calcgraf (R$ 5.411,87). O motor
 * (`calcularOrcamentoGrafico`) é a MESMA fonte do golden — o `resultadoCalculo`
 * gravado é o que a tela de detalhe renderiza (breakdown MD/CT/C.PROD).
 *
 * Idempotente: se já existir um orçamento com `serie='7343'` na empresa, não
 * recria (apenas informa). Dry-run por padrão.
 *
 * Uso:
 *   npx tsx scripts/seed-orcamento-7343-wega.ts            (dry-run — mostra o que gravaria)
 *   npx tsx scripts/seed-orcamento-7343-wega.ts --apply    (grava na produção)
 *
 * Conexão: DATABASE_URL (Neon de produção) via env.
 */
import { PrismaClient } from '@prisma/client'
import { calcularOrcamentoGrafico } from '../src/modules/orcamento-grafico/orcamento-grafico-calculo.service'
import { input7343 } from '../src/modules/orcamento-grafico/calibracao/golden-7343.fixture'

const EMPRESA = process.env.EMPRESA_WEGA || '75848e24-742e-461d-b913-1642c5b83ae9'
// Qualquer tipo de embalagem válido da empresa serve (o 7343 é rótulo/lâmina —
// usamos o cadastro genérico CG-EMB-1 "Cartuchos" só para satisfazer a FK).
const TIPO_EMBALAGEM_ID = '70d496ae-2fa9-4d1a-b09d-c1d8c6d90fe8'
const CRIADO_POR_ID = '7e355397-53a3-43b6-a973-78366fbae915' // alexander@visiofab.com (ADMIN)
const APPLY = process.argv.includes('--apply')
const prisma = new PrismaClient()

async function main() {
  console.log(`Empresa ${EMPRESA} | ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`)

  const r = calcularOrcamentoGrafico(input7343)
  const f2 = (n: number) => Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const custoMaterial = Number(r.materialDireto)          // MD (suporte+matriz+tintas+mat.acab)
  const custoMaquina = Number(r.custoTransformacao)       // CT (impressão + acabamentos hora)
  const custoAcabamento = Number(r.acabamentos?.custoTotal ?? 0)
  const custoProducao = Number(r.custoProducao)
  const custoTotal = Number(r.custoTotal)

  console.log('Resultado do motor (o que a tela mostrará):')
  console.log(`  Material Direto     = R$ ${f2(custoMaterial)}`)
  console.log(`  Custo Transformação = R$ ${f2(custoMaquina)}`)
  console.log(`  CUSTO DE PRODUÇÃO   = R$ ${f2(custoProducao)}   (Calcgraf 5.411,87)`)
  console.log(`  Custo Total         = R$ ${f2(custoTotal)}`)

  const existe = await prisma.orcamentoGrafico.findFirst({
    where: { empresaId: EMPRESA, serie: '7343' },
    select: { id: true, numero: true },
  })
  if (existe) {
    console.log(`\nJá existe orçamento com série 7343 (nº ${existe.numero}, id ${existe.id}). Nada a fazer.`)
    await prisma.$disconnect()
    return
  }

  if (!APPLY) {
    console.log('\nDRY-RUN — nada gravado. Rode com --apply para criar o orçamento 7343 na produção.')
    await prisma.$disconnect()
    return
  }

  const ultimo = await prisma.orcamentoGrafico.findFirst({
    where: { empresaId: EMPRESA }, orderBy: { numero: 'desc' }, select: { numero: true },
  })
  const numero = (ultimo?.numero ?? 0) + 1

  const criado = await prisma.orcamentoGrafico.create({
    data: {
      empresaId: EMPRESA,
      numero,
      versao: 1,
      serie: '7343', // referência ao cálculo do Calcgraf
      clienteNome: 'A IMPERATRIZ (cálculo 7343 Calcgraf)',
      dataOrcamento: new Date(),
      tipoEmbalagemId: TIPO_EMBALAGEM_ID,
      medidas: input7343.medidas,
      resultadoCalculo: r as any,
      papelDescricao: 'Nz Bobina 325',
      gramatura: 325,
      numCores: 3,
      quantidade: input7343.quantidade,
      custoMaterial,
      custoMaquina,
      custoAcabamento,
      custoTotal,
      precoVenda: Number(r.precoVenda ?? 0),
      precoUnitario: Number(r.precoUnitario ?? 0),
      margemReal: Number(r.margemReal ?? 0),
      custoProducaoConsolidado: custoProducao,
      valorTotalConsolidado: Number(r.precoVenda ?? custoTotal),
      status: 'RASCUNHO',
      observacoes:
        'Orçamento-espelho do cálculo 7343 do Calcgraf (RÓTULO P/ARAME FARPADO ELEFANTE 250M, ' +
        'tiragem 4.000). Criado para validação de paridade — Custo de Produção bate com o ' +
        'Calcgraf (R$ 5.411,87). Ver golden-7343 no backend.',
      produtoId: null,
      criadoPorId: CRIADO_POR_ID,
    },
    select: { id: true, numero: true, serie: true },
  })

  console.log(`\n✅ Orçamento 7343 criado: nº ${criado.numero} (série ${criado.serie}, id ${criado.id})`)
  await prisma.$disconnect()
}

main().catch((e) => { console.error('ERRO:', e.message); process.exit(1) })
