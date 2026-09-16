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
    // PENDENTE não pode pular direto para PRECIFICADA/CONVERTIDA
    expect(transicaoPermitida('PENDENTE', 'PRECIFICADA')).toBe(false)
    expect(transicaoPermitida('PENDENTE', 'CONVERTIDA')).toBe(false)
    // EM_ORCAMENTO não pode ir direto para CONVERTIDA (precisa precificar antes)
    expect(transicaoPermitida('EM_ORCAMENTO', 'CONVERTIDA')).toBe(false)
    // LIBERADA_PEDIDO não existe mais na Opção A
    expect(transicaoPermitida('PRECIFICADA', 'LIBERADA_PEDIDO')).toBe(false)
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

  it('cobre o caminho feliz completo (Opção A)', () => {
    const caminho: StatusSolicitacao[] = [
      'PENDENTE',
      'EM_ORCAMENTO',
      'PRECIFICADA',
      'CONVERTIDA',
    ]
    for (let i = 0; i < caminho.length - 1; i++) {
      expect(transicaoPermitida(caminho[i], caminho[i + 1])).toBe(true)
    }
  })
})
