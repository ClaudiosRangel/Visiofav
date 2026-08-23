# Implementation Plan: Portal do Representante

## Overview

Implementação do módulo Portal do Representante no backend Fastify existente, com autenticação JWT separada (`scope: 'portal-rep'`), rotas prefixadas em `/api/portal-rep`, models Prisma dedicados e isolamento multi-tenant estrito por `empresaId` + `vendedorId`. A implementação segue a ordem: schema/migração → autenticação → módulos funcionais → admin → notificações → testes de propriedade.

## Tasks

- [x] 1. Schema Prisma e migração de produção
  - [x] 1.1 Adicionar models ao schema.prisma e atualizar migrate-prod.ts
    - Adicionar os 5 novos models: `RepresentanteCredencial`, `SolicitacaoOrcamentoRep`, `NotificacaoRep`, `LogAuditoriaRep`, `AprovacaoClienteRep`
    - Adicionar relação `representanteCredencial` em `Vendedor`
    - Adicionar campo `vendedorId` em `Cliente` (opcional, sem FK formal)
    - Atualizar `prisma/migrate-prod.ts` com `CREATE TABLE IF NOT EXISTS` para cada tabela, `CREATE INDEX IF NOT EXISTS` para cada índice, e `ADD COLUMN IF NOT EXISTS` para campos em tabelas existentes — tudo idempotente
    - Rodar `npx prisma generate` para validar
    - _Requirements: 7.2, 6.2_

- [x] 2. Middleware de autenticação do portal
  - [x] 2.1 Implementar portal-rep-auth.middleware.ts
    - Criar `src/modules/portal-rep/auth/portal-rep-auth.middleware.ts`
    - Verificar token JWT com `scope: 'portal-rep'`
    - Popular `request.portalRepUser` com `{ scope, empresaId, vendedorId, representanteId }`
    - Rejeitar tokens com scope diferente de `portal-rep` (HTTP 401)
    - Verificar se `RepresentanteCredencial.status === 'ATIVO'` no banco (HTTP 401 com code `CONTA_INATIVA` se inativo)
    - Se `senhaTemporaria === true`, retornar HTTP 403 com code `SENHA_TEMPORARIA` para qualquer rota funcional (exceto `/auth/trocar-senha`)
    - _Requirements: 1.2, 1.3, 1.6, 7.5_

  - [x]* 2.2 Teste de propriedade — Property 4: Senha temporária bloqueia acesso funcional
    - **Property 4: Senha temporária bloqueia acesso funcional**
    - **Validates: Requirements 1.2**

  - [x]* 2.3 Teste de propriedade — Property 5: Token JWT contém claims obrigatórios
    - **Property 5: Token JWT contém claims obrigatórios**
    - **Validates: Requirements 1.3**

  - [x]* 2.4 Teste de propriedade — Property 6: Separação de domínios de autenticação
    - **Property 6: Separação de domínios de autenticação**
    - **Validates: Requirements 7.2, 7.5**

- [x] 3. Módulo de autenticação (login, troca de senha, refresh)
  - [x] 3.1 Implementar portal-rep-auth.service.ts
    - Criar `src/modules/portal-rep/auth/portal-rep-auth.service.ts`
    - Função `login(email, senha, empresaId)`: validar credenciais, verificar status/bloqueio, incrementar `tentativasLogin` em falha, emitir JWT + refresh token em sucesso, zerar tentativas em sucesso
    - Função `trocarSenha(representanteId, senhaAtual, novaSenha)`: validar senha atual, atualizar hash, setar `senhaTemporaria = false`
    - Função `refreshToken(token)`: validar refresh token, emitir novo par JWT + refresh
    - Implementar lógica de bloqueio: após 5 tentativas consecutivas, setar `status = 'BLOQUEADO'` e `bloqueadoAte = now() + 15min`
    - Registrar `LogAuditoriaRep` em cada login (sucesso/falha) e bloqueio
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 7.4_

  - [x] 3.2 Implementar portal-rep-auth.routes.ts
    - Criar `src/modules/portal-rep/auth/portal-rep-auth.routes.ts`
    - `POST /api/portal-rep/auth/login` — rota pública
    - `POST /api/portal-rep/auth/trocar-senha` — protegida pelo middleware (exceção para senha temporária)
    - `POST /api/portal-rep/auth/refresh` — rota pública (valida refresh token)
    - Schemas Zod para validação de input
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x]* 3.3 Teste de propriedade — Property 3: Bloqueio por tentativas consecutivas
    - **Property 3: Bloqueio por tentativas consecutivas**
    - **Validates: Requirements 1.4**

- [x] 4. Checkpoint - Verificar autenticação
  - Garantir que login, troca de senha, refresh token, bloqueio e middleware funcionam corretamente. Rodar testes. Perguntar ao usuário se há dúvidas.

- [x] 5. Módulo de solicitação de orçamento
  - [x] 5.1 Implementar portal-rep-solicitacao.service.ts
    - Criar `src/modules/portal-rep/solicitacao/portal-rep-solicitacao.service.ts`
    - Função `criarSolicitacao(dados, portalRepUser)`: criar `SolicitacaoOrcamentoRep` vinculando `vendedorId` do token, validar cliente (existente na carteira ou prospect inline)
    - Função `listarSolicitacoes(filtros, portalRepUser)`: filtrar por `empresaId` + `vendedorId`, suportar filtros de status/período/cliente
    - Função `obterSolicitacao(id, portalRepUser)`: buscar com isolamento
    - Função `cancelarSolicitacao(id, portalRepUser)`: só se status `PENDENTE`
    - Registrar `LogAuditoriaRep` na criação
    - _Requirements: 2.1, 2.2, 2.3, 2.6, 7.1_

  - [x] 5.2 Implementar portal-rep-solicitacao.routes.ts
    - Criar `src/modules/portal-rep/solicitacao/portal-rep-solicitacao.routes.ts`
    - `POST /api/portal-rep/solicitacoes-orcamento` — criar solicitação
    - `GET /api/portal-rep/solicitacoes-orcamento` — listar com filtros e paginação
    - `GET /api/portal-rep/solicitacoes-orcamento/:id` — detalhe
    - `DELETE /api/portal-rep/solicitacoes-orcamento/:id` — cancelar (só PENDENTE)
    - Schemas Zod; garantir que resposta NÃO inclui campos de custo/margem
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x]* 5.3 Teste de propriedade — Property 7: Solicitação vinculada ao vendedorId
    - **Property 7: Solicitação vinculada ao vendedorId**
    - **Validates: Requirements 2.1**

  - [x]* 5.4 Teste de propriedade — Property 2: Ocultação de dados sensíveis
    - **Property 2: Ocultação de dados sensíveis**
    - **Validates: Requirements 2.2, 2.3, 4.7**

- [x] 6. Módulo de pipeline
  - [x] 6.1 Implementar portal-rep-pipeline.service.ts
    - Criar `src/modules/portal-rep/pipeline/portal-rep-pipeline.service.ts`
    - Função `listarPipeline(filtros, portalRepUser)`: buscar `PedidoVenda` por `vendedorId` + `empresaId`, montar timeline cruzando `OrdemProducao` + etapas para determinar status corrente (Orçamento → Aprovação → PV → OP → Produção → Expedição → Entregue)
    - Função `detalhePipeline(pedidoVendaId, portalRepUser)`: retornar progresso detalhado com percentual de produção (`Math.round(etapasConcluidas / totalEtapas * 100)`)
    - Suportar filtros: status, cliente, período de criação, número do pedido
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 6.2 Implementar portal-rep-pipeline.routes.ts
    - Criar `src/modules/portal-rep/pipeline/portal-rep-pipeline.routes.ts`
    - `GET /api/portal-rep/pipeline` — lista com filtros e paginação
    - `GET /api/portal-rep/pipeline/:pedidoVendaId` — detalhe com progresso
    - Schemas Zod de query params
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x]* 6.3 Teste de propriedade — Property 15: Progresso de produção
    - **Property 15: Progresso de produção**
    - **Validates: Requirements 3.4**

  - [x]* 6.4 Teste de propriedade — Property 14: Filtros retornam subconjunto válido (pipeline)
    - **Property 14: Filtros retornam subconjunto válido**
    - **Validates: Requirements 3.5**

- [x] 7. Módulo de comissão
  - [x] 7.1 Implementar portal-rep-comissao.service.ts
    - Criar `src/modules/portal-rep/comissao/portal-rep-comissao.service.ts`
    - Função `calcularComissaoPedido(pedido, representante)`: se tipo FIXA → `precoVenda * vendedor.comissao / 100`; se VARIAVEL → buscar `RegraComissao` mais específica (produto > categoria > geral) e aplicar percentual
    - Função `resumoPorPeriodo(mes, ano, portalRepUser)`: agregar `totalProjetado` (pedidos antes do critério de creditamento) + `totalRealizado` (pedidos que atingiram o critério) usando parâmetro `portal-rep.criterio-creditamento`
    - Função `detalhamentoComissoes(filtros, portalRepUser)`: listar pedidos com comissão individual, suportar filtros por período/cliente/status
    - Ocultar campos de custo/margem na resposta
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [x] 7.2 Implementar portal-rep-comissao.routes.ts
    - Criar `src/modules/portal-rep/comissao/portal-rep-comissao.routes.ts`
    - `GET /api/portal-rep/comissoes` — resumo por período
    - `GET /api/portal-rep/comissoes/detalhe` — detalhamento por pedido com filtros
    - Schemas Zod
    - _Requirements: 4.1, 4.5, 4.6, 4.7_

  - [x]* 7.3 Teste de propriedade — Property 9: Cálculo de comissão correto
    - **Property 9: Cálculo de comissão correto**
    - **Validates: Requirements 4.1, 4.2, 4.3**

  - [x]* 7.4 Teste de propriedade — Property 10: Totalização de comissões por período
    - **Property 10: Totalização de comissões por período**
    - **Validates: Requirements 4.4, 4.5**

- [x] 8. Checkpoint - Verificar módulos funcionais do representante
  - Garantir que solicitação de orçamento, pipeline e comissão funcionam com isolamento correto. Rodar testes. Perguntar ao usuário se há dúvidas.

- [x] 9. Módulo de carteira de clientes
  - [x] 9.1 Implementar portal-rep-clientes.service.ts
    - Criar `src/modules/portal-rep/clientes/portal-rep-clientes.service.ts`
    - Função `listarCarteira(portalRepUser)`: buscar `Cliente` por `vendedorId` + `empresaId`
    - Função `cadastrarCliente(dados, portalRepUser)`: validar CPF/CNPJ (algoritmo de dígitos verificadores), verificar unicidade na empresa, criar registro em `Cliente` do sistema de vendas com `vendedorId` preenchido, registrar `LogAuditoriaRep`
    - Função `editarDadosComplementares(clienteId, dados, portalRepUser)`: atualizar telefone/email/endereço diretamente na tabela `Cliente`
    - Função `solicitarAlteracaoFiscal(clienteId, dados, portalRepUser)`: NÃO alterar `Cliente` diretamente; criar `AprovacaoClienteRep` com status `PENDENTE` contendo dados propostos
    - Tratar cenário de CPF/CNPJ duplicado: retornar 409 com `code: 'DOCUMENTO_EXISTENTE'` e informar que o cliente já existe (oferecer vinculação via `AprovacaoClienteRep` tipo `VINCULACAO`)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [x] 9.2 Implementar portal-rep-clientes.routes.ts
    - Criar `src/modules/portal-rep/clientes/portal-rep-clientes.routes.ts`
    - `GET /api/portal-rep/clientes` — listar carteira
    - `POST /api/portal-rep/clientes` — cadastrar novo cliente/prospect
    - `PUT /api/portal-rep/clientes/:id` — editar dados complementares
    - `PUT /api/portal-rep/clientes/:id/campos-fiscais` — solicitar alteração fiscal (gera aprovação)
    - Schemas Zod com validação de CPF/CNPJ
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [x]* 9.3 Teste de propriedade — Property 11: Validação e unicidade de CPF/CNPJ
    - **Property 11: Validação e unicidade de CPF/CNPJ**
    - **Validates: Requirements 5.4, 5.5**

  - [x]* 9.4 Teste de propriedade — Property 12: Edição fiscal submete para aprovação
    - **Property 12: Edição fiscal submete para aprovação**
    - **Validates: Requirements 5.7**

  - [x]* 9.5 Teste de propriedade — Property 13: Cadastro de cliente propaga para tabela central
    - **Property 13: Cadastro de cliente propaga para tabela central**
    - **Validates: Requirements 5.2, 5.3**

- [x] 10. Módulo de notificações
  - [x] 10.1 Implementar portal-rep-notificacao.service.ts
    - Criar `src/modules/portal-rep/notificacoes/portal-rep-notificacao.service.ts`
    - Função `criarNotificacao(tipo, titulo, mensagem, representanteId, empresaId, referencia?)`: criar `NotificacaoRep`, opcionalmente disparar envio de e-mail se `representante.notificacaoEmail === true` e parâmetro `portal-rep.notificacao-email` ativo
    - Função `listarNotificacoes(portalRepUser, paginacao)`: retornar com indicador lida/não-lida, ordenado por `criadoEm` desc
    - Função `marcarComoLida(id, portalRepUser)` e `marcarTodasComoLidas(portalRepUser)`
    - Função `contarNaoLidas(portalRepUser)`: retornar count para badge
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 10.2 Implementar portal-rep-notificacao.routes.ts
    - Criar `src/modules/portal-rep/notificacoes/portal-rep-notificacao.routes.ts`
    - `GET /api/portal-rep/notificacoes` — listar com paginação
    - `PUT /api/portal-rep/notificacoes/:id/lida` — marcar como lida
    - `PUT /api/portal-rep/notificacoes/ler-todas` — marcar todas como lidas
    - `GET /api/portal-rep/notificacoes/count-nao-lidas` — count para badge
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [x]* 10.3 Teste de propriedade — Property 8: Transições de status geram notificação
    - **Property 8: Transições de status geram notificação**
    - **Validates: Requirements 2.5, 8.1, 8.2, 8.3**

- [x] 11. Módulo admin (rotas internas do ERP)
  - [x] 11.1 Implementar portal-rep-admin.service.ts
    - Criar `src/modules/portal-rep/admin/portal-rep-admin.service.ts`
    - Função `criarRepresentante(dados, empresaId)`: vincular a Vendedor existente (validar unicidade empresaId+vendedorId), gerar senha temporária hasheada, criar `RepresentanteCredencial`
    - Função `editarRepresentante(id, dados, empresaId)`: atualizar status, tipo comissão, email
    - Função `inativarRepresentante(id, empresaId)`: setar status `INATIVO`
    - Função `resetarSenha(id, empresaId)`: gerar nova senha temporária, setar `senhaTemporaria = true`
    - Função `listarSolicitacoesAdmin(filtros, empresaId)`: todas as solicitações da empresa
    - Função `calcularOrcamento(solicitacaoId, empresaId)`: invocar `calcularOrcamentoGrafico()` internamente, gravar resultado (precoVenda/precoUnitario), atualizar status → CALCULADO, criar notificação
    - Função `configurarComissao(config, empresaId)`: definir critério de creditamento na tabela `Parametro`
    - Função `listarAprovacoesPendentes(empresaId)`: retornar `AprovacaoClienteRep` com status PENDENTE
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 1.1_

  - [x] 11.2 Implementar portal-rep-admin.routes.ts
    - Criar `src/modules/portal-rep/admin/portal-rep-admin.routes.ts`
    - Proteger todas as rotas com middleware `authenticate` interno do ERP (perfil ADMIN/SUPER_ADMIN)
    - `GET /api/portal-rep/admin/representantes` — listar contas do portal
    - `POST /api/portal-rep/admin/representantes` — criar conta
    - `PUT /api/portal-rep/admin/representantes/:id` — editar
    - `PUT /api/portal-rep/admin/representantes/:id/inativar` — inativar
    - `PUT /api/portal-rep/admin/representantes/:id/resetar-senha` — resetar senha
    - `GET /api/portal-rep/admin/solicitacoes-orcamento` — listar todas
    - `POST /api/portal-rep/admin/solicitacoes-orcamento/:id/calcular` — processar orçamento
    - `PUT /api/portal-rep/admin/configuracao-comissao` — definir critério de creditamento
    - `GET /api/portal-rep/admin/aprovacoes-cliente` — pendências de aprovação
    - Schemas Zod
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

  - [x]* 11.3 Teste de propriedade — Property 17: Vinculação 1:1 representante-vendedor
    - **Property 17: Vinculação 1:1 representante-vendedor**
    - **Validates: Requirements 6.2**

- [x] 12. Checkpoint - Verificar módulos de clientes, notificações e admin
  - Garantir que os módulos de carteira de clientes, notificações e admin funcionam com isolamento correto e integração entre si. Rodar testes. Perguntar ao usuário se há dúvidas.

- [x] 13. Auditoria e isolamento multi-tenant
  - [x] 13.1 Implementar serviço de auditoria e validar isolamento em todas as rotas
    - Criar `src/modules/portal-rep/auditoria/portal-rep-auditoria.service.ts`
    - Função `registrarLog(acao, detalhes, portalRepUser, ip)`: criar `LogAuditoriaRep`
    - Revisar TODAS as rotas do portal para garantir que queries filtram por `empresaId` + `vendedorId` (conforme steering `ATENCAO-pontos-verificar.md`)
    - Garantir que nenhuma rota do portal permite acesso a dados de outra empresa ou outro vendedor
    - _Requirements: 7.1, 7.4_

  - [x]* 13.2 Teste de propriedade — Property 1: Isolamento multi-tenant completo
    - **Property 1: Isolamento multi-tenant completo**
    - **Validates: Requirements 1.5, 3.1, 5.1, 7.1**

  - [x]* 13.3 Teste de propriedade — Property 16: Auditoria registrada
    - **Property 16: Auditoria registrada**
    - **Validates: Requirements 7.4**

- [x] 14. Registro do plugin e wiring final
  - [x] 14.1 Registrar rotas no servidor Fastify e configurar parâmetros
    - Criar `src/modules/portal-rep/index.ts` que registra todos os módulos como plugin Fastify sob prefixo `/api/portal-rep`
    - Registrar o plugin no `app.ts` (ou equivalente)
    - Inserir parâmetros default na tabela `Parametro` via `migrate-prod.ts` (idempotente): `portal-rep.habilitado`, `portal-rep.criterio-creditamento`, `portal-rep.tipo-comissao-padrao`, `portal-rep.jwt-expiracao-minutos`, `portal-rep.refresh-expiracao-dias`, `portal-rep.notificacao-email`
    - _Requirements: 1.5, 6.7, 7.2_

  - [x]* 14.2 Testes de integração end-to-end do fluxo principal
    - Testar fluxo completo: admin cria representante → representante faz login → troca senha → cria solicitação → admin calcula → representante vê preço → representante consulta pipeline e comissões
    - Usar mocks para motor de orçamento gráfico e envio de e-mail
    - _Requirements: 1.1, 1.2, 2.1, 2.4, 2.5, 6.6_

- [x] 15. Checkpoint final - Validação completa
  - Garantir que todos os testes passam, isolamento multi-tenant funciona, autenticação está segura e o módulo está pronto para integração com o frontend. Perguntar ao usuário se há dúvidas.

## Notes

- Tasks marcadas com `*` são opcionais e podem ser puladas para um MVP mais rápido
- Cada task referencia os requisitos específicos para rastreabilidade
- Checkpoints garantem validação incremental
- Property tests validam as 17 propriedades de corretude definidas no design
- **Regra de migração**: toda alteração em `schema.prisma` DEVE ser acompanhada de alteração idempotente em `prisma/migrate-prod.ts` no mesmo task (conforme steering `database-migrations.md`)
- **Isolamento multi-tenant**: todas as queries DEVEM filtrar por `empresaId` + `vendedorId` (conforme steering `ATENCAO-pontos-verificar.md`)
- O módulo reutiliza o mesmo servidor Fastify, banco PostgreSQL (Neon) e padrões de código existentes no projeto

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "3.1"] },
    { "id": 3, "tasks": ["3.2", "3.3"] },
    { "id": 4, "tasks": ["5.1", "6.1", "7.1", "9.1", "10.1"] },
    { "id": 5, "tasks": ["5.2", "5.3", "6.2", "7.2", "9.2", "10.2"] },
    { "id": 6, "tasks": ["5.4", "6.3", "6.4", "7.3", "7.4", "9.3", "9.4", "9.5", "10.3"] },
    { "id": 7, "tasks": ["11.1", "13.1"] },
    { "id": 8, "tasks": ["11.2", "11.3", "13.2", "13.3"] },
    { "id": 9, "tasks": ["14.1"] },
    { "id": 10, "tasks": ["14.2"] }
  ]
}
```
