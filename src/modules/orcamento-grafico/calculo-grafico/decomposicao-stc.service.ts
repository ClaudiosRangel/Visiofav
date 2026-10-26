// Decomposição REAL de custo por componente (tabela CalculoSTC do Calcgraf).
//
// O Calcgraf grava, na tabela `CalculoSTC`, o custo FINAL de cada componente de
// um cálculo (papel/tinta/impressão/acabamentos/matriz). A SOMA dos componentes
// bate EXATO com o custo de produção do Calcgraf (ex.: 12992 = R$ 5.192,05) —
// não é fórmula/caixa-preta. O exportador (`scripts/exportar-engenharia-calcgraf.mjs`)
// lê essa tabela e grava o JSON em `calculo_grafico.custos_calcgraf`.
//
// Este módulo PURO projeta essa decomposição sobre o `ResultadoOrcamento` do
// motor, para o item PUXADO (orçamento de repetição) exibir e bater COMPONENTE A
// COMPONENTE com o Calcgraf — não só o total ancorado. Mantém a engenharia
// editável do item (medidas/cores/etapas); sobrescreve apenas os VALORES de
// custo exibidos (decomposição MD/CT + detalhe por papel/tinta/máquina/acab.).
//
// Classificação do componente pelo `Itc.Origem`:
//   SUPORTE          → papel (MD)
//   TINTA            → tinta por cor (MD)
//   MAT.ACABAMENTO   → material de acabamento/BOPP (MD)
//   MATRIZ IMPRESSÃO → matriz/chapa (MD)
//   CENTRO DE CUSTO  → máquina/etapa (CT)
//
// Aditivo e não-regressivo: sem `custosCalcgraf` (cálculo novo), não toca nada.

import type { ResultadoOrcamento } from '../orcamento-grafico-calculo.service'

/** Componente individual da decomposição real do Calcgraf (linha de CalculoSTC). */
export interface ComponenteStc {
  origem: string
  grupo: 'MD' | 'CT'
  descricao: string | null
  valorTotal: number
  quantFixa: number | null
  quantVariavel: number | null
  valorCm: number | null
}

/** JSON gravado em `calculo_grafico.custos_calcgraf`. */
export interface CustosCalcgraf {
  materialDireto: number
  custoTransformacao: number
  custoProducao: number
  componentes: ComponenteStc[]
}

const r2 = (x: number) => Math.round(x * 100) / 100

/** Remove o prefixo numérico "0001" das descrições do CalculoSTC. */
export function limparDescStc(desc: string | null | undefined): string {
  if (!desc) return 'Componente'
  return desc.replace(/^0*\d{3,4}/, '').trim() || desc.trim()
}

/**
 * Valida/normaliza o JSON cru vindo do banco. Retorna `null` quando não há
 * decomposição utilizável (cálculo novo, JSON malformado ou sem componentes).
 */
export function normalizarCustosStc(custosRaw: unknown): CustosCalcgraf | null {
  const c = custosRaw as Partial<CustosCalcgraf> | null
  if (!c || !Array.isArray(c.componentes) || c.componentes.length === 0) return null
  const componentes = c.componentes
    .filter((k): k is ComponenteStc => !!k && Number.isFinite(Number(k.valorTotal)))
    .map((k) => ({
      origem: String(k.origem ?? 'INDEFINIDO'),
      grupo: k.grupo === 'CT' ? ('CT' as const) : ('MD' as const),
      descricao: k.descricao ?? null,
      valorTotal: Number(k.valorTotal),
      quantFixa: k.quantFixa != null ? Number(k.quantFixa) : null,
      quantVariavel: k.quantVariavel != null ? Number(k.quantVariavel) : null,
      valorCm: k.valorCm != null ? Number(k.valorCm) : null,
    }))
  if (!componentes.length) return null
  const materialDireto = r2(componentes.filter((k) => k.grupo === 'MD').reduce((s, k) => s + k.valorTotal, 0))
  const custoTransformacao = r2(componentes.filter((k) => k.grupo === 'CT').reduce((s, k) => s + k.valorTotal, 0))
  const custoProducao = r2(
    Number.isFinite(Number(c.custoProducao)) && Number(c.custoProducao) > 0
      ? Number(c.custoProducao)
      : materialDireto + custoTransformacao,
  )
  return { materialDireto, custoTransformacao, custoProducao, componentes }
}

/**
 * Projeta a decomposição real do Calcgraf sobre o `resultado` (mutação in-place).
 * Não lança erro; se `custosRaw` não for utilizável, o `resultado` fica intacto.
 */
export function aplicarDecomposicaoStc(resultado: ResultadoOrcamento, custosRaw: unknown): ResultadoOrcamento {
  const custos = normalizarCustosStc(custosRaw)
  if (!custos) return resultado

  const { materialDireto: md, custoTransformacao: ct, custoProducao: cp } = custos

  // Totais de decomposição (paridade Calcgraf) — fonte da seção "Decomposição do
  // Custo (MD/CT/SE/C.Prod)" exibida no StepRevisao e na página de detalhe.
  resultado.materialDireto = md
  resultado.custoTransformacao = ct
  resultado.servicoExterno = 0
  resultado.custoProducao = cp
  ;(resultado as { custoTotal?: number }).custoTotal = cp

  const porOrigem = (o: string) => custos.componentes.filter((k) => k.origem === o)

  // Papel (SUPORTE) — custo real (preserva o peso já calculado pelo motor).
  const suportes = porOrigem('SUPORTE')
  if (suportes.length) {
    resultado.papel = {
      pesoKg: resultado.papel?.pesoKg ?? 0,
      custo: r2(suportes.reduce((s, k) => s + k.valorTotal, 0)),
    }
  }

  // Tinta (TINTA) — detalhe por cor com o custo real de cada Pantone.
  const tintas = porOrigem('TINTA')
  if (tintas.length) {
    resultado.tinta = {
      custoTotal: r2(tintas.reduce((s, k) => s + k.valorTotal, 0)),
      detalhePorCor: tintas.map((k) => ({
        cor: limparDescStc(k.descricao),
        consumoKg: r2((k.quantFixa ?? 0) + (k.quantVariavel ?? 0)),
        custo: r2(k.valorTotal),
      })),
    }
  }

  // Máquinas / CT (CENTRO DE CUSTO) — detalhe por etapa com custo real.
  const centros = porOrigem('CENTRO DE CUSTO')
  if (centros.length) {
    resultado.maquinas = {
      custoTotal: r2(centros.reduce((s, k) => s + k.valorTotal, 0)),
      detalhePorEtapa: centros.map((k) => ({
        etapa: limparDescStc(k.descricao),
        setupMin: 0,
        operacaoMin: 0,
        custo: r2(k.valorTotal),
      })),
    }
  }

  // Material de acabamento / matriz (entram no MD) — expostos como acabamentos.
  const matMd = custos.componentes.filter((k) => k.origem === 'MAT.ACABAMENTO' || k.origem === 'MATRIZ IMPRESSÃO')
  if (matMd.length) {
    resultado.acabamentos = {
      custoTotal: r2(matMd.reduce((s, k) => s + k.valorTotal, 0)),
      detalhePorAcabamento: matMd.map((k) => ({ tipo: limparDescStc(k.descricao), custo: r2(k.valorTotal) })),
    }
  }

  // Decomposição crua anexada (descrições limpas) para front/relatório detalhar.
  ;(resultado as { custosCalcgraf?: CustosCalcgraf }).custosCalcgraf = {
    materialDireto: md,
    custoTransformacao: ct,
    custoProducao: cp,
    componentes: custos.componentes.map((k) => ({
      ...k,
      valorTotal: r2(k.valorTotal),
      descricao: limparDescStc(k.descricao),
    })),
  }

  return resultado
}

// ─────────────────────────────────────────────────────────────────────────────
// Memória STC para DEMONSTRAÇÃO (read-only) — spec configurador-grafico-calcgraf
// (Req 5). Deriva MD/CT/SE a partir da Origem de cada componente (SE =
// SERVIÇO EXTERNO; CT = CENTRO DE CUSTO; demais = MD) e soma o custo de produção.
// ─────────────────────────────────────────────────────────────────────────────

export type GrupoMemoria = 'MD' | 'CT' | 'SE'

export interface ComponenteMemoria {
  origem: string
  grupo: GrupoMemoria
  descricao: string
  valorTotal: number
}

export interface MemoriaStc {
  temMemoria: boolean
  materialDireto: number
  custoTransformacao: number
  servicoExterno: number
  custoProducao: number
  componentes: ComponenteMemoria[]
}

/** Grupo (MD/CT/SE) a partir da Origem do componente (normaliza acento). */
function grupoMemoriaDaOrigem(origem: string): GrupoMemoria {
  const u = (origem ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim()
  if (u === 'CENTRO DE CUSTO') return 'CT'
  if (u === 'SERVICO EXTERNO') return 'SE'
  return 'MD'
}

/**
 * Monta a memória de custo (SAÍDA, read-only) a partir do JSON `custosCalcgraf`.
 * Quando não há decomposição, retorna `temMemoria:false` com zeros. PURO.
 */
export function montarMemoriaStc(custosRaw: unknown): MemoriaStc {
  const custos = normalizarCustosStc(custosRaw)
  if (!custos) {
    return { temMemoria: false, materialDireto: 0, custoTransformacao: 0, servicoExterno: 0, custoProducao: 0, componentes: [] }
  }
  const componentes: ComponenteMemoria[] = custos.componentes.map((k) => ({
    origem: k.origem,
    grupo: grupoMemoriaDaOrigem(k.origem),
    descricao: limparDescStc(k.descricao),
    valorTotal: r2(k.valorTotal),
  }))
  const soma = (g: GrupoMemoria) => r2(componentes.filter((c) => c.grupo === g).reduce((s, c) => s + c.valorTotal, 0))
  const materialDireto = soma('MD')
  const custoTransformacao = soma('CT')
  const servicoExterno = soma('SE')
  const custoProducao = r2(materialDireto + custoTransformacao + servicoExterno)
  return { temMemoria: true, materialDireto, custoTransformacao, servicoExterno, custoProducao, componentes }
}
