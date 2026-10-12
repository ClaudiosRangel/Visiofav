/**
 * Validador em MASSA do Custo de Transformação (CT) do Calcgraf.
 *
 * Prova que a FÓRMULA DECIFRADA do CT (ver docs/calcgraf-ct-decifracao-definitiva.md)
 * reproduz o Calcgraf nos cálculos REAIS do cliente. Lê o backup SQL Server
 * local `CalcgrafCartonWega` (sqlcmd), aplica a fórmula do CustoFixo (acerto) e
 * compara com o valor real gravado em `CalculoResAgrupamento` (agrup 1).
 *
 * REQUER: SQL Server local com o backup restaurado (docs/restaurar-backup-calcgraf.md).
 * NÃO roda em CI (ferramenta de engenharia reversa/validação local).
 *
 * Uso: npx tsx scripts/validar-ct-calcgraf.ts
 *
 * Fórmula do CustoFixo (acerto) validada:
 *   impressão:   coresF × acertoPorCorMin(máquina) + tempoPrimeiroAcerto  (por linha × entradas)
 *   acabamentos: quantAcertos × tempoPorAcerto + tempoPrimeiroAcerto      (× entradas)
 *   custo = tempoFixoMin/60 × custoHora(Tabela 2)
 */
import { execSync } from 'node:child_process'

/** Roda UMA query e devolve as linhas como arrays de células (separador |). */
function rows(q: string): string[][] {
  const out = execSync(
    `sqlcmd -S localhost -E -C -d CalcgrafCartonWega -h -1 -W -s "|" -Q "SET NOCOUNT ON; ${q.replace(/"/g, '\\"')}"`,
    { encoding: 'utf8', maxBuffer: 200 * 1024 * 1024 },
  )
  return out.split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^-+$/.test(l) && !/linhas? afetadas/i.test(l) && !/rows? affected/i.test(l))
    .map((l) => l.split('|').map((s) => s.trim()))
}

const ACERTO_POR_COR: Record<number, number> = { 1: 20, 2: 25, 4: 45, 45: 90, 46: 36 }
const N = 150

function main() {
  // 1) Custo-hora por centro (Tabela 2).
  const CH: Record<number, number> = {}
  for (const [c, v] of rows(`SELECT i.CodOrigem, t.ValorDireto FROM Itc i JOIN TabelasCustoDetalhe t ON t.CodItc=i.Codigo WHERE i.Origem='CENTRO DE CUSTO' AND t.CodTabelaCusto=2 AND t.Coluna=1`)) {
    if (/^\d+$/.test(c)) CH[Number(c)] = Number(v)
  }
  CH[30] = 50

  // 2) Universo de cálculos (os N mais recentes).
  const cods = rows(`SELECT TOP ${N} Codigo FROM CalculoHeader ORDER BY Codigo DESC`).map((r) => Number(r[0])).filter((n) => !isNaN(n))
  const minCod = Math.min(...cods)

  // 3) Tudo de uma vez (3 queries em massa, filtrando pelo range).
  const atvAll = rows(`SELECT Codigo, tipo, codCentroCusto, entradas, quantAcertos, tempoPorAcerto, tempoPrimeiroAcerto FROM CalculoAtividades WHERE Codigo>=${minCod} AND tipo IN ('I','A')`)
  const imprAll = rows(`SELECT Codigo, coresF FROM CalculoAtvImpressao WHERE Codigo>=${minCod} AND coresF>0`)
  const resAll = rows(`SELECT Codigo, CustoFixo FROM CalculoResAgrupamento WHERE Codigo>=${minCod} AND CodAgrupamento=1`)

  const atvPorCod = new Map<number, string[][]>()
  for (const r of atvAll) { const k = Number(r[0]); if (!atvPorCod.has(k)) atvPorCod.set(k, []); atvPorCod.get(k)!.push(r) }
  const imprPorCod = new Map<number, number[]>()
  for (const r of imprAll) { const k = Number(r[0]); if (!imprPorCod.has(k)) imprPorCod.set(k, []); imprPorCod.get(k)!.push(Number(r[1])) }
  const fixoReal = new Map<number, number>()
  for (const r of resAll) fixoReal.set(Number(r[0]), Number(r[1]))

  let ok = 0, outliers = 0, pulados = 0
  const listaOutliers: string[] = []

  for (const cod of cods) {
    const ctFixoReal = fixoReal.get(cod)
    const atvs = atvPorCod.get(cod)
    if (ctFixoReal == null || !atvs) { pulados++; continue }
    // Pula cálculos-teste/incompletos (CustoFixo irrisório < R$100 = sem impressão real).
    if (ctFixoReal < 100) { pulados++; continue }
    const cores = imprPorCod.get(cod) ?? []
    let fixo = 0, imprIdx = 0, atipico = false
    for (const [, tipo, cS, eS, qaS, tpaS, t1S] of atvs) {
      const centro = Number(cS), ent = Number(eS) || 1, qa = Number(qaS), tpa = Number(tpaS), t1 = Number(t1S)
      const ch = CH[centro] ?? 0
      let tMin: number
      if (tipo === 'I') {
        const nc = cores[imprIdx] ?? qa
        imprIdx++
        const acor = ACERTO_POR_COR[centro]
        if (acor == null) { atipico = true; tMin = qa * tpa + t1 }
        else { if (qa !== nc) atipico = true; tMin = nc * acor + t1 }
        tMin *= ent
      } else {
        tMin = (qa * tpa + t1) * ent
      }
      fixo += (tMin / 60) * ch
    }
    const desvio = Math.abs(fixo - ctFixoReal) / (ctFixoReal || 1)
    if (desvio <= 0.01) ok++
    else {
      outliers++
      if (listaOutliers.length < 25) listaOutliers.push(`  ${cod}: calc=${fixo.toFixed(2)} real=${ctFixoReal.toFixed(2)} (${(desvio * 100).toFixed(1)}%)${atipico ? ' [override/máq s/tabela]' : ''}`)
    }
  }

  const total = ok + outliers
  console.log(`\n=== Validacao CustoFixo (acerto) do CT — ${total} calculos (${pulados} sem CT) ===`)
  console.log(`BATEM <=1%: ${ok}/${total} (${total ? ((ok / total) * 100).toFixed(1) : 0}%)`)
  console.log(`Outliers:   ${outliers}/${total}`)
  if (listaOutliers.length) { console.log('\nOutliers (overrides manuais / tira-retira / chapas excedentes):'); listaOutliers.forEach((l) => console.log(l)) }
}

main()
