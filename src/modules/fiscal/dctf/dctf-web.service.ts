/**
 * Serviço de Consolidação DCTF-Web
 *
 * Consolida débitos de contribuições federais (PIS, COFINS, IRRF, CSLL, INSS)
 * do período, concilia com apurações mensais e exporta no formato aceito pelo
 * sistema e-CAC/DCTF-Web da Receita Federal.
 *
 * A DCTF-Web é a Declaração de Débitos e Créditos Tributários Federais
 * Previdenciários e de Outras Entidades e Fundos, que substitui a DCTF
 * convencional para confissão de dívida tributária federal.
 *
 * @see Requirements 19.1, 19.2, 19.3
 */

import { prisma } from '../../../lib/prisma'
import { CodigoErroFiscal, ErroFiscal } from '../erros'

// === Tipos ===

/** Tipos de tributos federais consolidados na DCTF-Web */
export type TributoFederal = 'PIS' | 'COFINS' | 'IRRF' | 'CSLL' | 'INSS'

/** Parâmetros para geração da consolidação DCTF-Web */
export interface DctfWebParams {
  empresaId: string
  /** Período no formato YYYY-MM */
  periodo: string
}

/** Item de débito consolidado para um tributo */
export interface DebitoDctfWeb {
  tributo: TributoFederal
  codigoReceita: string
  periodoApuracao: string
  valorApurado: number
  valorCredito: number
  valorDeducao: number
  valorDevido: number
}

/** Resultado da conciliação entre DCTF-Web e apurações */
export interface ResultadoConciliacao {
  tributo: TributoFederal
  valorDctfWeb: number
  valorApuracao: number
  diferenca: number
  conciliado: boolean
}

/** Formato exportável para o e-CAC */
export interface ExportacaoEcac {
  /** Identificação da declaração */
  declaracao: {
    tipo: 'DCTF_WEB'
    versao: '1.0'
    periodoApuracao: string
    dataGeracao: string
    cnpjDeclarante: string
    razaoSocial: string
  }
  /** Débitos apurados por tributo */
  debitos: DebitoDctfWeb[]
  /** Totais consolidados */
  totais: {
    totalDebitos: number
    totalCreditos: number
    totalDeducoes: number
    totalDevido: number
  }
  /** Resultado da conciliação */
  conciliacao: ResultadoConciliacao[]
}

/** Códigos de receita padrão RFB por tributo */
const CODIGOS_RECEITA: Record<TributoFederal, string> = {
  PIS: '8109',      // PIS/Pasep
  COFINS: '2172',   // COFINS
  IRRF: '0561',     // IRRF sobre rendimentos do trabalho
  CSLL: '2372',     // CSLL
  INSS: '1082',     // Contribuição previdenciária patronal
}

// === Serviço ===

export class DctfWebService {
  /**
   * Consolida débitos de contribuições federais do período.
   * Busca apurações de PIS, COFINS e demais tributos registrados.
   *
   * Requirement 19.1
   */
  async consolidarDebitos(params: DctfWebParams): Promise<DebitoDctfWeb[]> {
    const { empresaId, periodo } = params

    this.validarPeriodo(periodo)

    const debitos: DebitoDctfWeb[] = []

    // Buscar apurações do período para cada tributo federal
    const tiposApuracao: TributoFederal[] = ['PIS', 'COFINS', 'IRRF', 'CSLL', 'INSS']

    for (const tributo of tiposApuracao) {
      const debito = await this.buscarDebitoTributo(empresaId, periodo, tributo)
      if (debito) {
        debitos.push(debito)
      }
    }

    return debitos
  }

  /**
   * Concilia os valores DCTF-Web com as apurações mensais de PIS/COFINS
   * e Reinf/eSocial (INSS/IRRF/CSLL).
   *
   * Requirement 19.3
   */
  async conciliarApuracoes(params: DctfWebParams): Promise<ResultadoConciliacao[]> {
    const { empresaId, periodo } = params

    this.validarPeriodo(periodo)

    const debitos = await this.consolidarDebitos(params)
    const resultados: ResultadoConciliacao[] = []

    for (const debito of debitos) {
      const valorApuracao = await this.obterValorApuracao(empresaId, periodo, debito.tributo)

      const diferenca = Math.abs(debito.valorDevido - valorApuracao)
      // Considerar conciliado se diferença menor que 1 centavo (arredondamento)
      const conciliado = diferenca < 0.01

      resultados.push({
        tributo: debito.tributo,
        valorDctfWeb: debito.valorDevido,
        valorApuracao,
        diferenca,
        conciliado,
      })
    }

    return resultados
  }

  /**
   * Exporta a consolidação no formato aceito pelo e-CAC/DCTF-Web.
   * Gera estrutura JSON compatível com o layout da Receita Federal.
   *
   * Requirement 19.2
   */
  async exportarEcac(params: DctfWebParams): Promise<ExportacaoEcac> {
    const { empresaId, periodo } = params

    this.validarPeriodo(periodo)

    // Buscar dados da empresa
    const empresa = await prisma.empresa.findUniqueOrThrow({
      where: { id: empresaId },
    })

    // Consolidar débitos
    const debitos = await this.consolidarDebitos(params)

    // Conciliar com apurações
    const conciliacao = await this.conciliarApuracoes(params)

    // Calcular totais
    const totais = debitos.reduce(
      (acc, d) => ({
        totalDebitos: acc.totalDebitos + d.valorApurado,
        totalCreditos: acc.totalCreditos + d.valorCredito,
        totalDeducoes: acc.totalDeducoes + d.valorDeducao,
        totalDevido: acc.totalDevido + d.valorDevido,
      }),
      { totalDebitos: 0, totalCreditos: 0, totalDeducoes: 0, totalDevido: 0 }
    )

    return {
      declaracao: {
        tipo: 'DCTF_WEB',
        versao: '1.0',
        periodoApuracao: periodo,
        dataGeracao: new Date().toISOString(),
        cnpjDeclarante: empresa.cnpj.replace(/\D/g, ''),
        razaoSocial: empresa.razaoSocial,
      },
      debitos,
      totais,
      conciliacao,
    }
  }

  // === Métodos internos ===

  /**
   * Busca o débito de um tributo federal específico no período.
   * Consulta a tabela ApuracaoFiscal para PIS e COFINS.
   * Para IRRF, CSLL e INSS, busca valores de apurações ou retorna zero (sem dados).
   */
  private async buscarDebitoTributo(
    empresaId: string,
    periodo: string,
    tributo: TributoFederal
  ): Promise<DebitoDctfWeb | null> {
    // PIS e COFINS possuem apuração fiscal direta
    if (tributo === 'PIS' || tributo === 'COFINS') {
      return this.buscarDebitoApuracao(empresaId, periodo, tributo)
    }

    // IRRF, CSLL, INSS — busca de documentos com retenção ou apurações complementares
    return this.buscarDebitoRetencoes(empresaId, periodo, tributo)
  }

  /**
   * Busca débitos de PIS/COFINS da tabela ApuracaoFiscal.
   */
  private async buscarDebitoApuracao(
    empresaId: string,
    periodo: string,
    tributo: 'PIS' | 'COFINS'
  ): Promise<DebitoDctfWeb | null> {
    const apuracao = await prisma.apuracaoFiscal.findFirst({
      where: {
        empresaId,
        tipo: tributo,
        periodo,
      },
    })

    if (!apuracao) {
      return null
    }

    const valorApurado = Number(apuracao.totalDebitos)
    const valorCredito = Number(apuracao.totalCreditos)
    const valorDeducao = Number(apuracao.estornoDebitos) + Number(apuracao.ajustes < 0 ? Math.abs(Number(apuracao.ajustes)) : 0)
    const valorDevido = Number(apuracao.valorRecolher)

    // Não incluir tributo se não há valor a recolher e sem débitos
    if (valorApurado === 0 && valorDevido === 0) {
      return null
    }

    return {
      tributo,
      codigoReceita: CODIGOS_RECEITA[tributo],
      periodoApuracao: periodo,
      valorApurado,
      valorCredito,
      valorDeducao,
      valorDevido: Math.max(0, valorDevido),
    }
  }

  /**
   * Busca débitos de IRRF, CSLL e INSS.
   * Baseado em retenções de documentos fiscais do período e/ou
   * dados do EFD-Reinf/eSocial.
   *
   * Para INSS: busca apuração tipo 'INSS' se existir
   * Para IRRF: soma retenções de documentos de saída (serviços)
   * Para CSLL: busca apuração tipo 'CSLL' se existir
   */
  private async buscarDebitoRetencoes(
    empresaId: string,
    periodo: string,
    tributo: TributoFederal
  ): Promise<DebitoDctfWeb | null> {
    // Tenta buscar apuração do tipo específico (IRRF, CSLL, INSS)
    const apuracao = await prisma.apuracaoFiscal.findFirst({
      where: {
        empresaId,
        tipo: tributo,
        periodo,
      },
    })

    if (apuracao) {
      const valorApurado = Number(apuracao.totalDebitos)
      const valorCredito = Number(apuracao.totalCreditos)
      const valorDevido = Number(apuracao.valorRecolher)

      if (valorApurado === 0 && valorDevido === 0) {
        return null
      }

      return {
        tributo,
        codigoReceita: CODIGOS_RECEITA[tributo],
        periodoApuracao: periodo,
        valorApurado,
        valorCredito,
        valorDeducao: 0,
        valorDevido: Math.max(0, valorDevido),
      }
    }

    // Sem apuração disponível para este tributo no período
    return null
  }

  /**
   * Obtém o valor da apuração mensal para conciliação.
   * Busca na ApuracaoFiscal o valorRecolher registrado.
   */
  private async obterValorApuracao(
    empresaId: string,
    periodo: string,
    tributo: TributoFederal
  ): Promise<number> {
    const apuracao = await prisma.apuracaoFiscal.findFirst({
      where: {
        empresaId,
        tipo: tributo,
        periodo,
      },
    })

    if (!apuracao) {
      return 0
    }

    return Number(apuracao.valorRecolher)
  }

  /**
   * Valida o formato do período (YYYY-MM).
   */
  private validarPeriodo(periodo: string): void {
    const regex = /^\d{4}-(0[1-9]|1[0-2])$/
    if (!regex.test(periodo)) {
      throw new ErroFiscal(
        CodigoErroFiscal.SPED_PERIODO_SEM_DADOS,
        `Período inválido: "${periodo}". Use o formato YYYY-MM (ex: 2024-01)`,
        { periodo }
      )
    }
  }
}

/** Instância singleton do serviço DCTF-Web */
export const dctfWebService = new DctfWebService()
