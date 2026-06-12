import { describe, it, expect } from 'vitest'
import {
  filtrarDadosConforme,
  validarCamposObrigatorios,
  ConfigConferenciaCega,
  ItemConferenciaInput,
  PayloadConferencia,
  ProdutoConfig,
} from './conferencia-cega.service'

// ─── Helpers ───────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<ItemConferenciaInput> = {}): ItemConferenciaInput {
  return {
    id: 'item-001',
    descricao: 'Produto Teste',
    codigoProduto: 'PROD-001',
    unidade: 'UN',
    quantidadeEsperada: 100,
    lote: 'LOTE-ABC',
    validade: new Date('2025-12-31'),
    ...overrides,
  }
}

function makePayload(overrides: Partial<PayloadConferencia> = {}): PayloadConferencia {
  return {
    itemNotaEntradaId: 'item-001',
    quantidadeConferida: 95,
    lote: 'LOTE-XYZ',
    ...overrides,
  }
}

// ─── filtrarDadosConforme ──────────────────────────────────────────────────────

describe('filtrarDadosConforme', () => {
  it('deve incluir quantidadeEsperada e lote quando ambas configs inativas', () => {
    const config: ConfigConferenciaCega = {
      conferenciaQuantidadeCega: false,
      conferenciaLoteCega: false,
    }
    const item = makeItem()
    const dto = filtrarDadosConforme(item, config)

    expect(dto.quantidadeEsperada).toBe(100)
    expect(dto.lote).toBe('LOTE-ABC')
  })

  it('deve omitir quantidadeEsperada quando conferência quantidade cega ativa', () => {
    const config: ConfigConferenciaCega = {
      conferenciaQuantidadeCega: true,
      conferenciaLoteCega: false,
    }
    const item = makeItem()
    const dto = filtrarDadosConforme(item, config)

    expect(dto.quantidadeEsperada).toBeUndefined()
    expect(dto.lote).toBe('LOTE-ABC')
  })

  it('deve omitir lote quando conferência lote cega ativa', () => {
    const config: ConfigConferenciaCega = {
      conferenciaQuantidadeCega: false,
      conferenciaLoteCega: true,
    }
    const item = makeItem()
    const dto = filtrarDadosConforme(item, config)

    expect(dto.quantidadeEsperada).toBe(100)
    expect(dto.lote).toBeUndefined()
  })

  it('deve omitir ambos quando ambas configs ativas', () => {
    const config: ConfigConferenciaCega = {
      conferenciaQuantidadeCega: true,
      conferenciaLoteCega: true,
    }
    const item = makeItem()
    const dto = filtrarDadosConforme(item, config)

    expect(dto.quantidadeEsperada).toBeUndefined()
    expect(dto.lote).toBeUndefined()
  })

  it('deve sempre manter campos base (id, descricao, codigoProduto, unidade, validade)', () => {
    const config: ConfigConferenciaCega = {
      conferenciaQuantidadeCega: true,
      conferenciaLoteCega: true,
    }
    const item = makeItem()
    const dto = filtrarDadosConforme(item, config)

    expect(dto.id).toBe('item-001')
    expect(dto.descricao).toBe('Produto Teste')
    expect(dto.codigoProduto).toBe('PROD-001')
    expect(dto.unidade).toBe('UN')
    expect(dto.validade).toEqual(new Date('2025-12-31'))
  })

  it('deve lidar com item sem lote (null)', () => {
    const config: ConfigConferenciaCega = {
      conferenciaQuantidadeCega: false,
      conferenciaLoteCega: false,
    }
    const item = makeItem({ lote: null })
    const dto = filtrarDadosConforme(item, config)

    expect(dto.lote).toBeNull()
  })
})

// ─── validarCamposObrigatorios ─────────────────────────────────────────────────

describe('validarCamposObrigatorios', () => {
  const configCega: ConfigConferenciaCega = {
    conferenciaQuantidadeCega: true,
    conferenciaLoteCega: true,
  }

  const configNormal: ConfigConferenciaCega = {
    conferenciaQuantidadeCega: false,
    conferenciaLoteCega: false,
  }

  const produtoComLote: ProdutoConfig = { exigeLote: true }
  const produtoSemLote: ProdutoConfig = { exigeLote: false }

  it('deve rejeitar quando quantidade cega ativa e quantidadeConferida null', () => {
    const payload = makePayload({ quantidadeConferida: null })
    const result = validarCamposObrigatorios(payload, configCega, produtoSemLote)

    expect(result.valido).toBe(false)
    expect(result.campo).toBe('quantidadeConferida')
  })

  it('deve rejeitar quando quantidade cega ativa e quantidadeConferida undefined', () => {
    const payload = makePayload({ quantidadeConferida: undefined })
    const result = validarCamposObrigatorios(payload, configCega, produtoSemLote)

    expect(result.valido).toBe(false)
    expect(result.campo).toBe('quantidadeConferida')
  })

  it('deve rejeitar por lote quando quantidade ok mas lote cega ativa e lote ausente', () => {
    const payload = makePayload({ quantidadeConferida: 50, lote: null })
    const result = validarCamposObrigatorios(payload, configCega, produtoSemLote)

    expect(result.valido).toBe(false)
    expect(result.campo).toBe('lote')
  })

  it('deve rejeitar quando lote cega ativa e lote não informado', () => {
    const payload = makePayload({ quantidadeConferida: 50, lote: null })
    const config: ConfigConferenciaCega = {
      conferenciaQuantidadeCega: false,
      conferenciaLoteCega: true,
    }
    const result = validarCamposObrigatorios(payload, config, produtoSemLote)

    expect(result.valido).toBe(false)
    expect(result.campo).toBe('lote')
  })

  it('deve rejeitar quando lote cega ativa e lote string vazia', () => {
    const payload = makePayload({ quantidadeConferida: 50, lote: '' })
    const config: ConfigConferenciaCega = {
      conferenciaQuantidadeCega: false,
      conferenciaLoteCega: true,
    }
    const result = validarCamposObrigatorios(payload, config, produtoSemLote)

    expect(result.valido).toBe(false)
    expect(result.campo).toBe('lote')
  })

  it('deve rejeitar quando produto.exigeLote=true e lote não informado', () => {
    const payload = makePayload({ quantidadeConferida: 50, lote: null })
    const result = validarCamposObrigatorios(payload, configNormal, produtoComLote)

    expect(result.valido).toBe(false)
    expect(result.campo).toBe('lote')
    expect(result.erro).toContain('obrigatório para este produto')
  })

  it('deve aceitar quando todas as validações passam', () => {
    const payload = makePayload({ quantidadeConferida: 50, lote: 'LOTE-123' })
    const result = validarCamposObrigatorios(payload, configCega, produtoComLote)

    expect(result.valido).toBe(true)
    expect(result.erro).toBeUndefined()
  })

  it('deve aceitar quando config normal e produto não exige lote', () => {
    const payload = makePayload({ quantidadeConferida: 50, lote: null })
    const result = validarCamposObrigatorios(payload, configNormal, produtoSemLote)

    expect(result.valido).toBe(true)
  })

  it('deve aceitar quantidade zero quando informada explicitamente', () => {
    const payload = makePayload({ quantidadeConferida: 0, lote: 'LOTE-A' })
    const result = validarCamposObrigatorios(payload, configCega, produtoSemLote)

    expect(result.valido).toBe(true)
  })
})
