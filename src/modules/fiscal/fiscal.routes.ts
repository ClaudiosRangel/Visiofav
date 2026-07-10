import { FastifyInstance } from 'fastify'
import { authenticate } from '../../middleware/authenticate'
import { registrarAuditoriaFiscalHook } from './auditoria/auditoria-middleware'
import { motorTributarioRoutes } from './motor-tributario/motor-tributario.routes'
import { certificadoRoutes } from './certificado/certificado.routes'
import { emissorDfeRoutes } from './emissor-dfe/emissor-dfe.routes'
import { contingenciaRoutes } from './contingencia/contingencia.routes'
import { spedRoutes } from './sped/sped.routes'
import { apuracaoRoutes } from './apuracao/apuracao.routes'
import { ncmRoutes } from './cadastros/ncm.routes'
import { cstCsosnRoutes } from './cadastros/cst-csosn.routes'
import { naturezaOperacaoRoutes } from './cadastros/natureza-operacao.routes'
import { cfopRoutes } from './cadastros/cfop.routes'
import { cestRoutes } from './cadastros/cest.routes'
import { seedFiscalRoutes } from './seed-fiscal/seed-fiscal.routes'
import { gnreRoutes } from './gnre/gnre.routes'
import { importacaoXmlRoutes } from './importacao/importacao-xml.routes'
import { distribuicaoDfeRoutes } from './distribuicao-dfe/distribuicao-dfe.routes'

export async function fiscalRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // Registrar hook de auditoria fiscal para operações de escrita (Req 37.1, 37.2)
  registrarAuditoriaFiscalHook(app)

  // Health check do módulo fiscal
  app.get('/status', async () => {
    return { modulo: 'fiscal', status: 'ativo' }
  })

  // Motor Tributário
  app.register(motorTributarioRoutes, { prefix: '/motor-tributario' })

  // Certificado Digital
  app.register(certificadoRoutes, { prefix: '/certificados' })

  // Emissor DFe (NF-e, NFC-e, CT-e, MDF-e, NFS-e, Manifesto)
  app.register(emissorDfeRoutes, { prefix: '/' })

  // Contingência
  app.register(contingenciaRoutes, { prefix: '/contingencia' })

  // SPED (EFD ICMS/IPI, Contribuições, ECD, ECF, Reinf)
  app.register(spedRoutes, { prefix: '/sped' })

  // Apuração de Impostos (ICMS, ICMS-ST, PIS/COFINS, IPI)
  app.register(apuracaoRoutes, { prefix: '/apuracao' })

  // Cadastros Fiscais (NCM, CST/CSOSN, Natureza de Operação, CFOP, CEST)
  app.register(ncmRoutes, { prefix: '/cadastros' })
  app.register(cstCsosnRoutes, { prefix: '/cadastros' })
  app.register(naturezaOperacaoRoutes, { prefix: '/cadastros' })
  app.register(cfopRoutes, { prefix: '/cadastros' })
  app.register(cestRoutes, { prefix: '/cadastros' })

  // Seed administrativo de Cadastros Fiscais (NCM/CFOP/CEST), restrito a ADMIN (Req 3.1)
  app.register(seedFiscalRoutes, { prefix: '/cadastros/seed' })

  // GNRE (Guia Nacional de Recolhimento de Tributos Estaduais)
  app.register(gnreRoutes, { prefix: '/' })

  // Importação de XML (upload, listagem, geração de entrada)
  app.register(importacaoXmlRoutes, { prefix: '/importacao' })

  // Distribuição DFe (verificar/baixar NF-e/CT-e emitidas contra o CNPJ da empresa)
  app.register(distribuicaoDfeRoutes, { prefix: '/distribuicao-dfe' })
}
