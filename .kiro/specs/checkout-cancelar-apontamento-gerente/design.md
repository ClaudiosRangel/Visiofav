# Design — Cancelar Apontamento com Autorização do Gerente (Checkout)

## Visão geral

O cancelamento de um apontamento errado deve ser **auditável** e **reversível
nos totais**, não uma exclusão física. O `ApontamentoEtapa` já incrementou os
totais da etapa (`quantidadeProduzida`/`quantidadePerda`/`quantidadeRetrabalho`
via `{ increment }` em `apontarProducao`), então o cancelamento é um **estorno
simétrico** (`{ decrement }`) + marcação lógica de cancelado + trilha de quem
autorizou.

Reutiliza a infra de autorização de supervisor já existente
(`validarCredenciaisSupervisorTerminal` + `autorizacaoSupervisorSchema`), a mesma
do apontamento retroativo e da conclusão com bloqueio — sem introduzir um novo
padrão de autenticação de gerente.

Repositórios:
- **Backend** `VisioFab.Wms.Back`: schema (4 colunas aditivas) + migrate-prod +
  função `cancelarApontamento` + rota + inclusão dos campos no histórico.
- **Frontend do Checkout** `VisioFab.Checkout` (app dentro do repo do backend):
  ação "Cancelar" por item no histórico da tela `etapa/[id]`.

## Modelo de dados

Colunas **aditivas e nullable** em `ApontamentoEtapa` (sem migração de dados):

```prisma
  // Cancelamento com autorização do gerente (spec checkout-cancelar-apontamento-gerente).
  cancelado              Boolean   @default(false)
  canceladoEm            DateTime? @map("cancelado_em")
  canceladoPorUsuarioId  String?   @map("cancelado_por_usuario_id")
  motivoCancelamento     String?   @map("motivo_cancelamento") @db.Text
```

`migrate-prod.ts` idempotente:
```
ALTER TABLE "apontamento_etapa" ADD COLUMN IF NOT EXISTS "cancelado" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "apontamento_etapa" ADD COLUMN IF NOT EXISTS "cancelado_em" TIMESTAMP(3);
ALTER TABLE "apontamento_etapa" ADD COLUMN IF NOT EXISTS "cancelado_por_usuario_id" TEXT;
ALTER TABLE "apontamento_etapa" ADD COLUMN IF NOT EXISTS "motivo_cancelamento" TEXT;
```
Schema + migrate no MESMO commit. Rodar 2× local se houver DB.

## Backend — serviço e rota

### `cancelarApontamento` (checkout.service.ts)

Assinatura:
```ts
cancelarApontamento(
  apontamentoId: string,
  checkoutUser: { empresaId: string },
  dados: { motivo: string },
  autorizacaoSupervisor: AutorizacaoSupervisorInput,
)
```

Fluxo (tudo em `prisma.$transaction`):
1. Valida `motivo` (min 1) e `autorizacaoSupervisor` (zod) — 400 se inválido.
2. `validarCredenciaisSupervisorTerminal(autorizacao, empresaId)` ANTES de
   qualquer escrita — credenciais inválidas bloqueiam (mesma classe de erro/
   padrão do retroativo). Captura o `usuarioAutorizador.id`.
3. Busca o apontamento filtrando por `empresaId` + resolvendo a etapa pela
   empresa (`etapaOrdemProducao.ordemProducao.empresaId`); inexistente/outra
   empresa → 404 indistinguível.
4. Guardas (Req 3): se `cancelado === true` → 400 ("já cancelado"); se `tipo` ∉
   {PRODUCAO, PERDA, RETRABALHO} → 400 ("tipo não cancelável").
5. Estorno simétrico na etapa (Req 2), limitando a 0 (nunca negativo):
   - PRODUCAO → `quantidadeProduzida = max(0, atual − apontado)`
   - PERDA → `quantidadePerda = max(0, atual − apontado)`
   - RETRABALHO → `quantidadeRetrabalho = max(0, atual − apontado)`
   (como `{ decrement }` não garante piso 0, lê-se o total atual na transação e
   grava `max(0, ...)` — ver `calcularEstorno` puro abaixo.)
6. Marca o apontamento: `cancelado = true`, `canceladoEm = now`,
   `canceladoPorUsuarioId = usuarioAutorizador.id`, `motivoCancelamento = motivo`.
7. Retorna o apontamento cancelado + os novos totais da etapa.

NÃO altera OP nem o apontamento retroativo vinculado (cada um é tratado à parte —
Req 3.3).

Função PURA testável:
```ts
calcularEstorno(totalAtual: number, apontado: number): number // = max(0, totalAtual - apontado)
```

### Rota (checkout.routes.ts, `checkoutAuth`)

`POST /checkout/apontamentos/:id/cancelar` — body:
`{ motivo: string, autorizacaoSupervisor: { email, senha } }`. Mesmo padrão de
try/catch + `CheckoutError` do `/apontamentos/:id/retroativo`.

### Histórico (listarHistoricoApontamentos)

Adicionar ao retorno de cada item: `cancelado`, `canceladoEm`,
`canceladoPorUsuarioId`, `motivoCancelamento` (Req 4). Itens cancelados
permanecem na lista (Req 4.2).

### Pareto / contagem — nota

O cancelamento já reverte os totais da etapa. Para relatórios que leem
`ApontamentoEtapa` diretamente (ex.: produtividade/valorização), um filtro
`cancelado: false` pode ser adicionado nessas agregações num follow-up se o
cliente relatar distorção — NÃO entra neste escopo (mantém não-regressão; o dado
de contagem corrigido já flui pela etapa). Documentado como dívida conhecida.

## Frontend do Checkout (etapa/[id]/page.tsx)

- `ApontamentoHistorico` ganha `cancelado`, `motivoCancelamento`,
  `canceladoEm`.
- Cada item que afeta contagem (PRODUCAO/PERDA/RETRABALHO) e NÃO cancelado
  mostra o botão "Cancelar".
- Ao clicar: abre um bloco inline pedindo `motivo` + `email`/`senha` do gerente
  (reaproveita o padrão de campos de supervisor já usado no bloqueio de
  sequência — `supEmail`/`supSenha`) → `POST /apontamentos/:id/cancelar` →
  recarrega histórico.
- Item cancelado: renderizado riscado + badge "Cancelado" + motivo; sem botão.

## Correctness Properties

1. **Estorno nunca negativo**: `calcularEstorno(t, a) = max(0, t−a) ≥ 0` para
   quaisquer t,a ≥ 0. (fast-check)
2. **Idempotência de cancelamento**: cancelar duas vezes falha na 2ª; o estorno
   acontece uma única vez. (teste de serviço com mock)
3. **Autorização obrigatória**: sem credenciais válidas de gerente, nada é
   alterado (nem apontamento nem etapa). (teste de serviço)
4. **Isolamento multi-tenant**: apontamento de outra empresa → 404; nunca
   estorna etapa de outro tenant. (teste de serviço)

## Decisões

- **D1 — Soft-cancel + estorno vs DELETE físico**: soft-cancel. Preserva
  auditoria (quem/quando/por quê) e o vínculo com retroativos; o DELETE perderia
  a trilha e a cascade removeria retroativos filhos.
- **D2 — Reusar autorização de supervisor**: usa
  `validarCredenciaisSupervisorTerminal` (e-mail+senha), já empregada no
  retroativo/conclusão — "login do gerente" do pedido do Caio.
- **D3 — Piso 0 no estorno**: lê o total atual na transação e grava
  `max(0, total − apontado)` em vez de `{ decrement }` cego, para nunca deixar a
  etapa com total negativo em caso de dado inconsistente.
