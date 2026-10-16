/**
 * Testes das funções puras do relatório Vizor da OP (Bloco 1 da spec
 * `op-visualizacao-observacoes-calcgraf`). Focam na extração de observações
 * para a seção "OBSERVAÇÕES" (consulta visual — Property 2) e nas tags.
 *
 * Não testam o PDF binário (pdfkit) — o foco é a lógica pura que decide o que
 * aparece na seção de observações, que é o requisito de completude (Req 2.2/3.1).
 */

import { describe, it, expect } from 'vitest'
import { extrairTag, extrairObservacoesParaExibicao } from './op-pdf-gerado.service'

describe('extrairTag', () => {
  it('extrai o valor de uma tag [Chave]', () => {
    const obs = '[Cliente] MORLAN S/A\n[Produto] ROTULO\n[Tiragem] 40000'
    expect(extrairTag(obs, 'Cliente')).toBe('MORLAN S/A')
    expect(extrairTag(obs, 'Produto')).toBe('ROTULO')
    expect(extrairTag(obs, 'Tiragem')).toBe('40000')
  })

  it('retorna null quando a tag não existe ou obs é vazio', () => {
    expect(extrairTag('[Cliente] X', 'Matriz')).toBeNull()
    expect(extrairTag(null, 'Cliente')).toBeNull()
    expect(extrairTag('', 'Cliente')).toBeNull()
  })
})

describe('extrairObservacoesParaExibicao', () => {
  it('inclui bobinas como linha legível e preserva texto livre', () => {
    const obs = [
      '[Cliente] MORLAN S/A',
      '[Produto] ROTULO',
      '[Bobina] Stora Enzo 315g em estoque (4.205,0 kg)',
      '[Bobina] Nz Fibra Longa 321g em estoque (386,34 kg)',
      'Seguir aprovação em máquina com impressor',
    ].join('\n')
    const linhas = extrairObservacoesParaExibicao(obs)
    expect(linhas).toContain('Bobina: Stora Enzo 315g em estoque (4.205,0 kg)')
    expect(linhas).toContain('Bobina: Nz Fibra Longa 321g em estoque (386,34 kg)')
    expect(linhas).toContain('Seguir aprovação em máquina com impressor')
  })

  it('NÃO duplica tags já exibidas em outras seções (Cliente/Produto/Cores/etc.)', () => {
    const obs = '[Cliente] X\n[Produto] Y\n[Cores] 4x0\n[Formato] 600 x 910\n[TipoOp] REPETIÇÃO\n[Acond] pallet 4000'
    const linhas = extrairObservacoesParaExibicao(obs)
    // Nenhuma dessas tags deve aparecer na seção de observações (já estão no cabeçalho).
    expect(linhas).toHaveLength(0)
  })

  it('mostra tag aditiva desconhecida como "Chave: valor" (não perde dado)', () => {
    const obs = '[Faturamento] Carton Wega\n[Ficha] 196'
    const linhas = extrairObservacoesParaExibicao(obs)
    expect(linhas).toContain('Faturamento: Carton Wega')
    expect(linhas).toContain('Ficha: 196')
  })

  it('retorna [] para observação vazia/nula', () => {
    expect(extrairObservacoesParaExibicao(null)).toEqual([])
    expect(extrairObservacoesParaExibicao('')).toEqual([])
    expect(extrairObservacoesParaExibicao('   \n  ')).toEqual([])
  })
})
