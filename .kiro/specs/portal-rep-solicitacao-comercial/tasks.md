# Tarefas — Solicitação de Orçamento do Representante coordenada pelo Comercial

- [x] 1. Schema + migração idempotente
  - Adicionar em `SolicitacaoOrcamentoRep` (`prisma/schema.prisma`) os campos:
    `enviadaOrcamentoEm/PorId`, `precificadaEm/PorId`, `liberadaPedidoEm/PorId`,
    `convertidaPedidoEm`, `pedidoVendaId`, `motivoRecusa` (todos opcionais).
  - Atualizar `prisma/migrate-prod.ts` com `ADD COLUMN IF NOT EXISTS` para cada
    campo + `UPDATE` de mapeamento de status legados (CALCULADO→PRECIFICADA,
    ENVIADO→CONVERTIDA, RECUSADO→RECUSADA).
  - Rodar `npx prisma migrate dev` (referência) e `npx tsx prisma/migrate-prod.ts`
    2x local (idempotente).
  - _Requirements: 5.1, 5.2, 5.3_

- [x] 2. Máquina de estados (backend)
  - Criar função pura de validação de transição (mapa
    `TRANSICOES_VALIDAS`) em `admin/portal-rep-admin.service.ts` (ou util
    dedicado) + `transicionarSolicitacao(...)` como ponto único de gravação de
    status e carimbos de auditoria.
  - Testes unitários (Vitest) cobrindo transições válidas e amostra de inválidas.
  - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.7_

- [x] 3. Correção do cliente na criação
  - Em `solicitacao/portal-rep-solicitacao.service.ts` (`criarSolicitacao`):
    quando `clienteId` presente, gravar `clienteNome` a partir do
    `cliente.nomeFantasia || cliente.razaoSocial` já buscado.
  - Teste de serviço.
  - _Requirements: 1.1_

- [x] 4. Correção do cliente na listagem
  - Em `admin/portal-rep-admin.service.ts` (`listarSolicitacoesAdmin`): incluir
    relação `cliente { razaoSocial, nomeFantasia }` no select e retornar
    `clienteNomeExibicao = clienteNome || cliente?.nomeFantasia ||
    cliente?.razaoSocial || null`. Confirmar isolamento por `empresaId`.
  - _Requirements: 1.2, 1.3, 1.4_

- [x] 5. Rotas de transição (backend)
  - Em `admin/portal-rep-admin.routes.ts`, adicionar:
    `POST /:id/enviar-orcamento`, `POST /:id/liberar-pedido`,
    `POST /:id/recusar` (com `motivoRecusa`).
  - Ajustar `/calcular` (exige EM_ORCAMENTO → grava PRECIFICADA) e
    `/converter-pedido` (exige LIBERADA_PEDIDO → grava CONVERTIDA + pedidoVendaId).
  - Guard de autorização (ADMIN/SUPER_ADMIN) + `verificarPerfilComercial` como
    ponto de extensão.
  - _Requirements: 2.3, 2.4, 2.5, 2.6, 2.7, 3.1, 3.2, 4.1, 4.2_

- [x] 6. Frontend — status e hooks
  - Atualizar `data/hooks/portal-representante/types.ts`: novos status em
    `StatusSolicitacao` e `statusSolicitacaoColors`; campo `clienteNomeExibicao`.
  - Adicionar hooks React Query para enviar-orcamento, liberar-pedido, recusar.
  - _Requirements: 1.3, 2.1_

- [x] 7. Frontend — tela de solicitações
  - Em `solicitacoes-orcamento/page.tsx`: coluna Cliente lê
    `clienteNomeExibicao || clienteNome || '—'`; ações condicionais por status
    (Enviar p/ orçamento / Precificar / Liberar p/ pedido / Converter / Recusar).
  - _Requirements: 1.2, 1.3, 2.1, 3.1_

- [ ] 8. Testes E2E (suíte QA) — PENDENTE (rodar contra produção após deploy)
  - Estender `test_02_portal_representante` (frontend) para o ciclo
    PENDENTE→EM_ORCAMENTO→PRECIFICADA→LIBERADA_PEDIDO→CONVERTIDA e exibição do
    cliente. Depende do backend/front deployados (a suíte roda contra a Vercel).
  - _Requirements: 1.1, 1.2, 2.1, 3.1_

- [x] 9. Verificação final
  - Backend: `tsc --noEmit` — sem erros novos nos arquivos tocados
    (o único erro em `portal-rep-admin.routes.ts` é baseline pré-existente do
    `create` do PedidoVenda, confirmado via git stash).
  - Unit tests da máquina de estados: 5/5 passando (Vitest).
  - Frontend: `get_diagnostics` sem erros nos 3 arquivos editados.
  - Migração idempotente testada 2x local.
  - Commit em branch nova (schema.prisma + migrate-prod.ts juntos) — pendente
    de execução pelo usuário.
  - _Requirements: 5.2_
