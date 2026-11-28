/**
 * Geração dos Planos do Cálculo (folhas) a partir dos Tipos de Plano do item — função PURA.
 * Spec orcamento-editor-calculo (R2, design §3).
 *
 * - Modelo CARTUCHO_COMPOSTO: cada Tipo de Plano gera a CAPA e, quando o suporte foi informado (e não é
 *   fornecido pelo cliente), o MICRO e a CAPA_INTERNA. Demais modelos: 1 folha (CAPA) por Tipo de Plano.
 * - Atividades marcadas no Tipo de Plano: no Cartucho Composto a acoplagem vai para o micro (senão capa
 *   interna, senão capa), o corte inicial vai para cada folha e o resto fica na capa. Nos demais
 *   modelos, tudo na capa.
 * - Regerar preserva: folhas AVULSO (incluídas no Editor), campos digitados à mão (`camposManuais`) e os
 *   detalhes digitados das atividades. Folha que deixou de existir no Tipo de Plano (ex.: micro removido)
 *   é descartada.
 */

export type ModeloLinha = 'SIMPLES' | 'EDITORIAL' | 'CARTUCHO_COMPOSTO' | 'BLOCADO' | 'OUTRO'
export type PapelFolha = 'CAPA' | 'MICRO' | 'CAPA_INTERNA' | 'AVULSO'
/** Classe da atividade para a repartição (vem do cadastro: centro/tipo de processo). */
export type ClasseAtividade = 'ACOPLAGEM' | 'CORTE_INICIAL' | 'OUTRA'

export function modeloDaLinha(v: unknown): ModeloLinha {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  return s === 'EDITORIAL' || s === 'CARTUCHO_COMPOSTO' || s === 'BLOCADO' || s === 'OUTRO' ? s : 'SIMPLES'
}

export interface SuporteEntrada {
  suporteId: string | null
  gramatura?: number | null
  fornecido?: boolean
}

export interface ImpressaoEntrada {
  cores: string | null
  processoImpressao: string | null
  coberturaTinta: number | string | null
  maquinaId?: string | null
  numCores?: number
  tintas?: unknown
}

export interface TipoPlanoEntrada {
  /** null = plano único implícito do item. */
  planoId: string | null
  nome: string
  tiragem: number | null
  ocorrencias: number
  formatoLarguraMm: number | null
  formatoAlturaMm: number | null
  /** Formato da folha (C) do Tipo de Plano (hoje o formato de corte do plano). */
  formatoFolhaLarguraMm?: number | null
  formatoFolhaAlturaMm?: number | null
  capa: SuporteEntrada
  impressao: ImpressaoEntrada | null
  micro?: SuporteEntrada | null
  capaInterna?: (SuporteEntrada & { impressao: ImpressaoEntrada | null }) | null
  /** Atividades marcadas no Tipo de Plano (ids de AcabamentoGrafico). */
  atividades: Array<{ acabamentoId: string; classe: ClasseAtividade }>
}

export interface FolhaGerada {
  planoId: string | null
  papel: PapelFolha
  sequencia: number
  nome: string
  tiragem: number | null
  ocorrencias: number
  formatoLarguraMm: number | null
  formatoAlturaMm: number | null
  formatoFolhaLarguraMm: number | null
  formatoFolhaAlturaMm: number | null
  suporteId: string | null
  gramatura: number | null
  impressao: ImpressaoEntrada[] | null
  camposManuais: string[]
  alteradaNoEditor: boolean
  /** Valores da folha anterior para os campos manuais (o serviço repõe na gravação). */
  manter?: Record<string, unknown>
  /** id da folha existente reaproveitada (para preservar o id e as atividades). */
  idExistente?: string
}

export interface AtividadeGerada {
  acabamentoId: string
  /** índice em `folhas` (null = atividade do produto). */
  folha: number | null
  sequencia: number
}

export interface FolhaExistente {
  id: string
  planoId: string | null
  papel: PapelFolha
  sequencia: number
  camposManuais: string[]
  valores: Record<string, unknown>
}

const temSuporte = (s: SuporteEntrada | null | undefined): s is SuporteEntrada =>
  !!s && typeof s.suporteId === 'string' && s.suporteId !== '' && s.fornecido !== true

function folhaBase(t: TipoPlanoEntrada, papel: PapelFolha, s: SuporteEntrada, impressao: ImpressaoEntrada | null) {
  return {
    planoId: t.planoId,
    papel,
    nome: t.nome,
    tiragem: t.tiragem,
    ocorrencias: t.ocorrencias > 0 ? t.ocorrencias : 1,
    formatoLarguraMm: t.formatoLarguraMm,
    formatoAlturaMm: t.formatoAlturaMm,
    formatoFolhaLarguraMm: t.formatoFolhaLarguraMm ?? null,
    formatoFolhaAlturaMm: t.formatoFolhaAlturaMm ?? null,
    suporteId: s.suporteId,
    gramatura: s.gramatura ?? null,
    impressao: impressao ? [impressao] : null,
  }
}

export interface ResultadoGeracao {
  folhas: FolhaGerada[]
  atividades: AtividadeGerada[]
}

/** Gera as folhas e a repartição das atividades. Pura e determinística. */
export function gerarFolhas(
  modelo: ModeloLinha,
  tipos: readonly TipoPlanoEntrada[],
  existentes: readonly FolhaExistente[] = [],
): ResultadoGeracao {
  const folhas: FolhaGerada[] = []
  const atividades: AtividadeGerada[] = []

  for (const t of tipos) {
    const iCapa = folhas.length
    folhas.push({ ...folhaBase(t, 'CAPA', t.capa, t.impressao), sequencia: 0, camposManuais: [], alteradaNoEditor: false })
    let iMicro: number | null = null
    let iInterna: number | null = null
    // Microondulado informado gera a folha MICRO em qualquer modelo (no plano único vem do combo
    // "Microondulado" do item); capa interna só existe no Cartucho Composto.
    if (temSuporte(t.micro)) {
      iMicro = folhas.length
      folhas.push({ ...folhaBase(t, 'MICRO', t.micro, null), sequencia: 0, camposManuais: [], alteradaNoEditor: false })
    }
    if (modelo === 'CARTUCHO_COMPOSTO') {
      if (temSuporte(t.capaInterna)) {
        iInterna = folhas.length
        folhas.push({
          ...folhaBase(t, 'CAPA_INTERNA', t.capaInterna, t.capaInterna.impressao),
          sequencia: 0,
          camposManuais: [],
          alteradaNoEditor: false,
        })
      }
    }
    const destinosCorte = [iCapa, iMicro, iInterna].filter((i): i is number => i !== null)
    const reparte = modelo === 'CARTUCHO_COMPOSTO' || iMicro !== null
    for (const a of t.atividades) {
      if (!reparte) {
        atividades.push({ acabamentoId: a.acabamentoId, folha: iCapa, sequencia: 0 })
      } else if (a.classe === 'ACOPLAGEM') {
        atividades.push({ acabamentoId: a.acabamentoId, folha: iMicro ?? iInterna ?? iCapa, sequencia: 0 })
      } else if (a.classe === 'CORTE_INICIAL') {
        for (const i of destinosCorte) atividades.push({ acabamentoId: a.acabamentoId, folha: i, sequencia: 0 })
      } else {
        atividades.push({ acabamentoId: a.acabamentoId, folha: iCapa, sequencia: 0 })
      }
    }
  }

  // Reaproveita folhas existentes por (planoId, papel): mantém id e campos digitados.
  const porChave = new Map(existentes.filter((e) => e.papel !== 'AVULSO').map((e) => [`${e.planoId ?? ''}|${e.papel}`, e]))
  for (const f of folhas) {
    const antiga = porChave.get(`${f.planoId ?? ''}|${f.papel}`)
    if (!antiga) continue
    f.idExistente = antiga.id
    f.camposManuais = [...antiga.camposManuais]
    if (antiga.camposManuais.length > 0) {
      f.manter = {}
      for (const campo of antiga.camposManuais) {
        const novo = (f as unknown as Record<string, unknown>)[campo]
        const velho = antiga.valores[campo]
        f.manter[campo] = velho
        if (campo in f) (f as unknown as Record<string, unknown>)[campo] = velho
        if (novo !== undefined && JSON.stringify(novo) !== JSON.stringify(velho)) f.alteradaNoEditor = true
      }
    }
  }

  // Avulsas (incluídas no Editor) ficam sempre, no fim, na ordem em que estavam.
  const avulsas = existentes.filter((e) => e.papel === 'AVULSO').sort((a, b) => a.sequencia - b.sequencia)
  for (const a of avulsas) {
    folhas.push({
      planoId: a.planoId,
      papel: 'AVULSO',
      sequencia: 0,
      nome: String(a.valores.nome ?? 'Plano'),
      tiragem: (a.valores.tiragem as number | null) ?? null,
      ocorrencias: Number(a.valores.ocorrencias ?? 1) || 1,
      formatoLarguraMm: (a.valores.formatoLarguraMm as number | null) ?? null,
      formatoAlturaMm: (a.valores.formatoAlturaMm as number | null) ?? null,
      formatoFolhaLarguraMm: (a.valores.formatoFolhaLarguraMm as number | null) ?? null,
      formatoFolhaAlturaMm: (a.valores.formatoFolhaAlturaMm as number | null) ?? null,
      suporteId: (a.valores.suporteId as string | null) ?? null,
      gramatura: (a.valores.gramatura as number | null) ?? null,
      impressao: (a.valores.impressao as ImpressaoEntrada[] | null) ?? null,
      camposManuais: [...a.camposManuais],
      alteradaNoEditor: true,
      idExistente: a.id,
    })
  }

  folhas.forEach((f, i) => { f.sequencia = i + 1 })
  atividades.forEach((a, i) => { a.sequencia = i + 1 })
  return { folhas, atividades }
}

/** Campos da folha que a geração preenche (os demais só mudam pelo Editor). */
export const CAMPOS_GERADOS = [
  'nome', 'tiragem', 'ocorrencias', 'formatoLarguraMm', 'formatoAlturaMm',
  'formatoFolhaLarguraMm', 'formatoFolhaAlturaMm', 'suporteId', 'gramatura', 'impressao',
] as const

/** Nome exibido no Editor: o micro ganha " (M)", como no sistema de referência. */
export function nomeExibido(f: { nome: string; papel: PapelFolha }): string {
  return f.papel === 'MICRO' ? `${f.nome} (M)` : f.nome
}

/**
 * Classe da atividade a partir do cadastro (tipo de processo do centro e nome), usada na repartição.
 * Corte inicial = centros de Cortadeira/Guilhotina; acoplagem = atividade de acoplagem/laminação de micro.
 */
export function classeDaAtividade(a: { nome: string; tipoProcessoCodigo?: string | null }): ClasseAtividade {
  const tp = (a.tipoProcessoCodigo ?? '').toUpperCase()
  const nome = a.nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (nome.includes('acoplag')) return 'ACOPLAGEM'
  if (tp === 'CORTADEIRA' || nome.includes('cortadeira') || nome.includes('guilhotina')) return 'CORTE_INICIAL'
  return 'OUTRA'
}
