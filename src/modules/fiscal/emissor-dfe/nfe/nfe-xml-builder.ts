/**
 * NF-e XML Builder — Layout 4.00
 * Monta XML completo da NF-e a partir dos dados tipados.
 * Função pura (sem I/O).
 *
 * Validates: Requirements 1.1, 36.3
 */

import {
  DadosDocumentoFiscal,
  DadosEmitente,
  DadosDestinatario,
  DadosItemDocumento,
  DadosTransporte,
  DadosPagamento,
} from '../tipos'

// === Tipos auxiliares para o builder ===

export interface DadosNFe extends DadosDocumentoFiscal {
  /** Código UF do emitente (tabela IBGE) */
  cUF: number
  /** Código numérico aleatório (8 dígitos) */
  cNF: string
  /** Número da NF-e (1..999999999) */
  nNF: number
  /** Tipo de emissão (1=Normal, 2=FS-IA, 5=Contingência, 6=SVC-AN, 7=SVC-RS, 9=Offline) */
  tpEmis: number
  /** Ambiente (1=Produção, 2=Homologação) */
  ambiente: number
  /** Código do município do emitente (IBGE 7 dígitos) */
  cMunFG: string
  /** Indicador de presença (0..9) */
  indPres?: number
  /** Emitente completo com endereço */
  emitente: DadosEmitenteNFe
  /** Destinatário completo com endereço */
  destinatario?: DadosDestinatarioNFe
  /** Itens com tributos calculados */
  itens: DadosItemNFe[]
  /** Valores de frete, seguro, outras despesas */
  valorFrete?: number
  valorSeguro?: number
  valorOutras?: number
  valorDesconto?: number
  /** Modalidade do frete (0..9) */
  modalidadeFrete?: number
  /** Informações adicionais de interesse do Fisco */
  infAdicionais?: string
  /** Chaves de acesso de NF-e referenciadas (para devolução finNFe=4) */
  nfesReferenciadas?: string[]
}

export interface DadosEmitenteNFe extends DadosEmitente {
  nomeFantasia?: string
  endereco: EnderecoNFe
  crt: number // 1=SN, 2=SN Excesso, 3=Normal
}

export interface DadosDestinatarioNFe extends DadosDestinatario {
  endereco?: EnderecoNFe
  indIEDest?: number // 1=Contribuinte, 2=Isento, 9=Não contribuinte
}

export interface EnderecoNFe {
  logradouro: string
  numero: string
  complemento?: string
  bairro: string
  codigoMunicipio: string
  municipio: string
  uf: string
  cep: string
  codigoPais?: string
  pais?: string
  telefone?: string
}

export interface DadosItemNFe extends DadosItemDocumento {
  /** Tributos calculados do item */
  icms?: TributosICMS
  pis?: TributosPISCOFINS
  cofins?: TributosPISCOFINS
  ipi?: TributosIPI
}

export interface TributosICMS {
  origem: number
  cst: string
  baseCalculo: number
  aliquota: number
  valor: number
  baseCalcST?: number
  aliquotaST?: number
  valorST?: number
}

export interface TributosPISCOFINS {
  cst: string
  baseCalculo: number
  aliquota: number
  valor: number
}

export interface TributosIPI {
  cst: string
  baseCalculo: number
  aliquota: number
  valor: number
}

// === Tabela de códigos UF IBGE ===

const UF_CODES: Record<string, number> = {
  RO: 11, AC: 12, AM: 13, RR: 14, PA: 15, AP: 16, TO: 17,
  MA: 21, PI: 22, CE: 23, RN: 24, PB: 25, PE: 26, AL: 27,
  SE: 28, BA: 29, MG: 31, ES: 32, RJ: 33, SP: 35,
  PR: 41, SC: 42, RS: 43, MS: 50, MT: 51, GO: 52, DF: 53,
}

// === Funções utilitárias ===

/**
 * Calcula dígito verificador módulo 11 (pesos 2-9) da chave de acesso
 * Retorna o dígito (0-9) segundo a regra:
 * - resto 0 ou 1 → DV = 0
 * - caso contrário → DV = 11 - resto
 */
export function calcularDV(chave43: string): number {
  const pesos = [2, 3, 4, 5, 6, 7, 8, 9]
  let soma = 0
  const digitos = chave43.split('').reverse()
  for (let i = 0; i < digitos.length; i++) {
    soma += parseInt(digitos[i], 10) * pesos[i % pesos.length]
  }
  const resto = soma % 11
  return resto < 2 ? 0 : 11 - resto
}

/**
 * Gera a chave de acesso de 44 dígitos da NF-e.
 * Formato: cUF(2) + AAMM(4) + CNPJ(14) + mod(2) + serie(3) + nNF(9) + tpEmis(1) + cNF(8) + cDV(1)
 */
export function gerarChaveAcesso(params: {
  cUF: number
  dataEmissao: Date
  cnpj: string
  modelo: number
  serie: number
  nNF: number
  tpEmis: number
  cNF: string
}): string {
  const { cUF, dataEmissao, cnpj, modelo, serie, nNF, tpEmis, cNF } = params

  const aamm = String(dataEmissao.getFullYear()).slice(2) +
    String(dataEmissao.getMonth() + 1).padStart(2, '0')

  const chave43 = [
    String(cUF).padStart(2, '0'),
    aamm,
    cnpj.padStart(14, '0'),
    String(modelo).padStart(2, '0'),
    String(serie).padStart(3, '0'),
    String(nNF).padStart(9, '0'),
    String(tpEmis),
    cNF.padStart(8, '0'),
  ].join('')

  const dv = calcularDV(chave43)
  return chave43 + String(dv)
}

/** Escape XML entities */
function escXml(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return ''
  const s = String(value)
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Formata número com casas decimais fixas */
function fmtDec(value: number, decimals: number = 2): string {
  return value.toFixed(decimals)
}

/** Formata data para formato NF-e: YYYY-MM-DD */
function fmtData(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Formata data+hora para formato NF-e: YYYY-MM-DDThh:mm:ss-03:00 */
function fmtDataHora(date: Date): string {
  const iso = date.toISOString().slice(0, 19)
  return `${iso}-03:00`
}

// === Builder de grupos XML ===

function buildIde(dados: DadosNFe, chaveAcesso: string): string {
  const dv = chaveAcesso.slice(-1)

  // NFref — referência de NF-e (obrigatório para finalidade=4 devolução)
  let nfRefBlock = ''
  if (dados.nfesReferenciadas && dados.nfesReferenciadas.length > 0) {
    nfRefBlock = dados.nfesReferenciadas
      .map(chave => `<NFref><refNFe>${chave}</refNFe></NFref>`)
      .join('\n')
    nfRefBlock = '\n' + nfRefBlock + '\n'
  }

  return `<ide>
<cUF>${dados.cUF}</cUF>
<cNF>${dados.cNF}</cNF>
<natOp>${escXml(dados.naturezaOp || 'VENDA')}</natOp>
<mod>${String(dados.modelo).padStart(2, '0')}</mod>
<serie>${dados.serie}</serie>
<nNF>${dados.nNF}</nNF>
<dhEmi>${fmtDataHora(dados.dataEmissao)}</dhEmi>
${dados.dataSaida ? `<dhSaiEnt>${fmtDataHora(dados.dataSaida)}</dhSaiEnt>\n` : ''}<tpNF>${dados.tipoOperacao}</tpNF>
<idDest>${getIdDest(dados)}</idDest>
<cMunFG>${dados.cMunFG}</cMunFG>
<tpImp>1</tpImp>
<tpEmis>${dados.tpEmis}</tpEmis>
<cDV>${dv}</cDV>
<tpAmb>${dados.ambiente}</tpAmb>
<finNFe>${dados.finalidade}</finNFe>
<indFinal>${dados.destinatario?.indIEDest === 9 ? '1' : '0'}</indFinal>
<indPres>${dados.indPres ?? 1}</indPres>
<procEmi>0</procEmi>
<verProc>VisioFab-1.0.0</verProc>${nfRefBlock}
</ide>`
}

function getIdDest(dados: DadosNFe): number {
  if (!dados.destinatario?.uf) return 1
  if (dados.destinatario.uf === 'EX') return 3
  if (dados.emitente.uf !== dados.destinatario.uf) return 2
  return 1
}

function buildEmit(emit: DadosEmitenteNFe): string {
  const end = emit.endereco
  return `<emit>
<CNPJ>${emit.cnpj}</CNPJ>
<xNome>${escXml(emit.razaoSocial)}</xNome>
${emit.nomeFantasia ? `<xFant>${escXml(emit.nomeFantasia)}</xFant>\n` : ''}<enderEmit>
<xLgr>${escXml(end.logradouro)}</xLgr>
<nro>${escXml(end.numero)}</nro>
${end.complemento ? `<xCpl>${escXml(end.complemento)}</xCpl>\n` : ''}<xBairro>${escXml(end.bairro)}</xBairro>
<cMun>${end.codigoMunicipio}</cMun>
<xMun>${escXml(end.municipio)}</xMun>
<UF>${end.uf}</UF>
<CEP>${end.cep}</CEP>
<cPais>${end.codigoPais || '1058'}</cPais>
<xPais>${escXml(end.pais || 'BRASIL')}</xPais>
${end.telefone ? `<fone>${end.telefone}</fone>\n` : ''}</enderEmit>
${emit.ie ? `<IE>${emit.ie}</IE>\n` : ''}<CRT>${emit.crt}</CRT>
</emit>`
}

function buildDest(dest: DadosDestinatarioNFe | undefined): string {
  if (!dest) return ''
  let xml = '<dest>\n'

  if (dest.cpfCnpj) {
    if (dest.cpfCnpj.length === 11) {
      xml += `<CPF>${dest.cpfCnpj}</CPF>\n`
    } else {
      xml += `<CNPJ>${dest.cpfCnpj}</CNPJ>\n`
    }
  }

  if (dest.razaoSocial) {
    xml += `<xNome>${escXml(dest.razaoSocial)}</xNome>\n`
  }

  if (dest.endereco) {
    const end = dest.endereco
    xml += `<enderDest>\n`
    xml += `<xLgr>${escXml(end.logradouro)}</xLgr>\n`
    xml += `<nro>${escXml(end.numero)}</nro>\n`
    if (end.complemento) xml += `<xCpl>${escXml(end.complemento)}</xCpl>\n`
    xml += `<xBairro>${escXml(end.bairro)}</xBairro>\n`
    xml += `<cMun>${end.codigoMunicipio}</cMun>\n`
    xml += `<xMun>${escXml(end.municipio)}</xMun>\n`
    xml += `<UF>${end.uf}</UF>\n`
    xml += `<CEP>${end.cep}</CEP>\n`
    xml += `<cPais>${end.codigoPais || '1058'}</cPais>\n`
    xml += `<xPais>${escXml(end.pais || 'BRASIL')}</xPais>\n`
    if (end.telefone) xml += `<fone>${end.telefone}</fone>\n`
    xml += `</enderDest>\n`
  }

  xml += `<indIEDest>${dest.indIEDest ?? 9}</indIEDest>\n`
  if (dest.ie) xml += `<IE>${dest.ie}</IE>\n`
  if (dest.email) xml += `<email>${escXml(dest.email)}</email>\n`
  xml += '</dest>'
  return xml
}

function buildDet(itens: DadosItemNFe[]): string {
  return itens.map((item, index) => {
    const nItem = item.nItem || index + 1
    return `<det nItem="${nItem}">
<prod>
<cProd>${escXml(item.codigoProd)}</cProd>
<cEAN>SEM GTIN</cEAN>
<xProd>${escXml(item.descricao)}</xProd>
<NCM>${item.ncm}</NCM>
${item.cest ? `<CEST>${item.cest}</CEST>\n` : ''}<CFOP>${item.cfop}</CFOP>
<uCom>${escXml(item.unidade)}</uCom>
<qCom>${fmtDec(item.quantidade, 4)}</qCom>
<vUnCom>${fmtDec(item.valorUnitario, 4)}</vUnCom>
<vProd>${fmtDec(item.valorTotal)}</vProd>
<cEANTrib>SEM GTIN</cEANTrib>
<uTrib>${escXml(item.unidade)}</uTrib>
<qTrib>${fmtDec(item.quantidade, 4)}</qTrib>
<vUnTrib>${fmtDec(item.valorUnitario, 4)}</vUnTrib>
${item.valorDesconto ? `<vDesc>${fmtDec(item.valorDesconto)}</vDesc>\n` : ''}<indTot>1</indTot>
${item.xPed ? `<xPed>${escXml(item.xPed)}</xPed>\n` : ''}</prod>
${buildImposto(item)}
</det>`
  }).join('\n')
}

function buildImposto(item: DadosItemNFe): string {
  let xml = '<imposto>\n'
  xml += buildICMS(item.icms)
  xml += buildPIS(item.pis)
  xml += buildCOFINS(item.cofins)
  if (item.ipi) xml += buildIPI(item.ipi)
  xml += '</imposto>'
  return xml
}

function buildICMS(icms: TributosICMS | undefined): string {
  if (!icms) {
    return `<ICMS>\n<ICMS00>\n<orig>0</orig>\n<CST>00</CST>\n<modBC>3</modBC>\n<vBC>0.00</vBC>\n<pICMS>0.00</pICMS>\n<vICMS>0.00</vICMS>\n</ICMS00>\n</ICMS>\n`
  }

  const cst = icms.cst.padStart(2, '0')
  const tag = getICMSTag(cst)

  let inner = `<orig>${icms.origem}</orig>\n<CST>${cst}</CST>\n`

  if (['00', '20', '90'].includes(cst)) {
    inner += `<modBC>3</modBC>\n`
    inner += `<vBC>${fmtDec(icms.baseCalculo)}</vBC>\n`
    inner += `<pICMS>${fmtDec(icms.aliquota)}</pICMS>\n`
    inner += `<vICMS>${fmtDec(icms.valor)}</vICMS>\n`
  }

  if (['10', '30', '70'].includes(cst) && icms.baseCalcST) {
    inner += `<modBCST>4</modBCST>\n`
    inner += `<vBCST>${fmtDec(icms.baseCalcST)}</vBCST>\n`
    inner += `<pICMSST>${fmtDec(icms.aliquotaST || 0)}</pICMSST>\n`
    inner += `<vICMSST>${fmtDec(icms.valorST || 0)}</vICMSST>\n`
  }

  if (['40', '41', '50', '60'].includes(cst)) {
    // Isento/Não tributado/Suspenso/Cobrado anteriormente
    // Apenas origem e CST
  }

  return `<ICMS>\n<${tag}>\n${inner}</${tag}>\n</ICMS>\n`
}

function getICMSTag(cst: string): string {
  const map: Record<string, string> = {
    '00': 'ICMS00', '10': 'ICMS10', '20': 'ICMS20', '30': 'ICMS30',
    '40': 'ICMS40', '41': 'ICMS40', '50': 'ICMS40',
    '51': 'ICMS51', '60': 'ICMS60', '70': 'ICMS70', '90': 'ICMS90',
  }
  return map[cst] || 'ICMS00'
}

function buildPIS(pis: TributosPISCOFINS | undefined): string {
  if (!pis) {
    return `<PIS>\n<PISOutr>\n<CST>99</CST>\n<vBC>0.00</vBC>\n<pPIS>0.00</pPIS>\n<vPIS>0.00</vPIS>\n</PISOutr>\n</PIS>\n`
  }
  const cst = pis.cst.padStart(2, '0')
  if (['01', '02'].includes(cst)) {
    return `<PIS>\n<PISAliq>\n<CST>${cst}</CST>\n<vBC>${fmtDec(pis.baseCalculo)}</vBC>\n<pPIS>${fmtDec(pis.aliquota, 4)}</pPIS>\n<vPIS>${fmtDec(pis.valor)}</vPIS>\n</PISAliq>\n</PIS>\n`
  }
  if (['04', '05', '06', '07', '08', '09'].includes(cst)) {
    return `<PIS>\n<PISNT>\n<CST>${cst}</CST>\n</PISNT>\n</PIS>\n`
  }
  return `<PIS>\n<PISOutr>\n<CST>${cst}</CST>\n<vBC>${fmtDec(pis.baseCalculo)}</vBC>\n<pPIS>${fmtDec(pis.aliquota, 4)}</pPIS>\n<vPIS>${fmtDec(pis.valor)}</vPIS>\n</PISOutr>\n</PIS>\n`
}

function buildCOFINS(cofins: TributosPISCOFINS | undefined): string {
  if (!cofins) {
    return `<COFINS>\n<COFINSOutr>\n<CST>99</CST>\n<vBC>0.00</vBC>\n<pCOFINS>0.00</pCOFINS>\n<vCOFINS>0.00</vCOFINS>\n</COFINSOutr>\n</COFINS>\n`
  }
  const cst = cofins.cst.padStart(2, '0')
  if (['01', '02'].includes(cst)) {
    return `<COFINS>\n<COFINSAliq>\n<CST>${cst}</CST>\n<vBC>${fmtDec(cofins.baseCalculo)}</vBC>\n<pCOFINS>${fmtDec(cofins.aliquota, 4)}</pCOFINS>\n<vCOFINS>${fmtDec(cofins.valor)}</vCOFINS>\n</COFINSAliq>\n</COFINS>\n`
  }
  if (['04', '05', '06', '07', '08', '09'].includes(cst)) {
    return `<COFINS>\n<COFINSNT>\n<CST>${cst}</CST>\n</COFINSNT>\n</COFINS>\n`
  }
  return `<COFINS>\n<COFINSOutr>\n<CST>${cst}</CST>\n<vBC>${fmtDec(cofins.baseCalculo)}</vBC>\n<pCOFINS>${fmtDec(cofins.aliquota, 4)}</pCOFINS>\n<vCOFINS>${fmtDec(cofins.valor)}</vCOFINS>\n</COFINSOutr>\n</COFINS>\n`
}

function buildIPI(ipi: TributosIPI): string {
  const cst = ipi.cst.padStart(2, '0')
  if (['01', '02', '03', '04', '05', '51', '52', '53', '54', '55'].includes(cst)) {
    return `<IPI>\n<IPINT>\n<CST>${cst}</CST>\n</IPINT>\n</IPI>\n`
  }
  return `<IPI>\n<IPITrib>\n<CST>${cst}</CST>\n<vBC>${fmtDec(ipi.baseCalculo)}</vBC>\n<pIPI>${fmtDec(ipi.aliquota)}</pIPI>\n<vIPI>${fmtDec(ipi.valor)}</vIPI>\n</IPITrib>\n</IPI>\n`
}

function buildTotal(dados: DadosNFe): string {
  let vProd = 0, vDesc = 0, vICMS = 0, vST = 0, vIPI = 0, vPIS = 0, vCOFINS = 0

  for (const item of dados.itens) {
    vProd += item.valorTotal
    vDesc += item.valorDesconto || 0
    if (item.icms) {
      vICMS += item.icms.valor
      vST += item.icms.valorST || 0
    }
    if (item.ipi) vIPI += item.ipi.valor
    if (item.pis) vPIS += item.pis.valor
    if (item.cofins) vCOFINS += item.cofins.valor
  }

  const vFrete = dados.valorFrete || 0
  const vSeg = dados.valorSeguro || 0
  const vOutro = dados.valorOutras || 0
  const vNF = vProd - vDesc + vST + vFrete + vSeg + vOutro + vIPI

  return `<total>
<ICMSTot>
<vBC>${fmtDec(vProd)}</vBC>
<vICMS>${fmtDec(vICMS)}</vICMS>
<vICMSDeson>0.00</vICMSDeson>
<vFCPUFDest>0.00</vFCPUFDest>
<vICMSUFDest>0.00</vICMSUFDest>
<vICMSUFRemet>0.00</vICMSUFRemet>
<vFCP>0.00</vFCP>
<vBCST>0.00</vBCST>
<vST>${fmtDec(vST)}</vST>
<vFCPST>0.00</vFCPST>
<vFCPSTRet>0.00</vFCPSTRet>
<vProd>${fmtDec(vProd)}</vProd>
<vFrete>${fmtDec(vFrete)}</vFrete>
<vSeg>${fmtDec(vSeg)}</vSeg>
<vDesc>${fmtDec(vDesc)}</vDesc>
<vII>0.00</vII>
<vIPI>${fmtDec(vIPI)}</vIPI>
<vIPIDevol>0.00</vIPIDevol>
<vPIS>${fmtDec(vPIS)}</vPIS>
<vCOFINS>${fmtDec(vCOFINS)}</vCOFINS>
<vOutro>${fmtDec(vOutro)}</vOutro>
<vNF>${fmtDec(vNF)}</vNF>
</ICMSTot>
</total>`
}

function buildTransp(transp: DadosTransporte | undefined): string {
  const modFrete = transp?.modalidadeFrete ?? 9
  let xml = `<transp>\n<modFrete>${modFrete}</modFrete>\n`

  if (transp?.transportadoraCnpj) {
    xml += `<transporta>\n`
    xml += `<CNPJ>${transp.transportadoraCnpj}</CNPJ>\n`
    if (transp.transportadoraRazao) {
      xml += `<xNome>${escXml(transp.transportadoraRazao)}</xNome>\n`
    }
    if (transp.transportadoraIE) {
      xml += `<IE>${transp.transportadoraIE}</IE>\n`
    }
    if (transp.transportadoraEndereco) {
      xml += `<xEnder>${escXml(transp.transportadoraEndereco)}</xEnder>\n`
    }
    if (transp.transportadoraMunicipio) {
      xml += `<xMun>${escXml(transp.transportadoraMunicipio)}</xMun>\n`
    }
    if (transp.transportadoraUF) {
      xml += `<UF>${transp.transportadoraUF}</UF>\n`
    }
    xml += `</transporta>\n`
  }

  if (transp?.volumes && transp.volumes.length > 0) {
    for (const vol of transp.volumes) {
      xml += `<vol>\n`
      xml += `<qVol>${vol.quantidade}</qVol>\n`
      if (vol.especie) xml += `<esp>${escXml(vol.especie)}</esp>\n`
      if (vol.pesoLiquido != null) xml += `<pesoL>${fmtDec(vol.pesoLiquido, 3)}</pesoL>\n`
      if (vol.pesoBruto != null) xml += `<pesoB>${fmtDec(vol.pesoBruto, 3)}</pesoB>\n`
      xml += `</vol>\n`
    }
  }

  xml += '</transp>'
  return xml
}

function buildPag(pagamentos: DadosPagamento[] | undefined): string {
  let xml = '<pag>\n'
  if (!pagamentos || pagamentos.length === 0) {
    xml += `<detPag>\n<tPag>90</tPag>\n<vPag>0.00</vPag>\n</detPag>\n`
  } else {
    for (const pag of pagamentos) {
      xml += `<detPag>\n`
      xml += `<tPag>${pag.formaPagamento.padStart(2, '0')}</tPag>\n`
      xml += `<vPag>${fmtDec(pag.valor)}</vPag>\n`
      xml += `</detPag>\n`
    }
  }
  xml += '</pag>'
  return xml
}

function buildInfAdic(info: string | undefined): string {
  if (!info) return ''
  return `<infAdic>\n<infCpl>${escXml(info)}</infCpl>\n</infAdic>`
}

// === Função principal exportada ===

/**
 * Monta o XML completo da NF-e layout 4.00.
 * Retorna string XML pronta para assinatura digital.
 *
 * @param dados - Dados completos da NF-e
 * @returns XML string com namespace http://www.portalfiscal.inf.br/nfe
 */
export function buildNFeXml(dados: DadosNFe): string {
  // Gera chave de acesso
  const chaveAcesso = gerarChaveAcesso({
    cUF: dados.cUF,
    dataEmissao: dados.dataEmissao,
    cnpj: dados.emitente.cnpj,
    modelo: dados.modelo,
    serie: dados.serie,
    nNF: dados.nNF,
    tpEmis: dados.tpEmis,
    cNF: dados.cNF,
  })

  const infNFe = [
    buildIde(dados, chaveAcesso),
    buildEmit(dados.emitente),
    buildDest(dados.destinatario),
    buildDet(dados.itens),
    buildTotal(dados),
    buildTransp(dados.transporte),
    buildPag(dados.pagamento),
    buildInfAdic(dados.informacoesAdicionais),
  ].filter(Boolean).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
<infNFe versao="4.00" Id="NFe${chaveAcesso}">
${infNFe}
</infNFe>
</NFe>`
}

export { UF_CODES }
