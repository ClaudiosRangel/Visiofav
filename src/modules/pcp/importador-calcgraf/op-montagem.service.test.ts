import { describe, it, expect } from 'vitest'
import { soDigitos, resolverCliente, montarEntregas } from './op-montagem.service'

/**
 * Testes do motor unificado (spec importador-calcgraf-paridade-pdf).
 * Foco: resolução de CLIENTE determinística (T2) — por CNPJ, de-para, ou tag.
 * Usa um fake Prisma mínimo em memória (sem banco).
 */

const EMPRESA = 'emp-1'

/** Fake Prisma mínimo com os models que resolverCliente usa. */
function fakePrisma(opts: {
  clientes?: Array<{ id: string; cpfCnpj: string | null }>
  deParas?: Array<{ tipoEntidade: string; codigoExterno: string; entidadeInternaId: string }>
}) {
  const clientes = opts.clientes ?? []
  const deParas = opts.deParas ?? []
  return {
    cliente: {
      findMany: async () => clientes,
      findFirst: async ({ where }: any) => clientes.find((c) => c.id === where.id) ?? null,
    },
    deParaImportacao: {
      findFirst: async ({ where }: any) =>
        deParas.find((d) => d.tipoEntidade === where.tipoEntidade && d.codigoExterno === where.codigoExterno) ?? null,
    },
  } as any
}

describe('soDigitos', () => {
  it('remove tudo que não é dígito', () => {
    expect(soDigitos('07.358.761/0001-69')).toBe('07358761000169')
    expect(soDigitos(null)).toBe('')
    expect(soDigitos(undefined)).toBe('')
  })
})

describe('resolverCliente — por CNPJ (match determinístico)', () => {
  it('vincula ao cliente com o mesmo CNPJ (dígitos), ignorando máscara', async () => {
    const tx = fakePrisma({
      clientes: [
        { id: 'c1', cpfCnpj: '11.111.111/0001-11' },
        { id: 'c2', cpfCnpj: '07.358.761/0001-69' },
      ],
    })
    const r = await resolverCliente(tx, EMPRESA, { clienteDoc: '07358761000169', clienteNome: 'GERDAU COSIGUA' })
    expect(r.clienteId).toBe('c2')
    expect(r.origem).toBe('CNPJ')
    expect(r.tagCliente).toBe('GERDAU COSIGUA')
  })

  it('desempata a filial correta pelo CNPJ exato', async () => {
    const tx = fakePrisma({
      clientes: [
        { id: 'f1', cpfCnpj: '07358761/0001-69' },
        { id: 'f2', cpfCnpj: '07358761/0051-28' },
        { id: 'f3', cpfCnpj: '07358761/0040-75' },
      ],
    })
    const r = await resolverCliente(tx, EMPRESA, { clienteDoc: '073587610005128', clienteNome: 'GERDAU' })
    // 073587610005128 (15 díg) não casa; usa o CNPJ exato de 14 díg:
    const r2 = await resolverCliente(tx, EMPRESA, { clienteDoc: '07358761005128', clienteNome: 'GERDAU' })
    expect(r.clienteId).toBeNull() // dígitos errados → sem match
    expect(r2.clienteId).toBe('f2')
  })

  it('ignora CNPJ placeholder "00000000000"', async () => {
    const tx = fakePrisma({ clientes: [{ id: 'actual', cpfCnpj: '00000000000' }] })
    const r = await resolverCliente(tx, EMPRESA, { clienteDoc: '00000000000', clienteNome: 'ACTUAL' })
    expect(r.clienteId).toBeNull()
    expect(r.origem).toBe('SEM_MATCH')
    expect(r.tagCliente).toBe('ACTUAL') // tag preserva o nome, mas NÃO vincula
  })
})

describe('resolverCliente — por de-para e sem match', () => {
  it('usa o de-para CLIENTE quando não há CNPJ', async () => {
    const tx = fakePrisma({
      clientes: [{ id: 'cx', cpfCnpj: '99.999.999/0001-99' }],
      deParas: [{ tipoEntidade: 'CLIENTE', codigoExterno: '368', entidadeInternaId: 'cx' }],
    })
    const r = await resolverCliente(tx, EMPRESA, { clienteCodigo: '368', clienteNome: 'GERDAU' })
    expect(r.clienteId).toBe('cx')
    expect(r.origem).toBe('DE_PARA')
  })

  it('sem CNPJ nem de-para → só tag, nunca cria/ACTUAL', async () => {
    const tx = fakePrisma({ clientes: [] })
    const r = await resolverCliente(tx, EMPRESA, { clienteNome: 'CLIENTE NOVO LTDA' })
    expect(r.clienteId).toBeNull()
    expect(r.origem).toBe('SEM_MATCH')
    expect(r.tagCliente).toBe('CLIENTE NOVO LTDA')
  })

  it('entrada totalmente vazia → tag nula, sem match', async () => {
    const tx = fakePrisma({ clientes: [] })
    const r = await resolverCliente(tx, EMPRESA, {})
    expect(r.clienteId).toBeNull()
    expect(r.tagCliente).toBeNull()
  })

  it('CNPJ tem prioridade sobre de-para', async () => {
    const tx = fakePrisma({
      clientes: [{ id: 'porCnpj', cpfCnpj: '07358761000169' }, { id: 'porDePara', cpfCnpj: null }],
      deParas: [{ tipoEntidade: 'CLIENTE', codigoExterno: '368', entidadeInternaId: 'porDePara' }],
    })
    const r = await resolverCliente(tx, EMPRESA, { clienteDoc: '07358761000169', clienteCodigo: '368', clienteNome: 'X' })
    expect(r.clienteId).toBe('porCnpj')
    expect(r.origem).toBe('CNPJ')
  })
})

describe('montarEntregas', () => {
  it('monta todas as datas válidas, ordenadas, e a 1ª como prevista', () => {
    const r = montarEntregas([
      { data: '2026-11-13', quantidade: 4000 },
      { data: '2026-10-20', quantidade: 2000 },
      { data: '2026-12-01', quantidade: 600 },
    ])
    expect(r.entregas).toHaveLength(3)
    expect(r.entregas[0].dataEntrega.toISOString().slice(0, 10)).toBe('2026-10-20')
    expect(r.dataPrevista?.toISOString().slice(0, 10)).toBe('2026-10-20')
  })

  it('ignora datas inválidas (não inventa data)', () => {
    const r = montarEntregas([{ data: 'xx', quantidade: 1 }, { data: null, quantidade: 2 }])
    expect(r.entregas).toHaveLength(0)
    expect(r.dataPrevista).toBeNull()
  })

  it('lista vazia/undefined → sem entregas, prevista null (fallback é do chamador)', () => {
    expect(montarEntregas([]).dataPrevista).toBeNull()
    expect(montarEntregas(undefined).dataPrevista).toBeNull()
    expect(montarEntregas(null).entregas).toHaveLength(0)
  })

  it('quantidade ausente vira 0 (não quebra)', () => {
    const r = montarEntregas([{ data: '2026-10-20' }])
    expect(r.entregas[0].quantidade).toBe(0)
  })
})
