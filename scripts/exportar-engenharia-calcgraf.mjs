// Exportador da ENGENHARIA CONCRETA do acervo Calcgraf (NÃO é foto).
// Para cada cálculo (maior Codigo por NumCalculo, não cancelado), extrai os
// dados REAIS de engenharia que o Calcgraf possui e que o Vizor precisa para
// montar o item completo e editável:
//   - plano: dimensão do produto (dimensao1/2), aproveitamento, ocorrências,
//     formato da folha (formSuporte), gramatura, nome do suporte (Itc), preço
//     do suporte (TabelasCustoDetalhe col 1), CodFaca;
//   - tintas: nome real, cobertura (areaTinta %), preço R$/kg (Itc→TabelasCusto).
//
// SOMENTE LEITURA do SQL Server local. Acentos via sqlcmd -u (UTF-16 → UTF-8).
// Uso: node scripts/exportar-engenharia-calcgraf.mjs [--numero N] [--saida arq.json]
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

const DB = 'CalcgrafCartonWega'
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d }
const soNumero = arg('numero', null)
const saida = arg('saida', join('cartoon', 'export', 'EngenhariaCalcgraf.json'))
mkdirSync(dirname(saida), { recursive: true })

function queryJson(sql) {
  const sqlFile = join('cartoon', `_tmp-eng-${randomUUID()}.sql`)
  const outFile = join('cartoon', `_tmp-eng-o-${randomUUID()}.txt`)
  writeFileSync(sqlFile, `SET NOCOUNT ON;\n${sql}\nFOR JSON PATH;`, 'utf8')
  try {
    execFileSync('sqlcmd', ['-S', 'localhost', '-E', '-C', '-d', DB, '-u', '-y', '0', '-i', sqlFile, '-o', outFile], { stdio: 'pipe' })
    let txt = readFileSync(outFile).toString('utf16le').replace(/\r?\n/g, '').trim()
    if (txt.charCodeAt(0) === 0xfeff) txt = txt.slice(1)
    return txt ? JSON.parse(txt) : []
  } finally {
    if (existsSync(sqlFile)) unlinkSync(sqlFile)
    if (existsSync(outFile)) unlinkSync(outFile)
  }
}
const num = (v) => { if (v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null }
const str = (v) => { if (v == null) return null; const s = String(v).trim(); return s === '' ? null : s }

const filtroNum = soNumero ? `AND h.NumCalculo = ${Number(soNumero)}` : ''

// Cabeçalhos (1 por NumCalculo = maior Codigo não cancelado)
const cabs = queryJson(`
  SELECT h.Codigo AS codigo, h.NumCalculo AS numeroCalcgraf, h.TiragemBase AS tiragem
  FROM CalculoHeader h
  WHERE h.FlagCancelado = 0 ${filtroNum}
    AND h.Codigo = (SELECT MAX(h2.Codigo) FROM CalculoHeader h2 WHERE h2.NumCalculo = h.NumCalculo AND h2.FlagCancelado = 0)
`)
console.log(`Cabeçalhos: ${cabs.length}`)
if (!cabs.length) { console.log('nada'); process.exit(0) }

const codigos = cabs.map((c) => c.codigo)
const blocos = []
for (let i = 0; i < codigos.length; i += 300) blocos.push(codigos.slice(i, i + 300))

// Planos com nome e preço do suporte (Itc por CodOrigem=codSuporte + gramatura)
const planosPorCod = new Map()
const tintasPorCod = new Map()
const etapasPorCod = new Map()
for (const bloco of blocos) {
  const inList = bloco.join(',')
  // PLANO: resolve nome+preço do suporte casando Itc.CodOrigem=codSuporte e Gramatura
  const planos = queryJson(`
    SELECT p.Codigo AS codigo, p.nomePlano AS nomePlano, p.aproveitamento AS aproveitamento,
           p.ocorrencias AS ocorrencias, p.dimensao1 AS dim1, p.dimensao2 AS dim2,
           p.formSuporte AS formSuporte, p.gramatura AS gramatura, p.codSuporte AS codSuporte,
           p.CodFaca AS codFaca, p.tiragem AS tiragem,
           itc.Descritivo AS suporteNome, itc.Codigo AS suporteItc,
           det.ValorTotal AS suportePrecoKg
    FROM CalculoPlanos p
    OUTER APPLY (
      SELECT TOP 1 i.Codigo, i.Descritivo
      FROM Itc i WHERE i.Origem='SUPORTE' AND i.CodOrigem = p.codSuporte
        AND ABS(ISNULL(i.Gramatura,0) - ISNULL(p.gramatura,0)) < 0.5
      ORDER BY i.Codigo
    ) itc
    OUTER APPLY (
      SELECT TOP 1 d.ValorTotal FROM TabelasCustoDetalhe d
      WHERE d.CodItc = itc.Codigo AND d.Coluna = 1 ORDER BY d.CodTabelaCusto DESC
    ) det
    WHERE p.Codigo IN (${inList})
  `)
  for (const p of planos) {
    if (!planosPorCod.has(p.codigo)) planosPorCod.set(p.codigo, [])
    planosPorCod.get(p.codigo).push(p)
  }
  // TINTAS: nome real + cobertura + preço R$/kg (Itc TINTA por CodOrigem=codTinta)
  const tintas = queryJson(`
    SELECT t.Codigo AS codigo, t.codTinta AS codTinta, t.areaTinta AS cobertura,
           t.ComplementoNome AS nome,
           itc.Codigo AS tintaItc, itc.Descritivo AS tintaNome,
           det.ValorTotal AS precoKg
    FROM CalculoTintas t
    OUTER APPLY (
      SELECT TOP 1 i.Codigo, i.Descritivo FROM Itc i
      WHERE i.Origem='TINTA' AND i.CodOrigem = t.codTinta ORDER BY i.Codigo
    ) itc
    OUTER APPLY (
      SELECT TOP 1 d.ValorTotal FROM TabelasCustoDetalhe d
      WHERE d.CodItc = itc.Codigo AND d.Coluna = 1 ORDER BY d.CodTabelaCusto DESC
    ) det
    WHERE t.Codigo IN (${inList})
  `)
  for (const t of tintas) {
    if (!tintasPorCod.has(t.codigo)) tintasPorCod.set(t.codigo, [])
    tintasPorCod.get(t.codigo).push(t)
  }
  // ETAPAS DE PRODUÇÃO (CalculoAtividades): todas as atividades do cálculo —
  // impressão + acabamentos (cortadeira/guilhotina/plastificadora/etc.). Cada uma
  // com o centro (nome real do Calcgraf), custo-hora da Tabela de Custos 2
  // (col 1, ValorDireto), produção/hora e os tempos de acerto REAIS. É isto que
  // faltava no item puxado — sem as etapas de acabamento o CT do Vizor fica abaixo
  // do Calcgraf. O de-para centro→Vizor é por NOME (feito no gravador).
  const etapas = queryJson(`
    SELECT a.Codigo AS codigo, a.itemSeq1 AS seq1, a.itemSeq2 AS seq2,
           a.codCentroCusto AS codCentro, a.codAgrupamento AS codAgrupamento,
           a.producaoHora AS producaoHora, a.quantAcertos AS quantAcertos,
           a.tempoPorAcerto AS tempoPorAcerto, a.tempoPrimeiroAcerto AS tempoPrimeiroAcerto,
           a.tiragem AS tiragem, a.entradas AS entradas,
           cp.Nome AS centroNome,
           det.ValorDireto AS custoHora
    FROM CalculoAtividades a
    LEFT JOIN CentrosProducao cp ON cp.Codigo = a.codCentroCusto
    OUTER APPLY (
      SELECT TOP 1 d.ValorDireto FROM Itc i
      JOIN TabelasCustoDetalhe d ON d.CodItc = i.Codigo AND d.CodTabelaCusto = 2 AND d.Coluna = 1
      WHERE i.Origem = 'CENTRO DE CUSTO' AND i.CodOrigem = a.codCentroCusto
      ORDER BY i.Codigo
    ) det
    WHERE a.Codigo IN (${inList})
  `)
  for (const e of etapas) {
    if (!etapasPorCod.has(e.codigo)) etapasPorCod.set(e.codigo, [])
    etapasPorCod.get(e.codigo).push(e)
  }
}

const saidaArr = cabs.map((c) => {
  const planos = (planosPorCod.get(c.codigo) || []).map((p) => ({
    nome: str(p.nomePlano),
    aproveitamento: num(p.aproveitamento),
    ocorrencias: num(p.ocorrencias),
    produtoLarguraMm: num(p.dim1),
    produtoAlturaMm: num(p.dim2),
    formatoFolha: str(p.formSuporte),
    gramatura: num(p.gramatura),
    suporteNome: str(p.suporteNome),
    suportePrecoKg: num(p.suportePrecoKg),
    codFaca: num(p.codFaca),
    tiragem: num(p.tiragem),
  }))
  const tintas = (tintasPorCod.get(c.codigo) || []).map((t) => ({
    nome: str(t.nome) || str(t.tintaNome),
    nomeCadastro: str(t.tintaNome),
    coberturaPercent: num(t.cobertura),
    precoKg: num(t.precoKg),
  }))
  const etapas = (etapasPorCod.get(c.codigo) || [])
    .sort((a, b) => (num(a.seq1) ?? 0) - (num(b.seq1) ?? 0) || (num(a.seq2) ?? 0) - (num(b.seq2) ?? 0))
    .map((e) => ({
      centroCodigoCalcgraf: num(e.codCentro),
      centroNome: str(e.centroNome),
      codAgrupamento: num(e.codAgrupamento),
      custoHora: num(e.custoHora),
      producaoHora: num(e.producaoHora),
      quantAcertos: num(e.quantAcertos),
      tempoPorAcerto: num(e.tempoPorAcerto),
      tempoPrimeiroAcerto: num(e.tempoPrimeiroAcerto),
      tiragem: num(e.tiragem),
      entradas: num(e.entradas),
    }))
  return { numeroCalcgraf: c.numeroCalcgraf, tiragem: num(c.tiragem), planos, tintas, etapas }
})

writeFileSync(saida, JSON.stringify(saidaArr, null, soNumero ? 2 : 0), 'utf8')
console.log(`Gravado: ${saida} (${saidaArr.length} cálculos)`)
if (soNumero) console.log(JSON.stringify(saidaArr[0], null, 2))
