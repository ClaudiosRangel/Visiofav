/**
 * Testes do motor puro do Board da Pré-Impressão.
 * Rodar: npx vitest run src/modules/orcamento-grafico/pedido-proposta/pre-impressao.motor.test.ts --reporter=dot
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  ETAPAS,
  STATUS_VALIDOS,
  etapasRelevantes,
  boardConcluido,
  validarStatus,
  validarEtapa,
  PreImpressaoError,
  type Caminho,
  type EtapaPre,
  type StatusEtapa,
} from './pre-impressao.motor'

const CAMINHOS: Caminho[] = ['CONFERENCIA', 'PARCIAL', 'COMPLETA']

describe('P1 — etapasRelevantes subconjunto de ETAPAS', () => {
  it('determinística e sempre subconjunto de ETAPAS', () => {
    for (const c of CAMINHOS) {
      const r = etapasRelevantes(c)
      expect(r).toEqual(etapasRelevantes(c)) // determinística
      for (const e of r) expect(ETAPAS).toContain(e)
    }
  })
  it('COMPLETA tem as 4; PARCIAL sem mockup; CONFERENCIA arte+ficha', () => {
    expect(etapasRelevantes('COMPLETA')).toEqual(['MOCKUP', 'ARTE', 'PADRAO', 'FICHA_TECNICA'])
    expect(etapasRelevantes('PARCIAL')).toEqual(['ARTE', 'PADRAO', 'FICHA_TECNICA'])
    expect(etapasRelevantes('CONFERENCIA')).toEqual(['ARTE', 'FICHA_TECNICA'])
  })
})

describe('P2 — boardConcluido', () => {
  it('true só quando todas as relevantes CONCLUIDA', () => {
    // CONFERENCIA: só ARTE+FICHA precisam estar concluídas
    expect(boardConcluido('CONFERENCIA', { ARTE: 'CONCLUIDA', FICHA_TECNICA: 'CONCLUIDA' })).toBe(true)
    expect(boardConcluido('CONFERENCIA', { ARTE: 'CONCLUIDA', FICHA_TECNICA: 'PENDENTE' })).toBe(false)
    // COMPLETA: mockup pendente derruba
    expect(boardConcluido('COMPLETA', { MOCKUP: 'PENDENTE', ARTE: 'CONCLUIDA', PADRAO: 'CONCLUIDA', FICHA_TECNICA: 'CONCLUIDA' })).toBe(false)
    expect(boardConcluido('COMPLETA', { MOCKUP: 'CONCLUIDA', ARTE: 'CONCLUIDA', PADRAO: 'CONCLUIDA', FICHA_TECNICA: 'CONCLUIDA' })).toBe(true)
  })

  it('property: concluído ⟺ relevantes todas CONCLUIDA', () => {
    const arbStatus = fc.constantFrom<StatusEtapa>('PENDENTE', 'EM_ANDAMENTO', 'CONCLUIDA')
    fc.assert(
      fc.property(
        fc.constantFrom(...CAMINHOS),
        fc.record({ MOCKUP: arbStatus, ARTE: arbStatus, PADRAO: arbStatus, FICHA_TECNICA: arbStatus }),
        (c, st) => {
          const esperado = etapasRelevantes(c).every((e) => st[e] === 'CONCLUIDA')
          expect(boardConcluido(c, st)).toBe(esperado)
        },
      ),
    )
  })
})

describe('P3 — validarStatus / validarEtapa', () => {
  it('aceita só os 3 status', () => {
    for (const s of STATUS_VALIDOS) expect(validarStatus(s)).toBe(s)
    expect(() => validarStatus('X')).toThrow(PreImpressaoError)
    try { validarStatus('X') } catch (e) { expect((e as PreImpressaoError).code).toBe('STATUS_ETAPA_INVALIDO') }
  })
  it('valida etapa', () => {
    for (const e of ETAPAS) expect(validarEtapa(e)).toBe(e)
    expect(() => validarEtapa('FOO')).toThrow(PreImpressaoError)
  })
})

import { resumoEtapasTooltip } from './pre-impressao.motor'

describe('resumoEtapasTooltip', () => {
  it('marca a etapa ATUAL como a 1ª relevante não concluída (caminho COMPLETA)', () => {
    const r = resumoEtapasTooltip('COMPLETA', { MOCKUP: 'CONCLUIDA', ARTE: 'EM_ANDAMENTO' })
    expect(r.map((e) => e.etapa)).toEqual(['MOCKUP', 'ARTE', 'PADRAO', 'FICHA_TECNICA'])
    expect(r.find((e) => e.etapa === 'ARTE')?.atual).toBe(true)
    expect(r.find((e) => e.etapa === 'MOCKUP')?.atual).toBe(false)
    expect(r.every((e) => e.relevante)).toBe(true)
  })

  it('CONFERENCIA: só ARTE e FICHA_TECNICA são relevantes; atual é a 1ª não concluída', () => {
    const r = resumoEtapasTooltip('CONFERENCIA', { ARTE: 'CONCLUIDA' })
    expect(r.find((e) => e.etapa === 'MOCKUP')?.relevante).toBe(false)
    expect(r.find((e) => e.etapa === 'FICHA_TECNICA')?.atual).toBe(true)
  })

  it('tudo concluído: nenhuma etapa marcada como atual', () => {
    const r = resumoEtapasTooltip('PARCIAL', { ARTE: 'CONCLUIDA', PADRAO: 'CONCLUIDA', FICHA_TECNICA: 'CONCLUIDA' })
    expect(r.some((e) => e.atual)).toBe(false)
  })
})
