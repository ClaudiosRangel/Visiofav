# Implementation Plan: Comercial: Pedido/Proposta (RFQ)

## Overview

Plano de implementação incremental e test-driven. **Repos separados**: Backend =
`VisioFab.Wms.Back`; Frontend = `VisioFab.Wms.Front` — cada tarefa indica
explicitamente o repo. No backend, `schema.prisma` + `migrate-prod.ts` sempre no
MESMO commit. Testes com `vitest + fast-check --reporter=dot`. Tarefas opcionais
(property-based extras) marcadas com `*`.

## Task Dependency Graph

```
1 (Schema + migrate-prod)
└─ 2 (Máquina de estados pura) ─ 2.1 (testes)
   └─ 3 (CRUD + transição) ─ 3.1 (testes)
      ├─ 4 (Anexos BYTEA) ─ 4.1 (testes)
      ├─ 5 (Encaminhar) ─ 5.1 (golden)
      │   └─ 6 (Liberar) ─ 6.1 (testes) ─ 6.2* (opcional)
      │      └─ 7 (Ver proposta)
      │         └─ 8 (Rotas + registro server.ts)
      │            └─ 9 (Frontend lista) ─ 9.1 (botão RFQ) ─ 9.2 (form RFQ) ─ 9.3 (ver proposta)
      │               └─ 10 (Verificação final)
```

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"] },
    { "wave": 2, "tasks": ["2", "2.1"] },
    { "wave": 3, "tasks": ["3", "3.1"] },
    { "wave": 4, "tasks": ["4", "4.1", "5", "5.1"] },
    { "wave": 5, "tasks": ["6", "6.1", "6.2"] },
    { "wave": 6, "tasks": ["7", "8"] },
    { "wave": 7, "tasks": ["9", "9.1", "9.2", "9.3"] },
    { "wave": 8, "tasks": ["10"] }
  ]
}
```

## Tasks

### 1. Schema e migração (Backend)

- [ ] 1. [Backend] Criar schema dos 3 models + coluna aditiva E o bloco idempotente do migrate-prod no MESMO item
  - Em `prisma/schema.prisma`: adicionar os models `PedidoProposta` (map `pedido_proposta`), `AnexoPedidoProposta` (map `anexo_pedido_proposta`, campo `dados Bytes`), `LogPedidoProposta` (map `log_pedido_proposta`), com todos os campos, `@@unique([empresaId, numero])`, índices e relações Cascade conforme o design.
  - No MESMO model `OrcamentoGrafico`: adicionar a coluna aditiva `pedidoPropostaId String? @map("pedido_proposta_id")`.
  - Em `prisma/migrate-prod.ts` (MESMO commit): adicionar o bloco idempotente — 3 `CREATE TABLE IF NOT EXISTS` (incl. `dados BYTEA NOT NULL`), `CREATE UNIQUE INDEX IF NOT EXISTS` da numeração, `CREATE INDEX IF NOT EXISTS` (empresa+estado, empresa+origem, índices dos anexos/logs), as 2 FKs Cascade em `try/catch` e o `ALTER TABLE "orcamento_grafico" ADD COLUMN IF NOT EXISTS "pedido_proposta_id" TEXT`.
  - Rodar `npx prisma generate`.
  - Rodar `npx tsx prisma/migrate-prod.ts` DUAS vezes local (idempotência; se o Postgres local estiver indisponível, registrar que roda no deploy do Render — idempotência garantida por `IF NOT EXISTS` / FK em try/catch).
  - _Requirements: 1.1, 2.1, 2.3, 3.1, 4.9, 5.5, 10.1_

### 2. Máquina de estados pura (Backend)

- [ ] 2. [Backend] Implementar `pedido-proposta-estado.service.ts` (PURO, sem Prisma)
  - Criar `src/modules/orcamento-grafico/pedido-proposta/pedido-proposta-estado.service.ts`: tipo `EstadoProposta`, classe `PedidoPropostaError(statusCode, message, code)`, mapa `TRANSICOES`, `ESTADOS_COM_MOTIVO`, `validarTransicao(atual, novo, motivo?)`, `getTransicoesPermitidas(atual)`, `isTerminal(estado)`.
  - `validarTransicao` lança `ESTADO_TRANSICAO_INVALIDA` quando fora do mapa e `MOTIVO_OBRIGATORIO` quando destino PERDIDO/CANCELADO com motivo < 5 chars.
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.10_

- [ ] 2.1 [Backend] Testes property-based da máquina de estados (`pedido-proposta-estado.service.test.ts`)
  - P1: para todo `(atual, novo)` em `EstadoProposta²`, lança `ESTADO_TRANSICAO_INVALIDA` ⟺ `novo ∉ TRANSICOES[atual]`.
  - P2 (edge-case): de `ACEITO|PERDIDO|CANCELADO`, toda transição lança.
  - P3: transição válida p/ PERDIDO/CANCELADO exige `motivo` ≥5 (ausente/<5 → `MOTIVO_OBRIGATORIO`; ≥5 → sucesso).
  - P4: `getTransicoesPermitidas` pura (mesmo input → mesma saída) e `isTerminal` ⟺ lista vazia.
  - Rodar `npx vitest run src/modules/orcamento-grafico/pedido-proposta/pedido-proposta-estado.service.test.ts --reporter=dot`.
  - _Requirements: 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.10_

### 3. CRUD + transição de estado (Backend)

- [ ] 3. [Backend] Implementar `pedido-proposta.service.ts` (CRUD + transição; empresaId EXPLÍCITO)
  - Criar `src/modules/orcamento-grafico/pedido-proposta/pedido-proposta.service.ts` com `criarPedidoProposta`, `atualizarPedidoProposta`, `obterPedidoProposta` (sem `dados`), `listarPedidosProposta` (filtros estado/origem/tipo + busca case-insensitive em cliente/produto), `transicionarEstado` (usa a máquina pura, grava `LogPedidoProposta` com estado anterior/novo/usuário/data).
  - Validações de criação: `origem ∈ {REPRESENTANTE,VENDEDOR,INTERNA}`, `tipoPedido ∈ {REPETICAO,MOSTRUARIO,NOVO}`, `REPRESENTANTE_OBRIGATORIO`, `VENDEDOR_OBRIGATORIO`, `mercado` obrigatório, `tipoEntrega=FRACIONADA ⇒ entregaFracionadaDias`, defaults `false` dos booleanos. Numeração `max(numero)+1` por `empresaId`.
  - Todas as queries filtram `empresaId` EXPLÍCITO; recurso de outra empresa → `NAO_ENCONTRADO` (404).
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 2.1, 2.3, 2.4, 2.5, 2.6, 2.7, 4.1, 4.9, 9.1, 9.2, 9.3, 9.4, 10.1, 10.2, 10.5_

- [ ] 3.1 [Backend] Testes property-based de criação/estado (`pedido-proposta.service.test.ts`, com mocks Prisma)
  - P1: criação aceita ⟺ enums válidos; qualquer outro valor → `VALIDACAO`.
  - P2: `REPRESENTANTE` sem `representanteId` → `REPRESENTANTE_OBRIGATORIO`; `VENDEDOR` sem `vendedorId` → `VENDEDOR_OBRIGATORIO`; `INTERNA` dispensa ambos.
  - P3: `tipoEntrega=FRACIONADA` sem `entregaFracionadaDias` → `ENTREGA_FRACIONADA_DIAS_OBRIGATORIO`; `UNICA` ignora o campo.
  - P12 (example): recurso de `empresaId` diferente → 404 sem expor dados.
  - Rodar `npx vitest run ... --reporter=dot`.
  - _Requirements: 1.2, 1.3, 1.4, 1.6, 1.7, 1.8, 2.4, 2.5, 2.6, 10.1, 10.2_

### 4. Anexos BYTEA (Backend)

- [ ] 4. [Backend] Implementar `anexo-pedido-proposta.service.ts` (BYTEA; mime/limite/tamanho)
  - Criar `src/modules/orcamento-grafico/pedido-proposta/anexo-pedido-proposta.service.ts` com `adicionarAnexo` (valida `image/*`, limite 5, tamanho ≤ 10MB, grava `nome/tipo/tamanho/dados`), `obterAnexoBinario` (retorna `{tipo, dados, nome}`), `removerAnexo`, `listarAnexosMetadados` (SEM `dados`, via `select` explícito).
  - Classe de erro com `MIME_INVALIDO`, `ARQUIVO_GRANDE`, `LIMITE_ANEXOS`. Toda operação valida que o `PedidoProposta` pai pertence ao `empresaId` do usuário antes de executar.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 10.3_

- [ ] 4.1 [Backend] Testes property-based de anexos (`anexo-pedido-proposta.service.test.ts`, com mocks)
  - P5 (mime): mime que não começa com `image/` → `MIME_INVALIDO`; `image/*` passa.
  - P6 (limite): dado `n ∈ [0..6]` anexos existentes, aceitar ⟺ `n < 5`; `n ≥ 5` → `LIMITE_ANEXOS`.
  - P7 (tamanho): buffer > 10MB → `ARQUIVO_GRANDE`.
  - P9 (example): listagem/detalhe nunca contém `dados`, só metadados.
  - Rodar `npx vitest run ... --reporter=dot`.
  - _Requirements: 3.2, 3.3, 3.5, 3.6_

### 5. Encaminhar para orçamento (Backend)

- [ ] 5. [Backend] Implementar `encaminhar-orcamento.service.ts` (REUSA mapeamento da solicitação; transação atômica)
  - Criar `src/modules/orcamento-grafico/pedido-proposta/encaminhar-orcamento.service.ts#criarOrcamentoDePedidoProposta`.
  - Reusar o mapeamento de `criarOrcamentoGraficoDeSolicitacao` (resolver `tipoEmbalagem` texto → FK, montar `medidas {L,A,P}` a partir de `medidasTexto` "C x L x A", observações). Extrair helper comum `mapear-para-orcamento.ts` SOMENTE se reduzir duplicação sem regressão no fluxo da solicitação (em produção); senão manter cópia enxuta documentada.
  - Pré-condição `estado == EM_ANALISE` (senão `RFQ_NAO_APTO_ENCAMINHAR` 409); `TIPO_EMBALAGEM_NAO_RESOLVIDO` quando texto sem match único e sem override.
  - `$transaction`: cria `OrcamentoGrafico` RASCUNHO (`etapaCalculo='AGUARDANDO'`, `empresaId` do RFQ, cliente/vendedor herdados, `exigeAmostra` propagado), grava `OrcamentoGrafico.pedidoPropostaId` + `PedidoProposta.orcamentoGraficoId`, transiciona RFQ → `ENVIADO_ORCAMENTO`. Falha → nada órfão, estado inalterado.
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 10.4_

- [ ] 5.1 [Backend] Golden do encaminhamento (`encaminhar-orcamento.service.test.ts`, mocks Prisma)
  - G1: RFQ `EM_ANALISE` com `tipoEmbalagem` que casa único → cria `OrcamentoGrafico` RASCUNHO `etapaCalculo=AGUARDANDO` com `pedidoPropostaId` gravado, `medidas` corretas a partir de `medidasTexto`, e RFQ vira `ENVIADO_ORCAMENTO`.
  - G2: RFQ em estado ≠ `EM_ANALISE` → `RFQ_NAO_APTO_ENCAMINHAR`, nada criado.
  - G3: falha na criação do orçamento (transação) → estado do RFQ inalterado, sem orçamento órfão.
  - Rodar `npx vitest run ... --reporter=dot`.
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

### 6. Liberar a PCP/Faturamento (Backend)

- [ ] 6. [Backend] Implementar `liberar-pedido-proposta.service.ts` (checa Fases_Exigidas; compõe cadeia existente)
  - Criar `src/modules/orcamento-grafico/pedido-proposta/liberar-pedido-proposta.service.ts#liberarPedidoDePedidoProposta`.
  - Checar: orçamento vinculado existe e está orçado; `estado == ACEITO`; `OrcamentoGrafico.etapaCalculo == VALIDADO`; se `exigeAmostra`, `AprovacaoAmostra` (via `orcamentoId == orcamentoGraficoId`) APROVADA; perfil Supervisor_Comercial (ADMIN/SUPER_ADMIN/SUPERVISOR).
  - Qualquer fase não resolvida → `FASES_PENDENTES` (409, corpo lista `fasesPendentes[]`) ou `AMOSTRA_PENDENTE` (409); sem permissão → `SEM_PERMISSAO_LIBERACAO` (403).
  - Tudo resolvido → compor a cadeia existente: `converterOrcamentoEmPedido(orcamentoGraficoId)` → `liberarPedidoParaPcp(empresaId, pedidoVendaId, usuarioId, {senha})`. Validar `empresaId` do pedido antes de aplicar.
  - _Requirements: 7.1, 7.5, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 10.5_

- [ ] 6.1 [Backend] Testes de liberação (`liberar-pedido-proposta.service.test.ts`, mocks)
  - Fases pendentes isoladas (sem orçamento / estado ≠ ACEITO / etapaCalculo ≠ VALIDADO / amostra pendente) → `FASES_PENDENTES`/`AMOSTRA_PENDENTE` com a lista correta das fases.
  - Todas resolvidas + Supervisor → compõe `converterOrcamentoEmPedido` + `liberarPedidoParaPcp`.
  - Não-Supervisor → `SEM_PERMISSAO_LIBERACAO`.
  - Rodar `npx vitest run ... --reporter=dot`.
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.7_

- [ ] 6.2* [Backend] (Opcional) Property-based das fases de liberação (P11)
  - Para todo subconjunto das Fases_Exigidas resolvido, liberar sucede ⟺ TODAS resolvidas (+ amostra quando `exigeAmostra`); qualquer subconjunto não-resolvido → `FASES_PENDENTES`/`AMOSTRA_PENDENTE` listando exatamente as pendentes.
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

### 7. Ver proposta no orçamento (Backend)

- [ ] 7. [Backend] Leitura da proposta por orçamento (somente-leitura + metadados de anexos)
  - Implementar a consulta usada por `GET /pedidos-proposta/por-orcamento/:orcamentoId`: retorna todos os campos do RFQ de origem (somente-leitura) + lista de metadados de anexos (`id/nome/tipo/tamanho`) com a referência de leitura por imagem; `{ proposta: null }` quando o orçamento não tem RFQ vinculado; orçamento de outra empresa → 404.
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 10.2_

### 8. Rotas e registro (Backend)

- [ ] 8. [Backend] Implementar `pedido-proposta.routes.ts` e registrar em `server.ts`
  - Criar `src/modules/orcamento-grafico/pedido-proposta/pedido-proposta.routes.ts` (prefixo `/api/orcamento-grafico`, `authenticate` + `empresaId` explícito) com: `GET/POST /pedidos-proposta`, `GET/PUT /pedidos-proposta/:id`, `PATCH /pedidos-proposta/:id/estado`, `POST /pedidos-proposta/:id/encaminhar`, `POST /pedidos-proposta/:id/liberar`, `POST/GET/DELETE /pedidos-proposta/:id/anexos[/:anexoId]`, `GET /cnpj/:cnpj` (reusa `enriquecerCnpj`), `GET /pedidos-proposta/por-orcamento/:orcamentoId`.
  - Upload multipart (`request.file()` + `file.toBuffer()`, só `image/*`, ≤10MB). GET do anexo seta `reply.type(anexo.tipo)` + `Content-Disposition inline` e aceita token via query param (padrão `GET /pcp/op-pdf/:opId`). Handler Zod compõe mensagem "campo: motivo".
  - Registrar `pedidoPropostaRoutes` em `src/server.ts`.
  - _Requirements: 2.2, 3.4, 6.3, 9.1, 9.3, 9.4_

### 9. Frontend (`VisioFab.Wms.Front`)

- [ ] 9. [Frontend] Listar PedidoProposta na tela `orcamento-grafico/pedidos/page.tsx` (filtros + ações)
  - Passar a consumir `GET /pedidos-proposta` com filtros estado/origem/tipo + busca textual; exibir, por linha, estado/origem/tipo + estágio do funil + andamento da amostra (badges).
  - Ações por linha: "Encaminhar" (`POST .../encaminhar`) e "Liberar" (`POST .../liberar`, tratando `FASES_PENDENTES`/`AMOSTRA_PENDENTE`/`SEM_PERMISSAO_LIBERACAO`).
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 5.1, 8.5, 8.6, 8.7_

- [ ] 9.1 [Frontend] Trocar o botão "Novo pedido/proposta" para abrir o formulário RFQ (não o Novo Orçamento)
  - Na tela de pedidos, o botão "Novo pedido/proposta" passa a abrir o formulário RFQ (criação de `PedidoProposta`), em vez de abrir o fluxo "Novo Orçamento".
  - _Requirements: 1.1, 5.7_

- [ ] 9.2 [Frontend] Formulário RFQ (campos da planilha + consulta CNPJ + galeria de até 5 imagens)
  - Formulário com todos os campos da planilha Carton Wega (identificação do cliente, comerciais e técnicos, discriminação, observações), com `mercado` obrigatório e a regra `tipoEntrega=FRACIONADA ⇒ entregaFracionadaDias`.
  - Consulta de CNPJ via `GET /cnpj/:cnpj` para autopreenchimento dos dados do cliente.
  - Galeria de até 5 imagens: upload (`POST .../anexos`), preview (via `GET .../anexos/:anexoId` com token na query) e remover (`DELETE .../anexos/:anexoId`); bloquear o 6º upload.
  - Criar/salvar via `POST`/`PUT /pedidos-proposta[/:id]`.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 9.3 [Frontend] Botão "Ver proposta" no detalhe do orçamento (`orcamento-grafico/[id]/page.tsx`) com galeria
  - Adicionar botão "Ver proposta" que abre a proposta de origem somente-leitura via `GET /pedidos-proposta/por-orcamento/:orcamentoId`, exibindo todos os campos + galeria de imagens; quando `{ proposta: null }`, indicar ausência sem erro.
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

### 10. Verificação final

- [ ] 10. [Backend + Frontend] Verificação e não-regressão
  - [Backend] `get_diagnostics` em todos os arquivos tocados (schema, migrate-prod, services, rotas, server.ts).
  - [Backend] `npx prisma generate`.
  - [Backend] Rodar a suíte `orcamento-grafico` inteira sem regressão, incluindo o golden 15.235 (`--reporter=dot`).
  - [Backend] Confirmar `npx tsx prisma/migrate-prod.ts` idempotente (2×) ou registrar execução no deploy.
  - [Frontend] `get_diagnostics` nos arquivos tocados + `npm run build` (Next) sem erros.
  - _Requirements: 1.1, 5.1, 8.6, 9.1_

## Notes

- **Repos separados**: cada tarefa indica `[Backend]` ou `[Frontend]`. Commits são
  por repo; no backend `schema.prisma` + `migrate-prod.ts` vão no MESMO commit.
- **Regra de schema (tarefa 1)**: o mesmo item altera `schema.prisma` E o bloco
  idempotente em `migrate-prod.ts`, roda `npx prisma generate` e executa
  `npx tsx prisma/migrate-prod.ts` 2× local (idempotência).
- **Reaproveitamentos (não reescrever)**: `criarOrcamentoGraficoDeSolicitacao`
  (mapeamento), `converterOrcamentoEmPedido`, `liberarPedidoParaPcp`,
  `amostra.service.ts`/`AprovacaoAmostra`, `enriquecerCnpj`.
- **Multi-tenant**: `empresaId` EXPLÍCITO em toda query; cross-empresa → 404.
- **BYTEA**: `select` explícito nas listagens (nunca materializar `dados`); imagem
  servida por rota GET dedicada que seta `Content-Type` e aceita token na query.
- **Tarefas opcionais** (`*`): property-based extras; podem ser puladas sem
  bloquear o fluxo principal.
- **Não-regressão**: a tarefa 10 roda a suíte `orcamento-grafico` inteira incl. o
  golden 15.235 e o build Next.
