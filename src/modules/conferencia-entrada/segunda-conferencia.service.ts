/**
 * Segunda Conferência Service
 *
 * Lógica de execução da segunda conferência obrigatória.
 * Quando a 1ª conferência detecta divergência de lote/validade, o item é marcado
 * PENDENTE_SEGUNDA_CONFERENCIA. Este serviço processa a 2ª conferência:
 * - Se valores coincidem com NF-e → auto-resolve (CONFERIDO)
 * - Se divergem → divergência confirmada → decisão conforme config do produto
 *
 * Requirements: 8.3, 8.4, 8.5, 8.6, 8.7
 */

import { prisma } from '../../lib/prisma'
import { obterConfigBloqueio, determinarDecisaoResolucao } from './config-conferencia-produto.service'
import { criarPendencia } from '../pendencia-cce/pendencia-cce.service'
import { enviarEmailDivergencia } from '../email-fiscal/email-fiscal.service'

// ─── Tipos ─────────────────────────────────────────────────────────────────────

export interface ItemSegundaConferenciaInput {
  itemNotaEntradaId: string
  lote?: string | null
  validade?: string | null
}

export type ResultadoItem =
  | { status: 'resolvido' }
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
 * Executa a segunda conferência para uma nota de entrada.
 *
 * Para cada item submetido:
 * 1. Verifica que está em PENDENTE_SEGUNDA_CONFERENCIA
 * 2. Compara lote/validade com NF-e (do ItemNotaEntrada)
 * 3. Se match → auto-resolve → CONFERIDO
 * 4. Se diverge → verifica ConfigConferenciaProduto → decide ação
 *
 * Requirements: 8.3, 8.4, 8.5, 8.6, 8.7
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

    // 3a. Comparar valores da 2ª conferência com NF-e
    const loteNfe = normalizarString(itemNota.lote)
    const loteConferido = normalizarString(itemInput.lote)
    const validadeNfe = itemNota.validade
    const validadeConferida = parsearValidade(itemInput.validade)

    const loteCoincide = loteNfe === loteConferido
    const validadeCoincide = mesmoDia(validadeNfe, validadeConferida)

    // 3b. Se valores coincidem com NF-e → auto-resolve
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

    // 3c. Divergência confirmada — determinar ação
    const tipoDivergencia = determinarTipoDivergencia(
      itemNota.lote,
      itemInput.lote ?? null,
      validadeNfe,
      validadeConferida,
    )

    // Obter config de bloqueio do produto
    const produtoId = itemNota.codigoProduto
    if (!produtoId) {
      // Sem produtoId, não conseguimos buscar config — tratar como bloqueio total
      await prisma.itemNotaEntrada.update({
        where: { id: itemInput.itemNotaEntradaId },
        data: { statusConferencia: 'DIVERGENCIA_CONFIRMADA' },
      })

      resultados.push({
        itemNotaEntradaId: itemInput.itemNotaEntradaId,
        resultado: { status: 'bloqueado' },
      })
      continue
    }

    const configBloqueio = await obterConfigBloqueio(empresaId, produtoId)
    const decisao = determinarDecisaoResolucao(configBloqueio)

    // 3d. Ação conforme decisão
    switch (decisao) {
      case 'ACEITAR_SENHA': {
        // Sinalizar necessidade de senha de supervisor (antes de pendência/email)
        resultados.push({
          itemNotaEntradaId: itemInput.itemNotaEntradaId,
          resultado: { status: 'requerSenha' },
        })
        break
      }

      case 'ACEITAR_CCE_PENDENTE': {
        // Marcar item como divergência confirmada
        await prisma.itemNotaEntrada.update({
          where: { id: itemInput.itemNotaEntradaId },
          data: { statusConferencia: 'DIVERGENCIA_CONFIRMADA' },
        })

        // Determinar valor esperado/conferido para e-mail
        const valorEsperado =
          tipoDivergencia === 'LOTE'
            ? itemNota.lote ?? ''
            : itemNota.validade?.toISOString() ?? ''
        const valorConferido =
          tipoDivergencia === 'LOTE'
            ? itemInput.lote ?? ''
            : itemInput.validade ?? ''

        if (integracaoAtiva) {
          // Criar pendência CC-e
          const pendencia = await criarPendencia({
            empresaId,
            notaEntradaId: notaId,
            codigoProduto: produtoId,
            descricaoProduto: itemNota.descricao,
            fornecedor: nota.fornecedor ?? '',
            tipo: tipoDivergencia,
          })

          resultados.push({
            itemNotaEntradaId: itemInput.itemNotaEntradaId,
            resultado: { status: 'pendenciaCriada', pendenciaId: pendencia.id },
          })
        } else {
          // Enviar e-mail ao setor fiscal
          // Primeiro, criar/buscar divergência para vincular ao e-mail
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
        // Bloqueio total — reconferência obrigatória, sem ação além de marcar
        await prisma.itemNotaEntrada.update({
          where: { id: itemInput.itemNotaEntradaId },
          data: { statusConferencia: 'DIVERGENCIA_CONFIRMADA' },
        })

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
