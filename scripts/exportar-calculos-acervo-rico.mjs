// Exportador da FOTO RICA do acervo Calcgraf → cartoon/export/CalculosAcervoRico.json
//
// Spec: calculo-grafico-foto-rica (Task 2.1). Por cálculo (maior Codigo por
// NumCalculo, não cancelado), monta a FotoRicaCalculo completa (cabeçalho,
// planos, suportes, matriz, tintas, mat.acabamento, impressão, acabamentos,
// custos MD/CT/SE, CEV, margens), resolvendo todos os NOMES. SOMENTE LEITURA do
// SQL Server local. Acentos via sqlcmd -u (UTF-16 LE) → UTF-8.
//
// Uso:
//   node scripts/exportar-calculos-acervo-rico.mjs [--numero N] [--saida arquivo.json]
//   --numero N  : exporta só o cálculo N (prova). Sem ele: TODOS.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

const DB = 'CalcgrafCartonWega'
function arg(nome, def) {
  const i = process.argv.indexOf(`--${nome}`)
  return i >= 0 ? process.argv[i + 1] : def
}
const soNumero = arg('numero', null)
const saida = arg('saida', join('cartoon', 'export', 'CalculosAcervoRico.json'))
mkdirSync(dirname(saida), { recursive: true })

// Executa um SELECT ... FOR JSON e devolve o array parseado (UTF-16 → UTF-8).
function queryJson(sql) {
  const sqlFile = join('cartoon', `_tmp-q-${randomUUID()}.sql`)
  const outFile = join('cartoon', `_tmp-o-${randomUUID()}.txt`)
  writeFileSync(sqlFile, `SET NOCOUNT ON;\n${sql}\nFOR JSON PATH;`, 'utf8')
  try {
    execFileSync('sqlcmd', ['-S', 'localhost', '-E', '-C', '-d', DB, '-u', '-y', '0', '-i', sqlFile, '-o', outFile], { stdio: 'pipe' })
    let txt = readFileSync(outFile).toString('utf16le').replace(/\r?\n/g, '').trim()
    if (txt.charCodeAt(0) === 0xfeff) txt = txt.slice(1)
    if (!txt) return []
    return JSON.parse(txt)
  } finally {
    if (existsSync(sqlFile)) unlinkSync(sqlFile)
    if (existsSync(outFile)) unlinkSync(outFile)
  }
}

const num = (v) => { if (v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null }
const str = (v) => { if (v == null) return null; const s = String(v).trim(); return s === '' ? null : s }

// ── 1) Cabeçalhos (1 por NumCalculo: maior Codigo, não cancelado) ──
const filtroNum = soNumero ? `AND h.NumCalculo = ${Number(soNumero)}` : ''
const cabecalhos = queryJson(`
  SELECT h.Codigo AS codigo, h.NumCalculo AS numeroCalcgraf, h.TiragemBase AS tiragem,
         n.RazaoSocial AS cliente, lp.Nome AS linhaProduto,
         h.CodNome AS codNome,
         CONVERT(varchar(19), h.DataHoraGravacao, 126) AS dataCalculo
  FROM CalculoHeader h
  LEFT JOIN Nomes n ON n.Codigo = h.CodNome
  LEFT JOIN _LinhasProduto lp ON lp.Codigo = h.CodLinhaProduto
  WHERE h.FlagCancelado = 0 ${filtroNum}
    AND h.Codigo = (SELECT MAX(h2.Codigo) FROM CalculoHeader h2 WHERE h2.NumCalculo = h.NumCalculo AND h2.FlagCancelado = 0)
`)
console.log(`Cabeçalhos: ${cabecalhos.length}`)
if (cabecalhos.length === 0) { console.log('nada a exportar'); process.exit(0) }

const codigos = cabecalhos.map((c) => c.codigo)
// Para exportar TODOS seria pesado por-cálculo; fazemos em blocos por IN(...).
// Como as filhas são buscadas por Codigo, carregamos todas as filhas dos códigos
// de uma vez (quando --numero, é 1 só; no acervo completo, blocos de 300).

function emBlocos(arr, tam) {
  const out = []
  for (let i = 0; i < arr.length; i += tam) out.push(arr.slice(i, i + tam))
  return out
}

// Agregadores por Codigo.
const acabadosPorCod = new Map()   // CalculoAcabados (produto/descricao/sigla)
const planosPorCod = new Map()
const tintasPorCod = new Map()
const matacabPorCod = new Map()
const atividadesPorCod = new Map()
const resagrPorCod = new Map()
const tiragensPorCod = new Map()
const taxasPorCod = new Map()
const diversosPorCod = new Map()

function push(map, cod, item) {
  if (!map.has(cod)) map.set(cod, [])
  map.get(cod).push(item)
}

for (const bloco of emBlocos(codigos, soNumero ? 1 : 300)) {
  const inList = bloco.join(',')

  for (const r of queryJson(`SELECT Codigo codigo, CodProduto codProduto, Descricao descricao, CodAcabado siglaAcabado, TipoProduto tipoProduto FROM CalculoAcabados WHERE Codigo IN (${inList})`))
    push(acabadosPorCod, r.codigo, r)

  for (const r of queryJson(`
    SELECT p.Codigo codigo, p.nomePlano nome, s.Nome suporte, p.gramatura gramatura,
           p.dimensao1 dim1, p.dimensao2 dim2, p.formSuporte formSuporte,
           p.aproveitamento aproveitamento, p.ocorrencias ocorrencias, p.tiragem tiragem, p.FlagMicro micro
    FROM CalculoPlanos p LEFT JOIN Suportes s ON s.Codigo = p.codSuporte
    WHERE p.Codigo IN (${inList})`))
    push(planosPorCod, r.codigo, r)

  for (const r of queryJson(`SELECT Codigo codigo, ComplementoNome nome, areaTinta cobertura FROM CalculoTintas WHERE Codigo IN (${inList})`))
    push(tintasPorCod, r.codigo, r)

  for (const r of queryJson(`
    SELECT m.Codigo codigo, i.Descritivo nome, i.Unidade unidade
    FROM CalculoMatAcabamento m LEFT JOIN Itc i ON i.Codigo = m.CodMaterial
    WHERE m.Codigo IN (${inList})`))
    push(matacabPorCod, r.codigo, r)

  for (const r of queryJson(`
    SELECT a.Codigo codigo, a.tipo tipo, a.itemSeq1 seq, a.codAtividade codAtividade,
           at.Nome atividade, cp.Nome centro, a.producaoHora producaoHora,
           a.quantAcertos quantAcertos, a.tempoPorAcerto tempoPorAcerto,
           a.tempoPrimeiroAcerto tempoPrimeiroAcerto, a.tiragem tiragem
    FROM CalculoAtividades a
    LEFT JOIN Atividades at ON at.Codigo = a.codAtividade
    LEFT JOIN CentrosProducao cp ON cp.Codigo = a.codCentroCusto
    WHERE a.Codigo IN (${inList})`))
    push(atividadesPorCod, r.codigo, r)

  for (const r of queryJson(`SELECT Codigo codigo, CodAgrupamento agr, CustoFixo fixo, CustoUnitario unit FROM CalculoResAgrupamento WHERE Codigo IN (${inList}) AND CodAgrupamento IN (1,2,3)`))
    push(resagrPorCod, r.codigo, r)

  for (const r of queryJson(`SELECT Codigo codigo, Tiragem tiragem, ItemMargem itemMargem, ValorTotalVenda valorTotal, AliqMargem aliqMargem, ValorContMarginal cm FROM CalculoTiragens WHERE Codigo IN (${inList})`))
    push(tiragensPorCod, r.codigo, r)

  for (const r of queryJson(`SELECT Codigo codigo, CodTaxa codTaxa, Aliquota aliquota FROM CalculoTaxas WHERE Codigo IN (${inList})`))
    push(taxasPorCod, r.codigo, r)

  for (const r of queryJson(`SELECT Codigo codigo, Descricao descricao, CustoUnitario valor FROM CalculoItensDiversos WHERE Codigo IN (${inList})`))
    push(diversosPorCod, r.codigo, r)
}

// ── Monta a FotoRicaCalculo por cálculo ──
const fotos = []
for (const h of cabecalhos) {
  const cod = h.codigo
  const acab = (acabadosPorCod.get(cod) || [])[0] || {}
  const planosRaw = planosPorCod.get(cod) || []
  const tintasRaw = tintasPorCod.get(cod) || []
  const matacabRaw = matacabPorCod.get(cod) || []
  const atvsRaw = atividadesPorCod.get(cod) || []
  const resagr = resagrPorCod.get(cod) || []
  const tiragens = tiragensPorCod.get(cod) || []
  const taxas = taxasPorCod.get(cod) || []
  const diversos = diversosPorCod.get(cod) || []

  const tiragemBase = num(h.tiragem) ?? 0

  // Decomposição de custo pelos agrupamentos do Calcgraf:
  //   agrup 1 = Custo de Transformação (máquinas/acabamentos)
  //   agrup 2 = Material Direto (papel + tinta + mat.acabamento)
  //   agrup 3 = Serviço Externo
  // custo por agrupamento = Σ (CustoFixo + CustoUnitario × tiragem).
  const porAgr = (a) => resagr.filter((r) => Number(r.agr) === a).reduce((s, r) => s + (num(r.fixo) ?? 0) + (num(r.unit) ?? 0) * tiragemBase, 0)
  const ct = porAgr(1), md = porAgr(2), se = porAgr(3)
  const custoProducao = md + ct + se

  // Planos.
  const planos = planosRaw.map((p) => ({
    nome: str(p.nome) ?? 'Plano',
    suporte: str(p.suporte),
    gramatura: num(p.gramatura),
    formatoAberto: p.dim1 != null && p.dim2 != null ? `${num(p.dim1)} x ${num(p.dim2)}` : null,
    formatoCorte: str(p.formSuporte),
    aproveitamento: num(p.aproveitamento),
    ocorrencias: num(p.ocorrencias),
    tiragem: num(p.tiragem),
    micro: Number(p.micro) === -1,
  }))

  // Suportes (a partir dos planos — nome/formato; peso/subtotal best-effort = null por ora).
  const suportes = planosRaw
    .filter((p) => str(p.suporte))
    .map((p) => ({ nome: str(p.suporte), formato: p.dim1 != null ? `${num(p.dim1)} x ${num(p.dim2)}` : null, folhas: null, quantidade: null, unidade: 'KG', precoUnitario: null, subtotal: null }))

  // Tintas.
  const tintas = tintasRaw
    .filter((t) => str(t.nome))
    .map((t) => ({ nome: str(t.nome), coberturaPercent: num(t.cobertura) }))

  // Mat. acabamento.
  const matAcabamento = matacabRaw
    .filter((m) => str(m.nome))
    .map((m) => ({ nome: str(m.nome), unidade: str(m.unidade) }))

  // Impressão (tipo I) e acabamentos (tipo A/M).
  const impressao = atvsRaw.filter((a) => a.tipo === 'I').map((a) => ({
    descricao: [str(a.atividade), str(a.centro)].filter(Boolean).join(' '),
    producaoHora: num(a.producaoHora),
  }))
  const acabamentos = atvsRaw.filter((a) => a.tipo === 'A' || a.tipo === 'M').map((a) => ({
    descricao: str(a.atividade) ?? 'Acabamento',
    centro: str(a.centro),
    producaoHora: num(a.producaoHora),
  }))

  // Margens (faixas de CalculoTiragens).
  const margens = tiragens.map((t) => {
    const vt = num(t.valorTotal) ?? 0
    return {
      margemPercent: num(t.aliqMargem) ?? 0,
      cmPercent: null,
      valorUnitario: tiragemBase > 0 ? Math.round((vt / tiragemBase) * 100) / 100 : 0,
      valorTotal: vt,
      selecionada: true,
    }
  })
  const valorTotal = margens.length ? margens[0].valorTotal : null

  // CEV (taxas por código — simplificado).
  const taxa = (c) => { const t = taxas.find((x) => Number(x.codTaxa) === c); return t ? num(t.aliquota) : null }
  const cev = { pisCofins: taxa(2), comissoes: taxa(-7), icms: null, juros: null, totalPercent: null }

  fotos.push({
    numeroCalcgraf: num(h.numeroCalcgraf),
    valorTotal,
    foto: {
      versaoFoto: 2,
      origem: 'MIGRADO_CALCGRAF',
      cabecalho: {
        numeroCalcgraf: num(h.numeroCalcgraf),
        cliente: str(h.cliente),
        linhaProduto: str(h.linhaProduto),
        produto: str(acab.tipoProduto),
        descricao: str(acab.descricao),
        siglaAcabado: str(acab.siglaAcabado),
        tiragem: tiragemBase,
        dataCalculo: str(h.dataCalculo),
      },
      planos, suportes, matriz: null, tintas, matAcabamento, impressao, acabamentos,
      itensDiversos: diversos.filter((d) => str(d.descricao)).map((d) => ({ descricao: str(d.descricao), valor: num(d.valor) ?? 0 })),
      custos: { materialDireto: round2(md), custoTransformacao: round2(ct), servicoExterno: round2(se), custoProducao: round2(custoProducao) },
      cev, margens,
    },
  })
}

function round2(n) { return Math.round(n * 100) / 100 }

writeFileSync(saida, JSON.stringify(fotos, null, 2), 'utf8')
console.log(`OK — ${fotos.length} foto(s) rica(s) em ${saida}`)
if (soNumero) {
  console.log('\n=== PROVA (cálculo ' + soNumero + ') ===')
  console.log(JSON.stringify(fotos[0], null, 2))
}
