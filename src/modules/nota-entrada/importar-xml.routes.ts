import { FastifyInstance } from 'fastify'
import { parseNfeXml } from './nfe-xml-parser'

export async function importarXmlRoutes(app: FastifyInstance) {
  app.post('/importar-xml', async (request, reply) => {
    const data = await request.file()
    if (!data) return reply.status(400).send({ message: 'Nenhum arquivo enviado' })

    const buffer = await data.toBuffer()
    const xmlString = buffer.toString('utf-8')

    try {
      const nota = parseNfeXml(xmlString)
      return nota
    } catch (err: any) {
      return reply.status(400).send({ message: 'Erro ao processar XML: ' + err.message })
    }
  })
}
