// Funções PURAS da spec orcamento-grafico-suporte-fechamento.
//
// Este módulo isola, SEM dependência de banco/rede, a LÓGICA DE DECISÃO que
// hoje vive inline nas rotas (`orcamento-grafico.routes.ts`):
//   • montagem da cláusula `where` de `GET /precos-mp` (filtro por suporteId/tipo);
//   • a DECISÃO de bloqueio por pré-condição de `validarPreCondicoesCalculo`
//     (a consulta ao banco fica na rota; a decisão vira pura e testável);
//   • o filtro de isolamento multi-tenant por `empresaId` dos cadastros.
//
// Objetivo: permitir testes de propriedade (fast-check) sobre lógica pura,
// alinhado às Properties 5, 6 e 9 do design — sem tocar na rota (aditivo).

// ────────────────────────────────────────────────────────────────────────────
// Property 5 — Filtro de preços por suporte (GET /precos-mp)
// ────────────────────────────────────────────────────────────────────────────

/** Parâmetros de filtro aceitos por `GET /precos-mp` (subconjunto relevante). */
export interface ParamsWherePrecos {
  empresaId: string
  tipo?: string
  suporteId?: string
  status?: boolean
}

/** Cláusula `where` resultante (espelha o objeto montado na rota). */
export interface WherePrecos {
  empresaId: string
  tipo?: string
  suporteId?: string
  status?: boolean
}

/**
 * Monta a cláusula `where` de `GET /precos-mp` a partir dos filtros.
 * SEMPRE filtra por `empresaId` (isolamento multi-tenant). `tipo`, `suporteId`
 * e `status` só entram no `where` quando informados.
 */
export function montarWherePrecos(params: ParamsWherePrecos): WherePrecos {
  const where: WherePrecos = { empresaId: params.empresaId }
  if (params.tipo) where.tipo = params.tipo
  if (params.suporteId) where.suporteId = params.suporteId
  if (params.status !== undefined) where.status = params.status
  return where
}

/** Registro mínimo de preço de matéria-prima para filtragem em memória. */
export interface PrecoLike {
  empresaId: string
  tipo: string
  suporteId?: string | null
  status?: boolean
}

/**
 * Aplica a cláusula `where` a um array em memória, com a MESMA semântica do
 * Prisma: igualdade exata em cada campo presente no `where`. Usado nos testes
 * para verificar que o filtro só retorna registros com o `suporteId` pedido
 * (e, com `tipo=PAPEL`, só papéis).
 */
export function aplicarWherePrecos<T extends PrecoLike>(itens: T[], where: WherePrecos): T[] {
  return itens.filter((it) => {
    if (it.empresaId !== where.empresaId) return false
    if (where.tipo !== undefined && it.tipo !== where.tipo) return false
    if (where.suporteId !== undefined && (it.suporteId ?? null) !== where.suporteId) return false
    if (where.status !== undefined && (it.status ?? true) !== where.status) return false
    return true
  })
}

// ────────────────────────────────────────────────────────────────────────────
// Property 6 — Bloqueio por pré-condição ausente (/calcular, POST /)
// ────────────────────────────────────────────────────────────────────────────

export const MSG_SUPORTE_SEM_PRECO =
  'Suporte sem preço de material vinculado — vincule um preço ao suporte antes de calcular'
export const MSG_SEM_PARAMETRO_PERDA =
  'Nenhum Parâmetro de Perda cadastrado — cadastre a perda do processo antes de calcular'

/**
 * Fatos consultados no banco pela rota, reduzidos ao que a DECISÃO precisa:
 *   • suporteTemPrecoPapel: o Suporte do papel escolhido possui ao menos um
 *     PrecoMateriaPrima de tipo PAPEL vinculado. (true quando o papel NÃO tem
 *     suporte — nesse caso o Req 2.4 não se aplica e não bloqueia.)
 *   • temParametroPerda: existe ao menos um ParametroPerda para a empresa.
 */
export interface FatosPreCondicao {
  suporteTemPrecoPapel: boolean
  temParametroPerda: boolean
}

/** Resultado da decisão de pré-condição. */
export interface DecisaoPreCondicao {
  bloqueia: boolean
  mensagem?: string
}

/**
 * Decisão PURA de bloqueio por pré-condição (Req 2.4 e 5.4).
 *   (a) Suporte sem preço PAPEL vinculado → bloqueia (MSG_SUPORTE_SEM_PRECO).
 *   (b) Nenhum ParametroPerda cadastrado → bloqueia (MSG_SEM_PARAMETRO_PERDA).
 * A ordem segue a rota: a verificação de suporte vem antes.
 * Quando ambas as pré-condições estão satisfeitas, não bloqueia.
 */
export function decidirPreCondicaoCalculo(fatos: FatosPreCondicao): DecisaoPreCondicao {
  if (!fatos.suporteTemPrecoPapel) {
    return { bloqueia: true, mensagem: MSG_SUPORTE_SEM_PRECO }
  }
  if (!fatos.temParametroPerda) {
    return { bloqueia: true, mensagem: MSG_SEM_PARAMETRO_PERDA }
  }
  return { bloqueia: false }
}

// ────────────────────────────────────────────────────────────────────────────
// Property 9 — Isolamento multi-tenant dos cadastros
// ────────────────────────────────────────────────────────────────────────────

/** Qualquer cadastro multi-tenant tem ao menos `empresaId`. */
export interface RegistroTenant {
  empresaId: string
}

/**
 * Filtra registros de um cadastro (SuporteGrafico/TabelaMargem/ParametroPerda)
 * pelo `empresaId` — reproduz o `where: { empresaId }` que toda rota aplica.
 * Garante que o contexto da empresa A nunca enxerga dados da empresa B.
 */
export function filtrarPorEmpresa<T extends RegistroTenant>(itens: T[], empresaId: string): T[] {
  return itens.filter((it) => it.empresaId === empresaId)
}
