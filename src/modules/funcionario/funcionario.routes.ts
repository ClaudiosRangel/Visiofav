import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import bcrypt from 'bcryptjs'
import { authenticate } from '../../middleware/authenticate'
import { validarDocumento, normalizarDoc } from '../financeiro/documento-validacao'

function getDb(request: any) { return request.prismaScoped || prisma }

// D3 — campos trabalhistas opcionais aceitos em POST/PUT de funcionário.
const camposTrabalhistas = {
  cpf: z.string().optional(),
  cargo: z.string().max(100).optional(),
  dataAdmissao: z.string().optional(),
  salarioBase: z.number().nonnegative().optional(),
  banco: z.string().max(60).optional(),
  agencia: z.string().max(20).optional(),
  conta: z.string().max(30).optional(),
  tipoConta: z.enum(['CORRENTE', 'POUPANCA', 'PIX']).optional(),
  chavePix: z.string().max(140).optional(),
}

/**
 * Valida/normaliza os campos trabalhistas. Valida CPF (se informado) e checa
 * unicidade de CPF por empresa. Converte dataAdmissao para Date. Lança objeto
 * { status, message } em erro (tratado pelo caller).
 */
async function prepararCamposTrabalhistas(
  db: any,
  empresaId: string | undefined,
  body: any,
  idAtual?: string,
): Promise<Record<string, any>> {
  const out: Record<string, any> = {}
  if (body.cargo !== undefined) out.cargo = body.cargo
  if (body.salarioBase !== undefined) out.salarioBase = body.salarioBase
  if (body.banco !== undefined) out.banco = body.banco
  if (body.agencia !== undefined) out.agencia = body.agencia
  if (body.conta !== undefined) out.conta = body.conta
  if (body.tipoConta !== undefined) out.tipoConta = body.tipoConta
  if (body.chavePix !== undefined) out.chavePix = body.chavePix
  if (body.dataAdmissao !== undefined) out.dataAdmissao = body.dataAdmissao ? new Date(body.dataAdmissao) : null

  if (body.cpf !== undefined && body.cpf !== null && String(body.cpf).trim() !== '') {
    const { valido } = validarDocumento(body.cpf)
    if (!valido) throw { status: 422, message: 'cpf: CPF/CNPJ inválido (dígito verificador)' }
    const cpfNorm = normalizarDoc(body.cpf)
    if (empresaId) {
      const dup = await db.funcionario.findFirst({
        where: { empresaId, cpf: cpfNorm, ...(idAtual ? { id: { not: idAtual } } : {}) },
        select: { id: true },
      })
      if (dup) throw { status: 409, message: 'Já existe um funcionário com este CPF nesta empresa' }
    }
    out.cpf = cpfNorm
  }
  return out
}

// Segurança: filtro explícito por empresaId como camada extra além do
// tenant-context (ver zona.routes.ts para o histórico completo do bug).
function getEmpresaId(request: any): string | undefined {
  return (request.user as { empresaId?: string } | undefined)?.empresaId
}

export async function funcionarioRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  app.get('/', async (request) => {
    const db = getDb(request)
    const empresaId = getEmpresaId(request)
    const q = z.object({
      page: z.coerce.number().default(1),
      limit: z.coerce.number().default(20),
      search: z.string().optional(),
      centroDistribuicaoId: z.string().uuid().optional(),
      disponiveis: z.enum(['true', 'false']).optional(),
    }).parse(request.query)

    const where: any = {
      ...(q.search ? { nome: { contains: q.search, mode: 'insensitive' as const } } : {}),
      ...(q.centroDistribuicaoId ? { centroDistribuicaoId: q.centroDistribuicaoId } : {}),
      ...(empresaId ? { empresaId } : {}),
    }

    // Filtrar funcionários que NÃO estão em OS ativa (ABERTO ou EXECUTANDO) com horaFim null
    if (q.disponiveis === 'true') {
      const funcionariosOcupados = await prisma.osFuncionarioWms.findMany({
        where: {
          horaFim: null,
          ordemServico: {
            status: { in: ['ABERTO', 'EXECUTANDO'] },
          },
        },
        select: { funcionarioId: true },
      })

      const idsOcupados = [...new Set(funcionariosOcupados.map((f) => f.funcionarioId))]

      if (idsOcupados.length > 0) {
        where.id = { notIn: idsOcupados }
      }
    }

    const [data, total] = await Promise.all([
      db.funcionario.findMany({
        where, skip: (q.page - 1) * q.limit, take: q.limit, orderBy: { nome: 'asc' },
      }),
      db.funcionario.count({ where }),
    ])
    return { data, total, page: q.page, limit: q.limit, totalPages: Math.ceil(total / q.limit) }
  })

  app.get('/:id', async (request, reply) => {
    const db = getDb(request)
    const empresaId = getEmpresaId(request)
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const item = empresaId
      ? await db.funcionario.findFirst({ where: { id, empresaId } })
      : await db.funcionario.findUnique({ where: { id } })
    if (!item) return reply.status(404).send({ message: 'Não encontrado' })
    return item
  })

  app.post('/', async (request, reply) => {
    const db = getDb(request)
    const empresaId = getEmpresaId(request)
    const body = z.object({
      nome: z.string().min(1),
      matricula: z.string().optional(),
      tipo: z.string().min(1),
      centroDistribuicaoId: z.string().uuid().optional(),
      email: z.string().email().optional(),
      senha: z.string().min(6).optional(),
      ...camposTrabalhistas,
    }).parse(request.body)

    const { email, senha, cpf, cargo, dataAdmissao, salarioBase, banco, agencia, conta, tipoConta, chavePix, ...rest } = body
    let trabalhistas: Record<string, any>
    try {
      trabalhistas = await prepararCamposTrabalhistas(db, empresaId, body)
    } catch (e: any) {
      return reply.status(e.status || 422).send({ message: e.message || 'Dados trabalhistas inválidos' })
    }
    const data = empresaId ? { ...rest, ...trabalhistas, empresaId } : { ...rest, ...trabalhistas }
    const funcionario = await db.funcionario.create({ data })

    // Create user account if email and senha provided (uses global prisma for non-isolated models)
    if (email && senha) {
      const usuario = await prisma.usuario.upsert({
        where: { email },
        update: { nome: data.nome, senha: bcrypt.hashSync(senha, 10) },
        create: { nome: data.nome, email, senha: bcrypt.hashSync(senha, 10), perfil: 'OPERADOR' },
      })
      // Link funcionario directly to usuario
      await db.funcionario.update({ where: { id: funcionario.id }, data: { usuarioId: usuario.id } })
      // Link user to empresa (get from centroDistribuicao)
      if (data.centroDistribuicaoId) {
        const cd = await db.centroDistribuicao.findFirst({ where: { id: data.centroDistribuicaoId }, select: { empresaId: true } })
        if (cd?.empresaId) {
          await prisma.usuarioEmpresa.upsert({
            where: { usuarioId_empresaId: { usuarioId: usuario.id, empresaId: cd.empresaId } },
            update: {},
            create: { usuarioId: usuario.id, empresaId: cd.empresaId, modulos: 'WMS' },
          })
        }
      } else if (empresaId) {
        await prisma.usuarioEmpresa.upsert({
          where: { usuarioId_empresaId: { usuarioId: usuario.id, empresaId } },
          update: {},
          create: { usuarioId: usuario.id, empresaId, modulos: '*' },
        })
      }
    }

    return reply.status(201).send(funcionario)
  })

  app.put('/:id', async (request, reply) => {
    const db = getDb(request)
    const empresaId = getEmpresaId(request)
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    if (empresaId) {
      const existente = await db.funcionario.findFirst({ where: { id, empresaId } })
      if (!existente) return reply.status(404).send({ message: 'Não encontrado' })
    }
    const body = z.object({
      nome: z.string().optional(),
      matricula: z.string().optional(),
      tipo: z.string().optional(),
      presente: z.boolean().optional(),
      status: z.boolean().optional(),
      centroDistribuicaoId: z.string().uuid().nullable().optional(),
      email: z.string().email().optional(),
      senha: z.string().min(6).optional(),
      ...camposTrabalhistas,
    }).parse(request.body)

    const { email, senha, cpf, cargo, dataAdmissao, salarioBase, banco, agencia, conta, tipoConta, chavePix, ...rest } = body
    let trabalhistas: Record<string, any>
    try {
      trabalhistas = await prepararCamposTrabalhistas(db, empresaId, body, id)
    } catch (e: any) {
      return reply.status(e.status || 422).send({ message: e.message || 'Dados trabalhistas inválidos' })
    }
    const data = { ...rest, ...trabalhistas }
    const funcionario = await db.funcionario.update({ where: { id }, data })

    // Create/update user account if email provided (uses global prisma for non-isolated models)
    if (email) {
      const updateData: any = { nome: data.nome || funcionario.nome }
      if (senha) updateData.senha = bcrypt.hashSync(senha, 10)

      const usuario = await prisma.usuario.upsert({
        where: { email },
        update: updateData,
        create: { nome: data.nome || funcionario.nome, email, senha: bcrypt.hashSync(senha || '123456', 10), perfil: 'OPERADOR' },
      })
      // Link funcionario directly to usuario
      await db.funcionario.update({ where: { id }, data: { usuarioId: usuario.id } })
    }

    return funcionario
  })

  app.delete('/:id', async (request, reply) => {
    const db = getDb(request)
    const empresaId = getEmpresaId(request)
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    if (empresaId) {
      const existente = await db.funcionario.findFirst({ where: { id, empresaId } })
      if (!existente) return reply.status(404).send({ message: 'Não encontrado' })
    }
    await db.funcionario.delete({ where: { id } })
    return reply.status(204).send()
  })
}
