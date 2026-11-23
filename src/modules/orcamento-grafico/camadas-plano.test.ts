import { describe, expect, it } from 'vitest'
import { custoPapelCamada, folhasDaCapa, somarCamadasAoResultado, suportesDasCamadas } from './camadas-plano'

describe('camadas do plano', () => {
  it('papel do microondulado do cálculo 15185 (Calcgraf: R$ 5.542,43)', () => {
    const r = custoPapelCamada({ folhas: 7500, larguraMm: 600, alturaMm: 700, gramatura: 230, precoKg: 7.65 })
    expect(r.pesoKg).toBeCloseTo(724.5, 3)
    expect(r.custo).toBeCloseTo(5542.43, 2)
  })

  it('dado incompleto não gera custo', () => {
    expect(custoPapelCamada({ folhas: 0, larguraMm: 600, alturaMm: 700, gramatura: 230, precoKg: 7 }).custo).toBe(0)
    expect(custoPapelCamada({ folhas: 10, larguraMm: 600, alturaMm: 700, gramatura: 0, precoKg: 7 }).custo).toBe(0)
  })

  it('recupera as folhas da capa a partir do peso', () => {
    const folhas = folhasDaCapa(
      { papel: { pesoKg: 480.465, custo: 0 }, encaixe: { layout: { folhaLarguraMm: 650, folhaAlturaMm: 1225 } } } as never,
      415,
    )
    expect(folhas).toBe(1454)
  })

  it('lê só camadas com suporte e não fornecidas', () => {
    expect(
      suportesDasCamadas({
        microondulado: { suporteId: 'a', fornecido: false },
        capaInterna: { suporteId: 'b', fornecido: true },
      }),
    ).toEqual([{ nome: 'microondulado', suporteId: 'a' }])
    expect(suportesDasCamadas(null)).toEqual([])
    expect(suportesDasCamadas({ microondulado: null, capaInterna: { suporteId: '' } })).toEqual([])
  })

  it('soma o custo das camadas ao material direto e aos totais', () => {
    const res = { materialDireto: 100, custoProducao: 150, custoTotal: 160 } as never
    somarCamadasAoResultado(res, [{ custo: 10.5 }, { custo: 4.5 }] as never)
    expect((res as { materialDireto: number }).materialDireto).toBe(115)
    expect((res as { custoProducao: number }).custoProducao).toBe(165)
    expect((res as { custoTotal: number }).custoTotal).toBe(175)
  })
})
