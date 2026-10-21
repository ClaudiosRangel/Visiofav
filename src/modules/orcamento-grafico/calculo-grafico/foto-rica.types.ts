// Contrato da FOTO RICA de um Cálculo Gráfico migrado do Calcgraf.
//
// Spec: calculo-grafico-foto-rica (Task 1). Gravada em
// `calculo_grafico.resultado_calculo` (coluna Json já existente — aditivo, sem
// migração de schema). Espelha o pré-cálculo do Calcgraf para que o operador
// reproduza/veja qualquer orçamento no Vizor com os MESMOS valores da origem
// (batem 100% por definição — a migração NÃO recalcula).
//
// `versaoFoto: 2` distingue a foto RICA (esta) da foto simples anterior.

/** Uma linha de PLANO (CalculoPlanos). */
export interface FotoPlano {
  nome: string
  suporte: string | null
  gramatura: number | null
  coresFV?: string | null
  formatoAberto?: string | null
  formatoCorte?: string | null
  aproveitamento: number | null
  ocorrencias: number | null
  tiragem: number | null
  micro?: boolean
}

/** Uma linha de SUPORTE (papel) com peso/subtotal. */
export interface FotoSuporte {
  nome: string
  formato?: string | null
  folhas?: number | null
  quantidade?: number | null
  unidade?: string | null
  precoUnitario?: number | null
  subtotal?: number | null
}

/** Matriz de impressão (quando houver). */
export interface FotoMatriz {
  descricao: string
  quantidade: number
  precoUnitario: number
  subtotal: number
}

/** Uma TINTA (CalculoTintas). */
export interface FotoTinta {
  nome: string
  coberturaPercent: number | null
  quantidadeKg?: number | null
  precoUnitario?: number | null
  subtotal?: number | null
}

/** Material de acabamento (CalculoMatAcabamento + Itc.Descritivo). */
export interface FotoMatAcabamento {
  nome: string
  quantidade?: number | null
  unidade?: string | null
  precoUnitario?: number | null
  subtotal?: number | null
}

/** Etapa de IMPRESSÃO (CalculoAtvImpressao + máquina). */
export interface FotoImpressao {
  descricao: string
  cores?: string | null
  horas?: number | null
  producaoHora?: number | null
  precoUnitario?: number | null
  subtotal?: number | null
}

/** Etapa de ACABAMENTO (CalculoAtividades tipo A/M + Atividades/Centros). */
export interface FotoAcabamento {
  descricao: string
  centro?: string | null
  horas?: number | null
  producaoHora?: number | null
  precoUnitario?: number | null
  subtotal?: number | null
}

/** Item diverso lançado no cálculo. */
export interface FotoItemDiverso {
  descricao: string
  valor: number
}

/** Decomposição de custo (CalculoResAgrupamento) — agregados que BATEM exato. */
export interface FotoCustos {
  materialDireto: number
  custoTransformacao: number
  servicoExterno: number
  custoProducao: number
  creditoIcms?: number | null
  creditoIpi?: number | null
  creditoPisCofins?: number | null
  custoFinanceiro?: number | null
  total?: number | null
}

/** CEV (CalculoTaxas) — percentuais de custos de venda. */
export interface FotoCev {
  icms?: number | null
  juros?: number | null
  pisCofins?: number | null
  comissoes?: number | null
  totalPercent?: number | null
}

/** Uma faixa de margem (CalculoTiragens/Margens). */
export interface FotoMargem {
  margemPercent: number
  cmPercent?: number | null
  valorUnitario: number
  valorTotal: number
  selecionada?: boolean
}

/** Cabeçalho comercial do pré-cálculo. */
export interface FotoCabecalho {
  numeroCalcgraf: number
  cliente: string | null
  contato?: string | null
  linhaProduto: string | null
  produto: string | null
  descricao: string | null
  siglaAcabado: string | null
  formatoFinal?: string | null
  tiragem: number
  tributacao?: string | null
  dataCalculo?: string | null
}

/**
 * FOTO RICA completa de um cálculo — o pré-cálculo inteiro do Calcgraf,
 * estruturado. Seções ausentes vêm como arrays vazios (resiliência).
 */
export interface FotoRicaCalculo {
  versaoFoto: 2
  origem: 'MIGRADO_CALCGRAF'
  cabecalho: FotoCabecalho
  planos: FotoPlano[]
  suportes: FotoSuporte[]
  matriz?: FotoMatriz | null
  tintas: FotoTinta[]
  matAcabamento: FotoMatAcabamento[]
  impressao: FotoImpressao[]
  acabamentos: FotoAcabamento[]
  itensDiversos?: FotoItemDiverso[]
  custos: FotoCustos
  cev?: FotoCev | null
  margens: FotoMargem[]
}
