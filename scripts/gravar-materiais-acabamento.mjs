/**
 * Gravador de MATERIAIS DE ACABAMENTO (tarefa 13.4 da spec
 * orcamento-grafico-paridade-total-calcgraf).
 *
 * Lê cartoon/export/paridade-materiais-acabamento.json (gerado por
 * exportar-paridade-calcgraf.mjs: { codigo, nome, valor }) e faz upsert em
 * `material_acabamento` por (empresa_id, codigo), gravando valor_referencia.
 *
 * Regras:
 *   - Idempotente por (empresa_id, codigo).
 *   - NÃO sobrescreve valor_referencia ajustado manualmente: no conflito,
 *     mantém o registro existente (ON CONFLICT DO NOTHING). Novos registros
 *     nascem com `ativo=true`; a flag "computar no custo" é por VÍNCULO de
 *     item (não existe no catálogo) — portanto não é gravada aqui.
 *   - empresaId Carton Wega (arg/env; default 75848e24-...).
 *   - RECUSA rodar contra localhost. --dry-run disponível.
 *
 * Uso:
 *   $env:DATABASE_URL_PROD="postgres://...neon..."; node scripts/gravar-materiais-acabamento.mjs [--dry-run] [--empresa <id>]
 */
import pg from 'pg'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const DRY = process.argv.includes('--dry-run')
const idxEmp = process.argv.indexOf('--empresa')
const EMPRESA =
  (idxEmp >= 0 ? process.argv[idxEmp + 1] : null) ||
  process.env.EMPRESA_ID ||
  '75848e24-742e-461d-b913-1642c5b83ae9'
const VALOR_MAX = 9999999.99 // R6.2 — teto do valor
const ARQUIVO = join('cartoon', 'export', 'paridade-materiais-acabamento.json')

function resolverConn() {
  const str = process.env.DATABASE_URL_PROD || process.env.DATABASE_URL
  if (!str) throw new Error('Defina DATABASE_URL_PROD (ou DATABASE_URL) com a string do Neon.')
  if (/@localhost|@127\.0\.0\.1|localhost:|127\.0\.0\.1:/.test(str)) {
    throw new Error('Connection string aponta para LOCALHOST. Este gravador é para PRODUÇÃO (Neon).')
  }
  return str
}

function sanitizarValor(v) {
  let n = Number(v)
  if (!Number.isFinite(n) || n < 0) n = 0
  if (n > VALOR_MAX) n = VALOR_MAX
  return n
}

async function main() {
  const materiais = JSON.parse(readFileSync(ARQUIVO, 'utf8'))
  console.log(`Materiais no arquivo: ${materiais.length}${DRY ? ' (DRY-RUN)' : ''}`)

  const client = new pg.Client({ connectionString: resolverConn(), ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    let criados = 0
    let preservados = 0
    for (const m of materiais) {
      const codigo = String(m.codigo)
      const nome = (m.nome || '').trim()
      const valor = sanitizarValor(m.valor)
      if (!nome) continue
      if (DRY) {
        const ex = await client.query(
          'SELECT 1 FROM material_acabamento WHERE empresa_id = $1 AND codigo = $2',
          [EMPRESA, codigo],
        )
        if (ex.rowCount) preservados++
        else criados++
        continue
      }
      const r = await client.query(
        `INSERT INTO material_acabamento (id, empresa_id, codigo, nome, valor_referencia, ativo)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, true)
         ON CONFLICT (empresa_id, codigo) DO NOTHING`,
        [EMPRESA, codigo, nome, valor],
      )
      if (r.rowCount === 1) {
        criados++
        console.log(`  + ${codigo}  ${nome}  (R$ ${valor})`)
      } else {
        preservados++
        console.log(`  = ${codigo}  ${nome}  (já existia, valor manual preservado)`)
      }
    }
    console.log(`\nResultado: ${criados} criados, ${preservados} preservados.`)
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error('ERRO:', e.message)
  process.exit(1)
})
