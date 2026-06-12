/**
 * CceService — Orquestração da emissão de Carta de Correção Eletrônica (CC-e)
 *
 * Fluxo: verificar limite → gerar XML → assinar → transmitir → registrar resultado
 * Limite máximo: 20 CC-e por NF-e (legislação vigente)
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5
 */
import { prisma } from '../../lib/prisma'
import { gerarXmlCCe, gerarTextoCCe } from './cce-xml-builder'
import { assinarXml, transmitirCCe } from './cce-sefaz'

// ─── Interfaces ────────────────────────────────────────────────────────────────

export interface EmitirCCeParams {
  empresaId: string
  notaEntradaId: string
  divergenciaId: string
  item: string
  quantidadeOriginal: number
  quantidadeCorrigida: number
}

export interface ResultadoCCe {
  sucesso: boolean
  protocolo?: string
  sequencia: number
  motivoRejeicao?: string
}

// Limite máximo de CC-e por NF-e conforme legislação
const LIMITE_CCE_POR_NF = 20

// Mapa UF sigla → código IBGE
const UF_PARA_CODIGO_IBGE: Record<string, string> = {
  AC: '12', AL: '27', AP: '16', AM: '13', BA: '29',
  CE: '23', DF: '53', ES: '32', GO: '52', MA: '21',
  MT: '51', MS: '50', MG: '31', PA: '15', PB: '25',
  PR: '41', PE: '26', PI: '22', RJ: '33', RN: '24',
  RS: '43', RO: '11', RR: '14', SC: '42', SP: '35',
  SE: '28', TO: '17',
}

// ─── Service ───────────────────────────────────────────────────────────────────

export class CceService {
  /**
   * Emite uma CC-e para correção de divergência de quantidade.
   *
   * Orquestração:
   * 1. Verifica limite de 20 CC-e por NF
   * 2. Busca dados da NF e Empresa (chave, certificado, UF)
   * 3. Gera texto de correção
   * 4. Gera XML do evento 110110
   * 5. Assina XML com certificado A1
   * 6. Transmite à SEFAZ
   * 7. Registra resultado (autorização ou rejeição)
   */
  async emitirCCe(params: EmitirCCeParams): Promise<ResultadoCCe> {
    const { empresaId, notaEntradaId, divergenciaId, item, quantidadeOriginal, quantidadeCorrigida } = params

    // 1. Verificar limite de 20 CC-e por NF
    const countExistentes = await prisma.cartaCorrecao.count({
      where: { notaEntradaId, empresaId },
    })

    if (countExistentes >= LIMITE_CCE_POR_NF) {
      return {
        sucesso: false,
        sequencia: countExistentes,
        motivoRejeicao: `Limite máximo de ${LIMITE_CCE_POR_NF} CC-e por NF-e atingido`,
      }
    }

    // 2. Buscar dados da NF e Empresa
    const notaEntrada = await prisma.notaEntrada.findUniqueOrThrow({
      where: { id: notaEntradaId },
      select: { chaveNfe: true, empresaId: true },
    })

    const empresa = await prisma.empresa.findUniqueOrThrow({
      where: { id: empresaId },
      select: {
        cnpj: true,
        uf: true,
        certificadoPfx: true,
        senhaCertificado: true,
        ambienteNFe: true,
      },
    })

    if (!notaEntrada.chaveNfe) {
      return {
        sucesso: false,
        sequencia: countExistentes + 1,
        motivoRejeicao: 'Nota de entrada não possui chave NF-e vinculada',
      }
    }

    if (!empresa.certificadoPfx || !empresa.senhaCertificado) {
      return {
        sucesso: false,
        sequencia: countExistentes + 1,
        motivoRejeicao: 'Certificado digital não configurado para a empresa',
      }
    }

    // 3. Calcular sequência do evento (próximo número)
    const sequencia = countExistentes + 1

    // 4. Gerar texto de correção
    const textoCorrecao = gerarTextoCCe({ item, quantidadeOriginal, quantidadeCorrigida })

    // 5. Determinar cOrgao (código IBGE da UF)
    const cOrgao = empresa.uf ? (UF_PARA_CODIGO_IBGE[empresa.uf] || '35') : '35'

    // 6. Gerar XML do evento CC-e
    const xml = gerarXmlCCe({
      chNFe: notaEntrada.chaveNfe,
      dhEvento: new Date().toISOString(),
      nSeqEvento: sequencia,
      xCorrecao: textoCorrecao,
      cnpjEmitente: empresa.cnpj,
      cOrgao,
      tpAmb: empresa.ambienteNFe,
    })

    // 7. Assinar XML com certificado A1
    const certificado = {
      pfxBase64: empresa.certificadoPfx,
      senha: empresa.senhaCertificado,
    }
    const xmlAssinado = assinarXml(xml, certificado)

    // 8. Transmitir à SEFAZ
    const resposta = await transmitirCCe(xmlAssinado, empresa.ambienteNFe, certificado)

    // 9. Registrar resultado no banco
    if (resposta.codigoStatus === 135) {
      // Autorizada — registrar protocolo e vincular à NF
      await prisma.cartaCorrecao.create({
        data: {
          empresaId,
          notaEntradaId,
          divergenciaId,
          chaveNfe: notaEntrada.chaveNfe,
          sequenciaEvento: sequencia,
          textoCorrecao,
          xmlEnviado: xml,
          xmlRetorno: resposta.xmlRetorno || null,
          protocolo: resposta.protocolo || null,
          status: 'AUTORIZADA',
        },
      })

      // Atualizar status da divergência para ACEITA
      await prisma.divergenciaConferencia.update({
        where: { id: divergenciaId },
        data: { status: 'ACEITA' },
      })

      return {
        sucesso: true,
        protocolo: resposta.protocolo,
        sequencia,
      }
    } else {
      // Rejeitada — registrar motivo, manter status PENDENTE_CCE
      const motivoRejeicao = resposta.motivoStatus || `Rejeição SEFAZ (cStat: ${resposta.codigoStatus})`

      await prisma.cartaCorrecao.create({
        data: {
          empresaId,
          notaEntradaId,
          divergenciaId,
          chaveNfe: notaEntrada.chaveNfe,
          sequenciaEvento: sequencia,
          textoCorrecao,
          xmlEnviado: xml,
          xmlRetorno: resposta.xmlRetorno || null,
          status: 'REJEITADA',
          motivoRejeicao,
        },
      })

      // Manter divergência em status PENDENTE_CCE
      await prisma.divergenciaConferencia.update({
        where: { id: divergenciaId },
        data: { status: 'PENDENTE_CCE' },
      })

      return {
        sucesso: false,
        sequencia,
        motivoRejeicao,
      }
    }
  }
}
