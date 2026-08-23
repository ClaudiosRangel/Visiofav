import { prisma } from '../../../lib/prisma'
import { PortalRepUser } from '../auth/portal-rep-auth.middleware'

/**
 * Serviço de auditoria do Portal do Representante.
 *
 * Fornece uma função reutilizável para registro de logs de auditoria
 * em `LogAuditoriaRep`. Pode ser chamada a partir de qualquer módulo
 * do portal para registrar ações relevantes.
 *
 * Ações típicas:
 * - LOGIN / LOGIN_FALHOU / BLOQUEIO
 * - SOLICITACAO_CRIADA / SOLICITACAO_CANCELADA
 * - CLIENTE_CADASTRADO / ALTERACAO_FISCAL_SOLICITADA
 * - ACESSO_NEGADO
 *
 * Requirements: 7.1, 7.4
 */

// ─── Interface de entrada ───────────────────────────────────────────────────────

interface RegistrarLogInput {
  acao: string
  detalhes: string
  portalRepUser: Pick<PortalRepUser, 'empresaId' | 'representanteId'> | null
  ip?: string
  /** Se portalRepUser for null (ex: login falhado com email desconhecido), usar empresaId avulso */
  empresaIdOverride?: string
}

// ─── Função principal ───────────────────────────────────────────────────────────

/**
 * Registra um log de auditoria em `LogAuditoriaRep`.
 *
 * @param acao - Identificador da ação (ex: 'LOGIN', 'SOLICITACAO_CRIADA')
 * @param detalhes - Descrição legível da ação
 * @param portalRepUser - Dados do representante autenticado (ou null para ações sem autenticação)
 * @param ip - Endereço IP do request (opcional)
 *
 * Requirement 7.4: registrar login, tentativa de acesso negado e ações relevantes.
 */
export async function registrarLog(
  acao: string,
  detalhes: string,
  portalRepUser: Pick<PortalRepUser, 'empresaId' | 'representanteId'> | null,
  ip?: string,
): Promise<void> {
  await prisma.logAuditoriaRep.create({
    data: {
      empresaId: portalRepUser?.empresaId ?? '',
      representanteId: portalRepUser?.representanteId ?? null,
      acao,
      detalhes,
      ip: ip || null,
    },
  })
}

/**
 * Registra log com empresaId explícito (para cenários sem representante autenticado,
 * como tentativa de login com email inexistente onde ainda sabemos o empresaId).
 */
export async function registrarLogComEmpresa(
  acao: string,
  detalhes: string,
  empresaId: string,
  representanteId: string | null,
  ip?: string,
): Promise<void> {
  await prisma.logAuditoriaRep.create({
    data: {
      empresaId,
      representanteId,
      acao,
      detalhes,
      ip: ip || null,
    },
  })
}

// ─── Validação de isolamento multi-tenant ───────────────────────────────────────
//
// REVISÃO DE ISOLAMENTO — Todos os módulos do portal verificados:
//
// ✅ portal-rep-auth.middleware.ts
//    - Verifica JWT scope === 'portal-rep'
//    - Busca RepresentanteCredencial com filtro { id: representanteId, empresaId }
//    - Popular request.portalRepUser garante empresaId+vendedorId em todas rotas
//
// ✅ portal-rep-auth.service.ts (login, trocarSenha, refreshToken)
//    - login: filtra por { empresaId, email } (unique constraint)
//    - trocarSenha: filtra por { id: representanteId, empresaId }
//    - refreshToken: filtra por { id, empresaId }
//    - Todos os logs de auditoria usam empresaId do contexto
//
// ✅ portal-rep-solicitacao.service.ts
//    - criarSolicitacao: extrai { empresaId, vendedorId } do portalRepUser;
//      valida cliente na carteira com { id, empresaId, vendedorId };
//      cria registro com empresaId + vendedorId do token
//    - listarSolicitacoes: where { empresaId, vendedorId }
//    - obterSolicitacao: where { id, empresaId, vendedorId }
//    - cancelarSolicitacao: where { id, empresaId, vendedorId }
//
// ✅ portal-rep-pipeline.service.ts
//    - listarPipeline: filtra PedidoVenda por { empresaId, vendedorId };
//      filtra OrdemProducao por { empresaId, pedidoVendaId in [...] }
//    - detalhePipeline: filtra PedidoVenda por { id, empresaId, vendedorId };
//      filtra OrdemProducao por { empresaId, pedidoVendaId }
//
// ✅ portal-rep-comissao.service.ts
//    - resumoPorPeriodo: filtra PedidoVenda por { empresaId, vendedorId }
//    - detalhamentoComissoes: filtra PedidoVenda por { empresaId, vendedorId }
//    - calcularComissaoPedido: usa empresaId + vendedorId para buscar Vendedor e RegraComissao
//    - obterCriterioCredimento / obterTipoComissao: filtram Parametro por { empresaId }
//
// ✅ portal-rep-clientes.service.ts
//    - listarCarteira: filtra Cliente por { empresaId, vendedorId }
//    - cadastrarCliente: cria Cliente com empresaId; valida unicidade CPF/CNPJ por empresa
//    - editarDadosComplementares: filtra Cliente por { id, empresaId, vendedorId }
//    - solicitarAlteracaoFiscal: filtra Cliente por { id, empresaId, vendedorId }
//
// ✅ portal-rep-notificacao.service.ts
//    - criarNotificacao: grava com empresaId + representanteId explícitos
//    - listarNotificacoes: filtra por { empresaId, representanteId }
//    - marcarComoLida: filtra por { id, empresaId, representanteId }
//    - marcarTodasComoLidas: filtra por { empresaId, representanteId }
//    - contarNaoLidas: filtra por { empresaId, representanteId }
//
// ✅ portal-rep-auth.routes.ts (rotas públicas)
//    - POST /login: recebe empresaId no body; não retorna dados de outras empresas
//    - POST /trocar-senha: protegida por middleware (empresaId do token)
//    - POST /refresh: valida refresh token vinculado ao representanteId/empresaId
//
// CONCLUSÃO: Todas as rotas do portal filtram corretamente por empresaId + vendedorId
// (ou empresaId + representanteId quando vendedorId não é aplicável ao recurso).
// Nenhuma query permite acesso cross-tenant ou cross-vendedor.
//
// Requirement 7.1: ✅ Isolamento multi-tenant completo confirmado.
