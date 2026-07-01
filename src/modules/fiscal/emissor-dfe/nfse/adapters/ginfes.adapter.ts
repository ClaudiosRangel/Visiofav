/**
 * Adapter GINFES (Nota Control / GINFES)
 * Utilizado por cidades como Guarulhos, Campinas, entre outras.
 *
 * Requirements: 5.1, 5.4
 */

import type {
  NfseAdapter,
  DadosNfse,
  NfseRespostaEmissao,
  NfseCancelamentoParams,
  NfseRespostaCancelamento,
  NfseConsultaParams,
  NfseRespostaConsulta,
} from './tipos'

export class GinfesAdapter implements NfseAdapter {
  private readonly urlWebservice: string

  constructor(urlWebservice: string) {
    this.urlWebservice = urlWebservice
  }

  async emitir(
    dados: DadosNfse,
    certificado: { pfxBuffer: Buffer; senha: string },
  ): Promise<NfseRespostaEmissao> {
    const xmlEnvio = this.montarXmlEnvio(dados)

    try {
      const xmlRetorno = await this.transmitirSoap(
        xmlEnvio,
        'RecepcionarLoteRpsV3',
        certificado,
      )

      return this.parsearRespostaEmissao(xmlRetorno)
    } catch (err) {
      return {
        sucesso: false,
        status: 'ERRO',
        erros: [{ codigo: 'COMM_ERROR', mensagem: (err as Error).message }],
      }
    }
  }

  async cancelar(
    params: NfseCancelamentoParams,
    certificado: { pfxBuffer: Buffer; senha: string },
  ): Promise<NfseRespostaCancelamento> {
    const xmlCancelamento = this.montarXmlCancelamento(params)

    try {
      const xmlRetorno = await this.transmitirSoap(
        xmlCancelamento,
        'CancelarNfse',
        certificado,
      )

      return this.parsearRespostaCancelamento(xmlRetorno)
    } catch (err) {
      return {
        sucesso: false,
        erros: [{ codigo: 'COMM_ERROR', mensagem: (err as Error).message }],
      }
    }
  }

  async consultar(
    params: NfseConsultaParams,
    certificado: { pfxBuffer: Buffer; senha: string },
  ): Promise<NfseRespostaConsulta> {
    const xmlConsulta = this.montarXmlConsulta(params)

    try {
      const xmlRetorno = await this.transmitirSoap(
        xmlConsulta,
        'ConsultarSituacaoLoteRpsV3',
        certificado,
      )

      return this.parsearRespostaConsulta(xmlRetorno)
    } catch (err) {
      return {
        sucesso: false,
        erros: [{ codigo: 'COMM_ERROR', mensagem: (err as Error).message }],
      }
    }
  }

  // === Montagem XML (formato GINFES) ===

  private montarXmlEnvio(dados: DadosNfse): string {
    const servico = dados.servico

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<ns3:EnviarLoteRpsEnvio xmlns:ns3="http://www.ginfes.com.br/servico_enviar_lote_rps_envio_v03.xsd" xmlns:ns4="http://www.ginfes.com.br/tipos_v03.xsd">`,
      `  <LoteRps versao="3" Id="lote_${Date.now()}">`,
      `    <ns4:NumeroLote>1</ns4:NumeroLote>`,
      `    <ns4:Cnpj>${dados.prestador.cnpj}</ns4:Cnpj>`,
      `    <ns4:InscricaoMunicipal>${dados.prestador.inscricaoMunicipal}</ns4:InscricaoMunicipal>`,
      `    <ns4:QuantidadeRps>1</ns4:QuantidadeRps>`,
      `    <ns4:ListaRps>`,
      `      <ns4:Rps>`,
      `        <ns4:InfRps Id="rps_${dados.numeroRps || 1}">`,
      `          <ns4:IdentificacaoRps>`,
      `            <ns4:Numero>${dados.numeroRps || 1}</ns4:Numero>`,
      `            <ns4:Serie>${dados.serieRps || 'A'}</ns4:Serie>`,
      `            <ns4:Tipo>${dados.tipoRps || 1}</ns4:Tipo>`,
      `          </ns4:IdentificacaoRps>`,
      `          <ns4:DataEmissao>${dados.dataEmissao.toISOString()}</ns4:DataEmissao>`,
      `          <ns4:NaturezaOperacao>${dados.naturezaOperacao}</ns4:NaturezaOperacao>`,
      `          <ns4:OptanteSimplesNacional>${dados.optanteSimplesNacional ? '1' : '2'}</ns4:OptanteSimplesNacional>`,
      `          <ns4:IncentivadorCultural>${dados.incentivadorCultural ? '1' : '2'}</ns4:IncentivadorCultural>`,
      `          <ns4:Status>1</ns4:Status>`,
      `          <ns4:Servico>`,
      `            <ns4:Valores>`,
      `              <ns4:ValorServicos>${servico.valorServicos.toFixed(2)}</ns4:ValorServicos>`,
      `              <ns4:IssRetido>${servico.issRetido ? '1' : '2'}</ns4:IssRetido>`,
      `              <ns4:ValorIss>${(servico.valorIss || 0).toFixed(2)}</ns4:ValorIss>`,
      `              <ns4:BaseCalculo>${servico.baseCalculo.toFixed(2)}</ns4:BaseCalculo>`,
      `              <ns4:Aliquota>${(servico.aliquotaIss / 100).toFixed(4)}</ns4:Aliquota>`,
      `            </ns4:Valores>`,
      `            <ns4:ItemListaServico>${servico.codigoServico}</ns4:ItemListaServico>`,
      `            <ns4:CodigoTributacaoMunicipio>${servico.codigoTributacao}</ns4:CodigoTributacaoMunicipio>`,
      `            <ns4:Discriminacao>${servico.discriminacao}</ns4:Discriminacao>`,
      `            <ns4:CodigoMunicipio>${servico.codigoMunicipio}</ns4:CodigoMunicipio>`,
      `          </ns4:Servico>`,
      `          <ns4:Prestador>`,
      `            <ns4:Cnpj>${dados.prestador.cnpj}</ns4:Cnpj>`,
      `            <ns4:InscricaoMunicipal>${dados.prestador.inscricaoMunicipal}</ns4:InscricaoMunicipal>`,
      `          </ns4:Prestador>`,
      `          <ns4:Tomador>`,
      `            <ns4:IdentificacaoTomador>`,
      `              <ns4:CpfCnpj>${dados.tomador.cpfCnpj.length === 11 ? `<ns4:Cpf>${dados.tomador.cpfCnpj}</ns4:Cpf>` : `<ns4:Cnpj>${dados.tomador.cpfCnpj}</ns4:Cnpj>`}</ns4:CpfCnpj>`,
      `            </ns4:IdentificacaoTomador>`,
      `            <ns4:RazaoSocial>${dados.tomador.razaoSocial}</ns4:RazaoSocial>`,
      `          </ns4:Tomador>`,
      `        </ns4:InfRps>`,
      `      </ns4:Rps>`,
      `    </ns4:ListaRps>`,
      `  </LoteRps>`,
      `</ns3:EnviarLoteRpsEnvio>`,
    ].join('\n')
  }

  private montarXmlCancelamento(params: NfseCancelamentoParams): string {
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<ns3:CancelarNfseEnvio xmlns:ns3="http://www.ginfes.com.br/servico_cancelar_nfse_envio" xmlns:ns4="http://www.ginfes.com.br/tipos_v03.xsd">`,
      `  <Pedido>`,
      `    <ns4:InfPedidoCancelamento Id="cancel_${params.numeroNfse}">`,
      `      <ns4:IdentificacaoNfse>`,
      `        <ns4:Numero>${params.numeroNfse}</ns4:Numero>`,
      `        <ns4:Cnpj>${params.cnpjPrestador}</ns4:Cnpj>`,
      `        <ns4:InscricaoMunicipal>${params.inscricaoMunicipal}</ns4:InscricaoMunicipal>`,
      `        <ns4:CodigoMunicipio>${params.codigoMunicipio}</ns4:CodigoMunicipio>`,
      `      </ns4:IdentificacaoNfse>`,
      `      <ns4:CodigoCancelamento>${params.codigoCancelamento}</ns4:CodigoCancelamento>`,
      `    </ns4:InfPedidoCancelamento>`,
      `  </Pedido>`,
      `</ns3:CancelarNfseEnvio>`,
    ].join('\n')
  }

  private montarXmlConsulta(params: NfseConsultaParams): string {
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<ns3:ConsultarSituacaoLoteRpsEnvio xmlns:ns3="http://www.ginfes.com.br/servico_consultar_situacao_lote_rps_envio_v03.xsd" xmlns:ns4="http://www.ginfes.com.br/tipos_v03.xsd">`,
      `  <ns4:Prestador>`,
      `    <ns4:Cnpj>${params.cnpjPrestador}</ns4:Cnpj>`,
      `    <ns4:InscricaoMunicipal>${params.inscricaoMunicipal}</ns4:InscricaoMunicipal>`,
      `  </ns4:Prestador>`,
      `</ns3:ConsultarSituacaoLoteRpsEnvio>`,
    ].join('\n')
  }

  // === Comunicação SOAP ===

  private async transmitirSoap(
    xml: string,
    metodo: string,
    certificado: { pfxBuffer: Buffer; senha: string },
  ): Promise<string> {
    const soapEnvelope = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">',
      '  <soapenv:Header/>',
      '  <soapenv:Body>',
      `    <${metodo}>`,
      `      <arg0>${xml.replace('<?xml version="1.0" encoding="UTF-8"?>', '').trim()}</arg0>`,
      `    </${metodo}>`,
      '  </soapenv:Body>',
      '</soapenv:Envelope>',
    ].join('\n')

    const https = await import('https')
    const { URL } = await import('url')

    const url = new URL(this.urlWebservice)

    const options: https.RequestOptions = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': '',
        'Content-Length': Buffer.byteLength(soapEnvelope, 'utf-8'),
      },
      pfx: certificado.pfxBuffer,
      passphrase: certificado.senha,
      rejectUnauthorized: true,
      timeout: 30000,
    }

    return new Promise<string>((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = ''
        res.on('data', (chunk: Buffer) => { data += chunk.toString() })
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data)
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`))
          }
        })
      })

      req.on('error', (err) => reject(err))
      req.on('timeout', () => {
        req.destroy()
        reject(new Error('Timeout ao comunicar com webservice GINFES'))
      })
      req.write(soapEnvelope)
      req.end()
    })
  }

  // === Parsing ===

  private parsearRespostaEmissao(xmlRetorno: string): NfseRespostaEmissao {
    const numeroMatch = xmlRetorno.match(/<ns4:Numero>(\d+)<\/ns4:Numero>/) ||
                        xmlRetorno.match(/<Numero>(\d+)<\/Numero>/)
    const codigoVerificacao = xmlRetorno.match(/<ns4:CodigoVerificacao>(.*?)<\/ns4:CodigoVerificacao>/) ||
                              xmlRetorno.match(/<CodigoVerificacao>(.*?)<\/CodigoVerificacao>/)

    // Verificar erros
    const erroMatch = xmlRetorno.match(/<ns4:MensagemRetorno>([\s\S]*?)<\/ns4:MensagemRetorno>/g) ||
                      xmlRetorno.match(/<MensagemRetorno>([\s\S]*?)<\/MensagemRetorno>/g)

    if (erroMatch && !numeroMatch) {
      const erros = erroMatch.map((m) => {
        const codigo = m.match(/<(?:ns4:)?Codigo>(.*?)<\/(?:ns4:)?Codigo>/)
        const mensagem = m.match(/<(?:ns4:)?Mensagem>(.*?)<\/(?:ns4:)?Mensagem>/)
        return {
          codigo: codigo?.[1] || 'UNKNOWN',
          mensagem: mensagem?.[1] || 'Erro desconhecido',
        }
      })

      return { sucesso: false, status: 'REJEITADA', xmlRetorno, erros }
    }

    return {
      sucesso: !!numeroMatch,
      status: numeroMatch ? 'AUTORIZADA' : 'PENDENTE',
      numeroNfse: numeroMatch?.[1],
      codigoVerificacao: codigoVerificacao?.[1],
      xmlRetorno,
    }
  }

  private parsearRespostaCancelamento(xmlRetorno: string): NfseRespostaCancelamento {
    const sucesso = xmlRetorno.includes('<Sucesso>') || xmlRetorno.includes('<NfseCancelamento>')

    if (!sucesso) {
      return {
        sucesso: false,
        erros: [{ codigo: 'CANCEL_FAIL', mensagem: 'Falha ao cancelar NFS-e no GINFES' }],
      }
    }

    return { sucesso: true, dataCancelamento: new Date() }
  }

  private parsearRespostaConsulta(xmlRetorno: string): NfseRespostaConsulta {
    const numeroMatch = xmlRetorno.match(/<(?:ns4:)?Numero>(\d+)<\/(?:ns4:)?Numero>/)

    if (!numeroMatch) {
      return {
        sucesso: false,
        erros: [{ codigo: 'NOT_FOUND', mensagem: 'NFS-e não encontrada' }],
      }
    }

    return {
      sucesso: true,
      status: 'AUTORIZADA',
      numeroNfse: numeroMatch[1],
      xmlNfse: xmlRetorno,
    }
  }
}
