import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  mapearSuporte,
  derivarTipoSuporte,
  COEF_TINTA_DEFAULT,
  type SuporteOrigemRow,
  type SuporteMapeado,
} from './calcgraf-dedup'

/**
 * PBT — Properties 1, 2 e 3 da spec `orcamento-grafico-suporte-fechamento`
 * (tasks 1.3, 1.4 e 1.5).
 *
 * Testamos a LÓGICA PURA do importador de suportes (sem banco):
 *  - `mapearSuporte` (Property 1 e 3) — mapeamento linha-origem → SuporteGrafico
 *    e invalidação de registros sem Codigo/Descricao;
 *  - um "store" em memória (Map de códigos) que replica o de-para por código do
 *    importador (Property 2) — idempotência: aplicar 1x e 2x produz o mesmo
 *    estado; nº de suportes = nº de códigos distintos.
 *
 * O store em memória reproduz exatamente o padrão de `importarSuportes`
 * (`scripts/importar-calcgraf.ts`): mapeia a linha, ignora as inválidas,
 * deduplica por código dentro do arquivo, e faz create/update por
 * `codigo` (chave única `[empresaId, codigo]`).
 */

// ── Geradores ───────────────────────────────────────────────────────────────

/** Descrição não-vazia (após trim), com variedade para exercitar derivarTipoSuporte. */
const arbDescricao = fc.oneof(
  fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim().length > 0),
  fc.constantFrom(
    'Duplex 280',
    'Triplex 350',
    'Couchê Brilho 170',
    'Couche Fosco',
    'Kraft Natural 200',
    'Off-Set 90',
    'Offset 75',
    'Papelão Paraná',
    'Papelao Couro',
    'Cartão Supremo',
  ),
)

/** CoefTinta de origem: número positivo, zero/negativo (→ default), ou ausente/lixo. */
const arbCoefTinta = fc.oneof(
  fc.double({ min: 0.1, max: 5, noNaN: true, noDefaultInfinity: true }),
  fc.constantFrom<number | string | null | undefined>(0, -1, '', null, undefined, 'abc', '2,2'),
)

/** Gramaturas: lista livre, número, ou vazio. */
const arbGramaturas = fc.oneof(
  fc.constantFrom<number | string | null | undefined>(
    '191,230,280',
    ' 300 ',
    ',250,',
    '',
    '   ',
    280,
    null,
    undefined,
  ),
  fc.string({ maxLength: 20 }),
)

/** Linha de origem VÁLIDA (tem Codigo e Descricao não-vazios). */
const arbLinhaValida: fc.Arbitrary<SuporteOrigemRow> = fc.record({
  Codigo: fc.oneof(
    fc.integer({ min: 1, max: 99999 }),
    fc.integer({ min: 1, max: 99999 }).map((n) => String(n)),
  ),
  Descricao: arbDescricao,
  CoefTinta: arbCoefTinta,
  Gramaturas: arbGramaturas,
})

/**
 * Linha de origem INVÁLIDA (sem Codigo OU sem Descricao).
 *
 * NOTA: `Codigo: 0` NÃO é inválido para `mapearSuporte` — `String(0).trim()`
 * é "0" (não-vazio), logo mapeia com `codigo = "CG-SUP-0"`. Só são inválidos
 * código null/undefined/vazio/whitespace. Por isso o `0` fica de fora do
 * conjunto de códigos inválidos abaixo.
 */
const arbLinhaInvalida: fc.Arbitrary<SuporteOrigemRow> = fc.oneof(
  // sem código (null/undefined/vazio/whitespace — mas NÃO 0, que vira "0")
  fc.record({
    Codigo: fc.constantFrom<number | string | null | undefined>(null, undefined, '', '   '),
    Descricao: arbDescricao,
    CoefTinta: arbCoefTinta,
  }),
  // sem descrição
  fc.record({
    Codigo: fc.integer({ min: 1, max: 99999 }),
    Descricao: fc.constantFrom<string | null | undefined>('', '   ', null, undefined),
    CoefTinta: arbCoefTinta,
  }),
)

// ═══════════════════════════════════════════════════════════════════════════
// Property 1 — mapeamento de campos preserva código/descrição/coefTinta/gramaturas
// ═══════════════════════════════════════════════════════════════════════════

describe('PBT — mapeamento de campos do importador de suportes (Property 1)', () => {
  it('Feature: orcamento-grafico-suporte-fechamento, Property 1: mapeamento de campos preserva código/descrição/coefTinta/gramaturas', () => {
    fc.assert(
      fc.property(arbLinhaValida, (linha) => {
        const r = mapearSuporte(linha)
        // Linha válida sempre mapeia com ok:true
        expect(r.ok).toBe(true)
        if (!r.ok) return
        const s = r.suporte

        // código = CG-SUP-<Codigo> (preservando o valor de origem, trimado)
        const codigoEsperado = String(linha.Codigo).trim()
        expect(s.codigo).toBe(`CG-SUP-${codigoEsperado}`)

        // descrição preservada (apenas trim), sem perda/alteração de valor
        expect(s.descricao).toBe(String(linha.Descricao).trim())

        // coefTinta: Number(CoefTinta) quando finito e > 0; senão default
        const coefNum = Number(linha.CoefTinta)
        const esperado = Number.isFinite(coefNum) && coefNum > 0 ? coefNum : COEF_TINTA_DEFAULT
        expect(s.coefTinta).toBe(esperado)

        // gramaturas: lista livre preservada (trim de bordas) ou null
        const gramRaw = linha.Gramaturas
        if (gramRaw === null || gramRaw === undefined) {
          expect(s.gramaturas).toBeNull()
        } else {
          const limpo = String(gramRaw).trim().replace(/^[,;\s]+|[,;\s]+$/g, '')
          expect(s.gramaturas).toBe(limpo.length ? limpo : null)
        }

        // tipoSuporte coerente com a heurística pura
        expect(s.tipoSuporte).toBe(derivarTipoSuporte(s.descricao))
      }),
      { numRuns: 300 },
    )
  })

  it('Feature: orcamento-grafico-suporte-fechamento, Property 1: gramaturas tipo lista "191,230,280" sobrevive sem perda', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 99999 }),
        fc.array(fc.integer({ min: 50, max: 500 }), { minLength: 1, maxLength: 5 }),
        (codigo, gramaturas) => {
          const lista = gramaturas.join(',')
          const r = mapearSuporte({ Codigo: codigo, Descricao: 'Duplex', Gramaturas: lista })
          expect(r.ok).toBe(true)
          if (r.ok) expect(r.suporte.gramaturas).toBe(lista)
        },
      ),
      { numRuns: 200 },
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Property 3 — suportes inválidos (sem código/descrição) são ignorados sem interromper
// ═══════════════════════════════════════════════════════════════════════════

describe('PBT — invalidação de suportes sem código/descrição (Property 3)', () => {
  it('Feature: orcamento-grafico-suporte-fechamento, Property 3: linhas inválidas são ignoradas (ok:false com motivo) e as válidas mapeadas', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.boolean(), arbLinhaValida, arbLinhaInvalida), {
          minLength: 1,
          maxLength: 30,
        }),
        (specs) => {
          // Monta uma mistura de linhas válidas e inválidas, mantendo o rótulo
          // esperado (true = válida, false = inválida).
          const linhas: Array<{ valida: boolean; row: SuporteOrigemRow }> = specs.map(
            ([usarValida, lv, li]) => ({ valida: usarValida, row: usarValida ? lv : li }),
          )

          let importadosOk = 0
          let ignorados = 0
          for (const { valida, row } of linhas) {
            const r = mapearSuporte(row)
            if (valida) {
              // toda linha válida mapeia com ok:true
              expect(r.ok).toBe(true)
              if (r.ok) importadosOk++
            } else {
              // toda linha inválida é ignorada com motivo não-vazio
              expect(r.ok).toBe(false)
              if (!r.ok) {
                expect(typeof r.motivo).toBe('string')
                expect(r.motivo.length).toBeGreaterThan(0)
                ignorados++
              }
            }
          }

          // Processar todas as linhas nunca interrompe: a soma bate com o total.
          expect(importadosOk + ignorados).toBe(linhas.length)
          expect(importadosOk).toBe(linhas.filter((l) => l.valida).length)
          expect(ignorados).toBe(linhas.filter((l) => !l.valida).length)
        },
      ),
      { numRuns: 200 },
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Property 2 — idempotência e de-para por código (store em memória, sem banco)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Simula o "store" de SuporteGrafico em memória (Map por código) e replica o
 * laço de `importarSuportes`: mapeia → ignora inválidos → dedup por código no
 * arquivo → de-para por código (create se ausente, update se existe).
 *
 * Retorna o estado final (Map código→suporte) e os contadores.
 */
function aplicarImportacaoSuportes(
  store: Map<string, SuporteMapeado>,
  rows: SuporteOrigemRow[],
): { criados: number; atualizados: number; ignorados: number } {
  let criados = 0
  let atualizados = 0
  let ignorados = 0
  const vistosNesteArquivo = new Set<string>()

  for (const row of rows) {
    const r = mapearSuporte(row)
    if (!r.ok) {
      ignorados++
      continue
    }
    const s = r.suporte
    // dedup dentro do próprio arquivo (não processar o mesmo código 2x)
    if (vistosNesteArquivo.has(s.codigo)) continue
    vistosNesteArquivo.add(s.codigo)

    if (store.has(s.codigo)) {
      // de-para por código: atualiza o existente (sem duplicar)
      store.set(s.codigo, s)
      atualizados++
    } else {
      store.set(s.codigo, s)
      criados++
    }
  }
  return { criados, atualizados, ignorados }
}

describe('PBT — idempotência e de-para do importador de suportes (Property 2)', () => {
  it('Feature: orcamento-grafico-suporte-fechamento, Property 2: aplicar 1x e 2x produz o mesmo estado; nº de suportes = nº de códigos distintos', () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(arbLinhaValida, arbLinhaInvalida), { minLength: 0, maxLength: 40 }),
        (rows) => {
          // Códigos distintos esperados entre as linhas VÁLIDAS.
          const codigosDistintos = new Set<string>()
          for (const row of rows) {
            const r = mapearSuporte(row)
            if (r.ok) codigosDistintos.add(r.suporte.codigo)
          }

          // 1ª execução (store vazio)
          const store = new Map<string, SuporteMapeado>()
          aplicarImportacaoSuportes(store, rows)
          const estado1 = new Map(store)

          // nº de suportes = nº de códigos distintos (nenhuma duplicata)
          expect(store.size).toBe(codigosDistintos.size)

          // 2ª execução sobre o MESMO store/dados → mesmo estado final
          aplicarImportacaoSuportes(store, rows)
          expect(store.size).toBe(codigosDistintos.size)

          // o conteúdo é idêntico entre a 1ª e a 2ª execução (idempotência)
          expect([...store.keys()].sort()).toEqual([...estado1.keys()].sort())
          for (const [codigo, s] of store) {
            expect(s).toEqual(estado1.get(codigo))
          }
        },
      ),
      { numRuns: 200 },
    )
  })

  it('Feature: orcamento-grafico-suporte-fechamento, Property 2: 2ª execução não cria nada (0 criados), só atualiza os distintos', () => {
    fc.assert(
      fc.property(
        fc.array(arbLinhaValida, { minLength: 1, maxLength: 30 }),
        (rows) => {
          const codigosDistintos = new Set(
            rows.map((row) => {
              const r = mapearSuporte(row)
              return r.ok ? r.suporte.codigo : ''
            }),
          )
          codigosDistintos.delete('')

          const store = new Map<string, SuporteMapeado>()
          const run1 = aplicarImportacaoSuportes(store, rows)
          // 1ª execução: cria exatamente os códigos distintos
          expect(run1.criados).toBe(codigosDistintos.size)

          const run2 = aplicarImportacaoSuportes(store, rows)
          // 2ª execução: 0 criados, atualiza os distintos
          expect(run2.criados).toBe(0)
          expect(run2.atualizados).toBe(codigosDistintos.size)
        },
      ),
      { numRuns: 200 },
    )
  })
})
