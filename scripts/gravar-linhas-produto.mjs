/**
 * Gravador de LINHAS DE PRODUTO (tarefa 13.2 da spec
 * orcamento-grafico-paridade-total-calcgraf).
 *
 * Lê cartoon/export/paridade-linhas-produto.json (gerado por
 * exportar-paridade-calcgraf.mjs) e faz upsert em `linha_produto` por
 * (empresa_id, codigo) na empresa Carton Wega.
 *
 * Regras:
 *   - Idempotente: rodar de novo produz o mesmo estado (não duplica).
 *   - NÃO sobrescreve o `nome` ajustado manualmente (só insere o que falta).
 *   - empresaId = Carton Wega (arg/env; default 75848e24-...).
 *   - RECUSA rodar contra localhost (produção é Neon).
 *   - --dry-run para simular sem gravar.
 *
 * Uso:
 *   $env:DATABASE_URL_PROD="postgres://...neon..."; node scripts/gravar-linhas-produto.mjs [--dry-run] [--empresa <id>]
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
const ARQUIVO = join('cartoon', 'export', 'paridade-linhas-produto.json')

function resolverConn() {
  const str = process.env.DATABASE_URL_PROD || process.env.DATABASE_URL
  if (!str) throw new Error('Defina DATABASE_URL_PROD (ou DATABASE_URL) com a string do Neon.')
  if (/@localhost|@127\.0\.0\.1|localhost:|127\.0\.0\.1:/.test(str)) {
    throw new Error('Connection string aponta para LOCALHOST. Este gravador é para PRODUÇÃO (Neon).')
  }
  return str
}

async function main() {
  const linhas = JSON.parse(readFileSync(ARQUIVO, 'utf8'))
  console.log(`Linhas de produto no arquivo: ${linhas.length}${DRY ? ' (DRY-RUN)' : ''}`)

  const client = new pg.Client({ connectionString: resolverConn(), ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    let criados = 0
    let mantidos = 0
    for (const l of linhas) {
      const codigo = String(l.codigo)
      const nome = (l.nome || '').trim()
      if (!nome) continue
      if (DRY) {
        const ex = await client.query(
          'SELECT 1 FROM linha_produto WHERE empresa_id = $1 AND codigo = $2',
          [EMPRESA, codigo],
        )
        if (ex.rowCount) mantidos++
        else criados++
        continue
      }
      // Idempotente + não sobrescreve nome manual: ON CONFLICT DO NOTHING.
      const r = await client.query(
        `INSERT INTO linha_produto (id, empresa_id, codigo, nome, ativo, criado_em, atualizado_em)
         VALUES (gen_random_uuid(), $1, $2, $3, true, now(), now())
         ON CONFLICT (empresa_id, codigo) DO NOTHING`,
        [EMPRESA, codigo, nome],
      )
      if (r.rowCount === 1) {
        criados++
        console.log(`  + ${codigo}  ${nome}`)
      } else {
        mantidos++
        console.log(`  = ${codigo}  (já existia, preservado)`)
      }
    }
    console.log(`\nResultado: ${criados} criados, ${mantidos} preservados.`)
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error('ERRO:', e.message)
  process.exit(1)
})
