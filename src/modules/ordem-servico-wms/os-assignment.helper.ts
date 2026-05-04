import { prisma } from '../../lib/prisma'

/**
 * Registers an operator taking over an OS.
 * Creates an OsFuncionarioWms record, sets horaInicio, and updates OS status to EXECUTANDO.
 *
 * Task 13.4: When operator takes over, register employee, start time, status EXECUTANDO.
 */
export async function assumirOs(
  ordemServicoId: string,
  funcionarioId: string,
): Promise<{ ordemServico: any; osFuncionario: any }> {
  return prisma.$transaction(async (tx) => {
    const os = await tx.ordemServicoWms.findUnique({
      where: { id: ordemServicoId },
    })

    if (!os) {
      throw { status: 404, message: 'Ordem de serviço não encontrada' }
    }

    if (os.status !== 'ABERTO' && os.status !== 'EXECUTANDO') {
      throw { status: 422, message: `OS em status ${os.status}. Esperado: ABERTO ou EXECUTANDO` }
    }

    const agora = new Date()

    // Create OsFuncionarioWms record
    const osFuncionario = await tx.osFuncionarioWms.create({
      data: {
        ordemServicoId,
        funcionarioId,
        horaInicio: agora,
      },
    })

    // Update OS status to EXECUTANDO and set horaInicio if first time
    const updateData: any = { status: 'EXECUTANDO' }
    if (!os.horaInicio) {
      updateData.horaInicio = agora
    }
    // Also set the main funcionarioId if not set
    if (!os.funcionarioId) {
      updateData.funcionarioId = funcionarioId
    }

    const ordemServico = await tx.ordemServicoWms.update({
      where: { id: ordemServicoId },
      data: updateData,
    })

    return { ordemServico, osFuncionario }
  })
}

/**
 * Completes an OS: registers end time and calculates total time in minutes.
 *
 * Task 13.4: On completion, register end time and calculate total time in minutes.
 */
export async function concluirOs(
  ordemServicoId: string,
  funcionarioId?: string,
): Promise<{ ordemServico: any; tempoTotalMinutos: number | null }> {
  return prisma.$transaction(async (tx) => {
    const os = await tx.ordemServicoWms.findUnique({
      where: { id: ordemServicoId },
    })

    if (!os) {
      throw { status: 404, message: 'Ordem de serviço não encontrada' }
    }

    const agora = new Date()

    // Calculate total time in minutes
    let tempoTotalMinutos: number | null = null
    if (os.horaInicio) {
      tempoTotalMinutos = Math.round((agora.getTime() - os.horaInicio.getTime()) / 60000)
    }

    // Update OS
    const ordemServico = await tx.ordemServicoWms.update({
      where: { id: ordemServicoId },
      data: {
        status: 'CONCLUIDO',
        horaFim: agora,
      },
    })

    // If a specific funcionario is provided, update their end time
    if (funcionarioId) {
      await tx.osFuncionarioWms.updateMany({
        where: {
          ordemServicoId,
          funcionarioId,
          horaFim: null,
        },
        data: { horaFim: agora },
      })
    } else {
      // Close all open funcionario records
      await tx.osFuncionarioWms.updateMany({
        where: {
          ordemServicoId,
          horaFim: null,
        },
        data: { horaFim: agora },
      })
    }

    return { ordemServico, tempoTotalMinutos }
  })
}
