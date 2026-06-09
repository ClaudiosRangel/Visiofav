import { prisma } from '../../lib/prisma'
import { testarConexaoImpressora } from './etiquetas-zpl.printer'
import { TEMPLATES_PADRAO } from './etiquetas-zpl.templates-padrao'
import {
  ValidacaoZplResult,
  PreviewResult,
  TesteConexaoResult,
  EnviarImpressaoResult,
  ImprimirLoteResult,
} from './etiquetas-zpl.types'

interface CriarTemplateInput {
  nome: string
  tipo: 'PRODUTO' | 'ENDERECO' | 'PALETE' | 'EXPEDICAO'
  codigoZpl: string
  larguraMm: number
  alturaMm: number
}

interface AtualizarTemplateInput {
  nome?: string
  tipo?: 'PRODUTO' | 'ENDERECO' | 'PALETE' | 'EXPEDICAO'
  codigoZpl?: string
  larguraMm?: number
  alturaMm?: number
  ativo?: boolean
}

interface CriarImpressoraInput {
  nome: string
  modelo: 'ZEBRA' | 'ELGIN' | 'GENERICA'
  ip: string
  porta: number
  localizacao?: string
  zonaId?: string
}

interface AtualizarImpressoraInput {
  nome?: string
  modelo?: 'ZEBRA' | 'ELGIN' | 'GENERICA'
  ip?: string
  porta?: number
  localizacao?: string
  zonaId?: string | null
  ativo?: boolean
}

interface EnviarParaFilaInput {
  templateId: string
  impressoraId: string
  dadosVariaveis: Record<string, string>
  quantidade: number
  prioridade: 'URGENTE' | 'NORMAL' | 'BAIXA'
  operacao?: 'RECEBIMENTO' | 'SEPARACAO' | 'EXPEDICAO'
  referenciaId?: string
}

interface EnviarLoteInput {
  templateId: string
  impressoraId: string
  itens: Array<{ dadosVariaveis: Record<string, string>; quantidade: number }>
  prioridade: 'URGENTE' | 'NORMAL' | 'BAIXA'
  operacao?: 'RECEBIMENTO' | 'SEPARACAO' | 'EXPEDICAO'
  referenciaId?: string
}

export class EtiquetasZplService {
  // ==========================================================================
  // TEMPLATES
  // ==========================================================================

  /**
   * Cria um novo template de etiqueta ZPL.
   */
  async criarTemplate(input: CriarTemplateInput, empresaId: string, userId: string) {
    const validacao = this.validarZpl(input.codigoZpl)
    if (!validacao.valido) {
      throw { statusCode: 422, message: `ZPL inválido: ${validacao.erros.join('; ')}` }
    }

    return prisma.templateEtiqueta.create({
      data: {
        empresaId,
        nome: input.nome,
        tipo: input.tipo,
        codigoZpl: input.codigoZpl,
        larguraMm: input.larguraMm,
        alturaMm: input.alturaMm,
        versao: 1,
        criadoPorId: userId,
      },
    })
  }

  /**
   * Atualiza um template existente.
   * Se codigoZpl for alterado, grava a versão anterior como backup.
   */
  async atualizarTemplate(id: string, input: AtualizarTemplateInput, empresaId: string, userId: string) {
    const template = await prisma.templateEtiqueta.findFirst({
      where: { id, empresaId },
    })
    if (!template) {
      throw { statusCode: 404, message: 'Template não encontrado' }
    }

    // Validar novo ZPL se fornecido
    if (input.codigoZpl) {
      const validacao = this.validarZpl(input.codigoZpl)
      if (!validacao.valido) {
        throw { statusCode: 422, message: `ZPL inválido: ${validacao.erros.join('; ')}` }
      }
    }

    // Se o codigoZpl está sendo alterado, gravar versão anterior
    if (input.codigoZpl && input.codigoZpl !== template.codigoZpl) {
      return prisma.$transaction(async (tx) => {
        // Gravar versão anterior
        await tx.versaoTemplateEtiqueta.create({
          data: {
            templateEtiquetaId: id,
            versao: template.versao,
            codigoZpl: template.codigoZpl,
            criadoPorId: userId,
          },
        })

        // Atualizar template com nova versão
        return tx.templateEtiqueta.update({
          where: { id },
          data: {
            ...input,
            versao: template.versao + 1,
          },
        })
      })
    }

    // Atualização sem mudança de ZPL (não versiona)
    return prisma.templateEtiqueta.update({
      where: { id },
      data: input,
    })
  }

  /**
   * Reverte um template para uma versão anterior.
   */
  async reverterParaVersao(id: string, versao: number, empresaId: string, userId: string) {
    const template = await prisma.templateEtiqueta.findFirst({
      where: { id, empresaId },
    })
    if (!template) {
      throw { statusCode: 404, message: 'Template não encontrado' }
    }

    const versaoAnterior = await prisma.versaoTemplateEtiqueta.findFirst({
      where: { templateEtiquetaId: id, versao },
    })
    if (!versaoAnterior) {
      throw { statusCode: 404, message: `Versão ${versao} não encontrada` }
    }

    return prisma.$transaction(async (tx) => {
      // Gravar versão atual como backup
      await tx.versaoTemplateEtiqueta.create({
        data: {
          templateEtiquetaId: id,
          versao: template.versao,
          codigoZpl: template.codigoZpl,
          criadoPorId: userId,
        },
      })

      // Restaurar ZPL da versão selecionada
      return tx.templateEtiqueta.update({
        where: { id },
        data: {
          codigoZpl: versaoAnterior.codigoZpl,
          versao: template.versao + 1,
        },
      })
    })
  }

  /**
   * Valida a sintaxe básica de um código ZPL.
   * Verifica ^XA no início, ^XZ no final e balanceamento.
   */
  validarZpl(codigoZpl: string): ValidacaoZplResult {
    const erros: string[] = []
    const trimmed = codigoZpl.trim()

    // Verificar ^XA no início
    if (!trimmed.startsWith('^XA')) {
      erros.push('ZPL deve iniciar com ^XA')
    }

    // Verificar ^XZ no final
    if (!trimmed.endsWith('^XZ')) {
      erros.push('ZPL deve terminar com ^XZ')
    }

    // Verificar balanceamento de ^XA e ^XZ
    const countXA = (trimmed.match(/\^XA/g) || []).length
    const countXZ = (trimmed.match(/\^XZ/g) || []).length
    if (countXA !== countXZ) {
      erros.push(`Desbalanceamento: ${countXA} ^XA vs ${countXZ} ^XZ`)
    }

    // Extrair placeholders {{campo}}
    const placeholders = this.extrairPlaceholders(codigoZpl)

    return { valido: erros.length === 0, erros, placeholders }
  }

  /**
   * Renderiza preview do template substituindo placeholders com dados de exemplo.
   */
  async renderizarPreview(
    templateId: string,
    empresaId: string,
    dadosExemplo?: Record<string, string>,
  ): Promise<PreviewResult> {
    const template = await prisma.templateEtiqueta.findFirst({
      where: { id: templateId, empresaId },
    })
    if (!template) {
      throw { statusCode: 404, message: 'Template não encontrado' }
    }

    const placeholders = this.extrairPlaceholders(template.codigoZpl)

    // Usar dados de exemplo fornecidos ou gerar dados padrão
    const dados: Record<string, string> = {}
    for (const placeholder of placeholders) {
      if (dadosExemplo && dadosExemplo[placeholder]) {
        dados[placeholder] = dadosExemplo[placeholder]
      } else {
        // Buscar dados padrão do template padrão correspondente
        const templatePadrao = TEMPLATES_PADRAO.find((t) => t.tipo === template.tipo)
        if (templatePadrao?.camposExemplo[placeholder]) {
          dados[placeholder] = templatePadrao.camposExemplo[placeholder]
        } else {
          dados[placeholder] = `[${placeholder}]`
        }
      }
    }

    const zplRenderizado = this.substituirPlaceholders(template.codigoZpl, dados)

    return {
      zplRenderizado,
      placeholdersUsados: placeholders,
      dadosAplicados: dados,
    }
  }

  // ==========================================================================
  // IMPRESSORAS
  // ==========================================================================

  /**
   * Cadastra uma nova impressora de rede.
   */
  async criarImpressora(input: CriarImpressoraInput, empresaId: string) {
    return prisma.impressoraRede.create({
      data: {
        empresaId,
        nome: input.nome,
        modelo: input.modelo,
        ip: input.ip,
        porta: input.porta,
        localizacao: input.localizacao || null,
        zonaId: input.zonaId || null,
        status: 'OFFLINE',
      },
    })
  }

  /**
   * Testa conexão TCP com uma impressora e atualiza seu status.
   */
  async testarConexao(impressoraId: string, empresaId: string): Promise<TesteConexaoResult> {
    const impressora = await prisma.impressoraRede.findFirst({
      where: { id: impressoraId, empresaId },
    })
    if (!impressora) {
      throw { statusCode: 404, message: 'Impressora não encontrada' }
    }

    const resultado = await testarConexaoImpressora(impressora.ip, impressora.porta)

    // Atualizar status da impressora
    await prisma.impressoraRede.update({
      where: { id: impressoraId },
      data: {
        status: resultado.sucesso ? 'ONLINE' : 'OFFLINE',
        ultimoCheck: new Date(),
      },
    })

    return {
      sucesso: resultado.sucesso,
      tempoMs: resultado.tempoMs,
      erro: resultado.erro,
    }
  }

  // ==========================================================================
  // FILA DE IMPRESSÃO
  // ==========================================================================

  /**
   * Envia um item para a fila de impressão.
   */
  async enviarParaFila(input: EnviarParaFilaInput, empresaId: string, userId: string): Promise<EnviarImpressaoResult> {
    // Validar template existe
    const template = await prisma.templateEtiqueta.findFirst({
      where: { id: input.templateId, empresaId, ativo: true },
    })
    if (!template) {
      throw { statusCode: 404, message: 'Template não encontrado ou inativo' }
    }

    // Validar impressora existe
    const impressora = await prisma.impressoraRede.findFirst({
      where: { id: input.impressoraId, empresaId, ativo: true },
    })
    if (!impressora) {
      throw { statusCode: 404, message: 'Impressora não encontrada ou inativa' }
    }

    const item = await prisma.filaImpressao.create({
      data: {
        empresaId,
        templateId: input.templateId,
        impressoraId: input.impressoraId,
        dadosVariaveis: input.dadosVariaveis,
        quantidade: input.quantidade,
        prioridade: input.prioridade,
        status: 'PENDENTE',
        operacao: input.operacao || null,
        referenciaId: input.referenciaId || null,
        solicitadoPorId: userId,
      },
    })

    // Calcular posição na fila
    const posicaoFila = await prisma.filaImpressao.count({
      where: { empresaId, status: 'PENDENTE' },
    })

    return { id: item.id, status: 'PENDENTE', posicaoFila }
  }

  /**
   * Envia múltiplos itens para a fila de impressão (impressão em lote).
   */
  async enviarLote(input: EnviarLoteInput, empresaId: string, userId: string): Promise<ImprimirLoteResult> {
    // Validar template existe
    const template = await prisma.templateEtiqueta.findFirst({
      where: { id: input.templateId, empresaId, ativo: true },
    })
    if (!template) {
      throw { statusCode: 404, message: 'Template não encontrado ou inativo' }
    }

    // Validar impressora existe
    const impressora = await prisma.impressoraRede.findFirst({
      where: { id: input.impressoraId, empresaId, ativo: true },
    })
    if (!impressora) {
      throw { statusCode: 404, message: 'Impressora não encontrada ou inativa' }
    }

    const ids: string[] = []

    await prisma.$transaction(async (tx) => {
      for (const item of input.itens) {
        const filaItem = await tx.filaImpressao.create({
          data: {
            empresaId,
            templateId: input.templateId,
            impressoraId: input.impressoraId,
            dadosVariaveis: item.dadosVariaveis,
            quantidade: item.quantidade,
            prioridade: input.prioridade,
            status: 'PENDENTE',
            operacao: input.operacao || null,
            referenciaId: input.referenciaId || null,
            solicitadoPorId: userId,
          },
        })
        ids.push(filaItem.id)
      }
    })

    return { totalEnfileirados: ids.length, ids }
  }

  // ==========================================================================
  // TEMPLATES PADRÃO
  // ==========================================================================

  /**
   * Cria templates padrão para uma empresa (se ainda não existirem).
   */
  async criarTemplatesPadrao(empresaId: string, userId: string) {
    const existentes = await prisma.templateEtiqueta.count({
      where: { empresaId },
    })

    if (existentes > 0) return []

    const criados = []
    for (const tp of TEMPLATES_PADRAO) {
      const template = await prisma.templateEtiqueta.create({
        data: {
          empresaId,
          nome: tp.nome,
          tipo: tp.tipo,
          codigoZpl: tp.codigoZpl,
          larguraMm: tp.larguraMm,
          alturaMm: tp.alturaMm,
          versao: 1,
          criadoPorId: userId,
        },
      })
      criados.push(template)
    }

    return criados
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  /**
   * Extrai placeholders no formato {{campo}} de um código ZPL.
   */
  extrairPlaceholders(codigoZpl: string): string[] {
    const matches = codigoZpl.match(/\{\{(\w+)\}\}/g) || []
    const placeholders = matches.map((m) => m.replace(/\{\{|\}\}/g, ''))
    return [...new Set(placeholders)]
  }

  /**
   * Substitui placeholders {{campo}} pelos valores fornecidos.
   */
  substituirPlaceholders(codigoZpl: string, dados: Record<string, string>): string {
    let resultado = codigoZpl
    for (const [campo, valor] of Object.entries(dados)) {
      resultado = resultado.replace(new RegExp(`\\{\\{${campo}\\}\\}`, 'g'), valor)
    }
    return resultado
  }
}

export const etiquetasZplService = new EtiquetasZplService()
