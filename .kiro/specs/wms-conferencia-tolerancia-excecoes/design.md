# Design Document: WMS Conferência — Tolerância de Quantidade e Fila de Exceções

## Overview

Evolução do fluxo de conferência de entrada existente (`conferir-todos` →
`segunda-conferencia` → `confirmar`) para incorporar duas capacidades novas,
sem alterar o contrato dos endpoints já usados pelo frontend e pelos testes
E2E:

1. **Tolerância percentual de quantidade** — diferença de quantidade dentro de
   um percentual configurável é aceita automaticamente (`Divergencia_Leve`),
   sem exigir segunda conferência.
2. **Estado HOLD com motivo padronizado** — divergência confirmada (fora da
   tolerância, ou lote/validade) pode ser colocada em espera por um motivo
   padronizado, saindo da tela operacional e entrando em uma **Fila de
   Exceções** resolvida por um Supervisor.

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                     Frontend (Next.js + Mantine)                      │
│  conferencia-entrada/page.tsx                                        │
│    └── badge "Aceito na tolerância" (item Divergencia_Leve)          │
│  SegundaConferenciaPanel.tsx                                          │
│    └── botão "Colocar em espera" → ModalMotivoHold (novo)            │
│  wms/fila-excecoes/page.tsx  (nova página)                           │
│    └── FilaExcecoesTable — lista Hold + PendenciaCce + requerSenha   │
└──────────────────────────────────────────────────────────────────────┘
                              │
┌──────────────────────────────────────────────────────────────────────┐
│                     Backend (Fastify + Prisma)                        │
│  conferencia-entrada.routes.ts                                       │
│    ├── POST /conferir-todos/:notaId        (estendido — tolerância)  │
│    ├── POST /segunda-conferencia/:notaId/hold  (novo)                │
│    └── POST /confirmar/:notaId             (estendido — bloqueia HOLD)│
│  conferencia-entrada/tolerancia-quantidade.service.ts  (novo, puro)   │
│  conferencia-entrada/hold.service.ts                   (novo)        │
│  fila-excecoes/fila-excecoes.routes.ts                 (novo)        │
│  fila-excecoes/fila-excecoes.service.ts                (novo)        │
└──────────────────────────────────────────────────────────────────────┘
                              │
                     PostgreSQL (Prisma)
┌──────────────────────────────────────────────────────────────────────┐
│  Produto.toleranciaQuantidadePercentual          (novo campo)        │
│  Empresa.toleranciaQuantidadePercentualPadrao    (novo campo)        │
│  ItemNotaEntrada.holdMotivo / holdMotivoDetalhe /                     │
│    holdUsuarioId / holdCriadoEm                  (novos campos)      │
│  ItemNotaEntrada.statusConferencia               (novo valor: HOLD)  │
└──────────────────────────────────────────────────────────────────────┘
```

## Data Models

### Alterações em `Produto` e `Empresa`

```prisma
model Produto {
  // ...campos existentes...
  toleranciaQuantidadePercentual Decimal? @map("tolerancia_quantidade_percentual") @db.Decimal(5, 2)
}

model Empresa {
  // ...campos existentes...
  toleranciaQuantidadePercentualPadrao Decimal? @map("tolerancia_quantidade_percentual_padrao") @db.Decimal(5, 2)
}
```

### Alterações em `ItemNotaEntrada`

```prisma
model ItemNotaEntrada {
  // ...campos existentes...
  // status_conferencia ganha o novo valor possível: HOLD
  holdMotivo         String?   @map("hold_motivo") @db.VarChar(40)
  holdMotivoDetalhe  String?   @map("hold_motivo_detalhe") @db.Text
  holdUsuarioId      String?   @map("hold_usuario_id")
  holdCriadoEm       DateTime? @map("hold_criado_em")
}
```

Nenhuma tabela nova é criada — a Fila de Exceções é uma **visão agregada**
(query composta), não uma tabela própria, evitando duplicar dados que já
existem em `ItemNotaEntrada` (HOLD) e `PendenciaCce` (AGUARDANDO_CCE).

### Motivos padronizados (constante compartilhada)

```typescript
export const MOTIVOS_DIVERGENCIA = [
  { value: 'ERRO_CONTAGEM_FORNECEDOR', label: 'Erro de contagem do fornecedor' },
  { value: 'AVARIA_TRANSPORTE', label: 'Avaria no transporte' },
  { value: 'ERRO_ETIQUETAGEM', label: 'Erro de etiquetagem' },
  { value: 'AGUARDANDO_CCE_FORNECEDOR', label: 'Aguardando CC-e do fornecedor' },
  { value: 'DIVERGENCIA_LOTE_FORNECEDOR', label: 'Divergência de lote do fornecedor' },
  { value: 'OUTRO', label: 'Outro (detalhar)' },
] as const
```

## Components and Interfaces

### 1. `tolerancia-quantidade.service.ts` (lógica pura)

```typescript
export interface AvaliacaoTolerancia {
  dentroTolerancia: boolean
  percentualDesvio: number
  percentualToleranciaAplicado: number
}

/**
 * Calcula o percentual de desvio absoluto entre quantidade conferida e
 * quantidade da NF-e, e compara com a tolerância aplicável (produto, com
 * fallback para o padrão da empresa, com fallback para 0).
 */
export function avaliarToleranciaQuantidade(
  quantidadeConferida: number,
  quantidadeNf: number,
  toleranciaProduto: number | null,
  toleranciaEmpresaPadrao: number | null,
): AvaliacaoTolerancia
```

Regras:
- `percentualDesvio = |quantidadeConferida - quantidadeNf| / quantidadeNf * 100`
  (se `quantidadeNf` for 0, qualquer desvio não-zero é considerado fora da
  tolerância, para evitar divisão por zero)
- `percentualToleranciaAplicado = toleranciaProduto ?? toleranciaEmpresaPadrao ?? 0`
- `dentroTolerancia = percentualDesvio <= percentualToleranciaAplicado`

### 2. Integração em `conferir-todos/:notaId`

Ordem de avaliação por item (preserva a ordem de regras já existente):
1. Quantidade não informada → divergente (sem alteração)
2. Lote/validade obrigatórios não informados → divergente (sem alteração)
3. Shelf life → bloqueia item (sem alteração)
4. **Recebimento parcial** (`permiteRecebimentoParcial`) avaliado primeiro,
   como já ocorre — se aplicável, não passa pela tolerância
5. **Novo**: se houver divergência de quantidade e recebimento parcial não
   se aplicou, avaliar `avaliarToleranciaQuantidade`. Se `dentroTolerancia`,
   o item é `CONFORME` com `tipoDivergencia: 'TOLERANCIA_ACEITA'` e os campos
   `percentualDesvio`/`percentualToleranciaAplicado` no resultado — **não**
   marca `PENDENTE_SEGUNDA_CONFERENCIA`
6. Caso contrário, segue o fluxo já existente (marcar pendente segunda
   conferência se houver qualquer divergência de quantidade/lote/validade)

Novo campo em `ConfigConferenciaProduto`? Não — tolerância é uma característica
do produto (`Produto.toleranciaQuantidadePercentual`), não da política de
resolução de divergência, então fica no model `Produto`, mantendo a separação
de responsabilidades já usada no schema (`Produto.exigeLote`,
`Produto.shelfLifeMinimo`).

### 3. `hold.service.ts`

```typescript
export interface ColocarEmHoldInput {
  itemNotaEntradaId: string
  motivo: string          // um dos MOTIVOS_DIVERGENCIA
  motivoDetalhe?: string  // obrigatório quando motivo === 'OUTRO'
  usuarioId: string
}

/**
 * Marca um item PENDENTE_SEGUNDA_CONFERENCIA como HOLD, registrando motivo,
 * usuário e timestamp. Falha se o item não estiver em
 * PENDENTE_SEGUNDA_CONFERENCIA.
 */
export async function colocarEmHold(input: ColocarEmHoldInput): Promise<void>

export interface ResolverHoldInput {
  itemNotaEntradaId: string
  acao: 'ACEITAR' | 'REJEITAR' | 'RETORNAR_SEGUNDA_CONFERENCIA'
  supervisorId: string
  motivo?: string
  motivoDetalhe?: string
}

/**
 * Resolve um item em HOLD:
 * - ACEITAR → statusConferencia = CONFERIDO
 * - REJEITAR → statusConferencia = REJEITADO
 * - RETORNAR_SEGUNDA_CONFERENCIA → statusConferencia = PENDENTE_SEGUNDA_CONFERENCIA,
 *   limpa campos de hold para nova tentativa
 */
export async function resolverHold(input: ResolverHoldInput): Promise<void>
```

### 4. Novo endpoint: `POST /conferencia-entrada/segunda-conferencia/:notaId/hold`

```typescript
const holdSchema = z.object({
  itemNotaEntradaId: z.string().uuid(),
  motivo: z.enum(['ERRO_CONTAGEM_FORNECEDOR', 'AVARIA_TRANSPORTE', 'ERRO_ETIQUETAGEM',
    'AGUARDANDO_CCE_FORNECEDOR', 'DIVERGENCIA_LOTE_FORNECEDOR', 'OUTRO']),
  motivoDetalhe: z.string().optional(),
})
```
Valida: item pertence à nota, está `PENDENTE_SEGUNDA_CONFERENCIA`, e se
`motivo === 'OUTRO'` então `motivoDetalhe` é obrigatório (400 se ausente).

### 5. Módulo `fila-excecoes` (novo)

```
GET /api/fila-excecoes
  Query: fornecedor?, notaId?, tipo? ('HOLD' | 'CCE' | 'SENHA'), dataInicio?, dataFim?
  Retorna itens agregados de 3 fontes, unificados em um formato comum:
    { id, tipo: 'HOLD'|'CCE'|'SENHA', notaEntradaId, notaNumero, fornecedor,
      descricaoProduto, motivo, criadoEm, itemNotaEntradaId? }

POST /api/fila-excecoes/:itemNotaEntradaId/resolver-hold
  Body: { acao: 'ACEITAR'|'REJEITAR'|'RETORNAR_SEGUNDA_CONFERENCIA', motivo?, motivoDetalhe? }
  Requer perfil SUPERVISOR ou ADMIN (reaproveita validarCredenciaisSupervisor
  não é necessário aqui pois o usuário já está autenticado via JWT com esse
  perfil — moduloGuard + checagem de perfil no handler)
```

`fila-excecoes.service.ts`:
```typescript
export async function listarFilaExcecoes(empresaId: string, filtros: FiltrosFilaExcecoes) {
  // 1. Itens HOLD: prisma.itemNotaEntrada.findMany({ where: { statusConferencia: 'HOLD', notaEntrada: { empresaId } } })
  // 2. PendenciaCce AGUARDANDO_CCE: reaproveita listarPendencias já existente
  // 3. Itens PENDENTE_SEGUNDA_CONFERENCIA cujo produto tem aceitarSenha=true
  //    (join com ConfigConferenciaProduto)
  // Unifica em um array só, ordenado por criadoEm desc, aplica filtros comuns
}
```

### 6. Extensão de `confirmar/:notaId`

Adiciona verificação: se existir `ItemNotaEntrada` com
`statusConferencia = 'HOLD'` para a nota, bloqueia com o mesmo padrão de erro
422 já usado para `PENDENTE_SEGUNDA_CONFERENCIA`:

```typescript
{
  error: {
    code: 'ITENS_EM_HOLD',
    message: 'Existem itens em espera (Hold) aguardando resolução na Fila de Exceções',
  },
}
```

### 7. Frontend

**`SegundaConferenciaPanel.tsx`** (estendido):
- Novo botão "Colocar em espera" ao lado de "Aceitar com divergência" /
  "Rejeitar" / "Corrigir Contagem", visível quando `status === 'divergenciaQuantidade'`
  **e também** quando `status === 'requerSenha'` (permite adiar decisão de
  lote/validade também).
- Abre `ModalMotivoHold` (novo componente) — `Select` com `MOTIVOS_DIVERGENCIA`
  + `Textarea` condicional quando `motivo === 'OUTRO'`.
- Ao confirmar, chama `useColocarEmHold` e remove o item da lista local
  (mesmo padrão de `handleRejeitarItem`).

**`conferencia-entrada/page.tsx`** (estendido):
- No resultado de `conferir-todos`, itens com `tipoDivergencia === 'TOLERANCIA_ACEITA'`
  exibem badge amarelo "Aceito na tolerância (±X%)" em vez do badge verde
  "Conforme" — sem nenhuma ação adicional, o item segue habilitado.

**`wms/fila-excecoes/page.tsx`** (novo, modelado em `wms/pendencias-cce/page.tsx`):
- Tabela com colunas: Tipo (badge HOLD/CCE/SENHA), Nota, Fornecedor, Produto,
  Motivo, Criado em, Ações.
- Ação por tipo:
  - `HOLD` → botões Aceitar / Rejeitar / Retornar p/ 2ª conferência
  - `CCE` → reaproveita `useResolverPendencia` (Resolver/Cancelar já existentes)
  - `SENHA` → botão "Autorizar" que abre `ModalSenhaSupervisor` existente e
    chama o endpoint `autorizar-senha` já existente

**Sidebar** (`ModuleSidebar.tsx`): adicionar item `Fila de Exceções` no grupo
Recebimento, entre "Endereçamento" e "Pendências CC-e".

## Error Handling

| Cenário | HTTP | Resposta |
|---|---|---|
| Hold sem item `PENDENTE_SEGUNDA_CONFERENCIA` | 422 | `{ message: 'Item não está pendente de segunda conferência' }` |
| Hold com motivo OUTRO sem detalhe | 400 | `{ message: 'motivoDetalhe é obrigatório quando motivo é OUTRO' }` |
| Resolver Hold em item que não está HOLD | 422 | `{ message: 'Item não está em espera (Hold)' }` |
| Confirmar nota com item em HOLD | 422 | `{ error: { code: 'ITENS_EM_HOLD', message: '...' } }` |
| Resolver Hold sem perfil SUPERVISOR/ADMIN | 403 | `{ message: 'Perfil insuficiente para resolver exceções' }` |

## Compatibilidade (Requirement 6)

- `conferir-todos/:notaId` mantém nome, método e schema de entrada. Resposta
  ganha campos novos apenas em itens `TOLERANCIA_ACEITA` — clientes que
  ignoram campos desconhecidos (padrão do frontend atual, que faz spread do
  JSON) não quebram.
- Tolerância default é 0 em todos os níveis (produto e empresa), então
  empresas que não configurarem nada mantêm o comportamento atual byte-a-byte
  (toda divergência de quantidade gera `PENDENTE_SEGUNDA_CONFERENCIA`, como
  hoje).
- `executarSegundaConferencia` não é alterado — Hold é uma ação *alternativa*
  tomada antes de chamar esse serviço, em um endpoint novo e separado.
- Bloqueio de `confirmar` por `PENDENTE_SEGUNDA_CONFERENCIA` e `PendenciaCce`
  aberta continua idêntico; a checagem de `HOLD` é uma verificação adicional,
  não uma substituição.

## Testing Strategy

- **Unit tests**: `avaliarToleranciaQuantidade` (casos de borda: NF=0,
  desvio exato no limite, tolerância null/0), `colocarEmHold`/`resolverHold`
  (transições de status válidas/invalidas).
- **Integration tests**: `conferir-todos` com tolerância configurada vs sem
  configurar (regressão), endpoint de hold, endpoint de fila de exceções com
  multi-tenancy (empresa A não vê itens da empresa B).
- Testes ficam em `src/tests/` seguindo a convenção do projeto
  (`*.test.ts` com vitest), sem necessidade de PBT com fast-check dado o
  escopo pequeno de lógica pura (poucos casos de borda determinísticos).
