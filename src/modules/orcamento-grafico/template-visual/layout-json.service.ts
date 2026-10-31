/**
 * Validação / normalização / clamp do Layout_JSON (núcleo PURO — sem Prisma).
 * Spec comercial-editor-visual-templates.
 *
 * - validarLayoutJson: valida via Zod; lança erro legível em falha.
 * - normalizarLayout: tolerante a JSON parcial; NUNCA lança (usa defaults).
 * - clampElemento: restringe x/y/largura/altura à área útil da página (Req 1.3).
 */
import { z } from 'zod'
import {
  type Elemento,
  type LayoutDocumento,
  type Pagina,
  TIPOS_ELEMENTO,
  paginaA4Padrao,
} from './layout-json.types'

export class LayoutJsonError extends Error {
  constructor(message: string, public code = 'LAYOUT_INVALIDO') {
    super(message)
    this.name = 'LayoutJsonError'
  }
}

const estiloSchema = z.object({
  fonte: z.enum(['Helvetica', 'Helvetica-Bold']),
  tamanhoPt: z.number().positive(),
  alinhamento: z.enum(['left', 'center', 'right']),
  negrito: z.boolean(),
  cor: z.string().regex(/^#([0-9a-fA-F]{6})$/, 'cor deve ser hex #RRGGBB'),
})

const colunaSchema = z.object({
  titulo: z.string(),
  binding: z.string(),
  larguraPt: z.number().nonnegative(),
  alinhamento: z.enum(['left', 'center', 'right']),
})

const elementoSchema = z.object({
  id: z.string().min(1),
  tipo: z.enum(TIPOS_ELEMENTO as [string, ...string[]]),
  xPt: z.number(),
  yPt: z.number(),
  larguraPt: z.number().nonnegative(),
  alturaPt: z.number().nonnegative(),
  estilo: estiloSchema.optional(),
  textoEstatico: z.string().optional(),
  binding: z.string().optional(),
  tabela: z
    .object({
      fonteDados: z.enum(['itens', 'variacoes']),
      colunas: z.array(colunaSchema),
    })
    .optional(),
  rotuloAssinatura: z.string().optional(),
})

const paginaSchema = z.object({
  larguraPt: z.number().positive(),
  alturaPt: z.number().positive(),
  margemTopoPt: z.number().nonnegative(),
  margemBaixoPt: z.number().nonnegative(),
  margemEsquerdaPt: z.number().nonnegative(),
  margemDireitaPt: z.number().nonnegative(),
})

const layoutSchema = z.object({
  versao: z.literal(1),
  pagina: paginaSchema,
  elementos: z.array(elementoSchema),
})

/** Valida o Layout_JSON. Lança LayoutJsonError com mensagem legível em falha. */
export function validarLayoutJson(raw: unknown): LayoutDocumento {
  const r = layoutSchema.safeParse(raw)
  if (!r.success) {
    const resumo = r.error.issues
      .map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`)
      .join('; ')
    throw new LayoutJsonError(`Layout inválido — ${resumo}`)
  }
  return r.data as LayoutDocumento
}

/**
 * Normaliza um JSON possivelmente parcial em um LayoutDocumento válido, SEM
 * lançar (preenche defaults). Útil para render tolerante e para o preview.
 */
export function normalizarLayout(raw: unknown): LayoutDocumento {
  const obj = (raw ?? {}) as Record<string, unknown>
  const paginaRaw = (obj.pagina ?? {}) as Record<string, unknown>
  const padrao = paginaA4Padrao()
  const num = (v: unknown, def: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : def

  const pagina: Pagina = {
    larguraPt: num(paginaRaw.larguraPt, padrao.larguraPt),
    alturaPt: num(paginaRaw.alturaPt, padrao.alturaPt),
    margemTopoPt: num(paginaRaw.margemTopoPt, padrao.margemTopoPt),
    margemBaixoPt: num(paginaRaw.margemBaixoPt, padrao.margemBaixoPt),
    margemEsquerdaPt: num(paginaRaw.margemEsquerdaPt, padrao.margemEsquerdaPt),
    margemDireitaPt: num(paginaRaw.margemDireitaPt, padrao.margemDireitaPt),
  }

  const elementosRaw = Array.isArray(obj.elementos) ? obj.elementos : []
  const elementos: Elemento[] = elementosRaw
    .map((e, i) => normalizarElemento(e, i))
    .filter((e): e is Elemento => e !== null)

  return { versao: 1, pagina, elementos }
}

function normalizarElemento(raw: unknown, indice: number): Elemento | null {
  const o = (raw ?? {}) as Record<string, unknown>
  const tipo = o.tipo as Elemento['tipo']
  if (!TIPOS_ELEMENTO.includes(tipo)) return null
  const num = (v: unknown, def: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : def
  const el: Elemento = {
    id: typeof o.id === 'string' && o.id ? o.id : `el-${indice}`,
    tipo,
    xPt: num(o.xPt, 0),
    yPt: num(o.yPt, 0),
    larguraPt: num(o.larguraPt, 100),
    alturaPt: num(o.alturaPt, 20),
  }
  if (o.estilo && typeof o.estilo === 'object') el.estilo = o.estilo as Elemento['estilo']
  if (typeof o.textoEstatico === 'string') el.textoEstatico = o.textoEstatico
  if (typeof o.binding === 'string') el.binding = o.binding
  if (o.tabela && typeof o.tabela === 'object') el.tabela = o.tabela as Elemento['tabela']
  if (typeof o.rotuloAssinatura === 'string') el.rotuloAssinatura = o.rotuloAssinatura
  return el
}

/**
 * Restringe um Elemento à área útil da página (dentro das margens). Garante:
 *   x >= margemEsquerda ; y >= margemTopo
 *   x + largura <= larguraPt - margemDireita
 *   y + altura  <= alturaPt - margemBaixo
 * (Req 1.3). Se a caixa for maior que a área útil, encolhe à área útil.
 */
export function clampElemento(el: Elemento, pagina: Pagina): Elemento {
  const areaX0 = pagina.margemEsquerdaPt
  const areaY0 = pagina.margemTopoPt
  const areaX1 = pagina.larguraPt - pagina.margemDireitaPt
  const areaY1 = pagina.alturaPt - pagina.margemBaixoPt
  const areaLargura = Math.max(0, areaX1 - areaX0)
  const areaAltura = Math.max(0, areaY1 - areaY0)

  // Primeiro limita a dimensão ao tamanho da área útil.
  const larguraPt = Math.max(0, Math.min(el.larguraPt, areaLargura))
  const alturaPt = Math.max(0, Math.min(el.alturaPt, areaAltura))

  // Depois posiciona dentro da área (clamp do canto superior-esquerdo).
  const xPt = Math.min(Math.max(el.xPt, areaX0), areaX1 - larguraPt)
  const yPt = Math.min(Math.max(el.yPt, areaY0), areaY1 - alturaPt)

  return { ...el, xPt, yPt, larguraPt, alturaPt }
}
