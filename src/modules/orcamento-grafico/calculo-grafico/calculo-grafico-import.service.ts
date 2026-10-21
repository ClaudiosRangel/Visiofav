// Motor de importação do acervo Calcgraf → Biblioteca de Cálculos Gráficos.
//
// Spec: biblioteca-calculos-graficos (Task 9.1; Req 6.1, 6.2, 6.3, 6.4, 6.5,
// 6.6, 7.1, 8.3).
//
// Este arquivo é o MOTOR PURO/semi-puro de mapeamento e idempotência da
// importação do acervo Calcgraf para `CalculoGrafico`. Ele NÃO lê o banco de
// origem (SQL Server restaurado) — as linhas brutas já chegam LIDAS por fora (o
// script da Task 9.2 fará a extração via sqlcmd/JSON e chamará `importarAcervo`
// com uma leva de linhas já em memória). Aqui tratamos apenas:
//
//   1. o TIPO tolerante da linha de origem (`LinhaAcervoCalcgraf`);
//   2. a função PURA `mapearLinhaParaCalculo` (uma linha de origem → params de
//      criação do `CalculoGrafico`, ou um erro resiliente — NÃO lança);
//   3. a função `importarAcervo` que itera as linhas, aplica idempotência por
//      `(empresaId, numeroCalcgraf)`, grava via `criarCalculoGrafico` e devolve
//      o resumo `{ importados, atualizados, ignorados, erros, relatorio }`.
//
// FOTO CONGELADA (Req 4 / 6.2): a migração PRESERVA os agregados de custo/valor
// DA ORIGEM — NÃO recalcula com o motor. `resultadoCalculo` recebe a foto já
// agregada vinda da origem; `custoProducao`/`valorTotal` recebem os totais da
// origem como estão.
//
// MULTI-TENANT (steering ATENCAO §2.1): `empresaId` é SEMPRE EXPLÍCITO — tanto
// na checagem de idempotência (`findFirst({ where: { empresaId, numeroCalcgraf } })`)
// quanto na gravação (via `criarCalculoGrafico({ empresaId, ... })`). Nunca
// confiamos no `prismaScoped` (bypass SUPER_ADMIN).
//
// RESILIÊNCIA (Req 6.5): uma linha corrompida/sem campo essencial NÃO aborta a
// carga — vira uma entrada no `relatorio` e conta como `erro`.
//
// INVARIANTE DE CONTAGEM (Req 6.6):
//   importados + atualizados + ignorados + erros === linhas.length
// cada linha é contada em EXATAMENTE um balde.
//
// NOTA de escopo (Task 9.1 vs 9.2): o LOTE/batch e o `comRetry` (reconexão do
// pooler Neon) ficam no SCRIPT da Task 9.2 — aqui processamos em memória a leva
// de linhas recebida, sem controle de transporte/retry.

import { prisma } from '../../../lib/prisma'
import { criarCalculoGrafico } from './calculo-grafico.service'
import type { CamposEngenhariaCalculo } from './calculo-grafico.types'

// ============================================================================
// TIPO TOLERANTE DA LINHA DE ORIGEM
// ============================================================================

/**
 * Registro genérico de TINTA/cor do acervo (origem `CalculoTintas`). Todos os
 * campos são tolerantes (opcionais/`unknown`) — a origem é heterogênea e vários
 * cálculos antigos têm colunas em branco.
 */
export interface TintaAcervoCalcgraf {
  /** Nome/descrição da cor (ex.: "Pantone 185 C", "Ciano"). */
  nome?: string | null
  /** Pantone (quando houver). */
  pantone?: string | null
  /** Tipo da cor (process/CMYK vs especial/Pantone). */
  tipo?: string | null
  /** Cobertura em % (0..100). */
  coberturaPercent?: number | null
  /** Campos extras não mapeados (toleramos qualquer coluna de origem). */
  [extra: string]: unknown
}

/**
 * Registro genérico de ACABAMENTO/material de acabamento do acervo (origem
 * `CalculoMatAcabamento` + `CalculoAtividades`). Tolerante.
 */
export interface AcabamentoAcervoCalcgraf {
  /** Nome/descrição do acabamento ou atividade. */
  nome?: string | null
  /** Centro de custo/produção da atividade (quando houver). */
  centro?: string | null
  [extra: string]: unknown
}

/**
 * Registro genérico de PLANO/imposição do acervo (origem `CalculoPlanos`).
 * Tolerante — dele derivamos aproveitamento/montagem quando disponíveis.
 */
export interface PlanoAcervoCalcgraf {
  /** Aproveitamento/peças por folha (imposição). */
  aproveitamento?: number | null
  /** Montagem: linhas da imposição. */
  montagemLinhas?: number | null
  /** Montagem: colunas da imposição. */
  montagemColunas?: number | null
  [extra: string]: unknown
}

/**
 * SHAPE GENÉRICO/FLEXÍVEL de uma linha do acervo Calcgraf já lida por fora (pelo
 * script da Task 9.2). A origem é heterogênea: muitos campos são opcionais e
 * `unknown`. Só `numCalculo` e `tipoEmbalagemId` são tratados como ESSENCIAIS
 * pelo mapeamento (sua ausência torna a linha "corrompida" — Req 6.5).
 *
 * Correlação com as tabelas de origem (design / mapeamento):
 *  - `CalculoHeader`         → numCalculo, cliente, produto, descricao,
 *                              siglaAcabado, linhaProduto, tiragem;
 *  - `CalculoTintas`         → cores[];
 *  - `CalculoMatAcabamento`
 *    + `CalculoAtividades`   → acabamentos[];
 *  - `CalculoPlanos`         → planos[] (aproveitamento/montagem);
 *  - agregados de custo/valor DA ORIGEM → custoProducao, valorTotal,
 *    resultadoCalculo (FOTO — não recalcular).
 */
export interface LinhaAcervoCalcgraf {
  // ── Cabeçalho (CalculoHeader) ──
  /** Nº original do Calcgraf (ESSENCIAL — chave de idempotência). */
  numCalculo?: number | null
  /** Nome do cliente (clienteId fica null nesta migração). */
  cliente?: string | null
  /** Documento do cliente (reservado p/ de-para futuro; não usado por ora). */
  clienteDoc?: string | null
  /** Linha de produto (classificação de busca). */
  linhaProduto?: string | null
  /** Produto (descritivo do header). */
  produto?: string | null
  /** Descrição do cálculo. */
  descricao?: string | null
  /** Sigla do acabado. */
  siglaAcabado?: string | null
  /** Tiragem base do cálculo. */
  tiragem?: number | null

  // ── Geometria / produto ──
  /**
   * Tipo de embalagem — FK `TipoEmbalagem` no destino. Pode vir de duas formas:
   *  - `tipoEmbalagemId` (UUID do Vizor) direto, quando já resolvido; OU
   *  - `codProduto` (número do Calcgraf, tabela `Produtos`), que o importador
   *    resolve para o `TipoEmbalagem` cujo código é `CG-EMB-<codProduto>` via o
   *    de-para passado a `importarAcervo`.
   * Pelo menos UM dos dois deve estar presente (senão a linha é "corrompida").
   */
  tipoEmbalagemId?: string | null
  /** Código do Produto no Calcgraf (tabela `Produtos`) → `CG-EMB-<n>`. */
  codProduto?: number | null
  /** Medidas do produto (nome do parâmetro → valor em mm). */
  medidas?: Record<string, number> | null

  // ── Papel / suporte ──
  papelId?: string | null
  papelDescricao?: string | null
  suporteId?: string | null
  gramatura?: number | null

  // ── Impressão ──
  numCores?: number | null
  /** Cores de impressão (CalculoTintas). */
  cores?: TintaAcervoCalcgraf[] | null
  maquinaId?: string | null

  // ── Matriz / tinta ──
  matrizQuantidade?: number | null
  matrizPrecoUnitario?: number | null

  // ── Acabamentos / planos ──
  /** Acabamentos (CalculoMatAcabamento + CalculoAtividades). */
  acabamentos?: AcabamentoAcervoCalcgraf[] | null
  /** Planos/imposição (CalculoPlanos). */
  planos?: PlanoAcervoCalcgraf[] | null
  /** Override direto de aproveitamento (quando a origem já traz consolidado). */
  aproveitamentoManual?: number | null

  // ── FOTO / totais agregados DA ORIGEM (não recalcular) ──
  /** Foto agregada da origem (vira `resultadoCalculo`). */
  resultadoCalculo?: unknown
  /** Custo de produção agregado da origem. */
  custoProducao?: number | null
  /** Valor total agregado da origem. */
  valorTotal?: number | null

  /** Campos extras não mapeados (a origem é heterogênea). */
  [extra: string]: unknown
}

// ============================================================================
// RESULTADO DO MAPEAMENTO DE UMA LINHA
// ============================================================================

/** Mapeamento bem-sucedido de uma linha → params de criação. */
export interface LinhaMapeadaOk {
  engenharia: CamposEngenhariaCalculo
  biblioteca: {
    clienteNome: string | null
    linhaProduto: string | null
    produto: string | null
    descricao: string | null
    siglaAcabado: string | null
  }
  numeroCalcgraf: number
  resultadoCalculo: unknown
  custoProducao: number | null
  valorTotal: number | null
}

/** Mapeamento falho (linha corrompida/sem campo essencial — Req 6.5). */
export interface LinhaMapeadaErro {
  erro: string
  numeroCalcgraf: number | null
}

/** União do retorno de `mapearLinhaParaCalculo`. */
export type ResultadoMapeamentoLinha = LinhaMapeadaOk | LinhaMapeadaErro

/** Type guard: o mapeamento resultou em erro? */
export function mapeamentoEhErro(
  r: ResultadoMapeamentoLinha,
): r is LinhaMapeadaErro {
  return (r as LinhaMapeadaErro).erro !== undefined
}

// ============================================================================
// HELPERS DE NORMALIZAÇÃO TOLERANTE
// ============================================================================

/** Converte um valor heterogêneo para `number`, ou `null` se não-numérico. */
function paraNumeroOuNull(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** Converte um valor heterogêneo para `string` não-vazia, ou `null`. */
function paraStringOuNull(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

/**
 * String não-vazia TRUNCADA a `max` caracteres (defensivo contra colunas
 * VARCHAR do destino — o acervo tem descrições > 200 chars que estouravam o
 * `createMany`). Limites do schema `calculo_grafico`: clienteNome/produto/
 * descricao 200, linhaProduto 120, siglaAcabado 60.
 */
function paraStringTruncada(v: unknown, max: number): string | null {
  const s = paraStringOuNull(v)
  if (s == null) return null
  return s.length > max ? s.slice(0, max) : s
}

/**
 * Mapeia o tipo textual da cor da origem para o enum do destino (`CMYK` |
 * `PANTONE`). Heurística tolerante: se houver Pantone ou o tipo mencionar
 * "pantone"/"especial", é PANTONE; caso contrário CMYK.
 */
function tipoCorDestino(cor: TintaAcervoCalcgraf): 'CMYK' | 'PANTONE' {
  const temPantone = paraStringOuNull(cor.pantone) != null
  const tipo = (paraStringOuNull(cor.tipo) ?? '').toLowerCase()
  if (temPantone || tipo.includes('pantone') || tipo.includes('especial')) {
    return 'PANTONE'
  }
  return 'CMYK'
}

/**
 * Converte as tintas da origem (`cores[]`) para o shape `CorInput[]` esperado
 * pela engenharia. Entradas inválidas (sem nome) são descartadas. Quando a
 * origem não traz preço/rendimento (comum no acervo), usamos `0` — a FOTO é a
 * fonte de verdade da migração, não um recálculo.
 */
function mapearCores(
  cores: TintaAcervoCalcgraf[] | null | undefined,
): CamposEngenhariaCalculo['cores'] {
  if (!Array.isArray(cores) || cores.length === 0) return null
  const mapeadas = cores
    .map((c) => {
      const nome =
        paraStringOuNull(c.nome) ?? paraStringOuNull(c.pantone)
      if (nome == null) return null
      return {
        nome,
        tipo: tipoCorDestino(c),
        coberturaPercent: paraNumeroOuNull(c.coberturaPercent) ?? 0,
        precoKg: 0,
        rendimentoM2Kg: 0,
      }
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)
  return mapeadas.length > 0 ? mapeadas : null
}

/**
 * Converte os acabamentos da origem (`acabamentos[]`) para o shape
 * `AcabamentoRicoInput[]` da engenharia. Na migração guardamos apenas o NOME
 * (identificação do acabado) — os custos/tempos NÃO são recalculados (a FOTO da
 * origem preserva os valores). Entradas sem nome são descartadas.
 */
function mapearAcabamentos(
  acabamentos: AcabamentoAcervoCalcgraf[] | null | undefined,
): CamposEngenhariaCalculo['acabamentosRicos'] {
  if (!Array.isArray(acabamentos) || acabamentos.length === 0) return null
  const mapeados = acabamentos
    .map((a) => {
      const nome = paraStringOuNull(a.nome)
      if (nome == null) return null
      return { nome }
    })
    .filter((a): a is NonNullable<typeof a> => a !== null)
  return mapeados.length > 0 ? mapeados : null
}

/**
 * Deriva aproveitamento/montagem a partir dos planos da origem. Usa o primeiro
 * plano com dados úteis. `aproveitamentoManual` explícito na linha tem
 * precedência sobre o derivado do plano.
 */
function derivarImposicao(linha: LinhaAcervoCalcgraf): {
  aproveitamentoManual: number | null
  montagemLinhas: number | null
  montagemColunas: number | null
} {
  const planos = Array.isArray(linha.planos) ? linha.planos : []
  const plano = planos.find((p) => p != null)

  const aproveitamentoManual =
    paraNumeroOuNull(linha.aproveitamentoManual) ??
    paraNumeroOuNull(plano?.aproveitamento) ??
    null
  const montagemLinhas = paraNumeroOuNull(plano?.montagemLinhas)
  const montagemColunas = paraNumeroOuNull(plano?.montagemColunas)

  return { aproveitamentoManual, montagemLinhas, montagemColunas }
}

// ============================================================================
// mapearLinhaParaCalculo — FUNÇÃO PURA (NÃO toca o banco)
// ============================================================================

/**
 * Converte UMA linha do acervo Calcgraf para os params de criação de um
 * `CalculoGrafico`. Função PURA: não toca banco, não calcula custo, não resolve
 * cadastro. É a ponte entre a leitura heterogênea da origem e `criarCalculoGrafico`.
 *
 * Resiliência (Req 6.5): se a linha estiver corrompida / sem campo ESSENCIAL
 * (sem `numCalculo` válido, ou sem `tipoEmbalagemId`), retorna
 * `{ erro, numeroCalcgraf }` em vez de LANÇAR — a carga continua.
 *
 * FOTO (Req 6.2): `resultadoCalculo` recebe a foto agregada da origem como está;
 * `custoProducao`/`valorTotal` recebem os totais da origem. Nada é recalculado.
 *
 * @returns `LinhaMapeadaOk` quando válida, ou `LinhaMapeadaErro` quando corrompida.
 */
export function mapearLinhaParaCalculo(
  linha: LinhaAcervoCalcgraf,
  deParaTipoEmbalagem?: Map<number, string>,
): ResultadoMapeamentoLinha {
  // ── Campo essencial 1: numCalculo (chave de idempotência / numeroCalcgraf) ──
  const numeroCalcgraf = paraNumeroOuNull(linha.numCalculo)
  if (numeroCalcgraf == null) {
    return {
      erro: 'Linha sem numCalculo válido (campo essencial ausente)',
      numeroCalcgraf: null,
    }
  }

  // ── Campo essencial 2: tipoEmbalagemId (FK obrigatória no destino) ──
  // Resolve de duas formas (ver LinhaAcervoCalcgraf.tipoEmbalagemId):
  //  1) `tipoEmbalagemId` string direto (já é UUID do Vizor); ou
  //  2) `codProduto` (número Calcgraf) → UUID via `deParaTipoEmbalagem`.
  let tipoEmbalagemId = paraStringOuNull(linha.tipoEmbalagemId)
  if (tipoEmbalagemId == null) {
    const codProduto = paraNumeroOuNull(linha.codProduto)
    if (codProduto != null && deParaTipoEmbalagem) {
      tipoEmbalagemId = deParaTipoEmbalagem.get(codProduto) ?? null
    }
  }
  if (tipoEmbalagemId == null) {
    const cod = paraNumeroOuNull(linha.codProduto)
    return {
      erro:
        cod != null
          ? `Tipo de embalagem CG-EMB-${cod} não encontrado no Vizor (rode a fase tipos-embalagem antes)`
          : 'Linha sem tipoEmbalagem (campo essencial ausente)',
      numeroCalcgraf,
    }
  }

  // ── Tiragem base (quantidade): essencial para um cálculo válido ──
  const quantidade = paraNumeroOuNull(linha.tiragem)
  if (quantidade == null || quantidade <= 0) {
    return {
      erro: 'Linha sem tiragem válida (quantidade ausente ou não-positiva)',
      numeroCalcgraf,
    }
  }

  const cores = mapearCores(linha.cores)
  const numCores =
    paraNumeroOuNull(linha.numCores) ?? (cores ? cores.length : 0)
  const acabamentosRicos = mapearAcabamentos(linha.acabamentos)
  const { aproveitamentoManual, montagemLinhas, montagemColunas } =
    derivarImposicao(linha)

  // Descrição truncada ao limite do VARCHAR(200) do destino.
  const descricao = paraStringTruncada(linha.descricao, 200)

  const engenharia: CamposEngenhariaCalculo = {
    // ── Geometria / produto ──
    tipoEmbalagemId,
    descricao,
    medidas: (linha.medidas ?? {}) as Record<string, number>,

    // ── Papel / suporte ──
    papelId: paraStringOuNull(linha.papelId),
    papelDescricao: paraStringOuNull(linha.papelDescricao),
    suporteId: paraStringOuNull(linha.suporteId),
    gramatura: paraNumeroOuNull(linha.gramatura),

    // ── Impressão / cores / máquina ──
    numCores,
    cores,
    maquinaId: paraStringOuNull(linha.maquinaId),

    // ── Matriz / tinta ──
    matrizQuantidade: paraNumeroOuNull(linha.matrizQuantidade),
    matrizPrecoUnitario: paraNumeroOuNull(linha.matrizPrecoUnitario),
    tintaModo: null,
    tintaConsumoKg: null,

    // ── Acabamentos ricos / faca / montagem ──
    acabamentosRicos,
    modeloFacaId: null,
    aproveitamentoManual,
    montagemLinhas,
    montagemColunas,
    formatoCorteLarguraMm: null,
    formatoCorteAlturaMm: null,

    // ── Itens diversos / fornecidos / campos livres ──
    itensDiversos: null,
    itensFornecidos: null,
    camposLivres: null,

    // ── Tiragem e fechamento ──
    quantidade,
    margemSelecionada: null,
  }

  return {
    engenharia,
    biblioteca: {
      // Truncados aos limites do schema calculo_grafico (evita estourar VARCHAR
      // no createMany — o acervo tem descrições/nomes longos).
      clienteNome: paraStringTruncada(linha.cliente, 200),
      linhaProduto: paraStringTruncada(linha.linhaProduto, 120),
      produto: paraStringTruncada(linha.produto, 200),
      descricao,
      siglaAcabado: paraStringTruncada(linha.siglaAcabado, 60),
    },
    numeroCalcgraf,
    // FOTO da origem como está — NÃO recalcula (Req 6.2).
    resultadoCalculo: linha.resultadoCalculo ?? null,
    custoProducao: paraNumeroOuNull(linha.custoProducao),
    valorTotal: paraNumeroOuNull(linha.valorTotal),
  }
}

// ============================================================================
// importarAcervo — ORQUESTRAÇÃO (idempotência + gravação + relatório)
// ============================================================================

/** Parâmetros de `importarAcervo`. */
export interface ImportarAcervoParams {
  /** Empresa dona dos cálculos (EXPLÍCITO — isolamento multi-tenant). */
  empresaId: string
  /** Leva de linhas da origem já lidas por fora (script da Task 9.2). */
  linhas: LinhaAcervoCalcgraf[]
  /** Quando `true`, NÃO grava — apenas conta como se fosse importar. */
  dryRun?: boolean
}

/** Entrada do relatório de uma linha com problema (corrompida/ausente). */
export interface RelatorioImportacao {
  numeroCalcgraf: number | null
  motivo: string
}

/** Resumo do resultado da importação (contagens conservadas — Req 6.6). */
export interface ResumoImportacao {
  importados: number
  atualizados: number
  ignorados: number
  erros: number
  relatorio: RelatorioImportacao[]
}

/**
 * Importa uma leva de linhas do acervo Calcgraf para `CalculoGrafico`.
 *
 * Para cada linha:
 *  1. mapeia via `mapearLinhaParaCalculo`;
 *     - linha corrompida (Req 6.5) → entra no `relatorio`, conta como `erro`,
 *       SEM abortar a carga;
 *  2. idempotência (Req 6.4): checa se já existe
 *     `prisma.calculoGrafico.findFirst({ where: { empresaId, numeroCalcgraf } })`
 *     (empresaId EXPLÍCITO) — se existe, conta como `ignorado` e NÃO duplica
 *     (mantém inalterado);
 *  3. linha nova e mapeada OK:
 *     - `dryRun` → NÃO grava, conta como `importado` (como se fosse importar);
 *     - caso contrário → `criarCalculoGrafico({ empresaId, engenharia,
 *       ...biblioteca, numeroCalcgraf, origem: 'MIGRADO_CALCGRAF',
 *       resultadoCalculo, custoProducao, valorTotal })`; conta `importado`.
 *       Se a gravação falhar (ex.: corrida que viola `@@unique`), a linha é
 *       registrada no `relatorio` e contada como `erro` (sem abortar).
 *
 * INVARIANTE (Req 6.6): `importados + atualizados + ignorados + erros ===
 * linhas.length` — cada linha cai em EXATAMENTE um balde. `atualizados` é sempre
 * 0 nesta migração (a idempotência mantém inalterado, nunca sobrescreve), mas é
 * reportado por completude do contrato.
 *
 * @returns `{ importados, atualizados, ignorados, erros, relatorio }`.
 */
export async function importarAcervo(
  params: ImportarAcervoParams,
): Promise<ResumoImportacao> {
  const { empresaId, linhas, dryRun = false } = params

  // De-para Produto(Calcgraf) → TipoEmbalagem(Vizor): os `Produtos` do Calcgraf
  // foram migrados como TipoEmbalagem com código `CG-EMB-<codProduto>` (fase
  // `tipos-embalagem`). Monta o mapa `codProduto → tipoEmbalagemId` uma vez por
  // chamada, filtrando pela empresa (multi-tenant explícito).
  const deParaTipoEmbalagem = new Map<number, string>()
  const tiposEmb = await prisma.tipoEmbalagem.findMany({
    where: { empresaId, codigo: { startsWith: 'CG-EMB-' } },
    select: { id: true, codigo: true },
  })
  for (const te of tiposEmb) {
    const m = te.codigo.match(/^CG-EMB-(\d+)$/)
    if (m) deParaTipoEmbalagem.set(Number(m[1]), te.id)
  }

  // Idempotência (Req 6.4) — PRÉ-CARREGA todos os `numeroCalcgraf` já migrados
  // da empresa num Set, com UMA query (em vez de 1 findFirst por linha — isso
  // tornava o loop lentíssimo no pooler Neon). O Set é a fonte da checagem de
  // "já existe"; a constraint @@unique continua sendo a garantia final sob
  // concorrência.
  const jaExistentes = new Set<number>()
  {
    const existentes = await prisma.calculoGrafico.findMany({
      where: { empresaId, numeroCalcgraf: { not: null } },
      select: { numeroCalcgraf: true },
    })
    for (const e of existentes) {
      if (e.numeroCalcgraf != null) jaExistentes.add(e.numeroCalcgraf)
    }
  }

  // Numeração própria em MASSA: para a migração, numeramos em memória a partir
  // do maior `numero` atual da empresa (uma query). Inserimos em LOTE via
  // `createMany` — MUITO mais rápido que `criarCalculoGrafico` um-a-um (que faz
  // 2 roundtrips por registro no pooler Neon). Não altera o fluxo normal de
  // criação (esse é um caminho exclusivo do importador). A constraint
  // `@@unique([empresaId, numero])` permanece como rede de segurança.
  let proximoNumero = 0
  if (!dryRun) {
    const maior = await prisma.calculoGrafico.findFirst({
      where: { empresaId },
      orderBy: { numero: 'desc' },
      select: { numero: true },
    })
    proximoNumero = (maior?.numero ?? 0) + 1
  }

  let importados = 0
  const atualizados = 0 // nunca sobrescreve nesta migração (idempotência mantém)
  let ignorados = 0
  let erros = 0
  const relatorio: RelatorioImportacao[] = []

  // Acumula as linhas prontas para o `createMany` do lote.
  const paraInserir: Array<Record<string, unknown>> = []

  for (const linha of linhas) {
    const mapeado = mapearLinhaParaCalculo(linha, deParaTipoEmbalagem)

    // 1. Linha corrompida → relatório + erro, sem abortar (Req 6.5).
    if (mapeamentoEhErro(mapeado)) {
      erros += 1
      relatorio.push({
        numeroCalcgraf: mapeado.numeroCalcgraf,
        motivo: mapeado.erro,
      })
      continue
    }

    // 2. Idempotência por (empresaId, numeroCalcgraf) — via Set pré-carregado.
    if (jaExistentes.has(mapeado.numeroCalcgraf)) {
      ignorados += 1
      continue
    }
    jaExistentes.add(mapeado.numeroCalcgraf)

    // 3. dryRun: só conta (não grava).
    if (dryRun) {
      importados += 1
      continue
    }

    // 4. Monta a linha do `createMany` (numeração própria em memória).
    const eng = mapeado.engenharia
    paraInserir.push({
      empresaId,
      numero: proximoNumero++,
      numeroCalcgraf: mapeado.numeroCalcgraf,
      origem: 'MIGRADO_CALCGRAF',
      clienteNome: mapeado.biblioteca.clienteNome,
      linhaProduto: mapeado.biblioteca.linhaProduto,
      produto: mapeado.biblioteca.produto,
      descricao: mapeado.biblioteca.descricao ?? eng.descricao ?? null,
      siglaAcabado: mapeado.biblioteca.siglaAcabado,
      tipoEmbalagemId: eng.tipoEmbalagemId,
      medidas: eng.medidas,
      papelId: eng.papelId ?? null,
      papelDescricao: eng.papelDescricao ?? null,
      suporteId: eng.suporteId ?? null,
      gramatura: eng.gramatura ?? null,
      numCores: eng.numCores,
      cores: (eng.cores ?? null) as never,
      maquinaId: eng.maquinaId ?? null,
      matrizQuantidade: eng.matrizQuantidade ?? null,
      matrizPrecoUnitario: eng.matrizPrecoUnitario ?? null,
      tintaModo: eng.tintaModo ?? null,
      tintaConsumoKg: eng.tintaConsumoKg ?? null,
      acabamentosRicos: (eng.acabamentosRicos ?? null) as never,
      modeloFacaId: eng.modeloFacaId ?? null,
      aproveitamentoManual: eng.aproveitamentoManual ?? null,
      montagemLinhas: eng.montagemLinhas ?? null,
      montagemColunas: eng.montagemColunas ?? null,
      formatoCorteLarguraMm: eng.formatoCorteLarguraMm ?? null,
      formatoCorteAlturaMm: eng.formatoCorteAlturaMm ?? null,
      itensDiversos: (eng.itensDiversos ?? null) as never,
      itensFornecidos: (eng.itensFornecidos ?? null) as never,
      camposLivres: (eng.camposLivres ?? null) as never,
      quantidade: eng.quantidade,
      resultadoCalculo: (mapeado.resultadoCalculo ?? null) as never,
      custoProducao: mapeado.custoProducao ?? null,
      valorTotal: mapeado.valorTotal ?? null,
      margemSelecionada: eng.margemSelecionada ?? null,
    })
  }

  // 5. Insere o lote de uma vez (createMany). `skipDuplicates` cobre colisões
  //    residuais de `numeroCalcgraf`/`numero` sem abortar. Em erro do lote
  //    inteiro, registra no relatório e NÃO aborta a carga das outras levas.
  if (!dryRun && paraInserir.length > 0) {
    try {
      const res = await prisma.calculoGrafico.createMany({
        data: paraInserir as never,
        skipDuplicates: true,
      })
      importados += res.count
      if (res.count < paraInserir.length) {
        ignorados += paraInserir.length - res.count
      }
    } catch (err) {
      erros += paraInserir.length
      relatorio.push({
        numeroCalcgraf: null,
        motivo:
          err instanceof Error
            ? `Falha ao gravar lote de ${paraInserir.length}: ${err.message}`
            : `Falha ao gravar lote de ${paraInserir.length}`,
      })
    }
  }

  return { importados, atualizados, ignorados, erros, relatorio }
}
