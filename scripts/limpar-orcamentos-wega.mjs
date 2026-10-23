// Limpa os ORÇAMENTOS gráficos da Carton Wega (NÃO toca calculo_grafico/biblioteca
// nem cadastros). Ordem de FK: planos → itens → orçamentos. Idempotente.
// Uso: $env:DATABASE_URL=<neon>; node scripts/limpar-orcamentos-wega.mjs
import pg from 'pg'
const CONN = process.env.DATABASE_URL
if (!CONN) { console.error('Defina DATABASE_URL'); process.exit(1) }
const E = process.env.EMPRESA_ID || '75848e24-742e-461d-b913-1642c5b83ae9'
const c = new pg.Client({ connectionString: CONN, ssl: { rejectUnauthorized: false } })
c.on('error', () => {})
await c.connect()
const antes = (await c.query(`SELECT COUNT(*)::int n FROM orcamento_grafico WHERE empresa_id=$1`, [E])).rows[0].n
await c.query('BEGIN')
try {
  let planos = 0
  try { planos = (await c.query(`DELETE FROM plano_calculo_grafico WHERE empresa_id=$1`, [E])).rowCount }
  catch { planos = (await c.query(`DELETE FROM plano_calculo_grafico WHERE item_orcamento_id IN (SELECT id FROM item_orcamento_grafico WHERE empresa_id=$1)`, [E])).rowCount }
  const itens = (await c.query(`DELETE FROM item_orcamento_grafico WHERE empresa_id=$1`, [E])).rowCount
  const orcs = (await c.query(`DELETE FROM orcamento_grafico WHERE empresa_id=$1`, [E])).rowCount
  await c.query('COMMIT')
  console.log(JSON.stringify({ antes, planosApagados: planos, itensApagados: itens, orcamentosApagados: orcs }, null, 2))
} catch (e) { await c.query('ROLLBACK'); console.error('ROLLBACK:', e.message); process.exit(1) }
await c.end()
