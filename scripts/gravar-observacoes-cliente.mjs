/**
 * Gravador de OBSERVAÇÕES DE CLIENTE (tarefa 13.3 da spec
 * orcamento-grafico-paridade-total-calcgraf).
 *
 * Lê cartoon/export/paridade-observacoes-cliente.json (gerado por
 * exportar-paridade-calcgraf.mjs: { cnpj, observacao }) e grava em
 * `cliente.observacao` casando por CNPJ normalizado (só dígitos) contra
 * `cliente.cpf_cnpj` (também normalizado) + empresa_id da Carton Wega.
 *
 * Regras:
 *   - De-para por CNPJ normalizado (funções puras em lib/depara-cnpj.mjs).
 *   - 0 ou >= 2 clientes candidatos para um CNPJ ⇒ NÃO grava (pula + loga).
 *     (Property 10)
 *   - NÃO sobrescreve `cliente.observacao` já preenchida manualmente.
 *   - Idempotente: rodar de novo produz o mesmo estado.
 *   - empresaId Carton Wega (arg/env; default 75848e24-...).
 *   - RECUSA rodar contra localhost. --dry-run disponível.
 *
 * Uso:
 *   $env:DATABASE_URL_PROD="postgres://...neon..."; node scripts/gravar-observacoes-cliente.mjs [--dry-run] [--empresa <id>]
 */
import pg from 'pg'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizarCnpj, casarCliente } from './lib/depara-cnpj.mjs'

const DRY = process.argv.includes('--dry-run')
const idxEmp = process.argv.indexOf('--empresa')
const EMPRESA =
  (idxEmp >= 0 ? process.argv[idxEmp + 1] : null) ||
  process.env.EMPRESA_ID ||
  '75848e24-742e-461d-b913-1642c5b83ae9'
const MAX_OBS = 1000 // R4.1 — limite do campo
const ARQUIVO = join('cartoon', 'export', 'paridade-observacoes-cliente.json')

function resolverConn() {
  const str = process.env.DATABASE_URL_PROD || process.env.DATABASE_URL
  if (!str) throw new Error('Defina DATABASE_URL_PROD (ou DATABASE_URL) com a string do Neon.')
  if (/@localhost|@127\.0\.0\.1|localhost:|127\.0\.0\.1:/.test(str)) {
    throw new Error('Connection string aponta para LOCALHOST. Este gravador é para PRODUÇÃO (Neon).')
  }
  return str
}

async function main() {
  const registros = JSON.parse(readFileSync(ARQUIVO, 'utf8'))
  console.log(`Observações no arquivo: ${registros.length}${DRY ? ' (DRY-RUN)' : ''}`)

  const client = new pg.Client({ connectionString: resolverConn(), ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    // Carrega os clientes da empresa (id + cpf_cnpj) para montar o índice por CNPJ.
    const clientes = await client.query(
      `SELECT id, cpf_cnpj FROM cliente WHERE empresa_id = $1`,
      [EMPRESA],
    )
    const porCnpj = new Map()
    for (const c of clientes.rows) {
      const doc = normalizarCnpj(c.cpf_cnpj)
      if (!doc) continue
      if (!porCnpj.has(doc)) porCnpj.set(doc, [])
      porCnpj.get(doc).push({ id: c.id, cpfCnpj: doc })
    }

    let gravados = 0
    let ambiguos = 0
    let semCliente = 0
    let preservados = 0

    for (const r of registros) {
      const cnpj = normalizarCnpj(r.cnpj)
      let observacao = (r.observacao || '').trim()
      if (!cnpj || !observacao) continue
      if (observacao.length > MAX_OBS) observacao = observacao.slice(0, MAX_OBS)

      const candidatos = porCnpj.get(cnpj) || []
      const clienteId = casarCliente(cnpj, candidatos)

      if (!clienteId) {
        if (candidatos.length === 0) {
          semCliente++
          console.log(`  · ${cnpj}: nenhum cliente (pulado)`)
        } else {
          ambiguos++
          console.log(`  · ${cnpj}: ${candidatos.length} candidatos (ambíguo, pulado)`)
        }
        continue
      }

      if (DRY) {
        gravados++
        continue
      }

      // Idempotente + não sobrescreve manual: só grava onde observacao está vazia/nula.
      const upd = await client.query(
        `UPDATE cliente
         SET observacao = $1
         WHERE id = $2 AND empresa_id = $3
           AND (observacao IS NULL OR btrim(observacao) = '')`,
        [observacao, clienteId, EMPRESA],
      )
      if (upd.rowCount === 1) {
        gravados++
        console.log(`  + ${cnpj} → cliente ${clienteId}`)
      } else {
        preservados++
        console.log(`  = ${cnpj} → cliente ${clienteId} (observação manual preservada)`)
      }
    }

    console.log(
      `\nResultado: ${gravados} gravados, ${preservados} preservados, ` +
        `${ambiguos} ambíguos pulados, ${semCliente} sem cliente.`,
    )
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error('ERRO:', e.message)
  process.exit(1)
})
