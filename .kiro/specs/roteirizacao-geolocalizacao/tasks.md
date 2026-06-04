# Implementation Plan: Roteirização com Geolocalização

## Overview

Plano de implementação para a funcionalidade de Roteirização com Geolocalização (Nível 1 - Básico) do WMS. A implementação segue uma ordem incremental: schema de banco de dados primeiro, depois utilitários puros (Haversine, Nearest Neighbor), validação de coordenadas, serviço de geocodificação, endpoints de distância e otimização, sugestão de rota, cobertura, integração com módulos existentes (Cliente, Empresa, Mapa de Carregamento, Romaneio).

## Tasks

- [x] 1. Atualizar schema Prisma e gerar migração
  - [x] 1.1 Adicionar campos de coordenadas em Cliente e Empresa
    - Adicionar campos `latitude Decimal? @db.Decimal(10,7)` e `longitude Decimal? @db.Decimal(10,7)` no model `Cliente`
    - Adicionar campos `latitude Decimal? @db.Decimal(10,7)` e `longitude Decimal? @db.Decimal(10,7)` no model `Empresa`
    - _Requirements: 1.1, 2.1_

  - [x] 1.2 Adicionar campos de sequência de entrega em MapaCarregamento e MapaCarregamentoNf
    - Adicionar campo `distanciaTotalKm Decimal? @db.Decimal(10,2) @map("distancia_total_km")` no model `MapaCarregamento`
    - Adicionar campo `sequenciaValida Boolean @default(false) @map("sequencia_valida")` no model `MapaCarregamento`
    - Adicionar campo `ordemEntrega Int? @map("ordem_entrega")` no model `MapaCarregamentoNf`
    - Adicionar campo `distanciaParcialKm Decimal? @db.Decimal(10,2) @map("distancia_parcial_km")` no model `MapaCarregamentoNf`
    - _Requirements: 5.4, 5.8, 7.1, 7.3_

  - [x] 1.3 Gerar e executar migração Prisma
    - Executar `npx prisma migrate dev --name add-geolocalizacao-coordenadas`
    - Verificar que a migração foi aplicada sem erros
    - _Requirements: 1.1, 2.1, 5.4, 7.1_

- [x] 2. Implementar utilitários puros e validação de coordenadas
  - [x] 2.1 Criar módulo de validação de coordenadas
    - Criar `src/modules/geolocalizacao/coord-validation.ts`
    - Implementar `latitudeSchema` (z.number().min(-90).max(90))
    - Implementar `longitudeSchema` (z.number().min(-180).max(180))
    - Implementar `coordenadasOptionalSchema` com refine para validar que lat/lng são fornecidas em conjunto
    - _Requirements: 1.3, 1.4, 1.5, 2.3, 2.4, 2.5_

  - [ ]* 2.2 Escrever testes de propriedade para validação de coordenadas
    - **Property 1: Coordinate validation rejects incomplete pairs**
    - **Property 2: Coordinate validation rejects out-of-range values**
    - **Validates: Requirements 1.3, 1.4, 1.5, 2.3, 2.4, 2.5, 4.4**
    - Criar `src/tests/coord-validation.test.ts` usando fast-check

  - [x] 2.3 Criar módulo Haversine
    - Criar `src/modules/geolocalizacao/haversine.ts`
    - Implementar interface `Coordenada { latitude: number; longitude: number }`
    - Implementar função `calcularDistanciaHaversine(origem: Coordenada, destino: Coordenada): number`
    - Usar raio da Terra = 6371 km
    - Retornar resultado com precisão de 2 casas decimais
    - _Requirements: 4.1, 4.2_

  - [ ]* 2.4 Escrever testes de propriedade para Haversine
    - **Property 4: Haversine distance symmetry**
    - **Property 5: Haversine distance non-negativity and identity**
    - **Property 6: Haversine distance triangle inequality**
    - **Property 14: Distance precision constraint**
    - **Validates: Requirements 4.1, 4.2**
    - Criar `src/tests/haversine.test.ts` usando fast-check

  - [x] 2.5 Criar módulo Nearest Neighbor
    - Criar `src/modules/geolocalizacao/nearest-neighbor.ts`
    - Implementar interfaces `PontoEntrega`, `SequenciaEntrega`, `ResultadoOtimizacao`
    - Implementar função `otimizarSequenciaNearestNeighbor(origem: Coordenada, pontos: PontoEntrega[]): ResultadoOtimizacao`
    - A cada passo selecionar o ponto não-visitado mais próximo usando Haversine
    - Calcular distância parcial e total com precisão de 2 casas decimais
    - _Requirements: 5.2, 5.4, 5.5_

  - [ ]* 2.6 Escrever testes de propriedade para Nearest Neighbor
    - **Property 7: Nearest Neighbor greedy selection**
    - **Property 8: Optimization total distance equals sum of partials**
    - **Validates: Requirements 5.2, 5.5, 7.2**
    - Criar `src/tests/nearest-neighbor.test.ts` usando fast-check

- [x] 3. Checkpoint — Verificar utilitários puros
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implementar coordenadas no cadastro de Cliente e Empresa
  - [x] 4.1 Modificar endpoints de Cliente para aceitar/retornar coordenadas
    - Atualizar schemas Zod de criação e atualização de Cliente para incluir latitude e longitude opcionais usando `coordenadasOptionalSchema`
    - Retornar latitude e longitude nos endpoints GET de listagem e detalhe de Cliente
    - Rejeitar requisição se latitude fornecida sem longitude (ou vice-versa) com mensagem de erro
    - Validar intervalos: latitude [-90, 90], longitude [-180, 180]
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6_

  - [x] 4.2 Modificar endpoints de Empresa para aceitar/retornar coordenadas
    - Atualizar schema Zod de atualização de Empresa para incluir latitude e longitude opcionais usando `coordenadasOptionalSchema`
    - Retornar latitude e longitude nos endpoints GET de consulta de Empresa
    - Rejeitar requisição se latitude fornecida sem longitude (ou vice-versa) com mensagem de erro
    - Validar intervalos: latitude [-90, 90], longitude [-180, 180]
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.6_

  - [ ]* 4.3 Escrever teste de propriedade para round-trip de coordenadas
    - **Property 3: Valid coordinate round-trip preservation**
    - **Validates: Requirements 1.2, 2.2**
    - Criar `src/tests/coord-validation.test.ts` (adicionar ao arquivo existente)

- [x] 5. Implementar serviço de geocodificação
  - [x] 5.1 Criar GeoService com geocodificação de cliente
    - Criar `src/modules/geolocalizacao/geo.service.ts`
    - Implementar método `geocodificarCliente(clienteId, empresaId)`: buscar endereço do cliente (CEP, cidade, UF, logradouro), consultar API externa, atualizar lat/lng no banco
    - Configurar timeout de 10 segundos para requisição externa
    - Retornar erro 503 se serviço externo indisponível
    - Retornar erro 422 se geocodificação não encontrar resultado
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 5.2 Implementar geocodificação em lote (batch)
    - Implementar método `geocodificarBatch(clienteIds[], empresaId)`: processar cada cliente sequencialmente
    - Falha em um item não interrompe o lote
    - Retornar resumo: total, sucessos, falhas, detalhes por cliente
    - _Requirements: 3.6, 3.7_

  - [ ]* 5.3 Escrever teste de propriedade para consistência do batch
    - **Property 9: Batch geocoding summary consistency**
    - **Validates: Requirements 3.7**
    - Adicionar em `src/tests/geo-service.test.ts`

  - [x] 5.4 Implementar geocodificação da empresa
    - Implementar método `geocodificarEmpresa(empresaId)`: buscar endereço da empresa, consultar API externa, atualizar lat/lng
    - Mesmas regras de erro do cliente (503, 422)
    - _Requirements: 3.8_

- [x] 6. Implementar endpoints de geocodificação
  - [x] 6.1 Criar rotas do módulo geolocalização
    - Criar `src/modules/geolocalizacao/geo.routes.ts`
    - Implementar `POST /geo/clientes/:id/geocodificar`: chamar GeoService.geocodificarCliente
    - Implementar `POST /geo/clientes/geocodificar-batch`: aceitar array de clienteIds, chamar GeoService.geocodificarBatch
    - Implementar `POST /geo/empresa/geocodificar`: chamar GeoService.geocodificarEmpresa
    - Adicionar autenticação e moduloGuard
    - _Requirements: 3.1, 3.6, 3.8_

  - [x] 6.2 Registrar rotas do módulo geolocalização em src/server.ts
    - Registrar `geoRoutes` com prefix `/geo`
    - Adicionar autenticação e moduloGuard
    - _Requirements: 3.1_

- [x] 7. Checkpoint — Verificar geocodificação
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implementar endpoints de cálculo de distância
  - [x] 8.1 Implementar endpoint de distância entre dois pontos
    - Adicionar `POST /geo/distancia` em geo.routes.ts
    - Aceitar origem (opcional) e destino como pares de coordenadas
    - Se origem omitida, usar coordenadas da Empresa autenticada
    - Validar coordenadas com schemas Zod
    - Retornar distância em km com 2 casas decimais
    - _Requirements: 4.2, 4.3, 4.4_

  - [x] 8.2 Implementar endpoint de distância empresa→cliente
    - Adicionar `GET /geo/distancia/cliente/:clienteId` em geo.routes.ts
    - Buscar coordenadas da Empresa e do Cliente
    - Retornar erro se Cliente não possui coordenadas
    - Retornar distância em km com 2 casas decimais
    - _Requirements: 4.5, 4.6_

- [x] 9. Implementar otimização de sequência de entrega
  - [x] 9.1 Implementar endpoint de otimização de sequência
    - Adicionar `POST /geo/mapas/:id/otimizar` em geo.routes.ts
    - Buscar coordenadas da Empresa (origem); rejeitar com 422 se empresa sem coordenadas
    - Buscar NFs do Mapa → Clientes com coordenadas
    - Chamar `otimizarSequenciaNearestNeighbor(origem, pontosGeocodificados)`
    - Incluir clientes sem coordenadas ao final da sequência com indicador "sem geolocalização" e distância parcial nula
    - Retornar sequência com: ordem, clienteId, razaoSocial, endereco, coordenadas, distanciaParcialKm
    - Retornar distanciaTotalKm
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [x] 9.2 Implementar endpoint para salvar sequência de entrega
    - Adicionar `POST /geo/mapas/:id/salvar-sequencia` em geo.routes.ts
    - Aceitar array de { nfeId, ordemEntrega, distanciaParcialKm }
    - Atualizar campos `ordemEntrega` e `distanciaParcialKm` em MapaCarregamentoNf
    - Calcular e persistir `distanciaTotalKm` no MapaCarregamento
    - Setar `sequenciaValida = true` no MapaCarregamento
    - Usar `prisma.$transaction()`
    - _Requirements: 5.8, 7.1, 7.2, 7.3_

  - [ ]* 9.3 Escrever testes unitários para otimização de sequência
    - Testar otimização com 0 pontos geocodificados (retorna sequência vazia)
    - Testar otimização com 1 ponto geocodificado
    - Testar que clientes sem coordenadas ficam ao final
    - Testar rejeição quando empresa sem coordenadas
    - _Requirements: 5.1, 5.6, 5.7_

- [x] 10. Implementar sequência de entrega no romaneio e indicador de distância
  - [x] 10.1 Modificar endpoint de romaneio para incluir sequência de entrega
    - Modificar `GET /relatorios/expedicao/romaneio/:mapaId` em relatorio-expedicao.routes.ts
    - Quando mapa possui sequência salva (sequenciaValida = true): ordenar NFs por ordemEntrega, exibir número de ordem, distância parcial entre pontos, distância total
    - Quando mapa não possui sequência salva: ordenar NFs pela ordem original de inclusão
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 10.2 Retornar distanciaTotalKm no detalhe e listagem de Mapa de Carregamento
    - Modificar `GET /mapas-carregamento/:id` para incluir campo `distanciaTotalKm` quando sequência salva
    - Modificar `GET /mapas-carregamento` (listagem) para incluir campo `distanciaTotalKm` quando disponível
    - Retornar com precisão de 2 casas decimais
    - _Requirements: 7.1, 7.5, 10.2_

  - [ ]* 10.3 Escrever teste de propriedade para ordenação do romaneio
    - **Property 13: Romaneio ordering matches saved sequence**
    - **Validates: Requirements 6.1**
    - Adicionar em `src/tests/geo-service.test.ts`

- [x] 11. Implementar invalidação de sequência
  - [x] 11.1 Invalidar sequência ao atualizar coordenadas do cliente
    - Modificar endpoint de atualização de Cliente: quando latitude/longitude são alteradas, buscar MapaCarregamentos em status AGUARDANDO_SEPARACAO ou EM_CARREGAMENTO que contenham NFs desse cliente
    - Setar `sequenciaValida = false` e `distanciaTotalKm = null` nesses mapas
    - Limpar `ordemEntrega` e `distanciaParcialKm` nas MapaCarregamentoNf correspondentes
    - _Requirements: 10.5_

  - [x] 11.2 Invalidar sequência ao adicionar/remover NFs do mapa
    - Modificar endpoints de adição/remoção de NFs em MapaCarregamento: quando mapa possui sequência salva, invalidar (sequenciaValida = false, distanciaTotalKm = null)
    - _Requirements: 7.4_

- [x] 12. Checkpoint — Verificar otimização e invalidação
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Implementar sugestão automática de rota
  - [x] 13.1 Implementar método de sugestão de rotas no GeoService
    - Implementar `sugerirRotas(clienteId, empresaId)`: buscar coordenadas do cliente (rejeitar se não possui)
    - Buscar todas as Rotas ativas da empresa com seus clientes ativos e geocodificados
    - Para cada rota: calcular distância média (Haversine) entre o cliente-alvo e todos os clientes geocodificados da rota
    - Ordenar por menor distância média, limitar a 5 sugestões
    - Retornar: rotaId, codigo, descricao, distanciaMediaKm, quantidadeClientes
    - Se nenhuma rota ativa possui clientes geocodificados, retornar lista vazia
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

  - [x] 13.2 Criar endpoint de sugestão de rota
    - Adicionar `GET /geo/clientes/:id/sugestao-rota` em geo.routes.ts
    - Chamar GeoService.sugerirRotas
    - _Requirements: 8.1_

  - [ ]* 13.3 Escrever testes de propriedade para sugestão de rota
    - **Property 10: Route suggestion ordering and limit**
    - **Property 11: Route suggestion average distance correctness**
    - **Validates: Requirements 8.2, 8.3**
    - Adicionar em `src/tests/geo-service.test.ts`

- [x] 14. Implementar visualização de área de cobertura
  - [x] 14.1 Implementar método de área de cobertura por rota no GeoService
    - Implementar `areaCoberturaRota(rotaId, empresaId)`: buscar clientes ativos da rota
    - Agrupar por cidade e bairro, contar clientes por agrupamento
    - Retornar totais de geocodificados e não-geocodificados
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 14.2 Implementar método de cobertura consolidada no GeoService
    - Implementar `areaCoberturaConsolidada(empresaId)`: buscar todas as rotas ativas com seus clientes
    - Calcular cobertura individual de cada rota
    - Identificar sobreposições: cidades/bairros atendidos por mais de uma rota
    - Retornar array de coberturas + array de sobreposições com indicação de quais rotas atendem cada cidade/bairro
    - _Requirements: 9.6, 9.7_

  - [x] 14.3 Criar endpoints de cobertura
    - Adicionar `GET /geo/rotas/:id/cobertura` em geo.routes.ts
    - Adicionar `GET /geo/rotas/cobertura-consolidada` em geo.routes.ts
    - _Requirements: 9.1, 9.6_

  - [ ]* 14.4 Escrever teste de propriedade para agregação de cobertura
    - **Property 12: Coverage area aggregation correctness**
    - **Validates: Requirements 9.2, 9.3, 9.4, 9.5**
    - Criar `src/tests/geo-coverage.test.ts` usando fast-check

- [x] 15. Implementar integração com fluxo de vendas e montagem de carga
  - [x] 15.1 Disponibilizar opção de otimização ao gerar mapa com clientes geocodificados
    - Modificar resposta do endpoint de geração de MapaCarregamento para incluir flag `podeOtimizar: boolean` indicando se existem clientes geocodificados no mapa
    - _Requirements: 10.1_

  - [x] 15.2 Exibir resumo de geocodificação na montagem de carga
    - Modificar endpoint de totalização/filtro por rota para incluir contagem de clientes geocodificados e não-geocodificados no resumo
    - _Requirements: 10.3_

- [x] 16. Final checkpoint — Verificar integração completa
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marcadas com `*` são opcionais e podem ser puladas para um MVP mais rápido
- Cada task referencia requirements específicos para rastreabilidade
- Checkpoints garantem validação incremental
- Testes de propriedade validam propriedades universais de corretude definidas no design (fast-check)
- Testes unitários validam exemplos específicos e edge cases (vitest)
- Todas as operações que modificam múltiplas tabelas devem usar `prisma.$transaction()`
- O projeto usa TypeScript em todo o stack (backend Fastify + Prisma + PostgreSQL)
- A geocodificação usa API externa configurável com timeout de 10s e sem retry automático (Nível 1)
- O algoritmo Nearest Neighbor é determinístico e adequado para o Nível 1 básico

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3"] },
    { "id": 2, "tasks": ["2.1", "2.3", "2.5"] },
    { "id": 3, "tasks": ["2.2", "2.4", "2.6"] },
    { "id": 4, "tasks": ["4.1", "4.2", "5.1"] },
    { "id": 5, "tasks": ["4.3", "5.2", "5.4"] },
    { "id": 6, "tasks": ["5.3", "6.1"] },
    { "id": 7, "tasks": ["6.2"] },
    { "id": 8, "tasks": ["8.1", "8.2"] },
    { "id": 9, "tasks": ["9.1"] },
    { "id": 10, "tasks": ["9.2", "9.3"] },
    { "id": 11, "tasks": ["10.1", "10.2", "11.1", "11.2"] },
    { "id": 12, "tasks": ["10.3"] },
    { "id": 13, "tasks": ["13.1"] },
    { "id": 14, "tasks": ["13.2", "13.3"] },
    { "id": 15, "tasks": ["14.1", "14.2"] },
    { "id": 16, "tasks": ["14.3", "14.4"] },
    { "id": 17, "tasks": ["15.1", "15.2"] }
  ]
}
```
