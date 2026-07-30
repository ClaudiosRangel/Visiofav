/**
 * DIAGNÓSTICO + LIMPEZA — Etapas manuais duplicadas na Programação
 * ===================================================================
 * Contexto: bug real encontrado na OP 2898 (FRESCATTO) — a rota
 * POST /pcp/etapas/adicionar-manual não tinha proteção contra duplo
 * clique/duplo submit no botão "Adicionar à Fila" do modal "Adicionar OS",
 * então cliques repetidos (ou rede lenta + usuário clicando de novo)
 * criavam DUAS `EtapaOrdemProducao` idênticas (mesma OP, mesmo centro,
 * mesma descrição), que apareciam como duas linhas idênticas no grupo
 * "Serviços Manuais - Produção" do painel de Programação.
 *
 * O bug de origem já foi corrigido em:
 *   - Frontend: trava de duplo clique no botão (programacao/page.tsx)
 *   - Backend: rejeita duplicata idêntica antes de criar (etapa-operacional.routes.ts)
 *
 * Este script é só para LIMPAR duplicatas que já existem na base (criadas
 * ANTES da correção). Por padrão roda em modo SOMENTE LEITURA (dry-run) —
 * lista o que encontrou sem apagar nada. Passe --aplicar para de fato excluir.
 *
 * O que conta como "duplicata": duas ou mais EtapaOrdemProducao com o
 * MESMO ordemProducaoId + centroProducaoId + descricao + status ainda
 * ativo (PENDENTE/EM_ANDAMENTO/PAUSADA) — nesse grupo, mantém a etapa
 * mais antiga (menor sequencia) e remove as demais. Etapas CONCLUÍDAS
 * nunca são tocadas (podem ter apontamentos reais vinculados).
 *
 * Uso:
 *   npx tsx scripts/diagnostico-limpar-etapas-duplicadas.ts                # só lista (dry-run)
 *   npx tsx scripts/diagnostico-limpar-etapas-duplicadas.ts --op 2898      # filtra por número/referência da OP
 *   npx tsx scripts/diagnostico-limpar-etapas-duplicadas.ts --aplicar      # de fato exclui as duplicatas (mantém 1 de cada grupo)
 *   npx tsx scripts/diagnostico-limpar-etapas-duplicadas.ts --op 2898 --aplicar
 *
 * IMPORTANTE: antes de rodar com --aplicar em produção, rode sem a flag
 * primeiro e confira a lista. Se a etapa duplicada já tiver apontamentos
 * (ApontamentoEtapa) registrados, o script AVISA e não exclui automaticamente
 * — teria que decidir manualmente qual das duas manter.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const args = process.argv.slice(2)
  const aplicar = args.includes('--aplicar')
  const opIdx = args.indexOf('--op')
  const filtroOp = opIdx >= 0 ? args[opIdx + 1] : null

  console.log(`Modo: ${aplicar ? 'APLICAR (vai excluir duplicatas)' : 'DRY-RUN (somente leitura)'}`)
  if (filtroOp) console.log(`Filtro: OP/referência contendo "${filtroOp}"`)
  console.log('─'.repeat(80))

  const ops = await prisma.ordemProducao.findMany({
    where: filtroOp
      ? {
          OR: [
            { referenciaExterna: { contains: filtroOp } },
            { numero: /^\d+$/.test(filtroOp) ? parseInt(filtroOp) : undefined },
          ],
        }
      : undefined,
    select: { id: true, numero: true, referenciaExterna: true, empresaId: true },
  })

  if (ops.length === 0) {
    console.log('Nenhuma OP encontrada com esse filtro.')
    return
  }

  const opIds = ops.map((o) => o.id)
  const opLabel = new Map(ops.map((o) => [o.id, o.referenciaExterna || String(o.numero)]))

  const etapas = await prisma.etapaOrdemProducao.findMany({
    where: {
      ordemProducaoId: { in: opIds },
      status: { in: ['PENDENTE', 'EM_ANDAMENTO', 'PAUSADA'] },
    },
    include: {
      centroProducao: { select: { descricao: true } },
      apontamentosEtapa: { select: { id: true } },
    },
    orderBy: { sequencia: 'asc' },
  })

  // Agrupa por ordemProducaoId + centroProducaoId + descricao
  const grupos = new Map<string, typeof etapas>()
  for (const etapa of etapas) {
    const chave = `${etapa.ordemProducaoId}::${etapa.centroProducaoId}::${etapa.descricao}`
    const lista = grupos.get(chave) || []
    lista.push(etapa)
    grupos.set(chave, lista)
  }

  let totalGruposDuplicados = 0
  let totalEtapasParaExcluir = 0
  let totalComApontamento = 0

  for (const [, lista] of grupos) {
    if (lista.length <= 1) continue // sem duplicata

    totalGruposDuplicados++
    const [manter, ...duplicadas] = lista // mantém a de menor sequencia (mais antiga)

    console.log(`\nOP ${opLabel.get(manter.ordemProducaoId)} — Centro: ${manter.centroProducao?.descricao || '(sem centro)'}`)
    console.log(`  Descrição: "${manter.descricao}"`)
    console.log(`  Manter:   etapa ${manter.id} (sequencia ${manter.sequencia}, status ${manter.status})`)

    for (const dup of duplicadas) {
      const temApontamento = dup.apontamentosEtapa.length > 0
      if (temApontamento) {
        totalComApontamento++
        console.log(`  ⚠️  PULAR: etapa ${dup.id} (sequencia ${dup.sequencia}) tem ${dup.apontamentosEtapa.length} apontamento(s) — não excluída automaticamente, decida manualmente.`)
        continue
      }
      totalEtapasParaExcluir++
      console.log(`  Excluir:  etapa ${dup.id} (sequencia ${dup.sequencia}, status ${dup.status})`)

      if (aplicar) {
        await prisma.etapaOrdemProducao.delete({ where: { id: dup.id } })
        console.log('            ✅ excluída')
      }
    }
  }

  console.log('\n' + '─'.repeat(80))
  console.log(`Resumo: ${totalGruposDuplicados} grupo(s) com duplicata | ${totalEtapasParaExcluir} etapa(s) ${aplicar ? 'excluída(s)' : 'a excluir'} | ${totalComApontamento} pulada(s) por ter apontamento`)
  if (!aplicar && totalEtapasParaExcluir > 0) {
    console.log('\nExecute novamente com --aplicar para excluir de fato as duplicatas listadas acima.')
  }
}

main()
  .catch((err) => {
    console.error('Erro:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
