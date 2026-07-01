/**
 * Tipos e interfaces do gerador SPED
 * Responsável pela geração de obrigações acessórias:
 * EFD ICMS/IPI, EFD Contribuições, ECD, ECF, EFD-Reinf
 */

// === Enums ===

export enum TipoSPED {
  EFD_ICMS_IPI = 'EFD_ICMS_IPI',
  EFD_CONTRIBUICOES = 'EFD_CONTRIBUICOES',
  ECD = 'ECD',
  ECF = 'ECF',
  REINF = 'REINF',
}

export enum BlocoSPED {
  BLOCO_0 = '0',   // Abertura, Identificação e Referências
  BLOCO_A = 'A',   // Documentos de Serviços (NFS-e)
  BLOCO_C = 'C',   // Documentos Fiscais de Mercadorias
  BLOCO_D = 'D',   // Documentos de Transporte (CT-e)
  BLOCO_E = 'E',   // Apuração ICMS/IPI
  BLOCO_F = 'F',   // Demais Documentos e Operações
  BLOCO_G = 'G',   // CIAP
  BLOCO_H = 'H',   // Inventário Físico
  BLOCO_I = 'I',   // Lançamentos Contábeis (ECD)
  BLOCO_J = 'J',   // Demonstrações Contábeis (ECD)
  BLOCO_K = 'K',   // Controle da Produção e Estoque
  BLOCO_M = 'M',   // Apuração PIS/COFINS
  BLOCO_1 = '1',   // Complemento
  BLOCO_9 = '9',   // Controle e Encerramento
}

// === Interfaces ===

export interface GeradorSPED {
  gerarEFDICMSIPI(params: PeriodoParams): Promise<ArquivoSPED>
  gerarEFDContribuicoes(params: PeriodoParams): Promise<ArquivoSPED>
  gerarECD(params: PeriodoParams): Promise<ArquivoSPED>
  gerarECF(params: PeriodoParams): Promise<ArquivoSPED>
}

export interface PeriodoParams {
  empresaId: string
  mes: number            // 1-12
  ano: number            // ex: 2024
  versaoLayout?: string  // versão do layout SPED (ex: '018')
  finalidade?: FinalidadeSPED
  perfil?: PerfilSPED
}

export type FinalidadeSPED = 'ORIGINAL' | 'RETIFICADORA'

export type PerfilSPED = 'A' | 'B' | 'C'

export interface ArquivoSPED {
  conteudo: Buffer         // ISO-8859-1 encoded
  nomeArquivo: string
  totalRegistros: number
  blocos: Record<string, number>  // contagem de registros por bloco
  valido: boolean
  erros?: string[]
}

/**
 * Resultado da validação estrutural do arquivo SPED
 */
export interface ValidacaoSPED {
  valido: boolean
  erros: ErroValidacaoSPED[]
}

export interface ErroValidacaoSPED {
  bloco: string
  registro: string
  linha?: number
  campo?: string
  descricao: string
}

/**
 * Registro individual de um arquivo SPED
 */
export interface RegistroSPED {
  bloco: string
  tipo: string         // ex: 'C100', 'E110', '0000'
  campos: string[]
}

/**
 * Configuração do writer SPED
 */
export interface SPEDWriterConfig {
  encoding?: 'ISO-8859-1' | 'UTF-8'
  delimitadorCampo?: string    // padrão '|'
  delimitadorRegistro?: string // padrão '\r\n'
}
