/**
 * Testes do motor de fluxo por operacao.
 * Rodar: npx vitest run src/modules/orcamento-grafico/fluxo-operacao --reporter=dot
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  OPERACOES,
  ETAPAS_FLUXO,
  fluxoPadrao,
  validarEtapas,
  etapaInicial,
  proximaEtapa,
  setorPodeAgir,
  setoresBloqueados,
  operacaoDoPedido,
  type EtapaConfig,
  type EtapaFluxo,
  type SetorBloqueavel,
} from './fluxo-operacao.motor'

/** Monta um fluxo valido: ordem dos 3 setores + finais fixos. */
function montar(
  ordem: EtapaFluxo[],
  extra: Partial<Record<EtapaFluxo, { ativa?: boolean; bloqueia?: SetorBloqueavel[] }>> = {},
): EtapaConfig[] {
  return [...ordem, 'OP_PCP', 'FATURAMENTO'].map((etapa) => ({
    etapa: etapa as EtapaFluxo,
    ativa: extra[etapa as EtapaFluxo]?.ativa ?? true,
    bloqueia: extra[etapa as EtapaFluxo]?.bloqueia ?? [],
  }))
}
const erros = (r: ReturnType<typeof validarEtapas>) => (r.ok ? [] : r.erros)

describe('fluxo padrao', () => {
  it.each(OPERACOES)('%s: todas as etapas, sem bloqueio e valido', (op) => {
    const f = fluxoPadrao(op)
    expect(f.etapas.map((e) => e.etapa)).toEqual([...ETAPAS_FLUXO])
    expect(f.etapas.every((e) => e.ativa && e.bloqueia.length === 0)).toBe(true)
    expect(validarEtapas(f.etapas).ok).toBe(true)
  })
})

describe('validarEtapas - ordem e etapa inicial', () => {
  it('Comercial primeiro e Orcamento primeiro sao validos', () => {
    expect(validarEtapas(montar(['COMERCIAL', 'ORCAMENTO', 'PRE_IMPRESSAO'])).ok).toBe(true)
    expect(validarEtapas(montar(['ORCAMENTO', 'COMERCIAL', 'PRE_IMPRESSAO'])).ok).toBe(true)
  })
  it('Pre-Impressao pode vir entre os dois ou depois dos dois', () => {
    expect(validarEtapas(montar(['COMERCIAL', 'PRE_IMPRESSAO', 'ORCAMENTO'])).ok).toBe(true)
    expect(validarEtapas(montar(['ORCAMENTO', 'PRE_IMPRESSAO', 'COMERCIAL'])).ok).toBe(true)
  })
  it('Pre-Impressao nao pode abrir o pedido', () => {
    const r = validarEtapas(montar(['PRE_IMPRESSAO', 'COMERCIAL', 'ORCAMENTO']))
    expect(r.ok).toBe(false)
    expect(erros(r).join(' ')).toMatch(/inicial/)
  })
  it('se a primeira etapa estiver pulada, vale a primeira ativa', () => {
    // Pre-Impressao pulada nao importa; Orcamento (1a ativa) e inicial valido
    expect(validarEtapas(montar(['PRE_IMPRESSAO', 'ORCAMENTO', 'COMERCIAL'], { PRE_IMPRESSAO: { ativa: false } })).ok).toBe(true)
  })
  it('OP/PCP e Faturamento sao sempre as duas ultimas, nessa ordem', () => {
    const invertido = montar(['COMERCIAL', 'ORCAMENTO', 'PRE_IMPRESSAO']).reverse()
    expect(validarEtapas(invertido).ok).toBe(false)
    const fatAntes = [
      ...montar(['COMERCIAL', 'ORCAMENTO', 'PRE_IMPRESSAO']).slice(0, 3),
      { etapa: 'FATURAMENTO', ativa: true, bloqueia: [] },
      { etapa: 'OP_PCP', ativa: true, bloqueia: [] },
    ]
    expect(erros(validarEtapas(fatAntes)).join(' ')).toMatch(/duas últimas/)
  })
  it('Comercial nao pode ser pulado', () => {
    const r = validarEtapas(montar(['ORCAMENTO', 'COMERCIAL', 'PRE_IMPRESSAO'], { COMERCIAL: { ativa: false } }))
    expect(erros(r).join(' ')).toMatch(/Comercial não pode ser pulada/)
  })
  it('Orcamento, Pre-Impressao, OP/PCP e Faturamento podem ser pulados', () => {
    const r = validarEtapas(
      montar(['COMERCIAL', 'ORCAMENTO', 'PRE_IMPRESSAO'], {
        ORCAMENTO: { ativa: false }, PRE_IMPRESSAO: { ativa: false }, OP_PCP: { ativa: false }, FATURAMENTO: { ativa: false },
      }),
    )
    expect(r.ok).toBe(true)
  })
})

describe('validarEtapas - estrutura', () => {
  it('rejeita entrada que nao e lista, etapa desconhecida, repetida ou faltando', () => {
    expect(validarEtapas(null).ok).toBe(false)
    expect(validarEtapas('x').ok).toBe(false)
    expect(validarEtapas([{ etapa: 'XPTO', ativa: true, bloqueia: [] }]).ok).toBe(false)
    const repetida = [...montar(['COMERCIAL', 'ORCAMENTO', 'PRE_IMPRESSAO']), { etapa: 'COMERCIAL', ativa: true, bloqueia: [] }]
    expect(erros(validarEtapas(repetida)).join(' ')).toMatch(/mais de uma vez/)
    const faltando = montar(['COMERCIAL', 'ORCAMENTO', 'PRE_IMPRESSAO']).slice(0, 4)
    expect(erros(validarEtapas(faltando)).join(' ')).toMatch(/Falta a etapa/)
  })
})

describe('validarEtapas - bloqueios (flexiveis: um, outro, os dois ou nenhum)', () => {
  const ordem: EtapaFluxo[] = ['COMERCIAL', 'ORCAMENTO', 'PRE_IMPRESSAO']

  it('Orcamento pode bloquear Comercial e Pre-Impressao, so um deles ou nenhum', () => {
    for (const bloqueia of [[], ['COMERCIAL'], ['PRE_IMPRESSAO'], ['COMERCIAL', 'PRE_IMPRESSAO']] as SetorBloqueavel[][]) {
      const r = validarEtapas(montar(ordem, { ORCAMENTO: { bloqueia } }))
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.etapas.find((e) => e.etapa === 'ORCAMENTO')!.bloqueia).toEqual(bloqueia)
    }
  })
  it('uma etapa nao pode bloquear o proprio setor', () => {
    const r = validarEtapas(montar(ordem, { ORCAMENTO: { bloqueia: ['ORCAMENTO'] } }))
    expect(erros(r).join(' ')).toMatch(/próprio setor/)
  })
  it('nao pode bloquear um setor que esta pulado no fluxo', () => {
    const r = validarEtapas(montar(ordem, { PRE_IMPRESSAO: { ativa: false }, ORCAMENTO: { bloqueia: ['PRE_IMPRESSAO'] } }))
    expect(erros(r).join(' ')).toMatch(/pulada/)
  })
  it('setor de bloqueio invalido e rejeitado', () => {
    const r = validarEtapas(montar(ordem, { ORCAMENTO: { bloqueia: ['OP_PCP' as SetorBloqueavel] } }))
    expect(r.ok).toBe(false)
  })
  it('normaliza: remove duplicados, ordem canonica e limpa bloqueios de etapa pulada', () => {
    const r = validarEtapas(
      montar(ordem, {
        ORCAMENTO: { bloqueia: ['PRE_IMPRESSAO', 'COMERCIAL', 'COMERCIAL'] },
        OP_PCP: { ativa: false, bloqueia: ['COMERCIAL'] },
      }),
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.etapas.find((e) => e.etapa === 'ORCAMENTO')!.bloqueia).toEqual(['COMERCIAL', 'PRE_IMPRESSAO'])
      expect(r.etapas.find((e) => e.etapa === 'OP_PCP')!.bloqueia).toEqual([])
    }
  })
})

describe('consultas do fluxo', () => {
  const etapas = montar(['ORCAMENTO', 'COMERCIAL', 'PRE_IMPRESSAO'], {
    ORCAMENTO: { bloqueia: ['COMERCIAL', 'PRE_IMPRESSAO'] },
    PRE_IMPRESSAO: { ativa: false },
  })

  it('etapa inicial e a primeira ativa', () => {
    expect(etapaInicial(etapas)).toBe('ORCAMENTO')
  })
  it('proxima etapa pula as desativadas e termina em null', () => {
    expect(proximaEtapa(etapas, 'ORCAMENTO')).toBe('COMERCIAL')
    expect(proximaEtapa(etapas, 'COMERCIAL')).toBe('OP_PCP') // Pre-Impressao pulada
    expect(proximaEtapa(etapas, 'OP_PCP')).toBe('FATURAMENTO')
    expect(proximaEtapa(etapas, 'FATURAMENTO')).toBeNull()
  })
  it('enquanto esta no Orcamento: Comercial e Pre-Impressao ficam bloqueados, Orcamento nao', () => {
    expect(setorPodeAgir(etapas, 'ORCAMENTO', 'COMERCIAL')).toMatchObject({ permitido: false, bloqueadoPor: 'ORCAMENTO' })
    expect(setorPodeAgir(etapas, 'ORCAMENTO', 'COMERCIAL').mensagem).toMatch(/aguarda a conclusão de Orçamento/)
    expect(setorPodeAgir(etapas, 'ORCAMENTO', 'ORCAMENTO').permitido).toBe(true)
    expect(setoresBloqueados(etapas, 'ORCAMENTO')).toEqual(['COMERCIAL', 'PRE_IMPRESSAO'])
  })
  it('depois que o Orcamento conclui, o Comercial volta a poder agir (desbloqueio so pelo fluxo)', () => {
    expect(setorPodeAgir(etapas, 'COMERCIAL', 'COMERCIAL').permitido).toBe(true)
    expect(setoresBloqueados(etapas, 'COMERCIAL')).toEqual([])
  })
  it('sem etapa atual ou etapa fora do fluxo nao bloqueia ninguem', () => {
    expect(setorPodeAgir(etapas, null, 'COMERCIAL').permitido).toBe(true)
    expect(setorPodeAgir(etapas, 'PRE_IMPRESSAO', 'COMERCIAL').permitido).toBe(true) // etapa pulada
  })
})

describe('sequencia define quem espera quem (sem bloqueio marcado)', () => {
  // Orcamento -> Comercial -> Pre-Impressao, nenhum bloqueio marcado.
  const etapas = montar(['ORCAMENTO', 'COMERCIAL', 'PRE_IMPRESSAO'], {})

  it('na etapa Orcamento, Comercial e Pre-Impressao aguardam a vez', () => {
    expect(setorPodeAgir(etapas, 'ORCAMENTO', 'ORCAMENTO').permitido).toBe(true)
    expect(setorPodeAgir(etapas, 'ORCAMENTO', 'COMERCIAL')).toMatchObject({ permitido: false, bloqueadoPor: 'ORCAMENTO' })
    expect(setorPodeAgir(etapas, 'ORCAMENTO', 'PRE_IMPRESSAO').permitido).toBe(false)
    expect(setoresBloqueados(etapas, 'ORCAMENTO')).toEqual(['COMERCIAL', 'PRE_IMPRESSAO'])
  })
  it('na etapa Comercial, quem ja passou (Orcamento) pode agir e a Pre-Impressao aguarda', () => {
    expect(setorPodeAgir(etapas, 'COMERCIAL', 'ORCAMENTO').permitido).toBe(true)
    expect(setorPodeAgir(etapas, 'COMERCIAL', 'PRE_IMPRESSAO').permitido).toBe(false)
    expect(setoresBloqueados(etapas, 'COMERCIAL')).toEqual(['PRE_IMPRESSAO'])
  })
  it('etapa pulada nao aguarda; depois das etapas de setor ninguem aguarda', () => {
    const comPulo = montar(['ORCAMENTO', 'COMERCIAL', 'PRE_IMPRESSAO'], { PRE_IMPRESSAO: { ativa: false } })
    expect(setorPodeAgir(comPulo, 'ORCAMENTO', 'PRE_IMPRESSAO').permitido).toBe(true)
    expect(setoresBloqueados(etapas, 'OP_PCP')).toEqual([])
  })
})

describe('operacaoDoPedido', () => {
  it('mostruario (tipo, amostra ou prova) tem prioridade', () => {
    expect(operacaoDoPedido({ tipoPedido: 'MOSTRUARIO' })).toBe('MOSTRUARIO')
    expect(operacaoDoPedido({ tipoPedido: 'NOVO', exigeAmostra: true })).toBe('MOSTRUARIO')
    expect(operacaoDoPedido({ tipoPedido: 'REPETICAO', exigeProva: true })).toBe('MOSTRUARIO')
  })
  it('alteracao: arte alterada, cliente envia arte, tipo derivado ou impressao alterada', () => {
    expect(operacaoDoPedido({ situacaoArte: 'EXISTENTE_COM_ALTERACAO' })).toBe('ALTERACAO')
    expect(operacaoDoPedido({ situacaoArte: 'CLIENTE_ENVIA' })).toBe('ALTERACAO')
    expect(operacaoDoPedido({ tipoPedidoDerivado: 'ALTERACAO' })).toBe('ALTERACAO')
    expect(operacaoDoPedido({ tipoPedido: 'REPETICAO', alteracaoImpressao: 'trocar a cor' })).toBe('ALTERACAO')
  })
  it('repeticao e novo', () => {
    expect(operacaoDoPedido({ tipoPedido: 'REPETICAO' })).toBe('REPETICAO')
    expect(operacaoDoPedido({ tipoPedidoDerivado: 'REPETICAO' })).toBe('REPETICAO')
    expect(operacaoDoPedido({ tipoPedido: 'NOVO' })).toBe('NOVO')
    expect(operacaoDoPedido({})).toBe('NOVO')
  })
  it('impressao alterada em branco nao conta como alteracao', () => {
    expect(operacaoDoPedido({ tipoPedido: 'REPETICAO', alteracaoImpressao: '   ' })).toBe('REPETICAO')
  })
})

describe('propriedades', () => {
  const ordens: EtapaFluxo[][] = [
    ['COMERCIAL', 'ORCAMENTO', 'PRE_IMPRESSAO'],
    ['COMERCIAL', 'PRE_IMPRESSAO', 'ORCAMENTO'],
    ['ORCAMENTO', 'COMERCIAL', 'PRE_IMPRESSAO'],
    ['ORCAMENTO', 'PRE_IMPRESSAO', 'COMERCIAL'],
  ]

  it('validar e idempotente: validar(validar(x)) == validar(x)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ordens),
        fc.subarray(['COMERCIAL', 'PRE_IMPRESSAO'] as SetorBloqueavel[]),
        (ordem, bloqueia) => {
          const r1 = validarEtapas(montar(ordem, { ORCAMENTO: { bloqueia } }))
          if (!r1.ok) return true
          const r2 = validarEtapas(r1.etapas)
          return r2.ok && JSON.stringify(r2.etapas) === JSON.stringify(r1.etapas)
        },
      ),
    )
  })
  it('com um fluxo valido, o setor da etapa em andamento nunca fica bloqueado por ela mesma', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ordens),
        fc.subarray(['COMERCIAL', 'ORCAMENTO', 'PRE_IMPRESSAO'] as SetorBloqueavel[]),
        fc.constantFrom('COMERCIAL', 'ORCAMENTO', 'PRE_IMPRESSAO') as fc.Arbitrary<SetorBloqueavel>,
        (ordem, bloqueia, atual) => {
          const r = validarEtapas(montar(ordem, { [atual]: { bloqueia } }))
          if (!r.ok) return true
          return setorPodeAgir(r.etapas, atual, atual).permitido === true
        },
      ),
    )
  })
})
