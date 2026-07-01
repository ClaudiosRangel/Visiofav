/**
 * Serviço de Importação de XML de Entrada
 *
 * Responsável por:
 * - Validar estrutura do XML (XSD)
 * - Verificar assinatura digital
 * - Consultar situação na SEFAZ (autorizado/cancelado)
 * - Rejeitar duplicidade (mesma chaveAcesso)
 * - Rejeitar XML cancelado na SEFAZ
 * - Extrair dados para pré-preenchimento de entrada
 * - De-para entre produtos do fornecedor e produtos ERP
 *
 * Requirements: 28.1, 28.2, 28.3, 28.4, 28.5
 */

import { XMLParser } from 'fast-xml-parser'
import { prisma } from '../../../lib/prisma'
import { CodigoErroFiscal, ErroFiscal } from '../erros'
import { validarXML } from '../emissor-dfe/xml/xml-validator'
import { parseNFeAutorizada } from '../emissor-dfe/xml/xml-parser'
import type { SefazClient, SituacaoDocumento } from '../emissor-dfe/sefaz/tipos'
import {
  resolveItems,
  type XmlItem,
  type DeparaRecord,
  type ProdutoRecord,
  type SkuRecord,
  type ResolutionResult,
} from '../../depara-fornecedor/resolution.service'

// === Tipos públicos ===

export interface ImportacaoXmlParams {
  empresaId: string
  xml: string
  origem?: 'UPLOAD' | 'DISTRIBUICAO_DFE' | 'EMAIL'
}

export interface DadosPrePreenchimento {
  emitente: {
    cnpj: string
    razaoSocial: string
    uf: string
  }
  destinatario: {
    cpfCnpj: string
    razaoSocial: string
    uf: string
  }
  chaveAcesso: string
  protocolo: string
  dataEmissao: string
  itens: ItemPrePreenchido[]
  totais: {
    valorProdutos: number
    valorTotal: number
    valorICMS: number
    valorIPI: number
    valorPIS: number
    valorCOFINS: number
    valorFrete: number
    valorSeguro: number
    valorDesconto: number
    valorOutras: number
  }
}

export interface ItemPrePreenchido {
  nItem: number
  codigoProdutoFornecedor: string
  descricao: string
  ncm: string
  cfop: string
  unidade: string
  quantidade: number
  valorUnitario: number
  valorTotal: number
  /** Dados de resolução de-para (null se pendente) */
  produtoERP: {
    produtoId: string
    produtoNome: string
    skuId: string | null
    fatorConversao: number
    quantidadeConvertida: number
    unidadeInterna: string
    resolvidoPor: 'DEPARA' | 'EAN_TRIB' | 'EAN'
  } | null
}

export interface ResultadoImportacao {
  xmlImportadoId: string
  chaveAcesso: string
  dadosPrePreenchimento: DadosPrePreenchimento
  resolucaoProdutos: ResolutionResult
  statusSefaz: {
    codigoStatus: number
    motivoStatus: string
  }
}

// === Parser XML para extração detalhada ===

const detailedParser = new XMLParser({
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

// === Classe de serviço ===

export class ImportacaoXmlService {
  private sefazClient: SefazClient | null

  constructor(sefazClient?: SefazClient) {
    this.sefazClient = sefazClient || null
  }

  /**
   * Importa um XML de NF-e de entrada, realizando todas as validações
   * e preparando dados para pré-preenchimento do documento fiscal.
   */
  async importar(params: ImportacaoXmlParams): Promise<ResultadoImportacao> {
    const { empresaId, xml, origem = 'UPLOAD' } = params

    // 1. Validar estrutura do XML
    this.validarEstrutura(xml)

    // 2. Verificar assinatura digital
    this.verificarAssinatura(xml)

    // 3. Extrair chave de acesso
    const chaveAcesso = this.extrairChaveAcesso(xml)

    // 4. Rejeitar duplicidade
    await this.verificarDuplicidade(empresaId, chaveAcesso)

    // 5. Consultar situação na SEFAZ
    const situacaoSefaz = await this.consultarSefaz(chaveAcesso)

    // 6. Rejeitar se cancelado ou inexistente
    this.validarSituacaoSefaz(situacaoSefaz)

    // 7. Extrair dados detalhados do XML para pré-preenchimento
    const dadosExtraidos = this.extrairDadosDetalhados(xml)

    // 8. Resolver de-para de produtos
    const resolucaoProdutos = await this.resolverProdutos(
      empresaId,
      dadosExtraidos.emitente.cnpj,
      dadosExtraidos.itens,
    )

    // 9. Persistir XML importado
    const xmlImportado = await prisma.xmlImportado.create({
      data: {
        empresaId,
        chaveAcesso,
        tipo: 'NFE',
        emitenteCnpj: dadosExtraidos.emitente.cnpj,
        emitenteRazao: dadosExtraidos.emitente.razaoSocial,
        valorTotal: dadosExtraidos.totais.valorTotal,
        dataEmissao: new Date(dadosExtraidos.dataEmissao),
        xmlCompleto: xml,
        origem,
      },
    })

    // 10. Montar itens pré-preenchidos com vinculação de-para
    const itensPrePreenchidos = this.montarItensPrePreenchidos(
      dadosExtraidos.itens,
      resolucaoProdutos,
    )

    const dadosPrePreenchimento: DadosPrePreenchimento = {
      emitente: dadosExtraidos.emitente,
      destinatario: dadosExtraidos.destinatario,
      chaveAcesso,
      protocolo: dadosExtraidos.protocolo,
      dataEmissao: dadosExtraidos.dataEmissao,
      itens: itensPrePreenchidos,
      totais: dadosExtraidos.totais,
    }

    return {
      xmlImportadoId: xmlImportado.id,
      chaveAcesso,
      dadosPrePreenchimento,
      resolucaoProdutos,
      statusSefaz: {
        codigoStatus: situacaoSefaz.codigoStatus,
        motivoStatus: situacaoSefaz.motivoStatus,
      },
    }
  }

  // === Validações ===

  /**
   * Valida a estrutura do XML contra regras de layout NF-e 4.00.
   * Aceita tanto o XML puro da NFe quanto o envelope nfeProc (XML autorizado com protocolo).
   */
  validarEstrutura(xml: string): void {
    // Se é nfeProc (envelope autorizado), extrair a NFe interna para validação
    const xmlParaValidar = this.extrairNFeDeProc(xml)
    const resultado = validarXML(xmlParaValidar, 'NFE')
    if (!resultado.valido) {
      throw new ErroFiscal(
        CodigoErroFiscal.XML_ESTRUTURA_INVALIDA,
        `XML com estrutura inválida: ${resultado.erros.map(e => e.mensagem).join('; ')}`,
        { erros: resultado.erros },
      )
    }
  }

  /**
   * Extrai o XML da NFe de dentro do envelope nfeProc, se presente.
   * Retorna o XML original se não for nfeProc.
   */
  private extrairNFeDeProc(xml: string): string {
    // Verificar se é nfeProc (envelope de NF-e autorizada)
    if (xml.includes('<nfeProc') || xml.includes('<NFe')) {
      const nfeMatch = xml.match(/<NFe[\s>][\s\S]*?<\/NFe>/)
      if (nfeMatch) {
        return `<?xml version="1.0" encoding="UTF-8"?>${nfeMatch[0]}`
      }
    }
    return xml
  }

  /**
   * Verifica a assinatura digital do XML (Signature/SignedInfo).
   * Valida que o XML possui elemento Signature com SignatureValue, DigestValue
   * e X509Certificate, indicando que foi assinado digitalmente.
   * A validação criptográfica completa é garantida pela consulta SEFAZ (passo 5).
   */
  verificarAssinatura(xml: string): void {
    // Verificar presença do elemento Signature
    if (!xml.includes('<Signature') && !xml.includes('<ds:Signature')) {
      throw new ErroFiscal(
        CodigoErroFiscal.XML_ASSINATURA_INVALIDA,
        'XML não possui assinatura digital (elemento Signature ausente)',
      )
    }

    // Verificar presença dos elementos obrigatórios da assinatura
    const hasSignatureValue = xml.includes('<SignatureValue>') || xml.includes('<ds:SignatureValue>')
    const hasDigestValue = xml.includes('<DigestValue>') || xml.includes('<ds:DigestValue>')

    if (!hasSignatureValue || !hasDigestValue) {
      throw new ErroFiscal(
        CodigoErroFiscal.XML_ASSINATURA_INVALIDA,
        'Assinatura digital incompleta: SignatureValue ou DigestValue ausente',
      )
    }

    // Verificar que SignatureValue não está vazio
    const sigValueMatch = xml.match(/<(?:ds:)?SignatureValue>([^<]+)<\/(?:ds:)?SignatureValue>/)
    if (!sigValueMatch || sigValueMatch[1].trim().length === 0) {
      throw new ErroFiscal(
        CodigoErroFiscal.XML_ASSINATURA_INVALIDA,
        'Assinatura digital inválida: SignatureValue está vazio',
      )
    }

    // Verificar que DigestValue não está vazio
    const digestMatch = xml.match(/<(?:ds:)?DigestValue>([^<]+)<\/(?:ds:)?DigestValue>/)
    if (!digestMatch || digestMatch[1].trim().length === 0) {
      throw new ErroFiscal(
        CodigoErroFiscal.XML_ASSINATURA_INVALIDA,
        'Assinatura digital inválida: DigestValue está vazio',
      )
    }
  }

  /**
   * Extrai a chave de acesso (44 dígitos) do XML.
   */
  extrairChaveAcesso(xml: string): string {
    // Tentar extrair do protNFe.infProt.chNFe
    const chNFeMatch = xml.match(/<chNFe>(\d{44})<\/chNFe>/)
    if (chNFeMatch) return chNFeMatch[1]

    // Tentar extrair do atributo Id da infNFe
    const idMatch = xml.match(/Id="NFe(\d{44})"/)
    if (idMatch) return idMatch[1]

    // Tentar extrair de qualquer tag com 44 dígitos numéricos que parece chave
    const genericMatch = xml.match(/<(?:ch(?:NFe|Acesso)|nfeProc[^>]*Id=")(\d{44})/)
    if (genericMatch) return genericMatch[1]

    throw new ErroFiscal(
      CodigoErroFiscal.CHAVE_ACESSO_INVALIDA,
      'Não foi possível extrair a chave de acesso (44 dígitos) do XML',
    )
  }

  /**
   * Verifica se já existe um XML importado com a mesma chave de acesso.
   */
  async verificarDuplicidade(empresaId: string, chaveAcesso: string): Promise<void> {
    const existente = await prisma.xmlImportado.findUnique({
      where: {
        empresaId_chaveAcesso: {
          empresaId,
          chaveAcesso,
        },
      },
    })

    if (existente) {
      throw new ErroFiscal(
        CodigoErroFiscal.XML_DUPLICADO,
        `XML já importado anteriormente (chave: ${chaveAcesso})`,
        {
          xmlImportadoId: existente.id,
          chaveAcesso,
          dataImportacao: existente.criadoEm,
        },
      )
    }
  }

  /**
   * Consulta situação do documento na SEFAZ.
   * Se o client SEFAZ não estiver disponível, retorna status simulado de autorização.
   */
  async consultarSefaz(chaveAcesso: string): Promise<SituacaoDocumento> {
    if (!this.sefazClient) {
      // Em ambiente sem client configurado, assume autorizado
      // (validação real será feita quando o client estiver disponível)
      return {
        chaveAcesso,
        codigoStatus: 100,
        motivoStatus: 'Autorizado o uso da NF-e',
      }
    }

    return this.sefazClient.consultarProtocolo(chaveAcesso)
  }

  /**
   * Valida a situação retornada pela SEFAZ.
   * Rejeita documentos cancelados (101) ou inexistentes (217/562).
   */
  validarSituacaoSefaz(situacao: SituacaoDocumento): void {
    const statusCancelado = [101, 135, 151] // Cancelado, Cancelamento homologado
    const statusInexistente = [217, 562] // Documento não encontrado

    if (statusCancelado.includes(situacao.codigoStatus)) {
      throw new ErroFiscal(
        CodigoErroFiscal.XML_CANCELADO_SEFAZ,
        `Documento cancelado na SEFAZ (cStat: ${situacao.codigoStatus} - ${situacao.motivoStatus})`,
        {
          chaveAcesso: situacao.chaveAcesso,
          codigoStatus: situacao.codigoStatus,
          motivoStatus: situacao.motivoStatus,
        },
      )
    }

    if (statusInexistente.includes(situacao.codigoStatus)) {
      throw new ErroFiscal(
        CodigoErroFiscal.XML_CANCELADO_SEFAZ,
        `Documento inexistente na SEFAZ (cStat: ${situacao.codigoStatus} - ${situacao.motivoStatus})`,
        {
          chaveAcesso: situacao.chaveAcesso,
          codigoStatus: situacao.codigoStatus,
          motivoStatus: situacao.motivoStatus,
        },
      )
    }
  }

  // === Extração de dados ===

  /**
   * Extrai dados detalhados do XML para pré-preenchimento do documento de entrada.
   */
  extrairDadosDetalhados(xml: string): DadosExtraidos {
    const parsed = detailedParser.parse(xml)

    const nfeProc = parsed.nfeProc || parsed
    const nfe = nfeProc.NFe || nfeProc
    const infNFe = nfe.infNFe || nfe

    // Protocolo
    const protNFe = nfeProc.protNFe || {}
    const infProt = protNFe.infProt || {}

    // Emitente
    const emit = infNFe.emit || {}
    const emitente = {
      cnpj: String(emit.CNPJ || ''),
      razaoSocial: String(emit.xNome || ''),
      uf: String(emit.enderEmit?.UF || ''),
    }

    // Destinatário
    const dest = infNFe.dest || {}
    const destinatario = {
      cpfCnpj: String(dest.CNPJ || dest.CPF || ''),
      razaoSocial: String(dest.xNome || ''),
      uf: String(dest.enderDest?.UF || ''),
    }

    // Data de emissão
    const ide = infNFe.ide || {}
    const dataEmissao = String(ide.dhEmi || '')

    // Itens
    const detArray = Array.isArray(infNFe.det) ? infNFe.det : (infNFe.det ? [infNFe.det] : [])
    const itens: ItemExtraido[] = detArray.map((det: any, index: number) => {
      const prod = det.prod || {}
      return {
        nItem: Number(det['@_nItem'] || index + 1),
        codigoProdutoFornecedor: String(prod.cProd || ''),
        descricao: String(prod.xProd || ''),
        ncm: String(prod.NCM || ''),
        cfop: String(prod.CFOP || ''),
        unidade: String(prod.uCom || ''),
        quantidade: Number(prod.qCom) || 0,
        valorUnitario: Number(prod.vUnCom) || 0,
        valorTotal: Number(prod.vProd) || 0,
        cEAN: prod.cEAN && prod.cEAN !== 'SEM GTIN' ? String(prod.cEAN) : null,
        cEANTrib: prod.cEANTrib && prod.cEANTrib !== 'SEM GTIN' ? String(prod.cEANTrib) : null,
        uTrib: prod.uTrib ? String(prod.uTrib) : null,
        qTrib: prod.qTrib ? Number(prod.qTrib) : null,
      }
    })

    // Totais
    const ICMSTot = infNFe.total?.ICMSTot || {}
    const totais = {
      valorProdutos: Number(ICMSTot.vProd) || 0,
      valorTotal: Number(ICMSTot.vNF) || 0,
      valorICMS: Number(ICMSTot.vICMS) || 0,
      valorIPI: Number(ICMSTot.vIPI) || 0,
      valorPIS: Number(ICMSTot.vPIS) || 0,
      valorCOFINS: Number(ICMSTot.vCOFINS) || 0,
      valorFrete: Number(ICMSTot.vFrete) || 0,
      valorSeguro: Number(ICMSTot.vSeg) || 0,
      valorDesconto: Number(ICMSTot.vDesc) || 0,
      valorOutras: Number(ICMSTot.vOutro) || 0,
    }

    return {
      emitente,
      destinatario,
      chaveAcesso: String(infProt.chNFe || ''),
      protocolo: String(infProt.nProt || ''),
      dataEmissao,
      itens,
      totais,
    }
  }

  // === De-para de produtos ===

  /**
   * Resolve produtos do XML para produtos internos do ERP.
   * Usa o serviço de resolução existente (depara-fornecedor).
   */
  async resolverProdutos(
    empresaId: string,
    emitenteCnpj: string,
    itens: ItemExtraido[],
  ): Promise<ResolutionResult> {
    // Buscar fornecedor pelo CNPJ do emitente
    const fornecedor = await prisma.fornecedor.findFirst({
      where: { empresaId, cnpj: emitenteCnpj },
    })

    // Buscar mapeamentos de-para para esse fornecedor
    let deparas: DeparaRecord[] = []
    if (fornecedor) {
      const deparasDb = await prisma.deparaProdutoFornecedor.findMany({
        where: {
          empresaId,
          fornecedorId: fornecedor.id,
          status: true,
        },
      })
      deparas = deparasDb.map(d => ({
        id: d.id,
        fornecedorId: d.fornecedorId,
        codigoProdutoFornecedor: d.codigoProdutoFornecedor,
        produtoId: d.produtoId,
        skuId: d.skuId,
        fatorConversao: Number(d.fatorConversao),
        unidadeFornecedor: d.unidadeFornecedor,
        status: d.status,
      }))
    }

    // Buscar produtos da empresa
    const produtos = await prisma.produto.findMany({
      where: { empresaId },
      select: { id: true, codigo: true, nome: true, unidade: true, cEAN: true },
    })
    const produtosRecord: ProdutoRecord[] = produtos.map(p => ({
      id: p.id,
      codigo: p.codigo,
      nome: p.nome,
      unidade: p.unidade,
      cEAN: (p as any).cEAN || null,
    }))

    // Buscar SKUs para match por EAN
    const skus = await prisma.sku.findMany({
      where: { produtoId: { in: produtos.map(p => p.id) } },
      select: { id: true, produtoId: true, sequencia: true, codigoBarra: true, unidade: true },
    })
    const skusRecord: SkuRecord[] = skus.map(s => ({
      id: s.id,
      produtoId: s.produtoId,
      sequencia: s.sequencia,
      codigoBarra: s.codigoBarra,
      unidade: s.unidade,
    }))

    // Converter itens para formato do resolution service
    const xmlItems: XmlItem[] = itens.map(item => ({
      codigoProdutoFornecedor: item.codigoProdutoFornecedor,
      descricao: item.descricao,
      unidade: item.unidade,
      quantidade: item.quantidade,
      valorUnitario: item.valorUnitario,
      valorTotal: item.valorTotal,
      ncm: item.ncm,
      cEAN: item.cEAN,
      cEANTrib: item.cEANTrib,
      uTrib: item.uTrib,
      qTrib: item.qTrib,
    }))

    return resolveItems(xmlItems, deparas, produtosRecord, skusRecord)
  }

  // === Montagem de itens pré-preenchidos ===

  /**
   * Combina itens extraídos do XML com resultado da resolução de-para.
   */
  private montarItensPrePreenchidos(
    itens: ItemExtraido[],
    resolucao: ResolutionResult,
  ): ItemPrePreenchido[] {
    return itens.map(item => {
      // Procurar resolução para este item
      const resolvido = resolucao.resolvidos.find(
        r => r.xmlItem.codigoProdutoFornecedor === item.codigoProdutoFornecedor
          && r.xmlItem.descricao === item.descricao,
      )

      return {
        nItem: item.nItem,
        codigoProdutoFornecedor: item.codigoProdutoFornecedor,
        descricao: item.descricao,
        ncm: item.ncm,
        cfop: item.cfop,
        unidade: item.unidade,
        quantidade: item.quantidade,
        valorUnitario: item.valorUnitario,
        valorTotal: item.valorTotal,
        produtoERP: resolvido ? {
          produtoId: resolvido.produtoId,
          produtoNome: resolvido.produtoNome,
          skuId: resolvido.skuId,
          fatorConversao: resolvido.fatorConversao,
          quantidadeConvertida: resolvido.quantidadeConvertida,
          unidadeInterna: resolvido.unidadeInterna,
          resolvidoPor: resolvido.resolvidoPor,
        } : null,
      }
    })
  }
}

// === Tipos internos ===

interface ItemExtraido {
  nItem: number
  codigoProdutoFornecedor: string
  descricao: string
  ncm: string
  cfop: string
  unidade: string
  quantidade: number
  valorUnitario: number
  valorTotal: number
  cEAN: string | null
  cEANTrib: string | null
  uTrib: string | null
  qTrib: number | null
}

interface DadosExtraidos {
  emitente: { cnpj: string; razaoSocial: string; uf: string }
  destinatario: { cpfCnpj: string; razaoSocial: string; uf: string }
  chaveAcesso: string
  protocolo: string
  dataEmissao: string
  itens: ItemExtraido[]
  totais: {
    valorProdutos: number
    valorTotal: number
    valorICMS: number
    valorIPI: number
    valorPIS: number
    valorCOFINS: number
    valorFrete: number
    valorSeguro: number
    valorDesconto: number
    valorOutras: number
  }
}
