import { UFS_VALIDAS } from './pedido-venda.constants'

// ========================================
// Validação de Campos e Cross-Field (5.1)
// ========================================

export interface ValidationError {
  campo: string
  motivo: string
}

export interface ValidacaoCamposInput {
  dataEntrega?: string | Date | null
  dataValidade?: string | Date | null
  dataEntregaItem?: Array<{ index: number; data: string | Date }>
  tipoDesconto?: string | null
  descontoGeral?: number | null
  acrescimoGeral?: { tipoAcrescimo?: string; valor?: number } | null
  orcamentoOrigemId?: string | null
  origemPedido?: string | null
  subtotal?: number
  itens?: Array<{ index: number; precoFinal: number }>
}

/**
 * Valida se uma data é igual ou posterior à data atual (apenas data, sem hora)
 */
export function validarDataNaoPassado(data: string | Date | null | undefined, campo: string): ValidationError | null {
  if (!data) return null
  const dataObj = typeof data === 'string' ? new Date(data) : data
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)
  const dataComparar = new Date(dataObj)
  dataComparar.setHours(0, 0, 0, 0)
  if (dataComparar < hoje) {
    return { campo, motivo: 'Data deve ser igual ou posterior à data atual' }
  }
  return null
}

/**
 * Valida par tipoDesconto/descontoGeral (obrigatórios em conjunto)
 */
export function validarParDesconto(tipoDesconto?: string | null, descontoGeral?: number | null): ValidationError | null {
  const temTipo = tipoDesconto !== undefined && tipoDesconto !== null
  const temValor = descontoGeral !== undefined && descontoGeral !== null && descontoGeral > 0
  if (temTipo && !temValor) return { campo: 'descontoGeral', motivo: 'tipoDesconto e descontoGeral são obrigatórios em conjunto' }
  if (!temTipo && temValor) return { campo: 'tipoDesconto', motivo: 'tipoDesconto e descontoGeral são obrigatórios em conjunto' }
  return null
}

/**
 * Valida que acrescimoGeral tem tipoAcrescimo e valor em conjunto
 */
export function validarAcrescimo(acrescimoGeral?: { tipoAcrescimo?: string; valor?: number } | null): ValidationError | null {
  if (!acrescimoGeral) return null
  const { tipoAcrescimo, valor } = acrescimoGeral
  if (!tipoAcrescimo || !valor || valor <= 0) {
    return { campo: 'acrescimoGeral', motivo: 'tipoAcrescimo e valor são obrigatórios em conjunto no acréscimo' }
  }
  return null
}

/**
 * Valida que orcamentoOrigemId só é aceito com origemPedido ORCAMENTO
 */
export function validarOrcamentoOrigem(orcamentoOrigemId?: string | null, origemPedido?: string | null): ValidationError | null {
  if (orcamentoOrigemId && origemPedido !== 'ORCAMENTO') {
    return { campo: 'orcamentoOrigemId', motivo: 'orcamentoOrigemId é aceito apenas para origem ORCAMENTO' }
  }
  return null
}

/**
 * Valida que desconto em valor fixo não excede o subtotal
 */
export function validarDescontoNaoExcedeSubtotal(tipoDesconto?: string | null, descontoGeral?: number | null, subtotal?: number): ValidationError | null {
  if (tipoDesconto === 'VALOR_FIXO' && descontoGeral && subtotal !== undefined && descontoGeral > subtotal) {
    return { campo: 'descontoGeral', motivo: 'Desconto não pode exceder o subtotal' }
  }
  return null
}

/**
 * Valida que precoFinal de cada item >= 0
 */
export function validarPrecoFinalPositivo(itens: Array<{ index: number; precoFinal: number }>): ValidationError[] {
  return itens
    .filter(i => i.precoFinal < 0)
    .map(i => ({ campo: `itens[${i.index}].precoFinal`, motivo: 'O desconto total excede o preço do produto' }))
}

/**
 * Valida UF do endereço de entrega contra a lista de UFs brasileiras válidas
 */
export function validarUfEndereco(uf?: string | null): ValidationError | null {
  if (!uf) return null
  if (!(UFS_VALIDAS as readonly string[]).includes(uf)) {
    return { campo: 'enderecoEntrega.uf', motivo: 'UF brasileira inválida' }
  }
  return null
}

/**
 * Valida formato do CEP (8 dígitos numéricos)
 */
export function validarCepEndereco(cep?: string | null): ValidationError | null {
  if (!cep) return null
  if (!/^\d{8}$/.test(cep)) {
    return { campo: 'enderecoEntrega.cep', motivo: 'CEP deve conter exatamente 8 dígitos numéricos' }
  }
  return null
}

/**
 * Executa todas as validações de campo e retorna lista de erros.
 * Retorna array vazio se tudo estiver válido.
 */
export function validarCamposPedido(input: ValidacaoCamposInput): ValidationError[] {
  const erros: ValidationError[] = []

  // Validar datas no passado
  const erroDataEntrega = validarDataNaoPassado(input.dataEntrega, 'dataEntrega')
  if (erroDataEntrega) erros.push(erroDataEntrega)

  const erroDataValidade = validarDataNaoPassado(input.dataValidade, 'dataValidade')
  if (erroDataValidade) erros.push(erroDataValidade)

  if (input.dataEntregaItem) {
    for (const item of input.dataEntregaItem) {
      const erroData = validarDataNaoPassado(item.data, `itens[${item.index}].dataEntregaItem`)
      if (erroData) erros.push(erroData)
    }
  }

  // Validar par desconto
  const erroDesconto = validarParDesconto(input.tipoDesconto, input.descontoGeral)
  if (erroDesconto) erros.push(erroDesconto)

  // Validar acrescimo
  const erroAcrescimo = validarAcrescimo(input.acrescimoGeral)
  if (erroAcrescimo) erros.push(erroAcrescimo)

  // Validar orcamento origem
  const erroOrcamento = validarOrcamentoOrigem(input.orcamentoOrigemId, input.origemPedido)
  if (erroOrcamento) erros.push(erroOrcamento)

  // Validar desconto não excede subtotal
  const erroDescontoSubtotal = validarDescontoNaoExcedeSubtotal(input.tipoDesconto, input.descontoGeral, input.subtotal)
  if (erroDescontoSubtotal) erros.push(erroDescontoSubtotal)

  // Validar precoFinal >= 0 em todos os itens
  if (input.itens) {
    const errosPreco = validarPrecoFinalPositivo(input.itens)
    erros.push(...errosPreco)
  }

  return erros
}

// ========================================
// Validação de Permissões de Edição (5.3)
// ========================================

// Campos editáveis no status CONFIRMADO (sem faturamento parcial)
const CAMPOS_EDITAVEIS_CONFIRMADO = [
  'observacao', 'observacaoNota', 'prioridade', 'dataEntrega',
  'transportadoraId', 'modalidadeFrete', 'enderecoEntrega'
]

export interface ItemBloqueado {
  itemId: string
  produtoNome: string
  quantidadeFaturada: number
}

export interface PermissaoEdicaoResult {
  permitido: boolean
  motivo?: string
  camposNaoEditaveis?: string[]
  itensBloqueados?: ItemBloqueado[]
}

/**
 * Determina quais campos são editáveis com base no status e estado de faturamento.
 * Função pura — não faz I/O.
 */
export function obterCamposEditaveis(params: {
  status: string
  temFaturamentosParciais: boolean
}): {
  camposCabecalho: string[]
  podeEditarItens: boolean
  podeEditarItensFaturados: boolean
} {
  const { status, temFaturamentosParciais } = params

  if (status === 'RASCUNHO') {
    return {
      camposCabecalho: ['*'], // todos
      podeEditarItens: true,
      podeEditarItensFaturados: true,
    }
  }

  if (status === 'CONFIRMADO') {
    return {
      camposCabecalho: CAMPOS_EDITAVEIS_CONFIRMADO,
      podeEditarItens: temFaturamentosParciais ? true : false,
      podeEditarItensFaturados: false,
    }
  }

  // EFETIVADO ou CANCELADO
  return {
    camposCabecalho: [],
    podeEditarItens: false,
    podeEditarItensFaturados: false,
  }
}

/**
 * Valida se a edição solicitada é permitida para o estado atual do pedido.
 */
export function validarPermissaoEdicao(params: {
  status: string
  temFaturamentosParciais: boolean
  camposAlterados: string[]
  itensAlterados: Array<{ itemId: string; quantidadeFaturada: number; produtoNome?: string }>
}): PermissaoEdicaoResult {
  const { status, temFaturamentosParciais, camposAlterados, itensAlterados } = params

  // EFETIVADO ou CANCELADO — nenhuma edição
  if (status === 'EFETIVADO' || status === 'CANCELADO') {
    return {
      permitido: false,
      motivo: `Pedido com status ${status} não pode ser editado`,
    }
  }

  // RASCUNHO — tudo editável
  if (status === 'RASCUNHO') {
    return { permitido: true }
  }

  // CONFIRMADO — verificar campos permitidos
  const camposNaoEditaveis = camposAlterados.filter(
    campo => !CAMPOS_EDITAVEIS_CONFIRMADO.includes(campo)
  )

  if (camposNaoEditaveis.length > 0 && !temFaturamentosParciais) {
    return {
      permitido: false,
      motivo: 'Os seguintes campos não são editáveis no status CONFIRMADO',
      camposNaoEditaveis,
    }
  }

  if (camposNaoEditaveis.length > 0 && temFaturamentosParciais) {
    return {
      permitido: false,
      motivo: 'Os seguintes campos não são editáveis em pedido com faturamentos parciais',
      camposNaoEditaveis,
    }
  }

  // Verificar itens com faturamento parcial
  const itensBloqueados: ItemBloqueado[] = itensAlterados
    .filter(item => item.quantidadeFaturada > 0)
    .map(item => ({
      itemId: item.itemId,
      produtoNome: item.produtoNome || '',
      quantidadeFaturada: item.quantidadeFaturada,
    }))

  if (itensBloqueados.length > 0) {
    return {
      permitido: false,
      motivo: 'Itens com faturamento parcial não podem ser editados ou removidos',
      itensBloqueados,
    }
  }

  return { permitido: true }
}
