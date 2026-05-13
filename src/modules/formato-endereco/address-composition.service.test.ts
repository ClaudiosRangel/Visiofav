import { describe, it, expect } from 'vitest'
import {
  AddressCompositionService,
  FormatoEndereco,
  FormatoEnderecoSegmento,
} from './address-composition.service'

describe('AddressCompositionService', () => {
  const service = new AddressCompositionService()

  const formatoPortaPalete: FormatoEndereco = {
    id: '1',
    nome: 'Porta-palete',
    segmentos: [
      { nome: 'Depósito', campoFisico: 'codigoDeposito', ordem: 1, numerico: true },
      { nome: 'Zona', campoFisico: 'codigoZona', ordem: 2, numerico: true },
      { nome: 'Rua', campoFisico: 'codigoRua', ordem: 3, numerico: true },
      { nome: 'Prédio', campoFisico: 'codigoPredio', ordem: 4, numerico: true },
      { nome: 'Nível', campoFisico: 'codigoNivel', ordem: 5, numerico: true },
      { nome: 'Apto', campoFisico: 'codigoApto', ordem: 6, numerico: true },
    ],
    empresaId: 'emp-1',
    criadoEm: new Date(),
  }

  const formatoDoca: FormatoEndereco = {
    id: '2',
    nome: 'Doca',
    segmentos: [
      { nome: 'Código', campoFisico: 'codigoRua', ordem: 1, numerico: true, prefixo: 'DOCA' },
    ],
    empresaId: 'emp-1',
    criadoEm: new Date(),
  }

  const formatoPicking: FormatoEndereco = {
    id: '3',
    nome: 'Picking de chão',
    segmentos: [
      { nome: 'Zona', campoFisico: 'codigoZona', ordem: 1, numerico: true },
      { nome: 'Posição', campoFisico: 'codigoRua', ordem: 2, numerico: true },
    ],
    empresaId: 'emp-1',
    criadoEm: new Date(),
  }

  describe('formatarSegmento', () => {
    it('aplica zero-padding de 3 dígitos para segmentos numéricos', () => {
      const segmento: FormatoEnderecoSegmento = {
        nome: 'Rua',
        campoFisico: 'codigoRua',
        ordem: 1,
        numerico: true,
      }

      expect(service.formatarSegmento(segmento, 1)).toBe('001')
      expect(service.formatarSegmento(segmento, 42)).toBe('042')
      expect(service.formatarSegmento(segmento, 999)).toBe('999')
    })

    it('aplica zero-padding quando valor é string numérica', () => {
      const segmento: FormatoEnderecoSegmento = {
        nome: 'Rua',
        campoFisico: 'codigoRua',
        ordem: 1,
        numerico: true,
      }

      expect(service.formatarSegmento(segmento, '5')).toBe('005')
      expect(service.formatarSegmento(segmento, '12')).toBe('012')
    })

    it('aplica prefixo quando configurado em segmento numérico', () => {
      const segmento: FormatoEnderecoSegmento = {
        nome: 'Código',
        campoFisico: 'codigoRua',
        ordem: 1,
        numerico: true,
        prefixo: 'DOCA',
      }

      expect(service.formatarSegmento(segmento, 1)).toBe('DOCA001')
      expect(service.formatarSegmento(segmento, 15)).toBe('DOCA015')
    })

    it('aplica prefixo em segmento não-numérico', () => {
      const segmento: FormatoEnderecoSegmento = {
        nome: 'Área',
        campoFisico: 'codigoRua',
        ordem: 1,
        numerico: false,
        prefixo: 'AVARIA',
      }

      expect(service.formatarSegmento(segmento, 'A')).toBe('AVARIAA')
    })

    it('retorna valor como string para segmento não-numérico sem prefixo', () => {
      const segmento: FormatoEnderecoSegmento = {
        nome: 'Código',
        campoFisico: 'codigoRua',
        ordem: 1,
        numerico: false,
      }

      expect(service.formatarSegmento(segmento, 'ABC')).toBe('ABC')
    })
  })

  describe('compor', () => {
    it('compõe endereço com formato de 6 segmentos (porta-palete)', () => {
      const valores = {
        codigoDeposito: 1,
        codigoZona: 2,
        codigoRua: 3,
        codigoPredio: 4,
        codigoNivel: 5,
        codigoApto: 6,
      }

      const resultado = service.compor(formatoPortaPalete, valores)
      expect(resultado).toBe('001-002-003-004-005-006')
    })

    it('compõe endereço com formato de 1 segmento com prefixo (doca)', () => {
      const valores = { codigoRua: 1 }

      const resultado = service.compor(formatoDoca, valores)
      expect(resultado).toBe('DOCA001')
    })

    it('compõe endereço com formato de 2 segmentos (picking)', () => {
      const valores = { codigoZona: 1, codigoRua: 15 }

      const resultado = service.compor(formatoPicking, valores)
      expect(resultado).toBe('001-015')
    })

    it('respeita a ordem dos segmentos independente da ordem no array', () => {
      const formatoDesordenado: FormatoEndereco = {
        id: '4',
        nome: 'Desordenado',
        segmentos: [
          { nome: 'Prédio', campoFisico: 'codigoPredio', ordem: 2, numerico: true },
          { nome: 'Rua', campoFisico: 'codigoRua', ordem: 1, numerico: true },
        ],
        empresaId: 'emp-1',
        criadoEm: new Date(),
      }

      const valores = { codigoRua: 5, codigoPredio: 10 }
      const resultado = service.compor(formatoDesordenado, valores)
      expect(resultado).toBe('005-010')
    })
  })

  describe('decompor', () => {
    it('decompõe endereço de 6 segmentos corretamente', () => {
      const resultado = service.decompor(formatoPortaPalete, '001-002-003-004-005-006')

      expect(resultado).toEqual({
        codigoDeposito: '001',
        codigoZona: '002',
        codigoRua: '003',
        codigoPredio: '004',
        codigoNivel: '005',
        codigoApto: '006',
      })
    })

    it('decompõe endereço de 1 segmento com prefixo', () => {
      const resultado = service.decompor(formatoDoca, 'DOCA001')

      expect(resultado).toEqual({
        codigoRua: 'DOCA001',
      })
    })

    it('decompõe endereço de 2 segmentos', () => {
      const resultado = service.decompor(formatoPicking, '001-015')

      expect(resultado).toEqual({
        codigoZona: '001',
        codigoRua: '015',
      })
    })

    it('lança erro quando número de segmentos não corresponde ao formato', () => {
      expect(() => service.decompor(formatoPortaPalete, '001-002-003')).toThrow(
        "Endereço '001-002-003' não corresponde ao formato 'Porta-palete': esperados 6 segmentos, encontrados 3"
      )
    })

    it('lança erro com mensagem descritiva em português', () => {
      expect(() => service.decompor(formatoPicking, '001-002-003')).toThrow(
        "Endereço '001-002-003' não corresponde ao formato 'Picking de chão': esperados 2 segmentos, encontrados 3"
      )
    })
  })

  describe('validar', () => {
    it('retorna valido=true para endereço compatível com formato de 6 segmentos', () => {
      const resultado = service.validar(formatoPortaPalete, '001-002-003-004-005-006')
      expect(resultado).toEqual({ valido: true })
    })

    it('retorna valido=true para endereço compatível com formato de 1 segmento', () => {
      const resultado = service.validar(formatoDoca, 'DOCA001')
      expect(resultado).toEqual({ valido: true })
    })

    it('retorna valido=false com erro descritivo quando segmentos não correspondem', () => {
      const resultado = service.validar(formatoPortaPalete, '001-002-003')

      expect(resultado.valido).toBe(false)
      expect(resultado.erro).toBe(
        "Endereço '001-002-003' não corresponde ao formato 'Porta-palete': esperados 6 segmentos, encontrados 3"
      )
    })

    it('retorna valido=false quando há segmentos a mais', () => {
      const resultado = service.validar(formatoPicking, '001-002-003-004')

      expect(resultado.valido).toBe(false)
      expect(resultado.erro).toContain('esperados 2 segmentos, encontrados 4')
    })
  })

  describe('round-trip compor/decompor', () => {
    it('decompor(compor(valores)) retorna valores equivalentes para porta-palete', () => {
      const valores = {
        codigoDeposito: 1,
        codigoZona: 2,
        codigoRua: 3,
        codigoPredio: 4,
        codigoNivel: 5,
        codigoApto: 6,
      }

      const composto = service.compor(formatoPortaPalete, valores)
      const decomposto = service.decompor(formatoPortaPalete, composto)

      expect(decomposto).toEqual({
        codigoDeposito: '001',
        codigoZona: '002',
        codigoRua: '003',
        codigoPredio: '004',
        codigoNivel: '005',
        codigoApto: '006',
      })
    })

    it('decompor(compor(valores)) retorna valores equivalentes para picking', () => {
      const valores = { codigoZona: 10, codigoRua: 25 }

      const composto = service.compor(formatoPicking, valores)
      const decomposto = service.decompor(formatoPicking, composto)

      expect(decomposto).toEqual({
        codigoZona: '010',
        codigoRua: '025',
      })
    })
  })
})
