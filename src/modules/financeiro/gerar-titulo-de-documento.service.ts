/**
 * Financeiro Operacional F1 — ponto ÚNICO de captação automática de títulos a
 * partir de documentos fiscais (venda, compra, CT-e).
 *
 * Objetivo: evitar a lógica "documento → título" duplicada inline (padrão que
 * já causou divergência no PCP→WMS). Venda e compra devem, ao longo do F1,
 * passar a chamar este service; o CT-e é a novidade do bloco.
 *
 * IMPORTANTE — o fluxo real de emissão de CT-e (`cte-emissao.service.ts`)
 * autoriza o documento em `DocumentoFiscal` (tipo `CTE`, `status=AUTORIZADO`,
 * `valorTotal` = valor do frete/prestação), NÃO no model legado `Cte`. Por
 * isso a captação do frete parte de `DocumentoFiscal`.
 *
 * Regras (design F1, Req 4):
 * - `empresaId` do título = o do DOCUMENTO (não do usuário logado).
 * - Idempotente: não duplica título para o mesmo documento.
 * - Falha na geração NÃO desfaz a autorização fiscal → registra
 *   `PendenciaTituloFiscal` para reprocessamento.
 */
import type { PrismaClient } from '@prisma/client'

export interface OpcoesTituloCte {
  /** Dias após a autorização para o vencimento do frete (default 30). */
  diasVencimento?: number
}

/**
 * Gera conta a receber do frete de um CT-e AUTORIZADO (a partir do
 * `DocumentoFiscal` tipo CTE). Idempotente por `documentoFiscalId`. Retorna o
 * título (novo ou já existente) ou `null` se o documento não deve gerar título.
 */
export async function gerarTituloDeCte(prisma: PrismaClient, documentoFiscalId: string, opcoes: OpcoesTituloCte = {}) {
  const doc = await prisma.documentoFiscal.findUnique({ where: { id: documentoFiscalId } })
  if (!doc) throw new Error(`DocumentoFiscal ${documentoFiscalId} não encontrado`)
  if (doc.tipo !== 'CTE') return null // este captador é só para CT-e
  if (doc.status !== 'AUTORIZADO') return null // só autorizado gera título

  // Idempotência: se já existe título para este documento, retorna-o
  const existente = await prisma.contaReceber.findFirst({
    where: { empresaId: doc.empresaId, documentoFiscalId },
  })
  if (existente) return existente

  // Pagador do frete: resolve o Cliente pelo CNPJ do destinatário, se houver
  let clienteId: string | null = null
  if (doc.destCpfCnpj) {
    const cliente = await prisma.cliente.findFirst({
      where: { empresaId: doc.empresaId, cpfCnpj: doc.destCpfCnpj },
      select: { id: true },
    })
    clienteId = cliente?.id ?? null
  }

  const diasVenc = opcoes.diasVencimento ?? 30
  const baseData = doc.dataAutorizacao ?? doc.dataEmissao ?? doc.criadoEm
  const vencimento = new Date(baseData.getTime() + diasVenc * 86400000)

  return prisma.contaReceber.create({
    data: {
      empresaId: doc.empresaId, // empresaId do DOCUMENTO (Req 4.6)
      documentoFiscalId,
      clienteId,
      descricao: `Frete CT-e nº ${doc.numero}/${doc.serie}`,
      valor: doc.valorTotal,
      dataVencimento: vencimento,
      dataCompetencia: baseData,
      status: 'ABERTA',
    },
  })
}

/**
 * Wrapper com proteção: gera o título do CT-e sem propagar erro ao fluxo
 * fiscal. Em falha, registra `PendenciaTituloFiscal` e retorna `null`.
 * Use este a partir do handler de transmissão/autorização do CT-e.
 */
export async function gerarTituloDeCteProtegido(prisma: PrismaClient, documentoFiscalId: string, opcoes?: OpcoesTituloCte) {
  try {
    return await gerarTituloDeCte(prisma, documentoFiscalId, opcoes)
  } catch (e: any) {
    const doc = await prisma.documentoFiscal
      .findUnique({ where: { id: documentoFiscalId }, select: { empresaId: true } })
      .catch(() => null)
    if (doc) {
      await prisma.pendenciaTituloFiscal
        .create({
          data: {
            empresaId: doc.empresaId,
            tipoDocumento: 'CTE',
            documentoId: documentoFiscalId,
            erro: String(e?.message ?? e).substring(0, 2000),
          },
        })
        .catch(() => {})
    }
    return null
  }
}

/** Cancela (marca CANCELADA) títulos em aberto de um CT-e cancelado. */
export async function cancelarTitulosDeCte(prisma: PrismaClient, empresaId: string, documentoFiscalId: string) {
  await prisma.contaReceber.updateMany({
    where: { empresaId, documentoFiscalId, status: 'ABERTA' },
    data: { status: 'CANCELADA' },
  })
}

// ============================================================================
// NF-e / NFC-e (Bloco F2) — ponto único pós-autorização (título + estoque)
// ============================================================================
//
// Espelha o padrão do CT-e (idempotência por documentoFiscalId, empresaId do
// documento, proteção sem propagar erro), mas para documentos de VENDA (NFE/
// NFCE de saída). A NF-e de devolução (finalidade=4, entrada) NÃO gera conta a
// receber e é ignorada aqui.

import { registrarMovimentacao } from '../estoque/movimentacao-estoque.service'

export interface OpcoesTituloNfe {
  /** Dias entre parcelas para o vencimento (default 30). */
  diasEntreParcelas?: number
}

/** Tipos de documento de venda que geram conta a receber. */
const TIPOS_VENDA_NFE = ['NFE', 'NFCE']

/**
 * Gera conta(s) a receber de uma NF-e/NFC-e de venda AUTORIZADA a partir do
 * `DocumentoFiscal`. Idempotente por `documentoFiscalId` (não duplica). Usa o
 * `empresaId` do documento. As parcelas seguem a condição de pagamento do
 * pedido vinculado à venda (default 1 parcela). Retorna a lista de títulos
 * (novos ou já existentes) ou `null` se o documento não deve gerar título.
 *
 * No-op (retorna `null`) para:
 * - documento que não é NFE/NFCE de saída;
 * - documento não autorizado;
 * - documento sem `vendaEfetivadaId` (ex.: NF-e de devolução/entrada);
 * - NFC-e à vista sem parcelas a prazo (venda de balcão liquidada no caixa).
 */
export async function gerarTituloDeNfe(
  prisma: PrismaClient,
  documentoFiscalId: string,
  opcoes: OpcoesTituloNfe = {},
) {
  const doc = await prisma.documentoFiscal.findUnique({ where: { id: documentoFiscalId } })
  if (!doc) throw new Error(`DocumentoFiscal ${documentoFiscalId} não encontrado`)
  if (!TIPOS_VENDA_NFE.includes(doc.tipo)) return null
  if (doc.status !== 'AUTORIZADO') return null
  if (doc.tipoOperacao === 0) return null // entrada (devolução) não gera receber
  if (!doc.vendaEfetivadaId) return null // sem venda vinculada, não há o que faturar

  // Idempotência: se já existe título para este documento, retorna o conjunto
  const existentes = await prisma.contaReceber.findMany({
    where: { empresaId: doc.empresaId, documentoFiscalId },
    orderBy: { parcela: 'asc' },
  })
  if (existentes.length > 0) return existentes

  // Resolver venda → pedido → condição de pagamento (parcelas/forma/cliente)
  const venda = await prisma.vendaEfetivada.findFirst({
    where: { id: doc.vendaEfetivadaId, empresaId: doc.empresaId },
    include: {
      pedidoVenda: {
        include: { tabelaPreco: { include: { condicoes: true } } },
      },
    },
  })

  const pedido = venda?.pedidoVenda
  const condicao = pedido?.condicaoPagId
    ? pedido.tabelaPreco?.condicoes.find((c) => c.id === pedido.condicaoPagId)
    : pedido?.tabelaPreco?.condicoes[0]

  const parcelas = Math.max(1, condicao?.parcelas ?? 1)
  const formaPagamento = condicao?.formaPagamento ?? undefined
  const clienteId = pedido?.clienteId ?? null

  // NFC-e à vista (uma parcela, forma à vista) de consumidor de balcão é
  // liquidada no caixa — não gera conta a receber em aberto.
  const ehNfceAVista =
    doc.tipo === 'NFCE' && parcelas === 1 && /vista|dinheiro|cart[aã]o|pix/i.test(formaPagamento ?? '')
  if (ehNfceAVista) return null

  const valorTotal = Number(doc.valorTotal)
  const valorParcela = Number((valorTotal / parcelas).toFixed(2))
  const diasEntre = opcoes.diasEntreParcelas ?? 30
  const baseData = doc.dataAutorizacao ?? doc.dataEmissao ?? doc.criadoEm

  const titulos = []
  for (let i = 0; i < parcelas; i++) {
    const vencimento = new Date(baseData.getTime() + diasEntre * (i + 1) * 86400000)
    const valor =
      i === parcelas - 1
        ? Number((valorTotal - valorParcela * (parcelas - 1)).toFixed(2))
        : valorParcela
    const titulo = await prisma.contaReceber.create({
      data: {
        empresaId: doc.empresaId, // empresaId do DOCUMENTO
        documentoFiscalId,
        vendaEfetivadaId: doc.vendaEfetivadaId,
        clienteId,
        descricao: `Venda NF-e nº ${doc.numero}/${doc.serie} - Parcela ${i + 1}/${parcelas}`,
        valor,
        dataVencimento: vencimento,
        dataCompetencia: baseData,
        formaPagamento,
        parcela: i + 1,
        totalParcelas: parcelas,
        status: 'ABERTA',
      },
    })
    titulos.push(titulo)
  }
  return titulos
}

/**
 * Wrapper protegido do título de NF-e: em falha, registra
 * `PendenciaTituloFiscal` e não propaga (não desfaz a autorização fiscal).
 */
export async function gerarTituloDeNfeProtegido(
  prisma: PrismaClient,
  documentoFiscalId: string,
  opcoes?: OpcoesTituloNfe,
) {
  try {
    return await gerarTituloDeNfe(prisma, documentoFiscalId, opcoes)
  } catch (e: any) {
    const doc = await prisma.documentoFiscal
      .findUnique({ where: { id: documentoFiscalId }, select: { empresaId: true } })
      .catch(() => null)
    if (doc) {
      await prisma.pendenciaTituloFiscal
        .create({
          data: {
            empresaId: doc.empresaId,
            tipoDocumento: 'NFE',
            documentoId: documentoFiscalId,
            erro: String(e?.message ?? e).substring(0, 2000),
          },
        })
        .catch(() => {})
    }
    return null
  }
}

/**
 * Baixa de estoque de uma NF-e/NFC-e de venda AUTORIZADA, idempotente por
 * documento (usa `origemId = documentoFiscalId` para detectar baixa já feita).
 * Só aplica para empresa SEM WMS (com WMS a saída física é controlada pela
 * expedição/separação). Protegida: em falha registra pendência e não propaga.
 *
 * Requirements: 2.3
 */
export async function baixarEstoqueDeNfeProtegido(prisma: PrismaClient, documentoFiscalId: string) {
  try {
    const doc = await prisma.documentoFiscal.findUnique({ where: { id: documentoFiscalId } })
    if (!doc) return null
    if (!TIPOS_VENDA_NFE.includes(doc.tipo)) return null
    if (doc.status !== 'AUTORIZADO') return null
    if (doc.tipoOperacao === 0) return null

    const empresa = await prisma.empresa.findUnique({
      where: { id: doc.empresaId },
      select: { usaWms: true },
    })
    if (empresa?.usaWms) return null // com WMS, saída controlada pela expedição

    // Idempotência: já baixou estoque para este documento?
    const jaBaixou = await prisma.movimentacaoEstoque.findFirst({
      where: { empresaId: doc.empresaId, tipo: 'SAIDA_VENDA', origemId: documentoFiscalId },
      select: { id: true },
    })
    if (jaBaixou) return null

    const itens = await prisma.itemDocumentoFiscal.findMany({
      where: { documentoFiscalId, produtoId: { not: null } },
      select: { produtoId: true, quantidade: true },
    })
    if (itens.length === 0) return null

    return await prisma.$transaction(async (tx) => {
      const negativos: string[] = []
      for (const item of itens) {
        if (!item.produtoId) continue
        const r = await registrarMovimentacao(tx, {
          empresaId: doc.empresaId,
          produtoId: item.produtoId,
          tipo: 'SAIDA_VENDA',
          quantidade: Number(item.quantidade),
          origemId: documentoFiscalId, // idempotência por documento
        })
        if (r.saldoNegativo) negativos.push(item.produtoId)
      }
      return { baixado: true, produtosComSaldoNegativo: negativos }
    })
  } catch (e: any) {
    const doc = await prisma.documentoFiscal
      .findUnique({ where: { id: documentoFiscalId }, select: { empresaId: true } })
      .catch(() => null)
    if (doc) {
      await prisma.pendenciaTituloFiscal
        .create({
          data: {
            empresaId: doc.empresaId,
            tipoDocumento: 'NFE',
            documentoId: documentoFiscalId,
            erro: `Baixa de estoque: ${String(e?.message ?? e)}`.substring(0, 2000),
          },
        })
        .catch(() => {})
    }
    return null
  }
}

/**
 * Orquestrador chamado na AUTORIZAÇÃO da NF-e/NFC-e de venda: gera o título e
 * baixa o estoque, ambos protegidos e idempotentes. Nunca propaga erro — a
 * autorização fiscal não pode ser desfeita por falha de amarração.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4
 */
export async function amarrarPosAutorizacaoNfe(prisma: PrismaClient, documentoFiscalId: string) {
  const titulos = await gerarTituloDeNfeProtegido(prisma, documentoFiscalId)
  const estoque = await baixarEstoqueDeNfeProtegido(prisma, documentoFiscalId)
  return { titulos, estoque }
}

/**
 * Reversão no CANCELAMENTO da NF-e: cancela títulos em aberto do documento e
 * estorna a baixa de estoque (se houve), de forma idempotente.
 *
 * Requirements: 2.5
 */
export async function reverterPosAutorizacaoNfe(
  prisma: PrismaClient,
  empresaId: string,
  documentoFiscalId: string,
) {
  // 1. Cancela títulos em aberto deste documento
  await prisma.contaReceber.updateMany({
    where: { empresaId, documentoFiscalId, status: 'ABERTA' },
    data: { status: 'CANCELADA' },
  })

  // 2. Estorna estoque, se foi baixado por este documento e ainda não estornado
  const saidas = await prisma.movimentacaoEstoque.findMany({
    where: { empresaId, tipo: 'SAIDA_VENDA', origemId: documentoFiscalId },
    select: { produtoId: true, quantidade: true },
  })
  if (saidas.length === 0) return { titulosCancelados: true, estoqueEstornado: false }

  const origemEstorno = `${documentoFiscalId}:ESTORNO`
  const jaEstornou = await prisma.movimentacaoEstoque.findFirst({
    where: { empresaId, tipo: 'ENTRADA_ESTORNO_VENDA', origemId: origemEstorno },
    select: { id: true },
  })
  if (jaEstornou) return { titulosCancelados: true, estoqueEstornado: true }

  await prisma.$transaction(async (tx) => {
    for (const s of saidas) {
      await registrarMovimentacao(tx, {
        empresaId,
        produtoId: s.produtoId,
        tipo: 'ENTRADA_ESTORNO_VENDA',
        quantidade: Number(s.quantidade),
        origemId: origemEstorno,
      })
    }
  })
  return { titulosCancelados: true, estoqueEstornado: true }
}
