/**
 * Resolução de binding + formatação (núcleo PURO — sem Prisma, sem pdfkit).
 * Spec comercial-editor-visual-templates.
 *
 * A MESMA especificação é implementada igual no frontend
 * (src/lib/comercial/template-visual/binding-resolver.ts). É o ponto mais
 * testável por property-based testing (Properties 4, 5, 6).
 */

/** Dados reais disponíveis na geração do documento. */
export interface ContextoGeracao {
  cliente: { nome?: string | null; cnpj?: string | null; contato?: string | null; email?: string | null }
  empresa: { razaoSocial?: string | null; cnpj?: string | null; telefone?: string | null; email?: string | null }
  orcamento: {
    numero?: number | null
    versao?: number | null
    precoVenda?: number | null
    precoUnitario?: number | null
    quantidade?: number | null
    validadeAte?: Date | null
    criadoEm?: Date | null
    condicaoPagamento?: string | null
    vendedorNome?: string | null
    imposto?: string | null
    [k: string]: unknown
  }
  itens: Array<{ descricao: string; quantidade: number; precoUnitario: number; precoTotal: number }>
  variacoes: Array<{ quantidade: number; precoUnitario: number; precoTotal: number }>
}

export interface ResultadoBinding {
  texto?: string
  vazio?: boolean
  aviso?: string
}

/** Caminhos cujo valor é monetário (formatados em R$). */
const CAMINHOS_MONETARIOS = new Set<string>([
  'orcamento.precoVenda',
  'orcamento.precoUnitario',
])

/** Formata número no padrão de moeda brasileiro: "R$ 1.234,56". */
export function formatarMoeda(valor: number): string {
  const n = Number.isFinite(valor) ? valor : 0
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/** Formata data no padrão "dd/mm/aaaa". */
export function formatarData(data: Date): string {
  const d = data instanceof Date ? data : new Date(data)
  if (isNaN(d.getTime())) return ''
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const aaaa = d.getFullYear()
  return `${dd}/${mm}/${aaaa}`
}

/** Remove os delimitadores {{ }} e espaços do binding, se presentes. */
function limparCaminho(bindingBruto: string): string {
  return bindingBruto.replace(/^\s*\{\{\s*/, '').replace(/\s*\}\}\s*$/, '').trim()
}

/** Navega um objeto por caminho pontilhado (ex.: "cliente.nome"). */
function navegar(ctx: ContextoGeracao, caminho: string): unknown {
  const partes = caminho.split('.')
  let atual: unknown = ctx
  for (const p of partes) {
    if (atual == null || typeof atual !== 'object') return undefined
    atual = (atual as Record<string, unknown>)[p]
  }
  return atual
}

/**
 * Resolve um binding ESCALAR a partir do contexto. Nunca lança (Req 3.4).
 * - presente → { texto } (monetário/data já formatados — Req 3.5)
 * - ausente/null → { vazio: true, aviso }
 */
export function resolverBinding(bindingBruto: string, ctx: ContextoGeracao): ResultadoBinding {
  try {
    const caminho = limparCaminho(String(bindingBruto ?? ''))
    if (!caminho) return { vazio: true, aviso: 'Binding vazio' }
    const valor = navegar(ctx, caminho)
    if (valor === undefined || valor === null || valor === '') {
      return { vazio: true, aviso: `Binding não encontrado: ${caminho}` }
    }
    if (CAMINHOS_MONETARIOS.has(caminho)) {
      return { texto: formatarMoeda(Number(valor)) }
    }
    if (valor instanceof Date) {
      return { texto: formatarData(valor) }
    }
    return { texto: String(valor) }
  } catch {
    // Blindagem: qualquer erro inesperado não interrompe a geração.
    return { vazio: true, aviso: 'Binding inválido' }
  }
}

/** Linha de tabela resolvida: valores já formatados por coluna (binding → texto). */
export type LinhaTabela = string[]

/**
 * Resolve as linhas de uma TABELA a partir da fonte de dados do contexto.
 * `bindings` são os caminhos RELATIVOS a cada linha (ex.: "quantidade",
 * "precoTotal"). Valores monetários conhecidos (precoUnitario/precoTotal) são
 * formatados em R$; quantidade usa separador de milhar pt-BR.
 */
export function resolverTabela(
  fonteDados: 'itens' | 'variacoes',
  bindings: string[],
  ctx: ContextoGeracao,
): LinhaTabela[] {
  const linhas = fonteDados === 'itens' ? ctx.itens : ctx.variacoes
  if (!Array.isArray(linhas)) return []
  return linhas.map((linha) =>
    bindings.map((b) => {
      const chave = limparCaminho(b)
      const v = (linha as Record<string, unknown>)[chave]
      if (v === undefined || v === null) return ''
      if (chave === 'precoUnitario' || chave === 'precoTotal') return formatarMoeda(Number(v))
      if (chave === 'quantidade') return Number(v).toLocaleString('pt-BR')
      return String(v)
    }),
  )
}
