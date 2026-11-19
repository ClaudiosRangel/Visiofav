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
  garantirEngenhariaCompleta,
  CalculoGraficoError,
} from './calculo-grafico.service'
import { montarMemoriaStc } from './decomposicao-stc.service'
import { gerarPdfPreCalculo, temMemoriaParaPdf, MSG_SEM_MEMORIA } from './pre-calculo-pdf.service'
import { CopiaCalculoError } from './calculo-copia.service'
import {
  incluirCalculoPadrao,
  copiarCalculoPadrao,
  editarCalculoPadrao,
  cancelarCalculoPadrao,
  reativarCalculoPadrao,
} from './calculo-status.service'

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

/** Flag de query string: "true"/"1" → true; "false"/"0"/ausente → false. */
const boolFlag = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((v) => v === true || v === 'true' || v === '1')

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
        cliente: z.string().max(200).optional(),
        clienteNome: z.string().max(200).optional(),
        clienteCodigo: z.string().max(20).optional(),
        semCliente: boolFlag,
        linhaProduto: z.string().max(120).optional(),
        produto: z.string().max(200).optional(),
        descricao: z.string().max(200).optional(),
        siglaAcabado: z.string().max(60).optional(),
        numero: z.coerce.number().int().positive().max(999999999).optional(),
        numeroCalcgraf: z.coerce.number().int().optional(),
        cancelado: boolFlag,
        status: z.enum(['ATIVO', 'RASCUNHO', 'ARQUIVADO']).optional(),
        modo: z.enum(['SELETOR', 'MENU', 'LISTAGEM']).optional(),
        pagina: z.coerce.number().int().positive().optional().default(1),
        tamanho: z.coerce.number().int().positive().max(100).optional(),
        pageSize: z.coerce.number().int().positive().max(100).optional(),
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
  // 2.1 GET /:id/memoria-stc — DEMONSTRAÇÃO (read-only) da memória de custo
  //     registrada no CalculoSTC (papel/tinta/impressão/acabamentos/matriz),
  //     agrupada em MD/CT/SE e somando o custo de produção. Liga cada componente
  //     à Origem. NÃO edita nada. Spec configurador-grafico-calcgraf (Req 5).
  //     empresaId do cálculo EXPLÍCITO (obterCalculoGrafico já filtra).
  // ───────────────────────────────────────────────────────────────────────────
  app.get('/:id/memoria-stc', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string() }).parse(request.params)

    const calc = await obterCalculoGrafico(user.empresaId, id)
    if (!calc) {
      return reply.status(404).send({ message: 'Cálculo não encontrado' })
    }
    const memoria = montarMemoriaStc((calc as { custosCalcgraf?: unknown }).custosCalcgraf)
    return {
      numeroCalcgraf: (calc as { numeroCalcgraf?: number | null }).numeroCalcgraf ?? null,
      ...memoria,
    }
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
  // 6.1 Ações do Menu Cálculo Padrão (spec paridade-fluxo-legado, tarefa 8.1)
  //     incluir / copiar / editar / cancelar / reativar. 404 idêntico para
  //     inexistente e outra empresa; `CopiaCalculoError` traduz o statusCode.
  // ───────────────────────────────────────────────────────────────────────────
  const paramsId = z.object({ id: z.string().min(1, 'obrigatório') })

  type Ctx = { id: string; empresaId: string }
  const executarAcao = async (
    reply: { status: (c: number) => { send: (b: unknown) => unknown } },
    fn: () => Promise<unknown>,
    sucesso = 200,
  ) => {
    try {
      const r = await fn()
      return reply.status(sucesso).send(r)
    } catch (e) {
      if (e instanceof CopiaCalculoError) {
        return reply.status(e.statusCode).send({ message: e.message })
      }
      throw e
    }
  }

  // :id = cálculo de referência (só tipo/linha/produto; não copia engenharia).
  app.post('/:id/incluir', async (request, reply) => {
    const user = request.user as Ctx
    const { id } = paramsId.parse(request.params)
    const body = z
      .object({
        tipoEmbalagemId: z.string().min(1).optional(),
        quantidade: z.number().int().min(1).max(999999999).optional(),
      })
      .parse(request.body ?? {})
    return executarAcao(
      reply,
      () =>
        incluirCalculoPadrao({
          empresaId: user.empresaId,
          usuarioId: user.id,
          referenciaId: id,
          ...body,
        }),
      201,
    )
  })

  app.post('/:id/copiar', async (request, reply) => {
    const user = request.user as Ctx
    const { id } = paramsId.parse(request.params)
    return executarAcao(
      reply,
      () => copiarCalculoPadrao({ empresaId: user.empresaId, usuarioId: user.id, id }),
      201,
    )
  })

  app.post('/:id/editar', async (request, reply) => {
    const user = request.user as Ctx
    const { id } = paramsId.parse(request.params)
    return executarAcao(reply, () => editarCalculoPadrao({ empresaId: user.empresaId, usuarioId: user.id, id }))
  })

  app.post('/:id/cancelar', async (request, reply) => {
    const user = request.user as Ctx
    const { id } = paramsId.parse(request.params)
    return executarAcao(reply, () => cancelarCalculoPadrao({ empresaId: user.empresaId, id }))
  })

  app.post('/:id/reativar', async (request, reply) => {
    const user = request.user as Ctx
    const { id } = paramsId.parse(request.params)
    return executarAcao(reply, () => reativarCalculoPadrao({ empresaId: user.empresaId, id }))
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

  // ───────────────────────────────────────────────────────────────────────────
  // 8. POST /enriquecer-lote — enriquecimento ANTECIPADO da engenharia (ADMIN)
  //    (spec orcamento-repeticao-engenharia-completa, Task 7 — lote prioritário).
  //    Roda `garantirEngenhariaCompleta` nos cálculos MIGRADO_CALCGRAF ainda não
  //    completos, priorizando os mais usados. Idempotente (pula completos).
  //    `empresaId` EXPLÍCITO. NÃO toca PCP. Retorna relatório resolvidos×pendentes.
  // ───────────────────────────────────────────────────────────────────────────
  app.post('/enriquecer-lote', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string; perfil?: string }
    if (!user.perfil || !['ADMIN', 'SUPER_ADMIN'].includes(user.perfil)) {
      return reply.status(403).send({ message: 'Acesso restrito a administradores' })
    }
    const { limite } = z
      .object({ limite: z.coerce.number().int().positive().max(2000).optional().default(400) })
      .parse(request.body ?? {})

    // Candidatos: migrados ainda não completos, da empresa (isolamento explícito).
    const candidatos = await prisma.calculoGrafico.findMany({
      where: {
        empresaId: user.empresaId,
        origem: 'MIGRADO_CALCGRAF',
        engenhariaCompleta: false,
      } as never,
      orderBy: { numeroCalcgraf: 'desc' },
      take: limite,
      select: { id: true, numeroCalcgraf: true },
    })

    let completos = 0
    let comPendencia = 0
    const pendenciasPorCampo: Record<string, number> = {}
    for (const c of candidatos) {
      try {
        const r = await garantirEngenhariaCompleta(user.empresaId, c.id)
        if (r.pendentes.length === 0) completos++
        else {
          comPendencia++
          for (const p of r.pendentes) pendenciasPorCampo[p] = (pendenciasPorCampo[p] ?? 0) + 1
        }
      } catch {
        comPendencia++
      }
    }

    return {
      processados: candidatos.length,
      completos,
      comPendencia,
      pendenciasPorCampo,
    }
  })
}

/**
 * GET /calculo-grafico/:id/pre-calculo.pdf — PDF do Pré-Cálculo (spec
 * paridade-fluxo-legado, Req 15). Plugin SEPARADO (sem o hook global
 * `authenticate`) para aceitar o token na query (`?token=`), como os demais PDFs
 * (requisição de corte / OP). A autenticação é feita aqui: token da query, ou
 * header/cookie como fallback. `empresaId` explícito (404 para outra empresa).
 * Registrado em `server.ts` com o mesmo prefixo `/api/calculo-grafico`.
 */
export async function preCalculoPdfRoutes(app: FastifyInstance) {
  app.get('/:id/pre-calculo.pdf', async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params)
    const { token } = z.object({ token: z.string().optional() }).parse(request.query ?? {})

    let user: { id: string; empresaId?: string; scope?: string } | null = null
    try {
      if (token) {
        const d = app.jwt.verify(token) as { sub?: string; id?: string; empresaId?: string; scope?: string }
        user = { id: (d.sub || d.id) as string, empresaId: d.empresaId, scope: d.scope }
      } else {
        const cookieToken = (request.cookies as Record<string, string> | undefined)?.['visiofab-access-token']
        if (!request.headers.authorization && cookieToken) {
          request.headers.authorization = `Bearer ${cookieToken}`
        }
        if (!request.headers.authorization) {
          return reply.status(401).send({ message: 'Não autenticado' })
        }
        await request.jwtVerify()
        user = request.user as { id: string; empresaId?: string; scope?: string }
      }
    } catch {
      return reply.status(401).send({ message: 'Token inválido ou expirado' })
    }
    if (!user?.empresaId) return reply.status(401).send({ message: 'Não autenticado' })
    if (user.scope === 'CHECKOUT_OPERADOR') return reply.status(403).send({ message: 'Acesso negado' })

    const naoEncontrado = () => reply.status(404).send({ message: 'Cálculo não encontrado' })
    try {
      const calc = (await obterCalculoGrafico(user.empresaId, id)) as
        | (Record<string, unknown> & { empresaId?: string })
        | null
      if (!calc || (calc.empresaId && calc.empresaId !== user.empresaId)) return naoEncontrado()

      const resultadoCalculo = calc.resultadoCalculo
      const custosCalcgraf = calc.custosCalcgraf
      if (!temMemoriaParaPdf({ resultadoCalculo, custosCalcgraf })) {
        return reply.status(422).send({ message: MSG_SEM_MEMORIA })
      }

      const empresa = await prisma.empresa.findUnique({
        where: { id: user.empresaId },
        select: { razaoSocial: true, nomeFantasia: true },
      })

      const numero = Number(calc.numero)
      const pdf = await Promise.race([
        gerarPdfPreCalculo({
          numero,
          resultadoCalculo,
          custosCalcgraf,
          cliente: (calc.clienteNome as string | null) ?? null,
          produto: (calc.produto as string | null) ?? null,
          descricao: (calc.descricao as string | null) ?? null,
          quantidade: (calc.quantidade as number | null) ?? null,
          empresaNome: empresa?.nomeFantasia || empresa?.razaoSocial || null,
        }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 10_000)),
      ])

      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="pre-calculo-${numero}.pdf"`)
        .send(pdf)
    } catch (e) {
      request.log.error({ err: e }, 'Falha ao gerar PDF do pré-cálculo')
      return reply
        .status(500)
        .send({ message: 'Não foi possível gerar o PDF do pré-cálculo. Tente novamente.' })
    }
  })
}
