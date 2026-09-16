import { prisma } from '../../lib/prisma'
import { proximoNumeroOp, explodirBomParaOp, gerarEtapasOp } from '../ordem-producao/ordem-producao.service'

/**
 * Resultado da geração de OP a partir de um orçamento gráfico.
 */
export interface ResultadoGeracaoOp {
  ordemProducaoId: string
  numero: number
  etapasGeradas: number
  materiaisGerados: number
  origemMateriais: 'BOM' | 'CALCULO' | 'NENHUM'
  avisos: string[]
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
      produtoId: true,
      gramatura: true,
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

  const avisos: string[] = []
  const qtd = Number(orcamento.quantidade)

  // ─── Decidir cenário: Repetição (produto vinculado com BOM) vs Especificação ──
  let estruturaId: string | null = null
  if (orcamento.produtoId) {
    const estrutura = await prisma.estruturaProduto.findFirst({
      where: { empresaId, produtoId: orcamento.produtoId, status: 'ATIVA' },
      select: { id: true },
    })
    if (estrutura) {
      estruturaId = estrutura.id
    } else {
      avisos.push('Produto de repetição não possui estrutura (BOM) ATIVA — materiais estimados pelo cálculo do orçamento.')
    }
  }

  // Criar OrdemProducao (com produto/estrutura no modo repetição)
  const op = await prisma.ordemProducao.create({
    data: {
      empresaId,
      numero,
      produtoId: orcamento.produtoId ?? null,
      estruturaProdutoId: estruturaId ?? undefined,
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

  // ─── Materiais ────────────────────────────────────────────────────────────
  // Cenário B (repetição com BOM): explode a estrutura do produto.
  // Cenário A (especificação): gera materiais a partir do resultadoCalculo.
  let materiaisGerados = 0
  let origemMateriais: 'BOM' | 'CALCULO' | 'NENHUM' = 'NENHUM'
  if (estruturaId && orcamento.produtoId) {
    const bom = await explodirBomParaOp(op.id, estruturaId, qtd, empresaId)
    materiaisGerados = bom.total
    origemMateriais = 'BOM'
  } else {
    materiaisGerados = await gerarMateriaisFromCalculo(
      op.id,
      orcamento.resultadoCalculo as any,
      { papelDescricao: orcamento.papelDescricao, gramatura: orcamento.gramatura ? Number(orcamento.gramatura) : null },
      empresaId,
    )
    origemMateriais = materiaisGerados > 0 ? 'CALCULO' : 'NENHUM'
    if (materiaisGerados === 0) {
      avisos.push('OP gerada sem materiais (orçamento sem resultado de cálculo).')
    }
  }

  // ─── Etapas ──────────────────────────────────────────────────────────────
  // Repetição com roteiro ATIVO usa o roteiro; senão, etapas do cálculo.
  let etapasGeradas = 0
  let usouRoteiro = false
  if (orcamento.produtoId) {
    const roteiro = await prisma.roteiroProducao.findFirst({
      where: { empresaId, produtoId: orcamento.produtoId, status: 'ATIVO' },
      select: { id: true },
    })
    if (roteiro) {
      const r = await gerarEtapasOp(op.id, orcamento.produtoId, qtd, empresaId)
      etapasGeradas = r.total
      usouRoteiro = true
    }
  }
  if (!usouRoteiro) {
    etapasGeradas = await gerarEtapasFromCalculo(
      op.id,
      orcamento.resultadoCalculo as any,
      orcamento.tipoEmbalagem?.processosObrigatorios ?? [],
      empresaId,
    )
  }

  // Log de criação
  await prisma.logOrdemProducao.create({
    data: {
      ordemProducaoId: op.id,
      statusAnterior: '',
      statusNovo: 'PLANEJADA',
      usuarioId: userId,
      observacao: `Gerada a partir do orçamento gráfico #${orcamento.numero} (pedido #${pedidoVendaId.slice(0, 8)}) — materiais: ${origemMateriais}`,
    },
  })

  return {
    ordemProducaoId: op.id,
    numero: op.numero,
    etapasGeradas,
    materiaisGerados,
    origemMateriais,
    avisos,
  }
}

/**
 * Cenário A (Calcgraf): gera ItemOrdemProducao a partir do resultadoCalculo do
 * orçamento — papel (pesoKg), uma tinta por cor (consumoKg) e materiais de
 * acabamento com consumo. São materiais "calculados" pela especificação, sem
 * BOM formal. Retorna a quantidade de itens criados.
 */
async function gerarMateriaisFromCalculo(
  ordemProducaoId: string,
  resultadoCalculo: any,
  papel: { papelDescricao: string | null; gramatura: number | null },
  empresaId?: string,
): Promise<number> {
  if (!resultadoCalculo) return 0

  const itens: Array<{
    ordemProducaoId: string
    empresaId?: string
    descricaoProduto: string
    quantidade: number
    unidadeMedida: string
    tipoMaterial: string
    status: string
  }> = []

  // Papel
  const pesoKg = Number(resultadoCalculo?.papel?.pesoKg ?? 0)
  if (pesoKg > 0) {
    const desc = papel.papelDescricao
      ? papel.papelDescricao
      : `Papel${papel.gramatura ? ' ' + papel.gramatura + 'g' : ''}`
    itens.push({
      ordemProducaoId,
      empresaId,
      descricaoProduto: desc,
      quantidade: Math.round(pesoKg * 10000) / 10000,
      unidadeMedida: 'KG',
      tipoMaterial: 'PAPEL',
      status: 'PENDENTE',
    })
  }

  // Tintas (uma por cor)
  const cores = resultadoCalculo?.tinta?.detalhePorCor
  if (Array.isArray(cores)) {
    for (const c of cores) {
      const consumo = Number(c?.consumoKg ?? 0)
      if (consumo > 0) {
        itens.push({
          ordemProducaoId,
          empresaId,
          descricaoProduto: `Tinta ${c?.cor ?? ''}`.trim(),
          quantidade: Math.round(consumo * 10000) / 10000,
          unidadeMedida: 'KG',
          tipoMaterial: 'TINTA',
          status: 'PENDENTE',
        })
      }
    }
  }

  // Acabamentos com consumo de material (verniz/laminação) — quando houver
  const acabs = resultadoCalculo?.acabamentos?.detalhePorAcabamento
  if (Array.isArray(acabs)) {
    for (const a of acabs) {
      const consumo = Number(a?.consumoKg ?? a?.materialKg ?? 0)
      if (consumo > 0) {
        const tipoUpper = String(a?.tipo ?? '').toUpperCase()
        itens.push({
          ordemProducaoId,
          empresaId,
          descricaoProduto: a?.tipo ?? 'Acabamento',
          quantidade: Math.round(consumo * 10000) / 10000,
          unidadeMedida: 'KG',
          tipoMaterial: tipoUpper.includes('VERNIZ') ? 'VERNIZ' : 'OUTRO',
          status: 'PENDENTE',
        })
      }
    }
  }

  if (itens.length > 0) {
    await prisma.itemOrdemProducao.createMany({ data: itens })
  }
  return itens.length
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
