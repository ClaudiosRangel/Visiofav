/**
 * SKU sob demanda — NÚCLEO PURO (sem Prisma), para testes rápidos.
 *
 * As funções aqui não importam nada do runtime pesado (Prisma/Capacitor), de
 * modo que o teste property-based carregue instantaneamente (padrão do projeto:
 * teste de lib pura não deve puxar o Prisma Client). O service de persistência
 * (`sku-sob-demanda.service.ts`) reexporta e usa estas funções.
 */

export const PREFIXO_SKU = 'GRAF-'

/**
 * Gera o próximo código de SKU gráfico único por empresa, no formato
 * `GRAF-NNNN` (sequencial), a partir dos códigos já existentes. PURA.
 * Considera só os que seguem `<prefixo><número>`; ignora o resto.
 */
export function gerarCodigoSku(codigosExistentes: string[], prefixo = PREFIXO_SKU): string {
  let maior = 0
  const re = new RegExp(`^${prefixo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`)
  for (const c of codigosExistentes) {
    const m = String(c ?? '').match(re)
    if (m) {
      const n = parseInt(m[1], 10)
      if (Number.isFinite(n) && n > maior) maior = n
    }
  }
  return `${prefixo}${String(maior + 1).padStart(4, '0')}`
}

/** Dados mínimos do item/orçamento necessários para montar o SKU. */
export interface DadosParaSku {
  descricao: string | null
  unidade?: string | null
  ncm?: string | null
  cfopEstadual?: string | null
  cfopInterest?: string | null
  cst?: string | null
  csosn?: string | null
}

/** Payload (puro) do `Produto` a criar para um item gráfico. */
export interface ProdutoSkuPayload {
  empresaId: string
  codigo: string
  nome: string
  descricao: string | null
  unidade: string
  classificacaoPcp: 'PRODUTO_ACABADO'
  ncm: string | null
  cfopEstadual: string | null
  cfopInterest: string | null
  cst: string | null
  csosn: string | null
  status: boolean
}

/**
 * Monta o payload do SKU a partir dos dados do item/orçamento. PURA.
 * `nome` truncado a 200 (schema); unidade default `UN` (máx 6).
 */
export function montarProdutoDoCalculo(
  empresaId: string,
  codigo: string,
  dados: DadosParaSku,
): ProdutoSkuPayload {
  const nome = (dados.descricao || 'Produto gráfico').trim().slice(0, 200)
  return {
    empresaId,
    codigo,
    nome,
    descricao: dados.descricao ?? null,
    unidade: (dados.unidade || 'UN').slice(0, 6),
    classificacaoPcp: 'PRODUTO_ACABADO',
    ncm: dados.ncm ?? null,
    cfopEstadual: dados.cfopEstadual ?? null,
    cfopInterest: dados.cfopInterest ?? null,
    cst: dados.cst ?? null,
    csosn: dados.csosn ?? null,
    status: true,
  }
}
