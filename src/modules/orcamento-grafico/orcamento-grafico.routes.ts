import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import {
  calcularItem,
  ItemOrcamentoError,
  type ItemOrcamentoInput,
} from './orcamento-grafico-item.service'
import {
  consolidarOrcamento,
  type FechamentoItem,
} from './orcamento-grafico-consolidacao.service'
import type { ResultadoOrcamento } from './orcamento-grafico-calculo.service'

/**
 * Extrai os parâmetros customizados (com defaults) de um TipoEmbalagem para o
 * motor de cálculo. Sem os defaults (ex.: FUNDO/DOBRA da SACOLA), fórmulas que
 * os referenciam quebram o avaliador (erro 500). Ver orcamento-grafico-calculo.
 */
function parametrosDoTipo(tipo: { parametros: unknown }): Array<{ nome: string; default?: number }> | undefined {
  if (!Array.isArray(tipo.parametros)) return undefined
  return (tipo.parametros as any[]).map((p) => ({
    nome: String(p?.nome ?? ''),
    default: typeof p?.default === 'number' ? p.default : undefined,
  }))
}

/**
 * Resolve o coefTinta do suporte vinculado ao papel (via PrecoMateriaPrima.
 * suporteId → SuporteGrafico.coefTinta). Retorna undefined se não houver vínculo
 * (motor cai no modelo legado de tinta). Filtra por empresaId (multi-tenant).
 */
async function resolverCoefTintaSuporte(
  empresaId: string,
  papelId: string | undefined,
): Promise<number | undefined> {
  if (!papelId) return undefined
  const papel = await prisma.precoMateriaPrima.findFirst({
    where: { id: papelId, empresaId },
    select: { suporteId: true },
  })
  const suporteId = (papel as { suporteId?: string | null } | null)?.suporteId
  if (!suporteId) return undefined
  const suporte = await prisma.suporteGrafico.findFirst({
    where: { id: suporteId, empresaId },
    select: { coefTinta: true, status: true },
  })
  if (!suporte || !suporte.status) return undefined
  const coef = Number(suporte.coefTinta)
  return coef > 0 ? coef : undefined
}

/**
 * Valida as pré-condições de cálculo de orçamento ANTES de calcular (defesa em
 * profundidade — o bloqueio principal vive no wizard do frontend). Filtra sempre
 * por empresaId (multi-tenant). Retorna uma mensagem de bloqueio quando alguma
 * pré-condição falha, ou undefined quando o cálculo pode prosseguir.
 *
 * Req 2.4: quando o papel selecionado aponta para um Suporte
 * (PrecoMateriaPrima.suporteId → SuporteGrafico), esse Suporte precisa ter ao
 * menos um PrecoMateriaPrima de tipo PAPEL (ativo) vinculado. Se o papel não tem
 * suporteId, NÃO bloqueia (comportamento atual preservado).
 *
 * Req 5.4: precisa existir ao menos um ParametroPerda cadastrado para a empresa.
 */
async function validarPreCondicoesCalculo(
  empresaId: string,
  papelId: string | undefined | null,
): Promise<string | undefined> {
  // Req 2.4 — Suporte sem preço PAPEL vinculado.
  if (papelId) {
    const papel = await prisma.precoMateriaPrima.findFirst({
      where: { id: papelId, empresaId },
      select: { suporteId: true },
    })
    const suporteId = (papel as { suporteId?: string | null } | null)?.suporteId
    if (suporteId) {
      const precoPapelDoSuporte = await prisma.precoMateriaPrima.findFirst({
        where: { empresaId, suporteId, tipo: 'PAPEL', status: true },
        select: { id: true },
      })
      if (!precoPapelDoSuporte) {
        return 'Suporte sem preço de material vinculado — vincule um preço ao suporte antes de calcular'
      }
    }
  }

  // Req 5.4 — Nenhum ParametroPerda cadastrado para a empresa.
  const totalPerdas = await prisma.parametroPerda.count({ where: { empresaId } })
  if (totalPerdas === 0) {
    return 'Nenhum Parâmetro de Perda cadastrado — cadastre a perda do processo antes de calcular'
  }

  return undefined
}

/** Lê o parâmetro de partida de consumo de tinta (kg) da empresa (default 0,2). */
async function resolverPartidaConsumoTinta(empresaId: string): Promise<number> {
  const p = await prisma.parametro.findFirst({
    where: { empresaId, chave: 'orcamento.partidaConsumoTintaKg' },
    select: { valor: true },
  })
  const v = p ? Number(p.valor) : NaN
  return Number.isFinite(v) && v > 0 ? v : 0.2
}

/**
 * Item de acabamento rico no REQUEST. Pode:
 *  - referenciar um AcabamentoGrafico do cadastro (`acabamentoId`) — o backend
 *    resolve natureza/custos/centro; e/ou
 *  - trazer overrides do próprio orçamento (consumo de material, tempos).
 * Campos de override têm precedência sobre o cadastro.
 */
const acabamentoRicoRequestSchema = z.object({
  acabamentoId: z.string().uuid().optional(),
  // overrides opcionais (quando não vêm, usa o cadastro)
  nome: z.string().optional(),
  naturezaCusto: z.enum(['HORA_MAQUINA', 'MATERIAL_KG', 'MATERIAL_UN', 'CUSTO_FIXO']).optional(),
  // material — `z.coerce` aceita number OU string numérica (os cadastros vêm do
  // Prisma como Decimal serializado em string, ex.: "320"). Blindagem definitiva
  // contra "Expected number, received string".
  variavelKg: z.coerce.number().min(0).optional(),
  precoKg: z.coerce.number().min(0).optional(),
  variavelUn: z.coerce.number().min(0).optional(),
  precoUn: z.coerce.number().min(0).optional(),
  valorFixo: z.coerce.number().min(0).optional(),
  // hora-máquina
  custoHora: z.coerce.number().min(0).optional(),
  producaoHora: z.coerce.number().min(0).optional(),
  unidadeBase: z.enum(['FOLHA', 'PRODUTO']).optional(),
  quantAcertos: z.coerce.number().min(0).optional(),
  tempoPorAcertoMin: z.coerce.number().min(0).optional(),
  tempoPrimeiroAcertoMin: z.coerce.number().min(0).optional(),
  tempoFixoHoras: z.coerce.number().min(0).optional(),
  tempoVarHoras: z.coerce.number().min(0).optional(),
})

type AcabamentoRicoRequest = z.infer<typeof acabamentoRicoRequestSchema>

/**
 * Resolve os itens de acabamento rico do request para o formato que o motor
 * (`ItemAcabamentoRico`) espera, buscando o cadastro `AcabamentoGrafico` por id
 * (quando informado) e aplicando overrides do orçamento por cima. Multi-tenant.
 */
async function montarAcabamentosRicos(
  empresaId: string,
  itens: AcabamentoRicoRequest[] | undefined,
): Promise<any[]> {
  if (!itens || itens.length === 0) return []

  const ids = itens.map((i) => i.acabamentoId).filter((x): x is string => !!x)
  const cadastros = ids.length
    ? await prisma.acabamentoGrafico.findMany({ where: { empresaId, id: { in: ids } } })
    : []
  const porId = new Map(cadastros.map((c) => [c.id, c]))

  const num = (v: unknown): number | undefined => (v == null ? undefined : Number(v))

  const resolvidos: any[] = []
  for (const it of itens) {
    const cad = it.acabamentoId ? porId.get(it.acabamentoId) : undefined
    const natureza = it.naturezaCusto ?? (cad?.naturezaCusto as string | undefined) ?? 'HORA_MAQUINA'
    const nome = it.nome ?? cad?.nome ?? 'Acabamento'

    if (natureza === 'MATERIAL_KG') {
      resolvidos.push({
        naturezaCusto: 'MATERIAL_KG',
        nome,
        variavelKg: it.variavelKg ?? 0,
        precoKg: it.precoKg ?? num(cad?.precoUnitario) ?? 0,
      })
    } else if (natureza === 'MATERIAL_UN') {
      resolvidos.push({
        naturezaCusto: 'MATERIAL_UN',
        nome,
        variavelUn: it.variavelUn ?? 0,
        precoUn: it.precoUn ?? num(cad?.precoUnitario) ?? 0,
      })
    } else if (natureza === 'CUSTO_FIXO') {
      resolvidos.push({
        naturezaCusto: 'CUSTO_FIXO',
        nome,
        valorFixo: it.valorFixo ?? num(cad?.precoUnitario) ?? 0,
      })
    } else {
      // HORA_MAQUINA — custo/produção/tempos do override OU do cadastro.
      resolvidos.push({
        naturezaCusto: 'HORA_MAQUINA',
        nome,
        custoHora: it.custoHora ?? num(cad?.custoHora) ?? 0,
        producaoHora: it.producaoHora ?? num(cad?.producaoHora),
        unidadeBase: it.unidadeBase ?? (cad?.unidadeBase as 'FOLHA' | 'PRODUTO' | undefined),
        quantAcertos: it.quantAcertos ?? num(cad?.quantAcertos),
        tempoPorAcertoMin: it.tempoPorAcertoMin ?? num(cad?.tempoPorAcertoMin),
        tempoPrimeiroAcertoMin: it.tempoPrimeiroAcertoMin ?? num(cad?.tempoPrimeiroAcertoMin),
        tempoFixoHoras: it.tempoFixoHoras,
        tempoVarHoras: it.tempoVarHoras,
      })
    }
  }
  return resolvidos
}

// ═══════════════════════════════════════════════════════════════════════════
// MULTI-ITEM (spec orcamento-grafico-multi-item-gcad §5.3) — schemas e helpers
// compartilhados pelas rotas de item aninhado. O cálculo de cada item reutiliza
// o SERVIÇO `calcularItem` (envelope do motor puro — Task 4), e a consolidação
// do cabeçalho usa `consolidarOrcamento` (Task 3). Isolamento por empresaId
// explícito em TODA query (nunca só prismaScoped — steering ATENCAO).
// ═══════════════════════════════════════════════════════════════════════════

/** Cor de impressão no payload do item (igual ao schema das demais rotas). */
const corItemSchema = z.object({
  nome: z.string(),
  tipo: z.enum(['CMYK', 'PANTONE']),
  coberturaPercent: z.number().min(0).max(100),
  precoKg: z.number().min(0),
  rendimentoM2Kg: z.number().positive().default(25),
})

/**
 * Payload de UM item de orçamento multi-item (POST /:id/itens, PUT, /calcular,
 * /simular-tiragens). Campos novos da spec são OPCIONAIS/aditivos (design §5.3).
 *
 * NESTA Task 5: os campos que ainda não têm efeito no motor (modeloFacaId,
 * matriz, tinta.modo, restricaoAcabamentoId) são ACEITOS e PERSISTIDOS no
 * ItemOrcamentoGrafico, mas NÃO alteram o cálculo (Fases 2/3/4). Ao motor passa-se
 * apenas o que ele já entende hoje (via `calcularItem`/`ItemOrcamentoInput`).
 */
const itemOrcamentoBodySchema = z.object({
  tipoEmbalagemId: z.string().uuid(),
  descricao: z.string().max(200).optional().nullable(),
  medidas: z.record(z.coerce.number()),
  papelId: z.string().uuid().optional().nullable(),
  papelDescricao: z.string().max(200).optional().nullable(),
  suporteId: z.string().uuid().optional().nullable(),
  gramatura: z.number().positive(),
  // Preço do papel por kg (aceita o alias precoKg, como o wizard envia).
  precoKgPapel: z.number().positive().optional(),
  precoKg: z.number().positive().optional(),
  numCores: z.number().int().min(0).default(4),
  cores: z.array(corItemSchema).optional().nullable(),
  maquinaId: z.string().uuid().optional().nullable(), // Req 8 (efeito já existente: usa a máquina)
  modeloFacaId: z.string().uuid().optional().nullable(), // Req 6 — persistido; sem efeito no motor nesta task
  // Override do aproveitamento (peças/folha) — imposição real da faca.
  aproveitamentoManual: z.coerce.number().positive().optional(),
  // Matriz de impressão no MD (Req 10) — persistida; sem efeito no motor nesta task.
  matriz: z
    .object({ quantidade: z.number().positive(), precoUnitario: z.number().min(0) })
    .optional()
    .nullable(),
  // Tinta por cobertura OU consumo direto (Req 11) — persistida; sem efeito nesta task.
  tinta: z
    .discriminatedUnion('modo', [
      z.object({ modo: z.literal('COBERTURA') }),
      z.object({
        modo: z.literal('CONSUMO_DIRETO'),
        consumoKg: z.number().positive(),
        precoKg: z.number().positive(),
      }),
    ])
    .optional()
    .nullable(),
  // Acabamentos ricos (restricaoAcabamentoId é aceito/persistido; sem efeito nesta task).
  acabamentosRicos: z
    .array(acabamentoRicoRequestSchema.extend({ restricaoAcabamentoId: z.string().uuid().optional() }))
    .optional(),
  // Itens Diversos / Fornecidos / Campos Livres (Req 12) — persistidos.
  itensDiversos: z
    .array(
      z.object({
        descricao: z.string().min(1).max(200),
        quantidade: z.number().min(0.001).max(999999.999),
        valor: z.number().min(0.01).max(9999999.99),
        fixo: z.boolean().default(false),
      }),
    )
    .max(50)
    .optional(),
  itensFornecidos: z
    .array(
      z.object({
        descricao: z.string().min(1).max(200),
        quantidade: z.number().min(0.001).max(999999.999),
      }),
    )
    .max(50)
    .optional(),
  camposLivres: z
    .array(z.object({ rotulo: z.string().min(1).max(50), conteudo: z.string().max(500) }))
    .max(20)
    .optional(),
  quantidade: z.number().int().positive(),
  tabelaMargemId: z.string().uuid().optional().nullable(),
  // Markup escolhido p/ o Valor Total consolidado do orçamento.
  margemSelecionada: z.number().optional().nullable(),
  // ── Paridade Calcgraf (opcionais/aditivos — já entendidos pelo motor) ──
  servicosExternos: z.array(z.object({ descricao: z.string(), valor: z.number() })).optional(),
  creditosFiscais: z.number().optional(),
  encargoFinanceiroPerc: z.number().optional(),
  cev: z
    .object({ icms: z.number(), juros: z.number(), pisCofins: z.number(), comissoes: z.number() })
    .optional(),
})

type ItemOrcamentoBody = z.infer<typeof itemOrcamentoBodySchema>

/**
 * Monta o `ItemOrcamentoInput` (consumido pelo serviço `calcularItem`) a partir
 * do payload do item, repassando ao motor APENAS o que ele já entende hoje.
 * Os campos ainda sem efeito no motor (modelo/matriz/tinta/restrição) NÃO entram
 * aqui — são apenas persistidos nas colunas do item pela rota.
 */
function montarInputDoItem(body: ItemOrcamentoBody): ItemOrcamentoInput {
  return {
    tipoEmbalagemId: body.tipoEmbalagemId,
    medidas: body.medidas,
    papelId: body.papelId ?? null,
    gramatura: body.gramatura,
    precoKgPapel: body.precoKgPapel,
    precoKg: body.precoKg,
    maquinaId: body.maquinaId ?? null,
    aproveitamentoManual: body.aproveitamentoManual,
    cores: (body.cores ?? []) as ItemOrcamentoInput['cores'],
    acabamentosRicos: body.acabamentosRicos as ItemOrcamentoInput['acabamentosRicos'],
    quantidade: body.quantidade,
    tabelaMargemId: body.tabelaMargemId ?? null,
    // Req 10 (Task 19) — matriz entra no MD como custo fixo (via itensDiversos no service).
    matriz: body.matriz ?? undefined,
    // Req 11 (Task 19) — modo de tinta (COBERTURA = legado; CONSUMO_DIRETO = direto no MD).
    tinta: body.tinta ?? undefined,
    servicosExternos: body.servicosExternos,
    // Itens Diversos/Fornecidos nesta task entram só como persistência (o motor
    // já aceita o formato {descricao, valor}; aqui mapeamos quantidade×valor dos
    // diversos para manter a soma coerente quando informados).
    itensDiversos: body.itensDiversos?.map((i) => ({
      descricao: i.descricao,
      valor: i.fixo ? i.valor : i.valor * i.quantidade,
    })),
    itensFornecidos: body.itensFornecidos?.map((i) => ({ descricao: i.descricao, valor: 0 })),
    creditosFiscais: body.creditosFiscais,
    encargoFinanceiroPerc: body.encargoFinanceiroPerc,
    cev: body.cev,
  }
}

/**
 * Deriva o fechamento consolidável de um item a partir do ResultadoOrcamento do
 * motor. O motor calcula o preço para a margem (markup) usada; expomos esse valor
 * em `valorTotalPorMargem[markup]` e também sob a chave da `margemSelecionada`
 * informada (para a consolidação do cabeçalho sempre encontrar a chave).
 */
function fechamentoDoResultado(
  resultado: ResultadoOrcamento,
  margemSelecionada: number | null | undefined,
): { custoProducao: number; valorTotal: number; margemSelecionada: number; fechamentoItem: FechamentoItem } {
  const custoProducao = Number(resultado.custoProducao ?? resultado.custoTotal ?? 0)
  const valorTotal = Number(resultado.precoVenda ?? 0)
  const margem = margemSelecionada ?? 0
  const valorTotalPorMargem: Record<string, number> = { [String(margem)]: valorTotal }
  return {
    custoProducao,
    valorTotal,
    margemSelecionada: margem,
    fechamentoItem: { custoProducao, valorTotalPorMargem, margemSelecionada: margem },
  }
}

/** Campos persistidos de um item (reaproveitado por POST /:id/itens e PUT). */
function dadosPersistenciaItem(body: ItemOrcamentoBody, resultado: ResultadoOrcamento) {
  const fech = fechamentoDoResultado(resultado, body.margemSelecionada)
  return {
    tipoEmbalagemId: body.tipoEmbalagemId,
    descricao: body.descricao ?? null,
    medidas: body.medidas,
    papelId: body.papelId ?? null,
    papelDescricao: body.papelDescricao ?? null,
    suporteId: body.suporteId ?? null,
    gramatura: body.gramatura,
    numCores: body.numCores,
    cores: (body.cores ?? undefined) as any,
    maquinaId: body.maquinaId ?? null,
    matrizQuantidade: body.matriz?.quantidade ?? null,
    matrizPrecoUnitario: body.matriz?.precoUnitario ?? null,
    tintaModo: body.tinta?.modo ?? null,
    tintaConsumoKg: body.tinta && body.tinta.modo === 'CONSUMO_DIRETO' ? body.tinta.consumoKg : null,
    acabamentosRicos: (body.acabamentosRicos ?? undefined) as any,
    modeloFacaId: body.modeloFacaId ?? null,
    itensDiversos: (body.itensDiversos ?? undefined) as any,
    itensFornecidos: (body.itensFornecidos ?? undefined) as any,
    camposLivres: (body.camposLivres ?? undefined) as any,
    quantidade: body.quantidade,
    resultadoCalculo: resultado as any,
    margemSelecionada: fech.margemSelecionada,
    custoProducao: fech.custoProducao,
    valorTotal: fech.valorTotal,
  }
}

/**
 * Recalcula e persiste os totais consolidados do cabeçalho a partir dos itens
 * atuais do orçamento. Sem itens → zera (0,00). Multi-tenant por empresaId.
 */
async function reconsolidarOrcamento(orcamentoId: string, empresaId: string): Promise<void> {
  const itens = await prisma.itemOrcamentoGrafico.findMany({
    where: { orcamentoId, empresaId },
    select: { custoProducao: true, valorTotal: true, margemSelecionada: true },
  })
  const fechamentos: FechamentoItem[] = itens.map((i) => {
    const margem = i.margemSelecionada != null ? Number(i.margemSelecionada) : 0
    return {
      custoProducao: i.custoProducao != null ? Number(i.custoProducao) : 0,
      valorTotalPorMargem: { [String(margem)]: i.valorTotal != null ? Number(i.valorTotal) : 0 },
      margemSelecionada: margem,
    }
  })
  const consolidado = consolidarOrcamento(fechamentos)
  await prisma.orcamentoGrafico.update({
    where: { id: orcamentoId },
    data: {
      custoProducaoConsolidado: consolidado.custoProducaoConsolidado,
      valorTotalConsolidado: consolidado.valorTotalConsolidado,
    },
  })
}

export async function orcamentoGraficoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // ═══════════════════════════════════════════════════════════════════════════
  // TIPO EMBALAGEM (Especialistas de cálculo)
  // ═══════════════════════════════════════════════════════════════════════════

  const tipoEmbalagemSelect = {
    id: true,
    empresaId: true,
    codigo: true,
    descricao: true,
    formulaLargura: true,
    formulaAltura: true,
    parametros: true,
    processosObrigatorios: true,
    abaColagemMm: true,
    sangriaMm: true,
    pincaMm: true,
    gabaritoPlanificacao: true,
    imagemUrl: true,
    status: true,
    criadoEm: true,
    atualizadoEm: true,
  } as const

  /**
   * GET /api/orcamento-grafico/tipos-embalagem
   * Lista tipos de embalagem da empresa. Por padrão retorna apenas ativos.
   */
  app.get('/tipos-embalagem', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const query = z.object({
      busca: z.string().optional(),
      status: z.enum(['true', 'false']).optional(),
      page: z.coerce.number().int().positive().optional().default(1),
      limit: z.coerce.number().int().positive().max(100).optional().default(50),
    }).parse(request.query)

    const where: any = { empresaId: user.empresaId }
    // Default: mostra apenas ativos; se query.status informado, filtra pelo valor
    if (query.status !== undefined) {
      where.status = query.status === 'true'
    } else {
      where.status = true
    }
    if (query.busca) {
      where.OR = [
        { codigo: { contains: query.busca, mode: 'insensitive' } },
        { descricao: { contains: query.busca, mode: 'insensitive' } },
      ]
    }

    const [data, total] = await Promise.all([
      prisma.tipoEmbalagem.findMany({
        where,
        select: tipoEmbalagemSelect,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { codigo: 'asc' },
      }),
      prisma.tipoEmbalagem.count({ where }),
    ])
    return { data, total, page: query.page, limit: query.limit, totalPages: Math.max(1, Math.ceil(total / query.limit)) }
  })

  /**
   * POST /api/orcamento-grafico/tipos-embalagem
   * Cria um novo tipo de embalagem.
   */
  app.post('/tipos-embalagem', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = z.object({
      codigo: z.string().min(1).max(30),
      descricao: z.string().min(1).max(200),
      formulaLargura: z.string().min(1),
      formulaAltura: z.string().min(1),
      parametros: z.array(z.any()),
      processosObrigatorios: z.array(z.string()).default([]),
      abaColagemMm: z.number().min(0).default(15),
      sangriaMm: z.number().min(0).default(3),
      pincaMm: z.number().min(0).default(10),
      gabaritoPlanificacao: z.string().max(30).optional().nullable(),
      imagemUrl: z.string().optional(),
    }).parse(request.body)

    const existe = await prisma.tipoEmbalagem.findUnique({
      where: { empresaId_codigo: { empresaId: user.empresaId, codigo: body.codigo } },
    })
    if (existe) return reply.status(409).send({ message: `Código '${body.codigo}' já existe` })

    const tipo = await prisma.tipoEmbalagem.create({
      data: { ...body, empresaId: user.empresaId },
      select: tipoEmbalagemSelect,
    })
    return reply.status(201).send(tipo)
  })

  /**
   * PUT /api/orcamento-grafico/tipos-embalagem/:id
   * Atualiza um tipo de embalagem existente.
   */
  app.put('/tipos-embalagem/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z.object({
      codigo: z.string().min(1).max(30),
      descricao: z.string().min(1).max(200),
      formulaLargura: z.string().min(1),
      formulaAltura: z.string().min(1),
      parametros: z.array(z.any()),
      processosObrigatorios: z.array(z.string()).default([]),
      abaColagemMm: z.number().min(0),
      sangriaMm: z.number().min(0),
      pincaMm: z.number().min(0),
      gabaritoPlanificacao: z.string().max(30).optional().nullable(),
      imagemUrl: z.string().optional().nullable(),
      status: z.boolean().optional(),
    }).parse(request.body)

    const existe = await prisma.tipoEmbalagem.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!existe) return reply.status(404).send({ message: 'Tipo de embalagem não encontrado' })

    // Verificar conflito de código se estiver alterando
    if (body.codigo !== existe.codigo) {
      const conflito = await prisma.tipoEmbalagem.findUnique({
        where: { empresaId_codigo: { empresaId: user.empresaId, codigo: body.codigo } },
      })
      if (conflito && conflito.id !== id) {
        return reply.status(409).send({ message: `Código '${body.codigo}' já existe` })
      }
    }

    const atualizado = await prisma.tipoEmbalagem.update({
      where: { id },
      data: body,
      select: tipoEmbalagemSelect,
    })
    return atualizado
  })

  /**
   * DELETE /api/orcamento-grafico/tipos-embalagem/:id
   * Soft delete — marca status = false (inativa o tipo).
   */
  app.delete('/tipos-embalagem/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const existe = await prisma.tipoEmbalagem.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!existe) return reply.status(404).send({ message: 'Tipo de embalagem não encontrado' })

    await prisma.tipoEmbalagem.update({
      where: { id },
      data: { status: false },
    })
    return reply.status(204).send()
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // PREÇO MATÉRIA-PRIMA
  // ═══════════════════════════════════════════════════════════════════════════

  const precoMateriaPrimaSelect = {
    id: true,
    empresaId: true,
    produtoId: true,
    descricao: true,
    tipo: true,
    unidade: true,
    precoUnitario: true,
    fornecedorId: true,
    dataVigencia: true,
    status: true,
    // Paridade Calcgraf: vínculo do papel ao suporte (coefTinta) + gramatura;
    // densidade da tinta (SPANKS). Ver spec orcamento-grafico-finalizacao.
    suporteId: true,
    gramatura: true,
    densidadeTinta: true,
    criadoEm: true,
    atualizadoEm: true,
  } as const

  /**
   * GET /api/orcamento-grafico/precos-mp
   * Lista preços de matéria-prima da empresa. Por padrão retorna apenas ativos.
   */
  app.get('/precos-mp', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const query = z.object({
      tipo: z.string().optional(),
      busca: z.string().optional(),
      suporteId: z.string().uuid().optional(),
      status: z.enum(['true', 'false']).optional(),
      // comPreco=true → só retorna itens com preço > 0 (usado na seleção de
      // papel do orçamento; papéis com preço 0 não servem para orçar).
      comPreco: z.enum(['true', 'false']).optional(),
      page: z.coerce.number().int().positive().optional().default(1),
      limit: z.coerce.number().int().positive().max(100).optional().default(50),
    }).parse(request.query)

    const where: any = { empresaId: user.empresaId }
    if (query.tipo) where.tipo = query.tipo
    if (query.suporteId) where.suporteId = query.suporteId
    if (query.comPreco === 'true') where.precoUnitario = { gt: 0 }
    if (query.status !== undefined) {
      where.status = query.status === 'true'
    } else {
      where.status = true
    }
    if (query.busca) {
      where.descricao = { contains: query.busca, mode: 'insensitive' }
    }

    const [data, total] = await Promise.all([
      prisma.precoMateriaPrima.findMany({
        where,
        select: precoMateriaPrimaSelect,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { descricao: 'asc' },
      }),
      prisma.precoMateriaPrima.count({ where }),
    ])
    return { data, total, page: query.page, limit: query.limit, totalPages: Math.max(1, Math.ceil(total / query.limit)) }
  })

  /**
   * POST /api/orcamento-grafico/precos-mp
   * Cria um novo preço de matéria-prima.
   */
  app.post('/precos-mp', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = z.object({
      descricao: z.string().min(1).max(200),
      tipo: z.enum(['PAPEL', 'TINTA', 'VERNIZ', 'COLA', 'FACA', 'BOPP', 'OUTRO']),
      unidade: z.string().min(1).max(6),
      precoUnitario: z.number().min(0),
      produtoId: z.string().uuid().optional().nullable(),
      fornecedorId: z.string().uuid().optional().nullable(),
      dataVigencia: z.coerce.date().optional(),
      suporteId: z.string().uuid().optional().nullable(),
      gramatura: z.number().min(0).optional().nullable(),
      densidadeTinta: z.number().min(0).optional().nullable(),
    }).parse(request.body)

    const preco = await prisma.precoMateriaPrima.create({
      data: { ...body, empresaId: user.empresaId },
      select: precoMateriaPrimaSelect,
    })
    return reply.status(201).send(preco)
  })

  /**
   * PUT /api/orcamento-grafico/precos-mp/:id
   * Atualiza um preço de matéria-prima existente.
   */
  app.put('/precos-mp/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z.object({
      descricao: z.string().min(1).max(200),
      tipo: z.enum(['PAPEL', 'TINTA', 'VERNIZ', 'COLA', 'FACA', 'BOPP', 'OUTRO']),
      unidade: z.string().min(1).max(6),
      precoUnitario: z.number().min(0),
      produtoId: z.string().uuid().optional().nullable(),
      fornecedorId: z.string().uuid().optional().nullable(),
      dataVigencia: z.coerce.date().optional(),
      status: z.boolean().optional(),
      suporteId: z.string().uuid().optional().nullable(),
      gramatura: z.number().min(0).optional().nullable(),
      densidadeTinta: z.number().min(0).optional().nullable(),
    }).parse(request.body)

    const existe = await prisma.precoMateriaPrima.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!existe) return reply.status(404).send({ message: 'Preço não encontrado' })

    const atualizado = await prisma.precoMateriaPrima.update({
      where: { id },
      data: body,
      select: precoMateriaPrimaSelect,
    })
    return atualizado
  })

  /**
   * DELETE /api/orcamento-grafico/precos-mp/:id
   * Soft delete — marca status = false (inativa o preço).
   */
  app.delete('/precos-mp/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const existe = await prisma.precoMateriaPrima.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!existe) return reply.status(404).send({ message: 'Preço não encontrado' })

    await prisma.precoMateriaPrima.update({
      where: { id },
      data: { status: false },
    })
    return reply.status(204).send()
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // SUPORTE GRÁFICO (cadastro de papel/suporte com coeficiente de tinta SPANKS)
  // ═══════════════════════════════════════════════════════════════════════════

  const suporteGraficoSelect = {
    id: true,
    empresaId: true,
    codigo: true,
    descricao: true,
    tipoSuporte: true,
    coefTinta: true,
    gramaturas: true,
    status: true,
    criadoEm: true,
    atualizadoEm: true,
  } as const

  app.get('/suportes', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const query = z.object({
      busca: z.string().optional(),
      status: z.enum(['true', 'false']).optional(),
      page: z.coerce.number().int().positive().optional().default(1),
      limit: z.coerce.number().int().positive().max(100).optional().default(50),
    }).parse(request.query)

    const where: any = { empresaId: user.empresaId }
    if (query.status !== undefined) where.status = query.status === 'true'
    else where.status = true
    if (query.busca) {
      where.OR = [
        { codigo: { contains: query.busca, mode: 'insensitive' } },
        { descricao: { contains: query.busca, mode: 'insensitive' } },
      ]
    }

    const [data, total] = await Promise.all([
      prisma.suporteGrafico.findMany({
        where,
        select: suporteGraficoSelect,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { codigo: 'asc' },
      }),
      prisma.suporteGrafico.count({ where }),
    ])
    return { data, total, page: query.page, limit: query.limit, totalPages: Math.max(1, Math.ceil(total / query.limit)) }
  })

  app.post('/suportes', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = z.object({
      codigo: z.string().min(1).max(30),
      descricao: z.string().min(1).max(200),
      tipoSuporte: z.string().min(1).max(30),
      coefTinta: z.number().min(0).max(100).default(1.5),
      gramaturas: z.string().optional().nullable(),
    }).parse(request.body)

    const existe = await prisma.suporteGrafico.findFirst({ where: { empresaId: user.empresaId, codigo: body.codigo } })
    if (existe) return reply.status(409).send({ message: `Código '${body.codigo}' já existe` })

    const suporte = await prisma.suporteGrafico.create({
      data: { ...body, empresaId: user.empresaId },
      select: suporteGraficoSelect,
    })
    return reply.status(201).send(suporte)
  })

  app.put('/suportes/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z.object({
      codigo: z.string().min(1).max(30),
      descricao: z.string().min(1).max(200),
      tipoSuporte: z.string().min(1).max(30),
      coefTinta: z.number().min(0).max(100),
      gramaturas: z.string().optional().nullable(),
      status: z.boolean().optional(),
    }).parse(request.body)

    const existe = await prisma.suporteGrafico.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!existe) return reply.status(404).send({ message: 'Suporte não encontrado' })
    if (body.codigo !== existe.codigo) {
      const conflito = await prisma.suporteGrafico.findFirst({ where: { empresaId: user.empresaId, codigo: body.codigo } })
      if (conflito && conflito.id !== id) return reply.status(409).send({ message: `Código '${body.codigo}' já existe` })
    }

    const atualizado = await prisma.suporteGrafico.update({ where: { id }, data: body, select: suporteGraficoSelect })
    return atualizado
  })

  app.delete('/suportes/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const existe = await prisma.suporteGrafico.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!existe) return reply.status(404).send({ message: 'Suporte não encontrado' })
    await prisma.suporteGrafico.update({ where: { id }, data: { status: false } })
    return reply.status(204).send()
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // ACABAMENTO GRÁFICO (cadastro de acabamentos — paridade relatório Calcgraf)
  // Substitui a lista fixa de 5 acabamentos hardcoded do wizard. Multi-tenant.
  // ═══════════════════════════════════════════════════════════════════════════

  const acabamentoGraficoSelect = {
    id: true,
    empresaId: true,
    codigo: true,
    nome: true,
    tipoAtividade: true,
    planoProduto: true,
    naturezaCusto: true,
    centroProducaoId: true,
    precoUnitario: true,
    custoHora: true,
    producaoHora: true,
    quantAcertos: true,
    tempoPorAcertoMin: true,
    tempoPrimeiroAcertoMin: true,
    unidadeBase: true,
    exigeRestricao: true,
    status: true,
    criadoEm: true,
    atualizadoEm: true,
  } as const

  const acabamentoBodySchema = z.object({
    codigo: z.string().min(1).max(40),
    nome: z.string().min(1).max(200),
    tipoAtividade: z.enum(['IMPRESSAO', 'ACABAMENTO']).default('ACABAMENTO'),
    planoProduto: z.enum(['PLANO', 'PRODUTO']).default('PLANO'),
    naturezaCusto: z.enum(['HORA_MAQUINA', 'MATERIAL_KG', 'MATERIAL_UN', 'CUSTO_FIXO']).default('HORA_MAQUINA'),
    centroProducaoId: z.string().uuid().optional().nullable(),
    precoUnitario: z.number().min(0).optional().nullable(),
    custoHora: z.number().min(0).optional().nullable(),
    producaoHora: z.number().min(0).optional().nullable(),
    quantAcertos: z.number().int().min(0).optional().nullable(),
    tempoPorAcertoMin: z.number().min(0).optional().nullable(),
    tempoPrimeiroAcertoMin: z.number().min(0).optional().nullable(),
    unidadeBase: z.enum(['FOLHA', 'PRODUTO']).optional().nullable(),
    exigeRestricao: z.boolean().optional(),
  })

  app.get('/acabamentos', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const query = z.object({
      busca: z.string().optional(),
      status: z.enum(['true', 'false']).optional(),
      tipoAtividade: z.enum(['IMPRESSAO', 'ACABAMENTO']).optional(),
      naturezaCusto: z.enum(['HORA_MAQUINA', 'MATERIAL_KG', 'MATERIAL_UN', 'CUSTO_FIXO']).optional(),
      page: z.coerce.number().int().positive().optional().default(1),
      limit: z.coerce.number().int().positive().max(100).optional().default(50),
    }).parse(request.query)

    const where: any = { empresaId: user.empresaId }
    if (query.status !== undefined) where.status = query.status === 'true'
    else where.status = true
    if (query.tipoAtividade) where.tipoAtividade = query.tipoAtividade
    if (query.naturezaCusto) where.naturezaCusto = query.naturezaCusto
    if (query.busca) {
      where.OR = [
        { codigo: { contains: query.busca, mode: 'insensitive' } },
        { nome: { contains: query.busca, mode: 'insensitive' } },
      ]
    }

    const [data, total] = await Promise.all([
      prisma.acabamentoGrafico.findMany({
        where,
        select: acabamentoGraficoSelect,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { nome: 'asc' },
      }),
      prisma.acabamentoGrafico.count({ where }),
    ])
    return { data, total, page: query.page, limit: query.limit, totalPages: Math.max(1, Math.ceil(total / query.limit)) }
  })

  app.post('/acabamentos', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = acabamentoBodySchema.parse(request.body)

    const existe = await prisma.acabamentoGrafico.findFirst({
      where: { empresaId: user.empresaId, codigo: body.codigo },
    })
    if (existe) return reply.status(409).send({ message: `Código '${body.codigo}' já existe` })

    const acabamento = await prisma.acabamentoGrafico.create({
      data: { ...body, empresaId: user.empresaId },
      select: acabamentoGraficoSelect,
    })
    return reply.status(201).send(acabamento)
  })

  app.put('/acabamentos/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = acabamentoBodySchema.extend({ status: z.boolean().optional() }).parse(request.body)

    const existe = await prisma.acabamentoGrafico.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!existe) return reply.status(404).send({ message: 'Acabamento não encontrado' })
    if (body.codigo !== existe.codigo) {
      const conflito = await prisma.acabamentoGrafico.findFirst({
        where: { empresaId: user.empresaId, codigo: body.codigo },
      })
      if (conflito && conflito.id !== id) return reply.status(409).send({ message: `Código '${body.codigo}' já existe` })
    }

    const atualizado = await prisma.acabamentoGrafico.update({
      where: { id },
      data: body,
      select: acabamentoGraficoSelect,
    })
    return atualizado
  })

  app.delete('/acabamentos/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const existe = await prisma.acabamentoGrafico.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!existe) return reply.status(404).send({ message: 'Acabamento não encontrado' })
    await prisma.acabamentoGrafico.update({ where: { id }, data: { status: false } })
    return reply.status(204).send()
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // RESTRIÇÕES DE ACABAMENTO (sub-opções por atividade — Req 7). Filhas de
  // AcabamentoGrafico. Alteram acerto/operação no Custo de Transformação.
  // Multi-tenant: a empresa é validada pelo acabamento pai.
  // ═══════════════════════════════════════════════════════════════════════════

  const restricaoBodySchema = z.object({
    nome: z.string().min(1).max(100),
    tempoAcertoMin: z.number().min(0).max(999),
    tempoOperacaoMin: z.number().min(0).max(999),
  })

  const restricaoSelect = {
    id: true,
    acabamentoGraficoId: true,
    empresaId: true,
    nome: true,
    tempoAcertoMin: true,
    tempoOperacaoMin: true,
    criadoEm: true,
  } as const

  // GET lista as restrições de um acabamento (ordenadas por nome asc — Req 7.3)
  app.get('/acabamentos/:acabamentoId/restricoes', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { acabamentoId } = z.object({ acabamentoId: z.string().uuid() }).parse(request.params)
    const acab = await prisma.acabamentoGrafico.findFirst({ where: { id: acabamentoId, empresaId: user.empresaId } })
    if (!acab) return reply.status(404).send({ message: 'Acabamento não encontrado' })
    const restricoes = await prisma.restricaoAcabamento.findMany({
      where: { acabamentoGraficoId: acabamentoId, empresaId: user.empresaId },
      select: restricaoSelect,
      orderBy: { nome: 'asc' },
    })
    return restricoes
  })

  app.post('/acabamentos/:acabamentoId/restricoes', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { acabamentoId } = z.object({ acabamentoId: z.string().uuid() }).parse(request.params)
    const body = restricaoBodySchema.parse(request.body)
    const acab = await prisma.acabamentoGrafico.findFirst({ where: { id: acabamentoId, empresaId: user.empresaId } })
    if (!acab) return reply.status(404).send({ message: 'Acabamento não encontrado' })
    const criada = await prisma.restricaoAcabamento.create({
      data: { ...body, acabamentoGraficoId: acabamentoId, empresaId: user.empresaId },
      select: restricaoSelect,
    })
    return reply.status(201).send(criada)
  })

  app.put('/acabamentos/:acabamentoId/restricoes/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { acabamentoId, id } = z.object({ acabamentoId: z.string().uuid(), id: z.string().uuid() }).parse(request.params)
    const body = restricaoBodySchema.parse(request.body)
    const existe = await prisma.restricaoAcabamento.findFirst({
      where: { id, acabamentoGraficoId: acabamentoId, empresaId: user.empresaId },
    })
    if (!existe) return reply.status(404).send({ message: 'Restrição não encontrada' })
    const atualizada = await prisma.restricaoAcabamento.update({
      where: { id },
      data: body,
      select: restricaoSelect,
    })
    return atualizada
  })

  app.delete('/acabamentos/:acabamentoId/restricoes/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { acabamentoId, id } = z.object({ acabamentoId: z.string().uuid(), id: z.string().uuid() }).parse(request.params)
    const existe = await prisma.restricaoAcabamento.findFirst({
      where: { id, acabamentoGraficoId: acabamentoId, empresaId: user.empresaId },
    })
    if (!existe) return reply.status(404).send({ message: 'Restrição não encontrada' })
    await prisma.restricaoAcabamento.delete({ where: { id } })
    return reply.status(204).send()
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // MODELO DE FACA (GCad) — catálogo de modelos/facas (gabarito técnico real).
  // Spec orcamento-grafico-multi-item-gcad §5.1, Task 9. Multi-tenant por
  // empresaId explícito. Selecionar um modelo no wizard preenche geometria e
  // encaixe (imposição) reais do item (Fase 2 / Task 10).
  // ═══════════════════════════════════════════════════════════════════════════

  const modeloFacaSelect = {
    id: true,
    empresaId: true,
    codigo: true,
    clienteNome: true,
    modelo: true,
    servico: true,
    larguraMm: true,
    alturaMm: true,
    repeticaoLinhas: true,
    repeticaoColunas: true,
    formatoCorteLarguraMm: true,
    formatoCorteAlturaMm: true,
    tipoCartucho: true,
    suporteId: true,
    gramatura: true,
    status: true,
    criadoEm: true,
    atualizadoEm: true,
  } as const

  // Zod do design §5.1. Ajuste: clienteNome, tipoCartucho, suporteId e gramatura
  // são OPCIONAIS/nullable (o schema os tem como nullable e o operador pode não
  // ter esses dados no cadastro manual). Obrigatórios de verdade (Req 5.4):
  // codigo, modelo, servico, dimensões (larguraMm/alturaMm > 0), encaixe
  // (repeticaoLinhas/Colunas >= 1) e formato de corte (> 0) — Req 5.1/5.4/5.5.
  const modeloFacaBodySchema = z.object({
    codigo: z.string().min(1).max(40),
    clienteNome: z.string().max(200).optional().nullable(),
    modelo: z.string().min(1).max(200),
    servico: z.string().min(1).max(200),
    larguraMm: z.number().positive(),
    alturaMm: z.number().positive(),
    repeticaoLinhas: z.number().int().min(1),
    repeticaoColunas: z.number().int().min(1),
    formatoCorteLarguraMm: z.number().positive(),
    formatoCorteAlturaMm: z.number().positive(),
    tipoCartucho: z.string().max(100).optional().nullable(),
    suporteId: z.string().uuid().optional().nullable(),
    gramatura: z.number().positive().optional().nullable(),
  })

  /**
   * GET /api/orcamento-grafico/modelos-faca
   * Lista paginada de modelos de faca da empresa. Filtros `cliente` e `modelo`
   * (contains, case-insensitive — Req 5.3) e `status` (default ativos).
   */
  app.get('/modelos-faca', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const query = z.object({
      cliente: z.string().optional(),
      modelo: z.string().optional(),
      status: z.enum(['true', 'false']).optional(),
      page: z.coerce.number().int().positive().optional().default(1),
      limit: z.coerce.number().int().positive().max(100).optional().default(50),
    }).parse(request.query)

    const where: any = { empresaId: user.empresaId }
    if (query.status !== undefined) where.status = query.status === 'true'
    else where.status = true
    if (query.cliente) where.clienteNome = { contains: query.cliente, mode: 'insensitive' }
    if (query.modelo) where.modelo = { contains: query.modelo, mode: 'insensitive' }

    const [data, total] = await Promise.all([
      prisma.modeloFaca.findMany({
        where,
        select: modeloFacaSelect,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { modelo: 'asc' },
      }),
      prisma.modeloFaca.count({ where }),
    ])
    return { data, total, page: query.page, limit: query.limit, totalPages: Math.max(1, Math.ceil(total / query.limit)) }
  })

  /**
   * POST /api/orcamento-grafico/modelos-faca
   * Cria um modelo de faca. Dimensões/encaixe > 0 garantidos pelo Zod
   * (Req 5.1/5.4/5.5). Código único por empresa → conflito retorna 409.
   */
  app.post('/modelos-faca', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = modeloFacaBodySchema.parse(request.body)

    const existe = await prisma.modeloFaca.findFirst({
      where: { empresaId: user.empresaId, codigo: body.codigo },
    })
    if (existe) return reply.status(409).send({ message: `Código '${body.codigo}' já existe` })

    const modelo = await prisma.modeloFaca.create({
      data: { ...body, empresaId: user.empresaId },
      select: modeloFacaSelect,
    })
    return reply.status(201).send(modelo)
  })

  /**
   * PUT /api/orcamento-grafico/modelos-faca/:id
   * Atualiza um modelo de faca (mesmas validações). 404 se não for da empresa;
   * conflito de código por empresa → 409. `status` opcional.
   */
  app.put('/modelos-faca/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = modeloFacaBodySchema.extend({ status: z.boolean().optional() }).parse(request.body)

    const existe = await prisma.modeloFaca.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!existe) return reply.status(404).send({ message: 'Modelo de faca não encontrado' })
    if (body.codigo !== existe.codigo) {
      const conflito = await prisma.modeloFaca.findFirst({
        where: { empresaId: user.empresaId, codigo: body.codigo },
      })
      if (conflito && conflito.id !== id) return reply.status(409).send({ message: `Código '${body.codigo}' já existe` })
    }

    const atualizado = await prisma.modeloFaca.update({
      where: { id },
      data: body,
      select: modeloFacaSelect,
    })
    return atualizado
  })

  /**
   * DELETE /api/orcamento-grafico/modelos-faca/:id
   * Exclui um modelo de faca. ANTES de excluir, bloqueia (409) se existir algum
   * ItemOrcamentoGrafico vinculado a este modelo na mesma empresa (Req 5.6) —
   * não dependemos só da FK onDelete: Restrict para dar a mensagem amigável.
   *
   * Escolha: SOFT DELETE (status=false), mantendo o padrão dos demais cadastros
   * do módulo (suportes/acabamentos usam soft delete). O ModeloFaca tem o campo
   * `status` justamente para isso; o requisito crítico (Req 5.6) é o bloqueio
   * 409 por vínculo, que é respeitado independentemente da forma de exclusão.
   */
  app.delete('/modelos-faca/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const existe = await prisma.modeloFaca.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!existe) return reply.status(404).send({ message: 'Modelo de faca não encontrado' })

    const vinculo = await prisma.itemOrcamentoGrafico.findFirst({
      where: { modeloFacaId: id, empresaId: user.empresaId },
    })
    if (vinculo) {
      return reply.status(409).send({ message: 'Modelo vinculado a item de orçamento — não pode ser excluído' })
    }

    await prisma.modeloFaca.update({ where: { id }, data: { status: false } })
    return reply.status(204).send()
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // PARÂMETRO PERDA
  // ═══════════════════════════════════════════════════════════════════════════

  const parametroPerdaSelect = {
    id: true,
    empresaId: true,
    tipoProcessoId: true,
    centroProducaoId: true,
    perdaFixaFolhas: true,
    perdaVariavel: true,
    criadoEm: true,
  } as const

  /**
   * GET /api/orcamento-grafico/parametros-perda
   * Lista todos os parâmetros de perda da empresa.
   */
  app.get('/parametros-perda', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const query = z.object({
      page: z.coerce.number().int().positive().optional().default(1),
      limit: z.coerce.number().int().positive().max(100).optional().default(50),
    }).parse(request.query)
    const where = { empresaId: user.empresaId }
    const [data, total] = await Promise.all([
      prisma.parametroPerda.findMany({
        where,
        select: parametroPerdaSelect,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { criadoEm: 'asc' },
      }),
      prisma.parametroPerda.count({ where }),
    ])
    return { data, total, page: query.page, limit: query.limit, totalPages: Math.max(1, Math.ceil(total / query.limit)) }
  })

  /**
   * POST /api/orcamento-grafico/parametros-perda
   * Cria um novo parâmetro de perda (upsert se já existir combinação única).
   */
  app.post('/parametros-perda', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = z.object({
      tipoProcessoId: z.string().uuid().optional().nullable(),
      centroProducaoId: z.string().uuid().optional().nullable(),
      perdaFixaFolhas: z.number().int().min(0).default(0),
      perdaVariavel: z.number().min(0).max(100).default(5),
    }).parse(request.body)

    // Upsert por (empresaId, tipoProcessoId, centroProducaoId)
    const existe = await prisma.parametroPerda.findFirst({
      where: {
        empresaId: user.empresaId,
        tipoProcessoId: body.tipoProcessoId ?? null,
        centroProducaoId: body.centroProducaoId ?? null,
      },
    })

    if (existe) {
      const atualizado = await prisma.parametroPerda.update({
        where: { id: existe.id },
        data: { perdaFixaFolhas: body.perdaFixaFolhas, perdaVariavel: body.perdaVariavel },
        select: parametroPerdaSelect,
      })
      return atualizado
    }

    const criado = await prisma.parametroPerda.create({
      data: { ...body, empresaId: user.empresaId },
      select: parametroPerdaSelect,
    })
    return reply.status(201).send(criado)
  })

  /**
   * PUT /api/orcamento-grafico/parametros-perda/:id
   * Atualiza um parâmetro de perda existente.
   */
  app.put('/parametros-perda/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z.object({
      tipoProcessoId: z.string().uuid().optional().nullable(),
      centroProducaoId: z.string().uuid().optional().nullable(),
      perdaFixaFolhas: z.number().int().min(0),
      perdaVariavel: z.number().min(0).max(100),
    }).parse(request.body)

    const existe = await prisma.parametroPerda.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!existe) return reply.status(404).send({ message: 'Parâmetro de perda não encontrado' })

    // Verificar conflito de unique constraint se tipoProcessoId ou centroProducaoId mudou
    const tipoProcessoChanged = (body.tipoProcessoId ?? null) !== existe.tipoProcessoId
    const centroProducaoChanged = (body.centroProducaoId ?? null) !== existe.centroProducaoId
    if (tipoProcessoChanged || centroProducaoChanged) {
      const conflito = await prisma.parametroPerda.findFirst({
        where: {
          empresaId: user.empresaId,
          tipoProcessoId: body.tipoProcessoId ?? null,
          centroProducaoId: body.centroProducaoId ?? null,
        },
      })
      if (conflito && conflito.id !== id) {
        return reply.status(409).send({ message: 'Já existe um parâmetro de perda para esta combinação de processo/centro' })
      }
    }

    const atualizado = await prisma.parametroPerda.update({
      where: { id },
      data: body,
      select: parametroPerdaSelect,
    })
    return atualizado
  })

  /**
   * DELETE /api/orcamento-grafico/parametros-perda/:id
   * Hard delete — remove permanentemente o parâmetro de perda.
   */
  app.delete('/parametros-perda/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const existe = await prisma.parametroPerda.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!existe) return reply.status(404).send({ message: 'Parâmetro de perda não encontrado' })

    await prisma.parametroPerda.delete({ where: { id } })
    return reply.status(204).send()
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // TABELA MARGEM (Política Comercial)
  // ═══════════════════════════════════════════════════════════════════════════

  const tabelaMargemSelect = {
    id: true,
    empresaId: true,
    nome: true,
    markup: true,
    impostos: true,
    comissao: true,
    despAdm: true,
    descontoMax: true,
    status: true,
    criadoEm: true,
  } as const

  /**
   * GET /api/orcamento-grafico/tabelas-margem
   * Lista tabelas de margem da empresa. Por padrão retorna apenas ativas.
   */
  app.get('/tabelas-margem', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const query = z.object({
      busca: z.string().optional(),
      status: z.enum(['true', 'false']).optional(),
      page: z.coerce.number().int().positive().optional().default(1),
      limit: z.coerce.number().int().positive().max(100).optional().default(50),
    }).parse(request.query)

    const where: any = { empresaId: user.empresaId }
    if (query.status !== undefined) {
      where.status = query.status === 'true'
    } else {
      where.status = true
    }
    if (query.busca) {
      where.nome = { contains: query.busca, mode: 'insensitive' }
    }

    const [data, total] = await Promise.all([
      prisma.tabelaMargem.findMany({
        where,
        select: tabelaMargemSelect,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { nome: 'asc' },
      }),
      prisma.tabelaMargem.count({ where }),
    ])
    return { data, total, page: query.page, limit: query.limit, totalPages: Math.max(1, Math.ceil(total / query.limit)) }
  })

  /**
   * POST /api/orcamento-grafico/tabelas-margem
   * Cria uma nova tabela de margem.
   */
  app.post('/tabelas-margem', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = z.object({
      nome: z.string().min(1).max(100),
      markup: z.number().min(0).max(500).default(30),
      impostos: z.number().min(0).max(100).default(15),
      comissao: z.number().min(0).max(100).default(5),
      despAdm: z.number().min(0).max(100).default(5),
      descontoMax: z.number().min(0).max(100).default(10),
    }).parse(request.body)

    const existe = await prisma.tabelaMargem.findFirst({ where: { empresaId: user.empresaId, nome: body.nome } })
    if (existe) return reply.status(409).send({ message: `Tabela '${body.nome}' já existe` })

    const tabela = await prisma.tabelaMargem.create({
      data: { ...body, empresaId: user.empresaId },
      select: tabelaMargemSelect,
    })
    return reply.status(201).send(tabela)
  })

  /**
   * PUT /api/orcamento-grafico/tabelas-margem/:id
   * Atualiza uma tabela de margem existente.
   */
  app.put('/tabelas-margem/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z.object({
      nome: z.string().min(1).max(100),
      markup: z.number().min(0).max(500),
      impostos: z.number().min(0).max(100),
      comissao: z.number().min(0).max(100),
      despAdm: z.number().min(0).max(100),
      descontoMax: z.number().min(0).max(100),
      status: z.boolean().optional(),
    }).parse(request.body)

    const existe = await prisma.tabelaMargem.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!existe) return reply.status(404).send({ message: 'Tabela não encontrada' })

    // Verificar conflito de nome se estiver alterando
    if (body.nome !== existe.nome) {
      const conflito = await prisma.tabelaMargem.findFirst({
        where: { empresaId: user.empresaId, nome: body.nome },
      })
      if (conflito && conflito.id !== id) {
        return reply.status(409).send({ message: `Tabela '${body.nome}' já existe` })
      }
    }

    const atualizado = await prisma.tabelaMargem.update({
      where: { id },
      data: body,
      select: tabelaMargemSelect,
    })
    return atualizado
  })

  /**
   * DELETE /api/orcamento-grafico/tabelas-margem/:id
   * Soft delete — marca status = false (inativa a tabela).
   */
  app.delete('/tabelas-margem/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const existe = await prisma.tabelaMargem.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!existe) return reply.status(404).send({ message: 'Tabela não encontrada' })

    await prisma.tabelaMargem.update({
      where: { id },
      data: { status: false },
    })
    return reply.status(204).send()
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // CÁLCULO (preview sem salvar)
  // ═══════════════════════════════════════════════════════════════════════════

  app.post('/calcular', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { calcularOrcamentoGrafico } = await import('./orcamento-grafico-calculo.service')

    const body = z.object({
      tipoEmbalagemId: z.string().uuid(),
      medidas: z.record(z.number()),
      papelId: z.string().uuid().optional(),
      gramatura: z.number().positive(),
      precoKgPapel: z.number().positive().optional(),
      precoKg: z.number().positive().optional(),
      maquinaId: z.string().uuid().optional(),
      // Override do aproveitamento (peças/folha) — imposição real da faca.
      aproveitamentoManual: z.coerce.number().positive().optional(),
      cores: z.array(z.object({
        nome: z.string(),
        tipo: z.enum(['CMYK', 'PANTONE']),
        coberturaPercent: z.number().min(0).max(100),
        precoKg: z.number().min(0),
        rendimentoM2Kg: z.number().positive().default(25),
      })),
      acabamentos: z.array(z.object({
        tipo: z.string(),
        custoHora: z.number().min(0),
        velocidade: z.number().positive(),
        setupMinutos: z.number().min(0).default(0),
        custoMaterialM2: z.number().min(0).optional(),
        custoMaterialUn: z.number().min(0).optional(),
      })).default([]),
      // Acabamentos RICOS (paridade Calcgraf). Cada item pode referenciar um
      // AcabamentoGrafico do cadastro (acabamentoId) — o backend resolve os
      // parâmetros de custo/centro — e/ou trazer overrides do próprio orçamento
      // (quantidades consumidas, tempos). Ver montarAcabamentosRicos().
      acabamentosRicos: z.array(acabamentoRicoRequestSchema).optional(),
      quantidade: z.number().int().positive(),
      tabelaMargemId: z.string().uuid().optional(),
      // ── Paridade Calcgraf (opcionais/aditivos) ─────────────────────────
      servicosExternos: z.array(z.object({ descricao: z.string(), valor: z.number() })).optional(),
      itensDiversos: z.array(z.object({ descricao: z.string(), valor: z.number() })).optional(),
      itensFornecidos: z.array(z.object({ descricao: z.string(), valor: z.number() })).optional(),
      creditosFiscais: z.number().optional(),
      encargoFinanceiroPerc: z.number().optional(),
      cev: z.object({ icms: z.number(), juros: z.number(), pisCofins: z.number(), comissoes: z.number() }).optional(),
    }).parse(request.body)

    const precoKgPapel = body.precoKgPapel || body.precoKg
    if (!precoKgPapel) return reply.status(400).send({ message: 'Preço do papel (precoKgPapel ou precoKg) é obrigatório' })

    // Pré-condições de cálculo (Req 2.4 e 5.4) — defesa em profundidade na borda.
    const bloqueio = await validarPreCondicoesCalculo(user.empresaId, body.papelId)
    if (bloqueio) return reply.status(400).send({ message: bloqueio })

    // Buscar tipo de embalagem
    const tipo = await prisma.tipoEmbalagem.findFirst({ where: { id: body.tipoEmbalagemId, empresaId: user.empresaId } })
    if (!tipo) return reply.status(404).send({ message: 'Tipo de embalagem não encontrado' })

    // Buscar máquina (específica ou primeira de impressão da empresa como default)
    let maquina: any = null
    if (body.maquinaId) {
      maquina = await prisma.centroProducao.findFirst({ where: { id: body.maquinaId, empresaId: user.empresaId } })
    }
    if (!maquina) {
      maquina = await prisma.centroProducao.findFirst({
        where: { empresaId: user.empresaId, status: true, tipoProcesso: { codigo: 'IMPRESSAO' } },
        orderBy: { posicao: 'asc' },
      })
    }
    if (!maquina) return reply.status(404).send({ message: 'Nenhuma máquina de impressão encontrada. Cadastre um Centro de Produção do tipo Impressão.' })

    // Buscar tabela de margem (ou usar default)
    let margem = { impostos: 15, comissao: 5, despAdm: 5, markup: 30 }
    if (body.tabelaMargemId) {
      const tabela = await prisma.tabelaMargem.findFirst({ where: { id: body.tabelaMargemId, empresaId: user.empresaId } })
      if (tabela) margem = { impostos: Number(tabela.impostos), comissao: Number(tabela.comissao), despAdm: Number(tabela.despAdm), markup: Number(tabela.markup) }
    }

    // Buscar perdas
    const perdasParam = await prisma.parametroPerda.findMany({ where: { empresaId: user.empresaId } })
    const perdaImpressao = perdasParam.find(p => !p.centroProducaoId) // default geral
    const perdas = {
      impressaoPercent: perdaImpressao ? Number(perdaImpressao.perdaVariavel) : 5,
      impressaoFixaFolhas: perdaImpressao ? perdaImpressao.perdaFixaFolhas : 50,
      corteVincoPercent: 3,
      colagemPercent: 2,
    }

    // Paridade Calcgraf: parâmetros calibrados (setup/acerto por cor da máquina;
    // coefTinta do suporte do papel; partida de consumo de tinta). Quando
    // presentes, o motor usa os modelos SPANKS/acerto-por-cor; senão, legado.
    const acertoPorCorMin = maquina.acertoPorCorMin != null ? Number(maquina.acertoPorCorMin) : undefined
    const tempoSetupMin = maquina.tempoSetupMin != null ? Number(maquina.tempoSetupMin) : undefined
    const coefTintaSuporte = await resolverCoefTintaSuporte(user.empresaId, body.papelId)
    const partidaConsumoTintaKg = await resolverPartidaConsumoTinta(user.empresaId)

    const resultado = calcularOrcamentoGrafico({
      tipoEmbalagem: {
        parametros: parametrosDoTipo(tipo),
        formulaLargura: tipo.formulaLargura,
        formulaAltura: tipo.formulaAltura,
        abaColagemMm: Number(tipo.abaColagemMm),
        sangriaMm: Number(tipo.sangriaMm),
        pincaMm: Number(tipo.pincaMm),
      },
      medidas: body.medidas,
      papel: { gramatura: body.gramatura, precoKg: precoKgPapel },
      maquinaImpressao: {
        velocidade: Number(maquina.velocidade) || 6000,
        custoHora: Number(maquina.custoHora) || 250,
        formatoLargura: maquina.formatoFolhaLargura || 660,
        formatoAltura: maquina.formatoFolhaAltura || 960,
        pinca: Number(maquina.pincaMm) || 10,
        // setup: usa o cadastrado (tempoSetupMin) quando houver; senão 30 (legado)
        setupMinutos: tempoSetupMin ?? 30,
        acertoPorCorMin,
        numCoresImpressao: body.cores.length,
      },
      cores: body.cores,
      // Combina acabamentos LEGADOS com os RICOS (resolvidos do cadastro).
      acabamentos: [
        ...body.acabamentos,
        ...(await montarAcabamentosRicos(user.empresaId, body.acabamentosRicos)),
      ],
      quantidade: body.quantidade,
      perdas,
      margem,
      coefTintaSuporte,
      partidaConsumoTintaKg,
      aproveitamentoManual: body.aproveitamentoManual,
      // paridade Calcgraf (repassados quando informados)
      servicosExternos: body.servicosExternos,
      itensDiversos: body.itensDiversos,
      itensFornecidos: body.itensFornecidos,
      creditosFiscais: body.creditosFiscais,
      encargoFinanceiroPerc: body.encargoFinanceiroPerc,
      cev: body.cev,
    })

    return resultado
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // CRIAR ORÇAMENTO (salva no banco)
  // ═══════════════════════════════════════════════════════════════════════════

  const orcamentoGraficoSelect = {
    id: true,
    empresaId: true,
    numero: true,
    versao: true,
    clienteId: true,
    clienteNome: true,
    vendedorId: true,
    tipoEmbalagemId: true,
    medidas: true,
    resultadoCalculo: true,
    papelId: true,
    papelDescricao: true,
    gramatura: true,
    numCores: true,
    cores: true,
    acabamentos: true,
    quantidade: true,
    custoMaterial: true,
    custoMaquina: true,
    custoAcabamento: true,
    custoTotal: true,
    precoVenda: true,
    precoUnitario: true,
    margemReal: true,
    status: true,
    validadeAte: true,
    motivoRecusa: true,
    aprovadoEm: true,
    pedidoVendaId: true,
    produtoId: true,
    variacoes: true,
    observacoes: true,
    criadoPorId: true,
    criadoEm: true,
    atualizadoEm: true,
  } as const

  /**
   * POST /api/orcamento-grafico
   * Cria e salva um orçamento gráfico.
   * Se `resultadoCalculo` for fornecido diretamente, salva sem recalcular.
   * Caso contrário, executa o cálculo a partir dos parâmetros informados.
   */
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { calcularOrcamentoGrafico: calcular } = await import('./orcamento-grafico-calculo.service')

    const body = z.object({
      // Dados do cliente
      clienteId: z.string().uuid().optional().nullable(),
      clienteNome: z.string().max(200).optional().nullable(),
      vendedorId: z.string().uuid().optional().nullable(),
      // Tipo e medidas
      tipoEmbalagemId: z.string().uuid(),
      medidas: z.record(z.number()),
      // Papel
      papelId: z.string().uuid().optional().nullable(),
      papelDescricao: z.string().max(200).optional().nullable(),
      gramatura: z.number().positive().optional(),
      numCores: z.number().int().min(0).default(4),
      cores: z.array(z.object({
        nome: z.string(),
        tipo: z.enum(['CMYK', 'PANTONE']),
        coberturaPercent: z.number().min(0).max(100),
        precoKg: z.number().min(0),
        rendimentoM2Kg: z.number().positive().default(25),
      })).optional().nullable(),
      acabamentos: z.array(z.object({
        tipo: z.string(),
        custoHora: z.number().min(0),
        velocidade: z.number().positive(),
        setupMinutos: z.number().min(0).default(0),
        custoMaterialM2: z.number().min(0).optional(),
        custoMaterialUn: z.number().min(0).optional(),
      })).optional().nullable(),
      acabamentosRicos: z.array(acabamentoRicoRequestSchema).optional(),
      quantidade: z.number().int().positive(),
      // Parâmetros de cálculo (opcionais — só necessários se não vier resultadoCalculo)
      precoKgPapel: z.number().positive().optional(),
      precoKg: z.number().positive().optional(), // alias enviado pelo wizard
      maquinaId: z.string().uuid().optional(),
      tabelaMargemId: z.string().uuid().optional(),
      // Override do aproveitamento (peças/folha) — imposição real da faca.
      aproveitamentoManual: z.coerce.number().positive().optional(),
      // Resultado pré-calculado (se o frontend já chamou /calcular)
      resultadoCalculo: z.any().optional().nullable(),
      // Extras
      variacoes: z.any().optional().nullable(),
      observacoes: z.string().optional().nullable(),
      validadeAte: z.coerce.date().optional().nullable(),
      status: z.enum(['RASCUNHO', 'ENVIADO']).default('RASCUNHO'),
      // Modo Repetição: produto cadastrado que o orçamento reproduz (opcional)
      produtoId: z.string().uuid().optional().nullable(),
      // ── Cabeçalho multi-item (spec multi-item-gcad §5.3) — aditivos opcionais ──
      serie: z.string().min(1).max(10).optional().nullable(),
      dataOrcamento: z.coerce.date().optional().nullable(),
    }).parse(request.body)

    // Verificar tipo de embalagem
    const tipo = await prisma.tipoEmbalagem.findFirst({
      where: { id: body.tipoEmbalagemId, empresaId: user.empresaId },
    })
    if (!tipo) return reply.status(404).send({ message: 'Tipo de embalagem não encontrado' })

    // Pré-condições de cálculo (Req 2.4 e 5.4) — defesa em profundidade na borda.
    const bloqueioCalculo = await validarPreCondicoesCalculo(user.empresaId, body.papelId)
    if (bloqueioCalculo) return reply.status(400).send({ message: bloqueioCalculo })

    // Se resultadoCalculo não foi fornecido, calcular agora
    let resultadoCalculo = body.resultadoCalculo
    let custoMaterial: number | null = null
    let custoMaquina: number | null = null
    let custoAcabamento: number | null = null
    let custoTotal: number | null = null
    let precoVenda: number | null = null
    let precoUnitario: number | null = null
    let margemReal: number | null = null

    const precoKgPapelPost = body.precoKgPapel ?? body.precoKg
    if (!resultadoCalculo && body.gramatura && precoKgPapelPost) {
      // Máquina: usa a informada OU a primeira de impressão da empresa (mesmo
      // fallback do /calcular). Antes exigia maquinaId, mas o wizard não envia
      // esse campo — então o orçamento era salvo SEM preço e não podia ser
      // enviado. Agora calcula/grava o preço no salvar, como no preview.
      let maquina = body.maquinaId
        ? await prisma.centroProducao.findFirst({ where: { id: body.maquinaId, empresaId: user.empresaId } })
        : null
      if (!maquina) {
        maquina = await prisma.centroProducao.findFirst({
          where: { empresaId: user.empresaId, status: true, tipoProcesso: { codigo: 'IMPRESSAO' } },
          orderBy: { posicao: 'asc' },
        })
      }
      if (!maquina) return reply.status(404).send({ message: 'Nenhuma máquina de impressão encontrada. Cadastre um Centro de Produção do tipo Impressão.' })

      // Buscar tabela de margem
      let margem = { impostos: 15, comissao: 5, despAdm: 5, markup: 30 }
      if (body.tabelaMargemId) {
        const tabela = await prisma.tabelaMargem.findFirst({
          where: { id: body.tabelaMargemId, empresaId: user.empresaId },
        })
        if (tabela) {
          margem = {
            impostos: Number(tabela.impostos),
            comissao: Number(tabela.comissao),
            despAdm: Number(tabela.despAdm),
            markup: Number(tabela.markup),
          }
        }
      }

      // Buscar perdas
      const perdasParam = await prisma.parametroPerda.findMany({
        where: { empresaId: user.empresaId },
      })
      const perdaImpressao = perdasParam.find(p => !p.centroProducaoId)
      const perdas = {
        impressaoPercent: perdaImpressao ? Number(perdaImpressao.perdaVariavel) : 5,
        impressaoFixaFolhas: perdaImpressao ? perdaImpressao.perdaFixaFolhas : 50,
        corteVincoPercent: 3,
        colagemPercent: 2,
      }

      const resultado = calcular({
        tipoEmbalagem: {
          formulaLargura: tipo.formulaLargura,
          formulaAltura: tipo.formulaAltura,
          abaColagemMm: Number(tipo.abaColagemMm),
          sangriaMm: Number(tipo.sangriaMm),
          pincaMm: Number(tipo.pincaMm),
          parametros: parametrosDoTipo(tipo),
        },
        medidas: body.medidas,
        papel: { gramatura: body.gramatura, precoKg: precoKgPapelPost },
        maquinaImpressao: {
          velocidade: Number(maquina.velocidade) || 6000,
          custoHora: Number(maquina.custoHora) || 250,
          formatoLargura: maquina.formatoFolhaLargura || 660,
          formatoAltura: maquina.formatoFolhaAltura || 960,
          pinca: Number(maquina.pincaMm) || 10,
          // Paridade com /calcular: usa acerto-por-cor da máquina quando houver.
          setupMinutos: maquina.tempoSetupMin != null ? Number(maquina.tempoSetupMin) : 30,
          acertoPorCorMin: maquina.acertoPorCorMin != null ? Number(maquina.acertoPorCorMin) : undefined,
          numCoresImpressao: (body.cores || []).length || undefined,
        },
        cores: (body.cores || []) as Array<{ nome: string; tipo: 'CMYK' | 'PANTONE'; coberturaPercent: number; precoKg: number; rendimentoM2Kg: number }>,
        acabamentos: [
          ...((body.acabamentos || []) as Array<{ tipo: string; custoHora: number; velocidade: number; setupMinutos: number; custoMaterialM2?: number; custoMaterialUn?: number }>),
          ...(await montarAcabamentosRicos(user.empresaId, body.acabamentosRicos)),
        ],
        quantidade: body.quantidade,
        perdas,
        margem,
        coefTintaSuporte: await resolverCoefTintaSuporte(user.empresaId, body.papelId ?? undefined),
        partidaConsumoTintaKg: await resolverPartidaConsumoTinta(user.empresaId),
        aproveitamentoManual: body.aproveitamentoManual,
      })

      resultadoCalculo = resultado
      custoMaterial = resultado.papel.custo + resultado.tinta.custoTotal
      custoMaquina = resultado.maquinas.custoTotal
      custoAcabamento = resultado.acabamentos.custoTotal
      custoTotal = resultado.custoTotal
      precoVenda = resultado.precoVenda
      precoUnitario = resultado.precoUnitario
      margemReal = resultado.margemReal
    } else if (resultadoCalculo) {
      // Extrair valores do resultado pré-calculado
      custoMaterial = (resultadoCalculo.papel?.custo ?? 0) + (resultadoCalculo.tinta?.custoTotal ?? 0)
      custoMaquina = resultadoCalculo.maquinas?.custoTotal ?? null
      custoAcabamento = resultadoCalculo.acabamentos?.custoTotal ?? null
      custoTotal = resultadoCalculo.custoTotal ?? null
      precoVenda = resultadoCalculo.precoVenda ?? null
      precoUnitario = resultadoCalculo.precoUnitario ?? null
      margemReal = resultadoCalculo.margemReal ?? null
    }

    // Gerar número sequencial por empresa
    const ultimo = await prisma.orcamentoGrafico.findFirst({
      where: { empresaId: user.empresaId },
      orderBy: { numero: 'desc' },
      select: { numero: true },
    })
    const numero = (ultimo?.numero ?? 0) + 1

    // Criar o orçamento. O Nº é gerado automaticamente (max+1). Uma colisão de
    // Nº único por empresa (Req 1.3/1.4) retorna 409 sem persistir duplicado.
    let orcamento
    try {
      orcamento = await prisma.orcamentoGrafico.create({
        data: {
          empresaId: user.empresaId,
          numero,
          versao: 1,
          clienteId: body.clienteId ?? null,
          clienteNome: body.clienteNome ?? null,
          vendedorId: body.vendedorId ?? null,
          serie: body.serie ?? null,
          dataOrcamento: body.dataOrcamento ?? null,
          tipoEmbalagemId: body.tipoEmbalagemId,
          medidas: body.medidas,
          resultadoCalculo: resultadoCalculo ?? undefined,
          papelId: body.papelId ?? null,
          papelDescricao: body.papelDescricao ?? null,
          gramatura: body.gramatura ?? null,
          numCores: body.numCores,
          cores: body.cores ?? undefined,
          acabamentos: body.acabamentos ?? undefined,
          quantidade: body.quantidade,
          custoMaterial,
          custoMaquina,
          custoAcabamento,
          custoTotal,
          precoVenda,
          precoUnitario,
          margemReal,
          status: body.status,
          validadeAte: body.validadeAte ?? null,
          variacoes: body.variacoes ?? undefined,
          observacoes: body.observacoes ?? null,
          produtoId: body.produtoId ?? null,
          criadoPorId: user.id,
        },
        select: orcamentoGraficoSelect,
      })
    } catch (err: any) {
      // P2002 = violação de unique (empresaId, numero, versao) — Nº já em uso.
      if (err?.code === 'P2002') {
        return reply.status(409).send({ message: 'Número de orçamento já existe para esta empresa' })
      }
      throw err
    }

    return reply.status(201).send(orcamento)
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // LISTAR ORÇAMENTOS (paginado com filtros)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/orcamento-grafico
   * Lista orçamentos gráficos da empresa com paginação e filtros.
   */
  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const query = z.object({
      page: z.coerce.number().int().positive().optional().default(1),
      limit: z.coerce.number().int().positive().max(100).optional().default(50),
      status: z.enum(['RASCUNHO', 'ENVIADO', 'APROVADO', 'RECUSADO', 'VENCIDO']).optional(),
      clienteId: z.string().uuid().optional(),
      clienteNome: z.string().optional(),
      vendedorId: z.string().uuid().optional(),
      dataInicio: z.coerce.date().optional(),
      dataFim: z.coerce.date().optional(),
      busca: z.string().optional(),
    }).parse(request.query)

    const where: any = { empresaId: user.empresaId }

    if (query.status) where.status = query.status
    if (query.clienteId) where.clienteId = query.clienteId
    if (query.vendedorId) where.vendedorId = query.vendedorId

    if (query.clienteNome) {
      where.clienteNome = { contains: query.clienteNome, mode: 'insensitive' }
    }

    if (query.dataInicio || query.dataFim) {
      where.criadoEm = {}
      if (query.dataInicio) where.criadoEm.gte = query.dataInicio
      if (query.dataFim) where.criadoEm.lte = query.dataFim
    }

    if (query.busca) {
      where.OR = [
        { numero: { equals: isNaN(Number(query.busca)) ? undefined : Number(query.busca) } },
        { clienteNome: { contains: query.busca, mode: 'insensitive' } },
      ].filter(c => Object.values(c)[0] !== undefined)
    }

    // Usa orcamentoGraficoSelect mas exclui resultadoCalculo (pode ser JSON grande)
    // e inclui tipoEmbalagem para exibir na listagem
    const listSelect = {
      ...orcamentoGraficoSelect,
      resultadoCalculo: false,
      tipoEmbalagem: {
        select: { id: true, codigo: true, descricao: true },
      },
    } as const

    const [data, total] = await Promise.all([
      prisma.orcamentoGrafico.findMany({
        where,
        select: listSelect,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { criadoEm: 'desc' },
      }),
      prisma.orcamentoGrafico.count({ where }),
    ])

    return { data, total, page: query.page, limit: query.limit, totalPages: Math.max(1, Math.ceil(total / query.limit)) }
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // DETALHE COMPLETO (GET /:id)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/orcamento-grafico/:id
   * Retorna orçamento completo por ID, incluindo resultadoCalculo e tipoEmbalagem.
   */
  app.get('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const orcamento = await prisma.orcamentoGrafico.findFirst({
      where: { id, empresaId: user.empresaId },
      select: {
        ...orcamentoGraficoSelect,
        // ── Cabeçalho multi-item (spec multi-item-gcad §5.3) — select explícito,
        //    nunca omit (padrão do projeto p/ não materializar JSONs grandes).
        serie: true,
        dataOrcamento: true,
        custoProducaoConsolidado: true,
        valorTotalConsolidado: true,
        tipoEmbalagem: {
          select: { id: true, codigo: true, descricao: true, formulaLargura: true, formulaAltura: true, parametros: true },
        },
        // Itens aninhados (cada um com resultadoCalculo + fechamento). select
        // explícito de TODOS os campos do item (inclui os JSONs do próprio item,
        // necessários à tela; o pesado é só o resultadoCalculo por item).
        itens: {
          orderBy: { sequencia: 'asc' },
          select: {
            id: true,
            orcamentoId: true,
            empresaId: true,
            sequencia: true,
            tipoEmbalagemId: true,
            descricao: true,
            medidas: true,
            papelId: true,
            papelDescricao: true,
            suporteId: true,
            gramatura: true,
            numCores: true,
            cores: true,
            maquinaId: true,
            matrizQuantidade: true,
            matrizPrecoUnitario: true,
            tintaModo: true,
            tintaConsumoKg: true,
            acabamentosRicos: true,
            modeloFacaId: true,
            itensDiversos: true,
            itensFornecidos: true,
            camposLivres: true,
            quantidade: true,
            resultadoCalculo: true,
            margemSelecionada: true,
            custoProducao: true,
            valorTotal: true,
            pendente: true,
            criadoEm: true,
            atualizadoEm: true,
          },
        },
      },
    })

    if (!orcamento) return reply.status(404).send({ message: 'Orçamento não encontrado' })

    // Resolver nome do produto de repetição (modo Repetição), se houver
    let produtoNome: string | null = null
    if ((orcamento as any).produtoId) {
      const prod = await prisma.produto.findFirst({
        where: { id: (orcamento as any).produtoId, empresaId: user.empresaId },
        select: { codigo: true, nome: true },
      })
      if (prod) produtoNome = `${prod.codigo} - ${prod.nome}`
    }

    return { ...orcamento, produtoNome }
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // RELATÓRIO (GET /:id/relatorio) — estrutura de seções estilo Calcgraf
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/orcamento-grafico/:id/relatorio
   * Monta a estrutura do relatório estilo pré-cálculo Calcgraf.
   *
   * FORMATO DO RETORNO (decisão de compatibilidade — Req 13.6/13.7):
   *  - Quando o orçamento tem itens (`itens.length > 0`): retorna o RELATÓRIO
   *    CONSOLIDADO (`montarRelatorioConsolidado`) — cabeçalho comercial único,
   *    a lista de itens (cada um com seu relatório detalhado: 6 componentes +
   *    custo de produção + CEV + margens) e os totais consolidados do orçamento
   *    (vindos de `custoProducaoConsolidado`/`valorTotalConsolidado` do
   *    cabeçalho, já calculados na gravação). Itens cujo `resultadoCalculo` é
   *    null são PULADOS (o mais simples/robusto — item ainda não calculado não
   *    tem componentes a exibir; a soma consolidada do cabeçalho não depende da
   *    presença do item no relatório).
   *  - Quando o orçamento NÃO tem itens (modelo item-único legado): mantém
   *    EXATAMENTE o comportamento anterior, montando `montarRelatorio` a partir
   *    do `resultadoCalculo` do CABEÇALHO. O 400 "sem resultado de cálculo" só
   *    é retornado nesse caso legado quando o cabeçalho não tem resultado.
   */
  app.get('/:id/relatorio', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const { montarRelatorio, montarRelatorioConsolidado } = await import('./orcamento-grafico-relatorio.service')

    const orcamento = await prisma.orcamentoGrafico.findFirst({
      where: { id, empresaId: user.empresaId },
      select: {
        numero: true, versao: true, serie: true, clienteNome: true, quantidade: true,
        resultadoCalculo: true, medidas: true, observacoes: true,
        custoProducaoConsolidado: true, valorTotalConsolidado: true,
        tipoEmbalagem: { select: { codigo: true, descricao: true } },
        itens: {
          orderBy: { sequencia: 'asc' },
          select: {
            sequencia: true, descricao: true, resultadoCalculo: true,
            quantidade: true, custoProducao: true, valorTotal: true,
            margemSelecionada: true,
          },
        },
      },
    })
    if (!orcamento) return reply.status(404).send({ message: 'Orçamento não encontrado' })

    const empresa = await prisma.empresa.findUnique({
      where: { id: user.empresaId }, select: { razaoSocial: true },
    })

    // ── Caso multi-item: relatório consolidado por item + total do orçamento ──
    if (orcamento.itens.length > 0) {
      const itens = orcamento.itens
        .filter((it) => it.resultadoCalculo && typeof it.resultadoCalculo === 'object')
        .map((it) => {
          const res = it.resultadoCalculo as any
          return {
            sequencia: it.sequencia,
            descricao: it.descricao,
            resultado: res,
            quantidade: it.quantidade || res.quantidade || 0,
            custoProducao: Number(it.custoProducao ?? 0),
            valorTotal: Number(it.valorTotal ?? 0),
            margemSelecionada: Number(it.margemSelecionada ?? 0),
          }
        })

      const consolidado = montarRelatorioConsolidado({
        cabecalho: {
          empresa: empresa?.razaoSocial,
          numero: orcamento.versao ? `${orcamento.numero}/${orcamento.versao}` : String(orcamento.numero),
          cliente: orcamento.clienteNome || undefined,
          serie: orcamento.serie,
        },
        itens,
        custoProducaoConsolidado: Number(orcamento.custoProducaoConsolidado ?? 0),
        valorTotalConsolidado: Number(orcamento.valorTotalConsolidado ?? 0),
      })
      return consolidado
    }

    // ── Caso legado (item único): relatório a partir do cabeçalho ──
    const resultado = orcamento.resultadoCalculo as any
    if (!resultado || typeof resultado !== 'object') {
      return reply.status(400).send({ message: 'Orçamento sem resultado de cálculo. Recalcule antes de gerar o relatório.' })
    }

    const relatorio = montarRelatorio({
      resultado,
      quantidade: orcamento.quantidade || resultado.quantidade || 0,
      cabecalho: {
        empresa: empresa?.razaoSocial,
        numero: orcamento.versao ? `${orcamento.numero}/${orcamento.versao}` : String(orcamento.numero),
        cliente: orcamento.clienteNome || undefined,
        produto: orcamento.tipoEmbalagem?.descricao,
        descricao: (orcamento.observacoes as string | null) || undefined,
      },
    })
    return relatorio
  })

  /**
   * GET /api/orcamento-grafico/:id/relatorio.pdf
   * Mesmo relatório, renderizado em PDF (layout do pré-cálculo Calcgraf).
   * Aceita token via query (?token=) para abrir em nova aba.
   */
  app.get('/:id/relatorio.pdf', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const { montarRelatorio } = await import('./orcamento-grafico-relatorio.service')
    const { gerarRelatorioPdf } = await import('./orcamento-grafico-relatorio-pdf.service')

    const orcamento = await prisma.orcamentoGrafico.findFirst({
      where: { id, empresaId: user.empresaId },
      select: {
        numero: true, versao: true, clienteNome: true, quantidade: true,
        resultadoCalculo: true, observacoes: true,
        tipoEmbalagem: { select: { descricao: true } },
      },
    })
    if (!orcamento) return reply.status(404).send({ message: 'Orçamento não encontrado' })
    const resultado = orcamento.resultadoCalculo as any
    if (!resultado || typeof resultado !== 'object') {
      return reply.status(400).send({ message: 'Orçamento sem resultado de cálculo. Recalcule antes de gerar o relatório.' })
    }

    const empresa = await prisma.empresa.findUnique({
      where: { id: user.empresaId }, select: { razaoSocial: true },
    })
    const relatorio = montarRelatorio({
      resultado,
      quantidade: orcamento.quantidade || resultado.quantidade || 0,
      cabecalho: {
        empresa: empresa?.razaoSocial,
        numero: orcamento.versao ? `${orcamento.numero}/${orcamento.versao}` : String(orcamento.numero),
        cliente: orcamento.clienteNome || undefined,
        produto: orcamento.tipoEmbalagem?.descricao,
        descricao: (orcamento.observacoes as string | null) || undefined,
      },
    })
    const pdf = await gerarRelatorioPdf(relatorio)
    reply.header('Content-Type', 'application/pdf')
    reply.header('Content-Disposition', `inline; filename="relatorio-${orcamento.numero}.pdf"`)
    return reply.send(pdf)
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // ATUALIZAR ORÇAMENTO EM RASCUNHO (PUT /:id)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * PUT /api/orcamento-grafico/:id
   * Atualiza orçamento — só permitido se status for RASCUNHO.
   * Se parâmetros de cálculo mudarem e forem suficientes, recalcula.
   */
  app.put('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const { calcularOrcamentoGrafico: calcular } = await import('./orcamento-grafico-calculo.service')

    const body = z.object({
      clienteId: z.string().uuid().optional().nullable(),
      clienteNome: z.string().max(200).optional().nullable(),
      vendedorId: z.string().uuid().optional().nullable(),
      produtoId: z.string().uuid().optional().nullable(), // modo Repetição
      tipoEmbalagemId: z.string().uuid().optional(),
      medidas: z.record(z.number()).optional(),
      papelId: z.string().uuid().optional().nullable(),
      papelDescricao: z.string().max(200).optional().nullable(),
      gramatura: z.number().positive().optional().nullable(),
      numCores: z.number().int().min(0).optional(),
      cores: z.array(z.object({
        nome: z.string(),
        tipo: z.enum(['CMYK', 'PANTONE']),
        coberturaPercent: z.number().min(0).max(100),
        precoKg: z.number().min(0),
        rendimentoM2Kg: z.number().positive().default(25),
      })).optional().nullable(),
      acabamentos: z.array(z.object({
        tipo: z.string(),
        custoHora: z.number().min(0),
        velocidade: z.number().positive(),
        setupMinutos: z.number().min(0).default(0),
        custoMaterialM2: z.number().min(0).optional(),
        custoMaterialUn: z.number().min(0).optional(),
      })).optional().nullable(),
      quantidade: z.number().int().positive().optional(),
      precoKgPapel: z.number().positive().optional(),
      precoKg: z.number().positive().optional(), // alias enviado pelo wizard
      maquinaId: z.string().uuid().optional(),
      tabelaMargemId: z.string().uuid().optional(),
      resultadoCalculo: z.any().optional().nullable(),
      variacoes: z.any().optional().nullable(),
      observacoes: z.string().optional().nullable(),
      validadeAte: z.coerce.date().optional().nullable(),
    }).parse(request.body)

    // Buscar orçamento existente
    const existente = await prisma.orcamentoGrafico.findFirst({
      where: { id, empresaId: user.empresaId },
      select: { id: true, status: true, tipoEmbalagemId: true, quantidade: true, medidas: true },
    })
    if (!existente) return reply.status(404).send({ message: 'Orçamento não encontrado' })
    if (existente.status !== 'RASCUNHO') {
      return reply.status(400).send({ message: 'Só é possível editar orçamentos em RASCUNHO' })
    }

    // Preparar dados de atualização
    const updateData: any = {}
    if (body.clienteId !== undefined) updateData.clienteId = body.clienteId
    if (body.clienteNome !== undefined) updateData.clienteNome = body.clienteNome
    if (body.vendedorId !== undefined) updateData.vendedorId = body.vendedorId
    if (body.tipoEmbalagemId !== undefined) updateData.tipoEmbalagemId = body.tipoEmbalagemId
    if (body.medidas !== undefined) updateData.medidas = body.medidas
    if (body.papelId !== undefined) updateData.papelId = body.papelId
    if (body.papelDescricao !== undefined) updateData.papelDescricao = body.papelDescricao
    if (body.gramatura !== undefined) updateData.gramatura = body.gramatura
    if (body.numCores !== undefined) updateData.numCores = body.numCores
    if (body.cores !== undefined) updateData.cores = body.cores ?? undefined
    if (body.acabamentos !== undefined) updateData.acabamentos = body.acabamentos ?? undefined
    if (body.quantidade !== undefined) updateData.quantidade = body.quantidade
    if (body.variacoes !== undefined) updateData.variacoes = body.variacoes ?? undefined
    if (body.observacoes !== undefined) updateData.observacoes = body.observacoes
    if (body.validadeAte !== undefined) updateData.validadeAte = body.validadeAte
    if (body.produtoId !== undefined) updateData.produtoId = body.produtoId

    // Recalcular se temos parâmetros suficientes
    const tipoEmbalagemId = body.tipoEmbalagemId ?? existente.tipoEmbalagemId
    const quantidade = body.quantidade ?? existente.quantidade
    const medidas = body.medidas ?? (existente.medidas as Record<string, number>)

    if (body.resultadoCalculo) {
      // Resultado pré-calculado fornecido
      updateData.resultadoCalculo = body.resultadoCalculo
      updateData.custoMaterial = (body.resultadoCalculo.papel?.custo ?? 0) + (body.resultadoCalculo.tinta?.custoTotal ?? 0)
      updateData.custoMaquina = body.resultadoCalculo.maquinas?.custoTotal ?? null
      updateData.custoAcabamento = body.resultadoCalculo.acabamentos?.custoTotal ?? null
      updateData.custoTotal = body.resultadoCalculo.custoTotal ?? null
      updateData.precoVenda = body.resultadoCalculo.precoVenda ?? null
      updateData.precoUnitario = body.resultadoCalculo.precoUnitario ?? null
      updateData.margemReal = body.resultadoCalculo.margemReal ?? null
    } else if (body.gramatura && (body.precoKgPapel ?? body.precoKg)) {
      // Recalcular com os novos parâmetros (máquina informada OU default de impressão)
      const precoKgPapelPut = body.precoKgPapel ?? body.precoKg
      const tipo = await prisma.tipoEmbalagem.findFirst({ where: { id: tipoEmbalagemId, empresaId: user.empresaId } })
      if (!tipo) return reply.status(404).send({ message: 'Tipo de embalagem não encontrado' })

      let maquina = body.maquinaId
        ? await prisma.centroProducao.findFirst({ where: { id: body.maquinaId, empresaId: user.empresaId } })
        : null
      if (!maquina) {
        maquina = await prisma.centroProducao.findFirst({
          where: { empresaId: user.empresaId, status: true, tipoProcesso: { codigo: 'IMPRESSAO' } },
          orderBy: { posicao: 'asc' },
        })
      }
      if (!maquina) return reply.status(404).send({ message: 'Nenhuma máquina de impressão encontrada. Cadastre um Centro de Produção do tipo Impressão.' })

      let margem = { impostos: 15, comissao: 5, despAdm: 5, markup: 30 }
      if (body.tabelaMargemId) {
        const tabela = await prisma.tabelaMargem.findFirst({ where: { id: body.tabelaMargemId, empresaId: user.empresaId } })
        if (tabela) margem = { impostos: Number(tabela.impostos), comissao: Number(tabela.comissao), despAdm: Number(tabela.despAdm), markup: Number(tabela.markup) }
      }

      const perdasParam = await prisma.parametroPerda.findMany({ where: { empresaId: user.empresaId } })
      const perdaImpressao = perdasParam.find(p => !p.centroProducaoId)
      const perdas = {
        impressaoPercent: perdaImpressao ? Number(perdaImpressao.perdaVariavel) : 5,
        impressaoFixaFolhas: perdaImpressao ? perdaImpressao.perdaFixaFolhas : 50,
        corteVincoPercent: 3,
        colagemPercent: 2,
      }

      const resultado = calcular({
        tipoEmbalagem: {
          formulaLargura: tipo.formulaLargura,
          formulaAltura: tipo.formulaAltura,
          abaColagemMm: Number(tipo.abaColagemMm),
          sangriaMm: Number(tipo.sangriaMm),
          pincaMm: Number(tipo.pincaMm),
          parametros: parametrosDoTipo(tipo),
        },
        medidas,
        papel: { gramatura: body.gramatura, precoKg: precoKgPapelPut as number },
        maquinaImpressao: {
          velocidade: Number(maquina.velocidade) || 6000,
          custoHora: Number(maquina.custoHora) || 250,
          formatoLargura: maquina.formatoFolhaLargura || 660,
          formatoAltura: maquina.formatoFolhaAltura || 960,
          pinca: Number(maquina.pincaMm) || 10,
          setupMinutos: 30,
        },
        cores: (body.cores || []) as Array<{ nome: string; tipo: 'CMYK' | 'PANTONE'; coberturaPercent: number; precoKg: number; rendimentoM2Kg: number }>,
        acabamentos: (body.acabamentos || []) as Array<{ tipo: string; custoHora: number; velocidade: number; setupMinutos: number; custoMaterialM2?: number; custoMaterialUn?: number }>,
        quantidade,
        perdas,
        margem,
      })

      updateData.resultadoCalculo = resultado
      updateData.custoMaterial = resultado.papel.custo + resultado.tinta.custoTotal
      updateData.custoMaquina = resultado.maquinas.custoTotal
      updateData.custoAcabamento = resultado.acabamentos.custoTotal
      updateData.custoTotal = resultado.custoTotal
      updateData.precoVenda = resultado.precoVenda
      updateData.precoUnitario = resultado.precoUnitario
      updateData.margemReal = resultado.margemReal
    }

    const atualizado = await prisma.orcamentoGrafico.update({
      where: { id },
      data: updateData,
      select: orcamentoGraficoSelect,
    })

    return atualizado
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // ENVIAR PROPOSTA (POST /:id/enviar)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/orcamento-grafico/:id/enviar
   * Muda status de RASCUNHO para ENVIADO. Define validadeAte se não definido (+30 dias).
   */
  app.post('/:id/enviar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const orcamento = await prisma.orcamentoGrafico.findFirst({
      where: { id, empresaId: user.empresaId },
      select: { id: true, status: true, validadeAte: true, precoVenda: true, resultadoCalculo: true },
    })
    if (!orcamento) return reply.status(404).send({ message: 'Orçamento não encontrado' })
    if (orcamento.status !== 'RASCUNHO') {
      return reply.status(400).send({ message: 'Só é possível enviar orçamentos em RASCUNHO' })
    }
    // Não permitir enviar um orçamento sem precificação — senão ele pode ser
    // aprovado gerando um PedidoVenda com valor zero (bug de negócio real).
    if (orcamento.precoVenda == null || !orcamento.resultadoCalculo) {
      return reply.status(400).send({
        message: 'Calcule o preço do orçamento antes de enviar (etapa Revisão).',
        code: 'ORCAMENTO_SEM_PRECO',
      })
    }

    const validadeAte = orcamento.validadeAte ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

    const atualizado = await prisma.orcamentoGrafico.update({
      where: { id },
      data: { status: 'ENVIADO', validadeAte },
      select: orcamentoGraficoSelect,
    })

    // Opção A: se este orçamento nasceu de uma solicitação do Portal do
    // Representante, refletir na solicitação (PRECIFICADA) e copiar o preço
    // para o rep ver no Portal — sem expor custo/margem.
    await prisma.solicitacaoOrcamentoRep.updateMany({
      where: { orcamentoGraficoId: id, empresaId: user.empresaId, status: 'EM_ORCAMENTO' },
      data: {
        status: 'PRECIFICADA',
        precoVenda: (atualizado as any).precoVenda ?? null,
        precoUnitario: (atualizado as any).precoUnitario ?? null,
        precificadaEm: new Date(),
        precificadaPorId: user.id,
      },
    })

    return atualizado
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // APROVAR ORÇAMENTO (POST /:id/aprovar)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/orcamento-grafico/:id/aprovar
   * Muda status de ENVIADO para APROVADO. Gera PedidoVenda se possível.
   */
  app.post('/:id/aprovar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const orcamento = await prisma.orcamentoGrafico.findFirst({
      where: { id, empresaId: user.empresaId },
      select: {
        id: true,
        status: true,
        clienteId: true,
        clienteNome: true,
        vendedorId: true,
        precoVenda: true,
        quantidade: true,
        precoUnitario: true,
      },
    })
    if (!orcamento) return reply.status(404).send({ message: 'Orçamento não encontrado' })
    if (orcamento.status !== 'ENVIADO') {
      return reply.status(400).send({ message: 'Só é possível aprovar orçamentos com status ENVIADO' })
    }
    // Reforço: não aprovar orçamento sem preço (evita PedidoVenda com valor 0)
    if (orcamento.precoVenda == null) {
      return reply.status(400).send({
        message: 'Este orçamento não possui preço calculado e não pode ser aprovado.',
        code: 'ORCAMENTO_SEM_PRECO',
      })
    }

    const updateData: any = {
      status: 'APROVADO',
      aprovadoEm: new Date(),
    }

    // Se tem clienteId, tentar gerar PedidoVenda
    if (orcamento.clienteId) {
      // Buscar tabelaPreco padrão da empresa (primeira ativa)
      const tabelaPreco = await prisma.tabelaPreco.findFirst({
        where: { empresaId: user.empresaId, status: true },
        select: { id: true },
      })

      if (tabelaPreco) {
        // Gerar número de pedido
        const ultimoPedido = await prisma.pedidoVenda.findFirst({
          where: { empresaId: user.empresaId },
          orderBy: { numero: 'desc' },
          select: { numero: true },
        })
        const numeroPedido = (ultimoPedido?.numero ?? 0) + 1

        const pedido = await prisma.pedidoVenda.create({
          data: {
            empresaId: user.empresaId,
            numero: numeroPedido,
            clienteId: orcamento.clienteId,
            vendedorId: orcamento.vendedorId,
            tabelaPrecoId: tabelaPreco.id,
            valorTotal: orcamento.precoVenda ?? 0,
            status: 'RASCUNHO',
            origemPedido: 'ORCAMENTO_GRAFICO',
            orcamentoOrigemId: id,
          },
          select: { id: true, numero: true },
        })

        updateData.pedidoVendaId = pedido.id
      }
    }

    const atualizado = await prisma.orcamentoGrafico.update({
      where: { id },
      data: updateData,
      select: orcamentoGraficoSelect,
    })

    return atualizado
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // RECUSAR ORÇAMENTO (POST /:id/recusar)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/orcamento-grafico/:id/recusar
   * Muda status de ENVIADO para RECUSADO. Exige motivoRecusa.
   */
  app.post('/:id/recusar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const body = z.object({
      motivoRecusa: z.string().min(1, 'Motivo da recusa é obrigatório'),
    }).parse(request.body)

    const orcamento = await prisma.orcamentoGrafico.findFirst({
      where: { id, empresaId: user.empresaId },
      select: { id: true, status: true },
    })
    if (!orcamento) return reply.status(404).send({ message: 'Orçamento não encontrado' })
    if (orcamento.status !== 'ENVIADO') {
      return reply.status(400).send({ message: 'Só é possível recusar orçamentos com status ENVIADO' })
    }

    const atualizado = await prisma.orcamentoGrafico.update({
      where: { id },
      data: { status: 'RECUSADO', motivoRecusa: body.motivoRecusa },
      select: orcamentoGraficoSelect,
    })

    // Opção A: refletir recusa na solicitação do Portal vinculada
    await prisma.solicitacaoOrcamentoRep.updateMany({
      where: {
        orcamentoGraficoId: id,
        empresaId: user.empresaId,
        status: { in: ['EM_ORCAMENTO', 'PRECIFICADA'] },
      },
      data: { status: 'RECUSADA', motivoRecusa: body.motivoRecusa },
    })

    return atualizado
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // COPIAR ORÇAMENTO (POST /:id/copiar)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/orcamento-grafico/:id/copiar
   * Duplica o orçamento como nova versão (mesmo numero, versao + 1), status RASCUNHO.
   */
  app.post('/:id/copiar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const original = await prisma.orcamentoGrafico.findFirst({
      where: { id, empresaId: user.empresaId },
      select: orcamentoGraficoSelect,
    })
    if (!original) return reply.status(404).send({ message: 'Orçamento não encontrado' })

    // Descobrir a maior versão desse número
    const ultimaVersao = await prisma.orcamentoGrafico.findFirst({
      where: { empresaId: user.empresaId, numero: original.numero },
      orderBy: { versao: 'desc' },
      select: { versao: true },
    })
    const novaVersao = (ultimaVersao?.versao ?? 1) + 1

    const copia = await prisma.orcamentoGrafico.create({
      data: {
        empresaId: user.empresaId,
        numero: original.numero,
        versao: novaVersao,
        clienteId: original.clienteId ?? null,
        clienteNome: original.clienteNome ?? null,
        vendedorId: original.vendedorId ?? null,
        tipoEmbalagemId: original.tipoEmbalagemId,
        medidas: original.medidas as any,
        resultadoCalculo: original.resultadoCalculo as any ?? undefined,
        papelId: original.papelId ?? null,
        papelDescricao: original.papelDescricao ?? null,
        gramatura: original.gramatura ?? null,
        numCores: original.numCores,
        cores: original.cores as any ?? undefined,
        acabamentos: original.acabamentos as any ?? undefined,
        quantidade: original.quantidade,
        custoMaterial: original.custoMaterial ?? null,
        custoMaquina: original.custoMaquina ?? null,
        custoAcabamento: original.custoAcabamento ?? null,
        custoTotal: original.custoTotal ?? null,
        precoVenda: original.precoVenda ?? null,
        precoUnitario: original.precoUnitario ?? null,
        margemReal: original.margemReal ?? null,
        status: 'RASCUNHO',
        variacoes: original.variacoes as any ?? undefined,
        observacoes: original.observacoes ?? null,
        criadoPorId: user.id,
      },
      select: orcamentoGraficoSelect,
    })

    return reply.status(201).send(copia)
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // PROPOSTA COMERCIAL PDF (GET /:id/proposta-pdf) — Task 10.2
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/orcamento-grafico/:id/proposta-pdf
   * Gera e retorna PDF da proposta comercial.
   * Somente para RASCUNHO (preview), ENVIADO ou APROVADO.
   */
  app.get('/:id/proposta-pdf', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const orcamento = await prisma.orcamentoGrafico.findFirst({
      where: { id, empresaId: user.empresaId },
      select: {
        ...orcamentoGraficoSelect,
        tipoEmbalagem: { select: { descricao: true } },
      },
    })
    if (!orcamento) return reply.status(404).send({ message: 'Orçamento não encontrado' })

    const statusPermitidos = ['RASCUNHO', 'ENVIADO', 'APROVADO']
    if (!statusPermitidos.includes(orcamento.status)) {
      return reply.status(400).send({ message: 'PDF disponível apenas para orçamentos em Rascunho, Enviado ou Aprovado' })
    }

    // Buscar dados da empresa
    const empresa = await prisma.empresa.findUnique({
      where: { id: user.empresaId },
      select: { razaoSocial: true, cnpj: true, telefone: true, email: true },
    })

    // Buscar dados do cliente se houver clienteId
    let clienteData: { nome: string; cnpj?: string | null } = {
      nome: orcamento.clienteNome || 'Cliente não informado',
    }
    if (orcamento.clienteId) {
      const cliente = await prisma.cliente.findFirst({
        where: { id: orcamento.clienteId, empresaId: user.empresaId },
        select: { razaoSocial: true, cpfCnpj: true },
      })
      if (cliente) {
        clienteData = { nome: cliente.razaoSocial, cnpj: cliente.cpfCnpj }
      }
    }

    const { gerarPropostaPdf } = await import('./orcamento-grafico-proposta-pdf.service')

    const pdfBuffer = await gerarPropostaPdf({
      orcamento: {
        numero: orcamento.numero,
        versao: orcamento.versao,
        tipoEmbalagem: (orcamento as any).tipoEmbalagem?.descricao || 'N/A',
        papelDescricao: orcamento.papelDescricao,
        gramatura: orcamento.gramatura ? Number(orcamento.gramatura) : null,
        numCores: orcamento.numCores,
        cores: orcamento.cores as any,
        acabamentos: orcamento.acabamentos as any,
        quantidade: orcamento.quantidade,
        custoMaterial: orcamento.custoMaterial ? Number(orcamento.custoMaterial) : null,
        custoMaquina: orcamento.custoMaquina ? Number(orcamento.custoMaquina) : null,
        custoAcabamento: orcamento.custoAcabamento ? Number(orcamento.custoAcabamento) : null,
        custoTotal: orcamento.custoTotal ? Number(orcamento.custoTotal) : null,
        precoVenda: orcamento.precoVenda ? Number(orcamento.precoVenda) : null,
        precoUnitario: orcamento.precoUnitario ? Number(orcamento.precoUnitario) : null,
        margemReal: orcamento.margemReal ? Number(orcamento.margemReal) : null,
        variacoes: orcamento.variacoes as any,
        validadeAte: orcamento.validadeAte,
        observacoes: orcamento.observacoes,
        criadoEm: orcamento.criadoEm,
      },
      cliente: clienteData,
      empresa: {
        razaoSocial: empresa?.razaoSocial || 'Empresa',
        cnpj: empresa?.cnpj,
        telefone: empresa?.telefone,
        email: empresa?.email,
      },
    })

    const filename = `proposta-${orcamento.numero}-v${orcamento.versao}.pdf`
    reply.header('Content-Type', 'application/pdf')
    reply.header('Content-Disposition', `inline; filename="${filename}"`)
    return reply.send(pdfBuffer)
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // ENVIAR PROPOSTA POR E-MAIL (POST /:id/enviar-email) — Task 10.3
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/orcamento-grafico/:id/enviar-email
   * Gera PDF e envia por e-mail via SMTP configurado da empresa.
   */
  app.post('/:id/enviar-email', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const body = z.object({
      destinatario: z.string().email('E-mail de destino inválido'),
      mensagem: z.string().optional(),
    }).parse(request.body)

    const orcamento = await prisma.orcamentoGrafico.findFirst({
      where: { id, empresaId: user.empresaId },
      select: {
        ...orcamentoGraficoSelect,
        tipoEmbalagem: { select: { descricao: true } },
      },
    })
    if (!orcamento) return reply.status(404).send({ message: 'Orçamento não encontrado' })

    // Buscar dados da empresa
    const empresa = await prisma.empresa.findUnique({
      where: { id: user.empresaId },
      select: { razaoSocial: true, cnpj: true, telefone: true, email: true },
    })

    // Buscar dados do cliente
    let clienteData: { nome: string; cnpj?: string | null } = {
      nome: orcamento.clienteNome || 'Cliente',
    }
    if (orcamento.clienteId) {
      const cliente = await prisma.cliente.findFirst({
        where: { id: orcamento.clienteId, empresaId: user.empresaId },
        select: { razaoSocial: true, cpfCnpj: true },
      })
      if (cliente) clienteData = { nome: cliente.razaoSocial, cnpj: cliente.cpfCnpj }
    }

    // Gerar PDF
    const { gerarPropostaPdf } = await import('./orcamento-grafico-proposta-pdf.service')
    const pdfBuffer = await gerarPropostaPdf({
      orcamento: {
        numero: orcamento.numero,
        versao: orcamento.versao,
        tipoEmbalagem: (orcamento as any).tipoEmbalagem?.descricao || 'N/A',
        papelDescricao: orcamento.papelDescricao,
        gramatura: orcamento.gramatura ? Number(orcamento.gramatura) : null,
        numCores: orcamento.numCores,
        cores: orcamento.cores as any,
        acabamentos: orcamento.acabamentos as any,
        quantidade: orcamento.quantidade,
        custoMaterial: orcamento.custoMaterial ? Number(orcamento.custoMaterial) : null,
        custoMaquina: orcamento.custoMaquina ? Number(orcamento.custoMaquina) : null,
        custoAcabamento: orcamento.custoAcabamento ? Number(orcamento.custoAcabamento) : null,
        custoTotal: orcamento.custoTotal ? Number(orcamento.custoTotal) : null,
        precoVenda: orcamento.precoVenda ? Number(orcamento.precoVenda) : null,
        precoUnitario: orcamento.precoUnitario ? Number(orcamento.precoUnitario) : null,
        margemReal: orcamento.margemReal ? Number(orcamento.margemReal) : null,
        variacoes: orcamento.variacoes as any,
        validadeAte: orcamento.validadeAte,
        observacoes: orcamento.observacoes,
        criadoEm: orcamento.criadoEm,
      },
      cliente: clienteData,
      empresa: {
        razaoSocial: empresa?.razaoSocial || 'Empresa',
        cnpj: empresa?.cnpj,
        telefone: empresa?.telefone,
        email: empresa?.email,
      },
    })

    // Buscar config SMTP
    const configSmtp = await prisma.configSmtp.findUnique({
      where: { empresaId: user.empresaId },
    })

    if (!configSmtp) {
      console.warn(`[orcamento-grafico] SMTP não configurado para empresa ${user.empresaId}. E-mail não enviado.`)
      return { sucesso: true, message: 'PDF gerado, mas SMTP não configurado. Configure em Configurações > E-mail.' }
    }

    try {
      const nodemailer = require('nodemailer')
      const transporter = nodemailer.createTransport({
        host: configSmtp.host,
        port: configSmtp.porta,
        secure: configSmtp.porta === 465,
        auth: { user: configSmtp.usuario, pass: configSmtp.senha },
        tls: configSmtp.usarTls ? { rejectUnauthorized: false } : undefined,
      })

      const filename = `proposta-${orcamento.numero}-v${orcamento.versao}.pdf`
      const assunto = `Proposta Comercial #${orcamento.numero} — ${empresa?.razaoSocial || 'Vizor ERP'}`
      const mensagemHtml = body.mensagem
        ? `<p>${body.mensagem.replace(/\n/g, '<br>')}</p>`
        : `<p>Prezado(a) ${clienteData.nome},</p><p>Segue em anexo nossa proposta comercial #${orcamento.numero}.</p><p>Atenciosamente,<br>${empresa?.razaoSocial || ''}</p>`

      await transporter.sendMail({
        from: configSmtp.emailFrom || configSmtp.usuario,
        to: body.destinatario,
        subject: assunto,
        html: mensagemHtml,
        attachments: [{
          filename,
          content: pdfBuffer,
          contentType: 'application/pdf',
        }],
      })

      return { sucesso: true, message: `Proposta enviada para ${body.destinatario}` }
    } catch (err: any) {
      console.error('[orcamento-grafico] Erro ao enviar email:', err.message)
      return reply.status(422).send({ message: `Falha ao enviar e-mail: ${err.message}` })
    }
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // IMPORTAÇÃO EM MASSA — Task 11
  // ═══════════════════════════════════════════════════════════════════════════

  // Cache de importação (TTL 30 min)
  const cacheImportacao = new Map<string, { registros: any[]; expira: number }>()

  function limparCacheImportacaoExpirado() {
    const agora = Date.now()
    for (const [key, val] of cacheImportacao) {
      if (val.expira < agora) cacheImportacao.delete(key)
    }
  }

  /**
   * POST /api/orcamento-grafico/importar
   * Upload de CSV para importação de materiais/preços.
   * Retorna preview com validação (não salva).
   */
  app.post('/importar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    limparCacheImportacaoExpirado()

    const file = await request.file()
    if (!file) {
      return reply.status(400).send({ message: 'Nenhum arquivo enviado. Envie um CSV via multipart/form-data.' })
    }

    const nomeArquivo = file.filename.toLowerCase()
    if (!nomeArquivo.endsWith('.csv') && !nomeArquivo.endsWith('.xlsx') && !nomeArquivo.endsWith('.xls')) {
      return reply.status(400).send({ message: 'Formato inválido. Envie CSV (.csv) ou Excel (.xlsx/.xls).' })
    }

    const buffer = await file.toBuffer()
    if (buffer.length > 5 * 1024 * 1024) {
      return reply.status(400).send({ message: 'Arquivo excede o limite de 5MB.' })
    }

    // Parse CSV (suporte básico — linhas separadas por \n, colunas por ; ou ,)
    let registros: Array<{
      descricao: string
      tipo: string
      unidade: string
      precoUnitario: number
      dataVigencia?: string
      valido: boolean
      erros: string[]
    }> = []

    try {
      if (nomeArquivo.endsWith('.csv')) {
        registros = parseCsv(buffer.toString('utf-8'))
      } else {
        // Para xlsx, tentar parse simples (header row + data rows)
        registros = parseXlsx(buffer)
      }
    } catch (err: any) {
      return reply.status(400).send({ message: `Erro ao processar arquivo: ${err.message}` })
    }

    if (registros.length === 0) {
      return reply.status(400).send({ message: 'Nenhum registro válido encontrado no arquivo.' })
    }

    // Gerar ID de importação e cachear
    const importacaoId = randomUUID()
    cacheImportacao.set(importacaoId, {
      registros,
      expira: Date.now() + 30 * 60 * 1000,
    })

    const totalValidos = registros.filter(r => r.valido).length
    const totalErros = registros.filter(r => !r.valido).length

    return {
      importacaoId,
      totalRegistros: registros.length,
      totalValidos,
      totalErros,
      registros: registros.slice(0, 100), // Limita preview a 100 registros
    }
  })

  /**
   * POST /api/orcamento-grafico/importar/confirmar
   * Confirma importação e grava registros válidos como PrecoMateriaPrima.
   */
  app.post('/importar/confirmar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }

    const body = z.object({
      importacaoId: z.string().uuid(),
    }).parse(request.body)

    const cached = cacheImportacao.get(body.importacaoId)
    if (!cached || cached.expira < Date.now()) {
      cacheImportacao.delete(body.importacaoId)
      return reply.status(404).send({ message: 'Importação não encontrada ou expirada. Faça o upload novamente.' })
    }

    const registrosValidos = cached.registros.filter(r => r.valido)
    if (registrosValidos.length === 0) {
      return reply.status(400).send({ message: 'Nenhum registro válido para importar.' })
    }

    // Criar registros em lote
    let criados = 0
    for (const reg of registrosValidos) {
      try {
        await prisma.precoMateriaPrima.create({
          data: {
            empresaId: user.empresaId,
            descricao: reg.descricao,
            tipo: reg.tipo,
            unidade: reg.unidade,
            precoUnitario: reg.precoUnitario,
            dataVigencia: reg.dataVigencia ? new Date(reg.dataVigencia) : new Date(),
          },
        })
        criados++
      } catch (err: any) {
        // Ignora erros individuais (ex: duplicate) e continua
        console.warn(`[importar] Erro ao criar registro "${reg.descricao}": ${err.message}`)
      }
    }

    cacheImportacao.delete(body.importacaoId)

    return {
      sucesso: true,
      message: `${criados} de ${registrosValidos.length} registros importados com sucesso.`,
      totalImportados: criados,
    }
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // DASHBOARD COMERCIAL — Task 12
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/orcamento-grafico/dashboard
   * Retorna indicadores comerciais do módulo de orçamento gráfico.
   */
  app.get('/dashboard', async (request) => {
    const user = request.user as { id: string; empresaId: string }

    const query = z.object({
      periodo: z.enum(['30', '90', '365']).optional().default('90'),
    }).parse(request.query)

    const diasAtras = parseInt(query.periodo)
    const dataInicio = new Date(Date.now() - diasAtras * 24 * 60 * 60 * 1000)

    const whereBase = { empresaId: user.empresaId }
    const wherePeriodo = { empresaId: user.empresaId, criadoEm: { gte: dataInicio } }

    // Contagem total e por status
    const [total, convertidos, statusCounts, aprovadosComPreco] = await Promise.all([
      prisma.orcamentoGrafico.count({ where: wherePeriodo }),
      prisma.orcamentoGrafico.count({ where: { ...wherePeriodo, status: 'APROVADO' } }),
      prisma.orcamentoGrafico.groupBy({
        by: ['status'],
        where: wherePeriodo,
        _count: { id: true },
      }),
      prisma.orcamentoGrafico.findMany({
        where: { ...wherePeriodo, status: 'APROVADO', precoVenda: { not: null } },
        select: { precoVenda: true },
      }),
    ])

    // Taxa de conversão
    const taxaConversao = total > 0 ? Math.round((convertidos / total) * 10000) / 100 : 0

    // Ticket médio
    const somaAprovados = aprovadosComPreco.reduce((acc, o) => acc + Number(o.precoVenda || 0), 0)
    const ticketMedio = convertidos > 0 ? Math.round(somaAprovados / convertidos * 100) / 100 : 0

    // Pipeline (funil) — contagem global (sem filtro de período)
    const pipeline = await prisma.orcamentoGrafico.groupBy({
      by: ['status'],
      where: whereBase,
      _count: { id: true },
    })

    const pipelineMap: Record<string, number> = {}
    for (const p of pipeline) {
      pipelineMap[p.status] = p._count.id
    }

    // Ranking de clientes por volume (top 10)
    const clientesAprovados = await prisma.orcamentoGrafico.findMany({
      where: { empresaId: user.empresaId, status: 'APROVADO', precoVenda: { not: null } },
      select: { clienteNome: true, clienteId: true, precoVenda: true, margemReal: true },
    })

    const clienteAgg: Record<string, { nome: string; volume: number; margem: number; count: number }> = {}
    for (const orc of clientesAprovados) {
      const key = orc.clienteId || orc.clienteNome || 'Sem cliente'
      if (!clienteAgg[key]) {
        clienteAgg[key] = { nome: orc.clienteNome || 'Sem nome', volume: 0, margem: 0, count: 0 }
      }
      clienteAgg[key].volume += Number(orc.precoVenda || 0)
      clienteAgg[key].margem += Number(orc.margemReal || 0)
      clienteAgg[key].count++
    }

    const rankingVolume = Object.values(clienteAgg)
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 10)
      .map(c => ({ nome: c.nome, volume: Math.round(c.volume * 100) / 100, count: c.count }))

    const rankingMargem = Object.values(clienteAgg)
      .map(c => ({ nome: c.nome, margemMedia: c.count > 0 ? Math.round((c.margem / c.count) * 100) / 100 : 0, count: c.count }))
      .sort((a, b) => b.margemMedia - a.margemMedia)
      .slice(0, 10)

    // Por status (para o período)
    const porStatus: Record<string, number> = {}
    for (const s of statusCounts) {
      porStatus[s.status] = s._count.id
    }

    return {
      periodo: `${diasAtras} dias`,
      total,
      convertidos,
      taxaConversao,
      ticketMedio,
      porStatus,
      pipeline: {
        rascunho: pipelineMap['RASCUNHO'] || 0,
        enviado: pipelineMap['ENVIADO'] || 0,
        aprovado: pipelineMap['APROVADO'] || 0,
        recusado: pipelineMap['RECUSADO'] || 0,
        vencido: pipelineMap['VENCIDO'] || 0,
      },
      rankingVolume,
      rankingMargem,
    }
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // SIMULAR TIRAGENS (POST /simular-tiragens)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/orcamento-grafico/simular-tiragens
   * Executa cálculo para múltiplas quantidades sem salvar.
   * Retorna array de { quantidade, custoTotal, precoVenda, precoUnitario }.
   */
  app.post('/simular-tiragens', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { calcularOrcamentoGrafico: calcular } = await import('./orcamento-grafico-calculo.service')

    const body = z.object({
      tipoEmbalagemId: z.string().uuid(),
      medidas: z.record(z.number()),
      papelId: z.string().uuid().optional(),
      gramatura: z.number().positive(),
      precoKgPapel: z.number().positive().optional(),
      precoKg: z.number().positive().optional(), // alias enviado pelo wizard
      maquinaId: z.string().uuid().optional(),
      cores: z.array(z.object({
        nome: z.string(),
        tipo: z.enum(['CMYK', 'PANTONE']),
        coberturaPercent: z.number().min(0).max(100),
        precoKg: z.number().min(0),
        rendimentoM2Kg: z.number().positive().default(25),
      })),
      acabamentos: z.array(z.object({
        tipo: z.string(),
        custoHora: z.number().min(0),
        velocidade: z.number().positive(),
        setupMinutos: z.number().min(0).default(0),
        custoMaterialM2: z.number().min(0).optional(),
        custoMaterialUn: z.number().min(0).optional(),
      })).default([]),
      acabamentosRicos: z.array(acabamentoRicoRequestSchema).optional(),
      quantidades: z.array(z.number().int().positive()).min(1).max(20),
      tabelaMargemId: z.string().uuid().optional(),
      aproveitamentoManual: z.coerce.number().positive().optional(),
    }).parse(request.body)

    // Buscar tipo de embalagem
    const tipo = await prisma.tipoEmbalagem.findFirst({ where: { id: body.tipoEmbalagemId, empresaId: user.empresaId } })
    if (!tipo) return reply.status(404).send({ message: 'Tipo de embalagem não encontrado' })

    // Buscar máquina: a informada OU a primeira de impressão (mesmo fallback do
    // /calcular — o wizard nem sempre envia maquinaId).
    let maquina = body.maquinaId
      ? await prisma.centroProducao.findFirst({ where: { id: body.maquinaId, empresaId: user.empresaId } })
      : null
    if (!maquina) {
      maquina = await prisma.centroProducao.findFirst({
        where: { empresaId: user.empresaId, status: true, tipoProcesso: { codigo: 'IMPRESSAO' } },
        orderBy: { posicao: 'asc' },
      })
    }
    if (!maquina) return reply.status(404).send({ message: 'Nenhuma máquina de impressão encontrada. Cadastre um Centro de Produção do tipo Impressão.' })

    // Buscar tabela de margem
    let margem = { impostos: 15, comissao: 5, despAdm: 5, markup: 30 }
    if (body.tabelaMargemId) {
      const tabela = await prisma.tabelaMargem.findFirst({ where: { id: body.tabelaMargemId, empresaId: user.empresaId } })
      if (tabela) margem = { impostos: Number(tabela.impostos), comissao: Number(tabela.comissao), despAdm: Number(tabela.despAdm), markup: Number(tabela.markup) }
    }

    // Buscar perdas
    const perdasParam = await prisma.parametroPerda.findMany({ where: { empresaId: user.empresaId } })
    const perdaImpressao = perdasParam.find(p => !p.centroProducaoId)
    const perdas = {
      impressaoPercent: perdaImpressao ? Number(perdaImpressao.perdaVariavel) : 5,
      impressaoFixaFolhas: perdaImpressao ? perdaImpressao.perdaFixaFolhas : 50,
      corteVincoPercent: 3,
      colagemPercent: 2,
    }

    // Paridade Calcgraf (mesmo caminho que /calcular)
    const acertoPorCorMin = maquina.acertoPorCorMin != null ? Number(maquina.acertoPorCorMin) : undefined
    const tempoSetupMin = maquina.tempoSetupMin != null ? Number(maquina.tempoSetupMin) : undefined
    const coefTintaSuporte = await resolverCoefTintaSuporte(user.empresaId, body.papelId)
    const partidaConsumoTintaKg = await resolverPartidaConsumoTinta(user.empresaId)
    // Resolve os acabamentos ricos UMA vez (iguais para todas as tiragens).
    const acabamentosRicosResolvidos = await montarAcabamentosRicos(user.empresaId, body.acabamentosRicos)
    const acabamentosCombinados = [...body.acabamentos, ...acabamentosRicosResolvidos]

    // Calcular para cada quantidade
    const simulacoes = body.quantidades.map(quantidade => {
      const resultado = calcular({
        tipoEmbalagem: {
          formulaLargura: tipo.formulaLargura,
          formulaAltura: tipo.formulaAltura,
          abaColagemMm: Number(tipo.abaColagemMm),
          sangriaMm: Number(tipo.sangriaMm),
          pincaMm: Number(tipo.pincaMm),
          parametros: parametrosDoTipo(tipo),
        },
        medidas: body.medidas,
        papel: { gramatura: body.gramatura, precoKg: body.precoKgPapel },
        maquinaImpressao: {
          velocidade: Number(maquina.velocidade) || 6000,
          custoHora: Number(maquina.custoHora) || 250,
          formatoLargura: maquina.formatoFolhaLargura || 660,
          formatoAltura: maquina.formatoFolhaAltura || 960,
          pinca: Number(maquina.pincaMm) || 10,
          setupMinutos: tempoSetupMin ?? 30,
          acertoPorCorMin,
          numCoresImpressao: body.cores.length,
        },
        cores: body.cores,
        acabamentos: acabamentosCombinados,
        quantidade,
        perdas,
        margem,
        coefTintaSuporte,
        partidaConsumoTintaKg,
      })

      return {
        quantidade,
        custoTotal: resultado.custoTotal,
        precoVenda: resultado.precoVenda,
        precoUnitario: resultado.precoUnitario,
      }
    })

    return { simulacoes }
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // ORÇAMENTO MULTI-ITEM E ITENS ANINHADOS (spec multi-item-gcad §5.3)
  // ═══════════════════════════════════════════════════════════════════════════

  /** Garante que o orçamento existe e pertence à empresa. Retorna o id ou null. */
  async function carregarOrcamentoDaEmpresa(id: string, empresaId: string) {
    return prisma.orcamentoGrafico.findFirst({ where: { id, empresaId }, select: { id: true } })
  }

  /**
   * POST /api/orcamento-grafico/:id/itens
   * Adiciona um item ao orçamento: sequencia = max(sequencia)+1 (Req 1.5);
   * calcula o item via `calcularItem`; persiste o ItemOrcamentoGrafico com
   * resultadoCalculo + custoProducao + valorTotal (margem selecionada);
   * reconsolida o cabeçalho. Isolamento por empresaId.
   */
  app.post('/:id/itens', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = itemOrcamentoBodySchema.parse(request.body)

    const orcamento = await carregarOrcamentoDaEmpresa(id, user.empresaId)
    if (!orcamento) return reply.status(404).send({ message: 'Orçamento não encontrado' })

    // Calcular o item (envelope do motor) — mapeia ItemOrcamentoError → status.
    let resultado: ResultadoOrcamento
    try {
      resultado = await calcularItem(user.empresaId, montarInputDoItem(body))
    } catch (err) {
      if (err instanceof ItemOrcamentoError) return reply.status(err.statusCode).send({ message: err.message })
      throw err
    }

    // sequencia = max(sequencia)+1 do orçamento (Req 1.5)
    const ultimo = await prisma.itemOrcamentoGrafico.findFirst({
      where: { orcamentoId: id, empresaId: user.empresaId },
      orderBy: { sequencia: 'desc' },
      select: { sequencia: true },
    })
    const sequencia = (ultimo?.sequencia ?? 0) + 1

    const item = await prisma.itemOrcamentoGrafico.create({
      data: {
        orcamentoId: id,
        empresaId: user.empresaId,
        sequencia,
        ...dadosPersistenciaItem(body, resultado),
      },
    })

    await reconsolidarOrcamento(id, user.empresaId)

    return reply.status(201).send(item)
  })

  /**
   * PUT /api/orcamento-grafico/:id/itens/:itemId
   * Altera UM item (recalcula só este item) e reconsolida (Req 2.3, 3.4).
   */
  app.put('/:id/itens/:itemId', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id, itemId } = z
      .object({ id: z.string().uuid(), itemId: z.string().uuid() })
      .parse(request.params)
    const body = itemOrcamentoBodySchema.parse(request.body)

    const existente = await prisma.itemOrcamentoGrafico.findFirst({
      where: { id: itemId, orcamentoId: id, empresaId: user.empresaId },
      select: { id: true },
    })
    if (!existente) return reply.status(404).send({ message: 'Item de orçamento não encontrado' })

    let resultado: ResultadoOrcamento
    try {
      resultado = await calcularItem(user.empresaId, montarInputDoItem(body))
    } catch (err) {
      if (err instanceof ItemOrcamentoError) return reply.status(err.statusCode).send({ message: err.message })
      throw err
    }

    const item = await prisma.itemOrcamentoGrafico.update({
      where: { id: itemId },
      data: dadosPersistenciaItem(body, resultado),
    })

    await reconsolidarOrcamento(id, user.empresaId)

    return item
  })

  /**
   * DELETE /api/orcamento-grafico/:id/itens/:itemId
   * Remove o item e reconsolida; sem itens restantes → zera consolidados
   * (Req 1.6, 3.4). Isolamento por empresaId.
   */
  app.delete('/:id/itens/:itemId', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id, itemId } = z
      .object({ id: z.string().uuid(), itemId: z.string().uuid() })
      .parse(request.params)

    const existente = await prisma.itemOrcamentoGrafico.findFirst({
      where: { id: itemId, orcamentoId: id, empresaId: user.empresaId },
      select: { id: true },
    })
    if (!existente) return reply.status(404).send({ message: 'Item de orçamento não encontrado' })

    await prisma.itemOrcamentoGrafico.delete({ where: { id: itemId } })
    await reconsolidarOrcamento(id, user.empresaId)

    return reply.status(204).send()
  })

  /**
   * POST /api/orcamento-grafico/:id/itens/:itemId/calcular
   * Recalcula e retorna o fechamento do item sem exigir persistir mudança de
   * parâmetros além do necessário (Req 2.1/2.2). Persiste o resultado/fechamento
   * no item e reconsolida (mantém cabeçalho coerente após recálculo).
   */
  app.post('/:id/itens/:itemId/calcular', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id, itemId } = z
      .object({ id: z.string().uuid(), itemId: z.string().uuid() })
      .parse(request.params)
    const body = itemOrcamentoBodySchema.parse(request.body)

    const existente = await prisma.itemOrcamentoGrafico.findFirst({
      where: { id: itemId, orcamentoId: id, empresaId: user.empresaId },
      select: { id: true },
    })
    if (!existente) return reply.status(404).send({ message: 'Item de orçamento não encontrado' })

    let resultado: ResultadoOrcamento
    try {
      resultado = await calcularItem(user.empresaId, montarInputDoItem(body))
    } catch (err) {
      if (err instanceof ItemOrcamentoError) return reply.status(err.statusCode).send({ message: err.message })
      throw err
    }

    const fech = fechamentoDoResultado(resultado, body.margemSelecionada)
    await prisma.itemOrcamentoGrafico.update({
      where: { id: itemId },
      data: {
        resultadoCalculo: resultado as any,
        margemSelecionada: fech.margemSelecionada,
        custoProducao: fech.custoProducao,
        valorTotal: fech.valorTotal,
      },
    })
    await reconsolidarOrcamento(id, user.empresaId)

    return { resultado, fechamento: { custoProducao: fech.custoProducao, valorTotal: fech.valorTotal } }
  })

  /**
   * POST /api/orcamento-grafico/:id/itens/:itemId/simular-tiragens
   * Fechamento por N tiragens do item: itera `calcularItem` variando a
   * quantidade (reaproveita o padrão do /simular-tiragens). Não persiste.
   */
  app.post('/:id/itens/:itemId/simular-tiragens', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id, itemId } = z
      .object({ id: z.string().uuid(), itemId: z.string().uuid() })
      .parse(request.params)
    const body = itemOrcamentoBodySchema
      .extend({ quantidades: z.array(z.number().int().positive()).min(1).max(20) })
      .parse(request.body)

    const existente = await prisma.itemOrcamentoGrafico.findFirst({
      where: { id: itemId, orcamentoId: id, empresaId: user.empresaId },
      select: { id: true },
    })
    if (!existente) return reply.status(404).send({ message: 'Item de orçamento não encontrado' })

    const baseInput = montarInputDoItem(body)
    const simulacoes: Array<{
      quantidade: number
      custoProducao: number
      custoTotal: number
      precoVenda: number
      precoUnitario: number
    }> = []
    try {
      for (const quantidade of body.quantidades) {
        const resultado = await calcularItem(user.empresaId, { ...baseInput, quantidade })
        simulacoes.push({
          quantidade,
          custoProducao: Number(resultado.custoProducao ?? resultado.custoTotal ?? 0),
          custoTotal: resultado.custoTotal,
          precoVenda: resultado.precoVenda,
          precoUnitario: resultado.precoUnitario,
        })
      }
    } catch (err) {
      if (err instanceof ItemOrcamentoError) return reply.status(err.statusCode).send({ message: err.message })
      throw err
    }

    return { simulacoes }
  })
}


// ═══════════════════════════════════════════════════════════════════════════
// Funções auxiliares de parsing (CSV/XLSX) — Task 11.2
// ═══════════════════════════════════════════════════════════════════════════

const TIPOS_VALIDOS = ['PAPEL', 'TINTA', 'VERNIZ', 'COLA', 'FACA', 'BOPP', 'OUTRO']
const UNIDADES_VALIDAS = ['KG', 'M2', 'UN', 'LT', 'ML', 'M', 'PC', 'FL', 'RS']

interface RegistroImportacao {
  descricao: string
  tipo: string
  unidade: string
  precoUnitario: number
  dataVigencia?: string
  valido: boolean
  erros: string[]
}

function parseCsv(conteudo: string): RegistroImportacao[] {
  const linhas = conteudo.split(/\r?\n/).filter(l => l.trim())
  if (linhas.length < 2) return [] // precisa de header + pelo menos 1 linha

  // Detectar separador (;  ou  ,)
  const primeiraLinha = linhas[0]
  const separador = primeiraLinha.includes(';') ? ';' : ','

  const header = linhas[0].split(separador).map(h => h.trim().toLowerCase().replace(/['"]/g, ''))

  // Mapear índices de colunas esperadas
  const idxDescricao = header.findIndex(h => h.includes('descri'))
  const idxTipo = header.findIndex(h => h === 'tipo')
  const idxUnidade = header.findIndex(h => h.includes('unid'))
  const idxPreco = header.findIndex(h => h.includes('preco') || h.includes('preço') || h.includes('valor'))
  const idxData = header.findIndex(h => h.includes('data') || h.includes('vigencia') || h.includes('vigência'))

  if (idxDescricao === -1 || idxPreco === -1) {
    throw new Error('Colunas obrigatórias não encontradas. Esperado: descricao, precoUnitario. Opcional: tipo, unidade, dataVigencia')
  }

  const registros: RegistroImportacao[] = []

  for (let i = 1; i < linhas.length; i++) {
    const cols = linhas[i].split(separador).map(c => c.trim().replace(/^['"]|['"]$/g, ''))
    if (cols.length < 2) continue

    const erros: string[] = []
    const descricao = cols[idxDescricao] || ''
    let tipo = (idxTipo >= 0 ? cols[idxTipo] : 'OUTRO').toUpperCase()
    let unidade = (idxUnidade >= 0 ? cols[idxUnidade] : 'UN').toUpperCase()
    const precoStr = cols[idxPreco] || '0'
    const dataVigencia = idxData >= 0 ? cols[idxData] : undefined

    // Validações
    if (!descricao) erros.push('Descrição vazia')

    if (!TIPOS_VALIDOS.includes(tipo)) {
      erros.push(`Tipo inválido: "${tipo}". Válidos: ${TIPOS_VALIDOS.join(', ')}`)
      tipo = 'OUTRO'
    }

    if (!UNIDADES_VALIDAS.includes(unidade)) {
      erros.push(`Unidade inválida: "${unidade}". Válidas: ${UNIDADES_VALIDAS.join(', ')}`)
      unidade = 'UN'
    }

    // Limpar preço (aceita vírgula como decimal, remover ponto de milhar)
    const precoLimpo = precoStr.replace(/\./g, '').replace(',', '.')
    const precoUnitario = parseFloat(precoLimpo)
    if (isNaN(precoUnitario) || precoUnitario < 0) {
      erros.push(`Preço inválido: "${precoStr}"`)
    }

    registros.push({
      descricao,
      tipo,
      unidade,
      precoUnitario: isNaN(precoUnitario) ? 0 : precoUnitario,
      dataVigencia,
      valido: erros.length === 0 && !!descricao,
      erros,
    })
  }

  return registros
}

function parseXlsx(buffer: Buffer): RegistroImportacao[] {
  // Fallback simples: tenta ler como CSV (caso o usuário envie .csv com extensão errada)
  // Para .xlsx real, seria necessário o pacote 'xlsx' — como não está no package.json,
  // retornamos erro orientando o upload em CSV
  try {
    const texto = buffer.toString('utf-8')
    // Se começar com PK (magic bytes de ZIP/XLSX), não é CSV
    if (buffer[0] === 0x50 && buffer[1] === 0x4B) {
      throw new Error('Formato XLSX detectado. Por favor, exporte o arquivo como CSV (separado por ; ou ,) e reenvie.')
    }
    return parseCsv(texto)
  } catch (err: any) {
    if (err.message.includes('XLSX')) throw err
    throw new Error('Não foi possível processar o arquivo. Envie como CSV (separado por ; ou ,).')
  }
}
