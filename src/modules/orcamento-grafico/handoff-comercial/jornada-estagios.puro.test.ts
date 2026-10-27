import { describe, it, expect } from 'vitest'
import { montarEstagios } from './jornada-estagios.puro'

describe('montarEstagios (régua da jornada do pedido)', () => {
  it('pedido direto sem amostra: 4 estágios (sem AMOSTRA)', () => {
    const est = montarEstagios({
      statusPedido: 'RASCUNHO',
      orcamento: null,
      exigeAmostra: false,
      amostraAprovada: false,
      temAmostra: false,
      ops: [],
    })
    expect(est.map((e) => e.chave)).toEqual(['ORCAMENTO', 'PEDIDO', 'PRODUCAO', 'FATURAMENTO'])
    expect(est.find((e) => e.chave === 'PEDIDO')?.estado).toBe('ATUAL')
  })

  it('exige amostra insere estágio AMOSTRA entre orçamento e pedido', () => {
    const est = montarEstagios({
      statusPedido: 'CONFIRMADO',
      orcamento: { status: 'CONVERTIDO' },
      exigeAmostra: true,
      amostraAprovada: true,
      temAmostra: true,
      ops: [],
    })
    expect(est.map((e) => e.chave)).toEqual(['ORCAMENTO', 'AMOSTRA', 'PEDIDO', 'PRODUCAO', 'FATURAMENTO'])
    expect(est.find((e) => e.chave === 'AMOSTRA')?.estado).toBe('CONCLUIDO')
    expect(est.find((e) => e.chave === 'PEDIDO')?.estado).toBe('CONCLUIDO')
  })

  it('amostra exigida e não solicitada fica PENDENTE', () => {
    const est = montarEstagios({
      statusPedido: 'RASCUNHO',
      orcamento: { status: 'APROVADO' },
      exigeAmostra: true,
      amostraAprovada: false,
      temAmostra: false,
      ops: [],
    })
    expect(est.find((e) => e.chave === 'AMOSTRA')?.estado).toBe('PENDENTE')
  })

  it('produção concluída quando todas as OPs estão CONCLUIDA', () => {
    const est = montarEstagios({
      statusPedido: 'EFETIVADO',
      orcamento: null,
      exigeAmostra: false,
      amostraAprovada: false,
      temAmostra: false,
      ops: [{ status: 'CONCLUIDA' }, { status: 'CONCLUIDA' }],
    })
    expect(est.find((e) => e.chave === 'PRODUCAO')?.estado).toBe('CONCLUIDO')
    expect(est.find((e) => e.chave === 'FATURAMENTO')?.estado).toBe('ATUAL')
  })

  it('produção parcial fica ATUAL com contador', () => {
    const est = montarEstagios({
      statusPedido: 'CONFIRMADO',
      orcamento: null,
      exigeAmostra: false,
      amostraAprovada: false,
      temAmostra: false,
      ops: [{ status: 'CONCLUIDA' }, { status: 'EM_PRODUCAO' }],
    })
    const prod = est.find((e) => e.chave === 'PRODUCAO')
    expect(prod?.estado).toBe('ATUAL')
    expect(prod?.detalhe).toContain('1/2')
  })

  it('pedido cancelado bloqueia o estágio PEDIDO', () => {
    const est = montarEstagios({
      statusPedido: 'CANCELADO',
      orcamento: null,
      exigeAmostra: false,
      amostraAprovada: false,
      temAmostra: false,
      ops: [],
    })
    expect(est.find((e) => e.chave === 'PEDIDO')?.estado).toBe('BLOQUEADO')
  })

  it('faturado conclui o estágio FATURAMENTO', () => {
    const est = montarEstagios({
      statusPedido: 'FATURADO',
      orcamento: null,
      exigeAmostra: false,
      amostraAprovada: false,
      temAmostra: false,
      ops: [{ status: 'CONCLUIDA' }],
    })
    expect(est.find((e) => e.chave === 'FATURAMENTO')?.estado).toBe('CONCLUIDO')
  })
})
