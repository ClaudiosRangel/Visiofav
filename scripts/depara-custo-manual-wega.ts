/**
 * De-para MANUAL de custo-hora dos centros da Carton Wega cujos nomes divergem
 * entre o Vizor e o Calcgraf (spec pcp-relatorio-gerencial-producao).
 *
 * Os pares abaixo foram conferidos 1-a-1 (nome Vizor → custo real do Calcgraf
 * via CentroCustoHora.json). Só preenche quando o custoHora do Vizor está
 * NULL ou 0 (nunca sobrescreve ajuste manual > 0). Idempotente.
 *
 * Uso:
 *   npx tsx scripts/depara-custo-manual-wega.ts <empresaId> [--apply]
 *   (sem --apply = DRY-RUN)
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// descrição EXATA no Vizor → custoHora (R$) do centro equivalente no Calcgraf.
const DEPARA: Record<string, number> = {
  'CD - 5 cores + VErniz': 440,
  'CD - 7 cores + Verniz': 550,
  'KBA - 6 cores + Verniz': 480,
  'RVU - 4 cores': 140,
  'RZU - 2 Cores': 100,
  'Cortadeira Doin': 113.21,
  'Cortadeira Makpel': 113.21,
  'Bobst E': 300,
  'Bobst S': 280,
  'Dayuan BHT 106 CE': 300,
  'Dayuan (Corte/Vinco)': 300,
  'Guilhotina': 77.69,
  'Guilhotina Tigger': 77.69,
  'Guilhotina de envol (Cartão)': 77.69,
  'Guilhotina de envol (Impressos)': 77.69,
  'Guilhotina maior (Cartão)': 77.69,
  'Guilhotina maior (Impressos)': 77.69,
  'Guilhotina maior (Todos os planos)': 77.69,
  'Laminadora Nova': 60,
  'Laminadora PL110': 60,
  'Vinco Manual': 45,
  'Vinco Manual Baby': 45,
  'Vinco / Hot': 45,
  'Destacar (Cartão)': 50,
  'Destacar (Impressos)': 50,
  'Fita dupla face (Impressos)': 12,
  'Heidelberg': 440,
  'KBA': 480,
  'Verniz Offset Fosco': 155,
  'Verniz UV Total': 155,
  'Verniz Local': 155,
  'Ebox': 86.27,
  'Fila Corte e VInco': 86.27,
  'Acopladeira Jato': 90,
  'Bimac HRB (Acoplagem)': 80,
}

function norm(s: string): string {
  return (s || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

async function main() {
  const empresaId = process.argv[2]
  const apply = process.argv.includes('--apply')
  if (!empresaId) { console.error('Uso: npx tsx scripts/depara-custo-manual-wega.ts <empresaId> [--apply]'); process.exit(1) }

  const centros = await prisma.centroProducao.findMany({
    where: { empresaId, status: true },
    select: { id: true, descricao: true, custoHora: true },
  })
  const deparaNorm = new Map(Object.entries(DEPARA).map(([k, v]) => [norm(k), v]))

  const proposta: Array<{ descricao: string; atual: number | null; novo: number; status: string }> = []
  for (const c of centros) {
    const custoCalc = deparaNorm.get(norm(c.descricao))
    if (custoCalc == null) continue
    const atual = c.custoHora != null ? Number(c.custoHora) : null
    const status = (atual == null || atual === 0) ? 'ATUALIZAR' : 'já preenchido (skip)'
    proposta.push({ descricao: c.descricao, atual, novo: custoCalc, status })
  }

  console.table(proposta)
  const atualizar = proposta.filter((p) => p.status === 'ATUALIZAR')
  console.log(`\nMapeados: ${proposta.length} | a atualizar: ${atualizar.length}`)

  if (!apply) { console.log('[DRY-RUN] Nada gravado. Rode com --apply.'); await prisma.$disconnect(); return }

  let n = 0
  for (const p of atualizar) {
    const c = centros.find((x) => norm(x.descricao) === norm(p.descricao))!
    await prisma.centroProducao.update({ where: { id: c.id }, data: { custoHora: p.novo } })
    n++
  }
  console.log(`[APPLY] ${n} centros atualizados.`)
  await prisma.$disconnect()
}

main().catch((e) => { console.error('ERRO:', e.message); process.exit(1) })
