/**
 * Funções de sincronização dos dados de transporte extraídos do XML de NF-e
 * com a AgendaWms.
 *
 * A parte pura (sem I/O) fica no topo do arquivo (`normalizarPlaca`,
 * `calcularAtualizacaoTransporte`) — a parte de I/O (`sincronizarDadosTransporte`)
 * fica ao final, reaproveitando essas funções puras.
 */

import type { PrismaClient } from '@prisma/client'
import { extrairBlocoTransporte, type DadosTransporteXml } from '../nota-entrada/transporte-xml-parser'

type PrismaTransaction = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]

export interface AgendaTransporteAtual {
  placa: string | null
  motorista: string | null
  tipoVeiculo: string | null
}

export interface ResultadoSincronizacao {
  placa?: string
  motorista?: string
  tipoVeiculo?: string
  divergenciaTransporte?: string // texto <=500 chars, só quando há conflito de placa
}

/** Normaliza placa para comparação: uppercase, remove espaços e hífens */
export function normalizarPlaca(placa: string): string {
  return placa.toUpperCase().replace(/[\s-]/g, '')
}

/**
 * Função pura: dado o estado atual da Agenda e os dados extraídos do XML,
 * decide quais campos preencher e se há divergência de placa a registrar.
 * Não faz I/O — usada tanto pelo fluxo XML→Agenda quanto Agenda→XML.
 */
export function calcularAtualizacaoTransporte(
  atual: AgendaTransporteAtual,
  extraido: DadosTransporteXml,
): ResultadoSincronizacao {
  const resultado: ResultadoSincronizacao = {}

  if (extraido.motorista && !atual.motorista) {
    resultado.motorista = extraido.motorista.slice(0, 100)
  }

  if (extraido.placa) {
    if (!atual.placa) {
      resultado.placa = extraido.placa
    } else if (normalizarPlaca(atual.placa) !== normalizarPlaca(extraido.placa)) {
      resultado.divergenciaTransporte =
        `placa: XML="${extraido.placa}" em ${new Date().toISOString()}`.slice(0, 500)
    }
  }

  return resultado
}

// ─── I/O ─────────────────────────────────────────────────────────────────────

/**
 * Sincroniza os dados de transporte entre a `NotaEntrada` mais recente e a
 * `AgendaWms` mais recente vinculadas ao mesmo `pedidoCompraId`/`fornecedorId`,
 * dentro de uma Empresa.
 *
 * Sincronização bidirecional (Requirement 1.4): esta função é chamada tanto
 * quando uma `NotaEntrada` é criada a partir do XML (a Agenda pode já existir)
 * quanto quando uma `AgendaWms` é criada/vinculada a um pedido/fornecedor
 * (a Nota pode já existir).
 *
 * Não faz nada (idempotente, sem lançar erro) quando:
 * - `Empresa.usaWms` é falsa (Requirement 1.5);
 * - a `AgendaWms` vinculada ainda não existe;
 * - a `NotaEntrada` com dados de transporte ainda não existe.
 *
 * A `NotaEntrada` não armazena `placa`/`motorista` (apenas `transportadoraUf`/
 * `transportadoraRntc`) — esses dois campos não são reconciliados aqui por não
 * existirem no schema da Nota; apenas `tipoVeiculo` (derivado da UF do veículo,
 * quando disponível) participa da atualização junto da divergência de placa
 * (que só é avaliada quando a própria Agenda já tem uma placa preenchida
 * manualmente e o XML original dessa mesma sincronização também trouxe uma
 * placa — cenário tratado nos pontos de chamada que têm acesso ao XML).
 */
export async function sincronizarDadosTransporte(
  tx: PrismaTransaction,
  empresaId: string,
  opts: {
    pedidoCompraId?: string | null
    fornecedorId?: string | null
    /**
     * Dados de transporte já extraídos do XML (via `extrairBlocoTransporte`),
     * quando disponíveis no ponto de chamada (ex.: importação de XML em
     * `compra.routes.ts`). Quando informado, tem prioridade sobre a busca
     * por `NotaEntrada` abaixo — permite propagar `placa`/`motorista`, que
     * não são persistidos em `NotaEntrada` (apenas `transportadoraUf`/
     * `transportadoraRntc`).
     */
    transporteExtraido?: DadosTransporteXml
  },
): Promise<void> {
  const { pedidoCompraId, fornecedorId, transporteExtraido } = opts
  if (!pedidoCompraId && !fornecedorId) return

  const empresa = await tx.empresa.findUnique({
    where: { id: empresaId },
    select: { usaWms: true },
  })
  if (!empresa?.usaWms) return

  const agenda = await tx.agendaWms.findFirst({
    where: {
      empresaId,
      OR: [
        ...(pedidoCompraId ? [{ pedidoCompraId }] : []),
        ...(fornecedorId ? [{ fornecedorId }] : []),
      ],
    },
    orderBy: { criadoEm: 'desc' },
  })
  if (!agenda) return

  let extraido: DadosTransporteXml | null = null

  if (transporteExtraido) {
    extraido = transporteExtraido
  } else {
    // Fallback 1: `CompraEfetivada.xmlNfe` — cobre o cenário em que a Agenda
    // é criada (manualmente ou via `POST /agenda-wms`) ANTES de a NotaEntrada
    // existir. `compra.routes.ts` nunca cria `NotaEntrada` diretamente (só
    // persiste o XML em `CompraEfetivada.xmlNfe`); a `NotaEntrada` só passa a
    // existir quando a Agenda atinge NA_DOCA/CONFERINDO (agenda-wms.routes.ts,
    // agenda.service.ts, portaria.routes.ts). Sem este fallback, uma Agenda
    // ainda em AGENDADO/CONFIRMADO nunca recebia placa/motorista do XML já
    // importado, mesmo com o XML disponível em CompraEfetivada.
    const pedidoIdBusca = pedidoCompraId ?? agenda.pedidoCompraId
    const idFornecedorBusca = fornecedorId ?? agenda.fornecedorId

    const compra = await tx.compraEfetivada.findFirst({
      where: {
        xmlNfe: { not: null },
        OR: [
          ...(pedidoIdBusca ? [{ pedidoCompraId: pedidoIdBusca }] : []),
          ...(idFornecedorBusca ? [{ pedidoCompra: { fornecedorId: idFornecedorBusca } }] : []),
        ],
      },
      orderBy: { criadoEm: 'desc' },
      select: { xmlNfe: true },
    })

    if (compra?.xmlNfe) {
      extraido = extrairBlocoTransporte(compra.xmlNfe)
    } else {
      // Fallback 2: `NotaEntrada.transportadoraUf`/`transportadoraRntc` — cobre
      // o cenário inverso (Nota já criada, mas sem CompraEfetivada.xmlNfe
      // acessível, ex. fluxos legados). NotaEntrada não armazena placa/motorista.
      let fornecedorDoc: string | null = null
      if (idFornecedorBusca) {
        const forn = await tx.fornecedor.findUnique({
          where: { id: idFornecedorBusca },
          select: { cnpj: true },
        })
        fornecedorDoc = forn?.cnpj ?? null
      }

      // NotaEntrada não possui `pedidoCompraId` no schema — a única forma de
      // vincular a uma Agenda é pelo documento do fornecedor.
      if (fornecedorDoc) {
        const nota = await tx.notaEntrada.findFirst({
          where: {
            fornecedorDoc,
            OR: [{ transportadoraUf: { not: null } }, { transportadoraRntc: { not: null } }],
          },
          orderBy: { criadoEm: 'desc' },
        })

        if (nota) {
          extraido = {
            placa: null,
            ufVeiculo: nota.transportadoraUf ?? null,
            rntc: nota.transportadoraRntc ?? null,
            motorista: null,
          }
        }
      }
    }
  }

  if (!extraido) return

  const atual = {
    placa: agenda.placa,
    motorista: agenda.motorista,
    tipoVeiculo: agenda.tipoVeiculo,
  }

  const resultado = calcularAtualizacaoTransporte(atual, extraido)

  if (Object.keys(resultado).length === 0) return

  await tx.agendaWms.update({
    where: { id: agenda.id },
    data: {
      ...(resultado.placa !== undefined && { placa: resultado.placa }),
      ...(resultado.motorista !== undefined && { motorista: resultado.motorista }),
      ...(resultado.tipoVeiculo !== undefined && { tipoVeiculo: resultado.tipoVeiculo }),
      ...(resultado.divergenciaTransporte !== undefined && {
        divergenciaTransporte: resultado.divergenciaTransporte,
      }),
    },
  })
}
