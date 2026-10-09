// Serviço de item do Orçamento Gráfico (multi-item) — ENVELOPE do motor puro.
//
// TASK 4 (spec orcamento-grafico-multi-item-gcad §2.3/§4): este serviço
// CENTRALIZA a lógica que hoje vive INLINE nas rotas (`POST /` e `/calcular`
// de `orcamento-grafico.routes.ts`) para:
//   1. resolver, por `empresaId` (SEMPRE multi-tenant explícito), os cadastros
//      necessários a partir dos ids do input (tipo de embalagem, papel/suporte,
//      máquina de impressão, acabamentos ricos, tabela de margem, perdas); e
//   2. montar o objeto `ParamsOrcamento` EXATAMENTE como as rotas fazem hoje; e
//   3. chamar o motor existente `calcularOrcamentoGrafico` UMA vez por item.
//
// O objetivo é ter uma função reutilizável para o fluxo multi-item (um item por
// vez) SEM reescrever o motor. O motor puro
// `orcamento-grafico-calculo.service.ts` permanece INALTERADO — aqui ele é
// apenas consumido.
//
// NÃO-REGRESSÃO: a lógica abaixo é equivalente à inline das rotas (reaproveitada,
// não reinventada). A rota NÃO é alterada nesta task (isso é a Task 5); por ora a
// lógica fica duplicada aqui de propósito, para manter a suíte atual verde. Na
// Task 5 a rota passa a importar `montarParamsDoItem`/`calcularItem`/
// `montarAcabamentosRicos` deste serviço.
//
// Pontos de injeção de GCad (Task 10), restrições (Task 15) e seletor de máquina
// novo (Task 18) NÃO são adicionados aqui — a Task 4 só extrai o que já existe.
// O `maquinaId` opcional do input já é aceito porque a rota já o aceita hoje.

import { prisma } from '../../lib/prisma'
import {
  calcularOrcamentoGrafico,
  type ParamsOrcamento,
  type ResultadoOrcamento,
} from './orcamento-grafico-calculo.service'

// ============================================================================
// TIPOS DO INPUT
// ============================================================================

/** Cor de impressão informada no input do item (igual ao schema das rotas). */
export interface CorInput {
  nome: string
  tipo: 'CMYK' | 'PANTONE'
  coberturaPercent: number
  precoKg: number
  rendimentoM2Kg: number
}

/** Acabamento LEGADO informado no input do item (igual ao schema das rotas). */
export interface AcabamentoLegadoInput {
  tipo: string
  custoHora: number
  velocidade: number
  setupMinutos: number
  custoMaterialM2?: number
  custoMaterialUn?: number
}

/**
 * Acabamento RICO no input do item. Pode:
 *  - referenciar um `AcabamentoGrafico` do cadastro (`acabamentoId`) — o serviço
 *    resolve natureza/custos/centro; e/ou
 *  - trazer overrides do próprio orçamento (consumo de material, tempos).
 * Campos de override têm precedência sobre o cadastro.
 *
 * Espelha o `acabamentoRicoRequestSchema` das rotas (após o parse/coerce do Zod,
 * os valores já chegam como `number`).
 */
export interface AcabamentoRicoInput {
  acabamentoId?: string
  restricaoAcabamentoId?: string
  nome?: string
  naturezaCusto?: 'HORA_MAQUINA' | 'MATERIAL_KG' | 'MATERIAL_UN' | 'CUSTO_FIXO'
  variavelKg?: number
  precoKg?: number
  variavelUn?: number
  precoUn?: number
  valorFixo?: number
  custoHora?: number
  producaoHora?: number
  unidadeBase?: 'FOLHA' | 'PRODUTO'
  quantAcertos?: number
  tempoPorAcertoMin?: number
  tempoPrimeiroAcertoMin?: number
  tempoFixoHoras?: number
  tempoVarHoras?: number
}

/**
 * Input para montar/calcular UM item do orçamento. Reúne os parâmetros que hoje
 * chegam no body de `POST /` e `/calcular`. Os campos de paridade Calcgraf são
 * todos opcionais/aditivos (quando ausentes, o motor produz o resultado legado).
 */
export interface ItemOrcamentoInput {
  tipoEmbalagemId: string
  medidas: Record<string, number>

  /** Papel/suporte do item (resolve coefTinta via PrecoMateriaPrima→SuporteGrafico). */
  papelId?: string | null
  gramatura: number
  /** Preço do papel por kg. Aceita o alias `precoKg` (como o wizard envia). */
  precoKgPapel?: number
  precoKg?: number

  /** Máquina de impressão (quando ausente, usa a 1ª IMPRESSAO ativa — legado). */
  maquinaId?: string | null

  /** Override do aproveitamento (peças/folha) — imposição real da faca. */
  aproveitamentoManual?: number

  /**
   * Matriz de impressão (Req 10 — Task 19). Quando presente e `quantidade > 0`,
   * o custo `quantidade × precoUnitario` entra no MATERIAL DIRETO como CUSTO FIXO
   * por ocorrência (NÃO escala com a tiragem). Implementação: vira um item em
   * `itensDiversos` (`{ descricao: 'Matriz de Impressão', valor }`) passado ao
   * motor — o motor soma cada item diverso como valor fixo no MD. Ausente → MD
   * idêntico ao legado (não-regressão).
   */
  matriz?: { quantidade: number; precoUnitario: number }

  /**
   * Modo de cálculo da tinta (Req 11 — Task 19).
   *  - COBERTURA (ou ausente): comportamento ATUAL — SPANKS via `coefTintaSuporte`
   *    (quando resolvido) ou o modelo legado por cobertura. NADA muda.
   *  - CONSUMO_DIRETO: o consumo é informado diretamente (`consumoKg × precoKg`),
   *    SEM SPANKS/cobertura. Ver `montarParamsDoItem` para a estratégia de
   *    injeção (zera cobertura das cores + não resolve coefTinta + adiciona o
   *    custo como item diverso no MD), preservando o nº de cores para o CT.
   */
  tinta?: { modo: 'COBERTURA' } | { modo: 'CONSUMO_DIRETO'; consumoKg: number; precoKg: number }

  /**
   * Modelo/Faca do catálogo GCad (Task 10 — ponto de injeção do encaixe real).
   * Quando presente, o serviço carrega o `ModeloFaca` por `{ id, empresaId }` e
   * injeta a imposição real (poses/folha = linhas × colunas), o formato de corte
   * (folha) e o suporte do modelo (precedência sobre o do item) nos params ANTES
   * de calcular. Ausente/nulo → comportamento 100% legado (encaixe geométrico).
   */
  modeloFacaId?: string | null

  cores: CorInput[]
  acabamentos?: AcabamentoLegadoInput[]
  acabamentosRicos?: AcabamentoRicoInput[]

  quantidade: number

  /** Tabela de margem (quando ausente, usa o default legado 15/5/5/30). */
  tabelaMargemId?: string | null

  // ── Paridade Calcgraf (opcionais/aditivos) ───────────────────────────────
  servicosExternos?: Array<{ descricao: string; valor: number }>
  itensDiversos?: Array<{ descricao: string; valor: number }>
  itensFornecidos?: Array<{ descricao: string; valor: number }>
  creditosFiscais?: number
  encargoFinanceiroPerc?: number
  cev?: { icms: number; juros: number; pisCofins: number; comissoes: number }
}

/** Erro de regra de negócio ao montar os params (ex.: cadastro ausente). */
export class ItemOrcamentoError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message)
    this.name = 'ItemOrcamentoError'
  }
}

// ============================================================================
// HELPERS DE RESOLUÇÃO DE CADASTRO (multi-tenant explícito por empresaId)
// ============================================================================

/**
 * Extrai os parâmetros customizados (com defaults) de um TipoEmbalagem para o
 * motor de cálculo. Sem os defaults (ex.: FUNDO/DOBRA da SACOLA), fórmulas que
 * os referenciam quebram o avaliador.
 */
export function parametrosDoTipo(
  tipo: { parametros: unknown },
): Array<{ nome: string; default?: number }> | undefined {
  if (!Array.isArray(tipo.parametros)) return undefined
  return (tipo.parametros as any[]).map((p) => ({
    nome: String(p?.nome ?? ''),
    default: typeof p?.default === 'number' ? p.default : undefined,
  }))
}

/**
 * Resolve o coefTinta do suporte vinculado ao papel (via
 * PrecoMateriaPrima.suporteId → SuporteGrafico.coefTinta). Retorna undefined se
 * não houver vínculo (motor cai no modelo legado de tinta). Multi-tenant.
 */
export async function resolverCoefTintaSuporte(
  empresaId: string,
  papelId: string | undefined | null,
): Promise<number | undefined> {
  if (!papelId) return undefined
  const papel = await prisma.precoMateriaPrima.findFirst({
    where: { id: papelId, empresaId },
    select: { suporteId: true },
  })
  const suporteId = (papel as { suporteId?: string | null } | null)?.suporteId
  if (!suporteId) return undefined
  const suporte = await prisma.suporteGrafico.findFirst({
    where: { id: suporteId, empresaId },
    select: { coefTinta: true, status: true },
  })
  if (!suporte || !suporte.status) return undefined
  const coef = Number(suporte.coefTinta)
  return coef > 0 ? coef : undefined
}

/**
 * Resolve o coefTinta diretamente a partir de um `suporteId` (SuporteGrafico).
 * Usado pelo ponto de injeção do GCad (Task 10): quando o Modelo tem suporte
 * próprio, ele tem PRECEDÊNCIA sobre o papel/suporte do item na resolução do
 * coefTinta (Req 6.1 — suporte do modelo). Retorna undefined quando o suporte
 * não existe, está inativo ou tem coefTinta ≤ 0 (motor cai no modelo legado de
 * tinta). Multi-tenant.
 */
export async function resolverCoefTintaPorSuporteId(
  empresaId: string,
  suporteId: string | undefined | null,
): Promise<number | undefined> {
  if (!suporteId) return undefined
  const suporte = await prisma.suporteGrafico.findFirst({
    where: { id: suporteId, empresaId },
    select: { coefTinta: true, status: true },
  })
  if (!suporte || !suporte.status) return undefined
  const coef = Number(suporte.coefTinta)
  return coef > 0 ? coef : undefined
}

/** Lê o parâmetro de partida de consumo de tinta (kg) da empresa (default 0,2). */
export async function resolverPartidaConsumoTinta(empresaId: string): Promise<number> {
  const p = await prisma.parametro.findFirst({
    where: { empresaId, chave: 'orcamento.partidaConsumoTintaKg' },
    select: { valor: true },
  })
  const v = p ? Number(p.valor) : NaN
  return Number.isFinite(v) && v > 0 ? v : 0.2
}

/**
 * Resolve os itens de acabamento rico do input para o formato que o motor
 * (`ItemAcabamentoRico`) espera, buscando o cadastro `AcabamentoGrafico` por id
 * (quando informado) e aplicando overrides do orçamento por cima. Multi-tenant.
 */
export async function montarAcabamentosRicos(
  empresaId: string,
  itens: AcabamentoRicoInput[] | undefined,
): Promise<any[]> {
  if (!itens || itens.length === 0) return []

  const ids = itens.map((i) => i.acabamentoId).filter((x): x is string => !!x)
  const cadastros = ids.length
    ? await prisma.acabamentoGrafico.findMany({ where: { empresaId, id: { in: ids } } })
    : []
  const porId = new Map(cadastros.map((c) => [c.id, c]))

  // Req 7.4 — restrições selecionadas sobrepõem acerto/operação no CT. Carrega
  // todas as restrições necessárias de uma vez (multi-tenant explícito).
  const restricaoIds = itens.map((i) => i.restricaoAcabamentoId).filter((x): x is string => !!x)
  const restricoes = restricaoIds.length
    ? await prisma.restricaoAcabamento.findMany({ where: { empresaId, id: { in: restricaoIds } } })
    : []
  const restricaoPorId = new Map(restricoes.map((r) => [r.id, r]))

  const num = (v: unknown): number | undefined => (v == null ? undefined : Number(v))

  const resolvidos: any[] = []
  for (const it of itens) {
    const cad = it.acabamentoId ? porId.get(it.acabamentoId) : undefined
    const natureza = it.naturezaCusto ?? (cad?.naturezaCusto as string | undefined) ?? 'HORA_MAQUINA'
    const nome = it.nome ?? cad?.nome ?? 'Acabamento'

    if (natureza === 'MATERIAL_KG') {
      resolvidos.push({
        naturezaCusto: 'MATERIAL_KG',
        nome,
        variavelKg: it.variavelKg ?? 0,
        precoKg: it.precoKg ?? num(cad?.precoUnitario) ?? 0,
      })
    } else if (natureza === 'MATERIAL_UN') {
      resolvidos.push({
        naturezaCusto: 'MATERIAL_UN',
        nome,
        variavelUn: it.variavelUn ?? 0,
        precoUn: it.precoUn ?? num(cad?.precoUnitario) ?? 0,
      })
    } else if (natureza === 'CUSTO_FIXO') {
      resolvidos.push({
        naturezaCusto: 'CUSTO_FIXO',
        nome,
        valorFixo: it.valorFixo ?? num(cad?.precoUnitario) ?? 0,
      })
    } else {
      // HORA_MAQUINA — custo/produção/tempos do override OU do cadastro.
      const acab: any = {
        naturezaCusto: 'HORA_MAQUINA',
        nome,
        custoHora: it.custoHora ?? num(cad?.custoHora) ?? 0,
        producaoHora: it.producaoHora ?? num(cad?.producaoHora),
        unidadeBase: it.unidadeBase ?? (cad?.unidadeBase as 'FOLHA' | 'PRODUTO' | undefined),
        quantAcertos: it.quantAcertos ?? num(cad?.quantAcertos),
        tempoPorAcertoMin: it.tempoPorAcertoMin ?? num(cad?.tempoPorAcertoMin),
        tempoPrimeiroAcertoMin: it.tempoPrimeiroAcertoMin ?? num(cad?.tempoPrimeiroAcertoMin),
        tempoFixoHoras: it.tempoFixoHoras,
        tempoVarHoras: it.tempoVarHoras,
      }
      // Req 7.4 — restrição selecionada sobrepõe acerto/operação no CT.
      if (it.restricaoAcabamentoId) {
        const r = restricaoPorId.get(it.restricaoAcabamentoId)
        if (r) {
          const acertoMin = Number(r.tempoAcertoMin)
          acab.tempoPrimeiroAcertoMin = acertoMin
          acab.tempoPorAcertoMin = acertoMin
          acab.tempoVarHoras = Number(r.tempoOperacaoMin) / 60
        }
      }
      resolvidos.push(acab)
    }
  }
  return resolvidos
}

/**
 * Valida as pré-condições de cálculo de orçamento ANTES de calcular (defesa em
 * profundidade). Multi-tenant. Retorna uma mensagem de bloqueio quando alguma
 * pré-condição falha, ou undefined quando o cálculo pode prosseguir.
 *
 * Req 2.4: quando o papel aponta para um Suporte (PrecoMateriaPrima.suporteId →
 * SuporteGrafico), esse Suporte precisa ter ao menos um PrecoMateriaPrima de
 * tipo PAPEL (ativo) vinculado. Papel sem suporteId NÃO bloqueia (legado).
 *
 * Req 5.4: precisa existir ao menos um ParametroPerda para a empresa.
 */
export async function validarPreCondicoesCalculo(
  empresaId: string,
  papelId: string | undefined | null,
): Promise<string | undefined> {
  // Req 2.4 — Suporte sem preço PAPEL vinculado.
  if (papelId) {
    const papel = await prisma.precoMateriaPrima.findFirst({
      where: { id: papelId, empresaId },
      select: { suporteId: true },
    })
    const suporteId = (papel as { suporteId?: string | null } | null)?.suporteId
    if (suporteId) {
      const precoPapelDoSuporte = await prisma.precoMateriaPrima.findFirst({
        where: { empresaId, suporteId, tipo: 'PAPEL', status: true },
        select: { id: true },
      })
      if (!precoPapelDoSuporte) {
        return 'Suporte sem preço de material vinculado — vincule um preço ao suporte antes de calcular'
      }
    }
  }

  // Req 5.4 — Nenhum ParametroPerda cadastrado para a empresa.
  const totalPerdas = await prisma.parametroPerda.count({ where: { empresaId } })
  if (totalPerdas === 0) {
    return 'Nenhum Parâmetro de Perda cadastrado — cadastre a perda do processo antes de calcular'
  }

  return undefined
}

// ============================================================================
// MONTAGEM DOS PARAMS DO ITEM (equivalente à lógica inline das rotas)
// ============================================================================

/**
 * Resolve os cadastros do item (por `empresaId`, multi-tenant explícito) e monta
 * o `ParamsOrcamento` EXATAMENTE como as rotas `POST /` e `/calcular` fazem hoje.
 *
 * Reaproveita a mesma lógica — NÃO inventa fórmula nova: a meta é centralizar o
 * comportamento atual (não-regressão). Lança `ItemOrcamentoError` quando uma
 * pré-condição falha (papel/perda/tipo/máquina), com `statusCode` apropriado
 * para a rota mapear (a rota segue inalterada nesta task).
 */
export async function montarParamsDoItem(
  empresaId: string,
  input: ItemOrcamentoInput,
): Promise<ParamsOrcamento> {
  const precoKgPapel = input.precoKgPapel ?? input.precoKg
  if (!precoKgPapel) {
    throw new ItemOrcamentoError('Preço do papel (precoKgPapel ou precoKg) é obrigatório', 400)
  }

  // Pré-condições de cálculo (Req 2.4 e 5.4) — defesa em profundidade.
  const bloqueio = await validarPreCondicoesCalculo(empresaId, input.papelId)
  if (bloqueio) throw new ItemOrcamentoError(bloqueio, 400)

  // Buscar tipo de embalagem
  const tipo = await prisma.tipoEmbalagem.findFirst({
    where: { id: input.tipoEmbalagemId, empresaId },
  })
  if (!tipo) throw new ItemOrcamentoError('Tipo de embalagem não encontrado', 404)

  // Buscar máquina (específica OU primeira de impressão da empresa como default).
  let maquina: any = null
  if (input.maquinaId) {
    maquina = await prisma.centroProducao.findFirst({
      where: { id: input.maquinaId, empresaId },
    })
  }
  if (!maquina) {
    maquina = await prisma.centroProducao.findFirst({
      where: { empresaId, status: true, tipoProcesso: { codigo: 'IMPRESSAO' } },
      orderBy: { posicao: 'asc' },
    })
  }
  if (!maquina) {
    throw new ItemOrcamentoError(
      'Nenhuma máquina de impressão encontrada. Cadastre um Centro de Produção do tipo Impressão.',
      404,
    )
  }

  // Buscar tabela de margem (ou usar default legado).
  let margem = { impostos: 15, comissao: 5, despAdm: 5, markup: 30 }
  if (input.tabelaMargemId) {
    const tabela = await prisma.tabelaMargem.findFirst({
      where: { id: input.tabelaMargemId, empresaId },
    })
    if (tabela) {
      margem = {
        impostos: Number(tabela.impostos),
        comissao: Number(tabela.comissao),
        despAdm: Number(tabela.despAdm),
        markup: Number(tabela.markup),
      }
    }
  }

  // Buscar perdas (parâmetro geral = sem centroProducaoId).
  const perdasParam = await prisma.parametroPerda.findMany({ where: { empresaId } })
  const perdaImpressao = perdasParam.find((p) => !p.centroProducaoId)
  const perdas = {
    impressaoPercent: perdaImpressao ? Number(perdaImpressao.perdaVariavel) : 5,
    impressaoFixaFolhas: perdaImpressao ? perdaImpressao.perdaFixaFolhas : 50,
    corteVincoPercent: 3,
    colagemPercent: 2,
  }

  // Paridade Calcgraf: parâmetros calibrados (acerto por cor / setup da máquina;
  // coefTinta do suporte do papel; partida de consumo de tinta). Quando
  // presentes, o motor usa os modelos SPANKS/acerto-por-cor; senão, legado.
  const acertoPorCorMin = maquina.acertoPorCorMin != null ? Number(maquina.acertoPorCorMin) : undefined
  const tempoSetupMin = maquina.tempoSetupMin != null ? Number(maquina.tempoSetupMin) : undefined
  const partidaConsumoTintaKg = await resolverPartidaConsumoTinta(empresaId)

  // ── Req 11 (Task 19): tinta por COBERTURA vs CONSUMO_DIRETO ────────────────
  // No modo CONSUMO_DIRETO o consumo de tinta é INFORMADO (consumoKg × precoKg),
  // sem SPANKS e sem cálculo por cobertura. Para refletir isso no MD SEM
  // reescrever o motor, e PRESERVANDO o nº de cores (que alimenta o acerto por
  // cor / CT da impressão), fazemos:
  //   (a) NÃO resolver o coefTintaSuporte (deixa `undefined`) → o motor NÃO entra
  //       no caminho SPANKS; cai no modelo legado de tinta por cobertura; e
  //   (b) passar as `cores` com `coberturaPercent = 0` → o modelo legado produz
  //       custo de tinta por cobertura = 0 (anula a tinta "automática"); e
  //   (c) somar o custo da tinta direto `consumoKg × precoKg` como um item em
  //       `itensDiversos` (entra como valor fixo no MD).
  // Assim o MD reflete exatamente o consumo direto e o CT continua usando o
  // número de cores informado (cores.length / numCoresImpressao). No modo
  // COBERTURA (ou ausente) nada disso acontece — comportamento 100% legado.
  const tintaConsumoDireto = input.tinta?.modo === 'CONSUMO_DIRETO' ? input.tinta : undefined

  const coresParaMotor: CorInput[] = tintaConsumoDireto
    ? input.cores.map((c) => ({ ...c, coberturaPercent: 0 }))
    : input.cores

  const coefTintaSuporte = tintaConsumoDireto
    ? undefined
    : await resolverCoefTintaSuporte(empresaId, input.papelId)

  const acabamentosRicosResolvidos = await montarAcabamentosRicos(empresaId, input.acabamentosRicos)

  // ── Req 10 (Task 19): matriz de impressão + Req 11 tinta direto no MD ───────
  // Monta a lista combinada de itens diversos: os do input MAIS a matriz (quando
  // houver) MAIS a tinta de consumo direto (quando o modo for CONSUMO_DIRETO).
  // Cada item entra no motor como valor FIXO somado ao Material Direto (não
  // escala com a tiragem). Sem matriz e sem tinta direto → lista idêntica à do
  // input (não-regressão: MD inalterado).
  const itensDiversosCombinados: Array<{ descricao: string; valor: number }> = [
    ...(input.itensDiversos ?? []),
  ]
  if (input.matriz && input.matriz.quantidade > 0) {
    itensDiversosCombinados.push({
      descricao: 'Matriz de Impressão',
      valor: input.matriz.quantidade * input.matriz.precoUnitario,
    })
  }
  if (tintaConsumoDireto) {
    itensDiversosCombinados.push({
      descricao: 'Tinta (consumo direto)',
      valor: tintaConsumoDireto.consumoKg * tintaConsumoDireto.precoKg,
    })
  }

  const params: ParamsOrcamento = {
    tipoEmbalagem: {
      parametros: parametrosDoTipo(tipo),
      formulaLargura: tipo.formulaLargura,
      formulaAltura: tipo.formulaAltura,
      abaColagemMm: Number(tipo.abaColagemMm),
      sangriaMm: Number(tipo.sangriaMm),
      pincaMm: Number(tipo.pincaMm),
    },
    medidas: input.medidas,
    papel: { gramatura: input.gramatura, precoKg: precoKgPapel },
    maquinaImpressao: {
      velocidade: Number(maquina.velocidade) || 6000,
      custoHora: Number(maquina.custoHora) || 250,
      formatoLargura: maquina.formatoFolhaLargura || 660,
      formatoAltura: maquina.formatoFolhaAltura || 960,
      pinca: Number(maquina.pincaMm) || 10,
      // setup: usa o cadastrado (tempoSetupMin) quando houver; senão 30 (legado)
      setupMinutos: tempoSetupMin ?? 30,
      acertoPorCorMin,
      // Nº de cores preservado SEMPRE do input (mesmo no CONSUMO_DIRETO, onde a
      // cobertura das cores é zerada) — alimenta o acerto por cor / CT.
      numCoresImpressao: input.cores.length || undefined,
    },
    cores: coresParaMotor,
    // Combina acabamentos LEGADOS com os RICOS (resolvidos do cadastro).
    acabamentos: [
      ...(input.acabamentos ?? []),
      ...acabamentosRicosResolvidos,
    ],
    quantidade: input.quantidade,
    perdas,
    margem,
    coefTintaSuporte,
    partidaConsumoTintaKg,
    aproveitamentoManual: input.aproveitamentoManual,
    // paridade Calcgraf (repassados quando informados)
    servicosExternos: input.servicosExternos,
    // Lista combinada: itens diversos do input + matriz (Req 10) + tinta direto
    // (Req 11). Quando vazia, passa `undefined` para não alterar o MD legado.
    itensDiversos: itensDiversosCombinados.length > 0 ? itensDiversosCombinados : undefined,
    itensFornecidos: input.itensFornecidos,
    creditosFiscais: input.creditosFiscais,
    encargoFinanceiroPerc: input.encargoFinanceiroPerc,
    cev: input.cev,
  }

  // ── Task 10: ponto de injeção do encaixe REAL do modelo GCad ───────────────
  // SEM modeloFacaId: nada acontece aqui → comportamento 100% legado (encaixe
  // geométrico), resultado idêntico ao motor puro congelado (Req 6.4, Prop 2).
  // COM modeloFacaId: injeta a imposição real sem reescrever o motor —
  // `aproveitamentoManual` já curto-circuita o encaixe geométrico no motor.
  if (input.modeloFacaId) {
    const modelo = await prisma.modeloFaca.findFirst({
      where: { id: input.modeloFacaId, empresaId },
    })
    if (!modelo) throw new ItemOrcamentoError('Modelo (GCad) não encontrado', 404)

    const linhas = Number(modelo.repeticaoLinhas)
    const colunas = Number(modelo.repeticaoColunas)
    // Req 6.7 — encaixe inválido rejeitado ANTES de montar/calcular; preserva estado.
    if (!(linhas >= 1) || !(colunas >= 1)) {
      throw new ItemOrcamentoError(
        'Encaixe do modelo inválido: linhas/colunas devem ser ≥ 1',
        400,
      )
    }

    // Poses por folha = linhas × colunas (Req 6.3/6.5). Curto-circuita o encaixe
    // geométrico no motor via `aproveitamentoManual` (ponto de injeção existente).
    params.aproveitamentoManual = linhas * colunas

    // Formato de corte = folha usada pelo encaixe/suporte (Req 6.1). Sobrescreve
    // apenas o formato da folha da máquina (o aproveitamentoManual já determina as
    // folhas; o formato alimenta o peso de papel/consumo de suporte).
    const corteLargura = Number(modelo.formatoCorteLarguraMm)
    const corteAltura = Number(modelo.formatoCorteAlturaMm)
    if (corteLargura > 0) params.maquinaImpressao.formatoLargura = corteLargura
    if (corteAltura > 0) params.maquinaImpressao.formatoAltura = corteAltura

    // Suporte do modelo tem PRECEDÊNCIA sobre o papel/suporte do item na
    // resolução do coefTinta (Req 6.1 — suporte do modelo).
    if (modelo.suporteId) {
      const coefModelo = await resolverCoefTintaPorSuporteId(empresaId, modelo.suporteId)
      if (coefModelo !== undefined) params.coefTintaSuporte = coefModelo
    }

    // Opcional: gramatura do modelo quando o item NÃO informou (não sobrescreve o
    // que o usuário informou).
    if (modelo.gramatura != null && !(input.gramatura > 0)) {
      params.papel.gramatura = Number(modelo.gramatura)
    }
  }

  return params
}

/**
 * Monta os `ParamsOrcamento` do item e calcula esse item UMA vez via o motor
 * existente `calcularOrcamentoGrafico`. É a função reutilizável do fluxo
 * multi-item (um item por vez). Multi-tenant por `empresaId`.
 */
export async function calcularItem(
  empresaId: string,
  input: ItemOrcamentoInput,
): Promise<ResultadoOrcamento> {
  const params = await montarParamsDoItem(empresaId, input)
  return calcularOrcamentoGrafico(params)
}
