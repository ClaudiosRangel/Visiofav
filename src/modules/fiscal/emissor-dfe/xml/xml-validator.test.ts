/**
 * Testes unitários para xml-validator.ts
 * Validates: Requirements 1.1, 1.10, 36.1, 36.2
 */

import { describe, it, expect } from 'vitest'
import { validarXML, _internals, type TipoDocumentoValidacao } from './xml-validator'

// === Helpers para gerar XML de teste ===

function gerarNFeXML(overrides?: {
  semIde?: boolean
  semEmit?: boolean
  semDet?: boolean
  semTotal?: boolean
  semTransp?: boolean
  semPag?: boolean
  cnpjEmitente?: string
  ncm?: string
  cfop?: string
  cest?: string
  versao?: string
  nNF?: string
  dhEmi?: string
}): string {
  const opts = overrides || {}
  const versao = opts.versao ?? '4.00'
  const cnpj = opts.cnpjEmitente ?? '11222333000181'
  const ncm = opts.ncm ?? '84713012'
  const cfop = opts.cfop ?? '5102'
  const nNF = opts.nNF ?? '1'
  const dhEmi = opts.dhEmi ?? '2024-01-15T10:30:00-03:00'

  let xml = `<?xml version="1.0" encoding="UTF-8"?>`
  xml += `<NFe><infNFe versao="${versao}">`

  if (!opts.semIde) {
    xml += `<ide><cUF>35</cUF><natOp>VENDA</natOp><mod>55</mod><serie>1</serie><nNF>${nNF}</nNF><dhEmi>${dhEmi}</dhEmi><tpNF>1</tpNF><tpEmis>1</tpEmis></ide>`
  }

  if (!opts.semEmit) {
    xml += `<emit><CNPJ>${cnpj}</CNPJ><xNome>Empresa Teste LTDA</xNome><enderEmit><UF>SP</UF><xMun>SAO PAULO</xMun><cMun>3550308</cMun></enderEmit><CRT>3</CRT></emit>`
  }

  if (!opts.semDet) {
    xml += `<det nItem="1"><prod><cProd>001</cProd><xProd>Produto Teste</xProd><NCM>${ncm}</NCM><CFOP>${cfop}</CFOP>${opts.cest ? `<CEST>${opts.cest}</CEST>` : ''}<uCom>UN</uCom><qCom>10.0000</qCom><vUnCom>100.0000</vUnCom><vProd>1000.00</vProd></prod><imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><modBC>3</modBC><vBC>1000.00</vBC><pICMS>18.00</pICMS><vICMS>180.00</vICMS></ICMS00></ICMS></imposto></det>`
  }

  if (!opts.semTotal) {
    xml += `<total><ICMSTot><vBC>1000.00</vBC><vICMS>180.00</vICMS><vProd>1000.00</vProd><vNF>1000.00</vNF></ICMSTot></total>`
  }

  if (!opts.semTransp) {
    xml += `<transp><modFrete>9</modFrete></transp>`
  }

  if (!opts.semPag) {
    xml += `<pag><detPag><tPag>01</tPag><vPag>1000.00</vPag></detPag></pag>`
  }

  xml += `</infNFe></NFe>`
  return xml
}

function gerarCTeXML(overrides?: { semIde?: boolean; semEmit?: boolean }): string {
  const opts = overrides || {}
  let xml = `<?xml version="1.0" encoding="UTF-8"?>`
  xml += `<CTe><infCte versao="4.00">`

  if (!opts.semIde) {
    xml += `<ide><cUF>35</cUF><mod>57</mod><serie>1</serie><nCT>1</nCT><dhEmi>2024-01-15T10:30:00-03:00</dhEmi><CFOP>5353</CFOP><tpEmis>1</tpEmis></ide>`
  }

  if (!opts.semEmit) {
    xml += `<emit><CNPJ>11222333000181</CNPJ><xNome>Transportadora Teste</xNome></emit>`
  }

  xml += `<vPrest><vTPrest>500.00</vTPrest><vRec>500.00</vRec></vPrest>`
  xml += `<infCTeNorm><infCarga><vCarga>10000.00</vCarga></infCarga></infCTeNorm>`
  xml += `</infCte></CTe>`
  return xml
}

function gerarMDFeXML(): string {
  let xml = `<?xml version="1.0" encoding="UTF-8"?>`
  xml += `<MDFe><infMDFe versao="3.00">`
  xml += `<ide><cUF>35</cUF><mod>58</mod><serie>1</serie><nMDF>1</nMDF><dhEmi>2024-01-15T10:30:00-03:00</dhEmi><tpEmis>1</tpEmis></ide>`
  xml += `<emit><CNPJ>11222333000181</CNPJ><xNome>Transportadora Teste</xNome></emit>`
  xml += `<infModal versaoModal="3.00"><rodo><infANTT><RNTRC>12345678</RNTRC></infANTT></rodo></infModal>`
  xml += `<infDoc><infMunDescarga><cMunDescarga>3550308</cMunDescarga></infMunDescarga></infDoc>`
  xml += `<tot><qCTe>1</qCTe><vCarga>5000.00</vCarga></tot>`
  xml += `</infMDFe></MDFe>`
  return xml
}

// === Testes ===

describe('xml-validator', () => {
  describe('validarXML - NF-e', () => {
    it('deve aceitar NF-e válida com todos os campos obrigatórios', () => {
      const xml = gerarNFeXML()
      const resultado = validarXML(xml, 'NFE')
      expect(resultado.valido).toBe(true)
      expect(resultado.erros).toHaveLength(0)
    })

    it('deve rejeitar XML vazio', () => {
      const resultado = validarXML('', 'NFE')
      expect(resultado.valido).toBe(false)
      expect(resultado.erros[0].campo).toBe('xml')
      expect(resultado.erros[0].mensagem).toContain('vazio')
    })

    it('deve rejeitar XML mal-formado', () => {
      const resultado = validarXML('<NFe><infNFe><unclosed>', 'NFE')
      expect(resultado.valido).toBe(false)
      expect(resultado.erros[0].mensagem).toContain('mal-formado')
    })

    it('deve rejeitar quando elemento raiz não é NFe', () => {
      const xml = `<?xml version="1.0"?><OutroDocumento><dados>teste</dados></OutroDocumento>`
      const resultado = validarXML(xml, 'NFE')
      expect(resultado.valido).toBe(false)
      expect(resultado.erros.some(e => e.campo === 'NFe')).toBe(true)
    })

    it('deve rejeitar NF-e sem elemento ide', () => {
      const xml = gerarNFeXML({ semIde: true })
      const resultado = validarXML(xml, 'NFE')
      expect(resultado.valido).toBe(false)
      expect(resultado.erros.some(e => e.campo.includes('ide'))).toBe(true)
    })

    it('deve rejeitar NF-e sem elemento emit', () => {
      const xml = gerarNFeXML({ semEmit: true })
      const resultado = validarXML(xml, 'NFE')
      expect(resultado.valido).toBe(false)
      expect(resultado.erros.some(e => e.campo.includes('emit'))).toBe(true)
    })

    it('deve rejeitar NF-e sem elemento det (itens)', () => {
      const xml = gerarNFeXML({ semDet: true })
      const resultado = validarXML(xml, 'NFE')
      expect(resultado.valido).toBe(false)
      expect(resultado.erros.some(e => e.campo.includes('det'))).toBe(true)
    })

    it('deve rejeitar NF-e sem elemento total', () => {
      const xml = gerarNFeXML({ semTotal: true })
      const resultado = validarXML(xml, 'NFE')
      expect(resultado.valido).toBe(false)
      expect(resultado.erros.some(e => e.campo.includes('total'))).toBe(true)
    })

    it('deve rejeitar NF-e sem elemento transp', () => {
      const xml = gerarNFeXML({ semTransp: true })
      const resultado = validarXML(xml, 'NFE')
      expect(resultado.valido).toBe(false)
      expect(resultado.erros.some(e => e.campo.includes('transp'))).toBe(true)
    })

    it('deve rejeitar NF-e sem elemento pag', () => {
      const xml = gerarNFeXML({ semPag: true })
      const resultado = validarXML(xml, 'NFE')
      expect(resultado.valido).toBe(false)
      expect(resultado.erros.some(e => e.campo.includes('pag'))).toBe(true)
    })

    it('deve rejeitar CNPJ inválido do emitente', () => {
      const xml = gerarNFeXML({ cnpjEmitente: '12345678901234' })
      const resultado = validarXML(xml, 'NFE')
      expect(resultado.valido).toBe(false)
      expect(resultado.erros.some(e => e.campo.includes('CNPJ') && e.mensagem.includes('inválido'))).toBe(true)
    })

    it('deve rejeitar NCM com menos de 8 dígitos', () => {
      const xml = gerarNFeXML({ ncm: '8471' })
      const resultado = validarXML(xml, 'NFE')
      expect(resultado.valido).toBe(false)
      expect(resultado.erros.some(e => e.mensagem.includes('NCM'))).toBe(true)
    })

    it('deve rejeitar NCM com letras', () => {
      const xml = gerarNFeXML({ ncm: '8471AB12' })
      const resultado = validarXML(xml, 'NFE')
      expect(resultado.valido).toBe(false)
      expect(resultado.erros.some(e => e.mensagem.includes('NCM'))).toBe(true)
    })

    it('deve rejeitar CFOP inválido', () => {
      const xml = gerarNFeXML({ cfop: '9999' })
      const resultado = validarXML(xml, 'NFE')
      expect(resultado.valido).toBe(false)
      expect(resultado.erros.some(e => e.mensagem.includes('CFOP'))).toBe(true)
    })

    it('deve rejeitar CFOP com primeiro dígito 0 ou 8', () => {
      const xml = gerarNFeXML({ cfop: '0102' })
      const resultado = validarXML(xml, 'NFE')
      expect(resultado.valido).toBe(false)
    })

    it('deve aceitar CEST válido (7 dígitos)', () => {
      const xml = gerarNFeXML({ cest: '2106300' })
      const resultado = validarXML(xml, 'NFE')
      expect(resultado.valido).toBe(true)
    })

    it('deve rejeitar CEST inválido (não 7 dígitos)', () => {
      const xml = gerarNFeXML({ cest: '12345' })
      const resultado = validarXML(xml, 'NFE')
      expect(resultado.valido).toBe(false)
      expect(resultado.erros.some(e => e.mensagem.includes('CEST'))).toBe(true)
    })

    it('deve alertar versão incorreta do layout', () => {
      const xml = gerarNFeXML({ versao: '3.10' })
      const resultado = validarXML(xml, 'NFE')
      expect(resultado.valido).toBe(false)
      expect(resultado.erros.some(e => e.mensagem.includes('Versão'))).toBe(true)
    })

    it('deve rejeitar nNF não numérico', () => {
      const xml = gerarNFeXML({ nNF: 'abc' })
      const resultado = validarXML(xml, 'NFE')
      expect(resultado.valido).toBe(false)
      expect(resultado.erros.some(e => e.mensagem.includes('número positivo'))).toBe(true)
    })

    it('deve rejeitar data de emissão em formato inválido', () => {
      const xml = gerarNFeXML({ dhEmi: '15/01/2024' })
      const resultado = validarXML(xml, 'NFE')
      expect(resultado.valido).toBe(false)
      expect(resultado.erros.some(e => e.mensagem.includes('data'))).toBe(true)
    })

    it('deve aceitar data de emissão no formato ISO completo', () => {
      const xml = gerarNFeXML({ dhEmi: '2024-06-20T14:00:00-03:00' })
      const resultado = validarXML(xml, 'NFE')
      expect(resultado.valido).toBe(true)
    })
  })

  describe('validarXML - NFC-e', () => {
    it('deve aceitar NFC-e válida (não exige transp)', () => {
      const xml = gerarNFeXML({ semTransp: true })
      const resultado = validarXML(xml, 'NFCE')
      expect(resultado.valido).toBe(true)
    })

    it('deve rejeitar NFC-e sem ide', () => {
      const xml = gerarNFeXML({ semIde: true })
      const resultado = validarXML(xml, 'NFCE')
      expect(resultado.valido).toBe(false)
    })
  })

  describe('validarXML - CT-e', () => {
    it('deve aceitar CT-e válido', () => {
      const xml = gerarCTeXML()
      const resultado = validarXML(xml, 'CTE')
      expect(resultado.valido).toBe(true)
      expect(resultado.erros).toHaveLength(0)
    })

    it('deve rejeitar CT-e sem ide', () => {
      const xml = gerarCTeXML({ semIde: true })
      const resultado = validarXML(xml, 'CTE')
      expect(resultado.valido).toBe(false)
      expect(resultado.erros.some(e => e.campo.includes('ide'))).toBe(true)
    })

    it('deve rejeitar CT-e sem emit', () => {
      const xml = gerarCTeXML({ semEmit: true })
      const resultado = validarXML(xml, 'CTE')
      expect(resultado.valido).toBe(false)
      expect(resultado.erros.some(e => e.campo.includes('emit'))).toBe(true)
    })
  })

  describe('validarXML - MDF-e', () => {
    it('deve aceitar MDF-e válido', () => {
      const xml = gerarMDFeXML()
      const resultado = validarXML(xml, 'MDFE')
      expect(resultado.valido).toBe(true)
      expect(resultado.erros).toHaveLength(0)
    })

    it('deve validar versão 3.00 para MDF-e', () => {
      const xml = gerarMDFeXML().replace('versao="3.00"', 'versao="2.00"')
      const resultado = validarXML(xml, 'MDFE')
      expect(resultado.valido).toBe(false)
      expect(resultado.erros.some(e => e.mensagem.includes('Versão'))).toBe(true)
    })
  })

  describe('validarXML - retorno estruturado de erros', () => {
    it('deve retornar múltiplos erros quando vários campos inválidos', () => {
      const xml = gerarNFeXML({ cnpjEmitente: '00000000000000', ncm: '123', cfop: '9999' })
      const resultado = validarXML(xml, 'NFE')
      expect(resultado.valido).toBe(false)
      expect(resultado.erros.length).toBeGreaterThan(1)
      // Cada erro deve ter campo e mensagem
      for (const erro of resultado.erros) {
        expect(erro.campo).toBeDefined()
        expect(erro.mensagem).toBeDefined()
        expect(erro.mensagem.length).toBeGreaterThan(0)
      }
    })
  })

  describe('_internals - validações de formato', () => {
    it('validarCNPJ: aceita CNPJ válido', () => {
      expect(_internals.validarCNPJ('11222333000181')).toBe(true)
    })

    it('validarCNPJ: rejeita CNPJ com todos dígitos iguais', () => {
      expect(_internals.validarCNPJ('11111111111111')).toBe(false)
    })

    it('validarCNPJ: rejeita CNPJ com dígitos verificadores errados', () => {
      expect(_internals.validarCNPJ('11222333000199')).toBe(false)
    })

    it('validarCPF: aceita CPF válido', () => {
      expect(_internals.validarCPF('52998224725')).toBe(true)
    })

    it('validarCPF: rejeita CPF com todos dígitos iguais', () => {
      expect(_internals.validarCPF('11111111111')).toBe(false)
    })

    it('validarNCM: aceita 8 dígitos', () => {
      expect(_internals.validarNCM('84713012')).toBe(true)
    })

    it('validarNCM: rejeita menos de 8 dígitos', () => {
      expect(_internals.validarNCM('8471301')).toBe(false)
    })

    it('validarCFOP: aceita CFOP válido (1xxx-7xxx)', () => {
      expect(_internals.validarCFOP('5102')).toBe(true)
      expect(_internals.validarCFOP('1102')).toBe(true)
      expect(_internals.validarCFOP('7101')).toBe(true)
    })

    it('validarCFOP: rejeita CFOP iniciando com 0 ou 8+', () => {
      expect(_internals.validarCFOP('0102')).toBe(false)
      expect(_internals.validarCFOP('8102')).toBe(false)
      expect(_internals.validarCFOP('9999')).toBe(false)
    })

    it('validarCEST: aceita 7 dígitos', () => {
      expect(_internals.validarCEST('2106300')).toBe(true)
    })

    it('validarCEST: rejeita tamanho incorreto', () => {
      expect(_internals.validarCEST('12345')).toBe(false)
      expect(_internals.validarCEST('12345678')).toBe(false)
    })

    it('validarNumeroPositivo: aceita números positivos', () => {
      expect(_internals.validarNumeroPositivo('1')).toBe(true)
      expect(_internals.validarNumeroPositivo('10.5')).toBe(true)
      expect(_internals.validarNumeroPositivo('0.01')).toBe(true)
    })

    it('validarNumeroPositivo: rejeita zero e negativos', () => {
      expect(_internals.validarNumeroPositivo('0')).toBe(false)
      expect(_internals.validarNumeroPositivo('-1')).toBe(false)
      expect(_internals.validarNumeroPositivo('abc')).toBe(false)
    })

    it('validarDataEmissao: aceita formato ISO com timezone', () => {
      expect(_internals.validarDataEmissao('2024-01-15T10:30:00-03:00')).toBe(true)
    })

    it('validarDataEmissao: aceita formato ISO simples', () => {
      expect(_internals.validarDataEmissao('2024-01-15')).toBe(true)
    })

    it('validarDataEmissao: rejeita formato DD/MM/YYYY', () => {
      expect(_internals.validarDataEmissao('15/01/2024')).toBe(false)
    })
  })
})
