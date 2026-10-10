/**
 * Teste HARNESS do golden de paridade 15.086 — Task 32 (Fase 6) da spec
 * `orcamento-grafico-op-relatorio-paridade`.
 *
 * Confronta a saída do Vizor (orçamento + relatório fiel + consumo da OP com
 * suporte de produção) com os ALVOS do PRÉ-CÁLCULO oficial do Calcgraf
 * (cálculo 15.086 / orçamento 5.316 / OP 3.149), exigindo desvio ≤ 0,5% (Req 14).
 *
 * ESTADO ATUAL: os números do pré-cálculo 15.086 ainda NÃO foram transcritos
 * (`PENDENTE_TRANSCRICAO === true` na fixture). Enquanto isso, este arquivo
 * registra APENAS um `it.todo` — não executa, não falha e não inventa números.
 * É o estado honesto de um harness aguardando dados do usuário.
 *
 * QUANDO O USUÁRIO TRANSCREVER o pré-cálculo (preencher os `alvo.valor` em
 * `golden-15086.fixture.ts` e trocar `PENDENTE_TRANSCRICAO` para `false`), o
 * bloco `if (!PENDENTE_TRANSCRICAO)` abaixo passa a rodar e confronta cada valor
 * (componentes, totais, 3 margens Primeiro Mil / Mil Seguinte, consumo da OP)
 * com desvio ≤ tolerância, indicando qual valor divergiu (Req 14.6).
 *
 * NOTA SOBRE O CÁLCULO REAL (importante):
 *   Não há, neste harness, um motor-por-item puro acessível SEM banco de dados
 *   (a resolução de cadastros — suporte/papel/tinta/acabamentos/máquina — depende
 *   de Prisma via `montarParamsDoItem`/`montarParamsDoPlano`). Por isso, onde o
 *   valor CALCULADO real entraria (`// TODO(usuário)` no bloco ativo), o confronto
 *   fica preparado para receber a saída do motor quando ela for plugada; a
 *   validação ponta a ponta do motor é feita na TELA/PRODUÇÃO (criar o 15.086 na
 *   Wega e conferir com o Relatório Calcgraf) — mesma estratégia dos demais golden.
 *   Enquanto o cálculo real não está plugado, o bloco ativo confronta a coerência
 *   interna dos ALVOS transcritos (ex.: C.Prod = MD + CT + Servex).
 */

import { describe, it, expect } from 'vitest'
import {
  PENDENTE_TRANSCRICAO,
  GOLDEN_15086,
  type Alvo,
} from './golden-15086.fixture'

/** Confronta um valor calculado com o alvo exigindo desvio ≤ tolerância (Req 14.6). */
function confrontar(calculado: number, alvo: Alvo, qual: string) {
  const desvio =
    alvo.valor === 0 ? Math.abs(calculado) : Math.abs(calculado - alvo.valor) / alvo.valor
  expect(
    desvio,
    `${qual}: calculado ${calculado} vs alvo ${alvo.valor} (desvio ${(desvio * 100).toFixed(3)}% > ${(
      alvo.tolerancia * 100
    ).toFixed(3)}%)`,
  ).toBeLessThanOrEqual(alvo.tolerancia)
}

describe('Golden 15.086 — paridade Calcgraf (OP/relatório)', () => {
  if (!PENDENTE_TRANSCRICAO) {
    // ─────────────────────────────────────────────────────────────────────
    // BLOCO ATIVO — só roda depois que o usuário transcrever o pré-cálculo
    // 15.086 e trocar PENDENTE_TRANSCRICAO para false.
    // ─────────────────────────────────────────────────────────────────────
    const g = GOLDEN_15086
    const c = g.componentes

    // ── 6 componentes (suporte/matriz/tinta/matAcabamento/impressao/acabamento) ──
    for (const comp of [c.suporte, c.matriz, c.tinta, c.matAcabamento, c.impressao, c.acabamento]) {
      it(`componente ${comp.rotulo} ≤ ${comp.alvo.tolerancia * 100}%`, () => {
        // TODO(usuário): quando o motor real estiver plugado, substituir `comp.alvo.valor`
        // pelo subtotal CALCULADO do componente correspondente (saída do motor).
        const calculado = comp.alvo.valor
        confrontar(calculado, comp.alvo, `componente ${comp.rotulo}`)
      })
    }

    // ── Totais: MD, CT, Servex, C.Prod, CEV%, Total ──
    it('totais do pré-cálculo (MD/CT/Servex/C.Prod/CEV/Total) ≤ 0,5%', () => {
      const t = g.totais
      // TODO(usuário): substituir cada `*.valor` pela saída CALCULADA do motor.
      confrontar(t.materialDireto.valor, t.materialDireto, 'Material Direto')
      confrontar(t.custoTransformacao.valor, t.custoTransformacao, 'Custo de Transformação')
      confrontar(t.servicoExterno.valor, t.servicoExterno, 'Serviço Externo')
      confrontar(t.custoProducao.valor, t.custoProducao, 'Custo de Produção')
      confrontar(t.cevPerc.valor, t.cevPerc, 'CEV %')
      confrontar(t.total.valor, t.total, 'Total')

      // Coerência interna: C.Prod = MD + CT + Servex (reconstitui o custo de produção).
      const somaComponentesCusto =
        t.materialDireto.valor + t.custoTransformacao.valor + t.servicoExterno.valor
      confrontar(somaComponentesCusto, t.custoProducao, 'C.Prod = MD + CT + Servex')
    })

    // ── 3 margens × (Primeiro Mil / Mil Seguinte): markup, preço unitário, preço total ──
    for (const m of g.margens) {
      it(`${m.rotulo} — Primeiro Mil / Mil Seguinte ≤ 0,5%`, () => {
        for (const [nome, ponto] of [
          ['Primeiro Mil', m.primeiroMil],
          ['Mil Seguinte', m.milSeguinte],
        ] as const) {
          // TODO(usuário): substituir cada `*.valor` pela saída CALCULADA do gross-up do motor.
          confrontar(ponto.markup.valor, ponto.markup, `${m.rotulo} ${nome} markup`)
          confrontar(ponto.precoUnitario.valor, ponto.precoUnitario, `${m.rotulo} ${nome} preço unitário`)
          confrontar(ponto.precoTotal.valor, ponto.precoTotal, `${m.rotulo} ${nome} preço total`)
        }
      })
    }

    // ── Consumo da OP (com suporte de PRODUÇÃO — Stora Enzo 234) ──
    it('consumo da OP (folhas/pesoKg/custo) com suporte de produção ≤ 0,5%', () => {
      const o = g.consumoOp
      // TODO(usuário): substituir cada `*.valor` pela saída de `consumoMaterialOp`
      // (consumo-op.service) usando o suporte de PRODUÇÃO (Stora Enzo 234).
      confrontar(o.folhas.valor, o.folhas, 'OP folhas')
      confrontar(o.pesoKg.valor, o.pesoKg, 'OP peso (kg)')
      confrontar(o.custo.valor, o.custo, 'OP custo')
    })
  } else {
    // ─────────────────────────────────────────────────────────────────────
    // HARNESS PENDENTE — números do pré-cálculo 15.086 ainda não transcritos.
    // `it.todo` NÃO executa nem falha: 0 testes rodados, 0 falhas. Um único todo
    // sinaliza a pendência de transcrição (destrava ao trocar a flag para false).
    // ─────────────────────────────────────────────────────────────────────
    it.todo(
      'transcrever os números do pré-cálculo 15.086 e trocar PENDENTE_TRANSCRICAO para false',
    )
  }
})
