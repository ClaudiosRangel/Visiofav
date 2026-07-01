import { describe, it, expect } from 'vitest'
import { validarEstruturaSPED, type ResultadoValidacao } from './sped-validator'
import { SPEDWriter } from './sped-writer'

/**
 * Helper: gera um arquivo SPED Fiscal mínimo válido usando o SPEDWriter
 */
function gerarSPEDMinimoValido(): Buffer {
  const writer = new SPEDWriter()

  // Bloco 0 - Abertura e identificação
  writer.writeRegistro('0', '0000', ['018', '0', '01012024', '31012024', 'EMPRESA TESTE LTDA', '12345678000199', 'SP', '123456789', '1234567890', '3550308', '', '1', '1'])
  writer.writeRegistro('0', '0001', ['0'])
  writer.writeRegistro('0', '0005', ['EMPRESA TESTE', '12345-000', 'Rua Teste 123', '100', 'Sala 1', 'Centro', '11999999999', '1199999999', 'teste@teste.com'])
  writer.writeRegistro('0', '0100', ['Nome Contador', '12345678000100', '1SP123456', '11999999999', 'cont@teste.com', '3550308'])
  writer.writeRegistro('0', '0990', ['5'])

  // Bloco C - Documentos fiscais
  writer.writeRegistro('C', 'C001', ['0'])
  writer.writeRegistro('C', 'C100', ['0', '1', '123', '55', '00', '1', '1', '12345678000199', 'FORNECEDOR X', '01012024', '01012024', '1000.00', '0', '0.00', '0.00', '0.00', '1000.00', '9', '', '180.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', ''])
  writer.writeRegistro('C', 'C170', ['1', 'PROD001', 'Produto Teste', '10', 'UN', '100.00', '0.00', '0', '5102', '', '', '1000.00', '0.00', '180.00', '18.00', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''])
  writer.writeRegistro('C', 'C190', ['000', '5102', '18.00', '1000.00', '180.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00'])
  writer.writeRegistro('C', 'C990', ['5'])

  // Bloco D - Transportes
  writer.writeRegistro('D', 'D001', ['1']) // sem movimento
  writer.writeRegistro('D', 'D990', ['2'])

  // Bloco E - Apuração
  writer.writeRegistro('E', 'E001', ['0'])
  writer.writeRegistro('E', 'E100', ['01012024', '31012024'])
  writer.writeRegistro('E', 'E110', ['180.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '180.00', '0.00', '0.00', '180.00'])
  writer.writeRegistro('E', 'E990', ['4'])

  // Bloco G - CIAP
  writer.writeRegistro('G', 'G001', ['1']) // sem movimento
  writer.writeRegistro('G', 'G990', ['2'])

  // Bloco H - Inventário
  writer.writeRegistro('H', 'H001', ['1']) // sem movimento
  writer.writeRegistro('H', 'H990', ['2'])

  // Bloco K - Produção/Estoque
  writer.writeRegistro('K', 'K001', ['1']) // sem movimento
  writer.writeRegistro('K', 'K990', ['2'])

  // Bloco 1 - Complemento
  writer.writeRegistro('1', '1001', ['1']) // sem movimento
  writer.writeRegistro('1', '1990', ['2'])

  return writer.finalize()
}

describe('validarEstruturaSPED', () => {
  describe('arquivo válido', () => {
    it('deve retornar valido=true para arquivo SPED mínimo correto', () => {
      const buffer = gerarSPEDMinimoValido()
      const resultado = validarEstruturaSPED(buffer)

      expect(resultado.valido).toBe(true)
      expect(resultado.erros).toHaveLength(0)
    })

    it('deve aceitar arquivo com múltiplos registros C100/C170', () => {
      const writer = new SPEDWriter()

      writer.writeRegistro('0', '0000', ['018', '0', '01012024', '31012024', 'EMPRESA', '12345678000199', 'SP', '123456789', '1234567890', '3550308', '', '1', '1'])
      writer.writeRegistro('0', '0001', ['0'])
      writer.writeRegistro('0', '0990', ['3'])

      writer.writeRegistro('C', 'C001', ['0'])
      // Primeiro documento
      writer.writeRegistro('C', 'C100', ['0', '1', '100', '55', '00', '1', '1', '11111111000111', 'FORN A', '01012024', '01012024', '500.00', '0', '0', '0', '0', '500.00', '9', '', '90.00', '0', '0', '0', '0', '0', '0', '0', '0', ''])
      writer.writeRegistro('C', 'C170', ['1', 'P1', 'Prod 1', '5', 'UN', '100.00', '0', '0', '5102', '', '', '500.00', '0', '90.00', '18.00', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''])
      writer.writeRegistro('C', 'C190', ['000', '5102', '18.00', '500.00', '90.00', '0', '0', '0', '0', '0', '0', '0', '0'])
      // Segundo documento
      writer.writeRegistro('C', 'C100', ['0', '1', '101', '55', '00', '1', '1', '22222222000222', 'FORN B', '02012024', '02012024', '300.00', '0', '0', '0', '0', '300.00', '9', '', '54.00', '0', '0', '0', '0', '0', '0', '0', '0', ''])
      writer.writeRegistro('C', 'C170', ['1', 'P2', 'Prod 2', '3', 'UN', '100.00', '0', '0', '5102', '', '', '300.00', '0', '54.00', '18.00', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''])
      writer.writeRegistro('C', 'C190', ['000', '5102', '18.00', '300.00', '54.00', '0', '0', '0', '0', '0', '0', '0', '0'])
      writer.writeRegistro('C', 'C990', ['9'])

      writer.writeRegistro('D', 'D001', ['1'])
      writer.writeRegistro('D', 'D990', ['2'])
      writer.writeRegistro('E', 'E001', ['0'])
      writer.writeRegistro('E', 'E100', ['01012024', '31012024'])
      writer.writeRegistro('E', 'E110', ['144.00', '0', '0', '0', '0', '0', '0', '0', '0', '144.00', '0', '0', '144.00'])
      writer.writeRegistro('E', 'E990', ['4'])
      writer.writeRegistro('G', 'G001', ['1'])
      writer.writeRegistro('G', 'G990', ['2'])
      writer.writeRegistro('H', 'H001', ['1'])
      writer.writeRegistro('H', 'H990', ['2'])
      writer.writeRegistro('K', 'K001', ['1'])
      writer.writeRegistro('K', 'K990', ['2'])
      writer.writeRegistro('1', '1001', ['1'])
      writer.writeRegistro('1', '1990', ['2'])

      const buffer = writer.finalize()
      const resultado = validarEstruturaSPED(buffer)

      expect(resultado.valido).toBe(true)
      expect(resultado.erros).toHaveLength(0)
    })
  })

  describe('blocos obrigatórios', () => {
    it('deve reportar erro quando bloco obrigatório está ausente', () => {
      // Cria arquivo SPED sem Bloco G
      const writer = new SPEDWriter()

      writer.writeRegistro('0', '0000', ['018', '0', '01012024', '31012024', 'EMPRESA', '12345678000199', 'SP', '123456789', '1234567890', '3550308', '', '1', '1'])
      writer.writeRegistro('0', '0001', ['0'])
      writer.writeRegistro('0', '0990', ['3'])
      writer.writeRegistro('C', 'C001', ['1'])
      writer.writeRegistro('C', 'C990', ['2'])
      writer.writeRegistro('D', 'D001', ['1'])
      writer.writeRegistro('D', 'D990', ['2'])
      writer.writeRegistro('E', 'E001', ['1'])
      writer.writeRegistro('E', 'E990', ['2'])
      // Bloco G ausente
      writer.writeRegistro('H', 'H001', ['1'])
      writer.writeRegistro('H', 'H990', ['2'])
      writer.writeRegistro('K', 'K001', ['1'])
      writer.writeRegistro('K', 'K990', ['2'])
      writer.writeRegistro('1', '1001', ['1'])
      writer.writeRegistro('1', '1990', ['2'])

      const buffer = writer.finalize()
      const resultado = validarEstruturaSPED(buffer)

      expect(resultado.valido).toBe(false)
      expect(resultado.erros.some(e => e.includes("Bloco obrigatório 'G' ausente"))).toBe(true)
    })

    it('deve reportar múltiplos blocos ausentes', () => {
      // Arquivo com apenas blocos 0 e 9
      const writer = new SPEDWriter()
      writer.writeRegistro('0', '0000', ['018', '0', '01012024', '31012024', 'EMPRESA', '12345678000199', 'SP', '123456789', '1234567890', '3550308', '', '1', '1'])
      writer.writeRegistro('0', '0001', ['0'])
      writer.writeRegistro('0', '0990', ['3'])

      const buffer = writer.finalize()
      const resultado = validarEstruturaSPED(buffer)

      expect(resultado.valido).toBe(false)
      // Deve faltar: C, D, E, G, H, K, 1
      expect(resultado.erros.filter(e => e.includes('Bloco obrigatório')).length).toBeGreaterThanOrEqual(7)
    })
  })

  describe('sequência pai-filho', () => {
    it('deve reportar erro quando C170 aparece sem C100 pai', () => {
      const writer = new SPEDWriter()

      writer.writeRegistro('0', '0000', ['018', '0', '01012024', '31012024', 'EMPRESA', '12345678000199', 'SP', '123456789', '1234567890', '3550308', '', '1', '1'])
      writer.writeRegistro('0', '0001', ['0'])
      writer.writeRegistro('0', '0990', ['3'])
      writer.writeRegistro('C', 'C001', ['0'])
      // C170 sem C100 antes
      writer.writeRegistro('C', 'C170', ['1', 'P1', 'Prod', '10', 'UN', '100.00', '0', '0', '5102', '', '', '1000.00', '0', '180.00', '18.00', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''])
      writer.writeRegistro('C', 'C990', ['3'])

      writer.writeRegistro('D', 'D001', ['1'])
      writer.writeRegistro('D', 'D990', ['2'])
      writer.writeRegistro('E', 'E001', ['1'])
      writer.writeRegistro('E', 'E990', ['2'])
      writer.writeRegistro('G', 'G001', ['1'])
      writer.writeRegistro('G', 'G990', ['2'])
      writer.writeRegistro('H', 'H001', ['1'])
      writer.writeRegistro('H', 'H990', ['2'])
      writer.writeRegistro('K', 'K001', ['1'])
      writer.writeRegistro('K', 'K990', ['2'])
      writer.writeRegistro('1', '1001', ['1'])
      writer.writeRegistro('1', '1990', ['2'])

      const buffer = writer.finalize()
      const resultado = validarEstruturaSPED(buffer)

      expect(resultado.valido).toBe(false)
      expect(resultado.erros.some(e => e.includes('C170') && e.includes('sem registro pai'))).toBe(true)
    })

    it('deve aceitar C170 após C100 (sequência correta)', () => {
      const buffer = gerarSPEDMinimoValido()
      const resultado = validarEstruturaSPED(buffer)

      // O arquivo mínimo válido já possui C100 → C170 na ordem correta
      expect(resultado.valido).toBe(true)
      expect(resultado.erros.filter(e => e.includes('C170'))).toHaveLength(0)
    })
  })

  describe('totalização Bloco 9', () => {
    it('deve reportar erro quando contagem declarada no 9900 não bate com real', () => {
      // Montar arquivo manualmente com Bloco 9 errado
      const lines = [
        '|0000|018|0|01012024|31012024|EMPRESA|12345678000199|SP|123456789|1234567890|3550308||1|1|',
        '|0001|0|',
        '|0990|3|',
        '|C001|1|',
        '|C990|2|',
        '|D001|1|',
        '|D990|2|',
        '|E001|1|',
        '|E990|2|',
        '|G001|1|',
        '|G990|2|',
        '|H001|1|',
        '|H990|2|',
        '|K001|1|',
        '|K990|2|',
        '|1001|1|',
        '|1990|2|',
        '|9001|0|',
        '|9900|0000|1|',
        '|9900|0001|1|',
        '|9900|0990|1|',
        '|9900|C001|99|',   // ERRADO: declara 99, mas real é 1
        '|9900|C990|1|',
        '|9900|D001|1|',
        '|9900|D990|1|',
        '|9900|E001|1|',
        '|9900|E990|1|',
        '|9900|G001|1|',
        '|9900|G990|1|',
        '|9900|H001|1|',
        '|9900|H990|1|',
        '|9900|K001|1|',
        '|9900|K990|1|',
        '|9900|1001|1|',
        '|9900|1990|1|',
        '|9900|9001|1|',
        '|9900|9900|20|',
        '|9900|9990|1|',
        '|9900|9999|1|',
        '|9990|22|',
        '|9999|39|',
      ]

      const content = lines.join('\r\n') + '\r\n'
      const buffer = Buffer.from(content, 'latin1')
      const resultado = validarEstruturaSPED(buffer)

      expect(resultado.valido).toBe(false)
      expect(resultado.erros.some(e => e.includes('C001') && e.includes('99') && e.includes('1'))).toBe(true)
    })

    it('deve reportar erro quando 9999 total não bate com registros reais', () => {
      const lines = [
        '|0000|018|0|01012024|31012024|EMPRESA|12345678000199|SP|123456789|1234567890|3550308||1|1|',
        '|0001|0|',
        '|0990|3|',
        '|C001|1|',
        '|C990|2|',
        '|D001|1|',
        '|D990|2|',
        '|E001|1|',
        '|E990|2|',
        '|G001|1|',
        '|G990|2|',
        '|H001|1|',
        '|H990|2|',
        '|K001|1|',
        '|K990|2|',
        '|1001|1|',
        '|1990|2|',
        '|9001|0|',
        '|9900|0000|1|',
        '|9900|0001|1|',
        '|9900|0990|1|',
        '|9900|C001|1|',
        '|9900|C990|1|',
        '|9900|D001|1|',
        '|9900|D990|1|',
        '|9900|E001|1|',
        '|9900|E990|1|',
        '|9900|G001|1|',
        '|9900|G990|1|',
        '|9900|H001|1|',
        '|9900|H990|1|',
        '|9900|K001|1|',
        '|9900|K990|1|',
        '|9900|1001|1|',
        '|9900|1990|1|',
        '|9900|9001|1|',
        '|9900|9900|20|',
        '|9900|9990|1|',
        '|9900|9999|1|',
        '|9990|22|',
        '|9999|999|', // ERRADO: total real é 39, declara 999
      ]

      const content = lines.join('\r\n') + '\r\n'
      const buffer = Buffer.from(content, 'latin1')
      const resultado = validarEstruturaSPED(buffer)

      expect(resultado.valido).toBe(false)
      expect(resultado.erros.some(e => e.includes('9999') && e.includes('999'))).toBe(true)
    })
  })

  describe('campos obrigatórios', () => {
    it('deve reportar erro quando campo obrigatório de 0000 está vazio', () => {
      const lines = [
        '|0000|018|0|01012024|31012024|EMPRESA||SP|123456789|1234567890|3550308||1|1|', // CNPJ vazio (posição 5)
        '|0001|0|',
        '|0990|3|',
        '|C001|1|',
        '|C990|2|',
        '|D001|1|',
        '|D990|2|',
        '|E001|1|',
        '|E990|2|',
        '|G001|1|',
        '|G990|2|',
        '|H001|1|',
        '|H990|2|',
        '|K001|1|',
        '|K990|2|',
        '|1001|1|',
        '|1990|2|',
        '|9001|0|',
        '|9900|0000|1|',
        '|9900|0001|1|',
        '|9900|0990|1|',
        '|9900|C001|1|',
        '|9900|C990|1|',
        '|9900|D001|1|',
        '|9900|D990|1|',
        '|9900|E001|1|',
        '|9900|E990|1|',
        '|9900|G001|1|',
        '|9900|G990|1|',
        '|9900|H001|1|',
        '|9900|H990|1|',
        '|9900|K001|1|',
        '|9900|K990|1|',
        '|9900|1001|1|',
        '|9900|1990|1|',
        '|9900|9001|1|',
        '|9900|9900|20|',
        '|9900|9990|1|',
        '|9900|9999|1|',
        '|9990|22|',
        '|9999|39|',
      ]

      const content = lines.join('\r\n') + '\r\n'
      const buffer = Buffer.from(content, 'latin1')
      const resultado = validarEstruturaSPED(buffer)

      expect(resultado.valido).toBe(false)
      expect(resultado.erros.some(e => e.includes('0000') && e.includes('campo obrigatório vazio'))).toBe(true)
    })

    it('deve reportar erro quando 9900 tem campo obrigatório vazio', () => {
      const lines = [
        '|0000|018|0|01012024|31012024|EMPRESA|12345678000199|SP|123456789|1234567890|3550308||1|1|',
        '|0001|0|',
        '|0990|3|',
        '|C001|1|',
        '|C990|2|',
        '|D001|1|',
        '|D990|2|',
        '|E001|1|',
        '|E990|2|',
        '|G001|1|',
        '|G990|2|',
        '|H001|1|',
        '|H990|2|',
        '|K001|1|',
        '|K990|2|',
        '|1001|1|',
        '|1990|2|',
        '|9001|0|',
        '|9900||1|', // REG_BLC vazio — campo obrigatório
        '|9990|3|',
        '|9999|20|',
      ]

      const content = lines.join('\r\n') + '\r\n'
      const buffer = Buffer.from(content, 'latin1')
      const resultado = validarEstruturaSPED(buffer)

      expect(resultado.valido).toBe(false)
      expect(resultado.erros.some(e => e.includes('9900') && e.includes('campo obrigatório vazio'))).toBe(true)
    })
  })

  describe('arquivo vazio', () => {
    it('deve retornar erro para buffer vazio', () => {
      const buffer = Buffer.from('', 'latin1')
      const resultado = validarEstruturaSPED(buffer)

      expect(resultado.valido).toBe(false)
      expect(resultado.erros).toContain('Arquivo SPED vazio ou sem registros válidos')
    })

    it('deve retornar erro para buffer com apenas newlines', () => {
      const buffer = Buffer.from('\r\n\r\n', 'latin1')
      const resultado = validarEstruturaSPED(buffer)

      expect(resultado.valido).toBe(false)
      expect(resultado.erros).toContain('Arquivo SPED vazio ou sem registros válidos')
    })
  })

  describe('retorno de erros detalhados', () => {
    it('deve retornar array com todos os erros encontrados', () => {
      // Arquivo com múltiplos problemas
      const lines = [
        '|0000|018|0|01012024|31012024|EMPRESA||SP|123456789|1234567890|3550308||1|1|', // campo vazio
        '|0001|0|',
        '|0990|3|',
        // Blocos ausentes: C, D, E, G, H, K, 1
        '|9001|0|',
        '|9900|0000|1|',
        '|9900|0001|1|',
        '|9900|0990|1|',
        '|9900|9001|1|',
        '|9900|9900|5|',
        '|9900|9990|1|',
        '|9900|9999|1|',
        '|9990|8|',
        '|9999|11|',
      ]

      const content = lines.join('\r\n') + '\r\n'
      const buffer = Buffer.from(content, 'latin1')
      const resultado = validarEstruturaSPED(buffer)

      expect(resultado.valido).toBe(false)
      // Deve ter erros de bloco ausente + campo obrigatório
      expect(resultado.erros.length).toBeGreaterThan(1)
    })

    it('deve impedir disponibilização quando inconsistente (valido=false)', () => {
      const buffer = Buffer.from('|0000|||||||||||||||\r\n', 'latin1')
      const resultado = validarEstruturaSPED(buffer)

      // Com tantos blocos ausentes, não pode ser válido
      expect(resultado.valido).toBe(false)
      expect(resultado.erros.length).toBeGreaterThan(0)
    })
  })
})
