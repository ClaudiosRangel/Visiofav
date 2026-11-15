/**
 * Exporta do Calcgraf (SQL Server local restaurado) os CADASTROS E RELAÇÕES do
 * orçamento gráfico para `cartoon/export/CadastrosOrcamento.json` (ignorado
 * pelo git). SOMENTE LEITURA: só executa SELECT.
 *
 * Spec: .kiro/specs/orcamento-grafico-cadastros-relacoes (tarefa 7.1, Req 14.9).
 * Consumidor: scripts/importar-cadastros-orcamento.ts (tarefa 7.2).
 *
 * Ponte = sqlcmd + FOR JSON PATH. Usa `-u` (UTF-16LE) gravando em arquivo (-o) e
 * converte utf16le → utf8 para PRESERVAR acentos (o stdout corrompe acento — ver
 * steering migracao-calcgraf-carton-wega). Mesmo padrão de
 * exportar-engenharia-calcgraf.mjs e exportar-calcgraf-cadastros.mjs.
 *
 * Uso:   node scripts/exportar-cadastros-orcamento.mjs
 * Pré-req: SQL Server local de pé, banco CalcgrafCartonWega restaurado
 *          (`sqlcmd -S localhost -E -C -d CalcgrafCartonWega`).
 *
 * Conjuntos exportados (chave no JSON → fonte):
 *   Produtos, ProdutosPlanos (defaults produto×plano), ProdutosAtividades,
 *   Linhas (_LinhasProduto), Planos, CaracteristicasPlano,
 *   Atividades (com `paramAcab`: uso real de ParamAcab1/2 e TipoParamAcab por material),
 *   Processos (atividades de impressão), Restricoes (RestricoesManuais),
 *   Materiais (ItensDiversos origem MAT.ACABAMENTO + Itc + preços),
 *   ItensDiversos (demais origens + Itc + preços), CoberturasTinta,
 *   RelTabelas (com `descartar` = true quando envolve a tabela 9),
 *   Roteiros, CamposLivres (ParamCl), CamposLivresLista (ParamClLista),
 *   CamposLivresRelacionamentos (ParamClRelacionamentos — SEM ConteudoCl),
 *   AjustesProdutividade, Quebras, QuebrasLimites, LimitesMontagem, Parametros,
 *   + apoio ao casamento por nome: CentrosProducao, CentrosCusto, Suportes,
 *     Fechamento, Unidades, TributacaoVenda.
 *
 * Observação: a tabela 9 da RelTabelas é EXPORTADA mas marcada `descartar: true`
 * (resíduo desalinhado — HANDOFF §16.2); o importador a ignora.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const DB = 'CalcgrafCartonWega'
const OUT = join('cartoon', 'export')
const ARQUIVO = join(OUT, 'CadastrosOrcamento.json')
mkdirSync(OUT, { recursive: true })

/** Tabela de RelTabelas descartada (HANDOFF §16.2). */
const TABELA_DESCARTADA = 9

/** Tipos de Parametros relevantes ao orçamento (as demais ~60 famílias não importam). */
const TIPOS_PARAMETROS = ['CÁLCULO', 'CALCULO', 'FECHAMENTO', 'SOLICITAÇÃO', 'SOLICITACAO', 'PRÉ-CÁLCULO']

/**
 * Executa um SELECT e devolve as linhas (array JSON). `-u` + `-o` em arquivo
 * (UTF-16LE com BOM) preserva acentos; o sqlcmd quebra o JSON por largura, então
 * removemos \r?\n antes de parsear (documento contíguo).
 */
function queryJson(sql) {
  const full = `SET NOCOUNT ON; ${sql} FOR JSON PATH`
  const tmp = join(OUT, `_raw-cad-orc-${Date.now()}.tmp`)
  try {
    execFileSync(
      'sqlcmd',
      ['-S', 'localhost', '-E', '-C', '-d', DB, '-y', '0', '-u', '-Q', full, '-o', tmp],
      { maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'ignore', 'pipe'] },
    )
    const buf = readFileSync(tmp)
    const txt = buf.toString('utf16le').replace(/^\uFEFF/, '').replace(/\r?\n/g, '').trim()
    if (!txt || txt === 'NULL') return []
    return JSON.parse(txt)
  } finally {
    rmSync(tmp, { force: true })
  }
}

const resultado = {}
const falhas = []

function exportar(nome, sql, posProcessar) {
  try {
    let rows = queryJson(sql)
    if (posProcessar) rows = posProcessar(rows)
    resultado[nome] = rows
    console.log(`  ${nome}: ${rows.length} registros`)
  } catch (e) {
    resultado[nome] = []
    falhas.push(nome)
    const msg = String(e.stderr || e.message || e).split('\n')[0]
    console.error(`  ! ${nome} FALHOU: ${msg}`)
  }
}

const lista = (arr) => arr.map((t) => `N'${t.replace(/'/g, "''")}'`).join(', ')

console.log('Exportando cadastros e relações do orçamento (SOMENTE LEITURA)...')

// ── Catálogos de produto ────────────────────────────────────────────────────
exportar('Linhas', 'SELECT Codigo, Nome, Ativo FROM _LinhasProduto')
exportar('Produtos', 'SELECT * FROM Produtos')
exportar(
  'ProdutosPlanos',
  `SELECT CodProduto, CodPlano, CodProcessoImpressao, CodCoberturaTinta, CoresF, CoresV,
          AreaTinta, FlagSemImpressao, NomeFabricanteSup
   FROM ProdutosxPlanos`,
)
exportar(
  'ProdutosAtividades',
  'SELECT CodProduto, CodPlano, CodAtividade, CodMatAcabamento, ConteudoAcond FROM ProdutosxAtividades',
)

// ── Planos (tipos) ──────────────────────────────────────────────────────────
exportar('Planos', 'SELECT * FROM Planos')
exportar('CaracteristicasPlano', 'SELECT codLinhaProduto, codPlano, NomeCampo, ValorCampo FROM _CaracteristicasPlano')

// ── Atividades (com ParamAcab/TipoParamAcab) ────────────────────────────────
// `paramAcab`: uso real de cada material por atividade em CalculoMatAcabamento
// (TipoParamAcab 0..4; faixa de ParamAcab1/2). Serve para o tipo de parâmetro do
// material e para a regra do preço (HANDOFF §16.1). Subconsulta FOR JSON aninhada.
exportar(
  'Atividades',
  `SELECT a.Codigo, a.Ativo, a.Nome, a.PlanoProduto, a.TipoAtividade, a.ChaveDicionario,
          a.TextoProposta, a.FlagExibirNomePlanoProposta, a.OrdemPrioridadeAtv, a.FlagAtvForte,
          a.AumTempoPerc, a.AumTempoMin, a.FlagUtilizaCTP,
          (SELECT m.CodMaterial AS codMaterial, m.TipoParamAcab AS tipoParamAcab,
                  COUNT(*) AS usos,
                  MIN(m.ParamAcab1) AS param1Min, MAX(m.ParamAcab1) AS param1Max,
                  MIN(m.ParamAcab2) AS param2Min, MAX(m.ParamAcab2) AS param2Max
           FROM CalculoMatAcabamento m
           WHERE m.codAtvAcabamento = a.Codigo
           GROUP BY m.CodMaterial, m.TipoParamAcab
           FOR JSON PATH) AS ParamAcab
   FROM Atividades a`,
)
// Processos de impressão: não há tabela própria; são as atividades de tipo Impressão.
exportar(
  'Processos',
  `SELECT Codigo, Ativo, Nome, TipoAtividade FROM Atividades WHERE TipoAtividade LIKE N'Impress%'`,
)
exportar('Restricoes', 'SELECT Codigo, Ativo, Nome, CodAtividade, flagExibirProposta FROM RestricoesManuais')

// ── Materiais de acabamento e itens diversos (catálogo único ItensDiversos) ──
// Preço por tabela de custo (1 = Padrão até 02/12/2024, 2 = vigente), coluna 1.
const ITEM_COM_ITC = `
  SELECT d.Codigo, d.Ativo, d.Nome, d.Origem, d.Tipo, d.FlagItensDiversos, d.TextoProposta,
         d.CodAcabadoRevenda, d.Sigla, d.FlagPendAutoPcp,
         i.Codigo AS CodItc, i.Descritivo, i.Unidade, i.Gramatura, i.AliqCredIcms, i.AliqCredIpi,
         (SELECT t.CodTabelaCusto AS codTabelaCusto, t.Coluna AS coluna, t.ValorTotal AS valorTotal,
                 t.ValorDireto AS valorDireto
          FROM TabelasCustoDetalhe t WHERE t.CodItc = i.Codigo
          FOR JSON PATH) AS Precos
  FROM ItensDiversos d
  LEFT JOIN Itc i ON i.CodOrigem = d.Codigo AND i.Origem = d.Origem`
/**
 * Um item pode ter mais de uma linha em Itc (ex.: Colagem Manual, cód. 48). Mantém a
 * primeira (menor CodItc) e guarda as demais em `itcAlternativos`, para a exportação
 * ter UMA linha por `Codigo` (a importação é idempotente por codigoOrigem).
 */
function unicoPorCodigo(rows) {
  const porCodigo = new Map()
  for (const r of rows.sort((a, b) => (a.CodItc ?? 0) - (b.CodItc ?? 0))) {
    const atual = porCodigo.get(r.Codigo)
    if (!atual) porCodigo.set(r.Codigo, { ...r })
    else (atual.itcAlternativos ??= []).push(r.CodItc)
  }
  return [...porCodigo.values()]
}
exportar('Materiais', `${ITEM_COM_ITC} WHERE d.Origem = N'MAT.ACABAMENTO'`, unicoPorCodigo)
exportar('ItensDiversos', `${ITEM_COM_ITC} WHERE d.Origem <> N'MAT.ACABAMENTO'`, unicoPorCodigo)

exportar(
  'CoberturasTinta',
  `SELECT c.Codigo, c.Ativo, c.Nome, c.CodProcessoImpressao,
          (SELECT x.CodTinta AS codTinta, x.AreaTinta AS areaTinta
           FROM CoberturasTintaxCodTinta x WHERE x.CodCoberturaTinta = c.Codigo
           FOR JSON PATH) AS Tintas
   FROM CoberturasTinta c`,
)

// ── Relações genéricas e roteiros ───────────────────────────────────────────
// A tabela 9 é exportada mas marcada para descarte (o importador ignora).
exportar(
  'RelTabelas',
  'SELECT CodTabela1, CodItem1, CodTabela2, CodItem2 FROM RelTabelas',
  (rows) =>
    rows.map((r) => ({
      ...r,
      descartar: r.CodTabela1 === TABELA_DESCARTADA || r.CodTabela2 === TABELA_DESCARTADA,
    })),
)
exportar('Roteiros', 'SELECT CodLinhaProduto, CodPlanoCad, Ordem, CodAtividade, FlagCheck FROM Roteiros')

// ── Campos livres (só definição; ConteudoCl = valores históricos NÃO entra) ──
exportar(
  'CamposLivres',
  `SELECT Proprietario, Codigo, Caption, Tipo, CAST(Lista AS nvarchar(max)) AS Lista,
          CodLinhaProduto, FlagOrdenarLista, CodChave, Ativo, FlagCampoLivrePorAcabado,
          FlagPreenchimentoObrigatorio, FlagAgrupamentoGerencial, FlagMascaraData, FlagMascaraValor
   FROM ParamCl`,
)
exportar('CamposLivresLista', 'SELECT Codigo, CodChaveParamCl, Lista, Ativo, flagDefaultCl FROM ParamClLista')
exportar(
  'CamposLivresRelacionamentos',
  `SELECT ProprietarioOrigem, CodigoOrigem, ProprietarioDestino, CodigoDestino,
          CodChaveParamClOrigem, CodChaveParamClDestino
   FROM ParamClRelacionamentos`,
)

// ── Ajustes de produtividade, quebras e limites ─────────────────────────────
exportar(
  'AjustesProdutividade',
  `SELECT CodAtividade, CodCentroProducao, DadoAjustar, Funcao, Operador, Valor, Fator,
          FlagPositiva, ImpedeMontCadernos
   FROM AjustesProdutividade`,
)
exportar('Quebras', 'SELECT * FROM Quebras')
exportar('QuebrasLimites', 'SELECT CodQuebra, Tiragem, QuebraPerc FROM QuebrasxLimites')
exportar('LimitesMontagem', 'SELECT DimInicial1, DimInicial2, DimFinal1, DimFinal2, FormFinal1, FormFinal2, tipoDado FROM LimiteMontagem')

// ── Parâmetros gerais (só as famílias relevantes; o importador aplica lista fechada de chaves) ──
exportar(
  'Parametros',
  `SELECT Codigo, Tipo, Descricao, Conteudo FROM Parametros WHERE Tipo IN (${lista(TIPOS_PARAMETROS)})`,
)

// ── Apoio ao casamento por nome normalizado ─────────────────────────────────
exportar('CentrosProducao', 'SELECT Codigo, Ativo, Nome, TipoAtividade, CodQuebra, Processo, CodCoberturaTinta FROM CentrosProducao')
exportar('CentrosCusto', 'SELECT Codigo, Ativo, Nome, AgrupamentoCusto, FlagTabelaCusto FROM CentrosCusto')
exportar('Suportes', 'SELECT Codigo, Ativo, Nome, Descricao, Fabricante FROM Suportes')
exportar('Fechamento', 'SELECT Codigo, Ativo, Nome, QtdeMargens, MargemDefault FROM Fechamento')
exportar('Unidades', 'SELECT Codigo, Ativo, Nome FROM Unidades')
exportar('TributacaoVenda', 'SELECT Codigo, Ativo, Nome, TipoImposto, AliquotaImposto, AliquotaIPI FROM TributacaoVenda')

// ── Gravação ────────────────────────────────────────────────────────────────
const contagens = Object.fromEntries(Object.entries(resultado).map(([k, v]) => [k, v.length]))
const relDescartadas = (resultado.RelTabelas ?? []).filter((r) => r.descartar).length
const saida = {
  geradoEm: new Date().toISOString(),
  banco: DB,
  tabelaRelDescartada: TABELA_DESCARTADA,
  contagens,
  ...resultado,
}
writeFileSync(ARQUIVO, JSON.stringify(saida), 'utf8')

console.log('')
console.log(`RelTabelas: ${resultado.RelTabelas?.length ?? 0} linhas (${relDescartadas} marcadas para descarte — tabela ${TABELA_DESCARTADA})`)
console.log(`Arquivo: ${ARQUIVO}`)
if (falhas.length) {
  console.error(`Conjuntos com falha: ${falhas.join(', ')}`)
  process.exitCode = 1
} else {
  console.log('Exportação concluída sem falhas.')
}
