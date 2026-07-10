/**
 * Rotas administrativas do Seed Fiscal (NCM/CFOP/CEST) — Requirement 3.
 *
 * - `GET /contagem`: retorna a quantidade de registros ativos nas tabelas
 *   globais Ncm/Cfop/Cest, para a tela de Configurações indicar quais
 *   cadastros já estão populados (Requirement 3.1).
 * - `POST /`: dispara o seed para as tabelas selecionadas no body. Cada
 *   tabela é processada de forma isolada (busca na fonte externa + inserção),
 *   com timeout de 60s por tabela; a falha/timeout de uma tabela não impede
 *   o processamento das demais (Requirements 3.6, 3.7, 3.8, 3.9).
 *
 * Ambas as rotas são restritas a usuários com perfil ADMIN via `perfilGuard`
 * (Requirement 3.6, 3.10). O hook `authenticate` é aplicado pelo módulo
 * pai (`fiscal.routes.ts`) no momento em que estas rotas forem registradas.
 */

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../../lib/prisma'
import { perfilGuard } from '../../../middleware/perfil-guard'
import { buscarDadosExternos, FonteExternaError, TabelaFiscalSeed } from './fonte-externa.service'
import { seedTabela, RegistroInvalidoError } from './seed-fiscal.service'

const TABELAS_VALIDAS = ['NCM', 'CFOP', 'CEST'] as const

const seedBodySchema = z.object({
  tabelas: z.array(z.enum(TABELAS_VALIDAS)).min(1, 'Selecione ao menos uma tabela para o seed'),
})

/** Timeout máximo por tabela selecionada (Requirements 3.8, 3.9). */
const SEED_TIMEOUT_MS = 60_000

/** Erro interno usado apenas para sinalizar o timeout dentro do `Promise.race`. */
class SeedTimeoutError extends Error {
  constructor(tabela: TabelaFiscalSeed) {
    super(`Processamento da tabela ${tabela} excedeu o tempo limite de ${SEED_TIMEOUT_MS / 1000} segundos`)
    this.name = 'SeedTimeoutError'
  }
}

function criarTimeout(tabela: TabelaFiscalSeed): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new SeedTimeoutError(tabela)), SEED_TIMEOUT_MS)
  })
}

interface ResultadoSucesso {
  inseridos: number
  ignorados: number
}

interface ResultadoErro {
  erro: { code: string; message: string }
  /** Preservados apenas quando o erro é `RegistroInvalidoError` (Requirement 3.5). */
  inseridos?: number
  ignorados?: number
}

type ResultadoTabela = ResultadoSucesso | ResultadoErro

/** Busca os dados externos e aplica o seed, em sequência, para uma tabela. */
async function executarSeedTabela(tabela: TabelaFiscalSeed): Promise<ResultadoSucesso> {
  const registros = await buscarDadosExternos(tabela)
  return seedTabela(tabela, registros)
}

/**
 * Processa uma tabela de forma isolada, com timeout de 60s, capturando cada
 * tipo de erro conhecido (fonte externa indisponível/estrutura inválida,
 * registro inválido no meio do lote, ou timeout) e traduzindo para o
 * formato de resposta esperado, sem nunca propagar a exceção — a falha de
 * uma tabela nunca deve impedir o processamento das demais.
 */
async function processarTabelaComTimeout(tabela: TabelaFiscalSeed): Promise<ResultadoTabela> {
  try {
    return await Promise.race([executarSeedTabela(tabela), criarTimeout(tabela)])
  } catch (err) {
    if (err instanceof FonteExternaError) {
      return { erro: { code: err.code, message: err.message } }
    }
    if (err instanceof RegistroInvalidoError) {
      return {
        erro: { code: 'ESTRUTURA_INVALIDA', message: err.message },
        inseridos: err.inseridos,
        ignorados: err.ignorados,
      }
    }
    if (err instanceof SeedTimeoutError) {
      return { erro: { code: 'TIMEOUT', message: err.message } }
    }
    return {
      erro: {
        code: 'ERRO_DESCONHECIDO',
        message: err instanceof Error ? err.message : `Erro desconhecido ao processar ${tabela}`,
      },
    }
  }
}

export async function seedFiscalRoutes(app: FastifyInstance) {
  // Restringe ambas as rotas a usuários com perfil ADMIN (Requirements 3.6, 3.10)
  app.addHook('preHandler', perfilGuard('ADMIN'))

  // ==========================================================================
  // GET /contagem — Contagem de registros ativos em Ncm/Cfop/Cest
  // Validates: Requirements 3.1, 3.10
  // ==========================================================================
  app.get('/contagem', async () => {
    const [ncm, cfop, cest] = await Promise.all([
      prisma.ncm.count({ where: { ativo: true } }),
      prisma.cfop.count({ where: { ativo: true } }),
      prisma.cest.count({ where: { ativo: true } }),
    ])

    return { ncm, cfop, cest }
  })

  // ==========================================================================
  // POST / — Dispara o seed para as tabelas selecionadas
  // Validates: Requirements 3.6, 3.7, 3.8, 3.9, 3.10
  // ==========================================================================
  app.post('/', async (request, reply) => {
    let body: z.infer<typeof seedBodySchema>
    try {
      body = seedBodySchema.parse(request.body)
    } catch (err: any) {
      return reply.status(400).send({ message: 'Dados inválidos', erros: err.errors })
    }

    // Remove duplicatas — cada tabela selecionada é processada uma única vez
    const tabelasSelecionadas = Array.from(new Set(body.tabelas))

    // Processa cada tabela isoladamente (em paralelo); erro/timeout de uma
    // tabela não impede o processamento das demais (Requirements 3.5, 3.8, 3.9)
    const resultados = await Promise.all(
      tabelasSelecionadas.map(async (tabela) => {
        const resultado = await processarTabelaComTimeout(tabela)
        return [tabela, resultado] as const
      })
    )

    const resposta: Record<string, ResultadoTabela> = {}
    for (const [tabela, resultado] of resultados) {
      resposta[tabela] = resultado
    }

    return reply.status(200).send(resposta)
  })
}
