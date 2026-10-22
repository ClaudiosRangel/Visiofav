# Implementation Plan: Puxar Cálculo da Biblioteca no ponto de criação

## Overview

Fechar o gap de fluxo "Localiza o Cálculo Padrão" (abordagem A do design): uma
rota backend atômica nova `POST /api/orcamento-grafico/de-calculo` cria o
orçamento rascunho + item copiado da foto congelada numa única transação, e o
frontend ganha o botão "Puxar Cálculo" na lista de orçamentos reusando o
`BuscaCalculoModal` em modo criação. Reúso máximo do que já existe (helpers de
cópia de foto, busca da Biblioteca, mapeamento); SEM motor novo, SEM mudança de
schema Prisma, SEM migração, SEM tocar o PCP. Backend em `VisioFab.Wms.Back` e
frontend em `VisioFab.Wms.Front` (repos separados). Linguagem: TypeScript.

## Tasks

- [x] 1. Backend: extrair helper compartilhado de cópia de cálculo → item
  - Em `src/modules/orcamento-grafico/orcamento-grafico.routes.ts`, criar o helper interno `copiarCalculoParaItem(calc, novaQuantidade?)` que, a partir de um registro de `CalculoGrafico`, retorna `{ dadosItem, fotoResultado }` reusando `calculoParaItemBody` (de `calculo-grafico/calculo-grafico-mapeamento.ts`) e `dadosPersistenciaItem`/`dadosPersistenciaItemSemRecalculo` já existentes — por CÓPIA da foto congelada, SEM recálculo
  - `novaQuantidade > 0` sobrepõe a quantidade do cálculo; caso contrário usa a quantidade do próprio cálculo
  - Refatorar a lógica de cópia de foto já existente no fluxo "dentro de um orçamento" para chamar esse helper, mantendo UMA única fonte da regra (evita a dívida de "duas versões da mesma lógica")
  - Validar com get_diagnostics no arquivo tocado (tsc inteiro trava nesta máquina)
  - _Requirements: 3.2, 3.4, 5.2, 5.3_

- [x] 2. Backend: rota atômica `POST /api/orcamento-grafico/de-calculo`
  - [x] 2.1 Implementar schema Zod e guard multi-tenant (404/403)
    - Body Zod: `calculoId` (uuid) + `novaQuantidade?` (inteiro positivo); 400 com mensagem de campo quando inválido
    - Carregar `calculoGrafico` por id SEM filtro de empresa para distinguir 404 (inexistente) de 403 (empresa diferente); depois carregar o cálculo completo isolado por `empresaId` via `obterCalculoGrafico(empresaId, id)`
    - _Requirements: 6.2, 6.3_

  - [x] 2.2 Implementar criação atômica em transação (orçamento + item)
    - Dentro de `prisma.$transaction`: gerar `numero = (maior numero da empresa) + 1`; criar `OrcamentoGrafico` RASCUNHO; criar `ItemOrcamentoGrafico` via `copiarCalculoParaItem` gravando `calculoGraficoOrigemId = calc.id`; reconsolidar totais com `reconsolidarOrcamento`
    - Herança no orçamento: `clienteId`/`clienteNome` (herda se existir, senão null), `tipoEmbalagemId`, `medidas` da foto, `quantidade` (novaQuantidade ?? calc.quantidade), `empresaId` da empresa corrente em orçamento E item
    - Retornar 201 com o orçamento criado (mesmo `select` da listagem/detalhe, com `id` e `numero`)
    - Tratar `P2002` (unique `empresaId,numero,versao`) → 409 sem persistir (transação revertida)
    - Validar com get_diagnostics no arquivo tocado
    - _Requirements: 3.1, 3.3, 3.5, 4.1, 4.2, 4.3, 4.4, 5.2, 5.3, 6.4, 7.2_

- [ ] 3. Backend: testes da rota e da lógica de criação
  - [ ]* 3.1 Property test — criação atômica e isolada
    - **Feature: orcamento-puxar-calculo-biblioteca, Property 1: Criação é atômica e isolada**
    - **Validates: Requirements 3.1, 6.4, 7.2**
    - fast-check, Prisma mockado, 100+ iterações (`npx vitest run <arquivo> --reporter=dot`)

  - [ ]* 3.2 Property test — foto copiada sem recálculo
    - **Feature: orcamento-puxar-calculo-biblioteca, Property 2: Foto copiada sem recálculo**
    - **Validates: Requirements 3.2**

  - [ ]* 3.3 Property test — rastreabilidade da origem
    - **Feature: orcamento-puxar-calculo-biblioteca, Property 3: Rastreabilidade da origem**
    - **Validates: Requirements 3.4**

  - [ ]* 3.4 Property test — número sequencial único por empresa
    - **Feature: orcamento-puxar-calculo-biblioteca, Property 4: Número sequencial único por empresa**
    - **Validates: Requirements 3.3**
    - Gerador cobre empresa sem nenhum orçamento e vários estados de "maior número atual"

  - [ ]* 3.5 Property test — herança de cliente, tipo de embalagem e medidas
    - **Feature: orcamento-puxar-calculo-biblioteca, Property 5: Herança de cliente, tipo de embalagem e medidas**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**
    - Gerador cobre cálculo com e sem cliente

  - [ ]* 3.6 Property test — resolução da quantidade
    - **Feature: orcamento-puxar-calculo-biblioteca, Property 6: Resolução da quantidade**
    - **Validates: Requirements 5.2, 5.3**
    - Gerador cobre Nova_Quantidade omitida e positiva

  - [ ]* 3.7 Property test — isolamento na escrita (cross-tenant nunca cria)
    - **Feature: orcamento-puxar-calculo-biblioteca, Property 7: Isolamento na escrita (cross-tenant nunca cria)**
    - **Validates: Requirements 6.2, 6.3**
    - Gerador cobre id inexistente e cálculo de outra empresa

  - [ ]* 3.8 Property test — isolamento na busca
    - **Feature: orcamento-puxar-calculo-biblioteca, Property 8: Isolamento na busca**
    - **Validates: Requirements 6.1**

  - [ ]* 3.9 Testes de exemplo da rota (integração)
    - 201 (criação feliz, com `id`/`numero`), 404 (id inexistente), 403 (cálculo de outra empresa), 409 (colisão de número)
    - _Requirements: 3.1, 3.5, 6.2, 6.3, 7.2_

- [x] 4. Frontend: adaptar `BuscaCalculoModal` para modo criação
  - Em `src/app/(interna)/orcamento-grafico/[id]/BuscaCalculoModal.tsx`: tornar `orcamentoId` opcional e adicionar `onCriado?(orcamentoId: string)`
  - Ramificar a ação "Usar": com `orcamentoId` → comportamento atual (`POST /orcamento-grafico/:id/itens/de-calculo` + `onUsado()`); sem `orcamentoId` → `POST /orcamento-grafico/de-calculo` com `{ calculoId, novaQuantidade? }` e, no 201, `onCriado(res.data.id)`
  - Manter filtros, paginação, campo opcional de Nova_Quantidade e tabela de resultados idênticos nos dois modos
  - Em erro (403/404/409/400/500): exibir notificação com a mensagem do backend e manter o operador no modal, sem navegar
  - Validar com get_diagnostics no arquivo tocado
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 5.1, 7.1_

- [x] 5. Frontend: botão "Puxar Cálculo" na lista de orçamentos
  - Em `src/app/(interna)/orcamento-grafico/page.tsx`: adicionar o botão "Puxar Cálculo" ao lado de "Novo Orçamento" no header, mantendo "Novo Orçamento" (fluxo em branco) como caminho alternativo
  - Controlar o estado de abertura do `BuscaCalculoModal` em modo criação (sem `orcamentoId`); no `onCriado(id)`, `router.push('/orcamento-grafico/' + id)`
  - Validar com get_diagnostics no arquivo tocado
  - _Requirements: 1.1, 1.2, 1.3, 3.5_

- [~] 6. Checkpoint — validação final
  - Rodar get_diagnostics em todos os arquivos tocados (back e front); se viável, rodar os property/example tests do backend com `npx vitest run <arquivo> --reporter=dot` e o build do front
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tarefas marcadas com `*` são opcionais (testes) e podem ser puladas para um MVP mais rápido; mesmo assim estão incluídas por haver seção de Correctness Properties no design.
- Verificação nesta máquina: `tsc` inteiro TRAVA → usar get_diagnostics nos arquivos tocados. Testes via `npx vitest run <arquivo> --reporter=dot` (reporter basic foi removido). NÃO usar `npx tsx` (trava).
- Property tests usam fast-check com Prisma mockado, mínimo 100 iterações, cada um com a tag `Feature: orcamento-puxar-calculo-biblioteca, Property N: ...`.
- SEM mudança de schema Prisma (coluna `calculoGraficoOrigemId` e models já existem) → nenhuma tarefa de migração.
- Isolamento multi-tenant: `empresaId` EXPLÍCITO em toda escrita (nunca só `prismaScoped` — bypass SUPER_ADMIN).
- NÃO commitar (política do usuário).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1", "4"] },
    { "id": 1, "tasks": ["2.1", "5"] },
    { "id": 2, "tasks": ["2.2"] },
    { "id": 3, "tasks": ["3.1", "3.2", "3.3", "3.4", "3.5", "3.6", "3.7", "3.8", "3.9"] }
  ]
}
```
