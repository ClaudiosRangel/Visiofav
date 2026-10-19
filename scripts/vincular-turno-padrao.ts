/**
 * Vincula o turno padrão (único turno ATIVO da empresa) aos centros de produção
 * ATIVOS que estão SEM turno. Para o Gantt projetar horários reais em vez de 24h.
 *
 * Só preenche quem está com turnoProducaoId NULL (idempotente, não sobrescreve
 * vínculo manual). Se a empresa tiver mais de um turno ativo, exige escolher o
 * código via --turno=<codigo> (não adivinha).
 *
 * Uso:
 *   npx tsx scripts/vincular-turno-padrao.ts <empresaId> [--turno=<codigo>] [--apply]
 */
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const empresaId = process.argv[2]
  const apply = process.argv.includes('--apply')
  const turnoArg = process.argv.find((a) => a.startsWith('--turno='))?.split('=')[1]
  if (!empresaId) { console.error('Uso: npx tsx scripts/vincular-turno-padrao.ts <empresaId> [--turno=<codigo>] [--apply]'); process.exit(1) }

  const turnosAtivos = await prisma.turnoProducao.findMany({ where: { empresaId, status: true } })
  if (turnosAtivos.length === 0) { console.error('Nenhum turno ATIVO na empresa.'); process.exit(1) }

  let turno = turnosAtivos[0]
  if (turnoArg) {
    const t = turnosAtivos.find((x) => x.codigo === turnoArg)
    if (!t) { console.error(`Turno código "${turnoArg}" não encontrado entre os ativos.`); process.exit(1) }
    turno = t
  } else if (turnosAtivos.length > 1) {
    console.error(`A empresa tem ${turnosAtivos.length} turnos ativos. Informe --turno=<codigo>:`)
    for (const t of turnosAtivos) console.error(`  ${t.codigo} - ${t.descricao} (${t.horaInicio}-${t.horaFim})`)
    process.exit(1)
  }

  const semTurno = await prisma.centroProducao.findMany({
    where: { empresaId, status: true, turnoProducaoId: null },
    select: { id: true, codigo: true, descricao: true },
    orderBy: { codigo: 'asc' },
  })

  console.log(`Turno padrão: ${turno.codigo} - ${turno.descricao} (${turno.horaInicio}-${turno.horaFim})`)
  console.log(`Centros ativos SEM turno: ${semTurno.length}`)
  console.table(semTurno.slice(0, 50).map((c) => ({ codigo: c.codigo, descricao: c.descricao })))
  if (semTurno.length > 50) console.log(`  ... e mais ${semTurno.length - 50}`)

  if (!apply) { console.log('\n[DRY-RUN] Nada gravado. Rode com --apply.'); await prisma.$disconnect(); return }

  const r = await prisma.centroProducao.updateMany({
    where: { empresaId, status: true, turnoProducaoId: null },
    data: { turnoProducaoId: turno.id },
  })
  console.log(`\n[APPLY] ${r.count} centros vinculados ao turno ${turno.codigo}.`)
  await prisma.$disconnect()
}

main().catch((e) => { console.error('ERRO:', e.message); process.exit(1) })
