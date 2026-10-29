# Implementation Plan — Templates de Proposta PDF (Bloco B1)

- [x] 1. Schema + migração do `TemplateProposta`
  - Model `TemplateProposta` no `schema.prisma` + `migrate-prod.ts` (CREATE TABLE/
    INDEX IF NOT EXISTS, idempotente). `prisma generate` OK.
  - _Requirements: 1, 2, 6_

- [x] 2. Service de template (config + CRUD + default)
  - `template-proposta.service.ts`: `CONFIG_DEFAULT_EMBUTIDA`, `normalizarConfig`
    (pura), `obterConfigTemplate`, CRUD com empresaId explícito + default único.
  - _Requirements: 1, 2, 6_

- [x] 2.1 Teste de `normalizarConfig` (property-based)
  - `template-proposta.service.test.ts` — 6/6 passou (P1 idempotência + P2
    totalidade via fast-check).
  - _Requirements: 3_

- [x] 3. Estender `gerarPropostaPdf` para usar a config
  - `gerarPropostaPdf` aceita `config`; cabeçalho/textos/blocos conforme config;
    sem config → `CONFIG_DEFAULT_EMBUTIDA` (não-regressão). Valores inalterados.
  - _Requirements: 3, 4.4, 5, 6.2_

- [x] 4. Rotas de CRUD de templates
  - `template-proposta.routes.ts` (GET/POST/PUT/DELETE + PATCH /:id/default)
    registrada em `server.ts` com prefixo `/api/orcamento-grafico/templates-proposta`.
  - _Requirements: 1, 2_

- [x] 5. Plugar `templateId` nas rotas de download e e-mail
  - Download lê `templateId` (query); e-mail lê `templateId` (body); ambas
    resolvem via `obterConfigTemplate` e repassam `config`. 404 cross-empresa.
  - _Requirements: 4.1, 4.2, 4.3_

- [x] 6. Seed do template "Padrão Carton Wega"
  - Estilo `WEGA` adicionado à config (`estilo: 'PADRAO' | 'WEGA'` + `textos.cidadeData`);
    renderizador `renderWega` no PDF service reproduz o modelo (cabeçalho +
    Proposta/Cálculo nº + À cliente + saudação + dados do produto + tabela
    Qtd/Unit/Total (1 item) ou Qtd/Descrição/Unit/Total multi-item com quebra de
    página + condições + bloco IMPORTANTE + assinatura). Referência:
    `docs/modelo-proposta-cliente-carton-wega.md`. Seed idempotente
    `scripts/seed-template-proposta-wega.mjs` (cria o default WEGA p/ a Wega; não
    sobrescreve). **Rodar em produção é passo operacional do usuário** (via
    `DATABASE_URL_PROD`). get_diagnostics limpo + teste 7/7.
  - _Requirements: 5_

- [x] 7. Frontend — cadastro de Templates de Proposta
  - Tela `/orcamento-grafico/cadastros/templates-proposta` (lista + modal com
    toggles de cabeçalho/blocos + textos + marcar padrão + excluir) + item no
    `ModuleSidebar` (grupo Cadastros). get_diagnostics limpo.
  - _Requirements: 1, 2, 3_

- [ ] 8. Frontend — escolher template ao baixar/enviar
  - PENDENTE: no detalhe do orçamento (`[id]`) o front HOJE não tem botões de
    baixar/enviar proposta plugados (as rotas backend existem). Fazer junto do
    B3 (painel/propostas) ou quando o usuário definir os botões de proposta no
    detalhe. `Select` de template (default pré-selecionado) passando `templateId`.
  - _Requirements: 4.1, 4.2_

- [ ] 9. Verificação e documentação
  - `get_diagnostics` nos arquivos tocados (back+front); `prisma generate` OK;
    conferir que sem template a saída é a de hoje (não-regressão).
  - Atualizar `docs/PROJETO-MODULO-COMERCIAL.md` (B1 → feito) e o backlog.
  - _Requirements: 6_
