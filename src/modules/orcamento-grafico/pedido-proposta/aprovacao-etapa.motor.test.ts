/**
 * Regras novas do workflow Mockup/Arte (reunião 24/11/2026) no motor de aprovação.
 * Rodar: npx vitest run src/modules/orcamento-grafico/pedido-proposta/aprovacao-etapa.motor.test.ts --reporter=dot
 */
import { describe, it, expect } from 'vitest'
import { validarDecisao, validarEtapaAprovacao, AprovacaoArteError } from './aprovacao-arte.motor'

const agora = new Date('2026-01-02T00:00:00.000Z')
const amanha = new Date('2026-01-03T00:00:00.000Z')

describe('cancelamento pelo cliente exige motivo', () => {
  it('sem motivo → 400 MOTIVO_OBRIGATORIO', () => {
    expect(() => validarDecisao('PENDENTE', amanha, agora, 'CANCELADA_CLIENTE')).toThrowError(AprovacaoArteError)
    try {
      validarDecisao('PENDENTE', amanha, agora, 'CANCELADA_CLIENTE', '   ')
    } catch (e) {
      expect((e as AprovacaoArteError).code).toBe('MOTIVO_OBRIGATORIO')
      expect((e as AprovacaoArteError).statusCode).toBe(400)
    }
  })
  it('com motivo → ok', () => {
    expect(() => validarDecisao('PENDENTE', amanha, agora, 'CANCELADA_CLIENTE', 'desistimos do projeto')).not.toThrow()
  })
  it('alteração sem descrição → 400; com descrição → ok', () => {
    expect(() => validarDecisao('PENDENTE', amanha, agora, 'AJUSTE_SOLICITADO')).toThrowError(AprovacaoArteError)
    expect(() => validarDecisao('PENDENTE', amanha, agora, 'AJUSTE_SOLICITADO', 'trocar a cor')).not.toThrow()
  })
  it('aprovar não exige motivo', () => {
    expect(() => validarDecisao('PENDENTE', amanha, agora, 'APROVADA')).not.toThrow()
  })
  it('link já respondido → 409', () => {
    expect(() => validarDecisao('CANCELADA_CLIENTE', amanha, agora, 'APROVADA')).toThrowError(/já foi respondido/)
  })
})

describe('validarEtapaAprovacao', () => {
  it('aceita MOCKUP e ARTE', () => {
    expect(validarEtapaAprovacao('MOCKUP')).toBe('MOCKUP')
    expect(validarEtapaAprovacao('ARTE')).toBe('ARTE')
  })
  it('rejeita outras etapas', () => {
    expect(() => validarEtapaAprovacao('PADRAO')).toThrowError(AprovacaoArteError)
  })
})
