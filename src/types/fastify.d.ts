import 'fastify'

declare module 'fastify' {
  interface FastifyRequest {
    prismaScoped: any // PrismaClient with extensions
  }
}
