// Service de BUSCA (I/O Prisma) da Central de Consulta do Produto/Acabado.
// empresaId EXPLÍCITO em TODAS as queries (multi-tenant — não confiar no
// prismaScoped, que faz bypass para SUPER_ADMIN). Delega a regra de negócio ao
// service PURO de consolidação.

import { prisma } from '../../../lib/prisma'
import { validarTermoBusca } from './central-produto-validacao'
import { extrairProdutoTag } from './central-produto-tag'
import { consolidarResultados, LIMITE_PADRAO } from './central-produto-consolidacao.service'
import type {
  BuscaParams,
  DeParaAcabado,
  ProdutoResumo,
  CalculoResumo,
  OpTagResumo,
  ResultadoConsolidado,
} from './central-produto.types'

/** Teto de linhas carregadas por fonte (defesa; a consolidação ainda corta em 100). */
const TETO_FONTE = 300

/**
 * Busca única consolidada por código de acabado OU nome (Req 1, 2, 3).
 * Lança CentralProdutoError(400) se o termo < 2 chars (Req 1.5) ANTES de qualquer
 * query. Isola por empresaId explícito (Req 11).
 */
export async function buscarCentralProduto(
  p: BuscaParams,
): Promise<ResultadoConsolidado> {
  const termoNormalizado = validarTermoBusca(p.termo) // lança 400 se inválido
  const termo = p.termo.trim()
  const empresaId = p.empresaId

  const contains = { contains: termo, mode: 'insensitive' as const }

  const [deParasRaw, produtosRaw, calculosRaw, opsRaw] = await Promise.all([
    // (a) de-paras de código acabado → produto (GPRINT/PRODUTO)
    prisma.deParaImportacao.findMany({
      where: {
        empresaId,
        sistemaOrigem: 'GPRINT',
        tipoEntidade: 'PRODUTO',
        codigoExterno: contains,
      },
      select: { codigoExterno: true, nomeExterno: true, entidadeInternaId: true },
      take: TETO_FONTE,
    }),
    // (b) produto por código/nome/descrição
    prisma.produto.findMany({
      where: {
        empresaId,
        OR: [{ codigo: contains }, { nome: contains }, { descricao: contains }],
      },
      select: {
        id: true,
        codigo: true,
        nome: true,
        descricao: true,
        imagemUrl: true,
        clienteId: true,
      },
      take: TETO_FONTE,
    }),
    // (c) cálculo por siglaAcabado/descrição (fallback acabado-sem-produto)
    prisma.calculoGrafico.findMany({
      where: {
        empresaId,
        OR: [{ siglaAcabado: contains }, { descricao: contains }],
      },
      select: {
        id: true,
        numero: true,
        numeroCalcgraf: true,
        siglaAcabado: true,
        descricao: true,
        produto: true,
        clienteNome: true,
      },
      take: TETO_FONTE,
    }),
    // (d) OPs sem produtoId cuja tag [Produto] bate o termo (SELECT sem pdfData)
    prisma.ordemProducao.findMany({
      where: {
        empresaId,
        produtoId: null,
        observacoes: { contains: termo, mode: 'insensitive' },
      },
      select: { id: true, numero: true, observacoes: true },
      take: TETO_FONTE,
    }),
  ])

  // Resolve os produtos referenciados pelos de-paras que ainda não vieram na
  // busca (b) — para preencher código/descrição do grupo.
  const idsProduto = new Set(produtosRaw.map((p) => p.id))
  const idsFaltantes = [
    ...new Set(
      deParasRaw
        .map((dp) => dp.entidadeInternaId)
        .filter((id) => !idsProduto.has(id)),
    ),
  ]
  let produtosExtras: typeof produtosRaw = []
  if (idsFaltantes.length > 0) {
    produtosExtras = await prisma.produto.findMany({
      where: { empresaId, id: { in: idsFaltantes } },
      select: {
        id: true,
        codigo: true,
        nome: true,
        descricao: true,
        imagemUrl: true,
        clienteId: true,
      },
    })
  }

  const deParas: DeParaAcabado[] = deParasRaw.map((dp) => ({
    codigoExterno: dp.codigoExterno,
    nomeExterno: dp.nomeExterno,
    produtoId: dp.entidadeInternaId,
  }))

  const produtos: ProdutoResumo[] = [...produtosRaw, ...produtosExtras]

  const calculos: CalculoResumo[] = calculosRaw.map((c) => ({
    id: c.id,
    numero: c.numero,
    numeroCalcgraf: c.numeroCalcgraf,
    siglaAcabado: c.siglaAcabado,
    descricao: c.descricao,
    produto: c.produto,
    clienteNome: c.clienteNome,
  }))

  // Filtro fino: só OPs cuja tag [Produto] realmente contém o termo.
  const termoLower = termoNormalizado
  const opsSemProduto: OpTagResumo[] = opsRaw
    .map((op) => {
      const tag = extrairProdutoTag(op.observacoes)
      return tag ? { id: op.id, numero: op.numero, produtoTag: tag } : null
    })
    .filter(
      (op): op is OpTagResumo =>
        op !== null && op.produtoTag.toLowerCase().includes(termoLower),
    )

  return consolidarResultados(
    { termoNormalizado, deParas, produtos, calculos, opsSemProduto },
    LIMITE_PADRAO,
  )
}
