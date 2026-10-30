/**
 * Encaminhar Pedido/Proposta (RFQ) → Orçamento Gráfico.
 * Spec comercial-pedido-proposta (Task 5).
 *
 * Cria um OrcamentoGrafico RASCUNHO (etapaCalculo='AGUARDANDO') a partir do RFQ,
 * vincula os dois (OrcamentoGrafico.pedidoPropostaId + PedidoProposta.
 * orcamentoGraficoId) e transiciona o RFQ para ENVIADO_ORCAMENTO — tudo em
 * transação atômica (falha → nada órfão, estado inalterado — Req 5.6).
 *
 * REUSA o mesmo MAPEAMENTO de criarOrcamentoGraficoDeSolicitacao (resolver tipo
 * de embalagem texto→FK; medidas JSON {L,A,P}; observações), aqui adaptado para
 * ler do PedidoProposta. Mantemos cópia enxuta do mapeamento para NÃO arriscar
 * o fluxo da solicitação do representante (em produção).
 */
import { prisma } from '../../../lib/prisma'
import { PedidoPropostaError } from './pedido-proposta-estado.service'

/** Normaliza texto p/ comparação: minúsculas, sem acento, trim. */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/** Resolve o tipoEmbalagemId por match único de código/descrição (normalizado). */
async function resolverTipoEmbalagem(empresaId: string, textoTipo: string | null): Promise<string | null> {
  const alvo = normalizar(textoTipo ?? '')
  if (!alvo) return null
  const tipos = await prisma.tipoEmbalagem.findMany({
    where: { empresaId, status: true },
    select: { id: true, codigo: true, descricao: true },
  })
  const matches = tipos.filter((t) => normalizar(t.codigo) === alvo || normalizar(t.descricao) === alvo)
  return matches.length === 1 ? matches[0].id : null
}

/**
 * Faz o parse de "C x L x A" (mm) em números. Aceita separadores x/X/×, vírgula
 * decimal e espaços. Mapeia para {P:comprimento, L:largura, A:altura} — mesma
 * convenção do motor (planificação 2D/3D usa L/A, 3D usa P). Retorna {} se não
 * conseguir extrair nada.
 */
function parseMedidasTexto(texto: string | null): Record<string, number> {
  if (!texto) return {}
  const nums = (texto.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => Number(n.replace(',', '.'))).filter((n) => Number.isFinite(n) && n > 0)
  const medidas: Record<string, number> = {}
  // Planilha Carton Wega: Comprimento x Largura x Altura
  if (nums[0] != null) { medidas.P = nums[0]; medidas.comprimento = nums[0] }
  if (nums[1] != null) { medidas.L = nums[1]; medidas.largura = nums[1] }
  if (nums[2] != null) { medidas.A = nums[2]; medidas.altura = nums[2] }
  return medidas
}

export interface EncaminharResult {
  orcamentoGraficoId: string
  numero: number
}

export async function criarOrcamentoDePedidoProposta(
  empresaId: string,
  pedidoId: string,
  usuarioId: string,
  tipoEmbalagemIdOverride?: string,
): Promise<EncaminharResult> {
  const rfq = await prisma.pedidoProposta.findFirst({
    where: { id: pedidoId, empresaId },
    select: {
      id: true,
      estado: true,
      orcamentoGraficoId: true,
      clienteId: true,
      clienteNome: true,
      vendedorId: true,
      tipoEmbalagem: true,
      medidasTexto: true,
      quantidade: true,
      acabamentos: true,
      observacoes: true,
      exigeAmostra: true,
      numero: true,
    },
  })
  if (!rfq) throw new PedidoPropostaError(404, 'Pedido/Proposta não encontrado.', 'NAO_ENCONTRADO')

  // Idempotência: se já encaminhado, retorna o orçamento existente.
  if (rfq.orcamentoGraficoId) {
    const existente = await prisma.orcamentoGrafico.findFirst({
      where: { id: rfq.orcamentoGraficoId, empresaId },
      select: { id: true, numero: true },
    })
    if (existente) return { orcamentoGraficoId: existente.id, numero: existente.numero }
  }

  if (rfq.estado !== 'EM_ANALISE') {
    throw new PedidoPropostaError(
      409,
      'O pedido precisa estar EM ANÁLISE para ser encaminhado ao orçamento.',
      'RFQ_NAO_APTO_ENCAMINHAR',
    )
  }

  const tipoEmbalagemId = tipoEmbalagemIdOverride ?? (await resolverTipoEmbalagem(empresaId, rfq.tipoEmbalagem))
  if (!tipoEmbalagemId) {
    throw new PedidoPropostaError(
      400,
      `Não foi possível identificar o Tipo de Embalagem${rfq.tipoEmbalagem ? ` para "${rfq.tipoEmbalagem}"` : ''}. Selecione um Tipo de Embalagem cadastrado.`,
      'TIPO_EMBALAGEM_NAO_RESOLVIDO',
    )
  }
  // Valida que o override (se veio) pertence à empresa.
  const tipo = await prisma.tipoEmbalagem.findFirst({
    where: { id: tipoEmbalagemId, empresaId },
    select: { id: true },
  })
  if (!tipo) throw new PedidoPropostaError(400, 'Tipo de embalagem inválido para esta empresa.', 'VALIDACAO')

  const medidas = parseMedidasTexto(rfq.medidasTexto)

  const obsPartes: string[] = [`Origem: Pedido/Proposta nº ${rfq.numero} (${rfq.id})`]
  if (rfq.acabamentos) obsPartes.push(`Acabamentos solicitados: ${rfq.acabamentos}`)
  if (rfq.observacoes) obsPartes.push(rfq.observacoes)

  // Número sequencial do orçamento gráfico.
  const ultimo = await prisma.orcamentoGrafico.findFirst({
    where: { empresaId },
    orderBy: { numero: 'desc' },
    select: { numero: true },
  })
  const numeroOrc = (ultimo?.numero ?? 0) + 1

  // Transação atômica: cria orçamento + vincula + transiciona o RFQ. Falha em
  // qualquer passo → rollback (sem orçamento órfão, estado do RFQ inalterado).
  const result = await prisma.$transaction(async (tx) => {
    const orc = await tx.orcamentoGrafico.create({
      data: {
        empresaId,
        numero: numeroOrc,
        versao: 1,
        clienteId: rfq.clienteId ?? null,
        clienteNome: rfq.clienteNome ?? null,
        vendedorId: rfq.vendedorId ?? null,
        tipoEmbalagemId,
        medidas,
        quantidade: rfq.quantidade ?? 0,
        status: 'RASCUNHO',
        etapaCalculo: 'AGUARDANDO',
        exigeAmostra: rfq.exigeAmostra ?? false,
        observacoes: obsPartes.join('\n'),
        pedidoPropostaId: rfq.id,
        criadoPorId: usuarioId,
      } as never,
      select: { id: true, numero: true },
    })

    await tx.pedidoProposta.update({
      where: { id: rfq.id },
      data: { orcamentoGraficoId: orc.id, estado: 'ENVIADO_ORCAMENTO' } as never,
    })

    await tx.logPedidoProposta.create({
      data: {
        pedidoPropostaId: rfq.id,
        empresaId,
        estadoAnterior: 'EM_ANALISE',
        estadoNovo: 'ENVIADO_ORCAMENTO',
        usuarioId,
        motivo: `Encaminhado ao orçamento gráfico nº ${orc.numero}`,
      } as never,
    })

    return { orcamentoGraficoId: orc.id, numero: orc.numero }
  })

  return result
}
