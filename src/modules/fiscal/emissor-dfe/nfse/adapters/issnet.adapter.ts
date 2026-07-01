/**
 * Adapter ISS.NET
 * Utilizado por cidades como Curitiba, Joinville, entre outras.
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

export class IssnetAdapter implements NfseAdapter {
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
        'RecepcionarLoteRps',
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
        'ConsultarNfse',
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

  // === Montagem XML (formato ISS.NET) ===

  private montarXmlEnvio(dados: DadosNfse): string {
    const servico = dados.servico

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<GerarNfseEnvio xmlns="http://www.issnetonline.com.br/webserviceabrasf/vsd/servico_enviar_lote_rps_envio.xsd">`,
      `  <Rps>`,
      `    <InfDeclaracaoPrestacaoServico Id="rps_${dados.numeroRps || 1}">`,
      `      <Rps>`,
      `        <IdentificacaoRps>`,
      `          <Numero>${dados.numeroRps || 1}</Numero>`,
      `          <Serie>${dados.serieRps || 'NF'}</Serie>`,
      `          <Tipo>${dados.tipoRps || 1}</Tipo>`,
      `        </IdentificacaoRps>`,
      `        <DataEmissao>${dados.dataEmissao.toISOString().split('T')[0]}</DataEmissao>`,
      `        <Status>1</Status>`,
      `      </Rps>`,
      `      <Competencia>${dados.competencia}</Competencia>`,
      `      <Servico>`,
      `        <Valores>`,
      `          <ValorServicos>${servico.valorServicos.toFixed(2)}</ValorServicos>`,
      `          <IssRetido>${servico.issRetido ? '1' : '2'}</IssRetido>`,
      `          <ValorIss>${(servico.valorIss || 0).toFixed(2)}</ValorIss>`,
      `          <BaseCalculo>${servico.baseCalculo.toFixed(2)}</BaseCalculo>`,
      `          <Aliquota>${(servico.aliquotaIss / 100).toFixed(4)}</Aliquota>`,
      `        </Valores>`,
      `        <ItemListaServico>${servico.codigoServico}</ItemListaServico>`,
      `        <CodigoTributacaoMunicipio>${servico.codigoTributacao}</CodigoTributacaoMunicipio>`,
      `        <Discriminacao>${servico.discriminacao}</Discriminacao>`,
      `        <CodigoMunicipio>${servico.codigoMunicipio}</CodigoMunicipio>`,
      `      </Servico>`,
      `      <Prestador>`,
      `        <CpfCnpj><Cnpj>${dados.prestador.cnpj}</Cnpj></CpfCnpj>`,
      `        <InscricaoMunicipal>${dados.prestador.inscricaoMunicipal}</InscricaoMunicipal>`,
      `      </Prestador>`,
      `      <Tomador>`,
      `        <IdentificacaoTomador>`,
      `          <CpfCnpj>${dados.tomador.cpfCnpj.length === 11 ? `<Cpf>${dados.tomador.cpfCnpj}</Cpf>` : `<Cnpj>${dados.tomador.cpfCnpj}</Cnpj>`}</CpfCnpj>`,
      `        </IdentificacaoTomador>`,
      `        <RazaoSocial>${dados.tomador.razaoSocial}</RazaoSocial>`,
      `      </Tomador>`,
      `      <OptanteSimplesNacional>${dados.optanteSimplesNacional ? '1' : '2'}</OptanteSimplesNacional>`,
      `      <IncentivoFiscal>${dados.incentivadorCultural ? '1' : '2'}</IncentivoFiscal>`,
      `    </InfDeclaracaoPrestacaoServico>`,
      `  </Rps>`,
      `</GerarNfseEnvio>`,
    ].join('\n')
  }

  private montarXmlCancelamento(params: NfseCancelamentoParams): string {
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<CancelarNfseEnvio xmlns="http://www.issnetonline.com.br/webserviceabrasf/vsd/servico_cancelar_nfse_envio.xsd">`,
      `  <Pedido>`,
      `    <InfPedidoCancelamento Id="cancel_${params.numeroNfse}">`,
      `      <IdentificacaoNfse>`,
      `        <Numero>${params.numeroNfse}</Numero>`,
      `        <CpfCnpj><Cnpj>${params.cnpjPrestador}</Cnpj></CpfCnpj>`,
      `        <InscricaoMunicipal>${params.inscricaoMunicipal}</InscricaoMunicipal>`,
      `        <CodigoMunicipio>${params.codigoMunicipio}</CodigoMunicipio>`,
      `      </IdentificacaoNfse>`,
      `      <CodigoCancelamento>${params.codigoCancelamento}</CodigoCancelamento>`,
      `    </InfPedidoCancelamento>`,
      `  </Pedido>`,
      `</CancelarNfseEnvio>`,
    ].join('\n')
  }

  private montarXmlConsulta(params: NfseConsultaParams): string {
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<ConsultarNfseEnvio xmlns="http://www.issnetonline.com.br/webserviceabrasf/vsd/servico_consultar_nfse_envio.xsd">`,
      `  <Prestador>`,
      `    <CpfCnpj><Cnpj>${params.cnpjPrestador}</Cnpj></CpfCnpj>`,
      `    <InscricaoMunicipal>${params.inscricaoMunicipal}</InscricaoMunicipal>`,
      `  </Prestador>`,
      params.numeroNfse ? `  <NumeroNfse>${params.numeroNfse}</NumeroNfse>` : '',
      params.dataInicial ? `  <PeriodoEmissao><DataInicial>${params.dataInicial.toISOString().split('T')[0]}</DataInicial><DataFinal>${(params.dataFinal || params.dataInicial).toISOString().split('T')[0]}</DataFinal></PeriodoEmissao>` : '',
      `</ConsultarNfseEnvio>`,
    ].filter(Boolean).join('\n')
  }

  // === Comunicação SOAP ===

  private async transmitirSoap(
    xml: string,
    metodo: string,
    certificado: { pfxBuffer: Buffer; senha: string },
  ): Promise<string> {
    const soapEnvelope = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:ws="http://www.issnetonline.com.br/webserviceabrasf/vsd">',
      '  <soap:Header/>',
      '  <soap:Body>',
      `    <ws:${metodo}>`,
      `      <ws:xml>${xml.replace('<?xml version="1.0" encoding="UTF-8"?>', '').trim()}</ws:xml>`,
      `    </ws:${metodo}>`,
      '  </soap:Body>',
      '</soap:Envelope>',
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
        'Content-Type': 'application/soap+xml; charset=utf-8',
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
        reject(new Error('Timeout ao comunicar com webservice ISS.NET'))
      })
      req.write(soapEnvelope)
      req.end()
    })
  }

  // === Parsing ===

  private parsearRespostaEmissao(xmlRetorno: string): NfseRespostaEmissao {
    const numeroMatch = xmlRetorno.match(/<Numero>(\d+)<\/Numero>/)
    const codigoVerificacao = xmlRetorno.match(/<CodigoVerificacao>(.*?)<\/CodigoVerificacao>/)

    const erroMatch = xmlRetorno.match(/<MensagemRetorno>([\s\S]*?)<\/MensagemRetorno>/g)
    if (erroMatch && !numeroMatch) {
      const erros = erroMatch.map((m) => {
        const codigo = m.match(/<Codigo>(.*?)<\/Codigo>/)
        const mensagem = m.match(/<Mensagem>(.*?)<\/Mensagem>/)
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
    const sucesso = xmlRetorno.includes('<NfseCancelamento>') ||
                    xmlRetorno.includes('<Sucesso>')

    if (!sucesso) {
      return {
        sucesso: false,
        erros: [{ codigo: 'CANCEL_FAIL', mensagem: 'Falha ao cancelar NFS-e no ISS.NET' }],
      }
    }

    return { sucesso: true, dataCancelamento: new Date() }
  }

  private parsearRespostaConsulta(xmlRetorno: string): NfseRespostaConsulta {
    const numeroMatch = xmlRetorno.match(/<Numero>(\d+)<\/Numero>/)

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
