/**
 * Financeiro Onda 2 — service de convênio bancário.
 * Credenciais sensíveis (client_secret, certificado PIX) criptografadas com
 * AES-256-GCM (reuso de certificado-crypto). NUNCA retorna credencial em texto.
 */
import type { PrismaClient } from '@prisma/client'
import { ErroFinanceiro } from '../financeiro/conta-financeira.service'
import { encryptSenha, decryptSenha } from '../fiscal/certificado/certificado-crypto'

export interface CriarConvenioInput {
  contaFinanceiraId: string
  tipo: 'BOLETO' | 'PIX' | 'AMBOS'
  banco: string
  agencia: string
  conta: string
  beneficiario: string
  carteira?: string
  codigoConvenio?: string
  chavePix?: string
  psp?: string
  clientId?: string
  clientSecret?: string        // texto — será criptografado
  certificadoPix?: string      // texto/base64 — será criptografado
  webhookSecret?: string
}

/** Remove campos sensíveis do objeto antes de retornar ao cliente. */
function sanitizar(convenio: any) {
  const { clientSecretCriptografado, certificadoPixCriptografado, ...resto } = convenio
  return {
    ...resto,
    proxNossoNumero: convenio.proxNossoNumero != null ? Number(convenio.proxNossoNumero) : 1,
    temClientSecret: Boolean(clientSecretCriptografado),
    temCertificadoPix: Boolean(certificadoPixCriptografado),
  }
}

export async function criarConvenio(prisma: PrismaClient, empresaId: string, input: CriarConvenioInput) {
  const conta = await prisma.contaFinanceira.findFirst({ where: { id: input.contaFinanceiraId, empresaId } })
  if (!conta) throw new ErroFinanceiro(404, 'Conta financeira não encontrada')

  const convenio = await prisma.convenioBancario.create({
    data: {
      empresaId,
      contaFinanceiraId: input.contaFinanceiraId,
      tipo: input.tipo,
      banco: input.banco,
      agencia: input.agencia,
      conta: input.conta,
      beneficiario: input.beneficiario,
      carteira: input.carteira,
      codigoConvenio: input.codigoConvenio,
      chavePix: input.chavePix,
      psp: input.psp,
      clientId: input.clientId,
      clientSecretCriptografado: input.clientSecret ? encryptSenha(input.clientSecret) : null,
      certificadoPixCriptografado: input.certificadoPix ? encryptSenha(input.certificadoPix) : null,
      webhookSecret: input.webhookSecret,
    },
  })
  return sanitizar(convenio)
}

export async function listarConvenios(prisma: PrismaClient, empresaId: string) {
  const convenios = await prisma.convenioBancario.findMany({ where: { empresaId }, orderBy: { criadoEm: 'desc' } })
  return convenios.map(sanitizar)
}

export async function obterConvenio(prisma: PrismaClient, empresaId: string, id: string) {
  const convenio = await prisma.convenioBancario.findFirst({ where: { id, empresaId } })
  if (!convenio) throw new ErroFinanceiro(404, 'Convênio não encontrado')
  return sanitizar(convenio)
}

export async function inativarConvenio(prisma: PrismaClient, empresaId: string, id: string) {
  const convenio = await prisma.convenioBancario.findFirst({ where: { id, empresaId } })
  if (!convenio) throw new ErroFinanceiro(404, 'Convênio não encontrado')
  return sanitizar(await prisma.convenioBancario.update({ where: { id }, data: { status: false } }))
}

/** Uso interno (não HTTP): retorna o convênio COM credenciais decriptadas. */
export async function obterConvenioComCredenciais(prisma: PrismaClient, empresaId: string, id: string) {
  const convenio = await prisma.convenioBancario.findFirst({ where: { id, empresaId } })
  if (!convenio) throw new ErroFinanceiro(404, 'Convênio não encontrado')
  return {
    ...convenio,
    clientSecret: convenio.clientSecretCriptografado ? decryptSenha(convenio.clientSecretCriptografado) : null,
    certificadoPix: convenio.certificadoPixCriptografado ? decryptSenha(convenio.certificadoPixCriptografado) : null,
  }
}
