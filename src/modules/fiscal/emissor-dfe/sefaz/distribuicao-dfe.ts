/**
 * Distribuição DFe - Download automático de XMLs emitidos contra o CNPJ
 * Consulta o webservice de Distribuição DFe (AN) por NSU sequencial
 * e armazena os documentos recebidos na base de dados.
 *
 * Requirements: 27.1, 27.2, 27.3, 27.4
 */

import { inflate } from 'node:zlib'
import { promisify } from 'node:util'
import type { PrismaClient } from '@prisma/client'
import type { SefazClient, DocumentoDistribuido } from './tipos'

const inflateAsync = promisify(inflate)

// === Tipos ===

export interface DistribuicaoDFeConfig {
  /** CNPJ da empresa (14 dígitos, sem formatação) */
  cnpj: string
  /** ID da empresa no banco de dados */
  empresaId: string
}

export interface ResultadoDistribuicao {
  /** Quantidade de documentos novos processados */
  documentosProcessados: number
  /** Último NSU obtido na consulta */
  ultimoNsu: string
  /** Indica se há mais documentos disponíveis para consulta */
  hasMaisDocumentos: boolean
  /** Lista de chaves de acesso dos documentos baixados */
  chavesAcesso: string[]
  /** Erros de processamento individual (documento falhou mas os demais continuaram) */
  erros: Array<{ nsu: string; erro: string }>
}

export interface DocumentoProcessado {
  chaveAcesso: string
  tipo: string
  emitenteCnpj: string
  emitenteRazao: string
  valorTotal: number
  dataEmissao: Date
  xmlCompleto: string
  nsu: string
}

// === Helpers internos ===

/**
 * Decomprime conteúdo Base64+GZip retornado pelo webservice DistDFe
 */
async function descomprimirXml(conteudoBase64: string): Promise<string> {
  if (!conteudoBase64 || conteudoBase64.trim().length === 0) {
    return ''
  }

  try {
    const buffer = Buffer.from(conteudoBase64, 'base64')
    const descomprimido = await inflateAsync(buffer)
    return descomprimido.toString('utf-8')
  } catch {
    // Se falha ao descomprimir, pode já estar em texto plano (resumo)
    return Buffer.from(conteudoBase64, 'base64').toString('utf-8')
  }
}

/**
 * Extrai a chave de acesso do XML descomprimido
 */
function extrairChaveAcesso(xml: string): string | null {
  // Busca em <chNFe>, <chCTe> ou infNFe/@Id
  const matchChave = xml.match(/<chNFe>(\d{44})<\/chNFe>/)
    || xml.match(/<chCTe>(\d{44})<\/chCTe>/)
    || xml.match(/Id="NFe(\d{44})"/)
    || xml.match(/Id="CTe(\d{44})"/)

  return matchChave ? matchChave[1] : null
}

/**
 * Extrai o CNPJ do emitente do XML
 */
function extrairCnpjEmitente(xml: string): string {
  const match = xml.match(/<emit>[\s\S]*?<CNPJ>(\d{14})<\/CNPJ>/)
  return match ? match[1] : ''
}

/**
 * Extrai a razão social do emitente
 */
function extrairRazaoEmitente(xml: string): string {
  const match = xml.match(/<emit>[\s\S]*?<xNome>([^<]+)<\/xNome>/)
  return match ? match[1] : ''
}

/**
 * Extrai o valor total do documento
 */
function extrairValorTotal(xml: string): number {
  // NF-e: <vNF>
  const matchNfe = xml.match(/<vNF>([\d.]+)<\/vNF>/)
  if (matchNfe) return parseFloat(matchNfe[1])

  // CT-e: <vTPrest>
  const matchCte = xml.match(/<vTPrest>([\d.]+)<\/vTPrest>/)
  if (matchCte) return parseFloat(matchCte[1])

  return 0
}

/**
 * Extrai a data de emissão do documento
 */
function extrairDataEmissao(xml: string): Date {
  // NF-e: <dhEmi> ou <dEmi>
  const match = xml.match(/<dhEmi>([^<]+)<\/dhEmi>/)
    || xml.match(/<dEmi>([^<]+)<\/dEmi>/)

  if (match) return new Date(match[1])
  return new Date()
}

/**
 * Identifica o tipo de documento (NFE, CTE) a partir do XML ou schema
 */
function identificarTipoDocumento(xml: string, schema: string): string {
  if (schema.includes('procNFe') || schema.includes('resNFe') || xml.includes('<nfeProc')) {
    return 'NFE'
  }
  if (schema.includes('procCTe') || schema.includes('resCTe') || xml.includes('<cteProc')) {
    return 'CTE'
  }
  if (schema.includes('resEvento') || schema.includes('procEventoNFe')) {
    return 'EVENTO'
  }
  return 'NFE' // default
}

/**
 * Verifica se o documento é um XML completo (procNFe/procCTe) ou apenas resumo
 */
function isXmlCompleto(xml: string, schema: string): boolean {
  return schema.includes('procNFe')
    || schema.includes('procCTe')
    || xml.includes('<nfeProc')
    || xml.includes('<cteProc')
    || xml.includes('<protNFe')
}

// === Serviço principal ===

export interface DistribuicaoDFeService {
  /**
   * Consulta DistDFe e baixa documentos novos a partir do último NSU armazenado.
   * Faz múltiplas consultas sequenciais até não haver mais documentos.
   */
  consultarEBaixar(config: DistribuicaoDFeConfig): Promise<ResultadoDistribuicao>

  /**
   * Consulta DistDFe uma única vez a partir de um NSU específico (sem loop).
   */
  consultarPorNsu(config: DistribuicaoDFeConfig, nsu: string): Promise<ResultadoDistribuicao>

  /**
   * Obtém o último NSU armazenado para a empresa
   */
  obterUltimoNsu(empresaId: string): Promise<string>
}

/**
 * Cria uma instância do serviço de Distribuição DFe
 */
export function criarDistribuicaoDFeService(
  sefazClient: SefazClient,
  prisma: PrismaClient,
): DistribuicaoDFeService {

  /**
   * Obtém ou inicializa o último NSU consultado para a empresa.
   * Usa a tabela parametro para armazenar o estado da distribuição.
   */
  async function obterNsuArmazenado(empresaId: string): Promise<string> {
    const parametro = await prisma.parametro.findFirst({
      where: {
        empresaId,
        chave: 'DIST_DFE_ULTIMO_NSU',
      },
    })

    return parametro?.valor || '0'
  }

  /**
   * Atualiza o último NSU consultado para a empresa
   */
  async function salvarUltimoNsu(empresaId: string, nsu: string): Promise<void> {
    await prisma.parametro.upsert({
      where: {
        empresaId_chave: {
          empresaId,
          chave: 'DIST_DFE_ULTIMO_NSU',
        },
      },
      update: { valor: nsu },
      create: {
        empresaId,
        chave: 'DIST_DFE_ULTIMO_NSU',
        valor: nsu,
      },
    })
  }

  /**
   * Processa um único documento retornado pela distribuição.
   * Descomprime, extrai dados e armazena no banco.
   */
  async function processarDocumento(
    doc: DocumentoDistribuido,
    config: DistribuicaoDFeConfig,
  ): Promise<DocumentoProcessado | null> {
    const xml = await descomprimirXml(doc.xmlConteudo)
    if (!xml || xml.trim().length === 0) return null

    const tipo = identificarTipoDocumento(xml, doc.schema)

    // Apenas processar XMLs completos (procNFe/procCTe)
    // Resumos (resNFe/resCTe) indicam existência mas não contêm o XML completo
    if (!isXmlCompleto(xml, doc.schema)) {
      // Para resumos, ainda extraímos dados básicos para registro
      const chave = extrairChaveAcesso(xml) || doc.chaveAcesso || ''
      if (!chave) return null

      return {
        chaveAcesso: chave,
        tipo,
        emitenteCnpj: extrairCnpjEmitente(xml) || doc.cnpjEmitente || '',
        emitenteRazao: extrairRazaoEmitente(xml) || '',
        valorTotal: extrairValorTotal(xml),
        dataEmissao: extrairDataEmissao(xml),
        xmlCompleto: xml,
        nsu: doc.nsu,
      }
    }

    const chaveAcesso = extrairChaveAcesso(xml) || doc.chaveAcesso || ''
    if (!chaveAcesso) return null

    return {
      chaveAcesso,
      tipo,
      emitenteCnpj: extrairCnpjEmitente(xml),
      emitenteRazao: extrairRazaoEmitente(xml),
      valorTotal: extrairValorTotal(xml),
      dataEmissao: extrairDataEmissao(xml),
      xmlCompleto: xml,
      nsu: doc.nsu,
    }
  }

  /**
   * Armazena o documento processado no banco de dados.
   * Ignora duplicatas (mesmo empresaId + chaveAcesso).
   */
  async function armazenarDocumento(
    docProcessado: DocumentoProcessado,
    empresaId: string,
  ): Promise<boolean> {
    try {
      await prisma.xmlImportado.create({
        data: {
          empresaId,
          chaveAcesso: docProcessado.chaveAcesso,
          tipo: docProcessado.tipo,
          emitenteCnpj: docProcessado.emitenteCnpj,
          emitenteRazao: docProcessado.emitenteRazao,
          valorTotal: docProcessado.valorTotal,
          dataEmissao: docProcessado.dataEmissao,
          xmlCompleto: docProcessado.xmlCompleto,
          origem: 'DISTRIBUICAO_DFE',
        },
      })
      return true
    } catch (err: unknown) {
      // Duplicata (constraint unique empresaId + chaveAcesso) — ignorar
      if (isDuplicateError(err)) {
        return false
      }
      throw err
    }
  }

  /**
   * Executa uma consulta ao webservice DistDFe e processa os resultados
   */
  async function executarConsulta(
    config: DistribuicaoDFeConfig,
    nsu: string,
  ): Promise<ResultadoDistribuicao> {
    const documentos = await sefazClient.distribuicaoDFe(config.cnpj, nsu)

    const resultado: ResultadoDistribuicao = {
      documentosProcessados: 0,
      ultimoNsu: nsu,
      hasMaisDocumentos: false,
      chavesAcesso: [],
      erros: [],
    }

    if (!documentos || documentos.length === 0) {
      return resultado
    }

    // Atualizar último NSU com o maior retornado
    let maiorNsu = nsu
    for (const doc of documentos) {
      if (doc.nsu && doc.nsu > maiorNsu) {
        maiorNsu = doc.nsu
      }
    }
    resultado.ultimoNsu = maiorNsu

    // Quando o webservice retorna documentos, pode haver mais — sinalizar
    resultado.hasMaisDocumentos = documentos.length > 0

    // Processar cada documento
    for (const doc of documentos) {
      try {
        const processado = await processarDocumento(doc, config)
        if (!processado) continue

        const armazenado = await armazenarDocumento(processado, config.empresaId)
        if (armazenado) {
          resultado.documentosProcessados++
          resultado.chavesAcesso.push(processado.chaveAcesso)
        }
      } catch (err: unknown) {
        const mensagem = err instanceof Error ? err.message : 'Erro desconhecido'
        resultado.erros.push({ nsu: doc.nsu, erro: mensagem })
      }
    }

    // Salvar último NSU consultado
    await salvarUltimoNsu(config.empresaId, maiorNsu)

    return resultado
  }

  /**
   * Consulta DistDFe com loop automático até não haver mais documentos
   */
  async function consultarEBaixar(config: DistribuicaoDFeConfig): Promise<ResultadoDistribuicao> {
    let nsuAtual = await obterNsuArmazenado(config.empresaId)

    const resultadoFinal: ResultadoDistribuicao = {
      documentosProcessados: 0,
      ultimoNsu: nsuAtual,
      hasMaisDocumentos: false,
      chavesAcesso: [],
      erros: [],
    }

    // Máximo de iterações para evitar loop infinito (50 × ~50 docs = 2500 docs max)
    const MAX_ITERACOES = 50
    let iteracoes = 0

    while (iteracoes < MAX_ITERACOES) {
      iteracoes++

      const parcial = await executarConsulta(config, nsuAtual)

      resultadoFinal.documentosProcessados += parcial.documentosProcessados
      resultadoFinal.chavesAcesso.push(...parcial.chavesAcesso)
      resultadoFinal.erros.push(...parcial.erros)
      resultadoFinal.ultimoNsu = parcial.ultimoNsu

      // Se não há mais documentos ou o NSU não avançou, parar
      if (!parcial.hasMaisDocumentos || parcial.ultimoNsu === nsuAtual) {
        resultadoFinal.hasMaisDocumentos = false
        break
      }

      nsuAtual = parcial.ultimoNsu
    }

    if (iteracoes >= MAX_ITERACOES) {
      resultadoFinal.hasMaisDocumentos = true
    }

    return resultadoFinal
  }

  /**
   * Consulta DistDFe uma única vez a partir de um NSU específico
   */
  async function consultarPorNsu(
    config: DistribuicaoDFeConfig,
    nsu: string,
  ): Promise<ResultadoDistribuicao> {
    return executarConsulta(config, nsu)
  }

  return {
    consultarEBaixar,
    consultarPorNsu,
    obterUltimoNsu: obterNsuArmazenado,
  }
}

// === Utilitários exportados para testes ===

export {
  descomprimirXml,
  extrairChaveAcesso,
  extrairCnpjEmitente,
  extrairRazaoEmitente,
  extrairValorTotal,
  extrairDataEmissao,
  identificarTipoDocumento,
  isXmlCompleto,
}

// === Helper interno ===

function isDuplicateError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const prismaErr = err as { code?: string }
  // Prisma unique constraint violation
  return prismaErr.code === 'P2002'
}
