import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { agenteAuth } from './agente-auth'
import { ingerirOpsCalcgraf } from './ingestao-op-calcgraf.service'
import { OpOrigemDTO } from './ingestao-op-calcgraf.pure'

/**
 * Rota de ingestão de OPs do Calcgraf (agente desktop → Vizor).
 *
 * Tarefa 5 do spec `importador-op-calcgraf`:
 *
 *   POST /api/pcp/ingest-op-calcgraf   (protegida pelo hook `agenteAuth`)
 *
 * A rota é autenticada por **credencial de máquina** (`x-agente-key`), NÃO por
 * JWT de usuário — por isso usa o `preHandler: [agenteAuth]` (que injeta
 * `request.agente = { empresaId, keyId }`) em vez do `authenticate` padrão.
 *
 * Isolamento multi-tenant (Req 6.4 / steering ATENCAO-pontos-verificar.md): a
 * ingestão SEMPRE usa `request.agente.empresaId` (a empresa dona da API key).
 * O `empresaId` NUNCA é aceito do corpo da requisição.
 *
 * Validação (Req 8.4): o payload é validado com Zod. Se for malformado, a rota
 * responde 400 com mensagem clara (campo/motivo) e NÃO processa nada — nenhuma
 * OP é tocada. Só quando o payload inteiro é válido o serviço é chamado.
 *
 * Registrada em `server.ts` com prefixo `/api/pcp` (mesmo ponto da
 * `agente-api-key.routes.ts`), resultando na URL `POST /api/pcp/ingest-op-calcgraf`.
 */

/** Número máximo de OPs por request (evita payload gigante — Req 8). */
const MAX_OPS_POR_REQUEST = 500

/** Versão de schema de payload atualmente aceita. */
const SCHEMA_VERSION_ACEITA = 1

// ---------------------------------------------------------------------------
// Schema Zod do payload — alinhado ao `OpOrigemDTO` de
// `ingestao-op-calcgraf.pure.ts`. Campos opcionais do DTO ficam `.optional()`;
// `numero` e `descricao` são obrigatórios (identidade + conteúdo mínimo).
// ---------------------------------------------------------------------------

const itemSchema = z.object({
  item: z.number().optional(),
  codItemEstoque: z.string().optional(),
  descricao: z.string().optional(),
  quantidade: z.number().optional(),
  unidadeMedida: z.string().optional(),
  status: z.string().optional(),
})

const etapaSchema = z.object({
  sequencia: z.number().optional(),
  centro: z.string().optional(),
  descricao: z.string().optional(),
  status: z.string().optional(),
})

const loteSchema = z.object({
  tiragem: z.number().optional(),
  dataPrometida: z.string().optional(),
  ordemFila: z.number().optional(),
  status: z.string().optional(),
})

const opSchema = z.object({
  numero: z.number({ required_error: 'numero é obrigatório' }).int('numero deve ser inteiro'),
  descricao: z.string({ required_error: 'descricao é obrigatória' }),
  dataEmissao: z.string().optional(),
  produtoNome: z.string().optional(),
  produtoCodigo: z.string().optional(),
  clienteNome: z.string().optional(),
  quantidade: z.number().optional(),
  dataEntrega: z.string().optional(),
  tiragem: z.number().optional(),
  hashOrigem: z.string().optional(),
  itens: z.array(itemSchema).optional(),
  etapas: z.array(etapaSchema).optional(),
  lotes: z.array(loteSchema).optional(),
})

const ingestaoSchema = z.object({
  // Literal 1: versões desconhecidas são rejeitadas com 400 claro (mensagem
  // explícita no `invalid_literal`), permitindo evoluir o payload no futuro.
  schemaVersion: z.literal(SCHEMA_VERSION_ACEITA, {
    errorMap: () => ({
      message: `Versão de schema não suportada. Esperado schemaVersion = ${SCHEMA_VERSION_ACEITA}.`,
    }),
  }),
  ops: z
    .array(opSchema)
    .min(1, 'A lista de OPs (ops) deve conter ao menos 1 item')
    .max(MAX_OPS_POR_REQUEST, `A lista de OPs (ops) excede o limite de ${MAX_OPS_POR_REQUEST} por requisição`),
})

export async function importadorCalcgrafRoutes(app: FastifyInstance) {
  // ===========================================================================
  // POST /api/pcp/ingest-op-calcgraf — recebe o lote de OPs do agente.
  // ===========================================================================
  app.post('/ingest-op-calcgraf', { preHandler: [agenteAuth] }, async (request, reply) => {
    // Validação do payload (Req 8.4). `safeParse` para controlar a resposta de
    // erro: 400 com campo/motivo e SEM processar nada quando malformado.
    const parsed = ingestaoSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({
        message: 'Payload inválido',
        issues: parsed.error.issues.map((i) => ({
          campo: i.path.join('.') || '(raiz)',
          motivo: i.message,
        })),
      })
    }

    // Isolamento multi-tenant: SEMPRE a empresa dona da API key (nunca do body).
    const { empresaId } = request.agente

    const resultados = await ingerirOpsCalcgraf(empresaId, parsed.data.ops as OpOrigemDTO[])

    return reply.status(200).send({
      schemaVersion: SCHEMA_VERSION_ACEITA,
      resultados,
    })
  })
}
