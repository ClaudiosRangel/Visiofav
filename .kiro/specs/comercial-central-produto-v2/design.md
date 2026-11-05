# Design — Central do Produto v2

## Visão geral

Estende a Central v1 (submódulo `src/modules/comercial/central-produto/`) com um
Item Master versionado. A v1 (busca/consolidação/detalhe/edição) permanece
intacta; a v2 adiciona services e rotas novas, 3 tabelas novas e 1 derivação
pura (matriz a partir da tag `[Matriz]`). Frontend: nova aba "Ficha Master" no
detalhe + listagem geral de produtos.

Referências: `docs/PROJETO-MODULO-COMERCIAL.md` §20.3 (Pilar 2) e
`docs/matriz-faca-fonte-de-dados.md` (fonte da matriz).

## Schema (Prisma) — 3 tabelas novas, aditivas, idempotentes

Todas com `empresaId`, FK para `Produto` (onDelete Cascade) e no mesmo commit
do `migrate-prod.ts` idempotente (Postgres local off; roda no deploy do Render).

### `FichaGraficaProduto` (`ficha_grafica_produto`)
- `id`, `empresaId`, `produtoId` — `@@unique([empresaId, produtoId])` (1:1).
- Campos: `cartao` (String?), `gramatura` (String?), `numCores` (Int?),
  `coresDescricao` (String? Text), `acabamentos` (String? Text),
  `matrizManual` (String?), `imagemFaca` (String? @db.Text — dataURL),
  `modeloFacaId` (String? — FK opcional a `ModeloFaca`), `observacoes` (Text?),
  `criadoEm`/`atualizadoEm`.
- **imagemFaca NUNCA em select de listagem** (pode ser grande).

### `ArteRevisaoProduto` (`arte_revisao_produto`)
- `id`, `empresaId`, `produtoId`, `numero` (Int — sequencial por produto),
  `estado` (VARCHAR: RASCUNHO|EM_APROVACAO|APROVADA|REPROVADA|OBSOLETA),
  `descricao` (String?), `imagens` (String[] — dataURLs; até 4),
  `aprovadaPorId`/`aprovadaEm`/`comentario`, `criadoEm`/`atualizadoEm`.
- `@@unique([empresaId, produtoId, numero])`, `@@index([empresaId, produtoId, estado])`.
- As imagens vêm só no detalhe de UMA revisão; a listagem retorna
  `qtdImagens`/`estado` (select sem `imagens`).

### `DimensaoProduto` (`dimensao_produto`)
- `id`, `empresaId`, `produtoId`, `tipo` (VARCHAR: PRODUTO_FINAL|PLANIFICADO|FOLHA),
  `larguraMm`/`alturaMm`/`profundidadeMm` (Decimal(10,2)?), `observacao` (String?),
  `criadoEm`/`atualizadoEm`. `@@index([empresaId, produtoId])`.

Relações inversas em `Produto`: `fichaGrafica`, `artesRevisao[]`, `dimensoes[]`.
`ModeloFaca` ganha inversa `fichasGraficas FichaGraficaProduto[]`.

## Funções PURAS (testáveis, sem Prisma)

Arquivo `central-produto-v2.motor.ts`:
- `proximaRevisao(revisoesExistentes: {numero}[]): number` — max+1, começa em 1.
- `validarImagensRevisao(imagens: string[])` — 1..4; lança `CentralProdutoV2Error`
  (400) fora do intervalo.
- `transicaoArte(atual, novo)` — valida a máquina (RASCUNHO→EM_APROVACAO→
  APROVADA|REPROVADA; APROVADA→OBSOLETA; REPROVADA→RASCUNHO). Inválida ⇒ erro.
- `aplicarAprovacao(revisoes, idAprovada)` — retorna o conjunto com a aprovada
  vigente e as demais aprovadas marcadas OBSOLETA (regra "só uma vigente").
- `derivarMatriz(obsDasOps: (string|null)[]): string | null` — extrai a 1ª tag
  `[Matriz]` não-vazia (regex `/\[Matriz\]\s*(.+?)(?:\n|$)/i`), na ordem passada
  (OPs já ordenadas por mais recente).
- `podeExcluir(mov: {pedidos, ops, notas, itensOrcamento, saldos}): {ok, motivo?}`
  — ok só quando TODOS os contadores são 0; senão motivo textual.
- `resolverMatrizExibida(matrizManual, derivada)` — manual tem precedência.

Property-based (fast-check):
- P1 `proximaRevisao` sempre > todos os números existentes.
- P2 `validarImagensRevisao` aceita exatamente 1..4.
- P3 `aplicarAprovacao` resulta em no máximo 1 APROVADA.
- P4 `podeExcluir` ok ⟺ soma dos contadores = 0.
- P5 `transicaoArte` nunca permite pular estado (ex.: RASCUNHO→APROVADA direto).

## Services de I/O (empresaId EXPLÍCITO)

Arquivo `central-produto-v2.service.ts`:
- `obterFichaMaster(empresaId, produtoId)` — ficha + artes (resumo) + dimensões +
  matriz derivada (lê tag `[Matriz]` das OPs do produto, select só `observacoes`)
  + vínculo estrutura ativa (leitura) + flag `podeExcluir` (conta movimentação).
- `salvarFicha(empresaId, produtoId, dados)` — upsert `FichaGraficaProduto`
  (valida cross-empresa 404; `modeloFacaId` validado na empresa quando enviado).
- `criarRevisaoArte` / `obterRevisaoArte` (com imagens) / `transicionarRevisao`
  (usa `transicaoArte` + `aplicarAprovacao` na aprovação, transação) — grava
  aprovadaPor/Em/comentario.
- `listarDimensoes` / `salvarDimensao` / `removerDimensao`.
- `totalizadoresVenda(empresaId, produtoId, {meses, topClientes})` — agrega
  `ItemDocumentoFiscal` de SAÍDA (groupBy no banco; join ao documento p/ data e
  cliente); retorna total qtd/valor + top clientes. Sem notas ⇒ zeros.
- `listarProdutos(empresaId, {status, comFicha, texto, page, pageSize})` —
  listagem paginada para a carga inicial; select enxuto (sem imagens).
- `inativarProduto` / `reativarProduto` / `excluirProduto` (usa `podeExcluir`;
  409 com motivo quando há movimentação). Permissão `podeEditarCadastros` + ADMIN.

## Rotas (prefixo `/api/comercial/central-produto`, reusa `central-produto.routes.ts`)

Aditivas à v1 (a v1 continua):
- `GET /produtos` — listagem paginada (carga inicial / filtros).
- `GET /ficha-master/:produtoId` — Item Master consolidado.
- `PUT /ficha-master/:produtoId/ficha` — salva ficha gráfica.
- `GET /ficha-master/:produtoId/artes` — lista revisões (resumo, sem imagens).
- `POST /ficha-master/:produtoId/artes` — cria revisão (≤4 imagens).
- `GET /artes/:revisaoId` — detalhe da revisão (com imagens).
- `PATCH /artes/:revisaoId/estado` — transição (aprovar/reprovar/obsoletar).
- `GET/POST /ficha-master/:produtoId/dimensoes`, `PUT/DELETE /dimensoes/:id`.
- `GET /ficha-master/:produtoId/vendas` — totalizadores.
- `PATCH /produtos/:produtoId/status` — inativar/reativar.
- `DELETE /produtos/:produtoId` — exclusão protegida (409 se movimentado).

Autenticação `authenticate`; escrita exige `podeEditarCadastros` (ADMIN bypass),
reusando o `central-produto-permissao.ts` da v1. `empresaId` do `request.user`.

## Frontend (`VisioFab.Wms.Front`)

- `comercial/central-produto/page.tsx` (v1) ganha um **modo "Todos os produtos"**
  (listagem paginada via `GET /produtos`) além da busca por termo.
- Nova aba/seção "Ficha Master" no detalhe do produto:
  - Ficha gráfica editável (cartão/gramatura/cores/acabamentos/matriz manual/
    imagem da faca/observações; vínculo ModeloFaca opcional).
  - **Matriz**: mostra a derivada das OPs (badge) + campo manual que sobrepõe.
  - **Arte versionada**: lista de revisões com estado + galeria da aprovada;
    criar revisão (upload ≤4), aprovar/reprovar (comentário).
  - **Dimensões**: tabela editável (tipo + medidas).
  - **Vendas**: cards de total + top clientes (período).
  - **Ações do produto**: Inativar/Reativar; Excluir (desabilitado + tooltip
    quando `podeExcluir=false`).
- Reusa o modal de imagem ampliada já existente.

## Multi-tenant e não-regressão

- `empresaId` explícito em 100% das queries novas (padrão da v1).
- OPs lidas só com `select` SEM `pdfData` (steering pcp-modulo §9.1).
- A v1 não é alterada em comportamento; os testes da v1 continuam.
- Schema aditivo (3 CREATE TABLE IF NOT EXISTS + índices + 1 ADD COLUMN p/ a
  inversa não precisa — relação é via FK nas tabelas novas). FK via try/catch.

## Riscos

- Imagens em TEXT (dataURL) podem crescer — mitigado por nunca trafegá-las em
  listagens (só no detalhe de 1 revisão) e limite de 4/revisão.
- Totalizadores de venda dependem do modelo fiscal real (`ItemDocumentoFiscal`);
  validar os campos reais (produtoId, documento com data/cliente/tipo saída)
  antes de agregar — se o vínculo não existir, degradar para "sem vendas".
