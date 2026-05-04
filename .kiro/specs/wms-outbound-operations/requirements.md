# Documento de Requisitos — Operações Outbound WMS

## Introdução

Este documento especifica os requisitos para o módulo de operações outbound (saída) do VisioFab WMS, cobrindo o fluxo completo de Separação (Picking) → Embalagem (Packing) → Carregamento (Loading). O módulo deve suportar operação dual-mode: modo manual (papel impresso + digitalização/OCR) e modo mobile/coletor (leitura de código de barras em tempo real). O objetivo é permitir que armazéns com diferentes níveis de maturidade tecnológica operem com eficiência, desde operadores com prancheta até coletores de dados.

## Glossário

- **Sistema_WMS**: O sistema VisioFab WMS (backend Fastify + Prisma + PostgreSQL, frontend Next.js + Mantine UI)
- **Operador**: Funcionário do armazém que executa operações físicas (separação, embalagem, carregamento)
- **Conferente**: Funcionário responsável por conferir quantidades e produtos
- **Coletor**: Dispositivo móvel ou smartphone com leitor de código de barras usado pelo Operador
- **OS**: Ordem de Serviço WMS (model OrdemServicoWms) que rastreia operações com funcionário, horários e status
- **Onda_Separacao**: Agrupamento de pedidos de venda para separação em lote (model OndaSeparacao)
- **Ordem_Separacao**: Subdivisão da onda atribuída a um Operador com itens a separar (model OrdemSeparacao)
- **Item_Separacao**: Item individual a ser separado com endereço de origem, produto e quantidade (model ItemSeparacao)
- **Volume**: Unidade de embalagem (caixa, palete, fardo) que agrupa itens separados (model Volume)
- **Carregamento**: Registro de carga vinculado a doca e veículo que agrupa volumes (model Carregamento)
- **Romaneio**: Documento de manifesto de carga listando todos os volumes de um Carregamento
- **Modo_Manual**: Modo de operação onde o Operador recebe uma folha impressa, preenche manualmente e depois digitaliza os dados
- **Modo_Coletor**: Modo de operação onde o Operador usa Coletor para escanear códigos de barras e confirmar operações em tempo real
- **OCR_Service**: Serviço de reconhecimento óptico de caracteres que lê dados manuscritos de folhas escaneadas/fotografadas
- **Endereco_Barcode**: Código de barras físico afixado no endereço/localização do armazém
- **Produto_Barcode**: Código de barras do produto (EAN, Code128 ou Code39)
- **Ficha_Operacional**: Folha impressa com dados da operação e campos em branco para preenchimento manual
- **Validacao_Localizacao**: Processo de escanear o Endereco_Barcode para confirmar que o Operador está fisicamente no local correto

## Requisitos

### Requisito 1: Operação Dual-Mode (Manual e Coletor)

**User Story:** Como gestor de armazém, eu quero que todas as operações WMS suportem tanto modo manual (papel) quanto modo coletor (barcode scanner), para que eu possa operar com diferentes níveis de tecnologia disponível.

#### Critérios de Aceitação

1. THE Sistema_WMS SHALL suportar dois modos de operação configuráveis por parâmetro: Modo_Manual e Modo_Coletor
2. WHEN o parâmetro WMS_MODO_OPERACAO estiver configurado como "MANUAL", THE Sistema_WMS SHALL habilitar a geração de Ficha_Operacional impressa e a interface de digitalização de dados
3. WHEN o parâmetro WMS_MODO_OPERACAO estiver configurado como "COLETOR", THE Sistema_WMS SHALL habilitar a interface de leitura de código de barras com foco automático no campo de entrada
4. WHEN o parâmetro WMS_MODO_OPERACAO estiver configurado como "AMBOS", THE Sistema_WMS SHALL permitir que o Operador escolha o modo de operação ao iniciar cada OS
5. THE Sistema_WMS SHALL aplicar o padrão dual-mode para as operações de Conferência, Endereçamento, Separação, Embalagem e Carregamento

### Requisito 2: Validação de Localização por Código de Barras

**User Story:** Como gestor de armazém, eu quero que o operador confirme sua localização física escaneando o código de barras do endereço antes de executar qualquer operação, para garantir que ele está no local correto.

#### Critérios de Aceitação

1. WHEN o Operador iniciar a execução de uma OS no Modo_Coletor, THE Sistema_WMS SHALL exigir a leitura do Endereco_Barcode antes de permitir qualquer ação sobre itens
2. WHEN o Endereco_Barcode escaneado corresponder ao endereço esperado da OS, THE Sistema_WMS SHALL liberar a operação e registrar o timestamp da validação
3. WHEN o Endereco_Barcode escaneado não corresponder ao endereço esperado, THE Sistema_WMS SHALL exibir alerta visual e sonoro informando o endereço correto e bloquear a operação
4. WHILE o Operador estiver executando uma OS com múltiplos endereços, THE Sistema_WMS SHALL exigir nova Validacao_Localizacao a cada mudança de endereço
5. THE Sistema_WMS SHALL registrar no log de auditoria cada Validacao_Localizacao realizada, incluindo endereço esperado, endereço escaneado e resultado

### Requisito 3: Fichas Operacionais Impressas

**User Story:** Como operador de armazém, eu quero imprimir fichas com os dados da operação e campos em branco para preenchimento manual, para poder trabalhar sem depender de dispositivos eletrônicos.

#### Critérios de Aceitação

1. WHEN o Operador solicitar impressão de ficha de separação, THE Sistema_WMS SHALL gerar uma Ficha_Operacional contendo: número da OS, lista de itens com produto, endereço de origem, quantidade solicitada e campo em branco para quantidade separada
2. WHEN o Operador solicitar impressão de ficha de embalagem, THE Sistema_WMS SHALL gerar uma Ficha_Operacional contendo: número da OS, lista de itens por volume, campos em branco para peso e dimensões
3. WHEN o Operador solicitar impressão de romaneio de carregamento, THE Sistema_WMS SHALL gerar uma Ficha_Operacional contendo: dados do veículo, doca, lista de volumes com sequência de carga e campo de confirmação
4. WHEN o Operador solicitar impressão de ficha de endereçamento, THE Sistema_WMS SHALL gerar uma Ficha_Operacional contendo: lista de itens recebidos, quantidade e campo em branco para endereço de destino
5. THE Sistema_WMS SHALL gerar as Fichas_Operacionais em formato HTML para impressão via navegador e em formato ZPL para impressoras térmicas Zebra
6. THE Sistema_WMS SHALL incluir um código de barras identificador único em cada Ficha_Operacional para permitir vinculação posterior com a OS digital

### Requisito 4: Digitalização de Fichas via OCR

**User Story:** Como operador de armazém, eu quero fotografar a ficha preenchida manualmente e ter os dados reconhecidos automaticamente pelo sistema, para eliminar a etapa de digitação manual.

#### Critérios de Aceitação

1. WHEN o Operador enviar uma imagem (foto ou scan) de uma Ficha_Operacional preenchida, THE Sistema_WMS SHALL processar a imagem através do OCR_Service para extrair os dados manuscritos
2. WHEN o OCR_Service extrair dados da imagem, THE Sistema_WMS SHALL pré-preencher os campos correspondentes na interface digital com os valores reconhecidos
3. WHEN o OCR_Service não conseguir reconhecer um campo com confiança acima de 80%, THE Sistema_WMS SHALL destacar o campo visualmente e solicitar revisão manual do Operador
4. THE Sistema_WMS SHALL permitir que o Operador revise e corrija todos os valores extraídos pelo OCR_Service antes de confirmar a operação
5. WHEN o Operador confirmar os dados extraídos, THE Sistema_WMS SHALL registrar a origem dos dados como "OCR" no log de auditoria
6. THE Sistema_WMS SHALL aceitar imagens nos formatos JPEG, PNG e PDF com resolução mínima de 300 DPI

### Requisito 5: Processo de Separação (Picking)

**User Story:** Como operador de armazém, eu quero receber instruções claras de quais produtos separar, de quais endereços, e confirmar cada item separado, para garantir acuracidade na separação.

#### Critérios de Aceitação

1. WHEN uma Onda_Separacao for iniciada, THE Sistema_WMS SHALL gerar itens de separação com endereço de origem selecionado por FEFO ou FIFO conforme dados logísticos do produto
2. WHEN o Operador iniciar uma Ordem_Separacao no Modo_Coletor, THE Sistema_WMS SHALL apresentar os itens ordenados por rota otimizada de coleta (rua → prédio → nível)
3. WHEN o Operador escanear o Produto_Barcode de um item, THE Sistema_WMS SHALL validar que o produto corresponde ao Item_Separacao atual
4. WHEN o Produto_Barcode escaneado não corresponder ao item esperado, THE Sistema_WMS SHALL exibir alerta visual e sonoro e bloquear a confirmação
5. WHEN o Operador confirmar a quantidade separada de um item, THE Sistema_WMS SHALL atualizar o campo quantidadeSeparada do Item_Separacao e registrar o timestamp
6. WHEN o Operador registrar quantidade separada menor que a solicitada, THE Sistema_WMS SHALL solicitar o motivo da divergência (PRODUTO_NAO_ENCONTRADO, QUANTIDADE_INSUFICIENTE ou AVARIA)
7. WHEN todos os itens de uma Ordem_Separacao forem separados, THE Sistema_WMS SHALL atualizar o status da Ordem_Separacao para CONCLUIDA
8. THE Sistema_WMS SHALL suportar separação por pedido individual (pick-by-order) e separação por onda completa (pick-by-wave)
9. WHEN o Operador operar no Modo_Manual, THE Sistema_WMS SHALL permitir a entrada de quantidades separadas via digitação no formulário ou via OCR de Ficha_Operacional

### Requisito 6: Processo de Embalagem (Packing)

**User Story:** Como operador de embalagem, eu quero agrupar os itens separados em volumes (caixas/paletes), registrar peso e dimensões, e imprimir etiquetas de volume, para preparar a carga para expedição.

#### Critérios de Aceitação

1. WHEN a separação de uma Onda_Separacao for concluída, THE Sistema_WMS SHALL habilitar o processo de embalagem para os itens separados
2. WHEN o Operador criar um novo Volume, THE Sistema_WMS SHALL gerar um código sequencial único vinculado à Onda_Separacao e ao pedido de venda
3. WHEN o Operador escanear o Produto_Barcode de um item separado no Modo_Coletor, THE Sistema_WMS SHALL vincular o item ao Volume ativo e atualizar a quantidade embalada
4. WHEN o Operador tentar vincular um item que não pertence à Onda_Separacao do Volume, THE Sistema_WMS SHALL rejeitar a operação e exibir mensagem de erro
5. WHEN o Operador registrar peso e dimensões do Volume, THE Sistema_WMS SHALL validar que os valores são positivos e atualizar o registro do Volume
6. WHEN o Operador finalizar um Volume, THE Sistema_WMS SHALL gerar etiqueta do Volume em formato HTML e ZPL contendo código de barras, tipo, peso e quantidade de itens
7. WHEN todos os itens separados de uma Onda_Separacao forem embalados em volumes, THE Sistema_WMS SHALL atualizar o status da Onda_Separacao para EMBALADA
8. THE Sistema_WMS SHALL permitir que o Operador visualize a lista de itens pendentes de embalagem agrupados por pedido de venda

### Requisito 7: Processo de Carregamento (Loading)

**User Story:** Como operador de expedição, eu quero carregar os volumes no veículo correto na sequência adequada, confirmando cada volume escaneado, para garantir que a carga está completa e correta.

#### Critérios de Aceitação

1. WHEN o Operador criar um Carregamento, THE Sistema_WMS SHALL exigir a vinculação com uma doca e a placa do veículo
2. WHEN o Operador adicionar volumes ao Carregamento, THE Sistema_WMS SHALL registrar a sequência de carga de cada Volume
3. WHEN o Operador escanear o código de barras de um Volume no Modo_Coletor, THE Sistema_WMS SHALL validar que o Volume pertence ao Carregamento e registrar o timestamp de carregamento
4. WHEN o Operador escanear um Volume que não pertence ao Carregamento, THE Sistema_WMS SHALL rejeitar a operação e exibir alerta visual e sonoro
5. WHEN o Operador escanear um Volume fora da sequência esperada, THE Sistema_WMS SHALL exibir aviso informando a sequência correta, permitindo que o Operador prossiga ou corrija
6. WHEN o Operador solicitar impressão do Romaneio, THE Sistema_WMS SHALL gerar documento contendo: dados do veículo, transportadora, doca, lista completa de volumes com sequência, peso total e quantidade total de itens
7. WHEN todos os volumes vinculados ao Carregamento forem confirmados como carregados, THE Sistema_WMS SHALL atualizar o status do Carregamento para CONCLUIDO e registrar o timestamp de conclusão
8. THE Sistema_WMS SHALL atualizar o status dos Volumes carregados para CARREGADO

### Requisito 8: Integração com Ordem de Serviço WMS

**User Story:** Como gestor de armazém, eu quero que cada operação outbound gere automaticamente uma OS rastreável com funcionário, horários e status, para controlar a produtividade e rastreabilidade.

#### Critérios de Aceitação

1. WHEN uma Onda_Separacao for iniciada, THE Sistema_WMS SHALL criar automaticamente uma OS do tipo SAIDA com operação SEPARACAO vinculada à onda
2. WHEN o processo de embalagem for iniciado para uma onda, THE Sistema_WMS SHALL criar automaticamente uma OS do tipo SAIDA com operação EMBALAGEM
3. WHEN o processo de carregamento for iniciado, THE Sistema_WMS SHALL criar automaticamente uma OS do tipo SAIDA com operação CARREGAMENTO
4. WHEN um Operador assumir uma OS, THE Sistema_WMS SHALL registrar o funcionário, a hora de início e atualizar o status para EXECUTANDO
5. WHEN uma OS for concluída, THE Sistema_WMS SHALL registrar a hora de fim e calcular o tempo total de execução em minutos
6. THE Sistema_WMS SHALL permitir que múltiplos funcionários sejam vinculados a uma mesma OS através do model OsFuncionarioWms

### Requisito 9: Endereçamento com Modo Dual

**User Story:** Como operador de armazém, eu quero que o processo de endereçamento de mercadorias recebidas também suporte modo manual (ficha impressa) e modo coletor, para manter consistência com as demais operações.

#### Critérios de Aceitação

1. WHEN o Operador iniciar endereçamento no Modo_Coletor, THE Sistema_WMS SHALL exigir Validacao_Localizacao do endereço de destino antes de confirmar cada item
2. WHEN o Operador escanear o Produto_Barcode durante o endereçamento, THE Sistema_WMS SHALL validar que o produto corresponde ao item da nota de entrada
3. WHEN o Operador operar no Modo_Manual, THE Sistema_WMS SHALL permitir impressão de Ficha_Operacional de endereçamento com campos em branco para endereço de destino
4. WHEN o Operador enviar imagem da Ficha_Operacional de endereçamento preenchida, THE Sistema_WMS SHALL processar via OCR_Service e pré-preencher os endereços de destino
5. THE Sistema_WMS SHALL registrar cada movimento de endereçamento no LogMovimentacao com tipo ENDERECAMENTO

### Requisito 10: Conferência de Saída com Modo Dual

**User Story:** Como conferente, eu quero conferir os itens separados tanto via coletor quanto via ficha impressa, para validar que a separação foi realizada corretamente.

#### Critérios de Aceitação

1. WHEN o Conferente iniciar conferência de saída no Modo_Coletor, THE Sistema_WMS SHALL apresentar a lista de itens separados para conferência com foco automático no campo de leitura
2. WHEN o Conferente escanear o Produto_Barcode de um item, THE Sistema_WMS SHALL registrar a quantidade conferida e comparar com a quantidade separada
3. WHEN a quantidade conferida divergir da quantidade separada, THE Sistema_WMS SHALL registrar o resultado como DIVERGENTE com o tipo de divergência (FALTA, EXCESSO ou PRODUTO_ERRADO)
4. WHEN o Conferente operar no Modo_Manual, THE Sistema_WMS SHALL permitir impressão de ficha de conferência com itens e campos em branco para quantidade conferida
5. WHEN todos os itens forem conferidos e aprovados, THE Sistema_WMS SHALL atualizar o status da Onda_Separacao para CONFERIDA

### Requisito 11: Feedback Sensorial no Modo Coletor

**User Story:** Como operador usando coletor, eu quero receber feedback visual e sonoro imediato a cada leitura de código de barras, para saber instantaneamente se a operação foi aceita ou rejeitada.

#### Critérios de Aceitação

1. WHEN uma leitura de código de barras for validada com sucesso, THE Sistema_WMS SHALL emitir feedback sonoro de sucesso e exibir indicador visual verde
2. WHEN uma leitura de código de barras falhar na validação, THE Sistema_WMS SHALL emitir feedback sonoro de erro e exibir indicador visual vermelho com mensagem descritiva
3. WHEN uma leitura de código de barras gerar um aviso (ex: sequência incorreta), THE Sistema_WMS SHALL emitir feedback sonoro de atenção e exibir indicador visual amarelo
4. THE Sistema_WMS SHALL retornar o foco automaticamente para o campo de leitura de código de barras após cada operação concluída

### Requisito 12: Tratamento de Divergências na Separação

**User Story:** Como operador de separação, eu quero registrar divergências encontradas durante a separação (produto não encontrado, quantidade insuficiente, avaria), para que o sistema possa tomar ações corretivas.

#### Critérios de Aceitação

1. WHEN o Operador registrar divergência do tipo PRODUTO_NAO_ENCONTRADO, THE Sistema_WMS SHALL marcar o Item_Separacao como SEPARADO_PARCIAL e registrar o motivo
2. WHEN o Operador registrar divergência do tipo QUANTIDADE_INSUFICIENTE, THE Sistema_WMS SHALL registrar a quantidade efetivamente separada e o motivo da divergência
3. WHEN o Operador registrar divergência do tipo AVARIA, THE Sistema_WMS SHALL registrar a quantidade avariada e gerar alerta para o gestor
4. WHEN uma Ordem_Separacao for concluída com divergências, THE Sistema_WMS SHALL manter o status como SEPARADO_PARCIAL e notificar o gestor para decisão
5. IF o saldo no endereço de origem for insuficiente para a quantidade solicitada, THEN THE Sistema_WMS SHALL sugerir endereços alternativos com saldo disponível do mesmo produto

### Requisito 13: Impressão de Etiquetas de Volume e Romaneio

**User Story:** Como operador de embalagem e expedição, eu quero imprimir etiquetas para cada volume e o romaneio completo do carregamento, para identificar fisicamente cada unidade de carga.

#### Critérios de Aceitação

1. WHEN o Operador solicitar impressão de etiqueta de Volume, THE Sistema_WMS SHALL gerar etiqueta contendo: código de barras do volume, tipo (CAIXA/PALETE/FARDO), peso, quantidade de itens e número do pedido de venda
2. WHEN o Operador solicitar impressão de Romaneio, THE Sistema_WMS SHALL gerar documento contendo: número do Carregamento, dados do veículo e transportadora, lista de volumes com peso e dimensões, totalizadores de peso e quantidade
3. THE Sistema_WMS SHALL gerar etiquetas de Volume em formato HTML e ZPL
4. THE Sistema_WMS SHALL gerar o Romaneio em formato HTML para impressão e em formato PDF para envio digital
