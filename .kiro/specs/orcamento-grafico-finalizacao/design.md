# Design — Finalização do Orçamento Gráfico

## Overview

Três frentes, implementadas em ondas de risco crescente, todas **aditivas**
(sem os campos novos preenchidos, o motor cai no comportamento atual e os 77
testes existentes continuam verdes):

- **Onda 1 — Schema + migração**: novos campos de máquina (acerto por cor,
  setup), novo model `SuporteGrafico` (coefTinta), densidade/suporte no papel,
  parâmetro de partida de tinta.
- **Onda 2 — Motor calibrado**: ligar `custo-transformacao.ts` e
  `consumo-tinta.ts` ao `calcularOrcamentoGrafico` com fallback; unificar
  `/calcular` e `/simular-tiragens`.
- **Onda 3 — Cadastros no front**: cadastro de Suporte + campos novos de máquina
  e densidade de tinta no wizard.
- **Onda 4 — Importador de vendedores**: fase `vendedores` (Vendedor +
  RepresentanteCredencial).

## Architecture

Backend (`VisioFab.Wms.Back`, Fastify + Prisma) e Frontend
(`VisioFab.Wms.Front`, Next.js + Mantine) são repos separados. O cálculo é um
serviço puro (`orcamento-grafico-calculo.service.ts`) que orquestra funções
puras já existentes (`calcularPapel/Tinta/Maquinas/Acabamentos`) e passará a
orquestrar também os módulos calibrados (`custo-transformacao.ts`,
`consumo-tinta.ts`). As rotas (`orcamento-grafico.routes.ts`) montam o
`ParamsOrcamento` a partir dos cadastros (CentroProducao, SuporteGrafico,
PrecoMateriaPrima, TabelaMargem, ParametroPerda) e chamam o motor.

Fluxo de cálculo (inalterado no contrato):
`wizard → POST /calcular → montarParamsOrcamento → calcularOrcamentoGrafico →
ResultadoOrcamento (MD/CT/SE/CEV/CM) → StepRevisao`.

Migração em produção segue o padrão do projeto: `prisma/migrate-prod.ts`
idempotente no mesmo commit do `schema.prisma` (regra `database-migrations`).

## Components and Interfaces

### Backend
- `orcamento-grafico-calculo.service.ts`: estende `ParamsOrcamento` (campos
  aditivos) e `calcularOrcamentoGrafico` para rotear tinta/máquina ao modelo
  calibrado quando os parâmetros existem; senão, modelo legado.
- `custo-transformacao.ts` / `consumo-tinta.ts`: já existem (funções puras
  `calcularCustoTransformacao`, `calcularConsumoTinta`); serão consumidos pelo
  motor.
- `orcamento-grafico.routes.ts`:
  - helper novo `montarParamsOrcamento(body, tipo, maquina, suporte, margem,
    perdas)` compartilhado por `/calcular` e `/simular-tiragens`.
  - CRUD novo de Suporte: `GET/POST/PUT/DELETE /orcamento-grafico/suportes`.
  - leitura dos campos novos de `CentroProducao` e do `SuporteGrafico` do papel.
- `scripts/importar-calcgraf.ts`: fase `vendedores`.

### Frontend
- `cadastros/suportes/page.tsx` (novo): CRUD de SuporteGrafico.
- Cadastro de máquina/centro (PCP): campos `acertoPorCorMin`/`tempoSetupMin`.
- `StepPapel.tsx`: exibe coefTinta/gramatura do suporte vinculado (read-only).
- `StepCores.tsx`: densidade opcional por cor.

### Interfaces (TypeScript — aditivo)
```ts
// ParamsOrcamento (campos novos, todos opcionais → fallback)
maquinaImpressao: { /* atual */ acertoPorCorMin?: number; tempoSetupMin?: number; cores?: number }
papel: { /* atual */ coefTinta?: number }
cores: Array<{ /* atual */ densidade?: number }>
partidaConsumoTintaKg?: number
// ResultadoOrcamento: + modeloCalculo?: { tinta: 'CALIBRADO'|'LEGADO'; maquina: 'CALIBRADO'|'LEGADO' }
```

## Data Models

### CentroProducao (campos novos, opcionais)
```prisma
acertoPorCorMin Decimal? @map("acerto_por_cor_min") @db.Decimal(8,2)
tempoSetupMin   Decimal? @map("tempo_setup_min")    @db.Decimal(8,2)
```
Fallback: impressão sem `acertoPorCorMin` → usa `tempoSetupMin`; ambos nulos →
setup atual (30 min).

### SuporteGrafico (model novo)
```prisma
model SuporteGrafico {
  id           String   @id @default(uuid())
  empresaId    String   @map("empresa_id")
  codigo       String   @db.VarChar(30)
  descricao    String   @db.VarChar(200)
  tipoSuporte  String   @db.VarChar(30) // CARTAO, KRAFT, OFFSET, COUCHE, MICRO...
  coefTinta    Decimal  @default(1.5) @map("coef_tinta") @db.Decimal(6,3)
  gramaturas   String?  @db.Text
  status       Boolean  @default(true)
  criadoEm     DateTime @default(now()) @map("criado_em")
  atualizadoEm DateTime @updatedAt @map("atualizado_em")
  @@unique([empresaId, codigo])
  @@map("suporte_grafico")
}
```

### PrecoMateriaPrima (campos novos, opcionais)
```prisma
suporteId      String?  @map("suporte_id")
gramatura      Decimal? @db.Decimal(6,2)
densidadeTinta Decimal? @map("densidade_tinta") @db.Decimal(6,3)
```

### Parâmetro de partida de tinta
Chave em `Parametro` (model genérico existente): `orcamento.partidaConsumoTintaKg`
= `"0.2"`. Sem alteração de schema.

### Vendedor / RepresentanteCredencial (existentes — só import)
Import usa `Vendedor` (`@@unique([empresaId, cpf])`) e cria
`RepresentanteCredencial` (`@@unique([empresaId, email])`,
`@@unique([empresaId, vendedorId])`) para e-mails válidos.

## Correctness Properties

### Property 1: Não-regressão do cálculo legado
Para qualquer orçamento sem os campos novos, o resultado do motor é idêntico ao
atual nos valores já testados.
**Validates: Requirements 3.3**

### Property 2: CT calibrado dentro de 1%
Quando `acertoPorCorMin` e custo-hora corretos estão presentes, o CT reproduz
`CustoFixo`/`CustoUnit` do Calcgraf dentro de ≤1% (calibração 52/53).
**Validates: Requirements 1.3, 3.1**

### Property 3: Tinta calibrada dentro de 2%
Quando `coefTinta` presente, o consumo de tinta segue SPANKS + partida, dentro
de ≤2% do real (1,3% no 15185).
**Validates: Requirements 2.3, 3.1**

### Property 4: Idempotência do import de vendedores
Rodar a fase `vendedores` duas vezes não cria duplicatas (0 criados na 2ª
execução).
**Validates: Requirements 4.6**

### Property 5: De-para seguro (não-sobrescrita)
O import nunca sobrescreve um vendedor/credencial existente; só enriquece campos
vazios.
**Validates: Requirements 4.3**

### Property 6: Isolamento multi-tenant
Toda query filtra `empresaId`; nenhum dado vaza entre empresas.
**Validates: Requirements 5.1**

## Error Handling

- Campos novos ausentes → fallback silencioso para o modelo legado (sem erro).
- `coefTinta`/`acertoPorCorMin` inválidos (≤0) → ignorados (fallback).
- Import: CPF ausente → placeholder sintético `SEM-DOC-<Codigo>` (cabe em
  VarChar(14)); e-mail inválido → cria só Vendedor (sem credencial), loga aviso.
- Migração: toda alteração idempotente (`IF NOT EXISTS`); FK em try/catch.
- `--dry-run` default no importador contra produção; `--apply` explícito.

## Testing Strategy

- **Unit/puro (Vitest):** manter 77 verdes (fallback = P1). Novo teste de
  integração ponta a ponta no motor com parâmetros reais (15185) validando CT
  (P2) e tinta (P3) nas tolerâncias já congeladas.
- **Property-based (fast-check):** P1 (equivalência legado quando campos nulos)
  e P4/P5 (idempotência e não-sobrescrita do import, com fixtures).
- **Import:** rodar `--dry-run` em LOCAL (empresa Wega local), conferir
  contadores, depois `--apply` local; só produção após confirmação.
- **Schema:** `npx tsx prisma/migrate-prod.ts` 2× local (idempotência) antes do
  push.
- **Frontend:** `npm run build` do front deve passar (rotas de cadastro novas).

## Decisões (confirmadas pelo usuário)
- Suporte dedicado (`SuporteGrafico`) para coefTinta (opção 1.b).
- Vendedores → `Vendedor` + `RepresentanteCredencial` para e-mail válido (2.b).
- Produtos/SKUs: fora de escopo.
