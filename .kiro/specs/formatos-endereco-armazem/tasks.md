# Plano de Implementação: Formatos de Endereço de Armazém

## Visão Geral

Implementação incremental em 7 fases: Setup de Testes → Modelo de Dados e Migração → Serviços Puros (composição, validação) → Serviço de Formato (CRUD + resolução) → Geração de Endereços v2 → Adaptação do Mapa → Integração e Wiring. Cada tarefa é independentemente testável e referencia requisitos específicos.

## Tasks

- [x] 1. Configurar framework de testes (Vitest + fast-check)
  - [x] 1.1 Instalar dependências e configurar Vitest
    - Instalar vitest, fast-check e @vitest/coverage-v8 como devDependencies
    - Criar vitest.config.ts na raiz com resolve alias para src/
    - Adicionar scripts "test" e "test:run" no package.json
    - Criar diretório src/tests/ para testes unitários e property-based
    - _Requirements: Design — Testing Strategy_

- [x] 2. Implementar modelo de dados FormatoEndereco
  - [x] 2.1 Criar migração Prisma para FormatoEndereco
    - Adicionar model FormatoEndereco no schema.prisma com campos: id, nome, descricao, segmentos (Json), empresaId, criadoEm, status
    - Adicionar campo formatoEnderecoId opcional no model Deposito com relação
    - Adicionar campo formatoEnderecoId opcional no model Zona com relação
    - Executar prisma migrate dev para gerar migração
    - _Requirements: 1.1, 1.3, 2.1, 2.2, 6.1_

  - [x] 2.2 Criar seed dos formatos pré-configurados
    - Adicionar ao prisma/seed.ts a criação dos 6 formatos padrão: Porta-palete (6 seg), Picking de chão (2 seg), Flow rack (2 seg), Blocado (3 seg), Doca (1 seg), Área de avaria (1 seg)
    - Cada formato com array de segmentos JSON conforme mapeamento definido no design (campoFisico, ordem, numerico, prefixo)
    - _Requirements: 1.5, 1.6_

- [x] 3. Implementar AddressCompositionService (serviço puro)
  - [x] 3.1 Criar src/modules/formato-endereco/address-composition.service.ts
    - Implementar função pura `formatarSegmento(segmento, valor)`: aplica zero-padding de 3 dígitos para numéricos, aplica prefixo quando configurado
    - Implementar função pura `compor(formato, valores)`: concatena segmentos ativos na ordem definida, separados por hífen, aplicando formatarSegmento a cada um
    - Implementar função pura `decompor(formato, enderecoCompleto)`: split por hífen, valida número de segmentos, retorna mapa campoFisico → valor
    - Implementar função pura `validar(formato, enderecoCompleto)`: verifica compatibilidade da string com o formato, retorna { valido, erro? }
    - _Requirements: 3.4, 3.5, 3.6, 4.1, 4.2, 4.3, 4.4_

  - [ ]* 3.2 Escrever property test para round-trip composição/decomposição
    - **Property 1: Round-trip composição/decomposição de endereço**
    - **Validates: Requirements 1.4, 3.4, 4.1, 4.2, 4.3**
    - Gerar formatos arbitrários (1-6 segmentos) e valores válidos para cada segmento
    - Verificar: decompor(formato, compor(formato, valores)) produz valores equivalentes aos originais

  - [ ]* 3.3 Escrever property test para formatação de segmentos
    - **Property 3: Formatação de segmentos**
    - **Validates: Requirements 3.5, 3.6**
    - Gerar valores numéricos arbitrários (1-999) e prefixos aleatórios
    - Verificar: segmento numérico produz string de exatamente 3 caracteres com zero-padding; segmento com prefixo inicia com o prefixo definido

  - [ ]* 3.4 Escrever property test para detecção de incompatibilidade
    - **Property 5: Detecção de endereço incompatível com formato**
    - **Validates: Requirements 4.4**
    - Gerar strings com número incorreto de segmentos separados por hífen em relação ao formato
    - Verificar: decompor/validar retorna erro descritivo indicando incompatibilidade

- [x] 4. Implementar AddressValidationService
  - [x] 4.1 Criar src/modules/formato-endereco/address-validation.service.ts
    - Implementar função `validarEndereco(formato, dados)`: verifica que todos os segmentos ativos (campoFisico) estão preenchidos nos dados
    - Verificar que todos os segmentos inativos (campos não presentes no formato) estão vazios ou nulos
    - Retornar ValidacaoResultado com lista de erros descritivos por campo
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [ ]* 4.2 Escrever property test para validação de segmentos ativos e inativos
    - **Property 4: Validação de segmentos ativos e inativos**
    - **Validates: Requirements 3.3, 7.1, 7.2**
    - Gerar formatos arbitrários e dados com combinações de campos preenchidos/vazios
    - Verificar: rejeita se segmento ativo vazio; rejeita se segmento inativo preenchido; aceita se todos ativos preenchidos e inativos nulos

- [x] 5. Checkpoint — Verificar serviços puros
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implementar FormatoEnderecoService (CRUD + resolução)
  - [x] 6.1 Criar src/modules/formato-endereco/formato-endereco.service.ts
    - Implementar `criar(data)`: validar que segmentos tem pelo menos 1 item, persistir via Prisma
    - Implementar `atualizar(id, data)`: validar segmentos, atualizar via Prisma
    - Implementar `buscarPorId(id)`: buscar formato por ID
    - Implementar `listar(empresaId)`: listar formatos da empresa
    - Implementar `excluir(id)`: verificar se formato está em uso (depósitos/zonas), rejeitar com HTTP 409 se em uso, senão excluir
    - Implementar `getFormatoPadrao()`: retornar formato legado de 6 segmentos (Depósito-Zona-Rua-Prédio-Nível-Apto)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 6.1, 6.2_

  - [x] 6.2 Implementar resolverFormato(depositoId, zonaId?)
    - Buscar zona por ID → se zona tem formatoEnderecoId, retornar formato da zona
    - Se zona não tem formato → buscar depósito por ID → se depósito tem formatoEnderecoId, retornar formato do depósito
    - Se nenhum tem formato → retornar getFormatoPadrao()
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [ ]* 6.3 Escrever property test para hierarquia de resolução de formato
    - **Property 2: Hierarquia de resolução de formato**
    - **Validates: Requirements 2.3, 2.4**
    - Gerar combinações de depósito/zona com/sem formato associado
    - Verificar: zona com formato → retorna formato da zona; zona sem formato + depósito com formato → retorna formato do depósito; nenhum com formato → retorna formato padrão 6 segmentos

  - [ ]* 6.4 Escrever property test para formato requer pelo menos um segmento
    - **Property 6: Formato requer pelo menos um segmento**
    - **Validates: Requirements 1.2**
    - Gerar listas de segmentos de tamanho 0..N
    - Verificar: rejeita criação quando lista vazia; aceita quando pelo menos 1 segmento válido

- [x] 7. Implementar rotas CRUD de FormatoEndereco
  - [x] 7.1 Criar src/modules/formato-endereco/formato-endereco.routes.ts
    - Registrar rotas com authenticate + moduloGuard
    - POST / — criar formato (validação Zod: nome obrigatório, segmentos array não-vazio)
    - GET / — listar formatos da empresa
    - GET /:id — buscar formato por ID
    - PUT /:id — atualizar formato
    - DELETE /:id — excluir formato (retorna 409 se em uso)
    - GET /resolver?depositoId=&zonaId= — resolver formato aplicável
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4_

  - [x] 7.2 Implementar rotas de associação formato → depósito/zona
    - PATCH /depositos/:id no módulo depósito — aceitar formatoEnderecoId opcional
    - PATCH /zonas/:id no módulo zona — aceitar formatoEnderecoId opcional
    - Validar que formatoEnderecoId referencia um formato existente da mesma empresa
    - _Requirements: 2.1, 2.2_

- [x] 8. Implementar AddressGenerationService v2
  - [x] 8.1 Criar src/modules/formato-endereco/address-generation-v2.service.ts
    - Implementar `gerarEnderecos(params: GenerationParamsV2)`: recebe faixas apenas para segmentos ativos do formato
    - Resolver formato via FormatoEnderecoService.resolverFormato
    - Gerar combinações cartesianas das faixas (início..fim para cada segmento ativo)
    - Para cada combinação: preencher apenas campos correspondentes aos segmentos ativos, manter demais como null
    - Compor enderecoCompleto via AddressCompositionService.compor
    - Gerar código de barras baseado no enderecoCompleto
    - Validar via AddressValidationService antes de persistir
    - Persistir endereços via Prisma em batch
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 8.1, 8.2_

  - [ ]* 8.2 Escrever property test para unicidade de código de barras
    - **Property 7: Unicidade de código de barras**
    - **Validates: Requirements 8.2**
    - Gerar pares de enderecoCompleto distintos
    - Verificar: função de geração de barcode produz códigos distintos para endereços distintos

- [x] 9. Implementar rota de geração de endereços v2
  - [x] 9.1 Adicionar rota POST /gerar no formato-endereco.routes.ts
    - Validação Zod do body: centroDistribuicaoId, depositoId, zonaId?, formatoEnderecoId?, faixas (array de { campoFisico, inicio, fim })
    - Chamar AddressGenerationService v2
    - Retornar endereços gerados com enderecoCompleto e codigoBarras
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 8.1_

  - [x] 9.2 Implementar lookup de endereço por código de barras
    - GET /enderecos/barcode/:codigo — buscar endereço pelo campo codigoBarras independente do formato
    - Retornar endereço com formato resolvido e segmentos decompostos
    - _Requirements: 8.3_

- [x] 10. Checkpoint — Verificar backend completo
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Implementar MapaAdaptadorService
  - [x] 11.1 Criar src/modules/formato-endereco/mapa-adaptador.service.ts
    - Implementar `getMapaConfig(formato)`: determinar tipo de renderização baseado no número de segmentos
      - 4+ segmentos (Porta-palete): tipo 'grade-4seg', agrupador=Rua, colunas=Prédio, células=Nível-Apto
      - 3 segmentos (Blocado): tipo 'grade-3seg', agrupador=primeiro segmento, coordenadas=demais
      - 2 segmentos (Picking, Flow rack): tipo 'lista-2seg', agrupador=primeiro segmento, posições=segundo
      - 1 segmento (Doca, Avaria): tipo 'lista-1seg', lista simples de posições
    - Gerar rótulos a partir dos nomes dos segmentos do formato
    - Implementar `agruparEnderecos(enderecos, config, formato)`: agrupar endereços conforme configuração do mapa
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ]* 11.2 Escrever property test para rótulos do mapa
    - **Property 8: Rótulos do mapa correspondem aos nomes dos segmentos**
    - **Validates: Requirements 5.5**
    - Gerar formatos arbitrários com nomes de segmentos variados
    - Verificar: configuração do mapa inclui rótulos que correspondem exatamente aos nomes dos segmentos definidos no formato

- [x] 12. Implementar rota do mapa adaptado
  - [x] 12.1 Adicionar rota GET /mapa no formato-endereco.routes.ts
    - Aceitar query params: depositoId, zonaId
    - Resolver formato via FormatoEnderecoService
    - Buscar endereços da zona/depósito
    - Chamar MapaAdaptadorService.getMapaConfig e agruparEnderecos
    - Retornar configuração do mapa + endereços agrupados
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 13. Integração e wiring final
  - [x] 13.1 Registrar rotas de formato-endereco em src/server.ts
    - Importar e registrar formatoEnderecoRoutes com prefix '/api/formato-endereco'
    - Posicionar no bloco de módulos WMS
    - _Requirements: 1.1, 2.1_

  - [x] 13.2 Integrar resolução de formato no fluxo existente de geração de endereços
    - Modificar src/modules/endereco/endereco.routes.ts para chamar resolverFormato antes de gerar endereços
    - Se formato resolvido ≠ padrão, delegar para AddressGenerationService v2
    - Se formato = padrão, manter comportamento legado (compatibilidade)
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 13.3 Integrar validação por formato na criação manual de endereços
    - No endpoint de criação de endereço existente, resolver formato e chamar AddressValidationService.validarEndereco
    - Rejeitar com HTTP 400 e mensagens descritivas se validação falhar
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x] 13.4 Integrar composição de enderecoCompleto no salvamento de endereços
    - Ao salvar/atualizar endereço, resolver formato e recompor enderecoCompleto via AddressCompositionService.compor
    - Garantir que enderecoCompleto sempre reflete o formato configurado
    - _Requirements: 4.1, 4.2_

- [x] 14. Checkpoint final — Verificar implementação completa
  - Ensure all tests pass, ask the user if questions arise.

## Notas

- Tasks marcadas com `*` são opcionais e podem ser puladas para MVP mais rápido
- Cada task referencia requisitos específicos para rastreabilidade
- Checkpoints garantem validação incremental
- Property tests validam propriedades universais de corretude (fast-check com numRuns: 100)
- Unit tests validam exemplos específicos e edge cases
- Todas as operações devem respeitar isolamento multi-tenant (empresaId)
- O AddressCompositionService é um serviço puro (sem I/O) — recebe dados pré-fetched
- Endereços existentes no formato legado continuam funcionando sem migração (Req 6.1, 6.2, 6.3)
- O modelo Prisma Endereco não é alterado — apenas FormatoEndereco é adicionado com relações em Deposito e Zona

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2", "3.1", "4.1"] },
    { "id": 3, "tasks": ["3.2", "3.3", "3.4", "4.2", "6.1"] },
    { "id": 4, "tasks": ["6.2", "6.3", "6.4"] },
    { "id": 5, "tasks": ["7.1", "7.2"] },
    { "id": 6, "tasks": ["8.1"] },
    { "id": 7, "tasks": ["8.2", "9.1", "9.2"] },
    { "id": 8, "tasks": ["11.1"] },
    { "id": 9, "tasks": ["11.2", "12.1"] },
    { "id": 10, "tasks": ["13.1", "13.2", "13.3", "13.4"] }
  ]
}
```
