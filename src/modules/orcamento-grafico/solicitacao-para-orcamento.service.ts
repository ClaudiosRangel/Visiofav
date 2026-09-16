import { prisma } from '../../lib/prisma'

/**
 * Integração Solicitação do Representante → Orçamento Gráfico (Opção A).
 *
 * Quando o Comercial "envia para orçamento" uma SolicitacaoOrcamentoRep, este
 * serviço cria um OrcamentoGrafico real (status RASCUNHO), pré-preenchido com
 * os dados da solicitação, e vincula os dois (orcamentoGraficoId).
 *
 * O grande descompasso: a solicitação guarda o tipo de embalagem como texto
 * livre; o OrcamentoGrafico exige tipoEmbalagemId (FK). Resolvemos por match
 * de codigo/descricao (normalizado) ou por override informado pelo Comercial.
 */

/** Normaliza texto para comparação: minúsculas, sem acento, trim. */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

export interface CriarOrcamentoDeSolicitacaoResult {
  orcamentoGraficoId: string
  numero: number
}

/**
 * Tenta resolver o tipoEmbalagemId a partir do texto livre da solicitação.
 * Retorna o id se houver match único por codigo OU descricao normalizados.
 */
async function resolverTipoEmbalagem(
  empresaId: string,
  textoTipo: string,
): Promise<string | null> {
  const alvo = normalizar(textoTipo)
  if (!alvo) return null

  const tipos = await prisma.tipoEmbalagem.findMany({
    where: { empresaId, status: true },
    select: { id: true, codigo: true, descricao: true },
  })

  const matches = tipos.filter(
    (t) => normalizar(t.codigo) === alvo || normalizar(t.descricao) === alvo,
  )

  return matches.length === 1 ? matches[0].id : null
}

/**
 * Cria um OrcamentoGrafico RASCUNHO a partir de uma solicitação e vincula
 * ambos. Idempotente: se a solicitação já tem orcamentoGraficoId, retorna o
 * existente sem recriar.
 *
 * @param tipoEmbalagemIdOverride quando informado pelo Comercial, tem
 *   prioridade sobre o match automático (usado quando o texto livre não casa).
 */
export async function criarOrcamentoGraficoDeSolicitacao(
  solicitacaoId: string,
  empresaId: string,
  usuarioId: string,
  tipoEmbalagemIdOverride?: string,
): Promise<CriarOrcamentoDeSolicitacaoResult> {
  const solicitacao = await prisma.solicitacaoOrcamentoRep.findFirst({
    where: { id: solicitacaoId, empresaId },
    select: {
      id: true,
      status: true,
      orcamentoGraficoId: true,
      clienteId: true,
      clienteNome: true,
      vendedorId: true,
      tipoEmbalagem: true,
      medidaLargura: true,
      medidaAltura: true,
      medidaComprimento: true,
      quantidade: true,
      acabamentos: true,
      observacoes: true,
    },
  })

  if (!solicitacao) {
    throw { statusCode: 404, message: 'Solicitação não encontrada' }
  }

  // Idempotência: já tem orçamento gráfico vinculado
  if (solicitacao.orcamentoGraficoId) {
    const existente = await prisma.orcamentoGrafico.findFirst({
      where: { id: solicitacao.orcamentoGraficoId, empresaId },
      select: { id: true, numero: true },
    })
    if (existente) {
      return { orcamentoGraficoId: existente.id, numero: existente.numero }
    }
  }

  // Resolver o tipo de embalagem (override > match automático)
  const tipoEmbalagemId =
    tipoEmbalagemIdOverride ?? (await resolverTipoEmbalagem(empresaId, solicitacao.tipoEmbalagem))

  if (!tipoEmbalagemId) {
    throw {
      statusCode: 400,
      message:
        `Não foi possível identificar o Tipo de Embalagem para "${solicitacao.tipoEmbalagem}". ` +
        'Selecione um Tipo de Embalagem cadastrado para enviar ao orçamento.',
      code: 'TIPO_EMBALAGEM_NAO_RESOLVIDO',
    }
  }

  // Se veio override, validar que pertence à empresa
  const tipo = await prisma.tipoEmbalagem.findFirst({
    where: { id: tipoEmbalagemId, empresaId },
    select: { id: true },
  })
  if (!tipo) {
    throw { statusCode: 400, message: 'Tipo de embalagem inválido para esta empresa' }
  }

  // Montar medidas JSON a partir das colunas da solicitação (omitir nulas)
  const medidas: Record<string, number> = {}
  if (solicitacao.medidaLargura != null) medidas.L = Number(solicitacao.medidaLargura)
  if (solicitacao.medidaAltura != null) medidas.A = Number(solicitacao.medidaAltura)
  if (solicitacao.medidaComprimento != null) medidas.P = Number(solicitacao.medidaComprimento)

  // Observações do orçamento: referência à solicitação + acabamentos livres
  const obsPartes: string[] = [`Origem: Solicitação do Portal do Representante (${solicitacao.id})`]
  if (solicitacao.acabamentos) obsPartes.push(`Acabamentos solicitados: ${solicitacao.acabamentos}`)
  if (solicitacao.observacoes) obsPartes.push(solicitacao.observacoes)

  // Número sequencial do orçamento gráfico
  const ultimo = await prisma.orcamentoGrafico.findFirst({
    where: { empresaId },
    orderBy: { numero: 'desc' },
    select: { numero: true },
  })
  const numero = (ultimo?.numero ?? 0) + 1

  const orcamento = await prisma.orcamentoGrafico.create({
    data: {
      empresaId,
      numero,
      versao: 1,
      clienteId: solicitacao.clienteId ?? null,
      clienteNome: solicitacao.clienteNome ?? null,
      vendedorId: solicitacao.vendedorId ?? null,
      tipoEmbalagemId,
      medidas,
      quantidade: solicitacao.quantidade,
      status: 'RASCUNHO',
      observacoes: obsPartes.join('\n'),
      criadoPorId: usuarioId,
    },
    select: { id: true, numero: true },
  })

  // Vincular e transicionar a solicitação para EM_ORCAMENTO (+ carimbo)
  await prisma.solicitacaoOrcamentoRep.update({
    where: { id: solicitacao.id },
    data: {
      orcamentoGraficoId: orcamento.id,
      status: 'EM_ORCAMENTO',
      enviadaOrcamentoEm: new Date(),
      enviadaOrcamentoPorId: usuarioId,
    },
  })

  return { orcamentoGraficoId: orcamento.id, numero: orcamento.numero }
}
