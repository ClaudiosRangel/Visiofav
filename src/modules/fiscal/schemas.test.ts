import { describe, it, expect } from 'vitest'
import {
  ncmSchema,
  cfopSchema,
  ufSchema,
  aliquotaSchema,
  regraTributariaInputSchema,
  emissaoNFeInputSchema,
  emissaoNFCeInputSchema,
  cancelamentoInputSchema,
  cceInputSchema,
  inutilizacaoInputSchema,
  certificadoUploadInputSchema,
  apuracaoInputSchema,
  periodoSPEDInputSchema,
  importacaoXMLInputSchema,
} from './schemas'

describe('Fiscal Schemas - Validadores base', () => {
  describe('NCM', () => {
    it('aceita 8 dígitos numéricos', () => {
      expect(ncmSchema.safeParse('12345678').success).toBe(true)
    })

    it('rejeita menos de 8 dígitos', () => {
      expect(ncmSchema.safeParse('1234567').success).toBe(false)
    })

    it('rejeita mais de 8 dígitos', () => {
      expect(ncmSchema.safeParse('123456789').success).toBe(false)
    })

    it('rejeita caracteres não numéricos', () => {
      expect(ncmSchema.safeParse('1234567A').success).toBe(false)
    })
  })

  describe('CFOP', () => {
    it('aceita 4 dígitos numéricos', () => {
      expect(cfopSchema.safeParse('5102').success).toBe(true)
    })

    it('rejeita menos de 4 dígitos', () => {
      expect(cfopSchema.safeParse('510').success).toBe(false)
    })

    it('rejeita letras', () => {
      expect(cfopSchema.safeParse('51A2').success).toBe(false)
    })
  })

  describe('UF', () => {
    it('aceita 2 letras maiúsculas', () => {
      expect(ufSchema.safeParse('SP').success).toBe(true)
      expect(ufSchema.safeParse('RJ').success).toBe(true)
    })

    it('rejeita minúsculas', () => {
      expect(ufSchema.safeParse('sp').success).toBe(false)
    })

    it('rejeita números', () => {
      expect(ufSchema.safeParse('S1').success).toBe(false)
    })

    it('rejeita mais de 2 caracteres', () => {
      expect(ufSchema.safeParse('SPP').success).toBe(false)
    })
  })

  describe('Alíquota', () => {
    it('aceita 0', () => {
      expect(aliquotaSchema.safeParse(0).success).toBe(true)
    })

    it('aceita 100', () => {
      expect(aliquotaSchema.safeParse(100).success).toBe(true)
    })

    it('aceita valor com 2 decimais', () => {
      expect(aliquotaSchema.safeParse(18.50).success).toBe(true)
    })

    it('rejeita valor negativo', () => {
      expect(aliquotaSchema.safeParse(-1).success).toBe(false)
    })

    it('rejeita valor acima de 100', () => {
      expect(aliquotaSchema.safeParse(100.01).success).toBe(false)
    })

    it('rejeita mais de 2 casas decimais', () => {
      expect(aliquotaSchema.safeParse(18.555).success).toBe(false)
    })
  })
})

describe('Fiscal Schemas - RegraTributariaInput', () => {
  const validInput = {
    ncm: '84719012',
    cfop: '5102',
    ufOrigem: 'SP',
    ufDestino: 'RJ',
    regimeTributario: 3,
    icmsAliquota: 18,
    pisAliquota: 1.65,
    cofinsAliquota: 7.6,
    ipiAliquota: 0,
  }

  it('aceita dados válidos completos', () => {
    expect(regraTributariaInputSchema.safeParse(validInput).success).toBe(true)
  })

  it('aplica defaults quando campos opcionais não fornecidos', () => {
    const minimal = {
      ncm: '84719012',
      cfop: '5102',
      ufOrigem: 'SP',
      ufDestino: 'RJ',
      regimeTributario: 1,
    }
    const result = regraTributariaInputSchema.safeParse(minimal)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.icmsAliquota).toBe(0)
      expect(result.data.icmsBaseCalculo).toBe(100)
      expect(result.data.icmsReducao).toBe(0)
    }
  })

  it('rejeita NCM inválido', () => {
    const input = { ...validInput, ncm: '1234' }
    expect(regraTributariaInputSchema.safeParse(input).success).toBe(false)
  })

  it('rejeita regime tributário fora do range', () => {
    const input = { ...validInput, regimeTributario: 4 }
    expect(regraTributariaInputSchema.safeParse(input).success).toBe(false)
  })
})

describe('Fiscal Schemas - EmissaoNFeInput', () => {
  const validItem = {
    codigoProd: 'PROD001',
    descricao: 'Produto Teste',
    ncm: '84719012',
    cfop: '5102',
    unidade: 'UN',
    quantidade: 10,
    valorUnitario: 100,
  }

  const validInput = {
    serie: 1,
    naturezaOp: 'VENDA',
    tipoOperacao: 1,
    destCpfCnpj: '12345678000199',
    destRazao: 'Empresa Teste',
    destUf: 'SP',
    itens: [validItem],
  }

  it('aceita dados válidos', () => {
    expect(emissaoNFeInputSchema.safeParse(validInput).success).toBe(true)
  })

  it('rejeita sem itens', () => {
    const input = { ...validInput, itens: [] }
    expect(emissaoNFeInputSchema.safeParse(input).success).toBe(false)
  })

  it('rejeita item com NCM inválido', () => {
    const input = { ...validInput, itens: [{ ...validItem, ncm: '123' }] }
    expect(emissaoNFeInputSchema.safeParse(input).success).toBe(false)
  })

  it('rejeita item com CFOP inválido', () => {
    const input = { ...validInput, itens: [{ ...validItem, cfop: '51020' }] }
    expect(emissaoNFeInputSchema.safeParse(input).success).toBe(false)
  })
})

describe('Fiscal Schemas - EmissaoNFCeInput', () => {
  const validInput = {
    serie: 1,
    itens: [
      {
        codigoProd: 'PROD001',
        descricao: 'Produto',
        ncm: '84719012',
        cfop: '5102',
        unidade: 'UN',
        quantidade: 1,
        valorUnitario: 50,
      },
    ],
    formaPagamento: 1,
    valorPago: 50,
  }

  it('aceita dados válidos sem CPF', () => {
    expect(emissaoNFCeInputSchema.safeParse(validInput).success).toBe(true)
  })

  it('aceita dados válidos com CPF', () => {
    const input = { ...validInput, destCpf: '12345678901' }
    expect(emissaoNFCeInputSchema.safeParse(input).success).toBe(true)
  })

  it('rejeita CPF com formato inválido', () => {
    const input = { ...validInput, destCpf: '123' }
    expect(emissaoNFCeInputSchema.safeParse(input).success).toBe(false)
  })
})

describe('Fiscal Schemas - CancelamentoInput', () => {
  it('aceita justificativa com 15+ caracteres', () => {
    const input = {
      documentoFiscalId: '550e8400-e29b-41d4-a716-446655440000',
      justificativa: 'Erro no valor da nota fiscal emitida',
    }
    expect(cancelamentoInputSchema.safeParse(input).success).toBe(true)
  })

  it('rejeita justificativa menor que 15 caracteres', () => {
    const input = {
      documentoFiscalId: '550e8400-e29b-41d4-a716-446655440000',
      justificativa: 'Muito curta',
    }
    expect(cancelamentoInputSchema.safeParse(input).success).toBe(false)
  })

  it('rejeita justificativa maior que 255 caracteres', () => {
    const input = {
      documentoFiscalId: '550e8400-e29b-41d4-a716-446655440000',
      justificativa: 'A'.repeat(256),
    }
    expect(cancelamentoInputSchema.safeParse(input).success).toBe(false)
  })
})

describe('Fiscal Schemas - CCeInput', () => {
  it('aceita texto com 15-1000 caracteres', () => {
    const input = {
      documentoFiscalId: '550e8400-e29b-41d4-a716-446655440000',
      textoCorrecao: 'Correcao do endereco do destinatario',
    }
    expect(cceInputSchema.safeParse(input).success).toBe(true)
  })

  it('rejeita texto menor que 15 caracteres', () => {
    const input = {
      documentoFiscalId: '550e8400-e29b-41d4-a716-446655440000',
      textoCorrecao: 'Texto curto',
    }
    expect(cceInputSchema.safeParse(input).success).toBe(false)
  })

  it('rejeita texto maior que 1000 caracteres', () => {
    const input = {
      documentoFiscalId: '550e8400-e29b-41d4-a716-446655440000',
      textoCorrecao: 'A'.repeat(1001),
    }
    expect(cceInputSchema.safeParse(input).success).toBe(false)
  })
})

describe('Fiscal Schemas - InutilizacaoInput', () => {
  it('aceita faixa válida', () => {
    const input = {
      serie: 1,
      numeroInicial: 1,
      numeroFinal: 10,
      justificativa: 'Inutilizacao por erro de sequencia',
      modelo: 55,
    }
    expect(inutilizacaoInputSchema.safeParse(input).success).toBe(true)
  })

  it('rejeita faixa maior que 1000 números', () => {
    const input = {
      serie: 1,
      numeroInicial: 1,
      numeroFinal: 1002,
      justificativa: 'Inutilizacao por erro de sequencia',
      modelo: 55,
    }
    expect(inutilizacaoInputSchema.safeParse(input).success).toBe(false)
  })

  it('aceita faixa de exatamente 1000 números', () => {
    const input = {
      serie: 1,
      numeroInicial: 1,
      numeroFinal: 1000,
      justificativa: 'Inutilizacao por erro de sequencia',
      modelo: 55,
    }
    expect(inutilizacaoInputSchema.safeParse(input).success).toBe(true)
  })

  it('rejeita número final menor que inicial', () => {
    const input = {
      serie: 1,
      numeroInicial: 10,
      numeroFinal: 5,
      justificativa: 'Inutilizacao por erro de sequencia',
      modelo: 55,
    }
    expect(inutilizacaoInputSchema.safeParse(input).success).toBe(false)
  })

  it('rejeita modelo inválido', () => {
    const input = {
      serie: 1,
      numeroInicial: 1,
      numeroFinal: 10,
      justificativa: 'Inutilizacao por erro de sequencia',
      modelo: 57,
    }
    expect(inutilizacaoInputSchema.safeParse(input).success).toBe(false)
  })

  it('rejeita justificativa menor que 15 caracteres', () => {
    const input = {
      serie: 1,
      numeroInicial: 1,
      numeroFinal: 10,
      justificativa: 'Curta demais',
      modelo: 55,
    }
    expect(inutilizacaoInputSchema.safeParse(input).success).toBe(false)
  })
})

describe('Fiscal Schemas - CertificadoUploadInput', () => {
  it('aceita CNPJ com 14 dígitos', () => {
    const input = { senha: 'minhaSenha123', cnpj: '12345678000199' }
    expect(certificadoUploadInputSchema.safeParse(input).success).toBe(true)
  })

  it('rejeita CNPJ com formato inválido', () => {
    const input = { senha: 'minhaSenha123', cnpj: '1234567800019' }
    expect(certificadoUploadInputSchema.safeParse(input).success).toBe(false)
  })

  it('rejeita senha vazia', () => {
    const input = { senha: '', cnpj: '12345678000199' }
    expect(certificadoUploadInputSchema.safeParse(input).success).toBe(false)
  })
})

describe('Fiscal Schemas - ApuracaoInput', () => {
  it('aceita tipo e período válidos', () => {
    const input = { tipo: 'ICMS', periodo: '2024-01' }
    expect(apuracaoInputSchema.safeParse(input).success).toBe(true)
  })

  it('aceita todos os tipos válidos', () => {
    const tipos = ['ICMS', 'ICMS_ST', 'PIS', 'COFINS', 'IPI'] as const
    for (const tipo of tipos) {
      expect(apuracaoInputSchema.safeParse({ tipo, periodo: '2024-06' }).success).toBe(true)
    }
  })

  it('rejeita tipo inválido', () => {
    const input = { tipo: 'ISS', periodo: '2024-01' }
    expect(apuracaoInputSchema.safeParse(input).success).toBe(false)
  })

  it('rejeita período com formato inválido', () => {
    const input = { tipo: 'ICMS', periodo: '2024-13' }
    expect(apuracaoInputSchema.safeParse(input).success).toBe(false)
  })
})

describe('Fiscal Schemas - PeriodoSPEDInput', () => {
  it('aceita tipo e período válidos', () => {
    const input = { tipo: 'FISCAL', periodo: '2024-03' }
    expect(periodoSPEDInputSchema.safeParse(input).success).toBe(true)
  })

  it('aceita todos os tipos SPED', () => {
    const tipos = ['FISCAL', 'CONTRIBUICOES', 'ECD', 'ECF', 'REINF'] as const
    for (const tipo of tipos) {
      expect(periodoSPEDInputSchema.safeParse({ tipo, periodo: '2024-01' }).success).toBe(true)
    }
  })

  it('rejeita tipo inválido', () => {
    const input = { tipo: 'DCTF', periodo: '2024-01' }
    expect(periodoSPEDInputSchema.safeParse(input).success).toBe(false)
  })
})

describe('Fiscal Schemas - ImportacaoXMLInput', () => {
  it('aceita chave de acesso com 44 dígitos', () => {
    const input = { chaveAcesso: '35240112345678000199550010000000011123456789' }
    expect(importacaoXMLInputSchema.safeParse(input).success).toBe(true)
  })

  it('aceita sem chave de acesso', () => {
    const input = {}
    expect(importacaoXMLInputSchema.safeParse(input).success).toBe(true)
  })

  it('rejeita chave de acesso com menos de 44 dígitos', () => {
    const input = { chaveAcesso: '3524011234567800019955001' }
    expect(importacaoXMLInputSchema.safeParse(input).success).toBe(false)
  })

  it('rejeita chave de acesso com letras', () => {
    const input = { chaveAcesso: '3524011234567800019955001000000001112345678A' }
    expect(importacaoXMLInputSchema.safeParse(input).success).toBe(false)
  })
})
