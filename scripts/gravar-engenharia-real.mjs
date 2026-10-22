// Grava a ENGENHARIA CONCRETA (cartoon/export/EngenhariaCalcgraf.json) nas
// COLUNAS estruturadas do calculo_grafico do Vizor — dados REAIS do Calcgraf
// (medidas, aproveitamento, gramatura, papel/suporte, cores com preço/kg).
// NÃO é foto. De-para de papel por suporte+gramatura (match único). Cores com
// preço real + rendimento padrão (25) — editáveis. Idempotente. Multi-tenant.
//
// Uso: $env:DATABASE_URL=<neon>; node scripts/gravar-engenharia-real.mjs [--dry-run] [--numero N]
import pg from 'pg'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CONN = process.env.DATABASE_URL
if (!CONN) { console.error('Defina DATABASE_URL'); process.exit(1) }
const EMPRESA = process.env.EMPRESA_ID || '75848e24-742e-461d-b913-1642c5b83ae9'
const DRY = process.argv.includes('--dry-run')
const idxNum = process.argv.indexOf('--numero')
const SO_NUMERO = idxNum >= 0 ? Number(process.argv[idxNum + 1]) : null

const norm = (s) => (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()
// CMYK só quando o nome indica escala de processo (não cores Pantone nomeadas).
const CMYK_RE = /\b(escala|cmyk|cm-?k|quadricromia|process)\b/i

function novoClient() {
  const cl = new pg.Client({ connectionString: CONN, ssl: { rejectUnauthorized: false } })
  cl.on('error', () => {})
  return cl
}
let client = novoClient()
await client.connect()
async function reconectar() { try { await client.end() } catch {} client = novoClient(); await client.connect() }
async function q(sql, params, tent = 3) {
  let ultimo
  for (let i = 1; i <= tent; i++) {
    try { return await client.query(sql, params) }
    catch (e) { ultimo = e; if (i < tent) { await new Promise((r) => setTimeout(r, 800)); await reconectar() } }
  }
  throw ultimo
}

// Cadastro de papel do Vizor (de-para alvo)
const papeis = (await q(`SELECT id, descricao, suporte_id, gramatura FROM preco_materia_prima WHERE empresa_id=$1 AND tipo='PAPEL' AND status=true`, [EMPRESA])).rows
const papelExato = new Map()
for (const p of papeis) { const k = norm(p.descricao); if (!papelExato.has(k)) papelExato.set(k, []); papelExato.get(k).push(p) }
const unico = (k) => { const a = papelExato.get(k); return a && a.length === 1 ? a[0] : undefined }

function resolverPapel(nomeSuporte, gram) {
  const alvo = norm(nomeSuporte)
  if (!alvo) return undefined
  let p = unico(alvo); if (p) return p
  const g = gram != null && gram > 0 ? Math.round(gram) : null
  if (g == null) return undefined
  p = unico(norm(`${nomeSuporte} ${g}`)); if (p) return p
  const cands = papeis.filter((c) => {
    const base = norm(c.descricao).replace(/\s+\d+$/, '')
    const gc = c.gramatura != null ? Math.round(Number(c.gramatura)) : null
    return base === alvo && gc === g
  })
  return cands.length === 1 ? cands[0] : undefined
}

let linhas = JSON.parse(readFileSync(join('cartoon', 'export', 'EngenhariaCalcgraf.json'), 'utf8'))
if (SO_NUMERO) linhas = linhas.filter((l) => Number(l.numeroCalcgraf) === SO_NUMERO)
console.log(`Papel cadastro: ${papeis.length} | cálculos a gravar: ${linhas.length}${DRY ? ' (DRY)' : ''}`)

async function flush(ops) {
  if (!ops.length) return 0
  try { await q('BEGIN'); for (const o of ops) await client.query(o.sql, o.vals); await client.query('COMMIT'); return ops.length }
  catch (e) { try { await client.query('ROLLBACK') } catch {} await reconectar(); let n = 0; for (const o of ops) { await q(o.sql, o.vals); n++ } return n }
}

let proc = 0, papelOk = 0, coresOk = 0, aprovOk = 0, medidasOk = 0, gravados = 0
const lote = []
for (const l of linhas) {
  proc++
  const plano = (l.planos || [])[0]
  if (!plano) continue

  const campos = {}
  // papel por suporte+gramatura
  const papel = resolverPapel(plano.suporteNome, plano.gramatura)
  if (papel) {
    campos.papel_id = papel.id
    if (papel.suporte_id) campos.suporte_id = papel.suporte_id
    campos.papel_descricao = plano.suporteNome
    papelOk++
  }
  if (plano.gramatura > 0) campos.gramatura = plano.gramatura
  // aproveitamento real (peças/folha) — imposição concreta
  if (plano.aproveitamento > 0) { campos.aproveitamento_manual = plano.aproveitamento; aprovOk++ }
  // medidas do produto (largura/altura reais em mm). As fórmulas dos TipoEmbalagem
  // 2D usam as variáveis L (largura) e A (altura); gravamos AMBAS as convenções
  // (L/A + largura/altura) para o motor resolver a planificação corretamente —
  // sem isso, L/A caem no default 0 e o encaixe explode (bug do 7665 peças/folha).
  if (plano.produtoLarguraMm > 0 || plano.produtoAlturaMm > 0) {
    const L = plano.produtoLarguraMm || 0
    const A = plano.produtoAlturaMm || 0
    campos.medidas = JSON.stringify({ L, A, largura: L, altura: A })
    medidasOk++
  }
  // cores reais com preço/kg + cobertura (rendimento padrão 25 — editável)
  const tts = l.tintas || []
  if (tts.length > 0) {
    const cores = tts.map((t) => ({
      nome: t.nome || t.nomeCadastro || 'Cor',
      tipo: CMYK_RE.test(t.nome || '') ? 'CMYK' : 'PANTONE',
      coberturaPercent: Number(t.coberturaPercent) || 0,
      precoKg: Number(t.precoKg) > 0 ? Number(t.precoKg) : 0,
      rendimentoM2Kg: 25,
    }))
    campos.cores = JSON.stringify(cores)
    campos.num_cores = cores.length
    coresOk++
  }

  if (DRY) continue
  const sets = []; const vals = []; let i = 1
  for (const [k, v] of Object.entries(campos)) { sets.push(`"${k}"=$${i++}`); vals.push(v) }
  if (!sets.length) continue
  vals.push(EMPRESA); vals.push(Number(l.numeroCalcgraf))
  lote.push({ sql: `UPDATE calculo_grafico SET ${sets.join(', ')} WHERE empresa_id=$${i++} AND numero_calcgraf=$${i}`, vals })
  if (lote.length >= 200) { gravados += await flush(lote); lote.length = 0; console.log(`  ${proc}/${linhas.length} (gravados ${gravados})`) }
}
if (!DRY && lote.length) gravados += await flush(lote)

const pct = (n) => `${n} (${(100 * n / proc).toFixed(1)}%)`
console.log('\n===== RESUMO =====')
console.log(JSON.stringify({ modo: DRY ? 'DRY' : 'APPLY', processados: proc, papelResolvido: pct(papelOk), aproveitamento: pct(aprovOk), medidas: pct(medidasOk), coresComPreco: pct(coresOk), gravados }, null, 2))
try { await client.end() } catch {}
