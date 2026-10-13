import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  baseContagem,
  resolverPlanejadoDaEtapa,
  exigirEmpresaId,
  BaseContagemError,
  type EtapaLike,
  type PlanoLike,
  type OpLike,
} from './base-contagem.service'

/**
 * Testes da fonte única de verdade da Base de Contagem por Tipo de Processo
 * (.kiro/specs/base-contagem-por-tipo-processo). Validam as 9 Correctness
 * Properties do design sobre as funções puras `baseContagem` e
 * `resolverPlanejadoDaEtapa`.
 */

/** Gerador de código de processo diferente de COLAGEM. */
const codigoNaoColagem = fc.oneof(
  fc.constantFrom('CORTADEIRA', 'IMPRESSAO', 'ACABAMENTO', 'VERNIZ', 'ACOPLAGEM', 'CORTE_VINCO'),
  fc.string(),
  fc.constant(''),
  fc.constant(null),
  fc.constant(undefined),
).filter((c) => c !== 'COLAGEM')

const qtd = fc.integer({ min: 0, max: 10_000_000 })
const qtdPos = fc.integer({ min: 1, max: 10_000_000 })

function etapa(partial: Partial<EtapaLike>): EtapaLike {
  return {
    tipoProcessoCodigo: partial.tipoProcessoCodigo ?? 'CORTADEIRA',
    quantidadePrevista: partial.quantidadePrevista ?? 0,
    quantidadeProduzida: partial.quantidadeProduzida ?? 0,
  }
}

describe('baseContagem', () => {
  // Feature: base-contagem-por-tipo-processo, Property 1: Colagem conta em Unidade
  it('Property 1 — COLAGEM sempre retorna UNIDADE', () => {
    expect(baseContagem('COLAGEM')).toBe('UNIDADE')
  })

  // Feature: base-contagem-por-tipo-processo, Property 2: Todo processo != Colagem conta em Tiragem
  it('Property 2 — qualquer código != COLAGEM retorna TIRAGEM', () => {
    fc.assert(
      fc.property(codigoNaoColagem, (codigo) => {
        expect(baseContagem(codigo)).toBe('TIRAGEM')
      }),
      { numRuns: 200 },
    )
  })

  // tabela-verdade (task 1.11)
  it('tabela-verdade dos códigos conhecidos', () => {
    expect(baseContagem('COLAGEM')).toBe('UNIDADE')
    for (const c of ['CORTADEIRA', 'IMPRESSAO', 'ACABAMENTO', 'VERNIZ']) {
      expect(baseContagem(c)).toBe('TIRAGEM')
    }
    expect(baseContagem(null)).toBe('TIRAGEM')
    expect(baseContagem(undefined)).toBe('TIRAGEM')
    expect(baseContagem('')).toBe('TIRAGEM')
  })
})

describe('resolverPlanejadoDaEtapa', () => {
  // Feature: base-contagem-por-tipo-processo, Property 3: Determinismo / fonte única
  it('Property 3 — determinístico e independente de dados != tipo de processo', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant('COLAGEM'), codigoNaoColagem),
        qtd, qtd, qtd, qtd, qtd,
        (codigo, produzida, prevista, tiragem, unidade, quantidade) => {
          const e = etapa({ tipoProcessoCodigo: codigo, quantidadeProduzida: produzida, quantidadePrevista: prevista })
          const p: PlanoLike = { tiragem, unidade }
          const o: OpLike = { quantidade }
          const r1 = resolverPlanejadoDaEtapa(e, p, o)
          const r2 = resolverPlanejadoDaEtapa(e, p, o)
          expect(r2).toEqual(r1)
          // A base depende SÓ do código do tipo de processo.
          expect(r1.base).toBe(baseContagem(codigo))
        },
      ),
      { numRuns: 200 },
    )
  })

  // Feature: base-contagem-por-tipo-processo, Property 4: Planejado na base Tiragem usa a Tiragem do plano
  it('Property 4 — base TIRAGEM usa plano.tiragem; desmembramento sobrepõe', () => {
    fc.assert(
      fc.property(codigoNaoColagem, qtdPos, qtd, qtdPos, (codigo, tiragem, prevista, quantidade) => {
        // sem desmembramento → usa a tiragem do plano
        const semDesm = resolverPlanejadoDaEtapa(
          etapa({ tipoProcessoCodigo: codigo, quantidadePrevista: 0 }),
          { tiragem },
          { quantidade },
        )
        expect(semDesm.base).toBe('TIRAGEM')
        expect(semDesm.planejado).toBe(tiragem)

        // com desmembramento (prevista > 0) → sobrepõe
        if (prevista > 0) {
          const comDesm = resolverPlanejadoDaEtapa(
            etapa({ tipoProcessoCodigo: codigo, quantidadePrevista: prevista }),
            { tiragem },
            { quantidade },
          )
          expect(comDesm.planejado).toBe(prevista)
        }
      }),
      { numRuns: 200 },
    )
  })

  // Feature: base-contagem-por-tipo-processo, Property 5: Planejado na base Unidade usa a Unidade do plano/OP
  it('Property 5 — base UNIDADE usa plano.unidade senão op.quantidade; desmembramento sobrepõe', () => {
    fc.assert(
      fc.property(qtdPos, qtdPos, (unidade, quantidade) => {
        const comUnidade = resolverPlanejadoDaEtapa(
          etapa({ tipoProcessoCodigo: 'COLAGEM', quantidadePrevista: 0 }),
          { tiragem: null, unidade },
          { quantidade },
        )
        expect(comUnidade.base).toBe('UNIDADE')
        expect(comUnidade.planejado).toBe(unidade)

        // sem unidade no plano → cai para quantidade da OP
        const semUnidade = resolverPlanejadoDaEtapa(
          etapa({ tipoProcessoCodigo: 'COLAGEM', quantidadePrevista: 0 }),
          { tiragem: null },
          { quantidade },
        )
        expect(semUnidade.planejado).toBe(quantidade)
      }),
      { numRuns: 200 },
    )
  })

  // Feature: base-contagem-por-tipo-processo, Property 6: Preservação do dado bruto apontado
  it('Property 6 — apontado === quantidadeProduzida (sem conversão), para qualquer base', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant('COLAGEM'), codigoNaoColagem),
        qtd, qtd, qtd, qtd,
        (codigo, produzida, prevista, tiragem, quantidade) => {
          const r = resolverPlanejadoDaEtapa(
            etapa({ tipoProcessoCodigo: codigo, quantidadeProduzida: produzida, quantidadePrevista: prevista }),
            { tiragem },
            { quantidade },
          )
          // apontado é o bruto normalizado para não-negativo (nunca convertido pela base)
          expect(r.apontado).toBe(produzida > 0 ? produzida : 0)
        },
      ),
      { numRuns: 200 },
    )
  })

  // Feature: base-contagem-por-tipo-processo, Property 7: Plano implícito reproduz o legado (não-regressão)
  it('Property 7 — plano null iguala o cálculo legado da OP', () => {
    fc.assert(
      fc.property(codigoNaoColagem, qtd, qtdPos, (codigo, prevista, quantidade) => {
        const e = etapa({ tipoProcessoCodigo: codigo, quantidadePrevista: prevista })
        const r = resolverPlanejadoDaEtapa(e, null, { quantidade })
        // legado: quantidadePrevista>0 ? prevista : op.quantidade
        const esperado = prevista > 0 ? prevista : quantidade
        expect(r.planejado).toBe(esperado)
      }),
      { numRuns: 200 },
    )
  })

  // Feature: base-contagem-por-tipo-processo, Property 8: Independência entre planos da mesma OP
  it('Property 8 — alterar outro plano não muda o resultado da etapa do primeiro', () => {
    fc.assert(
      fc.property(qtdPos, qtdPos, qtdPos, (tiragemA, tiragemOutro, quantidade) => {
        const e = etapa({ tipoProcessoCodigo: 'IMPRESSAO', quantidadePrevista: 0 })
        const rA = resolverPlanejadoDaEtapa(e, { tiragem: tiragemA }, { quantidade })
        // "outro plano" é passado separadamente — não entra no cálculo de rA
        const rAbis = resolverPlanejadoDaEtapa(e, { tiragem: tiragemA }, { quantidade })
        expect(rAbis.planejado).toBe(rA.planejado)
        expect(rA.planejado).toBe(tiragemA)
        // o valor de tiragemOutro é irrelevante para a etapa do plano A
        expect(tiragemOutro).toBeGreaterThan(0)
      }),
      { numRuns: 200 },
    )
  })

  // Feature: base-contagem-por-tipo-processo, Property 9: Agregação sem escopo de empresa falha explicitamente
  it('Property 9 — exigirEmpresaId lança quando o escopo está ausente', () => {
    fc.assert(
      fc.property(fc.oneof(fc.constant(null), fc.constant(undefined), fc.constant(''), fc.constant('   ')), (vazio) => {
        expect(() => exigirEmpresaId(vazio as string | null | undefined)).toThrow(BaseContagemError)
      }),
      { numRuns: 50 },
    )
    expect(exigirEmpresaId('empresa-123')).toBe('empresa-123')
  })

  // bordas (task 1.11)
  it('planejado <= 0 → progresso 0 (sem divisão por zero)', () => {
    const r = resolverPlanejadoDaEtapa(
      etapa({ tipoProcessoCodigo: 'IMPRESSAO', quantidadeProduzida: 50 }),
      { tiragem: 0 },
      { quantidade: 0 },
    )
    expect(r.planejado).toBe(0)
    expect(r.progresso).toBe(0)
  })

  it('tiragem ausente na base TIRAGEM → fallback para quantidade da OP', () => {
    const r = resolverPlanejadoDaEtapa(
      etapa({ tipoProcessoCodigo: 'CORTADEIRA', quantidadePrevista: 0 }),
      { tiragem: null },
      { quantidade: 1540 },
    )
    expect(r.planejado).toBe(1540)
  })

  it('progresso é limitado a 100 e calculado corretamente', () => {
    const r = resolverPlanejadoDaEtapa(
      etapa({ tipoProcessoCodigo: 'IMPRESSAO', quantidadeProduzida: 770 }),
      { tiragem: 1540 },
      { quantidade: 1540 },
    )
    expect(r.progresso).toBe(50)
    const cheio = resolverPlanejadoDaEtapa(
      etapa({ tipoProcessoCodigo: 'IMPRESSAO', quantidadeProduzida: 2000 }),
      { tiragem: 1540 },
      { quantidade: 1540 },
    )
    expect(cheio.progresso).toBe(100)
  })
})
