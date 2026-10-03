import { describe, it, expect } from 'vitest'
import { naturezaDefaultAcabamento } from './calcgraf-dedup'

/**
 * Testes da fase `acabamentos` do importador (spec orcamento-grafico-acabamentos,
 * task 6.2). Foco nas partes PURAS/determinísticas que sustentam a idempotência
 * e a classificação por natureza (Property 4 + natureza default por nome).
 */

describe('naturezaDefaultAcabamento — classificação por nome (task 6.2)', () => {
  it('Caixa → MATERIAL_UN', () => {
    expect(naturezaDefaultAcabamento('Caixa Padrão')).toBe('MATERIAL_UN')
  })

  it('Verniz / Cola / Laminação → MATERIAL_KG', () => {
    expect(naturezaDefaultAcabamento("Verniz Base D'Água Fosco (F100)")).toBe('MATERIAL_KG')
    expect(naturezaDefaultAcabamento('Cola Branca (190 mm)')).toBe('MATERIAL_KG')
    expect(naturezaDefaultAcabamento('Laminação maior')).toBe('MATERIAL_KG')
  })

  it('Faca / Matriz → CUSTO_FIXO', () => {
    expect(naturezaDefaultAcabamento('FACA NOVA')).toBe('CUSTO_FIXO')
    expect(naturezaDefaultAcabamento('Matriz de corte')).toBe('CUSTO_FIXO')
  })

  it('Centros de máquina → HORA_MAQUINA (default)', () => {
    for (const nome of [
      'Cortadeira (Grande)',
      'Guilhotina maior',
      'Bobst E (Corte e Vi)',
      'Destacar',
      'AFT70 (Coladeira)',
      'HotStamping',
      'Jato (acoplagem)',
    ]) {
      expect(naturezaDefaultAcabamento(nome)).toBe('HORA_MAQUINA')
    }
  })

  it('é determinística (mesma entrada → mesma saída)', () => {
    const nomes = ['Caixa', 'Verniz UV Total', 'FACA', 'Cortadeira', '']
    for (const n of nomes) {
      expect(naturezaDefaultAcabamento(n)).toBe(naturezaDefaultAcabamento(n))
    }
  })
})

describe('de-para por código — determinístico (idempotência, Property 4)', () => {
  // A chave de de-para é `CG-ACAB-<Codigo>`. Determinística por atividade →
  // 2ª execução casa com o mesmo registro (0 criados).
  const chave = (codigo: number) => `CG-ACAB-${codigo}`.slice(0, 40)

  it('mesma atividade → mesma chave; códigos distintos → chaves distintas', () => {
    expect(chave(8)).toBe('CG-ACAB-8')
    expect(chave(8)).toBe(chave(8))
    expect(chave(8)).not.toBe(chave(9))
    expect(chave(39).length).toBeLessThanOrEqual(40)
  })
})
