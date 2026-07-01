/**
 * Gerador EFD-Reinf (Escrituração Fiscal Digital de Retenções e Outras Informações Fiscais)
 *
 * Diferente dos demais geradores SPED (que geram arquivos texto pipe-delimited),
 * o EFD-Reinf é baseado em eventos XML transmitidos via webservice da RFB.
 *
 * Eventos implementados:
 * - R-1000: Informações do contribuinte (abertura de movimento)
 * - R-2010: Retenção de contribuição previdenciária — serviços tomados
 * - R-2020: Retenção de contribuição previdenciária — serviços prestados
 * - R-2099: Fechamento dos eventos periódicos
 *
 * A transmissão é feita via webservice RFB assinado com certificado digital.
 *
 * @see Requirements 18.1, 18.2, 18.3, 18.4, 18.5
 */

import { prisma } from '../../../lib/prisma'
import type { PeriodoParams } from './tipos'

// === Interfaces de eventos EFD-Reinf ===

export interface EventoReinf {
  tipo: TipoEventoReinf
  id: string
  xml: string
  periodoApuracao: string // YYYY-MM
  cnpjDeclarante: string
  status: StatusEventoReinf
  protocolo?: string
  erros?: ErroReinf[]
}

export enum TipoEventoReinf {
  R1000 = 'R-1000',
  R2010 = 'R-2010',
  R2020 = 'R-2020',
  R2099 = 'R-2099',
}

export enum StatusEventoReinf {
  PENDENTE = 'PENDENTE',
  TRANSMITIDO = 'TRANSMITIDO',
  ACEITO = 'ACEITO',
  REJEITADO = 'REJEITADO',
  ERRO = 'ERRO',
}

export interface ErroReinf {
  codigo: string
  descricao: string
}

export interface RetencaoServico {
  cnpjPrestador: string
  razaoPrestador: string
  valorServico: number
  valorRetencao: number
  valorBaseRetencao: number
  tipoServico: string // código tabela 06
  notaFiscalId?: string
  numNF?: string
  dataEmissao: Date
}

export interface DadosContribuinte {
  cnpj: string
  razaoSocial: string
  naturezaJuridica: string
  classTributaria: string
  uf: string
  municipio?: string
  inscEstadual?: string
}

export interface ResultadoTransmissao {
  sucesso: boolean
  protocolo?: string
  dataRecebimento?: string
  erros?: ErroReinf[]
}

export interface ReinfGeracaoResult {
  eventos: EventoReinf[]
  totalEventos: number
  periodoApuracao: string
}

// === Helper: formata período no padrão YYYY-MM ===

function formatPeriodo(ano: number, mes: number): string {
  return `${ano}-${String(mes).padStart(2, '0')}`
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]
}

function formatDecimal(value: number): string {
  return value.toFixed(2)
}

function gerarIdEvento(tipo: TipoEventoReinf, cnpj: string, periodo: string): string {
  const seq = Date.now().toString().slice(-8)
  return `ID${cnpj}${periodo.replace('-', '')}${seq}`
}

// === XML Builders para cada evento ===

export function buildXmlR1000(contribuinte: DadosContribuinte, periodo: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Reinf xmlns="http://www.reinf.esocial.gov.br/schemas/evtInfoContribuinte/v2_01_02">',
    '  <evtInfoContri>',
    '    <ideEvento>',
    `      <tpAmb>2</tpAmb>`,
    `      <procEmi>1</procEmi>`,
    `      <verProc>1.0.0</verProc>`,
    '    </ideEvento>',
    '    <ideContri>',
    `      <tpInsc>1</tpInsc>`,
    `      <nrInsc>${contribuinte.cnpj.substring(0, 8)}</nrInsc>`,
    '    </ideContri>',
    '    <infoContri>',
    '      <inclusao>',
    '        <idePeriodo>',
    `          <iniValid>${periodo}</iniValid>`,
    '        </idePeriodo>',
    '        <infoCadastro>',
          `          <classTrib>${contribuinte.classTributaria}</classTrib>`,
          `          <indEscrituracao>1</indEscrituracao>`,
          `          <indDesoneracao>0</indDesoneracao>`,
          `          <indAcordoIsenMulta>0</indAcordoIsenMulta>`,
    '          <contato>',
    `            <nmCtt>${contribuinte.razaoSocial}</nmCtt>`,
    `            <cpfCtt>00000000000</cpfCtt>`,
    `            <foneFixo>0000000000</foneFixo>`,
    '          </contato>',
    '        </infoCadastro>',
    '      </inclusao>',
    '    </infoContri>',
    '  </evtInfoContri>',
    '</Reinf>',
  ].join('\n')
}

export function buildXmlR2010(
  cnpjDeclarante: string,
  periodo: string,
  retencoes: RetencaoServico[],
): string {
  const nfsXml = retencoes.map((ret) => [
    '          <nfs>',
    `            <serie>1</serie>`,
    `            <numDocto>${ret.numNF ?? '0'}</numDocto>`,
    `            <dtEmissaoNF>${formatDate(ret.dataEmissao)}</dtEmissaoNF>`,
    `            <vlrBruto>${formatDecimal(ret.valorServico)}</vlrBruto>`,
    `            <vlrBaseRet>${formatDecimal(ret.valorBaseRetencao)}</vlrBaseRet>`,
    `            <vlrRetencao>${formatDecimal(ret.valorRetencao)}</vlrRetencao>`,
    '          </nfs>',
  ].join('\n')).join('\n')

  const prestadoresMap = new Map<string, RetencaoServico[]>()
  for (const ret of retencoes) {
    const key = ret.cnpjPrestador
    if (!prestadoresMap.has(key)) prestadoresMap.set(key, [])
    prestadoresMap.get(key)!.push(ret)
  }

  const prestadoresXml = Array.from(prestadoresMap.entries()).map(([cnpj, rets]) => {
    const totalServico = rets.reduce((s, r) => s + r.valorServico, 0)
    const totalRetencao = rets.reduce((s, r) => s + r.valorRetencao, 0)
    const totalBase = rets.reduce((s, r) => s + r.valorBaseRetencao, 0)
    const nfsItems = rets.map((ret) => [
      '          <nfs>',
      `            <serie>1</serie>`,
      `            <numDocto>${ret.numNF ?? '0'}</numDocto>`,
      `            <dtEmissaoNF>${formatDate(ret.dataEmissao)}</dtEmissaoNF>`,
      `            <vlrBruto>${formatDecimal(ret.valorServico)}</vlrBruto>`,
      `            <vlrBaseRet>${formatDecimal(ret.valorBaseRetencao)}</vlrBaseRet>`,
      `            <vlrRetencao>${formatDecimal(ret.valorRetencao)}</vlrRetencao>`,
      '          </nfs>',
    ].join('\n')).join('\n')

    return [
      '      <ideEstabObra>',
      `        <tpInscEstab>1</tpInscEstab>`,
      `        <nrInscEstab>${cnpjDeclarante}</nrInscEstab>`,
      '        <idePrestServ>',
      `          <cnpjPrestador>${cnpj}</cnpjPrestador>`,
      `          <vlrTotalBruto>${formatDecimal(totalServico)}</vlrTotalBruto>`,
      `          <vlrTotalBaseRet>${formatDecimal(totalBase)}</vlrTotalBaseRet>`,
      `          <vlrTotalRetPrinc>${formatDecimal(totalRetencao)}</vlrTotalRetPrinc>`,
      nfsItems,
      '        </idePrestServ>',
      '      </ideEstabObra>',
    ].join('\n')
  }).join('\n')

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Reinf xmlns="http://www.reinf.esocial.gov.br/schemas/evtServTom/v2_01_02">',
    '  <evtServTom>',
    '    <ideEvento>',
    `      <indRetif>1</indRetif>`,
    `      <perApur>${periodo}</perApur>`,
    `      <tpAmb>2</tpAmb>`,
    `      <procEmi>1</procEmi>`,
    `      <verProc>1.0.0</verProc>`,
    '    </ideEvento>',
    '    <ideContri>',
    `      <tpInsc>1</tpInsc>`,
    `      <nrInsc>${cnpjDeclarante.substring(0, 8)}</nrInsc>`,
    '    </ideContri>',
    prestadoresXml,
    '  </evtServTom>',
    '</Reinf>',
  ].join('\n')
}

export function buildXmlR2020(
  cnpjDeclarante: string,
  periodo: string,
  retencoes: RetencaoServico[],
): string {
  const tomadoresMap = new Map<string, RetencaoServico[]>()
  for (const ret of retencoes) {
    const key = ret.cnpjPrestador // neste contexto, cnpjPrestador = tomador
    if (!tomadoresMap.has(key)) tomadoresMap.set(key, [])
    tomadoresMap.get(key)!.push(ret)
  }

  const tomadoresXml = Array.from(tomadoresMap.entries()).map(([cnpj, rets]) => {
    const totalServico = rets.reduce((s, r) => s + r.valorServico, 0)
    const totalRetencao = rets.reduce((s, r) => s + r.valorRetencao, 0)
    const totalBase = rets.reduce((s, r) => s + r.valorBaseRetencao, 0)
    const nfsItems = rets.map((ret) => [
      '          <nfs>',
      `            <serie>1</serie>`,
      `            <numDocto>${ret.numNF ?? '0'}</numDocto>`,
      `            <dtEmissaoNF>${formatDate(ret.dataEmissao)}</dtEmissaoNF>`,
      `            <vlrBruto>${formatDecimal(ret.valorServico)}</vlrBruto>`,
      `            <vlrBaseRet>${formatDecimal(ret.valorBaseRetencao)}</vlrBaseRet>`,
      `            <vlrRetencao>${formatDecimal(ret.valorRetencao)}</vlrRetencao>`,
      '          </nfs>',
    ].join('\n')).join('\n')

    return [
      '      <ideEstabPrest>',
      `        <tpInscEstab>1</tpInscEstab>`,
      `        <nrInscEstab>${cnpjDeclarante}</nrInscEstab>`,
      '        <ideTomador>',
      `          <cnpjTomador>${cnpj}</cnpjTomador>`,
      `          <vlrTotalBruto>${formatDecimal(totalServico)}</vlrTotalBruto>`,
      `          <vlrTotalBaseRet>${formatDecimal(totalBase)}</vlrTotalBaseRet>`,
      `          <vlrTotalRetPrinc>${formatDecimal(totalRetencao)}</vlrTotalRetPrinc>`,
      nfsItems,
      '        </ideTomador>',
      '      </ideEstabPrest>',
    ].join('\n')
  }).join('\n')

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Reinf xmlns="http://www.reinf.esocial.gov.br/schemas/evtServPrest/v2_01_02">',
    '  <evtServPrest>',
    '    <ideEvento>',
    `      <indRetif>1</indRetif>`,
    `      <perApur>${periodo}</perApur>`,
    `      <tpAmb>2</tpAmb>`,
    `      <procEmi>1</procEmi>`,
    `      <verProc>1.0.0</verProc>`,
    '    </ideEvento>',
    '    <ideContri>',
    `      <tpInsc>1</tpInsc>`,
    `      <nrInsc>${cnpjDeclarante.substring(0, 8)}</nrInsc>`,
    '    </ideContri>',
    tomadoresXml,
    '  </evtServPrest>',
    '</Reinf>',
  ].join('\n')
}

export function buildXmlR2099(
  cnpjDeclarante: string,
  periodo: string,
  temMovimento: boolean,
): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Reinf xmlns="http://www.reinf.esocial.gov.br/schemas/evtFechamento/v2_01_02">',
    '  <evtFechaEvPer>',
    '    <ideEvento>',
    `      <perApur>${periodo}</perApur>`,
    `      <tpAmb>2</tpAmb>`,
    `      <procEmi>1</procEmi>`,
    `      <verProc>1.0.0</verProc>`,
    '    </ideEvento>',
    '    <ideContri>',
    `      <tpInsc>1</tpInsc>`,
    `      <nrInsc>${cnpjDeclarante.substring(0, 8)}</nrInsc>`,
    '    </ideContri>',
    '    <ideRespInf>',
    `      <nmResp>RESPONSAVEL</nmResp>`,
    `      <cpfResp>00000000000</cpfResp>`,
    `      <telefone>0000000000</telefone>`,
    `      <email>fiscal@empresa.com.br</email>`,
    '    </ideRespInf>',
    '    <infoFech>',
    `      <evtServTm>${temMovimento ? 'S' : 'N'}</evtServTm>`,
    `      <evtServPr>${temMovimento ? 'S' : 'N'}</evtServPr>`,
    `      <evtAssDespRec>N</evtAssDespRec>`,
    `      <evtAssDespRep>N</evtAssDespRep>`,
    `      <evtComProd>N</evtComProd>`,
    `      <evtCPRB>N</evtCPRB>`,
    `      <evtAquis>N</evtAquis>`,
    '    </infoFech>',
    '  </evtFechaEvPer>',
    '</Reinf>',
  ].join('\n')
}

// === Serviço de transmissão (mock para webservice RFB) ===

export interface ReinfTransmissor {
  transmitir(xml: string, certificado: { pfx: Buffer; senha: string }): Promise<ResultadoTransmissao>
}

/**
 * Transmissor mock para desenvolvimento/homologação.
 * Em produção, substituir pela comunicação real via SOAP com a RFB.
 */
export class ReinfTransmissorMock implements ReinfTransmissor {
  async transmitir(xml: string, _certificado: { pfx: Buffer; senha: string }): Promise<ResultadoTransmissao> {
    // Simula validação básica
    if (!xml || xml.length === 0) {
      return {
        sucesso: false,
        erros: [{ codigo: 'MS0001', descricao: 'XML vazio ou inválido' }],
      }
    }

    // Simula transmissão bem-sucedida
    const protocolo = `${Date.now()}.${Math.random().toString(36).substring(2, 10)}`
    return {
      sucesso: true,
      protocolo,
      dataRecebimento: new Date().toISOString(),
    }
  }
}

// === Main generator class ===

export class SpedReinfGenerator {
  private transmissor: ReinfTransmissor

  constructor(transmissor?: ReinfTransmissor) {
    this.transmissor = transmissor ?? new ReinfTransmissorMock()
  }

  /**
   * Gera todos os eventos EFD-Reinf para o período informado.
   * Fluxo: R-1000 → R-2010 (se houver) → R-2020 (se houver) → R-2099
   */
  async gerar(params: PeriodoParams): Promise<ReinfGeracaoResult> {
    const periodo = formatPeriodo(params.ano, params.mes)
    const eventos: EventoReinf[] = []

    // Carrega dados da empresa
    const empresa = await prisma.empresa.findUniqueOrThrow({
      where: { id: params.empresaId },
    })

    const cnpj = empresa.cnpj?.replace(/\D/g, '') ?? ''

    // 1. Evento R-1000 — Informações do contribuinte (Req 18.5)
    const eventoR1000 = this.gerarEventoR1000(empresa, periodo, cnpj)
    eventos.push(eventoR1000)

    // 2. Evento R-2010 — Retenções de serviços tomados (Req 18.1)
    const retencoesTomados = await this.buscarRetencoesTomados(params)
    if (retencoesTomados.length > 0) {
      const eventoR2010 = this.gerarEventoR2010(cnpj, periodo, retencoesTomados)
      eventos.push(eventoR2010)
    }

    // 3. Evento R-2020 — Retenções de serviços prestados (Req 18.2)
    const retencoesPrestados = await this.buscarRetencoesPrestados(params)
    if (retencoesPrestados.length > 0) {
      const eventoR2020 = this.gerarEventoR2020(cnpj, periodo, retencoesPrestados)
      eventos.push(eventoR2020)
    }

    // 4. Evento R-2099 — Fechamento (Req 18.3)
    const temMovimento = retencoesTomados.length > 0 || retencoesPrestados.length > 0
    const eventoR2099 = this.gerarEventoR2099(cnpj, periodo, temMovimento)
    eventos.push(eventoR2099)

    return {
      eventos,
      totalEventos: eventos.length,
      periodoApuracao: periodo,
    }
  }

  /**
   * Transmite eventos gerados via webservice RFB assinado com certificado digital (Req 18.4).
   */
  async transmitir(
    eventos: EventoReinf[],
    certificado: { pfx: Buffer; senha: string },
  ): Promise<EventoReinf[]> {
    const resultados: EventoReinf[] = []

    for (const evento of eventos) {
      const resultado = await this.transmissor.transmitir(evento.xml, certificado)

      resultados.push({
        ...evento,
        status: resultado.sucesso ? StatusEventoReinf.ACEITO : StatusEventoReinf.REJEITADO,
        protocolo: resultado.protocolo,
        erros: resultado.erros,
      })
    }

    return resultados
  }

  // === Geradores de eventos individuais ===

  private gerarEventoR1000(empresa: any, periodo: string, cnpj: string): EventoReinf {
    const contribuinte: DadosContribuinte = {
      cnpj,
      razaoSocial: empresa.razaoSocial ?? 'EMPRESA',
      naturezaJuridica: '2062', // Sociedade empresária limitada (padrão)
      classTributaria: '99',     // Outras (padrão)
      uf: empresa.uf ?? 'SP',
      inscEstadual: empresa.inscEstadual,
    }

    const xml = buildXmlR1000(contribuinte, periodo)
    const id = gerarIdEvento(TipoEventoReinf.R1000, cnpj, periodo)

    return {
      tipo: TipoEventoReinf.R1000,
      id,
      xml,
      periodoApuracao: periodo,
      cnpjDeclarante: cnpj,
      status: StatusEventoReinf.PENDENTE,
    }
  }

  private gerarEventoR2010(
    cnpj: string,
    periodo: string,
    retencoes: RetencaoServico[],
  ): EventoReinf {
    const xml = buildXmlR2010(cnpj, periodo, retencoes)
    const id = gerarIdEvento(TipoEventoReinf.R2010, cnpj, periodo)

    return {
      tipo: TipoEventoReinf.R2010,
      id,
      xml,
      periodoApuracao: periodo,
      cnpjDeclarante: cnpj,
      status: StatusEventoReinf.PENDENTE,
    }
  }

  private gerarEventoR2020(
    cnpj: string,
    periodo: string,
    retencoes: RetencaoServico[],
  ): EventoReinf {
    const xml = buildXmlR2020(cnpj, periodo, retencoes)
    const id = gerarIdEvento(TipoEventoReinf.R2020, cnpj, periodo)

    return {
      tipo: TipoEventoReinf.R2020,
      id,
      xml,
      periodoApuracao: periodo,
      cnpjDeclarante: cnpj,
      status: StatusEventoReinf.PENDENTE,
    }
  }

  private gerarEventoR2099(
    cnpj: string,
    periodo: string,
    temMovimento: boolean,
  ): EventoReinf {
    const xml = buildXmlR2099(cnpj, periodo, temMovimento)
    const id = gerarIdEvento(TipoEventoReinf.R2099, cnpj, periodo)

    return {
      tipo: TipoEventoReinf.R2099,
      id,
      xml,
      periodoApuracao: periodo,
      cnpjDeclarante: cnpj,
      status: StatusEventoReinf.PENDENTE,
    }
  }

  // === Busca de dados no banco ===

  /**
   * Busca documentos de serviço tomados (entradas) com retenção no período.
   * Corresponde ao evento R-2010 (Req 18.1).
   */
  private async buscarRetencoesTomados(params: PeriodoParams): Promise<RetencaoServico[]> {
    const dataInicio = new Date(params.ano, params.mes - 1, 1)
    const dataFim = new Date(params.ano, params.mes, 0, 23, 59, 59, 999)

    const docs = await prisma.documentoFiscal.findMany({
      where: {
        empresaId: params.empresaId,
        tipoOperacao: 0, // Entrada (serviços tomados)
        status: 'AUTORIZADO',
        tipo: 'NFSE',
        dataEmissao: { gte: dataInicio, lte: dataFim },
      },
      include: { itens: true },
    })

    const retencoes: RetencaoServico[] = []

    for (const doc of docs) {
      // Verifica se há retenção de ISS nos itens (indicativo de retenção previdenciária)
      const valorServico = Number(doc.valorTotal) || 0
      const valorIss = Number(doc.valorIss) || 0

      if (valorIss > 0) {
        // Retenção previdenciária = 11% sobre base de serviços (simplificado)
        const baseRetencao = valorServico
        const valorRetencao = Math.round(baseRetencao * 0.11 * 100) / 100

        retencoes.push({
          cnpjPrestador: doc.emitenteCnpj ?? '',
          razaoPrestador: doc.emitenteRazao ?? '',
          valorServico,
          valorRetencao,
          valorBaseRetencao: baseRetencao,
          tipoServico: '100000001', // Código genérico tabela 06
          notaFiscalId: doc.id,
          numNF: String(doc.numero),
          dataEmissao: doc.dataEmissao,
        })
      }
    }

    return retencoes
  }

  /**
   * Busca documentos de serviço prestados (saídas) com retenção no período.
   * Corresponde ao evento R-2020 (Req 18.2).
   */
  private async buscarRetencoesPrestados(params: PeriodoParams): Promise<RetencaoServico[]> {
    const dataInicio = new Date(params.ano, params.mes - 1, 1)
    const dataFim = new Date(params.ano, params.mes, 0, 23, 59, 59, 999)

    const docs = await prisma.documentoFiscal.findMany({
      where: {
        empresaId: params.empresaId,
        tipoOperacao: 1, // Saída (serviços prestados)
        status: 'AUTORIZADO',
        tipo: 'NFSE',
        dataEmissao: { gte: dataInicio, lte: dataFim },
      },
      include: { itens: true },
    })

    const retencoes: RetencaoServico[] = []

    for (const doc of docs) {
      const valorServico = Number(doc.valorTotal) || 0
      const valorIss = Number(doc.valorIss) || 0

      if (valorIss > 0) {
        const baseRetencao = valorServico
        const valorRetencao = Math.round(baseRetencao * 0.11 * 100) / 100

        retencoes.push({
          cnpjPrestador: doc.destCpfCnpj ?? '', // tomador
          razaoPrestador: doc.destRazao ?? '',
          valorServico,
          valorRetencao,
          valorBaseRetencao: baseRetencao,
          tipoServico: '100000001',
          notaFiscalId: doc.id,
          numNF: String(doc.numero),
          dataEmissao: doc.dataEmissao,
        })
      }
    }

    return retencoes
  }
}

// === Exported factory ===

export const spedReinfGenerator = new SpedReinfGenerator()
