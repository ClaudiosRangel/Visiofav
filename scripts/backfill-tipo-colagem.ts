/**
 * BACKFILL — Tipo de Colagem nas etapas de COLAGEM já existentes
 * ================================================================
 * Percorre todas as OPs (multi-empresa) que têm etapas em centros do tipo de
 * processo COLAGEM e ainda estão SEM `tipoColagem` preenchido, recarrega o PDF
 * salvo, reparseia com o parser GPrint e preenche o campo `tipoColagem` (texto
 * exato do PDF) nas etapas de colagem correspondentes.
 *
 * Seguro:
 *   - Só ATUALIZA o campo escalar `tipoColagem` — nunca recria/apaga etapas
 *     (preserva apontamentos, fila e histórico).
 *   - Casa por sequência; fallback para o primeiro tipo de colagem do PDF.
 *   - Pula OPs sem PDF salvo (loga aviso).
 *
 * Uso:
 *   npx tsx scripts/backfill-tipo-colagem.ts            (aplica de verdade)
 *   npx tsx scripts/backfill-tipo-colagem.ts --dry-run  (só mostra o que faria)
 */

import { PrismaClient } from '@prisma/client'
import { carregarOpPdf } from '../src/lib/storage'
import { extrairTextoPdf } from '../src/modules/pcp/importacao-op/pdf-extractor.service'
import { parseGprintPdf } from '../src/modules/pcp/importacao-op/parsers/gprint-parser'

const prisma = new PrismaClient()
const DRY_RUN = process.argv.includes('--dry-run')

async function main() {
  console.log(`\n=== Backfill Tipo de Colagem ${DRY_RUN ? '(DRY-RUN — nada será gravado)' : '(APLICANDO)'} ===\n`)

  // OPs que têm ao menos uma etapa em centro COLAGEM ainda sem tipoColagem.
  const ops = await prisma.ordemProducao.findMany({
    where: {
      origemImportacao: 'PDF_GPRINT',
      etapas: {
        some: {
          centroProducao: { tipoProcesso: { codigo: 'COLAGEM' } },
          tipoColagem: null,
        },
      },
    },
    select: { id: true, numero: true, referenciaExterna: true, empresaId: true },
    orderBy: { numero: 'asc' },
  })

  console.log(`OPs candidatas (com etapa COLAGEM sem tipo): ${ops.length}\n`)

  let atualizadas = 0
  let semPdf = 0
  let semTipoNoPdf = 0
  let etapasPreenchidas = 0

  for (const op of ops) {
    const ref = op.referenciaExterna || String(op.numero)

    const buffer = await carregarOpPdf(op.id)
    if (!buffer) {
      console.log(`  ⚠️  OP ${ref}: sem PDF salvo — pulada`)
      semPdf++
      continue
    }

    let tipoColagemPorSeq: Map<number, string>
    let primeiroTipo: string | null
    try {
      const extracao = await extrairTextoPdf(buffer)
      const dados = parseGprintPdf(extracao.texto)
      const colagensPdf = dados.etapas.filter((e) => e.tipo === 'COLAGEM' && e.tipoColagem)
      if (colagensPdf.length === 0) {
        console.log(`  ⚠️  OP ${ref}: PDF não trouxe tipo de colagem — pulada`)
        semTipoNoPdf++
        continue
      }
      tipoColagemPorSeq = new Map(colagensPdf.map((e) => [e.sequencia, e.tipoColagem as string]))
      primeiroTipo = colagensPdf[0].tipoColagem
    } catch (err: any) {
      console.log(`  ⚠️  OP ${ref}: erro ao reparsear PDF (${err?.message || err}) — pulada`)
      semTipoNoPdf++
      continue
    }

    // Etapas de colagem desta OP ainda sem tipo
    const etapasColagem = await prisma.etapaOrdemProducao.findMany({
      where: {
        ordemProducaoId: op.id,
        centroProducao: { tipoProcesso: { codigo: 'COLAGEM' } },
        tipoColagem: null,
      },
      select: { id: true, sequencia: true },
    })

    const preenchimentos: Array<{ id: string; tipo: string }> = []
    for (const etapa of etapasColagem) {
      const tipo = tipoColagemPorSeq.get(etapa.sequencia) ?? primeiroTipo
      if (tipo) preenchimentos.push({ id: etapa.id, tipo })
    }

    if (preenchimentos.length === 0) continue

    if (DRY_RUN) {
      console.log(`  🔎 OP ${ref}: preencheria ${preenchimentos.length} etapa(s) → "${preenchimentos[0].tipo}"`)
    } else {
      for (const p of preenchimentos) {
        await prisma.etapaOrdemProducao.update({
          where: { id: p.id },
          data: { tipoColagem: p.tipo },
        })
      }
      console.log(`  ✅ OP ${ref}: ${preenchimentos.length} etapa(s) preenchida(s) → "${preenchimentos[0].tipo}"`)
    }
    atualizadas++
    etapasPreenchidas += preenchimentos.length
  }

  console.log(`\n=== Resumo ===`)
  console.log(`OPs atualizadas:        ${atualizadas}`)
  console.log(`Etapas preenchidas:     ${etapasPreenchidas}`)
  console.log(`OPs sem PDF salvo:      ${semPdf}`)
  console.log(`OPs sem tipo no PDF:    ${semTipoNoPdf}`)
  if (DRY_RUN) console.log(`\n(DRY-RUN — nada foi gravado. Rode sem --dry-run para aplicar.)`)
  console.log('')
}

main()
  .catch((e) => {
    console.error('Erro no backfill:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
