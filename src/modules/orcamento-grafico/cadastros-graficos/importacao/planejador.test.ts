import { describe, expect, it, vi } from 'vitest'
import {
  executarPlano,
  planejarPorChaveNatural,
  planejarPorOrigem,
  type ExecutorCadastro,
  type ExistenteCadastro,
  type ItemLegado,
} from './planejador'
import { formatarRelatorio, totalizar } from './relatorio'

const item = (codigoOrigem: number, nome: string, extra: Partial<ItemLegado> = {}): ItemLegado => ({
  codigoOrigem,
  nome,
  chave: `CG-X-${codigoOrigem}`,
  dados: {},
  ...extra,
})

const existente = (id: string, nome: string, codigoOrigem: number | null, campos: Record<string, unknown> = {}, chave: string | null = null): ExistenteCadastro => ({
  id,
  nome,
  codigoOrigem,
  chave,
  campos,
})

/** Banco em memória: o executor grava aqui e `comoExistentes` devolve o estado para a 2ª execução. */
function bancoEmMemoria() {
  const registros = new Map<string, { id: string; nome: string; chave: string | null; codigoOrigem: number | null; campos: Record<string, unknown> }>()
  let seq = 0
  const executor: ExecutorCadastro = {
    async criar(it) {
      const id = `id-${++seq}`
      registros.set(id, { id, nome: it.nome, chave: it.chave ?? null, codigoOrigem: it.codigoOrigem, campos: { ...it.dados } })
      return id
    },
    async atualizar(id, patch) {
      const r = registros.get(id)!
      const { codigoOrigem, ...resto } = patch as Record<string, unknown> & { codigoOrigem?: number }
      if (codigoOrigem !== undefined) r.codigoOrigem = codigoOrigem
      Object.assign(r.campos, resto)
    },
  }
  const comoExistentes = (): ExistenteCadastro[] => [...registros.values()].map((r) => ({ ...r }))
  return { executor, comoExistentes, registros }
}

describe('planejarPorOrigem — criação, preenchimento e idempotência', () => {
  it('cria o que não existe e usa a chave textual', () => {
    const plano = planejarPorOrigem('atividades', [item(1, 'Laminação maior')], [])
    expect(plano.operacoes).toHaveLength(1)
    expect(plano.operacoes[0].tipo).toBe('CRIAR')
  })

  it('casa por nome normalizado e PRESERVA os acentos do nome do legado', () => {
    const itens = [item(37, 'Laminação maior', { chave: null, dados: { textoProposta: 'Laminação maior' } })]
    const plano = planejarPorOrigem('atividades', itens, [existente('a1', 'LAMINACAO MAIOR', null, { textoProposta: null })])
    const op = plano.operacoes[0]
    expect(op.tipo).toBe('PREENCHER')
    if (op.tipo !== 'PREENCHER') return
    expect(op.id).toBe('a1')
    expect(op.via).toBe('NOME')
    expect(op.patch).toEqual({ textoProposta: 'Laminação maior', codigoOrigem: 37 })
    expect(op.item.nome).toBe('Laminação maior') // o nome original, com acento, é o que chega ao executor
  })

  it('nunca sobrescreve campo preenchido; preenche só os vazios', () => {
    const itens = [item(5, 'Cartão', { dados: { textoProposta: 'novo', sigla: 'CT', caracteristicas: { a: 1 }, ordem: 3 } })]
    const plano = planejarPorOrigem('x', itens, [
      existente('e1', 'Cartão', 5, { textoProposta: 'DIGITADO PELO USUÁRIO', sigla: '', caracteristicas: null, ordem: 0 }),
    ])
    const op = plano.operacoes[0]
    expect(op.tipo).toBe('PREENCHER')
    if (op.tipo !== 'PREENCHER') return
    expect(op.patch).toEqual({ sigla: 'CT', caracteristicas: { a: 1 } }) // 0 e texto digitado ficam intactos
  })

  it('predicado extra: preço zero conta como vazio só quando pedido', () => {
    const itens = [item(14, 'BOPP Brilho', { dados: { valorReferencia: 0.605 } })]
    const ex = [existente('m1', 'BOPP Brilho', 14, { valorReferencia: 0 })]
    expect(planejarPorOrigem('materiais', itens, ex).operacoes[0].tipo).toBe('IGNORAR')
    const com = planejarPorOrigem('materiais', itens, ex, { tratarComoVazio: { valorReferencia: (v) => v === null || v === 0 } })
    expect(com.operacoes[0].tipo).toBe('PREENCHER')
  })

  it('2+ candidatos pelo nome = NÃO CASADO (ambíguo), sem criar nem mesclar', () => {
    const plano = planejarPorOrigem('atividades', [item(8, 'Cola', { chave: null })], [existente('a', 'cola', null), existente('b', 'COLA', null)])
    const op = plano.operacoes[0]
    expect(op.tipo).toBe('NAO_CASADO')
    if (op.tipo === 'NAO_CASADO') expect(op.motivo).toBe('AMBIGUO')
  })

  it('nome repetido em 2+ itens do legado não casa com existente por nome', () => {
    const plano = planejarPorOrigem('x', [item(1, 'Impressos', { chave: null }), item(2, 'Impressos', { chave: null })], [existente('e', 'Impressos', null)])
    expect(plano.operacoes.map((o) => (o.tipo === 'NAO_CASADO' ? o.motivo : o.tipo))).toEqual(['NOME_REPETIDO_NO_LEGADO', 'NOME_REPETIDO_NO_LEGADO'])
  })

  it('chave textual de outro código de origem = não casado (CHAVE_EM_USO)', () => {
    const plano = planejarPorOrigem('x', [item(9, 'Novo')], [existente('e', 'Outro', 77, {}, 'CG-X-9')])
    const op = plano.operacoes[0]
    expect(op.tipo === 'NAO_CASADO' && op.motivo).toBe('CHAVE_EM_USO')
  })

  it('cancelado sem equivalente não é criado (produto de teste); cancelado existente ainda pode ser preenchido', () => {
    const teste = item(10, 'TESTE', { cancelado: true })
    expect(planejarPorOrigem('produtos', [teste], []).operacoes[0]).toMatchObject({ tipo: 'IGNORAR', motivo: 'CANCELADO_NO_LEGADO' })
    const pre = planejarPorOrigem('produtos', [{ ...teste, dados: { sigla: 'T' } }], [existente('p', 'TESTE', 10, { sigla: null })])
    expect(pre.operacoes[0].tipo).toBe('PREENCHER')
  })

  it('entidade que o importador não cria (centro/suporte): sem equivalente = não casado', () => {
    const plano = planejarPorOrigem('centros', [item(1, 'KBA Rapida 75 6cores', { chave: null })], [existente('c', 'KBA-75-6', null)], { criaQuandoSemEquivalente: false })
    expect(plano.operacoes[0]).toMatchObject({ tipo: 'NAO_CASADO', motivo: 'SEM_EQUIVALENTE' })
  })

  it('o mesmo código repetido no legado vira ignorado (duplicado)', () => {
    const plano = planejarPorOrigem('x', [item(1, 'A'), item(1, 'A')], [])
    expect(plano.operacoes.map((o) => o.tipo)).toEqual(['CRIAR', 'IGNORAR'])
  })

  it('item rejeitado pelo mapeamento chega como não casado com o detalhe', () => {
    const rej = item(3, 'ACP', { rejeicao: { motivo: 'VALOR_SEM_EQUIVALENTE', detalhe: 'proprietário "ACP" sem equivalente' } })
    expect(planejarPorOrigem('campos-livres', [rej], []).operacoes[0]).toMatchObject({ tipo: 'NAO_CASADO', motivo: 'VALOR_SEM_EQUIVALENTE' })
  })
})

describe('executarPlano — dry-run e segunda execução', () => {
  it('--dry-run NÃO chama o executor, mas devolve contagens e ids sintéticos', async () => {
    const criar = vi.fn()
    const atualizar = vi.fn()
    const plano = planejarPorOrigem('atividades', [item(1, 'A'), item(2, 'B', { dados: { x: 1 } })], [existente('e2', 'B', 2, { x: null })])
    const r = await executarPlano(plano, { criar, atualizar }, { dryRun: true })
    expect(criar).not.toHaveBeenCalled()
    expect(atualizar).not.toHaveBeenCalled()
    expect(r.relatorio).toMatchObject({ criados: 1, atualizados: 1 })
    expect(r.idsPorCodigo.get(1)).toBe('dry:atividades:1')
    expect(r.idsPorCodigo.get(2)).toBe('e2')
  })

  it('a SEGUNDA execução cria zero e atualiza zero', async () => {
    const banco = bancoEmMemoria()
    const itens = [
      item(1, 'Cartão', { dados: { textoProposta: 'Cartão' } }),
      item(2, 'Microondulado', { dados: { caracteristicas: { ordem: 2 } } }),
      item(3, 'Invólucros', { dados: {} }),
    ]
    const r1 = await executarPlano(planejarPorOrigem('planos', itens, banco.comoExistentes()), banco.executor, { dryRun: false })
    expect(r1.relatorio.criados).toBe(3)

    const r2 = await executarPlano(planejarPorOrigem('planos', itens, banco.comoExistentes()), banco.executor, { dryRun: false })
    expect(r2.relatorio).toMatchObject({ criados: 0, atualizados: 0, ignorados: 3 })
    expect(banco.registros.size).toBe(3)
  })

  it('preencher um existente sem codigoOrigem é idempotente (na 2ª já casa por código)', async () => {
    const banco = bancoEmMemoria()
    banco.registros.set('pre', { id: 'pre', nome: 'Cartão', chave: null, codigoOrigem: null, campos: { textoProposta: null } })
    const itens = [item(1, 'Cartão', { chave: null, dados: { textoProposta: 'Cartão' } })]
    const r1 = await executarPlano(planejarPorOrigem('planos', itens, banco.comoExistentes()), banco.executor, { dryRun: false })
    expect(r1.relatorio).toMatchObject({ criados: 0, atualizados: 1 })
    const r2 = await executarPlano(planejarPorOrigem('planos', itens, banco.comoExistentes()), banco.executor, { dryRun: false })
    expect(r2.relatorio).toMatchObject({ criados: 0, atualizados: 0, ignorados: 1 })
  })
})

describe('planejarPorChaveNatural', () => {
  const natural = (chave: string | undefined, extra: Partial<ItemLegado> = {}): ItemLegado => ({ codigoOrigem: null, nome: `n ${chave}`, chaveNatural: chave, dados: { v: 1 }, ...extra })

  it('cria, ignora o que já existe e nunca grava codigoOrigem', async () => {
    const ex: ExistenteCadastro = { id: 'e1', nome: 'x', codigoOrigem: null, chaveNatural: 'a|1', campos: { v: 1 } }
    const plano = planejarPorChaveNatural('limites', [natural('a|1'), natural('a|2')], [ex])
    expect(plano.operacoes.map((o) => o.tipo)).toEqual(['IGNORAR', 'CRIAR'])
  })

  it('cancelado sem chave é ignorado; ativo sem chave é não casado', () => {
    const plano = planejarPorChaveNatural('x', [natural(undefined, { cancelado: true }), natural(undefined)], [])
    expect(plano.operacoes.map((o) => o.tipo)).toEqual(['IGNORAR', 'NAO_CASADO'])
  })
})

describe('relatório', () => {
  it('lista os não casados com motivo e detalhe, e totaliza', async () => {
    const plano = planejarPorOrigem(
      'atividades',
      [item(1, 'Cola', { chave: null }), item(2, 'Verniz', { chave: 'CG-ACAB-2' })],
      [existente('a', 'cola', null), existente('b', 'COLA', null)],
    )
    const { relatorio } = await executarPlano(plano, { criar: async () => 'novo', atualizar: async () => {} }, { dryRun: true })
    expect(relatorio.naoCasados).toEqual([{ codigoOrigem: 1, nome: 'Cola', motivo: 'AMBIGUO', detalhe: expect.stringContaining('2 candidatos') }])
    expect(totalizar([relatorio])).toEqual({ criados: 1, atualizados: 0, ignorados: 0, naoCasados: 1 })
    const texto = formatarRelatorio([relatorio], { dryRun: true })
    expect(texto).toContain('DRY-RUN')
    expect(texto).toContain('[atividades] criados=1')
    expect(texto).toContain('AMBIGUO=1')
    expect(texto).toContain('"Cola"')
  })
})
