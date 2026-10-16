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
  clienteId?: string | null
  dataEntregaPrevista?: Date | null
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
  descricao?: string
  centroProducaoId?: string | null
  tempoSetupMinutos?: number
  tempoOperacaoCalculado?: number
  tempoEsperaMinutos?: number
  sequencia?: number
  posicaoFila?: number | null
}

interface FakeVariacao {
  id: string
  ordemProducaoId: string
  codigoProduto: string
  descricao: string
  quantidade: number
  sequencia: number
  observacao?: string | null
}

interface FakePlano {
  id: string
  ordemProducaoId: string
  empresaId: string
  nome: string
  tipo: string
  cores?: string | null
  tiragem?: number | null
  formato?: string | null
  material?: string | null
  gramatura?: number | null
  faceDeId?: string | null
  sequencia?: number | null
}

interface FakeProgramacaoEntrega {
  id: string
  ordemProducaoId: string
  dataEntrega: Date
  quantidade: number
  status: string
}

interface FakeCentro {
  id: string
  empresaId: string
  codigo: string
  descricao: string
  tipo: string
  tipoProcessoId: string
}

interface FakeTipoProcesso {
  id: string
  empresaId: string
  codigo: string
  status: boolean
  posicao: number
}

interface FakeCliente {
  id: string
  empresaId: string
  cpfCnpj: string | null
}

/** Estado do "banco" fake, resetado a cada teste. */
const db = {
  ops: [] as FakeOp[],
  pendentes: [] as FakePendente[],
  itens: [] as FakeItem[],
  etapas: [] as FakeEtapa[],
  variacoes: [] as FakeVariacao[],
  planos: [] as FakePlano[],
  entregas: [] as FakeProgramacaoEntrega[],
  centros: [] as FakeCentro[],
  tiposProcesso: [] as FakeTipoProcesso[],
  clientes: [] as FakeCliente[],
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
          clienteId: (data.clienteId as string) ?? null,
          dataEntregaPrevista: (data.dataEntregaPrevista as Date) ?? null,
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
          descricao: data.descricao as string,
          centroProducaoId: (data.centroProducaoId as string) ?? null,
          tempoSetupMinutos: Number(data.tempoSetupMinutos ?? 0),
          tempoOperacaoCalculado: Number(data.tempoOperacaoCalculado ?? 0),
          tempoEsperaMinutos: Number(data.tempoEsperaMinutos ?? 0),
          sequencia: data.sequencia as number,
          posicaoFila: (data.posicaoFila as number) ?? null,
        }
        db.etapas.push(etapa)
        return etapa
      }),
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        db.etapas.filter((e) => casa(e as unknown as Record<string, unknown>, where)).length,
      ),
      aggregate: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const casam = db.etapas.filter((e) => casa(e as unknown as Record<string, unknown>, where))
        const max = casam.reduce((m, e) => Math.max(m, e.posicaoFila ?? 0), 0)
        return { _max: { posicaoFila: casam.length > 0 ? max : null } }
      }),
      deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const antes = db.etapas.length
        db.etapas = db.etapas.filter((e) => !casa(e as unknown as Record<string, unknown>, where))
        return { count: antes - db.etapas.length }
      }),
    },
    variacaoOrdemProducao: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const v: FakeVariacao = {
          id: novoId('var'),
          ordemProducaoId: data.ordemProducaoId as string,
          codigoProduto: data.codigoProduto as string,
          descricao: data.descricao as string,
          quantidade: Number(data.quantidade ?? 0),
          sequencia: data.sequencia as number,
          observacao: (data.observacao as string) ?? null,
        }
        db.variacoes.push(v)
        return v
      }),
      deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const antes = db.variacoes.length
        db.variacoes = db.variacoes.filter((v) => !casa(v as unknown as Record<string, unknown>, where))
        return { count: antes - db.variacoes.length }
      }),
    },
    planoOrdemProducao: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const p: FakePlano = {
          id: novoId('plano'),
          ordemProducaoId: data.ordemProducaoId as string,
          empresaId: data.empresaId as string,
          nome: data.nome as string,
          tipo: data.tipo as string,
          cores: (data.cores as string) ?? null,
          tiragem: (data.tiragem as number) ?? null,
          formato: (data.formato as string) ?? null,
          material: (data.material as string) ?? null,
          gramatura: (data.gramatura as number) ?? null,
          faceDeId: (data.faceDeId as string) ?? null,
          sequencia: (data.sequencia as number) ?? null,
        }
        db.planos.push(p)
        return p
      }),
      deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const antes = db.planos.length
        db.planos = db.planos.filter((p) => !casa(p as unknown as Record<string, unknown>, where))
        return { count: antes - db.planos.length }
      }),
    },
    programacaoEntrega: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const e: FakeProgramacaoEntrega = {
          id: novoId('entrega'),
          ordemProducaoId: data.ordemProducaoId as string,
          dataEntrega: data.dataEntrega as Date,
          quantidade: Number(data.quantidade ?? 0),
          status: data.status as string,
        }
        db.entregas.push(e)
        return e
      }),
      deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const antes = db.entregas.length
        db.entregas = db.entregas.filter((e) => !casa(e as unknown as Record<string, unknown>, where))
        return { count: antes - db.entregas.length }
      }),
    },
    centroProducao: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        // Suporta where.descricao = { equals, mode } (case-insensitive).
        const w = { ...where }
        const descCond = w.descricao as { equals?: string; mode?: string } | string | undefined
        delete (w as Record<string, unknown>).descricao
        let casam = db.centros.filter((c) => casa(c as unknown as Record<string, unknown>, w))
        if (descCond && typeof descCond === 'object' && 'equals' in descCond) {
          const alvo = (descCond.equals ?? '').toLowerCase()
          casam = casam.filter((c) => c.descricao.toLowerCase() === alvo)
        } else if (typeof descCond === 'string') {
          casam = casam.filter((c) => c.descricao === descCond)
        }
        return casam.sort((a, b) => a.codigo.localeCompare(b.codigo))[0] ?? null
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const c: FakeCentro = {
          id: novoId('centro'),
          empresaId: data.empresaId as string,
          codigo: data.codigo as string,
          descricao: data.descricao as string,
          tipo: data.tipo as string,
          tipoProcessoId: data.tipoProcessoId as string,
        }
        db.centros.push(c)
        return c
      }),
    },
    tipoProcesso: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        db.tiposProcesso
          .filter((t) => casa(t as unknown as Record<string, unknown>, where))
          .sort((a, b) => a.posicao - b.posicao)[0] ?? null,
      ),
    },
    // De-para de importação: no fake não há vínculos (retorna null), então o
    // motor de centro cai no reuso por nome/criação — igual ao testado antes.
    deParaImportacao: {
      findFirst: vi.fn(async () => null),
    },
    cliente: {
      // where: { empresaId, cpfCnpj: { not: null } } → ignora o {not:null}, só
      // filtra empresa e cpfCnpj preenchido (o motor compara dígitos em memória).
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        db.clientes.filter((c) => c.empresaId === (where.empresaId as string) && c.cpfCnpj != null),
      ),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        db.clientes.find((c) => casa(c as unknown as Record<string, unknown>, where)) ?? null,
      ),
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
  db.variacoes = []
  db.planos = []
  db.entregas = []
  db.centros = []
  db.tiposProcesso = []
  db.clientes = []
  db.apontEtapa = []
  db.apontProd = []
  db.logs = []
  db.seq = 0
  // Tipos de Processo padrão da empresa A (necessário para criar centros).
  db.tiposProcesso.push(
    { id: 'tp-impressao', empresaId: EMPRESA_A, codigo: 'IMPRESSAO', status: true, posicao: 1 },
    { id: 'tp-acabamento', empresaId: EMPRESA_A, codigo: 'ACABAMENTO', status: true, posicao: 2 },
    { id: 'tp-verniz', empresaId: EMPRESA_A, codigo: 'VERNIZ', status: true, posicao: 3 },
  )
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

// ───────────────────────────────────────────────────────────────────────────
// Fase 2 — golden OP 3000 (etapas com centro/tempos + variação + tintas texto)
// ───────────────────────────────────────────────────────────────────────────

describe('ingerirOpsCalcgraf — Fase 2: roteiro completo (golden OP 3000)', () => {
  /** DTO espelhando a OP 3000 do mapeamento (4 etapas, 1 plano, 2 tintas). */
  function op3000(): OpOrigemDTO {
    return op(3000, {
      quantidade: 100000,
      tiragem: 100000,
      etapas: [
        { sequencia: 0, tipo: 'I', centro: 'Roland RZU 2cores', descricao: 'Offset Plana Roland RZU 2cores', setupMinutos: 60, operacaoMinutos: 3000 },
        { sequencia: 1, tipo: 'A', centro: 'Cortadeira (Grande)', descricao: 'Cortadeira (Grande)', setupMinutos: 15, operacaoMinutos: 2000 },
        { sequencia: 2, tipo: 'A', centro: 'Guilhotina de envol', descricao: 'Guilhotina de envol', setupMinutos: 0, operacaoMinutos: 3000 },
        { sequencia: 3, tipo: 'A', centro: 'Plastificadora maior', descricao: 'Laminação maior Plastificadora maior', setupMinutos: 0, operacaoMinutos: 7500 },
      ],
      variacoes: [
        { sequencia: 1, codigoPlano: '1', nome: 'Impressos', quantidade: 100000, suporte: 'Stora Enzo Bobina 322', gramatura: 322, dimensao: '185x1150', aproveitamento: 3 },
      ],
      itens: [
        { codItemEstoque: 'SUP-8', descricao: 'Stora Enzo Bobina 322', quantidade: 2555.22, unidadeMedida: 'KG' },
        { codItemEstoque: 'MAT-14', descricao: 'BOPP Brilho', quantidade: 10, unidadeMedida: 'KG' },
      ],
      tintasTexto: 'AMARELO 123C (85%), VERDE CW0138 (15%)',
    })
  }

  it('cria a OP 3000 com 4 etapas (centro resolvido/criado + tempos), 1 variação e tag [Cores]', async () => {
    const r = await ingerirOpsCalcgraf(EMPRESA_A, [op3000()])
    expect(r).toEqual([{ numero: 3000, resultado: 'criada' }])

    const criada = opsDaEmpresa(EMPRESA_A, '3000')[0]
    expect(criada).toBeTruthy()

    // 4 etapas, cada uma com centro (resolvido/criado) e tempos.
    const etapas = db.etapas.filter((e) => e.ordemProducaoId === criada.id)
    expect(etapas).toHaveLength(4)
    for (const e of etapas) {
      expect(e.centroProducaoId).toBeTruthy() // nenhuma etapa sem centro
      expect(e.status).toBe('PENDENTE')
    }
    // Primeira etapa (impressão): setup 60, operação 3000.
    const impressao = etapas.find((e) => e.descricao?.includes('Offset'))
    expect(impressao?.tempoSetupMinutos).toBe(60)
    expect(impressao?.tempoOperacaoCalculado).toBe(3000)

    // Centros criados: a impressão vira tipo IMPRESSAO; acabamentos → ACABAMENTO.
    const centroImpressao = db.centros.find((c) => c.descricao === 'Roland RZU 2cores')
    expect(centroImpressao?.tipoProcessoId).toBe('tp-impressao')
    const centroCortadeira = db.centros.find((c) => c.descricao === 'Cortadeira (Grande)')
    expect(centroCortadeira?.tipoProcessoId).toBe('tp-acabamento')

    // Plano ÚNICO sem retiração → não cria PlanoOrdemProducao (paridade com o
    // importador de PDF: planos só são materializados quando há 2+ ou retiração).
    const planos = db.planos.filter((p) => p.ordemProducaoId === criada.id)
    expect(planos).toHaveLength(0)

    // 2 itens de material (papel + acabamento).
    const itens = db.itens.filter((i) => i.ordemProducaoId === criada.id)
    expect(itens).toHaveLength(2)

    // Tintas foram para a observação como tag [Cores] (NÃO viraram item).
    expect(criada.observacoes).toContain('[Cores] AMARELO 123C (85%), VERDE CW0138 (15%)')
  })

  it('etapa tipo "M" (verniz na impressora) cria centro com TipoProcesso VERNIZ', async () => {
    // Descoberto na validação T7: o Calcgraf usa tipo 'M' para verniz aplicado
    // na própria impressora (ex.: "Verniz Heidelberg CD" na OP 3133).
    const dto = op(3004, {
      etapas: [{ sequencia: 1, tipo: 'M', centro: 'Verniz Heidelberg CD', descricao: 'Verniz', setupMinutos: 0, operacaoMinutos: 0 }],
    })
    await ingerirOpsCalcgraf(EMPRESA_A, [dto])
    const centroVerniz = db.centros.find((c) => c.descricao === 'Verniz Heidelberg CD')
    expect(centroVerniz?.tipoProcessoId).toBe('tp-verniz')
  })

  it('reusa o MESMO centro quando duas etapas têm o mesmo nome (não duplica)', async () => {
    const dto = op(3002, {
      etapas: [
        { sequencia: 1, tipo: 'A', centro: 'Cortadeira (Grande)', descricao: 'Corte 1', setupMinutos: 10, operacaoMinutos: 100 },
        { sequencia: 2, tipo: 'A', centro: 'Cortadeira (Grande)', descricao: 'Corte 2', setupMinutos: 5, operacaoMinutos: 50 },
      ],
    })
    await ingerirOpsCalcgraf(EMPRESA_A, [dto])
    const centrosCortadeira = db.centros.filter((c) => c.descricao === 'Cortadeira (Grande)')
    expect(centrosCortadeira).toHaveLength(1) // reusou, não duplicou
  })

  it('OP sem cálculo (sem etapas/variações) continua sendo criada (comportamento fase 1)', async () => {
    const r = await ingerirOpsCalcgraf(EMPRESA_A, [op(3003)]) // sem etapas/variacoes
    expect(r).toEqual([{ numero: 3003, resultado: 'criada' }])
    const criada = opsDaEmpresa(EMPRESA_A, '3003')[0]
    expect(db.etapas.filter((e) => e.ordemProducaoId === criada.id)).toHaveLength(0)
    expect(db.planos.filter((p) => p.ordemProducaoId === criada.id)).toHaveLength(0)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// CINTO DE SEGURANÇA (incidente 15/10/2026): atualizar com payload SEM etapas
// NÃO pode zerar o roteiro já existente.
// ───────────────────────────────────────────────────────────────────────────

describe('ingerirOpsCalcgraf — cinto de segurança (payload sem etapas preserva roteiro)', () => {
  function op3200ComEtapas(): OpOrigemDTO {
    return op(3200, {
      quantidade: 1000,
      etapas: [
        { sequencia: 1, tipo: 'I', centro: 'Heidelberg', descricao: 'Impressão', setupMinutos: 100, operacaoMinutos: 50 },
        { sequencia: 2, tipo: 'A', centro: 'Cortadeira (Grande)', descricao: 'Corte', setupMinutos: 10, operacaoMinutos: 20 },
      ],
      // 2 planos (TAMPA/CAIXA) → materializam PlanoOrdemProducao (há 2+).
      planos: [
        { nome: 'TAMPA', tipo: 'COMPONENTE', tiragem: 500, sequencia: 1 },
        { nome: 'CAIXA', tipo: 'COMPONENTE', tiragem: 500, sequencia: 2 },
      ],
    })
  }

  it('OP com etapas recebendo payload SEM etapas (agente antigo) PRESERVA as etapas/planos', async () => {
    // 1ª ingestão: cria com 2 etapas + 2 planos.
    await ingerirOpsCalcgraf(EMPRESA_A, [op3200ComEtapas()])
    const criada = opsDaEmpresa(EMPRESA_A, '3200')[0]
    const etapasAntes = db.etapas.filter((e) => e.ordemProducaoId === criada.id).length
    const planosAntes = db.planos.filter((p) => p.ordemProducaoId === criada.id).length
    expect(etapasAntes).toBe(2)
    expect(planosAntes).toBe(2)

    // 2ª ingestão: MESMA OP, conteúdo de cabeçalho diferente (hash muda), mas
    // payload SEM etapas (simula o agente antigo da fase 1).
    const r = await ingerirOpsCalcgraf(EMPRESA_A, [op(3200, { quantidade: 2000 })])
    expect(r[0].resultado).toBe('atualizada')

    // Cabeçalho atualizado...
    const depois = opsDaEmpresa(EMPRESA_A, '3200')[0]
    expect(depois.quantidade).toBe(2000)
    // ...mas o roteiro foi PRESERVADO (não zerou).
    expect(db.etapas.filter((e) => e.ordemProducaoId === criada.id)).toHaveLength(2)
    expect(db.planos.filter((p) => p.ordemProducaoId === criada.id)).toHaveLength(2)
  })

  it('OP com etapas recebendo payload COM etapas substitui normalmente', async () => {
    await ingerirOpsCalcgraf(EMPRESA_A, [op3200ComEtapas()])
    const criada = opsDaEmpresa(EMPRESA_A, '3200')[0]

    // Novo payload COM 3 etapas → substitui (de 2 para 3).
    const novo = op(3200, {
      quantidade: 1000,
      etapas: [
        { sequencia: 1, tipo: 'I', centro: 'Heidelberg', descricao: 'Impressão', setupMinutos: 100, operacaoMinutos: 50 },
        { sequencia: 2, tipo: 'A', centro: 'Cortadeira (Grande)', descricao: 'Corte', setupMinutos: 10, operacaoMinutos: 20 },
        { sequencia: 3, tipo: 'A', centro: 'Verniz', descricao: 'Verniz', setupMinutos: 5, operacaoMinutos: 15 },
      ],
    })
    const r = await ingerirOpsCalcgraf(EMPRESA_A, [novo])
    expect(r[0].resultado).toBe('atualizada')
    expect(db.etapas.filter((e) => e.ordemProducaoId === criada.id)).toHaveLength(3)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// T5 — Paridade PDF: cliente por CNPJ, retiração (frente/verso), programação
// de entrega (resolve "entrega em branco"), tags [Matriz]/[Formato]/[Bobina].
// ───────────────────────────────────────────────────────────────────────────

describe('ingerirOpsCalcgraf — T5 cliente por CNPJ (nunca cria, nunca ACTUAL)', () => {
  it('vincula clienteId quando o CNPJ (só dígitos) casa com o cadastro, e grava a tag [Cliente]', async () => {
    db.clientes.push({ id: 'cli-real', empresaId: EMPRESA_A, cpfCnpj: '23.787.041/0001-75' })

    const r = await ingerirOpsCalcgraf(EMPRESA_A, [
      op(5000, { clienteDoc: '23787041000175', clienteNome: 'Carton Wega SA' }),
    ])
    expect(r[0].resultado).toBe('criada')

    const criada = opsDaEmpresa(EMPRESA_A, '5000')[0]
    // Vínculo formal resolvido por CNPJ (ignora máscara/pontuação).
    const opReal = db.ops.find((o) => o.id === criada.id) as unknown as { clienteId?: string }
    expect(opReal.clienteId).toBe('cli-real')
    // Tag [Cliente] com o nome de origem (exibição).
    expect(criada.observacoes).toContain('[Cliente] Carton Wega SA')
  })

  it('CNPJ placeholder (00000000000) NÃO vincula — fica só a tag [Cliente] (nunca ACTUAL)', async () => {
    db.clientes.push({ id: 'cli-actual', empresaId: EMPRESA_A, cpfCnpj: '00000000000' })

    const r = await ingerirOpsCalcgraf(EMPRESA_A, [
      op(5001, { clienteDoc: '00000000000', clienteNome: 'Fulano Ltda' }),
    ])
    expect(r[0].resultado).toBe('criada')

    const criada = opsDaEmpresa(EMPRESA_A, '5001')[0]
    const opReal = db.ops.find((o) => o.id === criada.id) as unknown as { clienteId?: string }
    expect(opReal.clienteId ?? null).toBeNull() // não vinculou ao placeholder
    expect(criada.observacoes).toContain('[Cliente] Fulano Ltda')
  })

  it('CNPJ sem match no cadastro NÃO cria cliente — só a tag [Cliente]', async () => {
    const r = await ingerirOpsCalcgraf(EMPRESA_A, [
      op(5002, { clienteDoc: '99999999000199', clienteNome: 'Cliente Novo Ltda' }),
    ])
    expect(r[0].resultado).toBe('criada')
    expect(db.clientes).toHaveLength(0) // NUNCA cria cliente
    const criada = opsDaEmpresa(EMPRESA_A, '5002')[0]
    expect(criada.observacoes).toContain('[Cliente] Cliente Novo Ltda')
  })
})

describe('ingerirOpsCalcgraf — T5 planos com retiração (frente/verso = FACE)', () => {
  it('plano com retiracao=true gera 2 FACES (FRENTE/VERSO), VERSO apontando para FRENTE', async () => {
    const r = await ingerirOpsCalcgraf(EMPRESA_A, [
      op(5100, {
        planos: [
          {
            nome: 'Impressos',
            tipo: 'FACE',
            retiracao: true,
            coresFrente: '7x0',
            coresVerso: '5x0',
            tiragem: 8250,
            sequencia: 1,
          },
        ],
      }),
    ])
    expect(r[0].resultado).toBe('criada')

    const criada = opsDaEmpresa(EMPRESA_A, '5100')[0]
    const planos = db.planos.filter((p) => p.ordemProducaoId === criada.id)
    expect(planos).toHaveLength(2)

    const frente = planos.find((p) => p.nome.includes('FRENTE'))
    const verso = planos.find((p) => p.nome.includes('VERSO'))
    expect(frente?.tipo).toBe('FACE')
    expect(verso?.tipo).toBe('FACE')
    expect(frente?.cores).toBe('7x0')
    expect(verso?.cores).toBe('5x0')
    // VERSO vincula à FRENTE (faceDeId).
    expect(verso?.faceDeId).toBe(frente?.id)
  })

  it('2+ planos COMPONENTE (TAMPA/CAIXA) são materializados', async () => {
    const r = await ingerirOpsCalcgraf(EMPRESA_A, [
      op(5101, {
        planos: [
          { nome: 'TAMPA', tipo: 'COMPONENTE', tiragem: 1000, sequencia: 1 },
          { nome: 'CAIXA', tipo: 'COMPONENTE', tiragem: 1000, sequencia: 2 },
        ],
      }),
    ])
    expect(r[0].resultado).toBe('criada')
    const criada = opsDaEmpresa(EMPRESA_A, '5101')[0]
    expect(db.planos.filter((p) => p.ordemProducaoId === criada.id)).toHaveLength(2)
  })
})

describe('ingerirOpsCalcgraf — T5 programação de entrega (resolve "entrega em branco")', () => {
  it('grava todas as entregas e usa a MENOR data como dataEntregaPrevista', async () => {
    const r = await ingerirOpsCalcgraf(EMPRESA_A, [
      op(5200, {
        dataEntrega: undefined, // lote sem data (era o que ficava "em branco")
        programacaoEntrega: [
          { data: '2026-08-02T00:00:00.000Z', quantidade: 1000000 },
          { data: '2026-07-06T00:00:00.000Z', quantidade: 1200000 },
        ],
      }),
    ])
    expect(r[0].resultado).toBe('criada')

    const criada = opsDaEmpresa(EMPRESA_A, '5200')[0]
    const entregas = db.entregas.filter((e) => e.ordemProducaoId === criada.id)
    expect(entregas).toHaveLength(2)

    // dataEntregaPrevista = a menor data (06/07), não a 1ª do array.
    const opReal = db.ops.find((o) => o.id === criada.id) as unknown as { dataEntregaPrevista?: Date }
    expect(opReal.dataEntregaPrevista?.toISOString()).toBe('2026-07-06T00:00:00.000Z')
  })

  it('atualização com payload SEM etapas mas COM programação atualiza as entregas (preserva roteiro)', async () => {
    // Cria com etapas + 1ª programação.
    await ingerirOpsCalcgraf(EMPRESA_A, [
      op(5201, {
        etapas: [{ sequencia: 1, tipo: 'A', centro: 'Cortadeira (Grande)', descricao: 'Corte', setupMinutos: 1, operacaoMinutos: 1 }],
        programacaoEntrega: [{ data: '2026-05-04T00:00:00.000Z', quantidade: 6900 }],
      }),
    ])
    const criada = opsDaEmpresa(EMPRESA_A, '5201')[0]
    expect(db.etapas.filter((e) => e.ordemProducaoId === criada.id)).toHaveLength(1)
    expect(db.entregas.filter((e) => e.ordemProducaoId === criada.id)).toHaveLength(1)

    // Atualiza SEM etapas (agente antigo) mas COM nova programação (2 entregas).
    const r = await ingerirOpsCalcgraf(EMPRESA_A, [
      op(5201, {
        programacaoEntrega: [
          { data: '2026-05-04T00:00:00.000Z', quantidade: 6900 },
          { data: '2026-05-10T00:00:00.000Z', quantidade: 4600 },
        ],
      }),
    ])
    expect(r[0].resultado).toBe('atualizada')

    // Roteiro preservado (etapa intacta)...
    expect(db.etapas.filter((e) => e.ordemProducaoId === criada.id)).toHaveLength(1)
    // ...mas as entregas foram atualizadas (de 1 para 2).
    expect(db.entregas.filter((e) => e.ordemProducaoId === criada.id)).toHaveLength(2)
  })
})

describe('ingerirOpsCalcgraf — T5 tags de cabeçalho [Matriz]/[Formato]/[Bobina]', () => {
  it('grava [Matriz], [Formato] e múltiplas [Bobina] na observação', async () => {
    const r = await ingerirOpsCalcgraf(EMPRESA_A, [
      op(5300, {
        matriz: '2529B - COM BRAILLE',
        formato: '600 x 910',
        bobinasTexto: ['Bobina Stora Enzo 222g', 'Bobina Suzano 300g'],
      }),
    ])
    expect(r[0].resultado).toBe('criada')

    const criada = opsDaEmpresa(EMPRESA_A, '5300')[0]
    expect(criada.observacoes).toContain('[Matriz] 2529B - COM BRAILLE')
    expect(criada.observacoes).toContain('[Formato] 600 x 910')
    expect(criada.observacoes).toContain('[Bobina] Bobina Stora Enzo 222g')
    expect(criada.observacoes).toContain('[Bobina] Bobina Suzano 300g')
  })
})
