/**
 * De-para MANUAL de preço/custo de acabamentos cujos NOMES no Vizor diferem do
 * Calcgraf (abreviações), conferido 1-a-1 contra as telas "Tabela de Custo
 * (Detalhes)" e "Listagem de Custos" enviadas pelo usuário (20/10/2026).
 *
 * NÃO inventa valor: cada linha abaixo tem o valor REAL lido da tela do Calcgraf.
 * Só os casos de correspondência INEQUÍVOCA entram aqui (abreviação óbvia do
 * mesmo material/atividade). Atividades compostas (Sacola+alça+ilhós, etc.) e
 * processos que a Wega não opera (Serigrafia, Rotogravura…) ficam de fora —
 * dependem de calibração por cálculo real / decisão do usuário.
 *
 * NUNCA sobrescreve valor já preenchido (>0). Dry-run por padrão.
 *
 * Uso:
 *   npx tsx scripts/depara-acabamentos-manual-wega.ts            (dry-run)
 *   npx tsx scripts/depara-acabamentos-manual-wega.ts --apply    (aplica)
 */
import { PrismaClient } from '@prisma/client'

const EMPRESA = process.env.EMPRESA_WEGA || '75848e24-742e-461d-b913-1642c5b83ae9'
const APPLY = process.argv.includes('--apply')
const prisma = new PrismaClient()

/**
 * De-para por CÓDIGO do acabamento (CG-ACAB-N) → { campo, valor, origem }.
 * campo: 'preco' (material R$/un) ou 'hora' (atividade R$/H).
 * Valores REAIS das telas do Calcgraf (MAT.ACABAMENTO / CENTRO DE CUSTO).
 */
const DEPARA: Record<string, { campo: 'preco' | 'hora'; valor: number; origem: string }> = {
  // ── Vernizes Base D'Água (MAT.ACABAMENTO) — nome abreviado no Vizor ──
  'Verniz BA Brilho': { campo: 'preco', valor: 13.2, origem: "Verniz Base D'Água Brilho" },
  'Verniz BA Fosco': { campo: 'preco', valor: 24.2, origem: "Verniz Base D'Água Fosco" },
  // ── Verniz para Blister (MAT.ACABAMENTO: "Verniz Especial para Blister") ──
  // Na tela esse item estava "Não Definido" (sem preço no Calcgraf) → NÃO entra.
  // ── Fechadora de Caixa (CENTRO DE CUSTO: "Fechamento de Caixa" = 115 R$/H) ──
  'Fechadora de Caixa': { campo: 'hora', valor: 115.0, origem: 'Fechamento de Caixa (CENTRO DE CUSTO)' },
  // ── Colagem de acetato (CENTRO DE CUSTO = 0,06 R$/H) ──
  'Colagem de acetato': { campo: 'hora', valor: 0.06, origem: 'Colagem acetato (CENTRO DE CUSTO)' },
  // ── Colocação Ilhós / velcro (CENTRO DE CUSTO = 15 R$/H) ──
  'Colocação Ilhós': { campo: 'hora', valor: 15.0, origem: 'Colocação de ilhós (CENTRO DE CUSTO)' },
  'Colocação velcro': { campo: 'hora', valor: 15.0, origem: 'Colocação de velcro (CENTRO DE CUSTO)' },
  // ── Poliéster (CENTRO DE CUSTO: "Colocação poliéster" = 1 R$/H) ──
  'Poliéster': { campo: 'hora', valor: 1.0, origem: 'Colocação poliéster (CENTRO DE CUSTO)' },
}

async function main() {
  console.log(`Empresa ${EMPRESA} | ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`)

  const acab = await prisma.acabamentoGrafico.findMany({
    where: { empresaId: EMPRESA },
    select: { id: true, codigo: true, nome: true, naturezaCusto: true, precoUnitario: true, custoHora: true },
  })
  const porNome = new Map(acab.map((a) => [a.nome.trim(), a]))

  const acoes: Array<{ a: (typeof acab)[number]; campo: 'preco' | 'hora'; valor: number; origem: string }> = []
  const naoEncontrados: string[] = []
  for (const [nome, d] of Object.entries(DEPARA)) {
    const a = porNome.get(nome)
    if (!a) { naoEncontrados.push(nome); continue }
    const jaTem = d.campo === 'preco' ? Number(a.precoUnitario) > 0 : Number(a.custoHora) > 0
    if (jaTem) continue
    acoes.push({ a, campo: d.campo, valor: d.valor, origem: d.origem })
  }

  console.log(`=== De-para manual a aplicar: ${acoes.length} ===`)
  for (const x of acoes) {
    console.log(`  ${x.a.codigo} "${x.a.nome}" [${x.a.naturezaCusto}] ${x.campo === 'preco' ? 'preco_unitario' : 'custo_hora'} = ${x.valor}  ← ${x.origem}`)
  }
  if (naoEncontrados.length) console.log(`\n(nomes do de-para não encontrados no cadastro: ${naoEncontrados.join(', ')})`)

  if (!APPLY) { console.log('\nDRY-RUN — nada gravado.'); await prisma.$disconnect(); return }

  let n = 0
  for (const x of acoes) {
    let data: any
    if (x.campo === 'preco') {
      data = { precoUnitario: x.valor }
    } else {
      // Custo-hora = atividade. Se o item está classificado como MATERIAL_*,
      // reclassifica para HORA_MAQUINA junto (consistência: custo_hora só faz
      // sentido em HORA_MAQUINA).
      data = { custoHora: x.valor }
      if (x.a.naturezaCusto !== 'HORA_MAQUINA') data.naturezaCusto = 'HORA_MAQUINA'
    }
    await prisma.acabamentoGrafico.update({ where: { id: x.a.id }, data })
    n++
  }
  console.log(`\nAplicados: ${n}`)
  await prisma.$disconnect()
}

main().catch((e) => { console.error('ERRO:', e.message); process.exit(1) })
