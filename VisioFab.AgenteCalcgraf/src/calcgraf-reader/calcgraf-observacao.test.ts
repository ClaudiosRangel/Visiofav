/**
 * Testes da query de OBSERVAÇÃO da OP (memo TabelaMemos) — Bloco 3 do spec
 * op-visualizacao-observacoes-calcgraf. Usam o runner nativo `node:test`.
 * Rodar após `npm run build`:
 *   node --test dist/calcgraf-reader/calcgraf-observacao.test.js
 *
 * A observação textual da OP (Serviço Novo/Repetição + bobinas "em estoque/
 * encomendado (N kg)" + LXL + Montagem) vive em `TabelaMemos` com
 * NomeTabela='CalculoOp' e Codigo=<CalcCodigo>. O reader lê esse memo e envia
 * ao backend em `observacaoTexto`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { montarQueryObservacaoOp, montarQueryProgEntregaCalculo, assertSomenteLeitura } from './calcgraf-reader'

test('montarQueryObservacaoOp seleciona Memo de TabelaMemos por CalculoOp', () => {
  const sql = montarQueryObservacaoOp([15196, 15193])
  // Filtra pela área correta (CalculoOp) e pelos códigos de cálculo.
  assert.match(sql, /FROM\s+TabelaMemos/i)
  assert.match(sql, /NomeTabela\s*=\s*'CalculoOp'/i)
  assert.match(sql, /Codigo\s+IN\s*\(15196,\s*15193\)/i)
  // Converte o ntext em nvarchar(max) para o driver trazer como string.
  assert.match(sql, /CAST\(Memo AS nvarchar\(max\)\)\s+AS memo/i)
  // Alias do código de cálculo.
  assert.match(sql, /Codigo AS CalcCodigo/i)
})

test('montarQueryObservacaoOp trunca os códigos (sem SQL injection via número)', () => {
  const sql = montarQueryObservacaoOp([15196.9, 100.1])
  assert.match(sql, /IN\s*\(15196,\s*100\)/)
})

test('a query de observação passa pelo guardião somente-leitura', () => {
  // Não deve lançar — é um SELECT puro.
  assert.doesNotThrow(() => assertSomenteLeitura(montarQueryObservacaoOp([1, 2, 3])))
})

test('montarQueryProgEntregaCalculo seleciona CalculoProgEntrega (fonte do PDF)', () => {
  const sql = montarQueryProgEntregaCalculo([15023, 15196])
  assert.match(sql, /FROM\s+CalculoProgEntrega/i)
  assert.match(sql, /Codigo AS CalcCodigo/i)
  assert.match(sql, /Tiragem/i)
  assert.match(sql, /Percentual/i)
  assert.match(sql, /DataEntrega/i)
  assert.match(sql, /Codigo\s+IN\s*\(15023,\s*15196\)/i)
})

test('a query de prog. entrega passa pelo guardião somente-leitura', () => {
  assert.doesNotThrow(() => assertSomenteLeitura(montarQueryProgEntregaCalculo([1, 2])))
})
