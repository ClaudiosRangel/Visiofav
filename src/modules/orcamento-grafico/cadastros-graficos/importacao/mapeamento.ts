/**
 * Mapeamento PURO das linhas exportadas do legado (JSON UTF-8) para `ItemLegado`
 * (campos do Vizor). Sem Prisma. Spec orcamento-grafico-cadastros-relacoes,
 * tarefa 7.2 (Req 14.7 e 14.9).
 *
 * Princípios:
 *  - nunca inventa valor: rótulo desconhecido vira `rejeicao` (não casado) ou campo vazio;
 *  - acentos e caixa do nome original são preservados (a normalização só serve para casar);
 *  - `CANCELADO` no legado marca `cancelado` (não é criado; pode preencher um existente);
 *  - dependências (ids do Vizor) chegam por `ctx`, montado pelo script a partir do banco
 *    (em dry-run, os recém-planejados entram com id sintético `dry:...`).
 */
import type { ItemLegado } from './planejador'
import { estaCancelado, flag, normalizarNome, numero, numeroPositivo, textoLimpo } from './normalizar'

export type LinhaBruta = Record<string, unknown>
type Ids = ReadonlyMap<number, string>

function codigoDe(valor: unknown): number | null {
  const n = numero(valor)
  return n !== null && Number.isInteger(n) ? n : null
}

/** Remove chaves com valor `undefined` (campo sem fonte no legado). */
function limpar(dados: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(dados).filter(([, v]) => v !== undefined))
}

// ───────────────────────── catálogos ─────────────────────────

interface MapeadorSimples {
  prefixo: string
  maxChave: number
  campoNome: string
  campoAtivo: string
  maxNome: number
}

function mapearCatalogoSimples(linhas: readonly LinhaBruta[], m: MapeadorSimples): ItemLegado[] {
  const itens: ItemLegado[] = []
  for (const l of linhas) {
    const codigo = codigoDe(l.Codigo)
    const nome = textoLimpo(l[m.campoNome], m.maxNome)
    if (codigo === null || !nome) continue
    itens.push({
      codigoOrigem: codigo,
      nome,
      chave: `${m.prefixo}-${codigo}`.slice(0, m.maxChave),
      dados: {},
      cancelado: estaCancelado(l[m.campoAtivo]),
    })
  }
  return itens
}

export const mapearLinhas = (linhas: readonly LinhaBruta[]) =>
  mapearCatalogoSimples(linhas, { prefixo: 'CG-LIN', maxChave: 60, campoNome: 'Nome', campoAtivo: 'Ativo', maxNome: 120 })

export const mapearCoberturas = (linhas: readonly LinhaBruta[]) =>
  mapearCatalogoSimples(linhas, { prefixo: 'CG-COB', maxChave: 60, campoNome: 'Nome', campoAtivo: 'Ativo', maxNome: 120 })

export const mapearProcessos = (linhas: readonly LinhaBruta[]) =>
  mapearCatalogoSimples(linhas, { prefixo: 'CG-PROC', maxChave: 60, campoNome: 'Nome', campoAtivo: 'Ativo', maxNome: 120 })

// ───────────────────────── produtos ─────────────────────────

const MODO_FORMATO: Record<string, string> = {
  '3 dimensoes': 'TRES_DIMENSOES',
  '2 dimensoes': 'DUAS_DIMENSOES',
  '2 dim (aberto+fechado)': 'ABERTO_FECHADO',
}
/**
 * Formato VAZIO no Calcgraf (Display, Envelope e Impressos da linha Lâminas): a tela mostra só "Formato Página"
 * (um par de medidas), sem Comprimento/Altura/Abas. Os tipos de embalagem desses produtos já usam fórmula 2D
 * (`L` e `A`). Mapeia para 2 dimensões; antes caía no padrão do banco (3 dimensões).
 */
const MODO_FORMATO_PADRAO_VAZIO = 'DUAS_DIMENSOES'
function modoDoFormato(formato: unknown): string | undefined {
  const chave = normalizarNome(formato)
  if (chave === '') return MODO_FORMATO_PADRAO_VAZIO
  return MODO_FORMATO[chave]
}

export interface CtxProdutos {
  idsLinha: Ids
  /** Código da tributação no legado → nome. */
  tributacoes: Ids
}

export function mapearProdutos(linhas: readonly LinhaBruta[], ctx: CtxProdutos): ItemLegado[] {
  const itens: ItemLegado[] = []
  for (const l of linhas) {
    const codigo = codigoDe(l.Codigo)
    const nome = textoLimpo(l.Nome, 200)
    if (codigo === null || !nome) continue
    const linhaCod = codigoDe(l.CodLinhaProduto)
    const trib = codigoDe(l.CodTributacaoVenda)
    const classif = numeroPositivo(l.CodClassFiscal)
    const baseUnidade = numero(l.BaseUnidade)
    itens.push({
      codigoOrigem: codigo,
      nome,
      chave: `CG-PROD-${codigo}`.slice(0, 60),
      cancelado: estaCancelado(l.Ativo),
      dados: limpar({
        linhaProdutoId: linhaCod ? ctx.idsLinha.get(linhaCod) : undefined,
        tributacao2026: trib ? textoLimpo(ctx.tributacoes.get(trib), 60) : undefined,
        classificacaoFiscal: classif !== null ? String(classif) : undefined,
        baseUnidadePreco: baseUnidade === 1 ? 'UNITARIO' : undefined,
        prazoProducaoDias: numeroPositivo(l.PrazoProducao) ?? undefined,
        faturamentoMinimo: flag(l.FlagFatMinimo),
        valorFaturamentoMinimo: numeroPositivo(l.ValFaturamentoMinimo) ?? undefined,
        tipoCartucho: textoLimpo(l.TipoCartucho, 60) ?? undefined,
        modoFormato: modoDoFormato(l.Formato),
        formatoPadraoLargura: numeroPositivo(l.FormatoDef1) ?? undefined,
        formatoPadraoAltura: numeroPositivo(l.FormatoDef2) ?? undefined,
      }),
    })
  }
  return itens
}

// ───────────────────────── tipos de plano ─────────────────────────

export interface CtxPlanos {
  idsLinha: Ids
  /** Código do suporte no legado → id do Vizor (casado por nome). */
  idsSuporte: Ids
}

export interface CaracteristicaPlano {
  codLinhaProduto: number
  codPlano: number
  NomeCampo: string
  ValorCampo: unknown
}

/** Primeiro valor útil (não vazio, não "undefined") de uma característica do plano. */
function caracteristica(cs: readonly CaracteristicaPlano[], nome: string): string | null {
  for (const c of cs) {
    if (normalizarNome(c.NomeCampo) !== normalizarNome(nome)) continue
    const v = textoLimpo(c.ValorCampo)
    if (v !== null && v !== 'undefined') return v
  }
  return null
}

const simNao = (v: string | null): boolean | undefined => {
  if (v === null) return undefined
  const n = normalizarNome(v)
  return n === 'sim' ? true : n === 'nao' ? false : undefined
}

export function mapearPlanos(
  linhas: readonly LinhaBruta[],
  caracteristicas: readonly LinhaBruta[],
  ctx: CtxPlanos,
): ItemLegado[] {
  const itens: ItemLegado[] = []
  for (const l of linhas) {
    const codigo = codigoDe(l.CODIGO)
    const nome = textoLimpo(l.NOME, 200)
    if (codigo === null || !nome) continue
    const linhaCod = codigoDe(l.CODLINHAPRODUTO)
    const cs = (caracteristicas as readonly unknown[] as CaracteristicaPlano[]).filter(
      (c) => Number(c.codPlano) === codigo && (linhaCod === null || Number(c.codLinhaProduto) === linhaCod),
    )
    const calc = caracteristica(cs, 'Cálc.Autom.Formato')
    const larg = caracteristica(cs, 'Tipo Largura')
    const ocor = caracteristica(cs, 'Tipo Ocorrencia')
    const suporteCod = codigoDe(l.CodSuporteDefault)
    const fibra = textoLimpo(l.FIBRA, 20) ?? textoLimpo(l.DefFibra, 20)
    itens.push({
      codigoOrigem: codigo,
      nome,
      chave: `CG-PLANO-${codigo}`.slice(0, 60),
      cancelado: estaCancelado(l.ATIVO),
      dados: limpar({
        linhaProdutoId: linhaCod ? ctx.idsLinha.get(linhaCod) : undefined,
        fixo: normalizarNome(l.ATIVO) === 'fixo',
        miolo: simNao(caracteristica(cs, 'Plano Miolo')),
        calculoAutomaticoFormato: calc ? { sim: 'SIM', nao: 'NAO', opcional: 'OPCIONAL' }[normalizarNome(calc)] : undefined,
        primeiraMedida: larg && ['LF', 'LFX2', 'LOMBADA'].includes(larg.toUpperCase()) ? larg.toUpperCase() : undefined,
        somarOrelhas: simNao(caracteristica(cs, 'Somar orelhas')),
        somarLombada: simNao(caracteristica(cs, 'Somar lombada')),
        ocorrencias: ocor ? { '1': 'UMA', '2': 'DUAS', livre: 'LIVRE' }[normalizarNome(ocor)] : undefined,
        quebraPadrao: numeroPositivo(l.QUEBRAPADRAO) ?? undefined,
        corteDuploMin: numeroPositivo(l.CorteDuploMin) ?? undefined,
        suportePadraoId: suporteCod ? ctx.idsSuporte.get(suporteCod) : undefined,
        gramaturaPadrao: numeroPositivo(l.GramaturaSuporteDefault) ?? undefined,
        usarPinca: flag(l.FlagPinca),
        fibraDefault: fibra && normalizarNome(fibra) !== 'nao' ? fibra : undefined,
        frenteIgualVerso: flag(l.FlagFrenteIgualVerso),
        caderno: flag(l.FlagCaderno),
        margem1Mm: numero(l.MARGEM1) ?? undefined,
        margem2Mm: numero(l.MARGEM2) ?? undefined,
        formato: textoLimpo(l.FORMATO, 60) ?? undefined,
      }),
    })
  }
  return itens
}

// ───────────────────────── atividades e restrições ─────────────────────────

export interface CtxAtividades {
  /** Códigos do legado que são destino da relação de acondicionamento (tabela 6). */
  codigosAcondicionamento: ReadonlySet<number>
}

function lerParamAcab(valor: unknown): unknown[] | null {
  if (Array.isArray(valor)) return valor
  if (typeof valor === 'string' && valor.trim().startsWith('[')) {
    try {
      const v = JSON.parse(valor)
      return Array.isArray(v) ? v : null
    } catch {
      return null
    }
  }
  return null
}

export function mapearAtividades(linhas: readonly LinhaBruta[], ctx: CtxAtividades): ItemLegado[] {
  const itens: ItemLegado[] = []
  for (const l of linhas) {
    const codigo = codigoDe(l.Codigo)
    const nome = textoLimpo(l.Nome, 200)
    if (codigo === null || !nome) continue
    const paramAcab = lerParamAcab(l.ParamAcab)
    const caracteristicas = limpar({
      chaveDicionario: textoLimpo(l.ChaveDicionario) ?? undefined,
      ordemPrioridade: numero(l.OrdemPrioridadeAtv) ?? undefined,
      aumentoTempoPerc: numeroPositivo(l.AumTempoPerc) ?? undefined,
      aumentoTempoMin: numeroPositivo(l.AumTempoMin) ?? undefined,
      atividadeForte: flag(l.FlagAtvForte) || undefined,
      utilizaCtp: flag(l.FlagUtilizaCTP) || undefined,
      paramAcab: paramAcab && paramAcab.length > 0 ? paramAcab : undefined,
    })
    itens.push({
      codigoOrigem: codigo,
      nome,
      chave: `CG-ACAB-${codigo}`.slice(0, 40),
      cancelado: estaCancelado(l.Ativo),
      dados: limpar({
        tipoAtividade: normalizarNome(l.TipoAtividade).startsWith('impress') ? 'IMPRESSAO' : 'ACABAMENTO',
        planoProduto: normalizarNome(l.PlanoProduto) === 'produto' ? 'PRODUTO' : 'PLANO',
        textoProposta: textoLimpo(l.TextoProposta) ?? undefined,
        exibirNomePlano: flag(l.FlagExibirNomePlanoProposta),
        acondicionamento: ctx.codigosAcondicionamento.has(codigo),
        caracteristicas: Object.keys(caracteristicas).length > 0 ? caracteristicas : undefined,
      }),
    })
  }
  return itens
}

export interface CtxRestricoes {
  idsAtividade: Ids
  atividadesCanceladas: ReadonlySet<number>
}

export function mapearRestricoes(linhas: readonly LinhaBruta[], ctx: CtxRestricoes): ItemLegado[] {
  const itens: ItemLegado[] = []
  for (const l of linhas) {
    const codigo = codigoDe(l.Codigo)
    const nome = textoLimpo(l.Nome, 100)
    const atividade = codigoDe(l.CodAtividade)
    if (codigo === null || !nome || atividade === null) continue
    const acabId = ctx.idsAtividade.get(atividade)
    const cancelado = estaCancelado(l.Ativo) || ctx.atividadesCanceladas.has(atividade)
    const base: ItemLegado = {
      codigoOrigem: codigo,
      nome,
      nomeCasamento: acabId ? `${acabId}|${nome}` : nome,
      cancelado,
      // Tempos de acerto/operação não existem no cadastro de restrições do legado
      // (o fator vem dos Ajustes de Produtividade): 0 é o valor neutro exigido pelo schema.
      dados: limpar({
        acabamentoGraficoId: acabId,
        tempoAcertoMin: 0,
        tempoOperacaoMin: 0,
        exibirNaProposta: flag(l.flagExibirProposta),
      }),
    }
    if (!acabId && !cancelado) {
      base.rejeicao = { motivo: 'DEPENDENCIA_SEM_EQUIVALENTE', detalhe: `atividade ${atividade} sem equivalente no Vizor` }
    }
    itens.push(base)
  }
  return itens
}

// ───────────────────────── materiais e itens diversos ─────────────────────────

const TIPO_MATERIAL: Record<string, string> = {
  'revestimento por m2': 'OUTRO',
  'cola para fechar cartucho': 'COLA',
  'revestimento por kg': 'REVESTIMENTO_KG',
  'mat. proporcional a tiragem': 'PROPORCIONAL_TIRAGEM',
  'fita dupla face': 'FITA',
  'acondicionamento (comum)': 'ACONDICIONAMENTO',
}

const UNIDADE_CUSTO: Record<string, string> = { kg: 'KG', m2: 'M2', un: 'UN', ml: 'M' }

export interface PrecoLegado {
  codTabelaCusto?: number
  coluna?: number
  valorTotal?: number
}

/** Preço da tabela de custo vigente (a de maior código com valor), coluna 1. Zero ou ausente = sem preço. */
export function precoVigente(precos: unknown, tabelaVigente?: number): number | null {
  const lista = Array.isArray(precos) ? (precos as PrecoLegado[]) : []
  const col1 = lista.filter((p) => Number(p.coluna) === 1 && (numero(p.valorTotal) ?? 0) > 0)
  if (col1.length === 0) return null
  const alvo =
    tabelaVigente !== undefined && col1.some((p) => Number(p.codTabelaCusto) === tabelaVigente)
      ? col1.filter((p) => Number(p.codTabelaCusto) === tabelaVigente)
      : [...col1].sort((a, b) => Number(b.codTabelaCusto) - Number(a.codTabelaCusto)).slice(0, 1)
  return numero(alvo[0].valorTotal)
}

export interface CtxMateriais {
  /** Materiais (código do legado) com `TipoParamAcab = 3` em algum cálculo (medida linear em mm). */
  codigosMedidaLinear: ReadonlySet<number>
  tabelaCustoVigente?: number
}

export function mapearMateriais(linhas: readonly LinhaBruta[], ctx: CtxMateriais): ItemLegado[] {
  const itens: ItemLegado[] = []
  for (const l of linhas) {
    const codigo = codigoDe(l.Codigo)
    const nome = textoLimpo(l.Nome, 200)
    if (codigo === null || !nome) continue
    const unidade = UNIDADE_CUSTO[normalizarNome(l.Unidade)]
    itens.push({
      codigoOrigem: codigo,
      nome,
      chave: `CG-MAT-${codigo}`.slice(0, 60),
      cancelado: estaCancelado(l.Ativo),
      dados: limpar({
        valorReferencia: precoVigente(l.Precos, ctx.tabelaCustoVigente) ?? undefined,
        tipoMaterial: TIPO_MATERIAL[normalizarNome(l.Tipo)],
        unidadeCusto: unidade,
        medidaLinear: ctx.codigosMedidaLinear.has(codigo) || normalizarNome(l.Unidade) === 'ml',
      }),
    })
  }
  return itens
}

/** Códigos de material cujo uso real tem `tipoParamAcab = 3`, lidos de `Atividades[].ParamAcab`. */
export function materiaisComMedidaLinear(atividades: readonly LinhaBruta[]): Set<number> {
  const out = new Set<number>()
  for (const a of atividades) {
    for (const p of lerParamAcab(a.ParamAcab) ?? []) {
      const o = p as Record<string, unknown>
      if (Number(o.tipoParamAcab) === 3) {
        const cod = codigoDe(o.codMaterial)
        if (cod !== null) out.add(cod)
      }
    }
  }
  return out
}

const ORIGEM_ITEM_DIVERSO: Record<string, string> = {
  'centro de custo': 'CENTRO_DE_CUSTO',
  'servico externo': 'SERVICO_EXTERNO',
  'pre-impressao': 'PRE_IMPRESSAO',
  tinta: 'TINTA',
  'matriz impressao': 'MATRIZ_IMPRESSAO',
}

export function mapearItensDiversos(linhas: readonly LinhaBruta[]): ItemLegado[] {
  const itens: ItemLegado[] = []
  for (const l of linhas) {
    const codigo = codigoDe(l.Codigo)
    const nome = textoLimpo(l.Nome, 200)
    if (codigo === null || !nome) continue
    const origem = ORIGEM_ITEM_DIVERSO[normalizarNome(l.Origem)]
    const base: ItemLegado = {
      codigoOrigem: codigo,
      nome,
      cancelado: estaCancelado(l.Ativo),
      dados: limpar({
        origem,
        sigla: textoLimpo(l.Sigla, 30) ?? undefined,
        textoProposta: textoLimpo(l.TextoProposta) ?? undefined,
        itemRevenda: (codigoDe(l.CodAcabadoRevenda) ?? 0) > 0,
        pendenciaAutomaticaPcp: flag(l.FlagPendAutoPcp),
      }),
    }
    if (!origem) base.rejeicao = { motivo: 'VALOR_SEM_EQUIVALENTE', detalhe: `origem "${String(l.Origem)}" sem equivalente` }
    itens.push(base)
  }
  return itens
}

// ───────────────────────── campos livres ─────────────────────────

const PROPRIETARIO: Record<string, string> = { SOL: 'SOLICITACAO', PED: 'PEDIDO', RCS: 'RECUSA', INS: 'INSUMO' }

export function mapearCamposLivres(linhas: readonly LinhaBruta[]): ItemLegado[] {
  const itens: ItemLegado[] = []
  for (const l of linhas) {
    const chave = codigoDe(l.CodChave)
    const nome = textoLimpo(l.Caption, 120)
    if (chave === null || !nome) continue
    const sigla = String(l.Proprietario ?? '').trim().toUpperCase()
    const proprietario = PROPRIETARIO[sigla]
    const tipo = codigoDe(l.Tipo)
    const base: ItemLegado = {
      codigoOrigem: chave,
      nome,
      nomeCasamento: `${proprietario ?? sigla}|${nome}`,
      cancelado: estaCancelado(l.Ativo),
      dados: limpar({
        proprietario,
        tipo: tipo === 2 ? 'LISTA' : tipo === 1 ? 'TEXTO' : undefined,
        obrigatorio: flag(l.FlagPreenchimentoObrigatorio),
        ordem: codigoDe(l.Codigo) ?? undefined,
      }),
    }
    if (!proprietario) base.rejeicao = { motivo: 'VALOR_SEM_EQUIVALENTE', detalhe: `proprietário "${sigla}" sem equivalente (válidos: ${Object.keys(PROPRIETARIO).join(', ')})` }
    else if (tipo !== 1 && tipo !== 2) base.rejeicao = { motivo: 'VALOR_SEM_EQUIVALENTE', detalhe: `tipo de campo "${String(l.Tipo)}" sem equivalente` }
    itens.push(base)
  }
  return itens
}

export function mapearOpcoesCampo(linhas: readonly LinhaBruta[], idsCampo: Ids, camposCancelados: ReadonlySet<number>): ItemLegado[] {
  const itens: ItemLegado[] = []
  const ordemPorCampo = new Map<number, number>()
  for (const l of linhas) {
    const campo = codigoDe(l.CodChaveParamCl)
    const valor = textoLimpo(l.Lista, 200)
    if (campo === null || !valor) continue
    const campoId = idsCampo.get(campo)
    const ordem = (ordemPorCampo.get(campo) ?? 0) + 1
    ordemPorCampo.set(campo, ordem)
    const item: ItemLegado = {
      codigoOrigem: null,
      nome: valor,
      chaveNatural: campoId ? `${campoId}|${normalizarNome(valor)}` : undefined,
      cancelado: estaCancelado(l.Ativo) || camposCancelados.has(campo),
      dados: { campoLivreId: campoId, valor, padrao: flag(l.flagDefaultCl), ordem },
    }
    if (!campoId && !item.cancelado) item.rejeicao = { motivo: 'DEPENDENCIA_SEM_EQUIVALENTE', detalhe: `campo livre ${campo} sem equivalente no Vizor` }
    itens.push(item)
  }
  return itens
}

export interface RelacionamentoCampo {
  origem: number
  destino: number
}

export function lerRelacionamentosCampos(linhas: readonly LinhaBruta[]): RelacionamentoCampo[] {
  const out: RelacionamentoCampo[] = []
  for (const l of linhas) {
    const origem = codigoDe(l.CodChaveParamClOrigem)
    const destino = codigoDe(l.CodChaveParamClDestino)
    if (origem !== null && destino !== null) out.push({ origem, destino })
  }
  return out
}

// ───────────────────────── ajustes, quebras, limites ─────────────────────────

const DADO_AJUSTAR: Record<string, string> = {
  incondicional: 'INCONDICIONAL',
  'producao/hora': 'PRODUCAO_HORA',
  acerto: 'ACERTO',
  'consumo do material': 'CONSUMO_MATERIAL',
}
const FUNCAO_AJUSTE: Record<string, string> = {
  'formato processo': 'FORMATO_PROCESSO',
  atividade: 'ATIVIDADE',
  'restricao manual': 'RESTRICAO_MANUAL',
}

export interface CtxAjustes {
  idsAtividade: Ids
  idsCentro: Ids
  atividadesCanceladas: ReadonlySet<number>
  /** `${codAtividade}|${nomeNormalizado}` → id da restrição no Vizor. */
  idsRestricaoPorNome: ReadonlyMap<string, string>
  /** Nome do centro no legado (para a mensagem). */
  nomesCentro: Ids
}

/** Chave natural do ajuste (a mesma regra vale para os existentes e para os do legado). */
export function chaveAjuste(c: {
  acabamentoId: string
  centroProducaoId: string | null
  dadoAjustar: string
  funcao: string
  operador: string | null
  valor: string | null
  fator: number
}): string {
  return [
    c.acabamentoId,
    c.centroProducaoId ?? '',
    c.dadoAjustar,
    c.funcao,
    normalizarNome(c.operador),
    normalizarNome(c.valor),
    Number(c.fator).toFixed(4),
  ].join('|')
}

export function mapearAjustes(linhas: readonly LinhaBruta[], ctx: CtxAjustes): ItemLegado[] {
  const itens: ItemLegado[] = []
  for (const l of linhas) {
    const atividade = codigoDe(l.CodAtividade)
    if (atividade === null) continue
    const centroCod = codigoDe(l.CodCentroProducao) ?? 0
    const nome = `Ajuste atividade ${atividade}${centroCod > 0 ? ` centro ${centroCod}` : ''}: ${String(l.DadoAjustar ?? '')} ${String(l.Valor ?? '')}`.trim()
    const dado = DADO_AJUSTAR[normalizarNome(l.DadoAjustar)]
    const funcao = FUNCAO_AJUSTE[normalizarNome(l.Funcao)]
    const acabId = ctx.idsAtividade.get(atividade)
    const centroId = centroCod > 0 ? ctx.idsCentro.get(centroCod) : null
    const item: ItemLegado = {
      codigoOrigem: null,
      nome,
      cancelado: ctx.atividadesCanceladas.has(atividade),
      dados: {},
    }
    if (!dado || !funcao) {
      item.rejeicao = { motivo: 'VALOR_SEM_EQUIVALENTE', detalhe: `dado "${String(l.DadoAjustar)}" ou função "${String(l.Funcao)}" sem equivalente` }
    } else if (!acabId) {
      if (!item.cancelado) item.rejeicao = { motivo: 'DEPENDENCIA_SEM_EQUIVALENTE', detalhe: `atividade ${atividade} sem equivalente no Vizor` }
    } else if (centroCod > 0 && !centroId) {
      item.rejeicao = {
        motivo: 'DEPENDENCIA_SEM_EQUIVALENTE',
        detalhe: `centro ${centroCod} "${ctx.nomesCentro.get(centroCod) ?? ''}" sem equivalente no Vizor`,
      }
    } else {
      const operador = textoLimpo(l.Operador, 20)
      const valor = textoLimpo(l.Valor, 120)
      const fator = numero(l.Fator) ?? 0
      const restricaoId =
        funcao === 'RESTRICAO_MANUAL' && valor ? ctx.idsRestricaoPorNome.get(`${atividade}|${normalizarNome(valor)}`) : undefined
      item.chaveNatural = chaveAjuste({
        acabamentoId: acabId,
        centroProducaoId: centroId ?? null,
        dadoAjustar: dado,
        funcao,
        operador,
        valor,
        fator,
      })
      item.dados = limpar({
        acabamentoId: acabId,
        centroProducaoId: centroId ?? undefined,
        dadoAjustar: dado,
        funcao,
        operador: operador ?? undefined,
        valor: valor ?? undefined,
        fator,
        fatorPositivo: flag(l.FlagPositiva),
        impedeMontagemCadernos: flag(l.ImpedeMontCadernos),
        restricaoId,
      })
    }
    itens.push(item)
  }
  return itens
}

export function mapearQuebras(linhas: readonly LinhaBruta[]): ItemLegado[] {
  const itens: ItemLegado[] = []
  for (const l of linhas) {
    const codigo = codigoDe(l.Codigo)
    const nome = textoLimpo(l.Nome, 200)
    if (codigo === null || !nome) continue
    itens.push({
      codigoOrigem: codigo,
      nome,
      cancelado: estaCancelado(l.Ativo),
      dados: limpar({
        tipoAtividade: normalizarNome(l.TipoAtividade).startsWith('impress') ? 'IMPRESSAO' : 'ACABAMENTO',
        // Pedacos2Ent carrega os "70 pedaços por acerto" da impressão (HANDOFF §17.2). O mapeamento
        // das demais colunas segue o nome; todas valem 0 na base atual (0 = sem valor).
        pedacosPorAcerto: numeroPositivo(l.Pedacos2Ent) ?? undefined,
        pedacosPorPlano: numeroPositivo(l.Pedacos1Ent) ?? undefined,
        pedacosPorTipoPlano: numeroPositivo(l.PedacosTipoPlano) ?? undefined,
        pedacosOcorrencias: numeroPositivo(l.PedacosOcorrencias) ?? undefined,
        pedacosMinimoPerc: numeroPositivo(l.PEDACOSMINPERC) ?? undefined,
        interpolar: flag(l.InterpolarQuebra),
      }),
    })
  }
  return itens
}

export function mapearLimitesQuebra(linhas: readonly LinhaBruta[], idsQuebra: Ids, quebrasCanceladas: ReadonlySet<number>): ItemLegado[] {
  const itens: ItemLegado[] = []
  for (const l of linhas) {
    const quebra = codigoDe(l.CodQuebra)
    const tiragem = codigoDe(l.Tiragem)
    const perc = numero(l.QuebraPerc)
    if (quebra === null || tiragem === null || perc === null) continue
    const quebraId = idsQuebra.get(quebra)
    const item: ItemLegado = {
      codigoOrigem: null,
      nome: `Quebra ${quebra} até ${tiragem}: ${perc}%`,
      chaveNatural: quebraId ? `${quebraId}|${tiragem}` : undefined,
      cancelado: quebrasCanceladas.has(quebra),
      dados: { quebraId, tiragemAte: tiragem, quebraPerc: perc },
    }
    if (!quebraId && !item.cancelado) item.rejeicao = { motivo: 'DEPENDENCIA_SEM_EQUIVALENTE', detalhe: `quebra ${quebra} sem equivalente no Vizor` }
    itens.push(item)
  }
  return itens
}

/** Chave natural do limite de montagem: formato final (largura x altura). */
export const chaveLimiteMontagem = (largura: number, altura: number) => `${Number(largura).toFixed(2)}x${Number(altura).toFixed(2)}`

export function mapearLimitesMontagem(linhas: readonly LinhaBruta[]): ItemLegado[] {
  const itens: ItemLegado[] = []
  for (const l of linhas) {
    const largura = numeroPositivo(l.FormFinal1)
    const altura = numeroPositivo(l.FormFinal2)
    if (largura === null || altura === null) continue
    itens.push({
      codigoOrigem: null,
      nome: `Limite de montagem ${largura} x ${altura}`,
      chaveNatural: chaveLimiteMontagem(largura, altura),
      dados: {
        formatoFinalLargura: largura,
        formatoFinalAltura: altura,
        minimo: codigoDe(l.DimInicial1) ?? 0,
        maximo: codigoDe(l.DimFinal1) ?? 0,
      },
    })
  }
  return itens
}

// ───────────────────────── defaults do produto por plano ─────────────────────────

export interface CtxDefaults {
  idsProduto: Ids
  idsPlano: Ids
  idsProcesso: Ids
  idsCobertura: Ids
  idsAtividade: Ids
  produtosCancelados: ReadonlySet<number>
}

export function mapearDefaults(
  linhas: readonly LinhaBruta[],
  produtosAtividades: readonly LinhaBruta[],
  ctx: CtxDefaults,
): ItemLegado[] {
  const itens: ItemLegado[] = []
  for (const l of linhas) {
    const produto = codigoDe(l.CodProduto)
    const plano = codigoDe(l.CodPlano)
    if (produto === null || plano === null) continue
    const produtoId = ctx.idsProduto.get(produto)
    const planoId = ctx.idsPlano.get(plano)
    const processo = codigoDe(l.CodProcessoImpressao) ?? 0
    const cobertura = codigoDe(l.CodCoberturaTinta) ?? 0
    const preMarcadas = produtosAtividades
      .filter((a) => codigoDe(a.CodProduto) === produto && codigoDe(a.CodPlano) === plano && (codigoDe(a.CodAtividade) ?? 0) > 0)
      .map((a) => ctx.idsAtividade.get(codigoDe(a.CodAtividade) as number))
      .filter((id): id is string => !!id)
    const item: ItemLegado = {
      codigoOrigem: null,
      nome: `Produto ${produto} × plano ${plano}`,
      chaveNatural: produtoId && planoId ? `${produtoId}|${planoId}` : undefined,
      cancelado: ctx.produtosCancelados.has(produto),
      dados: limpar({
        produtoId,
        tipoPlanoId: planoId,
        semImpressao: flag(l.FlagSemImpressao),
        processoImpressaoId: processo > 0 ? ctx.idsProcesso.get(processo) : undefined,
        coberturaTintaId: cobertura > 0 ? ctx.idsCobertura.get(cobertura) : undefined,
        coresFrente: codigoDe(l.CoresF) ?? 0,
        coresVerso: codigoDe(l.CoresV) ?? 0,
        areaTintaPerc: numero(l.AreaTinta) ?? 0,
        fabricanteSuporte: textoLimpo(l.NomeFabricanteSup, 120) ?? undefined,
        atividadesPreMarcadas: preMarcadas.length > 0 ? preMarcadas : undefined,
      }),
    }
    if ((!produtoId || !planoId) && !item.cancelado) {
      item.rejeicao = {
        motivo: 'DEPENDENCIA_SEM_EQUIVALENTE',
        detalhe: `${!produtoId ? `produto ${produto}` : ''}${!produtoId && !planoId ? ' e ' : ''}${!planoId ? `plano ${plano}` : ''} sem equivalente no Vizor`,
      }
    }
    itens.push(item)
  }
  return itens
}

// ───────────────────────── parâmetros gerais ─────────────────────────

/** Lista fechada: código do legado → chave `orc.*` e texto esperado da descrição (guarda contra código reaproveitado). */
export const PARAMETROS_MAPEADOS: readonly { codigo: number; chave: string; descricao: RegExp }[] = [
  { codigo: 124, chave: 'orc.refileFolhaInteira', descricao: /refile folha inteira/ },
  { codigo: 125, chave: 'orc.contraPinca', descricao: /contra-?pinca/ },
  { codigo: 126, chave: 'orc.refileFinal', descricao: /refile final/ },
  { codigo: 127, chave: 'orc.corteDuplo', descricao: /corte duplo/ },
  { codigo: 129, chave: 'orc.partidaTintaGramas', descricao: /partida de consumo de tinta/ },
  { codigo: 91, chave: 'orc.jurosAplicacaoMes', descricao: /juros para aplicacao/ },
  { codigo: 96, chave: 'orc.jurosBancariosMes', descricao: /juros bancarios/ },
  { codigo: 97, chave: 'orc.prazoMedioProducaoDias', descricao: /prazo medio de producao/ },
  { codigo: 616, chave: 'orc.diasRecusado', descricao: /considerar recusado/ },
]

export function mapearParametros(linhas: readonly LinhaBruta[]): ItemLegado[] {
  const itens: ItemLegado[] = []
  for (const def of PARAMETROS_MAPEADOS) {
    const l = linhas.find((x) => codigoDe(x.Codigo) === def.codigo)
    const nome = def.chave
    if (!l) {
      itens.push({ codigoOrigem: null, nome, chaveNatural: def.chave, dados: {}, rejeicao: { motivo: 'SEM_EQUIVALENTE', detalhe: `parâmetro ${def.codigo} ausente na exportação` } })
      continue
    }
    const valor = numero(l.Conteudo)
    if (!def.descricao.test(normalizarNome(l.Descricao)) || valor === null) {
      itens.push({
        codigoOrigem: null,
        nome,
        chaveNatural: def.chave,
        dados: {},
        rejeicao: { motivo: 'VALOR_SEM_EQUIVALENTE', detalhe: `parâmetro ${def.codigo} "${String(l.Descricao)}" = "${String(l.Conteudo)}" não confere com o esperado` },
      })
      continue
    }
    itens.push({ codigoOrigem: null, nome, chaveNatural: def.chave, dados: { valor: String(valor) } })
  }
  return itens
}

// ───────────────────────── cópia solicitação → pedido ─────────────────────────

export interface PlanoCopiaCampos {
  /** Campos de origem que passam a apontar para o campo do pedido (só os que estão vazios). */
  definir: { id: string; destinoId: string }[]
  ignorados: number
  naoCasados: { origem: number; destino: number; detalhe: string }[]
}

/**
 * `ParamClRelacionamentos`: o valor do campo da solicitação é copiado para o campo do pedido.
 * Preenche `copiaParaPedidoCampoId` só quando está vazio (nunca sobrescreve).
 * `atuais`: id do campo de origem → valor atual de `copiaParaPedidoCampoId` (ausente = vazio).
 */
export function planejarCopiaCampos(
  relacionamentos: readonly RelacionamentoCampo[],
  idsCampo: Ids,
  atuais: ReadonlyMap<string, string | null>,
): PlanoCopiaCampos {
  const plano: PlanoCopiaCampos = { definir: [], ignorados: 0, naoCasados: [] }
  for (const r of relacionamentos) {
    const origemId = idsCampo.get(r.origem)
    const destinoId = idsCampo.get(r.destino)
    if (!origemId || !destinoId) {
      plano.naoCasados.push({
        origem: r.origem,
        destino: r.destino,
        detalhe: `campo ${!origemId ? r.origem : r.destino} sem equivalente no Vizor`,
      })
      continue
    }
    if (atuais.get(origemId)) plano.ignorados++
    else plano.definir.push({ id: origemId, destinoId })
  }
  return plano
}
