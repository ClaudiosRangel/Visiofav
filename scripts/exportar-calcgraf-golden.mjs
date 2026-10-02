/**
 * Exporta cálculos REAIS do Calcgraf (backup restaurado) como FIXTURES para
 * calibrar/testar o motor de orçamento do Vizor (Bloco 2).
 *
 * Para cada NumCalculo escolhido, junta cabeçalho + tiragens (preço/margem/CM
 * reais = ALVO) + taxas (CEV) + resultado por agrupamento (custo decomposto).
 * Saída: cartoon/export/golden-orcamento.json (ignorado pelo git — dados reais).
 *
 * Uso: node scripts/exportar-calcgraf-golden.mjs [num1 num2 ...]
 * Sem args, usa um conjunto padrão variado.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const DB = 'CalcgrafCartonWega'
const OUT = join('cartoon', 'export')
mkdirSync(OUT, { recursive: true })

// Conjunto padrão: cálculos com 3 tiragens (variados) + os já conhecidos.
const NUMS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['15168', '15182', '14879', '14878']

function queryJson(sql) {
  const full = `SET NOCOUNT ON; ${sql} FOR JSON PATH`
  const tmp = join(OUT, `_raw-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`)
  execFileSync('sqlcmd', ['-S', 'localhost', '-E', '-C', '-d', DB, '-y', '0', '-u', '-Q', full, '-o', tmp], { maxBuffer: 256 * 1024 * 1024 })
  const buf = readFileSync(tmp)
  rmSync(tmp, { force: true })
  const txt = buf.toString('utf16le').replace(/^\uFEFF/, '').replace(/\r?\n/g, '').trim()
  if (!txt || txt === 'NULL') return []
  return JSON.parse(txt)
}

const casos = []
for (const num of NUMS) {
  const header = queryJson(`SELECT TOP 1 Codigo, NumCalculo, AliqIcms, AliqIpi, TaxaJurosAplicacao, CustoFinProducaoPerc, TiragemBase, CodNome, CodLinhaProduto FROM CalculoHeader WHERE NumCalculo = ${num}`)
  if (!header.length) { console.log(`! ${num} não encontrado`); continue }
  const cod = header[0].Codigo
  const tiragens = queryJson(`SELECT Tiragem, ValorTotalVenda, AliqMargem, ValorContMarginal, FlagValorInformado FROM CalculoTiragens WHERE Codigo = ${cod}`)
  const taxas = queryJson(`SELECT CodTaxa, Aliquota, flagManual, valorFixo FROM CalculoTaxas WHERE Codigo = ${cod}`)
  const resAgr = queryJson(`SELECT CodAgrupamento, CustoFixo, CustoUnitario FROM CalculoResAgrupamento WHERE Codigo = ${cod}`)
  const planos = queryJson(`SELECT nomePlano, codSuporte, aproveitamento, gramatura, tiragem, dimensao1, dimensao2, formSuporte, quebraPlanoFix, quebraPlanoVar, custoUnitFolhaSup, ocorrencias FROM CalculoPlanos WHERE Codigo = ${cod}`)
  casos.push({ num: Number(num), cod, header: header[0], tiragens, taxas, resAgr, planos })
  console.log(`  ${num}: ${tiragens.length} tiragens, ${resAgr.length} agrupamentos, ${planos.length} planos`)
}

writeFileSync(join(OUT, 'golden-orcamento.json'), JSON.stringify(casos, null, 2), 'utf8')
console.log(`Exportado ${casos.length} casos → cartoon/export/golden-orcamento.json`)
