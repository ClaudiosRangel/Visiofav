// Montagem da estrutura do RELATÓRIO de orçamento gráfico (paridade com o
// pré-cálculo do Calcgraf). Serviço PURO: recebe o resultado do cálculo + dados
// do orçamento e devolve as seções na ordem do golden (ver
// docs/calcgraf-golden-15235-acabamentos.md). Consumido pela rota
// GET /:id/relatorio e pelo gerador de PDF.

import type { ResultadoOrcamento } from './orcamento-grafico-calculo.service'
import { rotuloTrocaSuporte } from './troca-suporte.service'

export interface RelatorioSecaoLinha {
  item: string
  unidade?: string
  fixo?: number
  variavel?: number
  unitario?: number
  subtotal: number
}

export interface RelatorioMargem {
  markupPerc: number
  margemValor: number
  cmPerc: number
  cmValor: number
  precoUnitario: number
  precoTotal: number
  /**
   * Layout fiel (Task 26, §4.5/Req 12.9): preço do primeiro milheiro e do
   * milheiro seguinte derivados por gross-up do modelo de precificação por
   * tiragem. OPCIONAIS/aditivos — quando os dados de tiragem não forem
   * suficientes (ou o caller não os fornecer) os sub-objetos ficam `undefined`
   * e o layout legado segue idêntico. Ver `montarRelatorio` para a derivação.
   */
  primeiroMil?: { precoUnitario: number; precoTotal: number }
  milSeguinte?: { precoUnitario: number; precoTotal: number }
}

/**
 * Bloco por plano no relatório (Req 5.6 — versão simples desta fase). Um item
 * com planos gera um bloco por plano; um item SEM planos gera um bloco único
 * implícito (caminho legado). O layout fiel completo (ocorrências/cores/formato/
 * seções detalhadas) é da Fase 5 (Task 26) — aqui bastam os 3 custos derivados
 * do `ResultadoOrcamento` de cada plano.
 */
export interface RelatorioPlanoBloco {
  sequencia: number
  nome: string
  /** Suporte = papel (bloco `papel.custo` do ResultadoOrcamento). */
  custoSuporte: number
  /** Impressão = máquinas de impressão + tinta (`maquinas.custoTotal + tinta.custoTotal`). */
  custoImpressao: number
  /** Acabamento = acabamentos + cadeia de centros de acabamento (quando houver). */
  custoAcabamento: number
  /**
   * Sinalização de troca de suporte orçado → produção (Task 17, Req 7.2).
   * Derivado por `rotuloTrocaSuporte` a partir dos nomes/ids do suporte orçado e
   * de produção do plano/item. `null`/ausente quando não houve troca OU quando os
   * dados de suporte não foram fornecidos pelo caller (compatibilidade — Req 7.1/7.5).
   * Quando há troca: "Suporte alterado na produção: {orçado} → {real}".
   */
  trocaSuporte?: string | null

  // ── Layout fiel ao pré-cálculo (Task 26, §4.5/Req 12.3) — campos descritivos ──
  // TODOS opcionais/aditivos: preenchidos a partir de `DadosRelatorio.planos[].*`
  // quando fornecidos; ausentes → omitidos (callers atuais inalterados).
  ocorrencias?: number
  cores?: string
  formato?: string
  repeticao?: string
  tr?: number
  corte?: string
  aprovacao?: string
  tiragem?: number
  impressao?: string
  producaoHora?: number
  quebraPerc?: number
  aparaPerc?: number

  // ── Seções detalhadas por plano (Task 26, §4.5/Req 12.4/12.5) ──
  // Derivadas do `resultadoCalculo` do plano via `montarSecoesDoResultado`.
  // Opcionais/aditivas: só presentes no layout fiel; ausentes no caminho legado.
  suporte?: RelatorioSecaoLinha[]
  matrizImpressao?: RelatorioSecaoLinha[]
  tinta?: RelatorioSecaoLinha[]
  matAcabamento?: RelatorioSecaoLinha[]
  impressao?: RelatorioSecaoLinha[]
  acabamento?: RelatorioSecaoLinha[]
}

export interface RelatorioOrcamento {
  cabecalho: {
    empresa?: string
    data: string
    numero?: string | number
    cliente?: string
    produto?: string
    descricao?: string
    formatoFinal?: string
    quantidade: number
    // ── Layout fiel (Task 26, §4.5/Req 12.2) — todos opcionais/aditivos ──
    contato?: string
    telefone?: string
    codigoAcabado?: string
    excedente?: number
    programacaoEntrega?: Array<{ codigoPedido?: string; quantidade: number; data: string }>
    numeroOpVinculada?: string | number
    serie?: string
  }
  suporte: RelatorioSecaoLinha[]
  matrizImpressao: RelatorioSecaoLinha[]
  tinta: RelatorioSecaoLinha[]
  matAcabamento: RelatorioSecaoLinha[]
  impressao: RelatorioSecaoLinha[]
  acabamento: RelatorioSecaoLinha[]
  custoProducao: {
    materialDireto: number
    custoTransformacao: number
    servicoExterno: number
    custoProducao: number
    encargoFinanceiro: number
    total: number
    // ── Layout fiel (Task 26, §4.5/Req 12.6) — créditos fiscais e taxas ──
    creditoIcms?: number
    creditoIpi?: number
    creditoPisCofins?: number
    taxasProducao?: number
    encargoFinanceiroPerc?: number
  }
  cev: {
    icms?: number
    juros?: number
    pisCofins?: number
    comissoes?: number
    totalPerc: number
    // ── Layout fiel (Task 26, §4.5/Req 12.8) ──
    impostoIpi?: number
  }
  // ── Layout fiel (Task 26, §4.5/Req 12.7/12.8/12.10) — todos opcionais/aditivos ──
  prazos?: {
    producaoDias?: number
    armazenagemDias?: number
    pagamentoDias?: number
    financiamentoDias?: number
    totalDias?: number
  }
  comissoes?: Array<{ vendedor: string; percentual: number }>
  condicoesPagamento?: string
  incluidoPor?: string
  alteradoPor?: string
  margens: RelatorioMargem[]
  /**
   * Blocos por plano (Req 5.6) — SEMPRE presente (aditivo): com um bloco por
   * plano quando o item tem planos, ou com um único bloco implícito derivado do
   * próprio resultado item-único (caminho legado). O layout fiel completo é da
   * Fase 5; aqui é a versão simples (3 custos por plano).
   */
  planos: RelatorioPlanoBloco[]
}

export interface DadosRelatorio {
  resultado: ResultadoOrcamento
  quantidade: number
  cabecalho?: Partial<RelatorioOrcamento['cabecalho']>
  cev?: { icms: number; juros: number; pisCofins: number; comissoes: number; impostoIpi?: number }
  /** Markups a exibir na tabela de margem (default 10/20 + markup do cálculo). */
  markups?: number[]
  encargoFinanceiroPerc?: number

  // ── Layout fiel ao pré-cálculo (Task 26, §4.5) — todos opcionais/aditivos ──
  /**
   * Créditos fiscais e taxas do Custo de Produção (Req 12.6). Preenchidos quando
   * o item/orçamento os fornece; ausentes → omitidos no relatório.
   */
  creditosProducao?: {
    creditoIcms?: number
    creditoIpi?: number
    creditoPisCofins?: number
    taxasProducao?: number
  }
  /** Prazos do pré-cálculo (Req 12.7). */
  prazos?: {
    producaoDias?: number
    armazenagemDias?: number
    pagamentoDias?: number
    financiamentoDias?: number
    totalDias?: number
  }
  /** Comissões por vendedor (Req 12.7). */
  comissoes?: Array<{ vendedor: string; percentual: number }>
  /** Condições de pagamento (Req 12.8). */
  condicoesPagamento?: string
  /** Auditoria do pré-cálculo (Req 12.10). */
  incluidoPor?: string
  alteradoPor?: string
  /**
   * Tiragem do primeiro milheiro para o cálculo de Primeiro Mil / Mil Seguinte
   * (Req 12.9). Default: 1000. O "milheiro seguinte" usa a quantidade total como
   * referência de preço marginal. Quando não há dados suficientes (quantidade ≤ 0),
   * os sub-objetos `primeiroMil`/`milSeguinte` das margens ficam undefined.
   */
  tiragemPrimeiroMilheiro?: number
  /**
   * Planos do item (opcional, aditivo). Quando ausente/vazio, o relatório gera
   * UM bloco implícito único a partir do próprio `resultado` (compatibilidade /
   * caminho legado), com o nome do bloco = `cabecalho.produto` ou "Plano único".
   * Cada plano traz seu próprio `resultadoCalculo` (do motor), do qual os 3
   * custos são derivados. O `default` ausente preserva 100% o comportamento
   * anterior do relatório item-único.
   *
   * Os campos de suporte (`suporteOrcado*`/`suporteProducao*`) são opcionais e
   * aditivos (Task 17): quando fornecidos, o bloco do plano deriva `trocaSuporte`
   * via `rotuloTrocaSuporte`; quando ausentes, `trocaSuporte` fica `null`/omitido
   * (callers atuais que não passam suporte seguem funcionando igual — Req 7.1/7.5).
   */
  planos?: Array<{
    sequencia: number
    nome: string
    resultadoCalculo: ResultadoOrcamento
    suporteOrcadoId?: string | null
    suporteProducaoId?: string | null
    suporteOrcadoNome?: string | null
    suporteProducaoNome?: string | null
    // ── Layout fiel (Task 26, §4.5/Req 12.3) — campos descritivos opcionais ──
    // Quando fornecidos, são copiados para o bloco do plano no relatório; quando
    // ausentes, ficam undefined (sem efeito no caminho legado).
    descritivo?: {
      ocorrencias?: number
      cores?: string
      formato?: string
      repeticao?: string
      tr?: number
      corte?: string
      aprovacao?: string
      tiragem?: number
      impressao?: string
      producaoHora?: number
      quebraPerc?: number
      aparaPerc?: number
    }
  }>
  /**
   * Suporte orçado/produção do ITEM (nível do bloco implícito — item SEM planos),
   * opcional e aditivo (Task 17). Quando fornecidos, o bloco implícito único deriva
   * `trocaSuporte` via `rotuloTrocaSuporte`; quando ausentes, fica `null`/omitido
   * (compatibilidade total com os callers atuais — Req 7.1/7.5).
   */
  suporteOrcadoId?: string | null
  suporteProducaoId?: string | null
  suporteOrcadoNome?: string | null
  suporteProducaoNome?: string | null
}

const r2 = (x: number) => Math.round(x * 100) / 100

/**
 * Deriva os 3 custos de fechamento (Suporte/Impressão/Acabamento) a partir de um
 * `ResultadoOrcamento`, usando os nomes de campo REAIS expostos pelo motor
 * (`orcamento-grafico-calculo.service.ts`). O `ResultadoOrcamento` NÃO expõe
 * `custoSuporte/custoImpressao/custoAcabamento` nominais; derivamos dos blocos:
 *   - Suporte  = `papel.custo`                         (suporte = papel)
 *   - Impressão = `maquinas.custoTotal + tinta.custoTotal`
 *   - Acabamento = `acabamentos.custoTotal + (acabamentosCentros?.custoTotal ?? 0)`
 * Campos ausentes contam como 0. Função PURA.
 */
export function derivarCustosPlano(r: ResultadoOrcamento): {
  custoSuporte: number
  custoImpressao: number
  custoAcabamento: number
} {
  const custoSuporte = r2(r.papel?.custo ?? 0)
  const custoImpressao = r2((r.maquinas?.custoTotal ?? 0) + (r.tinta?.custoTotal ?? 0))
  const custoAcabamento = r2(
    (r.acabamentos?.custoTotal ?? 0) + (r.acabamentosCentros?.custoTotal ?? 0),
  )
  return { custoSuporte, custoImpressao, custoAcabamento }
}

/**
 * Helper PURO reutilizável (Task 26, §4.5): deriva as 6 seções detalhadas
 * (Suporte / Matriz / Tinta / Mat.Acabamento / Impressão / Acabamento) a partir
 * de UM `ResultadoOrcamento` — exatamente a mesma transformação que o relatório
 * já aplicava inline ao `resultado` raiz. É usado tanto no nível raiz
 * (compatibilidade — mantém a estrutura legada do `RelatorioOrcamento`) quanto
 * por plano (layout fiel), para que cada plano tenha suas próprias seções
 * derivadas do seu `resultadoCalculo`. Função pura, sem efeitos colaterais.
 */
export function montarSecoesDoResultado(r: ResultadoOrcamento): {
  suporte: RelatorioSecaoLinha[]
  matrizImpressao: RelatorioSecaoLinha[]
  tinta: RelatorioSecaoLinha[]
  matAcabamento: RelatorioSecaoLinha[]
  impressao: RelatorioSecaoLinha[]
  acabamento: RelatorioSecaoLinha[]
} {
  // Material Direto decompõe em suporte/tinta/matriz/mat.acabamento quando o
  // resultado expõe os blocos; caso contrário, mostra o papel como suporte.
  const suporte: RelatorioSecaoLinha[] = [
    { item: 'Suporte (papel)', unidade: 'KG', subtotal: r.papel.custo },
  ]

  // MAT.ACABAMENTO e MATRIZ: separa os itens de material do bloco matAcabamento.
  const matAcabamento: RelatorioSecaoLinha[] = []
  const matrizImpressao: RelatorioSecaoLinha[] = []
  for (const it of r.matAcabamento?.itens ?? []) {
    const linha: RelatorioSecaoLinha = {
      item: it.nome,
      unidade:
        it.natureza === 'MATERIAL_KG' ? 'KG' : it.natureza === 'MATERIAL_UN' ? 'UN' : undefined,
      fixo: it.fixo || undefined,
      variavel: it.variavel || undefined,
      unitario: it.unitario || undefined,
      subtotal: it.subtotal,
    }
    if (/matriz/i.test(it.nome)) matrizImpressao.push(linha)
    else matAcabamento.push(linha)
  }

  // TINTA: do detalhe por cor (modelo SPANKS/legado) OU dos itensDiversos de
  // tinta (quando modelada como material direto, caso golden 15.235).
  const tinta: RelatorioSecaoLinha[] = (r.tinta?.detalhePorCor ?? [])
    .filter((c) => c.custo > 0)
    .map((c) => ({ item: c.cor, unidade: 'KG', variavel: c.consumoKg, subtotal: c.custo }))

  // IMPRESSÃO
  const impressao: RelatorioSecaoLinha[] = (r.maquinas?.detalhePorEtapa ?? []).map((e) => ({
    item: e.etapa,
    unidade: 'H',
    fixo: r2(e.setupMin / 60),
    variavel: r2(e.operacaoMin / 60),
    subtotal: e.custo,
  }))

  // ACABAMENTO (cadeia de centros no CT)
  const acabamento: RelatorioSecaoLinha[] = (r.acabamentosCentros?.detalhePorEtapa ?? []).map(
    (e) => ({
      item: e.etapa,
      unidade: 'H',
      fixo: r2(e.setupMin / 60),
      variavel: r2(e.operacaoMin / 60),
      subtotal: e.custo,
    }),
  )

  return { suporte, matrizImpressao, tinta, matAcabamento, impressao, acabamento }
}

/**
 * Monta o relatório a partir do resultado do motor. O gross-up das margens usa
 * o mesmo CEV do cálculo; cada markup gera uma linha (preço, margem$, CM%/CM$).
 */
export function montarRelatorio(d: DadosRelatorio): RelatorioOrcamento {
  const { resultado: r, quantidade } = d
  const cevPerc = d.cev
    ? d.cev.icms + d.cev.juros + d.cev.pisCofins + d.cev.comissoes
    : r.cevPerc ?? 0

  // Seções detalhadas do nível raiz (compatibilidade): mesma transformação de
  // sempre, agora extraída para o helper puro reutilizável `montarSecoesDoResultado`
  // (usado também por plano no layout fiel — Task 26).
  const { suporte, matrizImpressao, tinta, matAcabamento, impressao, acabamento } =
    montarSecoesDoResultado(r)

  // Encargo financeiro (diferença entre total e custo de produção).
  const encargoFinanceiro = r2(r.custoTotal - r.custoProducao)

  // Margens: markups informados ou default [10, 20, markup do cálculo].
  const markupCalc = (() => {
    // deduz o markup efetivo do cálculo: preço = custoTotal/(1 − (cev+markup)/100)
    if (r.precoVenda > 0) {
      const fator = 1 - r.custoTotal / r.precoVenda // = (cev+markup)/100
      return r2(fator * 100 - cevPerc)
    }
    return 30
  })()
  const markups = (d.markups ?? [10, 20, markupCalc]).map((m) => r2(m))

  // Tiragem do primeiro milheiro (default 1000) usada no cálculo Primeiro Mil /
  // Mil Seguinte do layout fiel (Req 12.9).
  const tiragemPrimeiroMilheiro = d.tiragemPrimeiroMilheiro ?? 1000

  const margens: RelatorioMargem[] = markups.map((markup) => {
    const divisor = 1 - (cevPerc + markup) / 100
    const precoTotal = divisor > 0 ? r2(r.custoTotal / divisor) : 0
    const precoUnit = quantidade > 0 ? Math.round((precoTotal / quantidade) * 10000) / 10000 : 0
    const margemValor = r2(precoTotal - r.custoTotal)
    const cevValor = r2(precoTotal * (cevPerc / 100))
    const custosVariaveis = r.materialDireto + cevValor
    const cmValor = r2(precoTotal - custosVariaveis)
    const cmPerc = precoTotal > 0 ? r2((cmValor / precoTotal) * 100) : 0

    const margem: RelatorioMargem = {
      markupPerc: markup,
      margemValor,
      cmPerc,
      cmValor,
      precoUnitario: precoUnit,
      precoTotal,
    }

    // ── Primeiro Mil / Mil Seguinte (Task 26, §4.5/Req 12.9) ──
    // Derivação por gross-up do modelo de precificação por tiragem do Calcgraf:
    //   - PRIMEIRO MIL: preço do primeiro milheiro = preço unitário aplicado à
    //     tiragem do primeiro milheiro (gross-up pelo mesmo divisor margem+CEV).
    //   - MIL SEGUINTE: preço marginal do milheiro adicional = preço unitário ×
    //     1000 (custo marginal por milheiro, mesmo gross-up).
    // IMPORTANTE: esta derivação só é possível quando há preço unitário válido
    // (quantidade > 0 e preço > 0). O `ResultadoOrcamento` do motor expõe o custo
    // TOTAL da tiragem, não a decomposição fixo/variável por milheiro; portanto o
    // Primeiro Mil / Mil Seguinte aqui é o preço unitário projetado linearmente
    // sobre a tiragem (aproximação documentada). Quando os dados forem
    // insuficientes (quantidade ≤ 0 ou preço ≤ 0), os sub-objetos ficam undefined
    // e o layout legado segue idêntico (Task 26 — fase 5, pode permanecer undefined).
    if (quantidade > 0 && precoTotal > 0 && precoUnit > 0) {
      const precoPrimeiroMilTotal = r2(precoUnit * tiragemPrimeiroMilheiro)
      const precoMilSeguinteTotal = r2(precoUnit * 1000)
      margem.primeiroMil = {
        precoUnitario: precoUnit,
        precoTotal: precoPrimeiroMilTotal,
      }
      margem.milSeguinte = {
        precoUnitario: precoUnit,
        precoTotal: precoMilSeguinteTotal,
      }
    }

    return margem
  })

  // Blocos por plano (Req 5.6). Com planos: um bloco por plano, ordenado por
  // sequência, cada um com os 3 custos derivados do seu próprio resultado. Sem
  // planos: UM bloco implícito único derivado do resultado item-único (legado),
  // nomeado pelo produto do cabeçalho ou "Plano único".
  const planos: RelatorioPlanoBloco[] =
    d.planos && d.planos.length > 0
      ? [...d.planos]
          .sort((a, b) => a.sequencia - b.sequencia)
          .map((p) => ({
            sequencia: p.sequencia,
            nome: p.nome,
            ...derivarCustosPlano(p.resultadoCalculo),
            // Task 17: sinaliza troca de suporte orçado → produção quando os dados
            // forem fornecidos; sem troca ou sem dados → null (omitido).
            trocaSuporte: rotuloTrocaSuporte(
              p.suporteOrcadoNome ?? '',
              p.suporteProducaoNome ?? '',
              p.suporteOrcadoId,
              p.suporteProducaoId,
            ),
            // Task 26 (§4.5/Req 12.3): campos descritivos opcionais do plano.
            ...(p.descritivo ?? {}),
            // Task 26 (§4.5/Req 12.4/12.5): seções detalhadas do plano, derivadas
            // do seu próprio resultadoCalculo com o MESMO helper do nível raiz.
            ...montarSecoesDoResultado(p.resultadoCalculo),
          }))
      : [
          {
            sequencia: 1,
            nome: d.cabecalho?.produto?.trim() || 'Plano único',
            ...derivarCustosPlano(r),
            // Task 17: troca de suporte do bloco implícito (item sem planos).
            trocaSuporte: rotuloTrocaSuporte(
              d.suporteOrcadoNome ?? '',
              d.suporteProducaoNome ?? '',
              d.suporteOrcadoId,
              d.suporteProducaoId,
            ),
            // Task 26: plano implícito único recebe as mesmas seções detalhadas
            // derivadas do resultado item-único (layout fiel uniforme).
            ...montarSecoesDoResultado(r),
          },
        ]

  return {
    cabecalho: {
      data: new Date().toLocaleDateString('pt-BR'),
      quantidade,
      ...d.cabecalho,
    },
    suporte,
    matrizImpressao,
    tinta,
    matAcabamento,
    impressao,
    acabamento,
    custoProducao: {
      materialDireto: r.materialDireto,
      custoTransformacao: r.custoTransformacao,
      servicoExterno: r.servicoExterno,
      custoProducao: r.custoProducao,
      encargoFinanceiro,
      total: r.custoTotal,
      // Task 26 (§4.5/Req 12.6): créditos fiscais e taxas opcionais; aditivos.
      creditoIcms: d.creditosProducao?.creditoIcms,
      creditoIpi: d.creditosProducao?.creditoIpi,
      creditoPisCofins: d.creditosProducao?.creditoPisCofins,
      taxasProducao: d.creditosProducao?.taxasProducao,
      encargoFinanceiroPerc: d.encargoFinanceiroPerc,
    },
    cev: {
      icms: d.cev?.icms,
      juros: d.cev?.juros,
      pisCofins: d.cev?.pisCofins,
      comissoes: d.cev?.comissoes,
      totalPerc: cevPerc,
      // Task 26 (§4.5/Req 12.8): IPO opcional.
      impostoIpi: d.cev?.impostoIpi,
    },
    // Task 26 (§4.5/Req 12.7/12.8/12.10): blocos opcionais do layout fiel.
    // Preenchidos a partir de `DadosRelatorio` quando fornecidos; omitidos quando
    // ausentes (callers atuais seguem funcionando identicamente — não-regressão).
    prazos: d.prazos,
    comissoes: d.comissoes,
    condicoesPagamento: d.condicoesPagamento,
    incluidoPor: d.incluidoPor,
    alteradoPor: d.alteradoPor,
    margens,
    planos,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// RELATÓRIO CONSOLIDADO (multi-item) — Req 13.6/13.7
// ═══════════════════════════════════════════════════════════════════════════

/** Um item do relatório consolidado: o relatório completo do item (6 componentes
 *  + custoProducao + cev + margens, via `montarRelatorio`) mais os totais do
 *  fechamento (margem selecionada) usados na soma do orçamento. */
export interface RelatorioItemConsolidado {
  sequencia: number
  descricao?: string | null
  relatorio: RelatorioOrcamento
  custoProducao: number
  valorTotal: number
  margemSelecionada: number
}

/** Relatório de um orçamento multi-item: cabeçalho comercial único, a lista de
 *  itens (cada um com seu relatório detalhado) e os totais consolidados do
 *  orçamento (já calculados no cabeçalho). */
export interface RelatorioConsolidado {
  cabecalho: {
    empresa?: string
    data: string
    numero?: string | number
    cliente?: string
    serie?: string | null
    quantidadeItens: number
  }
  itens: RelatorioItemConsolidado[]
  totais: {
    custoProducaoConsolidado: number
    valorTotalConsolidado: number
  }
}

export interface DadosRelatorioConsolidado {
  cabecalho: Partial<RelatorioConsolidado['cabecalho']>
  itens: Array<{
    sequencia: number
    descricao?: string | null
    resultado: ResultadoOrcamento
    quantidade: number
    custoProducao: number
    valorTotal: number
    margemSelecionada: number
    cev?: { icms: number; juros: number; pisCofins: number; comissoes: number }
  }>
  custoProducaoConsolidado: number
  valorTotalConsolidado: number
}

/**
 * Monta o relatório consolidado de um orçamento multi-item. Função 100% pura:
 * reusa `montarRelatorio` por item (componentes + totais do item) e compõe os
 * totais do orçamento a partir dos valores consolidados do cabeçalho (já
 * calculados em `consolidarOrcamento` na gravação). Os itens são ordenados por
 * sequência para apresentação estável.
 */
export function montarRelatorioConsolidado(d: DadosRelatorioConsolidado): RelatorioConsolidado {
  const itens: RelatorioItemConsolidado[] = [...d.itens]
    .sort((a, b) => a.sequencia - b.sequencia)
    .map((item) => ({
      sequencia: item.sequencia,
      descricao: item.descricao ?? null,
      relatorio: montarRelatorio({
        resultado: item.resultado,
        quantidade: item.quantidade,
        cev: item.cev,
      }),
      custoProducao: r2(item.custoProducao),
      valorTotal: r2(item.valorTotal),
      margemSelecionada: r2(item.margemSelecionada),
    }))

  return {
    cabecalho: {
      data: new Date().toLocaleDateString('pt-BR'),
      quantidadeItens: itens.length,
      ...d.cabecalho,
    },
    itens,
    totais: {
      custoProducaoConsolidado: r2(d.custoProducaoConsolidado),
      valorTotalConsolidado: r2(d.valorTotalConsolidado),
    },
  }
}
