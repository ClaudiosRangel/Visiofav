import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'

/**
 * Configuração de visibilidade dos itens do menu do WMS, por empresa.
 *
 * Persistida na tabela genérica `Parametro` (chave `wms.menusDesabilitados`),
 * valor = JSON de `string[]` com os ids desabilitados. O id de um item é o seu
 * `href` (ex.: `/wms/inventario`); o id de um grupo é `grupo:<label>`.
 *
 * Um item/grupo cujo id está na lista SOME do menu (filtrado no frontend,
 * `ModuleSidebar` → `filtrarEntriesWms`). Sem configuração salva → lista vazia
 * (menu completo, backward-compatible).
 */

const CHAVE = 'wms.menusDesabilitados'

/**
 * Href da própria tela de Configuração de Menus. NUNCA pode ser desabilitado —
 * senão o admin ficaria sem como reconfigurar o menu (estado sem saída).
 */
export const MENU_CONFIG_PROTEGIDO = '/wms/configuracoes/menus'

const putSchema = z.object({
  menusDesabilitados: z.array(z.string()),
})

/**
 * Lê a lista de menus desabilitados de uma empresa. Retorna `[]` quando não há
 * configuração salva ou quando `empresaId` é ausente (leitura sem contexto de
 * empresa → comportamento padrão, menu completo).
 */
export async function getMenusDesabilitados(empresaId: string | null | undefined): Promise<string[]> {
  if (!empresaId) return []
  const param = await prisma.parametro.findUnique({
    where: { empresaId_chave: { empresaId, chave: CHAVE } },
  })
  if (!param?.valor) return []
  try {
    const parsed = JSON.parse(param.valor)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export async function wmsConfigMenusRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // GET /wms/config-menus — leitura (qualquer usuário do módulo WMS; o menu
  // precisa dela para decidir o que exibir).
  app.get('/config-menus', async (request) => {
    const user = request.user as { empresaId?: string }
    const menusDesabilitados = await getMenusDesabilitados(user.empresaId)
    return { menusDesabilitados }
  })

  // PUT /wms/config-menus — escrita (somente ADMIN/SUPER_ADMIN).
  app.put('/config-menus', async (request, reply) => {
    const user = request.user as { empresaId?: string; perfil?: string }
    if (!user.empresaId) {
      return reply.status(403).send({ message: 'Usuário sem empresa vinculada' })
    }
    if (!['ADMIN', 'SUPER_ADMIN'].includes(user.perfil ?? '')) {
      return reply.status(403).send({ message: 'Somente administradores podem configurar os menus do WMS' })
    }

    const body = putSchema.parse(request.body)
    // Salvaguarda: o item de Configuração de Menus nunca pode ser desabilitado
    // (evita deixar o admin sem como reverter). Removido antes de persistir.
    const lista = Array.from(new Set(body.menusDesabilitados.filter((id) => id !== MENU_CONFIG_PROTEGIDO)))

    await prisma.parametro.upsert({
      where: { empresaId_chave: { empresaId: user.empresaId, chave: CHAVE } },
      create: { empresaId: user.empresaId, chave: CHAVE, valor: JSON.stringify(lista) },
      update: { valor: JSON.stringify(lista) },
    })

    return { menusDesabilitados: lista }
  })
}
