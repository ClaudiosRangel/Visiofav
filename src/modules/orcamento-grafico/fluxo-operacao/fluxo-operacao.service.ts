import { prisma } from '../../../lib/prisma'
import {
  OPERACOES,
  FluxoOperacao,
  FluxoOperacaoError,
  Operacao,
  fluxoPadrao,
  validarEtapas,
} from './fluxo-operacao.motor'

/** Fluxo salvo (ou o padrão) de uma operação, com a marca de personalização. */
export interface FluxoComEstado extends FluxoOperacao {
  personalizado: boolean
}

function chave(operacao: Operacao) {
  return `comercial.fluxo.${operacao}`
}

export async function obterFluxo(empresaId: string, operacao: Operacao): Promise<FluxoComEstado> {
  const param = await prisma.parametro.findUnique({
    where: { empresaId_chave: { empresaId, chave: chave(operacao) } },
  })
  if (param?.valor) {
    try {
      const v = validarEtapas(JSON.parse(param.valor))
      if (v.ok) return { operacao, etapas: v.etapas, personalizado: true }
    } catch {
      // valor corrompido: cai no padrão
    }
  }
  return { ...fluxoPadrao(operacao), personalizado: false }
}

export async function listarFluxos(empresaId: string): Promise<FluxoComEstado[]> {
  return Promise.all(OPERACOES.map((op) => obterFluxo(empresaId, op)))
}

export async function salvarFluxo(empresaId: string, operacao: Operacao, etapas: unknown): Promise<FluxoComEstado> {
  const v = validarEtapas(etapas)
  if (!v.ok) {
    throw new FluxoOperacaoError(400, v.erros[0] ?? 'Fluxo inválido.', 'FLUXO_INVALIDO', v.erros)
  }
  const valor = JSON.stringify(v.etapas)
  await prisma.parametro.upsert({
    where: { empresaId_chave: { empresaId, chave: chave(operacao) } },
    create: { empresaId, chave: chave(operacao), valor },
    update: { valor },
  })
  return { operacao, etapas: v.etapas, personalizado: true }
}

export async function restaurarPadrao(empresaId: string, operacao: Operacao): Promise<FluxoComEstado> {
  await prisma.parametro.deleteMany({ where: { empresaId, chave: chave(operacao) } })
  return { ...fluxoPadrao(operacao), personalizado: false }
}
