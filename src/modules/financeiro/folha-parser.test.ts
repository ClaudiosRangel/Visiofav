/**
 * Testes do núcleo puro da folha de pagamento (D3).
 * Cobre Property 1 (líquido ≥ 0), Property 2 (totais), Property 6 (divergência)
 * e casos de CSV malformado.
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { calcularLiquido, calcularTotaisFolha, parsearCsvFolha } from './folha-parser'

describe('calcularLiquido', () => {
  it('proventos - descontos', () => {
    expect(calcularLiquido(3000, 800)).toBe(2200)
  })

  it('nunca negativo', () => {
    expect(calcularLiquido(500, 900)).toBe(0)
  })

  // Property 1: líquido = max(0, p - d), sempre >= 0
  it('Property 1: líquido é max(0, p-d) e nunca negativo', () => {
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: 1_000_000, noNaN: true }),
        fc.float({ min: 0, max: 1_000_000, noNaN: true }),
        (p, d) => {
          const liq = calcularLiquido(p, d)
          expect(liq).toBeGreaterThanOrEqual(0)
          const esperado = Math.max(0, Math.round((p - d) * 100) / 100)
          expect(Math.abs(liq - esperado)).toBeLessThanOrEqual(0.01)
        },
      ),
    )
  })
})

describe('calcularTotaisFolha', () => {
  it('soma líquidos e encargos', () => {
    const r = calcularTotaisFolha(
      [{ liquido: 2200 }, { liquido: 1800 }],
      [{ valor: 500 }, { valor: 300 }],
    )
    expect(r.totalLiquido).toBe(4000)
    expect(r.totalEncargos).toBe(800)
    expect(r.totalGeral).toBe(4800)
  })

  // Property 2: totais consistentes
  it('Property 2: totalGeral = totalLiquido + totalEncargos', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ liquido: fc.float({ min: 0, max: 100_000, noNaN: true }) }), { maxLength: 30 }),
        fc.array(fc.record({ valor: fc.float({ min: 0, max: 100_000, noNaN: true }) }), { maxLength: 30 }),
        (itens, encargos) => {
          const r = calcularTotaisFolha(itens, encargos)
          expect(Math.abs(r.totalGeral - (r.totalLiquido + r.totalEncargos))).toBeLessThanOrEqual(0.01)
        },
      ),
    )
  })
})

describe('parsearCsvFolha', () => {
  it('interpreta CSV com cabeçalho cpf/proventos/descontos/liquido', () => {
    const csv = [
      'cpf,proventos,descontos,liquido',
      '529.982.247-25,3000.00,800.00,2200.00',
      '111.444.777-35,2500.00,500.00,2000.00',
    ].join('\n')
    const { linhas, erros } = parsearCsvFolha(csv)
    expect(erros.length).toBe(0)
    expect(linhas.length).toBe(2)
    expect(linhas[0].identificador).toBe('52998224725') // só dígitos (CPF 11)
    expect(linhas[0].liquido).toBe(2200)
    expect(linhas[0].divergencia).toBe(false)
  })

  it('aceita separador ; e formato BR de valor', () => {
    const csv = ['matricula;proventos;descontos', 'M001;1.234,56;234,56'].join('\n')
    const { linhas, erros } = parsearCsvFolha(csv)
    expect(erros.length).toBe(0)
    expect(linhas[0].identificador).toBe('M001')
    expect(linhas[0].proventos).toBe(1234.56)
    expect(linhas[0].liquido).toBe(1000) // derivado (1234,56 - 234,56)
  })

  it('detecta divergência quando líquido informado não bate (Property 6)', () => {
    const csv = ['cpf,proventos,descontos,liquido', '52998224725,3000,800,9999'].join('\n')
    const { linhas } = parsearCsvFolha(csv)
    expect(linhas[0].divergencia).toBe(true)
  })

  it('CSV vazio → erro, sem linhas', () => {
    const r = parsearCsvFolha('')
    expect(r.linhas.length).toBe(0)
    expect(r.erros.length).toBeGreaterThan(0)
  })

  it('CSV só com cabeçalho → erro', () => {
    const r = parsearCsvFolha('cpf,proventos,descontos,liquido')
    expect(r.linhas.length).toBe(0)
    expect(r.erros.length).toBeGreaterThan(0)
  })

  it('sem coluna de identificação → erro', () => {
    const r = parsearCsvFolha(['proventos,descontos', '1000,200'].join('\n'))
    expect(r.linhas.length).toBe(0)
    expect(r.erros[0]).toContain('identificação')
  })

  it('linha sem identificador é ignorada com aviso', () => {
    const csv = ['cpf,proventos', ',1000', '52998224725,2000'].join('\n')
    const { linhas, erros } = parsearCsvFolha(csv)
    expect(linhas.length).toBe(1)
    expect(erros.some((e) => e.includes('vazio'))).toBe(true)
  })
})
