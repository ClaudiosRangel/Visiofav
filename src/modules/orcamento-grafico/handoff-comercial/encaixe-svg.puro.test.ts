import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { encaixeParaSvg, type EncaixeLayout } from './encaixe-svg.puro'

const layout = (over: Partial<EncaixeLayout> = {}): EncaixeLayout => ({
  folhaLarguraMm: 660, folhaAlturaMm: 960, colunas: 3, linhas: 2,
  pecaLarguraMm: 200, pecaAlturaMm: 300, ...over,
})

describe('encaixeParaSvg (R11 — Property 9)', () => {
  it('layout ausente/inválido → null (encaixe não gerado)', () => {
    expect(encaixeParaSvg(null)).toBeNull()
    expect(encaixeParaSvg(undefined)).toBeNull()
    expect(encaixeParaSvg(layout({ colunas: 0 }))).toBeNull()
    expect(encaixeParaSvg(layout({ folhaLarguraMm: 0 }))).toBeNull()
  })

  it('gera SVG com legenda e folha', () => {
    const svg = encaixeParaSvg(layout(), { orcamentoNumero: 123, aproveitamento: 6, folhasNecessarias: 100 })!
    expect(svg).toContain('<svg')
    expect(svg).toContain('Orçamento 123')
    expect(svg).toContain('Aproveitamento 6 pç/folha')
    expect(svg).toContain('100 folhas')
  })

  it('P9a: desenha no máximo colunas×linhas peças (rect de peça)', () => {
    const svg = encaixeParaSvg(layout({ colunas: 3, linhas: 2 }))!
    // conta rects com fill da peça (#cfe3ff)
    const pecas = (svg.match(/fill="#cfe3ff"/g) || []).length
    expect(pecas).toBeLessThanOrEqual(6)
    expect(pecas).toBeGreaterThan(0)
  })

  it('P9b: determinístico — mesmo layout gera o mesmo SVG', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1, max: 10 }),
        (c, l) => {
          const lay = layout({ colunas: c, linhas: l })
          expect(encaixeParaSvg(lay, { orcamentoNumero: 1 })).toBe(encaixeParaSvg(lay, { orcamentoNumero: 1 }))
        },
      ),
    )
  })

  it('P9c: escapa caracteres especiais na descrição', () => {
    const svg = encaixeParaSvg(layout(), { itemDescricao: 'Caixa <A&B>' })!
    expect(svg).toContain('Caixa &lt;A&amp;B&gt;')
    expect(svg).not.toContain('Caixa <A&B>')
  })
})
