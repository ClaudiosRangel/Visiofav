import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { checkoutAuth } from './checkout-auth.middleware'
import { iniciarEtapa, EtapaOperacionalError } from '../pcp/etapa-operacional.service'
import {
  buscarEtapaDoTerminal,
  listarPainelCheckout,
  iniciarSetup,
  finalizarSetup,
  registrarApontamentoProducao,
  pausarEtapaComMotivo,
  concluirEtapaComBloqueio,
  registrarEntradaOperador,
  registrarSaidaOperador,
  listarOperadoresAtivos,
  registrarApontamentoRetroativo,
  registrarApontamentoRetroativoSchema,
  registrarPendenciaMaterial,
  registrarPendenciaMaterialSchema,
  resolverPendenciaMaterial,
  autorizacaoSupervisorSchema,
  listarHistoricoApontamentos,
  listarEtapasEmAlertaParadaProlongada,
  CheckoutError,
} from './checkout.service'

/**
 * Rotas operacionais do Checkout de Apontamento (task 12 do spec
 * `checkout-apontamento`), construídas sobre as regras de negócio de
 * `checkout.service.ts` (task 10) e sobre o service compartilhado
 * `etapa-operacional.service.ts` (task 2).
 *
 * Mesmo padrão de export/estrutura de `checkout-auth.routes.ts`: todas as
 * rotas deste arquivo exigem `checkoutAuth` como `preHandler` (task 12.8),
 * validam o corpo/params via Zod, e envolvem a chamada de negócio em
 * `try/catch`, capturando `CheckoutError`/`EtapaOperacionalError` e
 * respondendo com `err.statusCode` + `{ message: err.message }`.
 *
 * IMPORTANTE — não registrado ainda no `server.ts`: isso é a task 13.1,
 * futura (ver tasks.md).
 *
 * Este arquivo cresce nas tarefas 12.2 a 12.7 subsequentes (setup,
 * apontar/pausar, concluir, operadores ativos, retroativo/pendência de
 * material, histórico/alertas) — cada nova rota segue o mesmo padrão de
 * bloco `app.<metodo>('/rota', { preHandler: [checkoutAuth] }, ...)`
 * definido aqui.
 */

const idParamSchema = z.object({ id: z.string().uuid() })

const iniciarEtapaBodySchema = z.object({
  funcionarioId: z.string().uuid().optional(),
})

// =============================================================================
// Schema local do corpo de POST /etapas/:id/apontar — mesmo formato aceito
// por `registrarApontamentoProducaoSchema` (checkout.service.ts), mas com
// `z.coerce.number()` em `quantidade` porque multipart/form-data entrega
// todos os campos como string (mesmo padrão já usado pela rota original
// `POST /api/pcp/etapas/:id/apontar` em `etapa-operacional.routes.ts`).
// =============================================================================
const apontarBodySchema = z.object({
  tipo: z.enum(['PRODUCAO', 'PERDA', 'RETRABALHO']),
  quantidade: z.coerce.number().min(0, 'Quantidade não pode ser negativa'),
  motivoPerda: z.enum(['ACERTO', 'REFUGO', 'DEFEITO', 'APARA']).optional(),
  funcionarioId: z.string().uuid().optional(),
  observacao: z.string().optional(),
})

const pausarEtapaBodySchema = z.object({
  motivoParada: z.enum(['MANUTENCAO', 'FALTA_MATERIAL', 'ACERTO_MAQUINA', 'TROCA_TURNO', 'OUTRO']),
  paradaPlanejada: z.boolean(),
  observacao: z.string().optional(),
})

// =============================================================================
// Schema local do corpo de PATCH /etapas/:id/concluir — corpo inteiramente
// opcional; `autorizacaoSupervisor` só é exigida pelo service
// (`concluirEtapaComBloqueio`, task 10.9) quando a etapa está bloqueada por
// sequência pendente (Requirement 9.4).
// =============================================================================
const concluirEtapaBodySchema = z.object({
  autorizacaoSupervisor: autorizacaoSupervisorSchema.optional(),
})

// =============================================================================
// Schema local do corpo de POST /etapas/:id/operadores/entrar e
// PATCH /etapas/:id/operadores/saida — mesmo `funcionarioId` validado por
// `checkout.service.ts > registrarEntradaOperador`/`registrarSaidaOperador`
// (task 10.12), aqui apenas para validação de shape na camada de rota.
// =============================================================================
const operadorBodySchema = z.object({
  funcionarioId: z.string().uuid(),
})

// =============================================================================
// Schema local do corpo de POST /apontamentos/:id/retroativo — combina
// `registrarApontamentoRetroativoSchema` (checkout.service.ts, task 10.15)
// com `autorizacaoSupervisor`, opcional nesta camada porque é o próprio
// service (`registrarApontamentoRetroativo`) quem decide bloquear a
// operação quando ausente (Requirement 11.3), retornando o
// `CheckoutError` apropriado.
// =============================================================================
const registrarApontamentoRetroativoBodySchema = registrarApontamentoRetroativoSchema.extend({
  autorizacaoSupervisor: autorizacaoSupervisorSchema.optional(),
})

export async function checkoutRoutes(app: FastifyInstance) {
  // =========================================================================
  // GET /painel — Lista as Etapas do Centro_Producao vinculado à
  // Sessão_Terminal ativa (Requirements 5.4)
  // =========================================================================
  app.get('/painel', { preHandler: [checkoutAuth] }, async (request, reply) => {
    const etapas = await listarPainelCheckout(request.checkoutUser)

    return reply.status(200).send(etapas)
  })

  // =========================================================================
  // PATCH /etapas/:id/iniciar — Inicia ou retoma uma Etapa PENDENTE/PAUSADA
  // pertencente ao Centro_Producao da Sessão_Terminal (Requirements 5.1,
  // 5.2, 5.3)
  // =========================================================================
  app.patch('/etapas/:id/iniciar', { preHandler: [checkoutAuth] }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params)
    const body = iniciarEtapaBodySchema.parse(request.body)

    try {
      // Requirement 5.2, 17.1, 17.2 — valida que a etapa pertence ao
      // Centro_Producao da Sessão_Terminal E à empresa do Token_Checkout
      // antes de delegar. `iniciarEtapa` (etapa-operacional.service.ts)
      // só filtra por empresa — o filtro adicional de centro é aplicado
      // aqui via buscarEtapaDoTerminal, replicando exatamente o padrão já
      // usado por `pausarEtapaComMotivo`/`concluirEtapaComBloqueio` neste
      // mesmo módulo.
      await buscarEtapaDoTerminal(id, request.checkoutUser)

      const funcionarioId = body.funcionarioId ?? request.checkoutUser.autenticadaPorUsuarioId

      const etapa = await iniciarEtapa(id, request.checkoutUser.empresaId, funcionarioId)

      return reply.status(200).send(etapa)
    } catch (err) {
      if (err instanceof CheckoutError || err instanceof EtapaOperacionalError) {
        return reply.status(err.statusCode).send({ message: err.message })
      }
      throw err
    }
  })

  // =========================================================================
  // POST /etapas/:id/setup/iniciar — Inicia o setup de uma Etapa como
  // evento próprio, distinto da produção (Requirement 6.1). Delega para
  // `checkout.service.ts > iniciarSetup` (task 10.3), que já resolve a
  // etapa via `buscarEtapaDoTerminal` e valida o status/setup em aberto.
  // =========================================================================
  app.post('/etapas/:id/setup/iniciar', { preHandler: [checkoutAuth] }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params)

    try {
      const setup = await iniciarSetup(id, request.checkoutUser)

      return reply.status(201).send(setup)
    } catch (err) {
      if (err instanceof CheckoutError || err instanceof EtapaOperacionalError) {
        return reply.status(err.statusCode).send({ message: err.message })
      }
      throw err
    }
  })

  // =========================================================================
  // PATCH /etapas/:id/setup/finalizar — Finaliza o setup em aberto de uma
  // Etapa, gravando `setupFim` e calculando `setupDuracaoMinutos`
  // (Requirement 6.3). Delega para `checkout.service.ts > finalizarSetup`
  // (task 10.3).
  // =========================================================================
  app.patch('/etapas/:id/setup/finalizar', { preHandler: [checkoutAuth] }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params)

    try {
      const setup = await finalizarSetup(id, request.checkoutUser)

      return reply.status(200).send(setup)
    } catch (err) {
      if (err instanceof CheckoutError || err instanceof EtapaOperacionalError) {
        return reply.status(err.statusCode).send({ message: err.message })
      }
      throw err
    }
  })

  // =========================================================================
  // POST /etapas/:id/apontar — Registra apontamento de produção, perda ou
  // retrabalho para a Etapa (Requirements 7.1, 7.2, 7.3). Delega para
  // `checkout.service.ts > registrarApontamentoProducao` (task 10.5), que
  // já valida o corpo via `registrarApontamentoProducaoSchema` e resolve a
  // etapa através de `buscarEtapaDoTerminal`.
  //
  // Aceita tanto JSON puro (Content-Type: application/json, sem foto)
  // quanto multipart/form-data (quando o operador anexa a foto da
  // contagem — Requirement 7.4), reaproveitando exatamente o mesmo padrão
  // de parsing já usado pela rota original `POST /api/pcp/etapas/:id/apontar`
  // em `etapa-operacional.routes.ts`: no multipart, os campos chegam como
  // string e são convertidos via `z.coerce.number()` em `quantidade`.
  // =========================================================================
  app.post('/etapas/:id/apontar', { preHandler: [checkoutAuth] }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params)

    let body: z.infer<typeof apontarBodySchema>
    let fotoUrl: string | undefined

    if (request.isMultipart()) {
      const camposRecebidos: Record<string, string> = {}
      const parts = request.parts()
      for await (const part of parts) {
        if (part.type === 'file') {
          const allowedMimes = ['image/jpeg', 'image/png', 'image/webp']
          if (!allowedMimes.includes(part.mimetype)) {
            return reply.status(400).send({ message: 'Formato de foto inválido. Use JPEG, PNG ou WebP.' })
          }
          const buffer = await part.toBuffer()
          if (buffer.length > 5 * 1024 * 1024) {
            return reply.status(400).send({ message: 'Foto muito grande. Máximo 5MB.' })
          }
          fotoUrl = `data:${part.mimetype};base64,${buffer.toString('base64')}`
        } else {
          camposRecebidos[part.fieldname] = part.value as string
        }
      }
      body = apontarBodySchema.parse(camposRecebidos)
    } else {
      body = apontarBodySchema.parse(request.body)
    }

    try {
      const apontamento = await registrarApontamentoProducao(id, request.checkoutUser, { ...body, fotoUrl })

      return reply.status(201).send(apontamento)
    } catch (err) {
      if (err instanceof CheckoutError || err instanceof EtapaOperacionalError) {
        return reply.status(err.statusCode).send({ message: err.message })
      }
      throw err
    }
  })

  // =========================================================================
  // PATCH /etapas/:id/pausar — Pausa a Etapa exigindo motivo de parada e
  // indicador de parada planejada/não planejada (Requirement 8.1). Delega
  // para `checkout.service.ts > pausarEtapaComMotivo` (task 10.8), que já
  // valida o corpo via `pausarEtapaComMotivoSchema` e resolve a etapa
  // através de `buscarEtapaDoTerminal`.
  // =========================================================================
  app.patch('/etapas/:id/pausar', { preHandler: [checkoutAuth] }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params)
    const body = pausarEtapaBodySchema.parse(request.body)

    try {
      const resultado = await pausarEtapaComMotivo(id, request.checkoutUser, body)

      return reply.status(200).send(resultado)
    } catch (err) {
      if (err instanceof CheckoutError || err instanceof EtapaOperacionalError) {
        return reply.status(err.statusCode).send({ message: err.message })
      }
      throw err
    }
  })

  // =========================================================================
  // PATCH /etapas/:id/concluir — Conclui a Etapa aplicando o bloqueio de
  // sequência entre etapas dependentes, disparando a integração com o WMS
  // quando for a última etapa da Ordem de Produção (Requirement 9.5).
  // Delega para `checkout.service.ts > concluirEtapaComBloqueio` (task
  // 10.9), que já resolve a etapa através de `buscarEtapaDoTerminal` e
  // valida a sequência/autorização de Supervisor.
  // =========================================================================
  app.patch('/etapas/:id/concluir', { preHandler: [checkoutAuth] }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params)
    const body = concluirEtapaBodySchema.parse(request.body ?? {})

    try {
      const etapa = await concluirEtapaComBloqueio(id, request.checkoutUser, body.autorizacaoSupervisor)

      return reply.status(200).send(etapa)
    } catch (err) {
      if (err instanceof CheckoutError || err instanceof EtapaOperacionalError) {
        return reply.status(err.statusCode).send({ message: err.message })
      }
      throw err
    }
  })

  // =========================================================================
  // POST /etapas/:id/operadores/entrar — Registra a entrada de um Operador
  // na Etapa, suportando múltiplos Operadores simultâneos (Requirement
  // 10.1). Delega para `checkout.service.ts > registrarEntradaOperador`
  // (task 10.12), que já resolve a etapa através de
  // `buscarEtapaDoTerminal` e é idempotente para o mesmo `funcionarioId`
  // já ativo.
  // =========================================================================
  app.post('/etapas/:id/operadores/entrar', { preHandler: [checkoutAuth] }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params)
    const body = operadorBodySchema.parse(request.body)

    try {
      const operadorAtivo = await registrarEntradaOperador(id, request.checkoutUser, body.funcionarioId)

      return reply.status(201).send(operadorAtivo)
    } catch (err) {
      if (err instanceof CheckoutError || err instanceof EtapaOperacionalError) {
        return reply.status(err.statusCode).send({ message: err.message })
      }
      throw err
    }
  })

  // =========================================================================
  // PATCH /etapas/:id/operadores/saida — Registra a saída de um Operador
  // da Etapa sem concluí-la, preservando os demais Operadores ativos
  // (Requirement 10.4). Delega para
  // `checkout.service.ts > registrarSaidaOperador` (task 10.12).
  // =========================================================================
  app.patch('/etapas/:id/operadores/saida', { preHandler: [checkoutAuth] }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params)
    const body = operadorBodySchema.parse(request.body)

    try {
      const operadorAtivo = await registrarSaidaOperador(id, request.checkoutUser, body.funcionarioId)

      return reply.status(200).send(operadorAtivo)
    } catch (err) {
      if (err instanceof CheckoutError || err instanceof EtapaOperacionalError) {
        return reply.status(err.statusCode).send({ message: err.message })
      }
      throw err
    }
  })

  // =========================================================================
  // GET /etapas/:id/operadores — Lista os Operadores atualmente ativos
  // (sem `saidaEm`) na Etapa (Requirement 10.4). Delega para
  // `checkout.service.ts > listarOperadoresAtivos` (task 10.12).
  // =========================================================================
  app.get('/etapas/:id/operadores', { preHandler: [checkoutAuth] }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params)

    try {
      const operadoresAtivos = await listarOperadoresAtivos(id, request.checkoutUser)

      return reply.status(200).send(operadoresAtivos)
    } catch (err) {
      if (err instanceof CheckoutError || err instanceof EtapaOperacionalError) {
        return reply.status(err.statusCode).send({ message: err.message })
      }
      throw err
    }
  })

  // =========================================================================
  // POST /apontamentos/:id/retroativo — Registra um Apontamento_Retroativo
  // vinculado a um `ApontamentoEtapa` original, exigindo autorização de
  // Supervisor (Requirement 11.2). O `:id` da rota refere-se ao
  // `apontamentoOrigemId` (o apontamento ORIGINAL sendo corrigido/
  // complementado), não a uma Etapa. Delega para
  // `checkout.service.ts > registrarApontamentoRetroativo` (task 10.15),
  // que já valida `autorizacaoSupervisor`, resolve o apontamento original
  // e a etapa através de `buscarEtapaDoTerminal`, e recalcula os totais
  // da etapa.
  // =========================================================================
  app.post('/apontamentos/:id/retroativo', { preHandler: [checkoutAuth] }, async (request, reply) => {
    const { id: apontamentoOrigemId } = idParamSchema.parse(request.params)
    const { autorizacaoSupervisor, ...dados } = registrarApontamentoRetroativoBodySchema.parse(request.body)

    try {
      const apontamentoRetroativo = await registrarApontamentoRetroativo(
        apontamentoOrigemId,
        request.checkoutUser,
        dados,
        autorizacaoSupervisor,
      )

      return reply.status(201).send(apontamentoRetroativo)
    } catch (err) {
      if (err instanceof CheckoutError || err instanceof EtapaOperacionalError) {
        return reply.status(err.statusCode).send({ message: err.message })
      }
      throw err
    }
  })

  // =========================================================================
  // POST /etapas/:id/pendencia-material — Registra falta de material
  // identificada durante a execução de uma Etapa `EM_ANDAMENTO`
  // (Requirement 12.1). Delega para
  // `checkout.service.ts > registrarPendenciaMaterial` (task 10.18), que
  // já resolve a etapa através de `buscarEtapaDoTerminal`, pausa a etapa
  // com motivo `FALTA_MATERIAL` e cria a `PendenciaMaterial` vinculada.
  // =========================================================================
  app.post('/etapas/:id/pendencia-material', { preHandler: [checkoutAuth] }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params)
    const body = registrarPendenciaMaterialSchema.parse(request.body ?? {})

    try {
      const pendencia = await registrarPendenciaMaterial(id, request.checkoutUser, body)

      return reply.status(201).send(pendencia)
    } catch (err) {
      if (err instanceof CheckoutError || err instanceof EtapaOperacionalError) {
        return reply.status(err.statusCode).send({ message: err.message })
      }
      throw err
    }
  })

  // =========================================================================
  // PATCH /pendencias-material/:id/resolver — Resolve uma
  // `PendenciaMaterial`, permitindo a retomada normal da etapa
  // (Requirement 12.4). Delega para
  // `checkout.service.ts > resolverPendenciaMaterial` (task 10.18), sem
  // corpo de requisição.
  // =========================================================================
  app.patch('/pendencias-material/:id/resolver', { preHandler: [checkoutAuth] }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params)

    try {
      const pendencia = await resolverPendenciaMaterial(id, request.checkoutUser)

      return reply.status(200).send(pendencia)
    } catch (err) {
      if (err instanceof CheckoutError || err instanceof EtapaOperacionalError) {
        return reply.status(err.statusCode).send({ message: err.message })
      }
      throw err
    }
  })

  // =========================================================================
  // GET /etapas/:id/apontamentos — Histórico de apontamentos de uma Etapa
  // em ordem cronológica, com Operador, tipo, quantidade, motivo, horário
  // e vínculo original/retroativo distinguível (Requirement 16.1). Delega
  // para `checkout.service.ts > listarHistoricoApontamentos` (task
  // 10.24), que filtra apenas por `empresaId` da Sessão_Terminal — não
  // por `centroProducaoId` — pois o histórico é visível para qualquer
  // Centro_Producao da mesma empresa (Requirement 16.4).
  // =========================================================================
  app.get('/etapas/:id/apontamentos', { preHandler: [checkoutAuth] }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params)

    try {
      const historico = await listarHistoricoApontamentos(id, request.checkoutUser)

      return reply.status(200).send(historico)
    } catch (err) {
      if (err instanceof CheckoutError || err instanceof EtapaOperacionalError) {
        return reply.status(err.statusCode).send({ message: err.message })
      }
      throw err
    }
  })

  // =========================================================================
  // GET /supervisor/alertas — Lista as Etapas atualmente em alerta de
  // parada prolongada (PAUSADA há mais de 60 minutos), para o Supervisor
  // acompanhar (Requirement 13.2). Delega para
  // `checkout.service.ts > listarEtapasEmAlertaParadaProlongada` (task
  // 10.22), que também filtra apenas por `empresaId` da Sessão_Terminal.
  // =========================================================================
  app.get('/supervisor/alertas', { preHandler: [checkoutAuth] }, async (request, reply) => {
    try {
      const alertas = await listarEtapasEmAlertaParadaProlongada(request.checkoutUser)

      return reply.status(200).send(alertas)
    } catch (err) {
      if (err instanceof CheckoutError || err instanceof EtapaOperacionalError) {
        return reply.status(err.statusCode).send({ message: err.message })
      }
      throw err
    }
  })
}
