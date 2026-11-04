# Implementation Plan: Central de Consulta do Produto/Acabado

## Overview

Plano de implementação incremental e test-driven. A abordagem segue a decisão
central do design: **ZERO mudança de schema** (reutiliza `DeParaImportacao`,
`CalculoGrafico`/`siglaAcabado`, `AtributoGrafico`, `OrdemProducao`,
`ItemOrcamentoGrafico`) — **não há tarefa de migração nem alteração de
`prisma/schema.prisma`/`prisma/migrate-prod.ts`**. Caso durante a implementação
surja qualquer necessidade de schema, PARAR e confirmar com o usuário (o design
decidiu explicitamente não tocar schema; ver Req 13.3/13.4).

As **funções puras** (consolidação, validação de termo/edição, seleção de
arte/ficha, extração/casamento da tag `[Produto]`, permissão) vêm **antes**, com
**property-based tests** (fast-check, ≥100 iterações cada), implementando as **13
Correctness Properties** do design — uma propriedade = um teste de propriedade.
Depois os services de I/O (busca, detalhe, edição) com `empresaId` **explícito**,
os schemas Zod e as rotas Fastify sob `/api/comercial/central-produto`.

Backend (`VisioFab.Wms.Back`) e frontend (`VisioFab.Wms.Front`) são **repositórios
separados** — as tarefas estão agrupadas e rotuladas por repo.

Os property tests desta feature são o **núcleo obrigatório** (validam as regras de
negócio não-triviais) e **não** são marcados como opcionais. Apenas testes
unitários/integração complementares e tarefas acessórias são marcados com `*`.

---

## Tasks

### BACKEND (`VisioFab.Wms.Back`)

- [x] 1. Estrutura do módulo e tipos compartilhados
  - Criar a pasta `src/modules/comercial/central-produto/`
  - Criar `central-produto.types.ts` com as interfaces do design:
    `DeParaAcabado`, `ProdutoResumo`, `CalculoResumo`, `OpTagResumo`,
    `EntradasConsolidacao`, `GrupoResultado`, `ResultadoConsolidado`,
    `DetalheProduto` (blocos identificacao/arte/fichaTecnica/historicoOps/calculos),
    `FichaAtributos`, `FichaEngenharia`, `BuscaParams`, `DetalheParams`,
    `EdicaoParams`
  - Criar a classe de erro de domínio `CentralProdutoError` (com `statusCode`,
    default 400) em `central-produto.errors.ts`
  - Sem Prisma e sem lógica aqui — apenas contratos reutilizados pelas demais tarefas
  - _Requirements: 13.3_

- [x] 2. Validação de termo e de edição (função pura) + property tests
  - [x] 2.1 Implementar `central-produto-validacao.ts`
    - `validarTermoBusca(termo)`: retorna `termoNormalizado` (trim + lower) ou
      lança `CentralProdutoError(400)` quando `termo.trim().length < 2` (inclui
      vazio/só-espaços)
    - `validarEdicao(params)`: rejeita `descricao` fora de 1..200, `imagemUrl`
      não-nula fora de 1..500, e lista `adicionarAcabados` com duplicata entre si
      (a duplicata contra vínculo já existente é checada no service de edição com
      os vínculos atuais, mas a função pura recebe a lista existente para validar)
    - _Requirements: 1.5, 9.1, 9.7_
  - [x] 2.2 Property test — validação do termo
    - **Property 1: Validação do termo de busca**
    - **Validates: Requirements 1.5**
    - `// Feature: comercial-central-produto-acabado, Property 1: ...` · ≥100 iterações
    - Geradores: strings só-espaços, 0/1/2+ chars após trim, acentuação/case misto
  - [x] 2.3 Property test — validação dos campos de edição
    - **Property 10: Validação dos campos de edição**
    - **Validates: Requirements 9.1, 9.7**
    - `// Feature: comercial-central-produto-acabado, Property 10: ...` · ≥100 iterações
    - Geradores: descrições em/fora de 1..200, imagemUrl nula e em/fora de 1..500,
      listas de acabados com e sem duplicata (entre si e contra existentes)

- [x] 3. Extração e casamento da tag `[Produto]` (função pura) + property test
  - [x] 3.1 Implementar `central-produto-tag.ts`
    - `extrairProdutoTag(observacoes)`: regex defensiva que recupera o valor de
      `[Produto] <valor>` sem espaços nas bordas; retorna `null` quando a tag não
      existe (trata `observacoes` como texto não confiável, sem interpretar)
    - `casarOpPorTag(produtoDescricaoNorm, opsSemProduto)`: associa uma OP ao
      produto sse o valor normalizado (trim + case-insensitive) da tag corresponder
      à descrição normalizada do produto
    - _Requirements: 2.3, 7.2_
  - [x] 3.2 Property test — extração/casamento da tag
    - **Property 9: Extração e casamento pela tag `[Produto]`**
    - **Validates: Requirements 2.3, 7.2**
    - `// Feature: comercial-central-produto-acabado, Property 9: ...` · ≥100 iterações
    - Geradores: observações com/sem tag, valor com espaços nas bordas, case misto,
      descrições iguais/diferentes

- [x] 4. Seleção de arte e indicador de ficha técnica (função pura) + property tests
  - [x] 4.1 Implementar `central-produto-arte-ficha.ts`
    - `resolverArte(produtoImagemUrl, calculoImagemUrl)`: retorna
      `{ fonte: 'PRODUTO'|'CALCULO'|'NENHUMA', imagemUrl }` priorizando o produto
    - `temFichaTecnica(atributoGrafico, engenhariaCalculo)`: `true` sse ao menos
      uma fonte estiver presente
    - _Requirements: 5.1, 5.2, 5.3, 6.3_
  - [x] 4.2 Property test — prioridade da fonte de arte
    - **Property 7: Prioridade da fonte de arte**
    - **Validates: Requirements 5.1, 5.2, 5.3**
    - `// Feature: comercial-central-produto-acabado, Property 7: ...` · ≥100 iterações
  - [x] 4.3 Property test — indicador de ficha técnica
    - **Property 8: Indicador de ficha técnica**
    - **Validates: Requirements 6.3**
    - `// Feature: comercial-central-produto-acabado, Property 8: ...` · ≥100 iterações

- [x] 5. Decisão de permissão de edição (função pura) + property test
  - [x] 5.1 Implementar `central-produto-permissao.ts`
    - `permitirEdicao({ perfil, flagComercial, flagPcp })`: `true` quando perfil ∈
      {ADMIN, SUPER_ADMIN} (independe das flags); caso contrário reflete
      `podeEditarCadastros` (Comercial e/ou PCP). Leitura sempre liberada (a função
      só decide a escrita)
    - _Requirements: 9.6, 10.1, 10.2, 10.3, 10.4_
  - [x] 5.2 Property test — decisão de permissão
    - **Property 11: Decisão de permissão de edição**
    - **Validates: Requirements 9.6, 10.1, 10.2, 10.3, 10.4**
    - `// Feature: comercial-central-produto-acabado, Property 11: ...` · ≥100 iterações
    - Geradores: todos os perfis × todas as combinações de flags

- [x] 6. Service de consolidação (função PURA, núcleo) + property tests
  - [x] 6.1 Implementar `central-produto-consolidacao.service.ts`
    - `consolidarResultados(entradas, limite = 100)`: sem Prisma/IO
    - Agrupa de-paras + produtos casados em grupos `tipo='PRODUTO'` por `produtoId`
      (produto nunca em dois grupos; `codigosAcabado` = união ordenada sem duplicatas)
    - Gera grupos `tipo='ACABADO_SEM_PRODUTO'` (`semProdutoCadastrado=true`) para
      cálculos cujo `siglaAcabado` não casa nenhum de-para nem resolve produto
    - Ordenação determinística: PRODUTO (por `codigo` asc), depois
      ACABADO_SEM_PRODUTO (por `siglaAcabado` asc), empate por `chave` asc
    - `semResultado`, `detalheDireto`, `limiteAplicado` conforme regras do design
    - _Requirements: 1.1, 1.3, 1.4, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5_
  - [x] 6.2 Property test — agrupamento único por produto
    - **Property 2: Agrupamento único por produto**
    - **Validates: Requirements 3.1, 3.2, 2.4**
    - `// Feature: comercial-central-produto-acabado, Property 2: ...` · ≥100 iterações
  - [x] 6.3 Property test — fallback de acabado sem produto
    - **Property 3: Fallback de acabado sem produto**
    - **Validates: Requirements 1.3, 3.5**
    - `// Feature: comercial-central-produto-acabado, Property 3: ...` · ≥100 iterações
  - [x] 6.4 Property test — ausência de resultados
    - **Property 4: Ausência de resultados**
    - **Validates: Requirements 1.4, 3.5**
    - `// Feature: comercial-central-produto-acabado, Property 4: ...` · ≥100 iterações
  - [x] 6.5 Property test — ordenação determinística e limite
    - **Property 5: Ordenação determinística e limite**
    - **Validates: Requirements 3.3, 1.1**
    - `// Feature: comercial-central-produto-acabado, Property 5: ...` · ≥100 iterações
    - Gerador aplica permutações das mesmas entradas e compara a sequência de grupos
  - [x] 6.6 Property test — detalhe direto com produto único
    - **Property 6: Detalhe direto com produto único**
    - **Validates: Requirements 3.4**
    - `// Feature: comercial-central-produto-acabado, Property 6: ...` · ≥100 iterações

- [x] 7. Checkpoint — funções puras e property tests do núcleo
  - Garantir que todos os property tests (Properties 1–11) passam com ≥100 iterações,
    `get_diagnostics` limpo nos arquivos puros. Ask the user if questions arise.

- [x] 8. Service de busca (I/O Prisma) com empresaId explícito
  - [x] 8.1 Implementar `central-produto-busca.service.ts`
    - `buscarCentralProduto({ empresaId, termo })`: chama `validarTermoBusca`
      (lança 400 antes de qualquer query — Req 1.5)
    - 4 queries com `empresaId` **EXPLÍCITO** (nunca só `prismaScoped`):
      `DeParaImportacao` (`sistemaOrigem='GPRINT'`, `tipoEntidade='PRODUTO'`,
      `codigoExterno contains` insensitive), `Produto` (`codigo`/`descricao`/`nome`
      contains insensitive), `CalculoGrafico` (`siglaAcabado`/`descricao` contains),
      `OrdemProducao` (`produtoId=null`, `observacoes contains`) com **`select`
      explícito SEM `pdfData`** + filtro fino pela tag `[Produto]` via `tag.ts`
    - Carrega os `Produto` referenciados pelos de-paras encontrados e delega a
      `consolidarResultados`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 7.3, 11.1, 11.2, 11.3_
  - [x] 8.2 Property test — não-vazamento multi-tenant na leitura (repo mockado)
    - **Property 12: Não-vazamento multi-tenant na leitura**
    - **Validates: Requirements 11.1, 11.2, 11.3**
    - `// Feature: comercial-central-produto-acabado, Property 12: ...` · ≥100 iterações
    - Repositório mockado gera dados de 2 empresas (inclusive códigos/nomes iguais);
      verifica que o resultado só contém entidades de A e que toda query recebeu o
      `empresaId` de A, inclusive com usuário SUPER_ADMIN
  - [x] 8.3* Testes de exemplo — matching case-insensitive/substring
    - Exemplos para Req 1.2/2.1/2.2 e exemplo confirmando `select` de OP sem `pdfData`
      (Req 7.3)
    - _Requirements: 1.2, 2.1, 2.2, 7.3_

- [x] 9. Service de detalhe (I/O Prisma) com empresaId explícito
  - [x] 9.1 Implementar `central-produto-detalhe.service.ts`
    - `obterDetalhe({ empresaId, produtoId? , calculoId? })` — 404 se entidade de
      outra empresa/inexistente
    - Bloco Identificação (Req 4): `Produto` + de-paras + cliente; fallback do
      cálculo (`siglaAcabado`/`descricao`/`clienteNome`)
    - Bloco Arte (Req 5): usa `resolverArte` (produto → cálculo → nenhuma)
    - Bloco Ficha (Req 6): `AtributoGrafico` (`[empresaId, produtoId]`) + nomes dos
      cadastros gráficos + engenharia do `CalculoGrafico` (`medidas`/cores); usa
      `temFichaTecnica`
    - Bloco Histórico de OPs (Req 7): por `produtoId` **união** OPs `produtoId=null`
      casadas por tag (`casarOpPorTag`); **`select` explícito sem `pdfData`**; só leitura
    - Bloco Cálculos (Req 8): `CalculoGrafico` + `ItemOrcamentoGrafico`
      (`calculoGraficoOrigemId`), `empresaId` explícito em ambos; só leitura
    - _Requirements: 4.1, 4.2, 4.3, 5.1, 5.2, 5.3, 6.1, 6.2, 6.3, 7.1, 7.2, 7.3, 7.4, 8.1, 8.2, 8.3, 8.4, 11.1_
  - [x] 9.2* Testes de exemplo — montagem dos blocos de detalhe
    - Produto completo, produto sem cliente, acabado-sem-produto, ficha vazia,
      cálculos vazios; confirma só-leitura e ausência de `pdfData`
    - _Requirements: 4.1, 4.2, 4.3, 6.1, 6.2, 7.3, 8.3, 8.4_

- [x] 10. Service de edição transacional com empresaId explícito
  - [x] 10.1 Implementar `central-produto-edicao.service.ts`
    - `aplicarEdicao(params)`: resolve o `Produto` por `findFirst({ id, empresaId })`
      → 404 se de outra empresa (Req 11.4)
    - Chama `validarEdicao` (passando os vínculos existentes para a checagem de
      duplicata) antes de gravar
    - Numa única `prisma.$transaction`: atualiza `Produto.descricao`/`imagemUrl`,
      faz upsert de `AtributoGrafico` por `[empresaId, produtoId]`, cria/deleta
      `DeParaImportacao` (add → `create`, captura `P2002` → `CentralProdutoError(409)`;
      remove → `deleteMany` por `empresaId`)
    - **NÃO** toca `OrdemProducao`/`CalculoGrafico`/`ItemOrcamentoGrafico` (Req 9.4)
    - Rollback total em qualquer falha (Req 9.5); retorna o `DetalheProduto` atualizado
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.7, 11.4_
  - [x] 10.2 Property test — não-vazamento multi-tenant na escrita (repo mockado)
    - **Property 13: Não-vazamento multi-tenant na escrita**
    - **Validates: Requirements 11.4**
    - `// Feature: comercial-central-produto-acabado, Property 13: ...` · ≥100 iterações
    - Entidade (Produto/AtributoGrafico/vínculo) de empresa ≠ usuário ⇒ rejeita e
      nenhuma gravação ocorre

- [x] 11. Schemas Zod e rotas Fastify
  - [x] 11.1 Implementar schemas Zod em `central-produto.schemas.ts`
    - `buscaQuerySchema` (`termo` min 1; o "min 2 após trim" é do service),
      `detalheQuerySchema` (`produtoId` XOR `calculoId`), `edicaoBodySchema`
      (descricao 1..200, imagemUrl 1..500 nullable, fichaTecnica com uuids, listas
      de acabados)
    - _Requirements: 1.5, 9.1, 9.7_
  - [x] 11.2 Implementar `central-produto.routes.ts` (prefixo `/api/comercial/central-produto`)
    - Hook `authenticate`; resolve `empresaId`/perfil da sessão; `formatarErroZod`
      para 400 "campo: motivo"; traduz `CentralProdutoError` → HTTP (400/403/404/409)
    - `GET /busca?termo=` → `buscarCentralProduto` (leitura, autenticado)
    - `GET /detalhe?produtoId=|?calculoId=` → `obterDetalhe` (leitura)
    - `GET /permissao` → `{ podeEditar }` via `permitirEdicao` (flags Comercial/PCP + ADMIN)
    - `PATCH /produto/:produtoId` → verifica `podeEditar` ANTES de gravar (403 se
      não; Req 9.6/10.2) → `aplicarEdicao`
    - _Requirements: 1.1, 1.5, 4.1, 9.3, 9.6, 10.2, 12.3_
  - [x] 11.3 Registrar as rotas em `server.ts` com o prefixo `/api/comercial/central-produto`
    - _Requirements: 12.1, 12.2, 12.3_

- [x] 12. Testes de integração (backend)
  - [x] 12.1* Integração — edição transacional e rollback
    - Adicionar/remover vínculo + editar descrição/ficha numa transação; forçar erro
      no meio e confirmar rollback total preservando o estado anterior
    - _Requirements: 9.2, 9.3, 9.5_
  - [x] 12.2* Integração — permissão (403)
    - Usuário sem `podeEditarCadastros` (não-ADMIN) recebe 403 no `PATCH` e nada é gravado
    - _Requirements: 9.6, 10.2_
  - [x] 12.3* Integração — isolamento multi-tenant na escrita (404 cross-empresa)
    - `PATCH` em produto de outra empresa ⇒ 404, sem gravação
    - _Requirements: 11.4_
  - [x] 12.4* Integração — select de OrdemProducao SEM pdfData
    - Confirmar que o histórico de OPs não materializa `pdfData` no `select`
    - _Requirements: 7.3_
  - [x] 12.5* Não-regressão — não altera motor de cálculo nem importação de OP
    - Revisão + ausência de escrita em `CalculoGrafico`/motor e no fluxo de
      importação de OP (PDF/agente)
    - _Requirements: 13.1, 13.2_

- [x] 13. Checkpoint — backend completo
  - `get_diagnostics` limpo nos arquivos do módulo; todos os property tests
    (1–13) e os testes de integração passam. Ask the user if questions arise.

### FRONTEND (`VisioFab.Wms.Front` — repositório separado)

- [x] 14. Hooks react-query
  - [x] 14.1 Criar `src/hooks/central-produto/` com os hooks
    - `useBuscaCentralProduto(termo)` — `GET /busca` (enabled quando
      `termo.trim().length >= 2`, com debounce)
    - `useDetalheProduto({ produtoId | calculoId })` — `GET /detalhe`
    - `usePermissaoCentralProduto()` — `GET /permissao`
    - `useEditarProduto()` — `PATCH /produto/:id` + `invalidateQueries` do detalhe
    - _Requirements: 1.1, 4.1, 9.3, 10.1_

- [x] 15. Tela única (busca + detalhe + modais de edição)
  - [x] 15.1 Criar `src/app/(interna)/comercial/central-produto/page.tsx` — busca + detalhe
    - Campo de busca com debounce; se `detalheDireto`, abre o detalhe direto; se N
      grupos, lista selecionável; se `semResultado`, mensagem preservando o termo
    - Blocos: Identificação, Arte, Ficha Técnica, Histórico de OPs (tabela só
      leitura), Cálculos/Orçamentos (tabela só leitura)
    - _Requirements: 1.1, 3.3, 3.4, 3.5, 4.1, 5.1, 6.1, 7.1, 7.3, 8.1, 8.3, 12.3_
  - [x] 15.2 Modais de edição (visíveis só quando `podeEditar`)
    - Editar descrição/arte; editar ficha técnica (selects dos cadastros gráficos);
      gerenciar vínculos de código acabado (adicionar/remover chips)
    - Campos cadastrais em modo só-leitura quando `podeEditar=false`
    - _Requirements: 9.1, 9.2, 10.1_
  - [x] 15.3* Testes de componente/hook (react-query)
    - Busca com `detalheDireto`, lista de N grupos, `semResultado` preservando o
      termo; modais ocultos quando `podeEditar=false`
    - _Requirements: 3.4, 3.5, 10.1_

- [x] 16. Itens de menu no ModuleSidebar (duas chaves)
  - Adicionar "Central do Produto" → `/comercial/central-produto` em
    `ModuleSidebar.tsx` nas DUAS chaves: `'orcamento-grafico'` (Comercial) e
    `'pcp'` (PCP), reutilizando a mesma rota
  - _Requirements: 12.1, 12.2, 12.3_

### VERIFICAÇÃO E DOCUMENTAÇÃO

- [x] 17. Verificação final (sem regressão)
  - Rodar `get_diagnostics` nos arquivos backend e frontend tocados
  - Rodar a suíte de testes do módulo (property + unit + integração) e confirmar
    verde, sem regressão no módulo Comercial/PCP/orçamento gráfico
  - _Requirements: 13.1, 13.2_

- [x] 18. Atualizar o doc-mestre `docs/PROJETO-MODULO-COMERCIAL.md` (documentação, não código)
  - Marcar o **Ponto 3 / seção 19.3** como **feito**, com um resumo do que foi
    entregue (tela única Comercial+PCP, busca por código acabado/nome, blocos
    consolidados, edição transacional de cadastro, zero mudança de schema)
  - _Requirements: 12.1, 12.2, 12.3_

## Notes

- **Zero schema**: não há tarefa de migração/`schema.prisma`/`migrate-prod.ts`. O
  design reusa `DeParaImportacao`/`CalculoGrafico`/`AtributoGrafico`. Se surgir
  necessidade de schema, PARAR e confirmar com o usuário (Req 13.3/13.4).
- **Repos separados**: tarefas 1–13 = backend (`VisioFab.Wms.Back`); 14–16 =
  frontend (`VisioFab.Wms.Front`); 17–18 = verificação/documentação.
- **Property tests são o núcleo obrigatório** (não marcados com `*`): implementam
  as 13 Correctness Properties, fast-check, ≥100 iterações, comentário
  `// Feature: comercial-central-produto-acabado, Property N: ...`, uma propriedade
  = um teste.
- Tarefas marcadas com `*` (unit/integração complementares e testes de componente
  do front) são opcionais para um MVP mais rápido, mas recomendadas.
- `empresaId` **explícito** em toda query (nunca só `prismaScoped` — bypass
  SUPER_ADMIN); `select` de `OrdemProducao` **sem `pdfData`**.
- Cada tarefa referencia os requisitos que cobre para rastreabilidade.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "3.1", "4.1", "5.1", "6.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "3.2", "4.2", "4.3", "5.2", "6.2", "6.3", "6.4", "6.5", "6.6"] },
    { "id": 3, "tasks": ["8.1", "9.1"] },
    { "id": 4, "tasks": ["8.2", "8.3", "9.2", "10.1"] },
    { "id": 5, "tasks": ["10.2", "11.1"] },
    { "id": 6, "tasks": ["11.2"] },
    { "id": 7, "tasks": ["11.3", "12.1", "12.2", "12.3", "12.4", "12.5"] },
    { "id": 8, "tasks": ["14.1"] },
    { "id": 9, "tasks": ["15.1", "16"] },
    { "id": 10, "tasks": ["15.2"] },
    { "id": 11, "tasks": ["15.3"] }
  ]
}
```
