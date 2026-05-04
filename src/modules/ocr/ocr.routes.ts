import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { createRequire } from 'node:module'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { criarOcrService } from './ocr.factory'
// pdf-parse será importado dinamicamente no handler

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

const processarOcrSchema = z.object({
  fichaOperacionalId: z.string().uuid(),
  imagem: z.string().min(1),
  formato: z.enum(['JPEG', 'PNG', 'PDF']),
})

const extrairPdfSchema = z.object({
  imagem: z.string().min(1),
})

const fichaIdParamsSchema = z.object({ fichaId: z.string().uuid() })

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function ocrRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // POST /processar — Recebe imagem e processa OCR
  app.post('/processar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = processarOcrSchema.parse(request.body)

    // Buscar ficha
    const ficha = await prisma.fichaOperacional.findFirst({
      where: { id: body.fichaOperacionalId, empresaId: user.empresaId },
    })

    if (!ficha) return reply.status(404).send({ message: 'Ficha operacional não encontrada' })

    // Decodificar imagem base64
    const imagemBuffer = Buffer.from(body.imagem, 'base64')

    // Obter serviço OCR via factory
    const ocrService = await criarOcrService(user.empresaId)

    // Processar imagem
    const campos = await ocrService.processarImagem(imagemBuffer, body.formato)

    // Montar resultado com flag de revisão
    const camposComRevisao = campos.map((campo) => ({
      nome: campo.nome,
      valor: campo.valor,
      confianca: campo.confianca,
      necessitaRevisao: campo.confianca < 80,
    }))

    const necessitaRevisao = camposComRevisao.some((c) => c.necessitaRevisao)

    // Armazenar resultado no campo dadosOcr da ficha e atualizar status
    await prisma.fichaOperacional.update({
      where: { id: ficha.id },
      data: {
        dadosOcr: JSON.stringify(camposComRevisao),
        status: 'DIGITALIZADA',
      },
    })

    return {
      fichaOperacionalId: ficha.id,
      campos: camposComRevisao,
      imagemProcessada: true,
      necessitaRevisao,
    }
  })

  // GET /resultado/:fichaId — Retorna resultado OCR de uma ficha
  app.get('/resultado/:fichaId', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { fichaId } = fichaIdParamsSchema.parse(request.params)

    const ficha = await prisma.fichaOperacional.findFirst({
      where: { id: fichaId, empresaId: user.empresaId },
    })

    if (!ficha) return reply.status(404).send({ message: 'Ficha operacional não encontrada' })

    if (!ficha.dadosOcr) {
      return reply.status(404).send({ message: 'Nenhum resultado OCR disponível para esta ficha' })
    }

    const campos = JSON.parse(ficha.dadosOcr)

    return {
      fichaOperacionalId: ficha.id,
      status: ficha.status,
      campos,
    }
  })

  // POST /extrair-pdf — Extrai texto de PDF/HTML de folha de conferência
  app.post('/extrair-pdf', async (request, reply) => {
    const body = extrairPdfSchema.parse(request.body)

    const fileBuffer = Buffer.from(body.imagem, 'base64')
    const fileStr = fileBuffer.toString('utf-8')

    let textoExtraido: string
    let formato: string

    // Detectar formato pelo conteúdo
    const header = fileStr.substring(0, 100).trim()

    if (header.startsWith('<!DOCTYPE') || header.startsWith('<html') || header.startsWith('<HTML')) {
      // HTML — extrair texto removendo tags
      formato = 'HTML'
      textoExtraido = fileStr
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/tr>/gi, '\n')
        .replace(/<\/td>/gi, '\t')
        .replace(/<\/th>/gi, '\t')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
    } else if (header.startsWith('%PDF')) {
      // PDF real — extrair texto dos streams
      formato = 'PDF'
      textoExtraido = extrairTextoDePdf(fileBuffer)
    } else {
      // Tentar como texto puro
      formato = 'TEXTO'
      textoExtraido = fileStr
    }

    console.log('[extrair-pdf] Formato:', formato, 'Texto extraído:', textoExtraido.length, 'chars')
    console.log('[extrair-pdf] Primeiras 500 chars:', textoExtraido.substring(0, 500))

    const itens = parseTabelaConferencia(textoExtraido)
    console.log('[extrair-pdf] Itens encontrados:', itens.length, JSON.stringify(itens))

    const campos = itens.map((item) => ({
      nome: item.codigo,
      valor: String(item.quantidade),
      confianca: formato === 'PDF' ? 95 : 100,
      necessitaRevisao: false,
    }))

    return { campos, formato }
  })
}

// ---------------------------------------------------------------------------
// Extrator de texto de PDF (sem dependências externas)
// Lê streams de texto dos objetos PDF e decodifica
// ---------------------------------------------------------------------------

function extrairTextoDePdf(buffer: Buffer): string {
  const zlib = require('zlib')
  const content = buffer.toString('latin1')

  // Step 1: Extract and decompress all streams
  const streams: string[] = []
  const streamRegex = /stream\r?\n([\s\S]*?)endstream/g
  let match
  while ((match = streamRegex.exec(content)) !== null) {
    try {
      const rawBuf = Buffer.from(match[1], 'latin1')
      streams.push(zlib.inflateSync(rawBuf).toString('utf-8'))
    } catch {
      streams.push(match[1])
    }
  }

  // Step 2: Build ToUnicode map from CMap streams
  const charMap = new Map<number, number>()
  for (const stream of streams) {
    if (!stream.includes('beginbfchar')) continue
    const bfcharBlocks = stream.match(/beginbfchar\n([\s\S]*?)endbfchar/g)
    if (bfcharBlocks) {
      for (const block of bfcharBlocks) {
        const lines = block.split('\n').filter(l => l.startsWith('<'))
        for (const line of lines) {
          const parts = line.match(/<([0-9a-fA-F]+)>/g)
          if (parts && parts.length >= 2) {
            charMap.set(parseInt(parts[0].slice(1, -1), 16), parseInt(parts[1].slice(1, -1), 16))
          }
        }
      }
    }
  }

  // Step 3: Decode hex strings using the CMap
  function decodeHex(hex: string): string {
    let result = ''
    for (let i = 0; i < hex.length; i += 4) {
      const code = parseInt(hex.substring(i, i + 4), 16)
      const unicode = charMap.get(code)
      if (unicode) result += String.fromCodePoint(unicode)
    }
    return result
  }

  // Step 4: Extract text from content streams
  const textos: string[] = []
  for (const stream of streams) {
    if (stream.includes('beginbfchar')) continue
    const textBlocks = stream.match(/BT[\s\S]*?ET/g)
    if (!textBlocks) continue
    for (const block of textBlocks) {
      // TJ arrays with hex strings
      const tjMatches = block.match(/\[([^\]]+)\]\s*TJ/g)
      if (tjMatches) {
        for (const tj of tjMatches) {
          const hexParts = tj.match(/<([0-9a-fA-F]+)>/g)
          if (hexParts) {
            let lineText = ''
            for (const hp of hexParts) lineText += decodeHex(hp.slice(1, -1))
            if (lineText.trim()) textos.push(lineText.trim())
          }
        }
      }
      // Simple Tj strings
      const strings = block.match(/\(([^)]*)\)/g)
      if (strings) {
        for (const s of strings) {
          const decoded = s.slice(1, -1).replace(/\\n/g, '\n').replace(/\\\(/g, '(').replace(/\\\)/g, ')').replace(/\\\\/g, '\\')
          if (decoded.trim()) textos.push(decoded)
        }
      }
    }
  }

  return textos.join('\n')
}

// ---------------------------------------------------------------------------
// Parser — extrai código e quantidade da tabela de conferência do PDF
// ---------------------------------------------------------------------------

/**
 * Unidades de medida comuns encontradas nas folhas de conferência.
 * Usadas para identificar onde termina a descrição do produto e começa a
 * quantidade contada na linha extraída do PDF.
 */
const UNIDADES = ['UN', 'RI', 'RL', 'PC', 'CX', 'KG', 'MT', 'M2', 'LT', 'GL', 'FD', 'SC', 'TB', 'PR', 'JG', 'CT', 'PT', 'BD', 'FR', 'GR', 'ML', 'MG', 'M3', 'TON', 'PAR', 'PCT', 'CJ', 'DZ', 'MIL', 'ROL', 'FLS', 'ENV', 'SAC', 'BAR', 'BLD', 'GAL', 'LAT', 'PEL', 'RES', 'VD']

/**
 * Padrão para detectar o início de uma linha de tabela:
 * número da linha (1, 2, 3…) seguido de espaço e código do produto.
 *
 * Códigos de produto são alfanuméricos, tipicamente 6-15 caracteres,
 * começando com letra ou dígito (ex: B17229055, 1070H103752, PROD001).
 */
function parseTabelaConferencia(texto: string): Array<{ codigo: string; quantidade: number }> {
  const linhas = texto.split('\n').map((l) => l.trim()).filter(Boolean)
  const resultado: Array<{ codigo: string; quantidade: number }> = []

  // Padrão de código de produto: alfanumérico, 6+ chars, começa com letra ou dígito
  const CODIGO_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{4,}$/

  for (let i = 0; i < linhas.length; i++) {
    // Formato 1: tabs (HTML) — "1\tB17025056\tPAPEL...\tRI\t1"
    if (linhas[i].includes('\t')) {
      const cols = linhas[i].split('\t').map(c => c.trim()).filter(Boolean)
      if (cols.length >= 4) {
        const numLinha = parseInt(cols[0])
        if (!isNaN(numLinha) && numLinha > 0 && cols[1] && /^[A-Za-z0-9]/.test(cols[1]) && cols[1].length >= 4) {
          let quantidade = 0
          for (let c = 3; c < cols.length; c++) {
            const val = parseFloat(cols[c].replace(',', '.'))
            if (!isNaN(val) && val > 0) { quantidade = val; break }
          }
          resultado.push({ codigo: cols[1], quantidade })
        }
      }
      continue
    }

    // Formato 2: mesma linha — "1 B17025056 PAPEL... RI 1"
    const matchInline = /^(\d+)\s+([A-Za-z0-9][A-Za-z0-9._/-]{4,})/.exec(linhas[i])
    if (matchInline) {
      const codigo = matchInline[2]
      let textoCompleto = linhas[i]
      let j = i + 1
      while (j < linhas.length && !/^(\d+)\s+([A-Za-z0-9][A-Za-z0-9._/-]{4,})/.test(linhas[j]) && !CODIGO_RE.test(linhas[j])) {
        textoCompleto += ' ' + linhas[j]
        j++
      }
      resultado.push({ codigo, quantidade: extrairQuantidade(textoCompleto) })
      continue
    }

    // Formato 3: linhas separadas (PDF com CMap) — número sozinho, código na próxima linha
    const numLinha = parseInt(linhas[i])
    if (!isNaN(numLinha) && numLinha > 0 && numLinha <= 999 && linhas[i] === String(numLinha)) {
      // Próxima linha deve ser o código do produto
      if (i + 1 < linhas.length && CODIGO_RE.test(linhas[i + 1])) {
        const codigo = linhas[i + 1]
        // Coletar linhas seguintes até encontrar uma unidade + quantidade
        let quantidade = 0
        for (let j = i + 2; j < Math.min(i + 8, linhas.length); j++) {
          // Verificar se a linha é um número sozinho (próximo item) — parar
          const nextNum = parseInt(linhas[j])
          if (!isNaN(nextNum) && nextNum > 0 && linhas[j] === String(nextNum) && j + 1 < linhas.length && CODIGO_RE.test(linhas[j + 1])) {
            break
          }
          // Verificar se é uma unidade de medida
          for (const unidade of UNIDADES) {
            if (linhas[j] === unidade) {
              // Próxima linha deve ser a quantidade
              if (j + 1 < linhas.length) {
                const val = parseFloat(linhas[j + 1].replace(',', '.'))
                if (!isNaN(val)) quantidade = val
              }
              break
            }
          }
          // Verificar se a linha contém unidade + quantidade juntos
          const uqMatch = new RegExp(`^(${UNIDADES.join('|')})\\s+(\\d+[.,]?\\d*)$`).exec(linhas[j])
          if (uqMatch) {
            quantidade = parseFloat(uqMatch[2].replace(',', '.'))
            break
          }
          if (quantidade > 0) break
        }
        resultado.push({ codigo, quantidade })
        i++ // pular a linha do código
      }
    }
  }

  return resultado
}

/**
 * Extrai a quantidade contada de uma linha (possivelmente multi-linha) da tabela.
 *
 * Estratégia:
 * 1. Procura por uma unidade de medida conhecida seguida de um número
 * 2. Se não encontrar, pega o último número isolado da linha
 */
function extrairQuantidade(texto: string): number {
  // Estratégia 1: encontrar UNIDADE seguida de número(s)
  // Padrão: "RI 1" ou "UN 25" ou "KG 1.5"
  for (const unidade of UNIDADES) {
    const re = new RegExp(`\\b${unidade}\\b\\s+(\\d+[.,]?\\d*)`, 'i')
    const m = re.exec(texto)
    if (m) {
      return parseFloat(m[1].replace(',', '.'))
    }
  }

  // Estratégia 2: pegar o último número isolado na linha
  // (geralmente a quantidade é o último campo numérico antes de lote/validade)
  const numeros = texto.match(/\b(\d+[.,]?\d*)\b/g)
  if (numeros && numeros.length > 1) {
    // O primeiro número é o # da linha, o último relevante é a quantidade
    // Ignorar o primeiro (número da linha)
    return parseFloat(numeros[numeros.length - 1].replace(',', '.'))
  }

  return 0
}
