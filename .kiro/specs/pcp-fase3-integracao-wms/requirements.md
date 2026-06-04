# Documento de Requisitos — Fase 3: Integração Bidirecional PCP ↔ WMS

## Introdução

Este documento especifica os requisitos para a integração bidirecional entre o módulo PCP e o módulo WMS dentro do backend unificado VisioFab.Wms.Back. A integração conecta os fluxos de produção com o armazém: liberação de materiais dispara separação no WMS, apontamento de produção gera entrada de produto acabado no WMS, e retorno de sobras reintegra materiais ao estoque. Esta fase depende dos cadastros (Fase 1) e da Ordem de Produção (Fase 2).

## Glossário

- **Sistema**: O backend VisioFab.Wms.Back (Fastify + Prisma + PostgreSQL)
- **Empresa**: Entidade multi-tenant
- **OrdemProducao (OP)**: Ordem de produção (Fase 2)
- **ItemOrdemProducao**: Material necessário para a OP
- **LiberacaoMaterial**: Requisição formal de materiais do almoxarifado para a produção
- **ItemLiberacao**: Cada material solicitado na liberação
- **ApontamentoProducao**: Registro do que foi efetivamente produzido, consumido e perdido
- **OndaSeparacao**: Onda de separação existente no WMS (picking)
- **NotaEntrada**: Nota de entrada existente no WMS (recebimento)
- **Estoque**: Saldo agregado por produto/empresa existente no WMS
- **SaldoEndereco**: Saldo físico por endereço existente no WMS
- **LogMovimentacao**: Log de movimentação de estoque existente no WMS
- **OrdemServicoWms (OS)**: Ordem de serviço operacional do WMS
- **TipoOnda**: Novo enum para diferenciar ondas: VENDA, PRODUCAO, TRANSFERENCIA
- **TipoNotaEntrada**: Novo enum para diferenciar notas: COMPRA, PRODUCAO, TRANSFERENCIA, DEVOLUCAO
- **ReservaProducao**: Reserva lógica de estoque para uma OP específica

## Requisitos

### Requisito 1: Liberação de Material — Criação da Requisição

**User Story:** Como planejador de produção, quero liberar materiais de uma OP para o almoxarifado, para que o WMS inicie a separação e entrega dos insumos na área de produção.

#### Critérios de Aceitação

1. THE Sistema SHALL fornecer um endpoint `POST /api/liberacoes-material` que cria uma LiberacaoMaterial com os campos: ordemProducaoId (obrigatório), itens (array de: itemOrdemProducaoId, quantidadeSolicitada), centroProducaoDestinoId (obrigatório — onde entregar o material), observacoes (opcional), e tipo (enum: TOTAL, PARCIAL)
2. WHEN tipo = TOTAL, THE Sistema SHALL incluir todos os ItemOrdemProducao com quantidade pendente (quantidadeNecessaria - quantidadeLiberada > 0)
3. WHEN tipo = PARCIAL, THE Sistema SHALL incluir apenas os itens explicitamente informados no array
4. THE Sistema SHALL validar que a OP está com status `LIBERADA` ou `EM_PRODUCAO`
5. THE Sistema SHALL validar que a quantidadeSolicitada de cada item não excede (quantidadeNecessaria - quantidadeLiberada) do ItemOrdemProducao
6. WHEN a LiberacaoMaterial é criada, THE Sistema SHALL atribuir um número sequencial por empresa e definir status = `PENDENTE`
7. THE Sistema SHALL atualizar o campo `quantidadeLiberada` de cada ItemOrdemProducao correspondente
8. THE Sistema SHALL registrar: dataLiberacao, usuarioId que autorizou, e ordemProducaoId

---

### Requisito 2: Liberação de Material → Onda de Separação WMS

**User Story:** Como operador de armazém, quero que a liberação de materiais do PCP gere automaticamente uma onda de separação no WMS, para que eu possa separar os insumos usando o fluxo padrão de picking.

#### Critérios de Aceitação

1. WHEN uma LiberacaoMaterial é criada e a empresa possui `usaWms = true`, THE Sistema SHALL criar automaticamente uma OndaSeparacao com tipoOnda = `PRODUCAO`
2. THE Sistema SHALL criar ItemSeparacao para cada ItemLiberacao, com: produtoId, quantidade, enderecoOrigemId (determinado pelo motor de separação existente — FEFO/FIFO), e enderecoDestinoId = null (entrega na produção, não em endereço WMS)
3. THE Sistema SHALL aplicar as mesmas regras de separação existentes (rota de coleta, FEFO para tintas/químicos, FIFO para papéis)
4. THE Sistema SHALL criar uma OrdemServicoWms com operacao = `SEPARACAO_PRODUCAO` vinculada à onda
5. WHEN a OndaSeparacao de produção é concluída (todos os itens separados), THE Sistema SHALL atualizar LiberacaoMaterial.status para `SEPARADA`
6. WHEN o operador confirma a entrega dos materiais no centro produtivo, THE Sistema SHALL atualizar LiberacaoMaterial.status para `ENTREGUE` e registrar dataEntrega
7. THE Sistema SHALL decrementar Estoque.quantidade e SaldoEndereco.quantidade ao confirmar a separação (mesmo fluxo do picking de vendas)
8. THE Sistema SHALL registrar LogMovimentacao com tipo = `SEPARACAO_PRODUCAO` para cada movimentação

---

### Requisito 3: Reserva de Estoque para Produção

**User Story:** Como planejador de produção, quero que ao liberar uma OP o sistema reserve os materiais no estoque, para que outras operações não consumam o que já está comprometido com a produção.

#### Critérios de Aceitação

1. WHEN uma OrdemProducao transiciona para status `LIBERADA`, THE Sistema SHALL criar registros de ReservaProducao para cada ItemOrdemProducao com: produtoId, quantidade, ordemProducaoId, status = ATIVA
2. THE Sistema SHALL incrementar Estoque.reservado pela quantidade de cada material reservado
3. THE Sistema SHALL validar que (Estoque.quantidade - Estoque.reservado) >= quantidadeNecessaria antes de permitir a reserva
4. IF o saldo livre for insuficiente para algum material, THEN THE Sistema SHALL retornar a lista de materiais com falta e permitir liberação parcial (apenas dos materiais disponíveis) ou forçar com flag `ignorarFalta`
5. WHEN a LiberacaoMaterial é concluída (status ENTREGUE), THE Sistema SHALL decrementar Estoque.reservado pela quantidade efetivamente entregue e decrementar Estoque.quantidade
6. WHEN uma OP é cancelada, THE Sistema SHALL liberar todas as reservas ativas (decrementar Estoque.reservado)
7. THE Sistema SHALL considerar ReservaProducao no cálculo de "saldo disponível" retornado pelo endpoint de verificação de materiais (Fase 2, Req 6)

---

### Requisito 4: Apontamento de Produção

**User Story:** Como operador de produção, quero registrar o que foi produzido em cada etapa, para que o sistema saiba o progresso real da OP e possa atualizar o estoque.

#### Critérios de Aceitação

1. THE Sistema SHALL fornecer um endpoint `POST /api/apontamentos-producao` que cria um ApontamentoProducao com os campos: ordemProducaoId (obrigatório), etapaOrdemProducaoId (opcional — se vinculado a uma etapa específica), centroProducaoId (obrigatório), quantidadeProduzida (decimal > 0), quantidadeRejeitada (decimal >= 0, default 0), dataInicio (datetime), dataFim (datetime), funcionarioId (opcional — operador), observacoes (opcional)
2. THE Sistema SHALL validar que a OP está com status `LIBERADA` ou `EM_PRODUCAO`
3. WHEN o primeiro apontamento é registrado para uma OP com status `LIBERADA`, THE Sistema SHALL transicionar o status para `EM_PRODUCAO`
4. THE Sistema SHALL acumular quantidadeProduzida no campo `quantidadeProduzidaTotal` da OrdemProducao
5. WHEN quantidadeProduzidaTotal >= quantidade da OP, THE Sistema SHALL permitir (mas não forçar) a conclusão da OP
6. THE Sistema SHALL calcular e armazenar: tempoProducaoMinutos = diferença entre dataFim e dataInicio
7. THE Sistema SHALL atualizar o status da EtapaOrdemProducao para `EM_ANDAMENTO` no primeiro apontamento e `CONCLUIDA` quando a quantidade da etapa for atingida
8. THE Sistema SHALL registrar LogMovimentacao com tipo = `PRODUCAO` para rastreabilidade

---

### Requisito 5: Apontamento → Entrada de Produto Acabado no WMS

**User Story:** Como gestor de produção, quero que ao concluir a produção o produto acabado entre automaticamente no estoque WMS, para que fique disponível para venda e expedição.

#### Critérios de Aceitação

1. WHEN um ApontamentoProducao é registrado para a última etapa do roteiro (ou quando a OP é concluída) e a empresa possui `usaWms = true`, THE Sistema SHALL criar uma NotaEntrada com tipoNotaEntrada = `PRODUCAO`
2. THE NotaEntrada de produção SHALL conter: fornecedorId = null (produção interna), ordemProducaoId (referência), itens com produtoId do produto acabado e quantidade produzida, e status = `PENDENTE`
3. THE Sistema SHALL seguir o fluxo WMS existente: NotaEntrada → ConferenciaEntrada → Endereçamento
4. IF a empresa possui endereçamento automático configurado, THEN THE Sistema SHALL disparar o endereçamento inteligente automaticamente após a conferência
5. WHEN o endereçamento é concluído, THE Sistema SHALL incrementar Estoque.quantidade e SaldoEndereco.quantidade para o produto acabado
6. THE Sistema SHALL registrar LogMovimentacao com tipo = `ENTRADA_PRODUCAO`
7. THE Sistema SHALL atualizar o status da OP para `CONCLUIDA` quando toda a quantidade produzida estiver endereçada no WMS
8. THE Sistema SHALL gerar etiquetas de identificação (código de barras) para o produto acabado usando o módulo de etiquetas existente

---

### Requisito 6: Registro de Consumo Real de Materiais

**User Story:** Como operador de produção, quero registrar o consumo real de matérias-primas (que pode diferir do previsto na BOM), para que o custo real da OP seja calculado corretamente.

#### Critérios de Aceitação

1. THE Sistema SHALL fornecer um endpoint `POST /api/apontamentos-producao/:id/consumos` que registra o consumo real de materiais vinculado a um apontamento, com array de: produtoId, quantidadeConsumida, lote (opcional), motivoDiferenca (obrigatório se diferir > 10% do previsto)
2. THE Sistema SHALL atualizar o campo `quantidadeConsumida` de cada ItemOrdemProducao correspondente
3. IF quantidadeConsumida > quantidadeLiberada para algum item, THEN THE Sistema SHALL registrar um alerta de consumo excedente
4. THE Sistema SHALL calcular a variação percentual: `((consumoReal - consumoPrevisto) / consumoPrevisto) × 100` e armazenar no apontamento
5. THE Sistema SHALL permitir registro de consumo de materiais não previstos na BOM (consumo extra) com justificativa obrigatória
6. THE Sistema SHALL usar os dados de consumo real para cálculo de custo da OP (custoReal = Σ(quantidadeConsumida × custoUnitario))

---

### Requisito 7: Registro de Perdas e Refugo

**User Story:** Como operador de produção, quero registrar perdas de material (acerto de máquina, refugo, aparas), para que o estoque reflita a realidade e o custo de produção seja preciso.

#### Critérios de Aceitação

1. THE Sistema SHALL fornecer um endpoint `POST /api/apontamentos-producao/:id/perdas` que registra perdas com: produtoId (material perdido), quantidade, tipoPerdaId (enum: ACERTO_MAQUINA, REFUGO, APARA, DEFEITO, VENCIDO, OUTRO), centroProducaoId, observacoes (obrigatório)
2. THE Sistema SHALL acumular as perdas no campo `quantidadePerda` do ItemOrdemProducao correspondente
3. THE Sistema SHALL decrementar Estoque.quantidade pelo valor da perda (material destruído/inutilizado)
4. THE Sistema SHALL registrar LogMovimentacao com tipo = `PERDA_PRODUCAO`
5. THE Sistema SHALL fornecer um relatório de perdas por: período, centroProducao, tipoPerdaId, produtoId, ordemProducaoId
6. THE Sistema SHALL calcular o percentual de perda real vs previsto (percentualPerda da BOM) para análise de eficiência

---

### Requisito 8: Retorno de Sobras ao WMS

**User Story:** Como operador de produção, quero devolver ao almoxarifado os materiais que sobraram da produção, para que voltem ao estoque disponível.

#### Critérios de Aceitação

1. THE Sistema SHALL fornecer um endpoint `POST /api/liberacoes-material/:id/retornos` que registra retorno de materiais com array de: produtoId, quantidadeRetornada, pesoRealKg (opcional — para bobinas), enderecoDestinoId (opcional — se o operador souber onde guardar), observacoes
2. WHEN um retorno é registrado e a empresa possui `usaWms = true`, THE Sistema SHALL criar uma movimentação de entrada no WMS com tipo = `RETORNO_PRODUCAO`
3. IF o material retornado é uma bobina parcialmente consumida (produto com controle de peso), THE Sistema SHALL gerar um novo código de barras único vinculado ao código original (sufixo -R01, -R02, etc.) e registrar o novo peso
4. THE Sistema SHALL incrementar Estoque.quantidade e SaldoEndereco.quantidade pelo valor retornado
5. IF enderecoDestinoId não for informado e a empresa possui endereçamento automático, THE Sistema SHALL usar o motor de endereçamento inteligente para sugerir o endereço
6. THE Sistema SHALL atualizar o campo `quantidadeDevolvida` do ItemOrdemProducao correspondente
7. THE Sistema SHALL registrar LogMovimentacao com tipo = `RETORNO_PRODUCAO`
8. THE Sistema SHALL decrementar a ReservaProducao correspondente pela quantidade retornada

---

### Requisito 9: Eventos Internos de Sincronização

**User Story:** Como desenvolvedor, quero que os módulos PCP e WMS se comuniquem via eventos internos, para que as ações em um módulo disparem reações automáticas no outro sem acoplamento direto.

#### Critérios de Aceitação

1. THE Sistema SHALL implementar um barramento de eventos interno (EventEmitter ou similar) com os seguintes eventos:
   - `pcp.op.liberada` → dispara reserva de estoque
   - `pcp.liberacao.criada` → dispara criação de onda de separação
   - `wms.separacao_producao.concluida` → atualiza status da liberação
   - `pcp.apontamento.concluido` → dispara entrada de PA no WMS
   - `pcp.retorno.registrado` → dispara endereçamento de retorno
   - `wms.estoque.abaixo_minimo` → notifica PCP para verificar OPs pendentes
   - `vendas.pedido.confirmado` → verifica necessidade de produção
   - `compras.recebimento.concluido` → verifica se libera OPs aguardando MP
2. EACH evento SHALL conter: tipo, timestamp, empresaId, payload com dados relevantes, e correlationId para rastreabilidade
3. THE Sistema SHALL registrar cada evento processado em uma tabela de log (EventoInterno) com: tipo, payload, status (PROCESSADO, ERRO), dataProcessamento, erro (se houver)
4. IF o processamento de um evento falhar, THEN THE Sistema SHALL registrar o erro e não bloquear o fluxo principal (processamento assíncrono e resiliente)
5. THE Sistema SHALL disparar webhooks externos (se configurados) para os mesmos eventos, usando o módulo de webhooks existente
6. THE Sistema SHALL garantir idempotência: processar o mesmo evento duas vezes não deve gerar duplicidade de registros

---

### Requisito 10: Tipo de Onda e Tipo de Nota — Diferenciação

**User Story:** Como operador de armazém, quero diferenciar ondas de separação de venda das de produção, para que eu saiba a prioridade e o destino de cada operação.

#### Critérios de Aceitação

1. THE Sistema SHALL adicionar o campo `tipoOnda` ao modelo OndaSeparacao com valores: `VENDA` (default para ondas existentes), `PRODUCAO`, `TRANSFERENCIA`
2. THE Sistema SHALL adicionar o campo `tipoNotaEntrada` ao modelo NotaEntrada com valores: `COMPRA` (default para notas existentes), `PRODUCAO`, `TRANSFERENCIA`, `DEVOLUCAO`
3. THE Sistema SHALL permitir filtrar ondas de separação por tipoOnda nos endpoints de listagem existentes
4. THE Sistema SHALL permitir filtrar notas de entrada por tipoNotaEntrada nos endpoints de listagem existentes
5. THE Sistema SHALL exibir o tipo de forma visual diferenciada no frontend (badge colorido)
6. THE Sistema SHALL manter compatibilidade retroativa: ondas e notas existentes sem o campo preenchido são tratadas como VENDA e COMPRA respectivamente
7. WHEN uma onda de tipo PRODUCAO é criada, THE Sistema SHALL vincular o campo `ordemProducaoId` e `liberacaoMaterialId` para rastreabilidade

---

### Requisito 11: Consulta de Estoque para PCP

**User Story:** Como planejador de produção, quero consultar o estoque de matérias-primas com visão de reservas por OP, para tomar decisões de programação informadas.

#### Critérios de Aceitação

1. THE Sistema SHALL fornecer um endpoint `GET /api/pcp/estoque-materiais` que retorna para cada produto de classificação MATERIA_PRIMA ou INSUMO: produtoId, descricao, unidade, estoqueTotal, reservadoVendas, reservadoProducao (soma de ReservaProducao ativas), disponivel (total - reservadoVendas - reservadoProducao), pontoReposicao (do DadosLogisticos), situacao (NORMAL, BAIXO, CRITICO)
2. THE Sistema SHALL aceitar filtros: classificacaoPcp, produtoId, situacao, e busca por texto (código ou descrição)
3. THE Sistema SHALL calcular situacao como: CRITICO se disponivel <= 0, BAIXO se disponivel <= pontoReposicao, NORMAL caso contrário
4. THE Sistema SHALL fornecer um endpoint `GET /api/pcp/estoque-materiais/:produtoId/reservas` que detalha todas as reservas ativas: ordemProducaoId, opNumero, quantidade reservada, dataLiberacao
5. THE Sistema SHALL filtrar todos os resultados pelo empresaId do usuário autenticado

---

### Requisito 12: Custeio da Ordem de Produção

**User Story:** Como controller financeiro, quero que o sistema calcule o custo real de cada OP com base nos materiais consumidos e tempo de máquina, para análise de rentabilidade.

#### Critérios de Aceitação

1. THE Sistema SHALL fornecer um endpoint `GET /api/ordens-producao/:id/custeio` que retorna:
   - custoMateriais: Σ(quantidadeConsumida × custoUnitarioMedio) de cada ItemOrdemProducao
   - custoPerdas: Σ(quantidadePerda × custoUnitarioMedio) de cada perda registrada
   - custoMaoDeObra: Σ(tempoProducaoMinutos / 60 × custoHora) de cada apontamento com funcionário
   - custoMaquina: Σ(tempoProducaoMinutos / 60 × custoHoraCentro) de cada apontamento por centro
   - custoTotal: custoMateriais + custoPerdas + custoMaoDeObra + custoMaquina
   - custoUnitario: custoTotal / quantidadeProduzida
2. THE Sistema SHALL usar o custo médio do Estoque (campo custoMedio do modelo Estoque, se existir) ou o último preço de compra como custoUnitarioMedio
3. THE Sistema SHALL usar o campo custoHora do CentroProducao para cálculo de custo de máquina
4. THE Sistema SHALL permitir comparar custo previsto (baseado na BOM × custos cadastrados) vs custo real (baseado em consumos e apontamentos)
5. THE Sistema SHALL retornar a variação percentual: `((custoReal - custoPrevisto) / custoPrevisto) × 100`
6. THE Sistema SHALL filtrar pelo empresaId do usuário autenticado
