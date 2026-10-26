import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  aplicarDecomposicaoStc,
  normalizarCustosStc,
  limparDescStc,
  type CustosCalcgraf,
} from './decomposicao-stc.service'
import type { ResultadoOrcamento } from '../orcamento-grafico-calculo.service'

/**
 * GOLDEN 12992 (Gerdau, "Rótulo p/ farpado GIR 500M", tiragem 4.000).
 * Decomposição REAL extraída da tabela CalculoSTC do Calcgraf — a soma dos
 * componentes = R$ 5.192,05 EXATO (MD 4.113,94 + CT 1.078,11). É a prova de que
 * o item puxado bate ITEM A ITEM, não só o total ancorado.
 */
const CUSTOS_12992: CustosCalcgraf = {
  materialDireto: 4113.94,
  custoTransformacao: 1078.11,
  custoProducao: 5192.05,
  componentes: [
    { origem: 'SUPORTE', grupo: 'MD', descricao: '0001Stora Enzo Bobina  415', valorTotal: 3010.745703875, quantFixa: 0, quantVariavel: 440.8119625, valorCm: 0 },
    { origem: 'CENTRO DE CUSTO', grupo: 'CT', descricao: '0001Offset Plana Roland RVU 4 cores', valorTotal: 732.790014684288, quantFixa: 4.5, quantVariavel: 0.734214390602056, valorCm: 732.79 },
    { origem: 'MAT.ACABAMENTO', grupo: 'MD', descricao: '0001BOPP Brilho (F100)', valorTotal: 581.8241, quantFixa: 0, quantVariavel: 1057.862, valorCm: 0 },
    { origem: 'MATRIZ IMPRESSÃO', grupo: 'MD', descricao: '0001RVU', valorTotal: 300, quantFixa: 3, quantVariavel: 0, valorCm: 0 },
    { origem: 'CENTRO DE CUSTO', grupo: 'CT', descricao: '0001Guilhotina de envol', valorTotal: 155.38, quantFixa: 0, quantVariavel: 2, valorCm: 155.38 },
    { origem: 'TINTA', grupo: 'MD', descricao: '0001Pantone 01 (424C - CINZA)', valorTotal: 101.164305949008, quantFixa: 0.2, quantVariavel: 1.35637393767705, valorCm: 0 },
    { origem: 'CENTRO DE CUSTO', grupo: 'CT', descricao: '0001Laminação maior / Plastificadora mai', valorTotal: 100, quantFixa: 0, quantVariavel: 1.66666666666667, valorCm: 100 },
    { origem: 'CENTRO DE CUSTO', grupo: 'CT', descricao: '0001Cortadeira (Grande)', valorTotal: 89.9390555555555, quantFixa: 0.25, quantVariavel: 0.544444444444444, valorCm: 89.94 },
    { origem: 'TINTA', grupo: 'MD', descricao: '0001Pantone 03 (123C - AMARELO)', valorTotal: 76.0509915014164, quantFixa: 0.2, quantVariavel: 0.290651558073654, valorCm: 0 },
    { origem: 'TINTA', grupo: 'MD', descricao: '0001Pantone 02 (295C - AZUL)', valorTotal: 44.1586402266289, quantFixa: 0.2, quantVariavel: 0.290651558073654, valorCm: 0 },
  ],
}

/** Resultado "cru" do motor, antes da projeção (valores diferentes do Calcgraf). */
function resultadoBase(): ResultadoOrcamento {
  return {
    planificacao: { larguraMm: 0, alturaMm: 0 },
    encaixe: {} as ResultadoOrcamento['encaixe'],
    papel: { pesoKg: 480, custo: 2162 },
    tinta: { custoTotal: 0, detalhePorCor: [] },
    maquinas: { custoTotal: 0, detalhePorEtapa: [] },
    acabamentos: { custoTotal: 0, detalhePorAcabamento: [] },
    custoTotal: 3319,
    precoVenda: 4000,
    precoUnitario: 1,
    margemReal: 0,
    breakdown: { papelPercent: 0, tintaPercent: 0, maquinaPercent: 0, acabamentoPercent: 0 },
    materialDireto: 2644,
    custoTransformacao: 866,
    servicoExterno: 0,
    custoProducao: 3510,
    cevPerc: 0,
    cevValor: 0,
    contribuicaoMarginalValor: 0,
    contribuicaoMarginalPerc: 0,
  }
}

const soma = (arr: number[]) => Math.round(arr.reduce((s, x) => s + x, 0) * 100) / 100

describe('decomposicao-stc — golden 12992 (bate item a item)', () => {
  const r = aplicarDecomposicaoStc(resultadoBase(), CUSTOS_12992)

  it('C.Prod = R$ 5.192,05 (soma dos componentes)', () => {
    expect(r.custoProducao).toBe(5192.05)
    expect((r as { custoTotal?: number }).custoTotal).toBe(5192.05)
  })

  it('MD 4.113,94 e CT 1.078,11', () => {
    expect(r.materialDireto).toBe(4113.94)
    expect(r.custoTransformacao).toBe(1078.11)
    expect(r.servicoExterno).toBe(0)
  })

  it('MD + CT = C.Prod (coerência)', () => {
    expect(soma([r.materialDireto, r.custoTransformacao])).toBe(r.custoProducao)
  })

  it('papel (SUPORTE) = R$ 3.010,75', () => {
    expect(r.papel.custo).toBe(3010.75)
    expect(r.papel.pesoKg).toBe(480) // peso do motor preservado
  })

  it('tinta: 3 Pantones com custo exato (soma 221,37)', () => {
    expect(r.tinta.detalhePorCor).toHaveLength(3)
    expect(r.tinta.custoTotal).toBe(221.37)
    const cinza = r.tinta.detalhePorCor.find((c) => c.cor.includes('CINZA'))
    expect(cinza?.custo).toBe(101.16)
  })

  it('máquinas/CT: 4 etapas (Roland 732,79, Guilhotina 155,38, Laminação 100, Cortadeira 89,94)', () => {
    expect(r.maquinas.detalhePorEtapa).toHaveLength(4)
    const roland = r.maquinas.detalhePorEtapa.find((e) => e.etapa.includes('Roland'))
    expect(roland?.custo).toBe(732.79)
    expect(r.maquinas.custoTotal).toBe(1078.11)
  })

  it('acabamentos/MD (BOPP + matriz RVU): soma 881,82', () => {
    expect(r.acabamentos.detalhePorAcabamento).toHaveLength(2)
    expect(r.acabamentos.custoTotal).toBe(881.82)
  })

  it('anexa custosCalcgraf cru com descrições limpas', () => {
    const cc = (r as { custosCalcgraf?: CustosCalcgraf }).custosCalcgraf!
    expect(cc.componentes).toHaveLength(10)
    expect(cc.componentes.every((k) => !/^0*\d{3,4}/.test(k.descricao ?? ''))).toBe(true)
  })
})

describe('decomposicao-stc — não-regressão', () => {
  it('sem custosCalcgraf → resultado intacto', () => {
    const base = resultadoBase()
    const r = aplicarDecomposicaoStc(base, null)
    expect(r.custoProducao).toBe(3510)
    expect(r.materialDireto).toBe(2644)
  })

  it('componentes vazios → intacto', () => {
    const base = resultadoBase()
    aplicarDecomposicaoStc(base, { componentes: [] })
    expect(base.custoProducao).toBe(3510)
  })

  it('normalizarCustosStc rejeita JSON inútil', () => {
    expect(normalizarCustosStc(null)).toBeNull()
    expect(normalizarCustosStc({})).toBeNull()
    expect(normalizarCustosStc({ componentes: [] })).toBeNull()
  })

  it('limparDescStc remove prefixo numérico', () => {
    expect(limparDescStc('0001Stora Enzo')).toBe('Stora Enzo')
    expect(limparDescStc(null)).toBe('Componente')
  })
})

describe('decomposicao-stc — propriedades (fast-check)', () => {
  const compArb = fc.record({
    origem: fc.constantFrom('SUPORTE', 'TINTA', 'MAT.ACABAMENTO', 'MATRIZ IMPRESSÃO', 'CENTRO DE CUSTO'),
    descricao: fc.string(),
    valorTotal: fc.double({ min: 0, max: 1e5, noNaN: true, noDefaultInfinity: true }),
  })

  it('P1 — C.Prod = MD + CT para qualquer conjunto de componentes', () => {
    fc.assert(
      fc.property(fc.array(compArb, { minLength: 1, maxLength: 20 }), (comps) => {
        const componentes = comps.map((c) => ({
          origem: c.origem,
          grupo: c.origem === 'CENTRO DE CUSTO' ? ('CT' as const) : ('MD' as const),
          descricao: c.descricao,
          valorTotal: c.valorTotal,
          quantFixa: null,
          quantVariavel: null,
          valorCm: null,
        }))
        const norm = normalizarCustosStc({ componentes })!
        const r = aplicarDecomposicaoStc(resultadoBase(), norm)
        const dif = Math.abs(r.materialDireto + r.custoTransformacao - r.custoProducao)
        expect(dif).toBeLessThanOrEqual(0.02)
      }),
    )
  })

  it('P2 — custoProducao nunca é negativo e CT soma só CENTRO DE CUSTO', () => {
    fc.assert(
      fc.property(fc.array(compArb, { minLength: 1, maxLength: 20 }), (comps) => {
        const componentes = comps.map((c) => ({
          origem: c.origem,
          grupo: c.origem === 'CENTRO DE CUSTO' ? ('CT' as const) : ('MD' as const),
          descricao: c.descricao,
          valorTotal: c.valorTotal,
          quantFixa: null,
          quantVariavel: null,
          valorCm: null,
        }))
        const r = aplicarDecomposicaoStc(resultadoBase(), { componentes })
        expect(r.custoProducao).toBeGreaterThanOrEqual(0)
        const ctEsperado = soma(componentes.filter((k) => k.origem === 'CENTRO DE CUSTO').map((k) => k.valorTotal))
        expect(Math.abs(r.custoTransformacao - ctEsperado)).toBeLessThanOrEqual(0.02)
      }),
    )
  })
})
