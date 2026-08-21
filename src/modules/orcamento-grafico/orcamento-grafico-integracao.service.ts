import { prisma } from '../../lib/prisma'
import { proximoNumeroOp } from '../ordem-producao/ordem-producao.service'

/**
 * Resultado da geração de OP a partir de um orçamento gráfico.
 */
export interface ResultadoGeracaoOp {
  ordemProducaoId: string
  numero: number
  etapasGeradas: number
}

/**
 * Gera uma Ordem de Produção a partir de um orçamento gráfico quando
 * o PedidoVenda originado do orçamento é confirmado.
 *
 * Essa função é idempotente: se já existir uma OP vinculada ao mesmo pedido
 * com origem ORCAMENTO_GRAFICO e status != CANCELADA, retorna null sem duplicar.
 *
 * Tarefas 9.2 e 9.3:
 * - Cria OrdemProducao com dados do orçamento
 * - Gera EtapaOrdemProducao a partir de resultadoCalculo.maquinas.detalhePorEtapa
 *   e resultadoCalculo.acabamentos.detalhePorAcabamento
 */
export async function gerarOpFromOrcamento(
  orcamentoId: string,
  pedidoVendaId: string,
  empresaId: string,
  userId: string,
): Promise<ResultadoGeracaoOp | null> {
  // Buscar o orçamento com dados necessários
  const orcamento = await prisma.orcamentoGrafico.findFirst({
    where: { id: orcamentoId, empresaId },
    select: {
      id: true,
      numero: true,
      quantidade: true,
      clienteId: true,
      clienteNome: true,
      precoVenda: true,
      resultadoCalculo: true,
      tipoEmbalagemId: true,
      tipoEmbalagem: {
        select: { descricao: true, processosObrigatorios: true },
      },
      papelDescricao: true,
      observacoes: true,
    },
  })

  if (!orcamento) return null

  // Idempotência: verificar se já existe OP gerada a partir desse pedido com origem orçamento
  const opExistente = await prisma.ordemProducao.findFirst({
    where: {
      empresaId,
      pedidoVendaId,
      origemImportacao: 'ORCAMENTO_GRAFICO',
      status: { notIn: ['CANCELADA'] },
    },
    select: { id: true, numero: true },
  })

  if (opExistente) {
    // Já existe — retorna null para indicar que não duplicou
    return null
  }

  // Gerar número sequencial
  const numero = await proximoNumeroOp(empresaId)

  // Montar observações com tags (padrão do módulo PCP)
  const tagsObs: string[] = []
  if (orcamento.clienteNome) {
    tagsObs.push(`[Cliente] ${orcamento.clienteNome}`)
  }
  if (orcamento.tipoEmbalagem?.descricao) {
    tagsObs.push(`[Produto] ${orcamento.tipoEmbalagem.descricao}`)
  }
  if (orcamento.observacoes) {
    tagsObs.push(orcamento.observacoes)
  }

  const observacoesOp = tagsObs.length > 0 ? tagsObs.join('\n') : null

  // Criar OrdemProducao
  const op = await prisma.ordemProducao.create({
    data: {
      empresaId,
      numero,
      produtoId: null, // orçamento gráfico não tem vínculo formal com produto cadastrado
      quantidade: orcamento.quantidade,
      unidadeMedida: 'UN',
      status: 'PLANEJADA',
      prioridade: 'NORMAL',
      pedidoVendaId,
      clienteId: orcamento.clienteId,
      referenciaExterna: `ORC-${orcamento.numero}`,
      origemImportacao: 'ORCAMENTO_GRAFICO',
      observacoes: observacoesOp,
      criadoPorId: userId,
    },
    select: { id: true, numero: true },
  })

  // Gerar etapas a partir do resultadoCalculo
  const etapasGeradas = await gerarEtapasFromCalculo(
    op.id,
    orcamento.resultadoCalculo as any,
    orcamento.tipoEmbalagem?.processosObrigatorios ?? [],
    empresaId,
  )

  // Log de criação
  await prisma.logOrdemProducao.create({
    data: {
      ordemProducaoId: op.id,
      statusAnterior: '',
      statusNovo: 'PLANEJADA',
      usuarioId: userId,
      observacao: `Gerada a partir do orçamento gráfico #${orcamento.numero} (pedido #${pedidoVendaId.slice(0, 8)})`,
    },
  })

  return {
    ordemProducaoId: op.id,
    numero: op.numero,
    etapasGeradas,
  }
}

/**
 * Gera EtapaOrdemProducao a partir do resultadoCalculo do orçamento.
 *
 * Task 9.3: Usa detalhePorEtapa (máquinas) e detalhePorAcabamento (acabamentos)
 * para gerar etapas com tempos calculados.
 *
 * Se o cálculo não tiver dados suficientes para vincular a um CentroProducao,
 * cria etapas genéricas com base nos processos obrigatórios do tipo de embalagem.
 */
async function gerarEtapasFromCalculo(
  ordemProducaoId: string,
  resultadoCalculo: any,
  processosObrigatorios: string[],
  empresaId: string,
): Promise<number> {
  const etapasParaCriar: Array<{
    ordemProducaoId: string
    sequencia: number
    descricao: string
    centroProducaoId: string | null
    tempoSetupMinutos: number
    tempoOperacaoCalculado: number
    status: string
  }> = []

  let sequencia = 1

  // Buscar centros de produção da empresa para tentar vincular por tipo
  const centrosEmpresa = await prisma.centroProducao.findMany({
    where: { empresaId, status: true },
    select: {
      id: true,
      codigo: true,
      descricao: true,
      tipoProcesso: { select: { codigo: true, descricao: true } },
    },
  })

  // Função helper para encontrar um centro por código/tipo de processo
  function encontrarCentro(etapaNome: string): string | null {
    const nomeUpper = (etapaNome || '').toUpperCase()

    // Tentar match pelo código do tipo de processo
    for (const centro of centrosEmpresa) {
      const tipoCodigo = (centro.tipoProcesso?.codigo || '').toUpperCase()
      const tipoDesc = (centro.tipoProcesso?.descricao || '').toUpperCase()
      const centroCodigo = (centro.codigo || '').toUpperCase()
      const centroDesc = (centro.descricao || '').toUpperCase()

      if (nomeUpper.includes('IMPRESS') && (tipoCodigo.includes('IMPRESS') || tipoDesc.includes('IMPRESS'))) {
        return centro.id
      }
      if (nomeUpper.includes('CORTE') && (tipoCodigo.includes('CORTE') || tipoDesc.includes('CORTE') || centroCodigo.includes('CORTE') || centroDesc.includes('CORTE'))) {
        return centro.id
      }
      if (nomeUpper.includes('VINCO') && (tipoCodigo.includes('CORTE') || tipoDesc.includes('CORTE') || centroDesc.includes('VINCO'))) {
        return centro.id
      }
      if (nomeUpper.includes('COLA') && (tipoCodigo.includes('COLA') || tipoDesc.includes('COLA'))) {
        return centro.id
      }
      if (nomeUpper.includes('VERNIZ') && (tipoCodigo.includes('VERNIZ') || tipoDesc.includes('VERNIZ'))) {
        return centro.id
      }
      if (nomeUpper.includes('LAMINAC') && (tipoCodigo.includes('ACABAM') || tipoDesc.includes('ACABAM') || tipoDesc.includes('LAMINAC'))) {
        return centro.id
      }
      if (nomeUpper.includes('ACABAM') && (tipoCodigo.includes('ACABAM') || tipoDesc.includes('ACABAM'))) {
        return centro.id
      }
    }

    return null
  }

  // Parte 1: Etapas de máquinas (impressão)
  if (resultadoCalculo?.maquinas?.detalhePorEtapa) {
    for (const etapaMaq of resultadoCalculo.maquinas.detalhePorEtapa) {
      const centroId = encontrarCentro(etapaMaq.etapa)

      etapasParaCriar.push({
        ordemProducaoId,
        sequencia,
        descricao: etapaMaq.etapa || `Máquina ${sequencia}`,
        centroProducaoId: centroId,
        tempoSetupMinutos: etapaMaq.setupMin || 0,
        tempoOperacaoCalculado: etapaMaq.operacaoMin || 0,
        status: 'PENDENTE',
      })
      sequencia++
    }
  }

  // Parte 2: Etapas de acabamento
  if (resultadoCalculo?.acabamentos?.detalhePorAcabamento) {
    for (const acabamento of resultadoCalculo.acabamentos.detalhePorAcabamento) {
      const centroId = encontrarCentro(acabamento.tipo)

      etapasParaCriar.push({
        ordemProducaoId,
        sequencia,
        descricao: acabamento.tipo || `Acabamento ${sequencia}`,
        centroProducaoId: centroId,
        tempoSetupMinutos: 0, // acabamentos no cálculo não têm setup separado
        tempoOperacaoCalculado: 0, // custo é registrado mas tempo não é separado no resultado
        status: 'PENDENTE',
      })
      sequencia++
    }
  }

  // Se não temos etapas do cálculo, usar processos obrigatórios como fallback
  if (etapasParaCriar.length === 0 && processosObrigatorios.length > 0) {
    for (const processo of processosObrigatorios) {
      const centroId = encontrarCentro(processo)

      etapasParaCriar.push({
        ordemProducaoId,
        sequencia,
        descricao: processo,
        centroProducaoId: centroId,
        tempoSetupMinutos: 0,
        tempoOperacaoCalculado: 0,
        status: 'PENDENTE',
      })
      sequencia++
    }
  }

  // Criar etapas no banco
  if (etapasParaCriar.length > 0) {
    await prisma.etapaOrdemProducao.createMany({ data: etapasParaCriar })
  }

  return etapasParaCriar.length
}
