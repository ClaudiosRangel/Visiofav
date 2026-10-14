/**
 * Hash de conteúdo de OP — ESPELHO EXATO do backend (Tarefa 10 / Requisito 2.2).
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️  ESPELHO BYTE-A-BYTE DO BACKEND — MANTER EM SINCRONIA                 ║
 * ║                                                                          ║
 * ║  Este arquivo é uma CÓPIA EXATA da normalização e do cálculo de hash de  ║
 * ║  OP implementados no backend do Vizor em:                                ║
 * ║    VisioFab.Wms.Back/src/modules/pcp/importador-calcgraf/                ║
 * ║        ingestao-op-calcgraf.pure.ts                                       ║
 * ║    (funções `normalizarOpParaHash` e `calcularHashOp`).                  ║
 * ║                                                                          ║
 * ║  A IDEMPOTÊNCIA da ingestão depende de os DOIS lados produzirem o MESMO   ║
 * ║  hash para a MESMA OP. O agente calcula o hash aqui e o envia como        ║
 * ║  `hashOrigem`; o backend recalcula e compara com o `hashImportacaoOrigem` ║
 * ║  salvo. Se as duas normalizações divergirem — mesmo em um único byte      ║
 * ║  (ordem de chaves, precisão numérica, trim, ordenação de arrays) — a      ║
 * ║  idempotência QUEBRA: toda sincronização reclassificaria OPs inalteradas  ║
 * ║  como "alteradas", gerando atualizações/pendências espúrias.             ║
 * ║                                                                          ║
 * ║  REGRA: qualquer mudança na normalização DEVE ser feita nos DOIS arquivos ║
 * ║  no MESMO commit, mantendo-os idênticos na lógica de normalização         ║
 * ║  (mesmas chaves, mesma ordem, mesma precisão, mesmo algoritmo sha256 hex).║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Depende apenas do módulo `crypto` nativo do Node — 100% determinístico e
 * portável (sem Prisma/Electron/IO).
 */

import { createHash } from 'node:crypto'

// Reusa o DTO do leitor do Calcgraf (que por sua vez espelha o DTO do backend),
// evitando uma terceira cópia das interfaces no agente.
import type {
  OpOrigemDTO,
  ItemOpOrigemDTO,
  EtapaOpOrigemDTO,
  LoteOpOrigemDTO,
} from '../calcgraf-reader/calcgraf-reader'

// Re-exporta o DTO para quem consome o change-detector não precisar conhecer o
// caminho do reader (conveniência; a definição canônica continua no reader).
export type { OpOrigemDTO, ItemOpOrigemDTO, EtapaOpOrigemDTO, LoteOpOrigemDTO }

// ---------------------------------------------------------------------------
// Normalização determinística — IDÊNTICA ao backend.
// ---------------------------------------------------------------------------

/** Casas decimais fixas para serializar números (evita 1 vs 1.0 vs 1.00). */
const PRECISAO_DECIMAL = 4

/**
 * Normaliza um valor escalar para a forma canônica (idêntico ao backend):
 *  - string → trim; vazia após trim vira null (equivale a ausente).
 *  - number → precisão fixa (toFixed) para eliminar divergências de formato;
 *    NaN/Infinity viram null (não representáveis de forma estável).
 *  - undefined/null → null (undefined e ausência de campo geram o mesmo hash).
 */
function normalizarEscalar(valor: unknown): string | number | boolean | null {
  if (valor === undefined || valor === null) return null
  if (typeof valor === 'string') {
    const t = valor.trim()
    return t.length === 0 ? null : t
  }
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) return null
    // Número com precisão fixa; parseFloat remove zeros à direita redundantes
    // mantendo o valor estável (ex.: 1, 1.0, 1.000 → mesma representação).
    return parseFloat(valor.toFixed(PRECISAO_DECIMAL))
  }
  if (typeof valor === 'boolean') return valor
  return null
}

/** Normaliza um item/componente para a forma canônica (campos ordenados). */
function normalizarItem(item: ItemOpOrigemDTO): Record<string, unknown> {
  return {
    item: normalizarEscalar(item.item),
    codItemEstoque: normalizarEscalar(item.codItemEstoque),
    descricao: normalizarEscalar(item.descricao),
    quantidade: normalizarEscalar(item.quantidade),
    unidadeMedida: normalizarEscalar(item.unidadeMedida),
    status: normalizarEscalar(item.status),
  }
}

/** Normaliza uma etapa/operação para a forma canônica. */
function normalizarEtapa(etapa: EtapaOpOrigemDTO): Record<string, unknown> {
  return {
    sequencia: normalizarEscalar(etapa.sequencia),
    centro: normalizarEscalar(etapa.centro),
    descricao: normalizarEscalar(etapa.descricao),
    status: normalizarEscalar(etapa.status),
  }
}

/** Normaliza um lote para a forma canônica. */
function normalizarLote(lote: LoteOpOrigemDTO): Record<string, unknown> {
  return {
    tiragem: normalizarEscalar(lote.tiragem),
    dataPrometida: normalizarEscalar(lote.dataPrometida),
    ordemFila: normalizarEscalar(lote.ordemFila),
    status: normalizarEscalar(lote.status),
  }
}

/**
 * Ordena uma lista de objetos já normalizados por uma chave estável (a própria
 * serialização JSON canônica). Garante ordem total e determinística mesmo
 * quando os campos naturais de ordenação estão ausentes/repetidos. IDÊNTICO ao
 * backend.
 */
function ordenarEstavel(itens: Record<string, unknown>[]): Record<string, unknown>[] {
  return [...itens].sort((a, b) => {
    const sa = JSON.stringify(a)
    const sb = JSON.stringify(b)
    if (sa < sb) return -1
    if (sa > sb) return 1
    return 0
  })
}

/**
 * Produz a representação canônica determinística do conteúdo relevante da OP.
 * IDÊNTICA ao backend: mesmas chaves, mesma ordem, mesma ordenação de arrays,
 * mesma precisão numérica. NÃO alterar sem alterar o backend no mesmo commit.
 */
export function normalizarOpParaHash(dto: OpOrigemDTO): string {
  const itensNorm = ordenarEstavel((dto.itens ?? []).map(normalizarItem))
  const etapasNorm = ordenarEstavel((dto.etapas ?? []).map(normalizarEtapa))
  const lotesNorm = ordenarEstavel((dto.lotes ?? []).map(normalizarLote))

  // Objeto canônico com chaves em ordem fixa e previsível (idêntico ao backend).
  const canonico = {
    numero: normalizarEscalar(dto.numero),
    descricao: normalizarEscalar(dto.descricao),
    dataEmissao: normalizarEscalar(dto.dataEmissao),
    produtoNome: normalizarEscalar(dto.produtoNome),
    produtoCodigo: normalizarEscalar(dto.produtoCodigo),
    clienteNome: normalizarEscalar(dto.clienteNome),
    quantidade: normalizarEscalar(dto.quantidade),
    dataEntrega: normalizarEscalar(dto.dataEntrega),
    tiragem: normalizarEscalar(dto.tiragem),
    itens: itensNorm,
    etapas: etapasNorm,
    lotes: lotesNorm,
  }

  return JSON.stringify(canonico)
}

/**
 * Retorna o sha256 (hex) da representação canônica da OP. Determinístico e
 * IDÊNTICO ao backend. Base da idempotência da ingestão (Property 1 /
 * Requisito 2.2).
 */
export function calcularHashOp(dto: OpOrigemDTO): string {
  const normalizado = normalizarOpParaHash(dto)
  return createHash('sha256').update(normalizado, 'utf8').digest('hex')
}
