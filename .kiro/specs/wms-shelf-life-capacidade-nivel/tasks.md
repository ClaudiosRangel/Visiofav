# Plano de Implementação: Controle de Shelf Life e Capacidade por Nível

## Visão Geral

Implementação incremental em 5 fases: Schema/Migração → Serviços Puros → Rotas Backend → Integração com Fluxos Existentes → Frontend. Cada tarefa é independentemente testável e referencia requisitos específicos.

## Tasks

- [-] 1. Migração de banco e atualização do Prisma schema
  - [ ] 1.1 Adicionar campo shelfLifeMinimo ao modelo Produto e criar modelo CapacidadeNivel no schema.prisma
    - Adicionar `shelfLifeMinimo Int? @map("shelf_life_minimo")` ao model Produto
    - Criar model CapacidadeNivel com campos: id, empresaId, estruturaId, codigoNivel, pesoMaximo (Decimal(12,3)?), volumeMaximo (Decimal(12,6)?), paletesMaximo (Int?), status, criadoEm, atualizadoEm
    - Adicionar @@unique([estruturaId, codigoNivel]) e @@map("capacidade_nivel")
    - Adicionar relation no model Estrutura
    - Executar `prisma generate` para atualizar o client
    - _Requirements: 1.1, 3.1_

  - [ ] 1.2 Criar migração SQL em prisma/migrate-prod.ts
    - Adicionar ALTER TABLE "produto" ADD COLUMN IF NOT EXISTS "shelf_life_minimo" INTEGER
    - Adicionar CREATE TABLE IF NOT EXISTS "capacidade_nivel" com todos os campos e constraints
    - Adicionar índices em empresa_id e estrutura_id
    - Seguir padrão existente com IF NOT EXISTS para idempotência
    - _Requirements: 1.1, 3.1_

- [ ] 2. Implementar serviços puros (funções de lógica de negócio)
  - [ ] 2.1 Criar src/modules/conferencia/shelf-life.service.ts com função validarShelfLife
    - Implementar interface ShelfLifeInput (shelfLifeMinimo, dataValidade, dataAtual, produtoNome)
    - Implementar interface ShelfLifeResult (aprovado, diasRestantes, mensagem?, dataMinima?)
    - Implementar função pura validarShelfLife: retorna aprovado=true se shelfLifeMinimo é null ou dataValidade é null; calcula diasRestantes e compara com shelfLifeMinimo; gera mensagem detalhada com nome do produto, dias restantes, shelf life mínimo e data mínima aceitável
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.7_

  - [ ]* 2.2 Escrever property test para validarShelfLife (Property 1: Shelf Life Validation Correctness)
    - **Property 1: Shelf Life Validation Correctness**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
    - Usar fast-check para gerar combinações arbitrárias de (shelfLifeMinimo, dataValidade, dataAtual)
    - Verificar: aprovado=true quando shelfLifeMinimo é null; aprovado=true quando dataValidade é null; aprovado=true quando diasRestantes >= shelfLifeMinimo; aprovado=false quando diasRestantes < shelfLifeMinimo

  - [ ]* 2.3 Escrever property test para mensagem de rejeição (Property 3: Rejection Message Completeness)
    - **Property 3: Rejection Message Completeness**
    - **Validates: Requirements 2.7**
    - Para qualquer cenário onde validarShelfLife retorna aprovado=false, verificar que mensagem contém: produtoNome, shelfLifeMinimo, diasRestantes e dataMinima (dataAtual + shelfLifeMinimo)

  - [ ] 2.4 Criar src/modules/endereco/ocupacao-nivel.service.ts com função calcularOcupacaoNivel
    - Implementar interface SaldoComSku (quantidade, pesoBruto, volume)
    - Implementar interface OcupacaoNivel (pesoTotal, volumeTotal, paletesTotal)
    - Implementar função pura: pesoTotal = Σ(quantidade × pesoBruto) tratando null como 0; volumeTotal = Σ(quantidade × volume) tratando null como 0; paletesTotal = contagem de saldos com quantidade > 0
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [ ]* 2.5 Escrever property test para calcularOcupacaoNivel (Property 9: Level Occupancy Calculation)
    - **Property 9: Level Occupancy Calculation**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4**
    - Gerar listas arbitrárias de SaldoComSku e verificar: pesoTotal = soma correta; volumeTotal = soma correta; paletesTotal = contagem de saldos com qty > 0; null tratado como zero

  - [ ] 2.6 Criar src/modules/endereco/validador-capacidade-nivel.service.ts com função validarCapacidadeNivel
    - Implementar interfaces CapacidadeNivelConfig, ValidacaoCapacidadeNivelInput, ValidacaoCapacidadeNivelResult
    - Implementar função pura: permitido=true se config é null; rejeitar se pesoMaximo > 0 e (pesoAtual + pesoIncoming) > pesoMaximo; rejeitar se volumeMaximo > 0 e (volumeAtual + volumeIncoming) > volumeMaximo; rejeitar se paletesMaximo > 0 e (paletesAtual + paletesIncoming) > paletesMaximo; permitido=true se nenhum limite excedido
    - Incluir detalhes do motivo de rejeição (tipo, atual, incoming, limite)
    - _Requirements: 5.2, 5.3, 5.4, 5.5_

  - [ ]* 2.7 Escrever property test para validarCapacidadeNivel (Property 7: Level Capacity Validation)
    - **Property 7: Level Capacity Validation**
    - **Validates: Requirements 5.2, 5.3, 5.4, 5.5**
    - Gerar combinações arbitrárias de (config, ocupacaoAtual, incoming) e verificar todas as regras de validação

  - [ ] 2.8 Criar src/modules/endereco/alert-nivel.service.ts com função classificarAlertaNivel
    - Implementar type AlertLevel = 'NORMAL' | 'ALERTA' | 'CRITICO'
    - Implementar função pura: >= 95 → CRITICO; >= 80 e < 95 → ALERTA; < 80 → NORMAL
    - _Requirements: 4.7_

  - [ ]* 2.9 Escrever property test para classificarAlertaNivel (Property 6: Alert Level Classification)
    - **Property 6: Alert Level Classification**
    - **Validates: Requirements 4.7**
    - Gerar percentuais arbitrários (>= 0) e verificar classificação correta nos 3 intervalos

- [x] 3. Checkpoint — Verificar serviços puros
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Implementar rotas CRUD de CapacidadeNivel
  - [ ] 4.1 Criar src/modules/capacidade-nivel/capacidade-nivel.routes.ts com CRUD completo
    - POST /api/capacidades-nivel: criar configuração com validação Zod (estruturaId, codigoNivel, pesoMaximo?, volumeMaximo?, paletesMaximo?); validar que pelo menos um limite > 0; validar unicidade (estruturaId + codigoNivel); escopar por empresaId
    - GET /api/capacidades-nivel?estruturaId=xxx: listar por estrutura, escopado por empresaId
    - PUT /api/capacidades-nivel/:id: atualizar configuração existente, validar pelo menos um limite > 0
    - DELETE /api/capacidades-nivel/:id: excluir configuração, validar pertence à empresa
    - Usar authenticate + moduloGuard('WMS')
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [ ]* 4.2 Escrever property test para validação de pelo menos um limite (Property 5: CapacidadeNivel Requires At Least One Limit)
    - **Property 5: CapacidadeNivel Requires At Least One Limit**
    - **Validates: Requirements 3.7**
    - Gerar combinações arbitrárias de (pesoMaximo, volumeMaximo, paletesMaximo) e verificar: rejeitado se todos null/zero; aceito se pelo menos um > 0

  - [ ] 4.3 Implementar endpoint GET /api/capacidades-nivel/ocupacao?estruturaId=xxx
    - Consultar todos os endereços da estrutura agrupados por codigoNivel
    - Para cada nível: buscar saldos com dados de SKU (pesoBruto, volume), chamar calcularOcupacaoNivel
    - Buscar configuração de CapacidadeNivel para cada nível
    - Retornar: pesoAtual, pesoMaximo, percentualPeso, volumeAtual, volumeMaximo, percentualVolume, paletesAtual, paletesMaximo, percentualPaletes, alertLevel (usando classificarAlertaNivel)
    - _Requirements: 6.5, 6.6, 4.6, 4.7_

  - [ ] 4.4 Registrar capacidadeNivelRoutes em src/server.ts com prefix '/api/capacidades-nivel'
    - Importar e registrar as rotas no bloco de cadastros/WMS
    - _Requirements: 3.2_

- [ ] 5. Implementar endpoint de batch shelf life e atualização do produto
  - [ ] 5.1 Adicionar campo shelfLifeMinimo ao endpoint PUT existente de Produto
    - Modificar src/modules/produto/produto.routes.ts para aceitar shelfLifeMinimo no body (Zod: z.number().int().positive().nullable().optional())
    - Persistir o campo na atualização do produto
    - _Requirements: 1.2, 1.3, 1.5, 1.6_

  - [ ] 5.2 Criar endpoint POST /api/produtos/batch-shelf-life
    - Aceitar body: { itens: [{ produtoId?: string, codigo?: string, shelfLifeMinimo: number | null }] }
    - Validar lista não vazia
    - Para cada item: buscar produto por produtoId ou codigo (escopado por empresaId); validar shelfLifeMinimo (inteiro positivo ou null); atualizar campo; registrar sucesso ou falha
    - Retornar: { total, sucessos, falhas, resultados: [{ produtoId, codigo, sucesso, erro? }] }
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ]* 5.3 Escrever property test para relatório de batch update (Property 10: Batch Update Report Correctness)
    - **Property 10: Batch Update Report Correctness**
    - **Validates: Requirements 7.3**
    - Para qualquer lista de itens (mix de válidos e inválidos), verificar: um resultado por item; sucessos + falhas = total

- [x] 6. Checkpoint — Verificar rotas backend
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Integrar validação de Shelf Life na conferência de entrada
  - [ ] 7.1 Modificar rota conferir-item em src/modules/conferencia/conferencia-entrada.routes.ts
    - Após receber dataValidade no body, buscar produto com shelfLifeMinimo
    - Chamar validarShelfLife com (shelfLifeMinimo, dataValidade, new Date(), produto.nome)
    - Se aprovado=false, retornar 422 com mensagem detalhada
    - _Requirements: 2.1, 2.2, 2.5_

  - [ ] 7.2 Modificar rota conferir-por-barras para incluir validação de shelf life
    - Mesma lógica: buscar produto, chamar validarShelfLife, rejeitar se não aprovado
    - _Requirements: 2.5_

  - [ ] 7.3 Modificar rota conferir-todos para validação em lote
    - Para cada item com dataValidade: chamar validarShelfLife
    - Rejeitar apenas itens que não atendem ao critério
    - Retornar lista de itens que falharam com mensagens individuais
    - Aprovar itens que passam na validação
    - _Requirements: 2.6_

  - [ ]* 7.4 Escrever property test para filtragem em lote (Property 2: Batch Shelf Life Filtering)
    - **Property 2: Batch Shelf Life Filtering**
    - **Validates: Requirements 2.6**
    - Gerar lista de itens com diferentes combinações e verificar que exatamente o subconjunto correto é rejeitado

- [ ] 8. Integrar validação de capacidade no endereçamento
  - [ ] 8.1 Modificar endereçamento manual em src/modules/enderecamento/enderecamento-wms.routes.ts
    - Antes de confirmar endereçamento: buscar endereço destino com codigoNivel e estruturaId
    - Buscar CapacidadeNivel para (estruturaId, codigoNivel)
    - Se existe config: calcular ocupação atual do nível (buscar saldos, chamar calcularOcupacaoNivel)
    - Calcular peso/volume incoming do item (via SKU)
    - Chamar validarCapacidadeNivel; se não permitido, retornar 422 com mensagem detalhada
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [ ] 8.2 Modificar endereçamento automático para respeitar capacidade por nível
    - Na lógica de seleção de endereço: para cada candidato, verificar capacidade do nível
    - Se nível excedido, pular para próximo endereço disponível em nível com capacidade suficiente
    - _Requirements: 5.6, 5.7_

- [x] 9. Checkpoint — Verificar integrações backend
  - Ensure all tests pass, ask the user if questions arise.

- [-] 10. Frontend — Campo shelfLifeMinimo no cadastro de Produto
  - [ ] 10.1 Adicionar campo shelfLifeMinimo ao formulário de Produto (ProdutoModal)
    - Adicionar NumberInput com label "Shelf Life Mínimo (dias)" ao modal de edição de produto
    - Campo opcional, aceita null (limpar para desabilitar)
    - Incluir tooltip explicativo: "Quantidade mínima de dias de validade restante para aceitar o produto no recebimento"
    - Integrar com react-hook-form e validação Zod (inteiro positivo ou null)
    - _Requirements: 1.4_

- [ ] 11. Frontend — Painel de gerenciamento de Capacidade por Nível
  - [ ] 11.1 Criar página/componente de configuração de capacidade por nível
    - Acessível a partir da tela de Estrutura (botão "Capacidade por Nível")
    - Receber estruturaId como parâmetro
    - Usar React Query para buscar GET /api/capacidades-nivel?estruturaId=xxx
    - _Requirements: 4.1_

  - [ ] 11.2 Implementar tabela de níveis com edição inline
    - Exibir tabela com colunas: Nível, Peso Máximo (kg), Volume Máximo (m³), Paletes Máximo, Ocupação Atual, Status
    - Permitir edição inline dos campos de capacidade
    - Botão para adicionar novo nível
    - Botão para remover nível com confirmação (Modal de confirmação Mantine)
    - Usar mutations do React Query para POST/PUT/DELETE
    - _Requirements: 4.2, 4.3, 4.4, 4.5_

  - [ ] 11.3 Implementar indicadores de ocupação com alertas visuais
    - Buscar dados de GET /api/capacidades-nivel/ocupacao?estruturaId=xxx
    - Exibir barras de progresso para peso, volume e paletes por nível
    - Aplicar cores: verde (< 80%), amarelo (>= 80% e < 95%), vermelho (>= 95%)
    - _Requirements: 4.6, 4.7_

- [ ] 12. Checkpoint final — Verificar implementação completa
  - Ensure all tests pass, ask the user if questions arise.

## Notas

- Tasks marcadas com `*` são opcionais e podem ser puladas para MVP mais rápido
- Cada task referencia requisitos específicos para rastreabilidade
- Checkpoints garantem validação incremental
- Property tests validam propriedades universais de corretude (fast-check com numRuns: 100)
- Unit tests validam exemplos específicos e edge cases
- Todas as operações devem respeitar isolamento multi-tenant (empresaId)
