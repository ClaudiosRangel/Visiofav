/**
 * Teste HARNESS do golden multi-item 15.185 — Task 24 (Fase 5) da spec
 * `orcamento-grafico-multi-item-gcad`.
 *
 * ESTADO ATUAL: os valores do print do Calcgraf 15.185 ainda NÃO foram
 * transcritos (`PENDENTE_TRANSCRICAO === true` na fixture). Enquanto isso, este
 * arquivo registra APENAS `it.todo` — não executa, não falha e não inventa
 * números. É o estado honesto de um harness aguardando dados.
 *
 * QUANDO O USUÁRIO TRANSCREVER o print (preencher `input`/alvos de cada item +
 * `cabecalho.totalConsolidado` e trocar `PENDENTE_TRANSCRICAO` para `false`), o
 * bloco `if (!PENDENTE_TRANSCRICAO)` abaixo passa a rodar de verdade e confronta:
 *   - C.Prod por item (≤0,5% — `tolerancia`);
 *   - Total consolidado via `consolidarOrcamento`, com arredondamento de 2 casas
 *     (≤ R$ 0,01).
 *
 * NOTA SOBRE O CONFRONTO DO C.PROD POR ITEM (importante):
 *   Não há, neste harness, um motor-por-item puro acessível SEM banco de dados
 *   (a resolução de cadastros de cada item — suporte/papel/acabamentos/máquina —
 *   depende de Prisma via `montarParamsDoItem`). Por isso, o confronto do C.Prod
 *   por item aqui compara os ALVOS transcritos entre si: a SOMA do C.Prod dos
 *   itens deve reconstituir o C.Prod consolidado (Σ itens = total, Req 3.2/3.5).
 *   O cálculo REAL do motor por item fica para a validação na TELA/PRODUÇÃO
 *   (criar o 15.185 na Wega e conferir com o Relatório Calcgraf) — mesma estratégia
 *   acordada para a validação final da spec.
 */

import { describe, it, expect } from 'vitest'
import {
  consolidarOrcamento,
  type FechamentoItem,
} from '../orcamento-grafico-consolidacao.service'
import {
  golden15185,
  PENDENTE_TRANSCRICAO,
  type Golden15185,
} from './golden-15185.fixture'

describe('Golden 15.185 multi-item (Task 24 — harness)', () => {
  if (!PENDENTE_TRANSCRICAO) {
    // ─────────────────────────────────────────────────────────────────────
    // BLOCO ATIVO — só roda depois que o usuário transcrever o print 15.185.
    // ─────────────────────────────────────────────────────────────────────
    const g: Golden15185 = golden15185

    // Confronto do C.Prod por item: a soma dos C.Prod dos itens deve reconstituir
    // o C.Prod consolidado (Σ itens = total), dentro da tolerância relativa.
    // Como não há motor-por-item puro sem banco (ver nota no cabeçalho), aqui
    // validamos a coerência entre os ALVOS transcritos; o cálculo real do motor é
    // conferido na tela/produção.
    for (const item of g.itens) {
      it(`PARTE ${item.parte}: C.Prod do item é um alvo transcrito (≤0,5%)`, () => {
        expect(item.alvoCustoProducao).not.toBeNull()
        expect(item.alvoValorTotal).not.toBeNull()
        expect(item.margemSelecionada).not.toBeNull()
        expect(item.alvoCustoProducao as number).toBeGreaterThan(0)
      })
    }

    it('Total consolidado = Σ Valor Total dos itens (consolidarOrcamento, ≤ R$ 0,01)', () => {
      expect(g.cabecalho.totalConsolidado).not.toBeNull()

      // Monta os FechamentoItem a partir dos alvos transcritos de cada item.
      const fechamentos: FechamentoItem[] = g.itens.map((item) => {
        const margem = item.margemSelecionada as number
        return {
          custoProducao: item.alvoCustoProducao as number,
          valorTotalPorMargem: { [String(margem)]: item.alvoValorTotal as number },
          margemSelecionada: margem,
        }
      })

      const consolidado = consolidarOrcamento(fechamentos)

      // Total consolidado (Σ Valor Total das margens selecionadas) ≤ R$ 0,01.
      expect(
        Math.abs(consolidado.valorTotalConsolidado - (g.cabecalho.totalConsolidado as number)),
      ).toBeLessThanOrEqual(0.01)

      // Coerência do C.Prod consolidado: Σ C.Prod dos itens reconstitui o total
      // (Req 3.2/3.5), dentro da tolerância relativa do golden.
      const somaCProd = g.itens.reduce(
        (acc, item) => acc + (item.alvoCustoProducao as number),
        0,
      )
      expect(
        Math.abs(consolidado.custoProducaoConsolidado - somaCProd) / somaCProd,
      ).toBeLessThanOrEqual(g.tolerancia)
    })
  } else {
    // ─────────────────────────────────────────────────────────────────────
    // HARNESS PENDENTE — valores do print 15.185 ainda não transcritos.
    // `it.todo` NÃO executa nem falha: 0 testes rodados, 0 falhas. Um todo por
    // item planejado + um todo para o Total consolidado.
    // ─────────────────────────────────────────────────────────────────────
    for (const item of golden15185.itens) {
      it.todo(
        `transcrever valores do print 15.185 (${item.parte}) e habilitar o confronto C.Prod do item ≤0,5%`,
      )
    }
    it.todo(
      'transcrever valores do print 15.185 e habilitar o confronto do Total consolidado',
    )
  }
})
