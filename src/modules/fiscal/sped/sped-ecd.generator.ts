/**
 * Gerador SPED ECD (Escrituração Contábil Digital)
 *
 * Gera o arquivo da ECD com os blocos obrigatórios:
 * 0 (Abertura/Identificação), I (Lançamentos Contábeis),
 * J (Demonstrações Contábeis), 9 (Controle - gerado automaticamente pelo SPEDWriter).
 *
 * Bloco I: plano de contas (I050), lançamentos diários (I200/I250)
 * Bloco J: balancete/balanço patrimonial e encerramento (J005, J100, J150, J900)
 *
 * Encoding: ISO-8859-1, delimitador pipe, CR+LF
 *
 * Como o ERP pode não ter módulo contábil completo, a estrutura é gerada
 * a partir dos dados fiscais disponíveis (apurações, documentos), permitindo
 * integração futura com um plano de contas real.
 *
 * @see Requirements 16.1, 16.2, 16.3
 */

import { prisma } from '../../../lib/prisma'
import { SPEDWriter } from './sped-writer'
import type { PeriodoParams, ArquivoSPED } from './tipos'

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

// === Interfaces para dados contábeis ===

export interface ContaContabil {
  codigo: string
  descricao: string
  natureza: 'D' | 'C' // Devedora / Credora
  tipo: 'S' | 'A'     // Sintética / Analítica
  nivel: number
  codigoPai?: string
}

export interface LancamentoContabil {
  data: Date
  numeroLancamento: number
  conta: string
  contaContrapartida: string
  valor: number
  natureza: 'D' | 'C'
  historico: string
  documento?: string
}

export interface SaldoContabil {
  conta: string
  saldoInicial: number
  debitos: number
  creditos: number
  saldoFinal: number
  naturezaSaldoInicial: 'D' | 'C'
  naturezaSaldoFinal: 'D' | 'C'
}

// === Plano de contas padrão simplificado ===

const PLANO_CONTAS_PADRAO: ContaContabil[] = [
  { codigo: '1', descricao: 'ATIVO', natureza: 'D', tipo: 'S', nivel: 1 },
  { codigo: '1.1', descricao: 'ATIVO CIRCULANTE', natureza: 'D', tipo: 'S', nivel: 2, codigoPai: '1' },
  { codigo: '1.1.01', descricao: 'CAIXA E EQUIVALENTES DE CAIXA', natureza: 'D', tipo: 'A', nivel: 3, codigoPai: '1.1' },
  { codigo: '1.1.02', descricao: 'BANCOS CONTA MOVIMENTO', natureza: 'D', tipo: 'A', nivel: 3, codigoPai: '1.1' },
  { codigo: '1.1.03', descricao: 'CLIENTES', natureza: 'D', tipo: 'A', nivel: 3, codigoPai: '1.1' },
  { codigo: '1.1.04', descricao: 'ESTOQUES', natureza: 'D', tipo: 'A', nivel: 3, codigoPai: '1.1' },
  { codigo: '1.1.05', descricao: 'IMPOSTOS A RECUPERAR', natureza: 'D', tipo: 'A', nivel: 3, codigoPai: '1.1' },
  { codigo: '1.2', descricao: 'ATIVO NAO CIRCULANTE', natureza: 'D', tipo: 'S', nivel: 2, codigoPai: '1' },
  { codigo: '1.2.01', descricao: 'IMOBILIZADO', natureza: 'D', tipo: 'A', nivel: 3, codigoPai: '1.2' },
  { codigo: '2', descricao: 'PASSIVO', natureza: 'C', tipo: 'S', nivel: 1 },
  { codigo: '2.1', descricao: 'PASSIVO CIRCULANTE', natureza: 'C', tipo: 'S', nivel: 2, codigoPai: '2' },
  { codigo: '2.1.01', descricao: 'FORNECEDORES', natureza: 'C', tipo: 'A', nivel: 3, codigoPai: '2.1' },
  { codigo: '2.1.02', descricao: 'IMPOSTOS A PAGAR', natureza: 'C', tipo: 'A', nivel: 3, codigoPai: '2.1' },
  { codigo: '2.1.03', descricao: 'SALARIOS E ENCARGOS A PAGAR', natureza: 'C', tipo: 'A', nivel: 3, codigoPai: '2.1' },
  { codigo: '2.3', descricao: 'PATRIMONIO LIQUIDO', natureza: 'C', tipo: 'S', nivel: 2, codigoPai: '2' },
  { codigo: '2.3.01', descricao: 'CAPITAL SOCIAL', natureza: 'C', tipo: 'A', nivel: 3, codigoPai: '2.3' },
  { codigo: '2.3.02', descricao: 'LUCROS ACUMULADOS', natureza: 'C', tipo: 'A', nivel: 3, codigoPai: '2.3' },
  { codigo: '3', descricao: 'RECEITAS', natureza: 'C', tipo: 'S', nivel: 1 },
  { codigo: '3.1', descricao: 'RECEITA BRUTA DE VENDAS', natureza: 'C', tipo: 'A', nivel: 2, codigoPai: '3' },
  { codigo: '3.2', descricao: 'RECEITA DE SERVICOS', natureza: 'C', tipo: 'A', nivel: 2, codigoPai: '3' },
  { codigo: '4', descricao: 'CUSTOS E DESPESAS', natureza: 'D', tipo: 'S', nivel: 1 },
  { codigo: '4.1', descricao: 'CUSTO DAS MERCADORIAS VENDIDAS', natureza: 'D', tipo: 'A', nivel: 2, codigoPai: '4' },
  { codigo: '4.2', descricao: 'DESPESAS OPERACIONAIS', natureza: 'D', tipo: 'A', nivel: 2, codigoPai: '4' },
  { codigo: '4.3', descricao: 'DESPESAS TRIBUTARIAS', natureza: 'D', tipo: 'A', nivel: 2, codigoPai: '4' },
]

// === Main generator class ===

export class SpedECDGenerator {
  private writer: SPEDWriter
  private params!: PeriodoParams
  private dataInicio!: Date
  private dataFim!: Date
  private planoContas: ContaContabil[] = PLANO_CONTAS_PADRAO
  private lancamentos: LancamentoContabil[] = []
  private saldos: SaldoContabil[] = []

  constructor() {
    this.writer = new SPEDWriter()
  }

  /**
   * Gera o arquivo SPED ECD para o período informado.
   * Exporta lançamentos contábeis no layout da ECD com blocos 0, I, J, 9.
   */
  async gerar(params: PeriodoParams): Promise<ArquivoSPED> {
    this.params = params
    this.writer = new SPEDWriter()

    // Define período (ECD é anual, mas usa mês início/fim do exercício)
    this.dataInicio = new Date(params.ano, params.mes - 1, 1)
    this.dataFim = new Date(params.ano, params.mes, 0, 23, 59, 59, 999)

    // Carrega dados contábeis derivados dos dados fiscais
    await this.carregarDadosContabeis()

    // Gera blocos na ordem obrigatória
    await this.gerarBloco0()
    this.gerarBlocoI()
    this.gerarBlocoJ()

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

  // === Carregamento de dados contábeis a partir de dados fiscais ===

  private async carregarDadosContabeis(): Promise<void> {
    // Busca documentos fiscais autorizados do período para gerar lançamentos
    const documentos = await prisma.documentoFiscal.findMany({
      where: {
        empresaId: this.params.empresaId,
        dataEmissao: { gte: this.dataInicio, lte: this.dataFim },
        status: 'AUTORIZADO',
      },
      orderBy: { dataEmissao: 'asc' },
    })

    // Gera lançamentos contábeis a partir dos documentos fiscais
    this.lancamentos = []
    let numLancamento = 1

    for (const doc of documentos) {
      const valor = Number(doc.valorTotal) || 0
      if (valor <= 0) continue

      if (doc.tipoOperacao === 1) {
        // Saída (venda) — Debita Clientes, Credita Receita
        this.lancamentos.push({
          data: doc.dataEmissao,
          numeroLancamento: numLancamento,
          conta: '1.1.03',            // Clientes
          contaContrapartida: '3.1',  // Receita bruta vendas
          valor,
          natureza: 'D',
          historico: `NF ${doc.numero} - ${doc.destRazao ?? 'Cliente'}`,
          documento: doc.chaveAcesso ?? String(doc.numero),
        })
      } else {
        // Entrada (compra) — Debita Estoque, Credita Fornecedores
        this.lancamentos.push({
          data: doc.dataEmissao,
          numeroLancamento: numLancamento,
          conta: '1.1.04',            // Estoques
          contaContrapartida: '2.1.01', // Fornecedores
          valor,
          natureza: 'D',
          historico: `NF ${doc.numero} - ${doc.emitenteRazao ?? 'Fornecedor'}`,
          documento: doc.chaveAcesso ?? String(doc.numero),
        })
      }
      numLancamento++
    }

    // Calcula saldos por conta analítica
    this.calcularSaldos()
  }

  private calcularSaldos(): void {
    const contasAnaliticas = this.planoContas.filter(c => c.tipo === 'A')
    this.saldos = []

    for (const conta of contasAnaliticas) {
      let debitos = 0
      let creditos = 0

      for (const lanc of this.lancamentos) {
        if (lanc.conta === conta.codigo) {
          if (lanc.natureza === 'D') debitos += lanc.valor
          else creditos += lanc.valor
        }
        if (lanc.contaContrapartida === conta.codigo) {
          if (lanc.natureza === 'D') creditos += lanc.valor
          else debitos += lanc.valor
        }
      }

      const saldoFinal = debitos - creditos

      this.saldos.push({
        conta: conta.codigo,
        saldoInicial: 0,
        debitos,
        creditos,
        saldoFinal: Math.abs(saldoFinal),
        naturezaSaldoInicial: conta.natureza,
        naturezaSaldoFinal: saldoFinal >= 0 ? 'D' : 'C',
      })
    }
  }

  // === Bloco 0: Abertura, Identificação e Referências ===

  private async gerarBloco0(): Promise<void> {
    const empresa = await prisma.empresa.findUniqueOrThrow({
      where: { id: this.params.empresaId },
    })

    // Registro 0000 - Abertura do arquivo digital (ECD)
    this.writer.writeRegistro('0', '0000', [
      'LECD',                            // REG_TIPO (identificador ECD)
      formatDate(this.dataInicio),       // DT_INI
      formatDate(this.dataFim),          // DT_FIN
      empresa.razaoSocial,               // NOME
      empresa.cnpj.replace(/\D/g, ''),   // CNPJ
      empresa.uf ?? '',                  // UF
      empresa.inscEstadual ?? '',        // IE
      '',                                // COD_MUN (IBGE)
      '',                                // IM
      'G',                               // IND_SIT_ESP (G=abertura normal)
      '0',                               // IND_SIT_INI_PER (0=regular)
      '0',                               // IND_NIRE
      '0',                               // IND_FIN_ESC (0=original)
      '',                                // COD_HASH_SUB
      '0',                               // IND_GRANDE_PORTE
      '',                                // TIP_ECD
      '',                                // COD_SCP
    ])

    // Registro 0001 - Abertura do Bloco 0
    this.writer.writeRegistro('0', '0001', ['0']) // 0 = com dados

    // Registro 0007 - Outras inscrições
    this.writer.writeRegistro('0', '0007', [
      empresa.inscEstadual ?? '', // COD_ENT_REF
      empresa.uf ?? '',           // COD_INSCR
    ])

    // Registro 0020 - Escrituração contábil descentralizada
    // (Não aplicável para a maioria — registro vazio/omitido)

    // Registro 0150 - Tabela de participantes (simplificado)
    this.writer.writeRegistro('0', '0150', [
      'EMPRESA',                       // COD_PART
      empresa.razaoSocial,             // NOME
      '1',                             // COD_PAIS (1=Brasil)
      empresa.cnpj.replace(/\D/g, ''), // CNPJ
      '',                              // CPF
      '',                              // NIT
      empresa.uf ?? '',                // UF
      empresa.inscEstadual ?? '',      // IE
      '',                              // COD_MUN
      '',                              // IM
      '',                              // SUFRAMA
    ])

    // Registro 0990 - Encerramento do Bloco 0
    const totalBloco0 = (this.writer.getContadores()['0'] ?? 0) + 1
    this.writer.writeRegistro('0', '0990', [String(totalBloco0)])
  }

  // === Bloco I: Lançamentos Contábeis ===

  private gerarBlocoI(): void {
    // I001 - Abertura do Bloco I
    const temMovimento = this.lancamentos.length > 0
    this.writer.writeRegistro('I', 'I001', [temMovimento ? '0' : '1'])

    // I010 - Identificação da escrituração contábil
    this.writer.writeRegistro('I', 'I010', [
      'G',  // IND_ESC (G=diário geral)
      '2',  // COD_VER_LC (2=layout vigente)
    ])

    // I050 - Plano de contas
    for (const conta of this.planoContas) {
      this.writer.writeRegistro('I', 'I050', [
        formatDate(this.dataInicio),  // DT_ALT (data da última alteração)
        '01',                         // COD_NAT (01=contabilidade geral)
        conta.tipo === 'S' ? 'S' : 'A', // IND_CTA (S=sintética, A=analítica)
        String(conta.nivel),          // NIVEL
        conta.codigo,                 // COD_CTA
        '',                           // COD_CTA_SUP (conta pai)
        conta.descricao,              // CTA
      ])
    }

    // I200/I250 - Lançamentos diários (agrupados por data)
    const lancamentosPorData = this.agruparPorData(this.lancamentos)

    for (const [dataStr, lancs] of lancamentosPorData) {
      // I200 - Abertura do lote de lançamentos do dia
      this.writer.writeRegistro('I', 'I200', [
        '1',      // NUM_LCTO (número sequencial do lote)
        dataStr,  // DT_LCTO (data dos lançamentos)
        formatDecimal(lancs.reduce((s, l) => s + l.valor, 0)), // VL_LCTO
        'N',      // IND_LCTO (N=normal)
      ])

      // I250 - Partidas dos lançamentos
      for (const lanc of lancs) {
        this.writer.writeRegistro('I', 'I250', [
          lanc.conta,                   // COD_CTA
          lanc.contaContrapartida,      // COD_CCUS (centro de custo / contrapartida)
          formatDecimal(lanc.valor),    // VL_DC
          lanc.natureza,                // IND_DC (D/C)
          '',                           // NUM_ARQ
          lanc.historico,               // HIST
          lanc.documento ?? '',         // COD_HIST_PAD
        ])
      }
    }

    // I990 - Encerramento do Bloco I
    const totalBlocoI = (this.writer.getContadores()['I'] ?? 0) + 1
    this.writer.writeRegistro('I', 'I990', [String(totalBlocoI)])
  }

  // === Bloco J: Demonstrações Contábeis ===

  private gerarBlocoJ(): void {
    // J001 - Abertura do Bloco J
    const temDados = this.saldos.some(s => s.debitos > 0 || s.creditos > 0)
    this.writer.writeRegistro('J', 'J001', [temDados ? '0' : '1'])

    if (temDados) {
      // J005 - Demonstração contábil
      this.writer.writeRegistro('J', 'J005', [
        formatDate(this.dataInicio), // DT_INI
        formatDate(this.dataFim),    // DT_FIN
        '1',                         // ID_DEM (1=balanço patrimonial)
        'BALANCO PATRIMONIAL',       // CAB_DEM (cabeçalho)
      ])

      // J100 - Balanço patrimonial (saldos por conta)
      for (const saldo of this.saldos) {
        if (saldo.debitos === 0 && saldo.creditos === 0) continue

        const contaInfo = this.planoContas.find(c => c.codigo === saldo.conta)
        this.writer.writeRegistro('J', 'J100', [
          saldo.conta,                                 // COD_AGL
          contaInfo?.nivel?.toString() ?? '3',         // NIVEL_AGL
          contaInfo?.descricao ?? saldo.conta,         // IND_GRP_BAL
          formatDecimal(saldo.saldoInicial),           // VL_CTA_INI
          saldo.naturezaSaldoInicial,                  // IND_DC_INI
          formatDecimal(saldo.saldoFinal),             // VL_CTA_FIN
          saldo.naturezaSaldoFinal,                    // IND_DC_FIN
        ])
      }

      // J150 - Demonstração do resultado do exercício (DRE)
      const saldosResultado = this.saldos.filter(s => {
        const conta = this.planoContas.find(c => c.codigo === s.conta)
        return conta && (conta.codigo.startsWith('3') || conta.codigo.startsWith('4'))
      })

      for (const saldo of saldosResultado) {
        if (saldo.debitos === 0 && saldo.creditos === 0) continue

        const contaInfo = this.planoContas.find(c => c.codigo === saldo.conta)
        this.writer.writeRegistro('J', 'J150', [
          saldo.conta,                                 // COD_AGL
          contaInfo?.nivel?.toString() ?? '2',         // NIVEL_AGL
          contaInfo?.descricao ?? saldo.conta,         // IND_GRP_DRE
          formatDecimal(saldo.saldoFinal),             // VL_CTA
          saldo.naturezaSaldoFinal,                    // IND_DC
        ])
      }
    }

    // J900 - Termo de encerramento
    this.writer.writeRegistro('J', 'J900', [
      'TERMO DE ENCERRAMENTO',           // DNRC_ABERT
      String(this.lancamentos.length),   // NUM_ORD
      '',                                 // NAT_LIVRO
      '',                                 // NOME
      formatDate(this.dataFim),          // DT_SIT_ESP
      formatDate(this.dataFim),          // DT_FIN
    ])

    // J990 - Encerramento do Bloco J
    const totalBlocoJ = (this.writer.getContadores()['J'] ?? 0) + 1
    this.writer.writeRegistro('J', 'J990', [String(totalBlocoJ)])
  }

  // === Utility methods ===

  private agruparPorData(lancamentos: LancamentoContabil[]): Map<string, LancamentoContabil[]> {
    const map = new Map<string, LancamentoContabil[]>()

    for (const lanc of lancamentos) {
      const dataStr = formatDate(lanc.data)
      if (!map.has(dataStr)) {
        map.set(dataStr, [])
      }
      map.get(dataStr)!.push(lanc)
    }

    return map
  }

  private gerarNomeArquivo(): string {
    const mes = padLeft(this.params.mes, 2)
    const ano = this.params.ano
    return `ECD_${ano}${mes}.txt`
  }
}

// === Exported factory ===

export const spedECDGenerator = new SpedECDGenerator()
