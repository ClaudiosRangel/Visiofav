/**
 * Linha de Produto da OP (usada para colorir o Gantt).
 *
 * FONTE HOJE: o campo "Produto:" do cabeçalho do PDF do GPrint/Calcgraf
 * (ex.: "Cartuchos", "Cartucho Composto", "Impressos"), gravado na tag
 * `[Linha]` de `OrdemProducao.observacoes` (mesmo padrão das outras tags, sem
 * mudança de schema). Esse campo é o "Produto" do Calcgraf, que corresponde
 * às Linhas de Produto do orçamento (CARTUCHO, CARTUCHO COMPOSTO, LÂMINA
 * SIMPLES, LÂMINAS, SACOLA).
 *
 * ROADMAP: quando as OPs nascerem direto do sistema (agente Calcgraf com
 * `_LinhasProduto.Nome` ou OP gerada pelo orçamento do Vizor, que já conhece a
 * linha), gravar a linha real em campo próprio e deixar de depender do PDF.
 * Ver `.kiro/steering/pcp-modulo.md` seção 19.
 *
 * Funções PURAS (sem Prisma).
 */

export interface LinhaProduto {
  /** Código estável (usado para cor/filtro). Ex.: CARTUCHO, CARTUCHO_COMPOSTO. */
  codigo: string
  /** Rótulo para exibição. */
  rotulo: string
}

function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/**
 * Classifica o texto do campo "Produto:" do PDF em uma Linha de Produto.
 * Valores desconhecidos (ex.: "Caixa", "Cartelas") viram uma linha própria
 * com código derivado do texto, para ainda terem cor/legenda estáveis.
 */
export function classificarLinhaProduto(texto: string | null | undefined): LinhaProduto | null {
  const bruto = (texto ?? '').trim()
  if (!bruto) return null
  const t = semAcento(bruto).toLowerCase()

  if (/cartucho/.test(t) && /composto/.test(t)) return { codigo: 'CARTUCHO_COMPOSTO', rotulo: 'Cartucho Composto' }
  if (/cartucho/.test(t)) return { codigo: 'CARTUCHO', rotulo: 'Cartucho' }
  if (/sacola/.test(t)) return { codigo: 'SACOLA', rotulo: 'Sacola' }
  // "Impressos" e "Venda de Cartão" são produtos da linha Lâmina Simples.
  if (/lamina\s+simples|impresso|venda\s+de\s+cartao/.test(t)) return { codigo: 'LAMINA_SIMPLES', rotulo: 'Lâmina Simples' }
  if (/lamina/.test(t)) return { codigo: 'LAMINAS', rotulo: 'Lâminas' }

  const codigo = semAcento(bruto).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return codigo ? { codigo, rotulo: bruto } : null
}

/** Lê a tag `[Linha]` das observações da OP e a classifica. */
export function extrairLinhaObs(obs: string | null | undefined): LinhaProduto | null {
  if (!obs) return null
  const m = obs.match(/\[Linha\]\s*(.+?)(?:\n|$)/)
  return m ? classificarLinhaProduto(m[1]) : null
}
