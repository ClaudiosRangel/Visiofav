# Portal do Representante — Correções Pendentes

## Status Atual (24/08/2026)

~~O login funciona. As rotas do backend retornam 200 (exceto comissões sem params).~~
~~O problema principal é que o **frontend** não trata corretamente os dados retornados~~
~~pelas APIs, e algumas rotas precisam de ajustes de contrato.~~

**Atualização**: Todas as correções de código foram aplicadas. Falta apenas a
correção #2 (SQL de dados de teste no banco).

## Problemas Identificados (em ordem de prioridade)

### 1. ✅ Tela de Comissões → tela branca (500 no backend)

**Correção aplicada (backend)**: `mes` e `ano` tornados opcionais no schema Zod de
`GET /comissoes`. Se não fornecidos, usa mês/ano correntes como default.

---

### 2. ⏳ Clientes → "Nenhum cliente na carteira"

**Causa**: Os clientes existentes na empresa Demo não têm `vendedorId` preenchido.

**Correção PENDENTE — requer execução manual de SQL no banco**:
```sql
UPDATE cliente SET vendedor_id = '43398945-27a5-4172-9bb4-6b3124b2e157'
WHERE id IN (
  '0b146b1b-b4d1-4bff-9df9-877fbeb5bd5c',
  '1a05d985-8c87-44a6-ad0b-33244ff23a02'
);
```

---

### 3. ✅ Orçamentos → mostra skeleton infinito e depois tela branca

**Correções aplicadas (frontend)**:
- `types.ts`: `SolicitacaoOrcamento` e `CriarSolicitacaoPayload` alinhados com
  contrato real do backend (campos flat: tipoEmbalagem, quantidade, medidas, etc.)
- `usePortalRepOrcamentos.ts`: trata resposta paginada `{ dados: [...] }`
- `orcamentos/page.tsx`: referência a `itens` removida, usa `tipoEmbalagem`/`quantidade`
- `orcamentos/novo/page.tsx`: reescrito para formulário flat (sem array de itens)
- `orcamentos/[id]/page.tsx`: reescrito para exibir campos flat com preço
- `usePortalRepDashboard.ts`: trata resposta paginada de orçamentos

---

### 4. ✅ Perfil → mostra "—" em todos os campos

**Correção aplicada (backend)**: A função `login` já incluía `nome`/`email` no JWT.
Corrigida a função `refreshToken` que NÃO os incluía (perderia os dados ao renovar
o token) — agora faz `include: { vendedor: ... }` e emite JWT com os mesmos claims.

---

### 5. ✅ Pipeline/Comissões/Notificações → tela branca

**Correções aplicadas (frontend)**:
- `types.ts`: `PedidoPipeline` alinhado com formato real (pedidoVendaId, numeroPedido,
  etapaAtual, progressoProducao, etc.)
- `types.ts`: `DetalheComissao` alinhado com formato real (comissaoPercentual, comissaoValor, etc.)
- `usePortalRepPipeline.ts`: extrai `data.data` da resposta paginada
- `usePortalRepNotificacoes.ts`: interface usa campo `notificacoes` (não `data`)
- `usePortalRepComissoes.ts`: `usePortalRepComissoesDetalhe` extrai array da resposta paginada
- `pipeline/page.tsx`: usa novos nomes de campos
- `comissoes/page.tsx`: usa novos nomes de campos
- `usePortalRepDashboard.ts`: pipeline trata paginação e usa `etapaAtual`

---

### 6. ✅ Sidebar não mostra nome do representante logado

**Correção aplicada (frontend)**:
- `SidebarDesktop.tsx`: nova prop `representanteNome` exibida abaixo do logo
- `layout.tsx`: extrai `nome` do payload do token e passa para a sidebar

---

## Credenciais de Teste (Empresa VisioFab Demo)

- **Representante**: teste-rep@vizor.test / Teste123!
- **Empresa ID**: 59512845-a692-4429-ace4-627566065fd4
- **Vendedor**: João Silva (43398945-27a5-4172-9bb4-6b3124b2e157)
- **Representante ID**: 1f2db0f7-73dc-46cb-9164-81896320dc0b

## Dados criados pelo script E2E

- 2 SolicitacaoOrcamentoRep (status ENVIADO)
- 2 PedidoVenda (#1, #2) — CONFIRMADO
- 2 OrdemProducao (#2989, #2990) — PROGRAMADA
- Tabela de Preço: "Tabela Padrão (teste E2E)" (e5c09ef0-ebb6-4778-946d-b0e4b6175259)

## Resumo final

| # | Problema | Status |
|---|----------|--------|
| 1 | Comissões 500 | ✅ Corrigido (backend) |
| 2 | Clientes vazios | ⏳ Requer SQL manual no banco |
| 3 | Orçamentos skeleton | ✅ Corrigido (frontend) |
| 4 | Perfil "—" | ✅ Corrigido (backend) |
| 5 | Pipeline/Comissões/Notificações branco | ✅ Corrigido (frontend) |
| 6 | Sidebar sem nome | ✅ Corrigido (frontend) |
