// Rotas HTTP do submódulo Biblioteca de Cálculos Gráficos (Task 6.1).
//
// Spec: biblioteca-calculos-graficos (Req 1.1, 2.1, 2.3, 4.2, 4.3, 5.1, 6.1,
// 8.1, 8.2).
//
// Expõe `calculoGraficoRoutes(app)` — o CRUD + busca + recálculo do "cálculo
// solto" da biblioteca (estilo "Localiza o Cálculo Padrão" do Calcgraf). O
// prefixo (`/api/calculo-grafico`) é aplicado no registro em `server.ts` (Task
// 6.2) — NÃO é definido aqui.
//
// AUTENTICAÇÃO: segue o mesmo padrão de `orcamento-grafico.routes.ts` — só
// `authenticate` no `onRequest` (sem moduloGuard inline). A rota administrativa
// `POST /importar-acervo` checa o perfil do usuário (ADMIN/SUPER_ADMIN).
//
// MULTI-TENANT (steering ATENCAO §2.1): `empresaId` é SEMPRE EXPLÍCITO
// (`request.user.empresaId`) em toda query — nunca confiamos só no
// `prismaScoped` (bypass SUPER_ADMIN). Cálculo de outra empresa → 404 (sem
// revelar existência cross-tenant).

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../../lib/prisma'
import { authenticate } from '../../../middleware/authenticate'
import { ItemOrcamentoError } from '../orcamento-grafico-item.service'
import type { CamposEngenhariaCalculo } from './calculo-grafico.types'
import {
  criarCalculoGrafico,
  buscarCalculosGraficos,
  obterCalculoGrafico,
  recalcularCalculoGrafico,
  CalculoGraficoError,
} from './calculo-grafico.service'

// ─────────────────────────────────────────────────────────────────────────────
// Schemas Zod reutilizados (shape de engenharia e campos de biblioteca)
// ─────────────────────────────────────────────────────────────────────────────

/** Uma cor de impressão (espelha `CorInput` do item do orçamento). */
const corSchema = z.object({
  nome: z.string(),
  tipo: z.enum(['CMYK', 'PANTONE']),
  coberturaPercent: z.number(),
  precoKg: z.number(),
  rendimentoM2Kg: z.number(),
})

/** Um acabamento rico (espelha `AcabamentoRicoInput` do item do orçamento). */
const acabamentoRicoSchema = z.object({
  acabamentoId: z.string().optional(),
  restricaoAcabamentoId: z.string().optional(),
  nome: z.string().optional(),
  naturezaCusto: z
    .enum(['HORA_MAQUINA', 'MATERIAL_KG', 'MATERIAL_UN', 'CUSTO_FIXO'])
    .optional(),
  variavelKg: z.number().optional(),
  precoKg: z.number().optional(),
  variavelUn: z.number().optional(),
  precoUn: z.number().optional(),
  valorFixo: z.number().optional(),
  custoHora: z.number().optional(),
  producaoHora: z.number().optional(),
  unidadeBase: z.enum(['FOLHA', 'PRODUTO']).optional(),
  quantAcertos: z.number().optional(),
  tempoPorAcertoMin: z.number().optional(),
  tempoPrimeiroAcertoMin: z.number().optional(),
  tempoFixoHoras: z.number().optional(),
  tempoVarHoras: z.number().optional(),
  fatorOperacao: z.number().optional(),
})

/** Item diverso (valor fixo no MD). */
const itemDiversoSchema = z.object({
  descricao: z.string(),
  quantidade: z.number(),
  valor: z.number(),
  fixo: z.boolean().optional(),
})

/** Item fornecido pelo cliente (custo zero). */
const itemFornecidoSchema = z.object({
  descricao: z.string(),
  quantidade: z.number(),
})

/** Campo livre (rótulo/conteúdo) — somente textual. */
const campoLivreSchema = z.object({
  rotulo: z.string(),
  conteudo: z.string(),
})

/**
 * Campos de ENGENHARIA no mesmo shape PLANO de `CamposEngenhariaCalculo`.
 * Obrigatórios: `tipoEmbalagemId`, `medidas`, `numCores`, `quantidade`. Os
 * demais campos de engenharia são opcionais/anuláveis.
 *
 * Reutilizado como base tanto na criação (POST) quanto na atualização (PUT) —
 * no PUT todos os campos ficam opcionais (`.partial()`), aditivos.
 */
const engenhariaShape = {
  // ── Geometria / produto ──
  tipoEmbalagemId: z.string().min(1),
  descricao: z.string().nullish(),
  medidas: z.record(z.number()),

  // ── Papel / suporte ──
  papelId: z.string().nullish(),
  papelDescricao: z.string().nullish(),
  suporteId: z.string().nullish(),
  gramatura: z.number().nullish(),

  // ── Impressão / cores / máquina ──
  numCores: z.number().int(),
  cores: z.array(corSchema).nullish(),
  maquinaId: z.string().nullish(),

  // ── Matriz / tinta (campos planos, como em CamposEngenhariaCalculo) ──
  matrizQuantidade: z.number().nullish(),
  matrizPrecoUnitario: z.number().nullish(),
  tintaModo: z.enum(['COBERTURA', 'CONSUMO_DIRETO']).nullish(),
  tintaConsumoKg: z.number().nullish(),

  // ── Acabamentos ricos / faca / montagem ──
  acabamentosRicos: z.array(acabamentoRicoSchema).nullish(),
  modeloFacaId: z.string().nullish(),
  aproveitamentoManual: z.number().nullish(),
  montagemLinhas: z.number().int().nullish(),
  montagemColunas: z.number().int().nullish(),
  formatoCorteLarguraMm: z.number().nullish(),
  formatoCorteAlturaMm: z.number().nullish(),

  // ── Itens diversos / fornecidos / campos livres ──
  itensDiversos: z.array(itemDiversoSchema).nullish(),
  itensFornecidos: z.array(itemFornecidoSchema).nullish(),
  camposLivres: z.array(campoLivreSchema).nullish(),

  // ── Tiragem e fechamento ──
  quantidade: z.number().int(),
  margemSelecionada: z.number().nullish(),
} as const

/** Campos de BIBLIOTECA (classificação de busca) — todos opcionais. */
const bibliotecaShape = {
  clienteId: z.string().nullish(),
  clienteNome: z.string().nullish(),
  linhaProduto: z.string().nullish(),
  produto: z.string().nullish(),
  descricao: z.string().nullish(),
  siglaAcabado: z.string().nullish(),
} as const

/**
 * Monta o objeto `engenharia: CamposEngenhariaCalculo` a partir do body
 * validado (shape plano). Repassa os campos de engenharia; os campos de
 * biblioteca/foto/totais ficam fora deste shape (tratados pela rota).
 */
function montarEngenharia(
  body: Record<string, unknown>,
): CamposEngenhariaCalculo {
  return {
    tipoEmbalagemId: body.tipoEmbalagemId as string,
    descricao: (body.descricao ?? null) as string | null,
    medidas: body.medidas as Record<string, number>,

    papelId: (body.papelId ?? null) as string | null,
    papelDescricao: (body.papelDescricao ?? null) as string | null,
    suporteId: (body.suporteId ?? null) as string | null,
    gramatura: (body.gramatura ?? null) as number | null,

    numCores: body.numCores as number,
    cores: (body.cores ?? null) as CamposEngenhariaCalculo['cores'],
    maquinaId: (body.maquinaId ?? null) as string | null,

    matrizQuantidade: (body.matrizQuantidade ?? null) as number | null,
    matrizPrecoUnitario: (body.matrizPrecoUnitario ?? null) as number | null,
    tintaModo: (body.tintaModo ?? null) as CamposEngenhariaCalculo['tintaModo'],
    tintaConsumoKg: (body.tintaConsumoKg ?? null) as number | null,

    acabamentosRicos: (body.acabamentosRicos ??
      null) as CamposEngenhariaCalculo['acabamentosRicos'],
    modeloFacaId: (body.modeloFacaId ?? null) as string | null,
    aproveitamentoManual: (body.aproveitamentoManual ?? null) as number | null,
    montagemLinhas: (body.montagemLinhas ?? null) as number | null,
    montagemColunas: (body.montagemColunas ?? null) as number | null,
    formatoCorteLarguraMm: (body.formatoCorteLarguraMm ?? null) as number | null,
    formatoCorteAlturaMm: (body.formatoCorteAlturaMm ?? null) as number | null,

    itensDiversos: (body.itensDiversos ??
      null) as CamposEngenhariaCalculo['itensDiversos'],
    itensFornecidos: (body.itensFornecidos ??
      null) as CamposEngenhariaCalculo['itensFornecidos'],
    camposLivres: (body.camposLivres ??
      null) as CamposEngenhariaCalculo['camposLivres'],

    quantidade: body.quantidade as number,
    margemSelecionada: (body.margemSelecionada ?? null) as number | null,
  }
}

/**
 * Rotas do Cálculo Gráfico (biblioteca). O prefixo `/api/calculo-grafico` é
 * aplicado no registro em `server.ts`.
 */
export async function calculoGraficoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // ───────────────────────────────────────────────────────────────────────────
  // 1. GET / — busca/lista por critérios (Req 2.1, 2.3)
  // ───────────────────────────────────────────────────────────────────────────
  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const query = z
      .object({
        cliente: z.string().optional(),
        linhaProduto: z.string().optional(),
        produto: z.string().optional(),
        descricao: z.string().optional(),
        siglaAcabado: z.string().optional(),
        numero: z.coerce.number().int().optional(),
        numeroCalcgraf: z.coerce.number().int().optional(),
        status: z.enum(['ATIVO', 'RASCUNHO', 'ARQUIVADO']).optional(),
        pagina: z.coerce.number().int().positive().optional().default(1),
        tamanho: z.coerce.number().int().positive().max(100).optional().default(20),
      })
      .parse(request.query)

    return buscarCalculosGraficos({ empresaId: user.empresaId, ...query })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 2. GET /:id — detalhe / foto congelada (Req 4.1, 8.1)
  // ───────────────────────────────────────────────────────────────────────────
  app.get('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string() }).parse(request.params)

    const calc = await obterCalculoGrafico(user.empresaId, id)
    if (!calc) {
      return reply.status(404).send({ message: 'Cálculo não encontrado' })
    }
    return calc
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 3. POST / — criar um cálculo na biblioteca (Req 1.1, 5.1, 8.2)
  // ───────────────────────────────────────────────────────────────────────────
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = z
      .object({
        ...engenhariaShape,
        ...bibliotecaShape,
        // FOTO congelada do resultado do cálculo (Req 4).
        resultadoCalculo: z.any().optional(),
        // Totais do fechamento.
        custoProducao: z.number().nullish(),
        valorTotal: z.number().nullish(),
        // numeroCalcgraf / origem (migração).
        numeroCalcgraf: z.number().int().nullish(),
        origem: z.string().optional(),
      })
      .parse(request.body)

    const engenharia = montarEngenharia(body)

    const criado = await criarCalculoGrafico({
      empresaId: user.empresaId,
      engenharia,
      clienteId: body.clienteId,
      clienteNome: body.clienteNome,
      linhaProduto: body.linhaProduto,
      produto: body.produto,
      descricao: body.descricao,
      siglaAcabado: body.siglaAcabado,
      resultadoCalculo: body.resultadoCalculo,
      custoProducao: body.custoProducao,
      valorTotal: body.valorTotal,
      margemSelecionada: body.margemSelecionada,
      numeroCalcgraf: body.numeroCalcgraf,
      origem: body.origem,
      criadoPorId: user.id,
    })

    return reply.status(201).send(criado)
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 4. PUT /:id — atualizar dados de engenharia / biblioteca (Req 5.1)
  // ───────────────────────────────────────────────────────────────────────────
  app.put('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string() }).parse(request.params)

    // No update todos os campos de engenharia + biblioteca são opcionais.
    const body = z
      .object({
        ...engenhariaShape,
        ...bibliotecaShape,
        custoProducao: z.number().nullish(),
        valorTotal: z.number().nullish(),
      })
      .partial()
      .parse(request.body)

    // Confirma posse (empresaId EXPLÍCITO) → 404 cross-tenant.
    const existente = await obterCalculoGrafico(user.empresaId, id)
    if (!existente) {
      return reply.status(404).send({ message: 'Cálculo não encontrado' })
    }

    // Monta o `data` apenas com os campos presentes no body (aditivo).
    const data: Record<string, unknown> = {}
    for (const [chave, valor] of Object.entries(body)) {
      if (valor === undefined) continue
      // Campos JSON (shape estruturado) são gravados como estão.
      data[chave] = valor as never
    }

    await prisma.calculoGrafico.updateMany({
      where: { id, empresaId: user.empresaId },
      data: data as never,
    })

    // Relê o cálculo atualizado (isolado por empresaId).
    const atualizado = await obterCalculoGrafico(user.empresaId, id)
    return atualizado
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 5. POST /:id/recalcular — recalcula com cadastros atuais (Req 4.2, 4.3)
  // ───────────────────────────────────────────────────────────────────────────
  app.post('/:id/recalcular', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string() }).parse(request.params)

    try {
      const r = await recalcularCalculoGrafico(user.empresaId, id)
      return r
    } catch (e) {
      if (e instanceof CalculoGraficoError) {
        return reply.status(e.statusCode).send({ message: e.message })
      }
      if (e instanceof ItemOrcamentoError) {
        return reply.status(400).send({ message: e.message })
      }
      throw e
    }
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 6. DELETE /:id — exclui um cálculo da biblioteca (Req 5.1)
  // ───────────────────────────────────────────────────────────────────────────
  app.delete('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string() }).parse(request.params)

    // Confirma posse (empresaId EXPLÍCITO) → 404 cross-tenant.
    const existente = await obterCalculoGrafico(user.empresaId, id)
    if (!existente) {
      return reply.status(404).send({ message: 'Cálculo não encontrado' })
    }

    await prisma.calculoGrafico.deleteMany({
      where: { id, empresaId: user.empresaId },
    })

    return { sucesso: true }
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 7. POST /importar-acervo — restrita a ADMIN (Req 6.1)
  // ───────────────────────────────────────────────────────────────────────────
  app.post('/importar-acervo', async (request, reply) => {
    const user = request.user as {
      id: string
      empresaId: string
      perfil?: string
    }

    if (!user.perfil || !['ADMIN', 'SUPER_ADMIN'].includes(user.perfil)) {
      return reply
        .status(403)
        .send({ message: 'Acesso restrito a administradores' })
    }

    // TODO: a integração HTTP da importação do acervo será plugada quando o
    // `import.service` (Task 9) existir. Por ora o importador do acervo é
    // executado via script (`scripts/importar-calculos-calcgraf.ts`), não por
    // esta rota.
    return reply.status(501).send({
      message:
        'Importação do acervo é executada via script scripts/importar-calculos-calcgraf.ts',
    })
  })
}
