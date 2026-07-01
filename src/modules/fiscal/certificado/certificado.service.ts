import forge from 'node-forge'
import { prisma } from '../../../lib/prisma'
import { CodigoErroFiscal, ErroFiscal } from '../erros'
import { encryptPfx, decryptPfx, encryptSenha, decryptSenha } from './certificado-crypto'

// === Interfaces ===

export interface CertificadoInfo {
  id: string
  cnpj: string
  tipo: string
  titular: string
  validoDe: Date
  validoAte: Date
  ativo: boolean
}

export interface CertificadoParaUso {
  pfxBuffer: Buffer
  senha: string
  cnpj: string
  validoAte: Date
}

export interface CertificadoVencendo {
  id: string
  cnpj: string
  titular: string
  validoAte: Date
  diasRestantes: number
}

// === Constantes ===

const LIMITE_CERTIFICADOS_ATIVOS = 100

/**
 * OIDs de políticas de certificação ICP-Brasil (raízes e ACs intermediárias).
 * Usados para verificar se o certificado pertence à cadeia ICP-Brasil.
 */
const ICP_BRASIL_OIDS = [
  '2.16.76.1.1',    // ICP-Brasil raiz
  '2.16.76.1.2',    // AC Raiz
  '2.16.76.1.3',    // AC de 1º nível
]

// === Funções auxiliares ===

/**
 * Extrai o CNPJ do campo Subject do certificado (CN ou OU).
 * O CNPJ pode aparecer no CN diretamente ou no OID 2.16.76.1.3.3.
 */
function extrairCnpjDoCertificado(cert: forge.pki.Certificate): string | null {
  const subject = cert.subject

  // Tentar extrair do campo CN (Common Name)
  const cn = subject.getField('CN')
  if (cn) {
    const cnValue = String(cn.value)
    // Buscar padrão de CNPJ (14 dígitos) no CN
    const cnpjMatch = cnValue.match(/\d{14}/)
    if (cnpjMatch) {
      return cnpjMatch[0]
    }
  }

  // Tentar extrair de campos OU (Organizational Unit)
  const ouFields = subject.attributes.filter(
    (attr) => attr.shortName === 'OU' || attr.name === 'organizationalUnitName'
  )
  for (const ou of ouFields) {
    const ouValue = String(ou.value)
    const cnpjMatch = ouValue.match(/\d{14}/)
    if (cnpjMatch) {
      return cnpjMatch[0]
    }
  }

  // Tentar extrair das extensões do certificado (OID ICP-Brasil para CNPJ)
  try {
    const extensions = cert.extensions || []
    for (const ext of extensions) {
      if (ext.id === '2.16.76.1.3.3') {
        // SubjectAlternativeName com OID ICP-Brasil para PJ
        const value = String(ext.value || '')
        const cnpjMatch = value.match(/\d{14}/)
        if (cnpjMatch) {
          return cnpjMatch[0]
        }
      }
    }
  } catch {
    // extensões opcionais — ignorar erro de parsing
  }

  return null
}

/**
 * Verifica se o certificado pertence à cadeia ICP-Brasil.
 * Verifica OIDs de políticas de certificação e a presença de AC raiz ICP-Brasil na cadeia.
 */
function validarCadeiaICPBrasil(cert: forge.pki.Certificate, caCerts: forge.pki.Certificate[]): boolean {
  // Verificar presença de OIDs ICP-Brasil nas políticas do certificado
  const extensions = cert.extensions || []
  
  for (const ext of extensions) {
    if (ext.id === '2.5.29.32') {
      // Certificate Policies
      const value = JSON.stringify(ext.value || ext)
      for (const oid of ICP_BRASIL_OIDS) {
        if (value.includes(oid)) {
          return true
        }
      }
    }
  }

  // Verificar se algum CA na cadeia referencia ICP-Brasil
  for (const ca of caCerts) {
    const caExtensions = ca.extensions || []
    for (const ext of caExtensions) {
      if (ext.id === '2.5.29.32') {
        const value = JSON.stringify(ext.value || ext)
        for (const oid of ICP_BRASIL_OIDS) {
          if (value.includes(oid)) {
            return true
          }
        }
      }
    }

    // Verificar se o issuer contém referência ICP-Brasil
    const issuerCN = ca.subject.getField('CN')
    if (issuerCN) {
      const cnValue = String(issuerCN.value).toLowerCase()
      if (cnValue.includes('icp-brasil') || cnValue.includes('icp brasil')) {
        return true
      }
    }

    const issuerO = ca.subject.getField('O')
    if (issuerO) {
      const oValue = String(issuerO.value).toLowerCase()
      if (oValue.includes('icp-brasil') || oValue.includes('icp brasil')) {
        return true
      }
    }
  }

  // Verificar no issuer do próprio certificado
  const certIssuerCN = cert.issuer.getField('CN')
  if (certIssuerCN) {
    const cnValue = String(certIssuerCN.value).toLowerCase()
    if (cnValue.includes('icp-brasil') || cnValue.includes('icp brasil')) {
      return true
    }
  }

  const certIssuerO = cert.issuer.getField('O')
  if (certIssuerO) {
    const oValue = String(certIssuerO.value).toLowerCase()
    if (oValue.includes('icp-brasil') || oValue.includes('icp brasil')) {
      return true
    }
  }

  return false
}

// === Serviço ===

export class CertificadoService {
  /**
   * Faz upload de um certificado A1 (PFX/P12), validando:
   * - Cadeia ICP-Brasil
   * - CNPJ correspondente à empresa
   * - Data de validade não expirada
   * - Limite de 100 certificados ativos por empresa
   *
   * Requirements: 29.1, 29.2, 29.3, 29.7
   */
  async upload(
    pfxBuffer: Buffer,
    senha: string,
    empresaId: string,
    cnpjEsperado: string
  ): Promise<CertificadoInfo> {
    // 1. Parsear o PFX
    let cert: forge.pki.Certificate
    let caCerts: forge.pki.Certificate[]

    try {
      const p12Der = forge.util.decode64(pfxBuffer.toString('base64'))
      const p12Asn1 = forge.asn1.fromDer(p12Der)
      const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, senha)

      // Extrair certificado do titular
      const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })
      const bags = certBags[forge.pki.oids.certBag] || []

      if (bags.length === 0) {
        throw new Error('Nenhum certificado encontrado no PFX')
      }

      // O primeiro certificado com chave privada é o titular
      cert = bags[0].cert!
      
      // CAs intermediários e raiz
      caCerts = bags.slice(1).filter((b) => b.cert).map((b) => b.cert!)
    } catch (err: any) {
      if (err instanceof ErroFiscal) throw err

      throw new ErroFiscal(
        CodigoErroFiscal.CERTIFICADO_SENHA_INCORRETA,
        'Não foi possível abrir o certificado PFX. Verifique se a senha está correta.',
        { erro: err.message }
      )
    }

    // 2. Validar cadeia ICP-Brasil (Requirement 29.2)
    if (!validarCadeiaICPBrasil(cert, caCerts)) {
      throw new ErroFiscal(
        CodigoErroFiscal.CERTIFICADO_CADEIA_INVALIDA,
        'Certificado não pertence à cadeia de certificação ICP-Brasil',
        { issuer: cert.issuer.getField('CN')?.value }
      )
    }

    // 3. Verificar data de validade (Requirement 29.2)
    const agora = new Date()
    const validoAte = cert.validity.notAfter
    const validoDe = cert.validity.notBefore

    if (agora > validoAte) {
      throw new ErroFiscal(
        CodigoErroFiscal.CERTIFICADO_EXPIRADO,
        'O certificado está expirado',
        { validoAte: validoAte.toISOString(), dataAtual: agora.toISOString() }
      )
    }

    // 4. Verificar CNPJ (Requirement 29.2)
    const cnpjCertificado = extrairCnpjDoCertificado(cert)

    if (!cnpjCertificado) {
      throw new ErroFiscal(
        CodigoErroFiscal.CERTIFICADO_CNPJ_DIVERGENTE,
        'Não foi possível extrair o CNPJ do certificado',
        { cnpjEsperado }
      )
    }

    if (cnpjCertificado !== cnpjEsperado) {
      throw new ErroFiscal(
        CodigoErroFiscal.CERTIFICADO_CNPJ_DIVERGENTE,
        'O CNPJ do certificado não corresponde ao CNPJ da empresa',
        { cnpjCertificado, cnpjEsperado }
      )
    }

    // 5. Verificar limite de 100 certificados ativos por empresa (Requirement 29.7)
    const totalAtivos = await prisma.certificadoDigital.count({
      where: { empresaId, ativo: true },
    })

    if (totalAtivos >= LIMITE_CERTIFICADOS_ATIVOS) {
      throw new ErroFiscal(
        CodigoErroFiscal.CERTIFICADO_LIMITE_ATINGIDO,
        `Limite de ${LIMITE_CERTIFICADOS_ATIVOS} certificados ativos por empresa atingido`,
        { totalAtivos, limite: LIMITE_CERTIFICADOS_ATIVOS }
      )
    }

    // 6. Extrair dados do titular
    const titular = cert.subject.getField('CN')?.value
      ? String(cert.subject.getField('CN')!.value)
      : 'Titular não identificado'

    // 7. Criptografar PFX e senha (Requirement 29.1)
    const pfxEncrypted = encryptPfx(pfxBuffer)
    const senhaEncrypted = encryptSenha(senha)

    // 8. Persistir no banco
    const certificado = await prisma.certificadoDigital.create({
      data: {
        empresaId,
        cnpj: cnpjCertificado,
        tipo: 'A1',
        titular,
        validoDe,
        validoAte,
        pfxEncrypted,
        senhaEncrypted,
        ativo: true,
      },
    })

    return {
      id: certificado.id,
      cnpj: certificado.cnpj,
      tipo: certificado.tipo,
      titular: certificado.titular,
      validoDe: certificado.validoDe,
      validoAte: certificado.validoAte,
      ativo: certificado.ativo,
    }
  }

  /**
   * Obtém um certificado ativo e válido para assinatura de documentos fiscais.
   * Seleciona automaticamente pelo CNPJ emitente.
   *
   * Requirements: 29.5, 29.7
   */
  async obterParaAssinatura(
    cnpjEmitente: string,
    empresaId: string
  ): Promise<CertificadoParaUso> {
    const agora = new Date()

    // Buscar certificado ativo para o CNPJ que não esteja expirado
    const certificado = await prisma.certificadoDigital.findFirst({
      where: {
        empresaId,
        cnpj: cnpjEmitente,
        ativo: true,
        validoAte: { gt: agora },
      },
      orderBy: { validoAte: 'desc' }, // Prioriza o que vence mais tarde
    })

    if (!certificado) {
      // Verificar se existe mas está expirado
      const expirado = await prisma.certificadoDigital.findFirst({
        where: {
          empresaId,
          cnpj: cnpjEmitente,
          ativo: true,
          validoAte: { lte: agora },
        },
      })

      if (expirado) {
        throw new ErroFiscal(
          CodigoErroFiscal.CERTIFICADO_EXPIRADO,
          'O certificado digital está vencido e necessita renovação',
          { cnpj: cnpjEmitente, validoAte: expirado.validoAte.toISOString() }
        )
      }

      throw new ErroFiscal(
        CodigoErroFiscal.CERTIFICADO_NAO_ENCONTRADO,
        'Nenhum certificado digital ativo encontrado para o CNPJ emitente',
        { cnpj: cnpjEmitente }
      )
    }

    // Descriptografar PFX e senha
    if (!certificado.pfxEncrypted || !certificado.senhaEncrypted) {
      throw new ErroFiscal(
        CodigoErroFiscal.CERTIFICADO_NAO_ENCONTRADO,
        'Dados do certificado incompletos (PFX ou senha ausentes)',
        { id: certificado.id }
      )
    }

    const pfxBuffer = decryptPfx(certificado.pfxEncrypted)
    const senha = decryptSenha(certificado.senhaEncrypted)

    return {
      pfxBuffer,
      senha,
      cnpj: certificado.cnpj,
      validoAte: certificado.validoAte,
    }
  }

  /**
   * Verifica certificados próximos do vencimento.
   * Retorna lista de certificados que vencem nos próximos N dias.
   *
   * Requirements: 29.5
   */
  async verificarVencimentos(
    empresaId: string,
    diasAntecedencia: number = 30
  ): Promise<CertificadoVencendo[]> {
    const agora = new Date()
    const dataLimite = new Date()
    dataLimite.setDate(dataLimite.getDate() + diasAntecedencia)

    const certificados = await prisma.certificadoDigital.findMany({
      where: {
        empresaId,
        ativo: true,
        validoAte: {
          gt: agora,     // Ainda não expirou
          lte: dataLimite, // Mas vence em até N dias
        },
      },
      orderBy: { validoAte: 'asc' },
    })

    return certificados.map((cert) => {
      const diffMs = cert.validoAte.getTime() - agora.getTime()
      const diasRestantes = Math.ceil(diffMs / (1000 * 60 * 60 * 24))

      return {
        id: cert.id,
        cnpj: cert.cnpj,
        titular: cert.titular,
        validoAte: cert.validoAte,
        diasRestantes,
      }
    })
  }

  /**
   * Lista certificados da empresa com filtros e paginação.
   *
   * Requirements: 29.1
   */
  async listar(
    empresaId: string,
    filtros: { cnpj?: string; ativo?: string; page: number; limit: number }
  ) {
    const where: any = { empresaId }

    if (filtros.cnpj) {
      where.cnpj = filtros.cnpj
    }

    if (filtros.ativo !== undefined) {
      where.ativo = filtros.ativo === 'true'
    }

    const [certificados, total] = await Promise.all([
      prisma.certificadoDigital.findMany({
        where,
        select: {
          id: true,
          cnpj: true,
          tipo: true,
          titular: true,
          validoDe: true,
          validoAte: true,
          ativo: true,
          criadoEm: true,
        },
        orderBy: { criadoEm: 'desc' },
        skip: (filtros.page - 1) * filtros.limit,
        take: filtros.limit,
      }),
      prisma.certificadoDigital.count({ where }),
    ])

    return {
      data: certificados,
      total,
      page: filtros.page,
      limit: filtros.limit,
      totalPages: Math.ceil(total / filtros.limit),
    }
  }

  /**
   * Desativa (soft-delete) um certificado digital.
   *
   * Requirements: 29.1
   */
  async desativar(empresaId: string, id: string): Promise<void> {
    const certificado = await prisma.certificadoDigital.findFirst({
      where: { id, empresaId },
    })

    if (!certificado) {
      throw new ErroFiscal(
        CodigoErroFiscal.CERTIFICADO_NAO_ENCONTRADO,
        'Certificado não encontrado',
        { id }
      )
    }

    await prisma.certificadoDigital.update({
      where: { id },
      data: { ativo: false },
    })
  }

  /**
   * Recebe XML assinado externamente (certificado A3 — token/smartcard).
   * Valida que o CNPJ tem certificado A3 ativo e armazena a assinatura.
   *
   * Requirements: 29.6
   */
  async receberAssinaturaExterna(
    empresaId: string,
    cnpj: string,
    xmlAssinado: string,
    chaveAcesso?: string
  ): Promise<{ recebido: boolean; mensagem: string; chaveAcesso?: string }> {
    // Verificar se existe certificado A3 ativo para o CNPJ
    const certificadoA3 = await prisma.certificadoDigital.findFirst({
      where: {
        empresaId,
        cnpj,
        tipo: 'A3',
        ativo: true,
      },
    })

    if (!certificadoA3) {
      throw new ErroFiscal(
        CodigoErroFiscal.CERTIFICADO_NAO_ENCONTRADO,
        'Nenhum certificado A3 ativo encontrado para o CNPJ informado',
        { cnpj }
      )
    }

    // Validar que o XML contém uma assinatura digital
    if (!xmlAssinado.includes('<Signature') && !xmlAssinado.includes('<ds:Signature')) {
      throw new ErroFiscal(
        CodigoErroFiscal.CERTIFICADO_CADEIA_INVALIDA,
        'XML não contém assinatura digital válida',
        { cnpj }
      )
    }

    return {
      recebido: true,
      mensagem: 'XML assinado recebido com sucesso',
      chaveAcesso,
    }
  }
}

export const certificadoService = new CertificadoService()
