// Tipos compartilhados da Central de Consulta do Produto/Acabado.
// Apenas contratos — sem Prisma e sem lógica. Reutilizados pelas funções puras
// (consolidação/validação/arte-ficha/tag/permissão) e pelos services de I/O.

// ─────────────────────────────────────────────────────────────────────────────
// Entradas da consolidação (já carregadas do banco, filtradas por empresaId)
// ─────────────────────────────────────────────────────────────────────────────

/** Vínculo código acabado → produto (de DeParaImportacao). */
export interface DeParaAcabado {
  codigoExterno: string // = Cód. Acabado
  nomeExterno: string
  produtoId: string // = entidadeInternaId
}

/** Produto já carregado (campos de identificação). */
export interface ProdutoResumo {
  id: string
  codigo: string
  nome: string
  descricao: string | null
  imagemUrl: string | null
  clienteId: string | null
}

/** Cálculo gráfico (acervo) carregado para fallback/ficha. */
export interface CalculoResumo {
  id: string
  numero: number
  numeroCalcgraf: number | null
  siglaAcabado: string | null
  descricao: string | null
  produto: string | null
  clienteNome: string | null
}

/** OP com produtoId nulo cuja tag [Produto] casou o termo. */
export interface OpTagResumo {
  id: string
  numero: number
  produtoTag: string // valor extraído de [Produto]
}

export interface EntradasConsolidacao {
  termoNormalizado: string // trim + lower
  deParas: DeParaAcabado[]
  produtos: ProdutoResumo[]
  calculos: CalculoResumo[]
  opsSemProduto: OpTagResumo[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Resultado da consolidação
// ─────────────────────────────────────────────────────────────────────────────

/** Grupo de resultado — por Produto OU por acabado-sem-produto. */
export interface GrupoResultado {
  tipo: 'PRODUTO' | 'ACABADO_SEM_PRODUTO'
  chave: string // produtoId | 'calc:'+calculoId
  produtoId: string | null
  calculoId: string | null
  codigo: string | null // Produto.codigo
  descricao: string | null
  codigosAcabado: string[] // todos os Cód. Acabado do grupo (ordenados, sem repetição)
  semProdutoCadastrado: boolean // Req 1.3 indicador
}

export interface ResultadoConsolidado {
  resultados: GrupoResultado[]
  semResultado: boolean // Req 1.4 / 3.5
  detalheDireto: boolean // Req 3.4 (exatamente 1 produto)
  limiteAplicado: boolean // true se cortou em 100
  termoBusca: string // preservado para a UI (Req 3.5)
}

// ─────────────────────────────────────────────────────────────────────────────
// Busca / Detalhe / Edição (params e retornos de I/O)
// ─────────────────────────────────────────────────────────────────────────────

export interface BuscaParams {
  empresaId: string // EXPLÍCITO (multi-tenant)
  termo: string
}

export interface DetalheParams {
  empresaId: string
  produtoId?: string
  calculoId?: string // fallback acabado-sem-produto
}

/** Ficha técnica a partir do AtributoGrafico + cadastros gráficos. */
export interface FichaAtributos {
  tipoCartaoId: string | null
  tipoCartaoNome: string | null
  tipoFormatoId: string | null
  tipoFormatoNome: string | null
  tipoGramaturaId: string | null
  tipoGramaturaNome: string | null
  tipoPolicromiaId: string | null
  tipoPolicromiaNome: string | null
  tipoVernizId: string | null
  tipoVernizNome: string | null
  tipoCoresIds: string[]
  tipoCoresNomes: string[]
}

/** Ficha a partir da engenharia do CalculoGrafico. */
export interface FichaEngenharia {
  medidas: unknown | null
  aproveitamento: number | null
  numCores: number | null
  formatoCorteLarguraMm: number | null
  formatoCorteAlturaMm: number | null
  gramatura: number | null
}

export interface OpHistorico {
  id: string
  numero: number
  referenciaExterna: string | null
  status: string
  origemImportacao: string | null
  quantidade: number | null
  dataEntregaPrevista: Date | null
  criadoEm: Date
}

export interface CalculoHistorico {
  id: string
  numero: number
  numeroCalcgraf: number | null
  siglaAcabado: string | null
  descricao: string | null
  custoProducao: number | null
  criadoEm: Date
  itensOrcamento: ItemOrcamentoHistorico[]
}

export interface ItemOrcamentoHistorico {
  id: string
  orcamentoId: string
  orcamentoNumero: number | null
  quantidade: number | null
  precoVenda: number | null
}

export interface DetalheProduto {
  identificacao: {
    produtoId: string | null
    codigo: string | null
    descricao: string | null
    codigosAcabado: string[]
    clienteNome: string | null
    semProdutoCadastrado: boolean
  }
  arte: {
    fonte: 'PRODUTO' | 'CALCULO' | 'NENHUMA'
    imagemUrl: string | null
  }
  fichaTecnica: {
    temFicha: boolean
    atributoGrafico: FichaAtributos | null
    engenhariaCalculo: FichaEngenharia | null
  }
  historicoOps: OpHistorico[] // somente leitura
  calculos: CalculoHistorico[] // somente leitura
}

export interface EdicaoParams {
  empresaId: string
  produtoId: string
  descricao?: string // 1..200
  imagemUrl?: string | null // 1..500 quando presente
  fichaTecnica?: {
    tipoCartaoId?: string | null
    tipoFormatoId?: string | null
    tipoGramaturaId?: string | null
    tipoPolicromiaId?: string | null
    tipoVernizId?: string | null
    tipoCoresIds?: string[]
  }
  adicionarAcabados?: string[] // novos codigoExterno
  removerAcabados?: string[] // codigoExterno a remover
}
