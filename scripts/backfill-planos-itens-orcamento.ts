/**
 * Backfill de PLANOS dos itens de orçamento já puxados (spec
 * orcamento-grafico-planos-fieis-calcgraf, Req 5).
 *
 * Para cada ItemOrcamentoGrafico de orçamento RASCUNHO que:
 *   - tem `calculoGraficoOrigemId` (veio de "Puxar Cálculo"), E
 *   - tem 0 planos materializados,
 * lê a foto do cálculo-origem, mapeia `foto.planos[]` (mesma regra D1 do puxar:
 * 2+ planos → todos; 0/1 → "Plano 1" da engenharia do item) e cria os
 * `PlanoCalculoGrafico`. NUNCA toca orçamento não-RASCUNHO. Idempotente (item que
 * já tem planos é ignorado). Custos do plano = 0 (detalhamento; não altera o
 * custo ancorado do item).
 *
 * Uso:
 *   npx tsx scripts/backfill-planos-itens-orcamento.ts --empresa <id> --dry-run
 *   npx tsx scripts/backfill-planos-itens-orcamento.ts --empresa <id>   (aplica)
 *   npx tsx scripts/backfill-planos-itens-orcamento.ts --dry-run        (todas as empresas)
 */
import { PrismaClient } from '@prisma/client'
import { mapearFotoPlanos, type PlanoMapeado } from '../src/modules/orcamento-grafico/calculo-grafico/foto-planos.service'

const prisma = new PrismaClient()

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const DRY_RUN = process.argv.includes('--dry-run')
const EMPRESA = arg('--empresa')

/** Regra D1: 2+ planos da foto → todos; 0/1 → "Plano 1" da engenharia do item. */
function planosDoItem(
  fotoPlanos: unknown,
  item: { gramatura: unknown; numCores: unknown; formatoCorteLarguraMm: unknown; formatoCorteAlturaMm: unknown },
): PlanoMapeado[] {
  const mapeados = mapearFotoPlanos(Array.isArray(fotoPlanos) ? (fotoPlanos as never) : undefined)
  if (mapeados.length >= 2) return mapeados
  const base = mapeados[0]
  return [
    {
      nome: base?.nome ?? 'Plano 1',
      suporteDescricao: base?.suporteDescricao ?? null,
      gramatura: base?.gramatura ?? (item.gramatura != null ? Number(item.gramatura) : null),
      numCores: base?.numCores ?? (item.numCores != null ? Number(item.numCores) : 0),
      formatoLarguraMm: base?.formatoLarguraMm ?? (item.formatoCorteLarguraMm != null ? Number(item.formatoCorteLarguraMm) : null),
      formatoAlturaMm: base?.formatoAlturaMm ?? (item.formatoCorteAlturaMm != null ? Number(item.formatoCorteAlturaMm) : null),
      aproveitamento: base?.aproveitamento ?? null,
      tiragem: base?.tiragem ?? null,
    },
  ]
}

async function main() {
  console.log(`[backfill-planos] ${DRY_RUN ? 'DRY-RUN' : 'APLICANDO'}${EMPRESA ? ` empresa=${EMPRESA}` : ' (todas as empresas)'}`)

  // Itens de orçamento RASCUNHO, com origem de cálculo e SEM planos.
  const itens = await prisma.itemOrcamentoGrafico.findMany({
    where: {
      calculoGraficoOrigemId: { not: null },
      planos: { none: {} },
      orcamento: { status: 'RASCUNHO', ...(EMPRESA ? { empresaId: EMPRESA } : {}) },
      ...(EMPRESA ? { empresaId: EMPRESA } : {}),
    },
    select: {
      id: true,
      empresaId: true,
      calculoGraficoOrigemId: true,
      gramatura: true,
      numCores: true,
      formatoCorteLarguraMm: true,
      formatoCorteAlturaMm: true,
    },
  })

  console.log(`[backfill-planos] itens candidatos: ${itens.length}`)
  let criadosPlanos = 0
  let itensProcessados = 0
  let itensSemFoto = 0

  for (const item of itens) {
    const calc = await prisma.calculoGrafico.findFirst({
      where: { id: item.calculoGraficoOrigemId as string, empresaId: item.empresaId },
      select: { resultadoCalculo: true },
    })
    const fotoPlanos = (calc?.resultadoCalculo as { planos?: unknown } | null)?.planos
    if (calc == null) {
      itensSemFoto += 1
      continue
    }
    const planos = planosDoItem(fotoPlanos, item)
    if (planos.length === 0) continue

    itensProcessados += 1
    let seq = 1
    for (const p of planos) {
      const larg = p.formatoLarguraMm != null && p.formatoLarguraMm > 0 ? p.formatoLarguraMm : 0.01
      const alt = p.formatoAlturaMm != null && p.formatoAlturaMm > 0 ? p.formatoAlturaMm : 0.01
      if (!DRY_RUN) {
        await prisma.planoCalculoGrafico.create({
          data: {
            empresaId: item.empresaId,
            itemId: item.id,
            sequencia: seq,
            nome: p.nome,
            gramatura: p.gramatura ?? null,
            formatoLarguraMm: larg,
            formatoAlturaMm: alt,
            numCores: p.numCores ?? 0,
            custoSuporte: 0,
            custoImpressao: 0,
            custoAcabamento: 0,
          },
        })
      }
      criadosPlanos += 1
      seq += 1
    }
  }

  console.log(`[backfill-planos] itens processados: ${itensProcessados} | planos ${DRY_RUN ? 'a criar' : 'criados'}: ${criadosPlanos} | itens sem foto/cálculo: ${itensSemFoto}`)
  console.log('[backfill-planos] concluído.')
}

main()
  .catch((e) => {
    console.error('[backfill-planos] erro:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
