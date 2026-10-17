/**
 * Funções PURAS de montagem do roteiro de OP do Calcgraf (Fase 2).
 *
 * Separadas do `calcgraf-reader.ts` (que faz I/O SQL) para serem testáveis sem
 * conexão. Convertem linhas cruas de `CalculoAtividades` (etapas) e
 * `CalculoPlanos`/`CalculoTintas`/`CalculoMatAcabamento` em pedaços do
 * `OpOrigemDTO` espelhado do backend.
 *
 * Referência: docs/calcgraf-mapeamento-roteiro-op.md (golden case OP 3000).
 */

// ===========================================================================
// Tipos de linha crua (subconjunto das colunas do Calcgraf que usamos)
// ===========================================================================

/** Linha de `CalculoAtividades` já com nomes de atividade/centro resolvidos. */
export interface AtividadeRow {
  tipo?: string // 'I' (impressão) | 'A' (acabamento)
  itemSeq1?: number
  itemSeq2?: number
  atividadeNome?: string // Atividades.Nome
  centroNome?: string // CentrosProducao.Nome
  centroCodigo?: number | string // CentrosProducao.Codigo (CalculoAtividades.codCentroCusto)
  quantAcertos?: number
  tempoPorAcerto?: number
  tempoPrimeiroAcerto?: number
  producaoHora?: number
  tiragem?: number
}

/** Linha de `CalculoPlanos` já com nome do suporte (papel) resolvido. */
export interface PlanoRow {
  Ordem?: number
  codPlano?: string | number
  nomePlano?: string
  suporteNome?: string // nome do papel resolvido de codSuporte
  gramatura?: number
  dimensao1?: number
  dimensao2?: number
  aproveitamento?: number
  tiragem?: number
}

/** Linha de `CalculoTintas` já com nome da tinta/Pantone. */
export interface TintaRow {
  codTinta?: string | number
  areaTinta?: number // % de cobertura
  ComplementoNome?: string // nome Pantone (ex.: "AMARELO - 123C")
}

/**
 * Cores por plano, agregadas de `CalculoAtvImpressao` (coresF/coresV) por
 * `processoCodPlano`. Validado no backup: OP 3000 plano 1 = 2x0; OP 3133
 * planos 15/17 = 4x0. Retiração (frente/verso) = `coresV > 0` OU `tiraRetira=1`.
 */
export interface CoresPlanoRow {
  /** `CalculoAtvImpressao.processoCodPlano` → casa com `CalculoPlanos.codPlano`. */
  codPlano?: string | number
  /** Cores da frente (máx entre as linhas do plano). */
  coresF?: number
  /** Cores do verso (máx entre as linhas do plano). */
  coresV?: number
  /** Flag de retiração (tira-retira) da impressão. */
  tiraRetira?: number
}

// ===========================================================================
// DTO (espelho do backend — subconjunto montado aqui)
// ===========================================================================

export interface EtapaDTO {
  sequencia?: number
  centro?: string
  descricao?: string
  tipo?: string
  setupMinutos?: number
  operacaoMinutos?: number
  /** Código do centro no Calcgraf (de-para no backend). Paridade PDF — T6. */
  centroCodigo?: string
}

export interface VariacaoDTO {
  sequencia?: number
  codigoPlano?: string
  nome?: string
  quantidade?: number
  suporte?: string
  gramatura?: number
  dimensao?: string
  aproveitamento?: number
}

/** Plano/componente (espelho de PlanoOpOrigemDTO do backend) — paridade PDF (T6b). */
export interface PlanoDTO {
  nome: string
  tipo?: string
  formato?: string
  cores?: string
  tiragem?: number
  material?: string
  gramatura?: number
  aproveitamento?: number
  retiracao?: boolean
  coresFrente?: string
  coresVerso?: string
  sequencia?: number
}

// ===========================================================================
// Helpers numéricos
// ===========================================================================

/** Converte um valor desconhecido para número finito; 0 se inválido. */
export function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

// ===========================================================================
// Cálculo de tempos (Requisito 2)
// ===========================================================================

/**
 * Setup (min) = quantAcertos * tempoPorAcerto + tempoPrimeiroAcerto.
 * Valores ausentes/inválidos contam como 0.
 */
export function calcularSetupMin(r: {
  quantAcertos?: number
  tempoPorAcerto?: number
  tempoPrimeiroAcerto?: number
}): number {
  return num(r.quantAcertos) * num(r.tempoPorAcerto) + num(r.tempoPrimeiroAcerto)
}

/**
 * Operação (min) = tiragem / producaoHora * 60.
 * Retorna 0 quando `producaoHora <= 0` (sem divisão por zero / sem Infinity).
 */
export function calcularOperacaoMin(r: { producaoHora?: number; tiragem?: number }): number {
  const ph = num(r.producaoHora)
  if (ph <= 0) return 0
  return (num(r.tiragem) / ph) * 60
}

/**
 * Nome/descrição da etapa = "<Atividade> <Centro>" (com trim). Cai para o que
 * estiver disponível quando um dos dois faltar; '' quando ambos faltam.
 */
export function montarNomeEtapa(atividadeNome?: string, centroNome?: string): string {
  const a = (atividadeNome ?? '').trim()
  const c = (centroNome ?? '').trim()
  if (a && c) return `${a} ${c}`
  return a || c || ''
}

// ===========================================================================
// Montagem de DTOs a partir das linhas cruas
// ===========================================================================

/** Converte uma linha de CalculoAtividades em EtapaDTO. `indice` é fallback de sequência. */
export function montarEtapaDTO(r: AtividadeRow, indice: number): EtapaDTO {
  // sequência estável: itemSeq1*1000 + itemSeq2 quando presentes; senão o índice.
  const temSeq = r.itemSeq1 != null || r.itemSeq2 != null
  const sequencia = temSeq ? num(r.itemSeq1) * 1000 + num(r.itemSeq2) : indice
  return {
    sequencia,
    centro: (r.centroNome ?? '').trim() || undefined,
    descricao: montarNomeEtapa(r.atividadeNome, r.centroNome) || undefined,
    tipo: (r.tipo ?? '').trim() || undefined,
    setupMinutos: calcularSetupMin(r),
    operacaoMinutos: calcularOperacaoMin(r),
    // Código do centro (de-para no backend): só emite quando presente/≠0.
    centroCodigo:
      r.centroCodigo != null && String(r.centroCodigo).trim() !== '' && num(r.centroCodigo) !== 0
        ? String(r.centroCodigo).trim()
        : undefined,
  }
}

/** Converte uma linha de CalculoPlanos em VariacaoDTO. */
export function montarVariacaoDTO(r: PlanoRow, indice: number): VariacaoDTO {
  const d1 = num(r.dimensao1)
  const d2 = num(r.dimensao2)
  const dimensao = d1 > 0 || d2 > 0 ? `${d1}x${d2}` : undefined
  return {
    sequencia: r.Ordem != null ? num(r.Ordem) : indice,
    codigoPlano: r.codPlano != null ? String(r.codPlano) : undefined,
    nome: (r.nomePlano ?? '').trim() || undefined,
    quantidade: num(r.tiragem),
    suporte: (r.suporteNome ?? '').trim() || undefined,
    gramatura: r.gramatura != null ? num(r.gramatura) : undefined,
    dimensao,
    aproveitamento: r.aproveitamento != null ? num(r.aproveitamento) : undefined,
  }
}

// ===========================================================================
// Programação de entrega (todas as datas dos lotes) — paridade PDF (T6)
// ===========================================================================

/** Lote de origem (OpLote) do qual derivamos a programação de entrega. */
export interface LoteParaEntrega {
  tiragem?: number
  dataPrometida?: string
  ordemFila?: number
}

/** Entrega parcial montada (espelho de EntregaOpOrigemDTO do backend). */
export interface EntregaDTO {
  data?: string
  quantidade?: number
}

/**
 * Monta a programação de entrega a partir dos lotes (OpLote): TODAS as datas,
 * não só a 1ª. Ignora lotes SEM data (não inventa data). Ordena por `ordemFila`
 * (quando houver) e depois por data crescente, para leitura previsível. O
 * backend (`montarEntregas`) ainda reordena por data e escolhe a MENOR como
 * `dataEntregaPrevista` — aqui só reunimos os pares (data, quantidade).
 *
 * Retorna `undefined` quando não há nenhuma data válida (o backend então usa o
 * fallback do lote principal). Função PURA (testável sem conexão).
 */
export function montarProgramacaoDeLotes(lotes: LoteParaEntrega[]): EntregaDTO[] | undefined {
  const entregas: EntregaDTO[] = []
  for (const l of lotes) {
    const data = (l.dataPrometida ?? '').trim()
    if (!data) continue // sem data → não vira entrega (não inventa)
    entregas.push({ data, quantidade: l.tiragem != null ? num(l.tiragem) : undefined })
  }
  if (entregas.length === 0) return undefined
  // Ordena por data crescente (estável; o backend reordena de qualquer modo).
  entregas.sort((a, b) => {
    const ta = new Date(a.data as string).getTime()
    const tb = new Date(b.data as string).getTime()
    if (Number.isNaN(ta) || Number.isNaN(tb)) return 0
    return ta - tb
  })
  return entregas
}

/**
 * Linha crua de `CalculoProgEntrega` — a programação de entrega POR CÁLCULO,
 * que é a fonte real da "Programação de Entrega" do PDF do Calcgraf (igual ao
 * importador de PDF). Cada linha é uma parcela: `Tiragem` é a tiragem TOTAL do
 * cálculo (repetida nas linhas) e `Percentual` é a fração daquela parcela.
 * A quantidade real da parcela = `Tiragem * Percentual / 100`.
 */
export interface ProgEntregaCalcRow {
  /** `CalculoProgEntrega.DataEntrega` (ISO/string de data). */
  dataEntrega?: string | null
  /** Tiragem total do cálculo (repetida em cada parcela). */
  tiragem?: number
  /** Percentual da parcela (0..100). Quando ausente/0, usa a Tiragem direta. */
  percentual?: number
}

/**
 * Monta a programação de entrega a partir de `CalculoProgEntrega` (fonte do
 * PDF do Calcgraf — por CÁLCULO, não por pedido). Converte cada linha numa
 * parcela `{ data, quantidade }`, com `quantidade = Tiragem * Percentual/100`
 * (ou `Tiragem` quando `Percentual` ausente/0). Ignora linhas SEM data (não
 * inventa). Ordena por data crescente. Retorna `undefined` quando não há
 * nenhuma data válida (o chamador então cai no fallback: pedido → lotes).
 *
 * PURA (testável sem conexão). Arredonda a quantidade para inteiro (as tiragens
 * do Calcgraf são inteiras; evita 9999.999 por imprecisão de float do percentual).
 */
export function montarProgramacaoDeCalculo(linhas: ProgEntregaCalcRow[]): EntregaDTO[] | undefined {
  const entregas: EntregaDTO[] = []
  for (const l of linhas) {
    const data = (l.dataEntrega ?? '').toString().trim()
    if (!data) continue // sem data → não vira entrega (não inventa)
    const tiragem = l.tiragem != null ? num(l.tiragem) : 0
    const perc = l.percentual != null ? num(l.percentual) : 0
    const quantidade = perc > 0 ? Math.round((tiragem * perc) / 100) : (tiragem > 0 ? tiragem : undefined)
    entregas.push({ data, quantidade })
  }
  if (entregas.length === 0) return undefined
  entregas.sort((a, b) => {
    const ta = new Date(a.data as string).getTime()
    const tb = new Date(b.data as string).getTime()
    if (Number.isNaN(ta) || Number.isNaN(tb)) return 0
    return ta - tb
  })
  return entregas
}

// ===========================================================================
// Planos/componentes + retiração (frente/verso) — paridade PDF (T6b)
// ===========================================================================

/**
 * Agrega as cores por plano a partir das linhas de `CalculoAtvImpressao`
 * (há normalmente 2 linhas por plano — chapas/vias). Para cada `codPlano`,
 * pega o MAX de `coresF`/`coresV` e OR do `tiraRetira`. Retorna um mapa
 * `codPlano(string) → { coresF, coresV, tiraRetira }`. Função PURA.
 */
export function agregarCoresPorPlano(
  linhas: CoresPlanoRow[],
): Map<string, { coresF: number; coresV: number; tiraRetira: boolean }> {
  const mapa = new Map<string, { coresF: number; coresV: number; tiraRetira: boolean }>()
  for (const l of linhas) {
    if (l.codPlano == null) continue
    const chave = String(l.codPlano)
    const atual = mapa.get(chave) ?? { coresF: 0, coresV: 0, tiraRetira: false }
    atual.coresF = Math.max(atual.coresF, num(l.coresF))
    atual.coresV = Math.max(atual.coresV, num(l.coresV))
    if (num(l.tiraRetira) > 0) atual.tiraRetira = true
    mapa.set(chave, atual)
  }
  return mapa
}

/**
 * Monta os `PlanoDTO` a partir dos planos (`CalculoPlanos`) + cores agregadas
 * (`CalculoAtvImpressao`). Regras (paridade com o importador de PDF):
 *  - cores exibidas = "coresF x coresV" (ex.: "2x0", "7x5");
 *  - RETIRAÇÃO quando `coresV > 0` OU `tiraRetira` → marca `retiracao=true`,
 *    `coresFrente`/`coresVerso` separados (o backend cria 2 FACES);
 *  - tipo 'FACE' quando retiração; senão 'COMPONENTE';
 *  - formato = "dimensao1 x dimensao2" do plano.
 *
 * Retorna `undefined` quando NÃO deve materializar planos (0 ou 1 plano SEM
 * retiração) — paridade com o PDF (plano único = legado; o backend não cria
 * `PlanoOrdemProducao`). Função PURA.
 */
export function montarPlanosDTO(
  planos: PlanoRow[],
  coresPorPlano: Map<string, { coresF: number; coresV: number; tiraRetira: boolean }>,
): PlanoDTO[] | undefined {
  if (planos.length === 0) return undefined

  const dtos: PlanoDTO[] = planos.map((p, i) => {
    const codPlano = p.codPlano != null ? String(p.codPlano) : ''
    const cores = coresPorPlano.get(codPlano)
    const coresF = cores?.coresF ?? 0
    const coresV = cores?.coresV ?? 0
    const retiracao = coresV > 0 || !!cores?.tiraRetira
    const d1 = num(p.dimensao1)
    const d2 = num(p.dimensao2)
    const formato = d1 > 0 || d2 > 0 ? `${d1}x${d2}` : undefined
    return {
      nome: (p.nomePlano ?? '').trim() || `Plano ${i + 1}`,
      tipo: retiracao ? 'FACE' : 'COMPONENTE',
      formato,
      cores: `${coresF}x${coresV}`,
      tiragem: p.tiragem != null ? num(p.tiragem) : undefined,
      material: (p.suporteNome ?? '').trim() || undefined,
      gramatura: p.gramatura != null ? num(p.gramatura) : undefined,
      aproveitamento: p.aproveitamento != null ? num(p.aproveitamento) : undefined,
      retiracao: retiracao || undefined,
      coresFrente: retiracao ? `${coresF}x0` : undefined,
      coresVerso: retiracao ? `${coresV}x0` : undefined,
      sequencia: p.Ordem != null ? num(p.Ordem) : i + 1,
    }
  })

  // Paridade PDF: só materializa com 2+ planos OU algum com retiração.
  const temRetiracao = dtos.some((d) => d.retiracao)
  if (dtos.length < 2 && !temRetiracao) return undefined
  return dtos
}

/**
 * Monta o texto resumido das tintas para a tag [Cores] (decisão 2 — tintas NÃO
 * viram item). Ex.: "AMARELO 123C (85%), VERDE CW0138 (15%)". Normaliza o
 * ComplementoNome (remove " - " para ficar "AMARELO 123C"). '' quando vazio.
 */
export function montarTextoTintas(tintas: TintaRow[]): string {
  const partes: string[] = []
  for (const t of tintas) {
    const nome = (t.ComplementoNome ?? '').replace(/\s*-\s*/g, ' ').trim()
    const base = nome || (t.codTinta != null ? `Tinta ${t.codTinta}` : 'Tinta')
    const area = t.areaTinta != null && Number.isFinite(Number(t.areaTinta)) ? ` (${num(t.areaTinta)}%)` : ''
    partes.push(`${base}${area}`)
  }
  return partes.join(', ')
}
