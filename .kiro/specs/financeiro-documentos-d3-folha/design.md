# Design Document

Central de Documentos Financeiros — Fase D3 (Folha de Pagamento)

## Overview

A D3 adiciona três entidades novas (`FolhaPagamento`, `ItemFolha`, `EncargoFolha`)
e enriquece `Funcionario` com dados trabalhistas. O núcleo de negócio é um serviço
de **efetivação** que transforma uma folha ABERTA em títulos de contas a pagar,
reusando `incluirTitulo` da D1. Um núcleo puro de **parsing/validação** (CSV +
cálculo de líquido) é testável sem I/O. A Vizor AI ganha uma tool de efetivação
que reusa o mesmo serviço da tela.

Princípios seguidos:
- **Estender, não reescrever**: `Funcionario` ganha colunas opcionais; a folha
  reusa `incluirTitulo`, categorias e o padrão de parceiro livre da D1.
- **Idempotência**: efetivação por folha é atômica e não duplica títulos; migração
  idempotente no `migrate-prod.ts` no mesmo commit.
- **Isolamento multi-tenant**: todas as queries filtram por `empresaId`; títulos
  gravam o `empresaId` da folha.
- **Confirmação humana**: efetivação exige confirmação explícita (tela e IA).

## Architecture

```
Tela / Vizor AI
      │  (criar folha, add itens/encargos, importar CSV, efetivar)
      ▼
folha.routes.ts  (/api/financeiro/folha, prefixo do módulo financeiro)
      │
      ├── folha-parser.ts        (núcleo puro: CSV → linhas, cálculo de líquido, divergência)
      ├── folha.service.ts       (CRUD folha/itens/encargos + totais, isolado por empresa)
      └── folha-efetivacao.service.ts
                │  (transação atômica)
                ├── incluirTitulo (D1)  → ContaPagar por funcionário (líquido)
                └── incluirTitulo (D1)  → ContaPagar por encargo (guia)
      ▼
FolhaPagamento / ItemFolha / EncargoFolha  (Prisma)  +  ContaPagar (existente)
```

Registro de rotas: sub-rota do módulo financeiro já registrado em `server.ts`
(`/api/financeiro`), seguindo o padrão da D1 (`/financeiro/contratos`).

## Components and Interfaces

### 1. Modelo de dados (Prisma)

```prisma
model FolhaPagamento {
  id          String   @id @default(uuid())
  empresaId   String   @map("empresa_id")
  competencia String   @db.VarChar(7)          // "YYYY-MM"
  descricao   String?  @db.VarChar(200)
  status      String   @default("ABERTA") @db.VarChar(20) // ABERTA | EFETIVADA | CANCELADA
  dataPagamento DateTime? @map("data_pagamento")
  totalLiquido  Decimal @default(0) @map("total_liquido") @db.Decimal(14, 2)
  totalEncargos Decimal @default(0) @map("total_encargos") @db.Decimal(14, 2)
  efetivadaEm   DateTime? @map("efetivada_em")
  criadoEm      DateTime  @default(now()) @map("criado_em")
  itens         ItemFolha[]
  encargos      EncargoFolha[]
  @@unique([empresaId, competencia, status])   // no máx. 1 ABERTA por competência
  @@map("folha_pagamento")
}

model ItemFolha {
  id            String  @id @default(uuid())
  folhaId       String  @map("folha_id")
  folha         FolhaPagamento @relation(fields: [folhaId], references: [id], onDelete: Cascade)
  funcionarioId String  @map("funcionario_id")
  proventos     Decimal @default(0) @db.Decimal(14, 2)
  descontos     Decimal @default(0) @db.Decimal(14, 2)
  liquido       Decimal @default(0) @db.Decimal(14, 2)
  contaPagarId  String? @map("conta_pagar_id")  // preenchido na efetivação
  @@map("item_folha")
}

model EncargoFolha {
  id           String  @id @default(uuid())
  folhaId      String  @map("folha_id")
  folha        FolhaPagamento @relation(fields: [folhaId], references: [id], onDelete: Cascade)
  tipo         String  @db.VarChar(20)          // INSS | FGTS | IRRF | OUTRO
  beneficiario String  @db.VarChar(150)
  valor        Decimal @db.Decimal(14, 2)
  vencimento   DateTime
  contaPagarId String? @map("conta_pagar_id")
  @@map("encargo_folha")
}
```

Enriquecimento de `Funcionario` (colunas opcionais, nenhuma quebra):

```prisma
  cpf          String?  @db.VarChar(14)   // dígitos; validado na aplicação
  cargo        String?  @db.VarChar(100)
  dataAdmissao DateTime? @map("data_admissao")
  salarioBase  Decimal? @map("salario_base") @db.Decimal(14, 2)
  banco        String?  @db.VarChar(60)
  agencia      String?  @db.VarChar(20)
  conta        String?  @db.VarChar(30)
  tipoConta    String?  @map("tipo_conta") @db.VarChar(20) // CORRENTE | POUPANCA | PIX
  chavePix     String?  @map("chave_pix") @db.VarChar(140)
```

Unicidade de CPF por empresa: índice único parcial
`@@unique([empresaId, cpf])` NÃO serve (permitiria só 1 null? Postgres trata
nulls como distintos, então múltiplos nulls são OK). Usaremos índice único
composto `(empresa_id, cpf)`; nulls não colidem. Migração cria o índice apenas
sobre linhas com cpf não-nulo via `CREATE UNIQUE INDEX ... WHERE cpf IS NOT NULL`.

### 2. Núcleo puro — `folha-parser.ts`

```typescript
export interface LinhaFolha {
  identificador: string   // CPF (dígitos) ou matrícula
  proventos: number
  descontos: number
  liquido: number
  divergencia: boolean    // |proventos - descontos - liquido| > 0.01
}

// Parse de CSV (cabeçalho flexível: cpf|matricula, proventos, descontos, liquido).
export function parsearCsvFolha(conteudo: string): { linhas: LinhaFolha[]; erros: string[] }

// Cálculo do líquido de um item (proventos - descontos), nunca negativo.
export function calcularLiquido(proventos: number, descontos: number): number

// Totais de uma folha a partir de itens/encargos.
export function calcularTotaisFolha(
  itens: { liquido: number }[],
  encargos: { valor: number }[],
): { totalLiquido: number; totalEncargos: number; totalGeral: number }
```

Sem I/O, sem Prisma, sem LLM — testável (unit + property-based).

### 3. `folha.service.ts` (CRUD + totais, isolado por empresa)

- `criarFolha(prisma, empresaId, { competencia, descricao?, dataPagamento? })`:
  valida formato competência `YYYY-MM`; recusa se já há folha ABERTA na competência.
- `adicionarItem` / `editarItem` / `removerItem`: só quando folha ABERTA; recalcula
  `liquido` via `calcularLiquido`; atualiza `totalLiquido`.
- `adicionarEncargo` / `removerEncargo`: só quando folha ABERTA; atualiza `totalEncargos`.
- `importarCsv(prisma, empresaId, folhaId, conteudo)`: usa `parsearCsvFolha`,
  resolve funcionário por CPF ou matrícula (`Funcionario` da empresa), cria itens
  para os resolvidos e retorna a lista de pendentes (não-resolvidos) sem abortar.
- `obterFolha` / `listarFolhas`: sempre `where: { empresaId }`.

### 4. `folha-efetivacao.service.ts`

```typescript
export async function efetivarFolha(prisma, empresaId: string, folhaId: string): Promise<{
  folhaId: string; titulosFuncionarios: number; titulosEncargos: number
}>
```

Regras:
- Carrega a folha com `where: { id: folhaId, empresaId }`. Se não achar → erro
  (proteção multi-tenant). Se `status !== 'ABERTA'` → erro (idempotência).
- Em **uma transação** (`prisma.$transaction`):
  - para cada `ItemFolha`: `incluirTitulo(tx, empresaId, 'PAGAR', { descricao:
    "Folha {competencia} - {nomeFuncionario}", valor: liquido, dataVencimento:
    folha.dataPagamento ?? fim do mês, parceiroId: (fornecedor do funcionário se
    houver) ou parceiroNomeLivre: nome + parceiroDocLivre: cpf, categoriaId: cat
    "Folha de Pagamento", tipoDocumento: 'FOLHA' })` → grava `contaPagarId` no item.
  - para cada `EncargoFolha`: `incluirTitulo(tx, empresaId, 'PAGAR', { descricao:
    "Folha {competencia} - {tipo}", valor, dataVencimento: encargo.vencimento,
    parceiroNomeLivre: beneficiario, categoriaId: cat "Encargos/Impostos",
    tipoDocumento: 'IMPOSTO' })` → grava `contaPagarId` no encargo.
  - marca folha `EFETIVADA`, seta `efetivadaEm`.
- A atomicidade garante que uma falha não deixe folha parcialmente efetivada
  (Requirement 4.4).

### 5. Rotas — `folha.routes.ts` (sub-rota de `/api/financeiro`)

| Método | Rota | Descrição |
|---|---|---|
| POST | `/folha` | Cria folha (competência única ABERTA). |
| GET | `/folha` | Lista folhas da empresa. |
| GET | `/folha/:id` | Detalhe com itens/encargos/totais. |
| POST | `/folha/:id/itens` | Adiciona item de funcionário. |
| PUT | `/folha/:id/itens/:itemId` | Edita item (só ABERTA). |
| DELETE | `/folha/:id/itens/:itemId` | Remove item (só ABERTA). |
| POST | `/folha/:id/encargos` | Adiciona encargo. |
| DELETE | `/folha/:id/encargos/:encargoId` | Remove encargo (só ABERTA). |
| POST | `/folha/:id/importar-csv` | Importa itens de CSV. |
| POST | `/folha/:id/efetivar` | Efetiva → gera contas a pagar (confirmação no front). |

Enriquecimento de funcionário: a rota de funcionário existente (`/api/funcionarios`
ou equivalente) aceita os novos campos opcionais; validação de CPF via
`validarDocumento` (D1). (A rota exata é confirmada na implementação.)

### 6. Vizor AI — tool `efetivar_folha`

- Tool em `ai-tools.ts`: `efetivar_folha` (input: `competencia` ou `folhaId`).
- Executor: resolve a folha ABERTA da competência na empresa, chama
  `efetivarFolha`. A IA resume totais e pede confirmação ANTES (regra do system
  prompt); só chama a tool após "sim". Idempotência garantida pelo serviço.

## Data Models

Ver seção 1. Enums textuais (VarChar) seguem o padrão do schema. `Decimal(14,2)`
para valores monetários (compatível com contas a pagar). `competencia` como
`VARCHAR(7)` `YYYY-MM` para ordenação/filtro simples.

## Error Handling

- Competência inválida ou folha ABERTA duplicada → 400/422 com mensagem clara.
- Efetivar folha não-ABERTA → 409 (conflito, idempotência).
- Folha de outra empresa → 404 (não vaza existência).
- CSV malformado/vazio → 422 com formato esperado; nenhuma folha parcial.
- Líquido negativo → 422.
- Falha na transação de efetivação → rollback total, folha permanece ABERTA.

## Testing Strategy

- **Unit/PBT** (`folha-parser.test.ts`): cálculo de líquido, totais, parsing CSV,
  detecção de divergência. Sem I/O.
- **QA E2E** (`test_47_folha.py`): criar folha, adicionar itens/encargos, efetivar
  gera N contas a pagar, idempotência (2ª efetivação recusada, sem duplicar),
  isolamento multi-tenant, CPF inválido barrado no funcionário.
- Checkpoint backend: `vitest run folha-parser.test.ts` + diagnostics limpos +
  bundle esbuild do server (lição da D2: validar build antes do push).

## Correctness Properties

### Property 1: Líquido é sempre proventos menos descontos, nunca negativo
Para quaisquer proventos ≥ 0 e descontos ≥ 0, `calcularLiquido(p, d)` retorna
`max(0, p - d)` e o resultado é ≥ 0.
**Validates: Requirements 2.2**

### Property 2: Totais consistentes
Para qualquer conjunto de itens e encargos, `calcularTotaisFolha` retorna
`totalLiquido = Σ liquido`, `totalEncargos = Σ valor` e
`totalGeral = totalLiquido + totalEncargos` (tolerância R$ 0,01).
**Validates: Requirements 2.5**

### Property 3: Efetivação é idempotente
Efetivar uma folha já EFETIVADA não cria nenhum título novo e retorna erro/no-op;
a contagem de contas a pagar vinculadas à folha permanece a mesma após qualquer
número de tentativas de efetivação além da primeira.
**Validates: Requirements 4.3**

### Property 4: Efetivação é atômica
Se qualquer título falhar durante a efetivação, nenhuma conta a pagar da folha é
persistida e a folha permanece ABERTA (nunca fica parcialmente efetivada).
**Validates: Requirements 4.4**

### Property 5: Isolamento multi-tenant
Uma folha criada pela empresa A nunca aparece nas listagens/consultas da empresa B,
e uma tentativa de efetivar/consultar por id conhecido de outra empresa retorna
como inexistente.
**Validates: Requirements 5.1**

### Property 6: Detecção de divergência de líquido na importação
Para uma linha de CSV com líquido informado, `divergencia` é verdadeiro se e
somente se `|proventos - descontos - liquido| > 0.01`.
**Validates: Requirements 3.3**
