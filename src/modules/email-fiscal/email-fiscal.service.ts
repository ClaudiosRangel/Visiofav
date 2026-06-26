import * as nodemailer from 'nodemailer'
import { prisma } from '../../lib/prisma'

// ============================================================================
// Configuração de retry
// ============================================================================

export const RETRY_CONFIG = {
  maxAttempts: 3,
  intervalMs: 10_000, // 10 segundos entre tentativas
  backoff: 'fixed' as const,
}

// ============================================================================
// Tipos
// ============================================================================

export interface DadosEmailDivergencia {
  divergenciaId: string
  empresaId: string
  fornecedor: string
  numeroNF: number
  dataEmissao: Date | string
  descricaoProduto: string
  tipoDivergencia: 'LOTE' | 'VALIDADE'
  valorEsperado: string
  valorConferido: string
}

export interface ResultadoEnvioEmail {
  sucesso: boolean
  motivo?: string
  tentativas?: number
  enviadoEm?: Date
}

// ============================================================================
// Construtor de conteúdo do e-mail (exportado para testabilidade)
// ============================================================================

export function construirConteudoEmail(dados: DadosEmailDivergencia): {
  subject: string
  html: string
} {
  const tipoLabel = dados.tipoDivergencia === 'LOTE' ? 'Lote' : 'Validade'
  const dataFormatada = formatarData(dados.dataEmissao)

  const subject = `Divergência de ${tipoLabel} - NF ${dados.numeroNF} - ${dados.fornecedor}`

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #d32f2f;">Divergência de ${tipoLabel} Detectada</h2>
      <p>Uma divergência de <strong>${tipoLabel.toLowerCase()}</strong> foi confirmada após a segunda conferência obrigatória.</p>
      
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        <tr style="background-color: #f5f5f5;">
          <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Fornecedor</td>
          <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(dados.fornecedor)}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Nº Nota Fiscal</td>
          <td style="padding: 8px; border: 1px solid #ddd;">${dados.numeroNF}</td>
        </tr>
        <tr style="background-color: #f5f5f5;">
          <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Data de Emissão</td>
          <td style="padding: 8px; border: 1px solid #ddd;">${dataFormatada}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Produto</td>
          <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(dados.descricaoProduto)}</td>
        </tr>
        <tr style="background-color: #f5f5f5;">
          <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Tipo de Divergência</td>
          <td style="padding: 8px; border: 1px solid #ddd;">${tipoLabel}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Valor Esperado (NF-e)</td>
          <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(dados.valorEsperado)}</td>
        </tr>
        <tr style="background-color: #ffebee;">
          <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Valor Conferido</td>
          <td style="padding: 8px; border: 1px solid #ddd; color: #d32f2f; font-weight: bold;">${escapeHtml(dados.valorConferido)}</td>
        </tr>
      </table>

      <p>Favor verificar a necessidade de solicitar <strong>CC-e (Carta de Correção Eletrônica)</strong> ao fornecedor.</p>
      <hr style="border: none; border-top: 1px solid #ddd; margin: 16px 0;" />
      <p style="font-size: 12px; color: #666;">E-mail enviado automaticamente pelo WMS VisioFab.</p>
    </div>
  `.trim()

  return { subject, html }
}

// ============================================================================
// Funções auxiliares
// ============================================================================

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatarData(data: Date | string): string {
  const d = typeof data === 'string' ? new Date(data) : data
  if (isNaN(d.getTime())) return String(data)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function criarTransporter() {
  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT) || 587
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS

  if (!host || !user || !pass) {
    return null
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  })
}

// ============================================================================
// Serviço principal
// ============================================================================

export async function enviarEmailDivergencia(dados: DadosEmailDivergencia): Promise<ResultadoEnvioEmail> {
  // 1. Verificar se e-mail fiscal está configurado para a empresa
  const configEmail = await prisma.configEmailFiscal.findUnique({
    where: { empresaId: dados.empresaId },
  })

  if (!configEmail) {
    console.error(
      `[email-fiscal] E-mail fiscal não configurado para empresa ${dados.empresaId}. ` +
      `Divergência ${dados.divergenciaId} não será notificada.`
    )
    return { sucesso: false, motivo: 'EMAIL_FISCAL_NAO_CONFIGURADO' }
  }

  // 2. Verificar se SMTP está configurado
  const transporter = criarTransporter()

  if (!transporter) {
    console.error(
      `[email-fiscal] Configuração SMTP incompleta (SMTP_HOST, SMTP_USER ou SMTP_PASS ausente). ` +
      `Divergência ${dados.divergenciaId} não será notificada.`
    )
    return { sucesso: false, motivo: 'SMTP_NAO_CONFIGURADO' }
  }

  // 3. Montar conteúdo do e-mail
  const { subject, html } = construirConteudoEmail(dados)
  const from = process.env.SMTP_FROM || process.env.SMTP_USER!

  // 4. Enviar com retry (3 tentativas, intervalo fixo de 10s)
  let ultimoErro: Error | null = null

  for (let tentativa = 1; tentativa <= RETRY_CONFIG.maxAttempts; tentativa++) {
    try {
      await transporter.sendMail({
        from,
        to: configEmail.email,
        subject,
        html,
      })

      // Sucesso — registrar timestamp de envio vinculado à divergência
      const enviadoEm = new Date()

      await prisma.divergenciaConferencia.update({
        where: { id: dados.divergenciaId },
        data: { status: 'NOTIFICADO' },
      })

      console.log(
        `[email-fiscal] E-mail enviado com sucesso para ${configEmail.email} ` +
        `(divergência ${dados.divergenciaId}, tentativa ${tentativa})`
      )

      return { sucesso: true, tentativas: tentativa, enviadoEm }
    } catch (error) {
      ultimoErro = error instanceof Error ? error : new Error(String(error))
      console.warn(
        `[email-fiscal] Falha na tentativa ${tentativa}/${RETRY_CONFIG.maxAttempts}: ${ultimoErro.message}`
      )

      // Aguardar antes da próxima tentativa (exceto na última)
      if (tentativa < RETRY_CONFIG.maxAttempts) {
        await sleep(RETRY_CONFIG.intervalMs)
      }
    }
  }

  // 5. Falha após todas as tentativas — marcar como pendente de notificação fiscal
  console.error(
    `[email-fiscal] Falha ao enviar e-mail após ${RETRY_CONFIG.maxAttempts} tentativas. ` +
    `Divergência ${dados.divergenciaId} marcada como pendente de notificação fiscal. ` +
    `Último erro: ${ultimoErro?.message}`
  )

  try {
    await prisma.divergenciaConferencia.update({
      where: { id: dados.divergenciaId },
      data: { status: 'PENDENTE_NOTIFICACAO_FISCAL' },
    })
  } catch (dbError) {
    console.error(
      `[email-fiscal] Erro ao atualizar status da divergência ${dados.divergenciaId}: ` +
      `${dbError instanceof Error ? dbError.message : String(dbError)}`
    )
  }

  return {
    sucesso: false,
    motivo: 'FALHA_ENVIO_APOS_TENTATIVAS',
    tentativas: RETRY_CONFIG.maxAttempts,
  }
}
