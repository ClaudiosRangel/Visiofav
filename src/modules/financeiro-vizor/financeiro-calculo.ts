/**
 * Núcleo puro de cálculo do Financeiro Vizor (billing do SaaS).
 *
 * Todas as funções deste arquivo são DETERMINÍSTICAS e SEM I/O:
 * - Não acessam banco de dados.
 * - Não leem o relógio global (`Date.now()`/`new Date()` sem argumento) —
 *   o "agora" é sempre injetado como parâmetro.
 * - Recebem todos os dados de que precisam por parâmetro.
 *
 * Isso torna a lógica de negócio sensível (total mensal, dias em atraso,
 * transição de estágio, geração de vencimentos e decisão do guard) testável
 * por property-based testing sem mocks. Ver design em
 * `.kiro/specs/financeiro-vizor/design.md` (seções "Components and Interfaces"
 * item 1 e "Correctness Properties").
 */

import {
  DIAS_BLOQUEIO,
  type Modulo,
  type StatusFatura,
  type StatusFinanceiro,
} from './financeiro.types'

/** Milissegundos em um dia (24h). */
const MS_POR_DIA = 24 * 60 * 60 * 1000

// ---------------------------------------------------------------------------
// Total mensal
// ---------------------------------------------------------------------------

/**
 * Total mensal = soma dos preços de módulo estritamente maiores que zero.
 *
 * Módulos com preço 0 (ou negativo, defensivamente) são ignorados. Retorna 0
 * quando nenhum módulo tem preço > 0. Resultado sempre >= 0. (Req 3.3)
 */
export function calcularTotalMensal(precos: { modulo: Modulo; preco: number }[]): number {
  let total = 0
  for (const p of precos) {
    if (p.preco > 0) {
      total += p.preco
    }
  }
  return total
}

// ---------------------------------------------------------------------------
// Faturas vencidas em aberto
// ---------------------------------------------------------------------------

/**
 * Uma fatura está "vencida em aberto" quando:
 * - status é `PENDENTE` ou `VENCIDA` (ou seja, não `PAGA` nem `CANCELADA`), e
 * - a data de vencimento é anterior a `agora`.
 */
function estaVencidaEmAberto(
  fatura: { status: StatusFatura; dataVencimento: Date },
  agora: Date,
): boolean {
  const emAberto = fatura.status === 'PENDENTE' || fatura.status === 'VENCIDA'
  return emAberto && fatura.dataVencimento.getTime() < agora.getTime()
}

/**
 * Dias corridos entre a data de vencimento da fatura vencida em aberto mais
 * antiga e `agora`. Retorna 0 quando não há fatura nessa condição.
 *
 * O resultado é o número inteiro de dias corridos (piso da diferença em dias),
 * sempre >= 0. Usa a fatura de vencimento mais antigo (maior atraso).
 * (Req 6.3, 4.4, 8.5)
 */
export function calcularDiasEmAtraso(
  faturas: { status: StatusFatura; dataVencimento: Date }[],
  agora: Date,
): number {
  let maisAntiga: Date | null = null
  for (const f of faturas) {
    if (estaVencidaEmAberto(f, agora)) {
      if (maisAntiga === null || f.dataVencimento.getTime() < maisAntiga.getTime()) {
        maisAntiga = f.dataVencimento
      }
    }
  }
  if (maisAntiga === null) return 0
  const diffMs = agora.getTime() - maisAntiga.getTime()
  const dias = Math.floor(diffMs / MS_POR_DIA)
  return dias > 0 ? dias : 0
}

/**
 * Total vencido em aberto = soma dos valores das faturas `PENDENTE`/`VENCIDA`
 * com vencimento anterior a `agora`. Faturas `PAGA`/`CANCELADA` ou ainda não
 * vencidas nunca entram. Sempre >= 0. (Req 2.5, 4.4)
 */
export function calcularTotalVencidoEmAberto(
  faturas: { status: StatusFatura; dataVencimento: Date; valor: number }[],
  agora: Date,
): number {
  let total = 0
  for (const f of faturas) {
    if (estaVencidaEmAberto(f, agora)) {
      total += f.valor
    }
  }
  return total
}

// ---------------------------------------------------------------------------
// Transição de estágio (ciclo de inadimplência)
// ---------------------------------------------------------------------------

/**
 * Transição de estágio a partir do status atual e dos dias em atraso, aplicada
 * pelo job diário e por recálculos.
 *
 * - `INATIVADO` nunca muda por este cálculo (só ação manual). (Req 6.12)
 * - `SOMENTE_LEITURA` nunca volta a `ATIVO` por este cálculo (desbloqueio é
 *   sempre manual). (Req 8.6)
 * - `ATIVO` -> `SOMENTE_LEITURA` se e somente se `dias >= 30`. (Req 6.7)
 * - `ATIVO` permanece `ATIVO` entre 0 e 29 dias. (Req 6.5, 6.11)
 */
export function determinarEstagio(
  atual: StatusFinanceiro,
  diasEmAtraso: number,
): StatusFinanceiro {
  if (atual === 'INATIVADO') return 'INATIVADO' // Req 6.12 (absorvente)
  if (atual === 'SOMENTE_LEITURA') return 'SOMENTE_LEITURA' // job nunca reativa (Req 8.6)
  // atual === 'ATIVO'
  if (diasEmAtraso >= DIAS_BLOQUEIO) return 'SOMENTE_LEITURA' // Req 6.7
  return 'ATIVO' // Req 6.5, 6.11
}

// ---------------------------------------------------------------------------
// Geração de datas de vencimento
// ---------------------------------------------------------------------------

/** Último dia do mês (1..12) de um dado ano, considerando ano bissexto. */
function ultimoDiaDoMes(ano: number, mes1a12: number): number {
  // `new Date(ano, mes, 0)` retorna o último dia do mês anterior a `mes+1`,
  // isto é, o último dia de `mes1a12` (mes é 0-indexado aqui: mes1a12 sem -1).
  return new Date(ano, mes1a12, 0).getDate()
}

/**
 * Competência inicial default = mês seguinte ao mês de `agora`, no formato
 * "YYYY-MM". Vira o ano corretamente (dezembro -> janeiro do ano seguinte).
 * (Req 5.6)
 */
export function competenciaMesSeguinte(agora: Date): string {
  let ano = agora.getFullYear()
  let mes = agora.getMonth() + 1 // 1..12 (mês corrente)
  mes += 1 // mês seguinte
  if (mes > 12) {
    mes = 1
    ano += 1
  }
  return `${ano.toString().padStart(4, '0')}-${mes.toString().padStart(2, '0')}`
}

/**
 * Datas de vencimento para N competências consecutivas a partir da inicial.
 *
 * - Retorna exatamente `meses` itens, em competências consecutivas (mês a mês,
 *   virando o ano corretamente).
 * - O dia de cada data de vencimento é `min(diaVencimento, últimoDiaDoMês)` —
 *   se o dia configurado não existe no mês (ex.: 31 em fevereiro), usa o
 *   último dia do mês. (Req 5.1, 5.2, 5.3)
 *
 * As datas são construídas em horário local à meia-noite (00:00) do dia.
 * `competenciaInicial` no formato "YYYY-MM".
 */
export function calcularDatasVencimento(
  competenciaInicial: string,
  meses: number,
  diaVencimento: number,
): { competencia: string; dataVencimento: Date }[] {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(competenciaInicial)
  if (!match) {
    throw new Error(`Competência inicial inválida: "${competenciaInicial}" (esperado YYYY-MM).`)
  }
  const anoInicial = Number(match[1])
  const mesInicial = Number(match[2]) // 1..12

  const resultado: { competencia: string; dataVencimento: Date }[] = []
  for (let i = 0; i < meses; i++) {
    // deslocamento de i meses a partir do mês inicial
    const totalMeses = mesInicial - 1 + i // 0-indexado para facilitar a virada de ano
    const ano = anoInicial + Math.floor(totalMeses / 12)
    const mes = (totalMeses % 12) + 1 // 1..12
    const dia = Math.min(diaVencimento, ultimoDiaDoMes(ano, mes))
    const competencia = `${ano.toString().padStart(4, '0')}-${mes.toString().padStart(2, '0')}`
    resultado.push({ competencia, dataVencimento: new Date(ano, mes - 1, dia) })
  }
  return resultado
}

// ---------------------------------------------------------------------------
// Decisão central do guard de somente-leitura
// ---------------------------------------------------------------------------

/** Resultado da decisão do guard de somente-leitura. */
export type DecisaoBloqueio = 'PERMITIR' | 'BLOQUEAR_SOMENTE_LEITURA' | 'BLOQUEAR_INATIVADO'

/** Métodos HTTP considerados de escrita. */
const METODOS_ESCRITA = ['POST', 'PUT', 'PATCH', 'DELETE']

/**
 * Decisão central do guard, pura e testável. (Req 7.1/7.2/7.4, 9.2)
 *
 * - `INATIVADO`: bloqueia qualquer método (inclusive GET). (Req 9.2)
 * - `SOMENTE_LEITURA`: bloqueia escrita (POST/PUT/PATCH/DELETE), libera GET.
 *   (Req 7.1, 7.2)
 * - `ATIVO`: nunca bloqueia. (Req 7.4)
 */
export function decidirBloqueio(status: StatusFinanceiro, metodoHttp: string): DecisaoBloqueio {
  const ehEscrita = METODOS_ESCRITA.includes(metodoHttp.toUpperCase())
  if (status === 'INATIVADO') return 'BLOQUEAR_INATIVADO' // Req 9.2 (bloqueia tudo)
  if (status === 'SOMENTE_LEITURA' && ehEscrita) return 'BLOQUEAR_SOMENTE_LEITURA' // Req 7.1
  return 'PERMITIR' // Req 7.2 (GET) e 7.4 (ATIVO)
}
