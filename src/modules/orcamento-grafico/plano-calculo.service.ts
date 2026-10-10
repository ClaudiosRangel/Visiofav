import {
  calcularOrcamentoGrafico,
  type ParamsOrcamento,
  type ResultadoOrcamento,
} from './orcamento-grafico-calculo.service'

export interface FechamentoPlano {
  sequencia: number
  custoSuporte: number
  custoImpressao: number
  custoAcabamento: number
  materialDireto: number
  custoTransformacao: number
  servicoExterno: number
}

/** Soma pura dos planos no item (Req 5.2). */
export function somaPlanos(planos: FechamentoPlano[]): {
  materialDireto: number; custoTransformacao: number; servicoExterno: number
} {
  const r2 = (x: number) => Math.round(x * 100) / 100
  return {
    materialDireto: r2(planos.reduce((s, p) => s + p.materialDireto, 0)),
    custoTransformacao: r2(planos.reduce((s, p) => s + p.custoTransformacao, 0)),
    servicoExterno: r2(planos.reduce((s, p) => s + p.servicoExterno, 0)),
  }
}

/**
 * Extrai de um `ResultadoOrcamento` os campos de fechamento de um plano.
 *
 * `materialDireto`, `custoTransformacao` e `servicoExterno` são expostos
 * diretamente pela decomposição de paridade Calcgraf do motor. Já os
 * componentes de granularidade fina (`custoSuporte/custoImpressao/
 * custoAcabamento`) NÃO são expostos pelo `ResultadoOrcamento` hoje —
 * entram como 0 por ora.
 */
export function fechamentoDoResultado(
  sequencia: number,
  resultado: ResultadoOrcamento,
): FechamentoPlano {
  return {
    sequencia,
    // TODO: derivar do detalhamento quando disponível
    custoSuporte: 0,
    // TODO: derivar do detalhamento quando disponível
    custoImpressao: 0,
    // TODO: derivar do detalhamento quando disponível
    custoAcabamento: 0,
    materialDireto: resultado.materialDireto,
    custoTransformacao: resultado.custoTransformacao,
    servicoExterno: resultado.servicoExterno,
  }
}

/**
 * Calcula um plano chamando o motor puro 1×.
 *
 * Recebe um `ParamsOrcamento` já montado (a montagem a partir do input de
 * plano via `montarParamsDoPlano` é responsabilidade do item.service — Task 8),
 * mantendo este serviço desacoplado e o motor intocado.
 */
export function calcularPlano(params: ParamsOrcamento): ResultadoOrcamento {
  return calcularOrcamentoGrafico(params)
}
