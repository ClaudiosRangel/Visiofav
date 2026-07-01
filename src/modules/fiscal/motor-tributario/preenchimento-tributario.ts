/**
 * Preenchimento automático de campos tributários a partir de regra encontrada.
 * Função pura que calcula valores sem persistir no banco — permite override manual antes da emissão.
 *
 * Validates: Requirements 7.5
 */

import { NivelFallback, RegimeTributario } from './tipos'
import { motorTributarioService, ResultadoBuscaRegra } from './motor-tributario.service'

// === Interfaces de entrada e saída ===

export interface DadosItemParaPreenchimento {
  ncm: string
  cfop: string
  ufOrigem: string
  ufDestino: string
  regimeTributario: RegimeTributario
  empresaId: string
  valorProduto: number
  valorFrete: number
  valorSeguro: number
  valorOutras: number
  valorDesconto: number
  quantidade: number
}

export interface ItemTributadoPreenchido {
  // CST/CSOSN
  icmsCst?: string
  icmsCsosn?: string
  // ICMS
  icmsAliquota: number
  icmsBase: number
  icmsValor: number
  icmsReducao: number
  // PIS
  pisAliquota: number
  pisBase: number
  pisValor: number
  pisCst: string
  // COFINS
  cofinsAliquota: number
  cofinsBase: number
  cofinsValor: number
  cofinsCst: string
  // IPI
  ipiAliquota: number
  ipiBase: number
  ipiValor: number
  ipiCst: string
  // Rastreabilidade
  regraTributariaId: string
  nivelFallback: NivelFallback
}

/**
 * Arredondamento ABNT NBR 5891 (half-up) com 2 casas decimais.
 */
function arredondar2(valor: number): number {
  return Math.round((valor + Number.EPSILON) * 100) / 100
}

/**
 * Preenche automaticamente os campos tributários de um item de documento fiscal
 * a partir da regra tributária encontrada via fallback hierárquico.
 *
 * Fluxo:
 * 1. Chama buscarRegraComFallback para obter a regra aplicável
 * 2. Calcula base de ICMS = valorProduto + valorFrete + valorSeguro + valorOutras - valorDesconto
 * 3. Aplica alíquotas da regra para calcular valores de cada imposto
 * 4. Retorna todos os campos preenchidos com regraTributariaId e nivelFallback
 *
 * NÃO persiste no banco — o chamador pode sobrescrever campos antes de salvar.
 *
 * @throws ErroFiscal(REGRA_NAO_ENCONTRADA) se nenhuma regra for encontrada em nenhum nível
 */
export async function preencherCamposTributarios(
  dados: DadosItemParaPreenchimento,
): Promise<ItemTributadoPreenchido> {
  // 1. Buscar regra com fallback hierárquico
  const resultado: ResultadoBuscaRegra = await motorTributarioService.buscarRegraComFallback({
    ncm: dados.ncm,
    cfop: dados.cfop,
    ufOrigem: dados.ufOrigem,
    ufDestino: dados.ufDestino,
    regimeTributario: dados.regimeTributario,
    empresaId: dados.empresaId,
  })

  const regra = resultado.regra!

  // 2. Calcular base de ICMS (vProd + vFrete + vSeg + vOutras - vDesc)
  const baseCalculoBruta =
    dados.valorProduto +
    dados.valorFrete +
    dados.valorSeguro +
    dados.valorOutras -
    dados.valorDesconto

  // Aplicar percentual de base de cálculo e redução da regra
  const percentualBase = regra.icms.baseCalculo / 100
  const percentualReducao = regra.icms.reducao / 100
  const icmsBase = arredondar2(baseCalculoBruta * percentualBase * (1 - percentualReducao))

  // 3. Calcular valores dos impostos
  const icmsAliquota = regra.icms.aliquota
  const icmsValor = arredondar2(icmsBase * icmsAliquota / 100)

  // PIS - mesma base bruta (sem redução ICMS)
  const pisBase = arredondar2(baseCalculoBruta)
  const pisAliquota = regra.pis.aliquota
  const pisValor = arredondar2(pisBase * pisAliquota / 100)

  // COFINS - mesma base bruta
  const cofinsBase = arredondar2(baseCalculoBruta)
  const cofinsAliquota = regra.cofins.aliquota
  const cofinsValor = arredondar2(cofinsBase * cofinsAliquota / 100)

  // IPI - base = vProd + vFrete + vSeg + vOutras (sem desconto)
  const ipiBase = arredondar2(
    dados.valorProduto + dados.valorFrete + dados.valorSeguro + dados.valorOutras,
  )
  const ipiAliquota = regra.ipi.aliquota
  const ipiValor = arredondar2(ipiBase * ipiAliquota / 100)

  // 4. Montar resultado
  const itemPreenchido: ItemTributadoPreenchido = {
    // CST/CSOSN - usar CST para regimes normais, CSOSN para Simples Nacional
    icmsCst: dados.regimeTributario === RegimeTributario.NORMAL
      ? regra.icms.cst || undefined
      : undefined,
    icmsCsosn: (dados.regimeTributario === RegimeTributario.SIMPLES_NACIONAL ||
      dados.regimeTributario === RegimeTributario.SIMPLES_NACIONAL_EXCESSO)
      ? regra.icms.cst || undefined
      : undefined,
    // ICMS
    icmsAliquota,
    icmsBase,
    icmsValor,
    icmsReducao: regra.icms.reducao,
    // PIS
    pisAliquota,
    pisBase,
    pisValor,
    pisCst: regra.pis.cst,
    // COFINS
    cofinsAliquota,
    cofinsBase,
    cofinsValor,
    cofinsCst: regra.cofins.cst,
    // IPI
    ipiAliquota,
    ipiBase,
    ipiValor,
    ipiCst: regra.ipi.cst,
    // Rastreabilidade
    regraTributariaId: regra.id,
    nivelFallback: resultado.nivelFallback,
  }

  return itemPreenchido
}
