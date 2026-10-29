// Rotas do CRUD de Templates de Proposta comercial (spec
// comercial-templates-proposta, bloco B1). Prefixo aplicado no server.ts
// (`/api/orcamento-grafico/templates-proposta`). authenticate no onRequest;
// empresaId SEMPRE EXPLÍCITO (isolamento multi-tenant). Só apresentação do PDF.
import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../middleware/authenticate'
import {
  listarTemplates,
  criarTemplate,
  atualizarTemplate,
  excluirTemplate,
  definirTemplateDefault,
  TemplatePropostaError,
} from './template-proposta.service'

const configShape = z
  .object({
    cabecalho: z
      .object({
        mostrarLogo: z.boolean().optional(),
        mostrarRazaoSocial: z.boolean().optional(),
        mostrarCnpj: z.boolean().optional(),
        mostrarTelefone: z.boolean().optional(),
        mostrarEmail: z.boolean().optional(),
      })
      .partial()
      .optional(),
    textos: z
      .object({
        introducao: z.string().optional(),
        condicoes: z.string().optional(),
        rodape: z.string().optional(),
      })
      .partial()
      .optional(),
    blocos: z
      .object({
        engenharia: z.boolean().optional(),
        decomposicaoCustos: z.boolean().optional(),
        variacoesTiragem: z.boolean().optional(),
        validade: z.boolean().optional(),
        observacoes: z.boolean().optional(),
      })
      .partial()
      .optional(),
  })
  .partial()

export async function templatePropostaRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // GET / — lista templates da empresa
  app.get('/', async (request) => {
    const user = request.user as { empresaId: string }
    return listarTemplates(user.empresaId)
  })

  // POST / — cria template
  app.post('/', async (request, reply) => {
    const user = request.user as { empresaId: string }
    const body = z
      .object({
        nome: z.string().min(1, 'Informe o nome do template'),
        isDefault: z.boolean().optional(),
        config: configShape.optional(),
      })
      .parse(request.body)
    const criado = await criarTemplate(user.empresaId, body)
    return reply.status(201).send(criado)
  })

  // PUT /:id — atualiza nome/config
  app.put('/:id', async (request, reply) => {
    const user = request.user as { empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z
      .object({ nome: z.string().min(1).optional(), config: configShape.optional() })
      .parse(request.body)
    try {
      return await atualizarTemplate(user.empresaId, id, body)
    } catch (e) {
      if (e instanceof TemplatePropostaError) return reply.status(e.statusCode).send({ message: e.message, code: e.code })
      throw e
    }
  })

  // PATCH /:id/default — define como default (desmarca os demais)
  app.patch('/:id/default', async (request, reply) => {
    const user = request.user as { empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    try {
      return await definirTemplateDefault(user.empresaId, id)
    } catch (e) {
      if (e instanceof TemplatePropostaError) return reply.status(e.statusCode).send({ message: e.message, code: e.code })
      throw e
    }
  })

  // DELETE /:id — exclui (não permite excluir o default)
  app.delete('/:id', async (request, reply) => {
    const user = request.user as { empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    try {
      return await excluirTemplate(user.empresaId, id)
    } catch (e) {
      if (e instanceof TemplatePropostaError) return reply.status(e.statusCode).send({ message: e.message, code: e.code })
      throw e
    }
  })
}
