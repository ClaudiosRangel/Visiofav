# Requirements Document

## Introduction

O **Checkout de Apontamento** é uma aplicação web responsiva, separada do
ERP Vizor, através da qual operadores de máquina da Carton Wega registram
tudo que acontece na produção: início de etapa, setup, produção, perda,
retrabalho, parada (planejada ou não planejada), retomada e conclusão de
etapa. Não é um app nativo nem depende de coletor dedicado nesta fase — é
uma URL acessível de qualquer computador, tablet ou celular com navegador.

O checkout usa um modelo de autenticação em dois níveis (sessão de terminal
vinculada a um centro de produção + identificação do operador por PIN a
cada apontamento), reaproveita e estende as rotas operacionais já existentes
do módulo PCP (`iniciar`, `pausar`, `apontar`, `concluir` em
`EtapaOrdemProducao`/`ApontamentoEtapa`), e cobre lacunas reais do chão de
fábrica que o painel de programação atual (uso interno, por usuários já
logados no ERP) não resolve: setup como evento próprio, múltiplos operadores
simultâneos numa etapa, correção retroativa auditável, diferenciação entre
parada planejada e não planejada, pendência de falta de material durante a
produção, retrabalho distinto de perda, bloqueio de sequência entre etapas
dependentes, e alerta de etapa parada há muito tempo sem retomada.

A arquitetura do checkout deve reservar espaço para, em fases futuras,
receber apontamentos automáticos de integrações de máquina (JDF/JMF,
OPC-UA, sensores IoT) pelos mesmos endpoints internos usados pelo operador
humano — sem exigir retrabalho do modelo de dados quando essa integração
for implementada.

Todo lançamento feito no checkout reflete no modelo de dados de PCP já
existente (`OrdemProducao`, `EtapaOrdemProducao`, `ApontamentoEtapa`), e
toda entidade de negócio criada ou consultada pelo checkout é isolada por
empresa (`empresaId`), seguindo o padrão multi-tenant já documentado no
projeto.

## Glossary

- **Checkout**: A aplicação web de apontamento de produção, objeto desta
  especificação, acessível por URL própria e distinta do ERP principal.
- **Terminal**: O computador, tablet ou celular usado no chão de fábrica
  para acessar o Checkout, vinculado a um `Centro_Producao` durante uma
  Sessão_Terminal.
- **Sessão_Terminal**: Sessão de longa duração (turno de trabalho),
  autenticada por um Supervisor, que vincula um Terminal a um
  `Centro_Producao` específico e permanece ativa até expirar ou ser
  encerrada manualmente.
- **Operador**: Um `Funcionario` (cadastro já existente no ERP) autorizado a
  se identificar no Checkout via PIN e realizar apontamentos.
- **Supervisor**: Usuário do ERP com perfil `ADMIN` ou `SUPERVISOR` (perfis
  já existentes no cadastro de `Usuario`), autorizado a autenticar uma
  Sessão_Terminal, trocar o centro vinculado a um Terminal, e autorizar
  Apontamentos_Retroativos.
- **PIN_Operador**: Código numérico pessoal de 6 dígitos, vinculado a um
  `Funcionario`, usado para identificar o Operador antes de cada
  apontamento no Checkout. Armazenado apenas como hash (`pinHash`), nunca
  em texto puro.
- **Token_Checkout**: Token de autenticação (JWT) com escopo restrito,
  emitido para uma Sessão_Terminal, aceito exclusivamente pelas rotas do
  Checkout — nunca pelas demais rotas do ERP.
- **Etapa**: Uma `EtapaOrdemProducao`, a etapa real de produção de uma
  `OrdemProducao`, executada num `Centro_Producao`.
- **Apontamento**: Um `ApontamentoEtapa`, o registro granular de um evento
  ocorrido numa Etapa (produção, perda, retrabalho, parada, retomada,
  setup).
- **Apontamento_Retroativo**: Um Apontamento criado para corrigir ou
  complementar um registro anterior, vinculado ao Apontamento original,
  sem apagar ou sobrescrever o registro original.
- **Parada_Planejada**: Interrupção da produção prevista e agendada
  antecipadamente (ex: manutenção preventiva).
- **Parada_Não_Planejada**: Interrupção da produção não prevista (ex:
  quebra inesperada de máquina, falta de material).
- **Retrabalho**: Quantidade produzida que retorna à fila de produção para
  reprocessamento, distinta de Perda (que é descarte definitivo).
- **Pendência_Material**: Registro de falta de material identificada durante
  a execução de uma Etapa (não antes de iniciá-la), visível para PCP e
  almoxarifado.
- **Fonte_Apontamento**: Classificação de origem de um Apontamento —
  `MANUAL_OPERADOR` (registrado por um Operador humano no Checkout) ou
  `INTEGRACAO_MAQUINA` (registrado automaticamente por uma integração de
  máquina em fase futura).
- **Centro_Producao**: Cadastro já existente de máquina/setor/linha de
  produção do módulo PCP.

## Requirements

### Requirement 1: Autenticação de Sessão de Terminal

**User Story:** Como Supervisor de produção, eu quero autenticar um
Terminal para um turno inteiro vinculado a um Centro_Producao, para que os
operadores daquele centro não precisem fazer login individual completo a
cada apontamento.

#### Acceptance Criteria

1. WHEN um Supervisor informa suas credenciais de Usuario e seleciona um
   Centro_Producao válido da empresa, THE Checkout SHALL criar uma
   Sessão_Terminal vinculada a esse Centro_Producao e emitir um
   Token_Checkout para o Terminal.
2. IF as credenciais informadas para autenticar a Sessão_Terminal forem
   inválidas, THEN THE Checkout SHALL rejeitar a criação da Sessão_Terminal
   e registrar a tentativa no SecurityAuditLog.
3. IF o usuário autenticado não possuir perfil ADMIN ou SUPERVISOR, THEN
   THE Checkout SHALL rejeitar a criação da Sessão_Terminal com um erro de
   acesso não autorizado.
4. WHILE uma Sessão_Terminal estiver ativa, THE Checkout SHALL exibir, na
   interface do Terminal, o Centro_Producao vinculado a essa sessão.
5. WHEN uma Sessão_Terminal atinge 12 horas desde sua criação, THE Checkout
   SHALL expirar a Sessão_Terminal e exigir nova autenticação de Supervisor.
6. WHEN um Supervisor autentica-se num Terminal com Sessão_Terminal ativa
   vinculada a um Centro_Producao diferente do desejado, THE Checkout SHALL
   permitir a troca do Centro_Producao vinculado à Sessão_Terminal.
7. THE Token_Checkout SHALL ser aceito exclusivamente pelas rotas do
   Checkout, sendo rejeitado por qualquer outra rota do ERP.

### Requirement 2: Identificação do Operador por PIN

**User Story:** Como Operador de máquina, eu quero me identificar
rapidamente digitando um PIN antes de cada apontamento, para que o sistema
saiba quem realizou cada lançamento sem exigir login completo por turno.

#### Acceptance Criteria

1. THE Funcionario SHALL possuir um campo `pinHash` armazenando o PIN do
   Operador exclusivamente na forma de hash, nunca em texto puro.
2. WHEN um Operador digita um PIN válido de 6 dígitos numéricos vinculado a
   um Funcionario ativo da empresa do Terminal, THE Checkout SHALL
   identificar esse Operador para o apontamento em andamento.
3. IF o PIN digitado não corresponder a nenhum Funcionario ativo da empresa
   do Terminal, THEN THE Checkout SHALL rejeitar a identificação e informar
   erro genérico, sem revelar se o PIN existe para outro Funcionario.
4. THE Checkout SHALL exigir a identificação do Operador antes de registrar
   qualquer Apontamento.
5. WHERE a tela de identificação de Operador está sendo exibida, THE
   Checkout SHALL NOT listar publicamente nomes ou matrículas de
   Funcionarios em formato de seleção aberta.
6. WHEN um Apontamento é registrado, THE Checkout SHALL gravar o
   Funcionario identificado como autor daquele Apontamento.

### Requirement 3: Segurança de Escopo do Token do Checkout

**User Story:** Como responsável técnico pelo Vizor, eu quero que o token
usado pelo Checkout tenha escopo restrito, para que um Terminal comprometido
não sirva de porta de entrada para o restante do ERP.

#### Acceptance Criteria

1. THE Checkout SHALL emitir o Token_Checkout com um escopo dedicado
   (`CHECKOUT_OPERADOR`), distinto do escopo dos tokens emitidos pelo login
   padrão do ERP.
2. THE rotas do ERP fora do módulo de Checkout SHALL rejeitar requisições
   autenticadas com um Token_Checkout de escopo `CHECKOUT_OPERADOR`.
3. THE rotas do Checkout SHALL rejeitar requisições autenticadas com um
   token de escopo diferente de `CHECKOUT_OPERADOR`.
4. IF o Token_Checkout apresentado numa requisição estiver expirado ou
   inválido, THEN THE Checkout SHALL responder com erro de autenticação e
   exigir nova autenticação de Sessão_Terminal.

### Requirement 4: Rate Limiting e Auditoria de Tentativas de PIN

**User Story:** Como responsável técnico pelo Vizor, eu quero limitar
tentativas inválidas de PIN e registrar tentativas suspeitas, para reduzir
o risco de um PIN ser descoberto por tentativa e erro.

#### Acceptance Criteria

1. WHEN 5 tentativas consecutivas de identificação de Operador falham num
   mesmo Terminal, THE Checkout SHALL bloquear temporariamente novas
   tentativas de identificação nesse Terminal por 15 minutos.
2. WHEN uma tentativa de identificação de Operador falha, THE Checkout
   SHALL registrar a tentativa no SecurityAuditLog com o Terminal e o
   horário do evento.
3. IF uma tentativa de identificação de Operador ocorrer enquanto o Terminal
   estiver bloqueado por excesso de tentativas, THEN THE Checkout SHALL
   rejeitar a tentativa e informar o tempo restante de bloqueio.
4. WHEN o bloqueio temporário de tentativas expira, THE Checkout SHALL
   permitir novas tentativas de identificação normalmente.

### Requirement 5: Início e Retomada de Etapa

**User Story:** Como Operador, eu quero iniciar ou retomar uma etapa da
fila do meu centro de produção, para começar a registrar o trabalho
realizado.

#### Acceptance Criteria

1. WHEN um Operador identificado seleciona uma Etapa com status `PENDENTE`
   ou `PAUSADA` pertencente ao Centro_Producao da Sessão_Terminal, THE
   Checkout SHALL iniciar ou retomar essa Etapa, reaproveitando a rota
   `PATCH /pcp/etapas/:id/iniciar` já existente.
2. IF a Etapa selecionada não pertencer ao Centro_Producao vinculado à
   Sessão_Terminal, THEN THE Checkout SHALL rejeitar a ação com erro de
   etapa não encontrada para aquele Terminal.
3. WHEN uma Etapa é retomada a partir do status `PAUSADA`, THE Checkout
   SHALL registrar um Apontamento do tipo `RETOMADA` vinculado ao Operador
   identificado.
4. THE Checkout SHALL exibir apenas as Etapas pertencentes ao
   Centro_Producao vinculado à Sessão_Terminal ativa.

### Requirement 6: Apontamento de Setup como Evento Próprio

**User Story:** Como Operador, eu quero registrar o início e o fim do setup
de uma máquina como um evento distinto da produção, para que o tempo de
setup real seja medido corretamente.

#### Acceptance Criteria

1. WHEN um Operador inicia o setup de uma Etapa com status `PENDENTE` ou
   `PAUSADA`, THE Checkout SHALL registrar um Apontamento do tipo `SETUP`
   com o horário de início.
2. WHILE um Apontamento do tipo `SETUP` estiver em aberto para uma Etapa,
   THE Checkout SHALL impedir o registro de um novo Apontamento do tipo
   `SETUP` para a mesma Etapa.
3. WHEN um Operador finaliza o setup em andamento de uma Etapa, THE
   Checkout SHALL registrar o horário de fim no Apontamento do tipo `SETUP`
   aberto e calcular a duração do setup.
4. IF um Operador tentar iniciar a produção de uma Etapa enquanto houver um
   Apontamento do tipo `SETUP` em aberto para essa Etapa, THEN THE Checkout
   SHALL exigir a finalização do setup antes de aceitar apontamentos de
   produção.

### Requirement 7: Apontamento de Produção, Perda e Retrabalho

**User Story:** Como Operador, eu quero registrar quantidade produzida,
perdida ou retrabalhada durante a execução de uma etapa, para que o
progresso real da produção seja refletido na Ordem de Produção.

#### Acceptance Criteria

1. WHEN um Operador registra uma quantidade produzida para uma Etapa com
   status `EM_ANDAMENTO` ou `PAUSADA`, THE Checkout SHALL registrar um
   Apontamento do tipo `PRODUCAO` e incrementar a quantidade produzida da
   Etapa, reaproveitando a rota `POST /pcp/etapas/:id/apontar` já existente.
2. WHEN um Operador registra uma quantidade perdida com um motivo de perda
   (`ACERTO`, `REFUGO`, `DEFEITO` ou `APARA`), THE Checkout SHALL registrar
   um Apontamento do tipo `PERDA` e incrementar a quantidade de perda da
   Etapa.
3. WHEN um Operador registra uma quantidade retrabalhada para uma Etapa, THE
   Checkout SHALL registrar um Apontamento do tipo `RETRABALHO`,
   distinguindo essa quantidade da quantidade de perda da Etapa.
4. THE Checkout SHALL permitir anexar uma foto opcional a um Apontamento de
   produção, perda ou retrabalho, reaproveitando o suporte a upload de foto
   já existente na rota de apontamento.
5. IF a quantidade produzida, perdida ou retrabalhada informada for negativa,
   THEN THE Checkout SHALL rejeitar o Apontamento com erro de validação.

### Requirement 8: Parada com Diferenciação Planejada/Não Planejada

**User Story:** Como Operador, eu quero pausar uma etapa informando se a
parada é planejada ou não planejada, para que o cálculo de disponibilidade
reflita corretamente o motivo da interrupção.

#### Acceptance Criteria

1. WHEN um Operador pausa uma Etapa com status `EM_ANDAMENTO`, THE Checkout
   SHALL exigir a indicação de um motivo de parada (`MANUTENCAO`,
   `FALTA_MATERIAL`, `ACERTO_MAQUINA`, `TROCA_TURNO` ou `OUTRO`) e se a
   parada é planejada ou não planejada.
2. WHEN uma parada é registrada como planejada, THE Checkout SHALL marcar o
   Apontamento do tipo `PARADA` correspondente como planejado.
3. WHEN uma parada é registrada como não planejada com motivo `MANUTENCAO`,
   THE Checkout SHALL sinalizar a parada como candidata a abertura de ordem
   de manutenção.
4. THE Checkout SHALL reaproveitar a rota `PATCH /pcp/etapas/:id/pausar` já
   existente para registrar a parada, estendendo-a com o indicador de
   parada planejada/não planejada.

### Requirement 9: Conclusão de Etapa com Bloqueio de Sequência

**User Story:** Como Supervisor de produção, eu quero que o Checkout impeça
a conclusão de uma etapa de acabamento antes da etapa de impressão da mesma
Ordem de Produção estar concluída, para evitar inconsistência no fluxo
produtivo.

#### Acceptance Criteria

1. WHEN um Operador tenta concluir uma Etapa, THE Checkout SHALL verificar
   se todas as Etapas de sequência anterior da mesma Ordem de Produção
   estão com status `CONCLUIDA`.
2. IF existir uma Etapa de sequência anterior da mesma Ordem de Produção que
   não esteja `CONCLUIDA`, THEN THE Checkout SHALL bloquear a conclusão da
   Etapa e informar qual etapa anterior está pendente.
3. WHERE a Etapa a ser concluída for resultado de um desmembramento
   (etapas paralelas legítimas da mesma sequência original), THE Checkout
   SHALL permitir sua conclusão independentemente do status das demais
   partes desmembradas.
4. WHEN um Supervisor autoriza explicitamente a conclusão de uma Etapa
   bloqueada por sequência pendente, THE Checkout SHALL permitir a
   conclusão e registrar a autorização no histórico da Etapa.
5. WHEN a conclusão de uma Etapa passa por todas as validações desta
   especificação e a Ordem de Produção correspondente está com status
   `EM_PRODUCAO`, THE Checkout SHALL reaproveitar a rota
   `PATCH /pcp/etapas/:id/concluir` já existente, incluindo o disparo da
   integração com o WMS quando for a última etapa da Ordem de Produção.
6. IF a Ordem de Produção correspondente à Etapa estiver `CANCELADA` ou a
   conclusão falhar em alguma validação desta especificação, THEN THE
   Checkout SHALL NOT reaproveitar a rota de conclusão, mantendo a Etapa em
   seu status atual.

### Requirement 10: Múltiplos Operadores Simultâneos na Etapa

**User Story:** Como Operador de uma máquina operada por equipe (ex:
coladeira com 2-3 pessoas), eu quero que qualquer membro da equipe possa
registrar apontamentos na mesma etapa, para refletir o trabalho real da
equipe.

#### Acceptance Criteria

1. WHEN um Operador se identifica numa Etapa que já está `EM_ANDAMENTO`
   iniciada por outro Operador, THE Checkout SHALL permitir que esse
   Operador também registre apontamentos naquela Etapa.
2. WHEN um Operador começa a trabalhar numa Etapa, THE Checkout SHALL
   registrar a hora de entrada desse Operador naquela Etapa.
3. WHEN um Operador finaliza sua participação numa Etapa sem concluí-la
   (ex: fim do turno), THE Checkout SHALL registrar a hora de saída desse
   Operador naquela Etapa, preservando os Operadores que permanecerem
   ativos.
4. THE Checkout SHALL exibir, para uma Etapa `EM_ANDAMENTO`, todos os
   Operadores atualmente ativos naquela Etapa.
5. WHEN um Apontamento é registrado numa Etapa com múltiplos Operadores
   ativos, THE Checkout SHALL vincular o Apontamento ao Operador que o
   registrou, mantendo os demais Operadores ativos na Etapa.

### Requirement 11: Apontamento Retroativo e Correção Auditável

**User Story:** Como Operador ou Supervisor, eu quero corrigir um
apontamento lançado incorretamente ou esquecido, sem apagar o registro
original, para preservar a trilha de auditoria da produção.

#### Acceptance Criteria

1. THE Checkout SHALL NOT permitir a exclusão ou sobrescrita de um
   Apontamento já registrado.
2. WHEN um Supervisor autoriza um Apontamento_Retroativo vinculado a um
   Apontamento original, THE Checkout SHALL registrar o novo Apontamento
   com referência ao Apontamento original, o motivo da correção e a
   identificação de quem autorizou.
3. IF um Operador tentar registrar um Apontamento_Retroativo sem autorização
   de um Supervisor, THEN THE Checkout SHALL bloquear o registro até que a
   autorização seja concedida.
4. WHEN um Apontamento_Retroativo é registrado, THE Checkout SHALL
   recalcular os totais da Etapa considerando o Apontamento_Retroativo além
   dos Apontamentos originais.
5. THE Checkout SHALL exibir, no histórico de uma Etapa, tanto o Apontamento
   original quanto qualquer Apontamento_Retroativo vinculado a ele, de forma
   distinguível.

### Requirement 12: Pendência de Falta de Material Durante a Produção

**User Story:** Como Operador, eu quero registrar falta de material
enquanto já estou produzindo uma etapa, para que PCP e almoxarilho sejam
avisados sem eu precisar sair da tela de apontamento.

#### Acceptance Criteria

1. WHEN um Operador registra falta de material numa Etapa `EM_ANDAMENTO`,
   THE Checkout SHALL criar uma Pendência_Material vinculada àquela Etapa,
   sem exigir navegação para outra tela.
2. WHEN uma Pendência_Material é criada, THE Checkout SHALL torná-la visível
   para os perfis de PCP e almoxarifado responsáveis pela empresa daquela
   Etapa.
3. WHEN um Operador registra falta de material durante a produção, THE
   Checkout SHALL também registrar um Apontamento do tipo `PARADA` com
   motivo `FALTA_MATERIAL`, vinculando a parada à Pendência_Material criada.
4. WHEN a Pendência_Material vinculada a uma Etapa é resolvida, THE Checkout
   SHALL permitir que o Operador retome a Etapa normalmente.

### Requirement 13: Alerta de Etapa Pausada Há Muito Tempo

**User Story:** Como Supervisor de produção, eu quero ser alertado quando
uma etapa fica pausada por tempo excessivo sem retomada, para agir antes que
o atraso comprometa a entrega.

#### Acceptance Criteria

1. WHEN uma Etapa permanece com status `PAUSADA` por mais de 60 minutos sem
   retomada, THE Checkout SHALL sinalizar essa Etapa como alerta de parada
   prolongada.
2. THE Checkout SHALL exibir as Etapas em alerta de parada prolongada de
   forma destacada na visão do Supervisor.
3. WHEN uma Etapa em alerta de parada prolongada é retomada ou concluída, THE
   Checkout SHALL remover o alerta associado a essa Etapa.

### Requirement 14: Responsividade e Usabilidade da Interface

**User Story:** Como Operador usando o Checkout em ambiente industrial, eu
quero uma interface simples e com botões grandes, para conseguir registrar
apontamentos rapidamente mesmo com mãos sujas, pouca luz ou pressa.

#### Acceptance Criteria

1. THE Checkout SHALL apresentar layout responsivo, adaptando-se a telas de
   computador, tablet e celular sem perda de funcionalidade.
2. THE Checkout SHALL apresentar, em cada tela de apontamento, uma única
   ação principal em destaque, com controles de toque de tamanho adequado
   para uso com dedo em ambiente industrial.
3. THE Checkout SHALL limitar o número de campos exibidos simultaneamente em
   cada tela de apontamento ao mínimo necessário para aquela ação.
4. THE Checkout SHALL ser acessível via URL própria, sem exigir instalação de
   aplicativo nativo nesta fase.

### Requirement 15: Arquitetura Pronta para Integração Futura com Máquinas

**User Story:** Como responsável técnico pelo Vizor, eu quero que o modelo
de apontamento já diferencie a origem do lançamento, para que integrações
futuras de máquina possam alimentar os mesmos endpoints sem exigir
retrabalho do modelo de dados.

#### Acceptance Criteria

1. THE Checkout SHALL registrar em cada Apontamento sua Fonte_Apontamento
   (`MANUAL_OPERADOR` ou `INTEGRACAO_MAQUINA`).
2. WHEN um Apontamento é registrado através das telas do Checkout por um
   Operador identificado, THE Checkout SHALL gravar a Fonte_Apontamento
   como `MANUAL_OPERADOR`.
3. WHERE uma integração de máquina futura estiver habilitada para um
   Centro_Producao, THE Checkout SHALL aceitar Apontamentos com
   Fonte_Apontamento `INTEGRACAO_MAQUINA` pelos mesmos endpoints internos
   usados para apontamentos manuais.
4. THE modelo de dados do Checkout SHALL permitir a ausência de um Operador
   identificado num Apontamento cuja Fonte_Apontamento seja
   `INTEGRACAO_MAQUINA`.

### Requirement 16: Histórico e Auditoria de Apontamentos

**User Story:** Como Supervisor ou PCP, eu quero consultar o histórico
completo de apontamentos de uma etapa ou de um terminal, para acompanhar o
que aconteceu na produção e investigar divergências.

#### Acceptance Criteria

1. THE Checkout SHALL disponibilizar, para cada Etapa, um histórico
   cronológico de todos os Apontamentos registrados, incluindo Operador,
   tipo, quantidade, motivo e horário.
2. THE Checkout SHALL registrar, para cada evento de autenticação de
   Sessão_Terminal, identificação de Operador e autorização de Supervisor,
   uma entrada no SecurityAuditLog com horário, Terminal e resultado.
3. WHEN um Apontamento_Retroativo é consultado no histórico, THE Checkout
   SHALL exibir o vínculo com o Apontamento original e a autorização
   correspondente.
4. THE Checkout SHALL permitir a um Supervisor consultar o histórico de
   apontamentos de qualquer Etapa da empresa vinculada à sua Sessão_Terminal
   ou ao seu Usuario.

### Requirement 17: Isolamento Multi-tenant

**User Story:** Como responsável técnico pelo Vizor, eu quero que todo
lançamento do Checkout seja isolado por empresa, para evitar vazamento de
dados entre empresas diferentes do mesmo banco.

#### Acceptance Criteria

1. THE Checkout SHALL filtrar toda consulta a Etapa, Apontamento,
   Pendência_Material e Sessão_Terminal pela empresa vinculada ao
   Token_Checkook da requisição.
2. IF uma requisição do Checkout referenciar uma Etapa que não pertença à
   empresa do Token_Checkout, THEN THE Checkout SHALL responder como se a
   Etapa não existisse, sem revelar sua existência em outra empresa.
3. WHEN um novo registro é criado pelo Checkout (Apontamento,
   Pendência_Material, Sessão_Terminal), THE Checkout SHALL gravar o
   `empresaId` da entidade de negócio real (a empresa da Ordem de Produção
   ou do Centro_Producao), não apenas o `empresaId` do usuário que
   autenticou a ação.

## Fora de Escopo / Considerações Futuras

As fases abaixo foram discutidas com o usuário como parte do parecer
completo de mercado, mas **não fazem parte desta especificação** (Fase 1).
Ficam registradas aqui para planejamento futuro:

- **Fase 2 — Leitor de código de barras/QR**: leitura de código de barras
  ou QR da Ordem de Produção via leitor USB/Bluetooth (funcionando como
  teclado, com campo de foco automático aceitando o scan como texto +
  Enter).
- **Fase 3 — PWA com fila offline**: aplicação instalável (ícone na tela
  inicial, tela cheia) com fila local de ações e sincronização automática
  quando a rede voltar, para operação em ambientes de rede instável ou
  intermitente no chão de fábrica.
- **Fase 4 — Integração real com máquinas via JDF/JMF**: conexão real com
  máquinas gráficas (Heidelberg Prinect, BOBST, KBA, Komori) usando o padrão
  JDF/JMF (CIP4), alimentando o Checkout via Fonte_Apontamento
  `INTEGRACAO_MAQUINA` (arquitetura já prevista no Requirement 15).
  Complementarmente, considerar OPC-UA (genérico, bidirecional) e MTConnect
  (leitura, mais focado em máquinas-ferramenta CNC) conforme o parque de
  máquinas a integrar.
- **Fase 5 — Retrofit IoT para máquinas legadas**: sensores óticos/
  magnéticos de pulso com gateway MQTT/HTTP, ou visão computacional por
  câmera, para máquinas antigas sem interface digital de comunicação.
