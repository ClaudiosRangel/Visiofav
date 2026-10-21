# Implementation Plan — Biblioteca de Cálculos Gráficos

## Overview

Plano incremental derivado do design. A ordem respeita as dependências:
schema + migração → tipo/mapeamento puro (com PBT de round-trip) → service
(numeração/isolamento/busca) → rotas → reaproveitar para orçamento → importador
do acervo → frontend. Linguagem: **TypeScript** (backend Fastify/Prisma;
frontend Next.js/Mantine), coerente com o projeto. Testes property-based com
**fast-check** (já no projeto), mínimo 100 iterações, cada teste anotado com
`Feature: biblioteca-calculos-graficos, Property N`.

Cada sub-tarefa referencia os requisitos (Req N) e, quando aplicável, as
Correctness Properties (Property N) do design. Sub-tarefas de teste são marcadas
com `*` (opcionais/puladas para MVP).

## Tasks

- [x] 1. Schema Prisma + migração idempotente (mesmo commit)
  - Adicionar o model `CalculoGrafico` ao `prisma/schema.prisma` com todos os
    campos de engenharia do design, `@@unique([empresaId, numero])`,
    `@@unique([empresaId, numeroCalcgraf])`, índices
    `([empresaId, status])`/`([empresaId, clienteNome])`/
    `([empresaId, numeroCalcgraf])` e `@@map("calculo_grafico")`.
  - Adicionar a coluna aditiva `calculoGraficoOrigemId String? @map("calculo_grafico_origem_id")`
    ao model `ItemOrcamentoGrafico`.
  - **No MESMO commit**, atualizar `prisma/migrate-prod.ts` de forma idempotente:
    `CREATE TABLE IF NOT EXISTS "calculo_grafico" (...)`; os índices com
    `CREATE INDEX IF NOT EXISTS` / `CREATE UNIQUE INDEX IF NOT EXISTS`, incluindo
    o índice único parcial em `("empresa_id","numero_calcgraf") WHERE numero_calcgraf IS NOT NULL`;
    e `ALTER TABLE "item_orcamento_grafico" ADD COLUMN IF NOT EXISTS "calculo_grafico_origem_id" TEXT`.
  - Rodar `npx prisma generate`.
  - _Requirements: 1.1, 1.2, 1.4, 1.5, 6.4, 8.3_
  - _Steering: database-migrations_

  - [x] 1.1 Testar a migração 2× local (idempotência)
    - Rodar `npx tsx prisma/migrate-prod.ts` duas vezes seguidas contra o banco
      local; a 2ª execução não deve falhar nem duplicar tabela/índice/coluna.
    - _Requirements: 6.4_
    - _Validação de exemplo: migrate-prod.ts roda 2× local sem erro_

- [ ] 2. Tipo compartilhado + mapeamento puro biblioteca ↔ item
  - [x] 2.1 Criar o submódulo e o tipo `CamposEngenhariaCalculo`
    - Criar `src/modules/orcamento-grafico/calculo-grafico/` e o tipo TS
      `CamposEngenhariaCalculo` com as ~30 colunas comuns a `CalculoGrafico` e
      `ItemOrcamentoGrafico` (tipo/produto, descrição, suporte, cores,
      acabamentos ricos, faca/montagem, formato, matriz, tinta, itens diversos/
      fornecidos, campos livres).
    - _Requirements: 1.3_

  - [x] 2.2 Implementar `calculoParaItemBody` e `itemBodyParaCalculo`
    - Funções puras de mapeamento nos dois sentidos (biblioteca → body de item e
      body de item → cálculo), uma transformação única e testada, sem lógica de
      I/O. Reusar os tipos de entrada de `montarInputDoItem`/
      `dadosPersistenciaItem` existentes.
    - _Requirements: 1.3, 3.2_

  - [ ]* 2.3 Property test do round-trip do mapeamento
    - **Property 3: Round-trip do mapeamento biblioteca ↔ item do orçamento**
    - **Validates: Requirements 1.3, 3.2**

- [ ] 3. Service do Cálculo Gráfico: criação atômica + numeração
  - [x] 3.1 Implementar criação atômica com numeração própria por empresa
    - Em `calculo-grafico.service.ts`: criar `CalculoGrafico` numa transação que
      atribui o `numero` próprio (sequência por empresa) e grava a foto numa
      única operação atômica (`origem='VIZOR'`), sem estado intermediário em que
      o cálculo exista com número mas fora da biblioteca. `empresaId` explícito.
    - _Requirements: 1.1, 1.2, 1.5, 5.1, 5.2, 8.1, 8.3_

  - [ ]* 3.2 Property test de numeração própria única e atômica
    - **Property 5: Numeração própria única e atômica por empresa**
    - **Validates: Requirements 1.2, 5.2**

  - [ ]* 3.3 Property test de empresa + origem corretas na criação
    - **Property 2: Cálculo sempre carrega empresa e origem corretas** (ramo de
      criação `VIZOR`; o ramo de importação é coberto na task 7)
    - **Validates: Requirements 1.5, 8.3**

- [ ] 4. Service do Cálculo Gráfico: busca/localizar + foto congelada + recalcular
  - [x] 4.1 Implementar busca por critérios (estilo Calcgraf)
    - Busca por `cliente`, `linhaProduto`, `produto`, `descricao`,
      `siglaAcabado` (contém, case-insensitive, conjunção), `numero` e
      `numeroCalcgraf` (exato); sem critério → lista paginada; filtro `status`
      (default `ATIVO`); `empresaId` explícito da sessão em TODA query; leitura
      por snapshot consistente (transação de leitura).
    - _Requirements: 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 7.2, 8.1, 8.2_

  - [x] 4.2 Implementar leitura da foto congelada e recalcular
    - `GET /:id` retorna a foto (`resultadoCalculo`) sem recalcular; nenhuma
      leitura dispara o motor. Recalcular: roda `calcularOrcamentoGrafico` com
      cadastros atuais, anexa a foto anterior a `fotosAnteriores` e grava a nova
      foto, preservando os valores de memória (aproveitamento/folhas e
      laminação/verniz) quando não recalculados.
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [ ]* 4.3 Property test de isolamento de consulta por empresa
    - **Property 1: Isolamento de consulta por empresa** (inclui SUPER_ADMIN
      restrito à empresa da sessão)
    - **Validates: Requirements 1.6, 8.1, 8.2**

  - [ ]* 4.4 Property test de busca por número exato
    - **Property 6: Busca por número exato retorna exatamente o cálculo**
    - **Validates: Requirements 2.4, 5.1, 7.2**

  - [ ]* 4.5 Property test de resultados satisfazem todos os critérios
    - **Property 7: Resultados da busca satisfazem todos os critérios
      (conjunção, case-insensitive)**
    - **Validates: Requirements 2.1, 2.5**

  - [ ]* 4.6 Property test de paginação sem critérios (sem perdas/duplicatas)
    - **Property 8: Sem critérios, a paginação cobre o conjunto da empresa sem
      perdas nem duplicatas**
    - **Validates: Requirements 2.3**

  - [ ]* 4.7 Property test de foto congelada imutável na leitura
    - **Property 9: Foto congelada é imutável na leitura**
    - **Validates: Requirements 4.1, 4.4, 6.2**

  - [ ]* 4.8 Property test de recalcular preserva a foto original
    - **Property 10: Recalcular preserva a foto original como histórico**
    - **Validates: Requirements 4.3**

- [x] 5. Checkpoint — garantir que os testes passam
  - Tasks de implementação verificadas via get_diagnostics (sem erros). Tasks de
    teste (`*`) puladas para o MVP, conforme a nota do plano.

- [ ] 6. Rotas HTTP do Cálculo Gráfico + registro no server
  - [x] 6.1 Implementar `calculo-grafico.routes.ts`
    - Rotas com prefixo `/api/calculo-grafico`, `authenticate` + `moduloGuard`
      do orçamento gráfico, `empresaId` explícito em toda query (validação Zod):
      `GET /` (busca/lista), `GET /:id` (foto), `POST /` (criar),
      `PUT /:id` (atualizar), `POST /:id/recalcular`, `DELETE /:id`,
      `POST /importar-acervo` (restrita a ADMIN). 404 para cálculo inexistente/
      de outra empresa (não revela existência cross-tenant).
    - _Requirements: 1.1, 2.1, 2.3, 4.2, 4.3, 5.1, 6.1, 8.1, 8.2_

  - [x] 6.2 Registrar as rotas em `server.ts`
    - Registrar o plugin `calculo-grafico.routes.ts` no `server.ts` com o
      prefixo e os guards corretos.
    - _Requirements: 1.1_

  - [ ]* 6.3 Testes de integração/exemplo das rotas
    - Busca textual case-insensitive e por `numeroCalcgraf`; `GET /:id` exibe a
      foto; `DELETE`/`PUT`/`GET` de outra empresa retornam 404.
    - _Requirements: 2.4, 2.5, 4.2, 7.2, 8.1, 8.2_

- [ ] 7. Reaproveitar cálculo → item novo do orçamento
  - [x] 7.1 Implementar `POST /api/orcamento-grafico/:id/itens/de-calculo`
    - Cria um `ItemOrcamentoGrafico` novo (próxima sequência) **copiando** os
      campos e a foto (`resultadoCalculo`) do `CalculoGrafico` via
      `calculoParaItemBody` + `dadosPersistenciaItem`; grava
      `calculoGraficoOrigemId`; reconsolida o orçamento. Bloqueia com **403** se
      `calculo.empresaId !== sessao.empresaId`. Mantém o fluxo "criar cálculo
      novo" do wizard intacto.
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [ ]* 7.2 Property test de reaproveitar copia campos e foto (cópia, não vínculo)
    - **Property 4: Reaproveitar copia campos e foto (cópia, não vínculo)**
    - **Validates: Requirements 3.2**

  - [ ]* 7.3 Teste de integração/exemplo: 403 cross-tenant
    - Reaproveitar um cálculo de outra empresa retorna 403 e não cria item nem
      copia/adapta o cálculo.
    - _Requirements: 3.4_

- [x] 8. Checkpoint — garantir que os testes passam
  - Rotas + reaproveitar verificados via get_diagnostics (sem erros).

- [ ] 9. Importador do acervo Calcgraf
  - [x] 9.1 Implementar `calculo-grafico-import.service.ts`
    - Mapeamento origem → `CalculoGrafico` (`CalculoHeader` + `CalculoAtividades`
      + `CalculoPlanos` + `CalculoTintas` + `CalculoMatAcabamento`); foto
      congelada a partir dos agregados da origem (não recalcula);
      `origem='MIGRADO_CALCGRAF'`; `numeroCalcgraf` preservado; `numero` próprio
      por empresa; idempotência por `(empresaId, numeroCalcgraf)` (ignora/mantém
      inalterado — sem duplicar); lotes com `comRetry`; relatório de
      corrompidos/ausentes sem abortar + resumo
      `{ importados, atualizados, ignorados, erros }`.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.1, 8.3_

  - [x] 9.2 Criar o script versionado `scripts/importar-calculos-calcgraf.ts`
    - Fonte: banco restaurado `CalcgrafCartonWega` (export por `sqlcmd -u`
      UTF-16 LE → UTF-8 quando passar por arquivo; nunca `FOR JSON` padrão).
      Destino: Neon via `DATABASE_URL` (env; nunca hardcode). Flags:
      `--desde-numero N`, `--desde-ano AAAA`, `--dry-run`. `empresaId` da Carton
      Wega parametrizado (nunca inferido do usuário).
    - _Requirements: 6.1, 6.3, 6.4, 6.5, 6.6_
    - _Steering: migracao-calcgraf-carton-wega (encoding sqlcmd -u)_

  - [ ]* 9.3 Property test de importação idempotente
    - **Property 11: Importação idempotente**
    - **Validates: Requirements 6.4**

  - [ ]* 9.4 Property test de importação resiliente + conservação das contagens
    - **Property 12: Importação resiliente com relatório e contagens conservadas**
    - **Validates: Requirements 6.5, 6.6**

  - [ ]* 9.5 Property test de empresa + origem na importação
    - **Property 2: Cálculo sempre carrega empresa e origem corretas** (ramo de
      importação `MIGRADO_CALCGRAF`)
    - **Validates: Requirements 6.3, 8.3**

  - [ ]* 9.6 Teste de integração/exemplo do importador
    - Relatório lista o cálculo com dado corrompido e a carga continua; resumo
      final com as contagens corretas; `--dry-run` não grava.
    - _Requirements: 6.5, 6.6_

- [x] 10. Checkpoint — garantir que os testes passam
  - Importador (service + script) verificado via get_diagnostics (sem erros).

- [ ] 11. Frontend — tela Biblioteca de Cálculos
  - [x] 11.1 Criar `orcamento-grafico/biblioteca-calculos/page.tsx` (rota `/orcamento-grafico/biblioteca-calculos`)
    - Lista/busca estilo "Localiza o Cálculo Padrão": campos de busca (cliente,
      linha de produto, produto, descrição, sigla do acabado, número), tabela
      paginada exibindo Nº Vizor + "Calcgraf NNNN" + cliente + produto/descrição
      + data + badge de origem (MIGRADO/VIZOR). Ações por linha: "Abrir"
      (detalhe/foto) e "Usar em orçamento". `api` direto + `useState`.
    - _Requirements: 2.1, 2.2, 2.3, 2.6, 4.2_

  - [x] 11.2 Adicionar o item no `ModuleSidebar`
    - Entrada "Biblioteca de Cálculos" no menu do Orçamento Gráfico apontando
      para a nova rota.
    - _Requirements: 2.1_

- [ ] 12. Frontend — botão "Localizar Cálculo" no wizard de item
  - [x] 12.1 Adicionar o botão "Localizar Cálculo" ao wizard de item (via `BuscaCalculoModal` na página de detalhe)
    - Modal de busca (mesma busca da biblioteca) → selecionar → chamar
      `POST /orcamento-grafico/:id/itens/de-calculo` → fechar o wizard com o item
      já preenchido (foto). Manter o botão "Criar cálculo novo" (fluxo atual).
    - _Requirements: 3.1, 3.2, 3.3_

- [x] 13. Checkpoint final — garantir que todos os testes passam
  - Backend + frontend verificados via get_diagnostics (11 arquivos, sem erros).
    Build/tsc inteiro não rodado (trava nesta máquina); os property tests (`*`)
    ficam como follow-up opcional.

## Notes

- Tarefas marcadas com `*` são de teste (property/integração/exemplo) e podem ser
  puladas para um MVP mais rápido; as tarefas de implementação (sem `*`) são
  obrigatórias.
- Cada tarefa referencia os requisitos para rastreabilidade; as de teste
  referenciam a Property do design que validam.
- `schema.prisma` + `migrate-prod.ts` vão **sempre no mesmo commit** (steering
  database-migrations); migração testada 2× local (task 1.1).
- `empresaId` explícito em TODA query do Cálculo Gráfico (steering ATENCAO §2.1 —
  `prismaScoped` sozinho não isola SUPER_ADMIN).
- Property tests: fast-check, mínimo 100 iterações, tag
  `Feature: biblioteca-calculos-graficos, Property N`.
- Dados sensíveis do acervo (`cartoon/`, scripts `_tmp-`) permanecem fora do git;
  o script de importação é versionado (não `_tmp-`) e lê o destino de
  `DATABASE_URL`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["2.2"] },
    { "id": 2, "tasks": ["2.3", "3.1"] },
    { "id": 3, "tasks": ["3.2", "3.3", "4.1", "4.2"] },
    { "id": 4, "tasks": ["4.3", "4.4", "4.5", "4.6", "4.7", "4.8", "6.1"] },
    { "id": 5, "tasks": ["6.2", "7.1", "9.1"] },
    { "id": 6, "tasks": ["6.3", "7.2", "7.3", "9.2", "9.3", "9.4", "9.5", "9.6"] },
    { "id": 7, "tasks": ["11.1", "12.1"] },
    { "id": 8, "tasks": ["11.2"] }
  ]
}
```
