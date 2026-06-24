import { describe, it, expect } from 'vitest'
import { PatioService } from '../../src/modules/patio/patio.service'

/**
 * Unit tests for status transition guards (Task 8.3)
 * Validates: Requirements 6.3, 7.3
 */
describe('PatioService - Guards de Transição de Status', () => {
  const service = new PatioService()

  // Helper to create a minimal VeiculoPatio-like object with a given status
  const criarVeiculoComStatus = (status: string) =>
    ({ status } as any)

  describe('validarStatusParaConferencia', () => {
    it('should NOT throw when status is NA_DOCA', () => {
      const veiculo = criarVeiculoComStatus('NA_DOCA')
      expect(() => service.validarStatusParaConferencia(veiculo)).not.toThrow()
    })

    it('should throw 422 when status is AGUARDANDO', () => {
      const veiculo = criarVeiculoComStatus('AGUARDANDO')
      expect(() => service.validarStatusParaConferencia(veiculo)).toThrow(
        expect.objectContaining({
          statusCode: 422,
          message: 'Veículo deve estar na doca para iniciar conferência',
        }),
      )
    })

    it('should throw 422 when status is CHAMADO', () => {
      const veiculo = criarVeiculoComStatus('CHAMADO')
      expect(() => service.validarStatusParaConferencia(veiculo)).toThrow(
        expect.objectContaining({
          statusCode: 422,
          message: 'Veículo deve estar na doca para iniciar conferência',
        }),
      )
    })

    it('should throw 422 when status is CONFERINDO', () => {
      const veiculo = criarVeiculoComStatus('CONFERINDO')
      expect(() => service.validarStatusParaConferencia(veiculo)).toThrow(
        expect.objectContaining({
          statusCode: 422,
          message: 'Veículo deve estar na doca para iniciar conferência',
        }),
      )
    })

    it('should throw 422 when status is CONFERIDO', () => {
      const veiculo = criarVeiculoComStatus('CONFERIDO')
      expect(() => service.validarStatusParaConferencia(veiculo)).toThrow(
        expect.objectContaining({
          statusCode: 422,
          message: 'Veículo deve estar na doca para iniciar conferência',
        }),
      )
    })

    it('should throw 422 when status is LIBERADO', () => {
      const veiculo = criarVeiculoComStatus('LIBERADO')
      expect(() => service.validarStatusParaConferencia(veiculo)).toThrow(
        expect.objectContaining({
          statusCode: 422,
          message: 'Veículo deve estar na doca para iniciar conferência',
        }),
      )
    })
  })

  describe('validarStatusParaLiberacao', () => {
    it('should NOT throw when status is CONFERIDO', () => {
      const veiculo = criarVeiculoComStatus('CONFERIDO')
      expect(() => service.validarStatusParaLiberacao(veiculo)).not.toThrow()
    })

    it('should throw 422 when status is AGUARDANDO', () => {
      const veiculo = criarVeiculoComStatus('AGUARDANDO')
      expect(() => service.validarStatusParaLiberacao(veiculo)).toThrow(
        expect.objectContaining({
          statusCode: 422,
          message: 'Conferência deve ser concluída antes da liberação',
        }),
      )
    })

    it('should throw 422 when status is CHAMADO', () => {
      const veiculo = criarVeiculoComStatus('CHAMADO')
      expect(() => service.validarStatusParaLiberacao(veiculo)).toThrow(
        expect.objectContaining({
          statusCode: 422,
          message: 'Conferência deve ser concluída antes da liberação',
        }),
      )
    })

    it('should throw 422 when status is NA_DOCA', () => {
      const veiculo = criarVeiculoComStatus('NA_DOCA')
      expect(() => service.validarStatusParaLiberacao(veiculo)).toThrow(
        expect.objectContaining({
          statusCode: 422,
          message: 'Conferência deve ser concluída antes da liberação',
        }),
      )
    })

    it('should throw 422 when status is CONFERINDO', () => {
      const veiculo = criarVeiculoComStatus('CONFERINDO')
      expect(() => service.validarStatusParaLiberacao(veiculo)).toThrow(
        expect.objectContaining({
          statusCode: 422,
          message: 'Conferência deve ser concluída antes da liberação',
        }),
      )
    })

    it('should throw 422 when status is LIBERADO', () => {
      const veiculo = criarVeiculoComStatus('LIBERADO')
      expect(() => service.validarStatusParaLiberacao(veiculo)).toThrow(
        expect.objectContaining({
          statusCode: 422,
          message: 'Conferência deve ser concluída antes da liberação',
        }),
      )
    })
  })
})
