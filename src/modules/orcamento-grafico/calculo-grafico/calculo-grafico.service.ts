// Service do submódulo Biblioteca de Cálculos Gráficos (Task 3.1).
//
// Spec: biblioteca-calculos-graficos (Req 5.2 / 7.A — numeração própria por
// empresa; Req 4 — FOTO congelada `resultadoCalculo`; Req 8.3 — origem).
//
// Este arquivo expõe `criarCalculoGrafico(params)`: criação ATÔMICA de um
// `CalculoGrafico` (o "cálculo solto" da biblioteca, estilo "Cálculo Padrão" do
// Calcgraf), com numeração PRÓPRIA do Vizor sequencial por empresa.
//
// INVARIANTE CRÍTICA (Req 5.2 / design §"Numeração atômica"):
//   O `numero` é atribuído e o registro é gravado dentro de UMA ÚNICA
//   `prisma.$transaction`, de modo que NUNCA exista um estado intermediário em
//   que o cálculo tenha número mas esteja fora da biblioteca (ou vice-versa).
//   Dentro da transação: `findFirst({ where:{ empresaId }, orderBy:{ numero:
//   'desc' } })` → `create` com `numero = (maior?.numero ?? 0) + 1`.
//
// MULTI-TENANT (steering ATENCAO §2.1): `empresaId` é SEMPRE filtrado/gravado
// EXPLÍCITO — nunca confiamos só no `prismaScoped` (bypass SUPER_ADMIN). O
// `empresaId` recebido aqui é o da entidade de negócio real (a empresa dona do
// cálculo), passado explicitamente pela rota.

import { prisma } from '../../../lib/prisma'
import type { CamposEngenhariaCalculo } from './calculo-grafico.types'
import { calculoParaItemBody } from './calculo-grafico-mapeamento'
import type { ItemBodyMapeado } from './calculo-grafico-mapeamento'
import {
  calcularItem,
  ItemOrcamentoError,
  type ItemOrcamentoInput,
} from '../orcamento-grafico-item.service'
import type { ResultadoOrcamento } from '../orcamento-grafico-calculo.service'
import {
  enriquecerEngenharia,
  type CampoEngenharia,
} from './enriquecimento-engenharia.service'

/**
 * Parâmetros de criação de um `CalculoGrafico` na biblioteca.
 *
 * Agrupa:
 *  - `empresaId` EXPLÍCITO (isolamento multi-tenant);
 *  - os campos de ENGENHARIA (`CamposEngenhariaCalculo` — ~30 colunas comuns ao
 *    item do orçamento);
 *  - os campos de BIBLIOTECA (cliente / linha / produto / descrição / sigla),
 *    todos opcionais;
 *  - a FOTO congelada `resultadoCalculo` (Json) e os totais já calculados;
 *  - metadados de origem/autor e o `numeroCalcgraf` opcional (migração).
 *
 * `status` fica a cargo do default do schema (`ATIVO`); `origem` tem default
 * `VIZOR` aqui no service (pode ser sobrescrito na migração do Calcgraf).
 */
export interface CriarCalculoGraficoParams {
  /** Empresa dona do cálculo (EXPLÍCITO — isolamento multi-tenant). */
  empresaId: string

  /** Campos de engenharia (shape comum ao item do orçamento). */
  engenharia: CamposEngenhariaCalculo

  // ── Campos de biblioteca (classificação de busca — Req 2.2) ──
  clienteId?: string | null
  clienteNome?: string | null
  linhaProduto?: string | null
  produto?: string | null
  descricao?: string | null
  siglaAcabado?: string | null

  /** FOTO congelada do resultado do cálculo (Req 4) — não recalcular depois. */
  resultadoCalculo?: unknown

  // ── Totais do fechamento (opcionais) ──
  custoProducao?: number | null
  valorTotal?: number | null
  margemSelecionada?: number | null

  /** Autor da criação (opcional). */
  criadoPorId?: string | null

  /** Nº original do Calcgraf (migração / busca — Req 7). */
  numeroCalcgraf?: number | null

  /** Origem do registro. Default `VIZOR`; `MIGRADO_CALCGRAF` na migração. */
  origem?: string
}

/**
 * Cria um `CalculoGrafico` com numeração PRÓPRIA sequencial por empresa, de
 * forma ATÔMICA.
 *
 * O `numero` é o maior `numero` já existente da empresa + 1, calculado e gravado
 * na MESMA transação do `create` — garantindo que o registro nasça já numerado e
 * dentro da biblioteca, sem janela de estado intermediário.
 *
 * Observação sobre o `numero` sob concorrência: a unicidade final é garantida
 * pela constraint `@@unique([empresaId, numero])` do schema — duas criações
 * concorrentes que leiam o mesmo "maior" farão uma delas falhar na constraint
 * (comportamento correto: a transação é revertida inteira, sem registro órfão).
 *
 * @returns o `CalculoGrafico` criado (registro completo do Prisma).
 */
export async function criarCalculoGrafico(params: CriarCalculoGraficoParams) {
  const {
    empresaId,
    engenharia: eng,
    clienteId,
    clienteNome,
    linhaProduto,
    produto,
    descricao,
    siglaAcabado,
    resultadoCalculo,
    custoProducao,
    valorTotal,
    margemSelecionada,
    criadoPorId,
    numeroCalcgraf,
    origem = 'VIZOR',
  } = params

  return prisma.$transaction(async (tx) => {
    // Numeração PRÓPRIA por empresa: maior numero existente + 1 (filtro
    // empresaId EXPLÍCITO — isolamento multi-tenant).
    const maior = await tx.calculoGrafico.findFirst({
      where: { empresaId },
      orderBy: { numero: 'desc' },
      select: { numero: true },
    })
    const numero = (maior?.numero ?? 0) + 1

    return tx.calculoGrafico.create({
      data: {
        empresaId,

        // ── Identificação / biblioteca ──
        numero,
        numeroCalcgraf: numeroCalcgraf ?? null,
        origem,
        // `status` usa o default do schema (ATIVO).

        // ── Cliente / classificação de busca ──
        clienteId: clienteId ?? null,
        clienteNome: clienteNome ?? null,
        linhaProduto: linhaProduto ?? null,
        produto: produto ?? null,
        descricao: descricao ?? eng.descricao ?? null,
        siglaAcabado: siglaAcabado ?? null,

        // ── Geometria / produto (engenharia) ──
        tipoEmbalagemId: eng.tipoEmbalagemId,
        medidas: eng.medidas,

        // ── Papel / suporte ──
        papelId: eng.papelId ?? null,
        papelDescricao: eng.papelDescricao ?? null,
        suporteId: eng.suporteId ?? null,
        gramatura: eng.gramatura ?? null,

        // ── Impressão / cores / máquina ──
        numCores: eng.numCores,
        cores: (eng.cores ?? null) as never,
        maquinaId: eng.maquinaId ?? null,

        // ── Matriz / tinta ──
        matrizQuantidade: eng.matrizQuantidade ?? null,
        matrizPrecoUnitario: eng.matrizPrecoUnitario ?? null,
        tintaModo: eng.tintaModo ?? null,
        tintaConsumoKg: eng.tintaConsumoKg ?? null,

        // ── Acabamentos ricos / faca / montagem ──
        acabamentosRicos: (eng.acabamentosRicos ?? null) as never,
        modeloFacaId: eng.modeloFacaId ?? null,
        aproveitamentoManual: eng.aproveitamentoManual ?? null,
        montagemLinhas: eng.montagemLinhas ?? null,
        montagemColunas: eng.montagemColunas ?? null,
        formatoCorteLarguraMm: eng.formatoCorteLarguraMm ?? null,
        formatoCorteAlturaMm: eng.formatoCorteAlturaMm ?? null,

        // ── Itens diversos / fornecidos / campos livres ──
        itensDiversos: (eng.itensDiversos ?? null) as never,
        itensFornecidos: (eng.itensFornecidos ?? null) as never,
        camposLivres: (eng.camposLivres ?? null) as never,

        // ── Tiragem e FOTO congelada ──
        quantidade: eng.quantidade,
        resultadoCalculo: (resultadoCalculo ?? null) as never,
        custoProducao: custoProducao ?? null,
        valorTotal: valorTotal ?? null,
        margemSelecionada: margemSelecionada ?? eng.margemSelecionada ?? null,

        criadoPorId: criadoPorId ?? null,
      },
    })
  })
}

// ============================================================================
// TASK 4.1 — BUSCA POR CRITÉRIOS (estilo "Localiza o Cálculo Padrão" do Calcgraf)
// ============================================================================
//
// Spec: biblioteca-calculos-graficos (Req 1.6, 1.7, 2.1–2.6, 7.2, 8.1, 8.2).
//
// Busca paginada de `CalculoGrafico` por critérios opcionais, em conjunção
// (AND). Critérios textuais usam `contains` + `mode: 'insensitive'` (contém,
// case-insensitive — Req 2.1/2.5); `numero` e `numeroCalcgraf` são match EXATO
// (Req 2.4/7.2). Sem nenhum critério, lista a biblioteca paginada da empresa
// (Req 2.3), ainda filtrando `status` e `empresaId`.
//
// MULTI-TENANT (steering ATENCAO §2.1): `empresaId` é SEMPRE parte do `where`,
// EXPLÍCITO — nunca confiamos só no `prismaScoped` (bypass SUPER_ADMIN).
//
// LEITURA CONSISTENTE (Req 1.7): a contagem total e a página de itens são lidas
// dentro de UMA `prisma.$transaction([...])` — ambas enxergam o mesmo snapshot,
// evitando `total` incoerente com a página (ex.: inserção concorrente entre as
// duas queries).

/** Status possíveis de um cálculo na biblioteca (Req 5.A). */
export type StatusCalculoGrafico = 'ATIVO' | 'RASCUNHO' | 'ARQUIVADO'

/**
 * Parâmetros da busca por critérios. Todos os filtros são opcionais e aplicados
 * em conjunção (AND). `empresaId` é obrigatório e EXPLÍCITO.
 */
export interface BuscarCalculosGraficosParams {
  /** Empresa dona dos cálculos (EXPLÍCITO — isolamento multi-tenant). */
  empresaId: string

  // ── Critérios textuais (contém, case-insensitive) ──
  cliente?: string | null
  linhaProduto?: string | null
  produto?: string | null
  descricao?: string | null
  siglaAcabado?: string | null

  // ── Critérios numéricos (match exato) ──
  numero?: number | null
  numeroCalcgraf?: number | null

  /** Status (default `ATIVO`). */
  status?: StatusCalculoGrafico

  /** Página (1-based, default 1). */
  pagina?: number
  /** Tamanho da página (default 20). */
  tamanho?: number
}

/**
 * Resumo de um cálculo para a listagem/busca. Traz APENAS os campos de
 * identificação/classificação (via `select`) — NÃO carrega `resultadoCalculo`,
 * `medidas` nem demais campos de engenharia (performance: a listagem não precisa
 * da foto nem do shape completo).
 */
export interface ResumoCalculo {
  id: string
  numero: number
  numeroCalcgraf: number | null
  clienteNome: string | null
  produto: string | null
  descricao: string | null
  linhaProduto: string | null
  siglaAcabado: string | null
  dataCalculo: Date
  origem: string
}

/** Resultado paginado da busca. */
export interface BuscaCalculosGraficosResultado {
  itens: ResumoCalculo[]
  total: number
  pagina: number
  tamanho: number
}

/**
 * Busca cálculos gráficos da biblioteca por critérios (conjunção), paginado.
 *
 * Monta o `where` com `empresaId` SEMPRE + `status` + cada critério informado.
 * Critérios textuais → `contains` + `mode: 'insensitive'`; numéricos → igualdade
 * exata. A contagem e a listagem rodam na MESMA transação de leitura (snapshot
 * consistente — Req 1.7).
 *
 * @returns `{ itens, total, pagina, tamanho }`.
 */
export async function buscarCalculosGraficos(
  params: BuscarCalculosGraficosParams,
): Promise<BuscaCalculosGraficosResultado> {
  const {
    empresaId,
    cliente,
    linhaProduto,
    produto,
    descricao,
    siglaAcabado,
    numero,
    numeroCalcgraf,
    status = 'ATIVO',
    pagina = 1,
    tamanho = 20,
  } = params

  // Normaliza paginação (defensivo contra valores inválidos vindos da rota).
  const paginaEfetiva = pagina > 0 ? Math.floor(pagina) : 1
  const tamanhoEfetivo = tamanho > 0 ? Math.floor(tamanho) : 20

  // `where` com conjunção (AND): empresaId e status SEMPRE; demais critérios só
  // quando informados (não-vazios). `contains` + insensitive para texto.
  const where: {
    empresaId: string
    status: string
    numero?: number
    numeroCalcgraf?: number
    clienteNome?: { contains: string; mode: 'insensitive' }
    linhaProduto?: { contains: string; mode: 'insensitive' }
    produto?: { contains: string; mode: 'insensitive' }
    descricao?: { contains: string; mode: 'insensitive' }
    siglaAcabado?: { contains: string; mode: 'insensitive' }
  } = {
    empresaId,
    status,
  }

  if (cliente != null && cliente !== '') {
    where.clienteNome = { contains: cliente, mode: 'insensitive' }
  }
  if (linhaProduto != null && linhaProduto !== '') {
    where.linhaProduto = { contains: linhaProduto, mode: 'insensitive' }
  }
  if (produto != null && produto !== '') {
    where.produto = { contains: produto, mode: 'insensitive' }
  }
  if (descricao != null && descricao !== '') {
    where.descricao = { contains: descricao, mode: 'insensitive' }
  }
  if (siglaAcabado != null && siglaAcabado !== '') {
    where.siglaAcabado = { contains: siglaAcabado, mode: 'insensitive' }
  }
  if (numero != null) {
    where.numero = numero
  }
  if (numeroCalcgraf != null) {
    where.numeroCalcgraf = numeroCalcgraf
  }

  // Leitura por snapshot consistente (Req 1.7): contagem + página na MESMA
  // transação. `select` traz só o resumo (sem resultadoCalculo/medidas).
  const [total, itens] = await prisma.$transaction([
    prisma.calculoGrafico.count({ where }),
    prisma.calculoGrafico.findMany({
      where,
      orderBy: { numero: 'desc' },
      skip: (paginaEfetiva - 1) * tamanhoEfetivo,
      take: tamanhoEfetivo,
      select: {
        id: true,
        numero: true,
        numeroCalcgraf: true,
        clienteNome: true,
        produto: true,
        descricao: true,
        linhaProduto: true,
        siglaAcabado: true,
        dataCalculo: true,
        origem: true,
      },
    }),
  ])

  return { itens, total, pagina: paginaEfetiva, tamanho: tamanhoEfetivo }
}

// ============================================================================
// TASK 4.2 — LEITURA DA FOTO CONGELADA + RECALCULAR
// ============================================================================
//
// Spec: biblioteca-calculos-graficos (Req 4.1, 4.2, 4.3, 4.4).
//
// `obterCalculoGrafico` lê o registro completo (incluindo a FOTO congelada
// `resultadoCalculo`) SEM recalcular nada (Req 4.1/4.4). `recalcularCalculoGrafico`
// reconstrói o input do motor a partir dos campos de engenharia persistidos,
// roda `calcularItem` com os cadastros ATUAIS, ANEXA a foto anterior ao histórico
// `fotosAnteriores` (Req 4.3) e grava a nova foto numa transação.
//
// MULTI-TENANT (steering ATENCAO §2.1): `empresaId` EXPLÍCITO em TODA query —
// `findFirst({ where: { id, empresaId } })` na leitura e `updateMany({ where:
// { id, empresaId } })` na gravação. Cálculo de outra empresa → `null`/erro (a
// rota traduz em 404).

/** Erro de regra de negócio do recalcular (ex.: cálculo não encontrado). */
export class CalculoGraficoError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message)
    this.name = 'CalculoGraficoError'
  }
}

/** Tipo auxiliar do registro completo do cálculo (retorno do Prisma). */
type CalculoGraficoRegistro = NonNullable<
  Awaited<ReturnType<typeof prisma.calculoGrafico.findFirst>>
>

/**
 * Lê UM cálculo gráfico completo (inclui a foto `resultadoCalculo`) por
 * `{ id, empresaId }`. `empresaId` EXPLÍCITO (isolamento multi-tenant).
 *
 * NÃO recalcula nada — devolve o registro persistido como está (Req 4.1/4.4).
 * Se não existir ou for de outra empresa, retorna `null` (a rota traduz em 404,
 * sem revelar existência cross-tenant).
 */
export async function obterCalculoGrafico(
  empresaId: string,
  id: string,
): Promise<CalculoGraficoRegistro | null> {
  return prisma.calculoGrafico.findFirst({
    where: { id, empresaId },
  })
}

/** `Decimal | null | undefined` (ou number) → `number | null`. */
function decimalParaNumero(v: unknown): number | null {
  if (v == null) return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}

/**
 * Reconstrói o shape de engenharia (`CamposEngenhariaCalculo`) a partir do
 * registro persistido do `CalculoGrafico` (convertendo `Decimal`→`number` e
 * lendo os campos JSON). É a ponte entre o que está no banco e o mapeamento puro
 * `calculoParaItemBody`.
 */
export function registroParaEngenharia(
  calc: CalculoGraficoRegistro,
): CamposEngenhariaCalculo {
  return {
    // ── Geometria / produto ──
    tipoEmbalagemId: calc.tipoEmbalagemId,
    descricao: calc.descricao,
    medidas: (calc.medidas ?? {}) as Record<string, number>,

    // ── Papel / suporte ──
    papelId: calc.papelId,
    papelDescricao: calc.papelDescricao,
    suporteId: calc.suporteId,
    gramatura: decimalParaNumero(calc.gramatura),

    // ── Impressão / cores / máquina ──
    numCores: calc.numCores,
    cores: (calc.cores ?? null) as CamposEngenhariaCalculo['cores'],
    maquinaId: calc.maquinaId,

    // ── Matriz / tinta ──
    matrizQuantidade: decimalParaNumero(calc.matrizQuantidade),
    matrizPrecoUnitario: decimalParaNumero(calc.matrizPrecoUnitario),
    tintaModo: (calc.tintaModo ?? null) as CamposEngenhariaCalculo['tintaModo'],
    tintaConsumoKg: decimalParaNumero(calc.tintaConsumoKg),

    // ── Acabamentos ricos / faca / montagem ──
    acabamentosRicos: (calc.acabamentosRicos ??
      null) as CamposEngenhariaCalculo['acabamentosRicos'],
    modeloFacaId: calc.modeloFacaId,
    aproveitamentoManual: decimalParaNumero(calc.aproveitamentoManual),
    montagemLinhas: calc.montagemLinhas,
    montagemColunas: calc.montagemColunas,
    formatoCorteLarguraMm: decimalParaNumero(calc.formatoCorteLarguraMm),
    formatoCorteAlturaMm: decimalParaNumero(calc.formatoCorteAlturaMm),

    // ── Itens diversos / fornecidos / campos livres ──
    itensDiversos: (calc.itensDiversos ??
      null) as CamposEngenhariaCalculo['itensDiversos'],
    itensFornecidos: (calc.itensFornecidos ??
      null) as CamposEngenhariaCalculo['itensFornecidos'],
    camposLivres: (calc.camposLivres ??
      null) as CamposEngenhariaCalculo['camposLivres'],

    // ── Tiragem e fechamento ──
    quantidade: calc.quantidade,
    margemSelecionada: decimalParaNumero(calc.margemSelecionada),
  }
}

/**
 * Converte o BODY mapeado (`ItemBodyMapeado`, saída de `calculoParaItemBody`)
 * para o `ItemOrcamentoInput` que `calcularItem` consome.
 *
 * O `ItemBodyMapeado` e o `ItemOrcamentoInput` compartilham praticamente os
 * mesmos campos de engenharia; as diferenças tratadas aqui:
 *  - `cores` é obrigatório (`CorInput[]`) no input → `?? []` quando ausente;
 *  - `matriz`/`tinta` já vêm no shape de OBJETO (igual ao input) a partir do
 *    mapeamento — repassados como estão (ou `undefined` quando `null`);
 *  - campos `null` do body viram `undefined`/null conforme o input espera.
 */
function bodyParaItemOrcamentoInput(body: ItemBodyMapeado): ItemOrcamentoInput {
  return {
    tipoEmbalagemId: body.tipoEmbalagemId,
    medidas: body.medidas,

    papelId: body.papelId ?? null,
    gramatura: body.gramatura,

    maquinaId: body.maquinaId ?? null,

    aproveitamentoManual: body.aproveitamentoManual ?? undefined,

    matriz: body.matriz ?? undefined,
    tinta: body.tinta ?? undefined,

    modeloFacaId: body.modeloFacaId ?? null,

    cores: body.cores ?? [],
    acabamentosRicos: body.acabamentosRicos ?? undefined,

    quantidade: body.quantidade,

    montagemLinhas: body.montagemLinhas ?? null,
    montagemColunas: body.montagemColunas ?? null,
    formatoCorteLarguraMm: body.formatoCorteLarguraMm ?? null,
    formatoCorteAlturaMm: body.formatoCorteAlturaMm ?? null,

    // Itens diversos/fornecidos: o input do motor usa o shape
    // `{ descricao, valor }` / `{ descricao, valor }`. Mapeamos a partir do
    // persistido (que carrega `quantidade`/`valor`/`fixo`), repassando o valor
    // efetivo. Mantém o MD coerente com o que foi lançado no cálculo.
    itensDiversos: (body.itensDiversos ?? []).map((i) => ({
      descricao: i.descricao,
      valor: i.fixo ? i.valor : i.valor * i.quantidade,
    })),
    itensFornecidos: (body.itensFornecidos ?? []).map((i) => ({
      descricao: i.descricao,
      valor: 0,
    })),

    tabelaMargemId: null,
  }
}

/**
 * RECALCULA um cálculo gráfico com os cadastros ATUAIS, preservando o histórico.
 *
 * Fluxo (Req 4.2/4.3):
 *  1. Carrega o cálculo por `{ id, empresaId }` (EXPLÍCITO); inexistente → erro.
 *  2. Reconstrói o input do motor a partir dos campos de engenharia persistidos
 *     (`registroParaEngenharia` → `calculoParaItemBody` → `bodyParaItemOrcamentoInput`).
 *  3. Roda `calcularItem(empresaId, input)` (motor com cadastros atuais).
 *     - Se lançar `ItemOrcamentoError` (cadastro ausente), a foto ORIGINAL é
 *       PRESERVADA (nada é gravado) e o erro é RE-LANÇADO para a rota tratar.
 *  4. ANEXA a foto ATUAL (`resultadoCalculo` + `custoProducao` + `valorTotal` +
 *     data) ao array `fotosAnteriores` (histórico — Req 4.3).
 *  5. Grava a NOVA foto (`resultadoCalculo`) + novos `custoProducao`/`valorTotal`
 *     numa transação, com `updateMany({ where: { id, empresaId } })` (posse
 *     reconfirmada no `where`).
 *
 * @returns o cálculo atualizado (registro completo).
 */
export async function recalcularCalculoGrafico(
  empresaId: string,
  id: string,
): Promise<CalculoGraficoRegistro> {
  // 1. Carrega o cálculo (empresaId EXPLÍCITO).
  const calculo = await prisma.calculoGrafico.findFirst({
    where: { id, empresaId },
  })
  if (!calculo) {
    throw new CalculoGraficoError('Cálculo não encontrado', 404)
  }

  // 2. Reconstrói o input do motor a partir dos campos persistidos.
  const engenharia = registroParaEngenharia(calculo)
  const body = calculoParaItemBody(engenharia)
  const input = bodyParaItemOrcamentoInput(body)

  // 3. Recalcula com os cadastros atuais. Se faltar cadastro, o motor lança
  //    ItemOrcamentoError — NÃO gravamos (foto original preservada) e re-lançamos.
  let resultado: ResultadoOrcamento
  try {
    resultado = await calcularItem(empresaId, input)
  } catch (err) {
    if (err instanceof ItemOrcamentoError) {
      throw err // preserva a foto original — a rota traduz o erro
    }
    throw err
  }

  // 4. Anexa a foto ATUAL ao histórico (Req 4.3). Preserva o array existente.
  const historicoAtual = Array.isArray(calculo.fotosAnteriores)
    ? (calculo.fotosAnteriores as unknown[])
    : []
  const fotoAnterior = {
    resultadoCalculo: calculo.resultadoCalculo ?? null,
    custoProducao: decimalParaNumero(calculo.custoProducao),
    valorTotal: decimalParaNumero(calculo.valorTotal),
    em: new Date().toISOString(),
  }
  const novasFotosAnteriores = [...historicoAtual, fotoAnterior]

  // 5. Grava a NOVA foto + totais numa transação (empresaId EXPLÍCITO no where).
  const novoCustoProducao = resultado.custoProducao
  const novoValorTotal = resultado.precoVenda

  await prisma.$transaction([
    prisma.calculoGrafico.updateMany({
      where: { id, empresaId },
      data: {
        resultadoCalculo: resultado as never,
        custoProducao: novoCustoProducao,
        valorTotal: novoValorTotal,
        fotosAnteriores: novasFotosAnteriores as never,
        dataCalculo: new Date(),
      },
    }),
  ])

  // Retorna o cálculo atualizado (releitura isolada por empresaId).
  const atualizado = await prisma.calculoGrafico.findFirst({
    where: { id, empresaId },
  })
  if (!atualizado) {
    // Teoricamente inalcançável (acabamos de atualizar); defensivo.
    throw new CalculoGraficoError('Cálculo não encontrado após recálculo', 404)
  }
  return atualizado
}

// ============================================================================
// ENRIQUECIMENTO DA ENGENHARIA (spec orcamento-repeticao-engenharia-completa)
// ============================================================================
//
// `garantirEngenhariaCompleta` roda o de-para (enriquecerEngenharia) quando o
// cálculo ainda não foi enriquecido (`engenhariaCompleta=false`), grava os campos
// resolvidos DE VOLTA no próprio CalculoGrafico (melhora progressiva — Req 2),
// persiste a lista de pendências (`engenhariaPendentes`) e marca
// `engenhariaCompleta=true` quando NÃO restam pendências ESSENCIAIS (papel,
// gramatura, cores) — campos secundários pendentes (ex.: máquina) não bloqueiam.
//
// A FOTO (`resultadoCalculo`) e os totais (`custoProducao`/`valorTotal`) NUNCA
// são alterados. `empresaId` EXPLÍCITO. Idempotente (não reexecuta se já
// completo). Retorna o cálculo atualizado + o clienteId resolvido (para a rota
// de puxar gravar no orçamento) + as pendências.

/** Pendências que BLOQUEIAM o recálculo (essenciais ao motor). */
const PENDENCIAS_ESSENCIAIS: CampoEngenharia[] = ['papel', 'gramatura', 'cores']

export interface GarantirEngenhariaResultado {
  calculo: CalculoGraficoRegistro
  /** Cliente resolvido por CNPJ (para a rota gravar no orçamento). */
  clienteId: string | null
  /** Campos A_COMPLETAR após o enriquecimento. */
  pendentes: CampoEngenharia[]
}

/**
 * Garante que a engenharia estruturada do CalculoGrafico está preenchida.
 * Idempotente: se `engenhariaCompleta=true`, apenas relê e devolve (resolvendo o
 * clienteId pela foto/clienteDoc para a rota). `empresaId` EXPLÍCITO.
 */
export async function garantirEngenhariaCompleta(
  empresaId: string,
  id: string,
): Promise<GarantirEngenhariaResultado> {
  const calc = await prisma.calculoGrafico.findFirst({ where: { id, empresaId } })
  if (!calc) throw new CalculoGraficoError('Cálculo não encontrado', 404)

  // Roda o de-para a partir da foto (não altera a foto).
  const { campos, pendentes } = await enriquecerEngenharia(empresaId, {
    resultadoCalculo: calc.resultadoCalculo,
    clienteDoc: (calc as { clienteDoc?: string | null }).clienteDoc ?? null,
    clienteCodigo: (calc as { clienteCodigo?: number | null }).clienteCodigo ?? null,
    cores: calc.cores,
  })

  // Se já estava completo, não regrava a engenharia (idempotência — Req 2.3);
  // apenas devolve o clienteId resolvido (útil para a rota de puxar).
  const jaCompleto = (calc as { engenhariaCompleta?: boolean }).engenhariaCompleta === true
  if (jaCompleto) {
    return { calculo: calc, clienteId: campos.clienteId ?? calc.clienteId ?? null, pendentes }
  }

  // Monta o `data` apenas com os campos RESOLVIDOS (nunca sobrescreve com vazio).
  const data: Record<string, unknown> = {}
  if (campos.papelId) data.papelId = campos.papelId
  if (campos.suporteId) data.suporteId = campos.suporteId
  if (campos.gramatura != null) data.gramatura = campos.gramatura
  if (campos.cores) data.cores = campos.cores as never
  if (campos.acabamentosRicos) data.acabamentosRicos = campos.acabamentosRicos as never
  if (campos.maquinaId) data.maquinaId = campos.maquinaId
  if (campos.clienteId) data.clienteId = campos.clienteId

  const essenciaisPendentes = pendentes.filter((p) => PENDENCIAS_ESSENCIAIS.includes(p))
  data.engenhariaPendentes = (pendentes.length ? pendentes : null) as never
  data.engenhariaCompleta = essenciaisPendentes.length === 0

  await prisma.calculoGrafico.updateMany({
    where: { id, empresaId },
    data: data as never,
  })

  const atualizado = await prisma.calculoGrafico.findFirst({ where: { id, empresaId } })
  if (!atualizado) throw new CalculoGraficoError('Cálculo não encontrado após enriquecimento', 404)
  return {
    calculo: atualizado,
    clienteId: campos.clienteId ?? atualizado.clienteId ?? null,
    pendentes,
  }
}
