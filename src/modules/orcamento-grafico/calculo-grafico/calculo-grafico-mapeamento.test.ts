import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  calculoParaItemBody,
  itemBodyParaCalculo,
} from './calculo-grafico-mapeamento'
import type { CamposEngenhariaCalculo } from './calculo-grafico.types'

/**
 * Property tests do submódulo Biblioteca de Cálculos Gráficos — MAPEAMENTO PURO.
 *
 * Testa as funções PURAS `calculoParaItemBody` / `itemBodyParaCalculo`
 * (sem banco, sem motor de cálculo). Padrão do projeto: vitest + fast-check,
 * 100 iterações por property (default do fast-check).
 *
 * Mapeia Property 3 das Correctness Properties do design
 * (`.kiro/specs/biblioteca-calculos-graficos/design.md`).
 */

// ============================================================================
// ARBITRÁRIOS
// ============================================================================

/** Cor de impressão (shape `CorInput`), gerada de forma estável p/ round-trip. */
const arbCor = fc.record({
  nome: fc.string({ minLength: 1, maxLength: 20 }),
  tipo: fc.constantFrom('CMYK' as const, 'PANTONE' as const),
  coberturaPercent: fc.integer({ min: 0, max: 100 }),
  precoKg: fc.double({ min: 0, max: 500, noNaN: true, noDefaultInfinity: true }),
  rendimentoM2Kg: fc.double({ min: 0, max: 30000, noNaN: true, noDefaultInfinity: true }),
})

/** Acabamento rico — subconjunto de campos tolerante (todos opcionais). */
const arbAcabamentoRico = fc.record(
  {
    nome: fc.string({ minLength: 1, maxLength: 30 }),
    naturezaCusto: fc.constantFrom(
      'HORA_MAQUINA' as const,
      'MATERIAL_KG' as const,
      'MATERIAL_UN' as const,
      'CUSTO_FIXO' as const,
    ),
    valorFixo: fc.double({ min: 0, max: 5000, noNaN: true, noDefaultInfinity: true }),
  },
  { requiredKeys: ['nome'] },
)

const arbItemDiverso = fc.record({
  descricao: fc.string({ minLength: 1, maxLength: 30 }),
  quantidade: fc.integer({ min: 0, max: 1000 }),
  valor: fc.double({ min: 0, max: 5000, noNaN: true, noDefaultInfinity: true }),
  fixo: fc.boolean(),
})

const arbItemFornecido = fc.record({
  descricao: fc.string({ minLength: 1, maxLength: 30 }),
  quantidade: fc.integer({ min: 0, max: 1000 }),
})

const arbCampoLivre = fc.record({
  rotulo: fc.string({ minLength: 1, maxLength: 20 }),
  conteudo: fc.string({ maxLength: 40 }),
})

/** `medidas` — Record<string, number> pequeno. */
const arbMedidas = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 5 }),
  fc.double({ min: 0, max: 2000, noNaN: true, noDefaultInfinity: true }),
  { maxKeys: 4 },
)

/** String opcional (string|null) usada nos campos nuláveis. */
const arbStrNull = fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: null })

/** Número opcional (number|null) genérico. */
const arbNumNull = fc.option(
  fc.double({ min: 0, max: 10000, noNaN: true, noDefaultInfinity: true }),
  { nil: null },
)

/**
 * Matriz: AMBOS os campos presentes OU AMBOS null — porque o mapeamento só monta
 * o objeto `matriz` quando quantidade E precoUnitario existem (caso contrário
 * matriz = null, e o round-trip calc→body→calc preserva apenas quando coerente).
 */
const arbMatriz = fc.oneof(
  fc.record({
    matrizQuantidade: fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
    matrizPrecoUnitario: fc.double({ min: 0, max: 5000, noNaN: true, noDefaultInfinity: true }),
  }),
  fc.constant({ matrizQuantidade: null, matrizPrecoUnitario: null }),
)

/**
 * Tinta: em {null, COBERTURA, CONSUMO_DIRETO}, com `tintaConsumoKg` coerente.
 * No modo CONSUMO_DIRETO o consumo é um número >= 0; nos demais é null
 * (como o próprio mapeamento normaliza).
 */
const arbTinta = fc.oneof(
  fc.constant({ tintaModo: null, tintaConsumoKg: null }),
  fc.constant({ tintaModo: 'COBERTURA' as const, tintaConsumoKg: null }),
  fc.record({
    tintaModo: fc.constant('CONSUMO_DIRETO' as const),
    tintaConsumoKg: fc.double({ min: 0, max: 500, noNaN: true, noDefaultInfinity: true }),
  }),
)

/**
 * Gera um `CamposEngenhariaCalculo` arbitrário VÁLIDO para o round-trip exato.
 *
 * Nota de round-trip (do próprio arquivo de mapeamento): o body de item exige
 * `gramatura: number`, enquanto no cálculo é `number|null`. Geramos gramatura
 * como número > 0 para que calc→body→calc seja igualdade EXATA (um cálculo
 * válido criado a partir de um body sempre tem gramatura numérica).
 */
const arbCalculo: fc.Arbitrary<CamposEngenhariaCalculo> = fc
  .record({
    tipoEmbalagemId: fc.string({ minLength: 1, maxLength: 36 }),
    descricao: arbStrNull,
    medidas: arbMedidas,
    papelId: arbStrNull,
    papelDescricao: arbStrNull,
    suporteId: arbStrNull,
    // gramatura > 0 (ver nota acima) para o round-trip ser exato.
    gramatura: fc.double({ min: 1, max: 600, noNaN: true, noDefaultInfinity: true }),
    numCores: fc.integer({ min: 0, max: 8 }),
    cores: fc.option(fc.array(arbCor, { maxLength: 4 }), { nil: null }),
    maquinaId: arbStrNull,
    matriz: arbMatriz,
    tinta: arbTinta,
    acabamentosRicos: fc.option(fc.array(arbAcabamentoRico, { maxLength: 4 }), { nil: null }),
    modeloFacaId: arbStrNull,
    aproveitamentoManual: arbNumNull,
    montagemLinhas: arbNumNull,
    montagemColunas: arbNumNull,
    formatoCorteLarguraMm: arbNumNull,
    formatoCorteAlturaMm: arbNumNull,
    itensDiversos: fc.option(fc.array(arbItemDiverso, { maxLength: 3 }), { nil: null }),
    itensFornecidos: fc.option(fc.array(arbItemFornecido, { maxLength: 3 }), { nil: null }),
    camposLivres: fc.option(fc.array(arbCampoLivre, { maxLength: 3 }), { nil: null }),
    quantidade: fc.integer({ min: 1, max: 5_000_000 }),
    margemSelecionada: arbNumNull,
  })
  .map((r) => {
    const { matriz, tinta, ...rest } = r
    return {
      ...rest,
      matrizQuantidade: matriz.matrizQuantidade,
      matrizPrecoUnitario: matriz.matrizPrecoUnitario,
      tintaModo: tinta.tintaModo,
      tintaConsumoKg: tinta.tintaConsumoKg,
    } as CamposEngenhariaCalculo
  })

// ============================================================================
// PROPERTY 3 — Round-trip biblioteca ↔ item do orçamento
// ============================================================================

describe('calculo-grafico-mapeamento — Property 3 (round-trip)', () => {
  // Feature: biblioteca-calculos-graficos, Property 3: Round-trip do mapeamento biblioteca ↔ item do orçamento — para todo Cálculo Gráfico válido, aplicar calculoParaItemBody e em seguida itemBodyParaCalculo reproduz um cálculo equivalente em todos os campos de engenharia.
  it('itemBodyParaCalculo(calculoParaItemBody(calc)) === calc (campos de engenharia)', () => {
    fc.assert(
      fc.property(arbCalculo, (calc) => {
        const round = itemBodyParaCalculo(calculoParaItemBody(calc))
        expect(round).toEqual(calc)
      }),
    )
  })

  // Feature: biblioteca-calculos-graficos, Property 3: Round-trip do mapeamento biblioteca ↔ item do orçamento — o sentido calc→body→calc é exato campo a campo (matriz e tinta reconstruídas corretamente).
  it('round-trip preserva matriz e tinta campo a campo', () => {
    fc.assert(
      fc.property(arbCalculo, (calc) => {
        const round = itemBodyParaCalculo(calculoParaItemBody(calc))
        // Matriz: ambos os campos preservados exatamente.
        expect(round.matrizQuantidade).toEqual(calc.matrizQuantidade)
        expect(round.matrizPrecoUnitario).toEqual(calc.matrizPrecoUnitario)
        // Tinta: modo e consumo preservados (o precoKg da tinta não é campo do
        // cálculo, logo não participa do round-trip calc→body→calc).
        expect(round.tintaModo).toEqual(calc.tintaModo)
        expect(round.tintaConsumoKg).toEqual(calc.tintaConsumoKg)
      }),
    )
  })

  // Feature: biblioteca-calculos-graficos, Property 3: Round-trip do mapeamento biblioteca ↔ item do orçamento — caso específico tinta CONSUMO_DIRETO com consumoKg definido.
  it('round-trip com tinta CONSUMO_DIRETO + consumoKg definido', () => {
    fc.assert(
      fc.property(
        arbCalculo,
        fc.double({ min: 0, max: 500, noNaN: true, noDefaultInfinity: true }),
        (base, consumo) => {
          const calc: CamposEngenhariaCalculo = {
            ...base,
            tintaModo: 'CONSUMO_DIRETO',
            tintaConsumoKg: consumo,
          }
          const body = calculoParaItemBody(calc)
          // O body reconstrói a tinta como objeto CONSUMO_DIRETO com precoKg 0
          // (precoKg não é persistido no cálculo — ver doc do mapeamento).
          expect(body.tinta).toEqual({
            modo: 'CONSUMO_DIRETO',
            consumoKg: consumo,
            precoKg: 0,
          })
          const round = itemBodyParaCalculo(body)
          expect(round.tintaModo).toBe('CONSUMO_DIRETO')
          expect(round.tintaConsumoKg).toEqual(consumo)
          expect(round).toEqual(calc)
        },
      ),
    )
  })
})

// ============================================================================
// Teste determinístico (documenta o shape — matriz + tinta CONSUMO_DIRETO)
// ============================================================================

describe('calculo-grafico-mapeamento — exemplo determinístico (shape)', () => {
  it('monta matriz como objeto e tinta CONSUMO_DIRETO com precoKg reconstruído 0', () => {
    const calc: CamposEngenhariaCalculo = {
      tipoEmbalagemId: 'uuid-emb-1',
      descricao: 'RÓTULO EXEMPLO',
      medidas: { L: 200, A: 300 },
      papelId: 'uuid-papel-1',
      papelDescricao: 'Nz Bobina 325',
      suporteId: 'uuid-suporte-1',
      gramatura: 325,
      numCores: 3,
      cores: [
        { nome: 'Pantone 01', tipo: 'PANTONE', coberturaPercent: 50, precoKg: 65, rendimentoM2Kg: 12000 },
      ],
      maquinaId: 'uuid-roland-rvu',
      matrizQuantidade: 3,
      matrizPrecoUnitario: 100,
      tintaModo: 'CONSUMO_DIRETO',
      tintaConsumoKg: 321.58,
      acabamentosRicos: [{ nome: 'Cortadeira (Grande)' }],
      modeloFacaId: null,
      aproveitamentoManual: 1334,
      montagemLinhas: null,
      montagemColunas: null,
      formatoCorteLarguraMm: 613,
      formatoCorteAlturaMm: 1210,
      itensDiversos: [{ descricao: 'BOPP', quantidade: 1, valor: 544.21, fixo: true }],
      itensFornecidos: null,
      camposLivres: null,
      quantidade: 4000,
      margemSelecionada: 30,
    }

    const body = calculoParaItemBody(calc)

    // Matriz vira objeto.
    expect(body.matriz).toEqual({ quantidade: 3, precoUnitario: 100 })
    // Tinta CONSUMO_DIRETO: precoKg reconstruído como 0.
    expect(body.tinta).toEqual({ modo: 'CONSUMO_DIRETO', consumoKg: 321.58, precoKg: 0 })
    // Gramatura numérica passa direto.
    expect(body.gramatura).toBe(325)

    // Round-trip exato de volta ao cálculo.
    expect(itemBodyParaCalculo(body)).toEqual(calc)
  })

  it('matriz null quando apenas um dos campos existe (não monta objeto)', () => {
    const calc: CamposEngenhariaCalculo = {
      tipoEmbalagemId: 'uuid-emb-2',
      descricao: null,
      medidas: {},
      papelId: null,
      papelDescricao: null,
      suporteId: null,
      gramatura: 300,
      numCores: 0,
      cores: null,
      maquinaId: null,
      matrizQuantidade: 5,
      matrizPrecoUnitario: null, // só um campo → body.matriz deve ser null
      tintaModo: 'COBERTURA',
      tintaConsumoKg: null,
      acabamentosRicos: null,
      modeloFacaId: null,
      aproveitamentoManual: null,
      montagemLinhas: null,
      montagemColunas: null,
      formatoCorteLarguraMm: null,
      formatoCorteAlturaMm: null,
      itensDiversos: null,
      itensFornecidos: null,
      camposLivres: null,
      quantidade: 1000,
      margemSelecionada: null,
    }

    const body = calculoParaItemBody(calc)
    expect(body.matriz).toBeNull()
    expect(body.tinta).toEqual({ modo: 'COBERTURA' })

    // O round-trip normaliza: como body.matriz é null, ambos voltam null.
    const round = itemBodyParaCalculo(body)
    expect(round.matrizQuantidade).toBeNull()
    expect(round.matrizPrecoUnitario).toBeNull()
  })
})
