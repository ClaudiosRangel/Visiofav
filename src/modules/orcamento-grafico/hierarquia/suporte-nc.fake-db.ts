/**
 * Banco em memória mínimo para os testes do Suporte NC (sem Postgres).
 * Implementa só o que `suporte-nc.service.ts` usa de `suporteGrafico`/`precoMateriaPrima` e uma
 * `$transaction` com rollback real (restaura o estado anterior quando o callback lança).
 */

export interface SuporteRow {
  id: string
  empresaId: string
  codigo: string
  descricao: string
  tipoSuporte: string
  coefTinta: number
  status: boolean
  [k: string]: unknown
}

export interface PrecoRow {
  id: string
  empresaId: string
  descricao: string
  tipo: string
  unidade: string
  precoUnitario: number
  suporteId: string | null
  gramatura: number | null
  status: boolean
  provisorio: boolean
  criadoEm: Date
  [k: string]: unknown
}

export const db = {
  suportes: [] as SuporteRow[],
  precos: [] as PrecoRow[],
  seq: 0,
  /** Quando preenchido, o próximo `precoMateriaPrima.create` lança este erro (simula falha no 2º passo). */
  falharNoPreco: null as Error | null,
  transacoes: 0,
}

export function resetar() {
  db.suportes = []
  db.precos = []
  db.seq = 0
  db.falharNoPreco = null
  db.transacoes = 0
}

const novoId = () => `00000000-0000-4000-8000-${String(++db.seq).padStart(12, '0')}`

function casa(valor: unknown, filtro: unknown): boolean {
  if (filtro && typeof filtro === 'object' && !(filtro instanceof Date)) {
    const f = filtro as Record<string, unknown>
    if ('in' in f) return (f.in as unknown[]).includes(valor)
    if ('not' in f) return valor !== f.not
  }
  return valor === filtro
}

function filtrar<T extends Record<string, any>>(rows: T[], where: Record<string, unknown> = {}): T[] {
  return rows.filter((r) => Object.entries(where).every(([k, v]) => casa(r[k], v)))
}

const suporteGrafico = {
  findMany: async ({ where }: any) => filtrar(db.suportes, where).map((r) => ({ ...r })),
  findFirst: async ({ where }: any) => {
    const r = filtrar(db.suportes, where)[0]
    return r ? { ...r } : null
  },
  create: async ({ data }: any) => {
    if (db.suportes.some((s) => s.empresaId === data.empresaId && s.codigo === data.codigo)) {
      throw new Error('Unique constraint failed on (empresa_id, codigo)')
    }
    const row = { id: novoId(), status: true, ...data } as SuporteRow
    db.suportes.push(row)
    return { id: row.id }
  },
}

const precoMateriaPrima = {
  findMany: async ({ where }: any) => filtrar(db.precos, where).map((r) => ({ ...r })),
  findFirst: async ({ where }: any) => {
    const r = filtrar(db.precos, where)[0]
    return r ? { ...r } : null
  },
  create: async ({ data }: any) => {
    if (db.falharNoPreco) throw db.falharNoPreco
    const row = { id: novoId(), status: true, provisorio: false, criadoEm: new Date(), ...data } as PrecoRow
    db.precos.push(row)
    return { id: row.id }
  },
}

const tx = { suporteGrafico, precoMateriaPrima }

export const prisma = {
  ...tx,
  $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => {
    db.transacoes++
    const suportes = db.suportes.map((r) => ({ ...r }))
    const precos = db.precos.map((r) => ({ ...r }))
    try {
      return await fn(tx)
    } catch (err) {
      db.suportes = suportes
      db.precos = precos
      throw err
    }
  },
}

/** Semeia um papel NC/legado já existente (suporte + preço) e devolve os ids. */
export function semear(opts: {
  empresaId: string
  nome: string
  gramatura: number
  provisorio?: boolean
  status?: boolean
  coefTinta?: number
  tipoSuporte?: string
}) {
  const suporte: SuporteRow = {
    id: novoId(),
    empresaId: opts.empresaId,
    codigo: `SEED-${db.seq}`,
    descricao: opts.nome,
    tipoSuporte: opts.tipoSuporte ?? 'CARTAO',
    coefTinta: opts.coefTinta ?? 1.5,
    status: opts.status ?? true,
  }
  db.suportes.push(suporte)
  const preco: PrecoRow = {
    id: novoId(),
    empresaId: opts.empresaId,
    descricao: opts.nome,
    tipo: 'PAPEL',
    unidade: 'KG',
    precoUnitario: 7.45,
    suporteId: suporte.id,
    gramatura: opts.gramatura,
    status: opts.status ?? true,
    provisorio: opts.provisorio ?? false,
    criadoEm: new Date(),
  }
  db.precos.push(preco)
  return { suporteId: suporte.id, precoId: preco.id }
}
