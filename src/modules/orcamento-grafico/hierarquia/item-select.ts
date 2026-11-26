import { prisma } from '../../../lib/prisma'

/** Select dos planos usado na hidratação do GET /:id (fonte única, sem alterar campos). */
export const PLANO_SELECT_HIDRATACAO = {
  id: true,
  sequencia: true,
  nome: true,
  tipoPlanoId: true,
  suporteId: true,
  suporteProducaoId: true,
  gramatura: true,
  formatoLarguraMm: true,
  formatoAlturaMm: true,
  numCores: true,
  cores: true,
  maquinaId: true,
  acabamentosRicos: true,
  custoSuporte: true,
  custoImpressao: true,
  custoAcabamento: true,
} as const

/** Select das tiragens do item na hidratação do GET /:id (sem o contexto interno de preço). */
export const TIRAGEM_SELECT_HIDRATACAO = {
  id: true,
  ordem: true,
  quantidade: true,
  custoProducao: true,
  materialDireto: true,
  custoTransformacao: true,
  servicoExterno: true,
  margemPerc: true,
  faixaMargem: true,
  valorTotal: true,
  valorInformado: true,
  cmValor: true,
  cmPerc: true,
} as const
/**
 * Select de hidratação dos itens do orçamento gráfico (GET /:id).
 * Fonte única: extraído de orcamento-grafico.routes.ts sem alterar nenhum campo.
 * select explícito (nunca omit) para não materializar JSONs além do necessário.
 *
 * `aproveitamentoManual` NÃO está aqui: a coluna fica fora do client Prisma e é
 * anexada por `anexarAproveitamentoManual` (SQL raw) depois da leitura.
 */
export const ITEM_SELECT_HIDRATACAO = {
  id: true,
  orcamentoId: true,
  empresaId: true,
  sequencia: true,
  tipoEmbalagemId: true,
  descricao: true,
  medidas: true,
  papelId: true,
  papelDescricao: true,
  suporteId: true,
  gramatura: true,
  numCores: true,
  cores: true,
  maquinaId: true,
  matrizQuantidade: true,
  matrizPrecoUnitario: true,
  tintaModo: true,
  tintaConsumoKg: true,
  acabamentosRicos: true,
  modeloFacaId: true,
  itensDiversos: true,
  itensFornecidos: true,
  camposLivres: true,
  preImpressao: true,
  quantidade: true,
  // Várias tiragens do item (uma linha por tiragem; a de ordem 0 é a referência espelhada no item).
  tiragens: { orderBy: { ordem: 'asc' }, select: TIRAGEM_SELECT_HIDRATACAO },
  resultadoCalculo: true,
  margemSelecionada: true,
  custoProducao: true,
  valorTotal: true,
  pendente: true,
  criadoEm: true,
  atualizadoEm: true,
  // Paridade/geometria/acondicionamento
  siglaAcabado: true,
  tributacao: true,
  processoImpressao: true,
  coberturaTintaTexto: true,
  fabricante: true,
  microondulado: true,
  materialMicroonduladoId: true,
  fornecido: true,
  qtdModelos: true,
  arte: true,
  observacao: true,
  observacaoAreasOp: true,
  conteudoVolume: true,
  acondicionamento: true,
  comprimentoMm: true,
  larguraMm: true,
  alturaMm: true,
  abaColaMm: true,
  abaFechamentoMm: true,
  fibra: true,
  montagemLinhas: true,
  montagemColunas: true,
  formatoSupLarguraMm: true,
  formatoSupAlturaMm: true,
  formatoCorteLarguraMm: true,
  formatoCorteAlturaMm: true,
  ajusteCorteMicroMm: true,
  suporteProducaoId: true,
  // Origem do item (repetição) e catálogo
  calculoGraficoOrigemId: true,
  produtoGraficoId: true,
  materiaisAcabamento: true,
  // Hierarquia Item/Plano (D3) — informativos, fora do cálculo
  formatoFechadoLarguraMm: true,
  formatoFechadoAlturaMm: true,
  formatoAbertoLarguraMm: true,
  formatoAbertoAlturaMm: true,
  formatoFinalLarguraMm: true,
  formatoFinalAlturaMm: true,
  alturaTampaMm: true,
  numeroSanfonas: true,
  numeroPaginas: true,
  // Planos do cálculo para hidratar a tela
  planos: {
    orderBy: { sequencia: 'asc' },
    select: PLANO_SELECT_HIDRATACAO,
  },
} as const

/** Leitura de plano (GET .../planos e .../planos/:planoId): select do GET /:id + `especificacao` (D1). */
export const PLANO_SELECT_LEITURA = {
  ...PLANO_SELECT_HIDRATACAO,
  especificacao: true,
} as const

/** Campos de engenharia que o recálculo do item consome e que a tela precisa hidratar. */
export const CAMPOS_ENGENHARIA_ITEM = [
  'tipoEmbalagemId',
  'medidas',
  'papelId',
  'papelDescricao',
  'suporteId',
  'suporteProducaoId',
  'gramatura',
  'numCores',
  'cores',
  'maquinaId',
  'matrizQuantidade',
  'matrizPrecoUnitario',
  'tintaModo',
  'tintaConsumoKg',
  'acabamentosRicos',
  'modeloFacaId',
  'itensDiversos',
  'itensFornecidos',
  'camposLivres',
  'preImpressao',
  'quantidade',
  'comprimentoMm',
  'larguraMm',
  'alturaMm',
  'abaColaMm',
  'abaFechamentoMm',
  'fibra',
  'montagemLinhas',
  'montagemColunas',
  'formatoSupLarguraMm',
  'formatoSupAlturaMm',
  'formatoCorteLarguraMm',
  'formatoCorteAlturaMm',
  'ajusteCorteMicroMm',
  'aproveitamentoManual',
] as const

/** Campos anexados por SQL raw (fora do client Prisma), não presentes no select. */
export const CAMPOS_ANEXADOS_POR_SQL: readonly string[] = ['aproveitamentoManual']

/**
 * Mapa "campo de engenharia → presente na hidratação" (select Prisma ou anexo SQL).
 * O teste de hidratação falha se algum valor for false.
 */
export const MAPA_ENGENHARIA_NO_SELECT: Readonly<Record<string, boolean>> = Object.fromEntries(
  CAMPOS_ENGENHARIA_ITEM.map((campo) => [
    campo,
    (ITEM_SELECT_HIDRATACAO as Record<string, unknown>)[campo] === true ||
      CAMPOS_ANEXADOS_POR_SQL.includes(campo),
  ]),
)

/**
 * Anexa `aproveitamentoManual` (peças/folha) a cada item via SQL raw — a coluna
 * existe no banco mas não no client Prisma. Reproduz exatamente o anexo do GET /:id:
 * em falha, segue sem o campo (não quebra a leitura).
 */
export async function anexarAproveitamentoManual(itens: Array<{ id: string }>): Promise<void> {
  try {
    if (itens.length > 0) {
      const ids = itens.map((i) => i.id)
      const rows = await prisma.$queryRawUnsafe<Array<{ id: string; aproveitamento_manual: unknown }>>(
        `SELECT id, aproveitamento_manual FROM item_orcamento_grafico WHERE id = ANY($1::text[])`,
        ids,
      )
      const mapa = new Map(rows.map((r) => [r.id, r.aproveitamento_manual]))
      for (const it of itens as Array<{ id: string; aproveitamentoManual?: unknown }>) {
        const v = mapa.get(it.id)
        it.aproveitamentoManual = v != null ? Number(v) : null
      }
    }
  } catch { /* se falhar, segue sem o campo (não quebra o GET) */ }
}
