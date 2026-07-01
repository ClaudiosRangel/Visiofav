/**
 * CT-e XML Builder — Layout 4.00
 * Monta XML completo do CT-e (Conhecimento de Transporte Eletrônico, modelo 57)
 * a partir dos dados tipados. Função pura (sem I/O).
 *
 * Grupos: ide, compl, emit, rem, dest, vPrest, imp, infCTeNorm, infDoc
 *
 * Validates: Requirements 3.1
 */

// === Tipos do CT-e ===

export interface DadosCTe {
  /** Código UF do emitente (tabela IBGE) */
  cUF: number
  /** Código numérico aleatório (8 dígitos) */
  cCT: string
  /** Número do CT-e (1..999999999) */
  nCT: number
  /** Série (0-999) */
  serie: number
  /** Modelo (sempre 57) */
  modelo: number
  /** Tipo de emissão (1=Normal, 5=Contingência FS-DA, 7=SVC-RS, 8=SVC-SP) */
  tpEmis: number
  /** Ambiente (1=Produção, 2=Homologação) */
  ambiente: number
  /** CFOP da prestação */
  cfop: string
  /** Natureza da operação */
  naturezaOp: string
  /** Tipo de serviço (0=Normal, 1=Subcontratação, 2=Redespacho, 3=Redespacho Intermediário, 4=Serviço Vinculado a Multimodal) */
  tpServ: number
  /** Data de emissão */
  dataEmissao: Date
  /** Tipo do CT-e (0=Normal, 1=Complementar, 2=Anulação, 3=Substituto) */
  tpCTe: number
  /** Modal (01=Rodoviário, 02=Aéreo, 03=Aquaviário, 04=Ferroviário, 05=Dutoviário, 06=Multimodal) */
  modal: string
  /** Município de início (código IBGE 7 dígitos) */
  cMunIni: string
  /** Nome do município de início */
  xMunIni: string
  /** UF de início */
  ufIni: string
  /** Município de fim (código IBGE 7 dígitos) */
  cMunFim: string
  /** Nome do município de fim */
  xMunFim: string
  /** UF de fim */
  ufFim: string
  /**
   * Tipo do tomador (0=Remetente, 1=Expedidor, 2=Recebedor, 3=Destinatário, 4=Outros)
   * Determina quem é responsável pelo pagamento do frete.
   */
  tpTom: number
  /** Indicador da IE do tomador (1=Contribuinte ICMS, 2=Isento, 9=Não contribuinte) */
  indIEToma: number
  /** Emitente */
  emitente: DadosEmitenteCTe
  /** Remetente */
  remetente: DadosParticipanteCTe
  /** Expedidor (opcional — quem entrega a carga ao transportador) */
  expedidor?: DadosParticipanteCTe
  /** Recebedor (opcional — quem recebe a carga do transportador) */
  recebedor?: DadosParticipanteCTe
  /** Destinatário */
  destinatario: DadosParticipanteCTe
  /** Valores da prestação */
  vPrest: DadosValorPrestacao
  /** Impostos */
  impostos: DadosImpostosCTe
  /** Informações do CT-e Normal */
  infCTeNorm: DadosInfCTeNorm
  /** Informações complementares */
  complemento?: DadosComplementoCTe
  /** Informações adicionais de interesse do fisco */
  infAdFisco?: string
  /** Informações complementares de interesse do contribuinte */
  infCpl?: string
  /** Dados do tomador quando tpTom=4 (Outros) */
  tomadorOutros?: DadosTomadorOutros
}

export interface DadosEmitenteCTe {
  cnpj: string
  ie: string
  razaoSocial: string
  nomeFantasia?: string
  endereco: EnderecoCTe
}

export interface DadosParticipanteCTe {
  cnpj?: string
  cpf?: string
  ie?: string
  razaoSocial: string
  nomeFantasia?: string
  endereco: EnderecoCTe
  email?: string
  telefone?: string
}

export interface EnderecoCTe {
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
}

export interface DadosValorPrestacao {
  /** Valor total da prestação do serviço */
  vTPrest: number
  /** Valor a receber */
  vRec: number
  /** Componentes do valor */
  componentes?: ComponenteValor[]
}

export interface ComponenteValor {
  /** Nome do componente (ex: FRETE VALOR, GRIS, PEDAGIO) */
  nome: string
  /** Valor do componente */
  valor: number
}

export interface DadosImpostosCTe {
  /** ICMS */
  icms: {
    /** CST (00=Tributação normal, 20=Com redução, 40=Isenta, 41=Não tributada, 51=Diferido, 60=ICMS cobrado antes por ST, 90=Outros) */
    cst: string
    /** Base de cálculo */
    baseCalculo?: number
    /** Alíquota */
    aliquota?: number
    /** Valor do ICMS */
    valor?: number
    /** Percentual de redução da base de cálculo */
    percentualReducao?: number
    /** Valor do crédito outorgado/presumido */
    vCred?: number
    /** Percentual ICMS diferido */
    pDif?: number
    /** Valor do ICMS diferido */
    vICMSDif?: number
  }
  /** Valor total de tributos (Lei da Transparência) */
  vTotTrib?: number
  /** Informações adicionais de interesse do fisco */
  infAdFisco?: string
}

export interface DadosInfCTeNorm {
  /** Informações da carga */
  infCarga: DadosInfCarga
  /** Informações dos documentos transportados */
  infDoc: DadosInfDoc
  /** Informações do modal rodoviário (quando modal=01) */
  infModal?: DadosInfModalRodoviario
}

export interface DadosInfCarga {
  /** Valor total da carga */
  vCarga: number
  /** Produto predominante */
  proPred: string
  /** Outras características da carga */
  xOutCat?: string
  /** Quantidade de volumes/unidades de medida */
  infQ: InfQuantidadeCarga[]
}

export interface InfQuantidadeCarga {
  /** Código da unidade de medida (00=M3, 01=KG, 02=TON, 03=UNIDADE, 04=LITROS, 05=MMBTU) */
  cUnid: string
  /** Tipo de medida */
  tpMed: string
  /** Quantidade */
  qCarga: number
}

export interface DadosInfDoc {
  /** NF-e vinculadas */
  infNFe?: InfNFeVinculada[]
  /** Outros documentos vinculados */
  infOutros?: InfOutrosDoc[]
}

export interface InfNFeVinculada {
  /** Chave de acesso da NF-e (44 dígitos) */
  chave: string
}

export interface InfOutrosDoc {
  /** Tipo de documento (00=Declaração, 10=Dutoviário, 59=CF-e SAT, 65=NFC-e, 99=Outros) */
  tpDoc: string
  /** Descrição */
  descOutros?: string
  /** Número */
  nDoc?: string
  /** Data de emissão */
  dEmi?: Date
}

export interface DadosInfModalRodoviario {
  /** RNTRC do transportador */
  RNTRC: string
  /** Veículos utilizados no transporte */
  veiculos?: VeiculoCTe[]
}

export interface VeiculoCTe {
  /** Placa do veículo */
  placa: string
  /** UF de licenciamento */
  uf: string
  /** RENAVAM */
  RENAVAM?: string
  /** Tipo de proprietário (0=TAC Agregado, 1=TAC Independente, 2=Outros) */
  tpProp?: number
  /** CNPJ ou CPF do proprietário (quando diferente do emitente) */
  cpfCnpjProp?: string
  /** RNTRC do proprietário */
  RNTRCProp?: string
  /** Tipo de rodado (00=Não aplicável, 01=Truck, 02=Toco, 03=Cavalo Mecânico, 04=VAN, 05=Utilitário, 06=Outros) */
  tpRod?: string
  /** Tipo de carroceria (00=Não aplicável, 01=Aberta, 02=Fechada/Baú, 03=Graneleira, 04=Porta Container, 05=Sider) */
  tpCar?: string
}

export interface DadosComplementoCTe {
  /** Características adicionais do transporte */
  xCaracAd?: string
  /** Características adicionais do serviço */
  xCaracSer?: string
  /** Observações gerais */
  xObs?: string
}

/** Dados do tomador quando tpTom=4 (Outros) */
export interface DadosTomadorOutros {
  cnpj?: string
  cpf?: string
  ie?: string
  razaoSocial: string
  nomeFantasia?: string
  endereco: EnderecoCTe
  email?: string
  telefone?: string
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
 * Calcula dígito verificador módulo 11 (pesos 2-9) da chave de acesso.
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
 * Gera a chave de acesso de 44 dígitos do CT-e.
 * Formato: cUF(2) + AAMM(4) + CNPJ(14) + mod(2) + serie(3) + nCT(9) + tpEmis(1) + cCT(8) + cDV(1)
 */
export function gerarChaveAcessoCTe(params: {
  cUF: number
  dataEmissao: Date
  cnpj: string
  modelo: number
  serie: number
  nCT: number
  tpEmis: number
  cCT: string
}): string {
  const { cUF, dataEmissao, cnpj, modelo, serie, nCT, tpEmis, cCT } = params

  const aamm = String(dataEmissao.getFullYear()).slice(2) +
    String(dataEmissao.getMonth() + 1).padStart(2, '0')

  const chave43 = [
    String(cUF).padStart(2, '0'),
    aamm,
    cnpj.padStart(14, '0'),
    String(modelo).padStart(2, '0'),
    String(serie).padStart(3, '0'),
    String(nCT).padStart(9, '0'),
    String(tpEmis),
    cCT.padStart(8, '0'),
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

/** Formata data+hora para formato CT-e: YYYY-MM-DDThh:mm:ss-03:00 */
function fmtDataHora(date: Date): string {
  const iso = date.toISOString().slice(0, 19)
  return `${iso}-03:00`
}

// === Builder de grupos XML ===

function buildIde(dados: DadosCTe, chaveAcesso: string): string {
  const dv = chaveAcesso.slice(-1)
  let xml = `<ide>
<cUF>${dados.cUF}</cUF>
<cCT>${dados.cCT}</cCT>
<CFOP>${dados.cfop}</CFOP>
<natOp>${escXml(dados.naturezaOp)}</natOp>
<mod>${String(dados.modelo).padStart(2, '0')}</mod>
<serie>${dados.serie}</serie>
<nCT>${dados.nCT}</nCT>
<dhEmi>${fmtDataHora(dados.dataEmissao)}</dhEmi>
<tpImp>1</tpImp>
<tpEmis>${dados.tpEmis}</tpEmis>
<cDV>${dv}</cDV>
<tpAmb>${dados.ambiente}</tpAmb>
<tpCTe>${dados.tpCTe}</tpCTe>
<procEmi>0</procEmi>
<verProc>VisioFab-1.0.0</verProc>
<cMunEnv>${dados.emitente.endereco.codigoMunicipio}</cMunEnv>
<xMunEnv>${escXml(dados.emitente.endereco.municipio)}</xMunEnv>
<UFEnv>${dados.emitente.endereco.uf}</UFEnv>
<modal>${dados.modal}</modal>
<tpServ>${dados.tpServ}</tpServ>
<cMunIni>${dados.cMunIni}</cMunIni>
<xMunIni>${escXml(dados.xMunIni)}</xMunIni>
<UFIni>${dados.ufIni}</UFIni>
<cMunFim>${dados.cMunFim}</cMunFim>
<xMunFim>${escXml(dados.xMunFim)}</xMunFim>
<UFFim>${dados.ufFim}</UFFim>
<indIEToma>${dados.indIEToma}</indIEToma>
`
  xml += buildTomador(dados)
  xml += `</ide>`
  return xml
}

/**
 * Constrói o grupo do tomador do serviço conforme tpTom.
 * - tpTom 0..3 → <toma3> (remetente, expedidor, recebedor, destinatário)
 * - tpTom 4 → <toma4> (outros — requer dados completos)
 */
function buildTomador(dados: DadosCTe): string {
  const tpTom = dados.tpTom

  if (tpTom >= 0 && tpTom <= 3) {
    return `<toma3>\n<toma>${tpTom}</toma>\n</toma3>\n`
  }

  // tpTom = 4 (Outros)
  const toma = dados.tomadorOutros
  if (!toma) {
    // Fallback: se não informado tomadorOutros, usa remetente como padrão
    return `<toma3>\n<toma>0</toma>\n</toma3>\n`
  }

  let xml = '<toma4>\n<toma>4</toma>\n'
  if (toma.cnpj) {
    xml += `<CNPJ>${toma.cnpj}</CNPJ>\n`
  } else if (toma.cpf) {
    xml += `<CPF>${toma.cpf}</CPF>\n`
  }
  if (toma.ie) xml += `<IE>${toma.ie}</IE>\n`
  xml += `<xNome>${escXml(toma.razaoSocial)}</xNome>\n`
  if (toma.nomeFantasia) xml += `<xFant>${escXml(toma.nomeFantasia)}</xFant>\n`
  if (toma.telefone) xml += `<fone>${toma.telefone}</fone>\n`

  const end = toma.endereco
  xml += `<enderToma>\n`
  xml += `<xLgr>${escXml(end.logradouro)}</xLgr>\n`
  xml += `<nro>${escXml(end.numero)}</nro>\n`
  if (end.complemento) xml += `<xCpl>${escXml(end.complemento)}</xCpl>\n`
  xml += `<xBairro>${escXml(end.bairro)}</xBairro>\n`
  xml += `<cMun>${end.codigoMunicipio}</cMun>\n`
  xml += `<xMun>${escXml(end.municipio)}</xMun>\n`
  xml += `<CEP>${end.cep}</CEP>\n`
  xml += `<UF>${end.uf}</UF>\n`
  xml += `<cPais>${end.codigoPais || '1058'}</cPais>\n`
  xml += `<xPais>${escXml(end.pais || 'BRASIL')}</xPais>\n`
  xml += `</enderToma>\n`

  if (toma.email) xml += `<email>${escXml(toma.email)}</email>\n`
  xml += '</toma4>\n'
  return xml
}

function buildCompl(compl: DadosComplementoCTe | undefined): string {
  if (!compl) return ''
  let xml = '<compl>\n'
  if (compl.xCaracAd) xml += `<xCaracAd>${escXml(compl.xCaracAd)}</xCaracAd>\n`
  if (compl.xCaracSer) xml += `<xCaracSer>${escXml(compl.xCaracSer)}</xCaracSer>\n`
  if (compl.xObs) xml += `<xObs>${escXml(compl.xObs)}</xObs>\n`
  xml += '</compl>'
  return xml
}

function buildEmit(emit: DadosEmitenteCTe): string {
  const end = emit.endereco
  return `<emit>
<CNPJ>${emit.cnpj}</CNPJ>
<IE>${emit.ie}</IE>
<xNome>${escXml(emit.razaoSocial)}</xNome>
${emit.nomeFantasia ? `<xFant>${escXml(emit.nomeFantasia)}</xFant>\n` : ''}<enderEmit>
<xLgr>${escXml(end.logradouro)}</xLgr>
<nro>${escXml(end.numero)}</nro>
${end.complemento ? `<xCpl>${escXml(end.complemento)}</xCpl>\n` : ''}<xBairro>${escXml(end.bairro)}</xBairro>
<cMun>${end.codigoMunicipio}</cMun>
<xMun>${escXml(end.municipio)}</xMun>
<CEP>${end.cep}</CEP>
<UF>${end.uf}</UF>
</enderEmit>
</emit>`
}

function buildParticipante(tag: string, part: DadosParticipanteCTe): string {
  const end = part.endereco
  let xml = `<${tag}>\n`

  if (part.cnpj) {
    xml += `<CNPJ>${part.cnpj}</CNPJ>\n`
  } else if (part.cpf) {
    xml += `<CPF>${part.cpf}</CPF>\n`
  }

  if (part.ie) xml += `<IE>${part.ie}</IE>\n`
  xml += `<xNome>${escXml(part.razaoSocial)}</xNome>\n`
  if (part.nomeFantasia) xml += `<xFant>${escXml(part.nomeFantasia)}</xFant>\n`
  if (part.telefone) xml += `<fone>${part.telefone}</fone>\n`

  xml += `<ender${tag === 'rem' ? 'Reme' : 'Dest'}>\n`
  xml += `<xLgr>${escXml(end.logradouro)}</xLgr>\n`
  xml += `<nro>${escXml(end.numero)}</nro>\n`
  if (end.complemento) xml += `<xCpl>${escXml(end.complemento)}</xCpl>\n`
  xml += `<xBairro>${escXml(end.bairro)}</xBairro>\n`
  xml += `<cMun>${end.codigoMunicipio}</cMun>\n`
  xml += `<xMun>${escXml(end.municipio)}</xMun>\n`
  xml += `<CEP>${end.cep}</CEP>\n`
  xml += `<UF>${end.uf}</UF>\n`
  xml += `<cPais>${end.codigoPais || '1058'}</cPais>\n`
  xml += `<xPais>${escXml(end.pais || 'BRASIL')}</xPais>\n`
  xml += `</ender${tag === 'rem' ? 'Reme' : 'Dest'}>\n`

  if (part.email) xml += `<email>${escXml(part.email)}</email>\n`
  xml += `</${tag}>`
  return xml
}

/**
 * Constrói participante genérico (expedidor/recebedor).
 * Usa tag de endereço baseada no role.
 */
function buildParticipanteGenerico(tag: string, part: DadosParticipanteCTe): string {
  const end = part.endereco
  const enderTag = tag === 'exped' ? 'enderExped' : 'enderReceb'
  let xml = `<${tag}>\n`

  if (part.cnpj) {
    xml += `<CNPJ>${part.cnpj}</CNPJ>\n`
  } else if (part.cpf) {
    xml += `<CPF>${part.cpf}</CPF>\n`
  }

  if (part.ie) xml += `<IE>${part.ie}</IE>\n`
  xml += `<xNome>${escXml(part.razaoSocial)}</xNome>\n`
  if (part.nomeFantasia) xml += `<xFant>${escXml(part.nomeFantasia)}</xFant>\n`
  if (part.telefone) xml += `<fone>${part.telefone}</fone>\n`

  xml += `<${enderTag}>\n`
  xml += `<xLgr>${escXml(end.logradouro)}</xLgr>\n`
  xml += `<nro>${escXml(end.numero)}</nro>\n`
  if (end.complemento) xml += `<xCpl>${escXml(end.complemento)}</xCpl>\n`
  xml += `<xBairro>${escXml(end.bairro)}</xBairro>\n`
  xml += `<cMun>${end.codigoMunicipio}</cMun>\n`
  xml += `<xMun>${escXml(end.municipio)}</xMun>\n`
  xml += `<CEP>${end.cep}</CEP>\n`
  xml += `<UF>${end.uf}</UF>\n`
  xml += `<cPais>${end.codigoPais || '1058'}</cPais>\n`
  xml += `<xPais>${escXml(end.pais || 'BRASIL')}</xPais>\n`
  xml += `</${enderTag}>\n`

  if (part.email) xml += `<email>${escXml(part.email)}</email>\n`
  xml += `</${tag}>`
  return xml
}

function buildVPrest(vPrest: DadosValorPrestacao): string {
  let xml = '<vPrest>\n'
  xml += `<vTPrest>${fmtDec(vPrest.vTPrest)}</vTPrest>\n`
  xml += `<vRec>${fmtDec(vPrest.vRec)}</vRec>\n`

  if (vPrest.componentes && vPrest.componentes.length > 0) {
    for (const comp of vPrest.componentes) {
      xml += `<Comp>\n`
      xml += `<xNome>${escXml(comp.nome)}</xNome>\n`
      xml += `<vComp>${fmtDec(comp.valor)}</vComp>\n`
      xml += `</Comp>\n`
    }
  }

  xml += '</vPrest>'
  return xml
}

function buildImp(impostos: DadosImpostosCTe): string {
  let xml = '<imp>\n'
  xml += buildICMSCTe(impostos.icms)
  if (impostos.vTotTrib != null) {
    xml += `<vTotTrib>${fmtDec(impostos.vTotTrib)}</vTotTrib>\n`
  }
  if (impostos.infAdFisco) {
    xml += `<infAdFisco>${escXml(impostos.infAdFisco)}</infAdFisco>\n`
  }
  xml += '</imp>'
  return xml
}

function buildICMSCTe(icms: DadosImpostosCTe['icms']): string {
  const cst = icms.cst.toUpperCase()
  let xml = '<ICMS>\n'

  // Simples Nacional — CST 'SN' or '90' com regime SN
  if (cst === 'SN') {
    xml += '<ICMSSN>\n'
    xml += `<CST>90</CST>\n`
    xml += `<indSN>1</indSN>\n`
    xml += '</ICMSSN>\n'
    xml += '</ICMS>\n'
    return xml
  }

  const cstPad = cst.padStart(2, '0')

  switch (cstPad) {
    case '00': // Tributação normal
      xml += '<ICMS00>\n'
      xml += `<CST>${cstPad}</CST>\n`
      xml += `<vBC>${fmtDec(icms.baseCalculo || 0)}</vBC>\n`
      xml += `<pICMS>${fmtDec(icms.aliquota || 0)}</pICMS>\n`
      xml += `<vICMS>${fmtDec(icms.valor || 0)}</vICMS>\n`
      xml += '</ICMS00>\n'
      break

    case '20': // Com redução de base de cálculo
      xml += '<ICMS20>\n'
      xml += `<CST>${cstPad}</CST>\n`
      xml += `<pRedBC>${fmtDec(icms.percentualReducao || 0)}</pRedBC>\n`
      xml += `<vBC>${fmtDec(icms.baseCalculo || 0)}</vBC>\n`
      xml += `<pICMS>${fmtDec(icms.aliquota || 0)}</pICMS>\n`
      xml += `<vICMS>${fmtDec(icms.valor || 0)}</vICMS>\n`
      xml += '</ICMS20>\n'
      break

    case '40': // Isenta
    case '41': // Não tributada
    case '51': // Diferido
      xml += '<ICMS45>\n'
      xml += `<CST>${cstPad}</CST>\n`
      xml += '</ICMS45>\n'
      break

    case '60': // ICMS cobrado anteriormente por substituição tributária
      xml += '<ICMS60>\n'
      xml += `<CST>${cstPad}</CST>\n`
      xml += `<vBCSTRet>0.00</vBCSTRet>\n`
      xml += `<vICMSSTRet>0.00</vICMSSTRet>\n`
      xml += `<pICMSSTRet>0.00</pICMSSTRet>\n`
      if (icms.vCred != null) {
        xml += `<vCred>${fmtDec(icms.vCred)}</vCred>\n`
      }
      xml += '</ICMS60>\n'
      break

    case '90': // Outros
      xml += '<ICMS90>\n'
      xml += `<CST>${cstPad}</CST>\n`
      xml += `<pRedBC>${fmtDec(icms.percentualReducao || 0)}</pRedBC>\n`
      xml += `<vBC>${fmtDec(icms.baseCalculo || 0)}</vBC>\n`
      xml += `<pICMS>${fmtDec(icms.aliquota || 0)}</pICMS>\n`
      xml += `<vICMS>${fmtDec(icms.valor || 0)}</vICMS>\n`
      if (icms.vCred != null) {
        xml += `<vCred>${fmtDec(icms.vCred)}</vCred>\n`
      }
      xml += '</ICMS90>\n'
      break

    default:
      // ICMSOutraUF — para operações com UF diferente
      xml += '<ICMSOutraUF>\n'
      xml += `<CST>${cstPad}</CST>\n`
      xml += `<pRedBCOutraUF>${fmtDec(icms.percentualReducao || 0)}</pRedBCOutraUF>\n`
      xml += `<vBCOutraUF>${fmtDec(icms.baseCalculo || 0)}</vBCOutraUF>\n`
      xml += `<pICMSOutraUF>${fmtDec(icms.aliquota || 0)}</pICMSOutraUF>\n`
      xml += `<vICMSOutraUF>${fmtDec(icms.valor || 0)}</vICMSOutraUF>\n`
      xml += '</ICMSOutraUF>\n'
      break
  }

  xml += '</ICMS>\n'
  return xml
}

function buildInfCTeNorm(infCTeNorm: DadosInfCTeNorm): string {
  let xml = '<infCTeNorm>\n'
  xml += buildInfCarga(infCTeNorm.infCarga)
  xml += buildInfDoc(infCTeNorm.infDoc)
  if (infCTeNorm.infModal) {
    xml += buildInfModal(infCTeNorm.infModal)
  }
  xml += '</infCTeNorm>'
  return xml
}

function buildInfCarga(infCarga: DadosInfCarga): string {
  let xml = '<infCarga>\n'
  xml += `<vCarga>${fmtDec(infCarga.vCarga)}</vCarga>\n`
  xml += `<proPred>${escXml(infCarga.proPred)}</proPred>\n`
  if (infCarga.xOutCat) {
    xml += `<xOutCat>${escXml(infCarga.xOutCat)}</xOutCat>\n`
  }

  for (const q of infCarga.infQ) {
    xml += `<infQ>\n`
    xml += `<cUnid>${q.cUnid}</cUnid>\n`
    xml += `<tpMed>${escXml(q.tpMed)}</tpMed>\n`
    xml += `<qCarga>${fmtDec(q.qCarga, 4)}</qCarga>\n`
    xml += `</infQ>\n`
  }

  xml += '</infCarga>\n'
  return xml
}

function buildInfDoc(infDoc: DadosInfDoc): string {
  let xml = '<infDoc>\n'

  if (infDoc.infNFe && infDoc.infNFe.length > 0) {
    for (const nfe of infDoc.infNFe) {
      xml += `<infNFe>\n`
      xml += `<chave>${nfe.chave}</chave>\n`
      xml += `</infNFe>\n`
    }
  }

  if (infDoc.infOutros && infDoc.infOutros.length > 0) {
    for (const doc of infDoc.infOutros) {
      xml += `<infOutros>\n`
      xml += `<tpDoc>${doc.tpDoc}</tpDoc>\n`
      if (doc.descOutros) xml += `<descOutros>${escXml(doc.descOutros)}</descOutros>\n`
      if (doc.nDoc) xml += `<nDoc>${escXml(doc.nDoc)}</nDoc>\n`
      if (doc.dEmi) xml += `<dEmi>${doc.dEmi.toISOString().slice(0, 10)}</dEmi>\n`
      xml += `</infOutros>\n`
    }
  }

  xml += '</infDoc>\n'
  return xml
}

function buildInfModal(infModal: DadosInfModalRodoviario): string {
  let xml = '<infModal versaoModal="4.00">\n'
  xml += '<rodo>\n'
  xml += `<RNTRC>${infModal.RNTRC}</RNTRC>\n`

  if (infModal.veiculos && infModal.veiculos.length > 0) {
    for (const veic of infModal.veiculos) {
      xml += '<occ>\n'
      xml += '<emiOcc>\n'
      xml += `<CNPJ>${veic.cpfCnpjProp || ''}</CNPJ>\n`
      xml += '</emiOcc>\n'
      xml += '</occ>\n'
    }

    for (const veic of infModal.veiculos) {
      xml += '<veic>\n'
      xml += `<placa>${veic.placa}</placa>\n`
      if (veic.RENAVAM) xml += `<RENAVAM>${veic.RENAVAM}</RENAVAM>\n`
      xml += `<UF>${veic.uf}</UF>\n`
      if (veic.tpRod) xml += `<tpRod>${veic.tpRod}</tpRod>\n`
      if (veic.tpCar) xml += `<tpCar>${veic.tpCar}</tpCar>\n`
      if (veic.tpProp != null) {
        xml += '<prop>\n'
        if (veic.cpfCnpjProp) {
          if (veic.cpfCnpjProp.length === 11) {
            xml += `<CPF>${veic.cpfCnpjProp}</CPF>\n`
          } else {
            xml += `<CNPJ>${veic.cpfCnpjProp}</CNPJ>\n`
          }
        }
        if (veic.RNTRCProp) xml += `<RNTRC>${veic.RNTRCProp}</RNTRC>\n`
        xml += `<tpProp>${veic.tpProp}</tpProp>\n`
        xml += '</prop>\n'
      }
      xml += '</veic>\n'
    }
  }

  xml += '</rodo>\n'
  xml += '</infModal>\n'
  return xml
}

function buildInfAdic(infAdFisco?: string, infCpl?: string): string {
  if (!infAdFisco && !infCpl) return ''
  let xml = '<infAdic>\n'
  if (infAdFisco) xml += `<infAdFisco>${escXml(infAdFisco)}</infAdFisco>\n`
  if (infCpl) xml += `<infCpl>${escXml(infCpl)}</infCpl>\n`
  xml += '</infAdic>'
  return xml
}

// === Função principal exportada ===

/**
 * Monta o XML completo do CT-e layout 4.00.
 * Retorna string XML pronta para assinatura digital.
 *
 * @param dados - Dados completos do CT-e
 * @returns XML string com namespace http://www.portalfiscal.inf.br/cte
 */
export function buildCTeXml(dados: DadosCTe): string {
  // Gera chave de acesso
  const chaveAcesso = gerarChaveAcessoCTe({
    cUF: dados.cUF,
    dataEmissao: dados.dataEmissao,
    cnpj: dados.emitente.cnpj,
    modelo: dados.modelo,
    serie: dados.serie,
    nCT: dados.nCT,
    tpEmis: dados.tpEmis,
    cCT: dados.cCT,
  })

  const parts: string[] = [
    buildIde(dados, chaveAcesso),
    buildCompl(dados.complemento),
    buildEmit(dados.emitente),
    buildParticipante('rem', dados.remetente),
  ]

  // Expedidor (opcional)
  if (dados.expedidor) {
    parts.push(buildParticipanteGenerico('exped', dados.expedidor))
  }

  // Recebedor (opcional)
  if (dados.recebedor) {
    parts.push(buildParticipanteGenerico('receb', dados.recebedor))
  }

  parts.push(buildParticipante('dest', dados.destinatario))
  parts.push(buildVPrest(dados.vPrest))
  parts.push(buildImp(dados.impostos))
  parts.push(buildInfCTeNorm(dados.infCTeNorm))
  parts.push(buildInfAdic(dados.infAdFisco, dados.infCpl))

  const infCte = parts.filter(Boolean).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<CTe xmlns="http://www.portalfiscal.inf.br/cte">
<infCte versao="4.00" Id="CTe${chaveAcesso}">
${infCte}
</infCte>
</CTe>`
}

export { UF_CODES }
