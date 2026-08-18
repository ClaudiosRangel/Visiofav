/**
 * Comunicação SOAP com SEFAZ para CT-e (versão 4.00 — envio síncrono)
 *
 * Utiliza a mesma infraestrutura do módulo fiscal:
 *   - criarSefazClient: cliente SOAP com mTLS e retentativas
 *   - obterUrlWebserviceCTe: resolve URLs do SVRS (autorizador nacional)
 *   - ServicoSefaz.CTE_AUTORIZACAO / CTE_RECEPCAO_EVENTO
 *
 * O CT-e 4.00 é transmitido em modo SÍNCRONO (sem lote):
 *   - Envia XML assinado → recebe protocolo de autorização na mesma resposta
 *   - Não usa retorno de recibo (CTeRetRecepcao) como era na 3.00
 *
 * Referências:
 *   - MOC CT-e 4.00 (WebService CTeRecepcaoSincV4)
 *   - NT 2023.001 (envio síncrono obrigatório)
 */

import { criarSefazClient, type SefazUrlResolver } from '../fiscal/emissor-dfe/sefaz/sefaz-client'
import { obterUrlWebserviceCTe } from '../fiscal/emissor-dfe/sefaz/sefaz-urls'
import {
  AmbienteSefaz,
  ServicoSefaz,
  type SefazConfig,
  type RespostaSefaz,
} from '../fiscal/emissor-dfe/sefaz/tipos'
import { certificadoService, type CertificadoParaUso } from '../fiscal/certificado/certificado.service'

// ─── Interface de retorno ────────────────────────────────────────────────────

export interface RespostaSefazCTe {
  sucesso: boolean
  protocolo?: string
  dataRecebimento?: string
  codigoStatus?: number
  motivoStatus?: string
  xmlRetorno?: string
  /** XML completo autorizado (cteProc = CTe + protCTe) — montado no sucesso */
  xmlAutorizado?: string
}

// ─── Parâmetros para as funções de comunicação ───────────────────────────────

export interface ParametrosEnvioCTe {
  xmlAssinado: string
  ambiente: number         // 1=produção, 2=homologação
  ufEmitente: string       // sigla UF do emitente (para resolver URL)
  cnpjEmitente: string     // CNPJ do emitente (para buscar certificado)
  empresaId: string        // ID da empresa (para buscar certificado)
  /** Certificado pré-obtido (opcional — se não informado, busca do banco) */
  certificado?: CertificadoParaUso
}

export interface ParametrosCancelamentoCTe {
  chaveAcesso: string
  protocolo: string
  justificativa: string
  ambiente: number
  ufEmitente: string
  cnpjEmitente: string
  empresaId: string
  certificado?: CertificadoParaUso
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ambienteParaEnum(ambiente: number): AmbienteSefaz {
  return ambiente === 1 ? AmbienteSefaz.PRODUCAO : AmbienteSefaz.HOMOLOGACAO
}

/**
 * Cria o SefazClient configurado para CT-e
 */
function criarClienteCTe(certificado: CertificadoParaUso, uf: string, ambiente: AmbienteSefaz): ReturnType<typeof criarSefazClient> {
  const sefazConfig: SefazConfig = {
    ambiente,
    uf,
    timeoutMs: Number(process.env.SEFAZ_TIMEOUT_MS) || 30000,
    maxRetentativas: 3,
    intervaloRetentativaMs: 5000,
    certificadoPfx: certificado.pfxBuffer,
    certificadoSenha: certificado.senha,
  }

  const urlResolver: SefazUrlResolver = {
    resolverUrl: (_uf: string, svc: ServicoSefaz, _amb: number) => {
      return obterUrlWebserviceCTe(svc, ambiente)
    },
  }

  return criarSefazClient(sefazConfig, urlResolver)
}

/**
 * Extrai cStat, xMotivo, nProt, dhRecbto e digVal de uma resposta de protocolo CT-e
 */
function extrairProtocolo(resposta: RespostaSefaz): {
  cStat: number
  xMotivo: string
  nProt?: string
  dhRecbto?: string
  digVal?: string
} {
  // A resposta parseada fica em resposta.dados (xml-parser -> objeto)
  const dados = resposta.dados as Record<string, any> | undefined

  // Navegar na estrutura: cteProc → protCTe → infProt OU retorno direto infProt
  const infProt = dados?.cteProc?.protCTe?.infProt
    ?? dados?.protCTe?.infProt
    ?? dados?.retCTe?.protCTe?.infProt
    ?? dados?.retCTe?.infProt
    ?? dados?.infProt
    ?? {}

  return {
    cStat: Number(infProt.cStat ?? resposta.cStat ?? 999),
    xMotivo: String(infProt.xMotivo ?? resposta.xMotivo ?? 'Resposta não identificada'),
    nProt: infProt.nProt ? String(infProt.nProt) : undefined,
    dhRecbto: infProt.dhRecbto ? String(infProt.dhRecbto) : undefined,
    digVal: infProt.digVal ? String(infProt.digVal) : undefined,
  }
}

/**
 * Monta o cteProc (XML autorizado = CTe + protCTe) para armazenamento
 */
function montarCteProc(xmlAssinado: string, xmlProtocolo: string): string {
  // Extrair só o <CTe>...</CTe> do XML assinado (remover <?xml ...?>)
  const cteMatch = xmlAssinado.match(/<CTe[\s\S]*<\/CTe>/)
  const cteXml = cteMatch ? cteMatch[0] : xmlAssinado

  return `<?xml version="1.0" encoding="UTF-8"?>`
    + `<cteProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/cte">`
    + cteXml
    + xmlProtocolo
    + `</cteProc>`
}

// ─── Funções públicas ────────────────────────────────────────────────────────

/**
 * Transmite um CT-e assinado para a SEFAZ (envio síncrono, versão 4.00).
 *
 * Em **homologação sem certificado cadastrado**: simula resposta de sucesso
 * (para permitir desenvolvimento/testes sem certificado A1 real).
 *
 * Em **produção**: exige certificado e faz comunicação real via HTTPS/mTLS.
 */
export async function enviarCTe(params: ParametrosEnvioCTe): Promise<RespostaSefazCTe> {
  const { xmlAssinado, ambiente, ufEmitente, cnpjEmitente, empresaId } = params
  const ambienteEnum = ambienteParaEnum(ambiente)

  // ── Obter certificado ───────────────────────────────────────────────────
  let certificado: CertificadoParaUso | undefined = params.certificado
  if (!certificado) {
    try {
      certificado = await certificadoService.obterParaAssinatura(cnpjEmitente, empresaId)
    } catch {
      // Sem certificado
      if (ambienteEnum === AmbienteSefaz.HOMOLOGACAO) {
        // Simulação em homologação
        return simularAutorizacao(xmlAssinado)
      }
      return {
        sucesso: false,
        codigoStatus: 999,
        motivoStatus: 'Certificado digital não encontrado. Necessário para transmissão em produção.',
      }
    }
  }

  // ── Transmitir via WebService SEFAZ ─────────────────────────────────────
  try {
    const client = criarClienteCTe(certificado, ufEmitente, ambienteEnum)
    const resposta: RespostaSefaz = await client.transmitir(xmlAssinado, ServicoSefaz.CTE_AUTORIZACAO)

    const proto = extrairProtocolo(resposta)

    // cStat 100 = Autorizado o uso do CT-e
    if (proto.cStat === 100) {
      // Montar XML autorizado (cteProc)
      const xmlProtocolo = resposta.xmlRetorno || ''
      const xmlAutorizado = montarCteProc(xmlAssinado, xmlProtocolo)

      return {
        sucesso: true,
        protocolo: proto.nProt,
        dataRecebimento: proto.dhRecbto,
        codigoStatus: proto.cStat,
        motivoStatus: proto.xMotivo,
        xmlRetorno: resposta.xmlRetorno,
        xmlAutorizado,
      }
    }

    // Qualquer outro cStat é rejeição/denegação
    return {
      sucesso: false,
      protocolo: proto.nProt,
      dataRecebimento: proto.dhRecbto,
      codigoStatus: proto.cStat,
      motivoStatus: proto.xMotivo,
      xmlRetorno: resposta.xmlRetorno,
    }
  } catch (err: any) {
    // Erro de comunicação (timeout, DNS, TLS, etc.)
    return {
      sucesso: false,
      codigoStatus: 999,
      motivoStatus: err.message || 'Erro de comunicação com a SEFAZ',
      xmlRetorno: err.detalhes?.body || undefined,
    }
  }
}

/**
 * Envia evento de cancelamento de CT-e para a SEFAZ.
 *
 * Monta o XML do evento (tpEvento=110111), assina com tag infEvento
 * e transmite via CTeRecepcaoEventoV4.
 */
export async function cancelarCTeSefaz(params: ParametrosCancelamentoCTe): Promise<RespostaSefazCTe> {
  const { chaveAcesso, protocolo, justificativa, ambiente, ufEmitente, cnpjEmitente, empresaId } = params
  const ambienteEnum = ambienteParaEnum(ambiente)

  // ── Obter certificado ───────────────────────────────────────────────────
  let certificado: CertificadoParaUso | undefined = params.certificado
  if (!certificado) {
    try {
      certificado = await certificadoService.obterParaAssinatura(cnpjEmitente, empresaId)
    } catch {
      if (ambienteEnum === AmbienteSefaz.HOMOLOGACAO) {
        return simularCancelamento()
      }
      return {
        sucesso: false,
        codigoStatus: 999,
        motivoStatus: 'Certificado digital não encontrado. Necessário para cancelamento em produção.',
      }
    }
  }

  // ── Montar XML do evento de cancelamento ────────────────────────────────
  const tpEvento = '110111'  // Cancelamento
  const nSeqEvento = '1'
  const dhEvento = new Date().toISOString().replace('Z', '-03:00')
  const idEvento = `ID${tpEvento}${chaveAcesso}${nSeqEvento.padStart(2, '0')}`
  const cnpjLimpo = cnpjEmitente.replace(/\D/g, '')
  const cOrgao = chaveAcesso.substring(0, 2) // cUF

  const xmlEvento = `<?xml version="1.0" encoding="UTF-8"?>`
    + `<eventoCTe versao="4.00" xmlns="http://www.portalfiscal.inf.br/cte">`
    + `<infEvento Id="${idEvento}">`
    + `<cOrgao>${cOrgao}</cOrgao>`
    + `<tpAmb>${ambiente}</tpAmb>`
    + `<CNPJ>${cnpjLimpo}</CNPJ>`
    + `<chCTe>${chaveAcesso}</chCTe>`
    + `<dhEvento>${dhEvento}</dhEvento>`
    + `<tpEvento>${tpEvento}</tpEvento>`
    + `<nSeqEvento>${nSeqEvento}</nSeqEvento>`
    + `<detEvento versaoEvento="4.00">`
    + `<evCancCTe>`
    + `<descEvento>Cancelamento</descEvento>`
    + `<nProt>${protocolo}</nProt>`
    + `<xJust>${justificativa}</xJust>`
    + `</evCancCTe>`
    + `</detEvento>`
    + `</infEvento>`
    + `</eventoCTe>`

  // ── Assinar evento ──────────────────────────────────────────────────────
  let xmlAssinado: string
  try {
    const { assinarXML } = await import('../fiscal/emissor-dfe/xml/xml-signer')
    const resultado = assinarXML({
      xml: xmlEvento,
      pfxBuffer: certificado.pfxBuffer,
      senha: certificado.senha,
      tagParaAssinar: 'infEvento',
    })
    xmlAssinado = resultado.xmlAssinado
  } catch (err: any) {
    return {
      sucesso: false,
      codigoStatus: 999,
      motivoStatus: `Erro ao assinar evento de cancelamento: ${err.message}`,
    }
  }

  // ── Transmitir evento ───────────────────────────────────────────────────
  try {
    const client = criarClienteCTe(certificado, ufEmitente, ambienteEnum)
    const resposta = await client.transmitir(xmlAssinado, ServicoSefaz.CTE_RECEPCAO_EVENTO)

    // Extrair resultado do evento
    const dados = resposta.dados as Record<string, any> | undefined
    const infEvento = dados?.retEventoCTe?.infEvento
      ?? dados?.infEvento
      ?? {}

    const cStat = Number(infEvento.cStat ?? resposta.cStat ?? 999)
    const xMotivo = String(infEvento.xMotivo ?? resposta.xMotivo ?? 'Resposta não identificada')
    const nProt = infEvento.nProt ? String(infEvento.nProt) : undefined

    // cStat 135 = Evento registrado e vinculado ao CT-e
    // cStat 155 = Cancelamento homologado fora de prazo
    const sucesso = cStat === 135 || cStat === 155

    return {
      sucesso,
      protocolo: nProt,
      dataRecebimento: infEvento.dhRegEvento ? String(infEvento.dhRegEvento) : undefined,
      codigoStatus: cStat,
      motivoStatus: xMotivo,
      xmlRetorno: resposta.xmlRetorno,
    }
  } catch (err: any) {
    return {
      sucesso: false,
      codigoStatus: 999,
      motivoStatus: err.message || 'Erro de comunicação com a SEFAZ ao cancelar CT-e',
    }
  }
}

// ─── Simulação (homologação sem certificado) ─────────────────────────────────

function simularAutorizacao(xmlAssinado: string): RespostaSefazCTe {
  const protocolo = `HOM${Date.now()}`
  const dhRecbto = new Date().toISOString().replace('Z', '-03:00')
  const xmlProtocolo = `<protCTe versao="4.00" xmlns="http://www.portalfiscal.inf.br/cte">`
    + `<infProt>`
    + `<tpAmb>2</tpAmb>`
    + `<verAplic>VisioFab-HOM</verAplic>`
    + `<chCTe>${extrairChaveDaTag(xmlAssinado)}</chCTe>`
    + `<dhRecbto>${dhRecbto}</dhRecbto>`
    + `<nProt>${protocolo}</nProt>`
    + `<digVal>SIMULACAO</digVal>`
    + `<cStat>100</cStat>`
    + `<xMotivo>Autorizado o uso do CT-e</xMotivo>`
    + `</infProt>`
    + `</protCTe>`

  return {
    sucesso: true,
    protocolo,
    dataRecebimento: dhRecbto,
    codigoStatus: 100,
    motivoStatus: 'Autorizado o uso do CT-e (simulação homologação)',
    xmlRetorno: xmlProtocolo,
    xmlAutorizado: montarCteProc(xmlAssinado, xmlProtocolo),
  }
}

function simularCancelamento(): RespostaSefazCTe {
  return {
    sucesso: true,
    protocolo: `HOM${Date.now()}`,
    dataRecebimento: new Date().toISOString().replace('Z', '-03:00'),
    codigoStatus: 135,
    motivoStatus: 'Evento registrado e vinculado ao CT-e (simulação homologação)',
  }
}

function extrairChaveDaTag(xml: string): string {
  const match = xml.match(/Id="CTe(\d{44})"/)
  return match ? match[1] : '00000000000000000000000000000000000000000000'
}
