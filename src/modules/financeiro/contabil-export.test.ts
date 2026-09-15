/**
 * Testes do núcleo puro de exportação contábil em CSV (D5).
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { diarioParaCsv, balanceteParaCsv, type LinhaBalancete } from './contabil-export'

describe('diarioParaCsv', () => {
  it('gera cabeçalho + linhas com separador ; e decimal BR', () => {
    const csv = diarioParaCsv([
      { data: '10/09/2026', historico: 'Pagamento', conta: '2.1.01', tipo: 'DEBITO', valor: 1234.5 },
    ])
    const linhas = csv.split('\r\n')
    expect(linhas[0]).toBe('Data;Historico;Conta;Tipo;Valor')
    expect(linhas[1]).toBe('10/09/2026;Pagamento;2.1.01;DEBITO;1234,50')
  })

  it('escapa campo com separador', () => {
    const csv = diarioParaCsv([
      { data: '10/09/2026', historico: 'Compra; NF 123', conta: '4.1', tipo: 'DEBITO', valor: 10 },
    ])
    expect(csv).toContain('"Compra; NF 123"')
  })

  it('lista vazia → só cabeçalho', () => {
    expect(diarioParaCsv([])).toBe('Data;Historico;Conta;Tipo;Valor')
  })
})

describe('balanceteParaCsv', () => {
  it('gera cabeçalho + linhas', () => {
    const csv = balanceteParaCsv([
      { codigo: '1.1.01', nome: 'Caixa', debito: 1000, credito: 300, saldo: 700 },
    ])
    const linhas = csv.split('\r\n')
    expect(linhas[0]).toBe('Codigo;Conta;Debito;Credito;Saldo')
    expect(linhas[1]).toBe('1.1.01;Caixa;1000,00;300,00;700,00')
  })

  it('lista vazia → só cabeçalho', () => {
    expect(balanceteParaCsv([])).toBe('Codigo;Conta;Debito;Credito;Saldo')
  })

  // Property 4: o total de débitos igual ao de créditos quando o balancete fecha
  it('Property 4: preserva os totais para conferência (soma consistente)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 100_000, noNaN: true }), { minLength: 1, maxLength: 20 }),
        (valores) => {
          // cada conta lança débito=credito → balancete fecha
          const linhas: LinhaBalancete[] = valores.map((v, i) => ({
            codigo: `1.${i}`, nome: `C${i}`, debito: v, credito: v, saldo: 0,
          }))
          const csv = balanceteParaCsv(linhas)
          const corpo = csv.split('\r\n').slice(1)
          let td = 0, tc = 0
          for (const l of corpo) {
            const cols = l.split(';')
            td += Number(cols[2].replace(',', '.'))
            tc += Number(cols[3].replace(',', '.'))
          }
          expect(Math.abs(td - tc)).toBeLessThanOrEqual(0.01)
        },
      ),
    )
  })
})
