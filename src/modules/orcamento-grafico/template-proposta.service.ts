/**
 * Service de Templates de Proposta comercial (spec comercial-templates-proposta,
 * bloco B1). Camada de APRESENTAÇÃO do PDF — não toca valores do orçamento.
 *
 * Responsável por:
 * - A config default embutida (reproduz o layout fixo atual → não-regressão).
 * - normalizarConfig(): função PURA, tolerante a JSON parcial do banco.
 * - obterConfigTemplate(): resolve a config a usar (templateId → default da
 *   empresa → embutida). Isolamento por empresaId EXPLÍCITO.
 * - CRUD: listar/criar/atualizar/excluir/definirDefault (default único em
 *   transação; não exclui o default).
 */
import { prisma } from '../../lib/prisma'

export interface TemplatePropostaConfig {
  cabecalho: {
    mostrarLogo: boolean
    mostrarRazaoSocial: boolean
    mostrarCnpj: boolean
    mostrarTelefone: boolean
    mostrarEmail: boolean
  }
  textos: {
    introducao?: string
    condicoes?: string
    rodape?: string
  }
  blocos: {
    engenharia: boolean
    decomposicaoCustos: boolean
    variacoesTiragem: boolean
    validade: boolean
    observacoes: boolean
  }
}

/**
 * Config embutida que reproduz o layout fixo ATUAL (todos os blocos ligados,
 * cabeçalho completo). É o fallback quando a empresa não tem template — garante
 * não-regressão da proposta que já existe hoje.
 */
export const CONFIG_DEFAULT_EMBUTIDA: TemplatePropostaConfig = {
  cabecalho: {
    mostrarLogo: true,
    mostrarRazaoSocial: true,
    mostrarCnpj: true,
    mostrarTelefone: true,
    mostrarEmail: true,
  },
  textos: {},
  blocos: {
    engenharia: true,
    decomposicaoCustos: true,
    variacoesTiragem: true,
    validade: true,
    observacoes: true,
  },
}

function asBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v
  return fallback
}

function asTexto(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim().length > 0) return v
  return undefined
}

/**
 * Função PURA: mescla uma config crua (JSON do banco, possivelmente parcial ou
 * inválida) com os defaults embutidos. NUNCA lança — qualquer entrada vira uma
 * config válida e completa. Idempotente.
 */
export function normalizarConfig(raw: unknown): TemplatePropostaConfig {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const cab = (obj.cabecalho && typeof obj.cabecalho === 'object' ? obj.cabecalho : {}) as Record<string, unknown>
  const txt = (obj.textos && typeof obj.textos === 'object' ? obj.textos : {}) as Record<string, unknown>
  const blk = (obj.blocos && typeof obj.blocos === 'object' ? obj.blocos : {}) as Record<string, unknown>
  const d = CONFIG_DEFAULT_EMBUTIDA
  return {
    cabecalho: {
      mostrarLogo: asBool(cab.mostrarLogo, d.cabecalho.mostrarLogo),
      mostrarRazaoSocial: asBool(cab.mostrarRazaoSocial, d.cabecalho.mostrarRazaoSocial),
      mostrarCnpj: asBool(cab.mostrarCnpj, d.cabecalho.mostrarCnpj),
      mostrarTelefone: asBool(cab.mostrarTelefone, d.cabecalho.mostrarTelefone),
      mostrarEmail: asBool(cab.mostrarEmail, d.cabecalho.mostrarEmail),
    },
    textos: {
      introducao: asTexto(txt.introducao),
      condicoes: asTexto(txt.condicoes),
      rodape: asTexto(txt.rodape),
    },
    blocos: {
      engenharia: asBool(blk.engenharia, d.blocos.engenharia),
      decomposicaoCustos: asBool(blk.decomposicaoCustos, d.blocos.decomposicaoCustos),
      variacoesTiragem: asBool(blk.variacoesTiragem, d.blocos.variacoesTiragem),
      validade: asBool(blk.validade, d.blocos.validade),
      observacoes: asBool(blk.observacoes, d.blocos.observacoes),
    },
  }
}

export class TemplatePropostaError extends Error {
  constructor(public statusCode: number, message: string, public code?: string) {
    super(message)
    this.name = 'TemplatePropostaError'
  }
}

/**
 * Resolve a config de template a usar numa geração de PDF.
 * - templateId informado → busca o template DESSA empresa (404 se de outra).
 * - sem templateId → o default da empresa; se não houver, a config embutida.
 * empresaId EXPLÍCITO (isolamento multi-tenant — não confiar no prismaScoped).
 */
export async function obterConfigTemplate(
  empresaId: string,
  templateId?: string | null,
): Promise<TemplatePropostaConfig> {
  if (templateId) {
    const t = await prisma.templateProposta.findFirst({
      where: { id: templateId, empresaId },
      select: { config: true },
    })
    if (!t) throw new TemplatePropostaError(404, 'Template de proposta não encontrado', 'TEMPLATE_NAO_ENCONTRADO')
    return normalizarConfig(t.config)
  }
  const def = await prisma.templateProposta.findFirst({
    where: { empresaId, isDefault: true },
    select: { config: true },
  })
  if (def) return normalizarConfig(def.config)
  return CONFIG_DEFAULT_EMBUTIDA
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export async function listarTemplates(empresaId: string) {
  return prisma.templateProposta.findMany({
    where: { empresaId },
    orderBy: [{ isDefault: 'desc' }, { nome: 'asc' }],
    select: { id: true, nome: true, isDefault: true, config: true, atualizadoEm: true },
  })
}

export async function criarTemplate(
  empresaId: string,
  dados: { nome: string; isDefault?: boolean; config?: unknown },
) {
  const config = normalizarConfig(dados.config)
  const tornarDefault = dados.isDefault === true
  return prisma.$transaction(async (tx) => {
    // Se não existe nenhum template ainda, o primeiro vira default por padrão.
    const total = await tx.templateProposta.count({ where: { empresaId } })
    const isDefault = tornarDefault || total === 0
    if (isDefault) {
      await tx.templateProposta.updateMany({ where: { empresaId, isDefault: true }, data: { isDefault: false } })
    }
    return tx.templateProposta.create({
      data: { empresaId, nome: dados.nome, isDefault, config: config as object },
      select: { id: true, nome: true, isDefault: true, config: true },
    })
  })
}

export async function atualizarTemplate(
  empresaId: string,
  id: string,
  dados: { nome?: string; config?: unknown },
) {
  const atual = await prisma.templateProposta.findFirst({ where: { id, empresaId }, select: { id: true } })
  if (!atual) throw new TemplatePropostaError(404, 'Template de proposta não encontrado', 'TEMPLATE_NAO_ENCONTRADO')
  const data: Record<string, unknown> = {}
  if (typeof dados.nome === 'string') data.nome = dados.nome
  if (dados.config !== undefined) data.config = normalizarConfig(dados.config) as object
  return prisma.templateProposta.update({
    where: { id },
    data,
    select: { id: true, nome: true, isDefault: true, config: true },
  })
}

export async function definirTemplateDefault(empresaId: string, id: string) {
  const atual = await prisma.templateProposta.findFirst({ where: { id, empresaId }, select: { id: true } })
  if (!atual) throw new TemplatePropostaError(404, 'Template de proposta não encontrado', 'TEMPLATE_NAO_ENCONTRADO')
  await prisma.$transaction([
    prisma.templateProposta.updateMany({ where: { empresaId, isDefault: true }, data: { isDefault: false } }),
    prisma.templateProposta.update({ where: { id }, data: { isDefault: true } }),
  ])
  return { id, isDefault: true }
}

export async function excluirTemplate(empresaId: string, id: string) {
  const alvo = await prisma.templateProposta.findFirst({ where: { id, empresaId }, select: { id: true, isDefault: true } })
  if (!alvo) throw new TemplatePropostaError(404, 'Template de proposta não encontrado', 'TEMPLATE_NAO_ENCONTRADO')
  if (alvo.isDefault) {
    throw new TemplatePropostaError(400, 'Não é possível excluir o template padrão. Defina outro como padrão antes.', 'TEMPLATE_DEFAULT')
  }
  await prisma.templateProposta.delete({ where: { id } })
  return { sucesso: true }
}
