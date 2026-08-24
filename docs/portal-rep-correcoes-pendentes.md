# Portal do Representante — Correções Pendentes

## Status Atual (24/08/2026)

O login funciona. As rotas do backend retornam 200 (exceto comissões sem params).
O problema principal é que o **frontend** não trata corretamente os dados retornados
pelas APIs, e algumas rotas precisam de ajustes de contrato.

## Problemas Identificados (em ordem de prioridade)

### 1. Tela de Comissões → tela branca (500 no backend)

**Causa**: O hook `usePortalRepComissoes` chama `GET /comissoes` sem `mes` e `ano`,
mas a rota exige esses params via schema Zod.

**Correção BACKEND** (`src/modules/portal-rep/comissao/portal-rep-comissao.routes.ts`):
- Tornar `mes` e `ano` opcionais no schema Zod — se não fornecidos, usar mês/ano
  correntes como default.

**OU Correção FRONTEND** (`src/data/hooks/portal-rep-app/usePortalRepComissoes.ts`):
- O hook já recebe `{ mes, ano }` como params obrigatórios, mas a página de Dashboard
  pode estar chamando sem eles. Verificar `usePortalRepDashboard.ts` que faz
  `portalRepApi.get('/comissoes', { params: { mes, ano } })` — este já passa os params.
- O problema está na **tela de comissões** (`comissoes/page.tsx`) que inicializa
  `mesAno` corretamente. Verificar se o primeiro render passa `{ mes: 0 }` ou algo
  inválido.

**Teste que confirmou**: `GET /comissoes?mes=8&ano=2026` com token → retorna 200 OK.

---

### 2. Clientes → "Nenhum cliente na carteira"

**Causa**: A rota `GET /portal-rep/clientes` filtra por `vendedorId` do token JWT.
Os clientes existentes na empresa Demo não têm `vendedorId` preenchido
(campo `vendedor_id` na tabela `cliente` é null para a maioria).

**Correção**: O script E2E criou solicitações com clienteId apontando para clientes
existentes, mas NÃO atualizou o campo `vendedorId` desses clientes. Precisa:
- Atualizar `vendedorId` dos 2 clientes usados no script para o vendedorId do
  representante (`43398945-27a5-4172-9bb4-6b3124b2e157`)
- Ou criar 2 clientes novos com `vendedorId` preenchido

**Script SQL direto no Neon**:
```sql
UPDATE cliente SET vendedor_id = '43398945-27a5-4172-9bb4-6b3124b2e157'
WHERE id IN (
  '0b146b1b-b4d1-4bff-9df9-877fbeb5bd5c',
  '1a05d985-8c87-44a6-ad0b-33244ff23a02'
);
```

---

### 3. Orçamentos → mostra skeleton infinito e depois tela branca

**Causa provável**: A API retorna 200 mas o formato não bate com o tipo
`SolicitacaoOrcamento[]` esperado pelo frontend. O backend retorna um array
de objetos com campos como `tipoEmbalagem`, `medidaLargura`, etc. — mas o
frontend espera `itens: ItemSolicitacao[]` (array de itens com produtoNome/quantidade).

O modelo `SolicitacaoOrcamentoRep` no schema NÃO tem campo `itens` (Json) —
os itens são campos diretos (tipoEmbalagem, quantidade, acabamentos). Mas o
frontend (`types.ts`) define `SolicitacaoOrcamento` com `itens: ItemSolicitacao[]`.

**Correção FRONTEND** (`src/data/hooks/portal-rep-app/types.ts`):
Alinhar a interface `SolicitacaoOrcamento` com o que o backend realmente retorna:
```typescript
export interface SolicitacaoOrcamento {
  id: string
  clienteId: string | null
  clienteNome: string | null
  status: StatusSolicitacao
  criadoEm: string
  tipoEmbalagem: string
  quantidade: number
  medidaLargura?: number
  medidaAltura?: number
  medidaComprimento?: number
  acabamentos?: string
  observacoes?: string
  precoVenda?: number
  precoUnitario?: number
}
```

E adaptar as páginas de Orçamentos para renderizar esses campos ao invés de `itens`.

---

### 4. Perfil → mostra "—" em todos os campos

**Causa**: A página decodifica o JWT para mostrar nome/email/empresa. Mas o JWT
do portal-rep tem os claims:
```json
{
  "scope": "portal-rep",
  "empresaId": "75848e24-...",
  "vendedorId": "5014ab9c-...",
  "representanteId": "9730009d-...",
  "iat": ...,
  "exp": ...
}
```
Não tem `nome`, `email` nem `empresaNome`.

**Correção BACKEND** (`src/modules/portal-rep/auth/portal-rep-auth.service.ts`):
Adicionar `nome` (do vendedor) e `email` (da credencial) ao payload do JWT:
```typescript
const accessToken = app.jwt.sign({
  scope: 'portal-rep',
  empresaId: credencial.empresaId,
  vendedorId: credencial.vendedorId,
  representanteId: credencial.id,
  nome: credencial.vendedor?.nome ?? '', // ADICIONAR
  email: credencial.email,               // ADICIONAR
})
```
Precisa incluir `vendedor: { select: { nome: true } }` no findFirst do login.

---

### 5. Pipeline/Comissões/Notificações → tela branca

**Causa**: Mesmo padrão — as APIs retornam 200 mas o formato dos dados não bate
com os tipos do frontend, ou a rota retorna lista vazia e o componente não trata
a resposta vazia corretamente (React Query retorna `undefined` antes de `[]`).

**Verificação**: Pipeline e Notificações retornam 200 no teste manual. O problema
é provavelmente de:
- Loading infinito (isLoading nunca vira false) por erro de tipagem
- Ou o `data` retornado tem formato diferente do esperado

**Ação**: Abrir DevTools em cada tela, ver a aba Network, e verificar:
1. Se a request foi feita (vai para a API correta)
2. Se retornou 200 ou erro
3. O formato do body da resposta vs o tipo TypeScript esperado

---

### 6. Sidebar não mostra nome do representante logado

**Causa**: O layout/sidebar não tem acesso ao nome do representante. O JWT não
tem esse dado (problema #4 acima).

**Correção**: Após resolver o problema #4 (adicionar `nome` ao JWT), o layout
pode decodificar o token e exibir o nome na sidebar (abaixo do "Vizor Rep"):
```typescript
// No layout.tsx, após confirmar token válido:
const payload = decodeTokenPayload(token)
const nomeRepresentante = payload?.nome as string || 'Representante'
// Passar para SidebarDesktop como prop
```

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

## Ordem de correção recomendada

1. Backend: adicionar nome/email ao JWT (resolve #4 e #6)
2. Backend: tornar mes/ano opcionais em comissões (resolve #1)
3. SQL: atualizar vendedorId nos clientes (resolve #2)
4. Frontend: alinhar tipos com resposta real da API (resolve #3 e #5)
5. Frontend: adicionar nome do representante na sidebar
