/**
 * Gerador SPED ECF (Escrituração Contábil Fiscal)
 *
 * Gera o arquivo da ECF com blocos obrigatórios:
 * 0 (Abertura/Identificação), C (Info contábil recuperada da ECD),
 * J (Mapa Econômico), K (Balanço Patrimonial),
 * L (Lucro Líquido - Lucro Real), M (Livro LALUR),
 * N (Cálculo IRPJ/CSLL), 9 (Controle - auto-gerado pelo SPEDWriter).
 *
 * Suporta regimes: Lucro Real e Lucro Presumido.
 * Recupera dados da ECD para blocos contábeis.
 *
 * @see Requirements 17.1, 17.2, 17.3
 */

import { prisma } from '../../../lib/prisma'
import { SPEDWriter } from './sped-writer'
import type { PeriodoParams, ArquivoSPED } from './tipos'

// === Enums e tipos internos ===

export enum RegimeTributarioECF {
  LUCRO_REAL = 1,
  LUCRO_PRESUMIDO = 2,
  LUCRO_ARBITRADO = 3,
}

export enum FormaApuracaoIRPJ {
  ANUAL = 'A',
  TRIMESTRAL = 'T',
}

/**
 * Dados contábeis recuperados da ECD para composição da ECF
 */
export interface DadosECD {
  planoContas: ContaECD[]
  saldos: SaldoContaECD[]
}

export interface ContaECD {
  codigo: string
  descricao: string
  tipo: 'S' | 'A' // S=sintética, A=analítica
  natureza: '01' | '02' | '03' | '04' | '05' | '09'
  // 01=Ativo, 02=Passivo, 03=PL, 04=Resultado, 05=Comp., 09=Outras
}

export interface SaldoContaECD {
  codigoConta: string
  saldoInicial: number
  debitos: number
  creditos: number
  saldoFinal: number
}

/**
 * Dados de apuração IRPJ/CSLL
 */
export interface ApuracaoIRPJCSLL {
  regime: RegimeTributarioECF
  // Lucro Real
  lucroLiquido?: number
  adicoes?: number
  exclusoes?: number
  lucroReal?: number
  // Lucro Presumido
  receitaBruta?: number
  percentualPresuncao?: number
  basePresumida?: number
  // IRPJ
  baseCalculoIRPJ: number
  aliquotaIRPJ: number
  valorIRPJ: number
  adicionalIRPJ: number // 10% sobre excedente de R$20.000/mês
  // CSLL
  baseCalculoCSLL: number
  aliquotaCSLL: number
  valorCSLL: number
}

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

// === Percentuais de presunção do Lucro Presumido ===

const PERCENTUAIS_PRESUNCAO_IRPJ: Record<string, number> = {
  COMERCIO: 8,
  INDUSTRIA: 8,
  SERVICOS: 32,
  TRANSPORTE_CARGA: 8,
  TRANSPORTE_PASSAGEIROS: 16,
  SERVICOS_HOSPITALARES: 8,
  REVENDA_COMBUSTIVEIS: 1.6,
}

const PERCENTUAIS_PRESUNCAO_CSLL: Record<string, number> = {
  COMERCIO: 12,
  INDUSTRIA: 12,
  SERVICOS: 32,
  TRANSPORTE_CARGA: 12,
  TRANSPORTE_PASSAGEIROS: 12,
  SERVICOS_HOSPITALARES: 12,
  REVENDA_COMBUSTIVEIS: 12,
}

// Alíquotas IRPJ e CSLL
const ALIQUOTA_IRPJ = 15 // 15%
const ALIQUOTA_ADICIONAL_IRPJ = 10 // 10% sobre excedente
const LIMITE_ADICIONAL_MENSAL = 20000 // R$ 20.000/mês
const ALIQUOTA_CSLL_GERAL = 9 // 9%

// === Main generator class ===

export class SpedECFGenerator {
  private writer: SPEDWriter
  private params!: PeriodoParams
  private dataInicio!: Date
  private dataFim!: Date
  private regime!: RegimeTributarioECF
  private dadosECD: DadosECD = { planoContas: [], saldos: [] }
  private apuracao!: ApuracaoIRPJCSLL

  constructor() {
    this.writer = new SPEDWriter()
  }

  /**
   * Gera o arquivo SPED ECF para o período informado.
   * Recupera dados da ECD e calcula IRPJ/CSLL conforme regime.
   */
  async gerar(params: PeriodoParams): Promise<ArquivoSPED> {
    this.params = params
    this.writer = new SPEDWriter()

    // Período anual (ECF é anual, usa ano do params)
    this.dataInicio = new Date(params.ano, 0, 1)
    this.dataFim = new Date(params.ano, 11, 31, 23, 59, 59, 999)

    // Carrega dados da empresa e determina regime
    const empresa = await prisma.empresa.findUniqueOrThrow({
      where: { id: params.empresaId },
    })
    this.regime = this.mapRegimeTributario(empresa.regimeTributario)

    // Recupera dados da ECD (Req 17.3)
    this.dadosECD = await this.recuperarDadosECD()

    // Calcula apuração IRPJ/CSLL (Req 17.2)
    this.apuracao = await this.calcularApuracaoIRPJCSLL()

    // Gera blocos na ordem obrigatória
    await this.gerarBloco0(empresa)
    this.gerarBlocoC()
    this.gerarBlocoJ()
    this.gerarBlocoK()
    this.gerarBlocoL()
    this.gerarBlocoM()
    this.gerarBlocoN()

    // Bloco 9 gerado automaticamente pelo SPEDWriter.finalize()
    const conteudo = this.writer.finalize()
    const blocos = this.writer.getContadores()

    return {
      conteudo,
      nomeArquivo: this.gerarNomeArquivo(),
      totalRegistros: conteudo
        .toString('latin1')
        .split('\r\n')
        .filter((l) => l.length > 0).length,
      blocos,
      valido: true,
    }
  }

  // === Bloco 0: Abertura e Identificação ===

  private async gerarBloco0(empresa: any): Promise<void> {
    const versaoLayout = this.params.versaoLayout ?? '010'
    const tipoECF = this.regime === RegimeTributarioECF.LUCRO_REAL ? '1' : '2'

    // 0000 - Abertura do arquivo
    this.writer.writeRegistro('0', '0000', [
      'LECF',                                    // COD_VER (leiaute ECF)
      versaoLayout,                              // COD_VER_LAYOUT
      '0',                                       // TIPO_ESCR (0=original)
      this.params.finalidade === 'RETIFICADORA' ? '1' : '0', // IND_SIT_INI_PER
      '',                                        // HASH_ECF_ANTERIOR
      formatDate(this.dataInicio),               // DT_INI
      formatDate(this.dataFim),                  // DT_FIN
      empresa.razaoSocial,                       // NOME
      empresa.cnpj?.replace(/\D/g, '') ?? '',    // CNPJ
      empresa.uf ?? '',                          // UF
      '',                                        // COD_MUN (IBGE)
      '',                                        // IM (Inscr. Municipal)
      empresa.inscEstadual ?? '',                // IE
      tipoECF,                                   // TIPO_ECF
      '',                                        // COD_SCP (Soc. em Conta Particip.)
    ])

    // 0001 - Abertura do Bloco 0
    this.writer.writeRegistro('0', '0001', ['0']) // 0 = com dados

    // 0010 - Parâmetros de tributação
    const formaApuracao = FormaApuracaoIRPJ.TRIMESTRAL
    this.writer.writeRegistro('0', '0010', [
      String(this.regime),                       // COD_FORMA_TRIB (1=Real, 2=Presumido)
      formaApuracao,                             // FORMA_APUR (A=Anual, T=Trimestral)
      '',                                        // COD_QTD_SCP
      'N',                                       // TIP_ENT (N=Normal)
      'N',                                       // FORMA_TRIB_PER (não aplica)
      'N',                                       // MES_BAL_RED (não aplica)
      'N',                                       // TIP_ESC_PRE (não aplica)
      '',                                        // TIP_ENT_ESCP
      'N',                                       // IND_PJ_HAB
      'N',                                       // IND_PART_CONS
      'N',                                       // IND_OP_EXT
      'N',                                       // IND_PJ_ADM_GRP
      'N',                                       // IND_REC_EXT
      'N',                                       // IND_ATIV_RURAL
      'N',                                       // IND_LUC_EXP
      'N',                                       // IND_RED_ISEN
      'N',                                       // IND_FIN
      'N',                                       // IND_DOA_ELEIT
      'N',                                       // IND_PAR_EXT
      'N',                                       // IND_DEREX
      'N',                                       // IND_PJ_MOD
    ])

    // 0020 - Parâmetros complementares
    this.writer.writeRegistro('0', '0020', [
      'N',   // IND_ALIQ_CSLL (N = não aplicável)
      'N',   // IND_QTE_SCP
      'N',   // DT_TRANS_CSLL
      'N',   // IND_ADM_FUN_CLU
      'N',   // IND_PART_COLIG
      'N',   // IND_PJ_SIGILOSA
      'N',   // IND_PGTO_EXT
      'N',   // IND_ATVD_EXT
    ])

    // 0990 - Encerramento do Bloco 0
    const qtdLinhasBloco0 = 4 // 0000 + 0001 + 0010 + 0020 + 0990
    this.writer.writeRegistro('0', '0990', [String(qtdLinhasBloco0 + 1)])
  }

  // === Bloco C: Informações contábeis recuperadas da ECD ===

  private gerarBlocoC(): void {
    const temDados = this.dadosECD.planoContas.length > 0

    // C001 - Abertura do Bloco C
    this.writer.writeRegistro('C', 'C001', [temDados ? '0' : '1'])

    if (temDados) {
      // C050 - Plano de contas societário recuperado da ECD
      for (const conta of this.dadosECD.planoContas) {
        this.writer.writeRegistro('C', 'C050', [
          formatDate(this.dataInicio),   // DT_ALT
          conta.codigo,                  // COD_CTA
          conta.descricao,               // NOME_CTA
        ])
      }

      // C150 - Saldos periódicos recuperados da ECD
      for (const saldo of this.dadosECD.saldos) {
        this.writer.writeRegistro('C', 'C150', [
          formatDate(this.dataInicio),          // DT_INI
          formatDate(this.dataFim),             // DT_FIN
          saldo.codigoConta,                    // COD_CTA
          formatDecimal(saldo.saldoInicial),    // VL_SLD_INI
          'D',                                  // IND_DC_INI
          formatDecimal(saldo.debitos),         // VL_DEB
          formatDecimal(saldo.creditos),        // VL_CRED
          formatDecimal(saldo.saldoFinal),      // VL_SLD_FIN
          'D',                                  // IND_DC_FIN
        ])
      }
    }

    // C990 - Encerramento do Bloco C
    const qtdRegistrosC = 1 + (temDados
      ? this.dadosECD.planoContas.length + this.dadosECD.saldos.length
      : 0) + 1
    this.writer.writeRegistro('C', 'C990', [String(qtdRegistrosC)])
  }

  // === Bloco J: Mapa Econômico ===

  private gerarBlocoJ(): void {
    // J001 - Abertura do Bloco J
    this.writer.writeRegistro('J', 'J001', ['0'])

    // J050 - Plano de contas do mapa econômico
    this.writer.writeRegistro('J', 'J050', [
      formatDate(this.dataInicio),  // DT_ALT
      '01',                         // COD_NAT (01=Ativo)
      'S',                          // IND_CTA (S=Sintética)
      '1',                          // NIVEL
      '1',                          // COD_CTA
      'ATIVO TOTAL',                // NOME_CTA
    ])

    this.writer.writeRegistro('J', 'J050', [
      formatDate(this.dataInicio),
      '02',                         // COD_NAT (02=Passivo)
      'S',
      '1',
      '2',
      'PASSIVO TOTAL',
    ])

    this.writer.writeRegistro('J', 'J050', [
      formatDate(this.dataInicio),
      '04',                         // COD_NAT (04=Resultado)
      'S',
      '1',
      '3',
      'RESULTADO DO EXERCICIO',
    ])

    // J990 - Encerramento do Bloco J
    this.writer.writeRegistro('J', 'J990', ['5']) // J001 + 3×J050 + J990
  }

  // === Bloco K: Balanço Patrimonial ===

  private gerarBlocoK(): void {
    // K001 - Abertura do Bloco K
    this.writer.writeRegistro('K', 'K001', ['0'])

    // K030 - Período do balanço
    this.writer.writeRegistro('K', 'K030', [
      formatDate(this.dataInicio),     // DT_INI
      formatDate(this.dataFim),        // DT_FIN
    ])

    // K155 - Saldos do balanço (simplificado - soma de ativos/passivos)
    const totalAtivos = this.dadosECD.saldos
      .filter(s => {
        const conta = this.dadosECD.planoContas.find(c => c.codigo === s.codigoConta)
        return conta?.natureza === '01'
      })
      .reduce((sum, s) => sum + s.saldoFinal, 0)

    const totalPassivos = this.dadosECD.saldos
      .filter(s => {
        const conta = this.dadosECD.planoContas.find(c => c.codigo === s.codigoConta)
        return conta?.natureza === '02' || conta?.natureza === '03'
      })
      .reduce((sum, s) => sum + s.saldoFinal, 0)

    this.writer.writeRegistro('K', 'K155', [
      '1',                              // COD_CTA (Ativo)
      formatDecimal(totalAtivos),       // VL_SLD_FIN
      'D',                              // IND_DC
    ])

    this.writer.writeRegistro('K', 'K155', [
      '2',                              // COD_CTA (Passivo)
      formatDecimal(totalPassivos),     // VL_SLD_FIN
      'C',                              // IND_DC
    ])

    // K990 - Encerramento do Bloco K
    this.writer.writeRegistro('K', 'K990', ['5']) // K001 + K030 + 2×K155 + K990
  }

  // === Bloco L: Lucro Líquido (Lucro Real) ===

  private gerarBlocoL(): void {
    const isLucroReal = this.regime === RegimeTributarioECF.LUCRO_REAL

    // L001 - Abertura do Bloco L
    this.writer.writeRegistro('L', 'L001', [isLucroReal ? '0' : '1'])

    if (isLucroReal) {
      // L030 - Período de apuração
      this.writer.writeRegistro('L', 'L030', [
        formatDate(this.dataInicio),   // DT_INI
        formatDate(this.dataFim),      // DT_FIN
      ])

      // L100 - Balanço (DRE simplificado)
      this.writer.writeRegistro('L', 'L100', [
        'L100_01',                                         // CODIGO
        'LUCRO LIQUIDO DO EXERCICIO',                      // DESCRICAO
        '1',                                               // TIPO (1=Receita)
        'A',                                               // IND_CTA (A=Analítica)
        '1',                                               // NIVEL
        formatDecimal(this.apuracao.lucroLiquido ?? 0),    // VALOR
      ])

      // L300 - Demonstração do lucro líquido
      this.writer.writeRegistro('L', 'L300', [
        formatDecimal(this.apuracao.lucroLiquido ?? 0),  // VL_LUC_LIQ
      ])
    }

    // L990 - Encerramento do Bloco L
    const qtdL = isLucroReal ? 5 : 2 // L001 + (L030 + L100 + L300) + L990
    this.writer.writeRegistro('L', 'L990', [String(qtdL)])
  }

  // === Bloco M: Livro LALUR/LACS (Lucro Real) ===

  private gerarBlocoM(): void {
    const isLucroReal = this.regime === RegimeTributarioECF.LUCRO_REAL

    // M001 - Abertura do Bloco M
    this.writer.writeRegistro('M', 'M001', [isLucroReal ? '0' : '1'])

    if (isLucroReal) {
      // M030 - Período do LALUR
      this.writer.writeRegistro('M', 'M030', [
        formatDate(this.dataInicio),   // DT_INI
        formatDate(this.dataFim),      // DT_FIN
      ])

      // M300 - LALUR - Demonstração do Lucro Real (Parte A)
      // Lucro líquido antes do IRPJ
      this.writer.writeRegistro('M', 'M300', [
        'M300_01',                                         // CODIGO
        'LUCRO LIQUIDO ANTES DO IRPJ',                     // DESCRICAO
        'L',                                               // TIPO_LANCAMENTO (L=Lucro)
        formatDecimal(this.apuracao.lucroLiquido ?? 0),    // VALOR
      ])

      // Adições
      if ((this.apuracao.adicoes ?? 0) > 0) {
        this.writer.writeRegistro('M', 'M300', [
          'M300_02',
          'ADICOES',
          'A',                                            // A=Adição
          formatDecimal(this.apuracao.adicoes ?? 0),
        ])
      }

      // Exclusões
      if ((this.apuracao.exclusoes ?? 0) > 0) {
        this.writer.writeRegistro('M', 'M300', [
          'M300_03',
          'EXCLUSOES',
          'E',                                            // E=Exclusão
          formatDecimal(this.apuracao.exclusoes ?? 0),
        ])
      }

      // Lucro Real
      this.writer.writeRegistro('M', 'M300', [
        'M300_99',
        'LUCRO REAL',
        'R',                                              // R=Resultado
        formatDecimal(this.apuracao.lucroReal ?? 0),
      ])
    }

    // M990 - Encerramento do Bloco M
    const qtdM = isLucroReal ? this.calcQtdBlocoM() : 2
    this.writer.writeRegistro('M', 'M990', [String(qtdM)])
  }

  private calcQtdBlocoM(): number {
    // M001 + M030 + M300(lucro) + M300(adições?) + M300(exclusões?) + M300(resultado) + M990
    let qtd = 4 // M001 + M030 + M300(lucro) + M300(resultado) + M990 = min 5
    if ((this.apuracao.adicoes ?? 0) > 0) qtd++
    if ((this.apuracao.exclusoes ?? 0) > 0) qtd++
    return qtd + 1 // +1 para M990
  }

  // === Bloco N: Cálculo do IRPJ e CSLL ===

  private gerarBlocoN(): void {
    // N001 - Abertura do Bloco N
    this.writer.writeRegistro('N', 'N001', ['0'])

    // N030 - Período de apuração
    this.writer.writeRegistro('N', 'N030', [
      formatDate(this.dataInicio),   // DT_INI
      formatDate(this.dataFim),      // DT_FIN
    ])

    if (this.regime === RegimeTributarioECF.LUCRO_PRESUMIDO) {
      // N500 - Base de cálculo IRPJ - Lucro Presumido
      this.writer.writeRegistro('N', 'N500', [
        formatDecimal(this.apuracao.receitaBruta ?? 0),          // VL_REC_BRT
        formatDecimal((this.apuracao.percentualPresuncao ?? 0)), // PERC_PRESUNCAO
        formatDecimal(this.apuracao.basePresumida ?? 0),         // VL_BASE_PRES
      ])

      // N600 - IRPJ Lucro Presumido
      this.writer.writeRegistro('N', 'N600', [
        formatDecimal(this.apuracao.baseCalculoIRPJ),   // VL_BC_IRPJ
        formatDecimal(this.apuracao.aliquotaIRPJ),      // ALIQ_IRPJ
        formatDecimal(this.apuracao.valorIRPJ),         // VL_IRPJ
        formatDecimal(this.apuracao.adicionalIRPJ),     // VL_ADIC
      ])

      // N650 - CSLL Lucro Presumido
      this.writer.writeRegistro('N', 'N650', [
        formatDecimal(this.apuracao.baseCalculoCSLL),    // VL_BC_CSLL
        formatDecimal(this.apuracao.aliquotaCSLL),       // ALIQ_CSLL
        formatDecimal(this.apuracao.valorCSLL),          // VL_CSLL
      ])
    } else {
      // Lucro Real
      // N500 - Base de cálculo IRPJ - Lucro Real
      this.writer.writeRegistro('N', 'N500', [
        formatDecimal(this.apuracao.lucroReal ?? 0),    // VL_LUCRO_REAL
        '',                                             // (sem presunção)
        formatDecimal(this.apuracao.baseCalculoIRPJ),   // VL_BC_IRPJ
      ])

      // N600 - IRPJ Lucro Real
      this.writer.writeRegistro('N', 'N600', [
        formatDecimal(this.apuracao.baseCalculoIRPJ),   // VL_BC_IRPJ
        formatDecimal(this.apuracao.aliquotaIRPJ),      // ALIQ_IRPJ
        formatDecimal(this.apuracao.valorIRPJ),         // VL_IRPJ
        formatDecimal(this.apuracao.adicionalIRPJ),     // VL_ADIC
      ])

      // N650 - CSLL Lucro Real
      this.writer.writeRegistro('N', 'N650', [
        formatDecimal(this.apuracao.baseCalculoCSLL),    // VL_BC_CSLL
        formatDecimal(this.apuracao.aliquotaCSLL),       // ALIQ_CSLL
        formatDecimal(this.apuracao.valorCSLL),          // VL_CSLL
      ])
    }

    // N990 - Encerramento do Bloco N
    this.writer.writeRegistro('N', 'N990', ['6']) // N001+N030+N500+N600+N650+N990
  }

  // === Métodos auxiliares ===

  /**
   * Recupera dados da ECD (plano de contas e saldos) para compor
   * os blocos contábeis da ECF (Req 17.3).
   */
  private async recuperarDadosECD(): Promise<DadosECD> {
    // Busca dados contábeis do período via tabela de apuração
    // Na prática, seriam lidos de um arquivo ECD gerado anteriormente.
    // Aqui simulamos com dados do plano de contas padrão.
    const apuracoes = await prisma.apuracaoFiscal.findMany({
      where: {
        empresaId: this.params.empresaId,
        periodo: {
          startsWith: String(this.params.ano),
        },
      },
    })

    // Monta plano de contas mínimo baseado nas apurações disponíveis
    const planoContas: ContaECD[] = [
      { codigo: '1', descricao: 'ATIVO', tipo: 'S', natureza: '01' },
      { codigo: '1.1', descricao: 'ATIVO CIRCULANTE', tipo: 'S', natureza: '01' },
      { codigo: '2', descricao: 'PASSIVO', tipo: 'S', natureza: '02' },
      { codigo: '2.1', descricao: 'PASSIVO CIRCULANTE', tipo: 'S', natureza: '02' },
      { codigo: '3', descricao: 'PATRIMONIO LIQUIDO', tipo: 'S', natureza: '03' },
      { codigo: '4', descricao: 'RECEITAS', tipo: 'S', natureza: '04' },
      { codigo: '5', descricao: 'DESPESAS', tipo: 'S', natureza: '04' },
    ]

    // Saldos calculados a partir das apurações existentes
    const totalDebitos = apuracoes.reduce(
      (sum, a) => sum + Number(a.totalDebitos ?? 0), 0
    )
    const totalCreditos = apuracoes.reduce(
      (sum, a) => sum + Number(a.totalCreditos ?? 0), 0
    )

    const saldos: SaldoContaECD[] = [
      {
        codigoConta: '1',
        saldoInicial: 0,
        debitos: totalDebitos,
        creditos: 0,
        saldoFinal: totalDebitos,
      },
      {
        codigoConta: '2',
        saldoInicial: 0,
        debitos: 0,
        creditos: totalCreditos,
        saldoFinal: totalCreditos,
      },
      {
        codigoConta: '4',
        saldoInicial: 0,
        debitos: 0,
        creditos: totalCreditos,
        saldoFinal: totalCreditos,
      },
      {
        codigoConta: '5',
        saldoInicial: 0,
        debitos: totalDebitos,
        creditos: 0,
        saldoFinal: totalDebitos,
      },
    ]

    return { planoContas, saldos }
  }

  /**
   * Calcula apuração de IRPJ e CSLL conforme regime tributário (Req 17.2).
   */
  private async calcularApuracaoIRPJCSLL(): Promise<ApuracaoIRPJCSLL> {
    if (this.regime === RegimeTributarioECF.LUCRO_PRESUMIDO) {
      return this.calcularLucroPresumido()
    }
    return this.calcularLucroReal()
  }

  private async calcularLucroPresumido(): Promise<ApuracaoIRPJCSLL> {
    // Busca receita bruta do período (soma de documentos de saída)
    const docs = await prisma.documentoFiscal.findMany({
      where: {
        empresaId: this.params.empresaId,
        tipoOperacao: 1, // Saída
        status: 'AUTORIZADO',
        dataEmissao: {
          gte: this.dataInicio,
          lte: this.dataFim,
        },
      },
      select: { valorTotal: true },
    })

    const receitaBruta = docs.reduce(
      (sum, d) => sum + Number(d.valorTotal ?? 0), 0
    )

    // Presunção padrão para comércio/indústria
    const percPresuncaoIRPJ = PERCENTUAIS_PRESUNCAO_IRPJ.COMERCIO / 100
    const percPresuncaoCSLL = PERCENTUAIS_PRESUNCAO_CSLL.COMERCIO / 100

    const baseIRPJ = receitaBruta * percPresuncaoIRPJ
    const baseCSLL = receitaBruta * percPresuncaoCSLL

    // IRPJ: 15% + adicional de 10% sobre excedente de R$60.000/trimestre
    const valorIRPJ = baseIRPJ * (ALIQUOTA_IRPJ / 100)
    const mesesPeriodo = 12 // ECF anual
    const limiteAdicional = LIMITE_ADICIONAL_MENSAL * mesesPeriodo
    const adicionalIRPJ = baseIRPJ > limiteAdicional
      ? (baseIRPJ - limiteAdicional) * (ALIQUOTA_ADICIONAL_IRPJ / 100)
      : 0

    // CSLL: 9%
    const valorCSLL = baseCSLL * (ALIQUOTA_CSLL_GERAL / 100)

    return {
      regime: RegimeTributarioECF.LUCRO_PRESUMIDO,
      receitaBruta,
      percentualPresuncao: percPresuncaoIRPJ * 100,
      basePresumida: baseIRPJ,
      baseCalculoIRPJ: baseIRPJ,
      aliquotaIRPJ: ALIQUOTA_IRPJ,
      valorIRPJ: Math.round(valorIRPJ * 100) / 100,
      adicionalIRPJ: Math.round(adicionalIRPJ * 100) / 100,
      baseCalculoCSLL: baseCSLL,
      aliquotaCSLL: ALIQUOTA_CSLL_GERAL,
      valorCSLL: Math.round(valorCSLL * 100) / 100,
    }
  }

  private async calcularLucroReal(): Promise<ApuracaoIRPJCSLL> {
    // Busca receitas e despesas do período
    const docsReceita = await prisma.documentoFiscal.findMany({
      where: {
        empresaId: this.params.empresaId,
        tipoOperacao: 1, // Saída
        status: 'AUTORIZADO',
        dataEmissao: { gte: this.dataInicio, lte: this.dataFim },
      },
      select: { valorTotal: true },
    })

    const receitaBruta = docsReceita.reduce(
      (sum, d) => sum + Number(d.valorTotal ?? 0), 0
    )

    // Lucro líquido simplificado (receita - custos estimados)
    // Na prática viria da contabilidade (ECD)
    const custos = this.dadosECD.saldos
      .filter(s => s.codigoConta === '5')
      .reduce((sum, s) => sum + s.saldoFinal, 0)

    const lucroLiquido = receitaBruta - custos
    const adicoes = 0  // Sem adições por padrão
    const exclusoes = 0 // Sem exclusões por padrão
    const lucroReal = lucroLiquido + adicoes - exclusoes

    const baseIRPJ = Math.max(lucroReal, 0) // IRPJ não aplica sobre prejuízo
    const baseCSLL = Math.max(lucroReal, 0)

    // IRPJ: 15% + adicional 10%
    const valorIRPJ = baseIRPJ * (ALIQUOTA_IRPJ / 100)
    const mesesPeriodo = 12
    const limiteAdicional = LIMITE_ADICIONAL_MENSAL * mesesPeriodo
    const adicionalIRPJ = baseIRPJ > limiteAdicional
      ? (baseIRPJ - limiteAdicional) * (ALIQUOTA_ADICIONAL_IRPJ / 100)
      : 0

    // CSLL: 9%
    const valorCSLL = baseCSLL * (ALIQUOTA_CSLL_GERAL / 100)

    return {
      regime: RegimeTributarioECF.LUCRO_REAL,
      lucroLiquido,
      adicoes,
      exclusoes,
      lucroReal,
      baseCalculoIRPJ: baseIRPJ,
      aliquotaIRPJ: ALIQUOTA_IRPJ,
      valorIRPJ: Math.round(valorIRPJ * 100) / 100,
      adicionalIRPJ: Math.round(adicionalIRPJ * 100) / 100,
      baseCalculoCSLL: baseCSLL,
      aliquotaCSLL: ALIQUOTA_CSLL_GERAL,
      valorCSLL: Math.round(valorCSLL * 100) / 100,
    }
  }

  private mapRegimeTributario(regime: number): RegimeTributarioECF {
    // regimeTributario: 1=SN, 2=SN Excesso, 3=Normal (Lucro Real por padrão)
    // Para ECF, se regime == 2 ou regime == 3, usa Lucro Real
    // Lucro Presumido seria regime específico
    if (regime === 2) return RegimeTributarioECF.LUCRO_PRESUMIDO
    return RegimeTributarioECF.LUCRO_REAL
  }

  private gerarNomeArquivo(): string {
    const ano = String(this.params.ano)
    return `ECF_${ano}.txt`
  }
}
