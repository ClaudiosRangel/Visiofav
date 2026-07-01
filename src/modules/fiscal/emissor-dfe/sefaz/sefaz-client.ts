/**
 * Cliente SOAP genérico para comunicação com webservices da SEFAZ
 * - SOAP 1.2 sobre HTTPS com mTLS via certificado A1
 * - Retry: 3 tentativas com 5s de intervalo
 * - Timeout configurável (padrão 30s, range 5000-120000ms)
 *
 * Requirements: 1.1, 1.4, 30.1
 */

import * as https from 'node:https'
import { XMLParser } from 'fast-xml-parser'
import {
  type SefazClient,
  type SefazConfig,
  type RespostaSefaz,
  type StatusServico,
  type SituacaoDocumento,
  type DocumentoDistribuido,
  ServicoSefaz,
} from './tipos'
import { CodigoErroFiscal, ErroFiscal } from '../../erros'

// === Constantes ===

const SOAP_CONTENT_TYPE = 'application/soap+xml; charset=utf-8'
const MIN_TIMEOUT_MS = 5000
const MAX_TIMEOUT_MS = 120000
const DEFAULT_TIMEOUT_MS = 30000
const DEFAULT_MAX_RETRIES = 3
const DEFAULT_RETRY_INTERVAL_MS = 5000

// === Tipo do resolvedor de URLs (injetável) ===

export interface SefazUrlResolver {
  resolverUrl(
    uf: string,
    servico: ServicoSefaz,
    ambiente: number
  ): string
}

// === Helpers ===

/**
 * Valida e normaliza o timeout dentro do range permitido (5000-120000ms)
 */
function normalizarTimeout(timeoutMs: number): number {
  if (timeoutMs < MIN_TIMEOUT_MS) return MIN_TIMEOUT_MS
  if (timeoutMs > MAX_TIMEOUT_MS) return MAX_TIMEOUT_MS
  return timeoutMs
}

/**
 * Envelopa o XML do payload em um envelope SOAP 1.2
 */
function criarEnvelopeSoap(xmlPayload: string, servico: ServicoSefaz): string {
  const namespace = obterNamespaceServico(servico)
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">',
    '  <soap12:Header/>',
    '  <soap12:Body>',
    `    <nfeDadosMsg xmlns="${namespace}">`,
    `      ${xmlPayload}`,
    '    </nfeDadosMsg>',
    '  </soap12:Body>',
    '</soap12:Envelope>',
  ].join('\n')
}

/**
 * Retorna o namespace do webservice de acordo com o serviço
 */
function obterNamespaceServico(servico: ServicoSefaz): string {
  if (servico === ServicoSefaz.DISTRIBUICAO_DFE) {
    return 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe'
  }
  return 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4'
}

/**
 * Aguarda um intervalo em milissegundos
 */
function aguardar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// === Implementação do Cliente ===

export function criarSefazClient(
  config: SefazConfig,
  urlResolver: SefazUrlResolver
): SefazClient {
  const timeoutMs = normalizarTimeout(config.timeoutMs || DEFAULT_TIMEOUT_MS)
  const maxRetentativas = config.maxRetentativas || DEFAULT_MAX_RETRIES
  const intervaloRetentativaMs = config.intervaloRetentativaMs || DEFAULT_RETRY_INTERVAL_MS

  const xmlParser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    parseTagValue: true,
  })

  /**
   * Cria o agente HTTPS com mTLS (certificado PFX A1)
   */
  function criarHttpsAgent(): https.Agent {
    return new https.Agent({
      pfx: config.certificadoPfx,
      passphrase: config.certificadoSenha,
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
    })
  }

  /**
   * Executa uma requisição HTTPS POST com SOAP 1.2
   */
  function executarRequisicao(url: string, body: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url)
      const agent = criarHttpsAgent()

      const options: https.RequestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        agent,
        timeout: timeoutMs,
        headers: {
          'Content-Type': SOAP_CONTENT_TYPE,
          'Content-Length': Buffer.byteLength(body, 'utf-8'),
        },
      }

      const req = https.request(options, (res) => {
        const chunks: Buffer[] = []

        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk)
        })

        res.on('end', () => {
          const responseBody = Buffer.concat(chunks).toString('utf-8')
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(responseBody)
          } else {
            reject(
              new ErroFiscal(
                CodigoErroFiscal.SEFAZ_REJEICAO,
                `SEFAZ retornou HTTP ${res.statusCode}`,
                { statusCode: res.statusCode, body: responseBody }
              )
            )
          }
        })
      })

      req.on('timeout', () => {
        req.destroy()
        reject(
          new ErroFiscal(
            CodigoErroFiscal.SEFAZ_TIMEOUT,
            `Timeout de ${timeoutMs}ms excedido na comunicação com SEFAZ`,
            { timeoutMs, url }
          )
        )
      })

      req.on('error', (err) => {
        reject(
          new ErroFiscal(
            CodigoErroFiscal.SEFAZ_INDISPONIVEL,
            `Erro de comunicação com SEFAZ: ${err.message}`,
            { url, erro: err.message }
          )
        )
      })

      req.write(body)
      req.end()
    })
  }

  /**
   * Executa requisição com retry (3 tentativas, intervalo de 5s)
   */
  async function executarComRetry(url: string, body: string): Promise<string> {
    let ultimoErro: Error | undefined

    for (let tentativa = 1; tentativa <= maxRetentativas; tentativa++) {
      try {
        return await executarRequisicao(url, body)
      } catch (err) {
        ultimoErro = err as Error

        // Não faz retry para rejeições da SEFAZ (erro de negócio)
        if (
          err instanceof ErroFiscal &&
          err.codigo === CodigoErroFiscal.SEFAZ_REJEICAO
        ) {
          throw err
        }

        // Se não é a última tentativa, aguarda antes de re-tentar
        if (tentativa < maxRetentativas) {
          await aguardar(intervaloRetentativaMs)
        }
      }
    }

    // Todas as tentativas falharam
    throw new ErroFiscal(
      CodigoErroFiscal.SEFAZ_INDISPONIVEL,
      `SEFAZ indisponível após ${maxRetentativas} tentativas`,
      {
        maxRetentativas,
        intervaloMs: intervaloRetentativaMs,
        ultimoErro: ultimoErro?.message,
      }
    )
  }

  /**
   * Extrai o conteúdo do nfeResultMsg da resposta SOAP
   */
  function extrairResultadoSoap(xmlResposta: string): string {
    const parsed = xmlParser.parse(xmlResposta)

    // Navegar pela estrutura SOAP 1.2
    const envelope = parsed?.Envelope || parsed?.['soap:Envelope'] || parsed?.['soap12:Envelope']
    const body = envelope?.Body || envelope?.['soap:Body'] || envelope?.['soap12:Body']

    if (!body) {
      // Tentar verificar se é SOAP Fault
      verificarSoapFault(parsed)
      throw new ErroFiscal(
        CodigoErroFiscal.SEFAZ_REJEICAO,
        'Resposta SOAP sem Body válido',
        { xml: xmlResposta.substring(0, 500) }
      )
    }

    // Extrair nfeResultMsg de qualquer nível dentro do Body
    const resultado = encontrarElemento(body, 'nfeResultMsg') ||
      encontrarElemento(body, 'retEnviNFe') ||
      encontrarElemento(body, 'retConsStatServ') ||
      encontrarElemento(body, 'retConsSitNFe') ||
      encontrarElemento(body, 'retDistDFeInt')

    if (resultado && typeof resultado === 'string') {
      return resultado
    }

    // Se o resultado é um objeto, reconstruir o XML
    if (resultado && typeof resultado === 'object') {
      return xmlResposta
    }

    return xmlResposta
  }

  /**
   * Verifica se a resposta SOAP contém um Fault
   */
  function verificarSoapFault(parsed: Record<string, unknown>): void {
    const envelope = parsed?.Envelope || parsed?.['soap:Envelope'] || parsed?.['soap12:Envelope']
    const body = (envelope as Record<string, unknown>)?.Body ||
      (envelope as Record<string, unknown>)?.['soap:Body'] ||
      (envelope as Record<string, unknown>)?.['soap12:Body']
    const fault = (body as Record<string, unknown>)?.Fault ||
      (body as Record<string, unknown>)?.['soap:Fault'] ||
      (body as Record<string, unknown>)?.['soap12:Fault']

    if (fault) {
      const faultObj = fault as Record<string, unknown>
      const reason = faultObj?.Reason || faultObj?.faultstring || 'SOAP Fault desconhecido'
      throw new ErroFiscal(
        CodigoErroFiscal.SEFAZ_REJEICAO,
        `SOAP Fault: ${typeof reason === 'string' ? reason : JSON.stringify(reason)}`,
        { fault }
      )
    }
  }

  /**
   * Busca recursivamente um elemento pelo nome na estrutura parseada
   */
  function encontrarElemento(obj: unknown, nome: string): unknown {
    if (!obj || typeof obj !== 'object') return undefined

    const record = obj as Record<string, unknown>
    if (nome in record) return record[nome]

    for (const key of Object.keys(record)) {
      const valor = record[key]
      if (valor && typeof valor === 'object') {
        const found = encontrarElemento(valor, nome)
        if (found !== undefined) return found
      }
    }

    return undefined
  }

  /**
   * Parseia a resposta da SEFAZ para RespostaSefaz
   */
  function parsearRespostaSefaz(xmlRetorno: string): RespostaSefaz {
    const parsed = xmlParser.parse(xmlRetorno)

    // Buscar retorno (retEnviNFe, retConsReciNFe, etc.)
    const cStat = encontrarElemento(parsed, 'cStat')
    const xMotivo = encontrarElemento(parsed, 'xMotivo')
    const nProt = encontrarElemento(parsed, 'nProt')
    const dhRecbto = encontrarElemento(parsed, 'dhRecbto')

    const codigoStatus = typeof cStat === 'number' ? cStat :
      typeof cStat === 'string' ? parseInt(cStat, 10) : 0

    return {
      sucesso: codigoStatus === 100 || codigoStatus === 104,
      protocolo: nProt ? String(nProt) : undefined,
      dataRecebimento: dhRecbto ? String(dhRecbto) : undefined,
      codigoStatus,
      motivoStatus: xMotivo ? String(xMotivo) : 'Sem motivo informado',
      xmlRetorno,
    }
  }

  // === Interface SefazClient ===

  async function transmitir(xml: string, servico: ServicoSefaz): Promise<RespostaSefaz> {
    const url = urlResolver.resolverUrl(config.uf, servico, config.ambiente)
    const envelope = criarEnvelopeSoap(xml, servico)

    const xmlResposta = await executarComRetry(url, envelope)
    const xmlResultado = extrairResultadoSoap(xmlResposta)

    return parsearRespostaSefaz(xmlResultado)
  }

  async function consultarStatus(uf: string): Promise<StatusServico> {
    const xmlConsulta = [
      '<consStatServ xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">',
      `  <tpAmb>${config.ambiente}</tpAmb>`,
      '  <cUF>' + obterCodigoUF(uf) + '</cUF>',
      '  <xServ>STATUS</xServ>',
      '</consStatServ>',
    ].join('')

    const url = urlResolver.resolverUrl(uf, ServicoSefaz.STATUS_SERVICO, config.ambiente)
    const envelope = criarEnvelopeSoap(xmlConsulta, ServicoSefaz.STATUS_SERVICO)

    const xmlResposta = await executarComRetry(url, envelope)
    const xmlResultado = extrairResultadoSoap(xmlResposta)
    const parsed = xmlParser.parse(xmlResultado)

    const cStat = encontrarElemento(parsed, 'cStat')
    const xMotivo = encontrarElemento(parsed, 'xMotivo')
    const tMed = encontrarElemento(parsed, 'tMed')

    const codigoStatus = typeof cStat === 'number' ? cStat :
      typeof cStat === 'string' ? parseInt(cStat, 10) : 0

    return {
      disponivel: codigoStatus === 107,
      codigoStatus,
      motivo: xMotivo ? String(xMotivo) : 'Sem motivo',
      tempoMedio: tMed ? Number(tMed) : undefined,
      dataHoraConsulta: new Date(),
    }
  }

  async function consultarProtocolo(chaveAcesso: string): Promise<SituacaoDocumento> {
    const xmlConsulta = [
      '<consSitNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">',
      `  <tpAmb>${config.ambiente}</tpAmb>`,
      '  <xServ>CONSULTAR</xServ>',
      `  <chNFe>${chaveAcesso}</chNFe>`,
      '</consSitNFe>',
    ].join('')

    const uf = obterUFPorChave(chaveAcesso)
    const url = urlResolver.resolverUrl(uf, ServicoSefaz.CONSULTA_PROTOCOLO, config.ambiente)
    const envelope = criarEnvelopeSoap(xmlConsulta, ServicoSefaz.CONSULTA_PROTOCOLO)

    const xmlResposta = await executarComRetry(url, envelope)
    const xmlResultado = extrairResultadoSoap(xmlResposta)
    const parsed = xmlParser.parse(xmlResultado)

    const cStat = encontrarElemento(parsed, 'cStat')
    const xMotivo = encontrarElemento(parsed, 'xMotivo')
    const nProt = encontrarElemento(parsed, 'nProt')
    const dhRecbto = encontrarElemento(parsed, 'dhRecbto')
    const protNFe = encontrarElemento(parsed, 'protNFe')

    const codigoStatus = typeof cStat === 'number' ? cStat :
      typeof cStat === 'string' ? parseInt(cStat, 10) : 0

    return {
      chaveAcesso,
      codigoStatus,
      motivoStatus: xMotivo ? String(xMotivo) : 'Sem motivo',
      protocolo: nProt ? String(nProt) : undefined,
      dataAutorizacao: dhRecbto ? new Date(String(dhRecbto)) : undefined,
      xmlProtocolo: protNFe ? JSON.stringify(protNFe) : undefined,
    }
  }

  async function distribuicaoDFe(cnpj: string, nsu: string): Promise<DocumentoDistribuido[]> {
    const xmlConsulta = [
      '<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">',
      `  <tpAmb>${config.ambiente}</tpAmb>`,
      '  <cUFAutor>' + obterCodigoUF(config.uf) + '</cUFAutor>',
      `  <CNPJ>${cnpj}</CNPJ>`,
      '  <distNSU>',
      `    <ultNSU>${nsu.padStart(15, '0')}</ultNSU>`,
      '  </distNSU>',
      '</distDFeInt>',
    ].join('')

    const url = urlResolver.resolverUrl('AN', ServicoSefaz.DISTRIBUICAO_DFE, config.ambiente)
    const envelope = criarEnvelopeSoap(xmlConsulta, ServicoSefaz.DISTRIBUICAO_DFE)

    const xmlResposta = await executarComRetry(url, envelope)
    const xmlResultado = extrairResultadoSoap(xmlResposta)
    const parsed = xmlParser.parse(xmlResultado)

    const loteDistDFe = encontrarElemento(parsed, 'loteDistDFeInt')
    if (!loteDistDFe) return []

    const docs = encontrarElemento(loteDistDFe, 'docZip')
    if (!docs) return []

    const docArray = Array.isArray(docs) ? docs : [docs]

    return docArray.map((doc: Record<string, unknown>) => ({
      nsu: doc['@_NSU'] ? String(doc['@_NSU']) : '',
      schema: doc['@_schema'] ? String(doc['@_schema']) : '',
      xmlConteudo: typeof doc['#text'] === 'string' ? doc['#text'] : '',
      chaveAcesso: extrairChaveDeSchema(doc),
      cnpjEmitente: undefined,
      tipoDocumento: doc['@_schema'] ? identificarTipoDocumento(String(doc['@_schema'])) : undefined,
    }))
  }

  return {
    transmitir,
    consultarStatus,
    consultarProtocolo,
    distribuicaoDFe,
  }
}

// === Utilitários auxiliares ===

/**
 * Tabela de códigos IBGE por UF
 */
const CODIGOS_UF: Record<string, string> = {
  AC: '12', AL: '27', AP: '16', AM: '13', BA: '29',
  CE: '23', DF: '53', ES: '32', GO: '52', MA: '21',
  MT: '51', MS: '50', MG: '31', PA: '15', PB: '25',
  PR: '41', PE: '26', PI: '22', RJ: '33', RN: '24',
  RS: '43', RO: '11', RR: '14', SC: '42', SP: '35',
  SE: '28', TO: '17', AN: '91',
}

/**
 * Retorna o código IBGE da UF
 */
function obterCodigoUF(uf: string): string {
  const codigo = CODIGOS_UF[uf.toUpperCase()]
  if (!codigo) {
    throw new ErroFiscal(
      CodigoErroFiscal.UF_INVALIDA,
      `UF inválida: ${uf}`,
      { uf }
    )
  }
  return codigo
}

/**
 * Extrai a UF a partir da chave de acesso (posições 0-1 = código UF)
 */
function obterUFPorChave(chaveAcesso: string): string {
  const codigoUf = chaveAcesso.substring(0, 2)
  const uf = Object.entries(CODIGOS_UF).find(([, cod]) => cod === codigoUf)
  if (!uf) {
    throw new ErroFiscal(
      CodigoErroFiscal.CHAVE_ACESSO_INVALIDA,
      `Código UF inválido na chave de acesso: ${codigoUf}`,
      { chaveAcesso }
    )
  }
  return uf[0]
}

/**
 * Tenta extrair a chave de acesso do documento distribuído
 */
function extrairChaveDeSchema(doc: Record<string, unknown>): string | undefined {
  const schema = doc['@_schema'] ? String(doc['@_schema']) : ''
  if (schema.includes('resNFe') || schema.includes('procNFe')) {
    // A chave estará no conteúdo XML decodificado
    return undefined
  }
  return undefined
}

/**
 * Identifica o tipo de documento pelo schema
 */
function identificarTipoDocumento(schema: string): string {
  if (schema.includes('resNFe') || schema.includes('procNFe')) return 'NFE'
  if (schema.includes('resCTe') || schema.includes('procCTe')) return 'CTE'
  if (schema.includes('resEvento') || schema.includes('procEventoNFe')) return 'EVENTO'
  return 'OUTRO'
}

// Exportar helpers para testes
export { normalizarTimeout, criarEnvelopeSoap, obterCodigoUF, obterUFPorChave, CODIGOS_UF }
