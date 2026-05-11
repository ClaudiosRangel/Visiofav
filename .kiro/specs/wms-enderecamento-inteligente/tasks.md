# Plano de Implementação: Endereçamento Inteligente com Distribuição por Capacidade e Visualização Gráfica

## Visão Geral

Implementação incremental em 6 fases: Serviços Puros (funções sem side-effects) → Rotas Backend → Integração com Fluxo Existente → Frontend Mapa do Armazém → Frontend Integração com Endereçamento → Checkpoint Final. Cada tarefa é independentemente testável e referencia requisitos específicos.

## Tasks

- [ ] 1. Implementar serviço de conversão de unidades
  - [ ] 1.1 Criar src/modules/enderecamento-inteligente/conversor-unidade.service.ts
    - Implementar interface SkuInfo (id, sequencia, qtdEmbalagem, lastro, camada)
    - Implementar interface ConversaoInput (quantidade, skuExpedicao, skuMaster)
    - Implementar interface ConversaoResult (quantidadeMaster, fatorConversao)
    - Implementar função pura `converterParaUnidadeMaster`: quantidadeMaster = quantidade × (skuExpedicao.qtdEmbalagem / skuMaster.qtdEmbalagem)
    - Implementar função pura `selecionarSkuMaster`: selecionar SKU com maior sequência que tenha lastro e camada definidos e não-nulos
    - Lançar erro descritivo se nenhum SKU master encontrado
    - _Requirements: 6.1, 6.2, 6.3_

  - [ ]* 1.2 Escrever property test para conversão de unidades (Property 12)
    - **Property 12: Conversão de unidades**
    - **Validates: Requirements 6.1**
    - Gerar combinações arbitrárias de (quantidade, skuExpedicao.qtdEmbalagem, skuMaster.qtdEmbalagem) com valores positivos
    - Verificar: resultado = quantidade × (skuExpedicao.qtdEmbalagem / skuMaster.qtdEmbalagem)

  - [ ]* 1.3 Escrever property test para seleção do SKU master (Property 13)
    - **Property 13: Seleção do SKU master**
    - **Validates: Requirements 6.2**
    - Gerar listas arbitrárias de SKUs com diferentes sequências e combinações de lastro/camada null/definido
    - Verificar: SKU selecionado tem a maior sequência entre os que possuem lastro e camada definidos

- [ ] 2. Implementar validador de cubagem
  - [ ] 2.1 Criar src/modules/enderecamento-inteligente/validador-cubagem.service.ts
    - Implementar interfaces DimensoesSku, DimensoesEstrutura, CapacidadeNivelConfig, CubagemInput, CubagemResult
    - Implementar função pura `validarCubagem`:
      - Se SKU não tem dimensões → retorna cabe=true (graceful degradation)
      - Se Estrutura não tem dimensões → retorna cabe=true
      - Verificar: sku.largura ≤ estrutura.largura AND sku.altura ≤ estrutura.altura AND sku.comprimento ≤ estrutura.comprimento
      - Se capacidadeNivel é null → permitir sem restrição de peso/volume
      - Verificar peso: (saldoAtualPeso + pesoBruto × quantidade) ≤ pesoMaximo
      - Verificar volume: (saldoAtualVolume + volume × quantidade) ≤ volumeMaximo
    - Retornar motivo e tipo de rejeição quando cabe=false
    - _Requirements: 1.3, 1.4, 1.5, 1.6_

  - [ ]* 2.2 Escrever property test para validação dimensional (Property 2)
    - **Property 2: Validação dimensional de cubagem**
    - **Validates: Requirements 1.3**
    - Gerar dimensões arbitrárias de SKU e Estrutura
    - Verificar: cabe=true sse largura ≤ largura AND altura ≤ altura AND comprimento ≤ comprimento

  - [ ]* 2.3 Escrever property test para rejeição por peso e volume (Property 3)
    - **Property 3: Rejeição por peso e volume**
    - **Validates: Requirements 1.4, 1.5**
    - Gerar combinações de (pesoBruto, volume, quantidade, saldoAtual, limites)
    - Verificar: rejeita sse peso total > pesoMaximo OU volume total > volumeMaximo

  - [ ]* 2.4 Escrever property test para configuração nula (Property 4)
    - **Property 4: Configuração nula permite tudo**
    - **Validates: Requirements 1.6**
    - Gerar qualquer combinação de SKU e quantidade com capacidadeNivel=null
    - Verificar: cabe=true sempre (quando dimensões são compatíveis)

- [ ] 3. Implementar alocador de proximidade
  - [ ] 3.1 Criar src/modules/enderecamento-inteligente/alocador-proximidade.service.ts
    - Implementar interfaces EnderecoCandidate, ProximidadeInput
    - Implementar função pura `ordenarPorProximidade`:
      1. Filtrar candidatos por nivel >= nivelMin AND nivel <= nivelMax
      2. Agrupar por rua (priorizar ruaOrigem)
      3. Dentro de cada rua, ordenar prédios: origem primeiro (diff=0), mesmo lado (diff par crescente: +2, -2, +4, -4), lado oposto (diff ímpar crescente: +1, -1, +3, -3)
      4. Dentro de cada prédio, ordenar por nível e apartamento
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [ ]* 3.2 Escrever property test para ordenação par/ímpar (Property 8)
    - **Property 8: Ordenação por proximidade (par/ímpar)**
    - **Validates: Requirements 3.3, 3.4, 3.5**
    - Gerar conjuntos arbitrários de endereços com prédios variados e um prédio de origem
    - Verificar: prédio origem primeiro, depois mesmo lado (diff par crescente), depois lado oposto (diff ímpar crescente)

  - [ ]* 3.3 Escrever property test para expansão entre ruas (Property 9)
    - **Property 9: Expansão entre ruas**
    - **Validates: Requirements 3.6**
    - Gerar endereços em múltiplas ruas com uma rua de origem
    - Verificar: todos os endereços da rua de origem aparecem antes dos de outras ruas

  - [ ]* 3.4 Escrever property test para filtro por classificação (Property 10)
    - **Property 10: Filtro por classificação de produto**
    - **Validates: Requirements 3.7**
    - Gerar endereços com classificações variadas e um produto com classificação específica
    - Verificar: resultado exclui endereços com classificação incompatível

- [ ] 4. Implementar motor de distribuição
  - [ ] 4.1 Criar src/modules/enderecamento-inteligente/motor-distribuicao.service.ts
    - Implementar interfaces EnderecoComCapacidade, DistribuicaoInput, Alocacao, DistribuicaoResult
    - Implementar função pura `calcularDistribuicao` (algoritmo greedy):
      1. Iterar sobre enderecosOrdenados
      2. Para cada endereço: alocar = min(quantidadeRestante, endereco.disponivel)
      3. Se alocar > 0: adicionar à lista de alocações
      4. Decrementar quantidadeRestante
      5. Se quantidadeRestante === 0: parar
      6. Retornar resultado com flag completa
    - Implementar função auxiliar `calcularCapacidadePalete`: retorna lastro × camada se ambos definidos, senão usa capacidade da Estrutura
    - _Requirements: 1.1, 1.2, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [ ]* 4.2 Escrever property test para cálculo de capacidade com fallback (Property 1)
    - **Property 1: Cálculo de capacidade com fallback**
    - **Validates: Requirements 1.1, 1.2**
    - Gerar SKUs com lastro/camada definidos ou null e estruturas com capacidade
    - Verificar: capacidade = lastro × camada quando ambos definidos; capacidade = estrutura.capacidade quando lastro ou camada é null

  - [ ]* 4.3 Escrever property test para alocação gulosa (Property 5)
    - **Property 5: Alocação gulosa (greedy)**
    - **Validates: Requirements 2.1, 2.2**
    - Gerar quantidade > capacidade de um endereço e lista de endereços com capacidades variadas
    - Verificar: cada alocação não-final usa toda a capacidade disponível do endereço

  - [ ]* 4.4 Escrever property test para conservação de quantidade (Property 6)
    - **Property 6: Invariante de conservação de quantidade**
    - **Validates: Requirements 2.6**
    - Gerar quantidade e endereços com capacidade total >= quantidade
    - Verificar: soma das alocações = quantidade solicitada e completa=true

  - [ ]* 4.5 Escrever property test para alocação parcial (Property 7)
    - **Property 7: Alocação parcial com resto**
    - **Validates: Requirements 2.4, 2.5**
    - Gerar quantidade > capacidade total disponível
    - Verificar: quantidadeRestante = quantidade - soma(alocações), completa=false, toda capacidade utilizada

- [ ] 5. Checkpoint — Verificar serviços puros
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Implementar rota POST /api/enderecamento-inteligente/distribuir
  - [ ] 6.1 Criar src/modules/enderecamento-inteligente/enderecamento-inteligente.routes.ts
    - Registrar rota POST /distribuir com validação Zod do body (produtoId: string, quantidade: number > 0, lote?: string, validade?: string ISO, skuId?: string)
    - Usar authenticate + moduloGuard('WMS')
    - Escopar todas as queries por empresaId (multi-tenant)
    - _Requirements: 5.3_

  - [ ] 6.2 Implementar lógica de orquestração do endpoint /distribuir
    - Buscar SKUs do produto (ordenados por sequência)
    - Chamar selecionarSkuMaster → retornar 422 se não encontrado (Req 5.5, 6.3)
    - Chamar converterParaUnidadeMaster com quantidade e SKUs
    - Buscar DadosLogisticosArmazenagem e DadosLogisticosPicking do produto
    - Determinar prédio/rua de origem (picking → fixo → primeiro livre)
    - Buscar endereços candidatos (tipo ARMAZENAGEM, status ativo, mesma empresa)
    - Buscar saldos dos endereços candidatos
    - Buscar CapacidadeNivel das estruturas envolvidas
    - Implementar cadeia de prioridade: endereço fixo → consolidação → endereços livres
    - Para cada candidato: chamar validarCubagem, filtrar os que não cabem
    - Chamar ordenarPorProximidade com candidatos válidos
    - Montar EnderecoComCapacidade[] com capacidade calculada e saldo atual
    - Chamar calcularDistribuicao
    - Retornar DistribuicaoResult
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 5.1, 5.2, 5.3, 5.5, 6.1, 6.2, 6.3_

  - [ ]* 6.3 Escrever property test para cadeia de prioridade (Property 11)
    - **Property 11: Cadeia de prioridade (fixo → consolidação → livre)**
    - **Validates: Requirements 5.2**
    - Gerar cenários com/sem endereço fixo e com/sem saldo existente
    - Verificar: primeira alocação é endereço fixo quando existe; senão consolidação quando existe saldo; senão endereço livre

- [ ] 7. Implementar rota GET /api/enderecamento-inteligente/ocupacao
  - [ ] 7.1 Implementar endpoint GET /ocupacao no mesmo arquivo de rotas
    - Aceitar query param: depositoId (obrigatório)
    - Validar depositoId com Zod
    - Buscar todos os endereços do depósito (via zona → depósito) escopados por empresaId
    - Para cada endereço: buscar saldo total, calcular capacidadePalete (via SKU master do produto ou estrutura)
    - Classificar status: VAZIO (saldo=0), PARCIAL (0 < saldo < capacidade), CHEIO (saldo >= capacidade), BLOQUEADO (status=false)
    - Calcular percentualOcupacao = (saldo / capacidadePalete) × 100
    - Retornar array com: id, enderecoCompleto, rua, predio, nivel, apto, status, percentualOcupacao, capacidadePalete, saldoAtual, produto (nome, quantidade, lote) se ocupado
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ]* 7.2 Escrever property test para classificação de ocupação (Property 14)
    - **Property 14: Classificação de ocupação**
    - **Validates: Requirements 7.2, 7.3, 7.4**
    - Gerar combinações de (saldo, capacidadePalete, statusEndereco)
    - Verificar: VAZIO quando saldo=0; PARCIAL quando 0 < saldo < capacidade; CHEIO quando saldo >= capacidade; BLOQUEADO quando status=false

- [ ] 8. Registrar rotas e integrar com fluxo existente
  - [ ] 8.1 Registrar enderecamentoInteligenteRoutes em src/server.ts
    - Importar e registrar com prefix '/api/enderecamento-inteligente'
    - Posicionar no bloco de Integração WMS
    - _Requirements: 5.3_

  - [ ] 8.2 Integrar motor no fluxo de conferência de entrada (enderecamento-wms)
    - Modificar src/modules/enderecamento/enderecamento-wms.routes.ts para utilizar o novo motor
    - Na rota de endereçamento automático: chamar POST /distribuir internamente (ou importar a lógica de orquestração)
    - Substituir chamada ao SugestaoEnderecoService.sugerirLote() pelo novo motor que retorna múltiplas alocações
    - Manter compatibilidade: se motor retorna uma única alocação, comportamento idêntico ao anterior
    - _Requirements: 5.1, 5.2_

  - [ ] 8.3 Implementar registro de LogMovimentacao na confirmação
    - Ao confirmar endereçamento (operador aceita sugestão): registrar LogMovimentacao tipo ENDERECAMENTO para cada alocação
    - Incluir: enderecoId, produtoId, quantidade, lote, validade, operadorId
    - _Requirements: 5.4_

- [ ] 9. Checkpoint — Verificar backend completo
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Frontend — Componente MapaArmazem
  - [ ] 10.1 Criar hook useOcupacaoArmazem em VisioFab.Wms.Front
    - Criar src/hooks/useOcupacaoArmazem.ts (ou no diretório de hooks do módulo WMS)
    - Usar React Query para GET /api/enderecamento-inteligente/ocupacao?depositoId=xxx
    - Retornar: data (enderecos[]), isLoading, error, refetch
    - _Requirements: 4.6, 7.1_

  - [ ] 10.2 Criar hook useDistribuicaoInteligente em VisioFab.Wms.Front
    - Criar src/hooks/useDistribuicaoInteligente.ts
    - Usar React Query mutation para POST /api/enderecamento-inteligente/distribuir
    - Retornar: mutate, data (DistribuicaoResult), isLoading, error
    - _Requirements: 5.3_

  - [ ] 10.3 Criar componente MapaArmazem com CSS Grid
    - Criar src/components/wms/MapaArmazem.tsx (ou diretório equivalente no frontend)
    - Implementar props: enderecos, sugestoes?, filtroRua?, filtroPredio?, filtroProduto?, onEnderecoClick?
    - Renderizar com CSS Grid: colunas = apartamentos, linhas = níveis (invertido, nível 1 embaixo)
    - Cada rua é uma seção com título, cada prédio é um bloco dentro da seção
    - Aplicar cores por status: verde (#4CAF50) vazio, amarelo (#FFC107) parcial, vermelho (#F44336) cheio, azul (#2196F3) bloqueado, roxo (#9C27B0) sugerido
    - Exibir código do endereço em cada célula
    - _Requirements: 4.1, 4.2, 4.3_

  - [ ] 10.4 Implementar tooltip/popover e painel de detalhes
    - No hover: exibir Tooltip Mantine com produto, quantidade, percentual
    - No click: abrir painel lateral (Drawer ou Modal) com detalhes completos: nome do produto, quantidade, lote, validade, percentual de ocupação
    - Exibir quantidade sugerida nas posições destacadas (quando sugestoes está presente)
    - _Requirements: 4.4, 4.7_

  - [ ] 10.5 Implementar filtros de visualização
    - Adicionar Select/MultiSelect Mantine para filtrar por rua, prédio ou produto
    - Filtrar enderecos exibidos no grid conforme seleção
    - Atualizar grid em tempo real ao mudar filtros
    - _Requirements: 4.5_

  - [ ]* 10.6 Escrever property test para filtragem de endereços (Property 15)
    - **Property 15: Filtragem de endereços no mapa**
    - **Validates: Requirements 4.5**
    - Gerar conjuntos de endereços e filtros arbitrários
    - Verificar: resultado contém apenas endereços que atendem todos os filtros ativos e contém TODOS que atendem

- [ ] 11. Frontend — Integração do mapa na tela de endereçamento
  - [ ] 11.1 Integrar MapaArmazem na página de endereçamento
    - Adicionar componente MapaArmazem à tela de endereçamento existente (conferência de entrada ou endereçamento WMS)
    - Ao executar distribuição: passar sugestões retornadas como prop `sugestoes` do MapaArmazem
    - Destacar posições sugeridas com cor roxa e exibir quantidade sugerida em cada uma
    - _Requirements: 4.3, 4.7_

  - [ ] 11.2 Implementar fluxo de distribuição no frontend
    - Adicionar botão "Distribuir" que chama useDistribuicaoInteligente com produtoId, quantidade, lote, validade
    - Exibir resultado da distribuição: lista de alocações com endereço e quantidade
    - Exibir alerta quando distribuição é parcial (completa=false) com quantidade restante
    - Permitir confirmação pelo operador (que dispara registro de LogMovimentacao no backend)
    - _Requirements: 2.3, 2.4, 5.1, 5.4_

- [ ] 12. Checkpoint final — Verificar implementação completa
  - Ensure all tests pass, ask the user if questions arise.

## Notas

- Tasks marcadas com `*` são opcionais e podem ser puladas para MVP mais rápido
- Cada task referencia requisitos específicos para rastreabilidade
- Checkpoints garantem validação incremental
- Property tests validam propriedades universais de corretude (fast-check com numRuns: 100)
- Unit tests validam exemplos específicos e edge cases
- Todas as operações devem respeitar isolamento multi-tenant (empresaId)
- Funções puras (tasks 1-4) não fazem chamadas ao banco — recebem dados pré-fetched
- O frontend está em VisioFab.Wms.Front (Next.js + Mantine UI + React Query)
