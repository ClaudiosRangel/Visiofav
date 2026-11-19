import { FastifyInstance } from 'fastify'
import { produtosPlanosRoutes } from './produtos-planos.routes'
import { outrosCadastrosRoutes } from './outros-cadastros.routes'
import { catalogoRoutes } from './catalogo.routes'
import { selecaoMaterialRoutes } from './selecao-material.routes'
import { serieDocumentoRoutes } from '../cadastros/serie-documento.routes'

/**
 * Agrega as rotas dos cadastros gráficos (spec orcamento-grafico-cadastros-relacoes).
 * Registrado em server.ts sob /api/orcamento-grafico/cadastros.
 * O catálogo fica sob o mesmo prefixo (/catalogo/...).
 */
export async function cadastrosGraficosRoutes(app: FastifyInstance) {
  await app.register(produtosPlanosRoutes)
  await app.register(outrosCadastrosRoutes)
  await app.register(catalogoRoutes)
  await app.register(selecaoMaterialRoutes)
  await app.register(serieDocumentoRoutes) // /series
}
