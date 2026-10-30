/**
 * Anexos de imagem do Pedido/Proposta (RFQ) — BYTEA no Neon.
 * Spec comercial-pedido-proposta (Task 4).
 *
 * Regras: até 5 imagens por proposta; só `image/*`; ≤ 10MB. O campo binário
 * `dados` NUNCA é retornado em listagem (servido por rota GET dedicada).
 * Isolamento: toda operação valida o pai (PedidoProposta) por `empresaId`.
 */
import { prisma } from '../../../lib/prisma'
import { PedidoPropostaError } from './pedido-proposta-estado.service'

const LIMITE_ANEXOS = 5
const TAMANHO_MAX = 10 * 1024 * 1024 // 10MB

export class AnexoPropostaError extends PedidoPropostaError {}

/** Garante que o pedido pai existe e pertence à empresa. Retorna o id. */
async function garantirPedidoDaEmpresa(empresaId: string, pedidoId: string): Promise<string> {
  const p = await prisma.pedidoProposta.findFirst({
    where: { id: pedidoId, empresaId },
    select: { id: true },
  })
  if (!p) throw new PedidoPropostaError(404, 'Pedido/Proposta não encontrado.', 'NAO_ENCONTRADO')
  return p.id
}

export interface ArquivoAnexo {
  nome: string
  mime: string
  buffer: Buffer
}

export async function adicionarAnexo(
  empresaId: string,
  pedidoId: string,
  file: ArquivoAnexo,
): Promise<{ id: string }> {
  await garantirPedidoDaEmpresa(empresaId, pedidoId)

  if (!file.mime || !file.mime.toLowerCase().startsWith('image/')) {
    throw new PedidoPropostaError(400, 'Apenas imagens são aceitas.', 'MIME_INVALIDO')
  }
  if (file.buffer.length > TAMANHO_MAX) {
    throw new PedidoPropostaError(400, 'Imagem acima do limite de 10MB.', 'ARQUIVO_GRANDE')
  }

  const total = await prisma.anexoPedidoProposta.count({ where: { pedidoPropostaId: pedidoId, empresaId } })
  if (total >= LIMITE_ANEXOS) {
    throw new PedidoPropostaError(409, `Limite de ${LIMITE_ANEXOS} imagens atingido.`, 'LIMITE_ANEXOS')
  }

  const criado = await prisma.anexoPedidoProposta.create({
    data: {
      pedidoPropostaId: pedidoId,
      empresaId,
      nome: file.nome.slice(0, 255),
      tipo: file.mime.slice(0, 100),
      tamanho: file.buffer.length,
      dados: file.buffer,
    },
    select: { id: true },
  })
  return criado
}

export async function obterAnexoBinario(
  empresaId: string,
  pedidoId: string,
  anexoId: string,
): Promise<{ tipo: string; dados: Buffer; nome: string }> {
  await garantirPedidoDaEmpresa(empresaId, pedidoId)
  const anexo = await prisma.anexoPedidoProposta.findFirst({
    where: { id: anexoId, pedidoPropostaId: pedidoId, empresaId },
    select: { tipo: true, dados: true, nome: true },
  })
  if (!anexo) throw new PedidoPropostaError(404, 'Anexo não encontrado.', 'NAO_ENCONTRADO')
  return { tipo: anexo.tipo, dados: Buffer.from(anexo.dados), nome: anexo.nome }
}

export async function removerAnexo(empresaId: string, pedidoId: string, anexoId: string): Promise<void> {
  await garantirPedidoDaEmpresa(empresaId, pedidoId)
  const anexo = await prisma.anexoPedidoProposta.findFirst({
    where: { id: anexoId, pedidoPropostaId: pedidoId, empresaId },
    select: { id: true },
  })
  if (!anexo) throw new PedidoPropostaError(404, 'Anexo não encontrado.', 'NAO_ENCONTRADO')
  await prisma.anexoPedidoProposta.delete({ where: { id: anexo.id } })
}

/** Lista metadados dos anexos — NUNCA o campo binário `dados`. */
export async function listarAnexosMetadados(
  empresaId: string,
  pedidoId: string,
): Promise<Array<{ id: string; nome: string; tipo: string; tamanho: number }>> {
  await garantirPedidoDaEmpresa(empresaId, pedidoId)
  return prisma.anexoPedidoProposta.findMany({
    where: { pedidoPropostaId: pedidoId, empresaId },
    select: { id: true, nome: true, tipo: true, tamanho: true },
    orderBy: { criadoEm: 'asc' },
  })
}

export { LIMITE_ANEXOS, TAMANHO_MAX }
