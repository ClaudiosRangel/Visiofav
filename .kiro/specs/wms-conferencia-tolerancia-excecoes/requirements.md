# Requirements Document

## Introduction

Evolução do fluxo de conferência de entrada (Opção 1 — Cascata Sequencial) para
resolver divergências de quantidade, lote e validade de forma organizada e
alinhada às práticas de mercado (SAP EWM, Oracle WMS Cloud, Infor WMS). Formaliza
a regra já implementada — quantidade resolvida antes de lote/validade, cada uma
com trilha de liberação distinta — e incorpora duas capacidades inexistentes
hoje: tolerância percentual configurável para divergência de quantidade (evita
reconferência para diferenças irrelevantes) e um terceiro estado de "espera"
(Hold) para divergências que não devem ser imediatamente aceitas nem
rejeitadas, com motivo padronizado (reason code) e fila de exceção dedicada
para resolução assíncrona por um supervisor.

## Glossary

- **Sistema_Conferencia**: Módulo backend responsável pela lógica de conferência
  de entrada, incluindo 1ª conferência, segunda conferência obrigatória e
  resolução de divergências
- **Frontend_Conferencia**: Interface web Next.js/Mantine da tela de
  Conferência de Entrada (`wms/conferencia-entrada`)
- **Tolerancia_Quantidade**: Percentual configurável (por produto ou global da
  empresa) que define o desvio máximo de quantidade aceito automaticamente sem
  gerar divergência nem exigir segunda conferência
- **Divergencia_Leve**: Diferença de quantidade dentro do percentual de
  Tolerancia_Quantidade — aceita automaticamente, sem bloqueio
- **Divergencia_Confirmada**: Diferença de quantidade fora da tolerância, ou
  qualquer diferença de lote/validade — exige segunda conferência
- **Hold**: Estado intermediário de um item com divergência confirmada, em que
  o operador não aceita nem rejeita a divergência, mas a registra para decisão
  posterior de um Supervisor, com um Motivo_Hold obrigatório
- **Motivo_Hold**: Código padronizado (não texto livre) que descreve a razão
  de um item ter sido colocado em Hold ou de uma divergência ter sido aceita
- **Fila_Excecoes**: Tela/listagem que agrega itens em Hold, pendências CC-e
  (AGUARDANDO_CCE) e itens aguardando autorização de supervisor, para
  resolução assíncrona fora da tela de conferência do operador de chão
- **Supervisor**: Usuário com perfil SUPERVISOR ou ADMIN, autorizado a
  resolver itens da Fila_Excecoes e liberar divergências de lote/validade
- **ConfigConferenciaProduto**: Tabela existente que define, por produto, se
  divergências de lote/validade aceitam senha (`aceitarSenha`) e/ou pendência
  CC-e (`aceitarCcePendente`)

## Requirements

### Requirement 1: Tolerância Percentual de Quantidade

**User Story:** As a administrador do WMS, I want configurar um percentual de
tolerância de quantidade por produto (com um valor padrão global da empresa),
so that pequenas diferenças de contagem não gerem reconferência obrigatória
para todo o item.

#### Acceptance Criteria

1. THE Sistema_Conferencia SHALL armazenar um percentual de tolerância de
   quantidade (`toleranciaQuantidadePercentual`) opcional em `Produto`, com
   valor decimal entre 0 e 100
2. THE Sistema_Conferencia SHALL armazenar um percentual de tolerância de
   quantidade padrão (`toleranciaQuantidadePercentualPadrao`) em `Empresa`,
   aplicado a produtos sem configuração própria
3. WHEN nenhum percentual estiver configurado nem no produto nem na empresa,
   THE Sistema_Conferencia SHALL considerar a tolerância como 0 (qualquer
   diferença gera Divergencia_Confirmada), preservando o comportamento atual
4. WHEN a quantidade conferida divergir da quantidade da NF-e dentro do
   percentual de tolerância aplicável ao produto, THE Sistema_Conferencia
   SHALL classificar o item como Divergencia_Leve
5. WHEN um item for classificado como Divergencia_Leve, THE Sistema_Conferencia
   SHALL aceitar a quantidade automaticamente, sem marcar o item como
   PENDENTE_SEGUNDA_CONFERENCIA e sem bloquear a confirmação da nota
6. WHEN a quantidade conferida divergir da quantidade da NF-e fora do
   percentual de tolerância aplicável, THE Sistema_Conferencia SHALL
   classificar o item como Divergencia_Confirmada e aplicar o fluxo de
   segunda conferência já existente
7. THE Sistema_Conferencia SHALL aplicar a tolerância apenas para excesso e
   falta de quantidade — divergências de lote e validade nunca são elegíveis a
   tolerância percentual
8. IF a config `permiteRecebimentoParcial` da empresa estiver ativa E a
   quantidade conferida for menor que a da NF-e, THEN THE Sistema_Conferencia
   SHALL avaliar primeiro a regra de recebimento parcial existente,
   aplicando a tolerância de quantidade somente quando o recebimento parcial
   não for aplicável ao item

### Requirement 2: Indicação Visual de Tolerância na Grade de Conferência

**User Story:** As a conferente, I want visualizar quais itens foram aceitos
automaticamente dentro da tolerância, so that eu entenda por que o item não
está bloqueando a nota mesmo com uma diferença de quantidade.

#### Acceptance Criteria

1. WHEN o resultado da conferência (`conferir-todos`) incluir um item
   classificado como Divergencia_Leve, THE Sistema_Conferencia SHALL retornar
   `tipoDivergencia: 'TOLERANCIA_ACEITA'` e o percentual de tolerância
   aplicado no item
2. WHILE um item estiver classificado como Divergencia_Leve, THE
   Frontend_Conferencia SHALL exibir um badge amarelo distinto de "Conforme"
   (verde) e de "Divergente" (vermelho), com o texto "Aceito dentro da
   tolerância" e o percentual de desvio
3. THE Frontend_Conferencia SHALL exibir o badge de tolerância sem qualquer
   interação bloqueante — o item segue disponível para confirmação da nota
   normalmente

### Requirement 3: Estado Hold para Divergência Confirmada

**User Story:** As a conferente ou supervisor, I want colocar um item com
divergência confirmada em espera (Hold), so that eu não seja forçado a
decidir imediatamente entre aceitar ou rejeitar quando a resolução depende de
um terceiro (fornecedor, transportadora, fiscal).

#### Acceptance Criteria

1. THE Sistema_Conferencia SHALL adicionar o status `HOLD` aos valores
   possíveis de `ItemNotaEntrada.statusConferencia`
2. WHILE um item estiver com status `PENDENTE_SEGUNDA_CONFERENCIA` e uma
   divergência de quantidade for confirmada novamente na segunda conferência,
   THE Frontend_Conferencia SHALL oferecer a ação "Colocar em espera" além das
   ações existentes (Aceitar com divergência / Rejeitar / Corrigir Contagem)
2. WHEN o operador selecionar "Colocar em espera" para um item, THE
   Sistema_Conferencia SHALL exigir a seleção de um Motivo_Hold antes de
   confirmar a ação
3. WHEN um Motivo_Hold for confirmado para um item, THE Sistema_Conferencia
   SHALL atualizar `ItemNotaEntrada.statusConferencia` para `HOLD`, registrar
   o Motivo_Hold, o usuário que colocou em espera e o timestamp
4. WHILE um item estiver com status `HOLD`, THE Sistema_Conferencia SHALL
   removê-lo da lista de itens pendentes exibida na tela de segunda
   conferência do operador de chão
5. WHILE um item estiver com status `HOLD`, THE Sistema_Conferencia SHALL
   bloquear a confirmação final da nota (`confirmar/:notaId`), da mesma forma
   que já bloqueia para itens `PENDENTE_SEGUNDA_CONFERENCIA` e para
   `PendenciaCce` com status `AGUARDANDO_CCE`
6. THE Sistema_Conferencia SHALL permitir que um item com status `HOLD` seja
   resolvido apenas a partir da Fila_Excecoes, retornando ao fluxo normal de
   segunda conferência (status `PENDENTE_SEGUNDA_CONFERENCIA`) ou sendo
   aceito/rejeitado diretamente pelo Supervisor

### Requirement 4: Motivos Padronizados (Reason Codes)

**User Story:** As a administrador do WMS, I want que toda divergência aceita,
colocada em espera ou rejeitada registre um motivo padronizado, so that eu
possa gerar relatórios de causas de divergência por fornecedor e produto.

#### Acceptance Criteria

1. THE Sistema_Conferencia SHALL definir uma lista fixa de motivos
   padronizados para divergência, incluindo no mínimo: `ERRO_CONTAGEM_
   FORNECEDOR`, `AVARIA_TRANSPORTE`, `ERRO_ETIQUETAGEM`, `AGUARDANDO_CCE_
   FORNECEDOR`, `DIVERGENCIA_LOTE_FORNECEDOR`, `OUTRO`
2. WHEN o motivo selecionado for `OUTRO`, THE Sistema_Conferencia SHALL exigir
   um texto complementar não vazio
3. THE Sistema_Conferencia SHALL registrar o Motivo_Hold selecionado no campo
   `observacao` estruturado de `DivergenciaConferencia` e/ou do novo estado
   `HOLD` de `ItemNotaEntrada`, preservando o texto complementar quando
   aplicável
4. THE Frontend_Conferencia SHALL exibir os motivos padronizados como uma
   lista de seleção (não campo de texto livre) em toda ação de aceitar,
   colocar em espera ou rejeitar uma divergência confirmada

### Requirement 5: Fila de Exceções

**User Story:** As a supervisor, I want uma tela única que reúna todos os
itens pendentes de decisão (Hold, pendência CC-e, aguardando senha), so that
eu possa resolver exceções de conferência sem precisar acessar a tela
operacional de chão de fábrica.

#### Acceptance Criteria

1. THE Sistema_Conferencia SHALL expor um endpoint que lista, para a empresa
   do usuário autenticado, todos os itens com status `HOLD`, todas as
   `PendenciaCce` com status `AGUARDANDO_CCE` e todos os itens
   `PENDENTE_SEGUNDA_CONFERENCIA` cuja resolução configurada seja
   `ACEITAR_SENHA`
2. THE Sistema_Conferencia SHALL permitir filtrar a listagem por fornecedor,
   por nota de entrada, por tipo de exceção (Hold, CC-e, Senha) e por data de
   criação
3. THE Frontend_Conferencia SHALL exibir a Fila_Excecoes como uma tela
   separada da grade de conferência operacional, acessível a usuários com
   perfil SUPERVISOR ou ADMIN
4. WHEN um Supervisor resolver um item em Hold pela Fila_Excecoes, THE
   Sistema_Conferencia SHALL oferecer as ações "Aceitar divergência",
   "Rejeitar item" e "Retornar para segunda conferência", cada uma exigindo
   um Motivo_Hold quando aplicável
5. THE Sistema_Conferencia SHALL registrar, para cada resolução realizada na
   Fila_Excecoes, o identificador do Supervisor responsável e o timestamp da
   decisão

### Requirement 6: Compatibilidade com Fluxo Existente

**User Story:** As a desenvolvedor, I want que a evolução do fluxo de
conferência não quebre o comportamento já validado em produção, so that as
notas em andamento e os testes E2E existentes continuem funcionando.

#### Acceptance Criteria

1. THE Sistema_Conferencia SHALL manter o endpoint `POST /conferencia-entrada
   /conferir-todos/:notaId` com o mesmo nome e contrato de entrada atuais,
   adicionando apenas campos novos na resposta
2. THE Sistema_Conferencia SHALL manter o comportamento de recebimento parcial
   (`registrarSaldoPendente`) e a segunda conferência de lote/validade
   (`executarSegundaConferencia`) sem alteração de contrato para empresas que
   não configurarem tolerância de quantidade
3. THE Sistema_Conferencia SHALL preservar a regra de que produtos com
   `exigeLote=true` sempre avaliam lote e validade, independente da
   configuração de tolerância de quantidade
4. THE Sistema_Conferencia SHALL preservar o bloqueio de confirmação de nota
   por `PendenciaCce` aberta e por item `PENDENTE_SEGUNDA_CONFERENCIA`,
   estendendo-o para incluir também itens com status `HOLD`
