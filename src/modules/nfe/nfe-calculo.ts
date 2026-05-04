/**
 * Cálculos tributários para NF-e 4.00
 * Suporta ICMS (CST/CSOSN), IPI, PIS e COFINS
 */

export interface DadosProdutoFiscal {
  vProd: number       // valor total do item (qCom * vUnCom)
  vDesc?: number      // desconto
  vFrete?: number     // frete rateado
  vSeg?: number       // seguro rateado
  vOutro?: number     // outras despesas
  // Campos fiscais do produto
  cst?: string | null
  csosn?: string | null
  aliqICMS: number
  aliqIPI: number
  cstPIS?: string | null
  aliqPIS: number
  cstCOFINS?: string | null
  aliqCOFINS: number
  origemProd: number
  regimeTributario: number  // 1=Simples, 2=Simples Excesso, 3=Normal
}

export interface TributosCalculados {
  // ICMS
  bcICMS: number
  vICMS: number
  cstICMS: string
  // IPI
  bcIPI: number
  vIPI: number
  cstIPI: string
  // PIS
  bcPIS: number
  vPIS: number
  cstPIS: string
  // COFINS
  bcCOFINS: number
  vCOFINS: number
  cstCOFINS: string
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Calcula todos os tributos de um item da NF-e
 */
export function calcularTributos(dados: DadosProdutoFiscal): TributosCalculados {
  const vDesc = dados.vDesc ?? 0
  const vFrete = dados.vFrete ?? 0
  const vSeg = dados.vSeg ?? 0
  const vOutro = dados.vOutro ?? 0

  // Base de cálculo geral
  const bcGeral = dados.vProd - vDesc + vFrete + vSeg + vOutro

  // --- ICMS ---
  let bcICMS = 0
  let vICMS = 0
  let cstICMS = dados.cst || '00'

  if (dados.regimeTributario === 1 || dados.regimeTributario === 2) {
    // Simples Nacional — usa CSOSN
    cstICMS = dados.csosn || '102'
    // CSOSN 102, 400, 500 → sem cálculo de ICMS
    if (['101'].includes(cstICMS)) {
      // 101 = tributada com permissão de crédito
      bcICMS = round2(bcGeral)
      vICMS = round2(bcICMS * dados.aliqICMS / 100)
    }
  } else {
    // Regime Normal — usa CST
    cstICMS = dados.cst || '00'
    if (['00', '10', '20', '70', '90'].includes(cstICMS)) {
      bcICMS = round2(bcGeral)
      vICMS = round2(bcICMS * dados.aliqICMS / 100)
    }
    // CST 40, 41, 50, 60 → sem cálculo
  }

  // --- IPI ---
  let bcIPI = 0
  let vIPI = 0
  const cstIPI = dados.aliqIPI > 0 ? '50' : '53'

  if (dados.regimeTributario === 3 && dados.aliqIPI > 0) {
    bcIPI = round2(bcGeral)
    vIPI = round2(bcIPI * dados.aliqIPI / 100)
  }

  // --- PIS ---
  const cstPIS = dados.cstPIS || '01'
  let bcPIS = 0
  let vPIS = 0

  if (['01', '02'].includes(cstPIS)) {
    bcPIS = round2(bcGeral)
    vPIS = round2(bcPIS * dados.aliqPIS / 100)
  }

  // --- COFINS ---
  const cstCOFINS = dados.cstCOFINS || '01'
  let bcCOFINS = 0
  let vCOFINS = 0

  if (['01', '02'].includes(cstCOFINS)) {
    bcCOFINS = round2(bcGeral)
    vCOFINS = round2(bcCOFINS * dados.aliqCOFINS / 100)
  }

  return {
    bcICMS, vICMS, cstICMS,
    bcIPI, vIPI, cstIPI,
    bcPIS, vPIS, cstPIS,
    bcCOFINS, vCOFINS, cstCOFINS,
  }
}

/**
 * Calcula totais da NF-e a partir dos tributos de cada item
 */
export function calcularTotaisNFe(itens: Array<{ vProd: number; vDesc?: number; tributos: TributosCalculados }>) {
  let vBC = 0, vICMS = 0, vIPI = 0, vPIS = 0, vCOFINS = 0, vProd = 0, vDesc = 0

  for (const item of itens) {
    vProd += item.vProd
    vDesc += item.vDesc ?? 0
    vBC += item.tributos.bcICMS
    vICMS += item.tributos.vICMS
    vIPI += item.tributos.vIPI
    vPIS += item.tributos.vPIS
    vCOFINS += item.tributos.vCOFINS
  }

  const vNF = round2(vProd - vDesc + vIPI)

  return {
    vBC: round2(vBC),
    vICMS: round2(vICMS),
    vIPI: round2(vIPI),
    vPIS: round2(vPIS),
    vCOFINS: round2(vCOFINS),
    vProd: round2(vProd),
    vDesc: round2(vDesc),
    vNF: round2(vNF),
  }
}
