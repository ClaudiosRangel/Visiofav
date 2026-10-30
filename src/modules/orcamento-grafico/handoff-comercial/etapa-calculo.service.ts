/**
 * Etapas do CÁLCULO dentro do orçamento em RASCUNHO (spec comercial-grids-orcamento).
 *
 * O setor de Propostas libera pedidos/solicitações para orçamento; eles entram
 * num grid "A orçar" (orçamentos RASCUNHO com `etapaCalculo = 'AGUARDANDO'`). O
 * calculista ASSUME o cálculo (→ EM_CALCULO), termina e envia para VALIDAÇÃO
 * (→ VALIDAR); o supervisor ASSINA a conferência (→ VALIDADO), liberando o
 * envio da proposta ao cliente.
 *
 * Sub-estado em `OrcamentoGrafico.etapaCalculo` (NÃO altera `status`, que segue
 * RASCUNHO durante todo o cálculo e só vira ENVIADO ao enviar a proposta). null
 * = orçamento avulso/legado, sem fluxo de validação (comporta-se como hoje).
 *
 * Isolamento por `empresaId` EXPLÍCITO em toda query (não confiar só no
 * prismaScoped — bypass SUPER_ADMIN).
 */
import bcrypt from 'bcryptjs'
import { prisma } from '../../../lib/prisma'

export type EtapaCalculo = 'AGUARDANDO' | 'EM_CALCULO' | 'VALIDAR' | 'VALIDADO'

export class EtapaCalculoError extends Error {
  constructor(public statusCode: number, message: string, public code?: string) {
    super(message)
    this.name = 'EtapaCalculoError'
  }
}

// Perfis autorizados a ASSINAR a validação do cálculo (setor de orçamento).
const PERFIS_ASSINATURA = ['ADMIN', 'SUPER_ADMIN', 'SUPERVISOR']

/**
 * Transições válidas da sub-etapa do cálculo. O valor `null` (legado) nunca é
 * exigido como pré-condição — só os orçamentos criados pela liberação do
 * comercial nascem com `AGUARDANDO`.
 */
const TRANSICOES: Record<EtapaCalculo, EtapaCalculo[]> = {
  AGUARDANDO: ['EM_CALCULO'],
  EM_CALCULO: ['VALIDAR', 'AGUARDANDO'], // pode devolver à fila
  VALIDAR: ['VALIDADO', 'EM_CALCULO'], // supervisor assina OU devolve ao calculista
  VALIDADO: ['EM_CALCULO'], // reabrir para ajuste
}

function validarTransicao(atual: EtapaCalculo | null, novo: EtapaCalculo): void {
  // Legado (null): só permite iniciar o fluxo entrando em EM_CALCULO.
  const permitidas = atual ? TRANSICOES[atual] ?? [] : ['EM_CALCULO']
  if (!permitidas.includes(novo)) {
    throw new EtapaCalculoError(
      400,
      `Transição de etapa inválida (${atual ?? 'avulso'} → ${novo}).`,
      'ETAPA_TRANSICAO_INVALIDA',
    )
  }
}

async function carregar(empresaId: string, id: string) {
  const orc = await prisma.orcamentoGrafico.findFirst({
    where: { id, empresaId },
    select: { id: true, status: true, etapaCalculo: true, numero: true },
  })
  if (!orc) throw new EtapaCalculoError(404, 'Orçamento não encontrado')
  if (orc.status !== 'RASCUNHO') {
    throw new EtapaCalculoError(
      400,
      'Só é possível mudar a etapa do cálculo em orçamentos em RASCUNHO.',
      'ORCAMENTO_NAO_RASCUNHO',
    )
  }
  return orc
}

/** AGUARDANDO/legado → EM_CALCULO: o calculista assume o orçamento. */
export async function iniciarCalculo(empresaId: string, id: string, usuarioId: string) {
  const orc = await carregar(empresaId, id)
  validarTransicao((orc.etapaCalculo as EtapaCalculo | null) ?? null, 'EM_CALCULO')
  await prisma.orcamentoGrafico.update({
    where: { id: orc.id },
    data: { etapaCalculo: 'EM_CALCULO' },
  })
  return { id: orc.id, etapaCalculo: 'EM_CALCULO' as const }
}

/** EM_CALCULO → VALIDAR: cálculo pronto, encaminha para conferência/assinatura. */
export async function enviarParaValidacao(empresaId: string, id: string) {
  const orc = await carregar(empresaId, id)
  validarTransicao((orc.etapaCalculo as EtapaCalculo | null) ?? null, 'VALIDAR')
  await prisma.orcamentoGrafico.update({
    where: { id: orc.id },
    data: { etapaCalculo: 'VALIDAR' },
  })
  return { id: orc.id, etapaCalculo: 'VALIDAR' as const }
}

/**
 * VALIDAR → VALIDADO: o supervisor ASSINA a conferência do cálculo (senha do
 * próprio usuário + perfil permitido). Não loga a senha.
 */
export async function assinarValidacao(
  empresaId: string,
  id: string,
  usuarioId: string,
  senha?: string,
) {
  const orc = await carregar(empresaId, id)
  validarTransicao((orc.etapaCalculo as EtapaCalculo | null) ?? null, 'VALIDADO')

  const usuario = await prisma.usuario.findFirst({
    where: { id: usuarioId },
    select: { id: true, nome: true, perfil: true, senha: true },
  })
  if (!usuario) throw new EtapaCalculoError(401, 'Usuário não encontrado')
  if (!usuario.perfil || !PERFIS_ASSINATURA.includes(usuario.perfil)) {
    throw new EtapaCalculoError(403, 'Seu perfil não tem permissão para validar o cálculo.', 'SEM_PERMISSAO_VALIDACAO')
  }
  if (!senha) throw new EtapaCalculoError(401, 'Informe sua senha para assinar a validação.', 'ASSINATURA_REQUERIDA')
  if (!bcrypt.compareSync(senha, usuario.senha)) {
    throw new EtapaCalculoError(401, 'Senha incorreta.', 'ASSINATURA_INVALIDA')
  }

  await prisma.orcamentoGrafico.update({
    where: { id: orc.id },
    data: { etapaCalculo: 'VALIDADO', validadoPorId: usuario.id, validadoEm: new Date() },
  })
  return { id: orc.id, etapaCalculo: 'VALIDADO' as const, validadoPor: usuario.nome }
}

/** VALIDAR → EM_CALCULO ou VALIDADO → EM_CALCULO: devolve/reabre para ajuste. */
export async function reabrirCalculo(empresaId: string, id: string) {
  const orc = await carregar(empresaId, id)
  validarTransicao((orc.etapaCalculo as EtapaCalculo | null) ?? null, 'EM_CALCULO')
  await prisma.orcamentoGrafico.update({
    where: { id: orc.id },
    data: { etapaCalculo: 'EM_CALCULO', validadoPorId: null, validadoEm: null },
  })
  return { id: orc.id, etapaCalculo: 'EM_CALCULO' as const }
}

/**
 * Cancela o orçamento (status RASCUNHO → RECUSADO) com motivo. Se nasceu de uma
 * solicitação do representante, devolve-a (EM_ORCAMENTO → RECUSADA) para o
 * comercial reavaliar. Idempotente por status.
 */
export async function cancelarCalculo(
  empresaId: string,
  id: string,
  usuarioId: string,
  motivo: string,
) {
  const orc = await prisma.orcamentoGrafico.findFirst({
    where: { id, empresaId },
    select: { id: true, status: true },
  })
  if (!orc) throw new EtapaCalculoError(404, 'Orçamento não encontrado')
  if (orc.status !== 'RASCUNHO') {
    throw new EtapaCalculoError(400, 'Só é possível cancelar orçamentos em RASCUNHO.', 'ORCAMENTO_NAO_RASCUNHO')
  }
  if (!motivo || motivo.trim().length < 3) {
    throw new EtapaCalculoError(400, 'Informe o motivo do cancelamento.', 'MOTIVO_OBRIGATORIO')
  }

  await prisma.orcamentoGrafico.update({
    where: { id: orc.id },
    data: { status: 'RECUSADO', etapaCalculo: null, motivoRecusa: motivo.trim() },
  })

  // Devolve a solicitação de origem (se houver) para o comercial.
  await prisma.solicitacaoOrcamentoRep.updateMany({
    where: { orcamentoGraficoId: orc.id, empresaId, status: 'EM_ORCAMENTO' },
    data: { status: 'RECUSADA', motivoRecusa: motivo.trim() },
  })

  return { id: orc.id, status: 'RECUSADO' as const }
}
