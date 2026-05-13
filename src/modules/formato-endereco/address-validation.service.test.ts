import { describe, it, expect } from 'vitest'
import { validarEndereco } from './address-validation.service'
import { FormatoEndereco } from './formato-endereco.types'

/** Formato de 2 segmentos: Rua e Prédio */
const formatoDoisSegmentos: FormatoEndereco = {
  id: 'fmt-1',
  nome: 'Picking de chão',
  segmentos: [
    { nome: 'Rua', campoFisico: 'codigoRua', ordem: 1, numerico: true },
    { nome: 'Prédio', campoFisico: 'codigoPredio', ordem: 2, numerico: true },
  ],
  empresaId: 'emp-1',
  criadoEm: new Date(),
}

/** Formato legado de 6 segmentos */
const formatoCompleto: FormatoEndereco = {
  id: 'fmt-2',
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

describe('AddressValidationService - validarEndereco', () => {
  it('deve aceitar endereço com todos os segmentos ativos preenchidos e inativos vazios', () => {
    const resultado = validarEndereco(formatoDoisSegmentos, {
      codigoRua: '001',
      codigoPredio: '002',
    })

    expect(resultado.valido).toBe(true)
    expect(resultado.erros).toHaveLength(0)
  })

  it('deve rejeitar endereço com segmento ativo vazio', () => {
    const resultado = validarEndereco(formatoDoisSegmentos, {
      codigoRua: '001',
      codigoPredio: '',
    })

    expect(resultado.valido).toBe(false)
    expect(resultado.erros).toHaveLength(1)
    expect(resultado.erros[0].mensagem).toContain('Segmentos obrigatórios não preenchidos')
    expect(resultado.erros[0].mensagem).toContain('codigoPredio')
  })

  it('deve rejeitar endereço com segmento ativo nulo', () => {
    const resultado = validarEndereco(formatoDoisSegmentos, {
      codigoRua: '001',
      codigoPredio: null,
    })

    expect(resultado.valido).toBe(false)
    expect(resultado.erros[0].mensagem).toContain('Segmentos obrigatórios não preenchidos')
    expect(resultado.erros[0].mensagem).toContain('codigoPredio')
  })

  it('deve rejeitar endereço com segmento ativo ausente (undefined)', () => {
    const resultado = validarEndereco(formatoDoisSegmentos, {
      codigoRua: '001',
    })

    expect(resultado.valido).toBe(false)
    expect(resultado.erros[0].mensagem).toContain('Segmentos obrigatórios não preenchidos')
    expect(resultado.erros[0].mensagem).toContain('codigoPredio')
  })

  it('deve rejeitar endereço com segmento inativo preenchido', () => {
    const resultado = validarEndereco(formatoDoisSegmentos, {
      codigoRua: '001',
      codigoPredio: '002',
      codigoNivel: '003', // inativo neste formato
    })

    expect(resultado.valido).toBe(false)
    expect(resultado.erros).toHaveLength(1)
    expect(resultado.erros[0].mensagem).toContain('Segmentos não pertencem ao formato')
    expect(resultado.erros[0].mensagem).toContain('codigoNivel')
  })

  it('deve reportar ambos os erros quando ativo vazio e inativo preenchido', () => {
    const resultado = validarEndereco(formatoDoisSegmentos, {
      codigoRua: '',
      codigoPredio: '',
      codigoDeposito: '001', // inativo
      codigoZona: '002', // inativo
    })

    expect(resultado.valido).toBe(false)
    expect(resultado.erros).toHaveLength(2)

    const mensagens = resultado.erros.map((e) => e.mensagem)
    expect(mensagens.some((m) => m.includes('Segmentos obrigatórios não preenchidos'))).toBe(true)
    expect(mensagens.some((m) => m.includes('Segmentos não pertencem ao formato'))).toBe(true)
  })

  it('deve aceitar formato completo de 6 segmentos com todos preenchidos', () => {
    const resultado = validarEndereco(formatoCompleto, {
      codigoDeposito: '001',
      codigoZona: '001',
      codigoRua: '001',
      codigoPredio: '001',
      codigoNivel: '001',
      codigoApto: '001',
    })

    expect(resultado.valido).toBe(true)
    expect(resultado.erros).toHaveLength(0)
  })

  it('deve aceitar segmentos inativos quando são null explicitamente', () => {
    const resultado = validarEndereco(formatoDoisSegmentos, {
      codigoRua: '001',
      codigoPredio: '002',
      codigoDeposito: null,
      codigoZona: null,
      codigoNivel: null,
      codigoApto: null,
    })

    expect(resultado.valido).toBe(true)
    expect(resultado.erros).toHaveLength(0)
  })

  it('deve listar múltiplos segmentos ativos vazios na mensagem de erro', () => {
    const resultado = validarEndereco(formatoDoisSegmentos, {})

    expect(resultado.valido).toBe(false)
    expect(resultado.erros[0].mensagem).toContain('codigoRua')
    expect(resultado.erros[0].mensagem).toContain('codigoPredio')
  })
})
