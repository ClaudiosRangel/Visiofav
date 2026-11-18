import { describe, it, expect } from 'vitest'
import { calcularPlano, fechamentoDoResultado, somaPlanos } from '../plano-calculo.service'
import { formarPrecoVenda } from '../orcamento-grafico-calculo.service'
import { MARGEM_T5, paramsPlano1, paramsPlano2 } from './t5-entrada'
import { CUSTO_BASELINE, centavos, type ItemBaseline, type TiragemBaseline } from './custo-baseline.fixture'
import {
  DivergenciaCustoError,
  executarProtocolo,
  medirRAnc,
  type MedidaCusto,
  type Passo,
  type PassosProtocolo,
} from './custo-protocolo'
import {
  ALVOS_GUARD,
  HASH_BASELINE_MOTOR,
  extrairCorpoFuncao,
  hashCorpoFuncao,
  hashTexto,
} from './motor-guard'

// Feature: orcamento-grafico-hierarquia-item-plano, tarefa 1.9 (Req. 15.1, 15.2, 15.7, 15.8, 15.9)
//
// RODA SEM BANCO. O Postgres local está parado e o banco de produção não é acessado.
// Passos feitos aqui: o que o motor puro e funções puras provam. Passos que dependem das
// rotas/serviços das Fases 1 em diante (cópia 3.8, Fechamento 3.4) ficam como `it.todo`,
// e o helper `executarProtocolo` já aceita esses passos plugados quando existirem.

const r2 = (x: number) => Math.round(x * 100) / 100

/** Linha como o banco a devolve (resultado_calculo em JSONB + colunas). */
interface LinhaPersistida {
  resultadoCalculo: { custos: { custoProducao: number }; custoProducao: number; precoVenda: number }
  custoProducao: number
  valorTotal: number
  quantidade: number
  siglaAcabado?: string | null
  observacao?: string | null
}

const clonarComoJsonb = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

const medidaDaLinha = (l: LinhaPersistida): MedidaCusto => ({
  custoProducao: l.resultadoCalculo.custos.custoProducao,
  precoVenda: l.resultadoCalculo.precoVenda,
  valorTotal: l.valorTotal,
})

/** T1..T4: a linha persistida é a foto do acervo (valores do baseline medidos no banco). */
function linhaDaFoto(t: TiragemBaseline): LinhaPersistida {
  return {
    resultadoCalculo: {
      custos: { custoProducao: t.custoProducao },
      custoProducao: t.custoProducao,
      precoVenda: t.precoVenda!,
    },
    custoProducao: t.custoProducao,
    valorTotal: t.valorTotal!,
    quantidade: t.tiragem,
  }
}

/** T5: calcula pelo MOTOR ATUAL (dois planos somados + preço de venda). */
function calcularT5(tiragem: number): MedidaCusto {
  const s = somaPlanos([
    fechamentoDoResultado(1, calcularPlano(paramsPlano1(tiragem))),
    fechamentoDoResultado(2, calcularPlano(paramsPlano2(tiragem))),
  ])
  const custo = r2(s.materialDireto + s.custoTransformacao + s.servicoExterno)
  const preco = formarPrecoVenda(custo, MARGEM_T5)
  return { custoProducao: custo, precoVenda: preco, valorTotal: preco }
}

function linhaDeMedida(m: MedidaCusto, quantidade: number): LinhaPersistida {
  return {
    resultadoCalculo: { custos: { custoProducao: m.custoProducao }, custoProducao: m.custoProducao, precoVenda: m.precoVenda! },
    custoProducao: m.custoProducao,
    valorTotal: m.valorTotal!,
    quantidade,
  }
}

const linhaDoItem = (item: ItemBaseline, t: TiragemBaseline): LinhaPersistida =>
  item.id === 'T5' ? linhaDeMedida(calcularT5(t.tiragem), t.tiragem) : linhaDaFoto(t)

/** Passos que rodam sem banco (a, b, d, e para todos; c só onde há entrada do motor: T5). */
function passosSemBanco(item: ItemBaseline): PassosProtocolo {
  const passos: PassosProtocolo = {
    // (a) abrir: GET /:id devolve a linha lida do JSONB
    a: ({ tiragem }) => medidaDaLinha(clonarComoJsonb(linhaDoItem(item, tiragem))),
    // (b) salvar sem alteração: reescreve a mesma linha; custo e preço não são recalculados
    b: ({ tiragem }) => {
      const lida = clonarComoJsonb(linhaDoItem(item, tiragem))
      const gravada = clonarComoJsonb({ ...lida, resultadoCalculo: { ...lida.resultadoCalculo } })
      return medidaDaLinha(gravada)
    },
    // (d) campos informativos não entram em nenhuma coluna de custo
    d: ({ tiragem }) => {
      const base = linhaDoItem(item, tiragem)
      const gravada = clonarComoJsonb({ ...base, siglaAcabado: 'SIGLA-TESTE', observacao: 'obs informativa' })
      return medidaDaLinha(gravada)
    },
    // (e) copiar: cópia integral da linha, sem chamar o motor
    e: ({ tiragem }) => medidaDaLinha(structuredClone(linhaDoItem(item, tiragem))),
  }
  if (item.id === 'T5') {
    // (c) calcular: motor puro com a entrada sintética de t5-entrada.ts
    passos.c = ({ tiragem }) => calcularT5(tiragem.tiragem)
  }
  return passos
}

describe('custo-igualdade — protocolo T1..T5 sem banco (centavos inteiros)', () => {
  for (const item of CUSTO_BASELINE) {
    it(`${item.id}: passos executáveis sem banco batem com o baseline`, async () => {
      const r = await executarProtocolo(item, passosSemBanco(item))
      const esperados = item.id === 'T5' ? ['a', 'b', 'c', 'd', 'e'] : ['a', 'b', 'd', 'e']
      expect(r.executados).toEqual(esperados)
      expect(r.pendentes).toContain('f')
      expect(r.comparacoes).toBeGreaterThan(0)
    })
  }

  it('T5: o passo (c) cobre todas as tiragens do baseline com diferença 0,00', async () => {
    const t5 = CUSTO_BASELINE.find((i) => i.id === 'T5')!
    const r = await executarProtocolo(t5, { c: passosSemBanco(t5).c })
    expect(r.executados).toEqual(['c'])
    expect(r.comparacoes).toBe(t5.tiragens.length * 3)
  })
})

describe('custo-igualdade — o helper falha informando item, passo, esperado e obtido (R15.9)', () => {
  const t5 = CUSTO_BASELINE.find((i) => i.id === 'T5')!

  it('desvio de 1 centavo no passo (c) lança DivergenciaCustoError com todos os dados', async () => {
    const desviado: Passo = ({ tiragem }) => {
      const m = calcularT5(tiragem.tiragem)
      return { ...m, custoProducao: r2(m.custoProducao + 0.01) }
    }
    const erro = await executarProtocolo(t5, { c: desviado }).catch((e: unknown) => e)
    expect(erro).toBeInstanceOf(DivergenciaCustoError)
    const e = erro as DivergenciaCustoError
    expect(e.itemId).toBe('T5')
    expect(e.passo).toBe('c')
    expect(e.tiragem).toBe(1000)
    expect(e.campo).toBe('custoProducao')
    expect(e.esperadoCentavos).toBe(centavos(2236.97))
    expect(e.obtidoCentavos).toBe(centavos(2236.97) + 1)
    expect(e.message).toContain('T5')
    expect(e.message).toContain('(c) calcular')
    expect(e.message).toContain(String(e.esperadoCentavos))
    expect(e.message).toContain(String(e.obtidoCentavos))
  })

  it('divergência em precoVenda e em passo posterior também é apontada', async () => {
    const erro = await executarProtocolo(t5, {
      c: ({ tiragem }) => calcularT5(tiragem.tiragem),
      e: ({ tiragem }) => ({ ...calcularT5(tiragem.tiragem), precoVenda: 1 }),
    }).catch((e: unknown) => e)
    const e = erro as DivergenciaCustoError
    expect(e).toBeInstanceOf(DivergenciaCustoError)
    expect(e.passo).toBe('e')
    expect(e.campo).toBe('precoVenda')
  })

  it('passos fora de ordem de declaração são executados na ordem a..f', async () => {
    const ordem: string[] = []
    const t = CUSTO_BASELINE[1]
    const medida = (): MedidaCusto => ({ custoProducao: t.tiragens[0].custoProducao })
    await executarProtocolo(t, {
      f: () => (ordem.push('f'), medida()),
      b: () => (ordem.push('b'), medida()),
      a: () => (ordem.push('a'), medida()),
    })
    expect(ordem).toEqual(['a', 'b', 'f'])
  })
})

describe('custo-igualdade — passos que dependem de rotas/banco (ativar quando existirem)', () => {
  // Estrutura pronta: basta plugar o passo em `executarProtocolo(item, { e: ..., f: ... })`.
  for (const item of CUSTO_BASELINE) {
    it.todo(`${item.id} (e) copiar pela rota real POST /:id/itens/:itemId/copiar — implementada na tarefa 3.8 (item-copia.service)`)
    it.todo(`${item.id} (f) Fechamento pela rota real GET /:id/fechamento-totalizador — implementada na tarefa 3.4 (agregarFechamento)`)
  }
  it.todo('T1..T5 (a)(b)(c)(d) pelas rotas reais GET /:id, PUT e POST .../calcular — exige banco; rodar no checkpoint 12 com Postgres local')
})

describe('R-ANC — gravar plano em item ancorado (MEDIÇÃO, sem exigir igualdade)', () => {
  it('sem passo plugado registra NAO_MEDIDO com motivo e não falha', async () => {
    const t1 = CUSTO_BASELINE.find((i) => i.id === 'T1')!
    const m = await medirRAnc(t1)
    expect(m.status).toBe('NAO_MEDIDO')
    expect(m.motivo).toBeTruthy()
  })

  it('com passo plugado registra a diferença em centavos, mesmo que seja diferente de zero', async () => {
    const t1 = CUSTO_BASELINE.find((i) => i.id === 'T1')!
    const m = await medirRAnc(t1, () => ({ custoProducao: 5100 }))
    expect(m.status).toBe('MEDIDO')
    expect(m.custoAntes).toBe(5192.05)
    expect(m.diferencaCentavos).toBe(centavos(5100) - centavos(5192.05))
  })

  it.todo('medir T1 (cálculo 12992, ancorado) gravando PlanoCalculoGrafico pela rota real — exige banco; resultado vai para a decisão do usuário (R-ANC)')
})

describe('guard de motor intacto (calcularOrcamentoGrafico e ancorarCustoCalcgraf)', () => {
  for (const alvo of ALVOS_GUARD) {
    it(`${alvo.nome}: o hash do corpo da função é o registrado como baseline`, () => {
      const obtido = hashCorpoFuncao(alvo)
      const esperado = HASH_BASELINE_MOTOR[alvo.nome]
      expect(
        obtido,
        `O corpo de ${alvo.nome} mudou (esperado ${esperado}, obtido ${obtido}). ` +
          'A spec proíbe alterar o motor e a ancoragem; só atualize o hash com decisão registrada do usuário.',
      ).toBe(esperado)
    })

    it(`${alvo.nome}: o trecho extraído começa na assinatura e termina na chave de fechamento`, () => {
      const corpo = extrairCorpoFuncao(alvo)
      expect(corpo).toContain(`function ${alvo.nome}(`)
      expect(corpo.trimEnd().endsWith('}')).toBe(true)
      expect(corpo.split('\n').length).toBeGreaterThan(20)
    })
  }

  it('o hash reage a qualquer alteração do texto (1 caractere) e ignora fim de linha e espaço final', () => {
    const corpo = extrairCorpoFuncao(ALVOS_GUARD[0])
    expect(hashTexto(corpo + ' ')).not.toBe(hashTexto(corpo))
    expect(hashTexto(corpo.replace('const', 'cons'))).not.toBe(hashTexto(corpo))
    // a normalização (CRLF e espaços no fim da linha) acontece na extração, não no hash
    expect(hashCorpoFuncao(ALVOS_GUARD[0])).toBe(HASH_BASELINE_MOTOR.calcularOrcamentoGrafico)
  })
})
