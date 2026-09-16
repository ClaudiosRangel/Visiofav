import { describe, it, expect } from 'vitest'
import {
  transicaoPermitida,
  proximasTransicoes,
  TRANSICOES_VALIDAS,
  type StatusSolicitacao,
} from './solicitacao-status'

describe('Máquina de estados da Solicitação de Orçamento (Comercial)', () => {
  it('permite todas as transições declaradas no mapa', () => {
    for (const [de, paras] of Object.entries(TRANSICOES_VALIDAS)) {
      for (const para of paras) {
        expect(transicaoPermitida(de, para)).toBe(true)
      }
    }
  })

  it('bloqueia transições fora do mapa', () => {
    // PENDENTE não pode pular direto para PRECIFICADA/LIBERADA/CONVERTIDA
    expect(transicaoPermitida('PENDENTE', 'PRECIFICADA')).toBe(false)
    expect(transicaoPermitida('PENDENTE', 'LIBERADA_PEDIDO')).toBe(false)
    expect(transicaoPermitida('PENDENTE', 'CONVERTIDA')).toBe(false)
    // EM_ORCAMENTO não pode ir direto para LIBERADA/CONVERTIDA
    expect(transicaoPermitida('EM_ORCAMENTO', 'LIBERADA_PEDIDO')).toBe(false)
    expect(transicaoPermitida('EM_ORCAMENTO', 'CONVERTIDA')).toBe(false)
    // PRECIFICADA não converte sem liberar
    expect(transicaoPermitida('PRECIFICADA', 'CONVERTIDA')).toBe(false)
  })

  it('trata status terminais como sem saída', () => {
    expect(proximasTransicoes('CONVERTIDA')).toEqual([])
    expect(proximasTransicoes('RECUSADA')).toEqual([])
    expect(proximasTransicoes('CANCELADA')).toEqual([])
    expect(transicaoPermitida('CONVERTIDA', 'PENDENTE')).toBe(false)
  })

  it('retorna false/vazio para status desconhecido', () => {
    expect(transicaoPermitida('XPTO', 'PENDENTE')).toBe(false)
    expect(proximasTransicoes('XPTO')).toEqual([])
  })

  it('cobre o caminho feliz completo coordenado pelo Comercial', () => {
    const caminho: StatusSolicitacao[] = [
      'PENDENTE',
      'EM_ORCAMENTO',
      'PRECIFICADA',
      'LIBERADA_PEDIDO',
      'CONVERTIDA',
    ]
    for (let i = 0; i < caminho.length - 1; i++) {
      expect(transicaoPermitida(caminho[i], caminho[i + 1])).toBe(true)
    }
  })
})
