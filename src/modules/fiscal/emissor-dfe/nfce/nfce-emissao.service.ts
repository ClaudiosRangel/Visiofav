/**
 * Serviço de Emissão de NFC-e (modelo 65)
 * Emissão rápida (≤5s), contingência offline automática (>5s sem resposta SEFAZ)
 *
 * Diferenças em relação à NF-e:
 * - Timeout de 5s (vs 30s da NF-e)
 * - Contingência tpEmis=9 ativada automaticamente se SEFAZ não responder em 5s
 * - Usa buildNFCeXml (modelo 65) em vez de buildNFeXml
 * - DocumentoFiscal tipo='NFCE', modelo=65
 * - Requer cscId e cscToken da empresa (campos cscIdNfce/cscTokenNfce) para QRCode
 *
 * Requirements: 5.8, 5.10
 */

import { prisma } from '../../../../lib/prisma'
import { CodigoErroFiscal, ErroFiscal } from '../../erros'
import { preencherCamposTributarios } from '../../motor-tributario/preenchimento-tributario'
import { RegimeTributario } from '../../motor-tributario/tipos'
import { buildNFCeXml, type DadosNFCe } from './nfce-xml-builder'
import { type DadosItemNFe } from '../nfe/nfe-xml-builder'
import { validarXML } from '../xml/xml-validator'
import { assinarXML } from '../xml/xml-signer'
import { criarSefazClient, type SefazUrlResolver } from '../sefaz/sefaz-client'
import { obterUrlWebservice } from '../sefaz/sefaz-urls'
import {
  AmbienteSefaz,
  ServicoSefaz,
  type SefazConfig,
  type RespostaSefaz,
} from '../sefaz/tipos'
import {
  certificadoService,
  type CertificadoParaUso,
} from '../../certificado/certificado.service'
import { type StatusDocumento } from '../tipos'

// === Tipos ===

export interface EmissaoNFCeParams {
  /** ID da empresa emitente */
  empresaId: string
  /**
   * Dados completos da NFC-e para emissão.
   * Os campos cscId e cscToken são opcionais aqui — o serviço os lê
   * automaticamente da empresa (campos cscIdNfce / cscTokenNfce).
   * Se fornecidos, têm precedência sobre os dados da empresa.
   */
  dadosNFCe: Omit<DadosNFCe, 'cscId' | 'cscToken'> & { cscId?: string; cscToken?: string }
  /** Forçar contingência offline (tpEmis=9) */
  forcarContingencia?: boolean
}

export interface EmissaoNFCeResult {
  sucesso: boolean
  status: StatusDocumento
  documentoFiscalId: string
  protocolo?: string
  chaveAcesso?: string
  xmlAutorizado?: string
  codigoRejeicao?: number
  motivoRejeicao?: string
  contingencia?: boolean
}

/** Alias para compatibilidade */
export type { EmissaoNFCeResult as EmissaoNFeResult }

// === Constantes ===

/**
 * Timeout máximo para comunicação com a SEFAZ na NFC-e.
 * Se ultrapassado, contingência offline (tpEmis=9) é ativada automaticamente.
 */
const NFCE_TIMEOUT_MS = 5000

/** Código de status SEFAZ para autorização */
const CSTAT_AUTORIZADO = 100

/** Código de status SEFAZ para lote em processamento */
const CSTAT_LOTE_PROCESSADO = 104

// === Serviço ===

export class NFCeEmissaoService {
  /**
   * Emite uma NFC-e executando o fluxo completo:
   * 1. Ler CSC (cscId/cscToken) da empresa — lança ErroFiscal se não cadastrado
   * 2. Calcular tributos (motor tributário)
   * 3. Gerar XML (NFC-e layout 4.00, modelo 65)
   * 4. Validar XML contra schema XSD
   * 5. Assinar digitalmente com certificado A1
   * 6. Transmitir à SEFAZ (timeout de 5s)
   * 7. Se timeout/indisponível → ativar contingência offline (tpEmis=9) e retransmitir
   * 8. Processar resposta (autorização ou rejeição)
   *
   * Requirements: 5.8, 5.10
   */
  async emitir(params: EmissaoNFCeParams): Promise<EmissaoNFCeResult> {
    const { empresaId, dadosNFCe, forcarContingencia } = params
    const cnpjEmitente = dadosNFCe.emitente.cnpj
    const ufEmitente = dadosNFCe.emitente.uf

    // 1. Ler CSC da empresa (obrigatório para NFC-e)
    const { cscId, cscToken } = await this.obterCscEmpresa(empresaId, dadosNFCe)

    // Verificar se deve entrar em contingência imediatamente
    const emContingencia = forcarContingencia ?? false

    // 2. Calcular tributos nos itens
    const itensComTributos = await this.calcularTributosItens(dadosNFCe, empresaId)

    // Montar dados completos com CSC e tributos calculados
    const dadosCompletos: DadosNFCe = {
      ...(dadosNFCe as DadosNFCe),
      itens: itensComTributos,
      cscId,
      cscToken,
      tpEmis: emContingencia ? 9 : (dadosNFCe.tpEmis ?? 1),
    }

    // 3. Obter certificado para assinar
    const certificado = await certificadoService.obterParaAssinatura(cnpjEmitente, empresaId)

    if (emContingencia) {
      return this.emitirContingencia(dadosCompletos, empresaId, ufEmitente, certificado)
    }

    // 4. Gerar XML em modo normal (tpEmis=1)
    const xmlGerado = buildNFCeXml(dadosCompletos)
    const chaveAcesso = this.extrairChaveAcesso(xmlGerado)

    // 5. Validar XML contra schema XSD
    const validacao = validarXML(xmlGerado, 'NFCE')
    if (!validacao.valido) {
      throw new ErroFiscal(
        CodigoErroFiscal.XML_INVALIDO_XSD,
        `Validação XSD falhou: ${validacao.erros.map(e => e.mensagem).join('; ')}`,
        { erros: validacao.erros }
      )
    }

    // 6. Assinar XML
    const { xmlAssinado } = assinarXML({
      xml: xmlGerado,
      pfxBuffer: certificado.pfxBuffer,
      senha: certificado.senha,
      tagParaAssinar: 'infNFe',
    })

    // 7. Criar registro do documento fiscal no banco (status PENDENTE)
    const documentoFiscal = await this.criarDocumentoFiscal(
      dadosCompletos,
      empresaId,
      chaveAcesso,
      xmlAssinado,
    )

    // 8. Transmitir à SEFAZ com timeout de 5s
    try {
      const resposta = await this.transmitirSefaz(xmlAssinado, ufEmitente, certificado)

      // 9. Processar resposta bem-sucedida
      return this.processarRespostaSefaz(resposta, documentoFiscal.id, chaveAcesso, xmlAssinado)
    } catch (err) {
      // Timeout ou SEFAZ indisponível → ativar contingência offline automaticamente
      if (this.isFalhaComunicacao(err as ErroFiscal)) {
        // Reemitir em contingência (tpEmis=9)
        const dadosContingencia: DadosNFCe = { ...dadosCompletos, tpEmis: 9 }
        return this.emitirContingenciaAposTimeout(
          dadosContingencia,
          empresaId,
          ufEmitente,
          certificado,
          documentoFiscal.id,
        )
      }

      throw err
    }
  }

  // === Métodos internos ===

  /**
   * Lê cscId e cscToken da empresa para uso no QRCode da NFC-e.
   * Se o caller já forneceu os campos em dadosNFCe, usa-os (precedência).
   * Caso contrário, lê da empresa no banco.
   * Lança ErroFiscal CAMPOS_OBRIGATORIOS_AUSENTES se não cadastrado.
   */
  private async obterCscEmpresa(
    empresaId: string,
    dadosNFCe: EmissaoNFCeParams['dadosNFCe'],
  ): Promise<{ cscId: string; cscToken: string }> {
    // Se o caller já forneceu os valores, usar diretamente
    if (dadosNFCe.cscId && dadosNFCe.cscToken) {
      return { cscId: dadosNFCe.cscId, cscToken: dadosNFCe.cscToken }
    }

    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { cscIdNfce: true, cscTokenNfce: true },
    })

    if (!empresa?.cscIdNfce || !empresa?.cscTokenNfce) {
      throw new ErroFiscal(
        CodigoErroFiscal.CAMPOS_OBRIGATORIOS_AUSENTES,
        'CSC (Código de Segurança do Contribuinte) não cadastrado para esta empresa. ' +
          'Configure os campos cscIdNfce e cscTokenNfce da empresa antes de emitir NFC-e.',
        { empresaId }
      )
    }

    return { cscId: empresa.cscIdNfce, cscToken: empresa.cscTokenNfce }
  }

  /**
   * Emite NFC-e diretamente em contingência offline (tpEmis=9).
   * Usado quando forcarContingencia=true.
   */
  private async emitirContingencia(
    dadosNFCe: DadosNFCe,
    empresaId: string,
    ufEmitente: string,
    certificado: CertificadoParaUso,
  ): Promise<EmissaoNFCeResult> {
    const dadosContingencia: DadosNFCe = { ...dadosNFCe, tpEmis: 9 }

    const xmlGerado = buildNFCeXml(dadosContingencia)
    const chaveAcesso = this.extrairChaveAcesso(xmlGerado)

    const { xmlAssinado } = assinarXML({
      xml: xmlGerado,
      pfxBuffer: certificado.pfxBuffer,
      senha: certificado.senha,
      tagParaAssinar: 'infNFe',
    })

    const documentoFiscal = await this.criarDocumentoFiscal(
      dadosContingencia,
      empresaId,
      chaveAcesso,
      xmlAssinado,
    )

    await this.enfileirarContingencia(
      empresaId,
      documentoFiscal.id,
      xmlAssinado,
      ufEmitente,
      'OFFLINE',
    )

    return {
      sucesso: false,
      status: 'CONTINGENCIA',
      documentoFiscalId: documentoFiscal.id,
      chaveAcesso,
      contingencia: true,
    }
  }

  /**
   * Reemite NFC-e em contingência offline após timeout de SEFAZ.
   * Atualiza o documento existente criado em modo normal.
   */
  private async emitirContingenciaAposTimeout(
    dadosContingencia: DadosNFCe,
    empresaId: string,
    ufEmitente: string,
    certificado: CertificadoParaUso,
    documentoFiscalId: string,
  ): Promise<EmissaoNFCeResult> {
    // Regerar XML com tpEmis=9
    const xmlContingencia = buildNFCeXml(dadosContingencia)
    const chaveAcessoContingencia = this.extrairChaveAcesso(xmlContingencia)

    const { xmlAssinado } = assinarXML({
      xml: xmlContingencia,
      pfxBuffer: certificado.pfxBuffer,
      senha: certificado.senha,
      tagParaAssinar: 'infNFe',
    })

    // Atualizar documento existente com chave de contingência
    await prisma.documentoFiscal.update({
      where: { id: documentoFiscalId },
      data: {
        status: 'CONTINGENCIA',
        chaveAcesso: chaveAcessoContingencia,
        xmlEnviado: xmlAssinado,
        contingencia: true,
        tipoContingencia: 'OFFLINE',
      },
    })

    await this.enfileirarContingencia(
      empresaId,
      documentoFiscalId,
      xmlAssinado,
      ufEmitente,
      'OFFLINE',
    )

    return {
      sucesso: false,
      status: 'CONTINGENCIA',
      documentoFiscalId,
      chaveAcesso: chaveAcessoContingencia,
      contingencia: true,
    }
  }

  /**
   * Calcula tributos para cada item da NFC-e usando o motor tributário.
   */
  private async calcularTributosItens(
    dadosNFCe: EmissaoNFCeParams['dadosNFCe'],
    empresaId: string,
  ): Promise<DadosItemNFe[]> {
    const regimeTributario = this.crtToRegimeTributario(dadosNFCe.emitente.crt)
    const ufOrigem = dadosNFCe.emitente.endereco.uf
    // NFC-e é sempre operação interna (consumidor no mesmo estado)
    const ufDestino = dadosNFCe.destinatario?.endereco?.uf || ufOrigem

    const itensComTributos: DadosItemNFe[] = []

    for (const item of dadosNFCe.itens) {
      // Se o item já possui tributos preenchidos manualmente, respeitar
      if (item.icms && item.pis && item.cofins) {
        itensComTributos.push(item)
        continue
      }

      const preenchido = await preencherCamposTributarios({
        ncm: item.ncm,
        cfop: item.cfop,
        ufOrigem,
        ufDestino,
        regimeTributario,
        empresaId,
        valorProduto: item.valorTotal,
        valorFrete: 0,
        valorSeguro: 0,
        valorOutras: 0,
        valorDesconto: item.valorDesconto || 0,
        quantidade: item.quantidade,
      })

      const itemComTributos: DadosItemNFe = {
        ...item,
        icms: {
          origem: 0,
          cst: preenchido.icmsCst || preenchido.icmsCsosn || '00',
          baseCalculo: preenchido.icmsBase,
          aliquota: preenchido.icmsAliquota,
          valor: preenchido.icmsValor,
        },
        pis: {
          cst: preenchido.pisCst,
          baseCalculo: preenchido.pisBase,
          aliquota: preenchido.pisAliquota,
          valor: preenchido.pisValor,
        },
        cofins: {
          cst: preenchido.cofinsCst,
          baseCalculo: preenchido.cofinsBase,
          aliquota: preenchido.cofinsAliquota,
          valor: preenchido.cofinsValor,
        },
        // NFC-e normalmente não inclui IPI (PDV/varejo), mas manter compatibilidade
        ipi: preenchido.ipiCst
          ? {
              cst: preenchido.ipiCst,
              baseCalculo: preenchido.ipiBase,
              aliquota: preenchido.ipiAliquota,
              valor: preenchido.ipiValor,
            }
          : undefined,
      }

      itensComTributos.push(itemComTributos)
    }

    return itensComTributos
  }

  /**
   * Transmite XML assinado à SEFAZ com timeout de 5s.
   * Se a SEFAZ não responder em 5s, lança ErroFiscal SEFAZ_TIMEOUT.
   */
  private async transmitirSefaz(
    xmlAssinado: string,
    ufEmitente: string,
    certificado: CertificadoParaUso,
  ): Promise<RespostaSefaz> {
    const ambiente = this.obterAmbiente()

    const sefazConfig: SefazConfig = {
      ambiente,
      uf: ufEmitente,
      timeoutMs: NFCE_TIMEOUT_MS,
      maxRetentativas: 1, // NFC-e: sem retentativas, vai direto para contingência
      intervaloRetentativaMs: 0,
      certificadoPfx: certificado.pfxBuffer,
      certificadoSenha: certificado.senha,
    }

    const urlResolver: SefazUrlResolver = {
      resolverUrl: (uf: string, servico: ServicoSefaz, amb: number) => {
        return obterUrlWebservice(uf, servico, amb as AmbienteSefaz)
      },
    }

    const client = criarSefazClient(sefazConfig, urlResolver)
    return client.transmitir(xmlAssinado, ServicoSefaz.AUTORIZACAO)
  }

  /**
   * Processa a resposta da SEFAZ:
   * - cStat=100 ou 104: armazena XML autorizado com protocolo
   * - Outros cStat (rejeição): armazena código e motivo
   */
  private async processarRespostaSefaz(
    resposta: RespostaSefaz,
    documentoFiscalId: string,
    chaveAcesso: string,
    xmlAssinado: string,
  ): Promise<EmissaoNFCeResult> {
    const cStat = resposta.codigoStatus

    // Autorizado (cStat = 100 ou 104)
    if (cStat === CSTAT_AUTORIZADO || cStat === CSTAT_LOTE_PROCESSADO) {
      const xmlAutorizado = this.montarXmlAutorizado(xmlAssinado, resposta)

      await prisma.documentoFiscal.update({
        where: { id: documentoFiscalId },
        data: {
          status: 'AUTORIZADO',
          xmlAutorizado,
          xmlRetorno: resposta.xmlRetorno,
          protocolo: resposta.protocolo,
          dataAutorizacao: resposta.dataRecebimento
            ? new Date(resposta.dataRecebimento)
            : new Date(),
        },
      })

      return {
        sucesso: true,
        status: 'AUTORIZADO',
        documentoFiscalId,
        protocolo: resposta.protocolo,
        chaveAcesso,
        xmlAutorizado,
      }
    }

    // Rejeição
    await prisma.documentoFiscal.update({
      where: { id: documentoFiscalId },
      data: {
        status: 'REJEITADO',
        xmlRetorno: resposta.xmlRetorno,
        codigoRejeicao: cStat,
        motivoRejeicao: resposta.motivoStatus,
      },
    })

    return {
      sucesso: false,
      status: 'REJEITADO',
      documentoFiscalId,
      chaveAcesso,
      codigoRejeicao: cStat,
      motivoRejeicao: resposta.motivoStatus,
    }
  }

  /**
   * Cria registro do DocumentoFiscal no banco antes da transmissão.
   * tipo='NFCE', modelo=65
   */
  private async criarDocumentoFiscal(
    dados: DadosNFCe,
    empresaId: string,
    chaveAcesso: string,
    xmlAssinado: string,
  ) {
    let valorProdutos = 0
    let valorIcms = 0
    let valorIcmsSt = 0
    let valorIpi = 0
    let valorPis = 0
    let valorCofins = 0

    for (const item of dados.itens) {
      valorProdutos += item.valorTotal
      if (item.icms) {
        valorIcms += item.icms.valor
        valorIcmsSt += item.icms.valorST || 0
      }
      if (item.ipi) valorIpi += item.ipi.valor
      if (item.pis) valorPis += item.pis.valor
      if (item.cofins) valorCofins += item.cofins.valor
    }

    const valorTotal =
      valorProdutos +
      (dados.valorFrete || 0) +
      (dados.valorSeguro || 0) +
      (dados.valorOutras || 0) +
      valorIcmsSt +
      valorIpi -
      (dados.valorDesconto || 0)

    const documento = await prisma.documentoFiscal.create({
      data: {
        empresaId,
        tipo: 'NFCE',
        modelo: 65,
        serie: dados.serie,
        numero: dados.nNF,
        chaveAcesso,
        status: 'PENDENTE',
        naturezaOp: dados.naturezaOp || 'VENDA',
        dataEmissao: dados.dataEmissao,
        dataSaida: dados.dataSaida,
        tipoOperacao: dados.tipoOperacao,
        finalidade: dados.finalidade,
        emitenteCnpj: dados.emitente.cnpj,
        emitenteRazao: dados.emitente.razaoSocial,
        emitenteUf: dados.emitente.uf,
        destCpfCnpj: dados.destinatario?.cpfCnpj || null,
        destRazao: dados.destinatario?.razaoSocial || null,
        destUf: dados.destinatario?.endereco?.uf || null,
        destIe: dados.destinatario?.ie || null,
        valorProdutos,
        valorFrete: dados.valorFrete || 0,
        valorSeguro: dados.valorSeguro || 0,
        valorDesconto: dados.valorDesconto || 0,
        valorOutras: dados.valorOutras || 0,
        valorTotal,
        valorIcms,
        valorIcmsSt,
        valorIpi,
        valorPis,
        valorCofins,
        xmlEnviado: xmlAssinado,
        ambiente: dados.ambiente,
      },
    })

    return documento
  }

  /**
   * Enfileira documento na fila de contingência.
   */
  private async enfileirarContingencia(
    empresaId: string,
    documentoFiscalId: string,
    xmlAssinado: string,
    ufEmitente: string,
    tipoContingencia: string,
  ): Promise<void> {
    // Verificar limite da fila (500 por empresa)
    const pendentes = await prisma.filaContingencia.count({
      where: { empresaId, status: 'PENDENTE' },
    })

    if (pendentes >= 500) {
      throw new ErroFiscal(
        CodigoErroFiscal.FILA_CONTINGENCIA_CHEIA,
        'Fila de contingência atingiu o limite de 500 documentos pendentes',
        { empresaId, pendentes },
      )
    }

    await prisma.filaContingencia.create({
      data: {
        empresaId,
        documentoFiscalId,
        xmlAssinado,
        tipoContingencia,
        tentativas: 0,
        status: 'PENDENTE',
      },
    })

    // Atualizar status do documento para CONTINGENCIA
    await prisma.documentoFiscal.update({
      where: { id: documentoFiscalId },
      data: {
        status: 'CONTINGENCIA',
        contingencia: true,
        tipoContingencia,
      },
    })
  }

  // === Helpers ===

  /**
   * Verifica se o erro é de comunicação (timeout/indisponibilidade).
   */
  private isFalhaComunicacao(err: ErroFiscal): boolean {
    return (
      err instanceof ErroFiscal &&
      (err.codigo === CodigoErroFiscal.SEFAZ_INDISPONIVEL ||
        err.codigo === CodigoErroFiscal.SEFAZ_TIMEOUT)
    )
  }

  /**
   * Obtém o ambiente de comunicação (Produção ou Homologação).
   */
  private obterAmbiente(): AmbienteSefaz {
    const ambiente = Number(process.env.SEFAZ_AMBIENTE) || 2
    return ambiente === 1 ? AmbienteSefaz.PRODUCAO : AmbienteSefaz.HOMOLOGACAO
  }

  /**
   * Converte CRT para enum RegimeTributario.
   */
  private crtToRegimeTributario(crt: number): RegimeTributario {
    switch (crt) {
      case 1:
        return RegimeTributario.SIMPLES_NACIONAL
      case 2:
        return RegimeTributario.SIMPLES_NACIONAL_EXCESSO
      case 3:
        return RegimeTributario.NORMAL
      default:
        return RegimeTributario.NORMAL
    }
  }

  /**
   * Extrai a chave de acesso de 44 dígitos do XML gerado.
   * Para NFC-e o Id é "NFe<44digitos>" (mesmo prefixo que NF-e).
   */
  private extrairChaveAcesso(xml: string): string {
    const match = xml.match(/Id="NFe(\d{44})"/)
    if (!match) {
      throw new ErroFiscal(
        CodigoErroFiscal.CHAVE_ACESSO_INVALIDA,
        'Não foi possível extrair a chave de acesso do XML NFC-e gerado',
      )
    }
    return match[1]
  }

  /**
   * Monta o XML autorizado (nfeProc) incluindo protocolo de autorização.
   */
  private montarXmlAutorizado(xmlAssinado: string, resposta: RespostaSefaz): string {
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">',
      xmlAssinado.replace('<?xml version="1.0" encoding="UTF-8"?>', '').trim(),
      '<protNFe versao="4.00">',
      '<infProt>',
      `<tpAmb>${this.obterAmbiente()}</tpAmb>`,
      `<verAplic>VisioFab-1.0.0</verAplic>`,
      `<chNFe>${this.extrairChaveDoXml(xmlAssinado)}</chNFe>`,
      resposta.dataRecebimento ? `<dhRecbto>${resposta.dataRecebimento}</dhRecbto>` : '',
      resposta.protocolo ? `<nProt>${resposta.protocolo}</nProt>` : '',
      `<digVal></digVal>`,
      `<cStat>${resposta.codigoStatus}</cStat>`,
      `<xMotivo>${resposta.motivoStatus}</xMotivo>`,
      '</infProt>',
      '</protNFe>',
      '</nfeProc>',
    ]
      .filter(Boolean)
      .join('\n')
  }

  /**
   * Extrai chave de acesso de um XML (assinado ou não).
   */
  private extrairChaveDoXml(xml: string): string {
    const match = xml.match(/Id="NFe(\d{44})"/)
    return match ? match[1] : ''
  }
}

export const nfceEmissaoService = new NFCeEmissaoService()
