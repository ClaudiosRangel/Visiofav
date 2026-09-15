/**
 * Financeiro D5 (Exportação Contábil) — geração de CSV do diário e do balancete
 * para importação em software contábil de mercado (Domínio/Fortes/Alterdata).
 * Núcleo puro (sem I/O). Formatação BR: separador ';', decimais com vírgula.
 */

export interface LinhaDiario {
  data: string // dd/mm/aaaa
  historico: string
  conta: string
  tipo: 'DEBITO' | 'CREDITO'
  valor: number
}

export interface LinhaBalancete {
  codigo: string
  nome: string
  debito: number
  credito: number
  saldo: number
}

const SEP = ';'

/** Formata número no padrão BR (vírgula decimal), 2 casas. */
function br(v: number): string {
  const n = Number(v)
  return (Number.isFinite(n) ? n : 0).toFixed(2).replace('.', ',')
}

/** Escapa um campo de texto para CSV (aspas se contiver separador/aspas/quebra). */
function campo(txt: string): string {
  const s = String(txt ?? '')
  if (s.includes(SEP) || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

/** CSV do diário: uma linha por partida. Sempre inclui o cabeçalho. */
export function diarioParaCsv(linhas: LinhaDiario[]): string {
  const cabecalho = ['Data', 'Historico', 'Conta', 'Tipo', 'Valor'].join(SEP)
  const corpo = linhas.map((l) =>
    [campo(l.data), campo(l.historico), campo(l.conta), l.tipo, br(l.valor)].join(SEP),
  )
  return [cabecalho, ...corpo].join('\r\n')
}

/** CSV do balancete: uma linha por conta. Sempre inclui o cabeçalho. */
export function balanceteParaCsv(linhas: LinhaBalancete[]): string {
  const cabecalho = ['Codigo', 'Conta', 'Debito', 'Credito', 'Saldo'].join(SEP)
  const corpo = linhas.map((l) =>
    [campo(l.codigo), campo(l.nome), br(l.debito), br(l.credito), br(l.saldo)].join(SEP),
  )
  return [cabecalho, ...corpo].join('\r\n')
}
