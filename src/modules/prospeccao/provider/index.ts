import { ArquivoOficialProvider } from './arquivo-oficial.provider'
import { ProspeccaoProvider } from './prospeccao-provider'

export * from './prospeccao-provider'
export { enriquecerCnpj } from './enriquecimento-api.service'

/**
 * Seleciona o provider da fonte de prospecção. Hoje só há o `arquivoOficial`
 * (base local espelho do dump da Receita). Preparado para plugar outros no
 * futuro via env `PROSPECCAO_PROVIDER` sem mudar rotas/tela.
 */
export function getProspeccaoProvider(): ProspeccaoProvider {
  const modo = process.env.PROSPECCAO_PROVIDER || 'arquivoOficial'
  switch (modo) {
    case 'arquivoOficial':
    default:
      return new ArquivoOficialProvider()
  }
}
