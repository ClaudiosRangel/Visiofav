import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Suporte NC (tarefa 9.4) — service com banco em memória (sem Postgres).
 * Cobre: válido, faixas, duplicata, confirmarExistente, rollback e isolamento por empresa
 * (inclusive SUPER_ADMIN: o service só conhece o empresaId da sessão).
 */

vi.mock('../../../lib/prisma', async () => ({ prisma: (await import('./suporte-nc.fake-db')).prisma }))

import { HierarquiaError } from './hierarquia-common'
import { db, resetar, semear } from './suporte-nc.fake-db'
import { criarSuporteNc, normalizarNome } from './suporte-nc.service'

const EMP_A = 'emp-A'
const EMP_B = 'emp-B'

const valido = { nome: 'Cartão Tríplex NC', gramatura: 250, custoKg: 8.5 }

async function falha(corpo: unknown, empresa = EMP_A): Promise<HierarquiaError> {
  try {
    await criarSuporteNc(empresa, corpo)
  } catch (e) {
    expect(e).toBeInstanceOf(HierarquiaError)
    return e as HierarquiaError
  }
  throw new Error('esperava falha de validação')
}

beforeEach(() => resetar())

describe('criarSuporteNc — caminho válido', () => {
  it('cria suporte + preço provisório com o empresaId da sessão e devolve 201 CRIADO', async () => {
    const r = await criarSuporteNc(EMP_A, {
      ...valido,
      espessuraGm: 0.3,
      espessuraMicras: 320,
      formatoLarguraMm: 660,
      formatoAlturaMm: 960,
      fibra: 'Longa',
      tiraRetira: true,
      unidadeCustoKg: true,
      unidadeCalculoFl: false,
      freteKg: 0.35,
      pacotesCom: 500,
      creditoIcmsPerc: 12,
      creditoIpiPerc: 5,
    })

    expect(r.status).toBe(201)
    expect(r.corpo).toMatchObject({ resultado: 'CRIADO', provisorio: true })
    if (r.corpo.resultado !== 'CRIADO') throw new Error('tipo')

    expect(db.suportes).toHaveLength(1)
    expect(db.precos).toHaveLength(1)
    const s = db.suportes[0]
    const p = db.precos[0]
    expect(s.id).toBe(r.corpo.suporteId)
    expect(p.id).toBe(r.corpo.precoId)
    expect(s).toMatchObject({
      empresaId: EMP_A,
      descricao: 'Cartão Tríplex NC',
      tipoSuporte: 'NC',
      coefTinta: 1.5,
      espessuraMicras: 320,
      fibra: 'Longa',
      tiraRetira: true,
      unidadeCalculoFl: false,
      pacotesCom: 500,
    })
    expect(s.codigo).toMatch(/^NC-/)
    expect(s.codigo.length).toBeLessThanOrEqual(30)
    expect(p).toMatchObject({
      empresaId: EMP_A,
      tipo: 'PAPEL',
      unidade: 'KG',
      precoUnitario: 8.5,
      suporteId: s.id,
      gramatura: 250,
      provisorio: true,
      freteKg: 0.35,
      creditoIcmsPerc: 12,
      creditoIpiPerc: 5,
    })
  })

  it('usa o coefTinta do tipo de suporte de referência (mesma empresa)', async () => {
    const ref = semear({ empresaId: EMP_A, nome: 'Kraft ref', gramatura: 120, coefTinta: 2.2, tipoSuporte: 'KRAFT' })
    const r = await criarSuporteNc(EMP_A, { ...valido, tipoSuporteConsumoTintaId: ref.suporteId })
    expect(r.status).toBe(201)
    const novo = db.suportes[db.suportes.length - 1]
    expect(novo).toMatchObject({ coefTinta: 2.2, tipoSuporte: 'KRAFT' })
  })

  it('aceita coefTinta direto e opcionais ausentes viram null', async () => {
    await criarSuporteNc(EMP_A, { ...valido, coefTinta: 1.8 })
    expect(db.suportes[0].coefTinta).toBe(1.8)
    expect(db.suportes[0].fibra).toBeNull()
    expect(db.precos[0].freteKg).toBeNull()
  })

  it('suporte de referência de OUTRA empresa → 400 sem criar nada', async () => {
    const ref = semear({ empresaId: EMP_B, nome: 'Ref B', gramatura: 90 })
    const e = await falha({ ...valido, tipoSuporteConsumoTintaId: ref.suporteId })
    expect(e.statusCode).toBe(400)
    expect(db.suportes).toHaveLength(1) // só o semeado
    expect(db.precos).toHaveLength(1)
  })
})

describe('criarSuporteNc — faixas', () => {
  const casos: Array<[string, Record<string, unknown>, string]> = [
    ['nome vazio', { nome: '   ' }, 'nome'],
    ['nome > 120', { nome: 'x'.repeat(121) }, 'nome'],
    ['gramatura 0', { gramatura: 0 }, 'gramatura'],
    ['gramatura 2001', { gramatura: 2001 }, 'gramatura'],
    ['custoKg 0', { custoKg: 0 }, 'custoKg'],
    ['custoKg 0,009', { custoKg: 0.009 }, 'custoKg'],
    ['custoKg > 999.999,99', { custoKg: 1_000_000 }, 'custoKg'],
    ['freteKg negativo', { freteKg: -0.01 }, 'freteKg'],
    ['freteKg > 999.999,99', { freteKg: 1_000_000 }, 'freteKg'],
    ['crédito ICMS > 100', { creditoIcmsPerc: 100.01 }, 'creditoIcmsPerc'],
    ['crédito IPI < 0', { creditoIpiPerc: -1 }, 'creditoIpiPerc'],
    ['espessura micras > 10.000', { espessuraMicras: 10_001 }, 'espessuraMicras'],
    ['espessura micras < 0', { espessuraMicras: -1 }, 'espessuraMicras'],
    ['pacotesCom fracionado', { pacotesCom: 1.5 }, 'pacotesCom'],
    ['fibra > 40', { fibra: 'f'.repeat(41) }, 'fibra'],
  ]

  it.each(casos)('rejeita %s com 400 "campo: motivo" e não grava', async (_nome, parcial, campo) => {
    const e = await falha({ ...valido, ...parcial })
    expect(e.statusCode).toBe(400)
    expect(e.message.startsWith(`${campo}: `)).toBe(true)
    expect(e.detalhes).toMatchObject({ campo })
    expect(db.suportes).toHaveLength(0)
    expect(db.precos).toHaveLength(0)
  })

  it('aceita os limites exatos (nome 120, gramatura 1 e 2000, custo 0,01 e 999.999,99, créditos 0 e 100, micras 0 e 10.000)', async () => {
    const limites = [
      { nome: 'n'.repeat(120), gramatura: 1, custoKg: 0.01, creditoIcmsPerc: 0, creditoIpiPerc: 100, espessuraMicras: 0, freteKg: 0 },
      { nome: 'outro', gramatura: 2000, custoKg: 999_999.99, creditoIcmsPerc: 100, creditoIpiPerc: 0, espessuraMicras: 10_000, freteKg: 999_999.99 },
    ]
    for (const l of limites) expect((await criarSuporteNc(EMP_A, l)).status).toBe(201)
    expect(db.suportes).toHaveLength(2)
  })

  it('corpo ausente → 400 e nada gravado', async () => {
    const e = await falha(undefined)
    expect(e.statusCode).toBe(400)
    expect(db.suportes).toHaveLength(0)
  })
})

describe('criarSuporteNc — duplicata', () => {
  it('mesmo nome sem caixa/acento e mesma gramatura → 200 DUPLICADO sem criar', async () => {
    const existente = semear({ empresaId: EMP_A, nome: 'Cartão Triplex', gramatura: 250 })
    const r = await criarSuporteNc(EMP_A, { nome: '  CARTAO   TRIPLEX ', gramatura: 250, custoKg: 9 })
    expect(r.status).toBe(200)
    expect(r.corpo).toEqual({
      resultado: 'DUPLICADO',
      suporteId: existente.suporteId,
      nome: 'Cartão Triplex',
      gramatura: 250,
    })
    expect(db.suportes).toHaveLength(1)
    expect(db.precos).toHaveLength(1)
  })

  it('mesma gramatura mas nome diferente, ou mesmo nome com gramatura diferente → cria', async () => {
    semear({ empresaId: EMP_A, nome: 'Cartão Triplex', gramatura: 250 })
    expect((await criarSuporteNc(EMP_A, { nome: 'Cartão Duplex', gramatura: 250, custoKg: 9 })).status).toBe(201)
    expect((await criarSuporteNc(EMP_A, { nome: 'Cartão Triplex', gramatura: 300, custoKg: 9 })).status).toBe(201)
    expect(db.suportes).toHaveLength(3)
  })

  it('suporte inativo não conta como duplicata', async () => {
    semear({ empresaId: EMP_A, nome: 'Cartão Triplex', gramatura: 250, status: false })
    expect((await criarSuporteNc(EMP_A, { nome: 'Cartão Triplex', gramatura: 250, custoKg: 9 })).status).toBe(201)
  })

  it('confirmarExistente: true devolve CRIADO com o existente (200) e não cria', async () => {
    const existente = semear({ empresaId: EMP_A, nome: 'Cartão Triplex', gramatura: 250, provisorio: true })
    const r = await criarSuporteNc(EMP_A, { nome: 'cartao triplex', gramatura: 250, custoKg: 9, confirmarExistente: true })
    expect(r.status).toBe(200)
    expect(r.corpo).toEqual({
      resultado: 'CRIADO',
      suporteId: existente.suporteId,
      precoId: existente.precoId,
      provisorio: true,
    })
    expect(db.suportes).toHaveLength(1)
    expect(db.precos).toHaveLength(1)
  })

  it('confirmarExistente sem duplicata cria normalmente (201)', async () => {
    const r = await criarSuporteNc(EMP_A, { ...valido, confirmarExistente: true })
    expect(r.status).toBe(201)
    expect(db.suportes).toHaveLength(1)
  })
})

describe('criarSuporteNc — rollback', () => {
  it('falha ao criar o preço desfaz o suporte já criado (nada órfão)', async () => {
    db.falharNoPreco = new Error('falha simulada no preço')
    await expect(criarSuporteNc(EMP_A, valido)).rejects.toThrow('falha simulada no preço')
    expect(db.transacoes).toBe(1)
    expect(db.suportes).toHaveLength(0)
    expect(db.precos).toHaveLength(0)
  })

  it('rollback preserva o que já existia', async () => {
    semear({ empresaId: EMP_A, nome: 'Existente', gramatura: 100 })
    db.falharNoPreco = new Error('boom')
    await expect(criarSuporteNc(EMP_A, valido)).rejects.toThrow('boom')
    expect(db.suportes.map((s) => s.descricao)).toEqual(['Existente'])
    expect(db.precos).toHaveLength(1)
  })
})

describe('criarSuporteNc — isolamento por empresa', () => {
  it('papel igual em OUTRA empresa não é duplicata: cada empresa cria o seu, com o próprio empresaId', async () => {
    semear({ empresaId: EMP_B, nome: 'Cartão Triplex', gramatura: 250 })
    const r = await criarSuporteNc(EMP_A, { nome: 'Cartão Triplex', gramatura: 250, custoKg: 9 })
    expect(r.status).toBe(201)
    const novo = db.suportes.find((s) => s.empresaId === EMP_A)
    expect(novo).toBeDefined()
    expect(db.precos.find((p) => p.suporteId === novo!.id)?.empresaId).toBe(EMP_A)
  })

  it('SUPER_ADMIN com empresa A selecionada: confirmarExistente nunca devolve registro da empresa B', async () => {
    // O service recebe só o empresaId da sessão (a rota não usa prismaScoped), logo SUPER_ADMIN
    // tem o mesmo recorte de um usuário comum.
    semear({ empresaId: EMP_B, nome: 'Cartão Triplex', gramatura: 250 })
    const r = await criarSuporteNc(EMP_A, { nome: 'Cartão Triplex', gramatura: 250, custoKg: 9, confirmarExistente: true })
    expect(r.status).toBe(201)
    expect(db.suportes.filter((s) => s.empresaId === EMP_A)).toHaveLength(1)
  })
})

describe('normalizarNome', () => {
  it('ignora caixa, acento e espaços repetidos', () => {
    expect(normalizarNome('  Cartão   TRÍPLEX ')).toBe('cartao triplex')
  })
})
