// Remove DUPLICATAS do cadastro de papel (preco_materia_prima tipo PAPEL) no
// padrão {A: com gramatura+preço+suporte} × {B: sem gramatura, preço 0, sem
// suporte} com o MESMO nome normalizado. Antes de apagar B, REAPONTA qualquer
// referência (calculo_grafico.papel_id / item_orcamento_grafico.papel_id) de B
// para A — nunca perde vínculo. Idempotente. Multi-tenant (empresaId).
//
// Uso: $env:DATABASE_URL=<neon>; node scripts/limpar-duplicatas-papel.mjs [--dry-run]
import pg from 'pg'
const CONN = process.env.DATABASE_URL
if (!CONN) { console.error('Defina DATABASE_URL'); process.exit(1) }
const EMPRESA = process.env.EMPRESA_ID || '75848e24-742e-461d-b913-1642c5b83ae9'
const DRY = process.argv.includes('--dry-run')
const norm = (s) => (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()

const c = new pg.Client({ connectionString: CONN, ssl: { rejectUnauthorized: false } })
c.on('error', () => {})
await c.connect()

const rows = (await c.query(
  `SELECT id, descricao, gramatura, preco_unitario, suporte_id FROM preco_materia_prima
   WHERE empresa_id=$1 AND tipo='PAPEL' AND status=true`, [EMPRESA])).rows

const grupos = new Map()
for (const r of rows) { const k = norm(r.descricao); if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(r) }

// pares seguros: exatamente 2 linhas, uma "boa" (gramatura>0) e uma "vazia"
// (gramatura null/0 E preço 0 E sem suporte).
const paresRemover = []
for (const [, a] of grupos) {
  if (a.length !== 2) continue
  const bons = a.filter((x) => x.gramatura != null && Number(x.gramatura) > 0)
  const vazios = a.filter((x) => (x.gramatura == null || Number(x.gramatura) === 0) && Number(x.preco_unitario) === 0 && !x.suporte_id)
  if (bons.length === 1 && vazios.length === 1) paresRemover.push({ bom: bons[0], vazio: vazios[0] })
}
console.log(`Pares a limpar (reaponta B→A e remove B): ${paresRemover.length}${DRY ? ' (DRY)' : ''}`)

let reapontCalc = 0, reapontItem = 0, removidos = 0
if (!DRY) await c.query('BEGIN')
try {
  for (const { bom, vazio } of paresRemover) {
    if (DRY) continue
    reapontCalc += (await c.query(`UPDATE calculo_grafico SET papel_id=$1 WHERE empresa_id=$2 AND papel_id=$3`, [bom.id, EMPRESA, vazio.id])).rowCount
    // item_orcamento_grafico pode ter empresa_id; reaponta defensivo
    try {
      reapontItem += (await c.query(`UPDATE item_orcamento_grafico SET papel_id=$1 WHERE empresa_id=$2 AND papel_id=$3`, [bom.id, EMPRESA, vazio.id])).rowCount
    } catch { /* tabela/coluna pode não existir — ignora */ }
    removidos += (await c.query(`DELETE FROM preco_materia_prima WHERE id=$1 AND empresa_id=$2`, [vazio.id, EMPRESA])).rowCount
  }
  if (!DRY) await c.query('COMMIT')
} catch (e) {
  if (!DRY) await c.query('ROLLBACK')
  console.error('ROLLBACK:', e.message); process.exit(1)
}

console.log(JSON.stringify({ modo: DRY ? 'DRY' : 'APPLY', pares: paresRemover.length, reapontadosCalc: reapontCalc, reapontadosItem: reapontItem, removidos }, null, 2))
await c.end()
