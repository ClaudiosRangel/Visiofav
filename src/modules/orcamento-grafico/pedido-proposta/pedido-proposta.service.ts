/**
 * Pedido/Proposta (RFQ) — CRUD + transição de estado (spec comercial-pedido-proposta).
 *
 * Isolamento multi-tenant por `empresaId` EXPLÍCITO em TODA query (não confiar
 * só no prismaScoped — bypass SUPER_ADMIN). A máquina de estados é delegada ao
 * módulo puro `pedido-proposta-estado.service.ts`. Cada transição grava um
 * `LogPedidoProposta` (auditoria).
 */
import { prisma } from '../../../lib/prisma'
import {
  validarTransicao,
  type EstadoProposta,
  PedidoPropostaError,
} from './pedido-proposta-estado.service'

const ORIGENS = ['REPRESENTANTE', 'VENDEDOR', 'INTERNA'] as const
const TIPOS_PEDIDO = ['REPETICAO', 'MOSTRUARIO', 'NOVO'] as const

export type OrigemProposta = (typeof ORIGENS)[number]
export type TipoPedido = (typeof TIPOS_PEDIDO)[number]

export interface CriarPedidoPropostaInput {
  origem: OrigemProposta
  representanteId?: string | null
  vendedorId?: string | null
  tipoPedido: TipoPedido
  clienteId?: string | null
  clienteNome?: string | null
  clienteCpfCnpj?: string | null
  jaCliente?: boolean
  mercado: string
  ufOrigem?: string | null
  cidade?: string | null
  tipoEntrega?: 'UNICA' | 'FRACIONADA' | null
  entregaFracionadaDias?: string | null
  prazoPagamento?: string | null
  produtoNome?: string | null
  tipoEmbalagem?: string | null
  quantidade?: number | null
  cartao?: string | null
  gramatura?: string | null
  medidasTexto?: string | null
  cartaoFsc?: boolean
  corteInternoVerso?: boolean
  passtime?: boolean
  acabamentos?: string | null
  matriz?: string | null
  acabamentoManual?: boolean
  quantidadePorVolume?: string | null
  variacoesArte?: string | null
  exportacao?: 'COMUM' | 'EXPORTACAO' | null
  dataValidade?: string | null
  discriminacao?: string | null
  observacoes?: string | null
  exigeAmostra?: boolean
  // Revisão 3: produto do cadastro, prazo cadastrado e checklist de acabamentos.
  produtoId?: string | null
  prazoPagamentoId?: string | null
  acabamentosSelecionados?: Array<{ acabamentoId?: string | null; nome: string; marcado: boolean; detalhe?: string | null }> | null
  tiragensTexto?: string | null
}

/** Valida regras de negócio da criação/edição (origem, tipo, obrigatórios). */
function validarCampos(input: Partial<CriarPedidoPropostaInput>, criando: boolean): void {
  if (criando || input.origem !== undefined) {
    if (!input.origem || !ORIGENS.includes(input.origem)) {
      throw new PedidoPropostaError(400, 'Origem inválida.', 'VALIDACAO')
    }
    if (input.origem === 'REPRESENTANTE' && !input.representanteId) {
      throw new PedidoPropostaError(400, 'Informe o representante.', 'REPRESENTANTE_OBRIGATORIO')
    }
    if (input.origem === 'VENDEDOR' && !input.vendedorId) {
      throw new PedidoPropostaError(400, 'Informe o vendedor.', 'VENDEDOR_OBRIGATORIO')
    }
  }
  if (criando || input.tipoPedido !== undefined) {
    if (!input.tipoPedido || !TIPOS_PEDIDO.includes(input.tipoPedido)) {
      throw new PedidoPropostaError(400, 'Tipo de pedido inválido.', 'VALIDACAO')
    }
  }
  if (criando || input.mercado !== undefined) {
    if (!input.mercado || !input.mercado.trim()) {
      throw new PedidoPropostaError(400, 'O campo Mercado é obrigatório.', 'VALIDACAO')
    }
  }
  if (input.tipoEntrega === 'FRACIONADA' && !input.entregaFracionadaDias?.trim()) {
    throw new PedidoPropostaError(
      400,
      'Informe o intervalo de dias para entrega fracionada.',
      'ENTREGA_FRACIONADA_DIAS_OBRIGATORIO',
    )
  }
}

/** Monta o objeto de dados para create/update (normaliza booleanos e INTERNA). */
function montarDados(input: Partial<CriarPedidoPropostaInput>) {
  const dados: Record<string, unknown> = {}
  const set = <K extends keyof CriarPedidoPropostaInput>(k: K) => {
    if (input[k] !== undefined) dados[k as string] = input[k]
  }
  ;([
    'origem', 'tipoPedido', 'clienteId', 'clienteNome', 'clienteCpfCnpj',
    'mercado', 'ufOrigem', 'cidade', 'tipoEntrega', 'entregaFracionadaDias',
    'prazoPagamento', 'produtoNome', 'tipoEmbalagem', 'quantidade', 'cartao',
    'gramatura', 'medidasTexto', 'acabamentos', 'matriz', 'quantidadePorVolume',
    'variacoesArte', 'exportacao', 'dataValidade', 'discriminacao', 'observacoes',
    'produtoId', 'prazoPagamentoId', 'acabamentosSelecionados', 'tiragensTexto',
  ] as (keyof CriarPedidoPropostaInput)[]).forEach(set)

  // Booleanos: default false quando não informados na criação.
  for (const b of ['jaCliente', 'cartaoFsc', 'corteInternoVerso', 'passtime', 'acabamentoManual', 'exigeAmostra'] as const) {
    if (input[b] !== undefined) dados[b] = !!input[b]
  }

  // Origem INTERNA dispensa representante/vendedor.
  if (input.origem === 'INTERNA') {
    dados.representanteId = null
    dados.vendedorId = null
  } else {
    if (input.representanteId !== undefined) dados.representanteId = input.representanteId
    if (input.vendedorId !== undefined) dados.vendedorId = input.vendedorId
  }

  // Entrega única ignora os dias.
  if (input.tipoEntrega === 'UNICA') dados.entregaFracionadaDias = null

  return dados
}

export async function criarPedidoProposta(
  empresaId: string,
  usuarioId: string,
  input: CriarPedidoPropostaInput,
): Promise<{ id: string; numero: number }> {
  validarCampos(input, true)

  const ultimo = await prisma.pedidoProposta.findFirst({
    where: { empresaId },
    orderBy: { numero: 'desc' },
    select: { numero: true },
  })
  const numero = (ultimo?.numero ?? 0) + 1

  const dados = montarDados(input)
  const criado = await prisma.pedidoProposta.create({
    data: {
      empresaId,
      numero,
      estado: 'NOVO',
      criadoPorId: usuarioId,
      // defaults dos booleanos quando ausentes
      jaCliente: !!input.jaCliente,
      cartaoFsc: !!input.cartaoFsc,
      corteInternoVerso: !!input.corteInternoVerso,
      passtime: !!input.passtime,
      acabamentoManual: !!input.acabamentoManual,
      exigeAmostra: !!input.exigeAmostra,
      ...(dados as object),
    } as never,
    select: { id: true, numero: true },
  })
  return criado
}

export async function atualizarPedidoProposta(
  empresaId: string,
  id: string,
  input: Partial<CriarPedidoPropostaInput>,
): Promise<void> {
  const existente = await prisma.pedidoProposta.findFirst({
    where: { id, empresaId },
    select: { id: true, origem: true, tipoEntrega: true },
  })
  if (!existente) throw new PedidoPropostaError(404, 'Pedido/Proposta não encontrado.', 'NAO_ENCONTRADO')

  // Para a validação de entrega fracionada, considerar o tipoEntrega resultante.
  validarCampos(
    {
      ...input,
      origem: input.origem ?? (existente.origem as OrigemProposta),
      tipoEntrega: input.tipoEntrega ?? (existente.tipoEntrega as 'UNICA' | 'FRACIONADA' | null),
    },
    false,
  )

  await prisma.pedidoProposta.update({
    where: { id: existente.id },
    data: montarDados(input) as never,
  })
}

/** Campos retornados em detalhe/listagem — NUNCA inclui bytea dos anexos. */
const anexoMetaSelect = {
  id: true,
  nome: true,
  tipo: true,
  tamanho: true,
  criadoEm: true,
} as const

export async function obterPedidoProposta(empresaId: string, id: string) {
  const p = await prisma.pedidoProposta.findFirst({
    where: { id, empresaId },
    include: { anexos: { select: anexoMetaSelect, orderBy: { criadoEm: 'asc' } } },
  })
  if (!p) throw new PedidoPropostaError(404, 'Pedido/Proposta não encontrado.', 'NAO_ENCONTRADO')
  return p
}

export interface ListarFiltros {
  estado?: string
  origem?: string
  tipoPedido?: string
  busca?: string
}

export async function listarPedidosProposta(empresaId: string, filtros: ListarFiltros) {
  const where: Record<string, unknown> = { empresaId }
  if (filtros.estado) where.estado = filtros.estado
  if (filtros.origem) where.origem = filtros.origem
  if (filtros.tipoPedido) where.tipoPedido = filtros.tipoPedido
  if (filtros.busca?.trim()) {
    const q = filtros.busca.trim()
    where.OR = [
      { clienteNome: { contains: q, mode: 'insensitive' } },
      { produtoNome: { contains: q, mode: 'insensitive' } },
    ]
  }
  return prisma.pedidoProposta.findMany({
    where: where as never,
    orderBy: { criadoEm: 'desc' },
    select: {
      id: true, numero: true, origem: true, representanteId: true, vendedorId: true,
      tipoPedido: true, clienteNome: true, produtoNome: true, tipoEmbalagem: true,
      quantidade: true, estado: true, exigeAmostra: true, orcamentoGraficoId: true,
      criadoEm: true,
    },
  })
}

/**
 * Transiciona o estado do RFQ (usa a máquina pura) e grava o log. Isolado por
 * empresaId. Opcionalmente atualiza campos auxiliares (ex.: motivo persistido).
 */
export async function transicionarEstado(
  empresaId: string,
  id: string,
  usuarioId: string,
  novoEstado: EstadoProposta,
  motivo?: string,
): Promise<{ id: string; estado: EstadoProposta }> {
  const p = await prisma.pedidoProposta.findFirst({
    where: { id, empresaId },
    select: { id: true, estado: true },
  })
  if (!p) throw new PedidoPropostaError(404, 'Pedido/Proposta não encontrado.', 'NAO_ENCONTRADO')

  const atual = p.estado as EstadoProposta
  validarTransicao(atual, novoEstado, motivo)

  await prisma.$transaction([
    prisma.pedidoProposta.update({
      where: { id: p.id },
      data: {
        estado: novoEstado,
        ...(motivo ? { motivo: motivo.trim() } : {}),
      } as never,
    }),
    prisma.logPedidoProposta.create({
      data: {
        pedidoPropostaId: p.id,
        empresaId,
        estadoAnterior: atual,
        estadoNovo: novoEstado,
        usuarioId,
        motivo: motivo?.trim() ?? null,
      } as never,
    }),
  ])

  return { id: p.id, estado: novoEstado }
}
