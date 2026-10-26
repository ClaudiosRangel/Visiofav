import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { precoLiquidoCredito, round2 } from './credito-fiscal.service'
import { sobrepoe, versaoVigenteNaData, conflitoDeVigencia, type Vigencia } from './vigencia-tabela.service'
import { grupoDaOrigem, montarItensCusto, origemValida, type ItemCustoFonte } from './itens-custo-view.service'

const d = (iso: string) => new Date(iso + 'T00:00:00')

// ───────────────────────── Crédito fiscal (P1–P3) ─────────────────────────
describe('credito-fiscal', () => {
  // A fórmula pura `bruto/(1+c)` com 9,25% dá 6,82. O preço efetivo do papel no
  // Calcgraf (12992) é 6,83 — que corresponde a um crédito de ~9,08%
  // (7,45/6,83 = 1,0908), NÃO 9,25%. Ou seja, o "6,83 = 7,45÷1,0925" era uma
  // aproximação; o percentual real que reproduz 6,83 é ~9,08%. O campo é
  // parametrizável por papel justamente para acomodar o percentual real.
  it('P3 golden: fórmula pura — 9,25% sobre 7,45 → 6,82', () => {
    expect(precoLiquidoCredito(7.45, 9.25)).toBe(6.82)
  })

  it('P3b golden: crédito que reproduz o preço real do papel 12992 (6,83)', () => {
    // 7,45 / 6,83 = 1,0908 → crédito ≈ 9,08%.
    expect(precoLiquidoCredito(7.45, 9.08)).toBe(6.83)
  })

  it('crédito 0 (ou ausente) → preço bruto', () => {
    expect(precoLiquidoCredito(7.45, 0)).toBe(7.45)
    expect(precoLiquidoCredito(10, -5)).toBe(10)
  })

  it('bruto <= 0 → 0', () => {
    expect(precoLiquidoCredito(0, 9.25)).toBe(0)
    expect(precoLiquidoCredito(-1, 9.25)).toBe(0)
  })

  it('P1 — líquido ≤ bruto para todo crédito ≥ 0', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
        (bruto, credito) => {
          expect(precoLiquidoCredito(bruto, credito)).toBeLessThanOrEqual(round2(bruto) + 1e-9)
        },
      ),
    )
  })

  it('P2 — crédito maior ⇒ líquido menor ou igual (monotonicidade)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 50, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 50, noNaN: true, noDefaultInfinity: true }),
        (bruto, c1, c2) => {
          const menor = Math.min(c1, c2)
          const maior = Math.max(c1, c2)
          expect(precoLiquidoCredito(bruto, maior)).toBeLessThanOrEqual(precoLiquidoCredito(bruto, menor) + 1e-9)
        },
      ),
    )
  })
})

// ───────────────────────── Vigência (P4–P5) ─────────────────────────
describe('vigencia-tabela', () => {
  it('golden Wega: 2 versões não sobrepõem; seleção por data', () => {
    const padrao: Vigencia & { id: string } = { id: 'p', inicio: d('2004-07-16'), fim: d('2024-12-02') }
    const teste: Vigencia & { id: string } = { id: 't', inicio: d('2024-12-03'), fim: d('2025-02-28') }
    expect(sobrepoe(padrao, teste)).toBe(false)
    expect(versaoVigenteNaData([padrao, teste], d('2026-01-01'))).toBeUndefined() // nenhuma cobre 2026
    expect(versaoVigenteNaData([padrao, teste], d('2025-01-15'))?.id).toBe('t')
    expect(versaoVigenteNaData([padrao, teste], d('2010-01-01'))?.id).toBe('p')
  })

  it('sobreposição no limite (fim===inicio) conta como sobreposta', () => {
    expect(sobrepoe({ inicio: d('2024-01-01'), fim: d('2024-06-01') }, { inicio: d('2024-06-01'), fim: null })).toBe(true)
  })

  it('fim null = aberto (+∞)', () => {
    expect(sobrepoe({ inicio: d('2024-01-01'), fim: null }, { inicio: d('2030-01-01'), fim: null })).toBe(true)
    expect(versaoVigenteNaData([{ inicio: d('2024-01-01'), fim: null }], d('2099-01-01'))).toBeDefined()
  })

  it('conflitoDeVigencia ignora a própria versão na edição', () => {
    const a = { id: 'a', inicio: d('2024-01-01'), fim: d('2024-12-31') }
    expect(conflitoDeVigencia({ inicio: d('2024-06-01'), fim: null }, [a], 'a')).toBeUndefined()
    expect(conflitoDeVigencia({ inicio: d('2024-06-01'), fim: null }, [a], 'outro')?.id).toBe('a')
  })

  it('P5 — sobrepoe é simétrica', () => {
    const arbV = fc.record({
      inicioDias: fc.integer({ min: 0, max: 1000 }),
      durDias: fc.integer({ min: 0, max: 500 }),
      aberto: fc.boolean(),
    })
    fc.assert(
      fc.property(arbV, arbV, (x, y) => {
        const mk = (v: typeof x): Vigencia => ({
          inicio: new Date(2020, 0, 1 + v.inicioDias),
          fim: v.aberto ? null : new Date(2020, 0, 1 + v.inicioDias + v.durDias),
        })
        const a = mk(x), b = mk(y)
        expect(sobrepoe(a, b)).toBe(sobrepoe(b, a))
      }),
    )
  })

  it('P4 — sem sobreposição ⇒ versaoVigenteNaData retorna 0 ou 1', () => {
    // Gera versões sequenciais NÃO sobrepostas (cada uma começa 1 dia após o fim da anterior).
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 1, maxLength: 12 }),
        fc.integer({ min: 0, max: 5000 }),
        (duracoes, diaConsulta) => {
          const versoes: Array<Vigencia & { id: string }> = []
          let cursor = 0
          duracoes.forEach((dur, i) => {
            const inicio = new Date(2000, 0, 1 + cursor)
            const fim = new Date(2000, 0, 1 + cursor + dur)
            versoes.push({ id: String(i), inicio, fim })
            cursor += dur + 2 // +2 dias de gap garante não-sobreposição (fim inclusive)
          })
          const data = new Date(2000, 0, 1 + diaConsulta)
          const cobrem = versoes.filter((v) => v.inicio.getTime() <= data.getTime() && data.getTime() <= (v.fim as Date).getTime())
          expect(cobrem.length).toBeLessThanOrEqual(1)
          const sel = versaoVigenteNaData(versoes, data)
          expect(sel ? 1 : 0).toBe(cobrem.length)
        },
      ),
    )
  })
})

// ───────────────────────── Itens de custo por Origem (P8) ─────────────────────────
describe('itens-custo-view', () => {
  it('grupoDaOrigem aplica a regra MD/CT/SE', () => {
    expect(grupoDaOrigem('SUPORTE')).toBe('MD')
    expect(grupoDaOrigem('TINTA')).toBe('MD')
    expect(grupoDaOrigem('MAT.ACABAMENTO')).toBe('MD')
    expect(grupoDaOrigem('MATRIZ IMPRESSÃO')).toBe('MD') // com acento normaliza
    expect(grupoDaOrigem('CENTRO DE CUSTO')).toBe('CT')
    expect(grupoDaOrigem('SERVIÇO EXTERNO')).toBe('SE')
  })

  it('origemValida reconhece variações e rejeita inválida', () => {
    expect(origemValida('CENTRO DE CUSTO')).toBe(true)
    expect(origemValida('MATRIZ IMPRESSÃO')).toBe(true)
    expect(origemValida('XPTO')).toBe(false)
  })

  it('montarItensCusto deriva origem/grupo por fonte', () => {
    const fontes: ItemCustoFonte[] = [
      { fonteTipo: 'PAPEL', id: '1', descricao: 'Stora Enzo 415', valor: 7.45 },
      { fonteTipo: 'TINTA', id: '2', descricao: 'Pantone 01', valor: 71.5 },
      { fonteTipo: 'CENTRO', id: '3', descricao: 'Roland RVU', valor: 140 },
      { fonteTipo: 'ACABAMENTO', id: '4', descricao: 'BOPP', natureza: 'MATERIAL', valor: 0.605 },
      { fonteTipo: 'ACABAMENTO', id: '5', descricao: 'Serviço X', natureza: 'SERVICO' },
    ]
    const r = montarItensCusto(fontes)
    expect(r.find((i) => i.fonteId === '1')).toMatchObject({ origem: 'SUPORTE', grupo: 'MD' })
    expect(r.find((i) => i.fonteId === '3')).toMatchObject({ origem: 'CENTRO DE CUSTO', grupo: 'CT' })
    expect(r.find((i) => i.fonteId === '4')).toMatchObject({ origem: 'MAT.ACABAMENTO', grupo: 'MD' })
    expect(r.find((i) => i.fonteId === '5')).toMatchObject({ origem: 'SERVICO EXTERNO', grupo: 'SE' })
  })

  it('P8 — todo item recebe exatamente um grupo MD/CT/SE', () => {
    const arb = fc.record({
      fonteTipo: fc.constantFrom('PAPEL', 'TINTA', 'ACABAMENTO', 'CENTRO', 'SERVICO') as fc.Arbitrary<ItemCustoFonte['fonteTipo']>,
      id: fc.uuid(),
      descricao: fc.string({ minLength: 1 }),
      natureza: fc.option(fc.constantFrom('MATERIAL', 'SERVICO'), { nil: undefined }),
    })
    fc.assert(
      fc.property(fc.array(arb, { maxLength: 30 }), (fontes) => {
        const r = montarItensCusto(fontes as ItemCustoFonte[])
        expect(r).toHaveLength(fontes.length)
        for (const item of r) {
          expect(['MD', 'CT', 'SE']).toContain(item.grupo)
        }
      }),
    )
  })
})

// ───────────────────────── Memória STC (P6–P7) ─────────────────────────
import { montarMemoriaStc } from '../orcamento-grafico/calculo-grafico/decomposicao-stc.service'

describe('memoria-stc', () => {
  const CUSTOS_12992 = {
    materialDireto: 4113.94,
    custoTransformacao: 1078.11,
    custoProducao: 5192.05,
    componentes: [
      { origem: 'SUPORTE', grupo: 'MD', descricao: '0001Stora Enzo Bobina 415', valorTotal: 3010.745703875, quantFixa: 0, quantVariavel: 440.8, valorCm: 0 },
      { origem: 'CENTRO DE CUSTO', grupo: 'CT', descricao: '0001Roland RVU', valorTotal: 732.790014684288, quantFixa: 4.5, quantVariavel: 0.73, valorCm: 732.79 },
      { origem: 'MAT.ACABAMENTO', grupo: 'MD', descricao: '0001BOPP Brilho', valorTotal: 581.8241, quantFixa: 0, quantVariavel: 1057.86, valorCm: 0 },
      { origem: 'MATRIZ IMPRESSÃO', grupo: 'MD', descricao: '0001RVU', valorTotal: 300, quantFixa: 3, quantVariavel: 0, valorCm: 0 },
      { origem: 'CENTRO DE CUSTO', grupo: 'CT', descricao: '0001Guilhotina', valorTotal: 155.38, quantFixa: 0, quantVariavel: 2, valorCm: 155.38 },
      { origem: 'TINTA', grupo: 'MD', descricao: '0001Pantone 01', valorTotal: 101.164305949008, quantFixa: 0.2, quantVariavel: 1.36, valorCm: 0 },
      { origem: 'CENTRO DE CUSTO', grupo: 'CT', descricao: '0001Laminacao', valorTotal: 100, quantFixa: 0, quantVariavel: 1.66, valorCm: 100 },
      { origem: 'CENTRO DE CUSTO', grupo: 'CT', descricao: '0001Cortadeira', valorTotal: 89.9390555555555, quantFixa: 0.25, quantVariavel: 0.54, valorCm: 89.94 },
      { origem: 'TINTA', grupo: 'MD', descricao: '0001Pantone 03', valorTotal: 76.0509915014164, quantFixa: 0.2, quantVariavel: 0.29, valorCm: 0 },
      { origem: 'TINTA', grupo: 'MD', descricao: '0001Pantone 02', valorTotal: 44.1586402266289, quantFixa: 0.2, quantVariavel: 0.29, valorCm: 0 },
    ],
  }

  it('P7 golden 12992: MD 4.113,94 / CT 1.078,11 / SE 0 / total 5.192,05', () => {
    const m = montarMemoriaStc(CUSTOS_12992)
    expect(m.temMemoria).toBe(true)
    expect(m.materialDireto).toBe(4113.94)
    expect(m.custoTransformacao).toBe(1078.11)
    expect(m.servicoExterno).toBe(0)
    expect(m.custoProducao).toBe(5192.05)
    expect(m.componentes).toHaveLength(10)
    // descrições sem o prefixo "0001"
    expect(m.componentes.every((c) => !/^0*\d{3,4}/.test(c.descricao))).toBe(true)
  })

  it('sem memória → temMemoria false e zeros', () => {
    const m = montarMemoriaStc(null)
    expect(m.temMemoria).toBe(false)
    expect(m.custoProducao).toBe(0)
    expect(m.componentes).toHaveLength(0)
  })

  it('P6 — C.Prod = MD + CT + SE para qualquer conjunto (incl. SERVIÇO EXTERNO)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            origem: fc.constantFrom('SUPORTE', 'TINTA', 'MAT.ACABAMENTO', 'MATRIZ IMPRESSÃO', 'CENTRO DE CUSTO', 'SERVIÇO EXTERNO'),
            valorTotal: fc.double({ min: 0, max: 1e5, noNaN: true, noDefaultInfinity: true }),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        (comps) => {
          const custos = {
            componentes: comps.map((c) => ({ ...c, grupo: 'MD', descricao: 'x', quantFixa: null, quantVariavel: null, valorCm: null })),
          }
          const m = montarMemoriaStc(custos)
          const soma = Math.round((m.materialDireto + m.custoTransformacao + m.servicoExterno) * 100) / 100
          expect(Math.abs(soma - m.custoProducao)).toBeLessThanOrEqual(0.02)
        },
      ),
    )
  })
})
