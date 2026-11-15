/**
 * Relatório final da importação (criados, atualizados, ignorados e não casados por fase).
 * Módulo PURO: só estrutura de dados e formatação de texto. Spec
 * orcamento-grafico-cadastros-relacoes, tarefa 7.2 (Req 14.2).
 */

export interface NaoCasado {
  codigoOrigem: number | null
  nome: string
  motivo: string
  detalhe: string
}

export interface RelatorioFase {
  fase: string
  criados: number
  atualizados: number
  ignorados: number
  /** Ignorados detalhados por motivo (ex.: `JA_COMPLETO`, `TABELA_9_DESCARTADA`). */
  ignoradosPorMotivo: Record<string, number>
  naoCasados: NaoCasado[]
}

export function relatorioVazio(fase: string): RelatorioFase {
  return { fase, criados: 0, atualizados: 0, ignorados: 0, ignoradosPorMotivo: {}, naoCasados: [] }
}

export interface TotaisRelatorio {
  criados: number
  atualizados: number
  ignorados: number
  naoCasados: number
}

export function totalizar(relatorios: readonly RelatorioFase[]): TotaisRelatorio {
  return relatorios.reduce<TotaisRelatorio>(
    (acc, r) => ({
      criados: acc.criados + r.criados,
      atualizados: acc.atualizados + r.atualizados,
      ignorados: acc.ignorados + r.ignorados,
      naoCasados: acc.naoCasados + r.naoCasados.length,
    }),
    { criados: 0, atualizados: 0, ignorados: 0, naoCasados: 0 },
  )
}

/** Conta os não casados por motivo. */
export function naoCasadosPorMotivo(r: RelatorioFase): Record<string, number> {
  const out: Record<string, number> = {}
  for (const n of r.naoCasados) out[n.motivo] = (out[n.motivo] ?? 0) + 1
  return out
}

export interface OpcoesFormatacao {
  dryRun: boolean
  /** Máximo de não casados listados por fase (o JSON completo não tem limite). */
  limiteListagem?: number
}

/** Texto do relatório final, uma seção por fase. */
export function formatarRelatorio(relatorios: readonly RelatorioFase[], opcoes: OpcoesFormatacao): string {
  const limite = opcoes.limiteListagem ?? 15
  const linhas: string[] = []
  linhas.push(opcoes.dryRun ? '===== RELATÓRIO (DRY-RUN: nada foi gravado) =====' : '===== RELATÓRIO DA IMPORTAÇÃO =====')
  for (const r of relatorios) {
    linhas.push('')
    linhas.push(
      `[${r.fase}] criados=${r.criados} atualizados=${r.atualizados} ignorados=${r.ignorados} não-casados=${r.naoCasados.length}`,
    )
    const motivosIgn = Object.entries(r.ignoradosPorMotivo)
    if (motivosIgn.length > 0) linhas.push(`  ignorados: ${motivosIgn.map(([m, n]) => `${m}=${n}`).join(', ')}`)
    const motivosNc = Object.entries(naoCasadosPorMotivo(r))
    if (motivosNc.length > 0) {
      linhas.push(`  não casados por motivo: ${motivosNc.map(([m, n]) => `${m}=${n}`).join(', ')}`)
      for (const n of r.naoCasados.slice(0, limite)) {
        linhas.push(`    - ${n.codigoOrigem ?? '-'} "${n.nome}": ${n.motivo} (${n.detalhe})`)
      }
      if (r.naoCasados.length > limite) linhas.push(`    … e mais ${r.naoCasados.length - limite} (use --relatorio <arquivo.json> para a lista completa)`)
    }
  }
  const t = totalizar(relatorios)
  linhas.push('')
  linhas.push(`TOTAL: criados=${t.criados} atualizados=${t.atualizados} ignorados=${t.ignorados} não-casados=${t.naoCasados}`)
  return linhas.join('\n')
}
