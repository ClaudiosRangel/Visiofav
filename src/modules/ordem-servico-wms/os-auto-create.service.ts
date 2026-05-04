import { prisma } from '../../lib/prisma'
import { OrdemServicoWms } from '@prisma/client'

/**
 * Serviço para criação automática de Ordens de Serviço WMS
 * nas operações outbound (SAIDA): Separação, Embalagem e Carregamento.
 */
export class OsAutoCreateService {
  /**
   * Gera o próximo número sequencial de OS para a empresa.
   */
  private async proximoNumero(empresaId: string, tx?: any): Promise<number> {
    const client = tx ?? prisma
    const ultima = await client.ordemServicoWms.findFirst({
      where: { empresaId },
      orderBy: { numero: 'desc' },
      select: { numero: true },
    })
    return (ultima?.numero ?? 0) + 1
  }

  /**
   * Cria OS de Separação vinculada a uma Onda de Separação.
   */
  async criarOsSeparacao(empresaId: string, ondaSeparacaoId: string): Promise<OrdemServicoWms> {
    return prisma.$transaction(async (tx) => {
      const numero = await this.proximoNumero(empresaId, tx)

      // Buscar funcionário da onda (primeiro funcionário atribuído)
      const ordem = await tx.ordemSeparacao.findFirst({
        where: { ondaSeparacaoId, funcionarioId: { not: null } },
        select: { funcionarioId: true },
      })

      return tx.ordemServicoWms.create({
        data: {
          empresaId,
          numero,
          tipo: 'SAIDA',
          operacao: 'SEPARACAO',
          status: 'ABERTO',
          ondaSeparacaoId,
          funcionarioId: ordem?.funcionarioId ?? undefined,
        },
      })
    })
  }

  /**
   * Cria OS de Embalagem vinculada a uma Onda de Separação.
   */
  async criarOsEmbalagem(empresaId: string, ondaSeparacaoId: string): Promise<OrdemServicoWms> {
    return prisma.$transaction(async (tx) => {
      const numero = await this.proximoNumero(empresaId, tx)

      // Buscar funcionário da onda
      const ordem = await tx.ordemSeparacao.findFirst({
        where: { ondaSeparacaoId, funcionarioId: { not: null } },
        select: { funcionarioId: true },
      })

      return tx.ordemServicoWms.create({
        data: {
          empresaId,
          numero,
          tipo: 'SAIDA',
          operacao: 'EMBALAGEM',
          status: 'ABERTO',
          ondaSeparacaoId,
          funcionarioId: ordem?.funcionarioId ?? undefined,
        },
      })
    })
  }

  /**
   * Cria OS de Carregamento vinculada a um Carregamento.
   */
  async criarOsCarregamento(empresaId: string, carregamentoId: string): Promise<OrdemServicoWms> {
    return prisma.$transaction(async (tx) => {
      const numero = await this.proximoNumero(empresaId, tx)

      return tx.ordemServicoWms.create({
        data: {
          empresaId,
          numero,
          tipo: 'SAIDA',
          operacao: 'CARREGAMENTO',
          status: 'ABERTO',
          carregamentoId,
        },
      })
    })
  }
}
