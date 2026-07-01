/**
 * Adapter ABRASF (Associação Brasileira das Secretarias de Finanças)
 * Padrão mais comum entre prefeituras brasileiras.
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

export class AbrasfAdapter implements NfseAdapter {
  private readonly urlWebservice: string
  private readonly versao: string

  constructor(urlWebservice: string, versao = '2.04') {
    this.urlWebservice = urlWebservice
    this.versao = versao
  }

  async emitir(
    dados: DadosNfse,
    certificado: { pfxBuffer: Buffer; senha: string },
  ): Promise<NfseRespostaEmissao> {
    const xmlEnvio = this.montarXmlEnvioLoteRps(dados)

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
        'ConsultarNfsePorRps',
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

  // === Montagem de XML ===

  private montarXmlEnvioLoteRps(dados: DadosNfse): string {
    const rps = this.montarRps(dados)

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<EnviarLoteRpsEnvio xmlns="http://www.abrasf.org.br/nfse.xsd">`,
      `  <LoteRps Id="lote_${Date.now()}" versao="${this.versao}">`,
      `    <NumeroLote>1</NumeroLote>`,
      `    <Cnpj>${dados.prestador.cnpj}</Cnpj>`,
      `    <InscricaoMunicipal>${dados.prestador.inscricaoMunicipal}</InscricaoMunicipal>`,
      `    <QuantidadeRps>1</QuantidadeRps>`,
      `    <ListaRps>`,
      rps,
      `    </ListaRps>`,
      `  </LoteRps>`,
      `</EnviarLoteRpsEnvio>`,
    ].join('\n')
  }

  private montarRps(dados: DadosNfse): string {
    const servico = dados.servico
    const tomador = dados.tomador

    return [
      `      <Rps>`,
      `        <InfDeclaracaoPrestacaoServico>`,
      `          <Rps>`,
      `            <IdentificacaoRps>`,
      `              <Numero>${dados.numeroRps || 1}</Numero>`,
      `              <Serie>${dados.serieRps || 'RPS'}</Serie>`,
      `              <Tipo>${dados.tipoRps || 1}</Tipo>`,
      `            </IdentificacaoRps>`,
      `            <DataEmissao>${dados.dataEmissao.toISOString().split('T')[0]}</DataEmissao>`,
      `            <Status>1</Status>`,
      `          </Rps>`,
      `          <Competencia>${dados.competencia}</Competencia>`,
      `          <Servico>`,
      `            <Valores>`,
      `              <ValorServicos>${servico.valorServicos.toFixed(2)}</ValorServicos>`,
      servico.valorDeducoes ? `              <ValorDeducoes>${servico.valorDeducoes.toFixed(2)}</ValorDeducoes>` : '',
      `              <IssRetido>${servico.issRetido ? '1' : '2'}</IssRetido>`,
      `              <ValorIss>${(servico.valorIss || 0).toFixed(2)}</ValorIss>`,
      `              <BaseCalculo>${servico.baseCalculo.toFixed(2)}</BaseCalculo>`,
      `              <Aliquota>${(servico.aliquotaIss / 100).toFixed(4)}</Aliquota>`,
      `            </Valores>`,
      `            <ItemListaServico>${servico.codigoServico}</ItemListaServico>`,
      `            <CodigoTributacaoMunicipio>${servico.codigoTributacao}</CodigoTributacaoMunicipio>`,
      `            <Discriminacao>${servico.discriminacao}</Discriminacao>`,
      `            <CodigoMunicipio>${servico.codigoMunicipio}</CodigoMunicipio>`,
      `          </Servico>`,
      `          <Prestador>`,
      `            <CpfCnpj><Cnpj>${dados.prestador.cnpj}</Cnpj></CpfCnpj>`,
      `            <InscricaoMunicipal>${dados.prestador.inscricaoMunicipal}</InscricaoMunicipal>`,
      `          </Prestador>`,
      `          <Tomador>`,
      `            <IdentificacaoTomador>`,
      `              <CpfCnpj>${tomador.cpfCnpj.length === 11 ? `<Cpf>${tomador.cpfCnpj}</Cpf>` : `<Cnpj>${tomador.cpfCnpj}</Cnpj>`}</CpfCnpj>`,
      `            </IdentificacaoTomador>`,
      `            <RazaoSocial>${tomador.razaoSocial}</RazaoSocial>`,
      tomador.endereco ? this.montarEnderecoTomador(tomador.endereco) : '',
      tomador.email ? `            <Contato><Email>${tomador.email}</Email></Contato>` : '',
      `          </Tomador>`,
      `          <OptanteSimplesNacional>${dados.optanteSimplesNacional ? '1' : '2'}</OptanteSimplesNacional>`,
      `          <IncentivoFiscal>${dados.incentivadorCultural ? '1' : '2'}</IncentivoFiscal>`,
      `        </InfDeclaracaoPrestacaoServico>`,
      `      </Rps>`,
    ].filter(Boolean).join('\n')
  }

  private montarEnderecoTomador(endereco: NonNullable<DadosNfse['tomador']['endereco']>): string {
    return [
      `            <Endereco>`,
      `              <Endereco>${endereco.logradouro}</Endereco>`,
      `              <Numero>${endereco.numero}</Numero>`,
      endereco.complemento ? `              <Complemento>${endereco.complemento}</Complemento>` : '',
      `              <Bairro>${endereco.bairro}</Bairro>`,
      `              <CodigoMunicipio>${endereco.codigoMunicipio}</CodigoMunicipio>`,
      `              <Uf>${endereco.uf}</Uf>`,
      `              <Cep>${endereco.cep}</Cep>`,
      `            </Endereco>`,
    ].filter(Boolean).join('\n')
  }

  private montarXmlCancelamento(params: NfseCancelamentoParams): string {
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<CancelarNfseEnvio xmlns="http://www.abrasf.org.br/nfse.xsd">`,
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
      `<ConsultarNfseRpsEnvio xmlns="http://www.abrasf.org.br/nfse.xsd">`,
      `  <IdentificacaoRps>`,
      params.numeroNfse ? `    <Numero>${params.numeroNfse}</Numero>` : '',
      `  </IdentificacaoRps>`,
      `  <Prestador>`,
      `    <CpfCnpj><Cnpj>${params.cnpjPrestador}</Cnpj></CpfCnpj>`,
      `    <InscricaoMunicipal>${params.inscricaoMunicipal}</InscricaoMunicipal>`,
      `  </Prestador>`,
      `</ConsultarNfseRpsEnvio>`,
    ].filter(Boolean).join('\n')
  }

  // === Comunicação SOAP ===

  private async transmitirSoap(
    xml: string,
    metodo: string,
    certificado: { pfxBuffer: Buffer; senha: string },
  ): Promise<string> {
    // Monta envelope SOAP 1.1
    const soapEnvelope = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ws="http://www.abrasf.org.br/nfse.xsd">',
      '  <soapenv:Header/>',
      '  <soapenv:Body>',
      `    <ws:${metodo}Envio>`,
      `      ${xml.replace('<?xml version="1.0" encoding="UTF-8"?>', '').trim()}`,
      `    </ws:${metodo}Envio>`,
      '  </soapenv:Body>',
      '</soapenv:Envelope>',
    ].join('\n')

    // Transmissão via HTTPS com mTLS (certificado A1)
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
        'SOAPAction': metodo,
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
        reject(new Error('Timeout ao comunicar com webservice municipal'))
      })
      req.write(soapEnvelope)
      req.end()
    })
  }

  // === Parsing de respostas ===

  private parsearRespostaEmissao(xmlRetorno: string): NfseRespostaEmissao {
    // Extrair número da NFS-e do retorno
    const numeroMatch = xmlRetorno.match(/<Numero>(\d+)<\/Numero>/)
    const codigoVerificacao = xmlRetorno.match(/<CodigoVerificacao>(.*?)<\/CodigoVerificacao>/)
    const dataMatch = xmlRetorno.match(/<DataEmissao>(.*?)<\/DataEmissao>/)

    // Verificar se há erros
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

      return {
        sucesso: false,
        status: 'REJEITADA',
        xmlRetorno,
        erros,
      }
    }

    return {
      sucesso: !!numeroMatch,
      status: numeroMatch ? 'AUTORIZADA' : 'PENDENTE',
      numeroNfse: numeroMatch?.[1],
      codigoVerificacao: codigoVerificacao?.[1],
      dataEmissao: dataMatch ? new Date(dataMatch[1]) : undefined,
      xmlRetorno,
    }
  }

  private parsearRespostaCancelamento(xmlRetorno: string): NfseRespostaCancelamento {
    const sucesso = xmlRetorno.includes('<Sucesso>true</Sucesso>') ||
                    xmlRetorno.includes('<NfseCancelamento>')

    const dataMatch = xmlRetorno.match(/<DataHora>(.*?)<\/DataHora>/)

    const erroMatch = xmlRetorno.match(/<MensagemRetorno>([\s\S]*?)<\/MensagemRetorno>/g)
    if (erroMatch && !sucesso) {
      const erros = erroMatch.map((m) => {
        const codigo = m.match(/<Codigo>(.*?)<\/Codigo>/)
        const mensagem = m.match(/<Mensagem>(.*?)<\/Mensagem>/)
        return {
          codigo: codigo?.[1] || 'UNKNOWN',
          mensagem: mensagem?.[1] || 'Erro desconhecido',
        }
      })
      return { sucesso: false, erros }
    }

    return {
      sucesso: true,
      dataCancelamento: dataMatch ? new Date(dataMatch[1]) : new Date(),
    }
  }

  private parsearRespostaConsulta(xmlRetorno: string): NfseRespostaConsulta {
    const numeroMatch = xmlRetorno.match(/<Numero>(\d+)<\/Numero>/)
    const codigoVerificacao = xmlRetorno.match(/<CodigoVerificacao>(.*?)<\/CodigoVerificacao>/)
    const cancelada = xmlRetorno.includes('<NfseCancelamento>')

    if (!numeroMatch) {
      return {
        sucesso: false,
        erros: [{ codigo: 'NOT_FOUND', mensagem: 'NFS-e não encontrada' }],
      }
    }

    return {
      sucesso: true,
      status: cancelada ? 'CANCELADA' : 'AUTORIZADA',
      numeroNfse: numeroMatch[1],
      codigoVerificacao: codigoVerificacao?.[1],
      xmlNfse: xmlRetorno,
    }
  }
}
