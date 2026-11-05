# Requirements Document

## Introduction

Esta spec é o Pilar 3 da §20.4 de `docs/PROJETO-MODULO-COMERCIAL.md` ("Frente 2" do fechamento do fluxo comercial): o **Board da Pré-Impressão**, que substitui o acompanhamento que a Carton Wega faz hoje no Monday. É onde o setor de Pré-Impressão executa e acompanha, por pedido, as etapas **Mockup → Arte → Padrão → Ficha Técnica**, com status de ida e volta, enquanto o Pedido/Proposta (RFQ) percorre o funil da Fundação (`comercial-pedido-status-fiel`).

O board é **aditivo e não-regressivo**: reusa o `Servico_Eventos` e a máquina de estados da Fundação sem alterá-los. Quando um pedido entra em `EM_PRE_IMPRESSAO`, suas etapas de board são criadas (uma vez); conforme as etapas avançam/retornam, o board registra eventos na Linha_do_Tempo do pedido e, ao concluir a última etapa relevante, sinaliza que a pré-impressão terminou.

Decisões do usuário (04/11/2026):
- Um card por **pedido**, com as etapas dentro.
- Etapas: **Mockup, Arte, Padrão, Ficha Técnica** (as 4 do Monday).
- Nesta primeira versão: sem SLA/prazo por etapa (fica para evolução). Só o quadro, as etapas e o vai-e-volta.
- Não migrar histórico do Monday.

### Fora de escopo

- SLA/prazo por etapa e alertas de atraso (evolução futura).
- Anexos por etapa (a arte continua anexada ao pedido; o board referencia).
- Link de aprovação do cliente (já implementado na spec `comercial-aprovacao-arte-cliente`).

### Escopo de repositórios

Back (`VisioFab.Wms.Back`) e Front (`VisioFab.Wms.Front`) são repositórios separados.

## Glossary

- **Pedido**: `PedidoProposta` (RFQ).
- **Board_Pre_Impressao**: conjunto de Etapas_Board de um Pedido.
- **Etapa_Board**: uma das 4 etapas (`MOCKUP`, `ARTE`, `PADRAO`, `FICHA_TECNICA`), com status, ordem e responsável.
- **Status_Etapa**: `PENDENTE`, `EM_ANDAMENTO`, `CONCLUIDA`.
- **Servico_Eventos**: interface interna do Back (`servico-eventos.service.ts`) criada na Fundação.
- **Caminho_Pre_Impressao**: volume de trabalho derivado do Tipo_Pedido (CONFERENCIA/PARCIAL/COMPLETA) — define quais etapas são relevantes.
- **Empresa_Ativa**: `empresaId` da entidade real, explícito em toda query.
- **Migracao_Prod**: `prisma/migrate-prod.ts`, idempotente.

## Requirements

### Requirement 1: Criação do board por pedido

**User Story:** Como pré-impressão, quero que cada pedido em pré-impressão tenha suas etapas, para organizar o trabalho.

#### Acceptance Criteria

1. WHEN um Pedido entra em `EM_PRE_IMPRESSAO` pela primeira vez, THE Sistema SHALL criar as 4 Etapas_Board (`MOCKUP`, `ARTE`, `PADRAO`, `FICHA_TECNICA`) com `Status_Etapa = PENDENTE` e ordem fixa.
2. THE Sistema SHALL ser idempotente: criar o board de um Pedido que já tem etapas não duplica etapas.
3. WHEN o board é criado, THE Sistema SHALL registrar um Evento_Pedido (`BOARD_CRIADO`) via Servico_Eventos.
4. THE Sistema SHALL permitir criar/garantir o board manualmente (endpoint), para pedidos antigos que já estavam em pré-impressão antes desta spec.
5. THE Sistema SHALL associar cada Etapa_Board ao `empresaId` do Pedido real.

### Requirement 2: Avançar e retornar etapas

**User Story:** Como pré-impressão, quero marcar cada etapa como em andamento ou concluída, e poder voltar uma etapa, para refletir o trabalho real.

#### Acceptance Criteria

1. THE Sistema SHALL permitir mudar o Status_Etapa de uma Etapa_Board entre `PENDENTE`, `EM_ANDAMENTO` e `CONCLUIDA`.
2. WHEN uma Etapa_Board muda de status, THE Sistema SHALL registrar um Evento_Pedido (`ETAPA_BOARD_<ETAPA>_<STATUS>`) via Servico_Eventos, com o usuário.
3. THE Sistema SHALL permitir uma observação opcional (até 500 caracteres) ao mudar o status, gravada na etapa e no evento.
4. IF a Etapa_Board ou o Pedido pertencem a outra empresa, THEN THE Sistema SHALL responder HTTP 404.
5. THE Sistema SHALL gravar `dataInicio` quando a etapa passa a `EM_ANDAMENTO` (1ª vez) e `dataConclusao` quando passa a `CONCLUIDA`.
6. WHEN uma etapa concluída volta para `PENDENTE`/`EM_ANDAMENTO`, THE Sistema SHALL limpar a `dataConclusao` e registrar o evento de retorno.

### Requirement 3: Integração com o status fiel do Pedido

**User Story:** Como gestor, quero que a conclusão da pré-impressão reflita no pedido, para o fluxo seguir.

#### Acceptance Criteria

1. WHEN todas as Etapas_Board relevantes do Caminho_Pre_Impressao do Pedido estão `CONCLUIDA`, THE Sistema SHALL registrar um Evento_Pedido (`PRE_IMPRESSAO_CONCLUIDA`) via Servico_Eventos.
2. THE Sistema SHALL NÃO forçar transição automática do Pedido para fora de `EM_PRE_IMPRESSAO`; a conclusão apenas sinaliza (o comercial/orçamento decide avançar). (Mantém a não-regressão da máquina de estados.)
3. WHEN o board aciona o Servico_Eventos e a chamada falha, THE Sistema SHALL manter a mudança da etapa e logar o erro (best-effort), sem reverter.
4. THE Sistema SHALL usar o Servico_Eventos existente, sem alterar a máquina de estados da Fundação.

### Requirement 4: Consulta do board

**User Story:** Como pré-impressão, quero ver o quadro de todos os pedidos em pré-impressão e as etapas de cada um, para priorizar.

#### Acceptance Criteria

1. THE Sistema SHALL expor `GET` do board de um Pedido (as 4 etapas com status/datas/observação).
2. THE Sistema SHALL expor `GET` da lista de pedidos em `EM_PRE_IMPRESSAO` da Empresa_Ativa, cada um com o resumo do board (quantas etapas concluídas / total) e o setor/tempo parado.
3. THE Sistema SHALL filtrar toda consulta por `empresaId` explícito.
4. THE Sistema SHALL ordenar a lista por tempo parado (mais antigo primeiro) por padrão.

### Requirement 5: Schema e migração de produção

**User Story:** Como responsável pelo deploy, quero schema e migração evoluindo juntos e idempotentes, para o Render/Neon nunca ficar dessincronizado.

#### Acceptance Criteria

1. THE Sistema SHALL alterar `prisma/schema.prisma` e `prisma/migrate-prod.ts` no mesmo commit.
2. THE Migracao_Prod SHALL criar a tabela nova com `CREATE TABLE IF NOT EXISTS`, índices com `CREATE INDEX IF NOT EXISTS`, e FK em try/catch.
3. THE Migracao_Prod SHALL ser idempotente.
4. THE tabela SHALL ter índice único por `(pedidoPropostaId, etapa)` para garantir uma etapa por tipo por pedido.

### Requirement 6: Front — board kanban

**User Story:** Como pré-impressão, quero um quadro visual dos pedidos e etapas, para operar o dia a dia sem o Monday.

#### Acceptance Criteria

1. THE Front SHALL exibir uma tela de Pré-Impressão listando os pedidos em `EM_PRE_IMPRESSAO`, com progresso do board (ex.: "2/4").
2. THE Front SHALL permitir abrir um pedido e ver as 4 etapas em colunas/cartões, com ações para mudar o status (iniciar/concluir/voltar) e observação.
3. THE Front SHALL exibir mensagens de erro do Back e degradar sem os campos novos.
4. THE Front SHALL ser acessível por teclado e com rótulos.
5. THE menu do Comercial SHALL ter o item "Pré-Impressão" apontando para a tela.

### Requirement 7: Qualidade

**User Story:** Como desenvolvedor, quero a lógica testável e isolada, para evitar regressões.

#### Acceptance Criteria

1. THE Sistema SHALL implementar as regras puras (catálogo de etapas, ordem, etapas relevantes por caminho, cálculo de "board concluído") como funções sem Prisma, testáveis.
2. THE Sistema SHALL cobrir com testes unitários o catálogo/ordem e a regra de board concluído por caminho.
3. THE Sistema SHALL cobrir com teste de integração (mock de Prisma) o isolamento por empresaId e a idempotência da criação do board.
