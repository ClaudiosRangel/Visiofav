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
