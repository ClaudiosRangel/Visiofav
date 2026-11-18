import { randomBytes } from 'node:crypto'
import { z, ZodError } from 'zod'
import { prisma } from '../../../lib/prisma'
import { HierarquiaError } from './hierarquia-common'

/**
 * Suporte Não Cadastrado (NC) — spec orcamento-grafico-hierarquia-item-plano, tarefa 9.4 (R12).
 *
 * Cria, numa única `$transaction`, um `SuporteGrafico` + um `PrecoMateriaPrima` PROVISÓRIO
 * (`provisorio = true`) com o `empresaId` do registro pai (a empresa da sessão), vinculados como o
 * resto do sistema vincula papel a suporte: `PrecoMateriaPrima.suporteId` + `gramatura`.
 *
 * Regras:
 *  - empresaId EXPLÍCITO em todo where/data (SUPER_ADMIN não isola pelo prismaScoped);
 *  - duplicata = mesma empresa + mesmo nome (sem caixa/acento) + mesma gramatura → `DUPLICADO`,
 *    sem criar nada; `confirmarExistente: true` devolve `CRIADO` usando o existente (sem criar);
 *  - falha em qualquer passo → rollback total (nenhum suporte órfão sem preço);
 *  - o motor NÃO lê nenhum campo novo (frete, créditos, espessuras...): só `precoUnitario`,
 *    `gramatura` e `coefTinta`, como em qualquer suporte. Não chama `calcularOrcamentoGrafico`.
 */

const MAX_DECIMAL_10_2 = 99_999_999.99

const numeroOpc = (max: number, min = 0) => z.number().min(min).max(max).nullish()

export const suporteNcBodySchema = z.object({
  nome: z.string().trim().min(1, 'obrigatório').max(120, 'máximo de 120 caracteres'),
  gramatura: z.number().min(1, 'mínimo 1').max(2000, 'máximo 2.000'),
  espessuraGm: numeroOpc(999_999),
  espessuraMicras: numeroOpc(10_000),
  formatoLarguraMm: numeroOpc(MAX_DECIMAL_10_2),
  formatoAlturaMm: numeroOpc(MAX_DECIMAL_10_2),
  fibra: z.string().trim().max(40, 'máximo de 40 caracteres').nullish(),
  tiraRetira: z.boolean().nullish(),
  /** Consumo de tinta: id de um suporte existente da empresa cujo `coefTinta`/`tipoSuporte` serão usados. */
  tipoSuporteConsumoTintaId: z.string().uuid().nullish(),
  /** Consumo de tinta informado direto (ignorado quando `tipoSuporteConsumoTintaId` vem preenchido). */
  coefTinta: numeroOpc(100),
  unidadeCustoKg: z.boolean().nullish(),
  unidadeCalculoFl: z.boolean().nullish(),
  custoKg: z.number().min(0.01, 'mínimo 0,01').max(999_999.99, 'máximo 999.999,99'),
  freteKg: numeroOpc(999_999.99),
  pacotesCom: z.number().int('deve ser inteiro').min(0).max(1_000_000).nullish(),
  creditoIcmsPerc: numeroOpc(100),
  creditoIpiPerc: numeroOpc(100),
  confirmarExistente: z.boolean().optional(),
})

export type SuporteNcBody = z.infer<typeof suporteNcBodySchema>

export type SuporteNcResposta =
  | { resultado: 'CRIADO'; suporteId: string; precoId: string; provisorio: boolean }
  | { resultado: 'DUPLICADO'; suporteId: string; nome: string; gramatura: number }

export interface SuporteNcResultadoHttp {
  /** 201 quando criou; 200 para `DUPLICADO` e para `CRIADO` reaproveitando o existente. */
  status: 200 | 201
  corpo: SuporteNcResposta
}

/** Minúsculas, sem acento, espaços colapsados — base da comparação de nomes. */
export function normalizarNome(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Zod → 400 "campo: motivo" (mesmo formato do handler global), com o campo no corpo para o front destacar. */
function validar(corpo: unknown): SuporteNcBody {
  try {
    return suporteNcBodySchema.parse(corpo)
  } catch (err) {
    if (err instanceof ZodError) {
      const primeiro = err.issues[0]
      const campo = primeiro?.path.join('.') || 'corpo'
      throw new HierarquiaError(400, `${campo}: ${primeiro?.message ?? 'valor inválido'}`, {
        campo,
        issues: err.issues.map((i) => ({ campo: i.path.join('.'), motivo: i.message })),
      })
    }
    throw err
  }
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

interface Existente {
  suporteId: string
  precoId: string
  nome: string
  gramatura: number
  provisorio: boolean
}

/**
 * Procura, na empresa, um papel ativo com a mesma gramatura cujo nome (do preço ou do suporte)
 * coincide sem caixa/acento. A gramatura é filtrada no banco; o nome, em memória (o Postgres não
 * normaliza acento sem extensão).
 */
async function buscarDuplicata(tx: Tx, empresaId: string, nome: string, gramatura: number): Promise<Existente | null> {
  const alvo = normalizarNome(nome)
  const precos = await tx.precoMateriaPrima.findMany({
    where: { empresaId, tipo: 'PAPEL', status: true, gramatura, suporteId: { not: null } },
    select: { id: true, descricao: true, suporteId: true, gramatura: true, provisorio: true },
    orderBy: { criadoEm: 'asc' },
  })
  if (precos.length === 0) return null

  const suporteIds = [...new Set(precos.map((p) => p.suporteId as string))]
  const suportes = await tx.suporteGrafico.findMany({
    where: { empresaId, id: { in: suporteIds }, status: true },
    select: { id: true, descricao: true },
  })
  const suportePorId = new Map(suportes.map((s) => [s.id, s]))

  for (const preco of precos) {
    const suporte = suportePorId.get(preco.suporteId as string)
    if (!suporte) continue
    if (normalizarNome(preco.descricao) === alvo || normalizarNome(suporte.descricao) === alvo) {
      return {
        suporteId: suporte.id,
        precoId: preco.id,
        nome: suporte.descricao,
        gramatura: Number(preco.gramatura),
        provisorio: preco.provisorio,
      }
    }
  }
  return null
}

/** Código único por empresa (varchar(30), `@@unique([empresaId, codigo])`). */
function gerarCodigoNc(): string {
  return `NC-${Date.now().toString(36).toUpperCase()}${randomBytes(2).toString('hex').toUpperCase()}`
}

/**
 * Resolve tipo/coeficiente de tinta. Com `tipoSuporteConsumoTintaId`, copia do suporte da MESMA empresa
 * (inexistente ou de outra empresa → 400 idêntico). Sem ele, usa `coefTinta` do corpo ou o default do cadastro.
 */
async function resolverConsumoTinta(tx: Tx, empresaId: string, body: SuporteNcBody) {
  if (body.tipoSuporteConsumoTintaId) {
    const ref = await tx.suporteGrafico.findFirst({
      where: { id: body.tipoSuporteConsumoTintaId, empresaId },
      select: { coefTinta: true, tipoSuporte: true },
    })
    if (!ref) {
      throw new HierarquiaError(400, 'tipoSuporteConsumoTintaId: suporte de referência não encontrado.', {
        campo: 'tipoSuporteConsumoTintaId',
      })
    }
    return { coefTinta: Number(ref.coefTinta), tipoSuporte: ref.tipoSuporte }
  }
  return { coefTinta: body.coefTinta ?? 1.5, tipoSuporte: 'NC' }
}

/**
 * Cria o Suporte NC (ou devolve a duplicata / o existente confirmado).
 * `corpoBruto` é validado aqui (faixas) para a regra valer também fora da rota.
 */
export async function criarSuporteNc(empresaId: string, corpoBruto: unknown): Promise<SuporteNcResultadoHttp> {
  const body = validar(corpoBruto)
  const nome = body.nome

  return prisma.$transaction(async (tx) => {
    const existente = await buscarDuplicata(tx, empresaId, nome, body.gramatura)

    if (existente) {
      if (body.confirmarExistente) {
        return {
          status: 200 as const,
          corpo: {
            resultado: 'CRIADO' as const,
            suporteId: existente.suporteId,
            precoId: existente.precoId,
            provisorio: existente.provisorio,
          },
        }
      }
      return {
        status: 200 as const,
        corpo: {
          resultado: 'DUPLICADO' as const,
          suporteId: existente.suporteId,
          nome: existente.nome,
          gramatura: existente.gramatura,
        },
      }
    }

    const consumo = await resolverConsumoTinta(tx, empresaId, body)

    const suporte = await tx.suporteGrafico.create({
      data: {
        empresaId,
        codigo: gerarCodigoNc(),
        descricao: nome,
        tipoSuporte: consumo.tipoSuporte,
        coefTinta: consumo.coefTinta,
        gramaturas: String(body.gramatura),
        espessuraGm: body.espessuraGm ?? null,
        espessuraMicras: body.espessuraMicras ?? null,
        formatoLarguraMm: body.formatoLarguraMm ?? null,
        formatoAlturaMm: body.formatoAlturaMm ?? null,
        fibra: body.fibra || null,
        tiraRetira: body.tiraRetira ?? null,
        unidadeCustoKg: body.unidadeCustoKg ?? null,
        unidadeCalculoFl: body.unidadeCalculoFl ?? null,
        pacotesCom: body.pacotesCom ?? null,
      },
      select: { id: true },
    })

    const preco = await tx.precoMateriaPrima.create({
      data: {
        empresaId,
        descricao: nome,
        tipo: 'PAPEL',
        unidade: 'KG',
        precoUnitario: body.custoKg,
        suporteId: suporte.id,
        gramatura: body.gramatura,
        provisorio: true,
        freteKg: body.freteKg ?? null,
        creditoIcmsPerc: body.creditoIcmsPerc ?? null,
        creditoIpiPerc: body.creditoIpiPerc ?? null,
      },
      select: { id: true },
    })

    return {
      status: 201 as const,
      corpo: { resultado: 'CRIADO' as const, suporteId: suporte.id, precoId: preco.id, provisorio: true },
    }
  })
}
