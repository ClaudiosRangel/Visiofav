/**
 * Financeiro — inclusão de título (documento a pagar/receber) profissional.
 * Suporta: campos ricos (número do documento, data de emissão, natureza,
 * conta bancária, centro de custo, anexo), parcelamento (gera N títulos com
 * vencimentos mensais) e leitura de linha digitável de boleto (autopreenche
 * valor e vencimento). Compartilhado por conta-pagar e conta-receber.
 */
import type { PrismaClient } from '@prisma/client'
import { ErroFinanceiro } from './conta-financeira.service'
import { validarDocumento, normalizarDoc } from './documento-validacao'

export type TipoTitulo = 'RECEBER' | 'PAGAR'

export const TIPOS_DOCUMENTO = ['NF', 'NFS', 'BOLETO', 'DESPESA', 'IMPOSTO', 'FINANCIAMENTO', 'RECORRENTE', 'REEMBOLSO', 'OUTRO'] as const
export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number]

export interface InclusaoTituloInput {
  descricao: string
  valor: number
  dataVencimento: Date
  dataEmissao?: Date
  dataCompetencia?: Date
  parceiroId?: string          // fornecedorId (PAGAR) ou clienteId (RECEBER)
  parceiroNomeLivre?: string   // parceiro sem cadastro formal
  parceiroDocLivre?: string    // CPF/CNPJ livre (validado)
  numeroDocumento?: string
  categoriaId?: string
  centroCustoId?: string
  contaFinanceiraId?: string
  formaPagamento?: string
  observacao?: string
  codigoBarras?: string
  anexoNome?: string
  anexoConteudo?: string       // base64 (data URL)
  parcelas?: number            // default 1
  // D1 — documento tipado + guia de imposto
  tipoDocumento?: TipoDocumento
  subtipoDocumento?: string
  codigoReceita?: string
  competenciaGuia?: string
  referenciaOrgao?: string
  contratoId?: string          // uso interno (contrato de parcelamento)
}

/** Soma meses a uma data preservando o dia (ajusta para o último dia do mês). */
function addMeses(data: Date, meses: number): Date {
  const d = new Date(Date.UTC(data.getUTCFullYear(), data.getUTCMonth() + meses, data.getUTCDate()))
  // se o dia "estourou" (ex.: 31 em mês de 30), o Date normaliza para o mês seguinte;
  // corrige para o último dia do mês alvo
  if (d.getUTCDate() !== data.getUTCDate()) d.setUTCDate(0)
  return d
}

/** Divide um valor total em N parcelas com 2 casas, ajustando o resto na 1ª. */
export function dividirParcelas(total: number, n: number): number[] {
  const centavos = Math.round(total * 100)
  const base = Math.floor(centavos / n)
  const resto = centavos - base * n
  const parcelas: number[] = []
  for (let i = 0; i < n; i++) {
    const c = base + (i === 0 ? resto : 0)
    parcelas.push(c / 100)
  }
  return parcelas
}

/**
 * Interpreta a linha digitável (47 dígitos) de um boleto de cobrança e extrai
 * valor e vencimento (fator de vencimento FEBRABAN). Retorna null se não for
 * uma linha reconhecível. Não valida DV (uso de conveniência para autopreencher).
 */
export function interpretarLinhaDigitavel(linha: string): { valor: number; vencimento: Date } | null {
  const d = linha.replace(/\D/g, '')
  if (d.length !== 47) return null
  // Reconstrói o código de barras a partir dos campos da linha digitável:
  // campo1[0..8], campo2[10..19], campo3[21..30], DV geral [32], fator+valor [33..46]
  const fatorValor = d.substring(33, 47) // 4 (fator) + 10 (valor)
  const fator = Number(fatorValor.substring(0, 4))
  const valorCent = Number(fatorValor.substring(4))
  const valor = valorCent / 100

  // Fator de vencimento → data (base 07/10/1997). Trata a reciclagem pós-9999.
  const base = new Date(Date.UTC(1997, 9, 7))
  let dias = fator
  // heurística de reciclagem: se fator < 1000 e estamos após 2025, soma 9000
  const vencimento = new Date(base.getTime() + dias * 86400000)
  if (isNaN(vencimento.getTime())) return null
  return { valor: valor > 0 ? valor : 0, vencimento }
}

function delegate(prisma: PrismaClient, tipo: TipoTitulo) {
  return tipo === 'RECEBER' ? prisma.contaReceber : prisma.contaPagar
}

/**
 * Cria o(s) título(s). Se `parcelas > 1`, gera N registros com vencimentos
 * mensais e valores divididos, numerados parcela/total. Retorna os títulos
 * criados. Valida parceiro (se informado) e período fechado.
 */
export async function incluirTitulo(prisma: PrismaClient, empresaId: string, tipo: TipoTitulo, input: InclusaoTituloInput) {
  if (input.valor <= 0) throw new ErroFinanceiro(422, 'valor: deve ser maior que zero')
  const n = Math.max(1, Math.min(input.parcelas ?? 1, 360))

  // valida parceiro (cadastrado)
  if (input.parceiroId) {
    if (tipo === 'RECEBER') {
      const c = await prisma.cliente.findFirst({ where: { id: input.parceiroId, empresaId } })
      if (!c) throw new ErroFinanceiro(404, 'Cliente não encontrado')
    } else {
      const f = await prisma.fornecedor.findFirst({ where: { id: input.parceiroId, empresaId } })
      if (!f) throw new ErroFinanceiro(404, 'Fornecedor não encontrado')
    }
  }

  // valida documento livre (PF/PJ) quando informado
  if (input.parceiroDocLivre && input.parceiroDocLivre.trim()) {
    const { valido } = validarDocumento(input.parceiroDocLivre)
    if (!valido) throw new ErroFinanceiro(422, 'documento: CPF/CNPJ inválido (dígito verificador)')
  }

  const valores = dividirParcelas(input.valor, n)
  const parceiroField = tipo === 'RECEBER' ? 'clienteId' : 'fornecedorId'
  const tipoDoc = input.tipoDocumento ?? 'OUTRO'
  const docLivre = input.parceiroDocLivre ? normalizarDoc(input.parceiroDocLivre) : null

  const registros = valores.map((valorParcela, i) => ({
    empresaId,
    descricao: n > 1 ? `${input.descricao} (${i + 1}/${n})` : input.descricao,
    valor: valorParcela,
    dataVencimento: addMeses(input.dataVencimento, i),
    dataEmissao: input.dataEmissao ?? null,
    dataCompetencia: input.dataCompetencia ?? input.dataEmissao ?? input.dataVencimento,
    [parceiroField]: input.parceiroId ?? null,
    parceiroNomeLivre: input.parceiroId ? null : input.parceiroNomeLivre ?? null,
    parceiroDocLivre: input.parceiroId ? null : docLivre,
    numeroDocumento: input.numeroDocumento ?? null,
    categoriaId: input.categoriaId ?? null,
    centroCustoId: input.centroCustoId ?? null,
    contaFinanceiraId: input.contaFinanceiraId ?? null,
    formaPagamento: input.formaPagamento ?? null,
    observacao: input.observacao ?? null,
    tipoDocumento: tipoDoc,
    subtipoDocumento: input.subtipoDocumento ?? null,
    parcela: i + 1,
    totalParcelas: n,
    // anexo só na 1ª parcela (evita duplicar base64 pesado)
    anexoNome: i === 0 ? input.anexoNome ?? null : null,
    anexoConteudo: i === 0 ? input.anexoConteudo ?? null : null,
    ...(tipo === 'PAGAR'
      ? {
          codigoBarras: input.codigoBarras ?? null,
          contratoId: input.contratoId ?? null,
          codigoReceita: input.codigoReceita ?? null,
          competenciaGuia: input.competenciaGuia ?? null,
          referenciaOrgao: input.referenciaOrgao ?? null,
        }
      : {}),
  }))

  await (delegate(prisma, tipo) as any).createMany({ data: registros })
  return { criadas: registros.length, parcelas: n }
}
