import { prisma } from '../../lib/prisma'
import { registrarAudit } from '../auditoria/auditoria.routes'

export interface ValidacaoLocalizacaoResult {
  valido: boolean
  enderecoEsperado: string
  enderecoEscaneado: string
  timestamp: string
  mensagem?: string
}

/**
 * Serviço de validação de localização por código de barras.
 * Compara o barcode escaneado pelo operador com o endereço esperado
 * e registra cada validação no AuditLog.
 */
export class ValidacaoLocalizacaoService {
  /**
   * Valida se o barcode escaneado corresponde ao endereço esperado.
   *
   * O barcode do endereço é derivado do campo `enderecoCompleto`
   * com caracteres não-alfanuméricos removidos (padrão das etiquetas).
   */
  async validar(
    barcodeEscaneado: string,
    enderecoEsperadoId: string,
    ordemServicoId: string,
    empresaId: string,
    usuarioId: string,
  ): Promise<ValidacaoLocalizacaoResult> {
    const timestamp = new Date().toISOString()

    // Buscar endereço esperado pelo ID
    const enderecoEsperado = await prisma.endereco.findUnique({
      where: { id: enderecoEsperadoId },
      select: { id: true, enderecoCompleto: true },
    })

    if (!enderecoEsperado) {
      await this.registrarValidacao(empresaId, usuarioId, ordemServicoId, {
        enderecoEsperadoId,
        enderecoEsperado: null,
        barcodeEscaneado,
        enderecoEscaneado: null,
        valido: false,
        motivo: 'Endereço esperado não encontrado',
        timestamp,
      })

      return {
        valido: false,
        enderecoEsperado: '',
        enderecoEscaneado: barcodeEscaneado,
        timestamp,
        mensagem: 'Endereço esperado não encontrado no sistema',
      }
    }

    // Gerar barcode do endereço esperado (mesmo padrão das etiquetas)
    const barcodeEsperado = (enderecoEsperado.enderecoCompleto || '').replace(/[^A-Za-z0-9]/g, '')

    // Normalizar barcode escaneado para comparação
    const barcodeNormalizado = barcodeEscaneado.replace(/[^A-Za-z0-9]/g, '')

    const valido = barcodeNormalizado.toUpperCase() === barcodeEsperado.toUpperCase()

    // Buscar endereço correspondente ao barcode escaneado (se diferente)
    let enderecoEscaneadoCompleto = barcodeEscaneado
    if (!valido) {
      // Tentar encontrar o endereço escaneado para dar contexto ao operador
      const enderecos = await prisma.endereco.findMany({
        where: { enderecoCompleto: { not: null } },
        select: { enderecoCompleto: true },
      })

      const encontrado = enderecos.find((e) => {
        const bc = (e.enderecoCompleto || '').replace(/[^A-Za-z0-9]/g, '')
        return bc.toUpperCase() === barcodeNormalizado.toUpperCase()
      })

      if (encontrado) {
        enderecoEscaneadoCompleto = encontrado.enderecoCompleto || barcodeEscaneado
      }
    } else {
      enderecoEscaneadoCompleto = enderecoEsperado.enderecoCompleto || barcodeEscaneado
    }

    await this.registrarValidacao(empresaId, usuarioId, ordemServicoId, {
      enderecoEsperadoId,
      enderecoEsperado: enderecoEsperado.enderecoCompleto,
      barcodeEscaneado,
      enderecoEscaneado: enderecoEscaneadoCompleto,
      valido,
      motivo: valido ? undefined : 'Barcode não corresponde ao endereço esperado',
      timestamp,
    })

    return {
      valido,
      enderecoEsperado: enderecoEsperado.enderecoCompleto || '',
      enderecoEscaneado: enderecoEscaneadoCompleto,
      timestamp,
      mensagem: valido
        ? undefined
        : `Endereço incorreto. Esperado: ${enderecoEsperado.enderecoCompleto}`,
    }
  }

  private async registrarValidacao(
    empresaId: string,
    usuarioId: string,
    ordemServicoId: string,
    dados: {
      enderecoEsperadoId: string
      enderecoEsperado: string | null
      barcodeEscaneado: string
      enderecoEscaneado: string | null
      valido: boolean
      motivo?: string
      timestamp: string
    },
  ): Promise<void> {
    await registrarAudit(empresaId, usuarioId, {
      entidade: 'VALIDACAO_LOCALIZACAO',
      entidadeId: ordemServicoId,
      acao: dados.valido ? 'APROVAR' : 'REJEITAR',
      descricao: dados.valido
        ? `Localização validada: ${dados.enderecoEsperado}`
        : `Localização rejeitada: esperado ${dados.enderecoEsperado}, escaneado ${dados.enderecoEscaneado}`,
      dados: {
        enderecoEsperadoId: dados.enderecoEsperadoId,
        enderecoEsperado: dados.enderecoEsperado,
        barcodeEscaneado: dados.barcodeEscaneado,
        enderecoEscaneado: dados.enderecoEscaneado,
        valido: dados.valido,
        motivo: dados.motivo,
        timestamp: dados.timestamp,
      },
    })
  }
}
