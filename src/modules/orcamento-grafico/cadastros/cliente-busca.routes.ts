import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../../lib/prisma'
import { authenticate } from '../../../middleware/authenticate'

/**
 * Busca de clientes para a Tela 1 do orçamento gráfico (Cliente Principal).
 * Código OU nome, trecho sem diferenciar caixa e acento, máximo de 50,
 * ordenada por nome. Devolve a observação cadastrada do cliente.
 * empresaId EXPLÍCITO (sessão), nunca só prismaScoped.
 */
export const LIMITE_BUSCA_CLIENTES = 50

export function normalizarBusca(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

export interface ClienteBuscaCandidato {
  id: string
  razaoSocial: string
  nomeFantasia: string | null
  codigoCalcgraf: number | null
  /** CNPJ/CPF; casa pelos dígitos digitados (opcional para compatibilidade). */
  cpfCnpj?: string | null
}

/**
 * Filtro puro, tudo por "contém": `q` casa por código, nome ou CNPJ/CPF (dígitos); `codigo` e `nome`
 * específicos, quando informados juntos com `q`, são combinados com E.
 */
export function filtrarClientes(
  candidatos: ClienteBuscaCandidato[],
  params: { q?: string; codigo?: string; nome?: string },
): ClienteBuscaCandidato[] {
  const q = normalizarBusca(params.q ?? '')
  const codigo = (params.codigo ?? '').trim()
  const nome = normalizarBusca(params.nome ?? '')

  const casaNome = (c: ClienteBuscaCandidato, trecho: string) =>
    normalizarBusca(c.razaoSocial).includes(trecho) ||
    (c.nomeFantasia != null && normalizarBusca(c.nomeFantasia).includes(trecho))
  const casaCodigo = (c: ClienteBuscaCandidato, cod: string) =>
    c.codigoCalcgraf != null && String(c.codigoCalcgraf).includes(cod)
  const casaDoc = (c: ClienteBuscaCandidato, trecho: string) => {
    const d = trecho.replace(/\D/g, '')
    return d.length >= 3 && (c.cpfCnpj ?? '').replace(/\D/g, '').includes(d)
  }

  const filtrados = candidatos.filter((c) => {
    if (q && !(casaCodigo(c, q) || casaNome(c, q) || casaDoc(c, q))) return false
    if (codigo && !casaCodigo(c, codigo)) return false
    if (nome && !casaNome(c, nome)) return false
    return true
  })

  return filtrados
    .sort((a, b) => a.razaoSocial.localeCompare(b.razaoSocial, 'pt-BR', { sensitivity: 'base' }))
    .slice(0, LIMITE_BUSCA_CLIENTES)
}

const querySchema = z.object({
  q: z.string().trim().max(200).optional(),
  codigo: z.string().trim().max(20).optional(),
  nome: z.string().trim().max(200).optional(),
})

export async function clienteBuscaRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // GET /api/orcamento-grafico/clientes/busca?q=|codigo=|nome=
  app.get('/busca', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const parsed = querySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.errors[0]?.message ?? 'Parâmetros inválidos' })
    }
    const { q, codigo, nome } = parsed.data
    if (!q && !codigo && !nome) {
      return reply.status(400).send({ message: 'Informe o código ou o nome do cliente' })
    }

    const candidatos = await prisma.cliente.findMany({
      where: { empresaId: user.empresaId, status: true },
      select: { id: true, razaoSocial: true, nomeFantasia: true, codigoCalcgraf: true, cpfCnpj: true },
    })

    const achados = filtrarClientes(candidatos, { q, codigo, nome })
    if (achados.length === 0) return []

    // Observação só dos clientes devolvidos (evita carregar o texto de todos).
    const obs = await prisma.cliente.findMany({
      where: { empresaId: user.empresaId, id: { in: achados.map((c) => c.id) } },
      select: { id: true, observacao: true },
    })
    const mapaObs = new Map(obs.map((o) => [o.id, o.observacao]))

    return achados.map((c) => ({
      id: c.id,
      codigo: c.codigoCalcgraf,
      nome: c.razaoSocial,
      nomeFantasia: c.nomeFantasia,
      cpfCnpj: c.cpfCnpj ?? null,
      observacao: mapaObs.get(c.id) ?? null,
    }))
  })
}
