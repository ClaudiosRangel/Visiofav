# Design — Importador de OP do Calcgraf: Roteiro, Variações e Materiais (Fase 2)

## 1. Visão geral

A **fase 1** do importador (spec `importador-op-calcgraf`, 16/16 tasks, em
produção) traz do Calcgraf, por OP, apenas **cabeçalho + materiais básicos +
lotes/entregas**. As OPs importadas chegam ao Vizor **sem etapas** (roteiro) e
**sem variações** (0/64 na primeira sincronização real).

Esta fase 2 estende o pipeline existente — **agente desktop (reader) → payload
HTTPS → backend (ingestão)** — para trazer o **roteiro de produção completo**:

- **Etapas** (operações/máquinas) com centro de produção e tempos (setup +
  operação), gravadas como `EtapaOrdemProducao` com `centroProducaoId` resolvido.
- **Variações/planos** (ex.: TAMPA/CAIXA, frente/costa) gravadas como
  `VariacaoOrdemProducao`.
- **Materiais enriquecidos**: papel/suporte, tintas (com % de cobertura e
  Pantone) e materiais de acabamento, melhorando os `ItemOrdemProducao`.

A descoberta-chave (validada no mapeamento) é que **o roteiro NÃO está nas
tabelas `Op*`** — ele vem do **CÁLCULO** que originou a OP
(`CalculoHeader`/`CalculoAtividades`/`CalculoPlanos`/`CalculoTintas`/
`CalculoMatAcabamento`), ligado via `OpItemEstrutura.Codigo`.

### Princípios herdados da fase 1 (não negociáveis)

1. **SOMENTE LEITURA** no Calcgraf (`assertSomenteLeitura` em toda query).
2. **Queries SEQUENCIAIS** no reader (tedious = 1 request por conexão).
3. **Application Name `ExportadorMovimentos`** (passa pela logon trigger).
4. **Match por `referenciaExterna`** (número da OP) em qualquer origem — nunca
   duplica.
5. **Idempotência por hash** (`hashImportacaoOrigem`): reingestão idêntica =
   `ignorada`.
6. **Proteção de produção**: OP com apontamento/etapa em curso → mudança vira
   `AlteracaoOpPendente` (nunca sobrescreve automaticamente).
7. **Isolamento multi-tenant** por `empresaId` explícito (dono da API key).
8. **DTO espelhado**: o DTO do agente é cópia local do DTO do backend; a
   normalização de hash dos dois lados precisa casar.

### Não-objetivos (fora do escopo)

- **Cálculo de orçamento gráfico** (preço/custo) — fase separada, já calibrada.
- **Vínculo formal de `Produto`** aos itens (de-para) — mantém o best-effort
  atual (descrição + preservação de vínculo manual existente).
- **Reescrever** o painel de Programação / tela de detalhe da OP — as etapas,
  materiais, variações e entregas entram no fluxo e nas abas que **já existem**.
- **Importação de PDF** — segue coexistindo; a regra de match não a quebra.

### Resultado esperado na tela (paridade com o PDF)

O objetivo é que uma OP importada pelo agente fique **idêntica** a uma importada
por PDF nas abas da tela de detalhe da OP (confirmado pelas telas da OP 3155):

- **Aba Etapas**: `Seq | Operação | Centro | Setup (min) | Operação (min) |
  Espera (min) | Status`. Ex. (OP 3155): "Impressão - Offset Plana Heidelberg
  CD 5cores | CD - 5 cores + Verniz | 125 | 190 | 0 | PENDENTE".
- **Aba Materiais**: `Material | Quantidade | Unidade | Liberado | Consumido |
  Perda | Status`. Inclui papel/suporte (KG), tintas (escala CMYK/Pantone,
  cobertura%), vernizes, cola e materiais de acabamento. Ex. (OP 3155): "NZ
  Extra White Bobina 258 | 2555,22 | KG", "Escala (CMYK) (70%) | 11,89 | KG".
- **Aba Variações**: lista de planos/componentes (pode ser 0 em plano único).
- **Aba Entregas**: `Data Entrega | Quantidade | Pedido | Status` (já na fase 1).

### Decisões firmadas com o usuário (16/10/2026)

1. **Centro não encontrado por nome → CRIAR o `CentroProducao`** (mesma regra do
   importador de PDF): resolve por `descricao` case-insensitive (reusa); se não
   existir, cria com código sanitizado único + `tipoProcessoId` inferido do
   tipo da etapa (`I`→IMPRESSAO; acabamentos→ACABAMENTO; fallback). Toda etapa
   SEMPRE tem centro (senão fica invisível no painel — bug conhecido da OS 3133).
2. **Tintas → texto nas observações da OP** (tag estruturada, não vira
   `ItemOrdemProducao`). Papel/suporte e materiais de acabamento com quantidade
   física VIRAM `ItemOrdemProducao` (aba Materiais). As tintas aparecem na tela
   via a tag `[Cores]`/observações, como o PDF já faz.

   > Nota de paridade: nas telas da OP 3155 as tintas (escala CMYK, metálica)
   > aparecem na aba Materiais com KG. Isso vem do cálculo gráfico do PDF, não
   > do agente. Para o agente, a decisão do usuário é registrar as tintas como
   > texto (observações/tag), e deixar como `ItemOrdemProducao` apenas o que tem
   > quantidade física confiável no cálculo (papel/suporte + mat. acabamento).
   > Revisável se o usuário quiser as tintas também como item com KG.
3. **Materiais de acabamento → ENTRAM nesta fase** como `ItemOrdemProducao`
   (`CalculoMatAcabamento`), ligados à etapa de acabamento correspondente.

---

## 2. Arquitetura de alto nível

```
┌──────────────────────── Servidor da PHTech (Windows) ────────────────────────┐
│                                                                               │
│  SQL Server Calcgraf (CartonWega, :5520)                                      │
│    OpHeader ─ OpItemEstrutura ─ OpLote                                        │
│         │           │                                                         │
│         │           └──► CalculoHeader (maior Codigo = recálculo)             │
│         │                   ├─ CalculoAtividades  (ETAPAS)                     │
│         │                   ├─ CalculoPlanos      (VARIAÇÕES + papel)          │
│         │                   ├─ CalculoTintas      (tintas)                     │
│         │                   └─ CalculoMatAcabamento (mat. acabamento)          │
│         ▼                                                                      │
│  ┌─────────────────── VisioFab.AgenteCalcgraf (Electron) ─────────────────┐   │
│  │  calcgraf-reader.ts                                                     │   │
│  │   • lê OpHeader/OpItemEstrutura/OpLote  (fase 1, inalterado)            │   │
│  │   • NOVO: resolverCalculoDaOp() → CalculoHeader.Codigo (maior)          │   │
│  │   • NOVO: lerEtapas / lerVariacoes / lerTintas / lerMatAcabamento       │   │
│  │   • NOVO: resolve nomes (Atividades, CentrosProducao, Suporte, Tinta)   │   │
│  │   • monta OpOrigemDTO estendido (etapas[], variacoes[], materiais[])    │   │
│  │  ingestao-op-calcgraf.pure.ts (espelho)                                 │   │
│  │   • calcularHashOp() agora cobre etapas (tempos/centro) + variacoes     │   │
│  └───────────────────────────────┬─────────────────────────────────────────┘ │
└──────────────────────────────────┼───────────────────────────────────────────┘
                                    │ HTTPS  POST /api/pcp/ingest-op-calcgraf
                                    │ (x-agente-key)  payload { ops: OpOrigemDTO[] }
                                    ▼
┌──────────────────────────── Vizor backend (Render) ──────────────────────────┐
│  importador-calcgraf.routes.ts  → ingerirOpsCalcgraf(empresaId, ops)          │
│  ingestao-op-calcgraf.service.ts                                              │
│    processarOp → classificarIngestao (pure, inalterado)                       │
│      criada    → criarOp    → criarItens + criarEtapas* + criarVariacoes*     │
│      atualizada→ atualizarOp→ (idem, substituição total)                      │
│      pendente  → AlteracaoOpPendente (payload com etapas/variações)           │
│    * NOVO: criarEtapas resolve CentroProducao por nome + grava tempos;        │
│      criarVariacoes grava VariacaoOrdemProducao                               │
│  ingestao-op-calcgraf.pure.ts  → hash cobre etapas/variacoes                  │
└───────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼  (sem mudança de schema Prisma)
             EtapaOrdemProducao (centroProducaoId, tempoSetup, tempoOperacao)
             VariacaoOrdemProducao (codigoProduto, descricao, quantidade, cor)
             ItemOrdemProducao (tintas/papel/mat. acabamento enriquecidos)
```

### Decisão-chave: SEM mudança de schema

Todos os destinos já existem no schema Prisma:

- `EtapaOrdemProducao` tem `centroProducaoId`, `tempoSetupMinutos`,
  `tempoOperacaoCalculado`, `sequencia`, `descricao`, `status`.
- `VariacaoOrdemProducao` tem `codigoProduto`, `descricao`, `quantidade`,
  `cor`, `observacao`, `sequencia`.
- `ItemOrdemProducao` tem `descricaoProduto`, `descricaoExterna`, `quantidade`,
  `unidadeMedida`, `tipoMaterial`.

→ **Não há `schema.prisma` nem `migrate-prod.ts` nesta fase** (o steering
`database-migrations` não se aplica). Isso reduz muito o risco de produção.

> Observação: não usamos `PlanoOrdemProducao` nesta fase. Ele é populado hoje
> pelo fluxo de **importação de PDF** (planos frente/costa). Para o agente,
> `VariacaoOrdemProducao` é o destino já previsto no MVP do DTO e no service
> (campo `variacoes[]` referenciado no handoff), evitando colisão de modelos de
> dados entre as duas origens. Revisitável se o usuário quiser unificar.

---

## 3. Caminho de dados no Calcgraf (mapeamento validado)

Referência completa: `docs/calcgraf-mapeamento-roteiro-op.md`. Resumo do elo
OP → cálculo (golden case OP 3000, bateu 100%):

```
OpHeader.Numero = 3000  →  OpHeader.Codigo = 3040
OpItemEstrutura (CodOpHeader = 3040)  →  OpItemEstrutura.Codigo = 3040
CalculoHeader WHERE CodOpItemEstrutura = 3040
   → pode haver +de 1 (original + recálculo); usar o de MAIOR Codigo
```

### 3.1 Etapas — `CalculoAtividades`

`WHERE Codigo = <calc>` ordenado por `itemSeq1, itemSeq2`.

| Coluna origem | Uso no DTO |
|---|---|
| `tipo` (`I`/`A`) | metadado (Impressão/Acabamento); prefixo da descrição |
| `itemSeq1`, `itemSeq2` | `sequencia` (ordenação estável) |
| `codAtividade` → `Atividades.Nome` | parte do nome da etapa |
| `codCentroCusto` → `CentrosProducao.Nome` | `centro` (nome da máquina) |
| `quantAcertos`, `tempoPorAcerto`, `tempoPrimeiroAcerto` | `setupMin = quantAcertos*tempoPorAcerto + tempoPrimeiroAcerto` |
| `producaoHora`, `tiragem` | `operacaoMin = tiragem / producaoHora * 60` |

Nome da etapa = `"<Atividade.Nome> <CentroProducao.Nome>"`.

### 3.2 Variações/planos — `CalculoPlanos`

`WHERE Codigo = <calc>` ordenado por `Ordem`. Colunas: `codPlano, nomePlano,
codSuporte, gramatura, dimensao1, dimensao2, aproveitamento, tiragem,
quantModelos, CodItemEstoque`.

### 3.3 Materiais — tintas + papel + acabamento

- Papel: `CalculoPlanos.codSuporte` → cadastro de suporte (nome do papel).
- Tintas: `CalculoTintas WHERE Codigo=<calc>` → `codTinta`, `areaTinta` (%),
  `ComplementoNome` (Pantone).
- Mat. acabamento: `CalculoMatAcabamento WHERE Codigo=<calc>` → `CodMaterial`,
  `codAtvAcabamento`.

### 3.4 Cobertura (validada sobre 3193 OPs do backup)

- 39 OPs (~1,2%) sem cálculo (OP avulsa) → mantêm o comportamento da fase 1
  (cabeçalho + materiais, SEM etapas). **Não é erro** — caso de borda aceito.
- 0 OPs com cálculo e 0 atividades → **tem cálculo ⇒ tem etapas**.
- Cobertura do roteiro: **~98,8%**.

---

## 4. Design de baixo nível — Agente (reader)

Arquivo: `VisioFab.AgenteCalcgraf/src/calcgraf-reader/calcgraf-reader.ts`.

### 4.1 Extensão do DTO (espelho dos dois lados)

O DTO ganha campos aditivos. Os campos atuais (`etapas` com
`sequencia/centro/descricao/status`) são **estendidos** com tempos; novos
arrays `variacoes[]` e tintas/acabamento entram em `materiais`/`itens`.

```ts
// EtapaOpOrigemDTO — ESTENDIDO (campos novos aditivos, todos opcionais)
export interface EtapaOpOrigemDTO {
  sequencia?: number
  centro?: string          // nome do CentroProducao (ex.: "Roland RZU 2cores")
  descricao?: string       // "<Atividade.Nome> <CentroProducao.Nome>"
  status?: string
  // NOVOS (fase 2):
  tipo?: string            // 'I' | 'A' (impressão/acabamento)
  setupMinutos?: number    // quantAcertos*tempoPorAcerto + tempoPrimeiroAcerto
  operacaoMinutos?: number // tiragem / producaoHora * 60
}

// VariacaoOpOrigemDTO — NOVO
export interface VariacaoOpOrigemDTO {
  sequencia?: number       // CalculoPlanos.Ordem
  codigoPlano?: string     // codPlano
  nome?: string            // nomePlano (ex.: "Impressos", "TAMPA")
  quantidade?: number      // tiragem do plano
  suporte?: string         // nome do papel resolvido de codSuporte
  gramatura?: number
  dimensao?: string        // "dimensao1 x dimensao2"
  aproveitamento?: number
}

// OpOrigemDTO — ganha:
//   variacoes?: VariacaoOpOrigemDTO[]   (planos → VariacaoOrdemProducao)
//   tintasTexto?: string                (tintas resumidas → tag [Cores], decisão 2)
// `itens` passa a incluir PAPEL/suporte (KG) e MATERIAIS DE ACABAMENTO
//   (decisão 3), além dos itens básicos da fase 1. Tintas NÃO entram em `itens`.
```

**Regra do espelho**: as MESMAS interfaces/ordem de campos existem no backend
(`ingestao-op-calcgraf.pure.ts`). A normalização de hash dos dois lados precisa
produzir string idêntica (ver §6).

### 4.2 Novas funções de leitura (SEQUENCIAIS)

```ts
/** Resolve o CalculoHeader.Codigo (maior = recálculo) de uma OP. null se não houver. */
async function resolverCalculoDaOp(
  conn: ConexaoCalcgrafSomenteLeitura,
  opHeaderCodigo: number,     // OpHeader.Codigo (já lido na fase 1)
): Promise<number | null> {
  // OpItemEstrutura.Codigo = chave do cálculo; CodOpHeader = OpHeader.Codigo.
  const rows = await conn.consultar<{ CalcCodigo: number }>(`
    SELECT MAX(ch.Codigo) AS CalcCodigo
    FROM OpItemEstrutura e
    JOIN CalculoHeader ch ON ch.CodOpItemEstrutura = e.Codigo
    WHERE e.CodOpHeader = ${opHeaderCodigo}
  `)
  const c = rows[0]?.CalcCodigo
  return typeof c === 'number' && Number.isFinite(c) ? c : null
}

/** Lê as etapas (CalculoAtividades) resolvendo nome de atividade e centro. */
async function lerEtapas(
  conn: ConexaoCalcgrafSomenteLeitura,
  calc: number,
): Promise<EtapaOpOrigemDTO[]> {
  // JOIN com Atividades (nome da operação) e CentrosProducao (nome da máquina).
  const rows = await conn.consultar<AtividadeRow>(`
    SELECT a.tipo, a.itemSeq1, a.itemSeq2,
           atv.Nome AS atividadeNome,
           cp.Nome  AS centroNome,
           a.quantAcertos, a.tempoPorAcerto, a.tempoPrimeiroAcerto,
           a.producaoHora, a.tiragem
    FROM CalculoAtividades a
    LEFT JOIN Atividades      atv ON atv.Codigo = a.codAtividade
    LEFT JOIN CentrosProducao cp  ON cp.Codigo  = a.codCentroCusto
    WHERE a.Codigo = ${calc}
    ORDER BY a.itemSeq1, a.itemSeq2
  `)
  return rows.map((r, i) => montarEtapaDTO(r, i))  // função pura (testável)
}

// Analogamente: lerVariacoes (CalculoPlanos + suporte), lerTintas
// (CalculoTintas), lerMatAcabamento (CalculoMatAcabamento).
```

> **SEQUENCIAL**: nunca `Promise.all` nas consultas (tedious = 1 request por
> conexão). As novas leituras rodam uma após a outra, por OP, dentro do loop
> que já existe na fase 1.

### 4.3 Função pura de montagem (testável no agente)

Para permitir testar a aritmética de tempos sem conexão SQL, a conversão de
linha → DTO é uma função pura:

```ts
/** Setup (min) = quantAcertos*tempoPorAcerto + tempoPrimeiroAcerto. */
export function calcularSetupMin(r: {
  quantAcertos?: number; tempoPorAcerto?: number; tempoPrimeiroAcerto?: number
}): number {
  const q = num(r.quantAcertos), t = num(r.tempoPorAcerto), p = num(r.tempoPrimeiroAcerto)
  return q * t + p
}

/** Operação (min) = tiragem / producaoHora * 60. 0 quando producaoHora inválida. */
export function calcularOperacaoMin(r: { producaoHora?: number; tiragem?: number }): number {
  const ph = num(r.producaoHora), tir = num(r.tiragem)
  if (ph <= 0) return 0           // evita divisão por zero
  return (tir / ph) * 60
}

/** Nome da etapa = "<Atividade> <Centro>" (trim; cai p/ um dos dois se faltar). */
export function montarNomeEtapa(atividadeNome?: string, centroNome?: string): string
```

### 4.4 Integração no fluxo existente

No ponto onde a fase 1 monta cada `OpOrigemDTO` (após ler OpHeader/itens/lotes),
adiciona-se:

```ts
const calc = await resolverCalculoDaOp(conn, opHeaderCodigo)
if (calc !== null) {
  dto.etapas     = await lerEtapas(conn, calc)          // etapas com centro + tempos
  dto.variacoes  = await lerVariacoes(conn, calc)       // planos (CalculoPlanos)
  const papel    = await lerPapelDosPlanos(conn, calc)  // suporte → itens PAPEL (KG)
  const matAcab  = await lerMatAcabamento(conn, calc)   // itens de acabamento (decisão 3)
  const tintas   = await lerTintas(conn, calc)          // → texto (decisão 2)
  dto.itens      = mesclarMateriais(dto.itens, papel, matAcab)  // itens físicos
  dto.tintasTexto = montarTextoTintas(tintas)           // vira tag [Cores] nas observações
}
// calc === null → mantém dto da fase 1 (sem etapas) — OP avulsa, caso de borda.
```

**Decisão 2 (tintas como texto)**: as tintas (`CalculoTintas`: `codTinta`,
`areaTinta%`, `ComplementoNome` Pantone) **não viram `ItemOrdemProducao`**. São
serializadas num texto curto (ex.: "AMARELO 123C (85%), VERDE CW0138 (15%)") e
anexadas às observações da OP como tag `[Cores]`, no mesmo espírito das tags do
PDF. Campo novo no DTO: `tintasTexto?: string`.

**Decisão 3 (mat. acabamento como item)**: `CalculoMatAcabamento` (`CodMaterial`,
`codAtvAcabamento`) vira `ItemOrdemProducao` (`tipoMaterial` conforme a
descrição; `descricaoExterna` com o código externo), aparecendo na aba Materiais
junto com o papel.

---

## 5. Design de baixo nível — Backend (ingestão)

Arquivo: `src/modules/pcp/importador-calcgraf/ingestao-op-calcgraf.service.ts`.

### 5.1 `criarEtapas` — resolver OU criar centro + gravar tempos

Hoje grava só `sequencia/descricao/status PENDENTE`. Estende-se para
**resolver OU criar** o `CentroProducao` (regra idêntica ao importador de PDF —
decisão 1) e gravar os tempos. O helper de resolução/criação é extraído do PDF
para evitar divergência:

```ts
/**
 * Resolve (reusa) OU cria o CentroProducao para o nome de centro de uma etapa.
 * Espelha a regra de importacao-op.routes.ts: busca por `descricao`
 * case-insensitive (menor codigo = determinístico); senão cria com código
 * sanitizado único + tipoProcessoId inferido do tipo da etapa.
 */
async function resolverOuCriarCentro(
  tx: PrismaTx, empresaId: string, nomeCentro: string, tipoEtapa?: string,
): Promise<string> {
  const existente = await tx.centroProducao.findFirst({
    where: { empresaId, descricao: { equals: nomeCentro, mode: 'insensitive' } },
    select: { id: true }, orderBy: { codigo: 'asc' },
  })
  if (existente) return existente.id

  let codigo = nomeCentro.substring(0, 20).toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '')
  if (!codigo) codigo = `CENTRO_${Date.now() % 100000}`
  // ... garante unicidade com sufixo numérico (igual ao PDF) ...
  const tipoProcessoId = await inferirTipoProcesso(tx, empresaId, tipoEtapa) // I→IMPRESSAO; senão ACABAMENTO; fallback 1º ativo
  const novo = await tx.centroProducao.create({
    data: { empresaId, codigo, descricao: nomeCentro, tipo: 'MAQUINA', tipoProcessoId },
  })
  return novo.id
}

async function criarEtapas(tx: PrismaTx, ordemProducaoId: string, empresaId: string, dto: OpOrigemDTO) {
  const etapas = dto.etapas ?? []
  let seq = 1
  for (const etapa of etapas) {
    const nomeCentro = (etapa.centro ?? etapa.descricao ?? '').trim()
    const centroId = nomeCentro ? await resolverOuCriarCentro(tx, empresaId, nomeCentro, etapa.tipo) : null
    const criada = await tx.etapaOrdemProducao.create({
      data: {
        ordemProducaoId,
        sequencia: etapa.sequencia ?? seq,
        descricao: (etapa.descricao ?? nomeCentro || `Etapa ${seq}`).substring(0, 200),
        centroProducaoId: centroId ?? undefined,
        tempoSetupMinutos: etapa.setupMinutos ?? 0,          // → coluna "Setup (min)"
        tempoOperacaoCalculado: etapa.operacaoMinutos ?? 0,  // → coluna "Operação (min)"
        tempoEsperaMinutos: 0,                               // → coluna "Espera (min)"
        status: 'PENDENTE',
      },
    })
    // posicaoFila na fila do centro (append), igual ao PDF, para aparecer no painel.
    seq++
  }
}
```

> **Decisão 1 (firmada)**: centro não encontrado por nome → **cria** o
> `CentroProducao` (reuso da regra do PDF). O `tipoProcessoId` é obrigatório;
> inferido pelo tipo da etapa (`I`→IMPRESSAO, demais→ACABAMENTO) com fallback
> para o primeiro Tipo de Processo ativo da empresa. Garante que a etapa apareça
> no grupo certo do painel de Programação.

### 5.2 `criarVariacoes` — NOVO

```ts
async function criarVariacoes(tx: PrismaTx, ordemProducaoId: string, dto: OpOrigemDTO) {
  const variacoes = dto.variacoes ?? []
  let seq = 1
  for (const v of variacoes) {
    await tx.variacaoOrdemProducao.create({
      data: {
        ordemProducaoId,
        codigoProduto: (v.codigoPlano ?? '').substring(0, 60),
        descricao: (v.nome ?? `Plano ${seq}`).substring(0, 200),
        quantidade: v.quantidade ?? 0,
        observacao: montarObsVariacao(v),  // gramatura/dimensão/aproveitamento como texto
        sequencia: v.sequencia ?? seq,
      },
    })
    seq++
  }
}
```

### 5.3 Pontos de chamada

- `criarOp` → chama `criarEtapas(tx, op.id, empresaId, dto)` **(assinatura
  ganha `empresaId`)** + `criarVariacoes(tx, op.id, dto)`.
- `atualizarOp` → após `deleteMany` de itens/etapas, adiciona
  `variacaoOrdemProducao.deleteMany({ where: { ordemProducaoId } })` e recria
  via `criarVariacoes`. Mantém a preservação de vínculo manual por descrição.
- `aplicarAlteracaoPendente` → reusa `atualizarOp` (nada muda além do payload já
  conter etapas/variações).

### 5.4 Invariantes de isolamento (steering ATENCAO)

- `EtapaOrdemProducao` e `VariacaoOrdemProducao` **não têm `empresaId` próprio**
  — herdam da OP. As queries de leitura de `CentroProducao` filtram
  `empresaId` explícito. Os `deleteMany`/`create` são escopados pela
  `ordemProducaoId` da OP que já foi resolvida por `empresaId`.

---

## 6. Hash e idempotência (os dois lados)

Arquivo: `ingestao-op-calcgraf.pure.ts` (backend) + espelho no agente.

`normalizarOpParaHash` já cobre `etapas` (via `normalizarEtapa`) e precisa:

1. **Estender `normalizarEtapa`** para incluir os campos novos (`tipo`,
   `setupMinutos`, `operacaoMinutos`) — assim mudança de tempo/centro no
   Calcgraf é detectada como alteração.
2. **Adicionar `normalizarVariacao`** e incluir `variacoes` no objeto canônico.

```ts
function normalizarEtapa(e: EtapaOpOrigemDTO): Record<string, unknown> {
  return {
    sequencia: normalizarEscalar(e.sequencia),
    centro: normalizarEscalar(e.centro),
    descricao: normalizarEscalar(e.descricao),
    status: normalizarEscalar(e.status),
    tipo: normalizarEscalar(e.tipo),                 // NOVO
    setupMinutos: normalizarEscalar(e.setupMinutos), // NOVO
    operacaoMinutos: normalizarEscalar(e.operacaoMinutos), // NOVO
  }
}
function normalizarVariacao(v: VariacaoOpOrigemDTO): Record<string, unknown> { /* ... */ }

// canonico ganha:
//   variacoes: ordenarEstavel((dto.variacoes ?? []).map(normalizarVariacao))
//   tintasTexto: normalizarEscalar(dto.tintasTexto)   // mudança de cores altera o hash
```

> **Compatibilidade de hash**: incluir campos novos **muda o hash** de OPs já
> importadas na fase 1. Na próxima sincronização, essas OPs terão `hashSalvo ≠
> hashRecebido` e serão reclassificadas (`atualizada` se sem produção, ou
> `pendente` se com produção). Isso é **desejável** — é exatamente o mecanismo
> que faz as etapas/variações entrarem nas OPs que hoje estão sem elas. A
> `classificarIngestao` não muda; apenas o conteúdo do hash.

As Correctness Properties existentes continuam valendo (ordem-insensível,
determinístico). Adicionam-se propriedades para os campos novos (ver §7).

---

## 7. Estratégia de teste

### Backend (vitest + fast-check — padrão do projeto)

- `ingestao-op-calcgraf.pure.test.ts` (estende):
  - **P1 (ordem-insensível)**: etapas/variações embaralhadas → mesmo hash.
  - **P-novo**: mudar `setupMinutos`/`operacaoMinutos` de uma etapa → hash muda.
  - **P-novo**: adicionar/remover uma variação → hash muda.
- `ingestao-op-calcgraf.service.test.ts` (estende): golden OP 3000 (4 etapas) —
  `criarOp` grava 4 `EtapaOrdemProducao` com os tempos esperados e os centros
  resolvidos; `criarVariacoes` grava 1 variação "Impressos". Mock de Prisma no
  padrão já usado no arquivo.

### Agente (funções puras)

- Testar `calcularSetupMin`, `calcularOperacaoMin` (incl. `producaoHora = 0`),
  `montarNomeEtapa` contra o golden OP 3000.

### Validação ponta a ponta (backup local)

- Script `_tmp-*` (removido após uso) ou reaproveitar o harness de varredura:
  rodar o reader contra o backup `CalcgrafCartonWega` para OPs 3000, 3120–3138,
  conferindo nº de etapas por OP contra a varredura do mapeamento (3 a 21).

---

## 8. Riscos e decisões

| Tema | Decisão (firmada com o usuário) |
|---|---|
| Centro não encontrado por nome | **CRIAR** o `CentroProducao` (regra idêntica ao PDF: reusa por `descricao`; senão cria com `tipoProcessoId` inferido). Toda etapa sempre tem centro. |
| Tintas | **Texto** nas observações da OP (tag `[Cores]`), não viram item. |
| Mat. de acabamento | **Entram nesta fase** como `ItemOrdemProducao` (aba Materiais). |
| Papel/suporte | `ItemOrdemProducao` tipo PAPEL (aba Materiais, KG). |
| Modelo de variação | `VariacaoOrdemProducao` (previsto no MVP/handoff; destino já no service). Não usa `PlanoOrdemProducao` (esse é do PDF). |
| Mudança de hash reclassifica OPs da fase 1 | Aceito e **desejável** — é o mecanismo que injeta as etapas/variações nas OPs que hoje estão sem elas. |
| OPs sem cálculo (~1,2%) | Mantêm o comportamento da fase 1 (cabeçalho + materiais básicos, sem etapas). Caso de borda aceito. |
| Reinstalar o agente | Reempacotar + trocar no servidor (janela de RDP). |

### Paridade final esperada (aba por aba, OP do agente == OP do PDF)
- **Etapas**: preenchidas (Seq/Operação/Centro/Setup/Operação/Espera/Status).
- **Materiais**: papel (KG) + materiais de acabamento (aba Materiais com
  Liberado/Consumido/Perda/Status zerados, PENDENTE).
- **Variações**: planos quando houver (0 em plano único — como a OP 3155).
- **Entregas**: já na fase 1 (Data/Quantidade/Pedido/Status).
- **Tintas/cores**: no cabeçalho/observações via tag `[Cores]`.
