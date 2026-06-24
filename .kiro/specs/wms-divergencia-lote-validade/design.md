# Design Document: WMS Divergência Lote/Validade

## Overview

Tratamento de divergências de lote e validade detectadas durante a conferência de entrada no WMS. O sistema detecta quando o conferente informa lote/validade diferentes da NF-e, consulta a política de resolução configurada por produto e aplica o modo correspondente: emissão de CC-e, liberação por supervisor, aceitação livre ou bloqueio total. A solução estende o fluxo existente em `conferencia-entrada.routes.ts` e adiciona um novo serviço de lógica pura para detecção/resolução, um novo endpoint unificado e um componente frontend dedicado.

## Architecture

A feature estende o fluxo de conferência de entrada existente para tratar divergências de lote e validade com política de resolução configurável por produto. A arquitetura segue o padrão já estabelecido no projeto: rotas Fastify + serviços de lógica pura + Prisma ORM.

```
┌─────────────────────────────────────────────────────────────────┐
│                     Frontend (Next.js + Mantine)                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ conferencia-entrada/page.tsx                                 ││
│  │   └── DivergenciaLoteValidadePanel (novo componente)        ││
│  │         ├── DivergenciaCard (por item divergente)            ││
│  │         ├── ModalSenhasSupervisor                           ││
│  │         └── BotaoFinalizacao (gate: sem pendentes)           ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
                    POST /api/conferencia-entrada
                              │
┌─────────────────────────────────────────────────────────────────┐
│                     Backend (Fastify + Prisma)                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ conferencia-entrada.routes.ts                               │ │
│  │   ├── POST /conferir-todos/:notaId  (extendido)            │ │
│  │   └── POST /resolver-divergencia-lv  (novo endpoint)       │ │
│  ├────────────────────────────────────────────────────────────┤ │
│  │ divergencia-lote-validade.service.ts  (novo - lógica pura) │ │
│  │   ├── detectarDivergenciaLote()                            │ │
│  │   ├── detectarDivergenciaValidade()                        │ │
│  │   ├── resolverModo()                                       │ │
│  │   ├── gerarTextoCCeLoteValidade()                          │ │
│  │   └── validarCredenciaisSupervisor()                       │ │
│  ├────────────────────────────────────────────────────────────┤ │
│  │ config-conferencia-produto.service.ts  (novo)              │ │
│  │   └── obterModoResolucao()                                 │ │
│  ├────────────────────────────────────────────────────────────┤ │
│  │ CceService (existente) — emissão de CC-e                   │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                     PostgreSQL (Prisma)
                              │
┌─────────────────────────────────────────────────────────────────┐
│  ConfigConferenciaProduto (nova tabela)                          │
│  DivergenciaConferencia (existente - reutilizada)               │
│  CartaCorrecao (existente - reutilizada)                        │
│  Produto (existente - consultada)                               │
│  Usuario (existente - validação supervisor)                     │
└─────────────────────────────────────────────────────────────────┘
```

## Data Models

### Nova Tabela: ConfigConferenciaProduto

```prisma
model ConfigConferenciaProduto {
  id                    String   @id @default(uuid())
  empresaId             String   @map("empresa_id")
  empresa               Empresa  @relation(fields: [empresaId], references: [id])
  produtoId             String   @map("produto_id")
  produto               Produto  @relation(fields: [produtoId], references: [id])
  modoResolucaoLote     String   @default("BLOQUEAR") @map("modo_resolucao_lote") @db.VarChar(20)
  modoResolucaoValidade String   @default("BLOQUEAR") @map("modo_resolucao_validade") @db.VarChar(20)
  criadoEm              DateTime @default(now()) @map("criado_em")
  atualizadoEm          DateTime @updatedAt @map("atualizado_em")

  @@unique([empresaId, produtoId])
  @@map("config_conferencia_produto")
}
```

Valores válidos para `modoResolucaoLote` e `modoResolucaoValidade`:
- `ACEITAR_CCE`
- `ACEITAR_SENHA`
- `ACEITAR_LIVRE`
- `BLOQUEAR`

### Alteração no DivergenciaConferencia (existente)

Novo campo opcional para registrar supervisor que autorizou:

```prisma
// adicionar ao model existente:
supervisorId String? @map("supervisor_id")
```

## Components and Interfaces

### 1. divergencia-lote-validade.service.ts (Lógica Pura)

```typescript
// ─── Tipos ─────────────────────────────────────────────────────────────────────

export type ModoResolucao = 'ACEITAR_CCE' | 'ACEITAR_SENHA' | 'ACEITAR_LIVRE' | 'BLOQUEAR'

export const MODOS_VALIDOS: ModoResolucao[] = ['ACEITAR_CCE', 'ACEITAR_SENHA', 'ACEITAR_LIVRE', 'BLOQUEAR']

export interface DeteccaoDivergenciaInput {
  valorEsperado: string | null
  valorConferido: string | null
  exigeLote?: boolean // usado apenas para lote
}

export interface DeteccaoDivergenciaResult {
  divergente: boolean
  tipo?: 'LOTE_DIVERGENTE' | 'VALIDADE_DIVERGENTE'
  valorEsperado: string | null
  valorConferido: string | null
}

export interface ResolucaoInput {
  modo: ModoResolucao
  credenciais?: { usuario: string; senha: string }
}

export interface ResolucaoResult {
  permitido: boolean
  novoStatus: 'ACEITA' | 'PENDENTE' | 'PENDENTE_CCE'
  requerCCe: boolean
  mensagem: string
}

export interface TextoCCeLoteValidadeInput {
  tipo: 'LOTE_DIVERGENTE' | 'VALIDADE_DIVERGENTE'
  valorEsperado: string | null
  valorConferido: string | null
  descricaoProduto: string
}

// ─── Funções Puras ─────────────────────────────────────────────────────────────

/**
 * Detecta divergência de lote entre NF-e e valor conferido.
 * Só detecta se produto exige lote (exigeLote = true).
 */
export function detectarDivergenciaLote(input: DeteccaoDivergenciaInput): DeteccaoDivergenciaResult

/**
 * Detecta divergência de validade entre NF-e e valor conferido.
 * Compara datas ignorando horas (apenas dia).
 */
export function detectarDivergenciaValidade(input: {
  validadeEsperada: Date | null
  validadeConferida: Date | null
}): DeteccaoDivergenciaResult

/**
 * Determina se a resolução é permitida e qual ação tomar.
 * Função pura — não faz I/O, não valida credenciais (isso é separado).
 */
export function resolverModo(modo: ModoResolucao): ResolucaoResult

/**
 * Gera texto de correção para CC-e de divergência de lote ou validade.
 */
export function gerarTextoCCeLoteValidade(input: TextoCCeLoteValidadeInput): string

/**
 * Valida se um modo informado é válido.
 */
export function isModoValido(modo: string): modo is ModoResolucao
```

### 2. config-conferencia-produto.service.ts

```typescript
export interface ConfigResolucao {
  modoResolucaoLote: ModoResolucao
  modoResolucaoValidade: ModoResolucao
}

const CONFIG_PADRAO: ConfigResolucao = {
  modoResolucaoLote: 'BLOQUEAR',
  modoResolucaoValidade: 'BLOQUEAR',
}

/**
 * Obtém a configuração de resolução para um produto.
 * Retorna BLOQUEAR como padrão se não houver configuração.
 */
export async function obterModoResolucao(
  empresaId: string,
  produtoId: string
): Promise<ConfigResolucao>
```

### 3. Endpoint POST /resolver-divergencia-lv

```typescript
// Schema de entrada (Zod)
const resolverDivergenciaLvSchema = z.object({
  divergenciaId: z.string().uuid(),
  acao: z.enum(['ACEITAR', 'REJEITAR']),
  credenciaisSupervisor: z.object({
    usuario: z.string().min(1),
    senha: z.string().min(1),
  }).optional(),
})

// Resposta
interface RespostaResolucao {
  divergenciaId: string
  status: 'ACEITA' | 'PENDENTE' | 'PENDENTE_CCE' | 'REJEITADA'
  modo: ModoResolucao
  cce?: {
    sucesso: boolean
    protocolo?: string
    motivoRejeicao?: string
  }
  mensagem: string
}
```

### 4. Fluxo de Resolução (Orquestração no Endpoint)

```
1. Validar JWT → extrair user.id, user.empresaId
2. Buscar divergência por ID + empresaId (multi-tenancy)
3. Se não encontrada → 404 genérico
4. Buscar produto associado ao item da divergência
5. Buscar ConfigConferenciaProduto (ou usar padrão BLOQUEAR)
6. Determinar modo aplicável (lote→modoResolucaoLote, validade→modoResolucaoValidade)
7. Switch por modo:
   - BLOQUEAR → rejeitar com mensagem
   - ACEITAR_LIVRE → atualizar status para ACEITA
   - ACEITAR_SENHA → validar credenciais supervisor, se OK → ACEITA
   - ACEITAR_CCE → gerar texto, chamar CceService, atualizar conforme resultado
8. Retornar resposta com status + mensagem + dados CC-e se aplicável
```

### 5. Integração com POST /conferir-todos/:notaId (Extensão)

O endpoint existente será estendido para:
1. Após comparar lote/validade, consultar `ConfigConferenciaProduto` do produto
2. Incluir o `modoResolucao` no resultado de cada divergência retornada
3. O resultado de divergência passa a incluir:

```typescript
interface ResultadoDivergenciaLoteValidade {
  itemId: string
  descricao: string
  divergenciaId: string
  tipo: 'LOTE_DIVERGENTE' | 'VALIDADE_DIVERGENTE'
  valorEsperado: string | null
  valorConferido: string | null
  modoResolucao: ModoResolucao
  status: 'PENDENTE'
}
```

### 6. Frontend: DivergenciaLoteValidadePanel

```typescript
// Props do componente principal
interface DivergenciaLoteValidadePanelProps {
  divergencias: ResultadoDivergenciaLoteValidade[]
  notaId: string
  onResolucaoCompleta: () => void
}

// Hook React Query
function useResolverDivergenciaLV() {
  return useMutation({
    mutationFn: (body: ResolverDivergenciaLVPayload) =>
      api.post('/conferencia-entrada/resolver-divergencia-lv', body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['conferencia-entrada'] }),
  })
}
```

Regras visuais por modo:
| Modo | Cor (Mantine) | Ícone | Ação Disponível |
|------|--------------|-------|-----------------|
| ACEITAR_LIVRE | `green` | IconCheck | Botão "Aceitar" direto |
| ACEITAR_SENHA | `yellow` | IconLock | Botão "Liberar" → abre modal senha |
| ACEITAR_CCE | `blue` | IconFileText | Botão "Aceitar (CC-e)" |
| BLOQUEAR | `red` | IconBan | Nenhum (só texto orientativo) |

### 7. Validação de Credenciais de Supervisor

```typescript
export interface ValidacaoSupervisorInput {
  usuario: string
  senha: string
  empresaId: string
}

export interface ValidacaoSupervisorResult {
  valido: boolean
  supervisorId?: string
  erro?: string
}

/**
 * Valida credenciais de supervisor.
 * Busca usuário por login na mesma empresa, verifica perfil e senha (bcrypt).
 * Mensagens de erro genéricas para não revelar qual campo está incorreto.
 */
export async function validarCredenciaisSupervisor(
  input: ValidacaoSupervisorInput
): Promise<ValidacaoSupervisorResult>
```

## Error Handling

| Cenário | HTTP Status | Resposta |
|---------|------------|----------|
| Divergência não encontrada / outra empresa | 404 | `{ message: "Divergência não encontrada" }` |
| Modo BLOQUEAR ativo | 422 | `{ message: "Produto não permite aceitação de divergência de lote/validade", bloqueio: true }` |
| Credenciais supervisor inválidas | 401 | `{ message: "Credenciais inválidas" }` |
| Perfil insuficiente | 403 | `{ message: "Perfil insuficiente para autorizar esta operação" }` |
| Limite de 20 CC-e atingido | 422 | `{ message: "Limite de CC-e por NF-e excedido (20/20)", limiteCCe: true }` |
| CC-e rejeitada pela SEFAZ | 422 | `{ message: "CC-e rejeitada: {motivo}", cceRejeitada: true }` |
| Modo inválido na configuração | 400 | `{ message: "Modo de resolução inválido" }` |

## Testing Strategy

- **Property-based tests (PBT)**: Validam as funções puras do serviço `divergencia-lote-validade.service.ts` — detecção de divergência, validação de enum, geração de texto CC-e e lógica de resolução por modo. Mínimo 100 iterações por propriedade.
- **Unit tests**: Casos específicos de edge case (limite 20 CC-e, credenciais inválidas, produto sem config).
- **Integration tests**: Fluxo completo do endpoint `/resolver-divergencia-lv` com banco de dados, validando multi-tenancy e orquestração CC-e com CceService mockado.
- **Component tests (frontend)**: DivergenciaLoteValidadePanel renderiza corretamente por modo, modal de supervisor funciona, gate de finalização bloqueia/libera conforme status.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Validação de enum de modo de resolução

*For any* string informada como modo de resolução, `isModoValido` deve retornar `true` se e somente se o valor for um dos quatro modos válidos (ACEITAR_CCE, ACEITAR_SENHA, ACEITAR_LIVRE, BLOQUEAR), e `false` para qualquer outro valor.

**Validates: Requirements 1.1, 1.2**

### Property 2: Padrão BLOQUEAR quando sem configuração

*For any* par (empresaId, produtoId) que não possua registro em ConfigConferenciaProduto, a função `obterModoResolucao` deve retornar `{ modoResolucaoLote: 'BLOQUEAR', modoResolucaoValidade: 'BLOQUEAR' }`.

**Validates: Requirements 1.3**

### Property 3: Detecção de divergência de lote

*For any* item com `exigeLote = true` e quaisquer valores (loteEsperado, loteConferido) onde `loteEsperado !== loteConferido` e ambos são não-nulos e não-vazios, `detectarDivergenciaLote` deve retornar `{ divergente: true, tipo: 'LOTE_DIVERGENTE' }` com os valores esperado e conferido preservados no resultado.

**Validates: Requirements 2.1, 2.3**

### Property 4: Detecção de divergência de validade

*For any* par de datas (validadeEsperada, validadeConferida) onde ambas são datas válidas e diferem no dia (ignorando hora), `detectarDivergenciaValidade` deve retornar `{ divergente: true, tipo: 'VALIDADE_DIVERGENTE' }` com os valores preservados.

**Validates: Requirements 2.2, 2.3**

### Property 5: ACEITAR_LIVRE resolve sem autenticação

*For any* divergência cujo produto tenha modo ACEITAR_LIVRE, chamar `resolverModo('ACEITAR_LIVRE')` deve retornar `{ permitido: true, novoStatus: 'ACEITA', requerCCe: false }`.

**Validates: Requirements 3.1**

### Property 6: Validação de perfil do supervisor

*For any* usuário com perfil diferente de SUPERVISOR e ADMIN, a validação de credenciais de supervisor deve retornar `{ valido: false }` independentemente de a senha estar correta. *For any* usuário com perfil SUPERVISOR ou ADMIN na mesma empresa e senha correta, deve retornar `{ valido: true, supervisorId }`.

**Validates: Requirements 4.2, 4.4**

### Property 7: BLOQUEAR rejeita qualquer resolução

*For any* divergência cujo produto tenha modo BLOQUEAR, chamar `resolverModo('BLOQUEAR')` deve retornar `{ permitido: false }` com mensagem informando que o produto não permite aceitação.

**Validates: Requirements 6.1**

### Property 8: Geração de texto CC-e para lote/validade

*For any* divergência do tipo LOTE_DIVERGENTE ou VALIDADE_DIVERGENTE com valores esperado e conferido não-nulos, `gerarTextoCCeLoteValidade` deve produzir uma string que contenha: o tipo da correção (lote ou validade), o valor original e o valor corrigido.

**Validates: Requirements 5.1**

### Property 9: Isolamento multi-tenancy

*For any* divergência pertencente a uma empresaId X e qualquer requisição autenticada com empresaId Y onde X ≠ Y, o endpoint de resolução deve retornar 404 sem revelar a existência do registro.

**Validates: Requirements 8.2, 8.5**

### Property 10: Gate de finalização por divergências pendentes

*For any* lista de divergências de uma nota, a finalização da conferência está habilitada se e somente se nenhuma divergência possui status PENDENTE. Se ao menos uma divergência tem status PENDENTE, a finalização está bloqueada.

**Validates: Requirements 7.4, 7.5**

### Property 11: Completude da resposta de resolução

*For any* chamada ao endpoint de resolução que retorne sucesso (2xx), a resposta deve conter: `divergenciaId`, `status` atualizado, `modo` aplicado e `mensagem` descritiva. Quando o modo for ACEITAR_CCE, deve incluir também o campo `cce` com resultado.

**Validates: Requirements 8.4**
