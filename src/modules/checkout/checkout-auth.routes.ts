import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '../../lib/prisma'
import { checkoutAuth } from './checkout-auth.middleware'
import { criarSessaoTerminal, trocarCentroSessao, SessaoTerminalError } from './sessao-terminal.service'
import { identificarOperadorPorPin, criarHashPin, PinOperadorError } from './pin-operador.service'

/**
 * Rotas de autenticação do Checkout de Apontamento (tasks 8.1–8.4 do spec
 * `checkout-apontamento`).
 *
 * Mesmo padrão de export de outros módulos de rotas do projeto (ex.:
 * `etapaOperacionalRoutes` em `etapa-operacional.routes.ts`,
 * `portalRoutes` em `portal.routes.ts`).
 *
 * IMPORTANTE — não registrado ainda no `server.ts`: isso é a task 13.1,
 * futura (ver tasks.md).
 *
 * `POST /auth/sessao` é o único ponto de entrada do Checkout que ainda não
 * tem uma Sessão_Terminal/Token_Checkout — por isso é a única rota deste
 * arquivo que exige `empresaId` explícito no body. As demais rotas deste
 * arquivo que precisam de empresa usam `request.checkoutUser.empresaId`,
 * já resolvido pelo middleware `checkoutAuth`.
 *
 * IMPORTANTE — prefixo dos paths internos: as rotas de sessão são
 * declaradas com o path literal `/auth/sessao*` (em vez de depender de um
 * prefixo `/auth` no registro deste plugin), porque `/operador/identificar`
 * precisa ficar FORA do prefixo `/auth` (ver tabela "Rotas novas do
 * Checkout" em `design.md`: `/checkout/auth/sessao` vs
 * `/checkout/operador/identificar`). Isso permite registrar tanto este
 * arquivo quanto `checkout.routes.ts` com o MESMO prefixo `/api/checkout`
 * em `server.ts` (task 13.1), sem sub-registro aninhado nem colisão de
 * rotas entre os dois módulos.
 */

const sessaoBodySchema = z.object({
  email: z.string().email(),
  senha: z.string().min(1),
  centroProducaoId: z.string().uuid(),
  empresaId: z.string().uuid(),
})

const trocarCentroBodySchema = z.object({
  novoCentroProducaoId: z.string().uuid(),
  email: z.string().email(),
  senha: z.string().min(1),
})

const identificarOperadorBodySchema = z.object({
  pin: z.string().regex(/^\d{6}$/, 'PIN deve ter exatamente 6 dígitos numéricos'),
})

export async function checkoutAuthRoutes(app: FastifyInstance) {
  // =========================================================================
  // POST /auth/pre-login — Valida credenciais do Supervisor e retorna a
  // lista de empresas e centros de produção disponíveis para seleção.
  // Não cria a Sessão_Terminal — é usado pelo frontend para popular os
  // seletores de empresa/centro ANTES do login definitivo.
  // =========================================================================
  app.post('/auth/pre-login', async (request, reply) => {
    const body = z.object({ email: z.string().email(), senha: z.string().min(1) }).parse(request.body)

    // Valida credenciais usando o mesmo fluxo de criarSessaoTerminal,
    // mas sem criar a sessão — apenas verifica email/senha e perfil.
    const usuario = await prisma.usuario.findFirst({ where: { email: body.email } })

    console.log(`[Checkout pre-login] email=${body.email}, encontrado=${!!usuario}, perfil=${usuario?.perfil || 'N/A'}`)

    if (!usuario) return reply.status(401).send({ message: 'Credenciais inválidas' })

    const senhaValida = bcrypt.compareSync(body.senha, usuario.senha)
    console.log(`[Checkout pre-login] senhaValida=${senhaValida}`)

    if (!senhaValida) return reply.status(401).send({ message: 'Credenciais inválidas' })

    if (!['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR'].includes(usuario.perfil)) {
      return reply.status(403).send({ message: 'Perfil não autorizado para autenticar um Terminal' })
    }

    // Busca empresas vinculadas ao usuário
    const empresasVinculadas = await prisma.usuarioEmpresa.findMany({
      where: { usuarioId: usuario.id },
      include: { empresa: { select: { id: true, razaoSocial: true, nomeFantasia: true } } },
    })

    const empresas = empresasVinculadas.map((eu: any) => ({
      id: eu.empresa.id,
      nome: eu.empresa.nomeFantasia || eu.empresa.razaoSocial || eu.empresa.id,
    }))

    // Se só tem uma empresa, já busca os centros dela
    let centros: { id: string; nome: string }[] = []
    if (empresas.length === 1) {
      const centrosDb = await prisma.centroProducao.findMany({
        where: { empresaId: empresas[0].id, status: true },
        select: { id: true, codigo: true, descricao: true },
        orderBy: { posicao: 'asc' },
      })
      centros = centrosDb.map((c: any) => ({ id: c.id, nome: c.descricao || c.codigo || c.id }))
    }

    return reply.status(200).send({ empresas, centros })
  })

  // =========================================================================
  // GET /auth/centros/:empresaId — Retorna os centros de produção ativos
  // de uma empresa (usado quando o Supervisor tem mais de uma empresa e
  // seleciona qual quer usar). Protegido por JWT básico (já emitido pelo
  // login normal do ERP) ou sem proteção (é uma listagem não-sensível de
  // nomes de centros, sem dados de negócio).
  // =========================================================================
  app.get('/auth/centros/:empresaId', async (request, reply) => {
    const { empresaId } = z.object({ empresaId: z.string().uuid() }).parse(request.params)

    const centros = await prisma.centroProducao.findMany({
      where: { empresaId, status: true },
      select: { id: true, codigo: true, descricao: true },
      orderBy: { posicao: 'asc' },
    })

    return reply.status(200).send(
      centros.map((c: any) => ({ id: c.id, nome: c.descricao || c.codigo || c.id }))
    )
  })

  // =========================================================================
  // POST /auth/sessao — Autentica Supervisor + Centro_Producao, cria a
  // Sessão_Terminal e emite o Token_Checkout (Requirements 1.1, 1.2, 1.3, 1.7)
  // =========================================================================
  app.post('/auth/sessao', async (request, reply) => {
    const body = sessaoBodySchema.parse(request.body)

    try {
      const resultado = await criarSessaoTerminal(
        { email: body.email, senha: body.senha },
        body.empresaId,
        body.centroProducaoId,
        request.ip,
        request.headers['user-agent'],
      )

      const token = app.jwt.sign(
        {
          scope: 'CHECKOUT_OPERADOR',
          sessaoTerminalId: resultado.sessaoTerminalId,
          empresaId: resultado.empresaId,
          centroProducaoId: resultado.centroProducaoId,
          autenticadaPorUsuarioId: resultado.autenticadaPorUsuarioId,
        },
        { expiresIn: '12h' },
      )

      return reply.status(201).send({
        token,
        sessaoTerminalId: resultado.sessaoTerminalId,
        centroProducaoId: resultado.centroProducaoId,
        expiraEm: resultado.expiraEm,
      })
    } catch (err) {
      if (err instanceof SessaoTerminalError) {
        return reply.status(err.statusCode).send({ message: err.message })
      }
      throw err
    }
  })

  // =========================================================================
  // PATCH /auth/sessao/trocar-centro — Supervisor troca o Centro_Producao
  // vinculado à Sessão_Terminal ativa (Requirement 1.6)
  //
  // Protegida por checkoutAuth (exige uma Sessão_Terminal ativa para
  // trocar seu próprio centro) — diferente das demais rotas deste arquivo.
  // =========================================================================
  app.patch('/auth/sessao/trocar-centro', { preHandler: [checkoutAuth] }, async (request, reply) => {
    const body = trocarCentroBodySchema.parse(request.body)

    try {
      const resultado = await trocarCentroSessao(
        request.checkoutUser.sessaoTerminalId,
        body.novoCentroProducaoId,
        { email: body.email, senha: body.senha },
        request.ip,
        request.headers['user-agent'],
      )

      // O centroProducaoId mudou — o token antigo ainda tem o centro
      // velho no payload, então um novo Token_Checkout é emitido, com a
      // mesma expiração remanescente da sessão (expiraEm retornado por
      // trocarCentroSessao), não uma nova janela de 12h.
      const expiresInMs = resultado.expiraEm.getTime() - Date.now()
      const expiresInSegundos = Math.max(1, Math.floor(expiresInMs / 1000))

      const token = app.jwt.sign(
        {
          scope: 'CHECKOUT_OPERADOR',
          sessaoTerminalId: resultado.sessaoTerminalId,
          empresaId: resultado.empresaId,
          centroProducaoId: resultado.centroProducaoId,
          autenticadaPorUsuarioId: resultado.autenticadaPorUsuarioId,
        },
        { expiresIn: expiresInSegundos },
      )

      return reply.status(200).send({
        token,
        sessaoTerminalId: resultado.sessaoTerminalId,
        centroProducaoId: resultado.centroProducaoId,
        expiraEm: resultado.expiraEm,
      })
    } catch (err) {
      if (err instanceof SessaoTerminalError) {
        return reply.status(err.statusCode).send({ message: err.message })
      }
      throw err
    }
  })

  // =========================================================================
  // DELETE /auth/sessao — Encerra a Sessão_Terminal manualmente (Requirement 1.4)
  // =========================================================================
  app.delete('/auth/sessao', { preHandler: [checkoutAuth] }, async (request, reply) => {
    await prisma.sessaoTerminal.update({
      where: { id: request.checkoutUser.sessaoTerminalId },
      data: { status: 'ENCERRADA', encerradaEm: new Date() },
    })

    return reply.status(200).send({ message: 'Sessão de Terminal encerrada' })
  })

  // =========================================================================
  // POST /operador/identificar — Identifica o Operador por PIN de 6
  // dígitos (Requirements 2.2, 2.3, 2.4, 2.6, 16.2)
  // =========================================================================
  app.post('/operador/identificar', { preHandler: [checkoutAuth] }, async (request, reply) => {
    const body = identificarOperadorBodySchema.parse(request.body)

    try {
      const resultado = await identificarOperadorPorPin(
        request.checkoutUser.empresaId,
        body.pin,
        request.checkoutUser.sessaoTerminalId,
        request.ip,
        request.headers['user-agent'],
      )

      return reply.status(200).send(resultado)
    } catch (err) {
      if (err instanceof PinOperadorError) {
        return reply.status(err.statusCode).send({ message: err.message })
      }
      throw err
    }
  })

  // =========================================================================
  // PATCH /admin/funcionarios/:id/pin — Define ou atualiza o PIN de um
  // Funcionário (6 dígitos numéricos). Protegida pelo middleware
  // `authenticate` padrão do ERP (não pelo checkoutAuth do Terminal) —
  // quem define PIN é o Admin/Supervisor logado no ERP, não o operador.
  //
  // Aceita `{ pin: "123456" }` e grava o hash em `funcionario.pinHash` +
  // marca `pinAtivo = true`. Para remover o PIN, usar a rota DELETE abaixo.
  // =========================================================================
  app.patch('/admin/funcionarios/:id/pin', async (request, reply) => {
    try { await request.jwtVerify() } catch { return reply.status(401).send({ message: 'Não autenticado' }) }
    const user = request.user as { id: string; empresaId: string; perfil?: string }
    if (!user || !user.empresaId) {
      return reply.status(401).send({ message: 'Não autenticado' })
    }

    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const { pin } = z.object({ pin: z.string().regex(/^\d{6}$/, 'PIN deve ter exatamente 6 dígitos numéricos') }).parse(request.body)

    // Verifica se o funcionário existe e pertence à empresa do usuário logado
    const funcionario = await prisma.funcionario.findFirst({
      where: { id, empresaId: user.empresaId },
      select: { id: true, nome: true },
    })

    if (!funcionario) {
      return reply.status(404).send({ message: 'Funcionário não encontrado' })
    }

    const pinHash = await criarHashPin(pin)

    await prisma.funcionario.update({
      where: { id },
      data: { pinHash, pinAtivo: true },
    })

    return reply.status(200).send({ message: `PIN definido para ${funcionario.nome}`, funcionarioId: id })
  })

  // =========================================================================
  // DELETE /admin/funcionarios/:id/pin — Remove o PIN de um Funcionário
  // (desabilita a identificação por PIN no Checkout para este operador).
  // =========================================================================
  app.delete('/admin/funcionarios/:id/pin', async (request, reply) => {
    try { await request.jwtVerify() } catch { return reply.status(401).send({ message: 'Não autenticado' }) }
    const user = request.user as { id: string; empresaId: string }
    if (!user || !user.empresaId) {
      return reply.status(401).send({ message: 'Não autenticado' })
    }

    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const funcionario = await prisma.funcionario.findFirst({
      where: { id, empresaId: user.empresaId },
      select: { id: true, nome: true },
    })

    if (!funcionario) {
      return reply.status(404).send({ message: 'Funcionário não encontrado' })
    }

    await prisma.funcionario.update({
      where: { id },
      data: { pinHash: null, pinAtivo: false },
    })

    return reply.status(200).send({ message: `PIN removido de ${funcionario.nome}` })
  })

  // =========================================================================
  // GET /admin/funcionarios/pin-status — Lista funcionários da empresa com
  // status do PIN (ativo/inativo), para o Admin ver quem já tem PIN
  // configurado. Não retorna o PIN em si (nem o hash).
  // =========================================================================
  app.get('/admin/funcionarios/pin-status', async (request, reply) => {
    try { await request.jwtVerify() } catch { return reply.status(401).send({ message: 'Não autenticado' }) }
    const user = request.user as { id: string; empresaId: string }
    if (!user || !user.empresaId) {
      return reply.status(401).send({ message: 'Não autenticado' })
    }

    const funcionarios = await prisma.funcionario.findMany({
      where: { empresaId: user.empresaId, status: true },
      select: { id: true, nome: true, codigo: true, matricula: true, pinAtivo: true },
      orderBy: { nome: 'asc' },
    })

    return reply.status(200).send(funcionarios)
  })
}
