import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Teste de integridade do arquivo compartilhado de vetores do layout do Item
// (tarefa 1.8 — Requirements 20.3, 20.4, 7.9, 7.12). O mesmo arquivo existe no front
// e os dois repositórios precisam ter conteúdo idêntico.

const ARQUIVO_BACK = join(process.cwd(), 'src', 'modules', 'orcamento-grafico', 'hierarquia', 'vetores-layout.json')
const ARQUIVO_FRONT = resolve(
  process.cwd(), '..', 'VisioFab.Wms.Front', 'src', 'app', '(interna)', 'orcamento-grafico', '[id]', '_layout', 'vetores-layout.json',
)

/** Hash do conteúdo normalizando quebras de linha (autocrlf do Git no Windows). */
function hashNormalizado(caminho: string): string {
  const texto = readFileSync(caminho, 'utf8').replace(/\r\n/g, '\n')
  return createHash('sha256').update(texto).digest('hex')
}

describe('vetores-layout.json (back)', () => {
  const doc = JSON.parse(readFileSync(ARQUIVO_BACK, 'utf8'))

  it('tem vetores com id único, entrada e saidaEsperada', () => {
    expect(doc.versao).toBe(1)
    expect(Array.isArray(doc.vetores)).toBe(true)
    expect(doc.vetores.length).toBeGreaterThan(0)
    const ids = doc.vetores.map((v: { id: string }) => v.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const v of doc.vetores) {
      expect(v.entrada?.produto).toBeDefined()
      expect(Array.isArray(v.entrada?.tiposPlano)).toBe(true)
      expect(v.saidaEsperada?.versao).toBe(1)
    }
  })

  it('cobre os 5 modos, modo ausente/desconhecido, padrão com zero e flags G2 tri-estado', () => {
    const modos = new Set(doc.vetores.map((v: any) => v.entrada.produto.modoFormato))
    for (const m of ['TRES_DIMENSOES', 'DUAS_DIMENSOES', 'ABERTO_FECHADO', 'SANFONA_ABAS', 'PAGINA']) expect(modos.has(m)).toBe(true)
    const motivos = new Set(doc.vetores.map((v: any) => v.saidaEsperada.motivoIncompleto))
    expect(motivos.has('MODO_FORMATO_AUSENTE')).toBe(true)
    expect(motivos.has('MODO_FORMATO_DESCONHECIDO')).toBe(true)
    expect(doc.vetores.some((v: any) => v.entrada.produto.formatoPadraoLargura === 0 && v.entrada.produto.formatoPadraoAltura > 0)).toBe(true)
    const micro = new Set(doc.vetores.map((v: any) => v.entrada.tiposPlano[0]?.previsao?.microondulado))
    for (const x of [true, false, null]) expect(micro.has(x)).toBe(true)
  })

  it('o front tem arquivo idêntico (hash)', (ctx) => {
    if (!existsSync(ARQUIVO_FRONT)) ctx.skip() // repositório vizinho ausente nesta máquina/CI
    expect(hashNormalizado(ARQUIVO_FRONT)).toBe(hashNormalizado(ARQUIVO_BACK))
  })
})
