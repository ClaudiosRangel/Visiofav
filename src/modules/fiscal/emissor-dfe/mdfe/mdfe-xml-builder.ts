/**
 * MDF-e XML Builder — Layout 3.00, Modelo 58
 * Monta XML completo do MDF-e (Manifesto Eletrônico de Documentos Fiscais)
 * a partir dos dados tipados. Função pura (sem I/O).
 *
 * Grupos: ide (UFs carregamento/descarregamento, municípios), emit,
 * infDoc (chaves NF-e/CT-e agrupadas por UF de descarga), seg (seguros),
 * prodPred, tot (qtCTe, qtNFe, peso, valor),
 * infModal (rodoviário: veículo tração, reboques, condutores, CIOT, vale-pedágio)
 *
 * Validações: ao menos um documento vinculado em infDoc
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.8, 7.10, 7.11
 */

// === Tipos auxiliares para o builder ===

export interface DadosMDFe {
  /** Código UF do emitente (tabela IBGE) */
  cUF: number
  /** Código numérico aleatório (8 dígitos) */
  cMDF: string
  /** Número do MDF-e (1..999999999) */
  nMDF: number
  /** Série do MDF-e */
  serie: number
  /** Tipo de emissão (1=Normal, 2=Contingência) */
  tpEmis: number
  /** Ambiente (1=Produção, 2=Homologação) */
  ambiente: number
  /** Tipo de emitente (1=Prestador de Serviço de Transporte, 2=Transportador de Carga Própria, 3=Prestador Serviço de Transporte que emitirá CT-e Globalizado) */
  tpEmit: number
  /** Tipo de transportador (1=ETC, 2=TAC, 3=CTC) */
  tpTransp?: number
  /** Modalidade de transporte (1=Rodoviário, 2=Aéreo, 3=Aquaviário, 4=Ferroviário) */
  modal: number
  /** Data e hora de emissão */
  dhEmi: Date
  /** UF de início do transporte */
  ufIni: string
  /** UF de fim do transporte */
  ufFim: string
  /** Informações dos municípios de carregamento */
  infMunCarrega: MunicipioCarrega[]
  /** Informações dos percursos (UFs intermediárias) */
  infPercurso?: string[]
  /** Dados do emitente */
  emitente: DadosEmitenteMDFe
  /** Documentos vinculados (por UF de descarregamento) */
  infDoc: InfDocMDFe[]
  /** Seguro da carga */
  seg?: SeguroMDFe[]
  /** Produto predominante */
  prodPred?: ProdutoPredominante
  /** Totalizadores */
  totais: TotaisMDFe
  /** Informações adicionais */
  infAdic?: string
  /** Veículo de tração (modal rodoviário) */
  veicTracao?: VeiculoTracao
  /** Lista de condutores */
  condutores?: Condutor[]
  /** Reboques */
  veicReboque?: VeiculoReboque[]
  /** Lacres */
  lacres?: string[]
  /** CIOT */
  infCIOT?: InfCIOT[]
  /** Vale pedagio */
  valePed?: ValePedagio[]
}

export interface MunicipioCarrega {
  cMunCarrega: string  // Código IBGE do município de carregamento
  xMunCarrega: string  // Nome do município
}

export interface DadosEmitenteMDFe {
  cnpj: string
  ie: string
  razaoSocial: string
  nomeFantasia?: string
  endereco: EnderecoMDFe
}

export interface EnderecoMDFe {
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
  email?: string
}

export interface InfDocMDFe {
  /** UF de descarregamento */
  cMunDescarga: string
  /** Nome do município de descarregamento */
  xMunDescarga: string
  /** Chaves de acesso dos CT-e vinculados */
  infCTe?: string[]
  /** Chaves de acesso das NF-e vinculadas */
  infNFe?: string[]
}

export interface SeguroMDFe {
  /** Responsável pelo seguro (1=Emitente, 2=Resp. pela contratação) */
  respSeg: number
  /** CNPJ do responsável pelo seguro */
  cnpjResp?: string
  /** CPF do responsável pelo seguro */
  cpfResp?: string
  /** Nome da seguradora */
  xSeg: string
  /** CNPJ da seguradora */
  cnpjSeg?: string
  /** Número da apólice */
  nApol?: string
  /** Número da averbação */
  nAver?: string[]
}

export interface ProdutoPredominante {
  /** Tipo de carga (00=Granel sólido, 01=Granel líquido, 02=Frigorificada, 03=Conteinerizada, 04=Carga Geral, 05=Neogranel, 06=Perigosa Granel, 07=Perigosa Carga Geral, 08=Perigosa Conteinerizada, 09=Perigosa Frigorificada, 99=Outros) */
  tpCarga: string
  /** Descrição do produto predominante */
  xProd: string
  /** NCM do produto predominante */
  cEAN?: string
  /** Código do NCM */
  NCM?: string
  /** Código interno do produto */
  infLotacao?: InfLotacao
}

export interface InfLotacao {
  infLocalCarrega: { CEP: string; latitude?: string; longitude?: string }
  infLocalDescarrega: { CEP: string; latitude?: string; longitude?: string }
}

export interface TotaisMDFe {
  /** Quantidade total de CT-e */
  qCTe?: number
  /** Quantidade total de NF-e */
  qNFe?: number
  /** Valor total da carga */
  vCarga: number
  /** Código da unidade de medida do peso (01=KG, 02=TON) */
  cUnid: string
  /** Peso bruto total */
  qCarga: number
}

export interface VeiculoTracao {
  /** Placa do veículo */
  placa: string
  /** RENAVAM */
  RENAVAM?: string
  /** Tara (kg) */
  tara: number
  /** Capacidade (kg) */
  capKG?: number
  /** Capacidade (m³) */
  capM3?: number
  /** Tipo de rodado (01=Truck, 02=Toco, 03=Cavalo Mecânico, 04=VAN, 05=Utilitário, 06=Outros) */
  tpRod: string
  /** Tipo de carroceria (00=Não aplicável, 01=Aberta, 02=Fechada/Baú, 03=Graneleira, 04=Porta Container, 05=Sider) */
  tpCar: string
  /** UF de licenciamento */
  UF?: string
  /** Proprietário (se diferente do emitente) */
  prop?: ProprietarioVeiculo
}

export interface ProprietarioVeiculo {
  cnpj?: string
  cpf?: string
  rntrc: string
  nome: string
  ie?: string
  uf?: string
  tpProp: number // 0=TAC Agregado, 1=TAC Independente, 2=Outros
}

export interface VeiculoReboque {
  placa: string
  RENAVAM?: string
  tara: number
  capKG?: number
  capM3?: number
  tpCar: string
  UF?: string
  prop?: ProprietarioVeiculo
}

export interface Condutor {
  /** Nome do condutor */
  xNome: string
  /** CPF do condutor */
  CPF: string
}

export interface InfCIOT {
  CIOT: string
  cnpj?: string
  cpf?: string
}

export interface ValePedagio {
  cnpjForn: string
  cnpjPg?: string
  cpfPg?: string
  nCompra: string
  vValePed: number
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
 * Gera a chave de acesso de 44 dígitos do MDF-e.
 * Formato: cUF(2) + AAMM(4) + CNPJ(14) + mod(2) + serie(3) + nMDF(9) + tpEmis(1) + cMDF(8) + cDV(1)
 */
export function gerarChaveAcessoMDFe(params: {
  cUF: number
  dhEmi: Date
  cnpj: string
  serie: number
  nMDF: number
  tpEmis: number
  cMDF: string
}): string {
  const { cUF, dhEmi, cnpj, serie, nMDF, tpEmis, cMDF } = params

  const aamm = String(dhEmi.getFullYear()).slice(2) +
    String(dhEmi.getMonth() + 1).padStart(2, '0')

  const chave43 = [
    String(cUF).padStart(2, '0'),
    aamm,
    cnpj.padStart(14, '0'),
    '58', // modelo MDF-e
    String(serie).padStart(3, '0'),
    String(nMDF).padStart(9, '0'),
    String(tpEmis),
    cMDF.padStart(8, '0'),
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

/** Formata data+hora para formato MDF-e: YYYY-MM-DDThh:mm:ss-03:00 */
function fmtDataHora(date: Date): string {
  const iso = date.toISOString().slice(0, 19)
  return `${iso}-03:00`
}

// === Builder de grupos XML ===

function buildIde(dados: DadosMDFe, chaveAcesso: string): string {
  const dv = chaveAcesso.slice(-1)
  let xml = `<ide>
<cUF>${dados.cUF}</cUF>
<tpAmb>${dados.ambiente}</tpAmb>
<tpEmit>${dados.tpEmit}</tpEmit>
${dados.tpTransp ? `<tpTransp>${dados.tpTransp}</tpTransp>\n` : ''}<mod>58</mod>
<serie>${dados.serie}</serie>
<nMDF>${dados.nMDF}</nMDF>
<cMDF>${dados.cMDF}</cMDF>
<cDV>${dv}</cDV>
<modal>${dados.modal}</modal>
<dhEmi>${fmtDataHora(dados.dhEmi)}</dhEmi>
<tpEmis>${dados.tpEmis}</tpEmis>
<procEmi>0</procEmi>
<verProc>VisioFab-1.0.0</verProc>
<UFIni>${dados.ufIni}</UFIni>
<UFFim>${dados.ufFim}</UFFim>\n`

  // Municípios de carregamento
  for (const mun of dados.infMunCarrega) {
    xml += `<infMunCarrega>\n<cMunCarrega>${mun.cMunCarrega}</cMunCarrega>\n<xMunCarrega>${escXml(mun.xMunCarrega)}</xMunCarrega>\n</infMunCarrega>\n`
  }

  // Percurso (UFs intermediárias)
  if (dados.infPercurso && dados.infPercurso.length > 0) {
    for (const uf of dados.infPercurso) {
      xml += `<infPercurso>\n<UFPer>${uf}</UFPer>\n</infPercurso>\n`
    }
  }

  xml += '</ide>'
  return xml
}

function buildEmit(emit: DadosEmitenteMDFe): string {
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
<UF>${end.uf}</UF>
<CEP>${end.cep}</CEP>
<cPais>${end.codigoPais || '1058'}</cPais>
<xPais>${escXml(end.pais || 'BRASIL')}</xPais>
${end.telefone ? `<fone>${end.telefone}</fone>\n` : ''}${end.email ? `<email>${escXml(end.email)}</email>\n` : ''}</enderEmit>
</emit>`
}

function buildInfDoc(infDoc: InfDocMDFe[]): string {
  let xml = '<infDoc>\n'

  for (const doc of infDoc) {
    xml += `<infMunDescarga>\n`
    xml += `<cMunDescarga>${doc.cMunDescarga}</cMunDescarga>\n`
    xml += `<xMunDescarga>${escXml(doc.xMunDescarga)}</xMunDescarga>\n`

    // CT-e vinculados
    if (doc.infCTe && doc.infCTe.length > 0) {
      for (const chave of doc.infCTe) {
        xml += `<infCTe>\n<chCTe>${chave}</chCTe>\n</infCTe>\n`
      }
    }

    // NF-e vinculadas
    if (doc.infNFe && doc.infNFe.length > 0) {
      for (const chave of doc.infNFe) {
        xml += `<infNFe>\n<chNFe>${chave}</chNFe>\n</infNFe>\n`
      }
    }

    xml += `</infMunDescarga>\n`
  }

  xml += '</infDoc>'
  return xml
}

function buildSeg(seg: SeguroMDFe[] | undefined): string {
  if (!seg || seg.length === 0) return ''

  let xml = ''
  for (const s of seg) {
    xml += '<seg>\n'
    xml += `<infResp>\n<respSeg>${s.respSeg}</respSeg>\n`
    if (s.cnpjResp) xml += `<CNPJ>${s.cnpjResp}</CNPJ>\n`
    if (s.cpfResp) xml += `<CPF>${s.cpfResp}</CPF>\n`
    xml += `</infResp>\n`
    xml += `<infSeg>\n<xSeg>${escXml(s.xSeg)}</xSeg>\n`
    if (s.cnpjSeg) xml += `<CNPJ>${s.cnpjSeg}</CNPJ>\n`
    xml += `</infSeg>\n`
    if (s.nApol) xml += `<nApol>${escXml(s.nApol)}</nApol>\n`
    if (s.nAver && s.nAver.length > 0) {
      for (const aver of s.nAver) {
        xml += `<nAver>${escXml(aver)}</nAver>\n`
      }
    }
    xml += '</seg>\n'
  }
  return xml
}

function buildProdPred(prod: ProdutoPredominante | undefined): string {
  if (!prod) return ''
  let xml = '<prodPred>\n'
  xml += `<tpCarga>${prod.tpCarga}</tpCarga>\n`
  xml += `<xProd>${escXml(prod.xProd)}</xProd>\n`
  if (prod.cEAN) xml += `<cEAN>${prod.cEAN}</cEAN>\n`
  if (prod.NCM) xml += `<NCM>${prod.NCM}</NCM>\n`

  if (prod.infLotacao) {
    xml += '<infLotacao>\n'
    xml += `<infLocalCarrega>\n<CEP>${prod.infLotacao.infLocalCarrega.CEP}</CEP>\n</infLocalCarrega>\n`
    xml += `<infLocalDescarrega>\n<CEP>${prod.infLotacao.infLocalDescarrega.CEP}</CEP>\n</infLocalDescarrega>\n`
    xml += '</infLotacao>\n'
  }

  xml += '</prodPred>'
  return xml
}

function buildTot(totais: TotaisMDFe): string {
  let xml = '<tot>\n'
  if (totais.qCTe != null && totais.qCTe > 0) xml += `<qCTe>${totais.qCTe}</qCTe>\n`
  if (totais.qNFe != null && totais.qNFe > 0) xml += `<qNFe>${totais.qNFe}</qNFe>\n`
  xml += `<vCarga>${fmtDec(totais.vCarga)}</vCarga>\n`
  xml += `<cUnid>${totais.cUnid}</cUnid>\n`
  xml += `<qCarga>${fmtDec(totais.qCarga, 4)}</qCarga>\n`
  xml += '</tot>'
  return xml
}

function buildInfAdic(info: string | undefined): string {
  if (!info) return ''
  return `<infAdic>\n<infCpl>${escXml(info)}</infCpl>\n</infAdic>`
}

function buildInfModal(dados: DadosMDFe): string {
  // Apenas modal rodoviário (modal=1) implementado
  if (dados.modal !== 1) {
    return `<infModal versaoModal="3.00">\n<rodo>\n</rodo>\n</infModal>`
  }

  let xml = '<infModal versaoModal="3.00">\n<rodo>\n'

  // CIOT
  if (dados.infCIOT && dados.infCIOT.length > 0) {
    for (const ciot of dados.infCIOT) {
      xml += `<infCIOT>\n<CIOT>${ciot.CIOT}</CIOT>\n`
      if (ciot.cnpj) xml += `<CNPJ>${ciot.cnpj}</CNPJ>\n`
      if (ciot.cpf) xml += `<CPF>${ciot.cpf}</CPF>\n`
      xml += `</infCIOT>\n`
    }
  }

  // Vale pedágio
  if (dados.valePed && dados.valePed.length > 0) {
    xml += '<infANTT>\n<valePed>\n'
    for (const vp of dados.valePed) {
      xml += `<disp>\n`
      xml += `<CNPJForn>${vp.cnpjForn}</CNPJForn>\n`
      if (vp.cnpjPg) xml += `<CNPJPg>${vp.cnpjPg}</CNPJPg>\n`
      if (vp.cpfPg) xml += `<CPFPg>${vp.cpfPg}</CPFPg>\n`
      xml += `<nCompra>${vp.nCompra}</nCompra>\n`
      xml += `<vValePed>${fmtDec(vp.vValePed)}</vValePed>\n`
      xml += `</disp>\n`
    }
    xml += '</valePed>\n</infANTT>\n'
  }

  // Veículo de tração
  if (dados.veicTracao) {
    xml += buildVeicTracao(dados.veicTracao, dados.condutores)
  }

  // Reboques
  if (dados.veicReboque && dados.veicReboque.length > 0) {
    for (const reboque of dados.veicReboque) {
      xml += buildVeicReboque(reboque)
    }
  }

  // Lacres
  if (dados.lacres && dados.lacres.length > 0) {
    for (const lacre of dados.lacres) {
      xml += `<lacRodo>\n<nLacre>${escXml(lacre)}</nLacre>\n</lacRodo>\n`
    }
  }

  xml += '</rodo>\n</infModal>'
  return xml
}

function buildVeicTracao(veic: VeiculoTracao, condutores?: Condutor[]): string {
  let xml = '<veicTracao>\n'
  xml += `<placa>${veic.placa}</placa>\n`
  if (veic.RENAVAM) xml += `<RENAVAM>${veic.RENAVAM}</RENAVAM>\n`
  xml += `<tara>${veic.tara}</tara>\n`
  if (veic.capKG != null) xml += `<capKG>${veic.capKG}</capKG>\n`
  if (veic.capM3 != null) xml += `<capM3>${veic.capM3}</capM3>\n`

  // Proprietário
  if (veic.prop) {
    xml += '<prop>\n'
    if (veic.prop.cnpj) xml += `<CNPJ>${veic.prop.cnpj}</CNPJ>\n`
    if (veic.prop.cpf) xml += `<CPF>${veic.prop.cpf}</CPF>\n`
    xml += `<RNTRC>${veic.prop.rntrc}</RNTRC>\n`
    xml += `<xNome>${escXml(veic.prop.nome)}</xNome>\n`
    if (veic.prop.ie) xml += `<IE>${veic.prop.ie}</IE>\n`
    if (veic.prop.uf) xml += `<UF>${veic.prop.uf}</UF>\n`
    xml += `<tpProp>${veic.prop.tpProp}</tpProp>\n`
    xml += '</prop>\n'
  }

  // Condutores
  if (condutores && condutores.length > 0) {
    for (const cond of condutores) {
      xml += `<condutor>\n<xNome>${escXml(cond.xNome)}</xNome>\n<CPF>${cond.CPF}</CPF>\n</condutor>\n`
    }
  }

  xml += `<tpRod>${veic.tpRod}</tpRod>\n`
  xml += `<tpCar>${veic.tpCar}</tpCar>\n`
  if (veic.UF) xml += `<UF>${veic.UF}</UF>\n`
  xml += '</veicTracao>\n'
  return xml
}

function buildVeicReboque(reboque: VeiculoReboque): string {
  let xml = '<veicReboque>\n'
  xml += `<placa>${reboque.placa}</placa>\n`
  if (reboque.RENAVAM) xml += `<RENAVAM>${reboque.RENAVAM}</RENAVAM>\n`
  xml += `<tara>${reboque.tara}</tara>\n`
  if (reboque.capKG != null) xml += `<capKG>${reboque.capKG}</capKG>\n`
  if (reboque.capM3 != null) xml += `<capM3>${reboque.capM3}</capM3>\n`

  if (reboque.prop) {
    xml += '<prop>\n'
    if (reboque.prop.cnpj) xml += `<CNPJ>${reboque.prop.cnpj}</CNPJ>\n`
    if (reboque.prop.cpf) xml += `<CPF>${reboque.prop.cpf}</CPF>\n`
    xml += `<RNTRC>${reboque.prop.rntrc}</RNTRC>\n`
    xml += `<xNome>${escXml(reboque.prop.nome)}</xNome>\n`
    if (reboque.prop.ie) xml += `<IE>${reboque.prop.ie}</IE>\n`
    if (reboque.prop.uf) xml += `<UF>${reboque.prop.uf}</UF>\n`
    xml += `<tpProp>${reboque.prop.tpProp}</tpProp>\n`
    xml += '</prop>\n'
  }

  xml += `<tpCar>${reboque.tpCar}</tpCar>\n`
  if (reboque.UF) xml += `<UF>${reboque.UF}</UF>\n`
  xml += '</veicReboque>\n'
  return xml
}

// === Função principal exportada ===

/**
 * Valida que ao menos um documento fiscal (NF-e ou CT-e) esteja vinculado ao MDF-e.
 * Requerido pelo layout 3.00 — MDF-e sem documentos é inválido.
 *
 * Validates: Requirements 7.10, 7.11
 */
function validarInfDoc(infDoc: InfDocMDFe[]): void {
  if (!infDoc || infDoc.length === 0) {
    throw new Error('MDF-e requer ao menos um documento fiscal (NF-e ou CT-e) vinculado em infDoc')
  }

  const temDocumento = infDoc.some(
    (doc) =>
      (doc.infCTe && doc.infCTe.length > 0) ||
      (doc.infNFe && doc.infNFe.length > 0)
  )

  if (!temDocumento) {
    throw new Error('MDF-e requer ao menos um documento fiscal (NF-e ou CT-e) vinculado em infDoc')
  }
}

/**
 * Monta o XML completo do MDF-e layout 3.00.
 * Retorna string XML pronta para assinatura digital.
 *
 * @param dados - Dados completos do MDF-e
 * @returns XML string com namespace http://www.portalfiscal.inf.br/mdfe
 * @throws Error se nenhum documento fiscal estiver vinculado em infDoc
 */
export function buildMDFeXml(dados: DadosMDFe): string {
  // Validação: ao menos um documento vinculado
  validarInfDoc(dados.infDoc)

  // Gera chave de acesso
  const chaveAcesso = gerarChaveAcessoMDFe({
    cUF: dados.cUF,
    dhEmi: dados.dhEmi,
    cnpj: dados.emitente.cnpj,
    serie: dados.serie,
    nMDF: dados.nMDF,
    tpEmis: dados.tpEmis,
    cMDF: dados.cMDF,
  })

  const infMDFe = [
    buildIde(dados, chaveAcesso),
    buildEmit(dados.emitente),
    buildInfModal(dados),
    buildInfDoc(dados.infDoc),
    buildSeg(dados.seg),
    buildProdPred(dados.prodPred),
    buildTot(dados.totais),
    buildInfAdic(dados.infAdic),
  ].filter(Boolean).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<MDFe xmlns="http://www.portalfiscal.inf.br/mdfe">
<infMDFe versao="3.00" Id="MDFe${chaveAcesso}">
${infMDFe}
</infMDFe>
</MDFe>`
}

export { UF_CODES }
