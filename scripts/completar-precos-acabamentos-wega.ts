/**
 * Completa preço/custo dos AcabamentoGrafico da Carton Wega a partir dos dados
 * REAIS do Calcgraf exportados (cartoon/export/Itc.json + TabelasCustoDetalhe.json).
 *
 * Duas origens de preço no Calcgraf (confirmado pelas telas "Tabela de Custo"):
 *   - MAT.ACABAMENTO  → preço do material consumível (KG/UN/M²/RL): verniz,
 *     cola, fita, ilhós, velcro, BOPP, etc.  → preenche `preco_unitario`.
 *   - CENTRO DE CUSTO → custo-hora (R$/H) da atividade: cortadeira, guilhotina,
 *     laminadora, coladeira, etc.  → preenche `custo_hora`.
 *
 * Match por NOME EXATO normalizado (acentos/caixa/pontuação ignorados, parênteses
 * PRESERVADOS — "(grande)" ≠ "(pequena)"). Preço vem de TabelasCustoDetalhe,
 * CodTabelaCusto=2 Coluna=1 (tabela vigente 2026, campo ValorDireto) para
 * CENTRO DE CUSTO, e da coluna de preço do próprio item para MAT.ACABAMENTO.
 *
 * REGRAS DE SEGURANÇA:
 *   - NUNCA sobrescreve valor já preenchido (> 0).
 *   - Acabamento MATERIAL_* que NÃO casa em MAT.ACABAMENTO mas casa em CENTRO DE
 *     CUSTO é marcado como "RECLASSIFICAR→HORA_MAQUINA" e só é alterado com a
 *     flag --reclassificar (além de --apply), para o usuário decidir.
 *   - Dry-run por padrão.
 *
 * Uso:
 *   npx tsx scripts/completar-precos-acabamentos-wega.ts                 (dry-run)
 *   npx tsx scripts/completar-precos-acabamentos-wega.ts --apply         (preenche preço/custo dos matches diretos)
 *   npx tsx scripts/completar-precos-acabamentos-wega.ts --apply --reclassificar  (também corrige natureza dos mal-classificados)
 *
 * Conexão: DATABASE_URL (Neon de produção) via env.
 */
import { PrismaClient } from '@prisma/client'
import fs from 'node:fs'
import path from 'node:path'

const EMPRESA = process.env.EMPRESA_WEGA || '75848e24-742e-461d-b913-1642c5b83ae9'
const APPLY = process.argv.includes('--apply')
const RECLASS = process.argv.includes('--reclassificar')
const prisma = new PrismaClient()

const norm = (s: string | null | undefined): string =>
  (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9()]+/g, ' ').replace(/\s+/g, ' ').trim()

function loadJson(file: string): any[] {
  const p = path.join(process.cwd(), 'cartoon', 'export', file)
  if (!fs.existsSync(p)) throw new Error(`Export não encontrado: ${p}`)
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}

async function main() {
  console.log(`Empresa ${EMPRESA} | ${APPLY ? 'APPLY' : 'DRY-RUN'}${RECLASS ? ' +reclassificar' : ''}\n`)

  const itc = loadJson('Itc.json')
  const det = loadJson('TabelasCustoDetalhe.json')

  // Detalhe vigente: CodTabelaCusto=2, Coluna=1 (tabela de 2026).
  // Campo do preço DIFERE por origem (descoberto empiricamente):
  //   - CENTRO DE CUSTO → ValorDireto (custo-hora R$/H)
  //   - MAT.ACABAMENTO  → ValorTotal (preço do material KG/UN/M²/RL)
  const detVigente = new Map<number, any>()
  for (const d of det) {
    if (d.CodTabelaCusto !== 2 || d.Coluna !== 1) continue
    if (!detVigente.has(d.CodItc)) detVigente.set(d.CodItc, d)
  }
  const precoCentroCusto = (codItc: number): number | null => {
    const d = detVigente.get(codItc)
    const v = d ? Number(d.ValorDireto) : NaN
    return isNaN(v) || v <= 0 ? null : v
  }
  const precoMaterial = (codItc: number): number | null => {
    const d = detVigente.get(codItc)
    const v = d ? Number(d.ValorTotal) : NaN
    return isNaN(v) || v <= 0 ? null : v
  }

  // Índices por nome normalizado, por origem.
  const matAcab = new Map<string, any>()
  const centroCusto = new Map<string, any>()
  for (const i of itc) {
    const k = norm(i.Descritivo)
    if (i.Origem === 'MAT.ACABAMENTO' && !matAcab.has(k)) matAcab.set(k, i)
    if (i.Origem === 'CENTRO DE CUSTO' && !centroCusto.has(k)) centroCusto.set(k, i)
  }

  const acab = await prisma.acabamentoGrafico.findMany({
    where: { empresaId: EMPRESA },
    select: { id: true, codigo: true, nome: true, naturezaCusto: true, precoUnitario: true, custoHora: true },
  })

  type Acao = { a: (typeof acab)[number]; campo: 'preco_unitario' | 'custo_hora'; valor: number; obs: string }
  const acoes: Acao[] = []
  const reclass: Array<{ a: (typeof acab)[number]; valor: number }> = []
  const semMatch: (typeof acab)[number][] = []

  for (const a of acab) {
    const k = norm(a.nome)
    const mat = matAcab.get(k)
    const cc = centroCusto.get(k)
    const temPrecoMat = mat ? precoMaterial(mat.Codigo) : null
    const temCustoCC = cc ? precoCentroCusto(cc.Codigo) : null

    if (a.naturezaCusto === 'HORA_MAQUINA') {
      if (Number(a.custoHora) > 0) { continue } // já tem
      if (temCustoCC != null) acoes.push({ a, campo: 'custo_hora', valor: temCustoCC, obs: 'CENTRO DE CUSTO' })
      else semMatch.push(a)
    } else {
      // MATERIAL_KG / MATERIAL_UN
      if (Number(a.precoUnitario) > 0) { continue } // já tem
      if (temPrecoMat != null) {
        acoes.push({ a, campo: 'preco_unitario', valor: temPrecoMat, obs: 'MAT.ACABAMENTO' })
      } else if (temCustoCC != null) {
        // Mal classificado: é atividade (hora-máquina), não material.
        reclass.push({ a, valor: temCustoCC })
      } else {
        semMatch.push(a)
      }
    }
  }

  console.log(`=== PREENCHER preço/custo (match direto): ${acoes.length} ===`)
  for (const x of acoes) console.log(`  ${x.a.codigo} "${x.a.nome}" [${x.a.naturezaCusto}] ${x.campo} = ${x.valor}  (${x.obs})`)

  console.log(`\n=== RECLASSIFICAR MATERIAL_* → HORA_MAQUINA (só com --reclassificar): ${reclass.length} ===`)
  for (const x of reclass) console.log(`  ${x.a.codigo} "${x.a.nome}" [${x.a.naturezaCusto}→HORA_MAQUINA] custo_hora = ${x.valor}`)

  console.log(`\n=== SEM MATCH (manter p/ tela/calibração): ${semMatch.length} ===`)
  console.log('  ' + semMatch.map((a) => `${a.codigo} "${a.nome}"`).join(' | '))

  if (!APPLY) { console.log('\nDRY-RUN — nada gravado.'); await prisma.$disconnect(); return }

  let n1 = 0
  for (const x of acoes) {
    await prisma.acabamentoGrafico.update({
      where: { id: x.a.id },
      data: x.campo === 'preco_unitario' ? { precoUnitario: x.valor } : { custoHora: x.valor },
    })
    n1++
  }
  let n2 = 0
  if (RECLASS) {
    for (const x of reclass) {
      await prisma.acabamentoGrafico.update({
        where: { id: x.a.id },
        data: { naturezaCusto: 'HORA_MAQUINA', custoHora: x.valor },
      })
      n2++
    }
  }
  console.log(`\nPreenchidos: ${n1} | Reclassificados: ${n2}`)
  await prisma.$disconnect()
}

main().catch((e) => { console.error('ERRO:', e.message); process.exit(1) })
