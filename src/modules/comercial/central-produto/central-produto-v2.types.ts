// Tipos da Central do Produto v2 (Item Master). Contratos — sem Prisma/lógica.
import type { EstadoArte } from './central-produto-v2.motor'

export interface FichaGraficaView {
  cartao: string | null
  gramatura: string | null
  numCores: number | null
  coresDescricao: string | null
  acabamentos: string | null
  matrizManual: string | null
  imagemFaca: string | null
  modeloFacaId: string | null
  modeloFacaCodigo: string | null
  observacoes: string | null
}

export interface ArteRevisaoResumo {
  id: string
  numero: number
  estado: EstadoArte
  descricao: string | null
  qtdImagens: number
  aprovadaPorId: string | null
  aprovadaEm: Date | null
  comentario: string | null
  criadoEm: Date
}

export interface ArteRevisaoDetalhe extends ArteRevisaoResumo {
  imagens: string[]
}

export interface DimensaoView {
  id: string
  tipo: string
  larguraMm: number | null
  alturaMm: number | null
  profundidadeMm: number | null
  observacao: string | null
}

export interface EstruturaAtivaView {
  id: string
  versao: number
  status: string
}

export interface FichaMaster {
  produtoId: string
  codigo: string
  nome: string
  descricao: string | null
  status: boolean
  clienteNome: string | null
  ficha: FichaGraficaView | null
  matrizDerivada: string | null
  matrizExibida: string | null
  artes: ArteRevisaoResumo[]
  arteAprovadaId: string | null
  dimensoes: DimensaoView[]
  estruturaAtiva: EstruturaAtivaView | null
  podeExcluir: boolean
  motivoBloqueioExclusao: string | null
}

export interface TotaisVendaCliente {
  clienteNome: string
  quantidade: number
  valor: number
}

export interface TotalizadoresVenda {
  quantidadeTotal: number
  valorTotal: number
  periodoMeses: number
  topClientes: TotaisVendaCliente[]
  temVendas: boolean
}

export interface ProdutoLista {
  id: string
  codigo: string
  nome: string
  status: boolean
  temFicha: boolean
}

export interface ListaProdutosResultado {
  itens: ProdutoLista[]
  total: number
  page: number
  pageSize: number
}

export interface SalvarFichaParams {
  empresaId: string
  produtoId: string
  cartao?: string | null
  gramatura?: string | null
  numCores?: number | null
  coresDescricao?: string | null
  acabamentos?: string | null
  matrizManual?: string | null
  imagemFaca?: string | null
  modeloFacaId?: string | null
  observacoes?: string | null
}

export interface SalvarDimensaoParams {
  empresaId: string
  produtoId: string
  id?: string // update quando presente
  tipo: string
  larguraMm?: number | null
  alturaMm?: number | null
  profundidadeMm?: number | null
  observacao?: string | null
}
