import { prisma } from '../../lib/prisma'
import { integracaoWmsAutomaticaAtiva } from './configuracao-pcp.routes'
import { criarEntradaProducao } from './pcp-wms-integration.service'

/**
 * Funções puras de negócio dos 4 handlers operacionais de
 * `EtapaOrdemProducao` (iniciar/pausar/apontar/concluir), extraídas de
 * `etapa-operacional.routes.ts` (task 2.1 do spec `checkout-apontamento`).
 *
 * Motivo da extração: sem este service compartilhado, qualquer regra nova
 * do módulo Checkout (bloqueio de sequência, setup obrigatório, etc.)
 * precisaria ser duplicada nas rotas do Checkout ou faria uma chamada HTTP
 * interna para si mesma — ambos os padrões já causaram bugs reais neste
 * projeto (ver `pcp-wms-integration.service.ts` vs lógica inline,
 * documentado em `ATENCAO-pontos-verificar.md`, seção 4).
 *
 * Padrão de erro escolhido: classe de erro customizada `EtapaOperacionalError`
 * com `statusCode` + `message`, seguindo o mesmo padrão já usado no projeto
 * para erros de negócio traduzíveis em HTTP (ver `LiberacaoRejeitadaError`
 * em `portaria.routes.ts`, `RegistroInvalidoError` em
 * `seed-fiscal.service.ts`). Optou-se por essa abordagem (em vez de um
 * objeto discriminado `{ ok, data } | { ok, statusCode, message }`) porque:
 * (a) é o padrão idiomático já estabelecido no restante do código-base,
 * (b) mantém o `try/catch` de erros de infraestrutura (ex.: falha ao criar
 * a NotaEntrada do WMS) e o `throw` de erros de validação de negócio na
 * mesma linguagem de controle de fluxo, sem misturar dois estilos de erro
 * na mesma função, e (c) simplifica a assinatura de retorno das funções
 * (o "caminho feliz" retorna o dado diretamente, sem precisar desembrulhar
 * `.data` em todo lugar que consome o service — inclusive o `checkout.service.ts`
 * futuro, que é o principal motivo desta extração existir).
 *
 * Quem chama estas funções (rotas) deve envolver a chamada em `try/catch`,
 * capturar `EtapaOperacionalError` e responder com `err.statusCode` +
 * `{ message: err.message }` — replicando exatamente as respostas HTTP que
 * os handlers inline retornavam antes desta extração.
 *
 * IMPORTANTE — filtro de segurança multi-tenant: todas as buscas de etapa
 * abaixo filtram explicitamente por `ordemProducao: { empresaId }`. Nunca
 * remover esse filtro (ver histórico de vazamento documentado em
 * `ATENCAO-pontos-verificar.md`, seção 2).
 *
 * Nota sobre `funcionarioId` em `iniciarEtapa`: o handler original em
 * `etapa-operacional.routes.ts` usava `body.funcionarioId || user.id` para
 * o campo `funcionarioId` da própria etapa, mas usava o valor **bruto**
 * `body.funcionarioId` (sem esse fallback) ao criar o `ApontamentoEtapa`
 * tipo `RETOMADA`. Como a assinatura desta função recebe um único parâmetro
 * `funcionarioId` (sem `usuarioId` do chamador, por definição da task 2.1),
 * não é possível reproduzir essa pequena inconsistência do código original
 * dentro do service — o mesmo valor recebido é usado tanto para o campo da
 * etapa quanto para o apontamento de `RETOMADA`. Isso só muda o
 * comportamento no caso de borda em que uma etapa `PAUSADA` é retomada sem
 * nenhum `funcionarioId` informado: o apontamento `RETOMADA` passa a
 * herdar o `funcionarioId` resolvido pelo chamador (ex.: `user.id`) em vez
 * de ficar `undefined`. Documentado aqui para que a task 2.2 (atualização
 * das rotas para usar este service) e qualquer revisão futura estejam
 * cientes dessa pequena divergência intencional.
 */

export class EtapaOperacionalError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message)
    this.name = 'EtapaOperacionalError'
  }
}

/**
 * Inicia ou retoma uma Etapa (status `PENDENTE` ou `PAUSADA` → `EM_ANDAMENTO`).
 * Se a etapa estava `PAUSADA`, registra um `ApontamentoEtapa` tipo `RETOMADA`
 * com o tempo de parada calculado a partir do último apontamento `PARADA`.
 */
export async function iniciarEtapa(etapaId: string, empresaId: string, funcionarioId?: string) {
  // Segurança: filtro explícito por empresaId (via ordemProducao) — sem
  // isso, qualquer usuário autenticado que soubesse/enumerar um UUID de
  // etapa de OUTRA empresa conseguiria iniciá-la (mesma classe de bug já
  // documentada em ATENCAO-pontos-verificar.md).
  const etapa = await prisma.etapaOrdemProducao.findFirst({
    where: { id: etapaId, ordemProducao: { empresaId } },
  })
  if (!etapa) throw new EtapaOperacionalError(404, 'Etapa não encontrada')

  if (!['PENDENTE', 'PAUSADA'].includes(etapa.status)) {
    throw new EtapaOperacionalError(400, `Etapa não pode ser iniciada. Status atual: ${etapa.status}`)
  }

  const agora = new Date()
  const atualizada = await prisma.etapaOrdemProducao.update({
    where: { id: etapaId },
    data: {
      status: 'EM_ANDAMENTO',
      dataInicioReal: etapa.dataInicioReal || agora,
      funcionarioId: funcionarioId,
    },
  })

  // Registra apontamento de retomada se estava pausada, calculando a
  // duração real da parada (diferença entre o apontamento de PARADA mais
  // recente e agora) — necessário para o Pareto de tempo de parada por
  // motivo no dashboard PCP, que antes só contava ocorrências sem duração.
  if (etapa.status === 'PAUSADA') {
    const ultimaParada = await prisma.apontamentoEtapa.findFirst({
      where: { etapaOrdemProducaoId: etapaId, tipo: 'PARADA' },
      orderBy: { dataHora: 'desc' },
    })
    const tempoParadaMinutos = ultimaParada
      ? Math.max(0, Math.round((agora.getTime() - new Date(ultimaParada.dataHora).getTime()) / 60000))
      : undefined

    await prisma.apontamentoEtapa.create({
      data: {
        etapaOrdemProducaoId: etapaId,
        empresaId,
        funcionarioId,
        tipo: 'RETOMADA',
        motivoParada: ultimaParada?.motivoParada,
        tempoParadaMinutos,
        // Requirement 15.2 (spec checkout-apontamento) — gravado
        // explicitamente (mesmo já sendo o default do schema) para manter
        // consistência com o restante das rotas do Checkout, que também
        // gravam este campo de forma explícita.
        fonteApontamento: 'MANUAL_OPERADOR',
      },
    })
  }

  return atualizada
}

/**
 * Pausa uma Etapa `EM_ANDAMENTO`, registrando um `ApontamentoEtapa` tipo
 * `PARADA` com o motivo informado.
 *
 * `paradaPlanejada` é opcional (permanece `undefined`/`null` para os
 * chamadores que não o informam, como a rota original
 * `PATCH /pcp/etapas/:id/pausar`) — foi adicionado ao `dados` para que o
 * Checkout de Apontamento (`checkout.service.ts`, Requirement 8.1, 8.2)
 * possa exigir e persistir o indicador de parada planejada/não planejada
 * sem duplicar esta função (design.md, Requirement 8.4: "reaproveitar a
 * rota... estendendo-a com o indicador de parada planejada/não
 * planejada").
 */
export async function pausarEtapa(
  etapaId: string,
  empresaId: string,
  dados: {
    motivoParada: 'MANUTENCAO' | 'FALTA_MATERIAL' | 'ACERTO_MAQUINA' | 'TROCA_TURNO' | 'OUTRO'
    observacao?: string
    paradaPlanejada?: boolean
  },
) {
  // Segurança: filtro explícito por empresaId — ver comentário em iniciarEtapa.
  const etapa = await prisma.etapaOrdemProducao.findFirst({
    where: { id: etapaId, ordemProducao: { empresaId } },
  })
  if (!etapa) throw new EtapaOperacionalError(404, 'Etapa não encontrada')

  if (etapa.status !== 'EM_ANDAMENTO') {
    throw new EtapaOperacionalError(400, 'Só é possível pausar etapa em andamento')
  }

  await prisma.etapaOrdemProducao.update({ where: { id: etapaId }, data: { status: 'PAUSADA' } })

  const apontamento = await prisma.apontamentoEtapa.create({
    data: {
      etapaOrdemProducaoId: etapaId,
      empresaId,
      funcionarioId: etapa.funcionarioId,
      tipo: 'PARADA',
      motivoParada: dados.motivoParada,
      observacao: dados.observacao,
      paradaPlanejada: dados.paradaPlanejada,
      // Requirement 15.2 (spec checkout-apontamento) — gravado
      // explicitamente (mesmo já sendo o default do schema) para manter
      // consistência com o restante das rotas do Checkout, que também
      // gravam este campo de forma explícita.
      fonteApontamento: 'MANUAL_OPERADOR',
    },
  })

  return { message: 'Etapa pausada', motivo: dados.motivoParada, apontamento }
}

/**
 * Registra produção parcial de uma Etapa `EM_ANDAMENTO` ou `PAUSADA`,
 * criando um `ApontamentoEtapa` (tipo `PRODUCAO` ou `PERDA`, dependendo de
 * `quantidadePerda > 0`) e incrementando os totais da etapa.
 */
export async function apontarProducao(
  etapaId: string,
  empresaId: string,
  dados: {
    quantidadeProduzida: number
    quantidadePerda: number
    motivoPerda?: 'ACERTO' | 'REFUGO' | 'DEFEITO' | 'APARA'
    funcionarioId?: string
    observacao?: string
    fotoUrl?: string
  },
) {
  const etapa = await prisma.etapaOrdemProducao.findFirst({
    where: { id: etapaId, ordemProducao: { empresaId } },
  })
  if (!etapa) throw new EtapaOperacionalError(404, 'Etapa não encontrada')

  if (!['EM_ANDAMENTO', 'PAUSADA'].includes(etapa.status)) {
    throw new EtapaOperacionalError(400, 'Etapa precisa estar em andamento ou pausada para apontar')
  }

  // Registra apontamento
  const apontamento = await prisma.apontamentoEtapa.create({
    data: {
      etapaOrdemProducaoId: etapaId,
      empresaId,
      funcionarioId: dados.funcionarioId || etapa.funcionarioId,
      tipo: dados.quantidadePerda > 0 ? 'PERDA' : 'PRODUCAO',
      quantidadeProduzida: dados.quantidadeProduzida,
      quantidadePerda: dados.quantidadePerda,
      motivoPerda: dados.motivoPerda,
      observacao: dados.observacao,
      fotoUrl: dados.fotoUrl,
      // Requirement 15.2 (spec checkout-apontamento) — gravado
      // explicitamente (mesmo já sendo o default do schema) para manter
      // consistência com o restante das rotas do Checkout, que também
      // gravam este campo de forma explícita.
      fonteApontamento: 'MANUAL_OPERADOR',
    },
  })

  // Atualiza totais na etapa
  await prisma.etapaOrdemProducao.update({
    where: { id: etapaId },
    data: {
      quantidadeProduzida: { increment: dados.quantidadeProduzida },
      quantidadePerda: { increment: dados.quantidadePerda },
    },
  })

  return apontamento
}

/**
 * Conclui uma Etapa `EM_ANDAMENTO` ou `PAUSADA`. Se for a última etapa
 * pendente da Ordem de Produção, propaga `quantidadeProduzida`/
 * `quantidadeRejeitada` para a OP, grava `LogOrdemProducao`, e — se a flag
 * `pcp.integracaoWmsAutomatica` estiver ativa para a empresa — dispara a
 * criação de uma `NotaEntrada` tipo `PRODUCAO` no WMS via
 * `criarEntradaProducao`. Falha na integração WMS é logada mas NUNCA
 * interrompe a resposta de sucesso da conclusão da etapa (tudo dentro de
 * try/catch, exatamente como no handler original).
 */
export async function concluirEtapa(etapaId: string, empresaId: string, usuarioId: string) {
  // Segurança: filtro explícito por empresaId — sem isso, um usuário de
  // OUTRA empresa que soubesse o UUID da etapa conseguia concluí-la, e a
  // NotaEntrada de produção (abaixo) era criada com empresaId do usuário
  // que clicou, não da empresa real da OP — vazando o lançamento de
  // produção para o WMS de uma empresa diferente da que produziu.
  const etapa = await prisma.etapaOrdemProducao.findFirst({
    where: { id: etapaId, ordemProducao: { empresaId } },
    include: {
      ordemProducao: {
        select: { id: true, empresaId: true, produtoId: true, quantidade: true, numero: true, lote: true },
      },
      centroProducao: { select: { codigo: true, descricao: true } },
    },
  })
  if (!etapa) throw new EtapaOperacionalError(404, 'Etapa não encontrada')

  if (!['EM_ANDAMENTO', 'PAUSADA'].includes(etapa.status)) {
    throw new EtapaOperacionalError(400, 'Etapa precisa estar em andamento para concluir')
  }

  const agora = new Date()
  const tempoRealMs = etapa.dataInicioReal ? agora.getTime() - new Date(etapa.dataInicioReal).getTime() : 0
  const tempoRealMin = Math.round(tempoRealMs / 60000)

  const atualizada = await prisma.etapaOrdemProducao.update({
    where: { id: etapaId },
    data: { status: 'CONCLUIDA', dataFimReal: agora },
  })

  // Log de auditoria — conclusão da etapa individual. Antes só havia log
  // quando a OP inteira era concluída (última etapa); etapas intermediárias
  // não deixavam rastro em logOrdemProducao. Registra centro, quantidade
  // produzida/perda e tempo real, sem alterar o status da OP.
  try {
    const centroLabel = etapa.centroProducao
      ? `${etapa.centroProducao.codigo} - ${etapa.centroProducao.descricao}`
      : 'sem centro'
    await prisma.logOrdemProducao.create({
      data: {
        ordemProducaoId: etapa.ordemProducaoId,
        statusAnterior: etapa.status,
        statusNovo: etapa.status,
        usuarioId,
        observacao:
          `Etapa "${etapa.descricao}" (${centroLabel}) concluída. ` +
          `Produzido: ${Number(atualizada.quantidadeProduzida)}, ` +
          `perda: ${Number(atualizada.quantidadePerda)}, ` +
          `tempo real: ${tempoRealMin} min.`,
      },
    })
  } catch (err) {
    console.error('[PCP] Erro ao registrar log de conclusão de etapa:', err)
  }

  // Verifica se TODAS as etapas da OP estão concluídas → entrada de PA no WMS
  let entradaWms = null
  const todasEtapas = await prisma.etapaOrdemProducao.findMany({
    where: { ordemProducaoId: etapa.ordemProducaoId },
    select: { status: true },
  })

  const todasConcluidas = todasEtapas.every((e) => e.status === 'CONCLUIDA')

  if (todasConcluidas) {
    // Propaga a quantidade produzida (apontada na última etapa) para a OP —
    // SEMPRE, independente de usar WMS ou não. Antes disso, a OP virava
    // CONCLUIDA (via essa própria rota, quando usaWms=true, ou via
    // PATCH /ordens-producao/:id/status manual) sem nunca atualizar
    // `quantidadeProduzida`, deixando o %Concluído travado em 0% mesmo com
    // a OP finalizada e material real apontado nas etapas.
    try {
      await prisma.ordemProducao.update({
        where: { id: etapa.ordemProducaoId },
        data: {
          status: 'CONCLUIDA',
          dataFimReal: agora,
          quantidadeProduzida: atualizada.quantidadeProduzida,
          quantidadeRejeitada: atualizada.quantidadePerda,
        },
      })

      await prisma.logOrdemProducao.create({
        data: {
          ordemProducaoId: etapa.ordemProducaoId,
          statusAnterior: 'EM_PRODUCAO',
          statusNovo: 'CONCLUIDA',
          usuarioId,
          observacao: `Todas as etapas concluídas. Quantidade produzida: ${Number(atualizada.quantidadeProduzida)}.`,
        },
      })
    } catch (err) {
      console.error('[PCP] Erro ao atualizar quantidade produzida da OP na conclusão:', err)
    }

    try {
      // empresaId sempre da OP (etapa.ordemProducao.empresaId), nunca do
      // usuário logado — já garantido pelo filtro na busca da etapa acima,
      // mas mantido explícito aqui para não reintroduzir o bug se a busca
      // for alterada no futuro sem esse cuidado.
      const empresaIdOp = etapa.ordemProducao.empresaId
      const empresa = await prisma.empresa.findUnique({ where: { id: empresaIdOp } })

      // Flag dedicada de integração automática PCP → WMS (pcp.integracaoWmsAutomatica),
      // não apenas `Empresa.usaWms` — usaWms indica só que a empresa usa o
      // módulo WMS, não que toda OP concluída deva gerar entrada automática
      // de estoque (ex.: empresa pode preferir lançar manualmente). Ver
      // configuracao-pcp.routes.ts e ATENCAO-pontos-verificar.md.
      const integracaoAutomatica = empresa?.usaWms ? await integracaoWmsAutomaticaAtiva(empresaIdOp) : false

      if (integracaoAutomatica) {
        // Cria Nota de Entrada tipo PRODUCAO (PA entra no estoque WMS) —
        // implementação única em pcp-wms-integration.service.ts, chamada
        // aqui em vez de duplicar a lógica inline (ver histórico do bug
        // de duas versões divergentes em ATENCAO-pontos-verificar.md).
        const quantidadeProduzidaFinal =
          Number(atualizada.quantidadeProduzida) > 0
            ? Number(atualizada.quantidadeProduzida)
            : Number(etapa.ordemProducao.quantidade)

        const nota = await criarEntradaProducao({
          empresaId: empresaIdOp,
          ordemProducaoId: etapa.ordemProducaoId,
          produtoId: etapa.ordemProducao.produtoId,
          quantidade: quantidadeProduzidaFinal,
          lote: etapa.ordemProducao.lote,
        })

        entradaWms = { notaEntradaId: nota.id, numero: nota.numero, status: 'PENDENTE' }

        await prisma.logOrdemProducao.create({
          data: {
            ordemProducaoId: etapa.ordemProducaoId,
            statusAnterior: 'CONCLUIDA',
            statusNovo: 'CONCLUIDA',
            usuarioId,
            observacao: `Nota de entrada #${nota.numero} criada no WMS.`,
          },
        })
      }
    } catch (err) {
      console.error('[PCP→WMS] Erro ao criar entrada de PA:', err)
    }
  }

  return { ...atualizada, tempoRealMinutos: tempoRealMin, todasConcluidas, entradaWms }
}
