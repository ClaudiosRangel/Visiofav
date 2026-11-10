import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { calculoParaItemBody } from './calculo-grafico-mapeamento'
import type { ItemBodyMapeado } from './calculo-grafico-mapeamento'
import type { CamposEngenhariaCalculo } from './calculo-grafico.types'
import { bodyParaItemOrcamentoInput } from './calculo-grafico.service'

/**
 * Property test do submódulo Biblioteca de Cálculos Gráficos — DERIVAÇÃO DO
 * INPUT DO MOTOR a partir do body mapeado.
 *
 * Spec: orcamento-grafico-experiencia-calcgraf (design Property 3; Req 3.6, 4.6).
 *
 * `bodyParaItemOrcamentoInput` converte o `ItemBodyMapeado` (saída de
 * `calculoParaItemBody`) no `ItemOrcamentoInput` que o motor consome. O único
 * Campo_Técnico que trafega pelo shape de engenharia/body é `siglaAcabado`
 * (paridade Calcgraf) — e ele NÃO pode ir ao input do motor nem alterar
 * qualquer outro campo do input. Logo, variar `siglaAcabado` (incl. null/
 * undefined/strings quaisquer) deve produzir um `ItemOrcamentoInput` IDÊNTICO.
 *
 * Padrão do projeto: vitest + fast-check, ≥100 iterações (default do fast-check).
 */

// ============================================================================
// ARBITRÁRIOS
// ============================================================================

const arbCor = fc.record({
  nome: fc.string({ minLength: 1, maxLength: 20 }),
  tipo: fc.constantFrom('CMYK' as const, 'PANTONE' as const),
  coberturaPercent: fc.integer({ min: 0, max: 100 }),
  precoKg: fc.double({ min: 0, max: 500, noNaN: true, noDefaultInfinity: true }),
  rendimentoM2Kg: fc.double({ min: 0, max: 30000, noNaN: true, noDefaultInfinity: true }),
})

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

const arbMedidas = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 5 }),
  fc.double({ min: 0, max: 2000, noNaN: true, noDefaultInfinity: true }),
  { maxKeys: 4 },
)

const arbStrNull = fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: null })
const arbNumNull = fc.option(
  fc.double({ min: 0, max: 10000, noNaN: true, noDefaultInfinity: true }),
  { nil: null },
)

const arbMatriz = fc.oneof(
  fc.record({
    matrizQuantidade: fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
    matrizPrecoUnitario: fc.double({ min: 0, max: 5000, noNaN: true, noDefaultInfinity: true }),
  }),
  fc.constant({ matrizQuantidade: null, matrizPrecoUnitario: null }),
)

const arbTinta = fc.oneof(
  fc.constant({ tintaModo: null, tintaConsumoKg: null }),
  fc.constant({ tintaModo: 'COBERTURA' as const, tintaConsumoKg: null }),
  fc.record({
    tintaModo: fc.constant('CONSUMO_DIRETO' as const),
    tintaConsumoKg: fc.double({ min: 0, max: 500, noNaN: true, noDefaultInfinity: true }),
  }),
)

/**
 * Engenharia arbitrária VÁLIDA, SEM o campo `siglaAcabado` (ele é variado
 * separadamente na property). `gramatura > 0` para coerência com o body.
 */
const arbEngenhariaBase: fc.Arbitrary<Omit<CamposEngenhariaCalculo, 'siglaAcabado'>> = fc
  .record({
    tipoEmbalagemId: fc.string({ minLength: 1, maxLength: 36 }),
    descricao: arbStrNull,
    medidas: arbMedidas,
    papelId: arbStrNull,
    papelDescricao: arbStrNull,
    suporteId: arbStrNull,
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
    } as Omit<CamposEngenhariaCalculo, 'siglaAcabado'>
  })

/**
 * Valor arbitrário para `siglaAcabado`: null, undefined ou qualquer string
 * (inclui vazia) — cobre todo o espaço do Campo_Técnico copiável.
 */
const arbSiglaAcabado = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.string({ maxLength: 60 }),
)

// ============================================================================
// PROPERTY 3 — Campos técnicos não afetam o input do motor
// ============================================================================

describe('bodyParaItemOrcamentoInput — Property 3 (técnicos não afetam o input)', () => {
  // Feature: orcamento-grafico-experiencia-calcgraf, Property 3: Campos técnicos não afetam o input nem o resultado do cálculo — para toda engenharia fixa e todo valor de siglaAcabado (incl. null/undefined/strings), o ItemOrcamentoInput derivado por bodyParaItemOrcamentoInput é idêntico (a Sigla Acabado não aparece no input e não muda nenhum outro campo).
  it('variar siglaAcabado não altera o ItemOrcamentoInput derivado', () => {
    fc.assert(
      fc.property(
        arbEngenhariaBase,
        arbSiglaAcabado,
        arbSiglaAcabado,
        (engBase, siglaA, siglaB) => {
          // Mesma engenharia, duas siglas distintas (incl. null/undefined/string).
          const calcA: CamposEngenhariaCalculo = { ...engBase, siglaAcabado: siglaA }
          const calcB: CamposEngenhariaCalculo = { ...engBase, siglaAcabado: siglaB }

          const bodyA: ItemBodyMapeado = calculoParaItemBody(calcA)
          const bodyB: ItemBodyMapeado = calculoParaItemBody(calcB)

          const inputA = bodyParaItemOrcamentoInput(bodyA)
          const inputB = bodyParaItemOrcamentoInput(bodyB)

          // O input do motor é IDÊNTICO independentemente da Sigla Acabado.
          expect(inputA).toEqual(inputB)
        },
      ),
    )
  })

  // Feature: orcamento-grafico-experiencia-calcgraf, Property 3: Campos técnicos não afetam o input nem o resultado do cálculo — a chave siglaAcabado (nem qualquer outro Campo_Técnico) existe no ItemOrcamentoInput produzido.
  it('siglaAcabado nunca aparece como chave do ItemOrcamentoInput', () => {
    fc.assert(
      fc.property(arbEngenhariaBase, arbSiglaAcabado, (engBase, sigla) => {
        const calc: CamposEngenhariaCalculo = { ...engBase, siglaAcabado: sigla }
        const input = bodyParaItemOrcamentoInput(calculoParaItemBody(calc))
        const chaves = Object.keys(input)
        // Nenhum Campo_Técnico vaza para o input do motor.
        for (const tecnico of [
          'siglaAcabado',
          'tributacao',
          'processoImpressao',
          'coberturaTintaTexto',
          'fabricante',
          'qtdModelos',
          'arte',
          'microondulado',
          'fornecido',
          'observacao',
          'observacaoAreasOp',
          'acondicionamento',
          'conteudoVolume',
        ]) {
          expect(chaves).not.toContain(tecnico)
        }
      }),
    )
  })
})

// ============================================================================
// Exemplo determinístico (documenta a invariância)
// ============================================================================

describe('bodyParaItemOrcamentoInput — exemplo determinístico', () => {
  it('mesma engenharia com siglaAcabado diferente → input idêntico', () => {
    const base: Omit<CamposEngenhariaCalculo, 'siglaAcabado'> = {
      tipoEmbalagemId: 'uuid-emb-1',
      descricao: 'CARTUCHO EXEMPLO',
      medidas: { L: 200, A: 300 },
      papelId: 'uuid-papel-1',
      papelDescricao: 'Stora Enzo 415',
      suporteId: 'uuid-suporte-1',
      gramatura: 415,
      numCores: 3,
      cores: [
        { nome: 'Pantone 01', tipo: 'PANTONE', coberturaPercent: 50, precoKg: 65, rendimentoM2Kg: 12000 },
      ],
      maquinaId: 'uuid-roland',
      matrizQuantidade: 3,
      matrizPrecoUnitario: 100,
      tintaModo: 'COBERTURA',
      tintaConsumoKg: null,
      acabamentosRicos: [{ nome: 'Cortadeira (Grande)' }],
      modeloFacaId: null,
      aproveitamentoManual: 1334,
      montagemLinhas: null,
      montagemColunas: null,
      formatoCorteLarguraMm: 650,
      formatoCorteAlturaMm: 910,
      itensDiversos: [{ descricao: 'BOPP', quantidade: 1, valor: 544.21, fixo: true }],
      itensFornecidos: null,
      camposLivres: null,
      quantidade: 50000,
      margemSelecionada: 30,
    }

    const inputComSigla = bodyParaItemOrcamentoInput(
      calculoParaItemBody({ ...base, siglaAcabado: 'CTC' }),
    )
    const inputSemSigla = bodyParaItemOrcamentoInput(
      calculoParaItemBody({ ...base, siglaAcabado: null }),
    )

    expect(inputComSigla).toEqual(inputSemSigla)
    expect(Object.keys(inputComSigla)).not.toContain('siglaAcabado')
  })
})
