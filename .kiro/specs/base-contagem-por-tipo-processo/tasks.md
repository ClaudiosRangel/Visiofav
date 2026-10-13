# Implementation Plan — Base de Contagem por Tipo de Processo

## Overview

Implementação **aditiva e de consistência** de uma fonte única de verdade para a
base de contagem de produção (Tiragem vs Unidade) derivada do Tipo de Processo do
centro. A abordagem é incremental: primeiro a função pura + testes (PBT), depois
anexar o campo derivado `contagem` em cada superfície de backend (aditivo, sem
remover campos existentes), depois consumir `contagem.*` no frontend (removendo o
literal `'COLAGEM'` duplicado), e por fim consistência/limpeza e fechamento.

Decisões confirmadas pelo usuário (fecham o escopo):

- **D1 — Unidade = `OrdemProducao.quantidade`** (colagem opera no produto final /
  plano único/implícito). Não há tratamento de peças por plano múltiplo agora.
- **D2 — Base derivada do Tipo de Processo ATUAL (opção C)**: **sem** persistir a
  base no apontamento, **sem** mudança de schema, **sem** migração.

Portanto este plano **não** inclui tarefas de schema (`schema.prisma`) nem de
migração (`migrate-prod.ts`). O apontamento (`POST /checkout/etapas/:id/apontar`
e `POST /pcp/etapas/:id/apontar`) permanece **inalterado** — grava sempre o dado
bruto (R3, R11.4).

Linguagem: **TypeScript** (back Fastify + Prisma; front Next.js/Mantine 7),
conforme o design.

## Tasks

- [ ] 1. Fundação — função pura `base-contagem.service.ts`
  - [ ] 1.1 Criar o serviço puro `base-contagem.service.ts`
    - Criar `src/modules/pcp/base-contagem.service.ts` (funções **puras**, sem
      Prisma, 100% testáveis)
    - Exportar `type BaseContagem = 'UNIDADE' | 'TIRAGEM'`
    - Implementar `baseContagem(codigo: string | null | undefined): BaseContagem`
      — regra travada: retorna `'UNIDADE'` só quando `codigo === 'COLAGEM'`,
      senão `'TIRAGEM'` (inclui `null`/`undefined`/códigos arbitrários)
    - Definir as interfaces `PlanoLike` (`tiragem`, `unidade?`), `OpLike`
      (`quantidade`), `EtapaLike` (`tipoProcessoCodigo`, `quantidadePrevista`,
      `quantidadeProduzida`) e `ContagemResolvida` (`base`, `planejado`,
      `apontado`, `progresso`) exatamente como no design
    - Implementar `resolverPlanejadoDaEtapa(etapa, plano, op): ContagemResolvida`:
      base via `baseContagem`; plano implícito quando `plano == null` (usa a OP);
      UNIDADE usa `plano.unidade` se houver, senão `op.quantidade`; TIRAGEM usa
      `plano.tiragem` se houver, senão fallback de não-regressão
      (`quantidadePrevista > 0 ? quantidadePrevista : op.quantidade`);
      desmembramento (`quantidadePrevista > 0`) sobrepõe o planejado; `progresso`
      = `0..100`, `0` quando `planejado <= 0`; `apontado = quantidadeProduzida`
      (bruto, nunca convertido)
    - Usar `Decimal` (prisma/decimal.js) onde fizer sentido para evitar erro de
      ponto flutuante no cálculo de `progresso`/`planejado`
    - Lançar erro explícito (ex.: `BaseContagemError`/400) quando o `empresaId`
      de escopo exigido não puder ser determinado nas assinaturas que o recebem
      (fonte única do comportamento de R14.3)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 4.1, 4.3, 5.1, 5.2, 5.4, 14.3_

  - [ ]* 1.2 PBT — Property 1: Colagem conta em Unidade
    - `src/modules/pcp/base-contagem.service.test.ts` (vitest + fast-check, `numRuns >= 100`)
    - **Property 1: Colagem conta em Unidade** — `baseContagem('COLAGEM') === 'UNIDADE'`
    - Tag: `// Feature: base-contagem-por-tipo-processo, Property 1`
    - **Validates: Requirements 1.1, 7.1, 8.1, 9.1, 10.1, 11.1, 12.1**

  - [ ]* 1.3 PBT — Property 2: Todo processo ≠ Colagem conta em Tiragem
    - Gerador cobrindo `CORTADEIRA`, `IMPRESSAO`, `ACABAMENTO`, `VERNIZ`, códigos
      arbitrários, string vazia, `null` e `undefined` → sempre `'TIRAGEM'`
    - **Property 2: Todo processo diferente de Colagem conta em Tiragem**
    - **Validates: Requirements 1.2, 1.4, 7.2, 8.2, 9.2, 10.2, 11.2, 12.2**

  - [ ]* 1.4 PBT — Property 3: Determinismo / fonte única
    - Chamadas repetidas com a mesma entrada produzem o mesmo resultado; a base
      não varia ao mudar qualquer dado da etapa que não seja o código do Tipo de
      Processo (idempotência / independência de superfície)
    - **Property 3: A base é função determinística apenas do Tipo de Processo**
    - **Validates: Requirements 1.3, 6.1, 6.2, 11.3, 13.1**

  - [ ]* 1.5 PBT — Property 4: Planejado na base Tiragem usa a Tiragem do plano
    - Para plano com `tiragem` definida e centro ≠ Colagem → `base = 'TIRAGEM'` e
      `planejado = tiragem`, exceto desmembramento (`quantidadePrevista > 0` →
      `planejado = quantidadePrevista`)
    - **Property 4: Planejado na base Tiragem usa a Tiragem do plano**
    - **Validates: Requirements 2.1, 2.3, 4.1, 4.3**

  - [ ]* 1.6 PBT — Property 5: Planejado na base Unidade usa a Unidade do plano/OP
    - Centro Colagem → `base = 'UNIDADE'`; `planejado = plano.unidade` quando
      existir, senão `op.quantidade` (plano único/implícito); desmembramento
      sobrepõe com `quantidadePrevista`
    - **Property 5: Planejado na base Unidade usa a Unidade do plano/OP**
    - **Validates: Requirements 2.2, 2.4, 4.1, 4.3**

  - [ ]* 1.7 PBT — Property 6: Preservação do dado bruto apontado
    - Para toda etapa e toda base, `apontado === quantidadeProduzida` sem
      conversão; a base só afeta `planejado` e `progresso`
    - **Property 6: O dado bruto apontado é preservado, independentemente da base**
    - **Validates: Requirements 3.1, 3.2, 3.3, 11.4**

  - [ ]* 1.8 PBT — Property 7: Plano implícito reproduz o legado (não-regressão)
    - Para `planoId` nulo, `resolverPlanejadoDaEtapa(etapa, null, op)` iguala o
      resultado com plano implícito construído da OP, e o `planejado` iguala o
      cálculo legado (`quantidadePrevista > 0 ? quantidadePrevista : op.quantidade`)
    - **Property 7: Plano implícito reproduz o comportamento legado**
    - **Validates: Requirements 5.1, 5.2, 5.4**

  - [ ]* 1.9 PBT — Property 8: Independência entre planos da mesma OP
    - Alterar tiragem/unidade de outro plano da mesma OP não altera
      `planejado`/`progresso` da etapa do primeiro plano (sem base única na OP)
    - **Property 8: Planos de uma mesma OP são calculados de forma independente**
    - **Validates: Requirements 4.2**

  - [ ]* 1.10 PBT — Property 9: Agregação sem escopo de empresa falha explícito
    - Gerar entradas sem `empresaId` de escopo e exigir que a função/rota lance
      erro explícito (nunca `[]` nem empresa default)
    - **Property 9: Agregação sem escopo de empresa falha explicitamente**
    - **Validates: Requirements 14.3**

  - [ ]* 1.11 Testes unitários (tabela de verdade + bordas)
    - Exemplos concretos: COLAGEM→UNIDADE; CORTADEIRA/IMPRESSAO/ACABAMENTO/VERNIZ
      →TIRAGEM; `planejado <= 0` → `progresso = 0`; tiragem ausente → fallback OP
    - _Requirements: 1.1, 1.2, 1.4, 2.3, 2.4, 5.2_

- [ ] 2. Checkpoint — fundação verde
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 3. Backend — anexar `contagem` nas superfícies
  - [ ] 3.1 Painel de Programação — `GET /programacao/painel`
    - Em `src/modules/pcp/etapa-operacional.routes.ts`, na montagem de cada etapa
      (~L2180–2250), chamar `resolverPlanejadoDaEtapa(etapa, plano, op)` e anexar
      o objeto derivado `contagem = { base, planejado, apontado, progresso }` no
      item — **aditivo**: manter `quantidade/quantidadeProduzida/percentual/tiragem`
      no payload
    - Garantir `select` explícito (nunca `omit`) incluindo `tipoProcesso.codigo`
      do centro e o `plano` da etapa; passar o `empresaId` **da OP real** ao
      resolver (R14.2)
    - _Requirements: 6.1, 6.2, 9.1, 9.2, 14.1, 14.2_

  - [ ] 3.2 Quadro de Produção — `GET /quadro-producao`
    - Em `etapa-operacional.routes.ts` (cálculo ~L1586–1655), incluir
      `tipoProcesso.codigo` e `plano` no `select` (hoje faltam) e anexar
      `contagem` via resolvedor, com filtro `empresaId` explícito da OP
    - _Requirements: 6.1, 6.2, 9.3, 14.1, 14.2_

  - [ ] 3.3 Dashboard do PCP — `GET /dashboard` e `GET /dashboard/indicadores`
    - Em `src/modules/pcp/dashboard-unificado.routes.ts`, ao agregar por
      `TipoProcesso`, derivar a base por `baseContagem` e expor progresso/meta na
      base correta por centro/processo; manter filtro `empresaId` explícito em
      cada `aggregate`/`groupBy`/`count`
    - _Requirements: 6.1, 6.2, 7.1, 7.2, 14.1, 14.2_

  - [ ] 3.4 Apontamentos do PCP — `GET /etapas/:id/apontamentos` e `GET /apontamentos-producao`
    - Em `etapa-operacional.routes.ts` (`GET /etapas/:id/apontamentos`, hoje só
      totais) anexar `contagem` com `base`/`planejado`/`progresso`; em
      `src/modules/apontamento-producao/apontamento-producao.routes.ts`
      (`GET /apontamentos-producao`) anexar a base por item
    - `select` explícito com `tipoProcesso.codigo` + `plano`; `empresaId` da OP real
    - _Requirements: 6.1, 6.2, 11.3, 14.1, 14.2_

  - [ ] 3.5 Checkout — `listarPainelCheckout` / `GET /painel`
    - Em `src/modules/checkout/checkout.service.ts` (`listarPainelCheckout`,
      consumido por `checkout.routes.ts` → `GET /painel`), anexar `contagem` via
      resolvedor usando o `empresaId` **da OP/etapa do terminal** (não o do
      usuário logado). O apontamento (`POST /checkout/etapas/:id/apontar`)
      permanece **INALTERADO** (grava bruto — R11.4)
    - `select` explícito com `tipoProcesso.codigo` + `plano`
    - _Requirements: 6.1, 6.2, 11.1, 11.2, 11.4, 14.1, 14.2_

  - [ ]* 3.6 Testes de wiring (exemplo/integração) por superfície
    - Confirmar que `GET /programacao/painel`, `GET /quadro-producao`,
      `GET /dashboard/indicadores`, `listarPainelCheckout` e
      `GET /etapas/:id/apontamentos` **anexam** `contagem` com base/planejado
      corretos (COLAGEM→UNIDADE; demais→TIRAGEM)
    - Isolamento multi-tenant: agregação da empresa A não inclui registros da B;
      `empresaId` usado é o da OP real
    - _Requirements: 6.2, 7.1, 7.2, 9.1, 9.2, 9.3, 11.1, 11.2, 11.3, 14.1, 14.2_

- [ ] 4. Checkpoint — backend verde
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Frontend — consumir `contagem.*`
  - [ ] 5.1 Programação — `pcp/programacao/page.tsx`
    - Em `src/app/(interna)/pcp/programacao/page.tsx`, substituir
      `unidadeContagem(...)`/comparação literal `=== 'COLAGEM'` pela leitura de
      `contagem.base`/`contagem.planejado`/`contagem.progresso` vindos do payload;
      Mantine 7
    - _Requirements: 6.1, 6.2, 9.1, 9.2_

  - [ ] 5.2 Painel de Produção (TV) — `pcp/painel-producao/page.tsx`
    - Ler `contagem.base`/`planejado`/`progresso` (reusa `GET /programacao/painel`)
    - _Requirements: 6.1, 6.2, 10.1, 10.2_

  - [ ] 5.3 Quadro de Produção (TV) — `pcp/quadro-producao/page.tsx`
    - Ler `contagem.*` do payload de `GET /quadro-producao`
    - _Requirements: 6.1, 6.2, 9.3_

  - [ ] 5.4 Dashboard do PCP — `pcp/dashboard/page.tsx`
    - Exibir indicadores/gráficos na base vinda de `contagem`/base por processo
    - _Requirements: 6.1, 6.2, 7.1, 7.2_

  - [ ] 5.5 Apontamentos — `pcp/apontamentos/page.tsx`
    - Ler `contagem.*` (base/planejado/progresso) nos itens de apontamento
    - _Requirements: 6.1, 6.2, 11.3_

  - [ ] 5.6 Checkout — app `VisioFab.Checkout` (tela da etapa/apontar)
    - Na tela da etapa/apontar do app de terminal, ler `contagem.base`/
      `planejado`/`progresso` para rótulo e meta; o fluxo de apontar (envio do
      valor bruto) permanece inalterado
    - _Requirements: 6.1, 6.2, 11.1, 11.2, 11.4_

- [ ] 6. Checkpoint — frontend verde
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Consistência e limpeza
  - [ ] 7.1 Remover a regra duplicada do front (literal `'COLAGEM'`)
    - Garantir que nenhuma tela de produção reimplementa a regra: remover/aposentar
      `unidadeContagem` e comparações literais `'COLAGEM'` relativas à base de
      contagem, deixando todas as telas lendo a fonte única (`contagem.*`).
      Manter `getCategoriaCentro` (uso de aba/agrupamento) apenas onde não for
      base de contagem
    - _Requirements: 6.1, 6.2, 13.1_

  - [ ] 7.2 Registrar a seção da base de contagem no steering `pcp-modulo.md`
    - Adicionar seção em `.kiro/steering/pcp-modulo.md` documentando: a função
      única `base-contagem.service.ts`, a regra travada (COLAGEM→UNIDADE / demais
      →TIRAGEM), o campo derivado `contagem` anexado por superfície, o fallback de
      não-regressão, e a decisão D2 (base pelo Tipo de Processo atual, sem
      congelamento/schema)
    - _Requirements: 6.3, 13.2_

- [ ] 8. Fechamento — não-regressão, build e QA
  - [ ] 8.1 Não-regressão da suíte vitest (pcp/checkout)
    - Rodar a suíte vitest do PCP e do Checkout (verde) e confirmar que uma OP
      legada sem `plano`/sem `[Tiragem]` mantém exatamente os números atuais do
      painel (fallback para `OrdemProducao.quantidade`)
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [ ] 8.2 Build do frontend
    - Rodar o build do front (`next build`) e corrigir eventuais erros de
      tipo/import introduzidos pela leitura de `contagem.*`
    - _Requirements: 6.1, 6.2_

  - [ ]* 8.3 QA manual (checklist)
    - Conferir: Colagem exibe base Unidade; demais processos exibem Tiragem; OP de
      plano único permanece inalterada em todas as superfícies
    - _Requirements: 7.1, 7.2, 9.1, 9.2, 9.3, 10.1, 10.2, 11.1, 11.2, 12.1, 12.2_

  - [ ] 8.4 Commits/push (confirmar com o usuário — não automático)
    - Preparar os commits (back e front são repositórios **separados**) em branch
      nova por repo; **não** commitar/pushar sem confirmação explícita do usuário.
      Nenhuma alteração de `schema.prisma`/`migrate-prod.ts` nesta feature
    - _Requirements: 6.1, 6.2_

## Notes

- Tarefas marcadas com `*` são opcionais (testes/QA) e podem ser puladas para um
  MVP mais rápido, mas as PBTs cobrem as 9 Correctness Properties do design.
- Esta feature é **aditiva**: o campo `contagem` é anexado ao payload sem remover
  campos existentes; o front antigo continua funcionando até migrar para
  `contagem.*`.
- O apontamento (bruto) nunca é alterado (R3/R11.4): nenhuma tarefa toca
  `POST /apontar` (nem Checkout nem PCP).
- **Sem schema, sem migração** (decisão D2 = opção C): nenhuma tarefa altera
  `prisma/schema.prisma` nem `prisma/migrate-prod.ts`.
- Isolamento multi-tenant: toda agregação filtra `empresaId` explícito da OP real
  (nunca confiar só no `prismaScoped`, que faz bypass para SUPER_ADMIN).
- Cada PBT referencia explicitamente a Property do design (número + texto) e a(s)
  cláusula(s) de requisito que valida.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8", "1.9", "1.10", "1.11"] },
    { "id": 2, "tasks": ["3.1", "3.2", "3.3", "3.4", "3.5"] },
    { "id": 3, "tasks": ["3.6", "5.4", "5.5", "5.6", "7.2"] },
    { "id": 4, "tasks": ["5.1", "5.2", "5.3"] },
    { "id": 5, "tasks": ["7.1"] },
    { "id": 6, "tasks": ["8.1", "8.3"] },
    { "id": 7, "tasks": ["8.2"] },
    { "id": 8, "tasks": ["8.4"] }
  ]
}
```
