// Lote de ENRIQUECIMENTO da engenharia dos cálculos migrados do Calcgraf.
// Reproduz o de-para do enriquecimento-engenharia.service (papel por
// suporte+gramatura, cliente por CNPJ→código, acabamentos, máquina) e grava os
// campos RESOLVIDOS de volta no calculo_grafico. FOTO (resultado_calculo)
// IMUTÁVEL. Nunca inventa (match único). Idempotente. Multi-tenant (empresaId).
//
// Uso: $env:DATABASE_URL=<neon>; node scripts/enriquecer-engenharia-lote.mjs [--dry-run] [--limite N]
// Task 7 da spec orcamento-repeticao-engenharia-completa.
import pg from 'pg'

const CONN = process.env.DATABASE_URL
if (!CONN) { console.error('Defina DATABASE_URL (Neon).'); process.exit(1) }
const EMPRESA = process.env.EMPRESA_ID || '75848e24-742e-461d-b913-1642c5b83ae9'
const DRY = process.argv.includes('--dry-run')
const idxLim = process.argv.indexOf('--limite')
const LIMITE = idxLim >= 0 ? Number(process.argv[idxLim + 1]) : null

const norm = (s) => (s ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toUpperCase().replace(/\s+/g, ' ').trim()
const normDoc = (s) => (s ?? '').replace(/\D/g, '')
// Essencial = o que trava a montagem. Cores é entrada manual (não bloqueia).
const ESSENCIAIS = ['papel', 'gramatura']

function novoClient() {
  const cl = new pg.Client({ connectionString: CONN, ssl: { rejectUnauthorized: false } })
  // Sem handler, um ECONNRESET do pooler vira 'unhandled error' e derruba o
  // processo. Captura e ignora — o queryRetry/flush reconecta e reexecuta.
  cl.on('error', () => { /* tratado por reconectar() */ })
  return cl
}
let client = novoClient()
await client.connect()
async function reconectar() {
  try { await client.end() } catch { /* ignore */ }
  client = novoClient()
  await client.connect()
}
async function q(sql, params, tent = 3) {
  let ultimo
  for (let i = 1; i <= tent; i++) {
    try { return await client.query(sql, params) }
    catch (e) { ultimo = e; if (i < tent) { await new Promise((r) => setTimeout(r, 800)); await reconectar() } }
  }
  throw ultimo
}

// ── Cadastros do Vizor (de-para alvo) ──
const papeis = (await q(
  `SELECT id, descricao, suporte_id, gramatura FROM preco_materia_prima WHERE empresa_id=$1 AND tipo='PAPEL' AND status=true`, [EMPRESA])).rows
const tintas = (await q(
  `SELECT id, descricao FROM preco_materia_prima WHERE empresa_id=$1 AND tipo='TINTA' AND status=true`, [EMPRESA])).rows
const acabs = (await q(`SELECT id, nome FROM acabamento_grafico WHERE empresa_id=$1`, [EMPRESA])).rows
const centros = (await q(
  `SELECT cp.id, cp.descricao FROM centro_producao cp
     JOIN tipo_processo tp ON tp.id = cp.tipo_processo_id
    WHERE cp.empresa_id=$1 AND cp.status=true AND tp.codigo='IMPRESSAO'`, [EMPRESA])).rows
const clientes = (await q(`SELECT id, cpf_cnpj, codigo_calcgraf FROM cliente WHERE empresa_id=$1`, [EMPRESA])).rows

// índices
const idxUnicoPorNome = (rows, campo) => {
  const m = new Map()
  for (const r of rows) { const k = norm(r[campo]); if (!m.has(k)) m.set(k, []); m.get(k).push(r) }
  return m
}
const papelExato = idxUnicoPorNome(papeis, 'descricao')
const tintaExato = idxUnicoPorNome(tintas, 'descricao')
const acabExato = idxUnicoPorNome(acabs, 'nome')
const clientePorDoc = new Map(clientes.map((c) => [normDoc(c.cpf_cnpj), c]))
const clientePorCodigo = new Map(clientes.filter((c) => c.codigo_calcgraf != null).map((c) => [c.codigo_calcgraf, c]))
const unico = (map, k) => { const a = map.get(k); return a && a.length === 1 ? a[0] : undefined }

// resolve papel por suporte+gramatura (3 estratégias)
function resolverPapel(nomeSuporte, gram) {
  const alvo = norm(nomeSuporte)
  if (!alvo) return undefined
  let p = unico(papelExato, alvo)
  if (p) return p
  const g = gram != null && gram > 0 ? Math.round(gram) : null
  if (g == null) return undefined
  p = unico(papelExato, norm(`${nomeSuporte} ${g}`))
  if (p) return p
  // base+gram: descrição sem número final == suporte E gramatura cadastro == g
  const cands = papeis.filter((c) => {
    const base = norm(c.descricao).replace(/\s+\d+$/, '')
    const gc = c.gramatura != null ? Math.round(Number(c.gramatura)) : null
    return base === alvo && gc === g
  })
  return cands.length === 1 ? cands[0] : undefined
}

console.log(`Cadastros: ${papeis.length} papel, ${tintas.length} tinta, ${acabs.length} acab, ${centros.length} máquina, ${clientes.length} cliente`)

// ── Cálculos migrados ──
let sql = `SELECT id, resultado_calculo, cliente_doc, cliente_codigo, engenharia_completa
             FROM calculo_grafico WHERE empresa_id=$1 AND origem='MIGRADO_CALCGRAF' AND resultado_calculo IS NOT NULL
            ORDER BY numero_calcgraf DESC`
if (LIMITE) sql += ` LIMIT ${LIMITE}`
const calcs = (await q(sql, [EMPRESA])).rows
console.log(`Cálculos a processar: ${calcs.length}${DRY ? ' (DRY-RUN)' : ''}`)

// Aplica um lote de UPDATEs numa única transação (muito mais rápido no pooler
// que 1 commit por query). Retorna quantos foram aplicados; em falha, reconecta
// e reexecuta o lote fora de transação como fallback.
async function flush(ops) {
  if (!ops.length) return 0
  try {
    await q('BEGIN')
    for (const op of ops) await client.query(op.sql, op.vals)
    await client.query('COMMIT')
    return ops.length
  } catch (e) {
    try { await client.query('ROLLBACK') } catch { /* ignore */ }
    await reconectar()
    let n = 0
    for (const op of ops) { await q(op.sql, op.vals); n++ }
    return n
  }
}

let proc = 0, papelOk = 0, maqOk = 0, acabOk = 0, cliOk = 0, completos = 0, gravados = 0
const lote = []
for (const c of calcs) {
  proc++
  const foto = c.resultado_calculo
  if (!foto || foto.versaoFoto !== 2) continue

  const campos = {}
  const pendentes = []

  // papel/gramatura
  const plano = (foto.planos || []).find((p) => p.suporte)
  const nomeSup = plano?.suporte ?? (foto.suportes || [])[0]?.nome ?? null
  const gramFoto = plano?.gramatura ?? null
  if (nomeSup) {
    const papel = resolverPapel(nomeSup, gramFoto)
    if (papel) {
      campos.papel_id = papel.id
      if (papel.suporte_id) campos.suporte_id = papel.suporte_id
      const g = gramFoto ?? (papel.gramatura != null ? Number(papel.gramatura) : null)
      if (g != null && g > 0) campos.gramatura = g; else pendentes.push('gramatura')
      papelOk++
    } else { pendentes.push('papel'); if (gramFoto > 0) campos.gramatura = gramFoto; else pendentes.push('gramatura') }
  } else { pendentes.push('papel'); pendentes.push('gramatura') }

  // cores (sempre pendente no de-para automático — vocabulário incompatível)
  const tts = foto.tintas || []
  const coresRes = []
  let coresPend = tts.length === 0
  for (const t of tts) {
    const tinta = unico(tintaExato, norm(t.nome))
    if (tinta) coresRes.push({ nome: t.nome, precoKg: null, coberturaPercent: Number(t.coberturaPercent) || 0 })
    else coresPend = true
  }
  if (coresPend) pendentes.push('cores')

  // acabamentos
  const acs = foto.acabamentos || []
  const acabRes = []
  let acabPend = false
  for (const a of acs) { const m = unico(acabExato, norm(a.descricao)); if (m) acabRes.push({ acabamentoId: m.id, nome: m.nome }); else acabPend = true }
  if (acabRes.length) { campos.acabamentos_ricos = JSON.stringify(acabRes); acabOk++ }
  if (acabPend || acs.length === 0) pendentes.push('acabamentos')

  // máquina
  const imp = (foto.impressao || [])[0]
  if (imp?.descricao) {
    const alvo = norm(imp.descricao)
    const cands = centros.filter((x) => { const d = norm(x.descricao); return d === alvo || alvo.includes(d) || d.includes(alvo) })
    if (cands.length === 1) { campos.maquina_id = cands[0].id; maqOk++ } else pendentes.push('maquina')
  } else pendentes.push('maquina')

  // cliente: CNPJ → código
  const doc = normDoc(c.cliente_doc)
  let cli = doc ? clientePorDoc.get(doc) : undefined
  if (!cli && c.cliente_codigo != null) cli = clientePorCodigo.get(c.cliente_codigo)
  if (cli) { campos.cliente_id = cli.id; cliOk++ } else pendentes.push('cliente')

  const essPend = pendentes.filter((p) => ESSENCIAIS.includes(p))
  const completo = essPend.length === 0
  if (completo) completos++

  if (DRY) continue
  if (c.engenharia_completa === true) continue // idempotência

  // monta UPDATE dinâmico só com campos resolvidos (acumula p/ transação em lote)
  const sets = []; const vals = []; let i = 1
  for (const [k, v] of Object.entries(campos)) { sets.push(`"${k}"=$${i++}`); vals.push(v) }
  sets.push(`"engenharia_pendentes"=$${i++}`); vals.push(pendentes.length ? JSON.stringify(pendentes) : null)
  sets.push(`"engenharia_completa"=$${i++}`); vals.push(completo)
  vals.push(c.id); vals.push(EMPRESA)
  lote.push({ sql: `UPDATE calculo_grafico SET ${sets.join(', ')} WHERE id=$${i++} AND empresa_id=$${i}`, vals })
  if (lote.length >= 200) { gravados += await flush(lote); lote.length = 0; console.log(`  ${proc}/${calcs.length} (gravados ${gravados})`) }
}
if (!DRY && lote.length) { gravados += await flush(lote); lote.length = 0 }

const pct = (n) => `${n} (${(100 * n / proc).toFixed(1)}%)`
console.log('\n===== RESUMO =====')
console.log(JSON.stringify({
  modo: DRY ? 'DRY-RUN' : 'APPLY',
  processados: proc,
  papelResolvido: pct(papelOk),
  maquinaResolvida: pct(maqOk),
  acabamentoResolvido: pct(acabOk),
  clienteResolvido: pct(cliOk),
  essencialCompleto: pct(completos),
  gravados,
}, null, 2))
try { await client.end() } catch { /* ignore */ }
