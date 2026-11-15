import { describe, expect, it } from 'vitest'
import { codigosAcondicionamento, planejarRelacoes, relatorioDeRelacoes, type ResolvedorRelacoes } from './relacoes-plano'
import { traduzirRelTabela, traduzirRelTabelas, type LinhaRelTabelas } from './tabelas-relacao'

const l = (t1: number, i1: number, t2: number, i2: number, descartar = false): LinhaRelTabelas => ({
  CodTabela1: t1,
  CodItem1: i1,
  CodTabela2: t2,
  CodItem2: i2,
  descartar,
})

const mapa = (pares: [number, string][]) => new Map<number, string>(pares)

const resolvedor: ResolvedorRelacoes = {
  ids: {
    PLANO: mapa([[2, 'plano-2']]),
    ATIVIDADE: mapa([[10, 'atv-10'], [39, 'atv-39']]),
    PRODUTO: mapa([[1, 'prod-1']]),
    SUPORTE: mapa([[5, 'sup-5']]),
    // ACONDICIONAMENTO aponta para atividades (Caixa Padrão 39, Embalar 53)
    ACONDICIONAMENTO: mapa([[39, 'atv-39']]),
    // TINTA e MATRIZ propositalmente ausentes: o Vizor não tem cadastro com código de origem
  },
  cancelados: { ATIVIDADE: new Set([77]) },
}

describe('tradutor de códigos de tabela (7.3)', () => {
  it('traduz os 12 códigos aceitos e descarta a 9', () => {
    expect(traduzirRelTabela(l(2, 1, 4, 10))).toMatchObject({ ok: true, origem: { tipo: 'PLANO', codigo: 1 }, destino: { tipo: 'ATIVIDADE', codigo: 10 }, invertida: false })
    expect(traduzirRelTabela(l(10, 1, 6, 39))).toMatchObject({ ok: true, origem: { tipo: 'PRODUTO' }, destino: { tipo: 'ACONDICIONAMENTO' } })
    expect(traduzirRelTabela(l(9, 1, 8, 11))).toMatchObject({ ok: false, motivo: 'DESCARTADA' })
    expect(traduzirRelTabela(l(8, 11, 9, 1))).toMatchObject({ ok: false, motivo: 'DESCARTADA' })
    expect(traduzirRelTabela({ ...l(4, 1, 8, 2), descartar: true })).toMatchObject({ ok: false, motivo: 'DESCARTADA' })
  })

  it('inverte o sentido quando só o inverso está em PARES_PERMITIDOS', () => {
    // RelTabelas guarda ATIVIDADE→PLANO, o Vizor tem PLANO→ATIVIDADE
    expect(traduzirRelTabela(l(4, 10, 2, 2))).toMatchObject({ ok: true, origem: { tipo: 'PLANO', codigo: 2 }, destino: { tipo: 'ATIVIDADE', codigo: 10 }, invertida: true })
  })

  it('rejeita par fora da lista e código sem equivalente', () => {
    expect(traduzirRelTabela(l(0, 1, 0, 2))).toMatchObject({ ok: false, motivo: 'PAR_NAO_PERMITIDO' }) // SUPORTE × SUPORTE
    expect(traduzirRelTabela(l(7, 1, 4, 2))).toMatchObject({ ok: false, motivo: 'CODIGO_DESCONHECIDO' })
  })

  it('o mesmo par nos dois sentidos conta uma vez', () => {
    const r = traduzirRelTabelas([l(2, 1, 4, 10), l(4, 10, 2, 1)])
    expect(r.relacoes).toHaveLength(1)
    expect(r.duplicadas).toBe(1)
  })
})

describe('planejarRelacoes', () => {
  const linhas: LinhaRelTabelas[] = [
    l(2, 2, 4, 10), // PLANO→ATIVIDADE ok
    l(4, 39, 10, 1), // ATIVIDADE→PRODUTO invertido: PRODUTO→ATIVIDADE ok
    l(10, 1, 6, 39), // PRODUTO→ACONDICIONAMENTO ok
    l(2, 2, 0, 5), // PLANO→SUPORTE ok
    l(9, 3, 8, 11, true), // tabela 9: descartada
    l(4, 10, 11, 4), // ATIVIDADE→TINTA: sem cadastro no Vizor
    l(2, 2, 4, 999), // atividade inexistente no Vizor
    l(4, 77, 10, 1), // atividade cancelada no legado
    l(0, 1, 0, 2), // par fora da lista
  ]

  it('cria as resolvidas, descarta a tabela 9 e lista os não casados com motivo', () => {
    const plano = planejarRelacoes(linhas, resolvedor, [])
    const rel = relatorioDeRelacoes(plano)
    expect(rel.criados).toBe(4)
    expect(rel.ignoradosPorMotivo).toMatchObject({ TABELA_9_DESCARTADA: 1, CANCELADO_NO_LEGADO: 1 })
    const motivos = Object.fromEntries(rel.naoCasados.map((n) => [n.motivo, n.nome]))
    expect(motivos.TIPO_SEM_CADASTRO_NO_VIZOR).toContain('TINTA 4')
    expect(motivos.DESTINO_SEM_EQUIVALENTE).toContain('ATIVIDADE 999')
    expect(motivos.PAR_NAO_PERMITIDO).toContain('tabela 0:1 → tabela 0:2')
    const criadas = plano.operacoes.flatMap((o) => (o.tipo === 'CRIAR' ? [`${o.relacao.tipoOrigem}:${o.relacao.idOrigem}>${o.relacao.tipoDestino}:${o.relacao.idDestino}`] : []))
    expect(criadas).toEqual(expect.arrayContaining(['PLANO:plano-2>ATIVIDADE:atv-10', 'PRODUTO:prod-1>ATIVIDADE:atv-39', 'PRODUTO:prod-1>ACONDICIONAMENTO:atv-39', 'PLANO:plano-2>SUPORTE:sup-5']))
  })

  it('nenhuma linha da tabela 9 vira relação', () => {
    const plano = planejarRelacoes([l(9, 1, 8, 11), l(8, 11, 9, 1), l(9, 2, 8, 12, true)], resolvedor, [])
    expect(plano.operacoes).toHaveLength(0)
    expect(plano.descartadas).toBe(3)
  })

  it('segunda execução cria zero: o que já existe é ignorado', () => {
    const primeira = planejarRelacoes(linhas, resolvedor, [])
    const existentes = primeira.operacoes.flatMap((o) => (o.tipo === 'CRIAR' ? [{ tipoOrigem: o.relacao.tipoOrigem, idOrigem: o.relacao.idOrigem, tipoDestino: o.relacao.tipoDestino, idDestino: o.relacao.idDestino }] : []))
    const segunda = relatorioDeRelacoes(planejarRelacoes(linhas, resolvedor, existentes))
    expect(segunda.criados).toBe(0)
    expect(segunda.ignoradosPorMotivo.JA_EXISTE).toBe(4)
  })

  it('relação do mesmo par vinda nos dois sentidos cria uma só', () => {
    const plano = relatorioDeRelacoes(planejarRelacoes([l(2, 2, 4, 10), l(4, 10, 2, 2)], resolvedor, []))
    expect(plano.criados).toBe(1)
  })

  it('acondicionamento: lista os destinos da tabela 6', () => {
    const t = traduzirRelTabelas([l(10, 7, 6, 53), l(10, 7, 6, 39), l(10, 1, 1, 3)])
    expect([...codigosAcondicionamento(t.relacoes)].sort((a, b) => a - b)).toEqual([39, 53])
  })
})
