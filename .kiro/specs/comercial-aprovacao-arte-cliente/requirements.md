# Requirements Document

## Introduction

Esta spec é o item 4 da §20.4 de `docs/PROJETO-MODULO-COMERCIAL.md` e a "Frente 3" do fechamento do fluxo comercial. Ela implementa a **aprovação de arte pelo cliente por meio de um link com código de acesso que expira**, substituindo o registro manual de aprovação de arte introduzido na Fundação (`comercial-pedido-status-fiel`).

Hoje, na Fundação, a aprovação de arte do cliente é registrada manualmente pelo comercial (rota `POST /pedidos-proposta/:id/aprovacao-arte`). Esta spec acrescenta o canal direto com o cliente: o comercial (ou o representante) **gera um link**, envia por fora (WhatsApp/e-mail), e o cliente abre uma **página pública** (sem login) protegida por um **token que expira**, vê a arte submetida e **Aprova** ou **Pede ajuste**. A decisão do cliente reflete no Pedido via o `Servico_Eventos` já existente: aprovar registra a aprovação de arte; pedir ajuste devolve o pedido para a Pré-Impressão abrindo uma nova rodada.

Decisões do usuário (04/11/2026):
- A aprovação é sempre do cliente, via representante ou direto do comercial.
- O link tem **código de acesso que expira** (para não vazar ao concorrente).
- Validade padrão do link: **7 dias**.
- O sistema **gera o link** para o usuário enviar manualmente (WhatsApp/e-mail). Não há disparo automático de e-mail nesta versão.
- A página do cliente mostra a arte (as imagens anexadas ao pedido) e as informações essenciais, sem expor dados internos (custo, margem).

### Fora de escopo

- Disparo automático de e-mail/WhatsApp (o sistema só gera o link).
- Board da Pré-Impressão (Frente 2, spec própria).
- Central do Produto v2.
- Assinatura digital/jurídica da aprovação (guarda-se nome/registro/IP/data como evidência, não assinatura ICP).

### Escopo de repositórios

Back (`VisioFab.Wms.Back`) e Front (`VisioFab.Wms.Front`) são repositórios separados. A página pública do cliente é uma rota do Front fora da área autenticada.

## Glossary

- **Pedido**: `PedidoProposta` (RFQ).
- **Link_Aprovacao**: registro de um pedido de aprovação de arte enviado ao cliente, com token, validade e status.
- **Token_Aprovacao**: código de acesso opaco e não-enumerável (UUID v4) que identifica o Link_Aprovacao na URL pública.
- **Pagina_Publica**: tela do Front, sem autenticação, acessada por `/aprovar-arte/<token>`, onde o cliente vê a arte e decide.
- **Validade_Link**: prazo de expiração do Link_Aprovacao (padrão 7 dias a partir da criação).
- **Decisao_Cliente**: `APROVADA` ou `AJUSTE_SOLICITADO`.
- **Servico_Eventos**: interface interna do Back (`servico-eventos.service.ts`) com `registrarEvento` e `solicitarTransicao`, criada na Fundação.
- **Evidencia**: dados guardados no momento da decisão: nome informado pelo cliente, IP, data/hora e observação.
- **Empresa_Ativa**: `empresaId` da entidade de negócio real, usado explicitamente em toda query.
- **Migracao_Prod**: `prisma/migrate-prod.ts`, idempotente, único mecanismo de migração em produção.

## Requirements

### Requirement 1: Geração do link de aprovação

**User Story:** Como comercial ou representante, quero gerar um link de aprovação de arte para um pedido, para enviar ao cliente por fora e colher a decisão dele.

#### Acceptance Criteria

1. WHEN um usuário autenticado solicita a geração de um Link_Aprovacao para um Pedido da Empresa_Ativa, THE Sistema SHALL criar um Link_Aprovacao com Token_Aprovacao único (UUID v4), status `PENDENTE` e Validade_Link de 7 dias a partir da criação.
2. THE Sistema SHALL retornar a URL pública completa do Link_Aprovacao (base pública configurável + `/aprovar-arte/<token>`) para o usuário copiar/enviar.
3. IF o Pedido não existe ou pertence a outra empresa, THEN THE Sistema SHALL responder HTTP 404 sem revelar a existência do Pedido.
4. WHEN já existe um Link_Aprovacao `PENDENTE` e não expirado para o mesmo Pedido, THE Sistema SHALL reutilizá-lo (retornar o mesmo token) em vez de criar outro, salvo quando o usuário pedir explicitamente um novo (que invalida o anterior).
5. WHEN o usuário solicita um novo link explicitamente, THE Sistema SHALL marcar os Links_Aprovacao `PENDENTE` anteriores do Pedido como `CANCELADO` e criar um novo.
6. THE Sistema SHALL exigir a permissão `podeVerComercial` (bypass ADMIN/SUPER_ADMIN) para gerar ou cancelar um Link_Aprovacao.
7. WHEN um Link_Aprovacao é gerado, THE Sistema SHALL registrar um Evento_Pedido (via Servico_Eventos) do tipo `LINK_APROVACAO_GERADO` com o token (sem expor dados sensíveis) e o usuário.
8. THE Sistema SHALL permitir listar os Links_Aprovacao de um Pedido (token abreviado, status, validade, decisão) para o comercial acompanhar.

### Requirement 2: Página pública de aprovação (cliente)

**User Story:** Como cliente, quero abrir o link recebido e ver a arte do meu pedido para aprovar ou pedir ajuste, sem precisar de login.

#### Acceptance Criteria

1. WHEN o cliente acessa a Pagina_Publica com um Token_Aprovacao válido e não expirado, THE Sistema SHALL retornar os dados públicos do Pedido: número, nome do produto, cliente, e as imagens de arte anexadas ao Pedido.
2. THE Sistema SHALL NOT expor na Pagina_Publica nenhum dado interno (custo, margem, preço de cálculo, fornecedores).
3. IF o Token_Aprovacao não existe, THEN THE Sistema SHALL responder HTTP 404 com mensagem neutra.
4. IF o Link_Aprovacao está expirado (Validade_Link ultrapassada) e ainda `PENDENTE`, THEN THE Sistema SHALL responder HTTP 410 com o código `LINK_EXPIRADO`, sem permitir decisão.
5. IF o Link_Aprovacao já foi decidido (`APROVADA` ou `AJUSTE_SOLICITADO`) ou `CANCELADO`, THEN THE Sistema SHALL retornar o estado atual e NÃO permitir nova decisão (a página mostra "já respondido").
6. THE Sistema SHALL servir as imagens de arte ao cliente apenas por meio do Token_Aprovacao (sem exigir token de usuário autenticado).
7. THE acesso à Pagina_Publica (GET) SHALL NOT exigir autenticação de usuário.

### Requirement 3: Decisão do cliente (aprovar / pedir ajuste)

**User Story:** Como cliente, quero aprovar a arte ou pedir um ajuste informando o motivo, para que o pedido siga ou volte à pré-impressão.

#### Acceptance Criteria

1. WHEN o cliente aprova pela Pagina_Publica com um Token_Aprovacao válido e `PENDENTE`, THE Sistema SHALL marcar o Link_Aprovacao como `APROVADA`, gravar a Evidencia (nome informado, IP, data/hora, observação opcional) e registrar a aprovação de arte no Pedido via Servico_Eventos (evento `APROVACAO_ARTE`, forma `CLIENTE_LINK`).
2. WHEN o cliente pede ajuste pela Pagina_Publica, THE Sistema SHALL exigir um motivo de 1 a 500 caracteres, marcar o Link_Aprovacao como `AJUSTE_SOLICITADO`, gravar a Evidencia e solicitar ao Servico_Eventos um retorno do Pedido para a Pré-Impressão (abre nova Rodada).
3. IF o motivo do ajuste está ausente ou vazio após remover espaços, THEN THE Sistema SHALL rejeitar com HTTP 400 e o código `MOTIVO_OBRIGATORIO`, sem alterar o Link_Aprovacao nem o Pedido.
4. IF o Token_Aprovacao está expirado, já decidido ou cancelado no momento da decisão, THEN THE Sistema SHALL rejeitar a decisão (410 `LINK_EXPIRADO` para expirado; 409 `LINK_JA_RESPONDIDO` para decidido/cancelado), sem alterar nada.
5. THE decisão (POST) SHALL NOT exigir autenticação de usuário; a autorização é o próprio Token_Aprovacao.
6. WHEN a decisão é gravada, THE Sistema SHALL fazê-lo de forma atômica com o Evento_Pedido correspondente; se a atualização de status do Pedido falhar, o Link permanece decidido e o erro é logado (best-effort do lado do status), sem reverter a decisão do cliente.
7. WHEN uma decisão é concluída, THE Sistema SHALL ser idempotente a reenvios do mesmo POST com o mesmo token já decidido (retorna o estado atual sem duplicar eventos).
8. THE Sistema SHALL registrar o `empresaId` real do Pedido em toda gravação (isolamento multi-tenant).

### Requirement 4: Integração com o status fiel do Pedido

**User Story:** Como gestor, quero que a decisão do cliente reflita automaticamente no status do pedido, para não precisar atualizar manualmente.

#### Acceptance Criteria

1. WHEN o cliente aprova a arte, THE Sistema SHALL registrar a aprovação de arte no Pedido (mesmo efeito do registro manual da Fundação), habilitando a transição para `APROVADO` quando as demais exigências estiverem cumpridas.
2. WHEN o cliente pede ajuste, THE Sistema SHALL devolver o Pedido para a situação de Pré-Impressão via Servico_Eventos, incrementando a Rodada e registrando o motivo na Linha_do_Tempo.
3. THE Sistema SHALL usar o Servico_Eventos existente, sem alterar a máquina de estados da Fundação.
4. IF o Pedido estiver em status terminal (PERDIDO/CANCELADO/FATURADO) no momento da decisão, THEN THE Sistema SHALL registrar a decisão do cliente no Link mas NÃO aplicar transição de status, retornando aviso ao cliente de que o pedido não está mais em aprovação.

### Requirement 5: Schema e migração de produção

**User Story:** Como responsável pelo deploy, quero schema e migração evoluindo juntos e idempotentes, para o Render/Neon nunca ficar dessincronizado.

#### Acceptance Criteria

1. THE Sistema SHALL alterar `prisma/schema.prisma` e `prisma/migrate-prod.ts` no mesmo commit.
2. THE Migracao_Prod SHALL criar a tabela nova com `CREATE TABLE IF NOT EXISTS` e índices com `CREATE INDEX IF NOT EXISTS`.
3. THE Migracao_Prod SHALL ser idempotente (rodar duas vezes sem erro).
4. THE novas colunas/tabela SHALL ter o Token_Aprovacao único por índice único, e índice por `(empresaId, pedidoPropostaId)`.
5. THE Sistema SHALL executar `prisma generate` após alterar o schema, e o build SHALL passar sem novos erros de tipo além da baseline.

### Requirement 6: Front — geração e acompanhamento (interno) e página pública

**User Story:** Como comercial, quero gerar o link e copiá-lo na tela do pedido; como cliente, quero uma página simples para decidir.

#### Acceptance Criteria

1. THE Tela de detalhe do Pedido (interna) SHALL oferecer a ação "Gerar link de aprovação do cliente", exibir a URL gerada com botão de copiar e listar os links já gerados (status/validade/decisão).
2. WHEN não há arte anexada ao Pedido, THE Tela SHALL alertar que não há imagens para o cliente aprovar, mas ainda permitir gerar o link (o cliente verá a mensagem correspondente).
3. THE Pagina_Publica SHALL exibir a(s) imagem(ns) de arte, os dados essenciais do pedido, e os botões "Aprovar" e "Pedir ajuste" (este com campo de motivo), com rótulos acessíveis e operável por teclado.
4. WHEN o link está expirado, já respondido ou inválido, THE Pagina_Publica SHALL exibir a mensagem correspondente sem permitir decisão.
5. WHEN a decisão é enviada com sucesso, THE Pagina_Publica SHALL exibir confirmação e desabilitar os botões.
6. THE Pagina_Publica SHALL funcionar sem o usuário estar autenticado no ERP.

### Requirement 7: Qualidade e verificabilidade

**User Story:** Como desenvolvedor, quero a lógica testável e isolada, para evitar regressões.

#### Acceptance Criteria

1. THE Sistema SHALL implementar as regras puras (estado do link, expiração, validação de decisão) como funções sem Prisma, testáveis.
2. THE Sistema SHALL cobrir com testes unitários: cálculo de expiração, transições de status do Link (PENDENTE→APROVADA/AJUSTE_SOLICITADO/CANCELADO), e rejeição de decisão em link expirado/decidido.
3. THE Sistema SHALL cobrir com teste de integração (mock de Prisma) o isolamento por empresaId na geração e a idempotência da decisão.
4. THE teste de idempotência da Migracao_Prod SHALL ser de fumaça (rodar duas vezes).
