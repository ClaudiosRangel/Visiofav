// Importa a FOTO RICA (cartoon/export/CalculosAcervoRico.json) para a coluna
// resultado_calculo de cada calculo_grafico, por (empresaId, numeroCalcgraf).
//
// Spec: calculo-grafico-foto-rica (Task 3.2). Idempotente (atualiza a foto, não
// cria cálculo). Em lote, com retry (pooler Neon). NÃO recalcula; grava a foto
// da origem. NÃO toca PCP (tabela isolada calculo_grafico).
//
// Uso:
//   DATABASE_URL=<neon ...pgbouncer=true&connection_limit=1> \
//   npx tsx scripts/importar-foto-rica-calcgraf.ts --empresa <id> [--numero N] [--dry-run]

import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const prisma = new PrismaClient()
const EXPORT = join('cartoon', 'export', 'CalculosAcervoRico.json')

function arg(n: string): string | undefined {
  const i = process.argv.indexOf(`--${n}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
function flag(n: string): boolean {
  return process.argv.includes(`--${n}`)
}

async function comRetry<T>(fn: () => Promise<T>, tent = 3): Promise<T> {
  let ultimo: unknown
  for (let i = 1; i <= tent; i++) {
    try {
      return await fn()
    } catch (e) {
      ultimo = e
      if (i < tent) await new Promise((r) => setTimeout(r, 1000))
    }
  }
  throw ultimo
}

interface LinhaFoto {
  numeroCalcgraf: number | null
  valorTotal: number | null
  foto: unknown
}

async function main() {
  const empresaId = arg('empresa')
  if (!empresaId) throw new Error('--empresa <id> é obrigatório')
  const dryRun = flag('dry-run')
  const soNumero = arg('numero') ? Number(arg('numero')) : null

  let linhas: LinhaFoto[] = JSON.parse(readFileSync(EXPORT, 'utf8'))
  if (soNumero != null) linhas = linhas.filter((l) => l.numeroCalcgraf === soNumero)
  console.log(`Fotos a aplicar: ${linhas.length}${dryRun ? ' (DRY-RUN)' : ''}`)

  let atualizados = 0
  let semCalculo = 0
  const faltam: number[] = []
  const TAM = 200

  for (let i = 0; i < linhas.length; i += TAM) {
    const bloco = linhas.slice(i, i + TAM)
    for (const l of bloco) {
      if (l.numeroCalcgraf == null) continue
      // Atualiza SÓ se o cálculo existir (match por empresa + numeroCalcgraf).
      const alvo = await comRetry(() =>
        prisma.calculoGrafico.findFirst({
          where: { empresaId, numeroCalcgraf: l.numeroCalcgraf! },
          select: { id: true },
        }),
      )
      if (!alvo) {
        semCalculo += 1
        faltam.push(l.numeroCalcgraf)
        continue
      }
      if (dryRun) {
        atualizados += 1
        continue
      }
      await comRetry(() =>
        prisma.calculoGrafico.updateMany({
          where: { id: alvo.id, empresaId },
          data: {
            resultadoCalculo: l.foto as never,
            // valorTotal oficial de CalculoTiragens (bate 100% na proposta).
            valorTotal: l.valorTotal ?? undefined,
          },
        }),
      )
      atualizados += 1
    }
    console.log(`  ${Math.min(i + TAM, linhas.length)}/${linhas.length}`)
  }

  console.log('\n===== RESUMO FOTO RICA =====')
  console.log(JSON.stringify({ atualizados, semCalculo }, null, 2))
  if (faltam.length) console.log(`Sem cálculo correspondente (amostra): ${faltam.slice(0, 20).join(', ')}`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
