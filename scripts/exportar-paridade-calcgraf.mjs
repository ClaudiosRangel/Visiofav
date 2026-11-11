/**
 * Exportador de PARIDADE (tarefa 13.1 da spec orcamento-grafico-paridade-total-calcgraf).
 *
 * Lê a base restaurada do sistema gráfico legado (SQL Server local,
 * banco CalcgrafCartonWega) em modo SOMENTE LEITURA e gera arquivos JSON em
 * cartoon/export/ (pasta gitignorada — dados sensíveis).
 *
 * Gera:
 *   - paridade-linhas-produto.json      : { codigo, nome } das linhas ATIVAS.
 *   - paridade-observacoes-cliente.json  : { cnpj, observacao } por cliente
 *                                          (memos concatenados).
 *   - paridade-materiais-acabamento.json : { codigo, nome, valor } (MAT.ACABAMENTO).
 *   - paridade-coberturas.json           : { codigo, nome } (CoberturasTinta ativas).
 *   - paridade-processos.json            : { codigo, nome } (processos de impressão).
 *
 * ENCODING: usamos `sqlcmd -u` (UTF-16 LE) e lemos o arquivo como utf16le,
 * convertendo para UTF-8, para PRESERVAR acentos. NÃO usar FOR JSON padrão nem
 * capturar stdout do console (ambos corrompem acento).
 *
 * Uso:
 *   node scripts/exportar-paridade-calcgraf.mjs
 * Pré-req: SQL Server local de pé, banco CalcgrafCartonWega restaurado.
 * Acesso: sqlcmd -S localhost -E -C -d CalcgrafCartonWega
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const DB = 'CalcgrafCartonWega'
const OUT = join('cartoon', 'export')
mkdirSync(OUT, { recursive: true })

/**
 * Executa uma query que termina com FOR JSON PATH e retorna o array parseado.
 * Grava a saída em arquivo via -o + -u (UTF-16LE) e lê de volta como UTF-8.
 */
function queryJson(sql) {
  const full = `SET NOCOUNT ON; ${sql} FOR JSON PATH`
  const tmp = join(OUT, `_raw-paridade-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`)
  execFileSync(
    'sqlcmd',
    ['-S', 'localhost', '-E', '-C', '-d', DB, '-y', '0', '-u', '-Q', full, '-o', tmp],
    { maxBuffer: 256 * 1024 * 1024 },
  )
  const buf = readFileSync(tmp)
  rmSync(tmp, { force: true })
  const txt = buf
    .toString('utf16le')
    .replace(/^\uFEFF/, '')
    .replace(/\r?\n/g, '')
    .trim()
  if (!txt || txt === 'NULL') return []
  return JSON.parse(txt)
}

function salvar(nome, rows) {
  writeFileSync(join(OUT, `${nome}.json`), JSON.stringify(rows), 'utf8')
  console.log(`  ${nome}.json: ${rows.length} registros`)
}

console.log('Exportando dados de paridade (somente leitura) do legado...')

// 1) Linhas de Produto ATIVAS (R3.2). _LinhasProduto.Ativo in ('Ativo','ATIVO').
{
  const rows = queryJson(
    `SELECT Codigo AS codigo, Nome AS nome
     FROM _LinhasProduto
     WHERE Ativo IN ('Ativo', 'ATIVO')`,
  )
  salvar(
    'paridade-linhas-produto',
    rows.map((r) => ({ codigo: r.codigo, nome: (r.nome || '').trim() })),
  )
}

// 2) Observações de cliente (R5). Memo de cliente = TabelaMemos (NomeTabela='Nomes')
//    casando m.Codigo = Nomes.Codigo. Concatena múltiplos memos do mesmo cliente.
//    Exporta { cnpj: <só dígitos>, observacao }. O de-para por CNPJ é feito no gravador.
{
  const rows = queryJson(
    `SELECT n.Codigo AS codigo, n.CNPJCPF AS cnpjcpf, CAST(m.Memo AS nvarchar(max)) AS memo
     FROM TabelaMemos m
     INNER JOIN Nomes n ON n.Codigo = m.Codigo
     WHERE m.NomeTabela = 'Nomes'
       AND m.Memo IS NOT NULL
       AND CAST(m.Memo AS nvarchar(max)) <> ''`,
  )
  // Agrupa por cliente (Codigo) concatenando memos; normaliza CNPJ para só dígitos.
  const porCliente = new Map()
  for (const r of rows) {
    const memo = (r.memo || '').trim()
    if (!memo) continue
    const cnpj = String(r.cnpjcpf || '').replace(/\D/g, '')
    if (!cnpj) continue // sem documento não há como fazer de-para
    const atual = porCliente.get(r.codigo)
    if (atual) {
      atual.observacao = `${atual.observacao}\n${memo}`
    } else {
      porCliente.set(r.codigo, { cnpj, observacao: memo })
    }
  }
  salvar('paridade-observacoes-cliente', [...porCliente.values()])
}

// 3) Materiais de acabamento (R7). Itc Origem='MAT.ACABAMENTO' + preço da tabela
//    de custo vigente (CodTabelaCusto=2, Coluna=1 → ValorTotal).
{
  const rows = queryJson(
    `SELECT i.Codigo AS codigo, i.Descritivo AS nome, d.ValorTotal AS valor
     FROM Itc i
     LEFT JOIN TabelasCustoDetalhe d
       ON d.CodItc = i.Codigo AND d.CodTabelaCusto = 2 AND d.Coluna = 1
     WHERE i.Origem = 'MAT.ACABAMENTO'
       AND i.Ativo IN ('Ativo', 'ATIVO')`,
  )
  salvar(
    'paridade-materiais-acabamento',
    rows.map((r) => ({
      codigo: r.codigo,
      nome: (r.nome || '').trim(),
      valor: r.valor == null ? 0 : Number(r.valor),
    })),
  )
}

// 4) Coberturas de tinta (R10.4). Fonte confiável = CoberturasTinta (Escala/Especial).
{
  const rows = queryJson(
    `SELECT Codigo AS codigo, Nome AS nome
     FROM CoberturasTinta
     WHERE Ativo IN ('Ativo', 'ATIVO')`,
  )
  salvar(
    'paridade-coberturas',
    rows.map((r) => ({ codigo: r.codigo, nome: (r.nome || '').trim() })),
  )
}

// 5) Processos de impressão (R11.4).
//    NÃO há tabela mestre nomeada de processo de impressão no legado — o código
//    aparece só como FK em CoberturasTinta.CodProcessoImpressao (todas = 2).
//    Exportamos os códigos DISTINTOS realmente usados + um nome SEED documentado
//    (code 2 = "Offset Plana", conforme glossário do design). NÃO inventar massa.
{
  const usados = queryJson(
    `SELECT DISTINCT CodProcessoImpressao AS codigo
     FROM CoberturasTinta
     WHERE CodProcessoImpressao IS NOT NULL`,
  )
  // Nomes SEED conhecidos por código (documentado — não há fonte de nome no legado).
  const NOMES_SEED = { 2: 'Offset Plana' }
  const processos = usados.map((r) => ({
    codigo: r.codigo,
    nome: NOMES_SEED[r.codigo] || `Processo ${r.codigo}`,
  }))
  // Garante ao menos o seed mínimo caso a consulta volte vazia.
  if (processos.length === 0) processos.push({ codigo: 2, nome: 'Offset Plana' })
  salvar('paridade-processos', processos)
}

console.log('Exportação de paridade concluída. Arquivos em cartoon/export/')
