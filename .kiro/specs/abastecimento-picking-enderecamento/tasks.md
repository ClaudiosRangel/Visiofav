# Plano de Implementação: Abastecimento Automático do Picking no Endereçamento

## Visão Geral

Implementação incremental em 4 fases: Serviço Puro de Cálculo → Testes de Propriedade → Integração na Rota /distribuir → Checkpoint Final. O serviço `calcularAbastecimentoPicking` é uma função pura (sem side-effects) que calcula a quantidade a ser alocada no picking antes de distribuir o restante no pulmão. A integração ocorre na rota `/distribuir` existente do módulo `enderecamento-inteligente`.

## Tasks

- [x] 1. Implementar serviço puro de cálculo de abastecimento do picking
  - [x] 1.1 Criar src/modules/enderecamento-inteligente/abastecimento-picking.service.ts com tipos e interfaces
    - Implementar interface `DadosPickingConfig` (enderecoPickingId, enderecoCompleto, capacidade, pontoReposicao, saldoAtual, enderecoAtivo, sequencia)
    - Implementar interface `AbastecimentoPickingInput` (quantidadeRestante, dadosPicking[])
    - Implementar interface `AlocacaoPicking` (enderecoId, enderecoCompleto, quantidadeAlocada, areaArmazenagem: 'PICKING', capacidadeTotal, saldoAnterior, saldoResultante)
    - Implementar interface `AbastecimentoPickingResult` (alocacoes[], quantidadeAbastecida, quantidadeRestante, avisos[])
    - Implementar interface `AbastecimentoPickingError` (tipo: 'PARAMETROS_INVALIDOS' | 'ERRO_INESPERADO', mensagem)
    - Implementar type `AbastecimentoPickingOutput` (discriminated union sucesso/erro)
    - _Requirements: 2.1, 2.5, 2.7, 5.1, 5.2, 5.4_

  - [x] 1.2 Implementar função `calcularQuantidadeUnitaria`
    - Fórmula: `max(0, min(quantidadeRestante, capacidade - saldoAtual))`
    - Pré-condições validadas pelo chamador: quantidadeRestante >= 0, saldoAtual >= 0, capacidade >= 1
    - Retornar número inteiro representando unidades a alocar
    - _Requirements: 2.1, 2.3, 2.4, 2.5_

  - [x] 1.3 Implementar função `calcularAbastecimentoPicking`
    - Validar parâmetros de entrada: rejeitar se quantidadeRestante < 0 ou qualquer dadosPicking com saldoAtual < 0 ou capacidade < 1 (retornar erro PARAMETROS_INVALIDOS)
    - Ordenar dadosPicking por campo `sequencia` crescente
    - Para cada DadosPickingConfig em ordem:
      - Pular se `enderecoAtivo === false` (registrar aviso)
      - Pular se `capacidade <= 0` (registrar aviso com produtoId e valor inválido)
      - Verificar ponto de reposição: se `pontoReposicao` é não-nulo e > 0 e `saldoAtual > pontoReposicao`, pular (não abastecer)
      - Se `pontoReposicao` é nulo, zero ou negativo, tratar como inativo (sempre abastecer quando há espaço)
      - Calcular quantidade via `calcularQuantidadeUnitaria(quantidadeRestante, capacidade, saldoAtual)`
      - Se resultado > 0: criar AlocacaoPicking e decrementar quantidadeRestante
    - Retornar resultado com alocações, quantidadeAbastecida (soma), quantidadeRestante e avisos
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.4, 3.5, 6.1, 6.2, 6.3, 6.4, 8.3, 8.4, 8.5_

- [ ] 2. Testes do serviço de cálculo
  - [ ]* 2.1 Escrever property test para corretude da fórmula (Property 1)
    - **Property 1: Corretude da Fórmula de Abastecimento**
    - **Validates: Requirements 2.1, 2.3, 2.4**
    - Gerar `quantidadeRestante ∈ [0, 10000]`, `saldoAtual ∈ [0, 10000]`, `capacidade ∈ [1, 10000]`
    - Verificar: resultado === min(quantidadeRestante, max(0, capacidade - saldoAtual))

  - [ ]* 2.2 Escrever property test para não-negatividade (Property 2)
    - **Property 2: Não-Negatividade do Resultado**
    - **Validates: Requirements 2.5**
    - Gerar entradas válidas arbitrárias
    - Verificar: resultado >= 0

  - [ ]* 2.3 Escrever property test para prevenção de overflow (Property 3)
    - **Property 3: Prevenção de Overflow de Capacidade**
    - **Validates: Requirements 2.6**
    - Gerar entradas válidas arbitrárias
    - Verificar: saldoAtual + resultado <= capacidade

  - [ ]* 2.4 Escrever property test para rejeição de parâmetros inválidos (Property 4)
    - **Property 4: Rejeição de Parâmetros Inválidos**
    - **Validates: Requirements 2.7**
    - Gerar valores inválidos: quantidadeRestante < 0, saldoAtual < 0, capacidade < 1
    - Verificar: retorna { sucesso: false, erro: { tipo: 'PARAMETROS_INVALIDOS' } }

  - [ ]* 2.5 Escrever property test para conservação de quantidade (Property 5)
    - **Property 5: Conservação de Quantidade**
    - **Validates: Requirements 4.6, 3.2**
    - Gerar cenários com dadosPicking[] e quantidadeRestante
    - Verificar: quantidadeAbastecida + quantidadeRestante === quantidadeOriginal

  - [ ]* 2.6 Escrever property test para estrutura de alocações (Property 6)
    - **Property 6: Estrutura de Alocações**
    - **Validates: Requirements 5.1, 5.2**
    - Gerar distribuições com picking
    - Verificar: toda alocação possui areaArmazenagem === 'PICKING'

  - [ ]* 2.7 Escrever property test para gate do ponto de reposição (Property 7)
    - **Property 7: Gate do Ponto de Reposição**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4**
    - Gerar combinações de saldo e pontoReposicao (nulo, zero, negativo, positivo)
    - Verificar: se pontoReposicao > 0 e saldo > pontoReposicao → abastecimento = 0; caso contrário → fórmula padrão

  - [ ]* 2.8 Escrever property test para ordem de processamento sequencial (Property 8)
    - **Property 8: Ordem de Processamento Sequencial**
    - **Validates: Requirements 8.4**
    - Gerar listas de 2-5 DadosPickingConfig com sequências aleatórias
    - Verificar: alocações são geradas na ordem crescente de sequência e quantidadeRestante é decrementada progressivamente

  - [ ]* 2.9 Escrever testes unitários para cenários específicos
    - Testar: dadosPicking vazio → quantidadeAbastecida = 0, quantidadeRestante = total
    - Testar: endereço inativo → pula, registra aviso
    - Testar: picking consome tudo (qtdRestante: 5, capacidade: 10, saldo: 0) → abastecido: 5, restante: 0
    - Testar: picking parcial (qtdRestante: 20, capacidade: 10, saldo: 3) → abastecido: 7, restante: 13
    - Testar: picking cheio (qtdRestante: 10, capacidade: 5, saldo: 5) → abastecido: 0, restante: 10
    - Testar: múltiplos endereços de picking processados em ordem de sequência
    - Testar: capacidade inválida (0 ou negativa) → pula, registra aviso
    - _Requirements: 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.4, 3.5, 6.1, 6.2, 6.3, 6.4, 8.3, 8.4, 8.5_

- [x] 3. Checkpoint — Verificar serviço puro
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Integrar abastecimento do picking na rota /distribuir
  - [x] 4.1 Implementar busca de DadosLogisticosPicking na rota /distribuir
    - Modificar src/modules/enderecamento-inteligente/enderecamento-inteligente.routes.ts
    - ANTES de chamar `executarCadeiaPrioridade`, buscar `DadosLogisticosPicking` do produto filtrado por empresaId (via join com Produto)
    - Ordenar por campo `sequencia` crescente
    - Se não existir registro, prosseguir com quantidade total para pulmão (fluxo normal)
    - _Requirements: 1.1, 1.2, 1.3, 7.1, 8.5_

  - [x] 4.2 Implementar busca de saldo e status do endereço de picking
    - Para cada DadosLogisticosPicking encontrado:
      - Buscar endereço de picking (verificar existência e status) filtrado por empresaId
      - Buscar saldo físico atual via `SaldoEndereco.aggregate` (sum quantidade) filtrado por empresaId
      - Se endereço não existe no DB: registrar log de aviso e pular
      - Se saldo não pode ser determinado (sem registros): considerar saldo = 0
    - Montar array de `DadosPickingConfig` para passar ao serviço
    - _Requirements: 1.2, 1.5, 3.4, 7.1, 7.2, 8.1, 8.2_

  - [x] 4.3 Invocar calcularAbastecimentoPicking e orquestrar resultado
    - Chamar `calcularAbastecimentoPicking` com input montado
    - Se retorna erro: log do erro, graceful degradation (quantidade total → pulmão)
    - Se quantidadeAbastecida > 0 e quantidadeRestante > 0: invocar motor de distribuição com quantidadeRestante
    - Se quantidadeAbastecida === quantidadeTotal: retornar apenas alocação picking (completa=true, sem invocar motor)
    - Se quantidadeAbastecida === 0: invocar motor de distribuição com quantidade total original
    - Envolver em try/catch para graceful degradation em erro inesperado
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 8.6_

  - [x] 4.4 Montar resultado final com picking + pulmão
    - Alocação de picking como primeiro item na lista de alocações
    - Alocações de pulmão na sequência (ordem de proximidade do motor)
    - Cada alocação com campo `areaArmazenagem` ('PICKING' ou 'PULMAO')
    - Incluir `pickingInfo` no resultado: capacidadeTotal, saldoResultante, quantidadeAbastecida
    - Retornar: alocacoes[], quantidadeTotal, quantidadeAlocada, quantidadeRestante, completa
    - Se motor de distribuição falha após picking: retornar resultado parcial com picking + restante
    - _Requirements: 4.6, 4.7, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 4.5 Garantir que fluxo manual (confirmar-coletor) não é afetado
    - Verificar que o endpoint/lógica de `confirmar-coletor` NÃO invoca o serviço de abastecimento picking
    - O fluxo manual continua operando com alocação direta no endereço informado pelo operador
    - _Requirements: 4.5_

  - [x] 4.6 Implementar registro de LogMovimentacao para alocações de picking
    - Na confirmação do endereçamento (operador aceita sugestão):
      - Registrar LogMovimentacao tipo ENDERECAMENTO para cada alocação de picking
      - Incluir: enderecoId, produtoId, quantidade, lote, validade, empresaId do usuário logado, saldoAnterior, saldoNovo
    - _Requirements: 3.3, 7.3_

- [ ] 5. Testes de integração
  - [ ]* 5.1 Escrever testes de integração para a rota /distribuir com picking
    - Testar: rota invoca serviço de picking ANTES do motor de distribuição
    - Testar: produto sem DadosLogisticosPicking → distribuição normal no pulmão
    - Testar: picking consome parte → motor recebe quantidade reduzida
    - Testar: picking consome tudo → retorna apenas alocação picking sem invocar motor
    - Testar: erro no serviço de picking → graceful degradation, quantidade total para pulmão
    - Testar: isolamento multi-tenant (dados de outra empresa não aparecem)
    - Testar: fluxo manual (confirmar-coletor) não é afetado
    - Testar: LogMovimentacao registrada corretamente na confirmação
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 7.1, 7.2, 7.3, 7.4, 7.5, 8.1, 8.2, 8.6_

- [x] 6. Checkpoint final — Verificar implementação completa
  - Ensure all tests pass, ask the user if questions arise.

## Notas

- Tasks marcadas com `*` são opcionais e podem ser puladas para MVP mais rápido
- Cada task referencia requisitos específicos para rastreabilidade
- Checkpoints garantem validação incremental
- Property tests validam propriedades universais de corretude (fast-check com numRuns: 100)
- Unit tests validam exemplos específicos e edge cases
- O serviço `calcularAbastecimentoPicking` é uma função pura — recebe dados pré-fetched, sem I/O
- A integração ocorre na rota `/distribuir` existente, ANTES do motor de distribuição
- Graceful degradation: falhas no picking não bloqueiam o fluxo principal
- Todas as operações respeitam isolamento multi-tenant (empresaId)
- Tag format para PBT: `Feature: abastecimento-picking-enderecamento, Property {N}: {título}`

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3"] },
    { "id": 3, "tasks": ["2.1", "2.2", "2.3", "2.4", "2.5", "2.6", "2.7", "2.8", "2.9"] },
    { "id": 4, "tasks": ["4.1", "4.2"] },
    { "id": 5, "tasks": ["4.3"] },
    { "id": 6, "tasks": ["4.4", "4.5", "4.6"] },
    { "id": 7, "tasks": ["5.1"] }
  ]
}
```
