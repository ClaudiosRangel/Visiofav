/**
 * Serviço de integração Compras → Fiscal
 *
 * Responsável por criar DocumentoFiscal de entrada a partir do XML do fornecedor.
 * Parseia o XML da NF-e, extrai dados do emitente, itens com tributos, e persiste
 * o documento fiscal vinculado à CompraEfetivada dentro de uma transação Prisma.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.6
 */

import { XMLParser } from 'fast-xml-parser'
import { prisma } from '../../../lib/prisma'
import { CodigoErroFiscal, ErroFiscal } from '../erros'

// === Tipos ===

export interface CriarDocFiscalEntradaParams {
  empresaId: string
  xmlNfe: string
  compraEfetivadaId: string
}

interface DadosNFeEntrada {
  chaveAcesso: string
  numero: number
  serie: number
  dataEmissao: string
  protocolo: string
  emitente: {
    cnpj: string
    razaoSocial: string
    uf: string
  }
  destinatario: {
    cpfCnpj: string
    razaoSocial: string
    uf: string
    ie: string
  }
  itens: ItemNFeEntrada[]
  totais: {
    valorProdutos: number
    valorTotal: number
    valorFrete: number
    valorSeguro: number
    valorDesconto: number
    valorOutras: number
    valorIcms: number
    valorIcmsSt: number
    valorIpi: number
    valorPis: number
    valorCofins: number
  }
}

interface ItemNFeEntrada {
  nItem: number
  codigoProd: string
  descricao: string
  ncm: string
  cfop: string
  unidade: string
  quantidade: number
  valorUnitario: number
  valorTotal: number
  valorDesconto: number
  // ICMS
  icmsOrigem: number
  icmsCst: string
  icmsBase: number
  icmsAliquota: number
  icmsValor: number
  // ICMS-ST
  icmsStBase: number
  icmsStAliquota: number
  icmsStValor: number
  // IPI
  ipiCst: string
  ipiBase: number
  ipiAliquota: number
  ipiValor: number
  // PIS
  pisCst: string
  pisBase: number
  pisAliquota: number
  pisValor: number
  // COFINS
  cofinsCst: string
  cofinsBase: number
  cofinsAliquota: number
  cofinsValor: number
}

// === Parser XML configurado para NF-e ===

function createNFeParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    parseTagValue: true,
    trimValues: true,
    numberParseOptions: {
      leadingZeros: false,
      hex: false,
      skipLike: /^\d{15,}$/,
    },
    isArray: (name) => name === 'det' || name === 'vol',
  })
}

// === Helpers ===

function toNumber(value: any): number {
  if (value == null) return 0
  const num = Number(value)
  return isNaN(num) ? 0 : num
}

function toString(value: any): string {
  if (value == null) return ''
  return String(value)
}

function ensureArray(value: any): any[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

// === Serviço ===

export class CompraFiscalService {
  /**
   * Cria DocumentoFiscal de entrada a partir do XML do fornecedor.
   *
   * Fluxo:
   * 1. Parseia e valida o XML da NF-e
   * 2. Extrai chave de acesso, emitente, itens com tributos, totais e protocolo
   * 3. Cria DocumentoFiscal (tipo=NFE, tipoOperacao=0, status=AUTORIZADO)
   * 4. Cria ItemDocumentoFiscal para cada item preservando ICMS, IPI, PIS, COFINS
   * 5. Vincula à CompraEfetivada via compraEfetivadaId
   *
   * Requirements: 3.1, 3.2, 3.3, 3.4, 3.6
   */
  async criarDocFiscalEntrada(params: CriarDocFiscalEntradaParams) {
    const { empresaId, xmlNfe, compraEfetivadaId } = params

    // 1. Parsear e validar o XML
    const dadosNFe = this.parseNFeXml(xmlNfe)

    // 2. Criar DocumentoFiscal + itens dentro de uma transação
    const documentoFiscal = await prisma.$transaction(async (tx) => {
      const doc = await tx.documentoFiscal.create({
        data: {
          empresaId,
          tipo: 'NFE',
          modelo: 55,
          serie: dadosNFe.serie,
          numero: dadosNFe.numero,
          chaveAcesso: dadosNFe.chaveAcesso || null,
          status: 'AUTORIZADO',
          naturezaOp: 'COMPRA',
          dataEmissao: dadosNFe.dataEmissao
            ? new Date(dadosNFe.dataEmissao)
            : new Date(),
          tipoOperacao: 0, // Entrada
          finalidade: 1, // Normal
          emitenteCnpj: dadosNFe.emitente.cnpj,
          emitenteRazao: dadosNFe.emitente.razaoSocial,
          emitenteUf: dadosNFe.emitente.uf,
          destCpfCnpj: dadosNFe.destinatario.cpfCnpj || null,
          destRazao: dadosNFe.destinatario.razaoSocial || null,
          destUf: dadosNFe.destinatario.uf || null,
          destIe: dadosNFe.destinatario.ie || null,
          valorProdutos: dadosNFe.totais.valorProdutos,
          valorFrete: dadosNFe.totais.valorFrete,
          valorSeguro: dadosNFe.totais.valorSeguro,
          valorDesconto: dadosNFe.totais.valorDesconto,
          valorOutras: dadosNFe.totais.valorOutras,
          valorTotal: dadosNFe.totais.valorTotal,
          valorIcms: dadosNFe.totais.valorIcms,
          valorIcmsSt: dadosNFe.totais.valorIcmsSt,
          valorIpi: dadosNFe.totais.valorIpi,
          valorPis: dadosNFe.totais.valorPis,
          valorCofins: dadosNFe.totais.valorCofins,
          xmlAutorizado: xmlNfe,
          protocolo: dadosNFe.protocolo || null,
          dataAutorizacao: dadosNFe.protocolo ? new Date() : null,
          ambiente: 1, // Produção (XML do fornecedor é real)
          compraEfetivadaId,
          itens: {
            create: dadosNFe.itens.map((item) => ({
              nItem: item.nItem,
              codigoProd: item.codigoProd,
              descricao: item.descricao,
              ncm: item.ncm,
              cfop: item.cfop,
              unidade: item.unidade,
              quantidade: item.quantidade,
              valorUnitario: item.valorUnitario,
              valorTotal: item.valorTotal,
              valorDesconto: item.valorDesconto,
              // ICMS
              icmsOrigem: item.icmsOrigem,
              icmsCst: item.icmsCst || null,
              icmsBase: item.icmsBase,
              icmsAliquota: item.icmsAliquota,
              icmsValor: item.icmsValor,
              // ICMS-ST
              icmsStBase: item.icmsStBase,
              icmsStAliquota: item.icmsStAliquota,
              icmsStValor: item.icmsStValor,
              // IPI
              ipiCst: item.ipiCst || null,
              ipiBase: item.ipiBase,
              ipiAliquota: item.ipiAliquota,
              ipiValor: item.ipiValor,
              // PIS
              pisCst: item.pisCst || null,
              pisBase: item.pisBase,
              pisAliquota: item.pisAliquota,
              pisValor: item.pisValor,
              // COFINS
              cofinsCst: item.cofinsCst || null,
              cofinsBase: item.cofinsBase,
              cofinsAliquota: item.cofinsAliquota,
              cofinsValor: item.cofinsValor,
            })),
          },
        },
        include: {
          itens: true,
        },
      })

      return doc
    })

    return documentoFiscal
  }

  /**
   * Parseia o XML da NF-e de entrada e extrai dados estruturados.
   * Aceita tanto o envelope `nfeProc` (com protocolo) quanto o XML da `NFe` diretamente.
   *
   * @throws ErroFiscal se o XML não é uma NF-e válida
   */
  parseNFeXml(xml: string): DadosNFeEntrada {
    // Validar que é um XML de NF-e
    if (!xml.includes('<nfeProc') && !xml.includes('<NFe')) {
      throw new ErroFiscal(
        CodigoErroFiscal.XML_ESTRUTURA_INVALIDA,
        'O XML fornecido não é uma NF-e válida (não contém nfeProc ou NFe)',
      )
    }

    const parser = createNFeParser()
    let parsed: any

    try {
      parsed = parser.parse(xml)
    } catch (err) {
      throw new ErroFiscal(
        CodigoErroFiscal.XML_ESTRUTURA_INVALIDA,
        `Falha ao parsear XML: ${err instanceof Error ? err.message : 'erro desconhecido'}`,
      )
    }

    // Navegar na estrutura: nfeProc > NFe > infNFe
    const nfeProc = parsed.nfeProc || parsed
    const nfe = nfeProc.NFe || nfeProc
    const infNFe = nfe.infNFe || nfe

    // Validar que temos a estrutura mínima de emitente
    const emit = infNFe.emit
    if (!emit || !emit.CNPJ) {
      throw new ErroFiscal(
        CodigoErroFiscal.XML_ESTRUTURA_INVALIDA,
        'XML inválido: emitente (emit) com CNPJ não encontrado',
      )
    }

    // Protocolo de autorização
    const protNFe = nfeProc.protNFe || {}
    const infProt = protNFe.infProt || {}

    // Chave de acesso
    const chaveAcesso = this.extrairChaveAcesso(xml, infNFe, infProt)

    // Dados do ide
    const ide = infNFe.ide || {}

    // Emitente
    const emitente = {
      cnpj: toString(emit.CNPJ),
      razaoSocial: toString(emit.xNome),
      uf: toString(emit.enderEmit?.UF || ''),
    }

    // Destinatário
    const dest = infNFe.dest || {}
    const destinatario = {
      cpfCnpj: toString(dest.CNPJ || dest.CPF || ''),
      razaoSocial: toString(dest.xNome || ''),
      uf: toString(dest.enderDest?.UF || ''),
      ie: toString(dest.IE || ''),
    }

    // Itens
    const detArray = ensureArray(infNFe.det)
    const itens: ItemNFeEntrada[] = detArray.map((det: any, index: number) => {
      const prod = det.prod || {}
      const imposto = det.imposto || {}

      // ICMS
      const icmsGroup = imposto.ICMS || {}
      const icms = icmsGroup.ICMS00 || icmsGroup.ICMS10 || icmsGroup.ICMS20
        || icmsGroup.ICMS30 || icmsGroup.ICMS40 || icmsGroup.ICMS51
        || icmsGroup.ICMS60 || icmsGroup.ICMS70 || icmsGroup.ICMS90
        || icmsGroup.ICMSSN101 || icmsGroup.ICMSSN102 || icmsGroup.ICMSSN201
        || icmsGroup.ICMSSN202 || icmsGroup.ICMSSN500 || icmsGroup.ICMSSN900 || {}

      // IPI
      const ipiGroup = imposto.IPI || {}
      const ipiTrib = ipiGroup.IPITrib || ipiGroup.IPINT || {}

      // PIS
      const pisGroup = imposto.PIS || {}
      const pis = pisGroup.PISAliq || pisGroup.PISQtde || pisGroup.PISNT
        || pisGroup.PISOutr || {}

      // COFINS
      const cofinsGroup = imposto.COFINS || {}
      const cofins = cofinsGroup.COFINSAliq || cofinsGroup.COFINSQtde
        || cofinsGroup.COFINSNT || cofinsGroup.COFINSOutr || {}

      // ICMS-ST (pode estar em ICMS10, ICMS30, ICMS70, ICMS90, etc.)
      const icmsStBase = toNumber(icms.vBCST)
      const icmsStAliquota = toNumber(icms.pICMSST)
      const icmsStValor = toNumber(icms.vICMSST)

      return {
        nItem: toNumber(det['@_nItem']) || (index + 1),
        codigoProd: toString(prod.cProd),
        descricao: toString(prod.xProd),
        ncm: toString(prod.NCM),
        cfop: toString(prod.CFOP),
        unidade: toString(prod.uCom),
        quantidade: toNumber(prod.qCom),
        valorUnitario: toNumber(prod.vUnCom),
        valorTotal: toNumber(prod.vProd),
        valorDesconto: toNumber(prod.vDesc),
        // ICMS
        icmsOrigem: toNumber(icms.orig),
        icmsCst: toString(icms.CST || icms.CSOSN || ''),
        icmsBase: toNumber(icms.vBC),
        icmsAliquota: toNumber(icms.pICMS),
        icmsValor: toNumber(icms.vICMS),
        // ICMS-ST
        icmsStBase,
        icmsStAliquota,
        icmsStValor,
        // IPI
        ipiCst: toString(ipiTrib.CST || ipiGroup.CST || ''),
        ipiBase: toNumber(ipiTrib.vBC),
        ipiAliquota: toNumber(ipiTrib.pIPI),
        ipiValor: toNumber(ipiTrib.vIPI),
        // PIS
        pisCst: toString(pis.CST || ''),
        pisBase: toNumber(pis.vBC),
        pisAliquota: toNumber(pis.pPIS),
        pisValor: toNumber(pis.vPIS),
        // COFINS
        cofinsCst: toString(cofins.CST || ''),
        cofinsBase: toNumber(cofins.vBC),
        cofinsAliquota: toNumber(cofins.pCOFINS),
        cofinsValor: toNumber(cofins.vCOFINS),
      }
    })

    // Totais
    const ICMSTot = infNFe.total?.ICMSTot || {}
    const totais = {
      valorProdutos: toNumber(ICMSTot.vProd),
      valorTotal: toNumber(ICMSTot.vNF),
      valorFrete: toNumber(ICMSTot.vFrete),
      valorSeguro: toNumber(ICMSTot.vSeg),
      valorDesconto: toNumber(ICMSTot.vDesc),
      valorOutras: toNumber(ICMSTot.vOutro),
      valorIcms: toNumber(ICMSTot.vICMS),
      valorIcmsSt: toNumber(ICMSTot.vST),
      valorIpi: toNumber(ICMSTot.vIPI),
      valorPis: toNumber(ICMSTot.vPIS),
      valorCofins: toNumber(ICMSTot.vCOFINS),
    }

    return {
      chaveAcesso,
      numero: toNumber(ide.nNF),
      serie: toNumber(ide.serie),
      dataEmissao: toString(ide.dhEmi),
      protocolo: toString(infProt.nProt),
      emitente,
      destinatario,
      itens,
      totais,
    }
  }

  /**
   * Extrai a chave de acesso do XML.
   * Tenta múltiplas fontes: infProt.chNFe, atributo Id da infNFe, ou regex.
   */
  private extrairChaveAcesso(xml: string, infNFe: any, infProt: any): string {
    // 1. Do protocolo
    if (infProt.chNFe) {
      return toString(infProt.chNFe)
    }

    // 2. Do atributo Id da infNFe (formato: "NFe" + 44 dígitos)
    const idAttr = infNFe['@_Id']
    if (idAttr) {
      const match = String(idAttr).match(/\d{44}/)
      if (match) return match[0]
    }

    // 3. Via regex no XML bruto
    const chNFeMatch = xml.match(/<chNFe>(\d{44})<\/chNFe>/)
    if (chNFeMatch) return chNFeMatch[1]

    const idMatch = xml.match(/Id="NFe(\d{44})"/)
    if (idMatch) return idMatch[1]

    // Retornar vazio se não encontrar (campo opcional no DocumentoFiscal)
    return ''
  }
}

// === Instância singleton ===

export const compraFiscalService = new CompraFiscalService()
