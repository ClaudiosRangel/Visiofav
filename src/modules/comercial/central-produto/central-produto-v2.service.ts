// Services de I/O da Central do Produto v2 (Item Master).
// empresaId EXPLÍCITO em TODA query. Imagens (dataURL) NUNCA em select de
// listagem. Não toca o motor de cálculo. Spec comercial-central-produto-v2.

import { Prisma } from '@prisma/client'
import { prisma } from '../../../lib/prisma'
import { CentralProdutoError } from './central-produto.errors'
import {
  proximaRevisao,
  validarImagensRevisao,
  transicaoArte,
  aplicarAprovacao,
  derivarMatriz,
  resolverMatrizExibida,
  podeExcluir,
  type EstadoArte,
} from './central-produto-v2.motor'
import type {
  FichaMaster,
  FichaGraficaView,
  ArteRevisaoResumo,
  ArteRevisaoDetalhe,
  DimensaoView,
  TotalizadoresVenda,
  ListaProdutosResultado,
  SalvarFichaParams,
  SalvarDimensaoParams,
} from './central-produto-v2.types'

function dec(v: unknown): number | null {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

async function garantirProduto(empresaId: string, produtoId: string) {
  const p = await prisma.produto.findFirst({
    where: { id: produtoId, empresaId },
    select: { id: true, codigo: true, nome: true, descricao: true, status: true, situacaoCadastro: true },
  })
  if (!p) throw new CentralProdutoError('Produto não encontrado.', 404)
  // Produto não tem vínculo direto com cliente no schema.
  return { ...p, clienteId: null as string | null }
}

// ── Leitura: Ficha Master consolidada ────────────────────────────────────────

export async function obterFichaMaster(
  empresaId: string,
  produtoId: string,
): Promise<FichaMaster> {
  const produto = await garantirProduto(empresaId, produtoId)

  let clienteNome: string | null = null
  if (produto.clienteId) {
    const c = await prisma.cliente.findFirst({
      where: { id: produto.clienteId, empresaId },
      select: { razaoSocial: true, nomeFantasia: true },
    })
    clienteNome = c?.nomeFantasia || c?.razaoSocial || null
  }

  const fichaRow = await prisma.fichaGraficaProduto.findFirst({
    where: { empresaId, produtoId },
  })
  let ficha: FichaGraficaView | null = null
  if (fichaRow) {
    let modeloFacaCodigo: string | null = null
    if (fichaRow.modeloFacaId) {
      const mf = await prisma.modeloFaca.findFirst({
        where: { id: fichaRow.modeloFacaId, empresaId },
        select: { codigo: true },
      })
      modeloFacaCodigo = mf?.codigo ?? null
    }
    ficha = {
      cartao: fichaRow.cartao,
      gramatura: fichaRow.gramatura,
      numCores: fichaRow.numCores,
      coresDescricao: fichaRow.coresDescricao,
      acabamentos: fichaRow.acabamentos,
      matrizManual: fichaRow.matrizManual,
      imagemFaca: fichaRow.imagemFaca,
      modeloFacaId: fichaRow.modeloFacaId,
      modeloFacaCodigo,
      observacoes: fichaRow.observacoes,
    }
  }

  // Matriz derivada: tag [Matriz] das OPs do produto (mais recentes primeiro).
  const opsObs = await prisma.ordemProducao.findMany({
    where: { empresaId, produtoId },
    select: { observacoes: true },
    orderBy: { criadoEm: 'desc' },
    take: 50,
  })
  const matrizDerivada = derivarMatriz(opsObs.map((o) => o.observacoes))
  const matrizExibida = resolverMatrizExibida(ficha?.matrizManual ?? null, matrizDerivada)

  const artes = await listarArtes(empresaId, produtoId)
  const arteAprovadaId = artes.find((a) => a.estado === 'APROVADA')?.id ?? null

  const dimensoes = await listarDimensoes(empresaId, produtoId)

  const estrutura = await prisma.estruturaProduto.findFirst({
    where: { empresaId, produtoId, status: 'ATIVA' },
    select: { id: true, versao: true, status: true },
    orderBy: { versao: 'desc' },
  })

  const exclusao = await avaliarExclusao(empresaId, produtoId)

  return {
    produtoId: produto.id,
    codigo: produto.codigo,
    nome: produto.nome,
    descricao: produto.descricao,
    status: produto.status,
    situacaoCadastro: (produto as { situacaoCadastro?: string }).situacaoCadastro ?? 'DEFINITIVO',
    clienteNome,
    ficha,
    matrizDerivada,
    matrizExibida,
    artes,
    arteAprovadaId,
    dimensoes,
    estruturaAtiva: estrutura
      ? { id: estrutura.id, versao: estrutura.versao, status: estrutura.status }
      : null,
    podeExcluir: exclusao.ok,
    motivoBloqueioExclusao: exclusao.motivo ?? null,
  }
}

// ── Ficha gráfica (upsert 1:1) ───────────────────────────────────────────────

export async function salvarFicha(p: SalvarFichaParams): Promise<FichaGraficaView> {
  await garantirProduto(p.empresaId, p.produtoId)

  if (p.modeloFacaId) {
    const mf = await prisma.modeloFaca.findFirst({
      where: { id: p.modeloFacaId, empresaId: p.empresaId },
      select: { id: true },
    })
    if (!mf) throw new CentralProdutoError('Modelo de faca não encontrado.', 400)
  }

  const existente = await prisma.fichaGraficaProduto.findFirst({
    where: { empresaId: p.empresaId, produtoId: p.produtoId },
    select: { id: true },
  })

  const data = {
    cartao: p.cartao ?? null,
    gramatura: p.gramatura ?? null,
    numCores: p.numCores ?? null,
    coresDescricao: p.coresDescricao ?? null,
    acabamentos: p.acabamentos ?? null,
    matrizManual: p.matrizManual ?? null,
    imagemFaca: p.imagemFaca ?? null,
    modeloFacaId: p.modeloFacaId ?? null,
    observacoes: p.observacoes ?? null,
  }

  if (existente) {
    await prisma.fichaGraficaProduto.update({ where: { id: existente.id }, data })
  } else {
    await prisma.fichaGraficaProduto.create({
      data: { empresaId: p.empresaId, produtoId: p.produtoId, ...data },
    })
  }

  let modeloFacaCodigo: string | null = null
  if (data.modeloFacaId) {
    const mf = await prisma.modeloFaca.findFirst({
      where: { id: data.modeloFacaId, empresaId: p.empresaId },
      select: { codigo: true },
    })
    modeloFacaCodigo = mf?.codigo ?? null
  }
  return { ...data, modeloFacaCodigo }
}

// ── Arte versionada ──────────────────────────────────────────────────────────

export async function listarArtes(
  empresaId: string,
  produtoId: string,
): Promise<ArteRevisaoResumo[]> {
  const linhas = await prisma.arteRevisaoProduto.findMany({
    where: { empresaId, produtoId },
    select: {
      id: true,
      numero: true,
      estado: true,
      descricao: true,
      imagens: true, // array; só contamos o length (não trafegamos no resumo)
      aprovadaPorId: true,
      aprovadaEm: true,
      comentario: true,
      criadoEm: true,
    },
    orderBy: { numero: 'desc' },
  })
  return linhas.map((l) => ({
    id: l.id,
    numero: l.numero,
    estado: l.estado as EstadoArte,
    descricao: l.descricao,
    qtdImagens: l.imagens.length,
    aprovadaPorId: l.aprovadaPorId,
    aprovadaEm: l.aprovadaEm,
    comentario: l.comentario,
    criadoEm: l.criadoEm,
  }))
}

export async function obterRevisaoArte(
  empresaId: string,
  revisaoId: string,
): Promise<ArteRevisaoDetalhe> {
  const r = await prisma.arteRevisaoProduto.findFirst({
    where: { id: revisaoId, empresaId },
  })
  if (!r) throw new CentralProdutoError('Revisão de arte não encontrada.', 404)
  return {
    id: r.id,
    numero: r.numero,
    estado: r.estado as EstadoArte,
    descricao: r.descricao,
    qtdImagens: r.imagens.length,
    imagens: r.imagens,
    aprovadaPorId: r.aprovadaPorId,
    aprovadaEm: r.aprovadaEm,
    comentario: r.comentario,
    criadoEm: r.criadoEm,
  }
}

export async function criarRevisaoArte(params: {
  empresaId: string
  produtoId: string
  imagens: string[]
  descricao?: string | null
}): Promise<ArteRevisaoResumo> {
  await garantirProduto(params.empresaId, params.produtoId)
  validarImagensRevisao(params.imagens)

  const existentes = await prisma.arteRevisaoProduto.findMany({
    where: { empresaId: params.empresaId, produtoId: params.produtoId },
    select: { numero: true },
  })
  const numero = proximaRevisao(existentes)

  const r = await prisma.arteRevisaoProduto.create({
    data: {
      empresaId: params.empresaId,
      produtoId: params.produtoId,
      numero,
      estado: 'RASCUNHO',
      descricao: params.descricao ?? null,
      imagens: params.imagens,
    },
    select: {
      id: true, numero: true, estado: true, descricao: true, imagens: true,
      aprovadaPorId: true, aprovadaEm: true, comentario: true, criadoEm: true,
    },
  })
  return {
    id: r.id,
    numero: r.numero,
    estado: r.estado as EstadoArte,
    descricao: r.descricao,
    qtdImagens: r.imagens.length,
    aprovadaPorId: r.aprovadaPorId,
    aprovadaEm: r.aprovadaEm,
    comentario: r.comentario,
    criadoEm: r.criadoEm,
  }
}

export async function transicionarRevisao(params: {
  empresaId: string
  revisaoId: string
  novoEstado: string
  usuarioId: string
  comentario?: string | null
}): Promise<ArteRevisaoResumo> {
  const r = await prisma.arteRevisaoProduto.findFirst({
    where: { id: params.revisaoId, empresaId: params.empresaId },
    select: { id: true, produtoId: true, estado: true },
  })
  if (!r) throw new CentralProdutoError('Revisão de arte não encontrada.', 404)

  const novo = params.novoEstado as EstadoArte
  transicaoArte(r.estado as EstadoArte, novo) // lança se inválido

  await prisma.$transaction(async (tx) => {
    if (novo === 'APROVADA') {
      const revisoes = await tx.arteRevisaoProduto.findMany({
        where: { empresaId: params.empresaId, produtoId: r.produtoId },
        select: { id: true, estado: true },
      })
      const obsoletar = aplicarAprovacao(
        revisoes.map((x) => ({ id: x.id, estado: x.estado as EstadoArte })),
        r.id,
      )
      if (obsoletar.length > 0) {
        await tx.arteRevisaoProduto.updateMany({
          where: { id: { in: obsoletar } },
          data: { estado: 'OBSOLETA' },
        })
      }
      await tx.arteRevisaoProduto.update({
        where: { id: r.id },
        data: {
          estado: 'APROVADA',
          aprovadaPorId: params.usuarioId,
          aprovadaEm: new Date(),
          comentario: params.comentario ?? undefined,
        },
      })
    } else {
      await tx.arteRevisaoProduto.update({
        where: { id: r.id },
        data: { estado: novo, comentario: params.comentario ?? undefined },
      })
    }
  })

  const atualizada = await obterRevisaoArte(params.empresaId, params.revisaoId)
  const { imagens: _omit, ...resumo } = atualizada
  void _omit
  return resumo
}

// ── Dimensões ────────────────────────────────────────────────────────────────

export async function listarDimensoes(
  empresaId: string,
  produtoId: string,
): Promise<DimensaoView[]> {
  const linhas = await prisma.dimensaoProduto.findMany({
    where: { empresaId, produtoId },
    orderBy: { criadoEm: 'asc' },
  })
  return linhas.map((d) => ({
    id: d.id,
    tipo: d.tipo,
    larguraMm: dec(d.larguraMm),
    alturaMm: dec(d.alturaMm),
    profundidadeMm: dec(d.profundidadeMm),
    observacao: d.observacao,
  }))
}

export async function salvarDimensao(p: SalvarDimensaoParams): Promise<DimensaoView> {
  await garantirProduto(p.empresaId, p.produtoId)
  const data = {
    tipo: p.tipo,
    larguraMm: p.larguraMm ?? null,
    alturaMm: p.alturaMm ?? null,
    profundidadeMm: p.profundidadeMm ?? null,
    observacao: p.observacao ?? null,
  }
  let row
  if (p.id) {
    const existe = await prisma.dimensaoProduto.findFirst({
      where: { id: p.id, empresaId: p.empresaId, produtoId: p.produtoId },
      select: { id: true },
    })
    if (!existe) throw new CentralProdutoError('Dimensão não encontrada.', 404)
    row = await prisma.dimensaoProduto.update({ where: { id: p.id }, data })
  } else {
    row = await prisma.dimensaoProduto.create({
      data: { empresaId: p.empresaId, produtoId: p.produtoId, ...data },
    })
  }
  return {
    id: row.id,
    tipo: row.tipo,
    larguraMm: dec(row.larguraMm),
    alturaMm: dec(row.alturaMm),
    profundidadeMm: dec(row.profundidadeMm),
    observacao: row.observacao,
  }
}

export async function removerDimensao(
  empresaId: string,
  produtoId: string,
  id: string,
): Promise<void> {
  const r = await prisma.dimensaoProduto.deleteMany({
    where: { id, empresaId, produtoId },
  })
  if (r.count === 0) throw new CentralProdutoError('Dimensão não encontrada.', 404)
}

// ── Totalizadores de venda (NF-e de saída) ───────────────────────────────────

export async function totalizadoresVenda(
  empresaId: string,
  produtoId: string,
  opts?: { meses?: number; topClientes?: number },
): Promise<TotalizadoresVenda> {
  await garantirProduto(empresaId, produtoId)
  const meses = opts?.meses ?? 12
  const topN = opts?.topClientes ?? 5
  const desde = new Date()
  desde.setMonth(desde.getMonth() - meses)

  // Itens de documento fiscal de SAÍDA (tipoOperacao=1) autorizados, do produto.
  const itens = await prisma.itemDocumentoFiscal.findMany({
    where: {
      produtoId,
      documentoFiscal: {
        empresaId,
        tipoOperacao: 1,
        status: { in: ['AUTORIZADA', 'AUTORIZADO'] },
        dataEmissao: { gte: desde },
      },
    },
    select: {
      quantidade: true,
      valorTotal: true,
      documentoFiscal: { select: { destRazao: true, destCpfCnpj: true } },
    },
  })

  if (itens.length === 0) {
    return { quantidadeTotal: 0, valorTotal: 0, periodoMeses: meses, topClientes: [], temVendas: false }
  }

  let quantidadeTotal = 0
  let valorTotal = 0
  const porCliente = new Map<string, { nome: string; qtd: number; valor: number }>()
  for (const it of itens) {
    const q = Number(it.quantidade) || 0
    const v = Number(it.valorTotal) || 0
    quantidadeTotal += q
    valorTotal += v
    const chave = it.documentoFiscal?.destCpfCnpj || it.documentoFiscal?.destRazao || '—'
    const nome = it.documentoFiscal?.destRazao || chave
    const acc = porCliente.get(chave) ?? { nome, qtd: 0, valor: 0 }
    acc.qtd += q
    acc.valor += v
    porCliente.set(chave, acc)
  }

  const topClientes = [...porCliente.values()]
    .sort((a, b) => b.valor - a.valor)
    .slice(0, topN)
    .map((c) => ({ clienteNome: c.nome, quantidade: c.qtd, valor: c.valor }))

  return { quantidadeTotal, valorTotal, periodoMeses: meses, topClientes, temVendas: true }
}

// ── Listagem de produtos (carga inicial) ─────────────────────────────────────

export async function listarProdutos(
  empresaId: string,
  opts: { status?: 'ATIVO' | 'INATIVO' | 'TODOS'; comFicha?: boolean; texto?: string; page?: number; pageSize?: number; situacao?: 'DEFINITIVO' | 'PROVISORIO' | 'TODOS' },
): Promise<ListaProdutosResultado> {
  const page = Math.max(1, opts.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20))

  const where: Prisma.ProdutoWhereInput = { empresaId }
  if (opts.status === 'ATIVO') where.status = true
  else if (opts.status === 'INATIVO') where.status = false
  // Por padrão, a Central lista só DEFINITIVOS (provisórios são do fluxo da
  // Pré-Impressão). 'TODOS'/'PROVISORIO' expõem os provisórios explicitamente.
  if (opts.situacao === 'PROVISORIO') (where as Record<string, unknown>).situacaoCadastro = 'PROVISORIO'
  else if (opts.situacao !== 'TODOS') (where as Record<string, unknown>).situacaoCadastro = 'DEFINITIVO'
  if (opts.texto && opts.texto.trim()) {
    const t = opts.texto.trim()
    where.OR = [
      { codigo: { contains: t, mode: 'insensitive' } },
      { nome: { contains: t, mode: 'insensitive' } },
      { descricao: { contains: t, mode: 'insensitive' } },
    ]
  }

  const [total, linhas] = await Promise.all([
    prisma.produto.count({ where }),
    prisma.produto.findMany({
      where,
      select: { id: true, codigo: true, nome: true, status: true, situacaoCadastro: true },
      orderBy: { codigo: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])

  // marcar quais têm ficha (uma query só)
  const ids = linhas.map((l) => l.id)
  const comFicha = ids.length
    ? await prisma.fichaGraficaProduto.findMany({
        where: { empresaId, produtoId: { in: ids } },
        select: { produtoId: true },
      })
    : []
  const setFicha = new Set(comFicha.map((f) => f.produtoId))

  let itens = linhas.map((l) => ({
    id: l.id,
    codigo: l.codigo,
    nome: l.nome,
    status: l.status,
    temFicha: setFicha.has(l.id),
    situacaoCadastro: (l as { situacaoCadastro?: string }).situacaoCadastro ?? 'DEFINITIVO',
  }))
  if (opts.comFicha === true) itens = itens.filter((i) => i.temFicha)
  else if (opts.comFicha === false) itens = itens.filter((i) => !i.temFicha)

  return { itens, total, page, pageSize }
}

// ── Inativar / reativar / excluir ────────────────────────────────────────────

async function avaliarExclusao(empresaId: string, produtoId: string) {
  const [pedVenda, pedCompra, ops, itensOrc, saldos, estoques, itensNf] = await Promise.all([
    prisma.itemPedidoVenda.count({ where: { produtoId, pedidoVenda: { empresaId } } }).catch(() => 0),
    prisma.itemPedidoCompra.count({ where: { produtoId, pedidoCompra: { empresaId } } }).catch(() => 0),
    prisma.ordemProducao.count({ where: { empresaId, produtoId } }),
    prisma.itemOrcamento.count({ where: { produtoId } }).catch(() => 0),
    prisma.saldoEndereco.count({ where: { produtoId } }).catch(() => 0),
    prisma.estoque.count({ where: { produtoId } }).catch(() => 0),
    prisma.itemDocumentoFiscal.count({ where: { produtoId, documentoFiscal: { empresaId } } }).catch(() => 0),
  ])
  return podeExcluir({
    pedidos: pedVenda + pedCompra,
    ops,
    notas: itensNf,
    itensOrcamento: itensOrc,
    saldos: saldos + estoques,
  })
}

export async function inativarProduto(empresaId: string, produtoId: string, ativo: boolean): Promise<void> {
  const r = await prisma.produto.updateMany({
    where: { id: produtoId, empresaId },
    data: { status: ativo },
  })
  if (r.count === 0) throw new CentralProdutoError('Produto não encontrado.', 404)
}

export async function excluirProduto(empresaId: string, produtoId: string): Promise<void> {
  await garantirProduto(empresaId, produtoId)
  const exclusao = await avaliarExclusao(empresaId, produtoId)
  if (!exclusao.ok) throw new CentralProdutoError(exclusao.motivo ?? 'Produto possui movimentação.', 409)
  // remove dependências cadastrais da Central (cascade cobre ficha/arte/dimensão)
  await prisma.produto.delete({ where: { id: produtoId } })
}
