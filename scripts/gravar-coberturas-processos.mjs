/**
 * Gravador de COBERTURAS DE TINTA e PROCESSOS DE IMPRESSÃO (tarefa 13.5 da spec
 * orcamento-grafico-paridade-total-calcgraf).
 *
 * Lê cartoon/export/paridade-coberturas.json e paridade-processos.json (gerados
 * por exportar-paridade-calcgraf.mjs: { codigo, nome }) e faz upsert em
 * `cobertura_tinta` e `processo_impressao` por (empresa_id, codigo).
 *
 * Regras:
 *   - Idempotente por (empresa_id, codigo); não duplica.
 *   - NÃO sobrescreve o nome existente (ON CONFLICT DO NOTHING) — preserva ajuste manual.
 *   - empresaId Carton Wega (arg/env; default 75848e24-...).
 *   - RECUSA rodar contra localhost. --dry-run disponível.
 *
 * Uso:
 *   $env:DATABASE_URL_PROD="postgres://...neon..."; node scripts/gravar-coberturas-processos.mjs [--dry-run] [--empresa <id>]
 */
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const DRY = process.argv.includes('--dry-run')
const idxEmp = process.argv.indexOf('--empresa')
const EMPRESA =
  (idxEmp >= 0 ? process.argv[idxEmp + 1] : null) ||
  process.env.EMPRESA_ID ||
  '75848e24-742e-461d-b913-1642c5b83ae9'

function resolverConn() {
  const str = process.env.DATABASE_URL_PROD || process.env.DATABASE_URL
  if (!str) throw new Error('Defina DATABASE_URL_PROD (ou DATABASE_URL) com a string do Neon.')
  if (/@localhost|@127\.0\.0\.1|localhost:|127\.0\.0\.1:/.test(str)) {
    throw new Error('Connection string aponta para LOCALHOST. Este gravador é para PRODUÇÃO (Neon).')
  }
  return str
}

function carregar(arquivo) {
  const p = join('cartoon', 'export', arquivo)
  if (!existsSync(p)) {
    console.warn(`  ! ${arquivo} não encontrado — pulando.`)
    return []
  }
  return JSON.parse(readFileSync(p, 'utf8'))
}

async function upsertCadastro(client, tabela, registros, label) {
  let criados = 0
  let preservados = 0
  for (const reg of registros) {
    const codigo = String(reg.codigo)
    const nome = (reg.nome || '').trim()
    if (!nome) continue
    if (DRY) {
      const ex = await client.query(
        `SELECT 1 FROM ${tabela} WHERE empresa_id = $1 AND codigo = $2`,
        [EMPRESA, codigo],
      )
      if (ex.rowCount) preservados++
      else criados++
      continue
    }
    const r = await client.query(
      `INSERT INTO ${tabela} (id, empresa_id, codigo, nome, ativo)
       VALUES (gen_random_uuid(), $1, $2, $3, true)
       ON CONFLICT (empresa_id, codigo) DO NOTHING`,
      [EMPRESA, codigo, nome],
    )
    if (r.rowCount === 1) {
      criados++
      console.log(`  + [${label}] ${codigo}  ${nome}`)
    } else {
      preservados++
      console.log(`  = [${label}] ${codigo}  (já existia, preservado)`)
    }
  }
  console.log(`  ${label}: ${criados} criados, ${preservados} preservados.`)
}

async function main() {
  const coberturas = carregar('paridade-coberturas.json')
  const processos = carregar('paridade-processos.json')
  console.log(
    `Coberturas: ${coberturas.length} | Processos: ${processos.length}${DRY ? ' (DRY-RUN)' : ''}`,
  )

  const client = new pg.Client({ connectionString: resolverConn(), ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    await upsertCadastro(client, 'cobertura_tinta', coberturas, 'cobertura')
    await upsertCadastro(client, 'processo_impressao', processos, 'processo')
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error('ERRO:', e.message)
  process.exit(1)
})
