import { describe, it, expect } from 'vitest'
import { fluxoPadrao, operacaoDoPedido, validarEtapas, EtapaConfig } from './fluxo-operacao.motor'
import { normalizarEtapaAtual } from './fluxo-pedido.service'

function com(ajuste: (e: EtapaConfig[]) => void): EtapaConfig[] {
  const e = fluxoPadrao('NOVO').etapas.map((x) => ({ ...x, bloqueia: [...x.bloqueia] }))
  ajuste(e)
  return e
}

describe('operacaoDoPedido com solicitaAlteracao', () => {
  it('novo ou repeticao com alteracao solicitada caem em ALTERACAO', () => {
    expect(operacaoDoPedido({ tipoPedido: 'NOVO', solicitaAlteracao: true })).toBe('ALTERACAO')
    expect(operacaoDoPedido({ tipoPedido: 'REPETICAO', solicitaAlteracao: true })).toBe('ALTERACAO')
  })
  it('mostruario e alteracao juntos: vale o fluxo de Mostruario', () => {
    expect(operacaoDoPedido({ tipoPedido: 'NOVO', exigeAmostra: true, solicitaAlteracao: true })).toBe('MOSTRUARIO')
  })
  it('sem alteracao, nada muda', () => {
    expect(operacaoDoPedido({ tipoPedido: 'REPETICAO', solicitaAlteracao: false })).toBe('REPETICAO')
  })
})

describe('OP/PCP automatica', () => {
  it('e preservada so na etapa OP_PCP ativa', () => {
    const e = com((l) => {
      l.find((x) => x.etapa === 'OP_PCP')!.automatica = true
      l.find((x) => x.etapa === 'FATURAMENTO')!.automatica = true
      l.find((x) => x.etapa === 'ORCAMENTO')!.automatica = true
    })
    const r = validarEtapas(e)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.etapas.find((x) => x.etapa === 'OP_PCP')!.automatica).toBe(true)
      expect(r.etapas.find((x) => x.etapa === 'FATURAMENTO')!.automatica).toBeUndefined()
      expect(r.etapas.find((x) => x.etapa === 'ORCAMENTO')!.automatica).toBeUndefined()
    }
  })
  it('padrao nao e automatico', () => {
    const r = validarEtapas(fluxoPadrao('NOVO').etapas)
    expect(r.ok && r.etapas.every((x) => !x.automatica)).toBe(true)
  })
  it('OP_PCP pulada perde a marca', () => {
    const e = com((l) => {
      const o = l.find((x) => x.etapa === 'OP_PCP')!
      o.ativa = false
      o.automatica = true
    })
    const r = validarEtapas(e)
    expect(r.ok && r.etapas.find((x) => x.etapa === 'OP_PCP')!.automatica).toBeFalsy()
  })
})

describe('normalizarEtapaAtual', () => {
  const etapas = fluxoPadrao('NOVO').etapas
  it('sem etapa salva assume a primeira ativa', () => {
    expect(normalizarEtapaAtual(etapas, null)).toBe('COMERCIAL')
  })
  it('mantem a etapa salva quando ativa', () => {
    expect(normalizarEtapaAtual(etapas, 'ORCAMENTO')).toBe('ORCAMENTO')
  })
  it('etapa pulada no fluxo segue para a proxima ativa', () => {
    const e = com((l) => { l.find((x) => x.etapa === 'PRE_IMPRESSAO')!.ativa = false })
    expect(normalizarEtapaAtual(e, 'PRE_IMPRESSAO')).toBe('OP_PCP')
  })
  it('concluido permanece concluido e valor invalido recomeca', () => {
    expect(normalizarEtapaAtual(etapas, 'CONCLUIDO')).toBe('CONCLUIDO')
    expect(normalizarEtapaAtual(etapas, 'XYZ')).toBe('COMERCIAL')
  })
  it('pulando ate o fim conclui', () => {
    const e = com((l) => { l.find((x) => x.etapa === 'FATURAMENTO')!.ativa = false })
    expect(normalizarEtapaAtual(e, 'FATURAMENTO')).toBe('CONCLUIDO')
  })
})
