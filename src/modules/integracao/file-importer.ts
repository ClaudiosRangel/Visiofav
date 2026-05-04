/**
 * Parser CSV genérico com validação
 */

export interface ImportResult {
  totalLinhas: number
  importadas: number
  rejeitadas: number
  erros: Array<{ linha: number; campo: string; mensagem: string }>
}

export function parseCSV(content: string): Array<Record<string, string>> {
  const lines = content.trim().split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length < 2) return []

  const headers = lines[0].split(',').map((h) => h.trim())
  const rows: Array<Record<string, string>> = []

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map((v) => v.trim())
    const row: Record<string, string> = {}
    headers.forEach((h, idx) => { row[h] = values[idx] || '' })
    rows.push(row)
  }

  return rows
}

export const TEMPLATES: Record<string, string> = {
  'notas-entrada': 'fornecedor_cnpj,numero_nota,serie,produto_codigo,quantidade,preco_unitario,data_entrega\n11111111000100,12345,1,PROD001,100,25.90,2026-05-15',
  'pedidos-separacao': 'cliente_cpf_cnpj,produto_codigo,quantidade\n22222222000100,PROD001,50',
  'produtos': 'codigo,nome,unidade,preco_base,ncm\nPROD001,Produto Exemplo,UN,25.90,10063021',
}
