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
import { obterConfigBloqueio, determinarDecisaoResolucao } from './config-conferencia-produto.service'
import { criarPendencia } from '../pendencia-cce/pendencia-cce.service'
import { enviarEmailDivergencia } from '../email-fiscal/email-fiscal.service'

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
  | { status: 'pendenciaCriada'; pendenciaId: string }
  | { status: 'emailEnviado' }
  | { status: 'emailFalhou'; motivo: string }
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
    const quantidadeNota = Number(itemNota.quantidade)
    const quantidadeConferida = itemInput.quantidadeConferida
    const quantidadeDivergente = quantidadeConferida !== quantidadeNota

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
    const decisao = determinarDecisaoResolucao(configBloqueio)

    switch (decisao) {
      case 'ACEITAR_SENHA': {
        // Sinalizar necessidade de senha de supervisor (item permanece
        // PENDENTE_SEGUNDA_CONFERENCIA até a autorização ser confirmada)
        resultados.push({
          itemNotaEntradaId: itemInput.itemNotaEntradaId,
          resultado: { status: 'requerSenha' },
        })
        break
      }

      case 'ACEITAR_CCE_PENDENTE': {
        // Determinar valor esperado/conferido para e-mail/pendência
        const valorEsperado =
          tipoDivergencia === 'LOTE'
            ? itemNota.lote ?? ''
            : itemNota.validade?.toISOString() ?? ''
        const valorConferido =
          tipoDivergencia === 'LOTE'
            ? itemInput.lote ?? ''
            : itemInput.validade ?? ''

        // Marca como conferido: a resolução procedural (pendência/e-mail) é
        // o mecanismo de acompanhamento fiscal; o bloqueio de finalização da
        // nota (caso integração ativa) é feito via verificarPendenciasAbertas.
        await prisma.itemNotaEntrada.update({
          where: { id: itemInput.itemNotaEntradaId },
          data: { statusConferencia: 'CONFERIDO' },
        })

        if (integracaoAtiva) {
          const pendencia = await criarPendencia({
            empresaId,
            notaEntradaId: notaId,
            codigoProduto: itemNota.codigoProduto ?? '',
            descricaoProduto: itemNota.descricao,
            fornecedor: nota.fornecedor ?? '',
            tipo: tipoDivergencia,
          })

          resultados.push({
            itemNotaEntradaId: itemInput.itemNotaEntradaId,
            resultado: { status: 'pendenciaCriada', pendenciaId: pendencia.id },
          })
        } else {
          // Enviar e-mail ao setor fiscal — cria divergência para vincular ao e-mail
          const divergencia = await prisma.divergenciaConferencia.create({
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

          const resultadoEmail = await enviarEmailDivergencia({
            divergenciaId: divergencia.id,
            empresaId,
            fornecedor: nota.fornecedor ?? '',
            numeroNF: nota.numero,
            dataEmissao: nota.dataEmissao ?? new Date(),
            descricaoProduto: itemNota.descricao,
            tipoDivergencia: tipoDivergencia,
            valorEsperado,
            valorConferido,
          })

          if (resultadoEmail.sucesso) {
            resultados.push({
              itemNotaEntradaId: itemInput.itemNotaEntradaId,
              resultado: { status: 'emailEnviado' },
            })
          } else {
            resultados.push({
              itemNotaEntradaId: itemInput.itemNotaEntradaId,
              resultado: { status: 'emailFalhou', motivo: resultadoEmail.motivo ?? 'ERRO_DESCONHECIDO' },
            })
          }
        }
        break
      }

      case 'BLOQUEAR': {
        // Bloqueio total — reconferência obrigatória. O item permanece
        // PENDENTE_SEGUNDA_CONFERENCIA (sem trilha de aceite) para que uma
        // nova tentativa seja obrigatória; nunca fica em estado terminal
        // bloqueado sem chance de correção.
        resultados.push({
          itemNotaEntradaId: itemInput.itemNotaEntradaId,
          resultado: { status: 'bloqueado' },
        })
        break
      }
    }
  }

  return { itens: resultados }
}
