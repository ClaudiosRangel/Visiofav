/**
 * Gerador SPED Contribuições (EFD PIS/COFINS)
 *
 * Gera o arquivo da EFD Contribuições com todos os blocos obrigatórios:
 * 0 (Abertura/Identificação), A (Serviços - NFS-e), C (Documentos Mercadoria),
 * D (Transporte), F (Demais Documentos/Operações), M (Apuração PIS/COFINS),
 * 1 (Complemento), 9 (Controle - gerado automaticamente pelo SPEDWriter).
 *
 * Bloco A: NFS-e (receitas de serviços)
 * Bloco C: documentos de mercadoria com detalhamento PIS/COFINS por item
 * Bloco F: receitas/deduções (financeiras, aluguéis, etc.)
 * Bloco M: apuração PIS/COFINS consolidada com créditos e contribuição devida
 *
 * Detalha créditos por base no regime não-cumulativo.
 *
 * @see Requirements 15.1, 15.2, 15.3, 15.4, 15.5, 15.6
 */

import { prisma } from '../../../lib/prisma'
import { SPEDWriter } from './sped-writer'
import type { PeriodoParams, ArquivoSPED } from './tipos'

// Chunk size for batch processing (performance)
const CHUNK_SIZE = 5000

// === Helper functions ===

function formatDecimal(value: any, decimals = 2): string {
  if (value === null || value === undefined) return '0,00'
  const num = typeof value === 'number' ? value : Number(value)
  return num.toFixed(decimals).replace('.', ',')
}

function formatDate(date: Date | null | undefined): string {
  if (!date) return ''
  const d = new Date(date)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${dd}${mm}${yyyy}`
}

function padLeft(value: string | number, length: number, char = '0'): string {
  return String(value).padStart(length, char)
}

// === Main generator class ===

export class SpedContribuicoesGenerator {
  private writer: SPEDWriter
  private params!: PeriodoParams
  private dataInicio!: Date
  private dataFim!: Date

  constructor() {
    this.writer = new SPEDWriter()
  }

  /**
   * Gera o arquivo SPED Contribuições (EFD PIS/COFINS) para o período informado.
   * Processa documentos em chunks para performance com grandes volumes.
   */
  async gerar(params: PeriodoParams): Promise<ArquivoSPED> {
    this.params = params
    this.writer = new SPEDWriter()

    // Define período
    this.dataInicio = new Date(params.ano, params.mes - 1, 1)
    this.dataFim = new Date(params.ano, params.mes, 0, 23, 59, 59, 999)

    // Gera blocos na ordem obrigatória
    await this.gerarBloco0()
    await this.gerarBlocoA()
    await this.gerarBlocoC()
    await this.gerarBlocoD()
    await this.gerarBlocoF()
    await this.gerarBlocoM()
    this.gerarBloco1()

    // Bloco 9 é gerado automaticamente pelo SPEDWriter.finalize()
    const conteudo = this.writer.finalize()

    const blocos = this.writer.getContadores()

    return {
      conteudo,
      nomeArquivo: this.gerarNomeArquivo(),
      totalRegistros: conteudo.toString('latin1').split('\r\n').filter(l => l.length > 0).length,
      blocos,
      valido: true,
    }
  }

  // === Bloco 0: Abertura, Identificação e Referências ===

  private async gerarBloco0(): Promise<void> {
    const empresa = await prisma.empresa.findUniqueOrThrow({
      where: { id: this.params.empresaId },
    })

    // Registro 0000 - Abertura do arquivo digital
    this.writer.writeRegistro('0', '0000', [
      '006',                             // COD_VER - versão layout EFD Contribuições
      '1',                               // TIPO_ESCRIT (1=EFD com apuração)
      '0',                               // IND_SIT_ESP (0=não se aplica)
      '',                                // NUM_REC_ANTERIOR
      formatDate(this.dataInicio),       // DT_INI
      formatDate(this.dataFim),          // DT_FIN
      empresa.razaoSocial,              // NOME
      empresa.cnpj.replace(/\D/g, ''), // CNPJ
      empresa.uf ?? '',                 // UF
      '',                                // COD_MUN (IBGE)
      '',                                // SUFRAMA
      String(empresa.regimeTributario), // IND_NAT_PJ
      '1',                               // IND_ATIV (1=industrial)
    ])

    // Registro 0001 - Abertura do Bloco 0
    this.writer.writeRegistro('0', '0001', ['0']) // 0 = com dados

    // Registro 0100 - Dados do contabilista
    this.writer.writeRegistro('0', '0100', [
      '',  // NOME
      '',  // CPF
      '',  // CRC
      '',  // CNPJ
      '',  // CEP
      '',  // END
      '',  // NUM
      '',  // COMPL
      '',  // BAIRRO
      '',  // FONE
      '',  // FAX
      '',  // EMAIL
      '',  // COD_MUN
    ])

    // Registro 0990 - Encerramento do Bloco 0
    const totalBloco0 = (this.writer.getContadores()['0'] ?? 0) + 1
    this.writer.writeRegistro('0', '0990', [String(totalBloco0)])
  }

  // === Bloco A: Documentos de Serviço (NFS-e) ===
  // Receitas de serviços conforme Requirement 15.2

  private async gerarBlocoA(): Promise<void> {
    const nfseCount = await prisma.documentoFiscal.count({
      where: {
        empresaId: this.params.empresaId,
        dataEmissao: { gte: this.dataInicio, lte: this.dataFim },
        status: 'AUTORIZADO',
        tipo: 'NFSE',
      },
    })

    // IND_MOV: 0=com movimento, 1=sem movimento
    const indMov = nfseCount > 0 ? '0' : '1'
    this.writer.writeRegistro('A', 'A001', [indMov])

    if (nfseCount > 0) {
      await this.processarDocumentosBlocoA()
    }

    // Registro A990 - Encerramento do Bloco A
    const totalBlocoA = (this.writer.getContadores()['A'] ?? 0) + 1
    this.writer.writeRegistro('A', 'A990', [String(totalBlocoA)])
  }

  private async processarDocumentosBlocoA(): Promise<void> {
    let skip = 0
    let hasMore = true

    while (hasMore) {
      const documentos = await prisma.documentoFiscal.findMany({
        where: {
          empresaId: this.params.empresaId,
          dataEmissao: { gte: this.dataInicio, lte: this.dataFim },
          status: 'AUTORIZADO',
          tipo: 'NFSE',
        },
        include: { itens: true },
        orderBy: [{ serie: 'asc' }, { numero: 'asc' }],
        skip,
        take: CHUNK_SIZE,
      })

      if (documentos.length === 0) {
        hasMore = false
        break
      }

      for (const doc of documentos) {
        this.escreverA100(doc)
        for (const item of doc.itens) {
          this.escreverA170(item)
        }
      }

      skip += CHUNK_SIZE
      if (documentos.length < CHUNK_SIZE) {
        hasMore = false
      }
    }
  }

  private escreverA100(doc: any): void {
    // Registro A100 - Documento fiscal de serviço
    this.writer.writeRegistro('A', 'A100', [
      doc.tipoOperacao === 0 ? '0' : '1', // IND_OPER (0=entrada, 1=saída)
      '0',                                  // IND_EMIT (0=própria)
      doc.destCpfCnpj ?? '',               // COD_PART
      '00',                                 // COD_SIT (00=regular)
      String(doc.serie),                   // SER
      '',                                   // SUB
      String(doc.numero),                  // NUM_DOC
      doc.chaveAcesso ?? '',              // CHV_NFSE
      formatDate(doc.dataEmissao),        // DT_DOC
      formatDate(doc.dataEmissao),        // DT_EXE_SERV
      formatDecimal(doc.valorTotal),      // VL_DOC
      '0',                                 // IND_PGTO (0=à vista)
      formatDecimal(doc.valorTotal),      // VL_DOC_LIQ (for now = total)
      formatDecimal(doc.valorPis),        // VL_PIS
      formatDecimal(doc.valorCofins),     // VL_COFINS
      formatDecimal(doc.valorIss),        // VL_ISS
    ])
  }

  private escreverA170(item: any): void {
    // Registro A170 - Complemento do documento fiscal (serviço)
    this.writer.writeRegistro('A', 'A170', [
      String(item.nItem),                  // NUM_ITEM
      item.codigoProd,                     // COD_ITEM
      item.descricao,                      // DESCR_COMPL
      formatDecimal(item.valorTotal),     // VL_ITEM
      formatDecimal(item.valorDesconto),  // VL_DESC
      '0',                                 // NAT_BC_CRED (base de cálculo PIS/COFINS)
      '',                                  // IND_ORIG_CRED
      item.pisCst ?? '',                  // CST_PIS
      formatDecimal(item.pisBase),        // VL_BC_PIS
      formatDecimal(item.pisAliquota, 4), // ALIQ_PIS
      formatDecimal(item.pisValor),       // VL_PIS
      item.cofinsCst ?? '',              // CST_COFINS
      formatDecimal(item.cofinsBase),    // VL_BC_COFINS
      formatDecimal(item.cofinsAliquota, 4), // ALIQ_COFINS
      formatDecimal(item.cofinsValor),   // VL_COFINS
      '',                                 // COD_CTA
      '',                                 // COD_CCUS
    ])
  }

  // === Bloco C: Documentos Fiscais de Mercadorias ===
  // Detalhamento PIS/COFINS por item conforme Requirement 15.3

  private async gerarBlocoC(): Promise<void> {
    const documentosCount = await prisma.documentoFiscal.count({
      where: {
        empresaId: this.params.empresaId,
        dataEmissao: { gte: this.dataInicio, lte: this.dataFim },
        status: 'AUTORIZADO',
        modelo: { in: [1, 4, 55, 65] },
      },
    })

    const indMov = documentosCount > 0 ? '0' : '1'
    this.writer.writeRegistro('C', 'C001', [indMov])

    if (documentosCount > 0) {
      await this.processarDocumentosBlocoC()
    }

    // Registro C990 - Encerramento do Bloco C
    const totalBlocoC = (this.writer.getContadores()['C'] ?? 0) + 1
    this.writer.writeRegistro('C', 'C990', [String(totalBlocoC)])
  }

  private async processarDocumentosBlocoC(): Promise<void> {
    let skip = 0
    let hasMore = true

    while (hasMore) {
      const documentos = await prisma.documentoFiscal.findMany({
        where: {
          empresaId: this.params.empresaId,
          dataEmissao: { gte: this.dataInicio, lte: this.dataFim },
          status: 'AUTORIZADO',
          modelo: { in: [1, 4, 55, 65] },
        },
        include: { itens: true },
        orderBy: [{ modelo: 'asc' }, { serie: 'asc' }, { numero: 'asc' }],
        skip,
        take: CHUNK_SIZE,
      })

      if (documentos.length === 0) {
        hasMore = false
        break
      }

      for (const doc of documentos) {
        this.escreverC010(doc)
        this.escreverC100(doc)
        for (const item of doc.itens) {
          this.escreverC170(item)
        }
      }

      skip += CHUNK_SIZE
      if (documentos.length < CHUNK_SIZE) {
        hasMore = false
      }
    }
  }

  private escreverC010(doc: any): void {
    // Registro C010 - Identificação do estabelecimento (CNPJ)
    this.writer.writeRegistro('C', 'C010', [
      doc.emitenteCnpj,  // CNPJ
      '1',               // IND_ESCRIT (1=consolidado)
    ])
  }

  private escreverC100(doc: any): void {
    // Registro C100 - Documento fiscal de mercadoria (NF-e, NFC-e)
    const codMod = doc.modelo === 55 ? '55' : doc.modelo === 65 ? '65' : String(doc.modelo).padStart(2, '0')
    this.writer.writeRegistro('C', 'C100', [
      doc.tipoOperacao === 0 ? '0' : '1', // IND_OPER
      '0',                                  // IND_EMIT (0=própria)
      doc.destCpfCnpj ?? '',               // COD_PART
      codMod,                              // COD_MOD
      '00',                                 // COD_SIT (00=regular)
      String(doc.serie),                   // SER
      String(doc.numero),                  // NUM_DOC
      doc.chaveAcesso ?? '',              // CHV_NFE
      formatDate(doc.dataEmissao),        // DT_DOC
      formatDate(doc.dataSaida ?? doc.dataEmissao), // DT_E_S
      formatDecimal(doc.valorProdutos),   // VL_MERC (valor mercadoria)
      '9',                                 // IND_PGTO
      formatDecimal(doc.valorDesconto),   // VL_DESC
      '0,00',                              // VL_ABAT_NT
      formatDecimal(doc.valorFrete),      // VL_FRT
      formatDecimal(doc.valorSeguro),     // VL_SEG
      formatDecimal(doc.valorOutras),     // VL_OUT_DA
      formatDecimal(doc.valorTotal),      // VL_DOC
    ])
  }

  private escreverC170(item: any): void {
    // Registro C170 - Itens do documento com detalhamento PIS/COFINS
    this.writer.writeRegistro('C', 'C170', [
      String(item.nItem),                   // NUM_ITEM
      item.codigoProd,                      // COD_ITEM
      item.descricao,                       // DESCR_COMPL
      formatDecimal(item.quantidade, 4),    // QTD
      item.unidade,                         // UNID
      formatDecimal(item.valorTotal),       // VL_ITEM
      formatDecimal(item.valorDesconto),    // VL_DESC
      item.icmsCst ?? item.icmsCsosn ?? '', // CST_ICMS
      item.cfop,                            // CFOP
      item.ncm,                             // COD_NCM
      item.pisCst ?? '',                    // CST_PIS
      formatDecimal(item.pisBase),          // VL_BC_PIS
      formatDecimal(item.pisAliquota, 4),   // ALIQ_PIS
      formatDecimal(item.pisValor),         // VL_PIS
      item.cofinsCst ?? '',                 // CST_COFINS
      formatDecimal(item.cofinsBase),       // VL_BC_COFINS
      formatDecimal(item.cofinsAliquota, 4),// ALIQ_COFINS
      formatDecimal(item.cofinsValor),      // VL_COFINS
      '',                                    // COD_CTA
    ])
  }

  // === Bloco D: Documentos de Transporte (CT-e) ===

  private async gerarBlocoD(): Promise<void> {
    const cteCount = await prisma.documentoFiscal.count({
      where: {
        empresaId: this.params.empresaId,
        dataEmissao: { gte: this.dataInicio, lte: this.dataFim },
        status: 'AUTORIZADO',
        modelo: 57,
      },
    })

    const indMov = cteCount > 0 ? '0' : '1'
    this.writer.writeRegistro('D', 'D001', [indMov])

    if (cteCount > 0) {
      await this.processarDocumentosBlocoD()
    }

    const totalBlocoD = (this.writer.getContadores()['D'] ?? 0) + 1
    this.writer.writeRegistro('D', 'D990', [String(totalBlocoD)])
  }

  private async processarDocumentosBlocoD(): Promise<void> {
    let skip = 0
    let hasMore = true

    while (hasMore) {
      const documentos = await prisma.documentoFiscal.findMany({
        where: {
          empresaId: this.params.empresaId,
          dataEmissao: { gte: this.dataInicio, lte: this.dataFim },
          status: 'AUTORIZADO',
          modelo: 57,
        },
        include: { itens: true },
        orderBy: [{ serie: 'asc' }, { numero: 'asc' }],
        skip,
        take: CHUNK_SIZE,
      })

      if (documentos.length === 0) {
        hasMore = false
        break
      }

      for (const doc of documentos) {
        this.escreverD100(doc)
        this.escreverD101(doc)
        this.escreverD105(doc)
      }

      skip += CHUNK_SIZE
      if (documentos.length < CHUNK_SIZE) {
        hasMore = false
      }
    }
  }

  private escreverD100(doc: any): void {
    // Registro D100 - Documento de transporte
    this.writer.writeRegistro('D', 'D100', [
      doc.tipoOperacao === 0 ? '0' : '1', // IND_OPER
      '0',                                  // IND_EMIT (0=própria)
      doc.destCpfCnpj ?? '',               // COD_PART
      '57',                                 // COD_MOD (CT-e)
      '00',                                 // COD_SIT
      String(doc.serie),                   // SER
      '',                                   // SUB
      String(doc.numero),                  // NUM_DOC
      doc.chaveAcesso ?? '',              // CHV_CTE
      formatDate(doc.dataEmissao),        // DT_DOC
      formatDate(doc.dataSaida ?? doc.dataEmissao), // DT_A_P
      formatDecimal(doc.valorTotal),      // VL_DOC
      formatDecimal(doc.valorDesconto),   // VL_DESC
      '9',                                 // IND_FRT
      formatDecimal(doc.valorTotal),      // VL_SERV
      formatDecimal(doc.valorIcms),       // VL_BC_ICMS
      formatDecimal(doc.valorIcms),       // VL_ICMS
      '',                                  // COD_INF
      '',                                  // COD_CTA
    ])
  }

  private escreverD101(doc: any): void {
    // Registro D101 - PIS sobre prestação de serviço de transporte
    this.writer.writeRegistro('D', 'D101', [
      '0',                                // IND_NAT_FRT (0=operações de vendas)
      formatDecimal(doc.valorPis),       // VL_ITEM (base PIS)
      '01',                               // CST_PIS
      '0',                                // NAT_BC_CRED
      formatDecimal(doc.valorTotal),     // VL_BC_PIS
      '1,6500',                           // ALIQ_PIS (1,65% não-cumulativo default)
      formatDecimal(doc.valorPis),       // VL_PIS
      '',                                 // COD_CTA
    ])
  }

  private escreverD105(doc: any): void {
    // Registro D105 - COFINS sobre prestação de serviço de transporte
    this.writer.writeRegistro('D', 'D105', [
      '0',                                // IND_NAT_FRT
      formatDecimal(doc.valorCofins),    // VL_ITEM
      '01',                               // CST_COFINS
      '0',                                // NAT_BC_CRED
      formatDecimal(doc.valorTotal),     // VL_BC_COFINS
      '7,6000',                           // ALIQ_COFINS (7,6% não-cumulativo default)
      formatDecimal(doc.valorCofins),    // VL_COFINS
      '',                                 // COD_CTA
    ])
  }

  // === Bloco F: Demais Documentos e Operações ===
  // Receitas financeiras, aluguéis, etc. conforme Requirement 15.4

  private async gerarBlocoF(): Promise<void> {
    // Bloco F captura receitas/deduções que não se enquadram nos blocos A, C, D
    // Ex: receitas financeiras, aluguéis, demais receitas/deduções
    // Como não há um modelo de dados específico para essas receitas no schema atual,
    // geramos o bloco sem movimento por padrão. Pode ser expandido futuramente.

    this.writer.writeRegistro('F', 'F001', ['1']) // 1 = sem movimento (default)

    // Registro F990 - Encerramento do Bloco F
    const totalBlocoF = (this.writer.getContadores()['F'] ?? 0) + 1
    this.writer.writeRegistro('F', 'F990', [String(totalBlocoF)])
  }

  // === Bloco M: Apuração PIS/COFINS ===
  // Apuração consolidada com créditos e contribuição devida conforme Requirements 15.5, 15.6

  private async gerarBlocoM(): Promise<void> {
    this.writer.writeRegistro('M', 'M001', ['0']) // 0 = com dados (sempre, mesmo zerado)

    // Buscar apurações do período
    const periodo = `${this.params.ano}-${padLeft(this.params.mes, 2)}`

    const apuracaoPIS = await prisma.apuracaoFiscal.findFirst({
      where: {
        empresaId: this.params.empresaId,
        tipo: 'PIS',
        periodo,
      },
      include: { detalhes: true },
    })

    const apuracaoCOFINS = await prisma.apuracaoFiscal.findFirst({
      where: {
        empresaId: this.params.empresaId,
        tipo: 'COFINS',
        periodo,
      },
      include: { detalhes: true },
    })

    // Buscar dados da empresa para determinar regime
    const empresa = await prisma.empresa.findUniqueOrThrow({
      where: { id: this.params.empresaId },
    })

    const regimeNaoCumulativo = empresa.regimeTributario === 3 // Lucro Real

    // === Apuração de PIS ===
    await this.gerarApuracaoPIS(apuracaoPIS, regimeNaoCumulativo)

    // === Apuração de COFINS ===
    await this.gerarApuracaoCOFINS(apuracaoCOFINS, regimeNaoCumulativo)

    // Registro M990 - Encerramento do Bloco M
    const totalBlocoM = (this.writer.getContadores()['M'] ?? 0) + 1
    this.writer.writeRegistro('M', 'M990', [String(totalBlocoM)])
  }

  private async gerarApuracaoPIS(apuracao: any, regimeNaoCumulativo: boolean): Promise<void> {
    const totalDebitos = Number(apuracao?.totalDebitos ?? 0)
    const totalCreditos = Number(apuracao?.totalCreditos ?? 0)
    const saldoAnterior = Number(apuracao?.saldoAnterior ?? 0)
    const valorRecolher = Number(apuracao?.valorRecolher ?? 0)

    // M200 - Consolidação da contribuição para o PIS
    this.writer.writeRegistro('M', 'M200', [
      formatDecimal(totalDebitos),   // VL_TOT_CONT_NC_PER (contribuição não-cumulativa)
      formatDecimal(0),               // VL_TOT_CRED_DESC
      formatDecimal(0),               // VL_TOT_CRED_DESC_ANT
      formatDecimal(totalCreditos),  // VL_TOT_CONT_NC_DEV
      formatDecimal(0),               // VL_RET_NC
      formatDecimal(0),               // VL_OUT_DED_NC
      formatDecimal(valorRecolher),  // VL_CONT_NC_REC
      formatDecimal(0),               // VL_TOT_CONT_CUM_PER (contribuição cumulativa)
      formatDecimal(0),               // VL_RET_CUM
      formatDecimal(0),               // VL_OUT_DED_CUM
      formatDecimal(0),               // VL_CONT_CUM_REC
      formatDecimal(valorRecolher),  // VL_TOT_CONT_REC (total a recolher)
    ])

    // M210 - Detalhamento da contribuição PIS (por CST)
    this.writer.writeRegistro('M', 'M210', [
      '01',                           // COD_CONT (01=não-cumulativa alíquota básica)
      formatDecimal(totalDebitos),   // VL_REC_BRT (receita bruta)
      formatDecimal(totalDebitos),   // VL_BC_CONT (base de cálculo)
      '1,6500',                       // ALIQ_PIS (1,65%)
      formatDecimal(totalDebitos * 0.0165), // VL_CONT_APUR (contribuição apurada)
      formatDecimal(0),               // VL_AJUS_ACRES
      formatDecimal(0),               // VL_AJUS_REDUC
      formatDecimal(totalDebitos * 0.0165), // VL_CONT_DIFER
      formatDecimal(totalDebitos * 0.0165), // VL_CONT_DIFER_ANT
      formatDecimal(totalDebitos * 0.0165), // VL_CONT_PER
    ])

    // M100 - Créditos de PIS (regime não-cumulativo) — Requirement 15.6
    if (regimeNaoCumulativo && totalCreditos > 0) {
      this.gerarCreditosPIS(apuracao)
    }
  }

  private gerarCreditosPIS(apuracao: any): void {
    // M100 - Crédito de PIS/Pasep relativo ao período
    // Detalha créditos por base de cálculo (Requirement 15.6)
    const creditos = apuracao?.detalhes?.filter((d: any) => d.tipo === 'CREDITO') ?? []

    if (creditos.length === 0) {
      // Gera ao menos um registro M100 consolidado se há crédito
      this.writer.writeRegistro('M', 'M100', [
        '01',                                   // COD_CRED (01=aquisição de bens para revenda)
        '0',                                    // IND_CRED_ORI (0=operações no mercado interno)
        formatDecimal(Number(apuracao.totalCreditos)), // VL_BC_PIS
        '1,6500',                               // ALIQ_PIS
        formatDecimal(Number(apuracao.totalCreditos) * 0.0165), // VL_CRED
        formatDecimal(Number(apuracao.totalCreditos) * 0.0165), // VL_CRED_DESC
        formatDecimal(0),                       // SLD_CRED
      ])
    } else {
      for (const credito of creditos) {
        this.writer.writeRegistro('M', 'M100', [
          '01',                              // COD_CRED
          '0',                               // IND_CRED_ORI
          formatDecimal(Number(credito.valor)), // VL_BC_PIS
          '1,6500',                          // ALIQ_PIS
          formatDecimal(Number(credito.valor) * 0.0165), // VL_CRED
          formatDecimal(Number(credito.valor) * 0.0165), // VL_CRED_DESC
          formatDecimal(0),                  // SLD_CRED
        ])
      }
    }
  }

  private async gerarApuracaoCOFINS(apuracao: any, regimeNaoCumulativo: boolean): Promise<void> {
    const totalDebitos = Number(apuracao?.totalDebitos ?? 0)
    const totalCreditos = Number(apuracao?.totalCreditos ?? 0)
    const valorRecolher = Number(apuracao?.valorRecolher ?? 0)

    // M600 - Consolidação da contribuição para COFINS
    this.writer.writeRegistro('M', 'M600', [
      formatDecimal(totalDebitos),   // VL_TOT_CONT_NC_PER
      formatDecimal(0),               // VL_TOT_CRED_DESC
      formatDecimal(0),               // VL_TOT_CRED_DESC_ANT
      formatDecimal(totalCreditos),  // VL_TOT_CONT_NC_DEV
      formatDecimal(0),               // VL_RET_NC
      formatDecimal(0),               // VL_OUT_DED_NC
      formatDecimal(valorRecolher),  // VL_CONT_NC_REC
      formatDecimal(0),               // VL_TOT_CONT_CUM_PER
      formatDecimal(0),               // VL_RET_CUM
      formatDecimal(0),               // VL_OUT_DED_CUM
      formatDecimal(0),               // VL_CONT_CUM_REC
      formatDecimal(valorRecolher),  // VL_TOT_CONT_REC
    ])

    // M610 - Detalhamento da COFINS (por CST)
    this.writer.writeRegistro('M', 'M610', [
      '01',                           // COD_CONT
      formatDecimal(totalDebitos),   // VL_REC_BRT
      formatDecimal(totalDebitos),   // VL_BC_CONT
      '7,6000',                       // ALIQ_COFINS (7,6%)
      formatDecimal(totalDebitos * 0.076), // VL_CONT_APUR
      formatDecimal(0),               // VL_AJUS_ACRES
      formatDecimal(0),               // VL_AJUS_REDUC
      formatDecimal(totalDebitos * 0.076), // VL_CONT_DIFER
      formatDecimal(totalDebitos * 0.076), // VL_CONT_DIFER_ANT
      formatDecimal(totalDebitos * 0.076), // VL_CONT_PER
    ])

    // M500 - Créditos de COFINS (regime não-cumulativo)
    if (regimeNaoCumulativo && totalCreditos > 0) {
      this.gerarCreditosCOFINS(apuracao)
    }
  }

  private gerarCreditosCOFINS(apuracao: any): void {
    // M500 - Crédito de COFINS relativo ao período
    const creditos = apuracao?.detalhes?.filter((d: any) => d.tipo === 'CREDITO') ?? []

    if (creditos.length === 0) {
      this.writer.writeRegistro('M', 'M500', [
        '01',                                   // COD_CRED
        '0',                                    // IND_CRED_ORI
        formatDecimal(Number(apuracao.totalCreditos)), // VL_BC_COFINS
        '7,6000',                               // ALIQ_COFINS
        formatDecimal(Number(apuracao.totalCreditos) * 0.076), // VL_CRED
        formatDecimal(Number(apuracao.totalCreditos) * 0.076), // VL_CRED_DESC
        formatDecimal(0),                       // SLD_CRED
      ])
    } else {
      for (const credito of creditos) {
        this.writer.writeRegistro('M', 'M500', [
          '01',                              // COD_CRED
          '0',                               // IND_CRED_ORI
          formatDecimal(Number(credito.valor)), // VL_BC_COFINS
          '7,6000',                          // ALIQ_COFINS
          formatDecimal(Number(credito.valor) * 0.076), // VL_CRED
          formatDecimal(Number(credito.valor) * 0.076), // VL_CRED_DESC
          formatDecimal(0),                  // SLD_CRED
        ])
      }
    }
  }

  // === Bloco 1: Complemento ===

  private gerarBloco1(): void {
    this.writer.writeRegistro('1', '1001', ['0']) // 0 = com dados

    // Registro 1010 - Processo referenciado (indicadores de complementos)
    this.writer.writeRegistro('1', '1010', [
      'N', // IND_NAT_REC (receitas auferidas)
      'N', // IND_ATIV (atividade)
      'N', // IND_INFO_COMPL (informações complementares)
    ])

    this.writer.writeRegistro('1', '1990', ['3'])
  }

  // === Utility methods ===

  private gerarNomeArquivo(): string {
    const mes = padLeft(this.params.mes, 2)
    const ano = this.params.ano
    return `EFD_CONTRIBUICOES_${ano}${mes}.txt`
  }
}

// === Exported singleton-like factory ===

export const spedContribuicoesGenerator = new SpedContribuicoesGenerator()
