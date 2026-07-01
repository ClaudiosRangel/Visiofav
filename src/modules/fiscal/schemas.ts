import { z } from 'zod'

// === Validadores reutilizáveis ===

/** NCM: 8 dígitos numéricos */
export const ncmSchema = z.string().regex(/^\d{8}$/, 'NCM deve conter exatamente 8 dígitos numéricos')

/** CFOP: 4 dígitos numéricos */
export const cfopSchema = z.string().regex(/^\d{4}$/, 'CFOP deve conter exatamente 4 dígitos numéricos')

/** UF: 2 letras maiúsculas */
export const ufSchema = z.string().length(2).regex(/^[A-Z]{2}$/, 'UF deve conter 2 letras maiúsculas')

/** Alíquota: 0 a 100 com até 2 casas decimais */
export const aliquotaSchema = z
  .number()
  .min(0, 'Alíquota mínima é 0')
  .max(100, 'Alíquota máxima é 100')
  .refine((v) => Number(v.toFixed(2)) === v, 'Alíquota deve ter no máximo 2 casas decimais')

/** Percentual de base/redução: 0 a 100 com até 2 casas decimais */
export const percentualSchema = z
  .number()
  .min(0, 'Percentual mínimo é 0')
  .max(100, 'Percentual máximo é 100')
  .refine((v) => Number(v.toFixed(2)) === v, 'Percentual deve ter no máximo 2 casas decimais')

/** Regime tributário: 1=SN, 2=SN Excesso, 3=Normal */
export const regimeTributarioSchema = z
  .number()
  .int()
  .min(1)
  .max(3, 'Regime tributário deve ser 1 (Simples Nacional), 2 (SN Excesso) ou 3 (Normal)')

// === Schemas principais ===

/**
 * Input para cadastro/atualização de Regra Tributária
 * Validates: Requirements 7.1
 */
export const regraTributariaInputSchema = z.object({
  ncm: ncmSchema,
  cfop: cfopSchema,
  ufOrigem: ufSchema,
  ufDestino: ufSchema,
  regimeTributario: regimeTributarioSchema,

  // ICMS
  icmsAliquota: aliquotaSchema.default(0),
  icmsCst: z.string().max(3).optional(),
  icmsCsosn: z.string().max(4).optional(),
  icmsBaseCalculo: percentualSchema.default(100),
  icmsReducao: percentualSchema.default(0),

  // ICMS-ST
  icmsStMva: percentualSchema.optional(),
  icmsStMvaAjustado: percentualSchema.optional(),
  icmsStAliqInterna: aliquotaSchema.optional(),

  // FCP
  fcpAliquota: aliquotaSchema.optional(),

  // PIS
  pisAliquota: aliquotaSchema.default(0),
  pisCst: z.string().max(2).optional(),

  // COFINS
  cofinsAliquota: aliquotaSchema.default(0),
  cofinsCst: z.string().max(2).optional(),

  // IPI
  ipiAliquota: aliquotaSchema.default(0),
  ipiCst: z.string().max(2).optional(),

  // ISS
  issAliquota: aliquotaSchema.optional(),
})

export type RegraTributariaInput = z.infer<typeof regraTributariaInputSchema>

/**
 * Item de documento fiscal para emissão de NF-e
 */
const itemNFeSchema = z.object({
  produtoId: z.string().uuid().optional(),
  codigoProd: z.string().min(1).max(60),
  descricao: z.string().min(1).max(120),
  ncm: ncmSchema,
  cest: z.string().regex(/^\d{7}$/, 'CEST deve conter 7 dígitos').optional(),
  cfop: cfopSchema,
  unidade: z.string().min(1).max(6),
  quantidade: z.number().positive('Quantidade deve ser positiva'),
  valorUnitario: z.number().min(0, 'Valor unitário não pode ser negativo'),
  valorDesconto: z.number().min(0).default(0),
})

/**
 * Input para emissão de NF-e (modelo 55)
 * Validates: Requirements 1.1, 1.10
 */
export const emissaoNFeInputSchema = z.object({
  serie: z.number().int().min(1).max(999),
  naturezaOp: z.string().min(1).max(100),
  tipoOperacao: z.number().int().min(0).max(1), // 0=Entrada, 1=Saída
  finalidade: z.number().int().min(1).max(4).default(1), // 1=Normal, 2=Complementar, 3=Ajuste, 4=Devolução

  // Destinatário
  destCpfCnpj: z.string().min(11).max(14),
  destRazao: z.string().min(1).max(200),
  destUf: ufSchema,
  destIe: z.string().max(20).optional(),
  destEndereco: z
    .object({
      logradouro: z.string().min(1).max(60),
      numero: z.string().min(1).max(10),
      complemento: z.string().max(60).optional(),
      bairro: z.string().min(1).max(60),
      codigoMunicipio: z.string().regex(/^\d{7}$/, 'Código IBGE do município deve ter 7 dígitos'),
      municipio: z.string().min(1).max(60),
      uf: ufSchema,
      cep: z.string().regex(/^\d{8}$/, 'CEP deve conter 8 dígitos'),
    })
    .optional(),

  // Itens
  itens: z.array(itemNFeSchema).min(1, 'NF-e deve conter ao menos 1 item'),

  // Transporte
  modalidadeFrete: z.number().int().min(0).max(9).default(9), // 9=Sem frete

  // Valores adicionais
  valorFrete: z.number().min(0).default(0),
  valorSeguro: z.number().min(0).default(0),
  valorOutras: z.number().min(0).default(0),

  // Informações adicionais
  infAdicionais: z.string().max(5000).optional(),

  // Ambiente (1=Produção, 2=Homologação)
  ambiente: z.number().int().min(1).max(2).default(2),
})

export type EmissaoNFeInput = z.infer<typeof emissaoNFeInputSchema>

/**
 * Input para emissão de NFC-e (modelo 65)
 * Validates: Requirements 1.1
 */
export const emissaoNFCeInputSchema = z.object({
  serie: z.number().int().min(1).max(999),

  // Consumidor (opcional na NFC-e)
  destCpf: z.string().regex(/^\d{11}$/, 'CPF deve conter 11 dígitos').optional(),
  destNome: z.string().max(200).optional(),

  // Itens
  itens: z.array(itemNFeSchema).min(1, 'NFC-e deve conter ao menos 1 item'),

  // Pagamento
  formaPagamento: z.number().int().min(1).max(99), // 01=Dinheiro, 02=Cheque, 03=Cartão Crédito, etc.
  valorPago: z.number().min(0),
  valorTroco: z.number().min(0).default(0),

  // Ambiente
  ambiente: z.number().int().min(1).max(2).default(2),
})

export type EmissaoNFCeInput = z.infer<typeof emissaoNFCeInputSchema>

/**
 * Input para cancelamento de NF-e ou NFC-e
 * Validates: Requirements 1.5
 */
export const cancelamentoInputSchema = z.object({
  documentoFiscalId: z.string().uuid(),
  justificativa: z
    .string()
    .min(15, 'Justificativa de cancelamento deve ter no mínimo 15 caracteres')
    .max(255, 'Justificativa de cancelamento deve ter no máximo 255 caracteres'),
})

export type CancelamentoInput = z.infer<typeof cancelamentoInputSchema>

/**
 * Input para Carta de Correção Eletrônica (CC-e)
 * Validates: Requirements 1.7
 */
export const cceInputSchema = z.object({
  documentoFiscalId: z.string().uuid(),
  textoCorrecao: z
    .string()
    .min(15, 'Texto da CC-e deve ter no mínimo 15 caracteres')
    .max(1000, 'Texto da CC-e deve ter no máximo 1000 caracteres'),
})

export type CCeInput = z.infer<typeof cceInputSchema>

/**
 * Input para inutilização de numeração
 * Validates: Requirements 1.8
 */
export const inutilizacaoInputSchema = z.object({
  serie: z.number().int().min(1).max(999),
  numeroInicial: z.number().int().min(1),
  numeroFinal: z.number().int().min(1),
  justificativa: z
    .string()
    .min(15, 'Justificativa de inutilização deve ter no mínimo 15 caracteres')
    .max(255, 'Justificativa de inutilização deve ter no máximo 255 caracteres'),
  modelo: z.number().int().refine((v) => v === 55 || v === 65, 'Modelo deve ser 55 (NF-e) ou 65 (NFC-e)'),
  ambiente: z.number().int().min(1).max(2).default(2),
}).refine(
  (data) => data.numeroFinal >= data.numeroInicial,
  { message: 'Número final deve ser maior ou igual ao número inicial', path: ['numeroFinal'] }
).refine(
  (data) => (data.numeroFinal - data.numeroInicial + 1) <= 1000,
  { message: 'Faixa de inutilização não pode exceder 1000 números', path: ['numeroFinal'] }
)

export type InutilizacaoInput = z.infer<typeof inutilizacaoInputSchema>

/**
 * Input para upload de certificado digital
 * Validates: Requirements 29.1
 */
export const certificadoUploadInputSchema = z.object({
  senha: z.string().min(1, 'Senha do certificado é obrigatória'),
  cnpj: z.string().regex(/^\d{14}$/, 'CNPJ deve conter 14 dígitos numéricos'),
})

export type CertificadoUploadInput = z.infer<typeof certificadoUploadInputSchema>

/**
 * Input para apuração de impostos
 * Validates: Requirements 1.1
 */
export const apuracaoInputSchema = z.object({
  tipo: z.enum(['ICMS', 'ICMS_ST', 'PIS', 'COFINS', 'IPI'], {
    errorMap: () => ({ message: 'Tipo de apuração deve ser ICMS, ICMS_ST, PIS, COFINS ou IPI' }),
  }),
  periodo: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Período deve estar no formato YYYY-MM'),
})

export type ApuracaoInput = z.infer<typeof apuracaoInputSchema>

/**
 * Input para geração de arquivo SPED
 * Validates: Requirements 1.1
 */
export const periodoSPEDInputSchema = z.object({
  tipo: z.enum(['FISCAL', 'CONTRIBUICOES', 'ECD', 'ECF', 'REINF'], {
    errorMap: () => ({ message: 'Tipo SPED deve ser FISCAL, CONTRIBUICOES, ECD, ECF ou REINF' }),
  }),
  periodo: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Período deve estar no formato YYYY-MM'),
  versaoLayout: z.string().optional(),
})

export type PeriodoSPEDInput = z.infer<typeof periodoSPEDInputSchema>

/**
 * Input para importação de XML de entrada
 * Validates: Requirements 1.1
 */
export const importacaoXMLInputSchema = z.object({
  chaveAcesso: z
    .string()
    .regex(/^\d{44}$/, 'Chave de acesso deve conter exatamente 44 dígitos numéricos')
    .optional(),
  verificarSefaz: z.boolean().default(true),
})

export type ImportacaoXMLInput = z.infer<typeof importacaoXMLInputSchema>
