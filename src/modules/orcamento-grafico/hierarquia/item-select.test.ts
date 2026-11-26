import { describe, it, expect } from 'vitest'
import {
  ITEM_SELECT_HIDRATACAO,
  CAMPOS_ENGENHARIA_ITEM,
  MAPA_ENGENHARIA_NO_SELECT,
} from './item-select'

// Cópia literal das chaves do select antigo do GET /:id (antes da extração).
const CHAVES_ITEM_ANTIGAS = [
  'id', 'orcamentoId', 'empresaId', 'sequencia', 'tipoEmbalagemId', 'descricao', 'medidas',
  'papelId', 'papelDescricao', 'suporteId', 'gramatura', 'numCores', 'cores', 'maquinaId',
  'matrizQuantidade', 'matrizPrecoUnitario', 'tintaModo', 'tintaConsumoKg', 'acabamentosRicos',
  'modeloFacaId', 'itensDiversos', 'itensFornecidos', 'camposLivres', 'preImpressao', 'quantidade',
  'resultadoCalculo', 'margemSelecionada', 'custoProducao', 'valorTotal', 'pendente',
  'criadoEm', 'atualizadoEm', 'siglaAcabado', 'tributacao', 'processoImpressao',
  'coberturaTintaTexto', 'fabricante', 'microondulado', 'materialMicroonduladoId', 'fornecido',
  'qtdModelos', 'arte', 'observacao', 'observacaoAreasOp', 'conteudoVolume', 'acondicionamento',
  'comprimentoMm', 'larguraMm', 'alturaMm', 'abaColaMm', 'abaFechamentoMm', 'fibra',
  'montagemLinhas', 'montagemColunas', 'formatoSupLarguraMm', 'formatoSupAlturaMm',
  'formatoCorteLarguraMm', 'formatoCorteAlturaMm', 'ajusteCorteMicroMm', 'suporteProducaoId',
  'calculoGraficoOrigemId', 'produtoGraficoId', 'materiaisAcabamento', 'planos',
]

// Colunas informativas D3 (tarefa 5.3/5.4) — aditivas, fora do motor.
const CHAVES_ITEM_D3 = [
  'formatoFechadoLarguraMm', 'formatoFechadoAlturaMm', 'formatoAbertoLarguraMm',
  'formatoAbertoAlturaMm', 'formatoFinalLarguraMm', 'formatoFinalAlturaMm', 'alturaTampaMm',
  'numeroSanfonas', 'numeroPaginas',
]

// Várias tiragens por item (spec orcamento-grafico-tiragens-por-item) — relação aditiva.
const CHAVES_ITEM_TIRAGENS = ['tiragens']
const CHAVES_PLANO_ANTIGAS = [
  'id', 'sequencia', 'nome', 'tipoPlanoId', 'suporteId', 'suporteProducaoId', 'gramatura',
  'formatoLarguraMm', 'formatoAlturaMm', 'numCores', 'cores', 'maquinaId', 'acabamentosRicos',
  'custoSuporte', 'custoImpressao', 'custoAcabamento',
]

describe('ITEM_SELECT_HIDRATACAO', () => {
  it('as tiragens vêm ordenadas pela referência primeiro e não expõem o contexto interno de preço', () => {
    expect(ITEM_SELECT_HIDRATACAO.tiragens.orderBy).toEqual({ ordem: 'asc' })
    const chaves = Object.keys(ITEM_SELECT_HIDRATACAO.tiragens.select)
    expect(chaves).toEqual(
      expect.arrayContaining(['ordem', 'quantidade', 'custoProducao', 'margemPerc', 'valorTotal', 'valorInformado', 'cmValor', 'cmPerc']),
    )
    expect(chaves).not.toContain('contexto')
    expect(chaves).not.toContain('empresaId')
  })
  it('mantém as chaves do select antigo do GET /:id (item) e só acrescenta as colunas D3', () => {
    expect(Object.keys(ITEM_SELECT_HIDRATACAO).sort()).toEqual(
      [...CHAVES_ITEM_ANTIGAS, ...CHAVES_ITEM_D3, ...CHAVES_ITEM_TIRAGENS].sort(),
    )
  })

  it('mantém exatamente as chaves do select antigo dos planos', () => {
    expect(Object.keys(ITEM_SELECT_HIDRATACAO.planos.select).sort()).toEqual(
      [...CHAVES_PLANO_ANTIGAS].sort(),
    )
    expect(ITEM_SELECT_HIDRATACAO.planos.orderBy).toEqual({ sequencia: 'asc' })
  })

  it('todo campo de engenharia está presente (select ou anexo SQL)', () => {
    const faltando = CAMPOS_ENGENHARIA_ITEM.filter((c) => !MAPA_ENGENHARIA_NO_SELECT[c])
    expect(faltando).toEqual([])
  })

  it('aproveitamentoManual é anexado por SQL, não pelo select', () => {
    expect('aproveitamentoManual' in ITEM_SELECT_HIDRATACAO).toBe(false)
    expect(MAPA_ENGENHARIA_NO_SELECT.aproveitamentoManual).toBe(true)
  })
})
