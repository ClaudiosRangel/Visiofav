/**
 * Job diário de recálculo do Financeiro Vizor (billing do SaaS).
 *
 * Reclassifica automaticamente o ciclo de inadimplência de TODAS as empresas
 * clientes do Vizor a partir da fatura vencida em aberto mais antiga:
 * marca faturas vencidas, recalcula o estágio (ATIVO -> SOMENTE_LEITURA aos 30
 * dias), dispara alertas a partir dos 10 dias e registra a execução.
 * (Req 6.1, 6.2, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.11, 6.12)
 *
 * DESIGN (ver `.kiro/specs/financeiro-vizor/design.md`, fluxo "Job diário de
 * recálculo" e "Components and Interfaces" item 5):
 * - A função é AGNÓSTICA AO GATILHO e IDEMPOTENTE: recebe `agora` como
 *   parâmetro (default `new Date()` se não informado). Reexecutá-la no mesmo
 *   dia não duplica alertas (idempotência diária em `alerta-cobranca.service`)
 *   nem "avança" o estágio além do que os dias em atraso justificam.
 * - Toda a lógica determinística vem do NÚCLEO PURO (`financeiro-calculo.ts`):
 *   `calcularDiasEmAtraso` e `determinarEstagio`. Aqui ficam apenas a I/O e a
 *   orquestração por empresa.
 * - ISOLAMENTO INVERTIDO (uso exclusivo do SUPER_ADMIN): usa o Prisma GLOBAL
 *   (`import { prisma }`), NUNCA `request.prismaScoped` — varre TODAS as
 *   empresas. O isolamento por empresa é EXPLÍCITO com `where: { empresaId }`
 *   em cada operação de escrita (marcação de faturas). O agendamento em si é a
 *   Tarefa 12.2 (não implementado aqui).
 *
 * RESILIÊNCIA (Req 6.2): cada empresa é processada dentro de um try/catch
 * INDIVIDUAL. Uma falha ao processar uma empresa NÃO altera o status das
 * demais e NÃO interrompe o job — o status vigente da empresa que falhou é
 * preservado (nenhuma escrita parcial de status é feita fora do fluxo normal).
 * A ocorrência de qualquer falha é registrada em `LogExecucaoJobFinanceiro`
 * (com `sucesso: false` e a mensagem de erro consolidada).
 */

import { prisma } from '../../lib/prisma'
import { enviarAlertaSeNecessario } from './alerta-cobranca.service'
import { calcularDiasEmAtraso, determinarEstagio } from './financeiro-calculo'
import { DIAS_ALERTA } from './financeiro.types'
import type { StatusFatura, StatusFinanceiro } from './financeiro.types'
import { aplicarStatus } from './status-financeiro.service'

/**
 * Executa o recálculo do ciclo de inadimplência de todas as empresas.
 *
 * @param agora Data de referência do recálculo. Default `new Date()` — a
 *   função é agnóstica ao gatilho e idempotente, então injetar `agora` permite
 *   testes determinísticos e reexecução controlada.
 * @returns `{ empresasProcessadas }` — quantas empresas foram processadas com
 *   sucesso (as que falharam individualmente não são contadas).
 */
export async function executarRecalculoFinanceiro(
  agora: Date = new Date(),
): Promise<{ empresasProcessadas: number }> {
  // Abre o log de execução (iniciadoEm = now por default do schema).
  const log = await prisma.logExecucaoJobFinanceiro.create({ data: {} })

  let empresasProcessadas = 0
  const errosPorEmpresa: string[] = []

  try {
    // Varredura GLOBAL de todas as empresas com suas faturas (Prisma global).
    const empresas = await prisma.empresa.findMany({
      select: {
        id: true,
        statusFinanceiro: true,
        faturas: {
          select: { id: true, status: true, dataVencimento: true },
        },
      },
    })

    for (const empresa of empresas) {
      // try/catch INDIVIDUAL: falha isolada não afeta as demais empresas nem
      // aborta o job. O status vigente da empresa que falhar é preservado.
      try {
        await processarEmpresa(
          {
            id: empresa.id,
            statusAtual: empresa.statusFinanceiro as StatusFinanceiro,
            faturas: empresa.faturas.map((f) => ({
              id: f.id,
              status: f.status as StatusFatura,
              dataVencimento: f.dataVencimento,
            })),
          },
          agora,
        )
        empresasProcessadas += 1
      } catch (erro) {
        const msg = erro instanceof Error ? erro.message : String(erro)
        errosPorEmpresa.push(`empresa ${empresa.id}: ${msg}`)
      }
    }

    // Sucesso do job = nenhuma empresa falhou individualmente. Se houve ao
    // menos uma falha, o job é marcado como falho e o erro é registrado
    // (Req 6.2), mas as empresas processadas com sucesso permanecem aplicadas.
    const sucesso = errosPorEmpresa.length === 0
    await prisma.logExecucaoJobFinanceiro.update({
      where: { id: log.id },
      data: {
        finalizadoEm: new Date(),
        sucesso,
        empresasProcessadas,
        erro: sucesso ? null : errosPorEmpresa.join('\n'),
      },
    })

    return { empresasProcessadas }
  } catch (erro) {
    // Falha global (ex.: a própria varredura de empresas falhou). Registra a
    // ocorrência preservando o status vigente de todas as empresas (Req 6.2).
    const msg = erro instanceof Error ? erro.message : String(erro)
    await prisma.logExecucaoJobFinanceiro.update({
      where: { id: log.id },
      data: {
        finalizadoEm: new Date(),
        sucesso: false,
        empresasProcessadas,
        erro: [msg, ...errosPorEmpresa].join('\n'),
      },
    })
    return { empresasProcessadas }
  }
}

/**
 * Processa o ciclo de inadimplência de UMA empresa (dentro de try/catch
 * individual do laço principal):
 *
 * 1. Marca faturas `PENDENTE` já vencidas (`dataVencimento < agora`) como
 *    `VENCIDA` (Req 6.4) — isolamento explícito por `empresaId`.
 * 2. Calcula `diasEmAtraso` via núcleo puro (fatura vencida em aberto mais
 *    antiga). (Req 6.3)
 * 3. `determinarEstagio(statusAtual, dias)`: `ATIVO -> SOMENTE_LEITURA` aos 30
 *    dias; `INATIVADO` permanece `INATIVADO`; `SOMENTE_LEITURA` não é reativado
 *    pelo job. Se o estágio mudou, materializa via `aplicarStatus`.
 *    (Req 6.5, 6.7, 6.11, 6.12, 8.6)
 * 4. Se `dias >= DIAS_ALERTA` (10) e o status resultante ≠ `INATIVADO`, dispara
 *    o alerta idempotente do dia. (Req 6.6, 6.8, 6.9)
 */
async function processarEmpresa(
  empresa: {
    id: string
    statusAtual: StatusFinanceiro
    faturas: { id: string; status: StatusFatura; dataVencimento: Date }[]
  },
  agora: Date,
): Promise<void> {
  const { id: empresaId, statusAtual } = empresa

  // 1. Marca PENDENTE vencida -> VENCIDA (Req 6.4). Isolamento explícito por
  //    empresaId; `updateMany` só afeta as faturas desta empresa.
  await prisma.fatura.updateMany({
    where: {
      empresaId,
      status: 'PENDENTE',
      dataVencimento: { lt: agora },
    },
    data: { status: 'VENCIDA' },
  })

  // As faturas em memória usadas no cálculo refletem essa transição (para não
  // depender de reler o banco): a marcação acima só troca PENDENTE->VENCIDA
  // quando já vencidas, e `calcularDiasEmAtraso` trata PENDENTE e VENCIDA de
  // forma idêntica (ambas "em aberto"), então o resultado é o mesmo.
  const faturasParaCalculo = empresa.faturas.map((f) => ({
    status: f.status,
    dataVencimento: f.dataVencimento,
  }))

  // 2. Dias em atraso via núcleo puro (Req 6.3).
  const diasEmAtraso = calcularDiasEmAtraso(faturasParaCalculo, agora)

  // 3. Novo estágio (núcleo puro). INATIVADO é absorvente; SOMENTE_LEITURA não
  //    é reativado; ATIVO -> SOMENTE_LEITURA aos 30 dias. (Req 6.5, 6.7, 6.11, 6.12)
  const novoStatus = determinarEstagio(statusAtual, diasEmAtraso)
  if (novoStatus !== statusAtual) {
    await aplicarStatus(empresaId, novoStatus)
  }

  // 4. Alerta a partir de 10 dias, exceto para empresas INATIVADO (Req 6.6, 6.8, 6.9).
  //    O serviço de alerta é idempotente por dia/tipo/empresa (Req 6.10) e o
  //    tipo (10d/30d) é determinado internamente pelos dias em atraso.
  if (diasEmAtraso >= DIAS_ALERTA && novoStatus !== 'INATIVADO') {
    await enviarAlertaSeNecessario({
      empresaId,
      diasEmAtraso,
      status: novoStatus,
      agora,
    })
  }
}
