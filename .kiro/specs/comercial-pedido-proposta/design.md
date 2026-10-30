# Design Document — Comercial: Pedido/Proposta (RFQ)

## Overview

Esta feature introduz o **Pedido/Proposta** (`PedidoProposta`) como o ponto de
entrada unificado do módulo Comercial do Vizor (Carton Wega). É um RFQ/lead que
representa a **intenção comercial** de um cliente ANTES de existir qualquer
cálculo. Só quando um usuário decide **encaminhar** a proposta é que um
`OrcamentoGrafico` é criado, vinculado e passa a aparecer no menu Orçamento.

O design cobre:

- Três models novos de schema (`PedidoProposta`, `AnexoPedidoProposta`,
  `LogPedidoProposta`) + uma coluna aditiva em `OrcamentoGrafico`
  (`pedidoPropostaId`). **TUDO que é schema novo exige o bloco idempotente
  correspondente em `prisma/migrate-prod.ts` no MESMO commit** (ver §
  "Migração idempotente").
- Uma máquina de estados PURA e testável (fast-check), no mesmo espírito de
  `etapa-calculo.service.ts`.
- Anexos de imagem armazenados como **BYTEA** no Postgres/Neon, servidos por
  rota GET dedicada que seta `Content-Type` — padrão de referência =
  `OrdemProducao.pdfData` (nunca materializar `dados` em listagens via `select`
  explícito).
- O **encaminhamento** reaproveitando o mapeamento de
  `criarOrcamentoGraficoDeSolicitacao` (resolver tipoEmbalagem texto → FK, montar
  medidas, criar `OrcamentoGrafico` RASCUNHO com `etapaCalculo='AGUARDANDO'`).
- A **liberação a PCP/Faturamento** compondo com `liberarPedidoParaPcp` já
  existente, via a cadeia `OrcamentoGrafico → converter → PedidoVenda → liberar`.
- Consulta de CNPJ reusando `enriquecerCnpj` (BrasilAPI/CNPJá Open).

### Princípios firmados (restrições do projeto)

1. **Sem `prisma migrate deploy`** — toda mudança de schema tem o equivalente
   idempotente em `prisma/migrate-prod.ts` no mesmo commit
   (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`,
   `CREATE INDEX IF NOT EXISTS`, FK em `try/catch`).
2. **Multi-tenant explícito** — toda query filtra `empresaId` EXPLÍCITO
   (`prismaScoped` dá bypass a SUPER_ADMIN; não confiar só nele).
3. **BYTEA** — `select` explícito nas listagens para NUNCA materializar `dados`;
   imagem servida por rota GET dedicada que seta `Content-Type`.
4. **Erros** — classe com `statusCode` + `code` (padrão
   `EtapaCalculoError`/`LiberacaoError`).
5. **Services `.service.ts` puros/testáveis**; rotas em
   `src/modules/orcamento-grafico/` (prefixo `/api/orcamento-grafico`),
   registradas em `server.ts`.
6. **Frontend em repo separado** (Next.js 15 / Mantine 7).

## Architecture

### Fluxo RFQ → Liberação

```
                     ┌──────────────────────────────────────────────────────┐
                     │                   PedidoProposta (RFQ)                │
                     │  origem: REPRESENTANTE | VENDEDOR | INTERNA           │
                     │  tipoPedido: REPETICAO | MOSTRUARIO | NOVO           │
                     │  anexos: 0..5 imagens (BYTEA)                         │
                     └──────────────────────────────────────────────────────┘
                                          │  máquina de estados (serviço PURO)
   (criar)                                ▼
   NOVO ──► EM_ANALISE ──► ENVIADO_ORCAMENTO ──► ORCADO ──► PROPOSTA_ENVIADA ──► ACEITO
                │  └──────────── (encaminhar p/ orçamento) ──────────┐              │
                │                                                     │              │
                ▼ (qualquer estado não-terminal)                     ▼              │
             PERDIDO / CANCELADO (terminais, exigem motivo ≥5)       │              │
                                                                     │              │
   ENCAMINHAR (estado deve ser EM_ANALISE):                          │              │
   ┌─────────────────────────────────────────────────────────────┐  │              │
   │ criarOrcamentoDePedidoProposta  (REUSA o mapeamento de       │  │              │
   │ criarOrcamentoGraficoDeSolicitacao):                         │◄─┘              │
   │  • resolve tipoEmbalagem texto → tipoEmbalagemId (FK)        │                 │
   │  • monta medidas JSON (L/A/P) a partir de medidasTexto       │                 │
   │  • cria OrcamentoGrafico RASCUNHO, etapaCalculo=AGUARDANDO   │                 │
   │  • grava OrcamentoGrafico.pedidoPropostaId  (vínculo RFQ)    │                 │
   │  • transação atômica: falha → nada órfão, estado inalterado  │                 │
   └─────────────────────────────────────────────────────────────┘                 │
                                          │                                         │
                                          ▼  (menu Orçamento Gráfico, fluxo já existe)│
   OrcamentoGrafico RASCUNHO                                                         │
     etapaCalculo: AGUARDANDO → EM_CALCULO → VALIDAR → VALIDADO                      │
     (etapa-calculo.service.ts — calculista assume, supervisor assina)              │
                                          │                                         │
                                          ▼  (aceite do cliente registrado no RFQ) ──┘
   LIBERAR A PCP/FATURAMENTO  (Supervisor_Comercial: ADMIN|SUPER_ADMIN|SUPERVISOR)
   ┌─────────────────────────────────────────────────────────────────────────────┐
   │ liberarPedidoDePedidoProposta (NOVO orquestrador — checa Fases_Exigidas):     │
   │   1. orçamento vinculado existe e está ORÇADO                                 │
   │   2. PedidoProposta.estado == ACEITO                                          │
   │   3. OrcamentoGrafico.etapaCalculo == VALIDADO                                │
   │   4. se exigeAmostra: AprovacaoAmostra APROVADA                               │
   │   5. perfil Supervisor_Comercial                                              │
   │  → compõe a cadeia existente:                                                 │
   │     converterOrcamentoEmPedido(OrcamentoGrafico) → PedidoVenda                │
   │     liberarPedidoParaPcp(PedidoVenda) → confirma + emite OP(s) (PCP)          │
   │       (o Faturamento/NF-e segue o fluxo de PedidoVenda já existente)          │
   └─────────────────────────────────────────────────────────────────────────────┘
```

### Posicionamento no código

| Camada | Local | Observação |
|---|---|---|
| Schema | `prisma/schema.prisma` | 3 models novos + 1 coluna em OrcamentoGrafico |
| Migração | `prisma/migrate-prod.ts` | bloco idempotente no MESMO commit |
| Máquina de estados (PURA) | `src/modules/orcamento-grafico/pedido-proposta/pedido-proposta-estado.service.ts` | sem Prisma; fast-check |
| Service de CRUD/estado | `src/modules/orcamento-grafico/pedido-proposta/pedido-proposta.service.ts` | Prisma; empresaId explícito |
| Service de anexos | `src/modules/orcamento-grafico/pedido-proposta/anexo-pedido-proposta.service.ts` | BYTEA; validação mime/limite |
| Service de encaminhamento | `src/modules/orcamento-grafico/pedido-proposta/encaminhar-orcamento.service.ts` | REUSA mapeamento da solicitação |
| Service de liberação | `src/modules/orcamento-grafico/pedido-proposta/liberar-pedido-proposta.service.ts` | compõe converter + liberarPedidoParaPcp |
| Rotas | `src/modules/orcamento-grafico/pedido-proposta/pedido-proposta.routes.ts` | prefixo `/api/orcamento-grafico`, registrado em `server.ts` |
| Frontend (repo separado) | `orcamento-grafico/pedidos/page.tsx`, `orcamento-grafico/[id]/page.tsx` | lista RFQ + botão "Ver proposta" |

## Components and Interfaces

### Models Prisma (SCHEMA NOVO — exigem migrate-prod no mesmo commit)

#### `PedidoProposta` (map `pedido_proposta`) — NOVO

```prisma
model PedidoProposta {
  id            String   @id @default(uuid())
  empresaId     String   @map("empresa_id")
  numero        Int      // sequencial por empresa (max+1)

  // Origem / classificação
  origem        String   @db.VarChar(16)  // REPRESENTANTE | VENDEDOR | INTERNA
  representanteId String? @map("representante_id")
  vendedorId      String? @map("vendedor_id")
  tipoPedido    String   @db.VarChar(12)  // REPETICAO | MOSTRUARIO | NOVO

  // Identificação do cliente (planilha #3/#4/#5)
  clienteId     String?  @map("cliente_id")
  clienteNome   String?  @map("cliente_nome") @db.VarChar(200)
  clienteCpfCnpj String? @map("cliente_cpf_cnpj") @db.VarChar(20)
  jaCliente     Boolean  @default(false) @map("ja_cliente")

  // Campos comerciais e técnicos (planilha Carton Wega)
  mercado       String   @db.VarChar(120)  // #6 — OBRIGATÓRIO
  ufOrigem      String?  @map("uf_origem") @db.VarChar(2)   // #7
  cidade        String?  @db.VarChar(120)                    // #7
  tipoEntrega   String?  @map("tipo_entrega") @db.VarChar(20) // UNICA | FRACIONADA  #8
  entregaFracionadaDias String? @map("entrega_fracionada_dias") @db.VarChar(60) // #9
  prazoPagamento String? @map("prazo_pagamento") @db.VarChar(60)  // #10
  produtoNome   String?  @map("produto_nome") @db.VarChar(200)    // #11
  tipoEmbalagem String?  @map("tipo_embalagem") @db.VarChar(120)  // #14 (texto livre)
  quantidade    Int?                                        // #16
  cartao        String?  @db.VarChar(120)                    // #17
  gramatura     String?  @db.VarChar(60)                     // #18 (texto)
  medidasTexto  String?  @map("medidas_texto") @db.VarChar(120) // #20 (C x L x A)
  cartaoFsc     Boolean  @default(false) @map("cartao_fsc")   // #19
  corteInternoVerso Boolean @default(false) @map("corte_interno_verso") // #21
  passtime      Boolean  @default(false)                      // #22
  acabamentos   String?  @db.Text                             // #23
  matriz        String?  @db.VarChar(200)                     // #24
  acabamentoManual Boolean @default(false) @map("acabamento_manual") // #25
  quantidadePorVolume String? @map("quantidade_por_volume") @db.VarChar(60) // #26
  variacoesArte String?  @map("variacoes_arte") @db.VarChar(60) // #13
  exportacao    String?  @db.VarChar(12)                      // COMUM | EXPORTACAO  #15
  dataValidade  String?  @map("data_validade") @db.VarChar(60) // #12 (texto)
  discriminacao String?  @db.Text                             // #28
  observacoes   String?  @db.Text                             // #29

  // Máquina de estados
  estado        String   @default("NOVO") @db.VarChar(20)
  // NOVO | EM_ANALISE | ENVIADO_ORCAMENTO | ORCADO | PROPOSTA_ENVIADA | ACEITO | PERDIDO | CANCELADO
  motivo        String?  @db.Text   // cancelamento / perdido (>=5 chars)

  // Controle de amostra
  exigeAmostra  Boolean  @default(false) @map("exige_amostra")

  // Vínculo ao orçamento criado pelo encaminhamento
  orcamentoGraficoId String? @map("orcamento_grafico_id")

  criadoPorId   String   @map("criado_por_id")
  criadoEm      DateTime @default(now()) @map("criado_em")
  atualizadoEm  DateTime @updatedAt @map("atualizado_em")

  anexos AnexoPedidoProposta[]
  logs   LogPedidoProposta[]

  @@unique([empresaId, numero])
  @@index([empresaId, estado])
  @@index([empresaId, origem])
  @@map("pedido_proposta")
}
```

#### `AnexoPedidoProposta` (map `anexo_pedido_proposta`) — NOVO (BYTEA)

```prisma
model AnexoPedidoProposta {
  id               String   @id @default(uuid())
  pedidoPropostaId String   @map("pedido_proposta_id")
  empresaId        String   @map("empresa_id") // denormalizado p/ filtro direto
  nome             String   @db.VarChar(255)
  tipo             String   @db.VarChar(100)   // mime (image/png, image/jpeg...)
  tamanho          Int                          // bytes
  dados            Bytes                        // BYTEA — NUNCA retornar em listagem
  criadoEm         DateTime @default(now()) @map("criado_em")

  pedidoProposta PedidoProposta @relation(fields: [pedidoPropostaId], references: [id], onDelete: Cascade)

  @@index([empresaId, pedidoPropostaId])
  @@map("anexo_pedido_proposta")
}
```

#### `LogPedidoProposta` (map `log_pedido_proposta`) — NOVO

```prisma
model LogPedidoProposta {
  id               String   @id @default(uuid())
  pedidoPropostaId String   @map("pedido_proposta_id")
  empresaId        String   @map("empresa_id")
  estadoAnterior   String   @map("estado_anterior") @db.VarChar(20)
  estadoNovo       String   @map("estado_novo") @db.VarChar(20)
  usuarioId        String   @map("usuario_id")
  motivo           String?  @db.Text
  criadoEm         DateTime @default(now()) @map("criado_em")

  pedidoProposta PedidoProposta @relation(fields: [pedidoPropostaId], references: [id], onDelete: Cascade)

  @@index([empresaId, pedidoPropostaId])
  @@map("log_pedido_proposta")
}
```

#### Coluna aditiva em `OrcamentoGrafico` — SCHEMA NOVO (aditivo)

```prisma
// dentro de model OrcamentoGrafico { ... }
pedidoPropostaId String? @map("pedido_proposta_id") // vínculo RFQ → orçamento
```

> **Decisão (vínculo amostra)**: a `AprovacaoAmostra` existente tem FKs
> `orcamentoId?` e `pedidoVendaId?` — **não** tem coluna para `PedidoProposta`.
> Em vez de adicionar uma 4ª FK (mudança invasiva num model compartilhado), o
> vínculo da amostra se dá **via o `OrcamentoGrafico` criado no encaminhamento**
> (`AprovacaoAmostra.orcamentoId == PedidoProposta.orcamentoGraficoId`). Isso
> reaproveita 100% o fluxo de amostra já existente do orçamento gráfico
> (`amostra.service.ts` + `liberacaoPermitidaPorAmostra`) e é coerente com o
> requisito 7.1 ("reutilizando a entidade AprovacaoAmostra existente, vinculada
> ao Pedido_Proposta"): a amostra do RFQ é a amostra do orçamento que ele gerou.
> A exigência de amostra fica no `PedidoProposta.exigeAmostra` (fonte autoritativa
> do RFQ) e é propagada ao `OrcamentoGrafico.exigeAmostra` no encaminhamento.

### Bloco idempotente em `prisma/migrate-prod.ts` (MESMO COMMIT)

```ts
// ── Comercial: Pedido/Proposta (RFQ) ───────────────────────────────────────
await prisma.$executeRawUnsafe(`
  CREATE TABLE IF NOT EXISTS "pedido_proposta" (
    "id" TEXT PRIMARY KEY,
    "empresa_id" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "origem" VARCHAR(16) NOT NULL,
    "representante_id" TEXT,
    "vendedor_id" TEXT,
    "tipo_pedido" VARCHAR(12) NOT NULL,
    "cliente_id" TEXT,
    "cliente_nome" VARCHAR(200),
    "cliente_cpf_cnpj" VARCHAR(20),
    "ja_cliente" BOOLEAN NOT NULL DEFAULT false,
    "mercado" VARCHAR(120) NOT NULL,
    "uf_origem" VARCHAR(2),
    "cidade" VARCHAR(120),
    "tipo_entrega" VARCHAR(20),
    "entrega_fracionada_dias" VARCHAR(60),
    "prazo_pagamento" VARCHAR(60),
    "produto_nome" VARCHAR(200),
    "tipo_embalagem" VARCHAR(120),
    "quantidade" INTEGER,
    "cartao" VARCHAR(120),
    "gramatura" VARCHAR(60),
    "medidas_texto" VARCHAR(120),
    "cartao_fsc" BOOLEAN NOT NULL DEFAULT false,
    "corte_interno_verso" BOOLEAN NOT NULL DEFAULT false,
    "passtime" BOOLEAN NOT NULL DEFAULT false,
    "acabamentos" TEXT,
    "matriz" VARCHAR(200),
    "acabamento_manual" BOOLEAN NOT NULL DEFAULT false,
    "quantidade_por_volume" VARCHAR(60),
    "variacoes_arte" VARCHAR(60),
    "exportacao" VARCHAR(12),
    "data_validade" VARCHAR(60),
    "discriminacao" TEXT,
    "observacoes" TEXT,
    "estado" VARCHAR(20) NOT NULL DEFAULT 'NOVO',
    "motivo" TEXT,
    "exige_amostra" BOOLEAN NOT NULL DEFAULT false,
    "orcamento_grafico_id" TEXT,
    "criado_por_id" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`)
await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "pedido_proposta_empresa_numero_key" ON "pedido_proposta"("empresa_id","numero")`)
await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_pedido_proposta_empresa_estado" ON "pedido_proposta"("empresa_id","estado")`)
await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_pedido_proposta_empresa_origem" ON "pedido_proposta"("empresa_id","origem")`)

await prisma.$executeRawUnsafe(`
  CREATE TABLE IF NOT EXISTS "anexo_pedido_proposta" (
    "id" TEXT PRIMARY KEY,
    "pedido_proposta_id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "nome" VARCHAR(255) NOT NULL,
    "tipo" VARCHAR(100) NOT NULL,
    "tamanho" INTEGER NOT NULL,
    "dados" BYTEA NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`)
await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_anexo_pedido_proposta_empresa_pedido" ON "anexo_pedido_proposta"("empresa_id","pedido_proposta_id")`)

await prisma.$executeRawUnsafe(`
  CREATE TABLE IF NOT EXISTS "log_pedido_proposta" (
    "id" TEXT PRIMARY KEY,
    "pedido_proposta_id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "estado_anterior" VARCHAR(20) NOT NULL,
    "estado_novo" VARCHAR(20) NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "motivo" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`)
await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_log_pedido_proposta_empresa_pedido" ON "log_pedido_proposta"("empresa_id","pedido_proposta_id")`)

// FK em try/catch (Postgres não tem ADD CONSTRAINT IF NOT EXISTS)
try {
  await prisma.$executeRawUnsafe(`ALTER TABLE "anexo_pedido_proposta" ADD CONSTRAINT "anexo_pedido_proposta_pedido_fk" FOREIGN KEY ("pedido_proposta_id") REFERENCES "pedido_proposta"("id") ON DELETE CASCADE`)
} catch { /* já existe */ }
try {
  await prisma.$executeRawUnsafe(`ALTER TABLE "log_pedido_proposta" ADD CONSTRAINT "log_pedido_proposta_pedido_fk" FOREIGN KEY ("pedido_proposta_id") REFERENCES "pedido_proposta"("id") ON DELETE CASCADE`)
} catch { /* já existe */ }

// Coluna aditiva em orcamento_grafico (vínculo RFQ → orçamento)
await prisma.$executeRawUnsafe(`ALTER TABLE "orcamento_grafico" ADD COLUMN IF NOT EXISTS "pedido_proposta_id" TEXT`)
```

> Testar localmente rodando `npx tsx prisma/migrate-prod.ts` **duas vezes**
> (idempotência). Em ambientes onde o Postgres local está indisponível, roda no
> deploy do Render — idempotência garantida por `IF NOT EXISTS` / FK em
> `try/catch`.

### Máquina de estados PURA — `pedido-proposta-estado.service.ts`

Espelha o padrão de `etapa-calculo.service.ts` (mapa de transições + validador),
mas SEM Prisma (testável com fast-check).

```ts
export type EstadoProposta =
  | 'NOVO' | 'EM_ANALISE' | 'ENVIADO_ORCAMENTO' | 'ORCADO'
  | 'PROPOSTA_ENVIADA' | 'ACEITO' | 'PERDIDO' | 'CANCELADO'

export class PedidoPropostaError extends Error {
  constructor(public statusCode: number, message: string, public code?: string) {
    super(message); this.name = 'PedidoPropostaError'
  }
}

export const TRANSICOES: Record<EstadoProposta, EstadoProposta[]> = {
  NOVO:               ['EM_ANALISE', 'CANCELADO'],
  EM_ANALISE:         ['ENVIADO_ORCAMENTO', 'PERDIDO', 'CANCELADO'],
  ENVIADO_ORCAMENTO:  ['ORCADO', 'PERDIDO', 'CANCELADO'],
  ORCADO:             ['PROPOSTA_ENVIADA', 'PERDIDO', 'CANCELADO'],
  PROPOSTA_ENVIADA:   ['ACEITO', 'PERDIDO', 'CANCELADO'],
  ACEITO:             [],   // terminal
  PERDIDO:            [],   // terminal
  CANCELADO:          [],   // terminal
}

const ESTADOS_COM_MOTIVO: EstadoProposta[] = ['PERDIDO', 'CANCELADO']

/** Valida a transição. Exige motivo (>=5) quando o destino é PERDIDO/CANCELADO. */
export function validarTransicao(
  atual: EstadoProposta,
  novo: EstadoProposta,
  motivo?: string,
): void {
  const permitidas = TRANSICOES[atual] ?? []
  if (!permitidas.includes(novo)) {
    throw new PedidoPropostaError(400,
      `Transição de estado inválida (${atual} → ${novo}).`, 'ESTADO_TRANSICAO_INVALIDA')
  }
  if (ESTADOS_COM_MOTIVO.includes(novo) && (!motivo || motivo.trim().length < 5)) {
    throw new PedidoPropostaError(400,
      'Informe um motivo com no mínimo 5 caracteres.', 'MOTIVO_OBRIGATORIO')
  }
}

export function getTransicoesPermitidas(atual: EstadoProposta): EstadoProposta[] {
  return TRANSICOES[atual] ?? []
}
export function isTerminal(estado: EstadoProposta): boolean {
  return getTransicoesPermitidas(estado).length === 0
}
```

### Services backend (assinaturas)

```ts
// pedido-proposta.service.ts — CRUD + transição (Prisma; empresaId EXPLÍCITO)
export interface CriarPedidoPropostaInput {
  origem: 'REPRESENTANTE' | 'VENDEDOR' | 'INTERNA'
  representanteId?: string
  vendedorId?: string
  tipoPedido: 'REPETICAO' | 'MOSTRUARIO' | 'NOVO'
  clienteId?: string; clienteNome?: string; clienteCpfCnpj?: string; jaCliente?: boolean
  mercado: string // obrigatório (Req 2.4)
  ufOrigem?: string; cidade?: string
  tipoEntrega?: 'UNICA' | 'FRACIONADA'; entregaFracionadaDias?: string
  prazoPagamento?: string; produtoNome?: string; tipoEmbalagem?: string
  quantidade?: number; cartao?: string; gramatura?: string; medidasTexto?: string
  cartaoFsc?: boolean; corteInternoVerso?: boolean; passtime?: boolean
  acabamentos?: string; matriz?: string; acabamentoManual?: boolean
  quantidadePorVolume?: string; variacoesArte?: string
  exportacao?: 'COMUM' | 'EXPORTACAO'; dataValidade?: string
  discriminacao?: string; observacoes?: string
  exigeAmostra?: boolean
}
export async function criarPedidoProposta(empresaId: string, usuarioId: string, input: CriarPedidoPropostaInput): Promise<{ id: string; numero: number }>
export async function atualizarPedidoProposta(empresaId: string, id: string, input: Partial<CriarPedidoPropostaInput>): Promise<void>
export async function obterPedidoProposta(empresaId: string, id: string): Promise<PedidoPropostaDetalhe>      // sem dados BYTEA
export async function listarPedidosProposta(empresaId: string, filtros: { estado?: string; origem?: string; tipoPedido?: string; busca?: string }): Promise<PedidoPropostaResumo[]>
export async function transicionarEstado(empresaId: string, id: string, usuarioId: string, novoEstado: EstadoProposta, motivo?: string): Promise<{ id: string; estado: EstadoProposta }>  // grava LogPedidoProposta

// anexo-pedido-proposta.service.ts — BYTEA (validação mime/limite 5)
export async function adicionarAnexo(empresaId: string, pedidoId: string, file: { nome: string; mime: string; buffer: Buffer }): Promise<{ id: string }>
export async function obterAnexoBinario(empresaId: string, pedidoId: string, anexoId: string): Promise<{ tipo: string; dados: Buffer; nome: string }>
export async function removerAnexo(empresaId: string, pedidoId: string, anexoId: string): Promise<void>
export async function listarAnexosMetadados(empresaId: string, pedidoId: string): Promise<Array<{ id: string; nome: string; tipo: string; tamanho: number }>> // SEM dados

// encaminhar-orcamento.service.ts — REUSA mapeamento da solicitação
export async function criarOrcamentoDePedidoProposta(empresaId: string, pedidoId: string, usuarioId: string, tipoEmbalagemIdOverride?: string): Promise<{ orcamentoGraficoId: string; numero: number }>

// liberar-pedido-proposta.service.ts — compõe converter + liberarPedidoParaPcp
export interface FasePendente { fase: string; motivo: string }
export async function liberarPedidoDePedidoProposta(empresaId: string, pedidoId: string, usuarioId: string, opcoes?: { senha?: string }): Promise<{ pedidoVendaId: string; opsEmitidas: unknown[] }>
```

#### Reaproveitamentos (explícitos)

- **Encaminhar** (`criarOrcamentoDePedidoProposta`) **REUSA o mapeamento de
  `criarOrcamentoGraficoDeSolicitacao`** (`solicitacao-para-orcamento.service.ts`):
  - a função `resolverTipoEmbalagem(empresaId, textoTipo)` (normalização sem
    acento + match único por `codigo`/`descricao`) e a montagem de `medidas`
    JSON (`{L, A, P}`) e de observações serão **extraídas para um helper comum**
    (`mapear-para-orcamento.ts`) consumido pelos dois fluxos, **se e somente se**
    isso reduzir duplicação sem quebrar o fluxo da solicitação do representante.
    Caso o helper introduza risco de regressão no fluxo da solicitação (que está
    em produção), mantém-se cópia enxuta e documenta-se o de/para.
  - cria `OrcamentoGrafico` RASCUNHO com `etapaCalculo='AGUARDANDO'`,
    `clienteId/clienteNome/vendedorId` herdados, `tipoEmbalagemId` resolvido,
    `medidas` a partir de `medidasTexto` (parse "C x L x A"), `quantidade`,
    `exigeAmostra` propagado, e **grava `pedidoPropostaId`** (vínculo).
  - **Transação atômica** (`$transaction`): cria o orçamento + grava o vínculo +
    transiciona o RFQ para `ENVIADO_ORCAMENTO`. Se a criação falhar, nada é
    gravado (sem orçamento órfão, estado inalterado) — Req 5.6.
  - Pré-condição: `PedidoProposta.estado == EM_ANALISE` (Req 5.4), senão
    `PedidoPropostaError(409, ..., 'RFQ_NAO_APTO_ENCAMINHAR')`.

- **Máquina de estados**: serviço PURO `pedido-proposta-estado.service.ts`, mesma
  ideia do `etapa-calculo.service.ts` (mapa `TRANSICOES` + `validarTransicao`),
  testável com fast-check.

- **Amostra**: reusa `AprovacaoAmostra` + `amostra.service.ts`
  (`liberacaoPermitidaPorAmostra`). O vínculo é via o `OrcamentoGrafico` criado
  (`AprovacaoAmostra.orcamentoId == orcamentoGraficoId`) — ver decisão acima.

- **Liberar a PCP/Faturamento** (`liberarPedidoDePedidoProposta`): checa as
  Fases_Exigidas (orçado + `estado==ACEITO` + `etapaCalculo==VALIDADO` + amostra
  aprovada quando `exigeAmostra`) + perfil Supervisor, e então **compõe a cadeia
  existente**:
  1. `converterOrcamentoEmPedido(orcamentoGraficoId)` (`converter-orcamento.service.ts`)
     → gera o `PedidoVenda`.
  2. `liberarPedidoParaPcp(empresaId, pedidoVendaId, usuarioId, { senha })`
     (`liberar-pedido-pcp.service.ts`) → confirma o pedido e emite a(s) OP(s)
     (PCP). O Faturamento/NF-e segue o fluxo padrão do `PedidoVenda` já existente.

- **Consulta CNPJ**: a rota de autopreenchimento reusa `enriquecerCnpj`
  (`prospeccao/provider`, BrasilAPI/CNPJá Open) — não reimplementa.

### Rotas REST (prefixo `/api/orcamento-grafico`, registradas em `server.ts`)

Todas com `authenticate` + isolamento por `empresaId` EXPLÍCITO.

| Método | Caminho | Corpo / Params | Sucesso | Erros |
|---|---|---|---|---|
| GET | `/pedidos-proposta` | query: `estado?`, `origem?`, `tipoPedido?`, `busca?` | 200 lista (sem `dados`) | 401 |
| POST | `/pedidos-proposta` | `CriarPedidoPropostaInput` | 201 `{id, numero}` | 400 `VALIDACAO` |
| GET | `/pedidos-proposta/:id` | — | 200 detalhe + metadados de anexos | 404 `NAO_ENCONTRADO` |
| PUT | `/pedidos-proposta/:id` | `Partial<CriarPedidoPropostaInput>` | 200 | 400, 404 |
| PATCH | `/pedidos-proposta/:id/estado` | `{ estado, motivo? }` | 200 `{estado}` | 400 `ESTADO_TRANSICAO_INVALIDA`/`MOTIVO_OBRIGATORIO`, 404 |
| POST | `/pedidos-proposta/:id/encaminhar` | `{ tipoEmbalagemIdOverride? }` | 201 `{orcamentoGraficoId, numero}` | 409 `RFQ_NAO_APTO_ENCAMINHAR`, 400 `TIPO_EMBALAGEM_NAO_RESOLVIDO`, 404 |
| POST | `/pedidos-proposta/:id/liberar` | `{ senha? }` | 200 `{pedidoVendaId, opsEmitidas}` | 403 `SEM_PERMISSAO_LIBERACAO`, 409 `FASES_PENDENTES`/`AMOSTRA_PENDENTE`, 404 |
| POST | `/pedidos-proposta/:id/anexos` | multipart (1 imagem, máx 10MB) | 201 `{id}` | 400 `LIMITE_ANEXOS`/`MIME_INVALIDO`/`ARQUIVO_GRANDE`, 404 |
| GET | `/pedidos-proposta/:id/anexos/:anexoId` | — | 200 binário + `Content-Type` do `tipo` | 404 |
| DELETE | `/pedidos-proposta/:id/anexos/:anexoId` | — | 204 | 404 |
| GET | `/cnpj/:cnpj` | — (reusa `enriquecerCnpj`) | 200 dados / 422 não encontrado | 400 `CNPJ_INVALIDO` |
| GET | `/pedidos-proposta/por-orcamento/:orcamentoId` | — | 200 proposta somente-leitura + anexos; 200 `{ proposta: null }` se não houver | 404 (orçamento de outra empresa) |

- **Padrão de servir imagem** (GET `/anexos/:anexoId`), igual ao PDF da OP:
  ```ts
  const anexo = await obterAnexoBinario(user.empresaId, id, anexoId)
  return reply.type(anexo.tipo).header('Content-Disposition', `inline; filename="${anexo.nome}"`).send(anexo.dados)
  ```
  Como o navegador não envia header `Authorization` ao abrir imagem em nova aba,
  a rota aceita **token via query param** (mesmo padrão de
  `GET /pcp/op-pdf/:opId`).
- **Upload multipart** segue o padrão `request.file()` + `file.toBuffer()` +
  checagem `mimetype`/tamanho ≤ 10MB (padrão do `PUT /ordens-producao/:id/pdf`).
  Aqui só aceita `image/*` (Req 3.3).

### Componentes frontend (repo separado — Next.js 15 / Mantine 7)

| Componente | Local | Papel |
|---|---|---|
| Lista de Pedidos/Proposta | `src/app/(interna)/orcamento-grafico/pedidos/page.tsx` | passa a consumir `GET /pedidos-proposta` (filtros estado/origem/tipo + busca; badges de estado/origem/amostra); botões "Novo", "Encaminhar", "Liberar" |
| Formulário RFQ | `.../orcamento-grafico/pedidos/[novo|id]` (modal/página) | todos os campos da planilha; consulta CNPJ (`GET /cnpj/:cnpj`); galeria de até 5 imagens (upload/preview/remover) |
| "Ver proposta" no orçamento | `src/app/(interna)/orcamento-grafico/[id]/page.tsx` | botão que abre a proposta de origem (somente-leitura) via `GET /pedidos-proposta/por-orcamento/:orcamentoId`, com galeria |

## Data Models

Resumo das entidades e vínculos:

- `PedidoProposta` 1..N `AnexoPedidoProposta` (Cascade) — anexo tem `dados` BYTEA
  (nunca materializado em listagens; servido por rota GET dedicada).
- `PedidoProposta` 1..N `LogPedidoProposta` (Cascade) — auditoria de transições.
- `PedidoProposta` 0..1 `OrcamentoGrafico` via `orcamentoGraficoId`
  (`OrcamentoGrafico.pedidoPropostaId` é o lado espelho, aditivo).
- `AprovacaoAmostra` vinculada ao RFQ **indiretamente** via
  `orcamentoId == PedidoProposta.orcamentoGraficoId`.
- Numeração: `numero` sequencial por empresa (`max(numero)+1` por `empresaId`),
  com `@@unique([empresaId, numero])`.

Itens **schema novo (exigem migrate-prod no mesmo commit)**:
`pedido_proposta`, `anexo_pedido_proposta`, `log_pedido_proposta` (3 CREATE
TABLE) + `orcamento_grafico.pedido_proposta_id` (1 ADD COLUMN) + os índices e
FKs listados no bloco idempotente.

## Error Handling

Classe `PedidoPropostaError` (e `AnexoPropostaError`, mesmo shape) com
`statusCode` + `code`, padrão `EtapaCalculoError`/`LiberacaoError`. A liberação
reaproveita `LiberacaoError` da cadeia existente.

| code | statusCode | Quando |
|---|---|---|
| `VALIDACAO` | 400 | Zod/validação de corpo (origem/tipoPedido inválidos; `mercado` ausente) |
| `REPRESENTANTE_OBRIGATORIO` | 400 | origem `REPRESENTANTE` sem `representanteId` (Req 1.3) |
| `VENDEDOR_OBRIGATORIO` | 400 | origem `VENDEDOR` sem `vendedorId` (Req 1.4) |
| `ENTREGA_FRACIONADA_DIAS_OBRIGATORIO` | 400 | `tipoEntrega=FRACIONADA` sem `entregaFracionadaDias` (Req 2.5) |
| `ESTADO_TRANSICAO_INVALIDA` | 400 | transição fora do mapa (Req 4.8) |
| `MOTIVO_OBRIGATORIO` | 400 | destino PERDIDO/CANCELADO com motivo <5 (Req 4.10) |
| `MIME_INVALIDO` | 400 | anexo não-imagem (Req 3.3) |
| `ARQUIVO_GRANDE` | 400 | anexo > 10MB |
| `LIMITE_ANEXOS` | 409 | já há 5 anexos (Req 3.2) |
| `CNPJ_INVALIDO` | 400 | CNPJ ≠ 14 dígitos |
| `RFQ_NAO_APTO_ENCAMINHAR` | 409 | encaminhar com estado ≠ EM_ANALISE (Req 5.4) |
| `TIPO_EMBALAGEM_NAO_RESOLVIDO` | 400 | texto de tipo de embalagem sem match único e sem override |
| `FASES_PENDENTES` | 409 | liberação com Fase_Exigida pendente — corpo lista `fasesPendentes[]` (Req 8.5) |
| `AMOSTRA_PENDENTE` | 409 | `exigeAmostra` e amostra não aprovada (Req 8.4) |
| `SEM_PERMISSAO_LIBERACAO` | 403 | usuário não é Supervisor_Comercial (Req 8.7) |
| `NAO_ENCONTRADO` | 404 | recurso de outra empresa ou inexistente (Req 10.2) — nunca expõe dados |

> **Multi-tenant (Req 10)**: toda query/`update`/`delete` filtra por
> `empresaId` do usuário autenticado. Pedido de outra empresa → 404
> (`NAO_ENCONTRADO`), sem expor dados. Anexos validam o pai antes de qualquer
> operação. O `OrcamentoGrafico` do encaminhamento é gravado com o `empresaId`
> do RFQ de origem.

## Correctness Properties

Propriedades verificáveis (property-based com fast-check, salvo onde marcado
como exemplo/edge-case). Elas guiam a Testing Strategy abaixo.

### Property 1: Domínio de enums (Req 1.2/1.6/1.7/1.8)

Criação só é aceita quando `origem ∈ {REPRESENTANTE, VENDEDOR, INTERNA}` e
`tipoPedido ∈ {REPETICAO, MOSTRUARIO, NOVO}`; qualquer outro valor →
`VALIDACAO`. _Tipo: property._

**Validates: Requirements 1.2, 1.6, 1.7, 1.8**

### Property 2: Obrigatoriedade por origem (Req 1.3/1.4)

`origem=REPRESENTANTE` sem `representanteId` → `REPRESENTANTE_OBRIGATORIO`;
`origem=VENDEDOR` sem `vendedorId` → `VENDEDOR_OBRIGATORIO`; `origem=INTERNA`
dispensa ambos. _Tipo: property._

**Validates: Requirements 1.3, 1.4**

### Property 3: Entrega fracionada (Req 2.5)

`tipoEntrega=FRACIONADA` sem `entregaFracionadaDias` →
`ENTREGA_FRACIONADA_DIAS_OBRIGATORIO`; `UNICA` ignora o campo. _Tipo: property._

**Validates: Requirements 2.5, 2.6**

### Property 4: Máquina de estados (Req 4.2–4.8)

`validarTransicao(atual, novo)` aceita ⟺ `novo ∈ TRANSICOES[atual]`; caso
contrário lança `ESTADO_TRANSICAO_INVALIDA`. _Tipo: property (sobre
EstadoProposta²)._

**Validates: Requirements 4.2, 4.3, 4.4, 4.5, 4.6, 4.8**

### Property 5: Terminais não transicionam (Req 4.7)

A partir de `ACEITO|PERDIDO|CANCELADO`, toda transição é rejeitada. _Tipo:
edge-case._

**Validates: Requirements 4.7**

### Property 6: Motivo obrigatório (Req 4.10)

Transição válida com destino PERDIDO/CANCELADO exige `motivo` com ≥5
caracteres, senão `MOTIVO_OBRIGATORIO`. _Tipo: property._

**Validates: Requirements 4.10**

### Property 7: Mime de anexo (Req 3.3)

Anexo aceito ⟺ `mime` começa com `image/`; caso contrário `MIME_INVALIDO`.
_Tipo: property._

**Validates: Requirements 3.3**

### Property 8: Limite de anexos (Req 3.2)

Com `n` anexos existentes, novo anexo aceito ⟺ `n < 5`; `n ≥ 5` →
`LIMITE_ANEXOS`. _Tipo: property._

**Validates: Requirements 3.2, 3.5**

### Property 9: Listagem sem BYTEA (Req 3.6)

Nenhum payload de listagem/detalhe contém o campo `dados`; só metadados
(`id/nome/tipo/tamanho`). _Tipo: example._

**Validates: Requirements 3.6**

### Property 10: Encaminhamento atômico (Req 5.4/5.6)

Só encaminha com estado `EM_ANALISE`; em qualquer falha, estado inalterado e
sem orçamento órfão. _Tipo: edge-case / golden._

**Validates: Requirements 5.4, 5.6**

### Property 11: Fases pendentes (Req 8.5)

A liberação só sucede quando orçado + `estado=ACEITO` + `etapaCalculo=VALIDADO`
+ (amostra aprovada se `exigeAmostra`); qualquer subconjunto não-resolvido →
`FASES_PENDENTES`/`AMOSTRA_PENDENTE` listando as fases. _Tipo: property/golden._

**Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5**

### Property 12: Isolamento multi-tenant (Req 10.1/10.2)

Recurso de `empresaId` diferente do usuário → 404, sem expor dados. _Tipo:
example._

**Validates: Requirements 10.1, 10.2**

## Testing Strategy

Vitest + fast-check (`--reporter=dot`). Foco em property-based na máquina de
estados e nas regras de anexo, mais um golden do encaminhamento.

### Property-based — máquina de estados (`pedido-proposta-estado.service.test.ts`)

- **P1 — transição só é aceita se estiver no mapa**: para quaisquer
  `(atual, novo)` em `EstadoProposta²`, `validarTransicao` lança
  `ESTADO_TRANSICAO_INVALIDA` ⟺ `novo ∉ TRANSICOES[atual]`.
- **P2 — estados terminais nunca transicionam**: para todo destino, a partir de
  `ACEITO|PERDIDO|CANCELADO`, a transição sempre lança (Req 4.7).
- **P3 — motivo obrigatório em PERDIDO/CANCELADO**: quando a transição é válida e
  o destino é PERDIDO/CANCELADO, `motivo` ausente/<5 → `MOTIVO_OBRIGATORIO`;
  motivo ≥5 → sucesso (Req 4.10).
- **P4 — determinismo/idempotência de leitura**: `getTransicoesPermitidas` é
  função pura (mesmo input → mesma saída) e `isTerminal` ⟺ lista vazia.

### Property-based — anexos (`anexo-pedido-proposta.service.test.ts`, com mocks)

- **P5 — mime**: qualquer mime que não comece com `image/` → `MIME_INVALIDO`;
  `image/*` passa na validação (Req 3.3).
- **P6 — limite**: dado um contador de anexos existentes `n ∈ [0..6]`, aceitar
  ⟺ `n < 5`; `n >= 5` → `LIMITE_ANEXOS` (Req 3.2).
- **P7 — tamanho**: buffer > 10MB → `ARQUIVO_GRANDE`.

### Golden — encaminhamento (`encaminhar-orcamento.service.test.ts`, mocks Prisma)

- **G1**: RFQ em `EM_ANALISE` com `tipoEmbalagem` que casa único → cria
  `OrcamentoGrafico` RASCUNHO `etapaCalculo=AGUARDANDO`, com `pedidoPropostaId`
  gravado, `medidas` corretas a partir de `medidasTexto`, e RFQ vira
  `ENVIADO_ORCAMENTO` (Req 5.1/5.2/5.3/5.5).
- **G2**: RFQ em estado ≠ `EM_ANALISE` → `RFQ_NAO_APTO_ENCAMINHAR`, nada criado
  (Req 5.4/5.6).
- **G3**: falha na criação do orçamento (transação) → estado do RFQ inalterado,
  sem orçamento órfão (Req 5.6).

### Liberação (`liberar-pedido-proposta.service.test.ts`, mocks)

- Fases pendentes isoladas (sem orçamento / estado ≠ ACEITO / etapaCalculo ≠
  VALIDADO / amostra pendente) → `FASES_PENDENTES`/`AMOSTRA_PENDENTE` com a lista
  correta; todas resolvidas + Supervisor → compõe converter + liberarPedidoParaPcp
  (Req 8).

### Verificação complementar

`get_diagnostics` nos arquivos tocados; `npx prisma generate`; rodar
`npx tsx prisma/migrate-prod.ts` 2× local (idempotência). Build Next no frontend.

## Mapeamento Requirement → Componente

| Req | Componente / Decisão |
|---|---|
| **1. Criação por origem** | `pedido-proposta.service.ts#criarPedidoProposta` + Zod na rota POST; validações `REPRESENTANTE_OBRIGATORIO`/`VENDEDOR_OBRIGATORIO`; estado inicial `NOVO`; `empresaId` do usuário |
| **2. Campos da planilha** | Model `PedidoProposta` (todos os campos); `mercado` NOT NULL; regra `tipoEntrega=FRACIONADA ⇒ entregaFracionadaDias`; defaults `false` dos booleanos; consulta CNPJ via `GET /cnpj/:cnpj` (reusa `enriquecerCnpj`) |
| **3. Anexos BYTEA (até 5)** | Model `AnexoPedidoProposta` (`dados` BYTEA); `anexo-pedido-proposta.service.ts` (mime/limite/tamanho); GET binário seta `Content-Type` (padrão `OrdemProducao.pdfData`); listagens via `select` sem `dados` |
| **4. Máquina de estados** | `pedido-proposta-estado.service.ts` (PURO, fast-check) + `transicionarEstado` grava `LogPedidoProposta` (estado anterior/novo/usuário/data) |
| **5. Encaminhar p/ orçamento** | `encaminhar-orcamento.service.ts#criarOrcamentoDePedidoProposta` (REUSA mapeamento de `criarOrcamentoGraficoDeSolicitacao`); transação atômica; grava `OrcamentoGrafico.pedidoPropostaId`; pré-condição `EM_ANALISE` |
| **6. Ver proposta no orçamento** | `GET /pedidos-proposta/por-orcamento/:orcamentoId` (somente-leitura + metadados de anexos + rota de leitura por imagem); `{ proposta: null }` quando não há vínculo |
| **7. Controle de amostra** | `PedidoProposta.exigeAmostra`; reuso de `AprovacaoAmostra` via `orcamentoId == orcamentoGraficoId`; estado da amostra exposto no detalhe/listagem |
| **8. Liberar a PCP/Faturamento** | `liberar-pedido-proposta.service.ts` (checa Fases_Exigidas + perfil Supervisor) compondo `converterOrcamentoEmPedido` + `liberarPedidoParaPcp` |
| **9. Gestão central** | `GET /pedidos-proposta` (todas as origens/tipos da empresa; filtros estado/origem/tipo; busca case-insensitive em cliente/produto; estágio do funil + amostra) |
| **10. Multi-tenant** | `empresaId` EXPLÍCITO em toda query; 404 em cross-empresa; validação do pai nos anexos; `OrcamentoGrafico` gravado com `empresaId` do RFQ |

## Pontos de código tocados (resumo por repo)

### Backend (`VisioFab.Wms.Back`) — SCHEMA NOVO exige migrate-prod no mesmo commit

- `prisma/schema.prisma`: + models `PedidoProposta`, `AnexoPedidoProposta`,
  `LogPedidoProposta`; + coluna `OrcamentoGrafico.pedidoPropostaId`. **(schema novo)**
- `prisma/migrate-prod.ts`: + bloco idempotente (3 CREATE TABLE, índices, 2 FK em
  try/catch, 1 ADD COLUMN). **(no mesmo commit do schema)**
- `src/modules/orcamento-grafico/pedido-proposta/` (NOVO submódulo):
  `pedido-proposta-estado.service.ts` (puro), `pedido-proposta.service.ts`,
  `anexo-pedido-proposta.service.ts`, `encaminhar-orcamento.service.ts`,
  `liberar-pedido-proposta.service.ts`, `pedido-proposta.routes.ts` + testes.
- `src/modules/orcamento-grafico/solicitacao-para-orcamento.service.ts`:
  possível extração de helper comum (`mapear-para-orcamento.ts`) SE reduzir
  duplicação sem regressão no fluxo da solicitação.
- `src/server.ts`: registrar `pedidoPropostaRoutes` com prefixo
  `/api/orcamento-grafico`.
- Reaproveitados (NÃO reescritos): `converter-orcamento.service.ts`,
  `liberar-pedido-pcp.service.ts`, `amostra.service.ts`, `enriquecerCnpj`.

### Frontend (`VisioFab.Wms.Front`) — repo separado

- `src/app/(interna)/orcamento-grafico/pedidos/page.tsx`: passa a consumir a nova
  listagem de `PedidoProposta` (filtros + ações encaminhar/liberar + formulário
  com galeria de até 5 imagens + consulta CNPJ).
- `src/app/(interna)/orcamento-grafico/[id]/page.tsx`: + botão "Ver proposta"
  (abre a proposta de origem somente-leitura com galeria).
