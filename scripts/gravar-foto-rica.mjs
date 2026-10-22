// Grava a FOTO RICA (cartoon/export/CalculosAcervoRico.json) na coluna
// resultado_calculo de cada calculo_grafico, por (empresaId, numeroCalcgraf),
// e também grava cliente_doc/cliente_codigo (de-para de cliente por CNPJ —
// spec orcamento-repeticao-engenharia-completa).
//
// npx tsx trava nesta máquina → usamos `pg` direto. Idempotente (UPDATE por
// numero_calcgraf). NÃO altera valores/foto de forma destrutiva; só grava a foto
// atual + documento/código do cliente. NÃO toca PCP (tabela isolada).
//
// Uso: $env:DATABASE_URL=<neon pooler>; node scripts/gravar-foto-rica.mjs [--dry-run]
import pg from 'pg'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CONN = process.env.DATABASE_URL
if (!CONN) { console.error('Defina DATABASE_URL (Neon).'); process.exit(1) }
const EMPRESA = process.env.EMPRESA_ID || '75848e24-742e-461d-b913-1642c5b83ae9'
const DRY = process.argv.includes('--dry-run')

const linhas = JSON.parse(readFileSync(join('cartoon', 'export', 'CalculosAcervoRico.json'), 'utf8'))
  .filter((l) => l.numeroCalcgraf != null)
console.log(`Fotos a aplicar: ${linhas.length}${DRY ? ' (DRY-RUN)' : ''}`)

// Conexão resiliente: o pooler do Neon derruba conexões em loops longos
// (ECONNRESET). Reconecta e retenta a query até 3x.
let client = new pg.Client({ connectionString: CONN, ssl: { rejectUnauthorized: false } })
await client.connect()
async function reconectar() {
  try { await client.end() } catch { /* ignore */ }
  client = new pg.Client({ connectionString: CONN, ssl: { rejectUnauthorized: false } })
  await client.connect()
}
async function queryRetry(sql, params, tent = 3) {
  let ultimo
  for (let i = 1; i <= tent; i++) {
    try { return await client.query(sql, params) }
    catch (e) {
      ultimo = e
      if (i < tent) { await new Promise((r) => setTimeout(r, 800)); await reconectar() }
    }
  }
  throw ultimo
}

let atualizados = 0, semCalculo = 0, comDoc = 0
try {
  const exist = await queryRetry(
    `SELECT numero_calcgraf FROM calculo_grafico WHERE empresa_id = $1 AND numero_calcgraf IS NOT NULL`, [EMPRESA])
  const existentes = new Set(exist.rows.map((r) => Number(r.numero_calcgraf)))
  console.log(`Cálculos existentes em produção: ${existentes.size}`)

  let i = 0
  for (const l of linhas) {
    i++
    if (!existentes.has(Number(l.numeroCalcgraf))) { semCalculo++; continue }
    if (l.clienteDoc) comDoc++
    if (DRY) { atualizados++; continue }
    const r = await queryRetry(
      `UPDATE calculo_grafico
         SET resultado_calculo = $1, valor_total = $2,
             cliente_doc = $3, cliente_codigo = $4
       WHERE empresa_id = $5 AND numero_calcgraf = $6`,
      [JSON.stringify(l.foto), l.valorTotal, l.clienteDoc ?? null, l.clienteCodigo ?? null, EMPRESA, l.numeroCalcgraf],
    )
    atualizados += r.rowCount
    if (i % 500 === 0) console.log(`  ${i}/${linhas.length} (atualizados ${atualizados})`)
  }
} finally {
  try { await client.end() } catch { /* ignore */ }
}
console.log('\n===== RESUMO =====')
console.log(JSON.stringify({ atualizados, semCalculo, comDocumentoCliente: comDoc }, null, 2))
