/**
 * Exporta do sistema legado (SQL Server local restaurado) as SÉRIES de numeração
 * do orçamento (`Series` com Origem='SOL') para `cartoon/export/Series.json`
 * (ignorado pelo git). SOMENTE LEITURA: só executa SELECT.
 *
 * Consumidor: scripts/importar-series-calcgraf.ts.
 *
 * Ponte = sqlcmd + FOR JSON PATH com `-u` (UTF-16LE) gravando em arquivo (-o) e
 * conversão utf16le → utf8 para preservar acentos (mesmo padrão de
 * exportar-cadastros-orcamento.mjs).
 *
 * Uso:   node scripts/exportar-series-calcgraf.mjs
 * Pré-req: `sqlcmd -S localhost -E -C -d CalcgrafCartonWega` acessível.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const DB = 'CalcgrafCartonWega'
const OUT = join('cartoon', 'export')
const ARQUIVO = join(OUT, 'Series.json')
mkdirSync(OUT, { recursive: true })

function queryJson(sql) {
  const full = `SET NOCOUNT ON; ${sql} FOR JSON PATH, INCLUDE_NULL_VALUES`
  const tmp = join(OUT, `_raw-series-${Date.now()}.tmp`)
  try {
    execFileSync(
      'sqlcmd',
      ['-S', 'localhost', '-E', '-C', '-d', DB, '-y', '0', '-u', '-Q', full, '-o', tmp],
      { maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'ignore', 'pipe'], timeout: 60000 },
    )
    const txt = readFileSync(tmp).toString('utf16le').replace(/^\uFEFF/, '').replace(/\r?\n/g, '').trim()
    if (!txt || txt === 'NULL') return []
    return JSON.parse(txt)
  } finally {
    rmSync(tmp, { force: true })
  }
}

const linhas = queryJson(
  `SELECT Codigo, Ativo, Origem, Nome, Descricao, ProximoNumero FROM Series WHERE Origem = 'SOL' ORDER BY Codigo`,
)
writeFileSync(ARQUIVO, JSON.stringify(linhas, null, 2), 'utf8')
console.log(`Séries exportadas: ${linhas.length} → ${ARQUIVO}`)
for (const s of linhas) {
  console.log(`  código ${s.Codigo} · nome "${(s.Nome ?? '').trim()}" · ativo ${s.Ativo} · próximo ${s.ProximoNumero}`)
}
