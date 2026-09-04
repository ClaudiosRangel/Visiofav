/**
 * Rotas HTTP do módulo Financeiro Vizor (billing do SaaS). Prefixo:
 * `/api/financeiro-vizor` (definido no registro em `server.ts`).
 *
 * Uso EXCLUSIVO do dono do Vizor (`SUPER_ADMIN`). Este plugin registra:
 *   - o hook global `authenticate` (valida o JWT / 401 sem sessão);
 *   - o preHandler `requireSuperAdmin` (403 para perfil ≠ SUPER_ADMIN);
 * como guardas de TODAS as rotas do módulo, e faz o wire das rotas com os
 * services de contrato (`contrato-cobranca.service`), faturas
 * (`fatura.service`) e status (`status-financeiro.service`).
 *
 * ⚠️ ISOLAMENTO INVERTIDO: os services usam o Prisma GLOBAL e filtram
 * explicitamente por `empresaId` da empresa-ALVO (o `:id` da URL), NÃO pela
 * empresa da sessão do SUPER_ADMIN — é o oposto do padrão multi-tenant normal.
 *
 * Mapeamento de erros (ver "Error Handling" no design):
 *   - Zod (validação de entrada) → 422 via `formatarErroZod`;
 *   - `ContratoValidacaoError` → 422;
 *   - `FinanceiroError` → o `statusCode` que ele carrega (422/404/409);
 *   - falta de perfil → 403 (pelo `requireSuperAdmin`); sem sessão → 401.
 *
 * Ver design em `.kiro/specs/financeiro-vizor/design.md`
 * (seções "API — Endpoints" e "Error Handling").
 */

import type { FastifyInstance, FastifyReply } from 'fastify'
import { ZodError } from 'zod'

import { authenticate } from '../../middleware/authenticate'
import {
  ContratoValidacaoError,
  obterDetalheEmpresa,
  salvarContrato,
} from './contrato-cobranca.service'
import {
  FinanceiroError,
  cancelarFatura,
  darBaixa,
  gerarVencimentos,
  listarFaturas,
} from './fatura.service'
import {
  formatarErroZod,
  gerarVencimentosSchema,
  salvarContratoSchema,
} from './financeiro.schemas'
import { requireSuperAdmin } from './require-super-admin'
import {
  inativarEmpresa,
  listarEmpresasComStatus,
  reativarEmpresa,
} from './status-financeiro.service'
import type { SalvarContratoInput } from './financeiro.types'

// ---------------------------------------------------------------------------
// Helper de mapeamento de erro → resposta HTTP
// ---------------------------------------------------------------------------

/**
 * Traduz os erros conhecidos do módulo para a resposta HTTP correta,
 * preservando o estado anterior (nada é persistido em caso de erro):
 *   - `ZodError` → 422 com mensagem "campo: motivo" (`formatarErroZod`);
 *   - `ContratoValidacaoError` → 422 (validação de contrato no service);
 *   - `FinanceiroError` → o `statusCode` que ele carrega (422/404/409);
 *   - demais → repropaga para o error handler global do Fastify (500).
 */
function tratarErro(err: unknown, reply: FastifyReply): FastifyReply {
  if (err instanceof ZodError) {
    return reply.status(422).send(formatarErroZod(err))
  }
  if (err instanceof ContratoValidacaoError) {
    return reply.status(422).send({ message: err.message })
  }
  if (err instanceof FinanceiroError) {
    return reply.status(err.statusCode).send({ message: err.message })
  }
  throw err
}

// ---------------------------------------------------------------------------
// Plugin de rotas
// ---------------------------------------------------------------------------

export async function financeiroVizorRoutes(app: FastifyInstance): Promise<void> {
  // Autenticação (JWT / 401) em TODAS as rotas do módulo.
  app.addHook('onRequest', authenticate)
  // Autorização (perfil SUPER_ADMIN / 403) em TODAS as rotas do módulo.
  app.addHook('preHandler', requireSuperAdmin)

  // GET /empresas — lista todas as empresas com status/total. (Req 2)
  app.get('/empresas', async (_request, reply) => {
    const empresas = await listarEmpresasComStatus()
    return reply.send(empresas)
  })

  // GET /empresas/:id — detalhe: contrato + preços + faturas. (Req 3.1, 4)
  app.get<{ Params: { id: string } }>('/empresas/:id', async (request, reply) => {
    const { id } = request.params
    const [detalhe, faturas] = await Promise.all([
      obterDetalheEmpresa(id),
      listarFaturas(id),
    ])
    return reply.send({ ...detalhe, faturas })
  })

  // PUT /empresas/:id/contrato — cria/atualiza contrato (Zod → 422). (Req 3)
  app.put<{ Params: { id: string } }>('/empresas/:id/contrato', async (request, reply) => {
    try {
      const body = salvarContratoSchema.parse(request.body)
      const input: SalvarContratoInput = {
        dataContrato: body.dataContrato,
        diaVencimento: body.diaVencimento,
        precos: body.precos,
      }
      const detalhe = await salvarContrato(request.params.id, input)
      return reply.send(detalhe)
    } catch (err) {
      return tratarErro(err, reply)
    }
  })

  // POST /empresas/:id/gerar-vencimentos — gera N faturas. (Req 5)
  app.post<{ Params: { id: string } }>(
    '/empresas/:id/gerar-vencimentos',
    async (request, reply) => {
      try {
        const { meses, competenciaInicial } = gerarVencimentosSchema.parse(request.body)
        const resultado = await gerarVencimentos(request.params.id, meses, competenciaInicial)
        return reply.send(resultado)
      } catch (err) {
        return tratarErro(err, reply)
      }
    },
  )

  // POST /empresas/:id/faturas/:faturaId/baixa — baixa de pagamento. (Req 8.1–8.5)
  app.post<{ Params: { id: string; faturaId: string } }>(
    '/empresas/:id/faturas/:faturaId/baixa',
    async (request, reply) => {
      try {
        const fatura = await darBaixa(request.params.id, request.params.faturaId)
        return reply.send(fatura)
      } catch (err) {
        return tratarErro(err, reply)
      }
    },
  )

  // POST /empresas/:id/faturas/:faturaId/cancelar — cancela fatura. (Req 8.9, 8.10)
  app.post<{ Params: { id: string; faturaId: string } }>(
    '/empresas/:id/faturas/:faturaId/cancelar',
    async (request, reply) => {
      try {
        const fatura = await cancelarFatura(request.params.id, request.params.faturaId)
        return reply.send(fatura)
      } catch (err) {
        return tratarErro(err, reply)
      }
    },
  )

  // POST /empresas/:id/reativar — reativa (→ ATIVO), com auditoria. (Req 8.7, 9.4)
  app.post<{ Params: { id: string } }>('/empresas/:id/reativar', async (request, reply) => {
    const user = request.user as { id: string }
    await reativarEmpresa(request.params.id, user.id)
    return reply.send({ empresaId: request.params.id, statusFinanceiro: 'ATIVO' })
  })

  // POST /empresas/:id/inativar — inativa (→ INATIVADO), com auditoria. (Req 9.1)
  app.post<{ Params: { id: string } }>('/empresas/:id/inativar', async (request, reply) => {
    const user = request.user as { id: string }
    await inativarEmpresa(request.params.id, user.id)
    return reply.send({ empresaId: request.params.id, statusFinanceiro: 'INATIVADO' })
  })
}
