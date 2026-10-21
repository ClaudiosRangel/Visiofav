// Exportador do ACERVO de cálculos do Calcgraf → cartoon/export/CalculosAcervo.json
//
// Lê o banco SQL Server restaurado localmente (CalcgrafCartonWega) via sqlcmd e
// gera UM JSON com todos os cálculos (cabeçalho + cliente + produto/tipo +
// linha + descrição/sigla + cores + custo/valor agregados da FOTO), no shape que
// o importador (`scripts/importar-calculos-calcgraf.ts` → `importarAcervo`)
// consome.
//
// ENCODING (regra do steering migracao-calcgraf-carton-wega):
//   O `FOR JSON` padrão do SQL Server CORROMPE acentos. Por isso usamos
//   `sqlcmd -u` (saída UTF-16 LE), lemos o arquivo em Node como `utf16le` e
//   convertemos para UTF-8. Acentos (ex.: "INVÓLUCRO", "LÂMINAS") saem corretos.
//
// SOMENTE LEITURA do banco Calcgraf. Dados sensíveis → cartoon/ é git-ignored.
//
// Uso:
//   node scripts/exportar-calculos-acervo-calcgraf.mjs [--saida cartoon/export/CalculosAcervo.json]
//
// Mapeamento de-para (confirmado no banco real 21/10/2026):
//   numCalculo    = CalculoHeader.NumCalculo
//   tiragem       = CalculoHeader.TiragemBase
//   cliente       = Nomes.RazaoSocial via CalculoHeader.CodNome (-1/NULL = sem cliente)
//   tipoProduto   = Produtos.Nome via CalculoAcabados.CodProduto  (= TipoEmbalagem CG-EMB-<CodProduto>)
//   codProduto    = CalculoAcabados.CodProduto (para montar o codigo CG-EMB-<n>)
//   linhaProduto  = _LinhasProduto.Nome via CalculoHeader.CodLinhaProduto
//   descricao     = CalculoAcabados.Descricao
//   siglaAcabado  = CalculoAcabados.CodAcabado
//   valorTotal    = CalculoTiragens.ValorTotalVenda (1a tiragem)
//   custoProducao = SUM(CustoFixo + CustoUnitario*tiragem) de CalculoResAgrupamento (agrup. 1,2,3)
//   cores[]       = CalculoTintas (ComplementoNome, areaTinta)
//   dataCalculo   = CalculoHeader.DataHoraGravacao

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

const DB = 'CalcgrafCartonWega'
function arg(nome, def) {
  const i = process.argv.indexOf(`--${nome}`)
  return i >= 0 ? process.argv[i + 1] : def
}
const saida = arg('saida', join('cartoon', 'export', 'CalculosAcervo.json'))
mkdirSync(dirname(saida), { recursive: true })

// Query que monta um ARRAY JSON (uma entrada por cálculo não-cancelado), com as
// cores como sub-array. Custo de producao e valor total agregados por subquery.
// FOR JSON PATH gera o JSON; sqlcmd -u o escreve em UTF-16 (acentos preservados).
const sql = `
SET NOCOUNT ON;
SELECT
  h.NumCalculo                                    AS numCalculo,
  h.TiragemBase                                   AS tiragem,
  CASE WHEN h.CodNome IS NULL OR h.CodNome < 0 THEN NULL ELSE n.RazaoSocial END AS cliente,
  -- Produto/descrição/sigla: UMA linha de CalculoAcabados por cálculo (menor
  -- ItemAcabado) — subqueries TOP 1 evitam a multiplicação do LEFT JOIN quando
  -- o cálculo tem vários acabados/tiragens (causava numCalculo duplicado).
  (SELECT TOP 1 a.CodProduto FROM CalculoAcabados a WHERE a.Codigo = h.Codigo ORDER BY a.ItemAcabado) AS codProduto,
  (SELECT TOP 1 p.Nome FROM CalculoAcabados a JOIN Produtos p ON p.Codigo = a.CodProduto WHERE a.Codigo = h.Codigo ORDER BY a.ItemAcabado) AS tipoProduto,
  lp.Nome                                         AS linhaProduto,
  (SELECT TOP 1 a.Descricao FROM CalculoAcabados a WHERE a.Codigo = h.Codigo ORDER BY a.ItemAcabado) AS descricao,
  (SELECT TOP 1 a.CodAcabado FROM CalculoAcabados a WHERE a.Codigo = h.Codigo ORDER BY a.ItemAcabado) AS siglaAcabado,
  (SELECT TOP 1 t.ValorTotalVenda FROM CalculoTiragens t WHERE t.Codigo = h.Codigo ORDER BY t.ItemMargem) AS valorTotal,
  (ISNULL((SELECT SUM(r.CustoFixo) FROM CalculoResAgrupamento r
             WHERE r.Codigo = h.Codigo AND r.CodAgrupamento IN (1,2,3)), 0)
   + ISNULL((SELECT SUM(r.CustoUnitario) FROM CalculoResAgrupamento r
             WHERE r.Codigo = h.Codigo AND r.CodAgrupamento IN (1,2,3)), 0)
     * h.TiragemBase)                                                           AS custoProducao,
  CONVERT(varchar(19), h.DataHoraGravacao, 126)   AS dataCalculo,
  (SELECT ti.ComplementoNome AS nome, ti.areaTinta AS coberturaPercent
     FROM CalculoTintas ti WHERE ti.Codigo = h.Codigo
     FOR JSON PATH)                               AS cores
FROM CalculoHeader h
LEFT JOIN Nomes n            ON n.Codigo = h.CodNome
LEFT JOIN _LinhasProduto lp  ON lp.Codigo = h.CodLinhaProduto
WHERE h.FlagCancelado = 0
  -- Um NumCalculo pode ter 2+ linhas em CalculoHeader (original + recálculo).
  -- Mantém só a MAIS RECENTE (maior Codigo) por NumCalculo — regra do steering.
  AND h.Codigo = (SELECT MAX(h2.Codigo) FROM CalculoHeader h2
                    WHERE h2.NumCalculo = h.NumCalculo AND h2.FlagCancelado = 0)
FOR JSON PATH;
`.trim()

// Escreve a query num arquivo temporário (evita problemas de escaping no -Q).
const sqlFile = join('cartoon', `_tmp-query-acervo-${randomUUID()}.sql`)
const outFile = join('cartoon', `_tmp-out-acervo-${randomUUID()}.txt`)
writeFileSync(sqlFile, sql, 'utf8')

try {
  console.log('Exportando acervo via sqlcmd (UTF-16)…')
  // -u = saída UTF-16 LE; -y 0 = largura ilimitada (campo). NÃO combinar com
  // -h -1 (mutuamente exclusivos no sqlcmd). Com FOR JSON + SET NOCOUNT ON não
  // há cabeçalho de coluna a suprimir.
  execFileSync(
    'sqlcmd',
    ['-S', 'localhost', '-E', '-C', '-d', DB, '-u', '-y', '0', '-i', sqlFile, '-o', outFile],
    { stdio: 'inherit' },
  )

  // Lê a saída como UTF-16 LE e converte para UTF-8.
  const buf = readFileSync(outFile)
  let texto = buf.toString('utf16le')
  // sqlcmd quebra o JSON em várias linhas por largura — junta tudo e tira espaços
  // de borda/linhas em branco. O FOR JSON PATH produz um único array contíguo.
  texto = texto.replace(/\r?\n/g, '').trim()
  // Remove um eventual BOM.
  if (texto.charCodeAt(0) === 0xfeff) texto = texto.slice(1)

  // Valida que é JSON.
  const dados = JSON.parse(texto)
  if (!Array.isArray(dados)) throw new Error('Saída não é um array JSON')

  // Normaliza: cada item tem `cores` como STRING JSON (sub FOR JSON) → parse.
  for (const it of dados) {
    if (typeof it.cores === 'string') {
      try { it.cores = JSON.parse(it.cores) } catch { it.cores = [] }
    }
    if (!Array.isArray(it.cores)) it.cores = []
  }

  writeFileSync(saida, JSON.stringify(dados, null, 2), 'utf8')
  console.log(`OK — ${dados.length} cálculos exportados para ${saida}`)
  // Amostra de conferência (acentos).
  const amostra = dados.slice(0, 3).map((d) => ({
    numCalculo: d.numCalculo, cliente: d.cliente, tipoProduto: d.tipoProduto,
    linhaProduto: d.linhaProduto, descricao: d.descricao, valorTotal: d.valorTotal,
    custoProducao: d.custoProducao, cores: d.cores?.length,
  }))
  console.log('Amostra:', JSON.stringify(amostra, null, 2))
} finally {
  if (existsSync(sqlFile)) unlinkSync(sqlFile)
  if (existsSync(outFile)) unlinkSync(outFile)
}
