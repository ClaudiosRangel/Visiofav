import { prisma } from '../../lib/prisma'
import { calcularConsumoPlana, calcularConsumoRotativa, ResultadoCalculo } from '../pcp/calculo-consumo-grafico.service'

/**
 * Transições de status válidas para Ordem de Produção.
 */
const TRANSICOES_VALIDAS: Record<string, string[]> = {
  RASCUNHO: ['PLANEJADA', 'CANCELADA'],
  PLANEJADA: ['PROGRAMADA', 'CANCELADA'],
  PROGRAMADA: ['LIBERADA', 'CANCELADA'],
  LIBERADA: ['EM_PRODUCAO', 'CANCELADA'],
  EM_PRODUCAO: ['CONCLUIDA'],
  CONCLUIDA: [],
  CANCELADA: [],
}

export function validarTransicaoStatus(statusAtual: string, statusNovo: string): boolean {
  const permitidos = TRANSICOES_VALIDAS[statusAtual]
  if (!permitidos) return false
  return permitidos.includes(statusNovo)
}

export function getTransicoesPermitidas(statusAtual: string): string[] {
  return TRANSICOES_VALIDAS[statusAtual] || []
}

/**
 * Gera o próximo número sequencial de OP para a empresa.
 */
export async function proximoNumeroOp(empresaId: string): Promise<number> {
  const ultima = await prisma.ordemProducao.findFirst({
    where: { empresaId },
    orderBy: { numero: 'desc' },
    select: { numero: true },
  })
  return (ultima?.numero ?? 0) + 1
}

/**
 * Explode a BOM e gera os itens da OP.
 */
export async function explodirBomParaOp(
  ordemProducaoId: string,
  estruturaProdutoId: string,
  quantidadeOp: number,
  empresaId: string,
) {
  const estrutura = await prisma.estruturaProduto.findFirst({
    where: { id: estruturaProdutoId, empresaId },
    include: { itens: { orderBy: { sequencia: 'asc' } } },
  })

  if (!estrutura || estrutura.itens.length === 0) {
    return { itens: [], total: 0 }
  }

  const fatorBase = quantidadeOp / Number(estrutura.rendimento)
  const itensParaCriar: Array<{
    ordemProducaoId: string
    produtoComponenteId: string
    descricaoProduto: string
    quantidade: number
    unidadeMedida: string
  }> = []

  // Explosão de primeiro nível (para OP, usamos nível direto)
  for (const item of estrutura.itens) {
    const qtdNecessaria = Number(item.quantidadeLiquida) * fatorBase

    const produto = await prisma.produto.findFirst({
      where: { id: item.produtoComponenteId, empresaId },
      select: { codigo: true, nome: true },
    })

    itensParaCriar.push({
      ordemProducaoId,
      produtoComponenteId: item.produtoComponenteId,
      descricaoProduto: produto ? `${produto.codigo} - ${produto.nome}` : item.produtoComponenteId,
      quantidade: Math.round(qtdNecessaria * 10000) / 10000,
      unidadeMedida: item.unidadeMedida,
    })
  }

  // Cria todos os itens
  if (itensParaCriar.length > 0) {
    await prisma.itemOrdemProducao.createMany({ data: itensParaCriar })
  }

  return { itens: itensParaCriar, total: itensParaCriar.length }
}

/**
 * Gera as etapas da OP a partir do roteiro ativo.
 */
export async function gerarEtapasOp(
  ordemProducaoId: string,
  produtoId: string,
  quantidadeOp: number,
  empresaId: string,
) {
  const roteiro = await prisma.roteiroProducao.findFirst({
    where: { empresaId, produtoId, status: 'ATIVO' },
    include: { etapas: { orderBy: { sequencia: 'asc' } } },
  })

  if (!roteiro || roteiro.etapas.length === 0) {
    return { etapas: [], total: 0 }
  }

  const etapasParaCriar = roteiro.etapas.map((etapa) => ({
    ordemProducaoId,
    sequencia: etapa.sequencia,
    descricao: etapa.descricao,
    centroProducaoId: etapa.centroProducaoId,
    tempoSetupMinutos: Number(etapa.tempoSetupMinutos),
    tempoOperacaoCalculado: Math.round(Number(etapa.tempoOperacaoMinutos) * quantidadeOp * 100) / 100,
    tempoEsperaMinutos: Number(etapa.tempoEsperaMinutos),
    recursoId: etapa.recursoId,
    status: 'PENDENTE',
  }))

  await prisma.etapaOrdemProducao.createMany({ data: etapasParaCriar })

  return { etapas: etapasParaCriar, total: etapasParaCriar.length }
}


// ============================================================================
// CÁLCULO AUTOMÁTICO DE CONSUMO GRÁFICO
// ============================================================================

export interface ConsumoGraficoCalculado {
  tipo: 'PLANA' | 'ROTATIVA' | 'NAO_APLICAVEL'
  folhasFisicas: number | null
  metrosLineares: number | null
  pesoTotalKg: number | null
  detalhamento: any
}

/**
 * Detecta o tipo de insumo principal da BOM e calcula o consumo teórico.
 * Chamado automaticamente após a criação da OP.
 *
 * Fluxo:
 * 1. Busca os itens da BOM explodida
 * 2. Identifica se o insumo principal é bobina ou papel plano
 * 3. Busca parâmetros do produto (gramatura, largura, etc.) via AtributoGrafico
 * 4. Executa o cálculo correspondente
 * 5. Retorna resultado para salvar na OP
 */
export async function calcularConsumoAutomatico(
  ordemProducaoId: string,
  produtoId: string,
  quantidadeOp: number,
  empresaId: string,
): Promise<ConsumoGraficoCalculado> {
  // Busca atributos gráficos do produto
  const atributo = await prisma.atributoGrafico.findUnique({
    where: { empresaId_produtoId: { empresaId, produtoId } },
  })

  // Busca dados do produto principal
  const produto = await prisma.produto.findFirst({
    where: { id: produtoId, empresaId },
    select: { nome: true, codigo: true, unidade: true },
  })

  if (!atributo) {
    return { tipo: 'NAO_APLICAVEL', folhasFisicas: null, metrosLineares: null, pesoTotalKg: null, detalhamento: { motivo: 'Produto sem atributos gráficos cadastrados' } }
  }

  // Busca gramatura do atributo gráfico
  let gramaturaGm2 = 0
  if (atributo.tipoGramaturaId) {
    const gramatura = await prisma.tipoGramatura.findFirst({
      where: { id: atributo.tipoGramaturaId, empresaId },
    })
    if (gramatura) gramaturaGm2 = Number(gramatura.valorGm2)
  }

  // Busca formato (largura x altura)
  let larguraMm = 0
  let alturaMm = 0
  if (atributo.tipoFormatoId) {
    const formato = await prisma.tipoFormato.findFirst({
      where: { id: atributo.tipoFormatoId, empresaId },
    })
    if (formato) {
      larguraMm = formato.larguraMm
      alturaMm = formato.alturaMm
    }
  }

  if (gramaturaGm2 <= 0) {
    return { tipo: 'NAO_APLICAVEL', folhasFisicas: null, metrosLineares: null, pesoTotalKg: null, detalhamento: { motivo: 'Gramatura não cadastrada no atributo gráfico' } }
  }

  // Detecta tipo pelo nome do produto ou unidade
  const nomeLower = (produto?.nome || '').toLowerCase()
  const isBobina = nomeLower.includes('bobina') || nomeLower.includes('rotativ') || nomeLower.includes('rolo') || nomeLower.includes('flexo')

  if (isBobina) {
    // Cálculo ROTATIVA — usa valores padrão se não informados
    // Valores padrão razoáveis para gráfica
    const repeticaoCorteMm = 250 // passo padrão
    const produtosPorPuxada = 1  // conservador
    const metrosAcertoFixo = 50  // padrão de mercado

    try {
      const resultado = calcularConsumoRotativa({
        tipo: 'ROTATIVA',
        qtdPedida: quantidadeOp,
        repeticaoCorteMm,
        produtosPorPuxada,
        metrosAcertoFixo,
        larguraBobinaMm: larguraMm > 0 ? larguraMm : 1000, // default 1m
        gramaturaGm2,
      })

      return {
        tipo: 'ROTATIVA',
        folhasFisicas: null,
        metrosLineares: resultado.metrosLineares,
        pesoTotalKg: resultado.pesoTotalKg,
        detalhamento: resultado.detalhamento,
      }
    } catch {
      return { tipo: 'ROTATIVA', folhasFisicas: null, metrosLineares: null, pesoTotalKg: null, detalhamento: { motivo: 'Erro no cálculo rotativa' } }
    }
  } else {
    // Cálculo PLANA — usa formato cadastrado
    if (larguraMm <= 0 || alturaMm <= 0) {
      return { tipo: 'NAO_APLICAVEL', folhasFisicas: null, metrosLineares: null, pesoTotalKg: null, detalhamento: { motivo: 'Formato (largura/altura) não cadastrado' } }
    }

    // Aproveitamento padrão: 1 produto por folha (conservador — pode ser ajustado na OP)
    const aproveitamento = 1
    const percentualPerda = 10 // 10% padrão

    try {
      const resultado = calcularConsumoPlana({
        tipo: 'PLANA',
        qtdPedida: quantidadeOp,
        aproveitamento,
        percentualPerda,
        larguraFolhaMm: larguraMm,
        comprimentoFolhaMm: alturaMm,
        gramaturaGm2,
      })

      return {
        tipo: 'PLANA',
        folhasFisicas: resultado.folhasFisicas,
        metrosLineares: null,
        pesoTotalKg: resultado.pesoTotalKg,
        detalhamento: resultado.detalhamento,
      }
    } catch {
      return { tipo: 'PLANA', folhasFisicas: null, metrosLineares: null, pesoTotalKg: null, detalhamento: { motivo: 'Erro no cálculo plana' } }
    }
  }
}
