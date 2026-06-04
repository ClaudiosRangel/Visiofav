# Documento de Requisitos — Fase 5: Migração e Unificação (VisioFab.Web → Backend Unificado)

## Introdução

Este documento especifica os requisitos para a migração do VisioFab.Web (PCP gráfico atualmente em Firebase/Firestore) para o backend unificado VisioFab.Wms.Back (Fastify + Prisma + PostgreSQL). O objetivo é eliminar a duplicidade de dados e garantir que todos os módulos operem sobre a mesma base, mantendo o frontend Next.js do VisioFab.Web funcional com mínimas alterações visuais. Também inclui a unificação do fluxo ponta-a-ponta (Pedido de Venda → Produção → Expedição) e a consolidação da autenticação.

## Glossário

- **Sistema**: O backend VisioFab.Wms.Back (Fastify + Prisma + PostgreSQL)
- **VisioFab.Web**: Frontend Next.js do PCP gráfico, atualmente usando Firebase Auth e Firestore
- **VisioFab.Wms.Front**: Frontend Next.js do ERP/WMS, usando JWT do backend
- **Firebase**: Plataforma Google usada atualmente pelo VisioFab.Web para auth e banco de dados
- **Firestore**: Banco de dados NoSQL do Firebase onde estão os dados de produção atuais
- **wmsApiClient**: Módulo já existente no VisioFab.Web que faz requisições ao backend WMS
- **MigracaoDados**: Processo de transferência de dados do Firestore para PostgreSQL
- **AdapterAuth**: Camada de compatibilidade que permite o backend aceitar tokens Firebase durante a transição
- **FluxoPontaAPonta**: Ciclo completo: Pedido Venda → OP → Produção → PA no WMS → Separação → Expedição

## Requisitos

### Requisito 1: Adapter de Autenticação Firebase → JWT

**User Story:** Como desenvolvedor, quero que o backend aceite tanto tokens JWT próprios quanto tokens Firebase durante a migração, para que o VisioFab.Web funcione sem interrupção enquanto migramos a autenticação.

#### Critérios de Aceitação

1. THE Sistema SHALL implementar um middleware de autenticação dual que aceita:
   - Token JWT próprio (formato atual do backend) no header `Authorization: Bearer {token}`
   - Token Firebase ID Token no header `Authorization: Bearer {firebaseToken}`
2. THE Sistema SHALL detectar automaticamente o tipo de token (JWT próprio vs Firebase) pela estrutura do payload (Firebase tokens contêm `firebase` no campo `aud` ou `iss` contém `securetoken.google.com`)
3. WHEN um token Firebase válido é recebido, THE Sistema SHALL extrair o email do usuário e buscar o Usuario correspondente no PostgreSQL
4. IF o email do token Firebase não corresponder a nenhum Usuario no PostgreSQL, THEN THE Sistema SHALL retornar HTTP 401 com mensagem "Usuário não encontrado no sistema. Solicite cadastro ao administrador."
5. THE Sistema SHALL manter o middleware dual ativo por um período de transição (configurável via variável de ambiente `FIREBASE_AUTH_ENABLED=true|false`)
6. WHEN `FIREBASE_AUTH_ENABLED=false`, THE Sistema SHALL rejeitar tokens Firebase e aceitar apenas JWT próprio
7. THE Sistema SHALL registrar em log qual tipo de autenticação foi utilizada em cada requisição (para monitorar progresso da migração)

---

### Requisito 2: Script de Migração de Dados Firestore → PostgreSQL

**User Story:** Como administrador, quero migrar os dados existentes do Firestore para o PostgreSQL, para que o histórico de produção não seja perdido.

#### Critérios de Aceitação

1. THE Sistema SHALL fornecer um script de migração (`scripts/migrar-firestore.ts`) que conecta ao Firestore e transfere dados para PostgreSQL
2. THE Script SHALL migrar as seguintes coleções do Firestore para os modelos Prisma correspondentes:
   - `ordens-servico` → OrdemProducao (mapeando campos: numero, produto, quantidade, status, datas, cliente)
   - `processos-producao` → RoteiroProducao + EtapaRoteiro
   - `maquinas` → CentroProducao
   - `produtos` → Produto (merge com produtos existentes por código) + AtributoGrafico
   - `tipos-cartao` → TipoCartao
   - `tipos-cores` → TipoCor
   - `tipos-formato` → TipoFormato
   - `tipos-gramatura` → TipoGramatura
   - `tipos-policromia` → TipoPolicromia
   - `tipos-verniz` → TipoVerniz
   - `clientes` → Cliente (merge com clientes existentes por CNPJ/CPF)
   - `usuarios` → Usuario (merge por email)
3. THE Script SHALL executar em modo dry-run (apenas relatório) ou modo efetivo (com flag `--execute`)
4. THE Script SHALL gerar um relatório de migração com: registros migrados por coleção, registros com conflito (merge), registros com erro, e tempo total
5. THE Script SHALL ser idempotente: executar múltiplas vezes não deve duplicar registros (usar campos únicos como chave de merge)
6. THE Script SHALL preservar os IDs originais do Firestore em um campo `legacyId` para referência cruzada durante a transição
7. IF um registro do Firestore conflitar com um registro existente no PostgreSQL (mesmo código/CNPJ), THEN THE Script SHALL manter o registro do PostgreSQL e registrar o conflito no relatório

---

### Requisito 3: Adaptação do VisioFab.Web para Usar Backend Unificado

**User Story:** Como desenvolvedor, quero adaptar o VisioFab.Web para consumir as APIs do backend unificado em vez do Firestore, para eliminar a duplicidade de dados.

#### Critérios de Aceitação

1. THE VisioFab.Web SHALL substituir todas as chamadas ao `firestoreService.ts` por chamadas ao `wmsApiClient.ts` (que já existe e conecta ao backend)
2. THE VisioFab.Web SHALL mapear as seguintes rotas de serviço:
   - Ordens de Serviço → `GET/POST /api/ordens-producao`
   - Processos de Produção → `GET/POST /api/roteiros-producao`
   - Máquinas → `GET/POST /api/centros-producao`
   - Produtos → `GET/POST /api/produtos` (já existente)
   - Tipos (cartão, cor, formato, etc.) → `GET/POST /api/atributos-graficos/{tipo}`
   - Clientes → `GET/POST /api/clientes` (já existente)
   - Picking → `GET/POST /api/ondas-separacao` (já existente)
   - Conferência Saída → `GET/POST /api/conferencias-saida` (já existente)
   - Expedição → `GET/POST /api/carregamentos` (já existente)
3. THE VisioFab.Web SHALL manter a mesma interface visual (componentes Mantine, layout, navegação) — apenas a camada de dados muda
4. THE VisioFab.Web SHALL usar o header `X-Empresa-Id` (já suportado pelo backend) para contexto multi-tenant
5. THE VisioFab.Web SHALL implementar tratamento de erros consistente com o padrão do backend (campo `message` no JSON de erro)
6. THE VisioFab.Web SHALL remover a dependência do pacote `firebase` do package.json após a migração completa

---

### Requisito 4: Kanban de Produção via API

**User Story:** Como planejador de produção, quero visualizar as OPs em formato Kanban (colunas por status), para gerenciar o fluxo de produção visualmente.

#### Critérios de Aceitação

1. THE Sistema SHALL fornecer um endpoint `GET /api/ordens-producao/kanban` que retorna OPs agrupadas por status em formato adequado para renderização Kanban
2. THE Sistema SHALL retornar para cada coluna (status): lista de OPs com campos resumidos (numero, produto, quantidade, prioridade, dataEntrega, clienteNome, percentualConcluido)
3. THE Sistema SHALL fornecer um endpoint `PATCH /api/ordens-producao/:id/mover-kanban` que permite mover uma OP entre colunas (transição de status) via drag-and-drop
4. THE Sistema SHALL validar as transições de status permitidas ao mover no Kanban (mesmas regras do Requisito 4 da Fase 2)
5. THE Sistema SHALL suportar filtros no Kanban: centroProducaoId, prioridade, clienteId, período
6. THE Sistema SHALL retornar contadores por coluna (total de OPs e soma de quantidades)
7. THE Sistema SHALL ordenar OPs dentro de cada coluna por: prioridade (desc), dataEntregaPrevista (asc)

---

### Requisito 5: Fluxo Ponta-a-Ponta — Pedido de Venda → Produção

**User Story:** Como gestor comercial, quero que ao confirmar um pedido de venda o sistema verifique automaticamente se precisa produzir, para que a produção seja disparada pela demanda sem intervenção manual.

#### Critérios de Aceitação

1. WHEN um PedidoVenda é confirmado (status → CONFIRMADO) e a empresa possui módulo PCP ativo, THE Sistema SHALL verificar para cada item do pedido:
   - Se Estoque.quantidade - Estoque.reservado >= quantidadePedido → item atendido pelo estoque
   - Se não → item precisa de produção
2. WHEN um item precisa de produção e o Produto possui EstruturaProduto ativa, THE Sistema SHALL sugerir a criação de OP (notificação ao PCP, não criação automática)
3. THE Sistema SHALL fornecer um endpoint `GET /api/pedidos-venda/:id/analise-producao` que retorna para cada item: quantidadePedida, estoqueDisponivel, quantidadeAProduzir, tempoEstimadoProducao (baseado no roteiro), e flag `possuiEstrutura`
4. THE Sistema SHALL fornecer um endpoint `POST /api/pedidos-venda/:id/gerar-ops` que cria OPs para todos os itens que precisam de produção (batch)
5. WHEN todas as OPs vinculadas a um PedidoVenda são concluídas e o PA está no estoque, THE Sistema SHALL notificar o módulo de Vendas que o pedido está pronto para separação
6. THE Sistema SHALL atualizar o status do PedidoVenda para `EM_PRODUCAO` quando existirem OPs ativas vinculadas

---

### Requisito 6: Fluxo Ponta-a-Ponta — Produção → Expedição

**User Story:** Como operador de expedição, quero que ao concluir a produção o produto acabado fique automaticamente disponível para separação do pedido de venda, para que a expedição não atrase.

#### Critérios de Aceitação

1. WHEN uma OrdemProducao vinculada a um PedidoVenda é concluída e o PA é endereçado no WMS, THE Sistema SHALL verificar se todos os itens do PedidoVenda estão disponíveis em estoque
2. IF todos os itens estão disponíveis, THE Sistema SHALL:
   - Atualizar PedidoVenda.status para `CONFIRMADO` (pronto para faturamento/separação)
   - Disparar evento `vendas.pedido.pronto_expedicao`
   - Se a empresa possui `usaWms = true` e separação automática configurada, criar OndaSeparacao automaticamente
3. THE Sistema SHALL fornecer um endpoint `GET /api/pedidos-venda/aguardando-producao` que lista pedidos com OPs pendentes, incluindo: pedidoNumero, cliente, itens com status de produção, previsão de conclusão
4. THE Sistema SHALL calcular a previsão de conclusão baseada na programação das OPs vinculadas (maior dataFimPrevista entre as OPs)
5. THE Sistema SHALL manter rastreabilidade completa: PedidoVenda → OrdemProducao → LiberacaoMaterial → ApontamentoProducao → NotaEntrada (PA) → OndaSeparacao → Carregamento

---

### Requisito 7: Dashboard Unificado (PCP + WMS + Vendas)

**User Story:** Como diretor de operações, quero um dashboard que mostre indicadores integrados de vendas, produção e logística, para ter visão completa do negócio.

#### Critérios de Aceitação

1. THE Sistema SHALL fornecer um endpoint `GET /api/dashboard/unificado` que retorna indicadores consolidados:
   - **Vendas**: pedidos pendentes, valor total em carteira, pedidos atrasados
   - **Produção**: OPs em andamento, OPs atrasadas, eficiência (produzido/planejado), percentual de perda
   - **Estoque**: itens abaixo do mínimo, valor total em estoque, giro de estoque
   - **Expedição**: pedidos aguardando separação, carregamentos do dia, entregas atrasadas
   - **Financeiro**: contas a receber vencidas, contas a pagar do dia
2. THE Sistema SHALL aceitar parâmetro de período (dataInicio, dataFim)
3. THE Sistema SHALL retornar dados de tendência (últimos 7 dias ou 30 dias) para gráficos de linha
4. THE Sistema SHALL calcular KPIs específicos da indústria gráfica (quando flags ativos):
   - Percentual médio de apara
   - Eficiência de uso de bobinas (peso consumido / peso total disponibilizado)
   - Lead time médio (pedido → entrega)
5. THE Sistema SHALL filtrar todos os dados pelo empresaId do usuário autenticado

---

### Requisito 8: Acompanhamento de Produção (Visão Cliente)

**User Story:** Como cliente da gráfica, quero acompanhar o status dos meus pedidos em produção, para saber quando estarão prontos sem precisar ligar para a gráfica.

#### Critérios de Aceitação

1. THE Sistema SHALL fornecer um endpoint público (autenticado por token de cliente) `GET /api/acompanhamento/:token` que retorna o status do pedido
2. THE Sistema SHALL gerar um token único por PedidoVenda (campo `tokenAcompanhamento`, UUID) que pode ser compartilhado com o cliente
3. THE Sistema SHALL retornar: numeroPedido, itens com status (Em Produção, Produzido, Em Separação, Expedido), previsão de entrega, e percentual geral de conclusão
4. THE Sistema SHALL NÃO expor informações internas (custos, fornecedores, endereços WMS) na visão do cliente
5. THE Sistema SHALL permitir que o frontend VisioFab.Web gere e envie o link de acompanhamento por email/WhatsApp
6. THE Sistema SHALL atualizar o status automaticamente conforme os eventos internos (OP concluída, separação concluída, carregamento concluído)

---

### Requisito 9: Relatórios Integrados PCP + WMS

**User Story:** Como gestor de operações, quero relatórios que cruzem dados de produção com dados de estoque e expedição, para análise de eficiência operacional.

#### Critérios de Aceitação

1. THE Sistema SHALL fornecer os seguintes relatórios integrados:
   - **Eficiência de Produção**: por centro produtivo, período — tempo produtivo vs tempo disponível, quantidade produzida vs planejada, percentual de perda
   - **Consumo de Materiais**: por OP ou período — previsto (BOM) vs real (apontamentos), variação percentual, custo da variação
   - **Lead Time Completo**: por pedido — data pedido, data início produção, data fim produção, data expedição, tempo total
   - **Giro de Estoque por Classificação**: matéria-prima, intermediário, produto acabado — quantidade média, consumo médio, dias de estoque
   - **Rastreabilidade de Lote**: dado um lote de MP, listar todas as OPs que o consumiram e todos os PAs gerados
2. THE Sistema SHALL aceitar filtros de período, centroProducaoId, produtoId, clienteId em todos os relatórios
3. THE Sistema SHALL retornar dados em formato JSON adequado para renderização de tabelas e gráficos
4. THE Sistema SHALL suportar exportação em formato adequado para o frontend gerar PDF ou Excel
5. THE Sistema SHALL filtrar todos os dados pelo empresaId do usuário autenticado

---

### Requisito 10: Plano de Rollback e Coexistência

**User Story:** Como administrador, quero que a migração seja reversível e que os dois sistemas possam coexistir durante a transição, para minimizar riscos.

#### Critérios de Aceitação

1. THE Sistema SHALL manter o Firebase Auth funcional durante todo o período de transição (via AdapterAuth)
2. THE Sistema SHALL fornecer um script de rollback (`scripts/rollback-migracao.ts`) que exporta dados do PostgreSQL de volta para formato Firestore-compatible (JSON)
3. THE Sistema SHALL manter um flag por empresa `migracaoConcluida` (boolean) que indica se a empresa já foi migrada
4. WHILE `migracaoConcluida = false`, THE Sistema SHALL aceitar ambos os métodos de autenticação para a empresa
5. WHEN `migracaoConcluida = true`, THE Sistema SHALL usar apenas JWT próprio para a empresa
6. THE Sistema SHALL fornecer um endpoint `POST /api/admin/concluir-migracao` (protegido por senha) que:
   - Valida que todos os dados foram migrados (contagem de registros)
   - Define `migracaoConcluida = true` para a empresa
   - Registra a data e usuário que concluiu
7. THE Sistema SHALL manter logs detalhados de todas as operações durante o período de transição para auditoria
8. THE Sistema SHALL permitir que o VisioFab.Web opere em "modo híbrido" durante a transição: telas já migradas usam backend PostgreSQL, telas pendentes continuam no Firestore
