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
  montarProgramacaoDeCalculo,
  agregarCoresPorPlano,
  montarPlanosDTO,
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

// ── Programação de entrega por CÁLCULO (CalculoProgEntrega — fonte do PDF) ──

test('montarProgramacaoDeCalculo: quantidade = Tiragem * Percentual / 100 (golden OP 3176: 40.000, 2x50%)', () => {
  // OP 3176 do PDF: "20.000 para 18/11, 20.000 para 21/12" (tiragem 40.000, 50% cada).
  const r = montarProgramacaoDeCalculo([
    { dataEntrega: '2026-12-21', tiragem: 40000, percentual: 50 },
    { dataEntrega: '2026-11-18', tiragem: 40000, percentual: 50 },
  ])
  assert.ok(r)
  assert.equal(r?.length, 2)
  // Ordenado por data crescente: 18/11 antes de 21/12.
  assert.equal(r?.[0].data, '2026-11-18')
  assert.equal(r?.[0].quantidade, 20000)
  assert.equal(r?.[1].data, '2026-12-21')
  assert.equal(r?.[1].quantidade, 20000)
})

test('montarProgramacaoDeCalculo: 4 parcelas de 25% de 40.000 = 10.000 cada (calc 15196)', () => {
  const r = montarProgramacaoDeCalculo([
    { dataEntrega: '2026-10-09', tiragem: 40000, percentual: 25 },
    { dataEntrega: '2026-11-02', tiragem: 40000, percentual: 25 },
    { dataEntrega: '2026-12-01', tiragem: 40000, percentual: 25 },
    { dataEntrega: '2026-12-01', tiragem: 40000, percentual: 25 },
  ])
  assert.equal(r?.length, 4)
  for (const e of r ?? []) assert.equal(e.quantidade, 10000)
})

test('montarProgramacaoDeCalculo: percentual 100 (parcela única) usa a tiragem cheia (calc 15193)', () => {
  const r = montarProgramacaoDeCalculo([{ dataEntrega: '2026-10-23', tiragem: 400, percentual: 100 }])
  assert.equal(r?.length, 1)
  assert.equal(r?.[0].quantidade, 400)
})

test('montarProgramacaoDeCalculo: percentual ausente/0 cai na tiragem direta', () => {
  const r = montarProgramacaoDeCalculo([{ dataEntrega: '2026-10-23', tiragem: 1680 }])
  assert.equal(r?.[0].quantidade, 1680)
})

test('montarProgramacaoDeCalculo: ignora linhas SEM data e → undefined quando nenhuma válida', () => {
  assert.equal(montarProgramacaoDeCalculo([]), undefined)
  assert.equal(montarProgramacaoDeCalculo([{ tiragem: 100, percentual: 50 }]), undefined)
  const r = montarProgramacaoDeCalculo([
    { dataEntrega: '2026-05-04', tiragem: 1000, percentual: 100 },
    { dataEntrega: '', tiragem: 1000, percentual: 50 },
  ])
  assert.equal(r?.length, 1)
})

test('montarProgramacaoDeCalculo: arredonda a quantidade (33,33% de 60.000 ≈ 20.000)', () => {
  const r = montarProgramacaoDeCalculo([
    { dataEntrega: '2026-10-13', tiragem: 60000, percentual: 66.6666666667 },
    { dataEntrega: '2026-11-13', tiragem: 60000, percentual: 33.3333333333 },
  ])
  assert.equal(r?.[0].quantidade, 40000)
  assert.equal(r?.[1].quantidade, 20000)
})

// ── T6b: cores por plano + planos/retiração (dados reais do backup) ──

test('agregarCoresPorPlano pega o MAX de coresF/coresV e OR do tiraRetira (2 linhas/plano)', () => {
  // Padrão real: 2 linhas por plano no CalculoAtvImpressao.
  const m = agregarCoresPorPlano([
    { codPlano: 1, coresF: 2, coresV: 0, tiraRetira: 0 },
    { codPlano: 1, coresF: 0, coresV: 0, tiraRetira: 0 },
  ])
  assert.equal(m.get('1')?.coresF, 2)
  assert.equal(m.get('1')?.coresV, 0)
  assert.equal(m.get('1')?.tiraRetira, false)
})

test('montarPlanosDTO plano ÚNICO sem retiração (OP 3000) → undefined (legado)', () => {
  // OP 3000 real: 1 plano "Impressos", 2x0, sem retiração.
  const cores = agregarCoresPorPlano([{ codPlano: 1, coresF: 2, coresV: 0 }])
  const r = montarPlanosDTO(
    [{ codPlano: 1, nomePlano: 'Impressos', dimensao1: 185, dimensao2: 1150, gramatura: 322, tiragem: 100000 }],
    cores,
  )
  assert.equal(r, undefined)
})

test('montarPlanosDTO multi-plano (OP 3133) → materializa 5 COMPONENTES com cores/formato', () => {
  // OP 3133 real: BOLSA/TAMPA/TAMPA/CAIXA/CAIXA; planos 15 e 17 com 4 cores.
  const cores = agregarCoresPorPlano([
    { codPlano: 15, coresF: 4, coresV: 0 },
    { codPlano: 17, coresF: 4, coresV: 0 },
  ])
  const r = montarPlanosDTO(
    [
      { codPlano: 14, nomePlano: 'BOLSA', dimensao1: 595, dimensao2: 419, tiragem: 5000 },
      { codPlano: 15, nomePlano: 'TAMPA', dimensao1: 224, dimensao2: 378, tiragem: 5000 },
      { codPlano: 16, nomePlano: 'TAMPA', dimensao1: 224, dimensao2: 378, tiragem: 5000 },
      { codPlano: 17, nomePlano: 'CAIXA', dimensao1: 278, dimensao2: 805, tiragem: 5000 },
      { codPlano: 18, nomePlano: 'CAIXA', dimensao1: 278, dimensao2: 805, tiragem: 5000 },
    ],
    cores,
  )
  assert.ok(r)
  assert.equal(r?.length, 5)
  const bolsa = r?.find((p) => p.nome === 'BOLSA')
  assert.equal(bolsa?.tipo, 'COMPONENTE')
  assert.equal(bolsa?.formato, '595x419')
  assert.equal(bolsa?.cores, '0x0')
  const tampa15 = r?.[1]
  assert.equal(tampa15.cores, '4x0')
  assert.equal(tampa15.retiracao, undefined) // sem verso
})

test('montarPlanosDTO plano ÚNICO COM retiração → materializa 1 FACE (frente/verso)', () => {
  // coresV > 0 → retiração; backend cria 2 FACES a partir desse plano.
  const cores = agregarCoresPorPlano([{ codPlano: 1, coresF: 7, coresV: 5 }])
  const r = montarPlanosDTO([{ codPlano: 1, nomePlano: 'Impressos', tiragem: 8250 }], cores)
  assert.ok(r)
  assert.equal(r?.length, 1)
  assert.equal(r?.[0].tipo, 'FACE')
  assert.equal(r?.[0].retiracao, true)
  assert.equal(r?.[0].cores, '7x5')
  assert.equal(r?.[0].coresFrente, '7x0')
  assert.equal(r?.[0].coresVerso, '5x0')
})
