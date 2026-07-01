/**
 * XML Validator — Validação estrutural de documentos fiscais
 * Valida XML contra regras estruturais dos layouts NF-e 4.00, NFC-e 4.00, CT-e 4.00, MDF-e 3.00.
 *
 * MVP: Validação estrutural (well-formed, elementos obrigatórios, formatos de campos).
 * Interface projetada para substituição futura por validação XSD completa (libxmljs2 ou similar).
 *
 * Validates: Requirements 1.1, 1.10, 36.1, 36.2
 */

import { XMLParser, XMLValidator } from 'fast-xml-parser'

// === Tipos públicos ===

export type TipoDocumentoValidacao = 'NFE' | 'NFCE' | 'CTE' | 'MDFE'

export interface ErroValidacao {
  campo: string
  mensagem: string
  linha?: number
}

export interface ValidacaoResult {
  valido: boolean
  erros: ErroValidacao[]
}

// === Configurações de validação por tipo de documento ===

interface SchemaConfig {
  rootElement: string
  infElement: string
  versao: string
  elementosObrigatorios: string[]
  /** Validações de campo específicas */
  validacoesCampos: CampoValidacao[]
}

interface CampoValidacao {
  caminho: string
  regra: 'cnpj' | 'cpf' | 'cpf_cnpj' | 'ncm' | 'cfop' | 'cest' | 'uf' | 'cep' | 'chave_acesso' | 'numero_positivo' | 'data_emissao' | 'obrigatorio'
  descricao: string
  /** Se true, valida apenas quando o campo existe */
  opcional?: boolean
}

const SCHEMAS: Record<TipoDocumentoValidacao, SchemaConfig> = {
  NFE: {
    rootElement: 'NFe',
    infElement: 'infNFe',
    versao: '4.00',
    elementosObrigatorios: [
      'infNFe',
      'infNFe.ide',
      'infNFe.emit',
      'infNFe.det',
      'infNFe.total',
      'infNFe.transp',
      'infNFe.pag',
    ],
    validacoesCampos: [
      { caminho: 'infNFe.ide.cUF', regra: 'obrigatorio', descricao: 'Código UF' },
      { caminho: 'infNFe.ide.natOp', regra: 'obrigatorio', descricao: 'Natureza da operação' },
      { caminho: 'infNFe.ide.mod', regra: 'obrigatorio', descricao: 'Modelo do documento' },
      { caminho: 'infNFe.ide.serie', regra: 'obrigatorio', descricao: 'Série' },
      { caminho: 'infNFe.ide.nNF', regra: 'numero_positivo', descricao: 'Número da NF-e' },
      { caminho: 'infNFe.ide.dhEmi', regra: 'data_emissao', descricao: 'Data de emissão' },
      { caminho: 'infNFe.ide.tpNF', regra: 'obrigatorio', descricao: 'Tipo operação (0=Entrada, 1=Saída)' },
      { caminho: 'infNFe.emit.CNPJ', regra: 'cnpj', descricao: 'CNPJ do emitente' },
      { caminho: 'infNFe.emit.xNome', regra: 'obrigatorio', descricao: 'Razão social emitente' },
      { caminho: 'infNFe.emit.enderEmit.UF', regra: 'uf', descricao: 'UF do emitente' },
      { caminho: 'infNFe.dest.CNPJ', regra: 'cnpj', descricao: 'CNPJ do destinatário', opcional: true },
      { caminho: 'infNFe.dest.CPF', regra: 'cpf', descricao: 'CPF do destinatário', opcional: true },
      { caminho: 'infNFe.det.prod.cProd', regra: 'obrigatorio', descricao: 'Código do produto' },
      { caminho: 'infNFe.det.prod.xProd', regra: 'obrigatorio', descricao: 'Descrição do produto' },
      { caminho: 'infNFe.det.prod.NCM', regra: 'ncm', descricao: 'NCM do produto' },
      { caminho: 'infNFe.det.prod.CFOP', regra: 'cfop', descricao: 'CFOP da operação' },
      { caminho: 'infNFe.det.prod.CEST', regra: 'cest', descricao: 'CEST do produto', opcional: true },
    ],
  },
  NFCE: {
    rootElement: 'NFe',
    infElement: 'infNFe',
    versao: '4.00',
    elementosObrigatorios: [
      'infNFe',
      'infNFe.ide',
      'infNFe.emit',
      'infNFe.det',
      'infNFe.total',
      'infNFe.pag',
    ],
    validacoesCampos: [
      { caminho: 'infNFe.ide.cUF', regra: 'obrigatorio', descricao: 'Código UF' },
      { caminho: 'infNFe.ide.mod', regra: 'obrigatorio', descricao: 'Modelo do documento' },
      { caminho: 'infNFe.ide.serie', regra: 'obrigatorio', descricao: 'Série' },
      { caminho: 'infNFe.ide.nNF', regra: 'numero_positivo', descricao: 'Número da NFC-e' },
      { caminho: 'infNFe.ide.dhEmi', regra: 'data_emissao', descricao: 'Data de emissão' },
      { caminho: 'infNFe.emit.CNPJ', regra: 'cnpj', descricao: 'CNPJ do emitente' },
      { caminho: 'infNFe.emit.xNome', regra: 'obrigatorio', descricao: 'Razão social emitente' },
      { caminho: 'infNFe.det.prod.cProd', regra: 'obrigatorio', descricao: 'Código do produto' },
      { caminho: 'infNFe.det.prod.xProd', regra: 'obrigatorio', descricao: 'Descrição do produto' },
      { caminho: 'infNFe.det.prod.NCM', regra: 'ncm', descricao: 'NCM do produto' },
      { caminho: 'infNFe.det.prod.CFOP', regra: 'cfop', descricao: 'CFOP da operação' },
    ],
  },
  CTE: {
    rootElement: 'CTe',
    infElement: 'infCte',
    versao: '4.00',
    elementosObrigatorios: [
      'infCte',
      'infCte.ide',
      'infCte.emit',
      'infCte.vPrest',
      'infCte.infCTeNorm',
    ],
    validacoesCampos: [
      { caminho: 'infCte.ide.cUF', regra: 'obrigatorio', descricao: 'Código UF' },
      { caminho: 'infCte.ide.mod', regra: 'obrigatorio', descricao: 'Modelo do documento' },
      { caminho: 'infCte.ide.serie', regra: 'obrigatorio', descricao: 'Série' },
      { caminho: 'infCte.ide.nCT', regra: 'numero_positivo', descricao: 'Número do CT-e' },
      { caminho: 'infCte.ide.dhEmi', regra: 'data_emissao', descricao: 'Data de emissão' },
      { caminho: 'infCte.emit.CNPJ', regra: 'cnpj', descricao: 'CNPJ do emitente' },
      { caminho: 'infCte.emit.xNome', regra: 'obrigatorio', descricao: 'Razão social emitente' },
      { caminho: 'infCte.ide.CFOP', regra: 'cfop', descricao: 'CFOP da prestação' },
    ],
  },
  MDFE: {
    rootElement: 'MDFe',
    infElement: 'infMDFe',
    versao: '3.00',
    elementosObrigatorios: [
      'infMDFe',
      'infMDFe.ide',
      'infMDFe.emit',
      'infMDFe.infModal',
      'infMDFe.infDoc',
      'infMDFe.tot',
    ],
    validacoesCampos: [
      { caminho: 'infMDFe.ide.cUF', regra: 'obrigatorio', descricao: 'Código UF' },
      { caminho: 'infMDFe.ide.mod', regra: 'obrigatorio', descricao: 'Modelo do documento' },
      { caminho: 'infMDFe.ide.serie', regra: 'obrigatorio', descricao: 'Série' },
      { caminho: 'infMDFe.ide.nMDF', regra: 'numero_positivo', descricao: 'Número do MDF-e' },
      { caminho: 'infMDFe.ide.dhEmi', regra: 'data_emissao', descricao: 'Data de emissão' },
      { caminho: 'infMDFe.emit.CNPJ', regra: 'cnpj', descricao: 'CNPJ do emitente' },
      { caminho: 'infMDFe.emit.xNome', regra: 'obrigatorio', descricao: 'Razão social emitente' },
    ],
  },
}

// === Constantes de validação ===

const UFS_VALIDAS = [
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO',
  'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR',
  'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
]

// === Parser XML ===

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => name === 'det' || name === 'infMunDescarga' || name === 'infCTe' || name === 'infNFe',
})

// === Funções de validação ===

/**
 * Valida um documento fiscal XML contra as regras estruturais do layout.
 * Verifica: well-formedness, elemento raiz, elementos obrigatórios, formatos de campos.
 */
export function validarXML(xml: string, tipo: TipoDocumentoValidacao): ValidacaoResult {
  const erros: ErroValidacao[] = []

  // 1. Validar que o XML não está vazio
  if (!xml || xml.trim().length === 0) {
    return { valido: false, erros: [{ campo: 'xml', mensagem: 'XML está vazio' }] }
  }

  // 2. Validar well-formedness (parseável)
  const validationResult = XMLValidator.validate(xml)
  if (validationResult !== true) {
    const err = (validationResult as { err: { msg: string; line: number; col: number } }).err
    return {
      valido: false,
      erros: [{
        campo: 'xml',
        mensagem: `XML mal-formado: ${err.msg}`,
        linha: err.line,
      }],
    }
  }

  let parsed: Record<string, unknown>
  try {
    parsed = parser.parse(xml)
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : 'Erro desconhecido ao parsear XML'
    return { valido: false, erros: [{ campo: 'xml', mensagem: `XML mal-formado: ${mensagem}` }] }
  }

  const schema = SCHEMAS[tipo]

  // 3. Validar elemento raiz
  const rootData = extrairRaiz(parsed, schema.rootElement)
  if (!rootData) {
    erros.push({
      campo: schema.rootElement,
      mensagem: `Elemento raiz '${schema.rootElement}' não encontrado. Esperado para documentos do tipo ${tipo}`,
    })
    return { valido: false, erros }
  }

  // 4. Validar versão do layout (atributo no infElement)
  const infData = resolverCaminho(rootData, schema.infElement)
  if (infData && typeof infData === 'object') {
    const versao = (infData as Record<string, unknown>)['@_versao']
    if (versao && versao !== schema.versao) {
      erros.push({
        campo: `${schema.infElement}@versao`,
        mensagem: `Versão do layout '${versao}' não é a esperada '${schema.versao}'`,
      })
    }
  }

  // 5. Validar elementos obrigatórios
  for (const elementoPath of schema.elementosObrigatorios) {
    const valor = resolverCaminho(rootData, elementoPath)
    if (valor === undefined || valor === null) {
      erros.push({
        campo: elementoPath,
        mensagem: `Elemento obrigatório '${elementoPath}' não encontrado`,
      })
    }
  }

  // 6. Validar campos específicos
  validarCamposEspecificos(rootData, schema, erros)

  return { valido: erros.length === 0, erros }
}

// === Funções internas de suporte ===

/**
 * Extrai dados do elemento raiz do documento fiscal.
 * Lida com namespaces (fast-xml-parser pode incluir prefixo de namespace).
 */
function extrairRaiz(parsed: Record<string, unknown>, rootElement: string): Record<string, unknown> | null {
  // Tenta acesso direto
  if (parsed[rootElement]) {
    return parsed[rootElement] as Record<string, unknown>
  }

  // Tenta com declaração XML (? xml vem antes)
  // fast-xml-parser pode ter '?xml' como propriedade
  const keys = Object.keys(parsed).filter(k => !k.startsWith('?'))
  for (const key of keys) {
    // Checa se é o root (pode ter namespace prefix como 'nfe:NFe')
    if (key === rootElement || key.endsWith(`:${rootElement}`)) {
      return parsed[key] as Record<string, unknown>
    }
  }

  return null
}

/**
 * Resolve um caminho de propriedade em notação dot (ex: 'infNFe.ide.cUF')
 * dentro de um objeto parseado. Suporta arrays (pega primeiro elemento para validação).
 */
function resolverCaminho(obj: unknown, caminho: string): unknown {
  const partes = caminho.split('.')
  let atual: unknown = obj

  for (const parte of partes) {
    if (atual === null || atual === undefined) return undefined
    if (typeof atual !== 'object') return undefined

    const objAtual = atual as Record<string, unknown>
    atual = objAtual[parte]

    // Se é array, valida o primeiro elemento (para campos de itens)
    if (Array.isArray(atual) && atual.length > 0) {
      atual = atual[0]
    }
  }

  return atual
}

/**
 * Executa validações de formato em campos específicos do documento.
 */
function validarCamposEspecificos(
  rootData: Record<string, unknown>,
  schema: SchemaConfig,
  erros: ErroValidacao[],
): void {
  for (const validacao of schema.validacoesCampos) {
    const valor = resolverCaminho(rootData, validacao.caminho)

    // Se opcional e ausente, pula
    if (validacao.opcional && (valor === undefined || valor === null)) continue

    // Se campo obrigatório e ausente
    if (!validacao.opcional && (valor === undefined || valor === null || valor === '')) {
      if (validacao.regra !== 'obrigatorio') {
        // O campo ausente será pego pela regra de formato a seguir
        erros.push({
          campo: validacao.caminho,
          mensagem: `${validacao.descricao}: campo ausente`,
        })
      } else {
        erros.push({
          campo: validacao.caminho,
          mensagem: `${validacao.descricao}: campo obrigatório não preenchido`,
        })
      }
      continue
    }

    // Se regra é apenas 'obrigatorio', a presença já foi validada
    if (validacao.regra === 'obrigatorio') continue

    const valorStr = String(valor)

    switch (validacao.regra) {
      case 'cnpj':
        if (!validarCNPJ(valorStr)) {
          erros.push({ campo: validacao.caminho, mensagem: `${validacao.descricao}: CNPJ inválido '${valorStr}'` })
        }
        break

      case 'cpf':
        if (!validarCPF(valorStr)) {
          erros.push({ campo: validacao.caminho, mensagem: `${validacao.descricao}: CPF inválido '${valorStr}'` })
        }
        break

      case 'cpf_cnpj':
        if (valorStr.length === 14 && !validarCNPJ(valorStr)) {
          erros.push({ campo: validacao.caminho, mensagem: `${validacao.descricao}: CNPJ inválido '${valorStr}'` })
        } else if (valorStr.length === 11 && !validarCPF(valorStr)) {
          erros.push({ campo: validacao.caminho, mensagem: `${validacao.descricao}: CPF inválido '${valorStr}'` })
        } else if (valorStr.length !== 11 && valorStr.length !== 14) {
          erros.push({ campo: validacao.caminho, mensagem: `${validacao.descricao}: CPF/CNPJ deve ter 11 ou 14 dígitos` })
        }
        break

      case 'ncm':
        if (!validarNCM(valorStr)) {
          erros.push({ campo: validacao.caminho, mensagem: `${validacao.descricao}: NCM deve ter 8 dígitos numéricos, recebido '${valorStr}'` })
        }
        break

      case 'cfop':
        if (!validarCFOP(valorStr)) {
          erros.push({ campo: validacao.caminho, mensagem: `${validacao.descricao}: CFOP deve ter 4 dígitos numéricos, recebido '${valorStr}'` })
        }
        break

      case 'cest':
        if (!validarCEST(valorStr)) {
          erros.push({ campo: validacao.caminho, mensagem: `${validacao.descricao}: CEST deve ter 7 dígitos numéricos, recebido '${valorStr}'` })
        }
        break

      case 'uf':
        if (!UFS_VALIDAS.includes(valorStr.toUpperCase())) {
          erros.push({ campo: validacao.caminho, mensagem: `${validacao.descricao}: UF inválida '${valorStr}'` })
        }
        break

      case 'cep':
        if (!/^\d{8}$/.test(valorStr)) {
          erros.push({ campo: validacao.caminho, mensagem: `${validacao.descricao}: CEP deve ter 8 dígitos numéricos` })
        }
        break

      case 'chave_acesso':
        if (!/^\d{44}$/.test(valorStr)) {
          erros.push({ campo: validacao.caminho, mensagem: `${validacao.descricao}: Chave de acesso deve ter 44 dígitos numéricos` })
        }
        break

      case 'numero_positivo':
        if (!validarNumeroPositivo(valorStr)) {
          erros.push({ campo: validacao.caminho, mensagem: `${validacao.descricao}: deve ser número positivo, recebido '${valorStr}'` })
        }
        break

      case 'data_emissao':
        if (!validarDataEmissao(valorStr)) {
          erros.push({ campo: validacao.caminho, mensagem: `${validacao.descricao}: formato de data inválido '${valorStr}'` })
        }
        break
    }
  }

  // Validação de itens (det) para NF-e e NFC-e — valida todos os itens
  if (schema.rootElement === 'NFe') {
    validarItensNFe(rootData, schema, erros)
  }
}

/**
 * Valida todos os itens (det) de uma NF-e/NFC-e.
 */
function validarItensNFe(
  rootData: Record<string, unknown>,
  schema: SchemaConfig,
  erros: ErroValidacao[],
): void {
  const infNFe = rootData['infNFe'] as Record<string, unknown> | undefined
  if (!infNFe) return

  const det = infNFe['det']
  if (!det) return

  const itens = Array.isArray(det) ? det : [det]

  for (let i = 0; i < itens.length; i++) {
    const item = itens[i] as Record<string, unknown>
    const nItem = i + 1
    const prod = item['prod'] as Record<string, unknown> | undefined

    if (!prod) {
      erros.push({ campo: `infNFe.det[${nItem}].prod`, mensagem: `Item ${nItem}: elemento 'prod' obrigatório ausente` })
      continue
    }

    // NCM obrigatório e com 8 dígitos
    const ncm = prod['NCM'] as string | undefined
    if (!ncm || !validarNCM(String(ncm))) {
      erros.push({
        campo: `infNFe.det[${nItem}].prod.NCM`,
        mensagem: `Item ${nItem}: NCM deve ter 8 dígitos numéricos${ncm ? `, recebido '${ncm}'` : ''}`,
      })
    }

    // CFOP obrigatório e com 4 dígitos
    const cfop = prod['CFOP'] as string | undefined
    if (!cfop || !validarCFOP(String(cfop))) {
      erros.push({
        campo: `infNFe.det[${nItem}].prod.CFOP`,
        mensagem: `Item ${nItem}: CFOP deve ter 4 dígitos numéricos${cfop ? `, recebido '${cfop}'` : ''}`,
      })
    }

    // CEST (se presente, deve ter 7 dígitos)
    const cest = prod['CEST'] as string | undefined
    if (cest && !validarCEST(String(cest))) {
      erros.push({
        campo: `infNFe.det[${nItem}].prod.CEST`,
        mensagem: `Item ${nItem}: CEST deve ter 7 dígitos numéricos, recebido '${cest}'`,
      })
    }

    // Quantidade e valor devem ser positivos
    const qCom = prod['qCom'] as string | undefined
    if (qCom && !validarNumeroPositivo(String(qCom))) {
      erros.push({
        campo: `infNFe.det[${nItem}].prod.qCom`,
        mensagem: `Item ${nItem}: quantidade deve ser positiva`,
      })
    }

    const vProd = prod['vProd'] as string | undefined
    if (vProd && !validarNumeroPositivo(String(vProd))) {
      erros.push({
        campo: `infNFe.det[${nItem}].prod.vProd`,
        mensagem: `Item ${nItem}: valor do produto deve ser positivo`,
      })
    }
  }
}

// === Funções auxiliares de validação de formato ===

/** CNPJ: 14 dígitos numéricos com dígito verificador válido */
function validarCNPJ(cnpj: string): boolean {
  if (!/^\d{14}$/.test(cnpj)) return false
  // Rejeitar CNPJs com todos os dígitos iguais
  if (/^(\d)\1{13}$/.test(cnpj)) return false

  const digits = cnpj.split('').map(Number)

  // Primeiro dígito verificador
  const pesos1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  let soma = 0
  for (let i = 0; i < 12; i++) soma += digits[i] * pesos1[i]
  let resto = soma % 11
  const dv1 = resto < 2 ? 0 : 11 - resto
  if (digits[12] !== dv1) return false

  // Segundo dígito verificador
  const pesos2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  soma = 0
  for (let i = 0; i < 13; i++) soma += digits[i] * pesos2[i]
  resto = soma % 11
  const dv2 = resto < 2 ? 0 : 11 - resto
  if (digits[13] !== dv2) return false

  return true
}

/** CPF: 11 dígitos numéricos com dígito verificador válido */
function validarCPF(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf)) return false
  // Rejeitar CPFs com todos os dígitos iguais
  if (/^(\d)\1{10}$/.test(cpf)) return false

  const digits = cpf.split('').map(Number)

  // Primeiro dígito
  let soma = 0
  for (let i = 0; i < 9; i++) soma += digits[i] * (10 - i)
  let resto = (soma * 10) % 11
  if (resto === 10) resto = 0
  if (digits[9] !== resto) return false

  // Segundo dígito
  soma = 0
  for (let i = 0; i < 10; i++) soma += digits[i] * (11 - i)
  resto = (soma * 10) % 11
  if (resto === 10) resto = 0
  if (digits[10] !== resto) return false

  return true
}

/** NCM: exatamente 8 dígitos numéricos */
function validarNCM(ncm: string): boolean {
  return /^\d{8}$/.test(ncm)
}

/** CFOP: exatamente 4 dígitos numéricos, primeiro dígito 1-7 */
function validarCFOP(cfop: string): boolean {
  return /^[1-7]\d{3}$/.test(cfop)
}

/** CEST: exatamente 7 dígitos numéricos */
function validarCEST(cest: string): boolean {
  return /^\d{7}$/.test(cest)
}

/** Número positivo (inteiro ou decimal > 0) */
function validarNumeroPositivo(valor: string): boolean {
  const num = parseFloat(valor)
  return !isNaN(num) && num > 0
}

/** Data de emissão: formato ISO 8601 (YYYY-MM-DDThh:mm:ss±hh:mm) ou YYYY-MM-DD */
function validarDataEmissao(data: string): boolean {
  // Formato SEFAZ: 2024-01-15T10:30:00-03:00
  const isoRegex = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)?)?$/
  if (!isoRegex.test(data)) return false

  // Verifica se a data é válida
  const dateObj = new Date(data)
  return !isNaN(dateObj.getTime())
}

// === Exportações auxiliares para testes ===

export const _internals = {
  validarCNPJ,
  validarCPF,
  validarNCM,
  validarCFOP,
  validarCEST,
  validarNumeroPositivo,
  validarDataEmissao,
  resolverCaminho,
  extrairRaiz,
}
