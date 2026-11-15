/**
 * Lista fechada de pares de relação permitidos na tabela genérica
 * `RelacaoCadastroGrafico` (design 4.1 e 6.2).
 *
 * Módulo PURO: sem Prisma, sem Fastify. A integridade da relação (ids existentes
 * na mesma empresa) é verificada pelo serviço; aqui só se valida o PAR de tipos.
 */

export const TIPOS_RELACAO = [
  'SUPORTE',
  'ITEM_DIVERSO',
  'PLANO',
  'COBERTURA_TINTA',
  'ATIVIDADE',
  'LINHA',
  'ACONDICIONAMENTO',
  'CENTRO',
  'PRODUTO',
  'TINTA',
  'MATRIZ',
  'MATERIAL',
] as const

export type TipoRelacao = (typeof TIPOS_RELACAO)[number]

export interface ParRelacao {
  readonly origem: TipoRelacao
  readonly destino: TipoRelacao
}

export const PARES_PERMITIDOS: readonly ParRelacao[] = [
  { origem: 'PRODUTO', destino: 'PLANO' },
  { origem: 'PRODUTO', destino: 'ATIVIDADE' },
  { origem: 'PRODUTO', destino: 'ACONDICIONAMENTO' },
  { origem: 'PRODUTO', destino: 'ITEM_DIVERSO' },
  { origem: 'PLANO', destino: 'ATIVIDADE' },
  { origem: 'PLANO', destino: 'COBERTURA_TINTA' },
  { origem: 'PLANO', destino: 'ITEM_DIVERSO' },
  { origem: 'PLANO', destino: 'SUPORTE' },
  { origem: 'ATIVIDADE', destino: 'MATERIAL' },
  { origem: 'ATIVIDADE', destino: 'CENTRO' },
  { origem: 'ATIVIDADE', destino: 'LINHA' },
  { origem: 'ATIVIDADE', destino: 'TINTA' },
  { origem: 'MATRIZ', destino: 'ATIVIDADE' },
  { origem: 'MATRIZ', destino: 'CENTRO' },
  { origem: 'SUPORTE', destino: 'ATIVIDADE' },
  { origem: 'ITEM_DIVERSO', destino: 'ATIVIDADE' },
] as const

export type ResultadoValidacaoPar =
  | { ok: true }
  | { ok: false; mensagem: string; destinosPermitidos: TipoRelacao[] }

/** Guarda de tipo: o valor é um tipo de relação conhecido? */
export function ehTipoRelacao(valor: string): valor is TipoRelacao {
  return (TIPOS_RELACAO as readonly string[]).includes(valor)
}

/** Destinos permitidos para uma origem (vazio se a origem não for conhecida). */
export function destinosPermitidosDe(origem: string): TipoRelacao[] {
  return PARES_PERMITIDOS.filter((p) => p.origem === origem).map((p) => p.destino)
}

/** O par origem → destino está na lista fechada? Tipos desconhecidos retornam false. */
export function parEhPermitido(origem: string, destino: string): boolean {
  return PARES_PERMITIDOS.some((p) => p.origem === origem && p.destino === destino)
}

/** Valida o par e devolve mensagem legível em português quando não permitido. */
export function validarPar(origem: string, destino: string): ResultadoValidacaoPar {
  if (!ehTipoRelacao(origem)) {
    return {
      ok: false,
      mensagem: `Tipo de origem desconhecido: "${origem}". Tipos válidos: ${TIPOS_RELACAO.join(', ')}.`,
      destinosPermitidos: [],
    }
  }
  if (!ehTipoRelacao(destino)) {
    return {
      ok: false,
      mensagem: `Tipo de destino desconhecido: "${destino}". Tipos válidos: ${TIPOS_RELACAO.join(', ')}.`,
      destinosPermitidos: destinosPermitidosDe(origem),
    }
  }
  if (parEhPermitido(origem, destino)) return { ok: true }

  const permitidos = destinosPermitidosDe(origem)
  const mensagem =
    permitidos.length > 0
      ? `Relação ${origem} → ${destino} não é permitida. Destinos permitidos para ${origem}: ${permitidos.join(', ')}.`
      : `Relação ${origem} → ${destino} não é permitida. ${origem} não pode ser origem de nenhuma relação.`
  return { ok: false, mensagem, destinosPermitidos: permitidos }
}
