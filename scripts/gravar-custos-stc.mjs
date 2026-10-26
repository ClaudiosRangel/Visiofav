// Grava SOMENTE a decomposição real por componente (CalculoSTC) na coluna
// `calculo_grafico.custos_calcgraf`, lendo `cartoon/export/EngenhariaCalcgraf.json`.
// Rápido e seguro: um único UPDATE ... FROM (VALUES ...) por lote (poucos
// round-trips no pooler Neon). NÃO toca engenharia/foto — só o JSON do STC.
//
// Uso: $env:DATABASE_URL=<neon>; node scripts/gravar-custos-stc.mjs [--dry-run] [--numero N] [--arquivo arq.json]
import pg from 'pg'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CONN = process.env.DATABASE_URL
if (!CONN) { console.error('Defina DATABASE_URL'); process.exit(1) }
const EMPRESA = process.env.EMPRESA_ID || '75848e24-742e-461d-b913-1642c5b83ae9'
const DRY = process.argv.includes('--dry-run')
const idxNum = process.argv.indexOf('--numero')
const SO_NUMERO = idxNum >= 0 ? Number(process.argv[idxNum + 1]) : null
const idxArq = process.argv.indexOf('--arquivo')
const ARQUIVO = idxArq >= 0 ? process.argv[idxArq + 1] : join('cartoon', 'export', 'EngenhariaCalcgraf.json')

function novoClient() {
  const cl = new pg.Client({ connectionString: CONN, ssl: { rejectUnauthorized: false } })
  cl.on('error', () => {})
  return cl
}
let client = novoClient()
await client.connect()
async function reconectar() { try { await client.end() } catch {} client = novoClient(); await client.connect() }
async function q(sql, params, tent = 4) {
  let ultimo
  for (let i = 1; i <= tent; i++) {
    try { return await client.query(sql, params) }
    catch (e) { ultimo = e; if (i < tent) { await new Promise((r) => setTimeout(r, 800)); await reconectar() } }
  }
  throw ultimo
}

let linhas = JSON.parse(readFileSync(ARQUIVO, 'utf8'))
if (SO_NUMERO) linhas = linhas.filter((l) => Number(l.numeroCalcgraf) === SO_NUMERO)
// Só os que têm decomposição STC utilizável.
const comStc = linhas.filter((l) => l.custosCalcgraf && Array.isArray(l.custosCalcgraf.componentes) && l.custosCalcgraf.componentes.length)
console.log(`Cálculos no arquivo: ${linhas.length} | com custosCalcgraf: ${comStc.length}${DRY ? ' (DRY)' : ''}`)
if (DRY) { try { await client.end() } catch {}; process.exit(0) }

// UPDATE em lote: um statement por lote, casando por (empresa_id, numero_calcgraf).
async function flush(lote) {
  if (!lote.length) return 0
  const values = []
  const params = [EMPRESA]
  let p = 2
  for (const it of lote) {
    values.push(`($${p++}::int, $${p++}::jsonb)`)
    params.push(Number(it.numeroCalcgraf), JSON.stringify(it.custosCalcgraf))
  }
  const sql = `
    UPDATE calculo_grafico c
    SET custos_calcgraf = v.custos
    FROM (VALUES ${values.join(',')}) AS v(numero_calcgraf, custos)
    WHERE c.empresa_id = $1 AND c.numero_calcgraf = v.numero_calcgraf`
  const r = await q(sql, params)
  return r.rowCount || 0
}

let proc = 0, afetados = 0
const LOTE = 300
for (let i = 0; i < comStc.length; i += LOTE) {
  const lote = comStc.slice(i, i + LOTE)
  afetados += await flush(lote)
  proc += lote.length
  console.log(`  ${proc}/${comStc.length} (linhas atualizadas ${afetados})`)
}

const verif = await q(`SELECT COUNT(*)::int n FROM calculo_grafico WHERE empresa_id=$1 AND custos_calcgraf IS NOT NULL`, [EMPRESA])
console.log(`\n===== RESUMO ===== escritos=${afetados} | total com custos_calcgraf no banco=${verif.rows[0].n}`)
try { await client.end() } catch {}
