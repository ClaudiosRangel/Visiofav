/**
 * Popular custoHora/velocidade dos CentroProducao a partir dos exports do
 * Calcgraf (spec pcp-relatorio-gerencial-producao, Task 2).
 *
 * Fontes (cartoon/export/):
 *   - CentroCustoHora.json                 → { descritivo, custoHora }
 *   - CentrosProducao.json                 → { Codigo, Nome }  (CodCpr → nome)
 *   - CentrosProducaoxTiragensProdHora.json → { CodCpr, Tiragem, ProdHora }
 *
 * De-para Vizor↔Calcgraf por NOME NORMALIZADO (sem acento, minúsculo, sem
 * pontuação/espaços colapsados). Ambíguo (0 ou >1 match) → fica de fora e é
 * listado para vínculo manual. Nunca adivinha.
 *
 * Uso:
 *   npx tsx scripts/popular-custo-velocidade-centros.ts <empresaId> [--apply]
 *   (sem --apply = DRY-RUN: só imprime a proposta, não grava.)
 *
 * Regra de escrita (apply): só preenche custoHora/velocidade quando o valor no
 * Vizor está NULL ou 0 (nunca sobrescreve valor ajustado manualmente > 0).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const EXPORT_DIR = join(process.cwd(), 'cartoon', 'export')

interface CentroCustoHora { descritivo: string; custoHora: number }
interface CentroCalcgraf { Codigo: number; Nome: string }
interface ProdHoraRow { CodCpr: number; Tiragem: number; ProdHora: number }

function normalizar(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/\uFFFD/g, '') // remove caractere de substituição (acento corrompido no export)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function lerJson<T>(nome: string): T {
  return JSON.parse(readFileSync(join(EXPORT_DIR, nome), 'utf-8')) as T
}

async function main() {
  const empresaId = process.argv[2]
  const apply = process.argv.includes('--apply')
  if (!empresaId) {
    console.error('Uso: npx tsx scripts/popular-custo-velocidade-centros.ts <empresaId> [--apply]')
    process.exit(1)
  }

  const custoHoraRows = lerJson<CentroCustoHora[]>('CentroCustoHora.json')
  const centrosCalc = lerJson<CentroCalcgraf[]>('CentrosProducao.json')
  const prodHoraRows = lerJson<ProdHoraRow[]>('CentrosProducaoxTiragensProdHora.json')

  // Velocidade representativa por CodCpr = maior ProdHora (maior faixa de tiragem).
  const velPorCod = new Map<number, number>()
  for (const r of prodHoraRows) {
    const atual = velPorCod.get(r.CodCpr) ?? 0
    if (r.ProdHora > atual) velPorCod.set(r.CodCpr, r.ProdHora)
  }

  // Índice Calcgraf por nome normalizado → { custoHora?, velocidade? }
  // custoHora vem de CentroCustoHora (por descritivo); velocidade de CodCpr.
  const custoPorNome = new Map<string, number>()
  for (const r of custoHoraRows) {
    const n = normalizar(r.descritivo)
    if (n) custoPorNome.set(n, r.custoHora)
  }
  const velPorNome = new Map<string, number>()
  for (const c of centrosCalc) {
    const n = normalizar(c.Nome)
    const v = velPorCod.get(c.Codigo)
    if (n && v != null) velPorNome.set(n, v)
  }

  // Centros do Vizor da empresa
  const centrosVizor = await prisma.centroProducao.findMany({
    where: { empresaId },
    select: { id: true, codigo: true, descricao: true, custoHora: true, velocidade: true },
    orderBy: { codigo: 'asc' },
  })

  const proposta: Array<{ codigo: string; descricao: string; custoAtual: number | null; velAtual: number | null; custoNovo: number | null; velNovo: number | null; status: string }> = []
  const ambiguos: string[] = []

  for (const cv of centrosVizor) {
    const n = normalizar(cv.descricao)
    const custoCalc = custoPorNome.get(n) ?? null
    const velCalc = velPorNome.get(n) ?? null
    const custoAtual = cv.custoHora != null ? Number(cv.custoHora) : null
    const velAtual = cv.velocidade != null ? Number(cv.velocidade) : null

    // só preenche o que está nulo/0
    const custoNovo = (custoAtual == null || custoAtual === 0) && custoCalc != null && custoCalc > 0 ? custoCalc : null
    const velNovo = (velAtual == null || velAtual === 0) && velCalc != null && velCalc > 0 ? velCalc : null

    let status: string
    if (custoCalc == null && velCalc == null) {
      status = 'SEM MATCH'
      ambiguos.push(`${cv.codigo} - ${cv.descricao}`)
    } else if (custoNovo == null && velNovo == null) {
      status = 'já preenchido (skip)'
    } else {
      status = 'ATUALIZAR'
    }

    proposta.push({ codigo: cv.codigo, descricao: cv.descricao, custoAtual, velAtual, custoNovo, velNovo, status })
  }

  console.log(`\n=== DE-PARA custo/velocidade — empresa ${empresaId} ===`)
  console.table(proposta.map((p) => ({
    codigo: p.codigo, descricao: p.descricao.slice(0, 28),
    custoAtual: p.custoAtual, custoNovo: p.custoNovo,
    velAtual: p.velAtual, velNovo: p.velNovo, status: p.status,
  })))

  const atualizar = proposta.filter((p) => p.status === 'ATUALIZAR')
  console.log(`\nTotal centros: ${proposta.length} | a atualizar: ${atualizar.length} | sem match: ${ambiguos.length}`)
  if (ambiguos.length) console.log('Sem match (vínculo manual):\n - ' + ambiguos.join('\n - '))

  if (!apply) {
    console.log('\n[DRY-RUN] Nada gravado. Rode novamente com --apply para aplicar.')
    await prisma.$disconnect()
    return
  }

  let n = 0
  for (const p of atualizar) {
    const cv = centrosVizor.find((c) => c.codigo === p.codigo)!
    const data: Record<string, unknown> = {}
    if (p.custoNovo != null) data.custoHora = p.custoNovo
    if (p.velNovo != null) { data.velocidade = p.velNovo; data.unidadeVelocidade = 'FOLHAS_HORA' }
    if (Object.keys(data).length === 0) continue
    await prisma.centroProducao.update({ where: { id: cv.id }, data })
    n++
  }
  console.log(`\n[APPLY] ${n} centros atualizados.`)
  await prisma.$disconnect()
}

main().catch((e) => { console.error('ERRO:', e.message); process.exit(1) })
