import { z } from 'zod'

/**
 * Configuração centralizada do módulo fiscal.
 *
 * Valida e exporta as variáveis de ambiente obrigatórias e opcionais
 * do módulo fiscal com tipagem forte via Zod.
 *
 * Requirements: 29.1, 30.1
 */

// === Schema de validação ===

const fiscalConfigSchema = z.object({
  /**
   * Chave de criptografia para certificados digitais (PFX em repouso).
   * Mínimo 32 caracteres para garantir AES-256. Obrigatória.
   */
  FISCAL_CERT_ENCRYPTION_KEY: z
    .string({ required_error: 'FISCAL_CERT_ENCRYPTION_KEY é obrigatória' })
    .min(32, 'FISCAL_CERT_ENCRYPTION_KEY deve ter no mínimo 32 caracteres (AES-256)'),

  /**
   * Ambiente SEFAZ: 1 = Produção, 2 = Homologação.
   * Padrão: 2 (homologação) para segurança.
   */
  SEFAZ_AMBIENTE: z
    .enum(['1', '2'], {
      errorMap: () => ({ message: 'SEFAZ_AMBIENTE deve ser 1 (produção) ou 2 (homologação)' }),
    })
    .default('2')
    .transform(Number) as unknown as z.ZodType<1 | 2>,

  /**
   * Timeout em milissegundos para comunicação com a SEFAZ.
   * Padrão: 30000ms. Range válido: 5000–120000ms.
   */
  SEFAZ_TIMEOUT_MS: z
    .string()
    .default('30000')
    .transform(Number)
    .pipe(
      z
        .number()
        .int('SEFAZ_TIMEOUT_MS deve ser inteiro')
        .min(5000, 'SEFAZ_TIMEOUT_MS mínimo é 5000ms')
        .max(120000, 'SEFAZ_TIMEOUT_MS máximo é 120000ms')
    ),

  /**
   * Tamanho máximo da fila de contingência (documentos pendentes).
   * Padrão: 500.
   */
  CONTINGENCIA_MAX_FILA: z
    .string()
    .default('500')
    .transform(Number)
    .pipe(
      z
        .number()
        .int('CONTINGENCIA_MAX_FILA deve ser inteiro')
        .min(1, 'CONTINGENCIA_MAX_FILA deve ser no mínimo 1')
    ),
})

// === Tipo exportado ===

export type FiscalConfig = z.infer<typeof fiscalConfigSchema>

// === Carregamento e validação ===

let _config: FiscalConfig | null = null

/**
 * Carrega e valida as variáveis de ambiente do módulo fiscal.
 * Lança erro detalhado se alguma variável estiver ausente ou inválida.
 *
 * Resultado é cacheado em memória após a primeira chamada bem-sucedida.
 */
export function loadFiscalConfig(): FiscalConfig {
  if (_config) return _config

  const result = fiscalConfigSchema.safeParse({
    FISCAL_CERT_ENCRYPTION_KEY: process.env.FISCAL_CERT_ENCRYPTION_KEY,
    SEFAZ_AMBIENTE: process.env.SEFAZ_AMBIENTE,
    SEFAZ_TIMEOUT_MS: process.env.SEFAZ_TIMEOUT_MS,
    CONTINGENCIA_MAX_FILA: process.env.CONTINGENCIA_MAX_FILA,
  })

  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')

    throw new Error(
      `[Módulo Fiscal] Configuração inválida:\n${errors}\n\nConsulte .env.example para referência.`
    )
  }

  _config = result.data
  return _config
}

/**
 * Retorna a configuração fiscal já carregada.
 * Chama loadFiscalConfig() na primeira invocação.
 */
export function getFiscalConfig(): FiscalConfig {
  return loadFiscalConfig()
}

/**
 * Reseta o cache de configuração (útil para testes).
 */
export function resetFiscalConfig(): void {
  _config = null
}
