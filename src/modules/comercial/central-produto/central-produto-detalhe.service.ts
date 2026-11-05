// Service de DETALHE (I/O Prisma) da Central de Consulta do Produto/Acabado.
// Monta os 5 blocos (Identificação, Arte, Ficha, Histórico de OPs, Cálculos) de
// um produto OU de um acabado-sem-produto (fallback de cálculo).
// empresaId EXPLÍCITO em TODAS as queries (Req 11). OPs/cálculos são só leitura.

import { prisma } from '../../../lib/prisma'
import { CentralProdutoError } from './central-produto.errors'
import { extrairProdutoTag, casarOpPorTag } from './central-produto-tag'
import { resolverArte, temFichaTecnica } from './central-produto-arte-ficha'
import type {
  DetalheParams,
  DetalheProduto,
  FichaAtributos,
  FichaEngenharia,
  OpHistorico,
  CalculoHistorico,
  OpTagResumo,
} from './central-produto.types'

function dec(v: unknown): number | null {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Extrai uma imagem do resultadoCalculo/foto do cálculo, se houver. */
function imagemDoCalculo(resultado: unknown): string | null {
  if (!resultado || typeof resultado !== 'object') return null
  const r = resultado as Record<string, unknown>
  const cand = r.imagemUrl ?? r.arte ?? r.imagem
  return typeof cand === 'string' && cand.trim().length > 0 ? cand : null
}

export async function obterDetalhe(p: DetalheParams): Promise<DetalheProduto> {
  const { empresaId } = p
  if (!empresaId) throw new CentralProdutoError('Empresa não informada.', 400)

  if (p.produtoId) {
    return detalhePorProduto(empresaId, p.produtoId)
  }
  if (p.calculoId) {
    return detalhePorCalculo(empresaId, p.calculoId)
  }
  throw new CentralProdutoError('Informe produtoId ou calculoId.', 400)
}

// ─────────────────────────────────────────────────────────────────────────────
// Detalhe por Produto
// ─────────────────────────────────────────────────────────────────────────────
async function detalhePorProduto(
  empresaId: string,
  produtoId: string,
): Promise<DetalheProduto> {
  const produto = await prisma.produto.findFirst({
    where: { id: produtoId, empresaId },
    select: {
      id: true,
      codigo: true,
      nome: true,
      descricao: true,
      imagemUrl: true,
    },
  })
  if (!produto) throw new CentralProdutoError('Produto não encontrado.', 404)

  // de-paras (códigos de acabado) do produto
  const deParas = await prisma.deParaImportacao.findMany({
    where: {
      empresaId,
      sistemaOrigem: 'GPRINT',
      tipoEntidade: 'PRODUTO',
      entidadeInternaId: produtoId,
    },
    select: { codigoExterno: true },
  })
  const codigosAcabado = [
    ...new Set(deParas.map((d) => d.codigoExterno.trim())),
  ].sort((a, b) => a.localeCompare(b))

  // cliente
  let clienteNome: string | null = null
  // Produto não tem vínculo direto com cliente no schema (sem clienteId).

  // ficha técnica (AtributoGrafico)
  const atributo = await prisma.atributoGrafico.findFirst({
    where: { empresaId, produtoId },
  })
  const atributoGrafico = atributo ? await montarFichaAtributos(empresaId, atributo) : null

  // cálculos do produto (por siglaAcabado nos códigos de acabado OU descrição)
  const calculosRaw = await prisma.calculoGrafico.findMany({
    where: {
      empresaId,
      OR: [
        codigosAcabado.length > 0 ? { siglaAcabado: { in: codigosAcabado } } : undefined,
        produto.descricao ? { descricao: produto.descricao } : undefined,
      ].filter(Boolean) as object[],
    },
    select: {
      id: true,
      numero: true,
      numeroCalcgraf: true,
      siglaAcabado: true,
      descricao: true,
      custoProducao: true,
      criadoEm: true,
      medidas: true,
      aproveitamentoManual: true,
      numCores: true,
      formatoCorteLarguraMm: true,
      formatoCorteAlturaMm: true,
      gramatura: true,
      resultadoCalculo: true,
    },
    orderBy: { criadoEm: 'desc' },
    take: 50,
  })

  // engenharia de ficha: usa o cálculo mais recente, se houver
  const calcFicha = calculosRaw[0]
  const engenhariaCalculo: FichaEngenharia | null = calcFicha
    ? {
        medidas: calcFicha.medidas ?? null,
        aproveitamento: dec(calcFicha.aproveitamentoManual),
        numCores: calcFicha.numCores ?? null,
        formatoCorteLarguraMm: dec(calcFicha.formatoCorteLarguraMm),
        formatoCorteAlturaMm: dec(calcFicha.formatoCorteAlturaMm),
        gramatura: dec(calcFicha.gramatura),
      }
    : null

  // arte: produto → cálculo → nenhuma
  const artImagemCalc = calcFicha ? imagemDoCalculo(calcFicha.resultadoCalculo) : null
  const arte = resolverArte(produto.imagemUrl, artImagemCalc)

  const calculos = await montarCalculosHistorico(empresaId, calculosRaw)

  // histórico de OPs: por produtoId + por tag [Produto]
  const historicoOps = await montarHistoricoOps(empresaId, produtoId, produto.descricao)

  return {
    identificacao: {
      produtoId: produto.id,
      codigo: produto.codigo,
      descricao: produto.descricao ?? produto.nome,
      codigosAcabado,
      clienteNome,
      semProdutoCadastrado: false,
    },
    arte,
    fichaTecnica: {
      temFicha: temFichaTecnica(atributoGrafico != null, engenhariaCalculo != null),
      atributoGrafico,
      engenhariaCalculo,
    },
    historicoOps,
    calculos,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Detalhe por Cálculo (acabado sem produto)
// ─────────────────────────────────────────────────────────────────────────────
async function detalhePorCalculo(
  empresaId: string,
  calculoId: string,
): Promise<DetalheProduto> {
  const calc = await prisma.calculoGrafico.findFirst({
    where: { id: calculoId, empresaId },
    select: {
      id: true,
      numero: true,
      numeroCalcgraf: true,
      siglaAcabado: true,
      descricao: true,
      produto: true,
      clienteNome: true,
      custoProducao: true,
      criadoEm: true,
      medidas: true,
      aproveitamentoManual: true,
      numCores: true,
      formatoCorteLarguraMm: true,
      formatoCorteAlturaMm: true,
      gramatura: true,
      resultadoCalculo: true,
    },
  })
  if (!calc) throw new CentralProdutoError('Cálculo não encontrado.', 404)

  const engenhariaCalculo: FichaEngenharia = {
    medidas: calc.medidas ?? null,
    aproveitamento: dec(calc.aproveitamentoManual),
    numCores: calc.numCores ?? null,
    formatoCorteLarguraMm: dec(calc.formatoCorteLarguraMm),
    formatoCorteAlturaMm: dec(calc.formatoCorteAlturaMm),
    gramatura: dec(calc.gramatura),
  }

  const arte = resolverArte(null, imagemDoCalculo(calc.resultadoCalculo))

  const calculos = await montarCalculosHistorico(empresaId, [calc])

  // histórico de OPs: por tag [Produto] = descrição/produto do cálculo
  const nomeRef = calc.descricao ?? calc.produto ?? null
  const historicoOps = await montarHistoricoOps(empresaId, null, nomeRef)

  return {
    identificacao: {
      produtoId: null,
      codigo: calc.siglaAcabado ?? null,
      descricao: calc.descricao ?? calc.produto ?? null,
      codigosAcabado: calc.siglaAcabado ? [calc.siglaAcabado.trim()] : [],
      clienteNome: calc.clienteNome ?? null,
      semProdutoCadastrado: true,
    },
    arte,
    fichaTecnica: {
      temFicha: temFichaTecnica(false, true),
      atributoGrafico: null,
      engenhariaCalculo,
    },
    historicoOps,
    calculos,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
async function montarFichaAtributos(
  empresaId: string,
  atributo: {
    tipoCartaoId: string | null
    tipoFormatoId: string | null
    tipoGramaturaId: string | null
    tipoPolicromiaId: string | null
    tipoVernizId: string | null
    tipoCoresIds: string[]
  },
): Promise<FichaAtributos> {
  const [cartao, formato, gramatura, policromia, verniz, cores] = await Promise.all([
    atributo.tipoCartaoId
      ? prisma.tipoCartao.findFirst({
          where: { id: atributo.tipoCartaoId, empresaId },
          select: { descricao: true },
        })
      : null,
    atributo.tipoFormatoId
      ? prisma.tipoFormato.findFirst({
          where: { id: atributo.tipoFormatoId, empresaId },
          select: { descricao: true },
        })
      : null,
    atributo.tipoGramaturaId
      ? prisma.tipoGramatura.findFirst({
          where: { id: atributo.tipoGramaturaId, empresaId },
          select: { descricao: true },
        })
      : null,
    atributo.tipoPolicromiaId
      ? prisma.tipoPolicromia.findFirst({
          where: { id: atributo.tipoPolicromiaId, empresaId },
          select: { descricao: true },
        })
      : null,
    atributo.tipoVernizId
      ? prisma.tipoVerniz.findFirst({
          where: { id: atributo.tipoVernizId, empresaId },
          select: { descricao: true },
        })
      : null,
    atributo.tipoCoresIds.length > 0
      ? prisma.tipoCor.findMany({
          where: { id: { in: atributo.tipoCoresIds }, empresaId },
          select: { id: true, descricao: true },
        })
      : [],
  ])

  const mapaCores = new Map((cores ?? []).map((c) => [c.id, c.descricao]))

  return {
    tipoCartaoId: atributo.tipoCartaoId,
    tipoCartaoNome: cartao?.descricao ?? null,
    tipoFormatoId: atributo.tipoFormatoId,
    tipoFormatoNome: formato?.descricao ?? null,
    tipoGramaturaId: atributo.tipoGramaturaId,
    tipoGramaturaNome: gramatura?.descricao ?? null,
    tipoPolicromiaId: atributo.tipoPolicromiaId,
    tipoPolicromiaNome: policromia?.descricao ?? null,
    tipoVernizId: atributo.tipoVernizId,
    tipoVernizNome: verniz?.descricao ?? null,
    tipoCoresIds: atributo.tipoCoresIds,
    tipoCoresNomes: atributo.tipoCoresIds
      .map((id) => mapaCores.get(id))
      .filter((n): n is string => !!n),
  }
}

type CalculoRaw = {
  id: string
  numero: number
  numeroCalcgraf: number | null
  siglaAcabado: string | null
  descricao: string | null
  custoProducao: unknown
  criadoEm: Date
}

async function montarCalculosHistorico(
  empresaId: string,
  calculos: CalculoRaw[],
): Promise<CalculoHistorico[]> {
  if (calculos.length === 0) return []

  const ids = calculos.map((c) => c.id)
  const itens = await prisma.itemOrcamentoGrafico.findMany({
    where: { empresaId, calculoGraficoOrigemId: { in: ids } },
    select: {
      id: true,
      orcamentoId: true,
      calculoGraficoOrigemId: true,
      quantidade: true,
      valorTotal: true,
      orcamento: { select: { numero: true } },
    },
  })

  const porCalculo = new Map<string, typeof itens>()
  for (const it of itens) {
    const key = it.calculoGraficoOrigemId as string
    const arr = porCalculo.get(key) ?? []
    arr.push(it)
    porCalculo.set(key, arr)
  }

  return calculos.map((c) => ({
    id: c.id,
    numero: c.numero,
    numeroCalcgraf: c.numeroCalcgraf,
    siglaAcabado: c.siglaAcabado,
    descricao: c.descricao,
    custoProducao: dec(c.custoProducao),
    criadoEm: c.criadoEm,
    itensOrcamento: (porCalculo.get(c.id) ?? []).map((it) => ({
      id: it.id,
      orcamentoId: it.orcamentoId,
      orcamentoNumero: it.orcamento?.numero ?? null,
      quantidade: it.quantidade ?? null,
      precoVenda: dec(it.valorTotal),
    })),
  }))
}

async function montarHistoricoOps(
  empresaId: string,
  produtoId: string | null,
  produtoDescricao: string | null,
): Promise<OpHistorico[]> {
  // (1) OPs vinculadas por produtoId
  const porId = produtoId
    ? await prisma.ordemProducao.findMany({
        where: { empresaId, produtoId },
        select: SELECT_OP,
        orderBy: { criadoEm: 'desc' },
        take: 100,
      })
    : []

  // (2) OPs com produtoId null cuja tag [Produto] casa a descrição
  const semProduto = produtoDescricao
    ? await prisma.ordemProducao.findMany({
        where: {
          empresaId,
          produtoId: null,
          observacoes: { contains: produtoDescricao, mode: 'insensitive' },
        },
        select: { ...SELECT_OP, observacoes: true },
        orderBy: { criadoEm: 'desc' },
        take: 100,
      })
    : []

  const opsTag: OpTagResumo[] = semProduto.map((op) => ({
    id: op.id,
    numero: op.numero,
    produtoTag: extrairProdutoTag(op.observacoes) ?? '',
  }))
  const idsCasadas = new Set(casarOpPorTag(produtoDescricao, opsTag).map((o) => o.id))

  const casadas = semProduto.filter((op) => idsCasadas.has(op.id))

  const todas = [...porId, ...casadas]
  // dedup por id (um produto pode casar por id e por tag)
  const vistos = new Set<string>()
  const unicas = todas.filter((op) => {
    if (vistos.has(op.id)) return false
    vistos.add(op.id)
    return true
  })

  return unicas.map((op) => ({
    id: op.id,
    numero: op.numero,
    referenciaExterna: op.referenciaExterna,
    status: op.status,
    origemImportacao: op.origemImportacao,
    quantidade: dec(op.quantidade),
    dataEntregaPrevista: op.dataEntregaPrevista,
    criadoEm: op.criadoEm,
  }))
}

// SELECT explícito SEM pdfData (steering pcp-modulo §9.1 — nunca materializar BYTEA)
const SELECT_OP = {
  id: true,
  numero: true,
  referenciaExterna: true,
  status: true,
  origemImportacao: true,
  quantidade: true,
  dataEntregaPrevista: true,
  criadoEm: true,
} as const
