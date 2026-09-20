# Design — Hierarquia Mercadológica

## Overview

> **Atualização pós-entrega:** o modelo foi reduzido de 5 para **4 níveis de
> agrupamento** (padrão SAP Retail + GS1 GPC). A folha passou a ser a
> **Subcategoria** (também chamada "Subcategoria/Família", 3 dígitos, pai =
> Categoria); o tipo `FAMILIA` foi removido. O código do produto/SKU é o
> "nível 5" — **não** é um nó da árvore. Como o campo `tipo` é `VARCHAR(20)`
> livre (não é enum no schema), a redução foi puramente de lógica de
> aplicação, **sem migration**. Além disso, a tela passou a ter uma **rota
> própria no módulo Compras** (`/compras/hierarquia`) além da rota do WMS
> (`/configurador/hierarquia`), ambas renderizando um componente
> compartilhado. As seções abaixo refletem o estado final (4 níveis).

Implementar a Hierarquia Mercadológica com 4 níveis fixos encadeados
(Departamento → Seção → Categoria → Subcategoria/Família), código hierárquico
gerado automaticamente, CRUD de cada nível e vínculo do produto ao nível folha
(Subcategoria/Família). O Produto passa a ter `familiaId` opcional; os 3 níveis
superiores são derivados subindo a árvore, sem redundância.

O design segue os padrões do projeto: Fastify + Prisma + Zod, `request.prismaScoped`
com filtro explícito por `empresaId` para isolamento multi-tenant. Uma única tabela
`NivelMercadologico` cobre os 4 tipos com auto-referência. O processo obrigatório de
migrations (`schema.prisma` + `migrate-prod.ts` no mesmo commit, testado 2x local)
é respeitado integralmente.

## Architecture

```
Backend (VisioFab.Wms.Back)
  prisma/schema.prisma              — model NivelMercadologico + FK em Produto
  prisma/migrate-prod.ts            — CREATE TABLE IF NOT EXISTS + FKs (idempotente)
  src/modules/hierarquia-mercadologica/
    hierarquia.service.ts           — lógica pura: validar segmento, compor código, caminho
    hierarquia.service.test.ts      — property-based (determinismo, largura, unicidade)
    hierarquia.routes.ts            — CRUD GET/POST/PUT/PATCH/DELETE
  src/server.ts                     — registrar prefix /api/hierarquia-mercadologica

Backend — produto.routes.ts         — aceitar familiaId no PUT /:id

Frontend (VisioFab.Wms.Front)
  src/components/hierarquia/HierarquiaMercadologicaView.tsx  — UI compartilhada da árvore
  src/app/(interna)/configurador/hierarquia/page.tsx   — wrapper (contexto WMS)
  src/app/(interna)/compras/hierarquia/page.tsx        — wrapper (contexto Compras)
  src/components/layout/ModuleSidebar.tsx  — menu Compras aponta p/ /compras/hierarquia
  src/app/(interna)/configurador/produtos/ProdutoModal.tsx
                                    — cascata guiada (Dep→Seção→Categoria→Subcategoria) + familiaId
```

## Components and Interfaces

### 1. Model Prisma — NivelMercadologico

Uma única tabela auto-referenciada cobre os 4 tipos via campo `tipo`.

```prisma
model NivelMercadologico {
  id                String    @id @default(uuid())
  empresaId         String    @map("empresa_id")
  tipo              String    @db.VarChar(20)
  // 4 níveis: DEPARTAMENTO | SECAO | CATEGORIA | SUBCATEGORIA (folha)
  codigo            String    @db.VarChar(4)
  codigoHierarquico String    @map("codigo_hierarquico") @db.VarChar(30)
  descricao         String    @db.VarChar(200)
  status            Boolean   @default(true)
  paiId             String?   @map("pai_id")
  pai               NivelMercadologico?  @relation("PaiFilho", fields: [paiId], references: [id])
  filhos            NivelMercadologico[] @relation("PaiFilho")
  produtos          Produto[]
  criadoEm          DateTime  @default(now()) @map("criado_em")
  atualizadoEm      DateTime  @updatedAt @map("atualizado_em")

  @@unique([empresaId, codigoHierarquico])
  @@index([empresaId, tipo, status])
  @@map("nivel_mercadologico")
}
```

Produto ganha FK opcional:
```prisma
familiaId String?              @map("familia_id")
familia   NivelMercadologico?  @relation(fields: [familiaId], references: [id])
```

### 2. Serviço puro — hierarquia.service.ts

```ts
export type TipoNivel =
  'DEPARTAMENTO' | 'SECAO' | 'CATEGORIA' | 'SUBCATEGORIA'

// Largura de dígitos por tipo (Req 2.3). SUBCATEGORIA é a folha (3 dígitos).
export const LARGURA_SEGMENTO: Record<TipoNivel, number> = {
  DEPARTAMENTO: 2, SECAO: 2, CATEGORIA: 2, SUBCATEGORIA: 3,
}

// Tipo pai exigido por tipo filho (Req 1.2)
export const TIPO_PAI_OBRIGATORIO: Partial<Record<TipoNivel, TipoNivel>> = {
  SECAO: 'DEPARTAMENTO', CATEGORIA: 'SECAO',
  SUBCATEGORIA: 'CATEGORIA',
}

// Valida código de segmento: só dígitos, largura exata para o tipo.
export function validarCodigoSegmento(tipo: TipoNivel, codigo: string): { valido: boolean; erro?: string }

// Compõe código hierárquico: DEPARTAMENTO → só o segmento; demais → pai + '.' + segmento.
export function composeCodigoHierarquico(
  tipo: TipoNivel, codigoPai: string | null, codigoSegmento: string,
): string

// Monta array [Departamento, ..., folha] a partir de nível com pai aninhado.
export function montarCaminhoCompleto(nivel: NivelComPai): NivelBasico[]
```

### 3. Rotas — hierarquia.routes.ts

Prefixo: `/api/hierarquia-mercadologica`. Padrão idêntico a `classificacaoProdutoRoutes`.

| Método | Rota | Ação |
|---|---|---|
| GET | `/` | Lista com filtros `tipo`, `paiId`, `status`, `search`; inclui 1 nível de `pai`. |
| GET | `/:id` | Detalhe com caminho completo aninhado. |
| POST | `/` | Cria nível. Valida tipo do pai, segmento, compõe `codigoHierarquico`. |
| PUT | `/:id` | Atualiza `descricao` e `status`. `codigoHierarquico` é imutável. |
| PATCH | `/:id/status` | Ativa/inativa. |
| DELETE | `/:id` | Recusa (409) se há filhos ou produtos vinculados. |

Guardas do POST:
1. `DEPARTAMENTO`: `paiId` ignorado.
2. Outros: `paiId` obrigatório do tipo correto em `TIPO_PAI_OBRIGATORIO`.
3. `codigo` validado por `validarCodigoSegmento`.
4. `codigoHierarquico` composto automaticamente.
5. P2002 → 409 legível ("código hierárquico já existe").
6. Escrita: ADMIN/SUPER_ADMIN. Leitura: aberta ao módulo.

### 4. Frontend — tela compartilhada + rotas por módulo

- **`HierarquiaMercadologicaView`** (`src/components/hierarquia/`): componente
  único com a UI de gestão. Recebe `breadcrumb` e `modulosPermitidos` por props.
- Painel com abas por tipo de nível (Departamento, Seção, Categoria,
  Subcategoria/Família). Por aba: lista filtrada + seleção do pai + form.
- Exibe `codigoHierarquico` (readonly) + `descricao` + status toggle.
- **Rotas (wrappers finos)**: `/configurador/hierarquia` (breadcrumb WMS) e
  `/compras/hierarquia` (breadcrumb Compras). `detectModule` mantém o contexto
  Compras para paths `/compras/*` — por isso a rota própria não leva ao WMS.
- **Menu**: no `ModuleSidebar`, o item de Compras aponta para
  `/compras/hierarquia`; o de WMS (grupo Cadastros) para `/configurador/hierarquia`.
- **Guard**: `useModuloGuard(['WMS', 'COMPRAS'])` libera com qualquer um dos módulos.

### 5. Frontend — ProdutoModal (cascata guiada)

- **Cascata** de 4 `Select` (Departamento → Seção → Categoria →
  Subcategoria/Família), cada um filtrando o próximo pelo `paiId`. Carrega
  todos os níveis ativos via `GET /hierarquia-mercadologica?status=true`.
- O vínculo persistido é sempre a folha (Subcategoria/Família), via `familiaId`.
- Ao reabrir um produto, a cascata é **pré-preenchida** subindo a árvore a
  partir da folha salva; ao trocar de produto, os selects são **resetados**.
- Sem folha: texto "Sem hierarquia definida".
- `familiaId` é enviado tanto no **POST** (criação) quanto no **PUT** (edição)
  de `/produtos`; o backend valida em ambos que a folha é do tipo `SUBCATEGORIA`
  e da mesma empresa.

## Data Models

### nivel_mercadologico (nova tabela)

| Campo | Tipo | Observações |
|---|---|---|
| `id` | UUID PK | |
| `empresa_id` | TEXT | isolamento |
| `tipo` | VARCHAR(20) | DEPARTAMENTO..SUBCATEGORIA (folha) |
| `codigo` | VARCHAR(4) | segmento (2 ou 3 dígitos) |
| `codigo_hierarquico` | VARCHAR(30) | ex.: `01.02.04.001`; único por empresa |
| `descricao` | VARCHAR(200) | |
| `status` | BOOLEAN | true = ativo |
| `pai_id` | TEXT nullable | FK self |
| `criado_em` / `atualizado_em` | TIMESTAMP | |

### produto (alteração)

Adicionar coluna `familia_id TEXT NULL` com FK para `nivel_mercadologico`.

### Migration idempotente (migrate-prod.ts)

```sql
CREATE TABLE IF NOT EXISTS "nivel_mercadologico" (
  "id" TEXT NOT NULL, "empresa_id" TEXT NOT NULL, "tipo" VARCHAR(20) NOT NULL,
  "codigo" VARCHAR(4) NOT NULL, "codigo_hierarquico" VARCHAR(30) NOT NULL,
  "descricao" VARCHAR(200) NOT NULL, "status" BOOLEAN NOT NULL DEFAULT true,
  "pai_id" TEXT, "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "nivel_mercadologico_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "nivel_mercadologico_empresa_codigo_hier_key"
  ON "nivel_mercadologico"("empresa_id","codigo_hierarquico");
CREATE INDEX IF NOT EXISTS "nivel_mercadologico_empresa_tipo_status_idx"
  ON "nivel_mercadologico"("empresa_id","tipo","status");
-- FKs em try/catch (padrão do projeto)
ALTER TABLE "produto" ADD COLUMN IF NOT EXISTS "familia_id" TEXT;
```

**Checklist database-migrations.md**: `schema.prisma` e `migrate-prod.ts` no mesmo commit; testar 2x local.

## Correctness Properties

### Property 1: Código hierárquico determinístico e imutável

Para qualquer `(tipo, codigoPai, codigoSegmento)`, `composeCodigoHierarquico` sempre
retorna o mesmo valor; o código não pode ser alterado após criação.

**Validates: Requirements 2.1, 2.2**

### Property 2: Largura de segmento sempre válida

Para qualquer `tipo`, `validarCodigoSegmento` só aprova strings numéricas com a
largura exata definida em `LARGURA_SEGMENTO`.

**Validates: Requirements 2.3**

### Property 3: Isolamento multi-tenant invariante

Nenhuma operação acessa níveis de empresa diferente da do usuário autenticado.

**Validates: Requirements 1.6**

### Property 4: Unicidade de código hierárquico por empresa

Dois níveis da mesma empresa nunca têm o mesmo `codigoHierarquico`.

**Validates: Requirements 2.4**

## Error Handling

- **Tipo de pai incompatível**: 400 indicando o tipo esperado.
- **Largura de segmento inválida**: 400 indicando largura esperada.
- **Código hierárquico duplicado** (P2002): 409 com mensagem legível.
- **Exclusão com dependentes**: 409 com contagem de filhos/produtos.
- **Nível não encontrado / outra empresa**: 404.
- **Escrita por não-admin**: 403.

## Testing Strategy

- Property-based (fast-check) sobre `composeCodigoHierarquico` e `validarCodigoSegmento` cobrindo P1–P4.
- Testes de integração: tipo-pai incorreto → 400; segmento errado → 400; duplicado → 409; criação válida → 201 com código correto; DELETE com dependentes → 409.
- `tsc --noEmit` sem novos erros.
- Migration: `npx tsx prisma/migrate-prod.ts` 2x local sem erro.
