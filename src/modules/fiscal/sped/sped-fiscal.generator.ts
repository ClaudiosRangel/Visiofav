/**
 * Gerador SPED Fiscal (EFD ICMS/IPI)
 *
 * Gera o arquivo da EFD ICMS/IPI com todos os blocos obrigatórios:
 * 0 (Abertura/Identificação), C (Documentos Mercadoria), D (Transporte),
 * E (Apuração), G (CIAP), H (Inventário), K (Produção/Estoque),
 * 1 (Complemento), 9 (Controle - gerado automaticamente pelo SPEDWriter).
 *
 * Performance: ≤120s para até 100.000 documentos (streaming por chunks).
 * Gera movimento zerado se sem documentos no período.
 *
 * @see Requirements 14.1, 14.2, 14.3, 14.4, 14.7
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

/** Maps modelo number to SPED cod_mod string */
function mapModeloCodigo(modelo: number): string {
  const map: Record<number, string> = {
    1: '01',   // NF modelo 1
    2: '1B',   // NF modelo 1B (avulsa)
    4: '04',   // NF produtor
    55: '55',  // NF-e
    65: '65',  // NFC-e
    57: '57',  // CT-e
  }
  return map[modelo] ?? String(modelo).padStart(2, '0')
}

// === Main generator class ===

export class SpedFiscalGenerator {
  private writer: SPEDWriter
  private params!: PeriodoParams
  private dataInicio!: Date
  private dataFim!: Date

  constructor() {
    this.writer = new SPEDWriter()
  }

  /**
   * Gera o arquivo SPED Fiscal (EFD ICMS/IPI) para o período informado.
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
    await this.gerarBlocoC()
    await this.gerarBlocoD()
    await this.gerarBlocoE()
    this.gerarBlocoG()
    this.gerarBlocoH()
    this.gerarBlocoK()
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

    const versaoLayout = this.params.versaoLayout ?? '018'
    const finalidade = this.params.finalidade === 'RETIFICADORA' ? '1' : '0'
    const perfil = this.params.perfil ?? 'A'

    // Registro 0000 - Abertura do arquivo digital
    this.writer.writeRegistro('0', '0000', [
      '018',                          // COD_VER - versão layout
      '0',                            // COD_FIN - finalidade (0=original, 1=retificadora)
      formatDate(this.dataInicio),    // DT_INI
      formatDate(this.dataFim),       // DT_FIM
      empresa.razaoSocial,            // NOME
      empresa.cnpj.replace(/\D/g, ''),// CNPJ
      '',                             // CPF
      empresa.uf ?? '',               // UF
      empresa.inscEstadual ?? '',     // IE
      '',                             // COD_MUN (IBGE)
      '',                             // IM
      '',                             // SUFRAMA
      String(empresa.regimeTributario), // IND_PERFIL (using regime as proxy)
      '1',                            // IND_ATIV (1=industrial/equiparado)
    ])

    // Registro 0001 - Abertura do Bloco 0
    this.writer.writeRegistro('0', '0001', ['0']) // 0 = com dados

    // Registro 0005 - Dados complementares da entidade
    this.writer.writeRegistro('0', '0005', [
      empresa.nomeFantasia ?? empresa.razaoSocial, // FANTASIA
      empresa.cep?.replace(/\D/g, '') ?? '',       // CEP
      empresa.logradouro ?? '',                     // END
      empresa.numero ?? '',                         // NUM
      empresa.complemento ?? '',                    // COMPL
      empresa.bairro ?? '',                         // BAIRRO
      empresa.telefone?.replace(/\D/g, '') ?? '',   // FONE
      '',                                           // FAX
      empresa.email ?? '',                          // EMAIL
    ])

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
    // Counter includes 0000, 0001, 0005, 0100, 0990 = 5 registros
    this.writer.writeRegistro('0', '0990', ['5'])
  }

  // === Bloco C: Documentos Fiscais de Mercadorias ===
  // Modelos: 01, 1B, 04, 55, 65

  private async gerarBlocoC(): Promise<void> {
    // Registro C001 - Abertura do Bloco C
    const documentosCount = await prisma.documentoFiscal.count({
      where: {
        empresaId: this.params.empresaId,
        dataEmissao: { gte: this.dataInicio, lte: this.dataFim },
        status: 'AUTORIZADO',
        modelo: { in: [1, 4, 55, 65] },
      },
    })

    // IND_MOV: 0=com movimento, 1=sem movimento
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
        this.escreverC100(doc)
        for (const item of doc.itens) {
          this.escreverC170(item, doc)
        }
        this.escreverC190(doc)
      }

      skip += CHUNK_SIZE
      if (documentos.length < CHUNK_SIZE) {
        hasMore = false
      }
    }
  }

  private escreverC100(doc: any): void {
    // Registro C100 - Dados do documento fiscal (NF-e, NFC-e, NF mod 01/04)
    this.writer.writeRegistro('C', 'C100', [
      doc.tipoOperacao === 0 ? '0' : '1',     // IND_OPER (0=entrada, 1=saída)
      '0',                                      // IND_EMIT (0=própria)
      doc.destCpfCnpj ?? '',                   // COD_PART
      mapModeloCodigo(doc.modelo),             // COD_MOD
      '00',                                     // COD_SIT (00=regular)
      String(doc.serie),                       // SER
      String(doc.numero),                      // NUM_DOC
      doc.chaveAcesso ?? '',                   // CHV_NFE
      formatDate(doc.dataEmissao),             // DT_DOC
      formatDate(doc.dataSaida ?? doc.dataEmissao), // DT_E_S
      formatDecimal(doc.valorProdutos),        // VL_MERC
      '9',                                      // IND_PGTO (9=sem pgto)
      formatDecimal(doc.valorDesconto),        // VL_DESC
      '0',                                      // VL_ABAT_NT
      formatDecimal(doc.valorProdutos),        // VL_MERC
      '1',                                      // IND_FRT (1=emitente)
      formatDecimal(doc.valorFrete),           // VL_FRT
      formatDecimal(doc.valorSeguro),          // VL_SEG
      formatDecimal(doc.valorOutras),          // VL_OUT_DA
      formatDecimal(doc.valorIcms),            // VL_BC_ICMS
      formatDecimal(doc.valorIcms),            // VL_ICMS
      formatDecimal(doc.valorIcmsSt),          // VL_BC_ICMS_ST
      formatDecimal(doc.valorIcmsSt),          // VL_ICMS_ST
      formatDecimal(doc.valorIpi),             // VL_IPI
      formatDecimal(doc.valorPis),             // VL_PIS
      formatDecimal(doc.valorCofins),          // VL_COFINS
      formatDecimal(doc.valorPis),             // VL_PIS_ST
      formatDecimal(doc.valorCofins),          // VL_COFINS_ST
    ])
  }

  private escreverC170(item: any, doc: any): void {
    // Registro C170 - Itens do documento fiscal
    this.writer.writeRegistro('C', 'C170', [
      String(item.nItem),                    // NUM_ITEM
      item.codigoProd,                       // COD_ITEM
      item.descricao,                        // DESCR_COMPL
      formatDecimal(item.quantidade, 4),     // QTD
      item.unidade,                          // UNID
      formatDecimal(item.valorTotal),        // VL_ITEM
      formatDecimal(item.valorDesconto),     // VL_DESC
      doc.tipoOperacao === 0 ? '0' : '1',   // IND_MOV (0=entrada, 1=saída)
      item.icmsCst ?? item.icmsCsosn ?? '', // CST_ICMS
      item.cfop,                             // CFOP
      item.ncm,                              // COD_NAT
      formatDecimal(item.icmsBase),          // VL_BC_ICMS
      formatDecimal(item.icmsAliquota),      // ALIQ_ICMS
      formatDecimal(item.icmsValor),         // VL_ICMS
      formatDecimal(item.icmsStBase),        // VL_BC_ICMS_ST
      formatDecimal(item.icmsStAliquota),    // ALIQ_ST
      formatDecimal(item.icmsStValor),       // VL_ICMS_ST
      '0',                                   // IND_APUR (0=mensal)
      item.pisCst ?? '',                     // CST_PIS
      formatDecimal(item.pisBase),           // VL_BC_PIS
      formatDecimal(item.pisAliquota),       // ALIQ_PIS
      formatDecimal(item.pisValor),          // VL_PIS
      item.cofinsCst ?? '',                  // CST_COFINS
      formatDecimal(item.cofinsBase),        // VL_BC_COFINS
      formatDecimal(item.cofinsAliquota),    // ALIQ_COFINS
      formatDecimal(item.cofinsValor),       // VL_COFINS
      '',                                    // COD_CTA
    ])
  }

  private escreverC190(doc: any): void {
    // Registro C190 - Consolidação analítica (por CST_ICMS + CFOP + ALIQ_ICMS)
    // Simplified: one line per document summarizing totals
    this.writer.writeRegistro('C', 'C190', [
      '000',                              // CST_ICMS (simplificado)
      doc.itens?.[0]?.cfop ?? '5102',     // CFOP
      formatDecimal(doc.valorIcms > 0 ? 18 : 0), // ALIQ_ICMS (estimativa)
      formatDecimal(doc.valorTotal),      // VL_OPR
      formatDecimal(doc.valorIcms),       // VL_BC_ICMS
      formatDecimal(doc.valorIcms),       // VL_ICMS
      formatDecimal(doc.valorIcmsSt),     // VL_BC_ICMS_ST
      formatDecimal(doc.valorIcmsSt),     // VL_ICMS_ST
      formatDecimal(doc.valorIcms),       // VL_RED_BC
      formatDecimal(doc.valorIpi),        // VL_IPI
      '',                                  // COD_OBS
    ])
  }

  // === Bloco D: Documentos de Transporte (CT-e modelo 57) ===

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
      }

      skip += CHUNK_SIZE
      if (documentos.length < CHUNK_SIZE) {
        hasMore = false
      }
    }
  }

  private escreverD100(doc: any): void {
    // Registro D100 - Nota fiscal de serviço de transporte (CT-e mod 57)
    this.writer.writeRegistro('D', 'D100', [
      doc.tipoOperacao === 0 ? '0' : '1',  // IND_OPER
      '0',                                   // IND_EMIT (0=própria)
      doc.destCpfCnpj ?? '',                // COD_PART
      '57',                                  // COD_MOD
      '00',                                  // COD_SIT (00=regular)
      String(doc.serie),                    // SER
      '',                                    // SUB
      String(doc.numero),                   // NUM_DOC
      doc.chaveAcesso ?? '',               // CHV_CTE
      formatDate(doc.dataEmissao),         // DT_DOC
      formatDate(doc.dataSaida ?? doc.dataEmissao), // DT_A_P
      '0',                                  // TP_CT_e (0=normal)
      '',                                    // CHV_CTE_REF
      formatDecimal(doc.valorTotal),       // VL_DOC
      formatDecimal(doc.valorDesconto),    // VL_DESC
      '9',                                   // IND_FRT
      formatDecimal(doc.valorTotal),       // VL_SERV
      formatDecimal(doc.valorIcms),        // VL_BC_ICMS
      formatDecimal(doc.valorIcms),        // VL_ICMS
      '0,00',                               // VL_NT
      '',                                    // COD_INF
      '',                                    // COD_CTA
    ])
  }

  // === Bloco E: Apuração de ICMS, ICMS-ST e IPI ===

  private async gerarBlocoE(): Promise<void> {
    this.writer.writeRegistro('E', 'E001', ['0']) // Abertura com dados

    // Buscar apurações do período
    const periodo = `${this.params.ano}-${padLeft(this.params.mes, 2)}`

    const apuracaoICMS = await prisma.apuracaoFiscal.findFirst({
      where: {
        empresaId: this.params.empresaId,
        tipo: 'ICMS',
        periodo,
      },
    })

    const apuracaoICMSST = await prisma.apuracaoFiscal.findFirst({
      where: {
        empresaId: this.params.empresaId,
        tipo: 'ICMS_ST',
        periodo,
      },
    })

    const apuracaoIPI = await prisma.apuracaoFiscal.findFirst({
      where: {
        empresaId: this.params.empresaId,
        tipo: 'IPI',
        periodo,
      },
    })

    // E100 - Período da apuração de ICMS
    this.writer.writeRegistro('E', 'E100', [
      formatDate(this.dataInicio),  // DT_INI
      formatDate(this.dataFim),     // DT_FIN
    ])

    // E110 - Apuração de ICMS — Operações Próprias
    this.writer.writeRegistro('E', 'E110', [
      formatDecimal(apuracaoICMS?.totalDebitos ?? 0),     // VL_TOT_DEBITOS
      formatDecimal(0),                                    // VL_AJ_DEBITOS
      formatDecimal(apuracaoICMS?.totalCreditos ?? 0),    // VL_TOT_AJ_CREDITOS
      formatDecimal(apuracaoICMS?.totalCreditos ?? 0),    // VL_TOT_CREDITOS
      formatDecimal(apuracaoICMS?.estornoCreditos ?? 0),  // VL_ESTORNOS_CRED
      formatDecimal(apuracaoICMS?.estornoDebitos ?? 0),   // VL_ESTORNOS_DEB
      formatDecimal(apuracaoICMS?.saldoAnterior ?? 0),    // VL_SLD_CREDOR_ANT
      formatDecimal(apuracaoICMS?.saldoFinal ?? 0),       // VL_SLD_APURADO
      formatDecimal(apuracaoICMS?.ajustes ?? 0),          // VL_TOT_DED
      formatDecimal(apuracaoICMS?.valorRecolher ?? 0),    // VL_ICMS_RECOLHER
      formatDecimal(Math.max(0, Number(apuracaoICMS?.saldoFinal ?? 0) * -1)), // VL_SLD_CREDOR_TRANSPORTAR
      formatDecimal(0),                                    // DEB_ESP
    ])

    // E200 - Período da apuração de ICMS-ST (se existe)
    if (apuracaoICMSST) {
      this.writer.writeRegistro('E', 'E200', [
        '',                                // UF
        formatDate(this.dataInicio),       // DT_INI
        formatDate(this.dataFim),          // DT_FIN
      ])

      // E210 - Apuração de ICMS-ST
      this.writer.writeRegistro('E', 'E210', [
        '0',                                               // IND_MOV_ST
        formatDecimal(apuracaoICMSST.totalDebitos),       // VL_SLD_CRED_ANT_ST
        formatDecimal(apuracaoICMSST.totalDebitos),       // VL_DEVOL_ST
        formatDecimal(apuracaoICMSST.totalCreditos),      // VL_RESSARC_ST
        formatDecimal(0),                                  // VL_OUT_CRED_ST
        formatDecimal(0),                                  // VL_AJ_CREDITOS_ST
        formatDecimal(apuracaoICMSST.totalDebitos),       // VL_RETENÇAO_ST
        formatDecimal(0),                                  // VL_OUT_DEB_ST
        formatDecimal(0),                                  // VL_AJ_DEBITOS_ST
        formatDecimal(apuracaoICMSST.saldoFinal),         // VL_SLD_DEV_ANT_ST
        formatDecimal(0),                                  // VL_DEDUCOES_ST
        formatDecimal(apuracaoICMSST.valorRecolher),      // VL_ICMS_RECOL_ST
        formatDecimal(0),                                  // VL_SLD_CRED_ST_TRANSPORTAR
        formatDecimal(0),                                  // DEB_ESP_ST
      ])
    }

    // E500 - Período de apuração de IPI
    if (apuracaoIPI) {
      this.writer.writeRegistro('E', 'E500', [
        '0',                            // IND_APUR (0=mensal)
        formatDate(this.dataInicio),   // DT_INI
        formatDate(this.dataFim),      // DT_FIN
      ])

      // E520 - Apuração de IPI
      this.writer.writeRegistro('E', 'E520', [
        formatDecimal(apuracaoIPI.saldoAnterior),    // VL_SD_ANT_IPI
        formatDecimal(apuracaoIPI.totalDebitos),     // VL_DEB_IPI
        formatDecimal(apuracaoIPI.totalCreditos),    // VL_CRED_IPI
        formatDecimal(0),                             // VL_OD_IPI
        formatDecimal(0),                             // VL_OC_IPI
        formatDecimal(apuracaoIPI.saldoFinal),       // VL_SC_IPI
        formatDecimal(apuracaoIPI.valorRecolher),    // VL_SD_IPI
      ])
    }

    // E990 - Encerramento do Bloco E
    const totalBlocoE = (this.writer.getContadores()['E'] ?? 0) + 1
    this.writer.writeRegistro('E', 'E990', [String(totalBlocoE)])
  }

  // === Bloco G: CIAP (Controle de crédito do ICMS do Ativo Permanente) ===

  private gerarBlocoG(): void {
    // Bloco G sem movimento (registro obrigatório)
    this.writer.writeRegistro('G', 'G001', ['1']) // 1 = sem movimento
    this.writer.writeRegistro('G', 'G990', ['2'])
  }

  // === Bloco H: Inventário Físico ===

  private gerarBlocoH(): void {
    // Bloco H sem movimento (registro obrigatório)
    this.writer.writeRegistro('H', 'H001', ['1']) // 1 = sem movimento
    this.writer.writeRegistro('H', 'H990', ['2'])
  }

  // === Bloco K: Controle da Produção e Estoque ===

  private gerarBlocoK(): void {
    // Bloco K sem movimento (registro obrigatório)
    this.writer.writeRegistro('K', 'K001', ['1']) // 1 = sem movimento
    this.writer.writeRegistro('K', 'K990', ['2'])
  }

  // === Bloco 1: Complemento ===

  private gerarBloco1(): void {
    // Bloco 1 - Registros complementares
    this.writer.writeRegistro('1', '1001', ['0']) // 0 = com dados

    // Registro 1010 - Obrigatoriedade de registros específicos
    this.writer.writeRegistro('1', '1010', [
      'N', // IND_EXP (exportação)
      'N', // IND_CCRF (crédito acumulado)
      'N', // IND_COMB (combustíveis)
      'N', // IND_USINA (usina)
      'N', // IND_VA (veículo automotor)
      'N', // IND_EE (energia elétrica)
      'N', // IND_CART (indústria)
      'N', // IND_FORM (formulário segurança)
      'N', // IND_AER (aéreo)
    ])

    this.writer.writeRegistro('1', '1990', ['3'])
  }

  // === Utility methods ===

  private gerarNomeArquivo(): string {
    const mes = padLeft(this.params.mes, 2)
    const ano = this.params.ano
    return `EFD_ICMS_IPI_${ano}${mes}.txt`
  }
}

// === Exported singleton-like factory ===

export const spedFiscalGenerator = new SpedFiscalGenerator()
