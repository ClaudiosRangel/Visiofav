/**
 * Notificações do setor comercial (R4 — spec orcamento-grafico-handoff-
 * comercial). Caixa de entrada interna que espelha o padrão do NotificacaoRep
 * do portal, mas voltada ao comercial da própria empresa. Isolamento por
 * `empresaId` explícito.
 */
import { prisma } from '../../../lib/prisma'

export async function criarNotificacaoComercial(params: {
  empresaId: string
  tipo: string
  titulo: string
  mensagem: string
  referenciaTipo?: string | null
  referenciaId?: string | null
}): Promise<void> {
  await prisma.notificacaoComercial.create({
    data: {
      empresaId: params.empresaId,
      tipo: params.tipo,
      titulo: params.titulo,
      mensagem: params.mensagem,
      referenciaTipo: params.referenciaTipo ?? null,
      referenciaId: params.referenciaId ?? null,
    },
  })
}

export async function listarNotificacoesComercial(
  empresaId: string,
  opcoes?: { page?: number; pageSize?: number },
) {
  const page = opcoes?.page ?? 1
  const pageSize = Math.min(opcoes?.pageSize ?? 50, 200)
  const [total, itens, naoLidas] = await Promise.all([
    prisma.notificacaoComercial.count({ where: { empresaId } }),
    prisma.notificacaoComercial.findMany({
      where: { empresaId },
      orderBy: { criadoEm: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.notificacaoComercial.count({ where: { empresaId, lida: false } }),
  ])
  return { total, page, pageSize, naoLidas, itens }
}

export async function marcarNotificacaoLida(empresaId: string, id: string): Promise<boolean> {
  const existe = await prisma.notificacaoComercial.findFirst({
    where: { id, empresaId },
    select: { id: true },
  })
  if (!existe) return false
  await prisma.notificacaoComercial.update({ where: { id }, data: { lida: true } })
  return true
}

export async function marcarTodasLidas(empresaId: string): Promise<number> {
  const r = await prisma.notificacaoComercial.updateMany({
    where: { empresaId, lida: false },
    data: { lida: true },
  })
  return r.count
}

export async function contarNaoLidasComercial(empresaId: string): Promise<number> {
  return prisma.notificacaoComercial.count({ where: { empresaId, lida: false } })
}
