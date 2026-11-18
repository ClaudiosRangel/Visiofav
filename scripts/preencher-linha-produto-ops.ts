/**
 * Preenche a tag [Linha] (Linha de Produto) nas OPs JÁ importadas, relendo o
 * PDF salvo (`pdf_data`) e extraindo o campo "Produto:" do cabeçalho.
 *
 * - Só ACRESCENTA a tag; não mexe em nenhuma outra tag/campo.
 * - Idempotente: OPs que já têm [Linha] são ignoradas.
 * - Padrão = DRY-RUN (só mostra). Para gravar: --apply.
 * - OPs sem PDF salvo (ex.: vindas do agente Calcgraf) são puladas — o
 *   "Reextrair PDF" também não resolve nelas; ver roadmap em pcp-modulo.md §19.
 *
 * Uso:
 *   DATABASE_URL=... npx tsx scripts/preencher-linha-produto-ops.ts [--apply] [--empresa <uuid>]
 */
import pg from 'pg'
import { extrairTextoPdf } from '../src/modules/pcp/importacao-op/pdf-extractor.service'
import { isGprintPdf, parseGprintPdf } from '../src/modules/pcp/importacao-op/parsers/gprint-parser'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const iEmp = args.indexOf('--empresa')
const empresaId = iEmp >= 0 ? args[iEmp + 1] : null

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('Defina DATABASE_URL')
  const c = new pg.Client({ connectionString: url, ssl: url.includes('localhost') ? undefined : { rejectUnauthorized: false } })
  await c.connect()

  const params: unknown[] = []
  let filtroEmpresa = ''
  if (empresaId) { params.push(empresaId); filtroEmpresa = `AND empresa_id = $${params.length}` }
  const { rows: ids } = await c.query(
    `SELECT id, numero, referencia_externa FROM ordem_producao
      WHERE pdf_data IS NOT NULL
        AND status NOT IN ('CANCELADA')
        AND (observacoes IS NULL OR observacoes NOT LIKE '%[Linha]%')
        ${filtroEmpresa}
      ORDER BY numero`,
    params,
  )
  console.log(`${apply ? 'APLICANDO' : 'DRY-RUN'} — ${ids.length} OP(s) sem [Linha] e com PDF`)

  const resumo = new Map<string, number>()
  let gravadas = 0
  let semProduto = 0
  let erros = 0
  for (const row of ids) {
    try {
      const { rows } = await c.query('SELECT observacoes, pdf_data FROM ordem_producao WHERE id = $1', [row.id])
      const ext = await extrairTextoPdf(Buffer.from(rows[0].pdf_data))
      if (!ext.temTexto || !isGprintPdf(ext.texto)) { semProduto++; continue }
      const produto = parseGprintPdf(ext.texto).cabecalho.produto
      if (!produto) { semProduto++; continue }
      resumo.set(produto, (resumo.get(produto) ?? 0) + 1)
      if (apply) {
        const obs = ((rows[0].observacoes as string | null) ?? '').trimEnd()
        await c.query('UPDATE ordem_producao SET observacoes = $1 WHERE id = $2', [`${obs}${obs ? '\n' : ''}[Linha] ${produto}`, row.id])
        gravadas++
      }
    } catch (e) {
      erros++
      console.warn(`OP ${row.referencia_externa ?? row.numero}: ${(e as Error).message}`)
    }
  }
  console.log('Distribuição do campo "Produto:":')
  for (const [k, v] of [...resumo.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`)
  console.log(`Gravadas: ${gravadas} | sem produto/PDF inválido: ${semProduto} | erros: ${erros}`)
  await c.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
