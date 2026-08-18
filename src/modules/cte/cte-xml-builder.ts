/**
 * Montagem do XML CT-e 4.00 (leiaute SEFAZ/ENCAT)
 *
 * Referências:
 *   - MOC CT-e 4.00 (Manual de Orientação do Contribuinte)
 *   - ATO COTEPE/ICMS 123/22 (obriga versão 4.00 a partir de fev/2024)
 *   - Schema cte_v4.00.xsd + cteModalRodoviario_v4.00.xsd (portal SEFAZ)
 *
 * Estrutura do <infCte> (ordem exigida pelo XSD):
 *   ide → compl? → emit → rem → exped? → receb? → dest → vPrest → imp
 *   → infCTeNorm (infCarga → infDoc? → infModal → veicNovos*)
 *   → infCTeSupl (qrCodCTe)
 */

// ─── Tipos de dados ─────────────────────────────────────────────────────────

export interface EnderecoXml {
  logradouro: string
  numero: string
  complemento?: string
  bairro: string
  cMun: string        // código IBGE (7 dígitos)
  xMun: string        // nome do município
  uf: string          // sigla UF (2 chars)
  cep: string         // 8 dígitos sem traço
  pais?: string       // código do país, default '1058' (Brasil)
  xPais?: string      // nome do país, default 'BRASIL'
  fone?: string       // somente dígitos, opcional
}

export interface ParticipanteCTe {
  cnpj?: string       // CNPJ sem máscara (14 dígitos) — ou CPF
  cpf?: string        // CPF sem máscara (11 dígitos)
  ie?: string         // Inscrição estadual (sem máscara)
  razaoSocial: string
  endereco: EnderecoXml
}

export interface EmitenteCTe extends ParticipanteCTe {
  fantasiaOpcional?: string
  crt: 1 | 2 | 3      // Código de Regime Tributário: 1=SN, 2=SN excesso, 3=Normal
}

export interface ComponenteValor {
  xNome: string    // descrição (ex: 'Frete', 'Pedagio', 'Seguro')
  vComp: number
}

/** Dados para o tomador quando é pessoa diferente de rem/dest (toma=4) */
export interface TomadorOutro {
  cnpj?: string
  cpf?: string
  ie?: string
  razaoSocial: string
  endereco: EnderecoXml
}

export interface QuantidadeCarga {
  cUnid: '00' | '01' | '02' | '03' | '04' | '05' | '06'
  // 00=M3, 01=KG, 02=TON, 03=UNIDADE, 04=LITROS, 05=MMBTU, 06=OUTRAS
  tpMed: string   // tipo de medida (ex: 'PESO BRUTO', 'UNIDADE')
  qCarga: number  // quantidade (4 decimais)
}

/** Veículo novo transportado (tpCTe=0 + proPred=VEICULOS) */
export interface VeiculoNovoCTe {
  chassi: string   // 17 caracteres
  cCor: string     // código cor (4 chars)
  xCor: string     // descrição cor
  cMod: string     // código modelo DENATRAN
  vUnit: number    // valor unitário do veículo
  vFrete: number   // valor do frete por veículo
}

// ─── Interfaces de Modal ─────────────────────────────────────────────────────

/**
 * Modal Rodoviário (01) — schema cteModalRodoviario_v4.00.xsd
 * Campos obrigatórios: RNTRC
 */
export interface ModalRodoviario {
  tipo: '01'
  rntrc: string               // Registro Nacional Transp. Rodoviários de Cargas (8 dígitos)
}

/**
 * Modal Aéreo (02) — schema cteModalAereo_v4.00.xsd
 *
 * Campos do XSD (grupo <aereo>):
 *   nMinu → nOCA → dPrevAereo → natCarga (xDime?, cImp?) → tarifa (CL, cTar?, vTar) → peri?[]
 */
export interface ModalAereo {
  tipo: '02'
  nMinu?: number              // número da minuta
  nOCA?: number               // número operacional do conhecimento aéreo (IATA)
  dPrevAereo: string          // data prevista de entrega (AAAA-MM-DD)
  natCarga: {
    xDime?: string            // dimensões da carga (ex: '100x80x60')
    cImp?: string             // código da embalagem (tabela IATA)
    cInfManuorth?: string[]   // códigos de informações de manuseio (array, 0-N)
  }
  tarifa: {
    CL: 'M' | 'G' | 'E'      // classe tarifa: M=mínima, G=geral, E=específica
    cTar?: string             // código da tarifa (4 dígitos)
    vTar: number              // valor da tarifa (R$)
  }
  /** Produtos perigosos (0-N) */
  peri?: {
    nONU: string              // número ONU/UN do produto perigoso
    qTotEmb: string           // quantidade total de volumes com produtos perigosos
    infTotAP?: {
      qTotProd: number        // quantidade total do produto (kg)
      uniAP: 1 | 2 | 3 | 4 | 5  // 1=KG, 2=KG G, 3=LITROS, 4=TI, 5=Unidades
    }
  }[]
}

/**
 * Modal Aquaviário (03) — schema cteModalAquaviario_v4.00.xsd
 *
 * Campos do XSD (grupo <aquav>):
 *   vPrest → vAFRMM → xNavio → nViag → direc → irin → lacre?[] → balsa?[] → detCont?[]
 */
export interface ModalAquaviario {
  tipo: '03'
  vPrest: number              // valor da prestação base de cálculo do AFRMM
  vAFRMM: number              // valor do AFRMM (Adicional ao Frete para Renovação da Marinha Mercante)
  xNavio: string              // nome do navio / identificação da embarcação
  nViag?: string              // número da viagem
  direc: 'N' | 'S'           // direção: N=Norte, S=Sul
  irin: string                // irin do navio (Identificação do navio na Receita)
  /** Lacres (0-N) */
  lacres?: { nLacre: string }[]
  /** Balsas (0-N) */
  balsas?: { xBalsa: string }[]
  /** Detalhamento dos contêineres (0-N) */
  detCont?: {
    nCont: string             // número do contêiner
    /** Documentos no contêiner (0-N) */
    infDoc?: {
      infNFe?: string[]       // chaves NF-e dentro desse contêiner
      infNF?: {
        serie: string
        nDoc: string
        unidRat?: number
      }[]
    }
  }[]
}

/**
 * Modal Ferroviário (04) — schema cteModalFerroviario_v4.00.xsd
 *
 * Campos do XSD (grupo <ferrov>):
 *   tpTraf → fluxo → trafMut? (respFat, ferrEmi, vFrete, chCTeFerroOrigem?, ferroEnv?)
 */
export interface ModalFerroviario {
  tipo: '04'
  tpTraf: 0 | 1 | 2 | 3     // tipo de tráfego: 0=próprio, 1=mútuo, 2=rodoferroviário, 3=rodoviário
  fluxo: string              // fluxo da carga (código/descrição)
  /** Informações de tráfego mútuo (obrigatório quando tpTraf=1) */
  trafMut?: {
    respFat: 1 | 2            // responsável pelo faturamento: 1=ferrovia de origem, 2=ferrovia de destino
    ferrEmi: 1 | 2            // ferrovia emissora: 1=origem, 2=destino
    vFrete: number            // valor do frete do tráfego mútuo
    chCTeFerroOrigem?: string // chave CT-e da ferrovia de origem (44 dígitos)
    ferroEnv?: {              // ferrovias envolvidas no tráfego mútuo (0-N)
      cnpj: string
      cInt?: string
      ie?: string
      xNome: string
      enderFerro: EnderecoXml
    }[]
  }
}

/**
 * Modal Dutoviário (05) — schema cteModalDutoviario_v4.00.xsd
 *
 * Campos do XSD (grupo <duto>):
 *   vTar → dIni → dFim
 */
export interface ModalDutoviario {
  tipo: '05'
  vTar: number               // valor da tarifa (R$/unidade)
  dIni: string               // data de início da prestação (AAAA-MM-DD)
  dFim: string               // data de fim da prestação (AAAA-MM-DD)
}

/** Union type que agrupa todos os modais suportados */
export type ModalCTe =
  | ModalRodoviario
  | ModalAereo
  | ModalAquaviario
  | ModalFerroviario
  | ModalDutoviario

export interface DadosCTeXml {
  // Identificação
  chaveAcesso: string   // 44 dígitos sem máscara
  numero: number
  serie: number
  dataEmissao: string   // ISO 8601 com offset (ex: '2026-02-20T10:33:25-03:00')
  tpAmb: 1 | 2          // 1=produção, 2=homologação
  cfop: string          // ex: '5353' (intraestadual), '6353' (interestadual)

  // Município de envio (onde o emissor está localizado / envia o CT-e)
  cMunEnv: string       // código IBGE município de envio
  xMunEnv: string       // nome do município de envio
  ufEnv: string         // UF de envio

  // Município início / fim do transporte
  cMunIni: string       // código IBGE município início
  xMunIni: string       // nome município início
  ufIni: string
  cMunFim: string       // código IBGE município fim
  xMunFim: string       // nome município fim
  ufFim: string

  // Indicadores
  retira: 0 | 1         // 0=não retira, 1=retira no local do emitente
  indIEToma: 1 | 2 | 3 | 9
  // 1=contribuinte ICMS, 2=contribuinte isento, 3=não contribuinte, 9=exterior

  /**
   * Tomador do serviço:
   *   0 = Remetente, 1 = Expedidor, 2 = Recebedor, 3 = Destinatário
   *   4 = Outros (preencher tomador4)
   */
  toma: 0 | 1 | 2 | 3 | 4
  tomador4?: TomadorOutro   // obrigatório quando toma=4

  // Observações complementares (campo livre, opcional)
  xObs?: string
  xEmi?: string           // nome do operador que emitiu (opcional)

  // Participantes
  emitente: EmitenteCTe
  remetente: ParticipanteCTe
  expedidor?: ParticipanteCTe   // opcional
  recebedor?: ParticipanteCTe   // opcional
  destinatario: ParticipanteCTe

  // Valores
  valorTotalPrestacao: number   // vTPrest
  valorReceber: number          // vRec (pode diferir de vTPrest por adiantamentos)
  componentes?: ComponenteValor[] // Comp — ao menos 1 é recomendado

  // Tributação
  /**
   * Situação tributária do ICMS:
   *   '00' = normal (tributado integralmente)
   *   '20' = com redução de base
   *   '40' = isento
   *   '41' = não tributado
   *   '51' = diferimento
   *   '60' = cobrado por substituição
   *   '90' = outros (Simples Nacional)
   */
  cst: '00' | '20' | '40' | '41' | '51' | '60' | '90'
  // Campos usados conforme CST:
  vBC?: number          // base cálculo (CST 00, 20, 60)
  pICMS?: number        // alíquota % (CST 00, 20)
  vICMS?: number        // valor ICMS calculado (CST 00, 20, 60)
  pRedBC?: number       // % redução BC (CST 20)
  vTotTrib?: number     // valor aprox. tributos (Lei 12.741/2012) — obrigatório

  // Carga
  valorCarga: number    // valor mercadoria segurada
  produtoPredominante: string
  quantidades: QuantidadeCarga[]

  // Documentos referenciados (NF-e, NF papel, CT-e anterior, etc.)
  chavesNfeRef?: string[]     // chaves NF-e (44 dígitos)
  chavesNfRef?: {             // NF modelo 1/1A/papel
    CNPJ: string
    mod: '01' | '1B'
    serie: string
    subSerie?: string
    nro: number
    valor: number
    dEmi: string             // AAAA-MM-DD
  }[]

  // Modal (rodoviário = '01')
  modal: '01' | '02' | '03' | '04' | '05'
  // 01=Rodoviário, 02=Aéreo, 03=Aquaviário, 04=Ferroviário, 05=Dutoviário

  // Dados específicos do modal (estrutura varia por tipo)
  modalDados: ModalCTe

  // Campo legado mantido para compatibilidade (usado quando modalDados não é fornecido)
  // Se modalDados.tipo === '01', rntrc pode ser obtido de modalDados.rntrc
  rntrc?: string

  // Veículos novos (quando transporte de veículos)
  veiculosNovos?: VeiculoNovoCTe[]

  // URL base para QR Code (SEFAZ do emitente — varia por UF/ambiente)
  urlQrCode?: string
}

// ─── Utilitários ─────────────────────────────────────────────────────────────

function esc(val: string | undefined | null): string {
  if (!val) return ''
  return val
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function num(val: number, decimals = 2): string {
  return val.toFixed(decimals)
}

function soDigitos(val: string | undefined | null): string {
  return (val || '').replace(/\D/g, '')
}

// ─── Constantes ──────────────────────────────────────────────────────────────

/**
 * URLs oficiais de QR Code do CT-e por autorizador (fonte: portal SEFAZ produção/homologação)
 *
 * Autorizadores próprios: MT, MS, MG, PR, RS (=SVRS), SP
 * SVRS (Sefaz Virtual RS): AC, AL, AM, BA, CE, DF, ES, GO, MA, PA, PB, PI, RJ, RN, RO, SC, SE, TO
 * SVSP (Sefaz Virtual SP): AP, PE, RR
 */
const QRCODE_PRODUCAO: Record<string, string> = {
  // Autorizadores próprios
  MT: 'https://www.sefaz.mt.gov.br/cte/qrcode',
  MS: 'http://www.dfe.ms.gov.br/cte/qrcode',
  MG: 'https://portalcte.fazenda.mg.gov.br/portalcte/sistema/qrcode.xhtml',
  PR: 'http://www.fazenda.pr.gov.br/cte/qrcode',
  SP: 'https://nfe.fazenda.sp.gov.br/CTeConsulta/qrCode',
  // SVRS (RS e todos que utilizam SVRS)
  RS: 'https://dfe-portal.svrs.rs.gov.br/cte/qrCode',
  // SVSP (AP, PE, RR usam SP como autorizador virtual)
  SVSP: 'https://nfe.fazenda.sp.gov.br/CTeConsulta/qrCode',
}

const QRCODE_HOMOLOGACAO: Record<string, string> = {
  MT: 'https://homologacao.sefaz.mt.gov.br/cte/qrcode',
  MS: 'http://www.dfe.ms.gov.br/cte/qrcode',
  MG: 'https://portalcte.fazenda.mg.gov.br/portalcte/sistema/qrcode.xhtml',
  PR: 'http://www.fazenda.pr.gov.br/cte/qrcode',
  SP: 'https://nfe.fazenda.sp.gov.br/CTeConsulta/qrCode',
  RS: 'https://dfe-portal.svrs.rs.gov.br/cte/qrCode',
  SVSP: 'https://nfe.fazenda.sp.gov.br/CTeConsulta/qrCode',
}

/**
 * Mapeia UF → autorizador (para determinar URL do QR Code).
 * UFs com autorizador próprio ficam com a própria sigla.
 * UFs que usam SVRS ficam com 'RS'. UFs que usam SVSP ficam com 'SVSP'.
 */
const UF_PARA_AUTORIZADOR: Record<string, string> = {
  // Autorizadores próprios
  MT: 'MT', MS: 'MS', MG: 'MG', PR: 'PR', SP: 'SP', RS: 'RS',
  // SVRS
  AC: 'RS', AL: 'RS', AM: 'RS', BA: 'RS', CE: 'RS', DF: 'RS',
  ES: 'RS', GO: 'RS', MA: 'RS', PA: 'RS', PB: 'RS', PI: 'RS',
  RJ: 'RS', RN: 'RS', RO: 'RS', SC: 'RS', SE: 'RS', TO: 'RS',
  // SVSP
  AP: 'SVSP', PE: 'SVSP', RR: 'SVSP',
}

/**
 * Obtém a URL do QR Code para a UF e ambiente informados.
 * Segue a tabela oficial do portal da SEFAZ (cte.fazenda.gov.br/portal/webServices.aspx)
 */
function obterUrlQrCode(uf: string, tpAmb: 1 | 2): string {
  const autorizador = UF_PARA_AUTORIZADOR[uf.toUpperCase()] ?? 'RS' // fallback SVRS
  const mapa = tpAmb === 1 ? QRCODE_PRODUCAO : QRCODE_HOMOLOGACAO
  return mapa[autorizador] ?? mapa['RS']
}

// Mapeamento UF → código IBGE (para extrair cUF da chave quando necessário)
const UF_PARA_CODIGO: Record<string, string> = {
  AC: '12', AL: '27', AP: '16', AM: '13', BA: '29', CE: '23', DF: '53',
  ES: '32', GO: '52', MA: '21', MT: '51', MS: '50', MG: '31', PA: '15',
  PB: '25', PR: '41', PE: '26', PI: '22', RJ: '33', RN: '24', RS: '43',
  RO: '11', RR: '14', SC: '42', SP: '35', SE: '28', TO: '17',
}

// ─── Builders parciais ───────────────────────────────────────────────────────

function buildEndereco(end: EnderecoXml, tag: string): string {
  let x = `<${tag}>`
  x += `<xLgr>${esc(end.logradouro)}</xLgr>`
  x += `<nro>${esc(end.numero)}</nro>`
  if (end.complemento) x += `<xCpl>${esc(end.complemento)}</xCpl>`
  x += `<xBairro>${esc(end.bairro)}</xBairro>`
  x += `<cMun>${end.cMun}</cMun>`
  x += `<xMun>${esc(end.xMun)}</xMun>`
  x += `<CEP>${soDigitos(end.cep)}</CEP>`
  x += `<UF>${end.uf}</UF>`
  x += `<cPais>${end.pais || '1058'}</cPais>`
  x += `<xPais>${esc(end.xPais || 'BRASIL')}</xPais>`
  if (end.fone) x += `<fone>${soDigitos(end.fone)}</fone>`
  x += `</${tag}>`
  return x
}

/**
 * Monta um participante (rem, dest, exped, receb) com a tag de endereço correta.
 * Ordem do XSD: (CNPJ|CPF) → IE → xNome → enderXxx
 */
function buildParticipante(p: ParticipanteCTe, tagPrincipal: string, tagEndereco: string): string {
  let x = `<${tagPrincipal}>`
  const cnpj = soDigitos(p.cnpj)
  const cpf = soDigitos(p.cpf)
  if (cnpj.length === 14) x += `<CNPJ>${cnpj}</CNPJ>`
  else if (cpf.length === 11) x += `<CPF>${cpf}</CPF>`
  if (p.ie) x += `<IE>${soDigitos(p.ie)}</IE>`
  x += `<xNome>${esc(p.razaoSocial)}</xNome>`
  x += buildEndereco(p.endereco, tagEndereco)
  x += `</${tagPrincipal}>`
  return x
}

// ─── Builder do infModal (por tipo de modal) ────────────────────────────────

function buildInfoModal(dados: DadosCTeXml): string {
  const m = dados.modalDados

  switch (m.tipo) {
    case '01': // Rodoviário
      return `<rodo><RNTRC>${m.rntrc}</RNTRC></rodo>`

    case '02': { // Aéreo
      let x = `<aereo>`
      if (m.nMinu != null) x += `<nMinu>${m.nMinu}</nMinu>`
      if (m.nOCA != null) x += `<nOCA>${m.nOCA}</nOCA>`
      x += `<dPrevAereo>${m.dPrevAereo}</dPrevAereo>`
      // natCarga
      x += `<natCarga>`
      if (m.natCarga.xDime) x += `<xDime>${esc(m.natCarga.xDime)}</xDime>`
      if (m.natCarga.cImp) x += `<cImp>${m.natCarga.cImp}</cImp>`
      if (m.natCarga.cInfManuorth) {
        for (const c of m.natCarga.cInfManuorth) {
          x += `<cInfManu>${c}</cInfManu>`
        }
      }
      x += `</natCarga>`
      // tarifa
      x += `<tarifa>`
      x += `<CL>${m.tarifa.CL}</CL>`
      if (m.tarifa.cTar) x += `<cTar>${m.tarifa.cTar}</cTar>`
      x += `<vTar>${num(m.tarifa.vTar)}</vTar>`
      x += `</tarifa>`
      // peri (produtos perigosos)
      if (m.peri && m.peri.length > 0) {
        for (const p of m.peri) {
          x += `<peri>`
          x += `<nONU>${p.nONU}</nONU>`
          x += `<qTotEmb>${p.qTotEmb}</qTotEmb>`
          if (p.infTotAP) {
            x += `<infTotAP>`
            x += `<qTotProd>${num(p.infTotAP.qTotProd, 4)}</qTotProd>`
            x += `<uniAP>${p.infTotAP.uniAP}</uniAP>`
            x += `</infTotAP>`
          }
          x += `</peri>`
        }
      }
      x += `</aereo>`
      return x
    }

    case '03': { // Aquaviário
      let x = `<aquav>`
      x += `<vPrest>${num(m.vPrest)}</vPrest>`
      x += `<vAFRMM>${num(m.vAFRMM)}</vAFRMM>`
      x += `<xNavio>${esc(m.xNavio)}</xNavio>`
      if (m.nViag) x += `<nViag>${esc(m.nViag)}</nViag>`
      x += `<direc>${m.direc}</direc>`
      x += `<irin>${m.irin}</irin>`
      if (m.lacres && m.lacres.length > 0) {
        for (const lac of m.lacres) {
          x += `<lacre><nLacre>${esc(lac.nLacre)}</nLacre></lacre>`
        }
      }
      if (m.balsas && m.balsas.length > 0) {
        for (const b of m.balsas) {
          x += `<balsa><xBalsa>${esc(b.xBalsa)}</xBalsa></balsa>`
        }
      }
      if (m.detCont && m.detCont.length > 0) {
        for (const cont of m.detCont) {
          x += `<detCont>`
          x += `<nCont>${cont.nCont}</nCont>`
          if (cont.infDoc) {
            x += `<infDoc>`
            if (cont.infDoc.infNFe) {
              for (const chave of cont.infDoc.infNFe) {
                x += `<infNFe><chave>${chave}</chave></infNFe>`
              }
            }
            if (cont.infDoc.infNF) {
              for (const nf of cont.infDoc.infNF) {
                x += `<infNF>`
                x += `<serie>${nf.serie}</serie>`
                x += `<nDoc>${nf.nDoc}</nDoc>`
                if (nf.unidRat != null) x += `<unidRat>${num(nf.unidRat, 2)}</unidRat>`
                x += `</infNF>`
              }
            }
            x += `</infDoc>`
          }
          x += `</detCont>`
        }
      }
      x += `</aquav>`
      return x
    }

    case '04': { // Ferroviário
      let x = `<ferrov>`
      x += `<tpTraf>${m.tpTraf}</tpTraf>`
      x += `<fluxo>${esc(m.fluxo)}</fluxo>`
      if (m.trafMut) {
        x += `<trafMut>`
        x += `<respFat>${m.trafMut.respFat}</respFat>`
        x += `<ferrEmi>${m.trafMut.ferrEmi}</ferrEmi>`
        x += `<vFrete>${num(m.trafMut.vFrete)}</vFrete>`
        if (m.trafMut.chCTeFerroOrigem) {
          x += `<chCTeFerroOrigem>${m.trafMut.chCTeFerroOrigem}</chCTeFerroOrigem>`
        }
        if (m.trafMut.ferroEnv && m.trafMut.ferroEnv.length > 0) {
          for (const f of m.trafMut.ferroEnv) {
            x += `<ferroEnv>`
            x += `<CNPJ>${soDigitos(f.cnpj)}</CNPJ>`
            if (f.cInt) x += `<cInt>${f.cInt}</cInt>`
            if (f.ie) x += `<IE>${soDigitos(f.ie)}</IE>`
            x += `<xNome>${esc(f.xNome)}</xNome>`
            x += buildEndereco(f.enderFerro, 'enderFerro')
            x += `</ferroEnv>`
          }
        }
        x += `</trafMut>`
      }
      x += `</ferrov>`
      return x
    }

    case '05': // Dutoviário
      return `<duto><vTar>${num(m.vTar)}</vTar><dIni>${m.dIni}</dIni><dFim>${m.dFim}</dFim></duto>`

    default:
      // Fallback: rodoviário com RNTRC do campo legado
      return `<rodo><RNTRC>${dados.rntrc || '00000000'}</RNTRC></rodo>`
  }
}

// ─── Builder principal ───────────────────────────────────────────────────────

export function buildCTeXml(dados: DadosCTeXml): string {
  // Extrair cUF, cCT e cDV da chave (44 dígitos)
  // Formato: cUF(2)+AAMM(4)+CNPJ(14)+mod(2)+serie(3)+nCT(9)+tpEmis(1)+cCT(8)+cDV(1)
  const chave = dados.chaveAcesso
  const cUF = chave.substring(0, 2)
  const cCT = chave.substring(35, 43)   // 8 dígitos do código numérico
  const cDV = chave.substring(43, 44)   // 1 dígito verificador

  // QR Code: usa URL fornecida ou determina pela UF do emitente e ambiente
  const urlBase = dados.urlQrCode ?? obterUrlQrCode(dados.ufEnv, dados.tpAmb)
  const qrCodCTe = `${urlBase}?chCTe=${chave}&tpAmb=${dados.tpAmb}`

  let xml = `<?xml version="1.0" encoding="UTF-8"?>`
  xml += `<CTe xmlns="http://www.portalfiscal.inf.br/cte">`
  xml += `<infCte versao="4.00" Id="CTe${chave}">`

  // ── ide ──────────────────────────────────────────────────────────────────
  xml += `<ide>`
  xml += `<cUF>${cUF}</cUF>`
  xml += `<cCT>${cCT}</cCT>`
  xml += `<CFOP>${dados.cfop}</CFOP>`
  xml += `<natOp>PRESTACAO DE SERVICO DE TRANSPORTE</natOp>`
  xml += `<mod>57</mod>`
  xml += `<serie>${dados.serie}</serie>`
  xml += `<nCT>${dados.numero}</nCT>`
  xml += `<dhEmi>${dados.dataEmissao}</dhEmi>`
  xml += `<tpImp>1</tpImp>`
  xml += `<tpEmis>1</tpEmis>`
  xml += `<cDV>${cDV}</cDV>`
  xml += `<tpAmb>${dados.tpAmb}</tpAmb>`
  xml += `<tpCTe>0</tpCTe>`
  xml += `<procEmi>0</procEmi>`
  xml += `<verProc>VisioFab1.0</verProc>`
  xml += `<cMunEnv>${dados.cMunEnv}</cMunEnv>`
  xml += `<xMunEnv>${esc(dados.xMunEnv)}</xMunEnv>`
  xml += `<UFEnv>${dados.ufEnv}</UFEnv>`
  xml += `<modal>${dados.modal}</modal>`
  xml += `<tpServ>0</tpServ>`
  xml += `<cMunIni>${dados.cMunIni}</cMunIni>`
  xml += `<xMunIni>${esc(dados.xMunIni)}</xMunIni>`
  xml += `<UFIni>${dados.ufIni}</UFIni>`
  xml += `<cMunFim>${dados.cMunFim}</cMunFim>`
  xml += `<xMunFim>${esc(dados.xMunFim)}</xMunFim>`
  xml += `<UFFim>${dados.ufFim}</UFFim>`
  xml += `<retira>${dados.retira}</retira>`
  xml += `<indIEToma>${dados.indIEToma}</indIEToma>`
  if (dados.toma <= 3) {
    // toma3: tomador é um dos participantes padrão (0=rem, 1=exped, 2=receb, 3=dest)
    xml += `<toma3><toma>${dados.toma}</toma></toma3>`
  } else {
    // toma4: tomador é "Outros" — precisa de dados completos
    const t4 = dados.tomador4!
    xml += `<toma4>`
    xml += `<toma>4</toma>`
    const t4cnpj = soDigitos(t4.cnpj)
    const t4cpf = soDigitos(t4.cpf)
    if (t4cnpj.length === 14) xml += `<CNPJ>${t4cnpj}</CNPJ>`
    else if (t4cpf.length === 11) xml += `<CPF>${t4cpf}</CPF>`
    if (t4.ie) xml += `<IE>${soDigitos(t4.ie)}</IE>`
    xml += `<xNome>${esc(t4.razaoSocial)}</xNome>`
    xml += buildEndereco(t4.endereco, 'enderToma')
    xml += `</toma4>`
  }
  xml += `</ide>`

  // ── compl (complemento — opcional mas recomendado) ───────────────────────
  const temCompl = dados.xEmi || dados.xObs
  if (temCompl) {
    xml += `<compl>`
    if (dados.xEmi) xml += `<xEmi>${esc(dados.xEmi)}</xEmi>`
    if (dados.xObs) xml += `<xObs>${esc(dados.xObs)}</xObs>`
    xml += `</compl>`
  }

  // ── emit ─────────────────────────────────────────────────────────────────
  // Ordem XSD: CNPJ → IE → xNome → xFant? → enderEmit → CRT
  {
    const e = dados.emitente
    xml += `<emit>`
    xml += `<CNPJ>${soDigitos(e.cnpj)}</CNPJ>`
    if (e.ie) xml += `<IE>${soDigitos(e.ie)}</IE>`
    xml += `<xNome>${esc(e.razaoSocial)}</xNome>`
    if (e.fantasiaOpcional) xml += `<xFant>${esc(e.fantasiaOpcional)}</xFant>`
    xml += buildEndereco(e.endereco, 'enderEmit')
    xml += `<CRT>${e.crt}</CRT>`
    xml += `</emit>`
  }

  // ── rem (remetente) ───────────────────────────────────────────────────────
  xml += buildParticipante(dados.remetente, 'rem', 'enderReme')

  // ── exped (expedidor) — opcional ─────────────────────────────────────────
  if (dados.expedidor) {
    xml += buildParticipante(dados.expedidor, 'exped', 'enderExped')
  }

  // ── receb (recebedor) — opcional ─────────────────────────────────────────
  if (dados.recebedor) {
    xml += buildParticipante(dados.recebedor, 'receb', 'enderReceb')
  }

  // ── dest (destinatário) ───────────────────────────────────────────────────
  xml += buildParticipante(dados.destinatario, 'dest', 'enderDest')

  // ── vPrest (valores da prestação) ────────────────────────────────────────
  xml += `<vPrest>`
  xml += `<vTPrest>${num(dados.valorTotalPrestacao)}</vTPrest>`
  xml += `<vRec>${num(dados.valorReceber)}</vRec>`
  if (dados.componentes && dados.componentes.length > 0) {
    for (const comp of dados.componentes) {
      xml += `<Comp><xNome>${esc(comp.xNome)}</xNome><vComp>${num(comp.vComp)}</vComp></Comp>`
    }
  } else {
    // Ao menos um componente é esperado (recomendado pelo MOC)
    xml += `<Comp><xNome>Frete</xNome><vComp>${num(dados.valorTotalPrestacao)}</vComp></Comp>`
  }
  xml += `</vPrest>`

  // ── imp (tributação) ─────────────────────────────────────────────────────
  xml += `<imp>`
  xml += `<ICMS>`
  switch (dados.cst) {
    case '00':
      xml += `<ICMS00>`
      xml += `<CST>00</CST>`
      xml += `<vBC>${num(dados.vBC ?? dados.valorTotalPrestacao)}</vBC>`
      xml += `<pICMS>${num(dados.pICMS ?? 12)}</pICMS>`
      xml += `<vICMS>${num(dados.vICMS ?? (dados.valorTotalPrestacao * 0.12))}</vICMS>`
      xml += `</ICMS00>`
      break
    case '20':
      xml += `<ICMS20>`
      xml += `<CST>20</CST>`
      xml += `<pRedBC>${num(dados.pRedBC ?? 0)}</pRedBC>`
      xml += `<vBC>${num(dados.vBC ?? dados.valorTotalPrestacao)}</vBC>`
      xml += `<pICMS>${num(dados.pICMS ?? 12)}</pICMS>`
      xml += `<vICMS>${num(dados.vICMS ?? (dados.valorTotalPrestacao * 0.12))}</vICMS>`
      xml += `</ICMS20>`
      break
    case '40':
      xml += `<ICMS40><CST>40</CST></ICMS40>`
      break
    case '41':
      // Não tributado — usado pelo Simples Nacional
      xml += `<ICMS45><CST>41</CST></ICMS45>`
      break
    case '51':
      xml += `<ICMS51>`
      xml += `<CST>51</CST>`
      if (dados.pRedBC != null) xml += `<pRedBC>${num(dados.pRedBC)}</pRedBC>`
      xml += `<vBC>${num(dados.vBC ?? dados.valorTotalPrestacao)}</vBC>`
      xml += `<pICMS>${num(dados.pICMS ?? 12)}</pICMS>`
      xml += `<vICMSDif>${num(dados.vICMS ?? 0)}</vICMSDif>`
      xml += `</ICMS51>`
      break
    case '60':
      xml += `<ICMS60>`
      xml += `<CST>60</CST>`
      xml += `<vBCST>${num(dados.vBC ?? 0)}</vBCST>`
      xml += `<vICMSST>${num(dados.vICMS ?? 0)}</vICMSST>`
      xml += `</ICMS60>`
      break
    case '90':
    default:
      // CST 90 — Outros / Simples Nacional tributado
      xml += `<ICMS90>`
      xml += `<CST>90</CST>`
      if (dados.vBC != null) xml += `<vBC>${num(dados.vBC)}</vBC>`
      if (dados.pICMS != null) xml += `<pICMS>${num(dados.pICMS)}</pICMS>`
      if (dados.vICMS != null) xml += `<vICMS>${num(dados.vICMS)}</vICMS>`
      xml += `</ICMS90>`
      break
  }
  xml += `</ICMS>`
  // vTotTrib — obrigatório pela Lei da Transparência 12.741/2012
  xml += `<vTotTrib>${num(dados.vTotTrib ?? 0)}</vTotTrib>`
  xml += `</imp>`

  // ── infCTeNorm ────────────────────────────────────────────────────────────
  xml += `<infCTeNorm>`

  // infCarga
  xml += `<infCarga>`
  xml += `<vCarga>${num(dados.valorCarga)}</vCarga>`
  xml += `<proPred>${esc(dados.produtoPredominante)}</proPred>`
  for (const q of dados.quantidades) {
    xml += `<infQ>`
    xml += `<cUnid>${q.cUnid}</cUnid>`
    xml += `<tpMed>${esc(q.tpMed)}</tpMed>`
    xml += `<qCarga>${q.qCarga.toFixed(4)}</qCarga>`
    xml += `</infQ>`
  }
  xml += `</infCarga>`

  // infDoc (documentos referenciados)
  const temDoc = (dados.chavesNfeRef && dados.chavesNfeRef.length > 0)
    || (dados.chavesNfRef && dados.chavesNfRef.length > 0)
  if (temDoc) {
    xml += `<infDoc>`
    for (const chaveNfe of (dados.chavesNfeRef || [])) {
      xml += `<infNFe><chave>${chaveNfe}</chave></infNFe>`
    }
    for (const nf of (dados.chavesNfRef || [])) {
      xml += `<infNF>`
      xml += `<CNPJ>${soDigitos(nf.CNPJ)}</CNPJ>`
      xml += `<mod>${nf.mod}</mod>`
      xml += `<serie>${nf.serie}</serie>`
      if (nf.subSerie) xml += `<subSer>${nf.subSerie}</subSer>`
      xml += `<nro>${nf.nro}</nro>`
      xml += `<valor>${num(nf.valor)}</valor>`
      xml += `<dEmi>${nf.dEmi}</dEmi>`
      xml += `</infNF>`
    }
    xml += `</infDoc>`
  }

  // infModal (obrigatório — define o modal de transporte)
  xml += `<infModal versaoModal="4.00">`
  xml += buildInfoModal(dados)
  xml += `</infModal>`

  // veicNovos (quando se transporta veículo novo)
  if (dados.veiculosNovos && dados.veiculosNovos.length > 0) {
    for (const v of dados.veiculosNovos) {
      xml += `<veicNovos>`
      xml += `<chassi>${v.chassi}</chassi>`
      xml += `<cCor>${v.cCor}</cCor>`
      xml += `<xCor>${esc(v.xCor)}</xCor>`
      xml += `<cMod>${v.cMod}</cMod>`
      xml += `<vUnit>${num(v.vUnit)}</vUnit>`
      xml += `<vFrete>${num(v.vFrete)}</vFrete>`
      xml += `</veicNovos>`
    }
  }

  xml += `</infCTeNorm>`

  // ── infCTeSupl (obrigatório na versão 4.00 — QR Code) ───────────────────
  xml += `<infCTeSupl>`
  xml += `<qrCodCTe>${esc(qrCodCTe)}</qrCodCTe>`
  xml += `</infCTeSupl>`

  xml += `</infCte>`
  xml += `</CTe>`

  return xml
}
