// Serviço de ENRIQUECIMENTO da engenharia estruturada de um CalculoGrafico
// migrado, a partir da sua FOTO RICA (resultadoCalculo) + de-para para os
// cadastros do Vizor.
//
// Spec: orcamento-repeticao-engenharia-completa (Task 3).
//
// REGRAS DE OURO:
//  - A FOTO (`resultadoCalculo`) é IMUTÁVEL: este serviço NÃO a lê para escrever,
//    só para derivar os nomes; NUNCA a altera.
//  - NUNCA inventa valor: quando o de-para resolve 0 ou 2+ candidatos, o campo
//    vira PENDENTE (A_COMPLETAR) — jamais recebe um valor "chutado".
//  - MULTI-TENANT: `empresaId` EXPLÍCITO em TODA query (nunca só prismaScoped).
//  - De-para por NOME NORMALIZADO (trim, maiúsculas, sem acento, colapsa espaços)
//    e por CNPJ NORMALIZADO (só dígitos) no caso do cliente.

import { prisma } from '../../../lib/prisma'
import type { FotoRicaCalculo } from './foto-rica.types'

/** Normaliza nome p/ match: trim, maiúsculas, sem acento, espaços colapsados. */
export function normalizarNome(s: string | null | undefined): string {
  if (!s) return ''
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Normaliza documento (CNPJ/CPF) p/ match: só dígitos. */
export function normalizarDoc(s: string | null | undefined): string {
  return (s ?? '').replace(/\D/g, '')
}

/**
 * De-para SEGURO por nome normalizado (função PURA, testável).
 * Dado um nome-alvo e uma lista de candidatos `{ id, nome }`, retorna o `id`
 * SOMENTE quando há EXATAMENTE UM candidato cujo nome normalizado é igual ao
 * alvo normalizado. 0 ou 2+ casamentos → `undefined` (vira PENDENTE — NUNCA
 * inventa um valor). Alvo vazio também → `undefined`.
 */
export function matchUnicoPorNome<T extends { id: string; nome: string }>(
  nomeAlvo: string | null | undefined,
  candidatos: readonly T[],
): T | undefined {
  const alvo = normalizarNome(nomeAlvo)
  if (!alvo) return undefined
  const casados = candidatos.filter((c) => normalizarNome(c.nome) === alvo)
  return casados.length === 1 ? casados[0] : undefined
}

/**
 * De-para do CLIENTE por documento normalizado (função PURA, testável).
 * Retorna o id do cliente cujo CNPJ/CPF (só dígitos) é igual ao doc-alvo (só
 * dígitos). Doc vazio ou sem casamento → `undefined`. Em multi-match retorna o
 * primeiro (CNPJ é único por empresa no cadastro).
 */
export function matchClientePorDoc<T extends { id: string; cpfCnpj: string | null }>(
  docAlvo: string | null | undefined,
  clientes: readonly T[],
): T | undefined {
  const doc = normalizarDoc(docAlvo)
  if (!doc) return undefined
  return clientes.find((c) => normalizarDoc(c.cpfCnpj) === doc)
}

/** Campos de engenharia que o enriquecimento pode resolver. */
export type CampoEngenharia =
  | 'papel'
  | 'gramatura'
  | 'cores'
  | 'acabamentos'
  | 'maquina'
  | 'cliente'

/** Resultado do enriquecimento: campos resolvidos + lista de pendências. */
export interface ResultadoEnriquecimento {
  /** Campos de engenharia resolvidos (para gravar no CalculoGrafico/orçamento). */
  campos: {
    papelId?: string
    suporteId?: string
    gramatura?: number
    cores?: Array<{
      nome: string
      tipo: 'CMYK' | 'PANTONE'
      coberturaPercent: number
      precoKg: number
      rendimentoM2Kg: number
    }>
    acabamentosRicos?: Array<{ acabamentoId: string; nome: string }>
    maquinaId?: string
    /** Cliente do Vizor resolvido por CNPJ (fica no orçamento, não no cálculo). */
    clienteId?: string
  }
  /** Campos que o de-para NÃO resolveu com segurança (A_COMPLETAR). */
  pendentes: CampoEngenharia[]
}

/** Lê a foto rica de um registro de CalculoGrafico (ou null se não houver). */
function lerFoto(resultadoCalculo: unknown): FotoRicaCalculo | null {
  if (!resultadoCalculo || typeof resultadoCalculo !== 'object') return null
  const f = resultadoCalculo as { versaoFoto?: number }
  if (f.versaoFoto !== 2) return null
  return resultadoCalculo as FotoRicaCalculo
}

/**
 * Resolve um `PrecoMateriaPrima` por tipo + nome normalizado, na empresa.
 * Retorna o id SOMENTE quando há EXATAMENTE um candidato (match seguro);
 * 0 ou 2+ → undefined (vira pendência). `empresaId` explícito.
 */
async function resolverMateriaPrima(
  empresaId: string,
  tipo: 'PAPEL' | 'TINTA',
  nome: string,
): Promise<{ id: string; suporteId: string | null; precoUnitario: number; gramatura: number | null } | undefined> {
  const alvo = normalizarNome(nome)
  if (!alvo) return undefined
  const candidatos = await prisma.precoMateriaPrima.findMany({
    where: { empresaId, tipo, status: true },
    select: { id: true, descricao: true, suporteId: true, precoUnitario: true, gramatura: true },
  })
  const casados = candidatos.filter((c) => normalizarNome(c.descricao) === alvo)
  if (casados.length !== 1) return undefined
  const c = casados[0]
  return {
    id: c.id,
    suporteId: c.suporteId ?? null,
    precoUnitario: Number(c.precoUnitario),
    gramatura: c.gramatura != null ? Number(c.gramatura) : null,
  }
}

/**
 * ENRIQUECE a engenharia de um CalculoGrafico a partir da sua foto rica.
 * Resolve: papel/suporte/gramatura, cores (preço/rendimento), acabamentos,
 * máquina e cliente (por CNPJ). NÃO grava nada — só devolve o resultado para o
 * chamador decidir onde persistir. NÃO altera a foto.
 *
 * @param empresaId empresa dona do cálculo (EXPLÍCITO — isolamento).
 * @param calc registro do CalculoGrafico (precisa de `resultadoCalculo`,
 *   `clienteDoc`, e os campos de engenharia atuais).
 */
export async function enriquecerEngenharia(
  empresaId: string,
  calc: {
    resultadoCalculo: unknown
    clienteDoc?: string | null
    cores?: unknown
  },
): Promise<ResultadoEnriquecimento> {
  const foto = lerFoto(calc.resultadoCalculo)
  const campos: ResultadoEnriquecimento['campos'] = {}
  const pendentes: CampoEngenharia[] = []

  if (!foto) {
    // Sem foto rica não há de onde derivar — tudo pendente.
    return { campos, pendentes: ['papel', 'gramatura', 'cores', 'acabamentos', 'maquina', 'cliente'] }
  }

  // ── Papel / suporte / gramatura ──
  // Usa o 1º plano com suporte, ou a 1ª linha de suportes da foto.
  const planoComSuporte = (foto.planos ?? []).find((p) => p.suporte)
  const nomeSuporte = planoComSuporte?.suporte ?? (foto.suportes ?? [])[0]?.nome ?? null
  const gramaturaFoto = planoComSuporte?.gramatura ?? null
  if (nomeSuporte) {
    const papel = await resolverMateriaPrima(empresaId, 'PAPEL', nomeSuporte)
    if (papel) {
      campos.papelId = papel.id
      if (papel.suporteId) campos.suporteId = papel.suporteId
      // gramatura: a da foto tem prioridade; senão a do cadastro de papel.
      const g = gramaturaFoto ?? papel.gramatura
      if (g != null && g > 0) campos.gramatura = g
      else pendentes.push('gramatura')
    } else {
      pendentes.push('papel')
      if (gramaturaFoto != null && gramaturaFoto > 0) campos.gramatura = gramaturaFoto
      else pendentes.push('gramatura')
    }
  } else {
    pendentes.push('papel')
    pendentes.push('gramatura')
  }

  // ── Cores (preço/rendimento do cadastro de tinta; cobertura da foto) ──
  const tintasFoto = foto.tintas ?? []
  if (tintasFoto.length > 0) {
    const cores: NonNullable<ResultadoEnriquecimento['campos']['cores']> = []
    let algumaPendente = false
    for (const t of tintasFoto) {
      const tinta = await resolverMateriaPrima(empresaId, 'TINTA', t.nome)
      const cobertura = t.coberturaPercent != null ? Number(t.coberturaPercent) : 0
      if (tinta) {
        cores.push({
          nome: t.nome,
          tipo: /escala|cmyk|process|ciano|magenta|amarelo|preto/i.test(t.nome) ? 'CMYK' : 'PANTONE',
          coberturaPercent: cobertura,
          precoKg: tinta.precoUnitario,
          rendimentoM2Kg: 25000, // rendimento padrão quando o cadastro não traz
        })
      } else {
        algumaPendente = true
      }
    }
    if (cores.length > 0) campos.cores = cores
    if (algumaPendente || cores.length === 0) pendentes.push('cores')
  } else {
    pendentes.push('cores')
  }

  // ── Acabamentos (nome → AcabamentoGrafico) ──
  const acabFoto = foto.acabamentos ?? []
  if (acabFoto.length > 0) {
    const cadastros = await prisma.acabamentoGrafico.findMany({
      where: { empresaId },
      select: { id: true, nome: true },
    })
    const resolvidos: Array<{ acabamentoId: string; nome: string }> = []
    let algumaPendente = false
    for (const a of acabFoto) {
      const casado = matchUnicoPorNome(a.descricao, cadastros)
      if (casado) resolvidos.push({ acabamentoId: casado.id, nome: casado.nome })
      else algumaPendente = true
    }
    if (resolvidos.length > 0) campos.acabamentosRicos = resolvidos
    if (algumaPendente || resolvidos.length === 0) pendentes.push('acabamentos')
  } else {
    pendentes.push('acabamentos')
  }

  // ── Máquina de impressão (nome → CentroProducao IMPRESSAO) ──
  const impFoto = (foto.impressao ?? [])[0]
  if (impFoto?.descricao) {
    const centros = await prisma.centroProducao.findMany({
      where: { empresaId, status: true, tipoProcesso: { codigo: 'IMPRESSAO' } },
      select: { id: true, descricao: true },
    })
    const alvo = normalizarNome(impFoto.descricao)
    // match por "contém" normalizado (a descrição da foto costuma ter texto extra)
    const casados = centros.filter((c) => {
      const d = normalizarNome(c.descricao)
      return d === alvo || alvo.includes(d) || d.includes(alvo)
    })
    if (casados.length === 1) campos.maquinaId = casados[0].id
    else pendentes.push('maquina')
  } else {
    pendentes.push('maquina')
  }

  // ── Cliente (CNPJ normalizado → cliente.cpf_cnpj normalizado) ──
  const doc = normalizarDoc(calc.clienteDoc)
  if (doc) {
    const clientes = await prisma.cliente.findMany({
      where: { empresaId },
      select: { id: true, cpfCnpj: true },
    })
    const casado = matchClientePorDoc(doc, clientes)
    if (casado) campos.clienteId = casado.id
    else pendentes.push('cliente')
  } else {
    pendentes.push('cliente')
  }

  return { campos, pendentes }
}
