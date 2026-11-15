import { describe, expect, it } from 'vitest'
import {
  chaveAjuste,
  mapearAjustes,
  mapearAtividades,
  mapearCamposLivres,
  mapearLinhas,
  mapearMateriais,
  mapearParametros,
  mapearPlanos,
  mapearProdutos,
  mapearRestricoes,
  precoVigente,
} from './mapeamento'
import { planejarPorOrigem } from './planejador'

describe('mapeamento — amostra do legado', () => {
  it('preserva acentos e caixa do nome; só tira espaços das pontas', () => {
    const [a] = mapearAtividades([{ Codigo: 37, Ativo: 'ATIVO', Nome: ' Laminação maior ', TipoAtividade: 'Acabamento', PlanoProduto: 'PLANO', TextoProposta: ' ' }], { codigosAcondicionamento: new Set() })
    expect(a.nome).toBe('Laminação maior')
    expect(a.chave).toBe('CG-ACAB-37')
    expect(a.dados.textoProposta).toBeUndefined() // texto em branco do legado não vira valor
    expect(a.dados.tipoAtividade).toBe('ACABAMENTO')
  })

  it('produto de teste cancelado é ignorado; os demais entram com os dados do legado', () => {
    const itens = mapearProdutos(
      [
        { Codigo: 1, Ativo: 'ATIVO', Nome: 'Cartuchos', CodLinhaProduto: 5, Formato: '3 dimensões', TipoCartucho: 'Simples', CodTributacaoVenda: 2, BaseUnidade: 1 },
        { Codigo: 10, Ativo: 'CANCELADO', Nome: 'TESTE', CodLinhaProduto: 5 },
      ],
      { idsLinha: new Map([[5, 'lin-5']]), tributacoes: new Map([[2, 'ICMS + IPI']]) },
    )
    expect(itens[0].dados).toMatchObject({ linhaProdutoId: 'lin-5', modoFormato: 'TRES_DIMENSOES', tributacao2026: 'ICMS + IPI', baseUnidadePreco: 'UNITARIO', tipoCartucho: 'Simples' })
    const plano = planejarPorOrigem('produtos', itens, [])
    expect(plano.operacoes.map((o) => o.tipo)).toEqual(['CRIAR', 'IGNORAR'])
  })

  it('catálogo simples: linha cancelada não é criada', () => {
    const itens = mapearLinhas([{ Codigo: 2, Nome: 'LÂMINAS', Ativo: 'Ativo' }, { Codigo: 9, Nome: 'Velha', Ativo: 'CANCELADO' }])
    expect(planejarPorOrigem('catalogos', itens, []).operacoes.map((o) => o.tipo)).toEqual(['CRIAR', 'IGNORAR'])
    expect(itens[0].chave).toBe('CG-LIN-2')
  })

  it('tipo de plano lê as características do plano na linha certa', () => {
    const [p] = mapearPlanos(
      [{ CODIGO: 21, NOME: 'Miolo', ATIVO: 'ATIVO', CODLINHAPRODUTO: 2, MARGEM1: 3, FlagPinca: -1 }],
      [
        { codLinhaProduto: 2, codPlano: 21, NomeCampo: 'Plano Miolo', ValorCampo: 'SIM' },
        { codLinhaProduto: 2, codPlano: 21, NomeCampo: 'Tipo Largura', ValorCampo: 'LFX2' },
        { codLinhaProduto: 2, codPlano: 21, NomeCampo: 'Cálc.Autom.Formato', ValorCampo: 'OPCIONAL' },
        { codLinhaProduto: 2, codPlano: 21, NomeCampo: 'Tipo Ocorrencia', ValorCampo: 'LIVRE' },
        { codLinhaProduto: 9, codPlano: 21, NomeCampo: 'Somar lombada', ValorCampo: 'SIM' }, // outra linha: não vale
      ],
      { idsLinha: new Map([[2, 'lin-2']]), idsSuporte: new Map() },
    )
    expect(p.dados).toMatchObject({ miolo: true, primeiraMedida: 'LFX2', calculoAutomaticoFormato: 'OPCIONAL', ocorrencias: 'LIVRE', usarPinca: true, fixo: false, margem1Mm: 3, linhaProdutoId: 'lin-2' })
    expect(p.dados.somarLombada).toBeUndefined()
  })

  it('material: preço da tabela vigente (coluna 1), tipo e unidade', () => {
    const precos = [
      { codTabelaCusto: 1, coluna: 1, valorTotal: 0.5 },
      { codTabelaCusto: 2, coluna: 1, valorTotal: 0.605 },
      { codTabelaCusto: 2, coluna: 2, valorTotal: 9 },
    ]
    expect(precoVigente(precos)).toBe(0.605)
    expect(precoVigente([{ codTabelaCusto: 2, coluna: 1, valorTotal: 0 }])).toBeNull()
    const [m] = mapearMateriais([{ Codigo: 14, Ativo: 'ATIVO', Nome: 'BOPP Brilho', Tipo: 'Revestimento por m2', Unidade: 'M2', Precos: precos }], { codigosMedidaLinear: new Set() })
    expect(m.dados).toMatchObject({ valorReferencia: 0.605, tipoMaterial: 'OUTRO', unidadeCusto: 'M2', medidaLinear: false })
    expect(m.chave).toBe('CG-MAT-14')
  })

  it('campo livre com proprietário sem equivalente (ACP) vira não casado; ARTE/PADRÃO entram', () => {
    const itens = mapearCamposLivres([
      { Proprietario: 'SOL', Codigo: 1, Caption: 'ARTE', Tipo: 2, CodChave: 5, Ativo: 'ATIVO', FlagPreenchimentoObrigatorio: -1 },
      { Proprietario: 'ACP', Codigo: 1, Caption: 'Pedido Cliente', Tipo: 1, CodChave: 3, Ativo: 'ATIVO' },
    ])
    expect(itens[0].dados).toMatchObject({ proprietario: 'SOLICITACAO', tipo: 'LISTA', obrigatorio: true })
    expect(itens[0].nome).toBe('ARTE')
    expect(itens[1].rejeicao?.detalhe).toContain('ACP')
    const ops = planejarPorOrigem('campos-livres', itens, [])
    expect(ops.operacoes.map((o) => o.tipo)).toEqual(['CRIAR', 'NAO_CASADO'])
  })

  it('restrições: casamento por nome só dentro da mesma atividade', () => {
    const itens = mapearRestricoes([{ Codigo: 1, Ativo: 'ATIVO', Nome: 'Normal Repetição ', CodAtividade: 11, flagExibirProposta: 0 }], {
      idsAtividade: new Map([[11, 'acab-11']]),
      atividadesCanceladas: new Set(),
    })
    expect(itens[0].nomeCasamento).toBe('acab-11|Normal Repetição')
    expect(itens[0].dados).toMatchObject({ acabamentoGraficoId: 'acab-11', tempoAcertoMin: 0, tempoOperacaoMin: 0 })
  })

  it('ajuste: centro sem equivalente no Vizor vira não casado (não aplica a todos os centros)', () => {
    const ctx = {
      idsAtividade: new Map([[10, 'acab-10']]),
      idsCentro: new Map([[7, 'cen-7']]),
      atividadesCanceladas: new Set<number>(),
      idsRestricaoPorNome: new Map([['10|normal repeticao', 'res-1']]),
      nomesCentro: new Map([[46, 'Heidelberg CD 7']]),
    }
    const [ok, semCentro, enumDesconhecido] = mapearAjustes(
      [
        { CodAtividade: 10, CodCentroProducao: 7, DadoAjustar: 'Acerto', Funcao: 'Restrição Manual', Operador: 'Igual a', Valor: 'Normal Repetição', Fator: 0.2, FlagPositiva: -1 },
        { CodAtividade: 10, CodCentroProducao: 46, DadoAjustar: 'Acerto', Funcao: 'Atividade', Operador: 'Igual a', Valor: 'x', Fator: 1 },
        { CodAtividade: 10, CodCentroProducao: 0, DadoAjustar: 'Algo novo', Funcao: 'Atividade', Fator: 1 },
      ],
      ctx,
    )
    expect(ok.dados).toMatchObject({ acabamentoId: 'acab-10', centroProducaoId: 'cen-7', dadoAjustar: 'ACERTO', funcao: 'RESTRICAO_MANUAL', restricaoId: 'res-1', fator: 0.2 })
    expect(ok.chaveNatural).toBe(chaveAjuste({ acabamentoId: 'acab-10', centroProducaoId: 'cen-7', dadoAjustar: 'ACERTO', funcao: 'RESTRICAO_MANUAL', operador: 'Igual a', valor: 'Normal Repetição', fator: 0.2 }))
    expect(semCentro.rejeicao).toMatchObject({ motivo: 'DEPENDENCIA_SEM_EQUIVALENTE' })
    expect(semCentro.rejeicao?.detalhe).toContain('Heidelberg CD 7')
    expect(enumDesconhecido.rejeicao).toMatchObject({ motivo: 'VALOR_SEM_EQUIVALENTE' })
  })

  it('parâmetros: só a lista fechada, com guarda pela descrição', () => {
    const itens = mapearParametros([
      { Codigo: 124, Tipo: 'CÁLCULO', Descricao: 'Refile folha inteira', Conteudo: '2' },
      { Codigo: 91, Tipo: 'FECHAMENTO', Descricao: 'Taxa mensal de juros para aplicação', Conteudo: '2,00' },
      { Codigo: 125, Tipo: 'CÁLCULO', Descricao: 'Outra coisa qualquer', Conteudo: '8' },
    ])
    const refile = itens.find((i) => i.chaveNatural === 'orc.refileFolhaInteira')!
    expect(refile.dados).toEqual({ valor: '2' })
    expect(itens.find((i) => i.chaveNatural === 'orc.jurosAplicacaoMes')!.dados).toEqual({ valor: '2' })
    expect(itens.find((i) => i.chaveNatural === 'orc.contraPinca')!.rejeicao?.motivo).toBe('VALOR_SEM_EQUIVALENTE')
    expect(itens.find((i) => i.chaveNatural === 'orc.corteDuplo')!.rejeicao?.motivo).toBe('SEM_EQUIVALENTE') // ausente no export
  })
})
