/**
 * Testes das funções puras de roteiro (Fase 2). Usam o runner nativo
 * `node:test` (sem dependências novas no agente). Rodar após `npm run build`:
 *   node --test dist/calcgraf-reader/calcgraf-roteiro.test.js
 *
 * Golden case: OP 3000 (docs/calcgraf-mapeamento-roteiro-op.md).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  calcularSetupMin,
  calcularOperacaoMin,
  montarNomeEtapa,
  montarEtapaDTO,
  montarTextoTintas,
  montarProgramacaoDeLotes,
} from './calcgraf-roteiro'

test('calcularSetupMin = quantAcertos*tempoPorAcerto + tempoPrimeiroAcerto', () => {
  // OP 3000, impressão: 2 acertos * 30 + 0 = 60.
  assert.equal(calcularSetupMin({ quantAcertos: 2, tempoPorAcerto: 30, tempoPrimeiroAcerto: 0 }), 60)
  // Cortadeira: 1 * 0 + 15 = 15.
  assert.equal(calcularSetupMin({ quantAcertos: 1, tempoPorAcerto: 0, tempoPrimeiroAcerto: 15 }), 15)
  // Campos ausentes contam 0.
  assert.equal(calcularSetupMin({}), 0)
})

test('calcularOperacaoMin = tiragem / producaoHora * 60', () => {
  // OP 3000, impressão: 100000 / 2000 * 60 = 3000.
  assert.equal(calcularOperacaoMin({ tiragem: 100000, producaoHora: 2000 }), 3000)
  // Laminação: 100000 / 800 * 60 = 7500.
  assert.equal(calcularOperacaoMin({ tiragem: 100000, producaoHora: 800 }), 7500)
})

test('calcularOperacaoMin protege contra producaoHora inválida (sem divisão por zero)', () => {
  assert.equal(calcularOperacaoMin({ tiragem: 100000, producaoHora: 0 }), 0)
  assert.equal(calcularOperacaoMin({ tiragem: 100000 }), 0) // producaoHora ausente
  assert.equal(calcularOperacaoMin({ tiragem: 100000, producaoHora: -5 }), 0)
})

test('montarNomeEtapa combina atividade + centro com trim', () => {
  assert.equal(montarNomeEtapa('Offset Plana', 'Roland RZU 2cores'), 'Offset Plana Roland RZU 2cores')
  assert.equal(montarNomeEtapa('  Offset  ', ''), 'Offset')
  assert.equal(montarNomeEtapa('', 'Cortadeira'), 'Cortadeira')
  assert.equal(montarNomeEtapa('', ''), '')
})

test('montarEtapaDTO (golden OP 3000 — impressão)', () => {
  const dto = montarEtapaDTO(
    {
      tipo: 'I',
      itemSeq1: 0,
      itemSeq2: 0,
      atividadeNome: 'Offset Plana',
      centroNome: 'Roland RZU 2cores',
      quantAcertos: 2,
      tempoPorAcerto: 30,
      tempoPrimeiroAcerto: 0,
      producaoHora: 2000,
      tiragem: 100000,
    },
    0,
  )
  assert.equal(dto.tipo, 'I')
  assert.equal(dto.centro, 'Roland RZU 2cores')
  assert.equal(dto.descricao, 'Offset Plana Roland RZU 2cores')
  assert.equal(dto.setupMinutos, 60)
  assert.equal(dto.operacaoMinutos, 3000)
})

test('montarTextoTintas (golden OP 3000 — 2 tintas) normaliza o Pantone', () => {
  const txt = montarTextoTintas([
    { codTinta: 4, areaTinta: 85, ComplementoNome: 'AMARELO - 123C' },
    { codTinta: 5, areaTinta: 15, ComplementoNome: 'VERDE - CW0138' },
  ])
  assert.equal(txt, 'AMARELO 123C (85%), VERDE CW0138 (15%)')
})

test('montarTextoTintas vazio → string vazia', () => {
  assert.equal(montarTextoTintas([]), '')
})

// ── T6: centroCodigo na etapa (de-para no backend) ──

test('montarEtapaDTO emite centroCodigo quando presente (de-para)', () => {
  const dto = montarEtapaDTO(
    { tipo: 'A', centroNome: 'Cortadeira (Grande)', atividadeNome: 'Corte', centroCodigo: 42 },
    0,
  )
  assert.equal(dto.centroCodigo, '42')
})

test('montarEtapaDTO NÃO emite centroCodigo quando ausente/zero', () => {
  assert.equal(montarEtapaDTO({ centroNome: 'X', centroCodigo: 0 }, 0).centroCodigo, undefined)
  assert.equal(montarEtapaDTO({ centroNome: 'X' }, 0).centroCodigo, undefined)
  assert.equal(montarEtapaDTO({ centroNome: 'X', centroCodigo: '' }, 0).centroCodigo, undefined)
})

// ── T6: programação de entrega a partir dos lotes ──

test('montarProgramacaoDeLotes reúne todas as datas e ordena crescente', () => {
  const r = montarProgramacaoDeLotes([
    { tiragem: 1000000, dataPrometida: '2026-08-02T00:00:00.000Z', ordemFila: 2 },
    { tiragem: 1200000, dataPrometida: '2026-07-06T00:00:00.000Z', ordemFila: 1 },
  ])
  assert.ok(r)
  assert.equal(r?.length, 2)
  // Ordenado por data crescente: 06/07 antes de 02/08.
  assert.equal(r?.[0].data, '2026-07-06T00:00:00.000Z')
  assert.equal(r?.[0].quantidade, 1200000)
  assert.equal(r?.[1].data, '2026-08-02T00:00:00.000Z')
})

test('montarProgramacaoDeLotes ignora lotes SEM data (não inventa)', () => {
  const r = montarProgramacaoDeLotes([
    { tiragem: 500, dataPrometida: '2026-05-04T00:00:00.000Z' },
    { tiragem: 500 }, // sem data → ignorado
    { tiragem: 500, dataPrometida: '' }, // vazia → ignorado
  ])
  assert.equal(r?.length, 1)
  assert.equal(r?.[0].data, '2026-05-04T00:00:00.000Z')
})

test('montarProgramacaoDeLotes sem nenhuma data válida → undefined (fallback do backend)', () => {
  assert.equal(montarProgramacaoDeLotes([]), undefined)
  assert.equal(montarProgramacaoDeLotes([{ tiragem: 100 }]), undefined)
})
