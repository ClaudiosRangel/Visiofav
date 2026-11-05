# Implementation Plan — Central do Produto v2

## Overview

Estende a Central v1 com Item Master versionado. Motor puro + testes → schema/
migrate → services I/O → rotas → front → verificação/commit. Reusa a v1
(permissão, errors, tipos) e NÃO toca o motor de cálculo.

## Tasks

- [x] 1. Motor puro `central-produto-v2.motor.ts` + testes
  - `proximaRevisao`, `validarImagensRevisao` (1..4), `transicaoArte` (máquina),
    `aplicarAprovacao` (só 1 vigente), `derivarMatriz` (tag `[Matriz]`),
    `podeExcluir`, `resolverMatrizExibida`; `CentralProdutoV2Error`.
  - `central-produto-v2.motor.test.ts` — Properties P1–P5 (fast-check) + goldens.
  - _Requirements: 2.2, 2.3, 3.1, 6.2, 9.4_

- [x] 2. Schema + migrate-prod (3 tabelas novas)
  - `FichaGraficaProduto` (1:1), `ArteRevisaoProduto`, `DimensaoProduto` + relações
    inversas em `Produto` e `ModeloFaca`; `migrate-prod.ts` idempotente
    (CREATE TABLE/INDEX/UNIQUE IF NOT EXISTS + FK try/catch); `prisma generate`;
    rodar `migrate-prod.ts` 2x local mental (idempotência garantida por IF NOT EXISTS).
  - _Requirements: 1.1, 2.1, 4.1, 9.3_

- [x] 3. Service de leitura `obterFichaMaster` + `totalizadoresVenda` + `listarProdutos`
  - `obterFichaMaster` (ficha + artes resumo + dimensões + matriz derivada das OPs
    [select só observacoes, sem pdfData] + estrutura ativa leitura + flag
    podeExcluir). `totalizadoresVenda` (agrega `ItemDocumentoFiscal` via
    `documentoFiscal` tipoOperacao=1 + status autorizado, groupBy destinatário/
    período; sem notas ⇒ zeros). `listarProdutos` paginado (filtros status/comFicha/
    texto; select enxuto). empresaId EXPLÍCITO em tudo.
  - _Requirements: 1.3, 3.1, 5.1, 5.2, 5.3, 5.4, 7.2, 8.1, 9.2_

- [x] 4. Services de escrita (ficha, arte, dimensões, status/exclusão)
  - `salvarFicha` (upsert 1:1; valida modeloFacaId na empresa), `criarRevisaoArte`/
    `obterRevisaoArte`/`transicionarRevisao` (usa motor; aprovação em transação
    marca anteriores OBSOLETA + grava aprovadaPor/Em), `salvarDimensao`/
    `removerDimensao`, `inativarProduto`/`reativarProduto`/`excluirProduto`
    (usa `podeExcluir`; 409 com motivo). Permissão `podeEditarCadastros` + ADMIN.
  - _Requirements: 1.1, 1.4, 2.1, 2.5, 3.2, 3.3, 4.2, 4.3, 6.1, 6.3, 6.4, 9.2_

- [x] 5. Rotas (aditivas à v1) + schemas Zod + registro
  - Em `central-produto.routes.ts` (ou arquivo v2 registrado no mesmo prefixo):
    `GET /produtos`, `GET /ficha-master/:produtoId`, `PUT .../ficha`,
    `GET/POST .../artes`, `GET /artes/:id`, `PATCH /artes/:id/estado`,
    `GET/POST .../dimensoes`, `PUT/DELETE /dimensoes/:id`, `GET .../vendas`,
    `PATCH /produtos/:id/status`, `DELETE /produtos/:id`. authenticate +
    permissão na escrita; empresaId do user; 404 cross-empresa.
  - _Requirements: 2.6, 6.4, 7.1, 9.2_

- [x] 6. Testes de integração (mock de Prisma)
  - `central-produto-v2.io.test.ts`: isolamento empresaId, upsert ficha,
    transição de arte + marca OBSOLETA, exclusão bloqueada por movimentação,
    totalizadores sem notas ⇒ zeros.
  - _Requirements: 9.2, 9.4_

- [x] 7. Front — aba "Ficha Master" + modo "Todos os produtos"
  - `comercial/central-produto/page.tsx`: modo listagem (GET /produtos, paginado,
    filtros). Detalhe: seção Ficha Master (ficha editável + matriz derivada/manual
    + imagem da faca; arte versionada com galeria da aprovada + criar/aprovar/
    reprovar; dimensões; vendas; inativar/reativar/excluir com tooltip quando
    bloqueado). Reusa modal de imagem ampliada.
  - _Requirements: 1.1, 2.4, 3.1, 4.2, 5.1, 6.1, 7.2_

- [x] 8. Verificação e commit
  - Testes (motor + integração); get_diagnostics limpo (back+front); prisma
    generate; migrate-prod idempotente. Commits separados (back: schema+migrate
    juntos; front à parte). Não commitar configurador/produtos nem useProduto.
    Atualizar `docs/PROJETO-MODULO-COMERCIAL.md` (Pilar 2 concluído).
  - _Requirements: 9.1, 9.3, 9.5_

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1", "2"] },
    { "wave": 2, "tasks": ["3", "4"] },
    { "wave": 3, "tasks": ["5"] },
    { "wave": 4, "tasks": ["6", "7"] },
    { "wave": 5, "tasks": ["8"] }
  ]
}
```

## Notes

- Back e front repos separados. 1–6 no Back; 7 no Front; 8 fecha.
- schema.prisma + migrate-prod.ts no MESMO commit; idempotente (Postgres local off).
- Matriz vem da tag `[Matriz]` das OPs (docs/matriz-faca-fonte-de-dados.md) — NÃO
  importar do Calcgraf (dado inexistente lá).
- Não tocar o motor de cálculo; v1 intacta (não-regressão).
- empresaId EXPLÍCITO; imagens (dataURL) nunca em select de listagem.
