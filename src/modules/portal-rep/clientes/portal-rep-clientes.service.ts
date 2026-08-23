import { Prisma } from '@prisma/client'
import { prisma } from '../../../lib/prisma'

/**
 * Serviço de gestão da carteira de clientes do Portal do Representante.
 *
 * Responsável por:
 * - Listar clientes vinculados ao vendedor (carteira própria)
 * - Cadastrar novo cliente no sistema de vendas com vendedorId preenchido
 * - Editar dados complementares (telefone, email, endereço) diretamente
 * - Solicitar alteração de campos fiscais (cria AprovacaoClienteRep, NÃO altera diretamente)
 * - Validar CPF/CNPJ com algoritmo de dígitos verificadores
 * - Tratar duplicidade de documento (409 com opção de vinculação)
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7
 */

// ─── Tipos ──────────────────────────────────────────────────────────────────────

interface PortalRepUser {
  scope: 'portal-rep'
  empresaId: string
  vendedorId: string
  representanteId: string
}

interface DadosCadastroCliente {
  razaoSocial: string
  nomeFantasia?: string | null
  cpfCnpj: string
  inscEstadual?: string | null
  logradouro?: string | null
  numero?: string | null
  complemento?: string | null
  bairro?: string | null
  cidade?: string | null
  codigoMunicipio?: string | null
  uf?: string | null
  cep?: string | null
  telefone?: string | null
  email?: string | null
}

interface DadosComplementares {
  telefone?: string | null
  email?: string | null
  logradouro?: string | null
  numero?: string | null
  complemento?: string | null
  bairro?: string | null
  cidade?: string | null
  codigoMunicipio?: string | null
  uf?: string | null
  cep?: string | null
  nomeFantasia?: string | null
}

interface DadosAlteracaoFiscal {
  razaoSocial?: string
  cpfCnpj?: string
  inscEstadual?: string | null
}

// ─── Validação de CPF ───────────────────────────────────────────────────────────

/**
 * Valida CPF com dígitos verificadores (módulo 11).
 * Aceita string de 11 dígitos numéricos.
 */
export function validarCpf(cpf: string): boolean {
  const limpo = cpf.replace(/\D/g, '')

  if (limpo.length !== 11) return false

  // Rejeitar CPFs com todos os dígitos iguais
  if (/^(\d)\1{10}$/.test(limpo)) return false

  // Cálculo do primeiro dígito verificador
  let soma = 0
  for (let i = 0; i < 9; i++) {
    soma += parseInt(limpo[i], 10) * (10 - i)
  }
  let resto = soma % 11
  const dv1 = resto < 2 ? 0 : 11 - resto

  if (parseInt(limpo[9], 10) !== dv1) return false

  // Cálculo do segundo dígito verificador
  soma = 0
  for (let i = 0; i < 10; i++) {
    soma += parseInt(limpo[i], 10) * (11 - i)
  }
  resto = soma % 11
  const dv2 = resto < 2 ? 0 : 11 - resto

  if (parseInt(limpo[10], 10) !== dv2) return false

  return true
}

// ─── Validação de CNPJ ──────────────────────────────────────────────────────────

/**
 * Valida CNPJ com dígitos verificadores (módulo 11).
 * Aceita string de 14 dígitos numéricos.
 */
export function validarCnpj(cnpj: string): boolean {
  const limpo = cnpj.replace(/\D/g, '')

  if (limpo.length !== 14) return false

  // Rejeitar CNPJs com todos os dígitos iguais
  if (/^(\d)\1{13}$/.test(limpo)) return false

  // Cálculo do primeiro dígito verificador
  const pesos1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  let soma = 0
  for (let i = 0; i < 12; i++) {
    soma += parseInt(limpo[i], 10) * pesos1[i]
  }
  let resto = soma % 11
  const dv1 = resto < 2 ? 0 : 11 - resto

  if (parseInt(limpo[12], 10) !== dv1) return false

  // Cálculo do segundo dígito verificador
  const pesos2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  soma = 0
  for (let i = 0; i < 13; i++) {
    soma += parseInt(limpo[i], 10) * pesos2[i]
  }
  resto = soma % 11
  const dv2 = resto < 2 ? 0 : 11 - resto

  if (parseInt(limpo[13], 10) !== dv2) return false

  return true
}

// ─── Validação CPF/CNPJ (dispatcher) ────────────────────────────────────────────

/**
 * Valida CPF ou CNPJ com base no comprimento da string limpa.
 * Retorna `{ valido: true }` ou `{ valido: false, motivo: string }`.
 */
export function validarCpfCnpj(documento: string): { valido: boolean; motivo?: string } {
  const limpo = documento.replace(/\D/g, '')

  if (limpo.length === 11) {
    if (!validarCpf(limpo)) {
      return { valido: false, motivo: 'CPF inválido: dígitos verificadores não conferem' }
    }
    return { valido: true }
  }

  if (limpo.length === 14) {
    if (!validarCnpj(limpo)) {
      return { valido: false, motivo: 'CNPJ inválido: dígitos verificadores não conferem' }
    }
    return { valido: true }
  }

  return { valido: false, motivo: 'Documento deve ter 11 dígitos (CPF) ou 14 dígitos (CNPJ)' }
}

// ─── Listar Carteira ────────────────────────────────────────────────────────────

/**
 * Lista clientes vinculados ao vendedorId do representante na empresa.
 * Requirement 5.1: exibir apenas clientes da carteira própria.
 */
export async function listarCarteira(portalRepUser: PortalRepUser) {
  const clientes = await prisma.cliente.findMany({
    where: {
      empresaId: portalRepUser.empresaId,
      vendedorId: portalRepUser.vendedorId,
      status: true,
    },
    select: {
      id: true,
      razaoSocial: true,
      nomeFantasia: true,
      cpfCnpj: true,
      inscEstadual: true,
      logradouro: true,
      numero: true,
      complemento: true,
      bairro: true,
      cidade: true,
      codigoMunicipio: true,
      uf: true,
      cep: true,
      telefone: true,
      email: true,
      criadoEm: true,
      atualizadoEm: true,
    },
    orderBy: { razaoSocial: 'asc' },
  })

  return clientes
}

// ─── Cadastrar Cliente ──────────────────────────────────────────────────────────

/**
 * Cadastra um novo cliente no sistema de vendas, vinculando ao vendedorId do representante.
 *
 * Fluxo:
 * 1. Valida CPF/CNPJ com algoritmo de dígitos verificadores
 * 2. Verifica unicidade do documento na empresa
 * 3. Se duplicado: retorna 409 com code DOCUMENTO_EXISTENTE (oferece vinculação)
 * 4. Cria registro em Cliente com vendedorId preenchido
 * 5. Registra LogAuditoriaRep
 *
 * Requirements: 5.2, 5.3, 5.4, 5.5
 */
export async function cadastrarCliente(dados: DadosCadastroCliente, portalRepUser: PortalRepUser) {
  // 1. Validar CPF/CNPJ
  const cpfCnpjLimpo = dados.cpfCnpj.replace(/\D/g, '')
  const validacao = validarCpfCnpj(cpfCnpjLimpo)

  if (!validacao.valido) {
    throw {
      statusCode: 400,
      message: validacao.motivo,
      code: 'DOCUMENTO_INVALIDO',
    }
  }

  // 2. Verificar unicidade na empresa
  const clienteExistente = await prisma.cliente.findFirst({
    where: {
      empresaId: portalRepUser.empresaId,
      cpfCnpj: cpfCnpjLimpo,
    },
    select: {
      id: true,
      razaoSocial: true,
      vendedorId: true,
    },
  })

  // 3. Se duplicado, retornar 409 e oferecer vinculação
  if (clienteExistente) {
    // Se o cliente já pertence ao vendedor, não precisa vincular
    if (clienteExistente.vendedorId === portalRepUser.vendedorId) {
      throw {
        statusCode: 409,
        message: `Cliente já existe na sua carteira: ${clienteExistente.razaoSocial}`,
        code: 'DOCUMENTO_EXISTENTE',
        details: {
          clienteExistente: {
            id: clienteExistente.id,
            razaoSocial: clienteExistente.razaoSocial,
          },
          jaVinculado: true,
        },
      }
    }

    // Cliente existe mas pertence a outro vendedor — criar solicitação de vinculação
    await prisma.aprovacaoClienteRep.create({
      data: {
        empresaId: portalRepUser.empresaId,
        representanteId: portalRepUser.representanteId,
        clienteId: clienteExistente.id,
        tipo: 'VINCULACAO',
        dadosNovos: {
          vendedorId: portalRepUser.vendedorId,
          solicitadoPor: portalRepUser.representanteId,
        } as unknown as Prisma.InputJsonValue,
        status: 'PENDENTE',
      },
    })

    throw {
      statusCode: 409,
      message: `Cliente com este CPF/CNPJ já existe na empresa: ${clienteExistente.razaoSocial}. Uma solicitação de vinculação foi criada para aprovação do administrador.`,
      code: 'DOCUMENTO_EXISTENTE',
      details: {
        clienteExistente: {
          id: clienteExistente.id,
          razaoSocial: clienteExistente.razaoSocial,
        },
        jaVinculado: false,
        vinculacaoSolicitada: true,
      },
    }
  }

  // 4. Criar registro no cadastro central de Clientes com vendedorId
  const novoCliente = await prisma.cliente.create({
    data: {
      empresaId: portalRepUser.empresaId,
      razaoSocial: dados.razaoSocial,
      nomeFantasia: dados.nomeFantasia || null,
      cpfCnpj: cpfCnpjLimpo,
      inscEstadual: dados.inscEstadual || null,
      logradouro: dados.logradouro || null,
      numero: dados.numero || null,
      complemento: dados.complemento || null,
      bairro: dados.bairro || null,
      cidade: dados.cidade || null,
      codigoMunicipio: dados.codigoMunicipio || null,
      uf: dados.uf || null,
      cep: dados.cep || null,
      telefone: dados.telefone || null,
      email: dados.email || null,
      vendedorId: portalRepUser.vendedorId,
      status: true,
    },
    select: {
      id: true,
      razaoSocial: true,
      nomeFantasia: true,
      cpfCnpj: true,
      inscEstadual: true,
      logradouro: true,
      numero: true,
      complemento: true,
      bairro: true,
      cidade: true,
      codigoMunicipio: true,
      uf: true,
      cep: true,
      telefone: true,
      email: true,
      vendedorId: true,
      criadoEm: true,
    },
  })

  // 5. Registrar log de auditoria
  await prisma.logAuditoriaRep.create({
    data: {
      empresaId: portalRepUser.empresaId,
      representanteId: portalRepUser.representanteId,
      acao: 'CLIENTE_CADASTRADO',
      detalhes: `Cliente cadastrado: ${novoCliente.razaoSocial} (${cpfCnpjLimpo})`,
    },
  })

  return novoCliente
}

// ─── Editar Dados Complementares ────────────────────────────────────────────────

/**
 * Atualiza dados complementares (telefone, email, endereço) diretamente na tabela Cliente.
 * Campos fiscais (razaoSocial, cpfCnpj, inscEstadual) NÃO são aceitos aqui.
 *
 * Requirement 5.6: editar dados complementares, propagando para cadastro central.
 */
export async function editarDadosComplementares(
  clienteId: string,
  dados: DadosComplementares,
  portalRepUser: PortalRepUser,
) {
  // Verificar se o cliente pertence à carteira do representante
  const cliente = await prisma.cliente.findFirst({
    where: {
      id: clienteId,
      empresaId: portalRepUser.empresaId,
      vendedorId: portalRepUser.vendedorId,
    },
    select: { id: true, razaoSocial: true },
  })

  if (!cliente) {
    throw {
      statusCode: 404,
      message: 'Cliente não encontrado na sua carteira',
    }
  }

  // Atualizar dados complementares diretamente
  const clienteAtualizado = await prisma.cliente.update({
    where: { id: clienteId },
    data: {
      telefone: dados.telefone !== undefined ? dados.telefone : undefined,
      email: dados.email !== undefined ? dados.email : undefined,
      logradouro: dados.logradouro !== undefined ? dados.logradouro : undefined,
      numero: dados.numero !== undefined ? dados.numero : undefined,
      complemento: dados.complemento !== undefined ? dados.complemento : undefined,
      bairro: dados.bairro !== undefined ? dados.bairro : undefined,
      cidade: dados.cidade !== undefined ? dados.cidade : undefined,
      codigoMunicipio: dados.codigoMunicipio !== undefined ? dados.codigoMunicipio : undefined,
      uf: dados.uf !== undefined ? dados.uf : undefined,
      cep: dados.cep !== undefined ? dados.cep : undefined,
      nomeFantasia: dados.nomeFantasia !== undefined ? dados.nomeFantasia : undefined,
    },
    select: {
      id: true,
      razaoSocial: true,
      nomeFantasia: true,
      cpfCnpj: true,
      inscEstadual: true,
      logradouro: true,
      numero: true,
      complemento: true,
      bairro: true,
      cidade: true,
      codigoMunicipio: true,
      uf: true,
      cep: true,
      telefone: true,
      email: true,
      vendedorId: true,
      atualizadoEm: true,
    },
  })

  return clienteAtualizado
}

// ─── Solicitar Alteração Fiscal ─────────────────────────────────────────────────

/**
 * Solicita alteração de campos fiscais (razaoSocial, cpfCnpj, inscEstadual).
 * NÃO altera o registro Cliente diretamente — cria AprovacaoClienteRep com status PENDENTE.
 *
 * O ERP_Admin aprova ou rejeita a alteração posteriormente.
 *
 * Requirement 5.7: campos fiscais obrigatórios requerem aprovação do admin.
 */
export async function solicitarAlteracaoFiscal(
  clienteId: string,
  dados: DadosAlteracaoFiscal,
  portalRepUser: PortalRepUser,
) {
  // Verificar se o cliente pertence à carteira do representante
  const cliente = await prisma.cliente.findFirst({
    where: {
      id: clienteId,
      empresaId: portalRepUser.empresaId,
      vendedorId: portalRepUser.vendedorId,
    },
    select: {
      id: true,
      razaoSocial: true,
      cpfCnpj: true,
      inscEstadual: true,
    },
  })

  if (!cliente) {
    throw {
      statusCode: 404,
      message: 'Cliente não encontrado na sua carteira',
    }
  }

  // Se estão alterando cpfCnpj, validar o novo valor
  if (dados.cpfCnpj) {
    const cpfCnpjLimpo = dados.cpfCnpj.replace(/\D/g, '')
    const validacao = validarCpfCnpj(cpfCnpjLimpo)

    if (!validacao.valido) {
      throw {
        statusCode: 400,
        message: validacao.motivo,
        code: 'DOCUMENTO_INVALIDO',
      }
    }

    // Verificar unicidade do novo CPF/CNPJ na empresa
    const duplicado = await prisma.cliente.findFirst({
      where: {
        empresaId: portalRepUser.empresaId,
        cpfCnpj: cpfCnpjLimpo,
        id: { not: clienteId },
      },
      select: { id: true, razaoSocial: true },
    })

    if (duplicado) {
      throw {
        statusCode: 409,
        message: `Já existe outro cliente com este CPF/CNPJ: ${duplicado.razaoSocial}`,
        code: 'DOCUMENTO_EXISTENTE',
        details: {
          clienteExistente: {
            id: duplicado.id,
            razaoSocial: duplicado.razaoSocial,
          },
        },
      }
    }

    // Normalizar para salvar limpo
    dados.cpfCnpj = cpfCnpjLimpo
  }

  // Guardar dados anteriores para histórico/comparação
  const dadosAnteriores: Record<string, unknown> = {}
  if (dados.razaoSocial !== undefined) dadosAnteriores.razaoSocial = cliente.razaoSocial
  if (dados.cpfCnpj !== undefined) dadosAnteriores.cpfCnpj = cliente.cpfCnpj
  if (dados.inscEstadual !== undefined) dadosAnteriores.inscEstadual = cliente.inscEstadual

  // Criar AprovacaoClienteRep com status PENDENTE — NÃO alterar Cliente diretamente
  const aprovacao = await prisma.aprovacaoClienteRep.create({
    data: {
      empresaId: portalRepUser.empresaId,
      representanteId: portalRepUser.representanteId,
      clienteId,
      tipo: 'ALTERACAO_FISCAL',
      dadosAnteriores: dadosAnteriores as unknown as Prisma.InputJsonValue,
      dadosNovos: dados as unknown as Prisma.InputJsonValue,
      status: 'PENDENTE',
    },
    select: {
      id: true,
      tipo: true,
      dadosNovos: true,
      status: true,
      criadoEm: true,
    },
  })

  // Registrar log de auditoria
  await prisma.logAuditoriaRep.create({
    data: {
      empresaId: portalRepUser.empresaId,
      representanteId: portalRepUser.representanteId,
      acao: 'ALTERACAO_FISCAL_SOLICITADA',
      detalhes: `Solicitação de alteração fiscal para cliente ${cliente.razaoSocial} (ID: ${clienteId})`,
    },
  })

  return aprovacao
}
