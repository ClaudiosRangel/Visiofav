/**
 * Erros e códigos de erro do módulo fiscal
 * Classe de erro customizada e enum com códigos padronizados
 */

// === Enum de códigos de erro ===

export enum CodigoErroFiscal {
  // Erros de validação (1xxx)
  CAMPOS_OBRIGATORIOS_AUSENTES = 1001,
  NCM_INVALIDO = 1002,
  CFOP_INVALIDO = 1003,
  UF_INVALIDA = 1004,
  ALIQUOTA_FORA_FAIXA = 1005,
  CHAVE_ACESSO_INVALIDA = 1006,
  XML_INVALIDO_XSD = 1007,
  DADOS_EMITENTE_INCOMPLETOS = 1008,
  DADOS_DESTINATARIO_INCOMPLETOS = 1009,
  TOTAIS_DIVERGENTES = 1010,

  // Erros de regra tributária (2xxx)
  REGRA_NAO_ENCONTRADA = 2001,
  REGRA_DUPLICADA = 2002,
  REGIME_TRIBUTARIO_INVALIDO = 2003,

  // Erros de emissão (3xxx)
  SEFAZ_INDISPONIVEL = 3001,
  SEFAZ_REJEICAO = 3002,
  SEFAZ_TIMEOUT = 3003,
  DOCUMENTO_JA_AUTORIZADO = 3004,
  DOCUMENTO_JA_CANCELADO = 3005,
  PRAZO_CANCELAMENTO_EXCEDIDO = 3006,
  LIMITE_CCE_EXCEDIDO = 3007,
  FAIXA_INUTILIZACAO_EXCEDIDA = 3008,
  JUSTIFICATIVA_INVALIDA = 3009,

  // Erros de certificado (4xxx)
  CERTIFICADO_NAO_ENCONTRADO = 4001,
  CERTIFICADO_EXPIRADO = 4002,
  CERTIFICADO_CNPJ_DIVERGENTE = 4003,
  CERTIFICADO_CADEIA_INVALIDA = 4004,
  CERTIFICADO_SENHA_INCORRETA = 4005,
  CERTIFICADO_LIMITE_ATINGIDO = 4006,

  // Erros de contingência (5xxx)
  FILA_CONTINGENCIA_CHEIA = 5001,
  RETRANSMISSAO_FALHOU = 5002,
  CONTINGENCIA_JA_ATIVA = 5003,

  // Erros SPED (6xxx)
  SPED_PERIODO_SEM_DADOS = 6001,
  SPED_VALIDACAO_ESTRUTURAL = 6002,
  SPED_BLOCO_OBRIGATORIO_AUSENTE = 6003,
  SPED_TOTALIZACAO_INCONSISTENTE = 6004,

  // Erros de apuração (7xxx)
  APURACAO_PERIODO_FECHADO = 7001,
  APURACAO_SALDO_INCONSISTENTE = 7002,

  // Erros de importação XML (8xxx)
  XML_DUPLICADO = 8001,
  XML_CANCELADO_SEFAZ = 8002,
  XML_ASSINATURA_INVALIDA = 8003,
  XML_ESTRUTURA_INVALIDA = 8004,
}

// === Classe de erro customizada ===

export class ErroFiscal extends Error {
  public readonly codigo: CodigoErroFiscal
  public readonly detalhes?: Record<string, unknown>
  public readonly timestamp: Date

  constructor(
    codigo: CodigoErroFiscal,
    mensagem: string,
    detalhes?: Record<string, unknown>
  ) {
    super(mensagem)
    this.name = 'ErroFiscal'
    this.codigo = codigo
    this.detalhes = detalhes
    this.timestamp = new Date()

    // Mantém stack trace correto em V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ErroFiscal)
    }
  }

  /**
   * Retorna representação serializada do erro para resposta HTTP
   */
  toJSON() {
    return {
      erro: this.name,
      codigo: this.codigo,
      mensagem: this.message,
      detalhes: this.detalhes,
      timestamp: this.timestamp.toISOString(),
    }
  }
}
