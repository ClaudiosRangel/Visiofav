import { describe, it, expect, beforeEach } from 'vitest'
import { EtiquetasZplService } from './etiquetas-zpl.service'

describe('EtiquetasZplService - validarZpl', () => {
  let service: EtiquetasZplService

  beforeEach(() => {
    service = new EtiquetasZplService()
  })

  it('deve aceitar ZPL válido com ^XA e ^XZ', () => {
    const zpl = '^XA^FO50,50^A0N,40,40^FDHello World^FS^XZ'
    const resultado = service.validarZpl(zpl)

    expect(resultado.valido).toBe(true)
    expect(resultado.erros).toHaveLength(0)
  })

  it('deve rejeitar ZPL sem ^XA no início', () => {
    const zpl = '^FO50,50^A0N,40,40^FDHello^FS^XZ'
    const resultado = service.validarZpl(zpl)

    expect(resultado.valido).toBe(false)
    expect(resultado.erros).toContain('ZPL deve iniciar com ^XA')
  })

  it('deve rejeitar ZPL com ^XA/^XZ desbalanceados', () => {
    const zpl = '^XA^FO50,50^XA^FDHello^FS^XZ'
    const resultado = service.validarZpl(zpl)

    expect(resultado.valido).toBe(false)
    expect(resultado.erros.some(e => e.includes('Desbalanceamento'))).toBe(true)
  })
})

describe('EtiquetasZplService - substituirPlaceholders', () => {
  let service: EtiquetasZplService

  beforeEach(() => {
    service = new EtiquetasZplService()
  })

  it('deve substituir todos placeholders corretamente', () => {
    const zpl = '^XA^FO50,50^FD{{produto}}^FS^FO50,100^FD{{codigo}}^FS^XZ'
    const dados = { produto: 'Parafuso M6', codigo: '7891234567890' }

    const resultado = service.substituirPlaceholders(zpl, dados)

    expect(resultado).toBe('^XA^FO50,50^FDParafuso M6^FS^FO50,100^FD7891234567890^FS^XZ')
  })

  it('deve substituir múltiplas ocorrências do mesmo placeholder', () => {
    const zpl = '^XA^FD{{nome}}^FS^FD{{nome}}^FS^XZ'
    const dados = { nome: 'Teste' }

    const resultado = service.substituirPlaceholders(zpl, dados)

    expect(resultado).toBe('^XA^FDTeste^FS^FDTeste^FS^XZ')
  })
})

describe('EtiquetasZplService - extrairPlaceholders', () => {
  let service: EtiquetasZplService

  beforeEach(() => {
    service = new EtiquetasZplService()
  })

  it('deve encontrar todos os padrões {{campo}}', () => {
    const zpl = '^XA^FD{{produto}}^FS^FD{{codigo}}^FS^FD{{lote}}^FS^XZ'

    const placeholders = service.extrairPlaceholders(zpl)

    expect(placeholders).toContain('produto')
    expect(placeholders).toContain('codigo')
    expect(placeholders).toContain('lote')
    expect(placeholders).toHaveLength(3)
  })

  it('deve retornar placeholders sem duplicatas', () => {
    const zpl = '^XA^FD{{nome}}^FS^FD{{nome}}^FS^FD{{codigo}}^FS^XZ'

    const placeholders = service.extrairPlaceholders(zpl)

    expect(placeholders).toHaveLength(2)
    expect(placeholders).toContain('nome')
    expect(placeholders).toContain('codigo')
  })

  it('deve retornar array vazio quando não há placeholders', () => {
    const zpl = '^XA^FDTexto fixo^FS^XZ'

    const placeholders = service.extrairPlaceholders(zpl)

    expect(placeholders).toHaveLength(0)
  })
})
