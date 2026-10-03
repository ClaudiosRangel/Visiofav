/**
 * Funções PURAS de de-para/normalização usadas pelo importador do Calcgraf
 * (`importar-calcgraf.ts`). Extraídas para um módulo próprio para poderem ser
 * testadas (property-based) SEM importar o script, que puxa o Prisma Client e
 * efeitos colaterais de conexão (steering: teste de lib pura não importa o
 * módulo pesado).
 *
 * As propriedades que sustentam a IDEMPOTÊNCIA e a NÃO-SOBRESCRITA do
 * importador dependem exclusivamente destas funções:
 *  - a chave de de-para (cpf/placeholder/nome) é determinística por linha;
 *  - o conjunto de "campos faltantes" nunca inclui um campo já preenchido.
 */

export function soDigitos(v: string | null | undefined): string {
  return (v || '').replace(/\D/g, '')
}

export function normalizarNome(v: string | null | undefined): string {
  return (v || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // tira acentos
    .toUpperCase().trim().replace(/\s+/g, ' ')
}

export function emailValido(v: string | null | undefined): string | null {
  const e = (v || '').trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null
}

/**
 * Deriva o `cpf` usado como chave única `[empresaId, cpf]` do Vendedor.
 * - Documento válido (11/14 dígitos) → o próprio CNPJ/CPF (trim, ≤14 chars).
 * - Sem documento → placeholder determinístico `SEM-DOC-<Codigo>` (≤14 chars).
 * Determinístico por linha: idempotência da 2ª execução depende disto.
 */
export function derivarCpfVendedor(cnpjCpf: string | null | undefined, codigo: number): string {
  const docDigitos = soDigitos(cnpjCpf)
  const temDoc = docDigitos.length === 11 || docDigitos.length === 14
  return temDoc ? (cnpjCpf as string).trim().slice(0, 14) : `SEM-DOC-${codigo}`.slice(0, 14)
}

/** True quando o documento é um CPF/CNPJ válido em comprimento (11 ou 14 dígitos). */
export function temDocumentoValido(cnpjCpf: string | null | undefined): boolean {
  const d = soDigitos(cnpjCpf).length
  return d === 11 || d === 14
}

/**
 * Campos de endereço do `novo` que devem ser gravados: SOMENTE os que estão
 * vazios no `existente`. Nunca inclui um campo já preenchido (não-sobrescrita).
 */
export function camposEnderecoVazios(
  existente: Record<string, unknown>,
  novo: Record<string, string | null | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of ['logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'cep'] as const) {
    const atual = existente[k]
    const nv = novo[k]
    if ((atual === null || atual === undefined || atual === '') && nv) out[k] = nv
  }
  return out
}

/**
 * Natureza de custo default de um acabamento, por nome (fase `acabamentos` do
 * importador). PURA/determinística. Valores de custo/tempo são calibrados na
 * tela depois (o Calcgraf não exporta tempos por atividade).
 *   caixa                   → MATERIAL_UN
 *   verniz | cola | laminaç → MATERIAL_KG
 *   faca | matriz           → CUSTO_FIXO
 *   demais                  → HORA_MAQUINA
 */
export function naturezaDefaultAcabamento(nome: string): string {
  const n = (nome || '').toLowerCase()
  if (/caixa/.test(n)) return 'MATERIAL_UN'
  // "cola" como material (cola branca) — mas NÃO "coladeira" (máquina de colar).
  if (/coladeira|colad/.test(n)) return 'HORA_MAQUINA'
  if (/verniz|cola|lamina/.test(n)) return 'MATERIAL_KG'
  if (/faca|matriz/.test(n)) return 'CUSTO_FIXO'
  return 'HORA_MAQUINA'
}

// ═══════════════════════════════════════════════════════════════════════════
// FASE SUPORTES — mapeamento PURO linha-origem (Calcgraf `Suportes`) → SuporteGrafico
// ═══════════════════════════════════════════════════════════════════════════
//
// Função PURA/isolada (sem I/O, sem Prisma) para permitir teste de propriedade
// sem banco (Property 1 e Property 3 da spec orcamento-grafico-suporte-fechamento).
// A fase `suportes` do importador (`importar-calcgraf.ts`) consome esta função
// para montar o objeto gravado em `SuporteGrafico` (de-para por código).

/** Objeto de domínio derivado de uma linha `Suportes` do Calcgraf, pronto
 * para gravar em `SuporteGrafico` (sem `empresaId`, que o importador injeta). */
export interface SuporteMapeado {
  codigo: string // `CG-SUP-<Codigo>`
  descricao: string
  coefTinta: number
  gramaturas: string | null // lista livre, ex.: "191,230,280"
  tipoSuporte: string // CARTAO | KRAFT | OFFSET | COUCHE | PAPELAO
}

/** Linha de origem da tabela `Suportes` do Calcgraf (campos usados). */
export interface SuporteOrigemRow {
  Codigo?: number | string | null
  Descricao?: string | null
  CoefTinta?: number | string | null
  Gramaturas?: number | string | null
  Formatos?: number | string | null
}

/** Resultado discriminado do mapeamento: `ok` com o suporte, ou motivo da exclusão. */
export type ResultadoMapeamentoSuporte =
  | { ok: true; suporte: SuporteMapeado }
  | { ok: false; motivo: string }

/** CoefTinta default quando ausente/inválido na origem (fator Stock SPANKS). */
export const COEF_TINTA_DEFAULT = 1.5

/**
 * Deriva o `tipoSuporte` por heurística a partir da descrição do suporte.
 * Ordem das regras importa: couro/papelão → PAPELAO antes de couchê, etc.
 *   kraft                       → KRAFT
 *   couch / couchê / couche     → COUCHE
 *   off-set / offset            → OFFSET
 *   papelão / papelao / couro   → PAPELAO
 *   (demais)                    → CARTAO
 */
export function derivarTipoSuporte(descricao: string | null | undefined): string {
  const n = (descricao || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // tira acentos (couchê→couche)
    .toLowerCase()
  if (/kraft/.test(n)) return 'KRAFT'
  if (/couch/.test(n)) return 'COUCHE'
  if (/off-?set/.test(n)) return 'OFFSET'
  if (/papelao|couro/.test(n)) return 'PAPELAO'
  return 'CARTAO'
}

/**
 * Converte uma gramatura/lista livre da origem numa string normalizada
 * ("191,230,280") ou `null` quando ausente/vazia. Preserva o conteúdo
 * (lista livre) apenas aparando espaços e vírgulas de borda.
 */
function normalizarGramaturas(v: number | string | null | undefined): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim().replace(/^[,;\s]+|[,;\s]+$/g, '')
  return s.length ? s : null
}

/**
 * Mapeia (PURO) uma linha da tabela `Suportes` do Calcgraf para o objeto de
 * `SuporteGrafico`. Retorna um resultado discriminado:
 *  - `{ ok: true, suporte }` quando a linha tem Codigo e Descricao válidos;
 *  - `{ ok: false, motivo }` quando falta Codigo ou Descricao (o chamador
 *    deve ignorar o registro e logar o motivo — Req 1.6).
 *
 * Regras (Req 1.2):
 *  - `codigo`      = `CG-SUP-<Codigo>`
 *  - `descricao`   = Descricao (trim)
 *  - `coefTinta`   = Number(CoefTinta), default 1,5 se ausente/inválido/≤0
 *  - `gramaturas`  = lista livre em string (pode ser null)
 *  - `tipoSuporte` = heurística por descrição (ver `derivarTipoSuporte`)
 */
export function mapearSuporte(linhaOrigem: SuporteOrigemRow): ResultadoMapeamentoSuporte {
  const codigoRaw = linhaOrigem?.Codigo
  // Codigo pode vir number ou string; 0/null/'' são inválidos.
  const codigoStr =
    codigoRaw === null || codigoRaw === undefined ? '' : String(codigoRaw).trim()
  if (!codigoStr) {
    return { ok: false, motivo: 'registro sem Codigo' }
  }

  const descricao = (linhaOrigem?.Descricao ?? '').toString().trim()
  if (!descricao) {
    return { ok: false, motivo: `registro ${codigoStr} sem Descricao` }
  }

  const coefNum = Number(linhaOrigem?.CoefTinta)
  const coefTinta = Number.isFinite(coefNum) && coefNum > 0 ? coefNum : COEF_TINTA_DEFAULT

  const suporte: SuporteMapeado = {
    codigo: `CG-SUP-${codigoStr}`,
    descricao,
    coefTinta,
    gramaturas: normalizarGramaturas(linhaOrigem?.Gramaturas),
    tipoSuporte: derivarTipoSuporte(descricao),
  }
  return { ok: true, suporte }
}
