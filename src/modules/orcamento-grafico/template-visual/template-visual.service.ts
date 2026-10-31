/**
 * Servico_Template — CRUD + default + resolução dos Templates Visuais
 * (editor WYSIWYG). Spec comercial-editor-visual-templates.
 *
 * Reusa a tabela `template_proposta` (estendida com `tipo` e `layout_json`).
 * Um template é VISUAL quando `layoutJson != null`; quando null, é LEGADO de
 * blocos (fluxo antigo, intocado). Isolamento multi-tenant por `empresaId`
 * EXPLÍCITO em TODA query (não confiar só no prismaScoped — steering ATENCAO §2.1).
 */
import { prisma } from '../../../lib/prisma'
import {
  type LayoutDocumento,
  type TipoTemplate,
  TIPOS_TEMPLATE,
} from './layout-json.types'
import { validarLayoutJson } from './layout-json.service'

export class TemplateVisualError extends Error {
  constructor(public statusCode: number, message: string, public code?: string) {
    super(message)
    this.name = 'TemplateVisualError'
  }
}

export interface TemplateVisualResumo {
  id: string
  nome: string
  tipo: TipoTemplate
  isDefault: boolean
  atualizadoEm: Date
}

export interface TemplateVisual extends TemplateVisualResumo {
  empresaId: string
  layoutJson: LayoutDocumento
  criadoEm: Date
}

function validarTipo(tipo: unknown): TipoTemplate {
  if (tipo !== 'ORCAMENTO' && tipo !== 'PROPOSTA') {
    throw new TemplateVisualError(400, 'Tipo inválido. Use ORCAMENTO ou PROPOSTA.', 'TIPO_INVALIDO')
  }
  return tipo
}

/** Apenas templates VISUAIS (layout_json não nulo). */
const FILTRO_VISUAL = { layoutJson: { not: null } }

/** Lista os templates visuais da empresa de um tipo (Req 5.2). */
export async function listarTemplatesVisuais(
  empresaId: string,
  tipo: TipoTemplate,
): Promise<TemplateVisualResumo[]> {
  validarTipo(tipo)
  const rows = await prisma.templateProposta.findMany({
    where: { empresaId, tipo, ...FILTRO_VISUAL } as never,
    orderBy: [{ isDefault: 'desc' }, { atualizadoEm: 'desc' }],
    select: { id: true, nome: true, tipo: true, isDefault: true, atualizadoEm: true } as never,
  })
  return rows as unknown as TemplateVisualResumo[]
}

/** Obtém um template visual da empresa. 404 se de outra empresa (Req 9.3). */
export async function obterTemplateVisual(empresaId: string, id: string): Promise<TemplateVisual> {
  const row = await prisma.templateProposta.findFirst({
    where: { id, empresaId } as never,
  })
  if (!row || (row as { layoutJson?: unknown }).layoutJson == null) {
    throw new TemplateVisualError(404, 'Template não encontrado.', 'NAO_ENCONTRADO')
  }
  return row as unknown as TemplateVisual
}

/** Cria um template visual (valida tipo + layout). (Req 5.3/5.4/7.1) */
export async function criarTemplateVisual(
  empresaId: string,
  dados: { nome: string; tipo: unknown; layoutJson: unknown },
): Promise<TemplateVisual> {
  const tipo = validarTipo(dados.tipo)
  const layout = validarLayoutJson(dados.layoutJson)
  const nome = (dados.nome ?? '').trim()
  if (!nome) throw new TemplateVisualError(400, 'Informe o nome do template.', 'NOME_OBRIGATORIO')

  const criado = await prisma.templateProposta.create({
    data: {
      empresaId,
      nome,
      tipo,
      isDefault: false,
      config: {}, // legado vazio — este é um template visual
      layoutJson: layout as never,
    } as never,
  })
  return criado as unknown as TemplateVisual
}

/** Atualiza nome e/ou layout de um template visual (Req 7.6). */
export async function atualizarTemplateVisual(
  empresaId: string,
  id: string,
  dados: { nome?: string; layoutJson?: unknown },
): Promise<TemplateVisual> {
  await obterTemplateVisual(empresaId, id) // garante escopo/empresa
  const data: Record<string, unknown> = {}
  if (dados.nome !== undefined) {
    const nome = dados.nome.trim()
    if (!nome) throw new TemplateVisualError(400, 'Nome não pode ser vazio.', 'NOME_OBRIGATORIO')
    data.nome = nome
  }
  if (dados.layoutJson !== undefined) {
    data.layoutJson = validarLayoutJson(dados.layoutJson)
  }
  const atualizado = await prisma.templateProposta.update({
    where: { id },
    data: data as never,
  })
  return atualizado as unknown as TemplateVisual
}

/** Duplica um template visual (mesmo tipo, cópia do layout, NÃO default). (Req 7.2) */
export async function duplicarTemplateVisual(empresaId: string, id: string): Promise<TemplateVisual> {
  const orig = await obterTemplateVisual(empresaId, id)
  const copia = await prisma.templateProposta.create({
    data: {
      empresaId,
      nome: `${orig.nome} (cópia)`,
      tipo: orig.tipo,
      isDefault: false,
      config: {},
      layoutJson: orig.layoutJson as never,
    } as never,
  })
  return copia as unknown as TemplateVisual
}

/**
 * Define um template como default. Zera os demais defaults da MESMA empresa e
 * MESMO tipo antes de marcar o alvo, em transação — garante no máximo um default
 * por (empresa, tipo). (Req 7.3)
 */
export async function definirDefault(empresaId: string, id: string): Promise<void> {
  const alvo = await obterTemplateVisual(empresaId, id)
  await prisma.$transaction([
    prisma.templateProposta.updateMany({
      where: { empresaId, tipo: alvo.tipo, isDefault: true } as never,
      data: { isDefault: false } as never,
    }),
    prisma.templateProposta.update({
      where: { id },
      data: { isDefault: true } as never,
    }),
  ])
}

/** Exclui um template visual não-default. Bloqueia default (Req 7.4/7.5). */
export async function excluirTemplateVisual(empresaId: string, id: string): Promise<void> {
  const t = await obterTemplateVisual(empresaId, id)
  if (t.isDefault) {
    throw new TemplateVisualError(
      400,
      'Este é o template padrão. Defina outro template como padrão antes de excluí-lo.',
      'TEMPLATE_DEFAULT',
    )
  }
  await prisma.templateProposta.delete({ where: { id } })
}

/**
 * Resolve o template visual a usar na geração. Ordem (Req 8):
 *  1) templateId informado → esse (404 se de outra empresa).
 *  2) sem id → default visual da empresa para o tipo.
 *  3) sem default visual → null (a rota cai no Fluxo_Legado).
 */
export async function resolverTemplateVisual(
  empresaId: string,
  tipo: TipoTemplate,
  templateId?: string,
): Promise<TemplateVisual | null> {
  validarTipo(tipo)
  if (templateId) {
    return obterTemplateVisual(empresaId, templateId)
  }
  const row = await prisma.templateProposta.findFirst({
    where: { empresaId, tipo, isDefault: true, ...FILTRO_VISUAL } as never,
  })
  return (row as unknown as TemplateVisual) ?? null
}

export { TIPOS_TEMPLATE }
