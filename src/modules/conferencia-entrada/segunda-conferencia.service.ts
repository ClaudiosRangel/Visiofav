/**
 * Segunda Conferência Service
 *
 * Lógica de execução da segunda conferência obrigatória.
 * Quando a 1ª conferência detecta divergência de quantidade, e/ou (se o produto
 * exige lote) de lote/validade, o item é marcado PENDENTE_SEGUNDA_CONFERENCIA.
 * Este serviço processa a 2ª (ou enésima, em caso de reconferência) conferência:
 *
 * Regra de quantidade (aplicada sempre, independente de exigeLote):
 * - Se a quantidade confere com a NF-e → segue para avaliação de lote/validade
 * - Se diverge novamente e o operador NÃO sinalizou aceite explícito
 *   (aceitarDivergenciaQuantidade) → retorna 'divergenciaQuantidade', habilitando
 *   no frontend as ações Aceitar com divergência / Rejeitar / Corrigir Contagem
 * - Se diverge e o operador aceitou explicitamente → segue para lote/validade
 *
 * Regra de lote/validade (só avaliada se Produto.exigeLote = true):
 * - Se ambos coincidem com a NF-e → item CONFERIDO
 * - Se algum diverge → decide conforme ConfigConferenciaProduto:
 *   aceitarSenha → 'requerSenha' | aceitarCcePendente → pendência/e-mail conforme
 *   ConfigIntegracao | ambos false → bloqueio total, reconferência obrigatória
 *   (item permanece PENDENTE_SEGUNDA_CONFERENCIA para nova tentativa)
 */

import { prisma } from '../../lib/prisma'
import { obterConfigBloqueio } from './config-conferencia-produto.service'
import { criarPendencia } from '../pendencia-cce/pendencia-cce.service'
import { enviarEmailDivergencia } from '../email-fiscal/email-fiscal.service'
import { avaliarToleranciaQuantidade } from './tolerancia-quantidade.service'

// ─── Tipos ─────────────────────────────────────────────────────────────────────

export interface ItemSegundaConferenciaInput {
  itemNotaEntradaId: string
  quantidadeConferida: number
  lote?: string | null
  validade?: string | null
  /** Operador clicou em "Aceitar com divergência" para a quantidade desta rodada */
  aceitarDivergenciaQuantidade?: boolean
}

export type ResultadoItem =
  | { status: 'resolvido' }
  | { status: 'divergenciaQuantidade'; quantidadeNota: number; quantidadeConferida: number }
  // Divergência de lote/validade confirmada e registrada (DivergenciaConferencia,
  // status PENDENTE) — a notificação fiscal (pendência CC-e ou e-mail) NÃO é
  // disparada aqui. Ela só ocorre quando a nota é efetivamente aprovada
  // (POST /confirmar), para evitar notificar o fiscal de uma divergência que
  // o operador pode abandonar sem aprovar (fechar aba, corrigir contagem,
  // rejeitar a conferência etc.) — ver processarDivergenciasPendentes().
  | { status: 'divergenciaRegistrada'; divergenciaId: string }
  | { status: 'requerSenha' }
  | { status: 'bloqueado' }
  | { status: 'ignorado'; motivo: string }

export interface ResultadoSegundaConferencia {
  itens: Array<{
    itemNotaEntradaId: string
    resultado: ResultadoItem
  }>
}

// ─── Funções auxiliares ────────────────────────────────────────────────────────

/**
 * Normaliza string para comparação: trim e lowercase.
 * Retorna null se valor é nulo/undefined/vazio.
 */
function normalizarString(valor: string | null | undefined): string | null {
  if (valor === null || valor === undefined) return null
  const trimmed = valor.trim()
  return trimmed === '' ? null : trimmed.toLowerCase()
}

/**
 * Compara datas ignorando hora (apenas dia).
 * Retorna true se representam o mesmo dia.
 */
function mesmoDia(d1: Date | null | undefined, d2: Date | string | null | undefined): boolean {
  if (!d1 && !d2) return true
  if (!d1 || !d2) return false

  const date1 = d1 instanceof Date ? d1 : new Date(d1)
  const date2 = d2 instanceof Date ? d2 : new Date(d2)

  if (isNaN(date1.getTime()) || isNaN(date2.getTime())) return false

  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  )
}

/**
 * Parseia uma string de validade (DD/MM/AAAA ou ISO) para Date.
 */
function parsearValidade(valor: string | null | undefined): Date | null {
  if (!valor) return null
  const trimmed = valor.trim()
  if (trimmed === '') return null

  // Formato BR: DD/MM/AAAA
  const brMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
  if (brMatch) {
    const [, dia, mes, ano] = brMatch
    return new Date(Number(ano), Number(mes) - 1, Number(dia))
  }

  // ISO
  const isoDate = new Date(trimmed)
  if (!isNaN(isoDate.getTime())) return isoDate

  return null
}

/**
 * Determina o tipo de divergência com base nos valores divergentes.
 */
function determinarTipoDivergencia(
  loteNfe: string | null,
  loteConferido: string | null,
  validadeNfe: Date | null,
  validadeConferida: Date | null,
): 'LOTE' | 'VALIDADE' {
  const loteNorm = normalizarString(loteNfe)
  const loteConfNorm = normalizarString(loteConferido)

  // Se lote diverge, prioriza LOTE
  if (loteNorm !== loteConfNorm) {
    return 'LOTE'
  }

  return 'VALIDADE'
}

// ─── Serviço principal ─────────────────────────────────────────────────────────

/**
 * Executa a segunda conferência (ou reconferência) para uma nota de entrada.
 *
 * Para cada item submetido, com status PENDENTE_SEGUNDA_CONFERENCIA:
 * 1. Verifica quantidade vs NF-e (item.quantidade, imutável desde a importação):
 *    - Diverge e sem aceite explícito → 'divergenciaQuantidade' (aguarda decisão)
 *    - Diverge com aceite explícito, ou não diverge → segue para o passo 2
 * 2. Se Produto.exigeLote=true, verifica lote/validade vs NF-e (item.lote/validade):
 *    - Coincidem → CONFERIDO
 *    - Divergem → decide conforme ConfigConferenciaProduto (senha/CC-e/bloqueio)
 * 3. Se Produto.exigeLote=false e quantidade resolvida → CONFERIDO
 */
export async function executarSegundaConferencia(
  notaId: string,
  itens: ItemSegundaConferenciaInput[],
  empresaId: string,
  userId: string,
): Promise<ResultadoSegundaConferencia> {
  // 1. Buscar nota com itens
  const nota = await prisma.notaEntrada.findUnique({
    where: { id: notaId },
    include: { itens: true },
  })

  if (!nota) {
    throw new Error(`Nota de entrada ${notaId} não encontrada`)
  }

  // Mapear itens da nota por ID para acesso rápido
  const itensNotaMap = new Map(nota.itens.map((item) => [item.id, item]))

  // 2. Buscar configuração de integração da empresa
  const configIntegracao = await prisma.configIntegracao.findUnique({
    where: { empresaId },
  })

  const integracaoAtiva = configIntegracao?.integracaoAtiva ?? false

  // 3. Processar cada item
  const resultados: ResultadoSegundaConferencia['itens'] = []

  for (const itemInput of itens) {
    const itemNota = itensNotaMap.get(itemInput.itemNotaEntradaId)

    // Item não encontrado na nota
    if (!itemNota) {
      resultados.push({
        itemNotaEntradaId: itemInput.itemNotaEntradaId,
        resultado: { status: 'ignorado', motivo: 'ITEM_NAO_ENCONTRADO' },
      })
      continue
    }

    // Item não está em PENDENTE_SEGUNDA_CONFERENCIA
    if (itemNota.statusConferencia !== 'PENDENTE_SEGUNDA_CONFERENCIA') {
      resultados.push({
        itemNotaEntradaId: itemInput.itemNotaEntradaId,
        resultado: { status: 'ignorado', motivo: 'STATUS_INVALIDO' },
      })
      continue
    }

    // ─── Gate 1: Quantidade (sempre verificada, independente de exigeLote) ────
    // Aplica a mesma tolerância percentual (produto, com fallback para o
    // padrão da empresa) usada na 1ª conferência — evita reexigir decisão
    // manual para um desvio já aceito automaticamente antes.
    const quantidadeNota = Number(itemNota.quantidade)
    const quantidadeConferida = itemInput.quantidadeConferida

    const [produtoTolerancia, empresaTolerancia] = await Promise.all([
      itemNota.codigoProduto
        ? prisma.produto.findFirst({
            where: { empresaId, codigo: itemNota.codigoProduto },
            select: { toleranciaQuantidadePercentual: true },
          })
        : null,
      prisma.empresa.findUnique({
        where: { id: empresaId },
        select: { toleranciaQuantidadePercentualPadrao: true },
      }),
    ])

    const toleranciaProduto = produtoTolerancia?.toleranciaQuantidadePercentual != null
      ? Number(produtoTolerancia.toleranciaQuantidadePercentual) : null
    const toleranciaEmpresa = empresaTolerancia?.toleranciaQuantidadePercentualPadrao != null
      ? Number(empresaTolerancia.toleranciaQuantidadePercentualPadrao) : null

    const avaliacaoTolerancia = avaliarToleranciaQuantidade(
      quantidadeConferida, quantidadeNota, toleranciaProduto, toleranciaEmpresa,
    )

    const quantidadeDivergente = quantidadeConferida !== quantidadeNota && !avaliacaoTolerancia.dentroTolerancia

    if (quantidadeDivergente && !itemInput.aceitarDivergenciaQuantidade) {
      // Divergência de quantidade confirmada na 2ª (ou enésima) conferência —
      // aguarda decisão do operador (aceitar/rejeitar/corrigir), sem avaliar
      // lote/validade ainda. Item permanece PENDENTE_SEGUNDA_CONFERENCIA.
      resultados.push({
        itemNotaEntradaId: itemInput.itemNotaEntradaId,
        resultado: { status: 'divergenciaQuantidade', quantidadeNota, quantidadeConferida },
      })
      continue
    }

    // ─── Gate 2: Lote/Validade — só se o produto exige lote ───────────────────
    const produto = itemNota.codigoProduto
      ? await prisma.produto.findFirst({
          where: { empresaId, codigo: itemNota.codigoProduto },
          select: { id: true, exigeLote: true },
        })
      : null

    if (!produto?.exigeLote) {
      // Produto não exige lote — quantidade resolvida é suficiente
      await prisma.itemNotaEntrada.update({
        where: { id: itemInput.itemNotaEntradaId },
        data: { statusConferencia: 'CONFERIDO' },
      })
      resultados.push({
        itemNotaEntradaId: itemInput.itemNotaEntradaId,
        resultado: { status: 'resolvido' },
      })
      continue
    }

    // Comparar valores da 2ª conferência com NF-e
    const loteNfe = normalizarString(itemNota.lote)
    const loteConferido = normalizarString(itemInput.lote)
    const validadeNfe = itemNota.validade
    const validadeConferida = parsearValidade(itemInput.validade)

    const loteCoincide = loteNfe === loteConferido
    const validadeCoincide = mesmoDia(validadeNfe, validadeConferida)

    // Se valores coincidem com NF-e → auto-resolve
    if (loteCoincide && validadeCoincide) {
      await prisma.itemNotaEntrada.update({
        where: { id: itemInput.itemNotaEntradaId },
        data: { statusConferencia: 'CONFERIDO' },
      })

      resultados.push({
        itemNotaEntradaId: itemInput.itemNotaEntradaId,
        resultado: { status: 'resolvido' },
      })
      continue
    }

    // Divergência confirmada — determinar ação conforme config do produto
    const tipoDivergencia = determinarTipoDivergencia(
      itemNota.lote,
      itemInput.lote ?? null,
      validadeNfe,
      validadeConferida,
    )

    const configBloqueio = await obterConfigBloqueio(empresaId, produto.id)

    // aceitarSenha e aceitarCcePendente são independentes: senha libera a
    // operação (desbloqueia o item para CONFERIDO) e CC-e/e-mail é o
    // rastreamento fiscal da divergência. Quando ambos estão marcados, os
    // dois se aplicam — a divergência é registrada (sem notificar ainda) e a
    // liberação do item depende da autorização de supervisor (endpoint
    // /autorizar-senha), que é o único resultado reportado ao frontend para
    // este item.
    //
    // IMPORTANTE: a notificação fiscal (pendência CC-e ou e-mail) NÃO é
    // disparada aqui — apenas a DivergenciaConferencia é registrada com
    // status PENDENTE. O envio real ocorre em processarDivergenciasPendentes(),
    // chamada só quando a nota é aprovada (POST /confirmar). Antes dessa
    // mudança, o e-mail/pendência era criado no momento da 2ª conferência,
    // mesmo que o operador depois abandonasse a tela, corrigisse a contagem
    // ou rejeitasse a conferência — gerando notificações fiscais para
    // divergências que nunca chegaram a ser efetivamente recebidas.
    if (configBloqueio.aceitarSenha) {
      if (configBloqueio.aceitarCcePendente) {
        await registrarDivergencia({
          empresaId, notaId, itemNota, itemInput, tipoDivergencia, validadeConferida,
        })
      }
      resultados.push({
        itemNotaEntradaId: itemInput.itemNotaEntradaId,
        resultado: { status: 'requerSenha' },
      })
      continue
    }

    if (configBloqueio.aceitarCcePendente) {
      const divergencia = await registrarDivergencia({
        empresaId, notaId, itemNota, itemInput, tipoDivergencia, validadeConferida,
      })
      // Sem senha exigida — a divergência registrada já é suficiente para
      // liberar o item; a notificação fiscal fica pendente para o momento
      // da aprovação da nota.
      await prisma.itemNotaEntrada.update({
        where: { id: itemInput.itemNotaEntradaId },
        data: { statusConferencia: 'CONFERIDO' },
      })
      resultados.push({
        itemNotaEntradaId: itemInput.itemNotaEntradaId,
        resultado: { status: 'divergenciaRegistrada', divergenciaId: divergencia.id },
      })
      continue
    }

    // Nem senha nem CC-e/e-mail habilitados — bloqueio total, reconferência
    // obrigatória. O item permanece PENDENTE_SEGUNDA_CONFERENCIA (sem
    // trilha de aceite) para que uma nova tentativa seja obrigatória.
    resultados.push({
      itemNotaEntradaId: itemInput.itemNotaEntradaId,
      resultado: { status: 'bloqueado' },
    })
  }

  return { itens: resultados }
}

// ─── Registro de divergência (sem notificação imediata) ───────────────────────

interface RegistrarDivergenciaInput {
  empresaId: string
  notaId: string
  itemNota: { id: string; codigoProduto: string | null; descricao: string; lote: string | null; validade: Date | null }
  itemInput: ItemSegundaConferenciaInput
  tipoDivergencia: 'LOTE' | 'VALIDADE'
  validadeConferida: Date | null
}

/**
 * Registra a divergência de lote/validade confirmada como
 * `DivergenciaConferencia` (status PENDENTE), sem disparar pendência CC-e ou
 * e-mail fiscal. A notificação real é feita depois, por
 * `processarDivergenciasPendentes()`, apenas se/quando a nota for aprovada.
 */
async function registrarDivergencia(input: RegistrarDivergenciaInput) {
  const { empresaId, notaId, itemNota, itemInput, tipoDivergencia, validadeConferida } = input

  return prisma.divergenciaConferencia.create({
    data: {
      empresaId,
      notaEntradaId: notaId,
      itemNotaEntradaId: itemInput.itemNotaEntradaId,
      tipo: tipoDivergencia === 'LOTE' ? 'LOTE_DIVERGENTE' : 'VALIDADE_DIVERGENTE',
      loteEsperado: tipoDivergencia === 'LOTE' ? itemNota.lote : null,
      loteConferido: tipoDivergencia === 'LOTE' ? itemInput.lote : null,
      validadeEsperada: tipoDivergencia === 'VALIDADE' ? itemNota.validade : null,
      validadeConferida: tipoDivergencia === 'VALIDADE' ? validadeConferida : null,
      status: 'PENDENTE',
    },
  })
}

// ─── Processamento de divergências pendentes (chamado na aprovação da nota) ───

export interface ResultadoProcessamentoDivergencias {
  pendenciasCriadas: number
  emailsEnviados: number
  emailsFalharam: number
  falhas: Array<{ divergenciaId: string; motivo: string }>
}

/**
 * Processa todas as `DivergenciaConferencia` com status PENDENTE de uma nota,
 * disparando a notificação fiscal (pendência CC-e se `integracaoAtiva`, senão
 * e-mail) — chamada apenas no momento em que a nota é efetivamente aprovada
 * (POST /confirmar/:notaId), nunca durante a segunda conferência em si.
 *
 * Cada divergência processada tem seu status atualizado: `PENDENTE_CCE`
 * (pendência criada), `NOTIFICADO` (e-mail enviado com sucesso) ou
 * `PENDENTE_NOTIFICACAO_FISCAL` (e-mail falhou após retries — precisa
 * reprocessamento manual). Falhas são reportadas ao chamador, nunca
 * descartadas silenciosamente.
 */
export async function processarDivergenciasPendentes(
  notaId: string,
  empresaId: string,
): Promise<ResultadoProcessamentoDivergencias> {
  const resultado: ResultadoProcessamentoDivergencias = {
    pendenciasCriadas: 0,
    emailsEnviados: 0,
    emailsFalharam: 0,
    falhas: [],
  }

  const divergencias = await prisma.divergenciaConferencia.findMany({
    where: { notaEntradaId: notaId, status: 'PENDENTE' },
  })
  if (divergencias.length === 0) return resultado

  const [nota, configIntegracao] = await Promise.all([
    prisma.notaEntrada.findUnique({
      where: { id: notaId },
      select: { fornecedor: true, numero: true, dataEmissao: true },
    }),
    prisma.configIntegracao.findUnique({ where: { empresaId } }),
  ])
  const integracaoAtiva = configIntegracao?.integracaoAtiva ?? false

  for (const divergencia of divergencias) {
    const itemNota = await prisma.itemNotaEntrada.findUnique({
      where: { id: divergencia.itemNotaEntradaId },
      select: { codigoProduto: true, descricao: true },
    })

    const tipoDivergencia: 'LOTE' | 'VALIDADE' = divergencia.tipo === 'LOTE_DIVERGENTE' ? 'LOTE' : 'VALIDADE'
    const valorEsperado = tipoDivergencia === 'LOTE'
      ? divergencia.loteEsperado ?? ''
      : divergencia.validadeEsperada?.toISOString() ?? ''
    const valorConferido = tipoDivergencia === 'LOTE'
      ? divergencia.loteConferido ?? ''
      : divergencia.validadeConferida?.toISOString() ?? ''

    if (integracaoAtiva) {
      await criarPendencia({
        empresaId,
        notaEntradaId: notaId,
        codigoProduto: itemNota?.codigoProduto ?? '',
        descricaoProduto: itemNota?.descricao ?? '',
        fornecedor: nota?.fornecedor ?? '',
        tipo: tipoDivergencia,
      })
      await prisma.divergenciaConferencia.update({
        where: { id: divergencia.id },
        data: { status: 'PENDENTE_CCE' },
      })
      resultado.pendenciasCriadas++
      continue
    }

    // Sem integração — enviar e-mail ao setor fiscal
    const resultadoEmail = await enviarEmailDivergencia({
      divergenciaId: divergencia.id,
      empresaId,
      fornecedor: nota?.fornecedor ?? '',
      numeroNF: nota?.numero ?? 0,
      dataEmissao: nota?.dataEmissao ?? new Date(),
      descricaoProduto: itemNota?.descricao ?? '',
      tipoDivergencia,
      valorEsperado,
      valorConferido,
    })

    if (resultadoEmail.sucesso) {
      resultado.emailsEnviados++
      // enviarEmailDivergencia já atualiza o status para NOTIFICADO em caso de sucesso
    } else {
      resultado.emailsFalharam++
      resultado.falhas.push({ divergenciaId: divergencia.id, motivo: resultadoEmail.motivo ?? 'ERRO_DESCONHECIDO' })
      // enviarEmailDivergencia já atualiza o status para PENDENTE_NOTIFICACAO_FISCAL em caso de falha
    }
  }

  return resultado
}
