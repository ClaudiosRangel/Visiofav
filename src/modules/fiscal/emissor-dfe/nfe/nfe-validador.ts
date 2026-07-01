/**
 * Validador de NF-e — Regras de Negócio (pré-transmissão)
 *
 * Valida dados da NF-e antes da validação XSD e transmissão à SEFAZ.
 * Retorna lista de erros quando inválido, bloqueando a transmissão.
 *
 * Validações:
 * - Campos obrigatórios (emitente, destinatário, itens)
 * - Consistência de totais (soma dos itens vs total informado)
 * - CNPJ (formato + dígito verificador)
 * - Inscrição Estadual (formato por UF)
 * - Datas (não podem ser futuras)
 *
 * Requirements: 1.1, 1.10
 */

import type { DadosNFe, DadosEmitenteNFe, DadosDestinatarioNFe, DadosItemNFe } from './nfe-xml-builder'

// === Tipos ===

export interface ErroValidacaoNFe {
  /** Campo com problema */
  campo: string
  /** Descrição do erro */
  mensagem: string
  /** Severidade: 'erro' bloqueia transmissão, 'aviso' apenas alerta */
  severidade: 'erro' | 'aviso'
}

export interface ResultadoValidacaoNFe {
  /** true se não há erros (pode ter avisos) */
  valido: boolean
  /** Lista de erros e avisos encontrados */
  erros: ErroValidacaoNFe[]
}

// === Validação principal ===

/**
 * Valida os dados da NF-e antes da transmissão.
 * Bloqueia transmissão se houver erros (severidade 'erro').
 *
 * @param dados - Dados completos da NF-e
 * @returns Resultado com lista de erros/avisos
 */
export function validarNFe(dados: DadosNFe): ResultadoValidacaoNFe {
  const erros: ErroValidacaoNFe[] = []

  validarCamposObrigatorios(dados, erros)
  validarEmitente(dados.emitente, erros)
  validarDestinatario(dados.destinatario, erros)
  validarItens(dados.itens, erros)
  validarTotais(dados, erros)
  validarDatas(dados, erros)

  const valido = !erros.some(e => e.severidade === 'erro')
  return { valido, erros }
}

// === Validação de campos obrigatórios ===

function validarCamposObrigatorios(dados: DadosNFe, erros: ErroValidacaoNFe[]): void {
  if (!dados.cUF || dados.cUF <= 0) {
    erros.push({ campo: 'cUF', mensagem: 'Código da UF do emitente é obrigatório', severidade: 'erro' })
  }

  if (!dados.cNF || dados.cNF.length !== 8) {
    erros.push({ campo: 'cNF', mensagem: 'Código numérico (cNF) deve ter 8 dígitos', severidade: 'erro' })
  }

  if (!dados.nNF || dados.nNF <= 0 || dados.nNF > 999999999) {
    erros.push({ campo: 'nNF', mensagem: 'Número da NF-e deve estar entre 1 e 999999999', severidade: 'erro' })
  }

  if (!dados.modelo || dados.modelo !== 55) {
    erros.push({ campo: 'modelo', mensagem: 'Modelo deve ser 55 (NF-e)', severidade: 'erro' })
  }

  if (dados.serie == null || dados.serie < 0 || dados.serie > 999) {
    erros.push({ campo: 'serie', mensagem: 'Série deve estar entre 0 e 999', severidade: 'erro' })
  }

  if (![1, 2, 5, 6, 7, 9].includes(dados.tpEmis)) {
    erros.push({ campo: 'tpEmis', mensagem: 'Tipo de emissão inválido', severidade: 'erro' })
  }

  if (![1, 2].includes(dados.ambiente)) {
    erros.push({ campo: 'ambiente', mensagem: 'Ambiente deve ser 1 (Produção) ou 2 (Homologação)', severidade: 'erro' })
  }

  if (!dados.cMunFG || dados.cMunFG.length !== 7) {
    erros.push({ campo: 'cMunFG', mensagem: 'Código do município do fato gerador deve ter 7 dígitos', severidade: 'erro' })
  }

  if (!dados.dataEmissao) {
    erros.push({ campo: 'dataEmissao', mensagem: 'Data de emissão é obrigatória', severidade: 'erro' })
  }

  if (!dados.emitente) {
    erros.push({ campo: 'emitente', mensagem: 'Dados do emitente são obrigatórios', severidade: 'erro' })
  }

  if (!dados.itens || dados.itens.length === 0) {
    erros.push({ campo: 'itens', mensagem: 'NF-e deve conter ao menos 1 item', severidade: 'erro' })
  }

  if (dados.itens && dados.itens.length > 990) {
    erros.push({ campo: 'itens', mensagem: 'NF-e não pode conter mais de 990 itens', severidade: 'erro' })
  }
}

// === Validação de emitente ===

function validarEmitente(emitente: DadosEmitenteNFe | undefined, erros: ErroValidacaoNFe[]): void {
  if (!emitente) return // já reportado como campo obrigatório ausente

  if (!emitente.cnpj) {
    erros.push({ campo: 'emitente.cnpj', mensagem: 'CNPJ do emitente é obrigatório', severidade: 'erro' })
  } else if (!validarCNPJ(emitente.cnpj)) {
    erros.push({ campo: 'emitente.cnpj', mensagem: 'CNPJ do emitente é inválido (dígito verificador)', severidade: 'erro' })
  }

  if (!emitente.razaoSocial || emitente.razaoSocial.trim().length === 0) {
    erros.push({ campo: 'emitente.razaoSocial', mensagem: 'Razão social do emitente é obrigatória', severidade: 'erro' })
  }

  if (!emitente.uf || !UFS_VALIDAS.includes(emitente.uf)) {
    erros.push({ campo: 'emitente.uf', mensagem: 'UF do emitente é obrigatória e deve ser válida', severidade: 'erro' })
  }

  if (!emitente.ie) {
    erros.push({ campo: 'emitente.ie', mensagem: 'Inscrição Estadual do emitente é obrigatória', severidade: 'erro' })
  } else if (emitente.uf && !validarIE(emitente.ie, emitente.uf)) {
    erros.push({ campo: 'emitente.ie', mensagem: `Inscrição Estadual inválida para UF ${emitente.uf}`, severidade: 'aviso' })
  }

  if (![1, 2, 3].includes(emitente.crt)) {
    erros.push({ campo: 'emitente.crt', mensagem: 'CRT deve ser 1 (SN), 2 (SN Excesso) ou 3 (Normal)', severidade: 'erro' })
  }

  if (!emitente.endereco) {
    erros.push({ campo: 'emitente.endereco', mensagem: 'Endereço do emitente é obrigatório', severidade: 'erro' })
  } else {
    if (!emitente.endereco.logradouro) {
      erros.push({ campo: 'emitente.endereco.logradouro', mensagem: 'Logradouro do emitente é obrigatório', severidade: 'erro' })
    }
    if (!emitente.endereco.numero) {
      erros.push({ campo: 'emitente.endereco.numero', mensagem: 'Número do endereço do emitente é obrigatório', severidade: 'erro' })
    }
    if (!emitente.endereco.bairro) {
      erros.push({ campo: 'emitente.endereco.bairro', mensagem: 'Bairro do emitente é obrigatório', severidade: 'erro' })
    }
    if (!emitente.endereco.codigoMunicipio || emitente.endereco.codigoMunicipio.length !== 7) {
      erros.push({ campo: 'emitente.endereco.codigoMunicipio', mensagem: 'Código do município do emitente deve ter 7 dígitos', severidade: 'erro' })
    }
    if (!emitente.endereco.uf) {
      erros.push({ campo: 'emitente.endereco.uf', mensagem: 'UF do endereço do emitente é obrigatória', severidade: 'erro' })
    }
    if (!emitente.endereco.cep || emitente.endereco.cep.length !== 8) {
      erros.push({ campo: 'emitente.endereco.cep', mensagem: 'CEP do emitente deve ter 8 dígitos', severidade: 'erro' })
    }
  }
}

// === Validação de destinatário ===

function validarDestinatario(dest: DadosDestinatarioNFe | undefined, erros: ErroValidacaoNFe[]): void {
  if (!dest) return // Destinatário pode ser omitido em NFC-e para consumidor final

  if (dest.cpfCnpj) {
    if (dest.cpfCnpj.length === 14) {
      if (!validarCNPJ(dest.cpfCnpj)) {
        erros.push({ campo: 'destinatario.cpfCnpj', mensagem: 'CNPJ do destinatário é inválido (dígito verificador)', severidade: 'erro' })
      }
    } else if (dest.cpfCnpj.length === 11) {
      if (!validarCPF(dest.cpfCnpj)) {
        erros.push({ campo: 'destinatario.cpfCnpj', mensagem: 'CPF do destinatário é inválido (dígito verificador)', severidade: 'erro' })
      }
    } else {
      erros.push({ campo: 'destinatario.cpfCnpj', mensagem: 'CPF/CNPJ do destinatário deve ter 11 (CPF) ou 14 (CNPJ) dígitos', severidade: 'erro' })
    }
  }

  if (dest.ie && dest.ie !== 'ISENTO' && dest.uf) {
    if (!validarIE(dest.ie, dest.uf)) {
      erros.push({ campo: 'destinatario.ie', mensagem: `Inscrição Estadual do destinatário inválida para UF ${dest.uf}`, severidade: 'aviso' })
    }
  }
}

// === Validação de itens ===

function validarItens(itens: DadosItemNFe[] | undefined, erros: ErroValidacaoNFe[]): void {
  if (!itens || itens.length === 0) return

  for (let i = 0; i < itens.length; i++) {
    const item = itens[i]
    const prefixo = `itens[${i}]`

    if (!item.codigoProd || item.codigoProd.trim().length === 0) {
      erros.push({ campo: `${prefixo}.codigoProd`, mensagem: `Item ${i + 1}: código do produto é obrigatório`, severidade: 'erro' })
    }

    if (!item.descricao || item.descricao.trim().length === 0) {
      erros.push({ campo: `${prefixo}.descricao`, mensagem: `Item ${i + 1}: descrição é obrigatória`, severidade: 'erro' })
    }

    if (!item.ncm || !/^\d{8}$/.test(item.ncm)) {
      erros.push({ campo: `${prefixo}.ncm`, mensagem: `Item ${i + 1}: NCM deve ter 8 dígitos numéricos`, severidade: 'erro' })
    }

    if (!item.cfop || !/^\d{4}$/.test(item.cfop)) {
      erros.push({ campo: `${prefixo}.cfop`, mensagem: `Item ${i + 1}: CFOP deve ter 4 dígitos numéricos`, severidade: 'erro' })
    }

    if (!item.unidade || item.unidade.trim().length === 0) {
      erros.push({ campo: `${prefixo}.unidade`, mensagem: `Item ${i + 1}: unidade de medida é obrigatória`, severidade: 'erro' })
    }

    if (item.quantidade == null || item.quantidade <= 0) {
      erros.push({ campo: `${prefixo}.quantidade`, mensagem: `Item ${i + 1}: quantidade deve ser maior que zero`, severidade: 'erro' })
    }

    if (item.valorUnitario == null || item.valorUnitario < 0) {
      erros.push({ campo: `${prefixo}.valorUnitario`, mensagem: `Item ${i + 1}: valor unitário não pode ser negativo`, severidade: 'erro' })
    }

    if (item.valorTotal == null || item.valorTotal < 0) {
      erros.push({ campo: `${prefixo}.valorTotal`, mensagem: `Item ${i + 1}: valor total não pode ser negativo`, severidade: 'erro' })
    }

    // Validar consistência valor total do item vs quantidade * valor unitário
    if (item.quantidade > 0 && item.valorUnitario >= 0 && item.valorTotal >= 0) {
      const calculado = Math.round(item.quantidade * item.valorUnitario * 100) / 100
      const diferenca = Math.abs(calculado - item.valorTotal)
      if (diferenca > 0.01) {
        erros.push({
          campo: `${prefixo}.valorTotal`,
          mensagem: `Item ${i + 1}: valor total (${item.valorTotal}) diverge de qtd × vUnit (${calculado})`,
          severidade: 'aviso',
        })
      }
    }
  }
}

// === Validação de totais ===

function validarTotais(dados: DadosNFe, erros: ErroValidacaoNFe[]): void {
  if (!dados.itens || dados.itens.length === 0) return

  // Soma dos valores dos itens
  let somaVProd = 0
  let somaVDesc = 0
  let somaICMS = 0
  let somaIPI = 0
  let somaPIS = 0
  let somaCOFINS = 0
  let somaST = 0

  for (const item of dados.itens) {
    somaVProd += item.valorTotal || 0
    somaVDesc += item.valorDesconto || 0
    if (item.icms) {
      somaICMS += item.icms.valor || 0
      somaST += item.icms.valorST || 0
    }
    if (item.ipi) somaIPI += item.ipi.valor || 0
    if (item.pis) somaPIS += item.pis.valor || 0
    if (item.cofins) somaCOFINS += item.cofins.valor || 0
  }

  // Verificar se vProd não é zero (NF-e sem valor)
  if (somaVProd <= 0) {
    erros.push({ campo: 'total.vProd', mensagem: 'Valor total dos produtos deve ser maior que zero', severidade: 'erro' })
  }

  // Verificar se valor do desconto não excede valor dos produtos
  if (somaVDesc > somaVProd) {
    erros.push({
      campo: 'total.vDesc',
      mensagem: `Valor total do desconto (${somaVDesc.toFixed(2)}) excede o valor dos produtos (${somaVProd.toFixed(2)})`,
      severidade: 'erro',
    })
  }

  // Verificar consistência: vNF = vProd - vDesc + vST + vFrete + vSeg + vOutro + vIPI
  const vFrete = dados.valorFrete || 0
  const vSeg = dados.valorSeguro || 0
  const vOutro = dados.valorOutras || 0
  const vDescTotal = dados.valorDesconto || 0

  const valorNFCalculado = somaVProd - vDescTotal + somaST + vFrete + vSeg + vOutro + somaIPI

  if (valorNFCalculado < 0) {
    erros.push({
      campo: 'total.vNF',
      mensagem: 'Valor total da NF-e resulta em valor negativo',
      severidade: 'erro',
    })
  }
}

// === Validação de datas ===

function validarDatas(dados: DadosNFe, erros: ErroValidacaoNFe[]): void {
  if (!dados.dataEmissao) return

  const agora = new Date()
  // Margem de 5 minutos para diferença de relógio
  const margemMs = 5 * 60 * 1000

  if (dados.dataEmissao.getTime() > agora.getTime() + margemMs) {
    erros.push({
      campo: 'dataEmissao',
      mensagem: 'Data de emissão não pode ser futura',
      severidade: 'erro',
    })
  }

  if (dados.dataSaida && dados.dataSaida.getTime() > agora.getTime() + margemMs) {
    erros.push({
      campo: 'dataSaida',
      mensagem: 'Data de saída não pode ser futura',
      severidade: 'aviso',
    })
  }
}

// === Validação de CNPJ ===

/**
 * Valida CNPJ com dígitos verificadores (módulo 11).
 * Aceita apenas string de 14 dígitos numéricos.
 */
export function validarCNPJ(cnpj: string): boolean {
  // Remover formatação se necessário
  const limpo = cnpj.replace(/\D/g, '')

  if (limpo.length !== 14) return false

  // Rejeitar CNPJs com todos os dígitos iguais
  if (/^(\d)\1{13}$/.test(limpo)) return false

  // Cálculo do primeiro dígito verificador
  const pesos1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  let soma = 0
  for (let i = 0; i < 12; i++) {
    soma += parseInt(limpo[i], 10) * pesos1[i]
  }
  let resto = soma % 11
  const dv1 = resto < 2 ? 0 : 11 - resto

  if (parseInt(limpo[12], 10) !== dv1) return false

  // Cálculo do segundo dígito verificador
  const pesos2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  soma = 0
  for (let i = 0; i < 13; i++) {
    soma += parseInt(limpo[i], 10) * pesos2[i]
  }
  resto = soma % 11
  const dv2 = resto < 2 ? 0 : 11 - resto

  if (parseInt(limpo[13], 10) !== dv2) return false

  return true
}

// === Validação de CPF ===

/**
 * Valida CPF com dígitos verificadores (módulo 11).
 * Aceita apenas string de 11 dígitos numéricos.
 */
export function validarCPF(cpf: string): boolean {
  const limpo = cpf.replace(/\D/g, '')

  if (limpo.length !== 11) return false

  // Rejeitar CPFs com todos os dígitos iguais
  if (/^(\d)\1{10}$/.test(limpo)) return false

  // Cálculo do primeiro dígito verificador
  let soma = 0
  for (let i = 0; i < 9; i++) {
    soma += parseInt(limpo[i], 10) * (10 - i)
  }
  let resto = soma % 11
  const dv1 = resto < 2 ? 0 : 11 - resto

  if (parseInt(limpo[9], 10) !== dv1) return false

  // Cálculo do segundo dígito verificador
  soma = 0
  for (let i = 0; i < 10; i++) {
    soma += parseInt(limpo[i], 10) * (11 - i)
  }
  resto = soma % 11
  const dv2 = resto < 2 ? 0 : 11 - resto

  if (parseInt(limpo[10], 10) !== dv2) return false

  return true
}

// === Validação de IE ===

/**
 * Valida Inscrição Estadual por UF.
 * Validação simplificada: verifica formato básico (tamanho e apenas dígitos).
 * Validações completas por UF incluem dígitos verificadores específicos.
 */
export function validarIE(ie: string, uf: string): boolean {
  if (!ie || ie === 'ISENTO') return true

  const limpo = ie.replace(/\D/g, '')
  if (limpo.length === 0) return false

  const tamanhos = IE_TAMANHOS[uf]
  if (!tamanhos) return false

  return tamanhos.includes(limpo.length)
}

/** Tamanhos aceitos de IE por UF (sem formatação, apenas dígitos) */
const IE_TAMANHOS: Record<string, number[]> = {
  AC: [13],
  AL: [9],
  AM: [9],
  AP: [9],
  BA: [8, 9],
  CE: [9],
  DF: [13],
  ES: [9],
  GO: [9],
  MA: [9],
  MG: [13],
  MS: [9],
  MT: [11],
  PA: [9],
  PB: [9],
  PE: [9, 14],
  PI: [9],
  PR: [10],
  RJ: [8],
  RN: [9, 10],
  RO: [14],
  RR: [9],
  RS: [10],
  SC: [9],
  SE: [9],
  SP: [12],
  TO: [11],
}

// === UFs válidas ===

const UFS_VALIDAS = [
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO',
  'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR',
  'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
]
