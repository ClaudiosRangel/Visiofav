# Implementation Plan: Classificação Tipo Máquina

## Overview

Implementação do campo `tipoMaquina` no modelo CentroProducao para classificação determinística de máquinas (IMPRESSAO, ACABAMENTO, CORTADEIRA, COLAGEM, VERNIZ), substituindo heurísticas por keywords na descrição. Inclui migração de dados existentes, atualização de CRUD, endpoint do painel de Programação, wizard de importação de OP e filtragem por abas no frontend.

## Tasks

- [x] 1. Schema Prisma, migração e validação backend
  - [x] 1.1 Adicionar campo tipoMaquina ao schema Prisma e criar migration
    - Adicionar `tipoMaquina String? @map("tipo_maquina") @db.VarChar(20)` ao model CentroProducao
    - Criar migration com `ALTER TABLE centro_producao ADD COLUMN tipo_maquina VARCHAR(20)`
    - Incluir SQL de migração de dados existentes (UPDATEs por keyword matching case-insensitive)
    - Executar `npx prisma generate` para atualizar o client
    - _Requirements: 1.1, 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 1.2 Adicionar validação Zod de tipoMaquina no backend
    - Criar schema Zod `tipoMaquinaSchema = z.enum(['IMPRESSAO', 'ACABAMENTO', 'CORTADEIRA', 'COLAGEM', 'VERNIZ'])`
    - Atualizar `centroProducaoBodySchema` para incluir `tipoMaquina: tipoMaquinaSchema.nullable().optional()`
    - Atualizar `listQuerySchema` para incluir `tipoMaquina: tipoMaquinaSchema.optional()`
    - _Requirements: 1.1, 6.4, 6.5_

  - [x]* 1.3 Write property test: Validation rejects invalid tipoMaquina values
    - **Property 6: Validation rejects invalid tipoMaquina values**
    - Generator: strings aleatórias (maioria inválida) + valores válidos do enum
    - Verificar que valores fora do enum são rejeitados pelo schema Zod e valores válidos são aceitos
    - **Validates: Requirements 6.4, 6.5**

- [x] 2. CRUD de CentroProducao — lógica condicional e filtro
  - [x] 2.1 Implementar lógica condicional no create/update de CentroProducao
    - No handler de POST e PUT, se `tipo !== 'MAQUINA'`, forçar `tipoMaquina = null`
    - Se `tipo === 'MAQUINA'` e `tipoMaquina` informado, persistir o valor
    - Incluir `tipoMaquina` no select de GET individual e listagem
    - _Requirements: 1.2, 1.3, 1.4_

  - [x] 2.2 Implementar filtro por tipoMaquina na listagem de centros
    - Adicionar filtro `where: { tipoMaquina }` quando query param `tipoMaquina` estiver presente
    - Retornar apenas centros que possuem o tipoMaquina solicitado
    - _Requirements: 1.5_

  - [x]* 2.3 Write property test: Conditional persistence of tipoMaquina
    - **Property 2: Conditional persistence of tipoMaquina**
    - Generator: payloads com tipo random (MAQUINA|SETOR|LINHA) e tipoMaquina random (válido ou null)
    - Verificar que se tipo=MAQUINA, tipoMaquina é persistido; se tipo!=MAQUINA, tipoMaquina é null
    - **Validates: Requirements 1.2, 1.3, 3.4**

  - [x]* 2.4 Write property test: List filter by tipoMaquina query parameter
    - **Property 5: List filter by tipoMaquina query parameter**
    - Generator: conjuntos de centros com tipoMaquina variado, filter value aleatório do enum
    - Verificar que todos os registros retornados possuem o tipoMaquina filtrado
    - **Validates: Requirements 1.5**

- [x] 3. Checkpoint — Validar schema e CRUD
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Endpoint do painel de Programação — incluir tipoMaquina
  - [x] 4.1 Incluir tipoMaquina na resposta do painel (painelPorCentro)
    - No `GET /api/pcp/programacao/painel`, adicionar `tipoMaquina` ao select do centroProducao em `painelPorCentro`
    - Retornar `tipoMaquina` em cada objeto centro na resposta
    - _Requirements: 4.1_

  - [x] 4.2 Incluir tipoMaquina no aguardandoCartao
    - Para cada item em `aguardandoCartao`, incluir `tipoMaquina` do centro da primeira etapa pendente
    - Ajustar query Prisma para incluir relação centro → tipoMaquina na primeira etapa
    - _Requirements: 5.1_

  - [x]* 4.3 Write property test: Keyword classification correctness
    - **Property 1: Keyword classification correctness**
    - Criar função pura `classificarTipoMaquina(descricao: string): string | null`
    - Generator: strings aleatórias com keywords inseridos em posições aleatórias
    - Verificar que a classificação retorna o valor correto para cada keyword ou null quando nenhum match
    - **Validates: Requirements 2.2, 2.3, 2.4, 2.5**

- [x] 5. Importação de OP — persistir tipoMaquina em novos centros
  - [x] 5.1 Estender schema da confirmação de importação para incluir tipoMaquina
    - Adicionar `tipoMaquina: z.enum([...]).optional()` no schema de `centrosVinculados`
    - Na lógica de criação de novo centro, persistir `tipoMaquina` junto com os demais campos
    - _Requirements: 3.3, 3.4_

  - [x]* 5.2 Write unit tests for import OP tipoMaquina persistence
    - Testar que ao confirmar importação com `criar = true`, o centro criado recebe tipoMaquina
    - Testar que centros vinculados a existentes não alteram tipoMaquina indevidamente
    - _Requirements: 3.3, 3.4_

- [x] 6. Checkpoint — Validar backend completo
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Frontend — Filtragem por abas na Programação
  - [x] 7.1 Substituir lógica de filtro por keywords pela filtragem por tipoMaquina
    - Remover funções heurísticas (regex na descrição) de categorização de centros
    - Implementar filtro determinístico: Cortadeira → `CORTADEIRA`, Impressão → `IMPRESSAO`, Acabamento → `ACABAMENTO|COLAGEM|VERNIZ`
    - Centros com tipoMaquina null aparecem apenas na aba "Todos"
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 7.2 Implementar filtragem de Aguardando Cartão por aba
    - Filtrar itens aguardandoCartao pelo tipoMaquina da primeira etapa usando mesmas regras de aba
    - Na aba "Todos", exibir todos os itens aguardandoCartao
    - _Requirements: 5.2, 5.3, 5.4, 5.5_

  - [x]* 7.3 Write property test: Tab filtering correctness for centros
    - **Property 3: Tab filtering correctness for centros**
    - Generator: arrays de centros com tipoMaquina aleatório (incluindo null), tab aleatória
    - Verificar que um centro é visível na aba se e somente se satisfaz a regra de mapeamento
    - **Validates: Requirements 4.2, 4.3, 4.4, 4.5, 4.6**

  - [x]* 7.4 Write property test: Tab filtering correctness for Aguardando Cartão
    - **Property 4: Tab filtering correctness for Aguardando Cartão**
    - Generator: arrays de items aguardandoCartao com tipoMaquina aleatório, tab aleatória
    - Verificar que item aparece na aba correta conforme tipoMaquina da primeira etapa
    - **Validates: Requirements 5.2, 5.3, 5.4, 5.5**

- [x] 8. Frontend — Formulário CRUD de CentroProducao
  - [x] 8.1 Adicionar campo Select de tipoMaquina no formulário de CentroProducao
    - Exibir `<Select>` "Tipo de Máquina" com options IMPRESSAO, ACABAMENTO, CORTADEIRA, COLAGEM, VERNIZ
    - Visível apenas quando `tipo === 'MAQUINA'`; ocultar quando SETOR ou LINHA
    - Enviar `tipoMaquina` no payload de criação/edição
    - _Requirements: 6.1, 6.2, 6.3_

- [x] 9. Frontend — Import OP Wizard Step 4 com tipoMaquina
  - [x] 9.1 Adicionar Select de tipoMaquina no Step 4 do wizard de importação
    - Para cada centro no step de mapeamento, exibir `<Select>` de tipoMaquina
    - Obrigatório quando `criar = true` (novo centro)
    - Pre-fill com `tipoMaquina` do centro vinculado quando `centroIdVinculado` existe
    - Enviar `tipoMaquina` no payload de confirmação
    - _Requirements: 3.1, 3.2, 3.3, 3.5_

- [x] 10. Frontend — Novo Grupo na Programação com tipoMaquina
  - [x] 10.1 Pre-selecionar tipoMaquina ao criar novo grupo com base na aba ativa
    - Aba "Cortadeira" → pre-select CORTADEIRA
    - Aba "Impressão" → pre-select IMPRESSAO
    - Aba "Acabamento" → pre-select ACABAMENTO
    - Aba "Todos" → sem pre-select, obrigar seleção manual
    - Enviar `tipoMaquina` junto com demais campos ao backend
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 11. Checkpoint final — Validar integração completa
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marcadas com `*` são opcionais e podem ser puladas para MVP mais rápido
- Cada task referencia requisitos específicos para rastreabilidade
- Checkpoints garantem validação incremental
- Property tests usam **fast-check** com Vitest (backend) e Vitest (frontend)
- A migração SQL é idempotente (condição `AND tipo_maquina IS NULL`)
- O campo é nullable para manter backward-compatibility com centros não classificados
- Frontend: VisioFab.Wms.Front (Next.js + Mantine); Backend: VisioFab.Wms.Back (Fastify + Prisma)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1", "2.2"] },
    { "id": 3, "tasks": ["2.3", "2.4", "4.1", "4.2"] },
    { "id": 4, "tasks": ["4.3", "5.1"] },
    { "id": 5, "tasks": ["5.2", "7.1", "7.2"] },
    { "id": 6, "tasks": ["7.3", "7.4", "8.1", "9.1", "10.1"] }
  ]
}
```
