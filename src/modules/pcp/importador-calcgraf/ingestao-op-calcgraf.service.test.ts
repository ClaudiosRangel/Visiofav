/**
 * Teste de integração da ingestão de OPs do Calcgraf (Tarefa 7 do spec
 * `importador-op-calcgraf`).
 *
 * Cobre as três propriedades de correção do design relevantes à ingestão:
 *  - Property 2 / Req 8.1 — Idempotência: enviar o MESMO payload (mesmo numero
 *    + mesmo conteúdo) duas vezes resulta em exatamente UMA `OrdemProducao`
 *    (`'criada'` na 1ª, `'ignorada'` na 2ª).
 *  - Property 4 / Req 5.2 — Não-regressão de produção: OP existente COM produção
 *    e conteúdo alterado → `'pendente'`, OP NÃO sobrescrita, uma
 *    `AlteracaoOpPendente` criada.
 *  - Property 5 / Req 6.2 — Isolamento multi-tenant: a OP é gravada sob a
 *    `empresaId` passada; ingerir a mesma referência numa empresa B não enxerga
 *    nem colide com a OP da empresa A.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ABORDAGEM: mock do Prisma (NÃO banco real).
 *
 * O Postgres local está indisponível nesta máquina (serviço parado, sem
 * privilégio de admin para iniciá-lo), então um teste que grave de verdade via
 * Prisma não roda aqui. Seguimos o padrão JÁ ESTABELECIDO no projeto para
 * testar serviços-Prisma sem banco real: `vi.mock('../../../lib/prisma', ...)`
 * (mesmo padrão de `pcp-wms-integration.service.test.ts`, `fiscal/**`, etc.).
 *
 * Em vez de um mock "burro" (que só verifica chamadas), montamos um FAKE de
 * banco em memória: um `Map` de `OrdemProducao` chaveado por
 * `empresaId|referenciaExterna`, mais listas de `AlteracaoOpPendente`,
 * `ItemOrdemProducao`, `EtapaOrdemProducao` e `LogOrdemProducao`. Os models
 * mockados (`findFirst`/`create`/`update`/`count`/`deleteMany`/`findMany`) leem
 * e escrevem nesse estado, e `$transaction(cb)` apenas executa `cb(prisma)`.
 * Isso permite exercitar a LÓGICA DE DECISÃO real do serviço ponta a ponta
 * (incluindo a persistência simulada e o isolamento por `empresaId`), não só
 * assertar chamadas.
 *
 * Limitação assumida (documentada): o fake implementa só o subconjunto do
 * contrato do Prisma que o serviço usa, com a semântica mínima de filtragem por
 * `empresaId`/`ordemProducaoId`/`status` necessária às três propriedades. Não é
 * um Postgres — não valida SQL, constraints, transações reais ou tipos Decimal.
 * O comportamento transacional é simulado (sem rollback real), o que é
 * suficiente para as propriedades testadas (nenhuma delas depende de rollback).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ───────────────────────────────────────────────────────────────────────────
// Fake de "banco" em memória + mock do Prisma.
// Precisa ser declarado ANTES do import do serviço (hoisting do vi.mock).
// ───────────────────────────────────────────────────────────────────────────

interface FakeOp {
  id: string
  empresaId: string
  numero: number
  status: string
  referenciaExterna: string | null
  origemImportacao: string | null
  hashImportacaoOrigem: string | null
  observacoes?: string | null
  quantidade?: number
}

interface FakePendente {
  id: string
  empresaId: string
  ordemProducaoId: string
  numeroOrigem: string
  hashOrigem: string
  payloadJson: unknown
  status: string
  resolvidoPorId?: string | null
  resolvidoEm?: Date | null
}

interface FakeItem {
  id: string
  ordemProducaoId: string
  empresaId: string
  descricaoProduto: string
  produtoComponenteId?: string | null
}

interface FakeEtapa {
  id: string
  ordemProducaoId: string
  status: string
}

/** Estado do "banco" fake, resetado a cada teste. */
const db = {
  ops: [] as FakeOp[],
  pendentes: [] as FakePendente[],
  itens: [] as FakeItem[],
  etapas: [] as FakeEtapa[],
  apontEtapa: [] as { etapaOrdemProducaoId: string }[],
  apontProd: [] as { ordemProducaoId: string }[],
  logs: [] as unknown[],
  seq: 0,
}

function novoId(prefix: string): string {
  db.seq += 1
  return `${prefix}-${db.seq}`
}

/** Verifica se um registro casa com um `where` simples (igualdade rasa + in). */
function casa(registro: Record<string, unknown>, where: Record<string, unknown>): boolean {
  for (const [chave, cond] of Object.entries(where)) {
    const valor = registro[chave]
    if (cond !== null && typeof cond === 'object' && 'in' in (cond as object)) {
      const lista = (cond as { in: unknown[] }).in
      if (!lista.includes(valor)) return false
    } else if (valor !== cond) {
      return false
    }
  }
  return true
}

/**
 * Mock do Prisma. Os models implementam só o que o serviço usa. `$transaction`
 * executa o callback passando o próprio mock como client transacional (`tx`).
 */
vi.mock('../../../lib/prisma', () => {
  const prismaMock: Record<string, unknown> = {
    ordemProducao: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        // Suporta ordenação por numero desc (próximo número sequencial).
        const encontrados = db.ops.filter((o) => casa(o as unknown as Record<string, unknown>, where))
        return encontrados.sort((a, b) => b.numero - a.numero)[0] ?? null
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const op: FakeOp = {
          id: novoId('op'),
          empresaId: data.empresaId as string,
          numero: data.numero as number,
          status: data.status as string,
          referenciaExterna: (data.referenciaExterna as string) ?? null,
          origemImportacao: (data.origemImportacao as string) ?? null,
          hashImportacaoOrigem: (data.hashImportacaoOrigem as string) ?? null,
          observacoes: (data.observacoes as string) ?? null,
          quantidade: data.quantidade as number,
        }
        db.ops.push(op)
        return op
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const op = db.ops.find((o) => o.id === where.id)
        if (!op) throw new Error('OP não encontrada no fake')
        Object.assign(op, data)
        return op
      }),
    },
    itemOrdemProducao: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const item: FakeItem = {
          id: novoId('item'),
          ordemProducaoId: data.ordemProducaoId as string,
          empresaId: data.empresaId as string,
          descricaoProduto: data.descricaoProduto as string,
          produtoComponenteId: (data.produtoComponenteId as string) ?? null,
        }
        db.itens.push(item)
        return item
      }),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        db.itens.filter((i) => casa(i as unknown as Record<string, unknown>, where)),
      ),
      deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const antes = db.itens.length
        db.itens = db.itens.filter((i) => !casa(i as unknown as Record<string, unknown>, where))
        return { count: antes - db.itens.length }
      }),
    },
    etapaOrdemProducao: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const etapa: FakeEtapa = {
          id: novoId('etapa'),
          ordemProducaoId: data.ordemProducaoId as string,
          status: data.status as string,
        }
        db.etapas.push(etapa)
        return etapa
      }),
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        db.etapas.filter((e) => casa(e as unknown as Record<string, unknown>, where)).length,
      ),
      deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const antes = db.etapas.length
        db.etapas = db.etapas.filter((e) => !casa(e as unknown as Record<string, unknown>, where))
        return { count: antes - db.etapas.length }
      }),
    },
    apontamentoEtapa: {
      // where: { etapaOrdemProducao: { ordemProducaoId } } — resolve via etapas do fake.
      count: vi.fn(async ({ where }: { where: { etapaOrdemProducao?: { ordemProducaoId?: string } } }) => {
        const opId = where?.etapaOrdemProducao?.ordemProducaoId
        if (!opId) return db.apontEtapa.length
        const etapasDaOp = new Set(db.etapas.filter((e) => e.ordemProducaoId === opId).map((e) => e.id))
        return db.apontEtapa.filter((a) => etapasDaOp.has(a.etapaOrdemProducaoId)).length
      }),
    },
    apontamentoProducao: {
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        db.apontProd.filter((a) => casa(a as unknown as Record<string, unknown>, where)).length,
      ),
    },
    alteracaoOpPendente: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        db.pendentes.find((p) => casa(p as unknown as Record<string, unknown>, where)) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const pend: FakePendente = {
          id: novoId('pend'),
          empresaId: data.empresaId as string,
          ordemProducaoId: data.ordemProducaoId as string,
          numeroOrigem: data.numeroOrigem as string,
          hashOrigem: data.hashOrigem as string,
          payloadJson: data.payloadJson,
          status: data.status as string,
        }
        db.pendentes.push(pend)
        return pend
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const pend = db.pendentes.find((p) => p.id === where.id)
        if (!pend) throw new Error('Pendência não encontrada no fake')
        Object.assign(pend, data)
        return pend
      }),
    },
    logOrdemProducao: {
      create: vi.fn(async ({ data }: { data: unknown }) => {
        db.logs.push(data)
        return data
      }),
    },
    // $transaction executa o callback com o próprio mock como `tx`.
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(prismaMock)),
  }
  return { prisma: prismaMock }
})

import { ingerirOpsCalcgraf } from './ingestao-op-calcgraf.service'
import type { OpOrigemDTO } from './ingestao-op-calcgraf.pure'

// ───────────────────────────────────────────────────────────────────────────
// Helpers de teste
// ───────────────────────────────────────────────────────────────────────────

const EMPRESA_A = 'empresa-a-id'
const EMPRESA_B = 'empresa-b-id'

/** Payload-base de uma OP de origem. */
function op(numero: number, overrides: Partial<OpOrigemDTO> = {}): OpOrigemDTO {
  return {
    numero,
    descricao: `OP de teste ${numero}`,
    clienteNome: 'Cliente Teste Ltda',
    produtoNome: 'Caixa de Papelão',
    quantidade: 1000,
    dataEmissao: '2026-01-10T00:00:00.000Z',
    ...overrides,
  }
}

/** Conta as OPs do fake pertencentes a uma empresa com uma referência externa. */
function opsDaEmpresa(empresaId: string, referenciaExterna: string): FakeOp[] {
  return db.ops.filter(
    (o) =>
      o.empresaId === empresaId &&
      o.referenciaExterna === referenciaExterna &&
      o.origemImportacao === 'AGENTE_CALCGRAF',
  )
}

beforeEach(() => {
  db.ops = []
  db.pendentes = []
  db.itens = []
  db.etapas = []
  db.apontEtapa = []
  db.apontProd = []
  db.logs = []
  db.seq = 0
  vi.clearAllMocks()
})

// ───────────────────────────────────────────────────────────────────────────
// Property 2 / Req 8.1 — Idempotência
// ───────────────────────────────────────────────────────────────────────────

describe('ingerirOpsCalcgraf — idempotência (Property 2 / Req 8.1)', () => {
  it('mesmo payload enviado 2× → 1ª "criada", 2ª "ignorada", e apenas UMA OrdemProducao criada', async () => {
    const payload = op(2870)

    const primeira = await ingerirOpsCalcgraf(EMPRESA_A, [payload])
    expect(primeira).toEqual([{ numero: 2870, resultado: 'criada' }])

    // Reenvio do MESMO conteúdo (mesmo numero + mesmo payload).
    const segunda = await ingerirOpsCalcgraf(EMPRESA_A, [payload])
    expect(segunda).toEqual([{ numero: 2870, resultado: 'ignorada' }])

    // Apenas UMA OP para aquele numero/empresa.
    expect(opsDaEmpresa(EMPRESA_A, '2870')).toHaveLength(1)
  })

  it('conteúdo alterado (mesmo numero) numa OP SEM produção → "atualizada", sem duplicar OP', async () => {
    await ingerirOpsCalcgraf(EMPRESA_A, [op(3001, { quantidade: 1000 })])

    // Mesma OP (numero 3001) com conteúdo diferente → hash muda → atualiza.
    const r = await ingerirOpsCalcgraf(EMPRESA_A, [op(3001, { quantidade: 2500 })])
    expect(r).toEqual([{ numero: 3001, resultado: 'atualizada' }])

    const ops = opsDaEmpresa(EMPRESA_A, '3001')
    expect(ops).toHaveLength(1)
    expect(ops[0].quantidade).toBe(2500) // quantidade atualizada, OP não duplicada
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Property 4 / Req 5.2 — Não-regressão de produção (pendente)
// ───────────────────────────────────────────────────────────────────────────

describe('ingerirOpsCalcgraf — não-regressão de produção (Property 4 / Req 5.2)', () => {
  it('OP com produção + conteúdo alterado → "pendente", OP NÃO sobrescrita e uma AlteracaoOpPendente criada', async () => {
    // 1ª ingestão cria a OP.
    await ingerirOpsCalcgraf(EMPRESA_A, [op(3100, { quantidade: 1000 })])
    const criada = opsDaEmpresa(EMPRESA_A, '3100')[0]
    const quantidadeOriginal = criada.quantidade
    const hashOriginal = criada.hashImportacaoOrigem

    // Simula produção na OP: uma etapa EM_ANDAMENTO (bloqueia sobrescrita).
    db.etapas.push({ id: 'etapa-prod', ordemProducaoId: criada.id, status: 'EM_ANDAMENTO' })

    // Novo conteúdo chega do Calcgraf (hash muda).
    const r = await ingerirOpsCalcgraf(EMPRESA_A, [op(3100, { quantidade: 9999 })])
    expect(r[0].resultado).toBe('pendente')

    // A OP NÃO foi sobrescrita (quantidade e hash preservados).
    const depois = opsDaEmpresa(EMPRESA_A, '3100')
    expect(depois).toHaveLength(1)
    expect(depois[0].quantidade).toBe(quantidadeOriginal)
    expect(depois[0].hashImportacaoOrigem).toBe(hashOriginal)

    // Uma AlteracaoOpPendente foi criada para aquela OP.
    const pendentes = db.pendentes.filter(
      (p) => p.ordemProducaoId === criada.id && p.status === 'PENDENTE' && p.empresaId === EMPRESA_A,
    )
    expect(pendentes).toHaveLength(1)
    expect(pendentes[0].numeroOrigem).toBe('3100')
  })

  it('reenvio idêntico de OP com produção → "ignorada" (não cria nova pendência)', async () => {
    await ingerirOpsCalcgraf(EMPRESA_A, [op(3101)])
    const criada = opsDaEmpresa(EMPRESA_A, '3101')[0]
    db.apontProd.push({ ordemProducaoId: criada.id }) // produção via apontamento de OP

    // Mesmo payload de novo: hash igual → ignorada (idempotência tem precedência).
    const r = await ingerirOpsCalcgraf(EMPRESA_A, [op(3101)])
    expect(r[0].resultado).toBe('ignorada')
    expect(db.pendentes).toHaveLength(0)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Property 5 / Req 6.2 — Isolamento multi-tenant
// ───────────────────────────────────────────────────────────────────────────

describe('ingerirOpsCalcgraf — isolamento multi-tenant (Property 5 / Req 6.2)', () => {
  it('a OP é gravada sob a empresaId passada', async () => {
    await ingerirOpsCalcgraf(EMPRESA_A, [op(4000)])

    const ops = opsDaEmpresa(EMPRESA_A, '4000')
    expect(ops).toHaveLength(1)
    expect(ops[0].empresaId).toBe(EMPRESA_A)
  })

  it('mesma referência (numero) em empresas diferentes NÃO colide: cada empresa tem a sua OP', async () => {
    // Empresa A ingere a OP 4100.
    const rA = await ingerirOpsCalcgraf(EMPRESA_A, [op(4100)])
    expect(rA).toEqual([{ numero: 4100, resultado: 'criada' }])

    // Empresa B ingere a MESMA referência externa 4100.
    // Como a empresa B não enxerga a OP da A, deve ser "criada" (não "ignorada"/"atualizada").
    const rB = await ingerirOpsCalcgraf(EMPRESA_B, [op(4100)])
    expect(rB).toEqual([{ numero: 4100, resultado: 'criada' }])

    // Cada empresa tem exatamente UMA OP com a referência 4100, sob a sua própria empresaId.
    const opsA = opsDaEmpresa(EMPRESA_A, '4100')
    const opsB = opsDaEmpresa(EMPRESA_B, '4100')
    expect(opsA).toHaveLength(1)
    expect(opsB).toHaveLength(1)
    expect(opsA[0].empresaId).toBe(EMPRESA_A)
    expect(opsB[0].empresaId).toBe(EMPRESA_B)
    expect(opsA[0].id).not.toBe(opsB[0].id)
  })

  it('alterar a OP da empresa B não afeta a OP da empresa A (mesma referência)', async () => {
    await ingerirOpsCalcgraf(EMPRESA_A, [op(4200, { quantidade: 1000 })])
    await ingerirOpsCalcgraf(EMPRESA_B, [op(4200, { quantidade: 1000 })])

    // Empresa B recebe conteúdo alterado para a 4200.
    const rB = await ingerirOpsCalcgraf(EMPRESA_B, [op(4200, { quantidade: 7777 })])
    expect(rB[0].resultado).toBe('atualizada')

    // A OP da empresa A permanece intacta.
    const opA = opsDaEmpresa(EMPRESA_A, '4200')[0]
    expect(opA.quantidade).toBe(1000)

    // A da empresa B foi atualizada.
    const opB = opsDaEmpresa(EMPRESA_B, '4200')[0]
    expect(opB.quantidade).toBe(7777)
  })
})
