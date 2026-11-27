import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  classeDaAtividade,
  gerarFolhas,
  modeloDaLinha,
  nomeExibido,
  type TipoPlanoEntrada,
} from './gerar-folhas'

const imp = { cores: '6x0', processoImpressao: 'Offset Plana', coberturaTinta: null }

function tipo(over: Partial<TipoPlanoEntrada> = {}): TipoPlanoEntrada {
  return {
    planoId: 'p1',
    nome: 'Cartão',
    tiragem: null,
    ocorrencias: 1,
    formatoLarguraMm: 490,
    formatoAlturaMm: 790,
    capa: { suporteId: 'stora290', gramatura: 290 },
    impressao: imp,
    micro: { suporteId: 'micro245', gramatura: 245 },
    capaInterna: null,
    atividades: [
      { acabamentoId: 'cortadeira', classe: 'CORTE_INICIAL' },
      { acabamentoId: 'bobst', classe: 'OUTRA' },
      { acabamentoId: 'bimac', classe: 'ACOPLAGEM' },
    ],
    ...over,
  }
}

describe('gerarFolhas — Cartucho Composto (caso do cálculo 15061/15650)', () => {
  it('1 tipo com micro gera capa + micro; micro sem impressão e exibido com (M)', () => {
    const r = gerarFolhas('CARTUCHO_COMPOSTO', [tipo()])
    expect(r.folhas.map((f) => [f.papel, f.suporteId, f.sequencia])).toEqual([
      ['CAPA', 'stora290', 1],
      ['MICRO', 'micro245', 2],
    ])
    expect(r.folhas[1].impressao).toBeNull()
    expect(nomeExibido(r.folhas[1])).toBe('Cartão (M)')
  })
  it('acoplagem no micro, corte inicial em cada folha, resto na capa', () => {
    const r = gerarFolhas('CARTUCHO_COMPOSTO', [tipo()])
    const onde = (id: string) => r.atividades.filter((a) => a.acabamentoId === id).map((a) => r.folhas[a.folha!].papel)
    expect(onde('bimac')).toEqual(['MICRO'])
    expect(onde('cortadeira')).toEqual(['CAPA', 'MICRO'])
    expect(onde('bobst')).toEqual(['CAPA'])
  })
  it('capa interna gera a 3ª folha com a impressão dela; sem micro, a acoplagem vai para a capa interna', () => {
    const r = gerarFolhas('CARTUCHO_COMPOSTO', [
      tipo({ micro: null, capaInterna: { suporteId: 'int', gramatura: 276, impressao: { cores: '1x0', processoImpressao: 'Offset', coberturaTinta: 20 } } }),
    ])
    expect(r.folhas.map((f) => f.papel)).toEqual(['CAPA', 'CAPA_INTERNA'])
    expect(r.folhas[1].impressao?.[0].cores).toBe('1x0')
    const bimac = r.atividades.find((a) => a.acabamentoId === 'bimac')!
    expect(r.folhas[bimac.folha!].papel).toBe('CAPA_INTERNA')
  })
  it('suporte fornecido pelo cliente ou vazio não gera folha', () => {
    expect(gerarFolhas('CARTUCHO_COMPOSTO', [tipo({ micro: { suporteId: 'm', fornecido: true } })]).folhas).toHaveLength(1)
    expect(gerarFolhas('CARTUCHO_COMPOSTO', [tipo({ micro: { suporteId: '' } })]).folhas).toHaveLength(1)
  })
  it('vários tipos (TAMPA/CAIXA/BOLSA) numeram as folhas em sequência', () => {
    const r = gerarFolhas('CARTUCHO_COMPOSTO', [
      tipo({ planoId: 't', nome: 'TAMPA' }),
      tipo({ planoId: 'c', nome: 'CAIXA' }),
      tipo({ planoId: 'b', nome: 'BOLSA', micro: null }),
    ])
    expect(r.folhas.map((f) => `${f.nome}:${f.papel}:${f.sequencia}`)).toEqual([
      'TAMPA:CAPA:1', 'TAMPA:MICRO:2', 'CAIXA:CAPA:3', 'CAIXA:MICRO:4', 'BOLSA:CAPA:5',
    ])
  })
})

describe('gerarFolhas — demais modelos', () => {
  it('SIMPLES e EDITORIAL: 1 folha por tipo, micro ignorado, todas as atividades na folha', () => {
    for (const modelo of ['SIMPLES', 'EDITORIAL'] as const) {
      const r = gerarFolhas(modelo, [tipo(), tipo({ planoId: 'p2', nome: 'MONT02' })])
      expect(r.folhas.map((f) => f.papel)).toEqual(['CAPA', 'CAPA'])
      expect(r.atividades.filter((a) => a.folha === 0)).toHaveLength(3)
    }
  })
  it('modelo desconhecido vira SIMPLES', () => {
    expect(modeloDaLinha('cartucho_composto')).toBe('CARTUCHO_COMPOSTO')
    expect(modeloDaLinha(null)).toBe('SIMPLES')
    expect(modeloDaLinha('XYZ')).toBe('SIMPLES')
  })
})

describe('gerarFolhas — regeração', () => {
  it('preserva id, campo digitado à mão (marca alterada) e as folhas avulsas', () => {
    const r1 = gerarFolhas('CARTUCHO_COMPOSTO', [tipo()])
    const existentes = [
      { id: 'f1', planoId: 'p1', papel: 'CAPA' as const, sequencia: 1, camposManuais: ['suporteId'], valores: { suporteId: 'outro' } },
      { id: 'f2', planoId: 'p1', papel: 'MICRO' as const, sequencia: 2, camposManuais: [], valores: {} },
      { id: 'av', planoId: null, papel: 'AVULSO' as const, sequencia: 3, camposManuais: [], valores: { nome: 'BERÇO', suporteId: 'x' } },
    ]
    const r2 = gerarFolhas('CARTUCHO_COMPOSTO', [tipo()], existentes)
    expect(r1.folhas).toHaveLength(2)
    expect(r2.folhas.map((f) => [f.idExistente, f.papel])).toEqual([['f1', 'CAPA'], ['f2', 'MICRO'], ['av', 'AVULSO']])
    expect(r2.folhas[0].suporteId).toBe('outro')
    expect(r2.folhas[0].alteradaNoEditor).toBe(true)
    expect(r2.folhas[2].nome).toBe('BERÇO')
  })
  it('micro removido do tipo: a folha do micro deixa de ser gerada', () => {
    const existentes = [{ id: 'f2', planoId: 'p1', papel: 'MICRO' as const, sequencia: 2, camposManuais: [], valores: {} }]
    const r = gerarFolhas('CARTUCHO_COMPOSTO', [tipo({ micro: null })], existentes)
    expect(r.folhas.map((f) => f.papel)).toEqual(['CAPA'])
  })
  it('determinística: gerar 2 vezes com as mesmas entradas dá o mesmo resultado', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), fc.integer({ min: 1, max: 4 }), (micro, interna, n) => {
        const tipos = Array.from({ length: n }, (_, i) =>
          tipo({
            planoId: `p${i}`,
            micro: micro ? { suporteId: 'm' } : null,
            capaInterna: interna ? { suporteId: 'i', impressao: null } : null,
          }),
        )
        const a = gerarFolhas('CARTUCHO_COMPOSTO', tipos)
        const b = gerarFolhas('CARTUCHO_COMPOSTO', tipos)
        const esperado = n * (1 + (micro ? 1 : 0) + (interna ? 1 : 0))
        return JSON.stringify(a) === JSON.stringify(b) && a.folhas.length === esperado
          && a.folhas.every((f, i) => f.sequencia === i + 1)
      }),
    )
  })
})

describe('classeDaAtividade', () => {
  it('acoplagem pelo nome; corte inicial por tipo de processo ou nome; resto OUTRA', () => {
    expect(classeDaAtividade({ nome: 'Bimac (Acoplagem)' })).toBe('ACOPLAGEM')
    expect(classeDaAtividade({ nome: 'Mazola (acoplagem)' })).toBe('ACOPLAGEM')
    expect(classeDaAtividade({ nome: 'Cortadeira (Grande)' })).toBe('CORTE_INICIAL')
    expect(classeDaAtividade({ nome: 'Guilhotina maior' })).toBe('CORTE_INICIAL')
    expect(classeDaAtividade({ nome: 'Qualquer', tipoProcessoCodigo: 'CORTADEIRA' })).toBe('CORTE_INICIAL')
    expect(classeDaAtividade({ nome: 'Bobst E (Corte e Vinco)' })).toBe('OUTRA')
  })
})
