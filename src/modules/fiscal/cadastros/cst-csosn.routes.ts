import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { cstCsosnService, cstCsosnCodigoSchema } from './cst-csosn.service'

// === Types ===

export type TipoImposto = 'ICMS' | 'PIS' | 'COFINS' | 'IPI'
export type TipoOperacao = 'ENTRADA' | 'SAIDA' | 'AMBOS'
export type RegimeTributario = 'SIMPLES_NACIONAL' | 'LUCRO_PRESUMIDO' | 'LUCRO_REAL' | 'TODOS'

export interface CstItem {
  codigo: string
  descricao: string
  tipo: TipoImposto
  operacoes: TipoOperacao
}

export interface CsosnItem {
  codigo: string
  descricao: string
  permiteCreditoIcms: boolean
  operacoes: TipoOperacao
}

// === Tabelas de CST — definidas pela legislação ===

/** CST de ICMS (Tabela A + B combinadas, aqui só Tabela B — origem fica à parte) */
export const CST_ICMS: CstItem[] = [
  { codigo: '00', descricao: 'Tributada integralmente', tipo: 'ICMS', operacoes: 'AMBOS' },
  { codigo: '10', descricao: 'Tributada e com cobrança do ICMS por substituição tributária', tipo: 'ICMS', operacoes: 'SAIDA' },
  { codigo: '20', descricao: 'Com redução de base de cálculo', tipo: 'ICMS', operacoes: 'AMBOS' },
  { codigo: '30', descricao: 'Isenta ou não tributada e com cobrança do ICMS por substituição tributária', tipo: 'ICMS', operacoes: 'SAIDA' },
  { codigo: '40', descricao: 'Isenta', tipo: 'ICMS', operacoes: 'AMBOS' },
  { codigo: '41', descricao: 'Não tributada', tipo: 'ICMS', operacoes: 'AMBOS' },
  { codigo: '50', descricao: 'Suspensão', tipo: 'ICMS', operacoes: 'AMBOS' },
  { codigo: '51', descricao: 'Diferimento', tipo: 'ICMS', operacoes: 'SAIDA' },
  { codigo: '60', descricao: 'ICMS cobrado anteriormente por substituição tributária', tipo: 'ICMS', operacoes: 'ENTRADA' },
  { codigo: '70', descricao: 'Com redução de base de cálculo e cobrança do ICMS por substituição tributária', tipo: 'ICMS', operacoes: 'SAIDA' },
  { codigo: '90', descricao: 'Outros', tipo: 'ICMS', operacoes: 'AMBOS' },
]

/** CST de PIS */
export const CST_PIS: CstItem[] = [
  { codigo: '01', descricao: 'Operação tributável com alíquota básica', tipo: 'PIS', operacoes: 'AMBOS' },
  { codigo: '02', descricao: 'Operação tributável com alíquota diferenciada', tipo: 'PIS', operacoes: 'AMBOS' },
  { codigo: '03', descricao: 'Operação tributável com alíquota por unidade de medida de produto', tipo: 'PIS', operacoes: 'AMBOS' },
  { codigo: '04', descricao: 'Operação tributável monofásica – revenda a alíquota zero', tipo: 'PIS', operacoes: 'SAIDA' },
  { codigo: '05', descricao: 'Operação tributável por substituição tributária', tipo: 'PIS', operacoes: 'AMBOS' },
  { codigo: '06', descricao: 'Operação tributável a alíquota zero', tipo: 'PIS', operacoes: 'AMBOS' },
  { codigo: '07', descricao: 'Operação isenta da contribuição', tipo: 'PIS', operacoes: 'AMBOS' },
  { codigo: '08', descricao: 'Operação sem incidência da contribuição', tipo: 'PIS', operacoes: 'AMBOS' },
  { codigo: '09', descricao: 'Operação com suspensão da contribuição', tipo: 'PIS', operacoes: 'AMBOS' },
  { codigo: '49', descricao: 'Outras operações de saída', tipo: 'PIS', operacoes: 'SAIDA' },
  { codigo: '50', descricao: 'Operação com direito a crédito – vinculada exclusivamente a receita tributada no mercado interno', tipo: 'PIS', operacoes: 'ENTRADA' },
  { codigo: '51', descricao: 'Operação com direito a crédito – vinculada exclusivamente a receita não tributada no mercado interno', tipo: 'PIS', operacoes: 'ENTRADA' },
  { codigo: '52', descricao: 'Operação com direito a crédito – vinculada exclusivamente a receita de exportação', tipo: 'PIS', operacoes: 'ENTRADA' },
  { codigo: '53', descricao: 'Operação com direito a crédito – vinculada a receitas tributadas e não-tributadas no mercado interno', tipo: 'PIS', operacoes: 'ENTRADA' },
  { codigo: '54', descricao: 'Operação com direito a crédito – vinculada a receitas tributadas no mercado interno e de exportação', tipo: 'PIS', operacoes: 'ENTRADA' },
  { codigo: '55', descricao: 'Operação com direito a crédito – vinculada a receitas não-tributadas no mercado interno e de exportação', tipo: 'PIS', operacoes: 'ENTRADA' },
  { codigo: '56', descricao: 'Operação com direito a crédito – vinculada a receitas tributadas e não-tributadas no mercado interno, e de exportação', tipo: 'PIS', operacoes: 'ENTRADA' },
  { codigo: '60', descricao: 'Crédito presumido – operação de aquisição vinculada exclusivamente a receita tributada no mercado interno', tipo: 'PIS', operacoes: 'ENTRADA' },
  { codigo: '61', descricao: 'Crédito presumido – operação de aquisição vinculada exclusivamente a receita não-tributada no mercado interno', tipo: 'PIS', operacoes: 'ENTRADA' },
  { codigo: '62', descricao: 'Crédito presumido – operação de aquisição vinculada exclusivamente a receita de exportação', tipo: 'PIS', operacoes: 'ENTRADA' },
  { codigo: '63', descricao: 'Crédito presumido – operação de aquisição vinculada a receitas tributadas e não-tributadas no mercado interno', tipo: 'PIS', operacoes: 'ENTRADA' },
  { codigo: '64', descricao: 'Crédito presumido – operação de aquisição vinculada a receitas tributadas no mercado interno e de exportação', tipo: 'PIS', operacoes: 'ENTRADA' },
  { codigo: '65', descricao: 'Crédito presumido – operação de aquisição vinculada a receitas não-tributadas no mercado interno e de exportação', tipo: 'PIS', operacoes: 'ENTRADA' },
  { codigo: '66', descricao: 'Crédito presumido – operação de aquisição vinculada a receitas tributadas e não-tributadas no mercado interno, e de exportação', tipo: 'PIS', operacoes: 'ENTRADA' },
  { codigo: '67', descricao: 'Crédito presumido – outras operações', tipo: 'PIS', operacoes: 'ENTRADA' },
  { codigo: '70', descricao: 'Operação de aquisição sem direito a crédito', tipo: 'PIS', operacoes: 'ENTRADA' },
  { codigo: '71', descricao: 'Operação de aquisição com isenção', tipo: 'PIS', operacoes: 'ENTRADA' },
  { codigo: '72', descricao: 'Operação de aquisição com suspensão', tipo: 'PIS', operacoes: 'ENTRADA' },
  { codigo: '73', descricao: 'Operação de aquisição a alíquota zero', tipo: 'PIS', operacoes: 'ENTRADA' },
  { codigo: '74', descricao: 'Operação de aquisição sem incidência da contribuição', tipo: 'PIS', operacoes: 'ENTRADA' },
  { codigo: '75', descricao: 'Operação de aquisição por substituição tributária', tipo: 'PIS', operacoes: 'ENTRADA' },
  { codigo: '98', descricao: 'Outras operações de entrada', tipo: 'PIS', operacoes: 'ENTRADA' },
  { codigo: '99', descricao: 'Outras operações', tipo: 'PIS', operacoes: 'AMBOS' },
]

/** CST de COFINS (mesma estrutura do PIS) */
export const CST_COFINS: CstItem[] = CST_PIS.map((item) => ({
  ...item,
  tipo: 'COFINS' as TipoImposto,
}))

/** CST de IPI */
export const CST_IPI: CstItem[] = [
  { codigo: '00', descricao: 'Entrada com recuperação de crédito', tipo: 'IPI', operacoes: 'ENTRADA' },
  { codigo: '01', descricao: 'Entrada tributável com alíquota zero', tipo: 'IPI', operacoes: 'ENTRADA' },
  { codigo: '02', descricao: 'Entrada isenta', tipo: 'IPI', operacoes: 'ENTRADA' },
  { codigo: '03', descricao: 'Entrada não-tributada', tipo: 'IPI', operacoes: 'ENTRADA' },
  { codigo: '04', descricao: 'Entrada imune', tipo: 'IPI', operacoes: 'ENTRADA' },
  { codigo: '05', descricao: 'Entrada com suspensão', tipo: 'IPI', operacoes: 'ENTRADA' },
  { codigo: '49', descricao: 'Outras entradas', tipo: 'IPI', operacoes: 'ENTRADA' },
  { codigo: '50', descricao: 'Saída tributada', tipo: 'IPI', operacoes: 'SAIDA' },
  { codigo: '51', descricao: 'Saída tributável com alíquota zero', tipo: 'IPI', operacoes: 'SAIDA' },
  { codigo: '52', descricao: 'Saída isenta', tipo: 'IPI', operacoes: 'SAIDA' },
  { codigo: '53', descricao: 'Saída não-tributada', tipo: 'IPI', operacoes: 'SAIDA' },
  { codigo: '54', descricao: 'Saída imune', tipo: 'IPI', operacoes: 'SAIDA' },
  { codigo: '55', descricao: 'Saída com suspensão', tipo: 'IPI', operacoes: 'SAIDA' },
  { codigo: '99', descricao: 'Outras saídas', tipo: 'IPI', operacoes: 'SAIDA' },
]

/** CSOSN — Código de Situação da Operação no Simples Nacional */
export const CSOSN_TABLE: CsosnItem[] = [
  { codigo: '101', descricao: 'Tributada pelo Simples Nacional com permissão de crédito', permiteCreditoIcms: true, operacoes: 'SAIDA' },
  { codigo: '102', descricao: 'Tributada pelo Simples Nacional sem permissão de crédito', permiteCreditoIcms: false, operacoes: 'SAIDA' },
  { codigo: '103', descricao: 'Isenção do ICMS no Simples Nacional para faixa de receita bruta', permiteCreditoIcms: false, operacoes: 'SAIDA' },
  { codigo: '201', descricao: 'Tributada pelo Simples Nacional com permissão de crédito e com cobrança do ICMS por substituição tributária', permiteCreditoIcms: true, operacoes: 'SAIDA' },
  { codigo: '202', descricao: 'Tributada pelo Simples Nacional sem permissão de crédito e com cobrança do ICMS por substituição tributária', permiteCreditoIcms: false, operacoes: 'SAIDA' },
  { codigo: '203', descricao: 'Isenção do ICMS no Simples Nacional para faixa de receita bruta e com cobrança do ICMS por substituição tributária', permiteCreditoIcms: false, operacoes: 'SAIDA' },
  { codigo: '300', descricao: 'Imune', permiteCreditoIcms: false, operacoes: 'AMBOS' },
  { codigo: '400', descricao: 'Não tributada pelo Simples Nacional', permiteCreditoIcms: false, operacoes: 'AMBOS' },
  { codigo: '500', descricao: 'ICMS cobrado anteriormente por substituição tributária (substituído) ou por antecipação', permiteCreditoIcms: false, operacoes: 'ENTRADA' },
  { codigo: '900', descricao: 'Outros', permiteCreditoIcms: false, operacoes: 'AMBOS' },
]

// === Query Schemas ===

const listCstQuerySchema = z.object({
  tipo: z.enum(['ICMS', 'PIS', 'COFINS', 'IPI']).optional(),
  operacao: z.enum(['ENTRADA', 'SAIDA']).optional(),
  q: z.string().optional(),
})

const listCsosnQuerySchema = z.object({
  operacao: z.enum(['ENTRADA', 'SAIDA']).optional(),
  q: z.string().optional(),
})

const validarQuerySchema = z.object({
  codigo: z.string().min(1, 'Código é obrigatório'),
  tipo: z.enum(['ICMS', 'PIS', 'COFINS', 'IPI', 'CSOSN']),
  operacao: z.enum(['ENTRADA', 'SAIDA']).optional(),
  regimeTributario: z.coerce.number().int().min(1).max(3).optional(),
})

// === Helpers ===

function getTabelaCst(tipo: TipoImposto): CstItem[] {
  switch (tipo) {
    case 'ICMS': return CST_ICMS
    case 'PIS': return CST_PIS
    case 'COFINS': return CST_COFINS
    case 'IPI': return CST_IPI
  }
}

function filtrarPorOperacao<T extends { operacoes: TipoOperacao }>(itens: T[], operacao?: 'ENTRADA' | 'SAIDA'): T[] {
  if (!operacao) return itens
  return itens.filter((i) => i.operacoes === operacao || i.operacoes === 'AMBOS')
}

function filtrarPorTexto<T extends { codigo: string; descricao: string }>(itens: T[], q?: string): T[] {
  if (!q) return itens
  const termo = q.trim().toLowerCase()
  return itens.filter(
    (i) => i.codigo.includes(termo) || i.descricao.toLowerCase().includes(termo),
  )
}

// === Validação de compatibilidade ===

export interface ValidacaoCstResult {
  valido: boolean
  codigo: string
  descricao?: string
  motivo?: string
}

/**
 * Valida se um código CST/CSOSN é válido e compatível com a operação e regime.
 * Validates: Requirements 34.3, 34.4
 */
export function validarCstCsosn(
  codigo: string,
  tipo: 'ICMS' | 'PIS' | 'COFINS' | 'IPI' | 'CSOSN',
  operacao?: 'ENTRADA' | 'SAIDA',
  regimeTributario?: number,
): ValidacaoCstResult {
  // Validar regime vs tipo de código
  // Regime 1 ou 2 (Simples Nacional) deve usar CSOSN para ICMS
  // Regime 3 (Normal) deve usar CST de ICMS
  if (tipo === 'CSOSN') {
    if (regimeTributario && regimeTributario === 3) {
      return {
        valido: false,
        codigo,
        motivo: 'CSOSN só pode ser utilizado por empresas do Simples Nacional (regime 1 ou 2). Para regime Normal, utilize CST de ICMS.',
      }
    }

    const csosn = CSOSN_TABLE.find((c) => c.codigo === codigo)
    if (!csosn) {
      return {
        valido: false,
        codigo,
        motivo: `CSOSN "${codigo}" não encontrado. Valores válidos: ${CSOSN_TABLE.map((c) => c.codigo).join(', ')}`,
      }
    }

    if (operacao && csosn.operacoes !== 'AMBOS' && csosn.operacoes !== operacao) {
      return {
        valido: false,
        codigo,
        descricao: csosn.descricao,
        motivo: `CSOSN ${codigo} é para operações de ${csosn.operacoes}, mas a operação informada é ${operacao}`,
      }
    }

    return { valido: true, codigo, descricao: csosn.descricao }
  }

  // CST de ICMS — não deve ser usado no Simples Nacional
  if (tipo === 'ICMS' && regimeTributario && (regimeTributario === 1 || regimeTributario === 2)) {
    return {
      valido: false,
      codigo,
      motivo: 'Empresas do Simples Nacional devem utilizar CSOSN ao invés de CST de ICMS.',
    }
  }

  const tabela = getTabelaCst(tipo)
  const cst = tabela.find((c) => c.codigo === codigo)

  if (!cst) {
    return {
      valido: false,
      codigo,
      motivo: `CST ${tipo} "${codigo}" não encontrado. Valores válidos: ${tabela.map((c) => c.codigo).join(', ')}`,
    }
  }

  if (operacao && cst.operacoes !== 'AMBOS' && cst.operacoes !== operacao) {
    return {
      valido: false,
      codigo,
      descricao: cst.descricao,
      motivo: `CST ${tipo} ${codigo} é para operações de ${cst.operacoes}, mas a operação informada é ${operacao}`,
    }
  }

  return { valido: true, codigo, descricao: cst.descricao }
}

// === Schemas do cadastro persistido (tabela cst_csosn) ===

const listCadastroQuerySchema = z.object({
  search: z.string().optional(),
  tipo: z.enum(['CST', 'CSOSN']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

const idParamsSchema = z.object({
  id: z.string().uuid('ID deve ser um UUID válido'),
})

const cadastroBodySchema = z.object({
  codigo: cstCsosnCodigoSchema,
  tipo: z.enum(['CST', 'CSOSN']),
  descricao: z.string().min(1, 'Descrição é obrigatória').max(500),
})

const cadastroUpdateSchema = z.object({
  codigo: cstCsosnCodigoSchema.optional(),
  tipo: z.enum(['CST', 'CSOSN']).optional(),
  descricao: z.string().min(1).max(500).optional(),
})

// === Rotas ===

export async function cstCsosnRoutes(app: FastifyInstance) {
  // ==========================================================================
  // GET /cst-csosn — Listagem paginada do cadastro persistido (CRUD)
  // ==========================================================================
  app.get('/cst-csosn', async (request, reply) => {
    try {
      const filtros = listCadastroQuerySchema.parse(request.query)
      const resultado = await cstCsosnService.listar({
        q: filtros.search,
        tipo: filtros.tipo,
        page: filtros.page,
        pageSize: filtros.limit,
      })
      return resultado
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Parâmetros inválidos', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // POST /cst-csosn — Criar cadastro de CST/CSOSN
  // ==========================================================================
  app.post('/cst-csosn', async (request, reply) => {
    try {
      const body = cadastroBodySchema.parse(request.body)
      const criado = await cstCsosnService.criar(body)
      return reply.status(201).send(criado)
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Dados inválidos', erros: err.errors })
      }
      if (err.message?.includes('Já existe')) {
        return reply.status(422).send({ message: err.message })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // PUT /cst-csosn/:id — Atualizar cadastro de CST/CSOSN
  // ==========================================================================
  app.put('/cst-csosn/:id', async (request, reply) => {
    try {
      const { id } = idParamsSchema.parse(request.params)
      const body = cadastroUpdateSchema.parse(request.body)
      const atualizado = await cstCsosnService.atualizar(id, body)

      if (!atualizado) {
        return reply.status(404).send({ message: 'CST/CSOSN não encontrado' })
      }

      return atualizado
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Dados inválidos', erros: err.errors })
      }
      if (err.message?.includes('Já existe')) {
        return reply.status(422).send({ message: err.message })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // DELETE /cst-csosn/:id — Excluir (soft delete) cadastro de CST/CSOSN
  // ==========================================================================
  app.delete('/cst-csosn/:id', async (request, reply) => {
    try {
      const { id } = idParamsSchema.parse(request.params)
      const excluido = await cstCsosnService.excluir(id)

      if (!excluido) {
        return reply.status(404).send({ message: 'CST/CSOSN não encontrado' })
      }

      return { message: 'CST/CSOSN excluído com sucesso' }
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Parâmetros inválidos', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /cst — Lista CST filtrados por tipo de imposto e operação
  // Validates: Requirements 34.1
  // ==========================================================================
  app.get('/cst', async (request, reply) => {
    try {
      const filtros = listCstQuerySchema.parse(request.query)

      let resultado: CstItem[]

      if (filtros.tipo) {
        resultado = getTabelaCst(filtros.tipo)
      } else {
        // Retorna todos os CST agrupados
        resultado = [...CST_ICMS, ...CST_PIS, ...CST_COFINS, ...CST_IPI]
      }

      resultado = filtrarPorOperacao(resultado, filtros.operacao)
      resultado = filtrarPorTexto(resultado, filtros.q)

      return { data: resultado, total: resultado.length }
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Parâmetros inválidos', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /csosn — Lista CSOSN (Simples Nacional) filtrados por operação
  // Validates: Requirements 34.2
  // ==========================================================================
  app.get('/csosn', async (request, reply) => {
    try {
      const filtros = listCsosnQuerySchema.parse(request.query)

      let resultado: CsosnItem[] = [...CSOSN_TABLE]

      resultado = filtrarPorOperacao(resultado, filtros.operacao)
      resultado = filtrarPorTexto(resultado, filtros.q)

      return { data: resultado, total: resultado.length }
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Parâmetros inválidos', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /cst-csosn/validar — Valida compatibilidade de CST/CSOSN com operação e regime
  // Validates: Requirements 34.3, 34.4
  // ==========================================================================
  app.get('/cst-csosn/validar', async (request, reply) => {
    try {
      const params = validarQuerySchema.parse(request.query)

      const resultado = validarCstCsosn(
        params.codigo,
        params.tipo,
        params.operacao,
        params.regimeTributario,
      )

      if (!resultado.valido) {
        return reply.status(422).send(resultado)
      }

      return resultado
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Parâmetros inválidos', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })

  // ==========================================================================
  // GET /cst-csosn/por-regime — Retorna CST ou CSOSN correto para o regime tributário
  // Validates: Requirements 34.3
  // ==========================================================================
  app.get('/cst-csosn/por-regime', async (request, reply) => {
    try {
      const querySchema = z.object({
        regimeTributario: z.coerce.number().int().min(1).max(3),
        operacao: z.enum(['ENTRADA', 'SAIDA']).optional(),
      })

      const { regimeTributario, operacao } = querySchema.parse(request.query)

      // Simples Nacional (1 ou 2) → CSOSN; Normal (3) → CST ICMS
      if (regimeTributario === 1 || regimeTributario === 2) {
        let resultado = [...CSOSN_TABLE]
        resultado = filtrarPorOperacao(resultado, operacao)
        return {
          regime: regimeTributario === 1 ? 'SIMPLES_NACIONAL' : 'SIMPLES_NACIONAL_EXCESSO',
          tipoCodigoIcms: 'CSOSN',
          icms: resultado,
          pis: filtrarPorOperacao(CST_PIS, operacao),
          cofins: filtrarPorOperacao(CST_COFINS, operacao),
          ipi: filtrarPorOperacao(CST_IPI, operacao),
        }
      }

      // Regime Normal (Lucro Presumido ou Real)
      return {
        regime: 'NORMAL',
        tipoCodigoIcms: 'CST',
        icms: filtrarPorOperacao(CST_ICMS, operacao),
        pis: filtrarPorOperacao(CST_PIS, operacao),
        cofins: filtrarPorOperacao(CST_COFINS, operacao),
        ipi: filtrarPorOperacao(CST_IPI, operacao),
      }
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ message: 'Parâmetros inválidos', erros: err.errors })
      }
      return reply.status(500).send({ message: err.message || 'Erro interno' })
    }
  })
}
