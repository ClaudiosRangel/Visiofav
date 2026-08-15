/**
 * Serviço de configuração do WMS Standalone.
 * Gerencia o modo de operação da empresa (ERP_COMPLETO vs WMS_STANDALONE).
 * 
 * REGRA FUNDAMENTAL: quando modoOperacao = 'ERP_COMPLETO', NADA muda no
 * comportamento existente. A config standalone só tem efeito quando
 * explicitamente ativada.
 */

import { prisma } from '../../lib/prisma'

export interface ConfigStandalone {
  modoOperacao: 'ERP_COMPLETO' | 'WMS_STANDALONE'
  integracaoAtiva: boolean
  sistemaExterno: string | null
  urlCallbackErp: string | null
  masterProduto: 'ERP_EXTERNO' | 'WMS' | 'DUAL'
  sincronizacaoEstoque: 'WMS_PARA_ERP' | 'BIDIRECIONAL'
  autenticacaoOperador: 'PIN_TERMINAL' | 'LOGIN_SENHA' | 'SSO_EXTERNO'
  produtoExigeCamposFiscais: boolean
  permiteCriarProdutoUI: boolean
}

const CONFIG_DEFAULT: ConfigStandalone = {
  modoOperacao: 'ERP_COMPLETO',
  integracaoAtiva: false,
  sistemaExterno: null,
  urlCallbackErp: null,
  masterProduto: 'ERP_EXTERNO',
  sincronizacaoEstoque: 'WMS_PARA_ERP',
  autenticacaoOperador: 'PIN_TERMINAL',
  produtoExigeCamposFiscais: false,
  permiteCriarProdutoUI: false,
}

/**
 * Retorna a configuração standalone de uma empresa.
 * Se não existir registro, retorna o default (ERP_COMPLETO, tudo off).
 */
export async function obterConfigStandalone(empresaId: string): Promise<ConfigStandalone> {
  const config = await prisma.configWmsStandalone.findUnique({
    where: { empresaId },
  })

  if (!config) return { ...CONFIG_DEFAULT }

  return {
    modoOperacao: config.modoOperacao as ConfigStandalone['modoOperacao'],
    integracaoAtiva: config.integracaoAtiva,
    sistemaExterno: config.sistemaExterno,
    urlCallbackErp: config.urlCallbackErp,
    masterProduto: config.masterProduto as ConfigStandalone['masterProduto'],
    sincronizacaoEstoque: config.sincronizacaoEstoque as ConfigStandalone['sincronizacaoEstoque'],
    autenticacaoOperador: config.autenticacaoOperador as ConfigStandalone['autenticacaoOperador'],
    produtoExigeCamposFiscais: config.produtoExigeCamposFiscais,
    permiteCriarProdutoUI: config.permiteCriarProdutoUI,
  }
}

/**
 * Verifica se a empresa opera em modo standalone.
 * Atalho usado pelos middlewares para decidir comportamento.
 */
export async function isStandalone(empresaId: string): Promise<boolean> {
  const config = await prisma.configWmsStandalone.findUnique({
    where: { empresaId },
    select: { modoOperacao: true },
  })
  return config?.modoOperacao === 'WMS_STANDALONE'
}

/**
 * Verifica se a integração está ativa para a empresa.
 * Usado pelo apiKeyGuard expandido para bloquear chamadas quando desativada.
 */
export async function isIntegracaoAtiva(empresaId: string): Promise<boolean> {
  const config = await prisma.configWmsStandalone.findUnique({
    where: { empresaId },
    select: { integracaoAtiva: true, modoOperacao: true },
  })
  // Integração só é relevante no modo standalone
  if (!config || config.modoOperacao !== 'WMS_STANDALONE') return false
  return config.integracaoAtiva
}
