// Montagem da estrutura do RELATÓRIO de orçamento gráfico (paridade com o
// pré-cálculo do Calcgraf). Serviço PURO: recebe o resultado do cálculo + dados
// do orçamento e devolve as seções na ordem do golden (ver
// docs/calcgraf-golden-15235-acabamentos.md). Consumido pela rota
// GET /:id/relatorio e pelo gerador de PDF.

import type { ResultadoOrcamento } from './orcamento-grafico-calculo.service'

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
  }
  cev: {
    icms?: number
    juros?: number
    pisCofins?: number
    comissoes?: number
    totalPerc: number
  }
  margens: RelatorioMargem[]
}

export interface DadosRelatorio {
  resultado: ResultadoOrcamento
  quantidade: number
  cabecalho?: Partial<RelatorioOrcamento['cabecalho']>
  cev?: { icms: number; juros: number; pisCofins: number; comissoes: number }
  /** Markups a exibir na tabela de margem (default 10/20 + markup do cálculo). */
  markups?: number[]
  encargoFinanceiroPerc?: number
}

const r2 = (x: number) => Math.round(x * 100) / 100

/**
 * Monta o relatório a partir do resultado do motor. O gross-up das margens usa
 * o mesmo CEV do cálculo; cada markup gera uma linha (preço, margem$, CM%/CM$).
 */
export function montarRelatorio(d: DadosRelatorio): RelatorioOrcamento {
  const { resultado: r, quantidade } = d
  const cevPerc = d.cev
    ? d.cev.icms + d.cev.juros + d.cev.pisCofins + d.cev.comissoes
    : r.cevPerc ?? 0

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
      unidade: it.natureza === 'MATERIAL_KG' ? 'KG' : it.natureza === 'MATERIAL_UN' ? 'UN' : undefined,
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
  const acabamento: RelatorioSecaoLinha[] = (r.acabamentosCentros?.detalhePorEtapa ?? []).map((e) => ({
    item: e.etapa,
    unidade: 'H',
    fixo: r2(e.setupMin / 60),
    variavel: r2(e.operacaoMin / 60),
    subtotal: e.custo,
  }))

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

  const margens: RelatorioMargem[] = markups.map((markup) => {
    const divisor = 1 - (cevPerc + markup) / 100
    const precoTotal = divisor > 0 ? r2(r.custoTotal / divisor) : 0
    const precoUnit = quantidade > 0 ? Math.round((precoTotal / quantidade) * 10000) / 10000 : 0
    const margemValor = r2(precoTotal - r.custoTotal)
    const cevValor = r2(precoTotal * (cevPerc / 100))
    const custosVariaveis = r.materialDireto + cevValor
    const cmValor = r2(precoTotal - custosVariaveis)
    const cmPerc = precoTotal > 0 ? r2((cmValor / precoTotal) * 100) : 0
    return { markupPerc: markup, margemValor, cmPerc, cmValor, precoUnitario: precoUnit, precoTotal }
  })

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
    },
    cev: {
      icms: d.cev?.icms,
      juros: d.cev?.juros,
      pisCofins: d.cev?.pisCofins,
      comissoes: d.cev?.comissoes,
      totalPerc: cevPerc,
    },
    margens,
  }
}
