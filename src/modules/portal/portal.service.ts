import { prisma } from '../../lib/prisma'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'secret'
const JWT_EXPIRES_IN = '7d'
const SALT_ROUNDS = 10

export class PortalService {
  // ===========================================================================
  // AUTENTICAÇÃO
  // ===========================================================================

  /**
   * Login de usuário do portal 3PL.
   * Gera JWT com scope='portal' para diferenciar do token interno.
   */
  async login(email: string, senha: string) {
    const usuario = await prisma.portalUsuario.findFirst({
      where: { email, status: 'ATIVO' },
    })

    if (!usuario) {
      throw { statusCode: 401, message: 'Credenciais inválidas' }
    }

    const senhaValida = await bcrypt.compare(senha, usuario.senhaHash)
    if (!senhaValida) {
      throw { statusCode: 401, message: 'Credenciais inválidas' }
    }

    const token = jwt.sign(
      {
        scope: 'portal',
        portalUsuarioId: usuario.id,
        empresaId: usuario.empresaId,
        clienteId: usuario.clienteId,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN },
    )

    // Atualizar último acesso
    await prisma.portalUsuario.update({
      where: { id: usuario.id },
      data: { ultimoAcesso: new Date() },
    })

    return {
      token,
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        clienteId: usuario.clienteId,
        empresaId: usuario.empresaId,
      },
    }
  }

  // ===========================================================================
  // GESTÃO DE USUÁRIOS (Admin)
  // ===========================================================================

  /**
   * Cria um novo usuário do portal para um cliente.
   */
  async criarUsuario(empresaId: string, data: { clienteId: string; nome: string; email: string; senha: string }) {
    // Verificar se email já existe
    const existente = await prisma.portalUsuario.findFirst({
      where: { email: data.email, empresaId },
    })
    if (existente) {
      throw { statusCode: 409, message: 'Email já cadastrado no portal' }
    }

    const senhaHash = await bcrypt.hash(data.senha, SALT_ROUNDS)

    const usuario = await prisma.portalUsuario.create({
      data: {
        empresaId,
        clienteId: data.clienteId,
        nome: data.nome,
        email: data.email,
        senhaHash,
        status: 'ATIVO',
      },
    })

    return {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      clienteId: usuario.clienteId,
      status: usuario.status,
      criadoEm: usuario.criadoEm,
    }
  }

  /**
   * Lista todos os usuários do portal de uma empresa.
   */
  async listarUsuarios(empresaId: string, filters?: { clienteId?: string; status?: string; page?: number; limit?: number }) {
    const page = filters?.page || 1
    const limit = filters?.limit || 20
    const skip = (page - 1) * limit

    const where: any = { empresaId }
    if (filters?.clienteId) where.clienteId = filters.clienteId
    if (filters?.status) where.status = filters.status

    const [data, total] = await Promise.all([
      prisma.portalUsuario.findMany({
        where,
        skip,
        take: limit,
        orderBy: { criadoEm: 'desc' },
        select: {
          id: true,
          nome: true,
          email: true,
          clienteId: true,
          status: true,
          ultimoAcesso: true,
          criadoEm: true,
        },
      }),
      prisma.portalUsuario.count({ where }),
    ])

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) }
  }

  // ===========================================================================
  // ESTOQUE
  // ===========================================================================

  /**
   * Consulta saldos de estoque do cliente no portal.
   */
  async consultarEstoque(empresaId: string, clienteId: string, page: number = 1, limit: number = 50) {
    const skip = (page - 1) * limit

    // Buscar produtos do cliente
    const where: any = {
      empresaId,
      quantidade: { gt: 0 },
    }

    const [data, total] = await Promise.all([
      prisma.saldoEndereco.findMany({
        where,
        skip,
        take: limit,
        include: {
          produto: { select: { id: true, descricao: true, codigo: true, unidade: true } },
          endereco: { select: { id: true, enderecoCompleto: true } },
        },
        orderBy: { produto: { nome: 'asc' } },
      }),
      prisma.saldoEndereco.count({ where }),
    ])

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) }
  }

  // ===========================================================================
  // FATURAS
  // ===========================================================================

  /**
   * Consulta faturas de armazenagem do cliente.
   */
  async consultarFaturas(empresaId: string, clienteId: string, page: number = 1, limit: number = 20, status?: string) {
    const skip = (page - 1) * limit
    const where: any = { empresaId, clienteId }
    if (status) where.status = status

    const [data, total] = await Promise.all([
      prisma.faturaArmazenagem.findMany({
        where,
        skip,
        take: limit,
        orderBy: { criadoEm: 'desc' },
      }),
      prisma.faturaArmazenagem.count({ where }),
    ])

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) }
  }

  // ===========================================================================
  // SOLICITAÇÕES DE EXPEDIÇÃO
  // ===========================================================================

  /**
   * Cria solicitação de expedição pelo portal.
   * Gera número sequencial SOL-YYYY-NNNNNN.
   */
  async criarSolicitacaoExpedicao(
    empresaId: string,
    clienteId: string,
    portalUsuarioId: string,
    data: { itens: { produtoId: string; quantidade: number }[]; observacao?: string },
  ) {
    // Validar estoque disponível
    for (const item of data.itens) {
      const saldoTotal = await prisma.saldoEndereco.aggregate({
        where: { empresaId, produtoId: item.produtoId },
        _sum: { quantidade: true },
      })
      const disponivel = Number(saldoTotal._sum?.quantidade || 0)
      if (disponivel < item.quantidade) {
        const produto = await prisma.produto.findUnique({ where: { id: item.produtoId }, select: { nome: true } })
        throw {
          statusCode: 422,
          message: `Estoque insuficiente para ${produto?.nome || item.produtoId}. Disponível: ${disponivel}, Solicitado: ${item.quantidade}`,
        }
      }
    }

    // Gerar número sequencial
    const ano = new Date().getFullYear()
    const ultimaSolicitacao = await prisma.solicitacaoExpedicaoPortal.findFirst({
      where: { empresaId, numero: { startsWith: `SOL-${ano}` } },
      orderBy: { criadoEm: 'desc' },
      select: { numero: true },
    })

    let sequencial = 1
    if (ultimaSolicitacao) {
      const partes = ultimaSolicitacao.numero.split('-')
      sequencial = parseInt(partes[2] || '0', 10) + 1
    }

    const numero = `SOL-${ano}-${sequencial.toString().padStart(6, '0')}`

    const solicitacao = await prisma.solicitacaoExpedicaoPortal.create({
      data: {
        empresaId,
        clienteId,
        portalUsuarioId,
        numero,
        status: 'PENDENTE',
        observacao: data.observacao || null,
        itens: {
          create: data.itens.map((item) => ({
            produtoId: item.produtoId,
            quantidade: item.quantidade,
          })),
        },
      },
      include: { itens: true },
    })

    return solicitacao
  }

  /**
   * Lista solicitações de expedição do cliente com filtros.
   */
  async listarSolicitacoes(
    empresaId: string,
    clienteId: string,
    filters?: { status?: string; page?: number; limit?: number },
  ) {
    const page = filters?.page || 1
    const limit = filters?.limit || 20
    const skip = (page - 1) * limit

    const where: any = { empresaId, clienteId }
    if (filters?.status) where.status = filters.status

    const [data, total] = await Promise.all([
      prisma.solicitacaoExpedicaoPortal.findMany({
        where,
        skip,
        take: limit,
        include: { itens: true },
        orderBy: { criadoEm: 'desc' },
      }),
      prisma.solicitacaoExpedicaoPortal.count({ where }),
    ])

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) }
  }

  /**
   * Cancela uma solicitação PENDENTE.
   */
  async cancelarSolicitacao(empresaId: string, clienteId: string, id: string) {
    const solicitacao = await prisma.solicitacaoExpedicaoPortal.findFirst({
      where: { id, empresaId, clienteId },
    })

    if (!solicitacao) {
      throw { statusCode: 404, message: 'Solicitação não encontrada' }
    }

    if (solicitacao.status !== 'PENDENTE') {
      throw { statusCode: 422, message: `Não é possível cancelar solicitação com status ${solicitacao.status}` }
    }

    const atualizada = await prisma.solicitacaoExpedicaoPortal.update({
      where: { id },
      data: { status: 'CANCELADA' },
    })

    return atualizada
  }

  // ===========================================================================
  // NOTIFICAÇÕES
  // ===========================================================================

  /**
   * Lista notificações do usuário do portal.
   */
  async listarNotificacoes(
    empresaId: string,
    clienteId: string,
    portalUsuarioId: string,
    page: number = 1,
    limit: number = 20,
  ) {
    const skip = (page - 1) * limit

    const where = { empresaId, clienteId, portalUsuarioId }

    const [data, total, naoLidas] = await Promise.all([
      prisma.notificacaoPortal.findMany({
        where,
        skip,
        take: limit,
        orderBy: { criadoEm: 'desc' },
      }),
      prisma.notificacaoPortal.count({ where }),
      prisma.notificacaoPortal.count({ where: { ...where, lida: false } }),
    ])

    return { data, total, naoLidas, page, limit, totalPages: Math.ceil(total / limit) }
  }

  /**
   * Marca uma notificação como lida.
   */
  async marcarLida(empresaId: string, id: string) {
    const notificacao = await prisma.notificacaoPortal.findFirst({
      where: { id, empresaId },
    })

    if (!notificacao) {
      throw { statusCode: 404, message: 'Notificação não encontrada' }
    }

    const atualizada = await prisma.notificacaoPortal.update({
      where: { id },
      data: { lida: true },
    })

    return atualizada
  }

  /**
   * Marca todas as notificações do usuário como lidas.
   */
  async marcarTodasLidas(empresaId: string, clienteId: string, portalUsuarioId: string) {
    const result = await prisma.notificacaoPortal.updateMany({
      where: { empresaId, clienteId, portalUsuarioId, lida: false },
      data: { lida: true },
    })

    return { marcadas: result.count }
  }
}

export const portalService = new PortalService()
