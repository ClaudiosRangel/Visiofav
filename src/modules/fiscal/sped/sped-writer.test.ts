import { describe, it, expect, beforeEach } from 'vitest'
import { SPEDWriter } from './sped-writer'

describe('SPEDWriter', () => {
  let writer: SPEDWriter

  beforeEach(() => {
    writer = new SPEDWriter()
  })

  describe('writeRegistro', () => {
    it('should write a record with pipe-delimited fields', () => {
      writer.writeRegistro('0', '0000', ['campo1', 'campo2', 'campo3'])
      const buffer = writer.finalize()
      const content = buffer.toString('latin1')

      // First record should be pipe-delimited
      expect(content).toContain('|0000|campo1|campo2|campo3|')
    })

    it('should use CR+LF line endings', () => {
      writer.writeRegistro('0', '0000', ['test'])
      const buffer = writer.finalize()
      const content = buffer.toString('latin1')

      // Each line should end with \r\n
      const lines = content.split('\r\n')
      // Last element is empty string after final \r\n
      expect(lines[lines.length - 1]).toBe('')
      // All non-empty lines should start with |
      for (const line of lines.filter(l => l.length > 0)) {
        expect(line.startsWith('|')).toBe(true)
      }
    })

    it('should output ISO-8859-1 encoded content', () => {
      // Characters valid in ISO-8859-1 but different in UTF-8
      writer.writeRegistro('0', '0000', ['caf\xe9', 'a\xe7\xe3o'])
      const buffer = writer.finalize()

      // Buffer should encode correctly as latin1
      const content = buffer.toString('latin1')
      expect(content).toContain('café')
      expect(content).toContain('ação')
    })

    it('should handle empty fields', () => {
      writer.writeRegistro('0', '0000', ['', '', ''])
      const buffer = writer.finalize()
      const content = buffer.toString('latin1')

      expect(content).toContain('|0000||||')
    })

    it('should throw if writer is already finalized', () => {
      writer.writeRegistro('0', '0000', ['test'])
      writer.finalize()

      expect(() => writer.writeRegistro('0', '0001', ['test'])).toThrow(
        'SPEDWriter já foi finalizado'
      )
    })
  })

  describe('finalize', () => {
    it('should generate Block 9 automatically', () => {
      writer.writeRegistro('0', '0000', ['test'])
      writer.writeRegistro('0', '0001', ['0'])
      writer.writeRegistro('C', 'C001', ['0'])
      writer.writeRegistro('C', 'C100', ['dados'])
      writer.writeRegistro('C', 'C990', ['3'])

      const buffer = writer.finalize()
      const content = buffer.toString('latin1')

      // Should contain Block 9 records
      expect(content).toContain('|9001|')
      expect(content).toContain('|9900|')
      expect(content).toContain('|9990|')
      expect(content).toContain('|9999|')
    })

    it('should count records correctly in Block 9 (9900 entries)', () => {
      writer.writeRegistro('0', '0000', ['test'])
      writer.writeRegistro('0', '0001', ['0'])
      writer.writeRegistro('C', 'C001', ['0'])
      writer.writeRegistro('C', 'C100', ['item1'])
      writer.writeRegistro('C', 'C100', ['item2'])
      writer.writeRegistro('C', 'C100', ['item3'])
      writer.writeRegistro('C', 'C990', ['4'])

      const buffer = writer.finalize()
      const content = buffer.toString('latin1')

      // 9900 for 0000 should show count of 1
      expect(content).toContain('|9900|0000|1|')
      // 9900 for 0001 should show count of 1
      expect(content).toContain('|9900|0001|1|')
      // 9900 for C001 should show count of 1
      expect(content).toContain('|9900|C001|1|')
      // 9900 for C100 should show count of 3
      expect(content).toContain('|9900|C100|3|')
      // 9900 for C990 should show count of 1
      expect(content).toContain('|9900|C990|1|')
    })

    it('should include 9999 with total record count including Block 9', () => {
      writer.writeRegistro('0', '0000', ['test'])
      writer.writeRegistro('0', '0001', ['0'])

      const buffer = writer.finalize()
      const content = buffer.toString('latin1')
      const lines = content.split('\r\n').filter(l => l.length > 0)

      // Find 9999 record (starts with |9999|, not |9900|9999|)
      const reg9999 = lines.find(l => l.startsWith('|9999|'))
      expect(reg9999).toBeDefined()

      // Total in 9999 should equal total number of lines
      // Format: |9999|total| → split('|') = ['', '9999', 'total', '']
      const totalDeclared = parseInt(reg9999!.split('|')[2])
      expect(totalDeclared).toBe(lines.length)
    })

    it('should include 9990 with correct Block 9 line count', () => {
      writer.writeRegistro('0', '0000', ['test'])

      const buffer = writer.finalize()
      const content = buffer.toString('latin1')
      const lines = content.split('\r\n').filter(l => l.length > 0)

      // Count Block 9 lines (those starting with |9, i.e. 9001, 9900, 9990, 9999)
      const bloco9Lines = lines.filter(l => l.startsWith('|9'))

      // Find 9990 record (starts with |9990|, not |9900|9990|)
      const reg9990 = lines.find(l => l.startsWith('|9990|'))
      expect(reg9990).toBeDefined()

      // Format: |9990|total| → split('|') = ['', '9990', 'total', '']
      const totalBloco9 = parseInt(reg9990!.split('|')[2])
      expect(totalBloco9).toBe(bloco9Lines.length)
    })

    it('should throw if called twice', () => {
      writer.writeRegistro('0', '0000', ['test'])
      writer.finalize()

      expect(() => writer.finalize()).toThrow('SPEDWriter já foi finalizado')
    })

    it('should include 9900 entries for Block 9 own records', () => {
      writer.writeRegistro('0', '0000', ['test'])
      const buffer = writer.finalize()
      const content = buffer.toString('latin1')

      // Should have 9900 entry for itself
      expect(content).toContain('|9900|9001|1|')
      expect(content).toContain('|9900|9990|1|')
      expect(content).toContain('|9900|9999|1|')
      // 9900 count should include all 9900 records
      expect(content).toMatch(/\|9900\|9900\|\d+\|/)
    })
  })

  describe('getContadores', () => {
    it('should return record counts per block', () => {
      writer.writeRegistro('0', '0000', ['test'])
      writer.writeRegistro('0', '0001', ['0'])
      writer.writeRegistro('C', 'C001', ['0'])
      writer.writeRegistro('C', 'C100', ['item1'])
      writer.writeRegistro('C', 'C100', ['item2'])

      const contadores = writer.getContadores()
      expect(contadores['0']).toBe(2)
      expect(contadores['C']).toBe(3)
    })

    it('should return empty object for empty writer', () => {
      const contadores = writer.getContadores()
      expect(contadores).toEqual({})
    })
  })

  describe('getTotalRegistros', () => {
    it('should return total records written (excluding Block 9)', () => {
      writer.writeRegistro('0', '0000', ['test'])
      writer.writeRegistro('C', 'C001', ['0'])
      writer.writeRegistro('C', 'C100', ['item'])

      expect(writer.getTotalRegistros()).toBe(3)
    })
  })

  describe('isFinalized', () => {
    it('should return false before finalize', () => {
      expect(writer.isFinalized()).toBe(false)
    })

    it('should return true after finalize', () => {
      writer.writeRegistro('0', '0000', ['test'])
      writer.finalize()
      expect(writer.isFinalized()).toBe(true)
    })
  })

  describe('custom config', () => {
    it('should respect custom delimiter config (for testing)', () => {
      const customWriter = new SPEDWriter({
        delimitadorCampo: '|',
        delimitadorRegistro: '\r\n',
      })
      customWriter.writeRegistro('0', '0000', ['a', 'b'])
      const buffer = customWriter.finalize()
      const content = buffer.toString('latin1')

      expect(content).toContain('|0000|a|b|')
    })
  })

  describe('streaming / memory efficiency', () => {
    it('should handle large number of records without issues', () => {
      // Write 10,000 records to validate streaming approach
      for (let i = 0; i < 10000; i++) {
        writer.writeRegistro('C', 'C100', [
          String(i),
          'PROD001',
          'Produto de Teste',
          '12345678',
          '5102',
          'UN',
          '10.0000',
          '100.00',
          '1000.00',
        ])
      }

      const buffer = writer.finalize()
      const content = buffer.toString('latin1')

      // Verify totals
      expect(content).toContain('|9900|C100|10000|')

      // Total lines = 10000 records + Block 9 records
      const lines = content.split('\r\n').filter(l => l.length > 0)
      expect(lines.length).toBeGreaterThan(10000)
    })
  })
})
