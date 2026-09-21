# Requirements Document

## Introduction

Esta feature fecha os itens ainda pendentes do **Relatório de Validação
Cadastral de produtos WMS** (arquivo `2-RELATORIO DE OCORRENCIAS E AJUSTES.pdf`
na raiz de `VisioFab.Wms.Back`, 18/09/2026), para que o cadastro mestre de
produto do Vizor atenda **100%** do que o cliente pediu.

O rastreamento de o-que-já-existe vs o-que-falta é mantido no steering
`.kiro/steering/relatorio-validacao-cadastral.md` (carregado automaticamente
toda sessão). **Ao concluir qualquer tarefa desta spec, atualizar aquela
tabela.**

### O que já está pronto (fora do escopo desta spec)

- **Hierarquia Mercadológica** completa (specs `hierarquia-mercadologica` fase 1
  e 2): 4 níveis, `Produto.familiaId`, cascata no cadastro, relatório e migração.
- **Tipo de Carga / conservação**: `Produto.ambienteExigido` (SECO/REFRIGERADO/
  CONGELADO) + motor de put-away (RF008).
- **Tipo de Produto / volumetria**: `Produto.tipoFisico` +
  `Produto.classificacaoArmazenagemId`.
- **Exige lote, FEFO e recusa de vencido**: `Produto.exigeLote`; FEFO na
  separação; `Produto.shelfLifeMinimo` (dias) usado na conferência de entrada
  (spec `conferencia-validade-produto`).
- **Bug do código automático**: já corrigido (commits `a43386551`, `b9c4d2de9`).
- **Bloqueio/quarentena de endereço (manual)**: já existe no WMS.

### O que falta (escopo desta spec)

1. **Característica / Periculosidade** do produto (campo dedicado + uso no
   endereçamento).
2. **Shelf Life Total do fabricante** (dias) + cálculo de vencimento a partir da
   data de fabricação na conferência.
3. **Shelf Life mínimo de Recebimento (RLM) por percentual de vida útil**
   (recusa/alerta na doca).
4. **Shelf Life de Expedição por cliente** (dias mínimos de validade a vencer,
   aplicado no picking/FEFO).
5. **Trava de Quarentena automática por dias a vencer** (bloqueio automático de
   lote para expedição + alerta), reaproveitando a quarentena existente.

Todos os campos novos são **opcionais/nullable**: produtos e clientes já
cadastrados continuam válidos e sem mudança de comportamento até que os novos
campos sejam preenchidos (compatibilidade retroativa).

## Glossary

- **Sistema**: o Vizor ERP/WMS (backend Fastify/Prisma/Zod + frontend Next.js/Mantine), no escopo desta feature.
- **Produto**: item de cadastro mestre (`Produto`), escopado por empresa (`empresaId`).
- **Periculosidade / Característica**: classificação de risco do produto para fins de armazenagem (ex.: Isento/Carga Geral, Perigoso, Inflamável).
- **Shelf Life Total**: prazo de validade total concedido pelo fabricante, em dias (ex.: 365).
- **Data de Fabricação**: data em que o lote foi produzido; base para calcular o vencimento quando a validade não é informada diretamente.
- **Vida útil restante**: dias entre a data de referência (hoje/recebimento) e o vencimento do lote.
- **Percentual de vida útil restante**: vida útil restante dividida pelo Shelf Life Total, em percentual.
- **RLM (Recebimento Lote Mínimo)**: regra que recusa/alerta a entrada de um lote na doca quando o percentual de vida útil restante é inferior ao mínimo configurado.
- **Shelf Life de Expedição por cliente**: quantidade mínima de dias de validade a vencer que um cliente exige para aceitar um lote na saída.
- **FEFO**: First Expire, First Out — estratégia de saída pelo lote que vence primeiro.
- **Quarentena automática**: bloqueio automático de um saldo/lote para expedição quando faltam poucos dias para o vencimento (limiar configurável).
- **Conferência de entrada**: processo de recebimento na doca (canais padrão, com senha e cega) já existente.
- **Lote/Saldo**: `SaldoEndereco` (WMS) com lote e validade; unidade sobre a qual as regras de expedição/quarentena atuam.
- **Perfil administrativo**: usuário com perfil ADMIN ou SUPER_ADMIN.

## Requirements

### Requirement 1: Característica / Periculosidade do produto

**User Story:** Como cadastrador de produtos, quero classificar a
periculosidade/característica de um produto, para que o WMS restrinja a
armazenagem em áreas compatíveis.

#### Acceptance Criteria

1. WHERE o cadastro de produto está aberto, THE Sistema SHALL permitir informar a característica/periculosidade do produto entre um conjunto controlado de valores (no mínimo: Isento/Carga Geral, Perigoso, Inflamável), de forma opcional.
2. WHEN um produto é salvo sem característica informada, THE Sistema SHALL gravar o produto normalmente (campo opcional), preservando a compatibilidade com produtos já cadastrados.
3. WHEN o motor de endereçamento (put-away) sugere endereço para um produto classificado como Perigoso ou Inflamável, THE Sistema SHALL restringir a sugestão a endereços/áreas compatíveis com esse tipo de risco, não sugerindo endereços comuns incompatíveis.
4. WHEN o produto é Isento/Carga Geral ou não possui característica informada, THE Sistema SHALL manter o comportamento atual de endereçamento, sem restrição adicional por periculosidade.
5. THE Sistema SHALL manter a característica escopada por empresa (`empresaId`) como invariante permanente, com filtro explícito por empresa em qualquer consulta.

### Requirement 2: Shelf Life Total do fabricante e cálculo de vencimento

**User Story:** Como responsável pelo recebimento, quero cadastrar o shelf life
total do fabricante e informar a data de fabricação na doca, para que o sistema
calcule o vencimento automaticamente quando a validade não vier pronta.

#### Acceptance Criteria

1. WHERE o cadastro de produto está aberto, THE Sistema SHALL permitir informar o Shelf Life Total do fabricante em dias, como valor inteiro positivo e opcional.
2. WHEN, na conferência de entrada, o operador informa a data de fabricação de um lote E o produto possui Shelf Life Total cadastrado E a validade não foi informada, THE Sistema SHALL calcular o vencimento do lote como data de fabricação somada ao Shelf Life Total (em dias).
3. IF a validade do lote é informada diretamente E o produto possui Shelf Life Total cadastrado E a data de fabricação também é informada, THEN THE Sistema SHALL validar a coerência entre a validade informada e o vencimento calculado, sinalizando divergência quando não coincidirem, sem impedir o registro.
4. WHEN o produto não possui Shelf Life Total cadastrado, THE Sistema SHALL manter o comportamento atual (a validade é usada como informada, sem cálculo a partir da fabricação).
5. IF a data de fabricação informada é posterior à data corrente, THEN THE Sistema SHALL rejeitar a data de fabricação com mensagem clara, sem calcular vencimento.

### Requirement 3: Shelf Life mínimo de Recebimento (RLM) por percentual de vida útil

**User Story:** Como gestor de recebimento, quero recusar lotes que cheguem com
pouca vida útil restante, para não estocar produtos que vencerão cedo demais.

#### Acceptance Criteria

1. WHERE o cadastro de produto está aberto, THE Sistema SHALL permitir informar o percentual mínimo de vida útil restante exigido no recebimento (RLM), como valor entre 0 e 100, opcional, complementar ao `shelfLifeMinimo` em dias já existente.
2. WHEN, na conferência de entrada, um lote possui vencimento conhecido E o produto possui RLM percentual configurado E o Shelf Life Total cadastrado, THE Sistema SHALL calcular o percentual de vida útil restante do lote na data do recebimento e compará-lo ao RLM configurado.
3. IF o percentual de vida útil restante do lote é inferior ao RLM configurado, THEN THE Sistema SHALL bloquear/sinalizar a entrada do lote com mensagem indicando o percentual encontrado e o mínimo exigido, de forma uniforme nos três canais de conferência (padrão, com senha e cega).
4. WHEN o produto não possui RLM percentual configurado, THE Sistema SHALL manter a verificação atual baseada apenas em `shelfLifeMinimo` (dias) e recusa de vencido, sem alteração de comportamento.
5. WHEN ambos os critérios estão configurados (RLM percentual e `shelfLifeMinimo` em dias), THE Sistema SHALL aplicar os dois, recusando o lote se qualquer um deles não for atendido.
6. THE Sistema SHALL restringir a verificação aos dados da empresa corrente (`empresaId`), com filtro explícito por empresa.

### Requirement 4: Shelf Life de Expedição por cliente (FEFO por dias mínimos)

**User Story:** Como responsável pela expedição, quero que cada cliente tenha um
mínimo de dias de validade a vencer, para que o picking nunca separe um lote que
o cliente recusaria.

#### Acceptance Criteria

1. WHERE o cadastro de cliente está aberto, THE Sistema SHALL permitir informar a quantidade mínima de dias de validade a vencer exigida por aquele cliente na expedição, como valor inteiro não negativo e opcional.
2. WHEN a separação (picking) seleciona lotes por FEFO para um pedido E o cliente do pedido possui dias mínimos de expedição configurados, THE Sistema SHALL desconsiderar os lotes cujo vencimento está a menos dias do que o mínimo exigido pelo cliente, priorizando os lotes elegíveis pelo FEFO.
3. IF nenhum lote disponível atende aos dias mínimos exigidos pelo cliente, THEN THE Sistema SHALL bloquear/sinalizar a separação daquele item com mensagem indicando a ausência de lote elegível, sem selecionar um lote que viole a regra.
4. WHEN o cliente do pedido não possui dias mínimos de expedição configurados, THE Sistema SHALL manter o comportamento FEFO atual, sem restrição adicional por cliente.
5. THE Sistema SHALL restringir a regra aos dados da empresa corrente (`empresaId`), com filtro explícito por empresa, e usar o cliente vinculado ao próprio pedido.

### Requirement 5: Trava de Quarentena automática por dias a vencer

**User Story:** Como gestor de qualidade, quero que lotes prestes a vencer sejam
bloqueados automaticamente para expedição, para evitar expedir produto no limite
da validade.

#### Acceptance Criteria

1. THE Sistema SHALL permitir configurar um limiar de dias a vencer para quarentena automática, por produto ou por empresa, como valor inteiro não negativo e opcional.
2. WHEN um saldo/lote possui vencimento conhecido E o limiar de quarentena está configurado E os dias restantes até o vencimento são menores ou iguais ao limiar, THE Sistema SHALL bloquear automaticamente aquele saldo/lote para expedição, reutilizando o mecanismo de bloqueio/quarentena já existente no WMS.
3. WHEN um saldo/lote é bloqueado automaticamente por quarentena, THE Sistema SHALL registrar/sinalizar o motivo (proximidade do vencimento) de forma auditável e distinguível de um bloqueio manual.
4. WHEN o limiar de quarentena não está configurado, THE Sistema SHALL manter o comportamento atual, sem bloqueio automático por proximidade de vencimento.
5. WHILE um saldo/lote está sob quarentena automática, THE Sistema SHALL impedir sua seleção na separação/expedição, de forma consistente com os bloqueios manuais existentes.
6. THE Sistema SHALL restringir a avaliação e o bloqueio aos dados da empresa corrente (`empresaId`), com filtro explícito por empresa.

### Requirement 6: Lógica pura de datas e percentuais (testável)

**User Story:** Como responsável técnico, quero funções puras e determinísticas
para os cálculos de validade, para que as regras de recebimento, expedição e
quarentena sejam corretas e testáveis por property-based testing.

#### Acceptance Criteria

1. WHEN o Sistema calcula o vencimento a partir da data de fabricação e do Shelf Life Total, THE Sistema SHALL usar uma função pura determinística que, para as mesmas entradas, produz sempre o mesmo vencimento.
2. WHEN o Sistema calcula o percentual de vida útil restante, THE Sistema SHALL usar uma função pura que retorna 100% quando a vida útil restante é igual ao shelf life total, 0% quando o lote está vencendo na data de referência, e nunca um valor negativo para lotes já vencidos (tratando-os como 0% ou vencidos).
3. WHEN o Sistema decide aceitar ou recusar um lote no recebimento por percentual, THE Sistema SHALL usar uma função pura que recusa se, e somente se, o percentual de vida útil restante é estritamente inferior ao mínimo configurado.
4. WHEN o Sistema decide se um lote é elegível para um cliente na expedição, THE Sistema SHALL usar uma função pura que aprova se, e somente se, os dias restantes até o vencimento são maiores ou iguais aos dias mínimos exigidos pelo cliente.
5. WHEN o Sistema decide se um lote entra em quarentena automática, THE Sistema SHALL usar uma função pura que bloqueia se, e somente se, os dias restantes até o vencimento são menores ou iguais ao limiar configurado.
6. IF qualquer entrada de data é nula/ausente ou o parâmetro de configuração correspondente não está definido, THEN as funções puras SHALL retornar um resultado neutro (não recusa, não bloqueia, não calcula) sem lançar erro.

### Requirement 7: Persistência, migração e isolamento

**User Story:** Como responsável técnico, quero que os novos campos sejam
persistidos de forma consistente entre desenvolvimento e produção, sem quebrar
dados existentes.

#### Acceptance Criteria

1. WHEN novos campos são introduzidos em `Produto` e `Cliente` (e/ou parâmetros de empresa), THE Sistema SHALL criá-los como colunas opcionais/nullable via migração idempotente aplicada em desenvolvimento e produção, conforme o processo obrigatório de migrations do projeto (`schema.prisma` + `migrate-prod.ts` no mesmo commit).
2. WHEN a migração é executada mais de uma vez, THE Sistema SHALL ser idempotente, sem falhar nem duplicar colunas/estruturas.
3. WHERE produtos e clientes já existem sem os novos campos preenchidos, THE Sistema SHALL preservá-los inalterados e manter o comportamento anterior até que os campos sejam preenchidos.
4. THE Sistema SHALL aplicar isolamento multi-tenant por `empresaId` com filtro explícito em todas as consultas relacionadas, não dependendo apenas do isolamento automático do `prismaScoped`.
