/**
 * Testes do motor PURO de status fiel (spec comercial-pedido-status-fiel).
 * Unit + property-based (Vitest + fast-check). Cobre as Correctness Properties
 * P1–P9 do design.
 *
 * Rodar: npx vitest run src/modules/orcamento-grafico/pedido-proposta/status-fiel.motor.test.ts --reporter=dot
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  SITUACOES_VALIDAS,
  ESTADOS_LEGADOS_VALIDOS,
  SETORES_VALIDOS,
  TRANSICOES,
  statusMacroDe,
  setorDe,
  isTerminal,
  estadoLegadoDe,
  situacaoDeEstadoLegado,
  derivarTipoPedido,
  caminhoPreImpressao,
  exigenciasDoTipo,
  situacaoFacaDoTexto,
  converterTipoLegado,
  transicoesPermitidas,
  validarTransicao,
  validarRetorno,
  classeDaTransicao,
  StatusFielError,
  type Situacao,
  type TipoPedido,
  type SituacaoFaca,
  type SituacaoArte,
} from './status-fiel.motor'

const TIPOS: TipoPedido[] = ['REPETICAO', 'ALTERACAO', 'PRODUTO_NOVO']
const FACAS: SituacaoFaca[] = ['NOVA', 'EXISTENTE', 'NAO_INFORMADA']
const ARTES: SituacaoArte[] = [
  'CRIAR',
  'CLIENTE_ENVIA',
  'EXISTENTE_SEM_ALTERACAO',
  'EXISTENTE_COM_ALTERACAO',
  'NAO_INFORMADA',
]

const arbSituacao = fc.constantFrom(...SITUACOES_VALIDAS)
const arbTipo = fc.constantFrom(...TIPOS)
const arbFaca = fc.constantFrom(...FACAS)
const arbArte = fc.constantFrom(...ARTES)

// ============================================================================
// Catálogo e mapeamentos
// ============================================================================

describe('catálogo de Situacoes_Internas', () => {
  it('tem exatamente 12 situações', () => {
    expect(SITUACOES_VALIDAS).toHaveLength(12)
  })

  it('cada situação tem Status_Macro definido e setor dentro do conjunto válido ou null', () => {
    for (const s of SITUACOES_VALIDAS) {
      expect(statusMacroDe(s)).toBeTruthy()
      const setor = setorDe(s)
      if (setor !== null) expect(SETORES_VALIDOS).toContain(setor)
    }
  })

  it('terminais (FATURADO/PERDIDO/CANCELADO) têm setor nulo (Req 5.6)', () => {
    for (const s of ['FATURADO', 'PERDIDO', 'CANCELADO'] as Situacao[]) {
      expect(isTerminal(s)).toBe(true)
      expect(setorDe(s)).toBeNull()
    }
  })
})

// P9 — cada Estado_Legado → Situacao + Status definidos (Req 16.4)
describe('P9 — mapeamento dos 8 Estado_Legado', () => {
  it('cada um dos 8 estados legados resolve em situação e status definidos', () => {
    for (const e of ESTADOS_LEGADOS_VALIDOS) {
      const s = situacaoDeEstadoLegado(e)
      expect(SITUACOES_VALIDAS).toContain(s)
      expect(statusMacroDe(s)).toBeTruthy()
    }
  })

  it('round-trip situação→estado→situação cai num estado coerente', () => {
    fc.assert(
      fc.property(arbSituacao, (s) => {
        const legado = estadoLegadoDe(s)
        expect(ESTADOS_LEGADOS_VALIDOS).toContain(legado)
      }),
    )
  })
})

// ============================================================================
// P1 — idempotência da derivação do Status_Macro (Req 3.10)
// ============================================================================

describe('P1 — statusMacroDe idempotente', () => {
  it('aplicar duas vezes dá o mesmo resultado', () => {
    fc.assert(
      fc.property(arbSituacao, (s) => {
        const a = statusMacroDe(s)
        const b = statusMacroDe(s)
        expect(a).toBe(b)
      }),
    )
  })
})

// ============================================================================
// P6 — totalidade de derivarTipoPedido (Req 1.16)
// ============================================================================

describe('P6 — derivarTipoPedido é total e determinística', () => {
  it('toda combinação (faca × arte × prova) produz exatamente um tipo válido', () => {
    fc.assert(
      fc.property(arbFaca, arbArte, fc.boolean(), (faca, arte, prova) => {
        const r = derivarTipoPedido({ situacaoFaca: faca, situacaoArte: arte, exigeProva: prova })
        expect(TIPOS).toContain(r.tipo)
        // determinismo
        const r2 = derivarTipoPedido({ situacaoFaca: faca, situacaoArte: arte, exigeProva: prova })
        expect(r2.tipo).toBe(r.tipo)
        expect(r2.aConfirmar).toBe(r.aConfirmar)
      }),
    )
  })

  it('regras da tabela (a/b/c/d)', () => {
    expect(derivarTipoPedido({ situacaoFaca: 'NOVA', situacaoArte: 'EXISTENTE_SEM_ALTERACAO' }).tipo).toBe('PRODUTO_NOVO')
    expect(derivarTipoPedido({ situacaoFaca: 'EXISTENTE', situacaoArte: 'CRIAR' }).tipo).toBe('PRODUTO_NOVO')
    expect(derivarTipoPedido({ situacaoFaca: 'EXISTENTE', situacaoArte: 'EXISTENTE_COM_ALTERACAO' }).tipo).toBe('ALTERACAO')
    expect(derivarTipoPedido({ situacaoFaca: 'EXISTENTE', situacaoArte: 'CLIENTE_ENVIA' }).tipo).toBe('ALTERACAO')
    expect(derivarTipoPedido({ situacaoFaca: 'EXISTENTE', situacaoArte: 'EXISTENTE_SEM_ALTERACAO' }).tipo).toBe('REPETICAO')
  })

  it('respostas incompletas (NAO_INFORMADA) sem decidir por PRODUTO_NOVO ⇒ aConfirmar', () => {
    const r = derivarTipoPedido({ situacaoFaca: 'NAO_INFORMADA', situacaoArte: 'NAO_INFORMADA' })
    expect(r.tipo).toBe('PRODUTO_NOVO')
    expect(r.aConfirmar).toBe(true)
  })

  it('faca NOVA com arte não informada decide PRODUTO_NOVO sem aConfirmar', () => {
    const r = derivarTipoPedido({ situacaoFaca: 'NOVA', situacaoArte: 'NAO_INFORMADA' })
    expect(r.tipo).toBe('PRODUTO_NOVO')
    expect(r.aConfirmar).toBe(false)
  })
})

// ============================================================================
// Caminho e exigências (Req 2)
// ============================================================================

describe('caminho e exigências por tipo', () => {
  it('caminho por tipo', () => {
    expect(caminhoPreImpressao('REPETICAO')).toBe('CONFERENCIA')
    expect(caminhoPreImpressao('ALTERACAO')).toBe('PARCIAL')
    expect(caminhoPreImpressao('PRODUTO_NOVO')).toBe('COMPLETA')
  })

  it('nenhum tipo dispensa pré-impressão, cálculo e aprovação de arte', () => {
    fc.assert(
      fc.property(arbTipo, fc.boolean(), (tipo, prova) => {
        const ex = exigenciasDoTipo(tipo, prova)
        expect(ex.preImpressao).toBe(true)
        expect(ex.calculo).toBe(true)
        expect(ex.aprovacaoArte).toBe(true)
        expect(ex.prova).toBe(prova)
      }),
    )
  })
})

// ============================================================================
// Heurística da faca (Req 4.5)
// ============================================================================

describe('situacaoFacaDoTexto', () => {
  it('casos conhecidos', () => {
    expect(situacaoFacaDoTexto(null)).toBe('NAO_INFORMADA')
    expect(situacaoFacaDoTexto('')).toBe('NAO_INFORMADA')
    expect(situacaoFacaDoTexto('-')).toBe('NAO_INFORMADA')
    expect(situacaoFacaDoTexto('não sei')).toBe('NAO_INFORMADA')
    expect(situacaoFacaDoTexto('faca nova')).toBe('NOVA')
    expect(situacaoFacaDoTexto('Tudo novo')).toBe('NOVA')
    expect(situacaoFacaDoTexto('tem na casa')).toBe('EXISTENTE')
    expect(situacaoFacaDoTexto('repetição do pedido anterior')).toBe('EXISTENTE')
    expect(situacaoFacaDoTexto('Matriz 2529B - COM BRAILLE')).toBe('EXISTENTE')
    expect(situacaoFacaDoTexto('M12')).toBe('EXISTENTE')
    expect(situacaoFacaDoTexto('na Wega')).toBe('EXISTENTE')
  })

  it('sempre retorna um valor válido', () => {
    fc.assert(
      fc.property(fc.option(fc.string(), { nil: null }), (txt) => {
        expect(FACAS).toContain(situacaoFacaDoTexto(txt))
      }),
    )
  })
})

describe('converterTipoLegado (Req 4.3)', () => {
  it('mapeia os valores legados', () => {
    expect(converterTipoLegado('REPETICAO')).toEqual({ tipo: 'REPETICAO', exigeProva: false, aConfirmar: false })
    expect(converterTipoLegado('NOVO')).toEqual({ tipo: 'PRODUTO_NOVO', exigeProva: false, aConfirmar: false })
    expect(converterTipoLegado('MOSTRUARIO')).toEqual({ tipo: 'PRODUTO_NOVO', exigeProva: true, aConfirmar: false })
    expect(converterTipoLegado(null)).toEqual({ tipo: 'PRODUTO_NOVO', exigeProva: false, aConfirmar: true })
    expect(converterTipoLegado('QUALQUER')).toEqual({ tipo: 'PRODUTO_NOVO', exigeProva: false, aConfirmar: true })
  })
})

// ============================================================================
// P2 — ausência de becos sem saída (Req 6.13)
// ============================================================================

describe('P2 — sem becos sem saída', () => {
  it('toda situação não-terminal tem ≥1 saída e alcança um terminal', () => {
    fc.assert(
      fc.property(arbSituacao, arbTipo, (atual, tipo) => {
        if (isTerminal(atual)) return
        const { avanco, retorno } = transicoesPermitidas(atual, tipo)
        expect(avanco.length + retorno.length).toBeGreaterThan(0)

        // BFS até achar um terminal
        const visto = new Set<Situacao>([atual])
        const fila: Situacao[] = [atual]
        let achouTerminal = false
        while (fila.length > 0) {
          const s = fila.shift() as Situacao
          if (isTerminal(s)) {
            achouTerminal = true
            break
          }
          const t = transicoesPermitidas(s, tipo)
          for (const d of [...t.avanco, ...t.retorno]) {
            if (!visto.has(d)) {
              visto.add(d)
              fila.push(d)
            }
          }
        }
        expect(achouTerminal).toBe(true)
      }),
    )
  })
})

// ============================================================================
// P5 — destino de avanço compatível com o caminho do tipo (Req 6.14)
// ============================================================================

describe('P5 — avanços pertencem ao caminho do tipo', () => {
  it('toda transição de avanço aceita é compatível com o tipo', () => {
    fc.assert(
      fc.property(arbSituacao, arbTipo, (atual, tipo) => {
        if (isTerminal(atual)) return
        const { avanco } = transicoesPermitidas(atual, tipo)
        for (const destino of avanco) {
          // não deve lançar para avanços sem exigência de motivo
          if (destino !== 'PERDIDO' && destino !== 'CANCELADO') {
            expect(() => validarTransicao(atual, destino, tipo)).not.toThrow()
          }
        }
      }),
    )
  })
})

// ============================================================================
// P8 — consulta == validação (Req 6.15)
// ============================================================================

describe('P8 — consulta de transições é consistente com a validação', () => {
  it('todo destino retornado pela consulta é aceito pela validação (ignorando motivo)', () => {
    fc.assert(
      fc.property(arbSituacao, arbTipo, (atual, tipo) => {
        if (isTerminal(atual)) {
          const t = transicoesPermitidas(atual, tipo)
          expect(t.avanco).toHaveLength(0)
          expect(t.retorno).toHaveLength(0)
          return
        }
        const { avanco, retorno } = transicoesPermitidas(atual, tipo)
        for (const destino of [...avanco, ...retorno]) {
          const motivo = destino === 'PERDIDO' || destino === 'CANCELADO' ? 'motivo valido' : undefined
          expect(() => validarTransicao(atual, destino, tipo, motivo)).not.toThrow()
        }
      }),
    )
  })

  it('destino fora da consulta é rejeitado pela validação', () => {
    fc.assert(
      fc.property(arbSituacao, arbSituacao, arbTipo, (atual, destino, tipo) => {
        if (isTerminal(atual)) return
        const { avanco, retorno } = transicoesPermitidas(atual, tipo)
        const permitidos = new Set([...avanco, ...retorno])
        if (!permitidos.has(destino)) {
          expect(() => validarTransicao(atual, destino, tipo, 'motivo valido')).toThrow(StatusFielError)
        }
      }),
    )
  })
})

// ============================================================================
// Validação de transição — códigos e precedência (Req 6)
// ============================================================================

describe('validarTransicao — códigos', () => {
  it('terminal rejeita com PEDIDO_TERMINAL (precede inválida — Req 6.6)', () => {
    try {
      validarTransicao('PERDIDO', 'TRIAGEM', 'REPETICAO')
      throw new Error('deveria ter lançado')
    } catch (e) {
      expect(e).toBeInstanceOf(StatusFielError)
      expect((e as StatusFielError).code).toBe('PEDIDO_TERMINAL')
      expect((e as StatusFielError).statusCode).toBe(409)
    }
  })

  it('destino == atual é ESTADO_TRANSICAO_INVALIDA (Req 6.3)', () => {
    try {
      validarTransicao('TRIAGEM', 'TRIAGEM', 'REPETICAO')
      throw new Error('deveria ter lançado')
    } catch (e) {
      expect((e as StatusFielError).code).toBe('ESTADO_TRANSICAO_INVALIDA')
    }
  })

  it('PERDIDO/CANCELADO exigem motivo 5..500 (Req 6.7/6.8)', () => {
    expect(() => validarTransicao('TRIAGEM', 'CANCELADO', 'REPETICAO', 'ok ok')).not.toThrow()
    try {
      validarTransicao('TRIAGEM', 'CANCELADO', 'REPETICAO', '  x  ')
      throw new Error('deveria ter lançado')
    } catch (e) {
      expect((e as StatusFielError).code).toBe('MOTIVO_OBRIGATORIO')
    }
  })

  it('encerramento disponível a partir de qualquer não-terminal', () => {
    for (const s of SITUACOES_VALIDAS) {
      if (isTerminal(s)) continue
      expect(classeDaTransicao(s, 'PERDIDO')).toBe('AVANCO')
      expect(classeDaTransicao(s, 'CANCELADO')).toBe('AVANCO')
    }
  })
})

// ============================================================================
// Retornos (Req 7)
// ============================================================================

describe('validarRetorno', () => {
  it('devolver de APROVACAO_ARTE_PENDENTE para PRE_IMPRESSAO é válido', () => {
    const destino = validarRetorno('APROVACAO_ARTE_PENDENTE', 'PRE_IMPRESSAO', 'ajustar a arte')
    expect(destino).toBe('PRE_IMPRESSAO_EM_ANDAMENTO')
  })

  it('devolver para o setor atual é RETORNO_INVALIDO', () => {
    try {
      // ORCAMENTO_EM_ANDAMENTO já está no setor ORCAMENTO
      validarRetorno('ORCAMENTO_EM_ANDAMENTO', 'ORCAMENTO', 'motivo valido')
      throw new Error('deveria ter lançado')
    } catch (e) {
      expect((e as StatusFielError).code).toBe('RETORNO_INVALIDO')
    }
  })

  it('motivo curto é MOTIVO_OBRIGATORIO', () => {
    try {
      validarRetorno('PROPOSTA_ENVIADA_AGUARDA_CLIENTE', 'ORCAMENTO', 'x')
      throw new Error('deveria ter lançado')
    } catch (e) {
      expect((e as StatusFielError).code).toBe('MOTIVO_OBRIGATORIO')
    }
  })

  it('terminal rejeita retorno com PEDIDO_TERMINAL', () => {
    try {
      validarRetorno('FATURADO', 'ORCAMENTO', 'motivo valido')
      throw new Error('deveria ter lançado')
    } catch (e) {
      expect((e as StatusFielError).code).toBe('PEDIDO_TERMINAL')
    }
  })

  it('retorno não previsto na tabela é RETORNO_INVALIDO', () => {
    try {
      // de TRIAGEM não há retorno para CLIENTE
      validarRetorno('TRIAGEM', 'CLIENTE', 'motivo valido')
      throw new Error('deveria ter lançado')
    } catch (e) {
      expect((e as StatusFielError).code).toBe('RETORNO_INVALIDO')
    }
  })
})

// ============================================================================
// Integridade da tabela de transições
// ============================================================================

describe('tabela TRANSICOES', () => {
  it('toda transição referencia situações válidas', () => {
    for (const t of TRANSICOES) {
      expect(SITUACOES_VALIDAS).toContain(t.de)
      expect(SITUACOES_VALIDAS).toContain(t.para)
      expect(['AVANCO', 'RETORNO']).toContain(t.classe)
    }
  })

  it('nenhuma transição explícita parte de uma situação terminal', () => {
    for (const t of TRANSICOES) {
      expect(isTerminal(t.de)).toBe(false)
    }
  })
})
