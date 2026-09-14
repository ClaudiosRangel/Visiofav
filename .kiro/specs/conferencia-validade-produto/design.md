# Design — Conferência de validade baseada no produto (shelf life + não vencido)

## Overview

Hoje, na conferência de entrada, a **data de validade** informada pelo conferente
é validada de duas formas independentes:

1. **Shelf life** (`validarShelfLife`): a validade digitada precisa dar pelo menos
   `Produto.shelfLifeMinimo` dias a partir de hoje. Já funciona corretamente.
2. **Divergência contra a NF-e** (`item.validade`, vindo do bloco `<rastro><dVal>`
   do XML): qualquer diferença de dia entre a validade digitada e a da NF-e marca
   o item como `VALIDADE_DIVERGENTE` → segunda conferência obrigatória.

O item (2) é a fonte do problema. A validade da NF-e é **frequentemente ausente ou
incorreta** (o fornecedor nem sempre preenche `<dVal>`, ou preenche com data errada/
genérica). Comparar a validade real do produto contra esse valor não confiável gera:

- **Divergências falsas** quando a NF traz validade diferente da impressa no produto.
- **Nenhuma validação de risco real** quando a NF vem sem validade (produto vencido
  ou com validade curta passa sem bloqueio, pois só o shelf life segura — e mesmo
  o "produto vencido" não é checado explicitamente hoje).

A referência confiável de validade é **o que está impresso no produto físico**, não o
que o fornecedor declarou na nota. Este design remove a comparação validade-vs-NF-e
como gatilho de divergência e passa a validar a validade **exclusivamente** contra
duas referências objetivas:

- **Não vencido**: a validade digitada não pode ser menor ou igual à data atual.
- **Shelf life mínimo**: a validade digitada precisa dar pelo menos `shelfLifeMinimo`
  dias (regra já existente, mantida).

A validação é idêntica em **todos os canais de conferência** — conferência manual
individual, conferir-todos e conferência por código de barras (coletor/app) — e a
**conferência cega de lote** (`conferenciaLoteCega`) reforça o comportamento correto
ao ocultar a validade da NF-e da tela, forçando o conferente a ler do produto.

### Escopo

**Dentro do escopo:**
- Remover `VALIDADE_DIVERGENTE` (validade digitada × NF-e) como gatilho de segunda
  conferência na 1ª conferência (`conferir-todos`).
- Adicionar validação explícita de **produto vencido** (validade ≤ hoje) como
  bloqueio de recebimento, nos três canais de conferência.
- Manter a validação de **shelf life** como está, nos três canais.
- Ajustar a **segunda conferência** para não reavaliar validade contra a NF-e
  (lote continua como está).
- Ajustar a **persistência**: a validade que segue para o `SaldoEndereco` passa a ser
  a **validade digitada** (do produto), não mais o valor da NF-e.

**Fora do escopo (não mexer):**
- Divergência e segunda conferência de **quantidade** (tolerância, recebimento parcial).
- Divergência de **lote** contra a NF-e — permanece exatamente como hoje.
- Parser de NF-e (`nfe-xml-parser.ts`) — `item.validade` continua sendo capturado do
  XML e exibido como referência quando a conferência não é cega; só deixa de ser
  usado como critério de bloqueio.
- Fluxo FEFO de separação (consome `SaldoEndereco.validade`, que passa a ser mais
  confiável como efeito colateral positivo).

## Architecture

### Componentes afetados

```
conferencia-entrada.routes.ts        (3 canais de conferência — orquestração)
  ├── POST /conferir-item            (manual individual)
  ├── POST /conferir-por-barras/:id  (coletor/app)
  └── POST /conferir-todos/:notaId   (conferência em lote — principal)
        │
        ├── validarShelfLife()          [shelf-life.service.ts]      — mantido
        ├── verificarProdutoVencido()   [validade.service.ts]        — passa a SER USADO
        └── (REMOVIDO) comparação validade digitada × item.validade  — gatilho de divergência

segunda-conferencia.service.ts       (2ª conferência)
  └── executarSegundaConferencia()   — remove avaliação de validade vs NF-e no Gate 2
```

### Fluxo de validade após a mudança

```
Conferente lê validade do PRODUTO físico e digita
        │
        ▼
┌─────────────────────────────────────────────┐
│ Validação de validade (mesma nos 3 canais)   │
│                                              │
│ 1. Produto vencido?  validade ≤ hoje         │
│      → BLOQUEIO 'PRODUTO_VENCIDO' (422)       │
│                                              │
│ 2. Shelf life:  diasRestantes < shelfLifeMin │
│      → BLOQUEIO 'SHELF_LIFE' (422)            │
│                                              │
│ (NÃO compara mais com item.validade da NF-e) │
└─────────────────────────────────────────────┘
        │ passou
        ▼
Persiste validade DIGITADA em ItemNotaEntrada.validade
        │
        ▼  (endereçamento)
SaldoEndereco.validade = validade do produto (confiável)
        │
        ▼  (saída FEFO — mais preciso como efeito colateral)
```

### Onde `exigeLote` continua importando

A **obrigatoriedade** de informar validade continua governada por `Produto.exigeLote`
(regra 2 do `conferir-todos`): se o produto exige lote, lote **e** validade seguem
obrigatórios. O que muda é apenas **como** a validade informada é validada — contra
produto vencido + shelf life, nunca mais contra a NF-e.

Produtos que **não** exigem lote: validade continua opcional; se informada, é validada
igualmente (vencido + shelf life). Se não informada, nada a validar.

## Components and Interfaces

### 1. `verificarProdutoVencido` — já existe, passa a ser chamado

Arquivo: `conferencia-entrada/validade.service.ts` (sem alteração de assinatura).

```ts
verificarProdutoVencido(validadeDigitada, dataAtual): BloqueioVencimento | null
// retorna { alerta: 'PRODUTO VENCIDO', ... } se validadeDigitada < dataAtual (só data, ignora hora)
```

Decisão de borda — **"menor ou igual à data atual"** (requisito do usuário): a função
hoje bloqueia apenas `< hoje` (vence hoje ainda passa). O usuário pediu explicitamente
**≤ hoje** (vence hoje também bloqueia). Ajustar o comparador:

```ts
// de:
if (validadeNorm.getTime() < atualNorm.getTime())
// para:
if (validadeNorm.getTime() <= atualNorm.getTime())
```

> Ponto de confirmação para a fase de requisitos: bloquear no dia do vencimento
> (`<=`) vs só depois de vencido (`<`). O texto do usuário diz "menor ou igual",
> então o design assume `<=`.

### 2. Helper único de validação de validade (novo)

Para não triplicar a lógica nos 3 canais, criar uma função pura que encapsula a
ordem "vencido primeiro, depois shelf life":

Arquivo novo: `conferencia-entrada/validar-validade-produto.service.ts`

```ts
export interface ValidacaoValidadeInput {
  validadeDigitada: Date | null
  shelfLifeMinimo: number | null
  dataAtual: Date
  produtoNome: string
}

export type ValidacaoValidadeResult =
  | { aprovado: true }
  | { aprovado: false; bloqueio: 'PRODUTO_VENCIDO'; mensagem: string }
  | { aprovado: false; bloqueio: 'SHELF_LIFE'; mensagem: string; diasRestantes: number; dataMinima: string }

export function validarValidadeProduto(input: ValidacaoValidadeInput): ValidacaoValidadeResult {
  // validade ausente → nada a validar (obrigatoriedade é responsabilidade de exigeLote)
  if (!input.validadeDigitada) return { aprovado: true }

  // 1. Vencido (≤ hoje) tem prioridade — mensagem mais clara que shelf life negativo
  const vencido = verificarProdutoVencido(input.validadeDigitada, input.dataAtual)
  if (vencido) {
    return { aprovado: false, bloqueio: 'PRODUTO_VENCIDO',
      mensagem: `Produto "${input.produtoNome}" está vencido (validade ${fmt(input.validadeDigitada)}).` }
  }

  // 2. Shelf life mínimo (reusa a função existente)
  const sl = validarShelfLife({
    shelfLifeMinimo: input.shelfLifeMinimo,
    dataValidade: input.validadeDigitada,
    dataAtual: input.dataAtual,
    produtoNome: input.produtoNome,
  })
  if (!sl.aprovado) {
    return { aprovado: false, bloqueio: 'SHELF_LIFE',
      mensagem: sl.mensagem!, diasRestantes: sl.diasRestantes!, dataMinima: sl.dataMinima! }
  }

  return { aprovado: true }
}
```

Vantagem: os 3 canais chamam a mesma função → comportamento garantidamente idêntico
entre conferência manual e coletor (requisito explícito do usuário). Testável por
propriedade isoladamente.

### 3. `conferir-todos` — remover divergência de validade vs NF-e

Arquivo: `conferencia-entrada.routes.ts`, bloco ~linha 678-690.

**Remover** o trecho que compara `validadeConferidaDate` × `validadeNfDate` e faz
`tiposDivergentes.push('VALIDADE_DIVERGENTE')`. O bloco de **lote** permanece intacto.

**Substituir** o `validarShelfLife` inline (~linha 596-618) pela chamada ao helper
`validarValidadeProduto`, que agora cobre vencido + shelf life. Falha → adiciona a
`falhasShelfLife` (renomear conceito para "falhasValidade" no retorno, mantendo
compatibilidade — ver seção de contrato de API).

**Persistência** (~linha 709-716): trocar a preferência pela NF-e pela validade
digitada:

```ts
// de:
validade: item.validade ?? (conferido.validade ? parseDateBR(conferido.validade) : null),
// para:
validade: conferido.validade ? parseDateBR(conferido.validade) : item.validade,
```

O mesmo ajuste de preferência vale para `lote`? **Não** — lote continua comparado
contra a NF-e (fora do escopo). Só a validade passa a preferir o digitado.

### 4. `conferir-item` e `conferir-por-barras` — adicionar checagem de vencido

Ambos já chamam `validarShelfLife` e retornam 422 com `bloqueio: 'SHELF_LIFE'`.
Trocar essa chamada pelo helper `validarValidadeProduto` e mapear o retorno:

```ts
const r = validarValidadeProduto({ validadeDigitada: parseDateBR(body.validade), shelfLifeMinimo, dataAtual: new Date(), produtoNome })
if (!r.aprovado) {
  return reply.status(422).send({ message: r.mensagem, bloqueio: r.bloqueio,
    ...(r.bloqueio === 'SHELF_LIFE' ? { diasRestantes: r.diasRestantes, dataMinima: r.dataMinima } : {}) })
}
```

Persistência desses dois canais (`data: { validade: body.validade ? parseDateBR... : item.validade }`)
já usa o valor digitado com fallback para a NF-e — **manter**, é o comportamento desejado.

### 5. `segunda-conferencia.service.ts` — não reavaliar validade vs NF-e

No `executarSegundaConferencia`, Gate 2 (lote/validade), hoje:

```ts
const validadeCoincide = mesmoDia(validadeNfe, validadeConferida)
if (loteCoincide && validadeCoincide) { /* CONFERIDO */ }
```

Como a 1ª conferência não vai mais gerar `VALIDADE_DIVERGENTE`, um item só chega à 2ª
conferência por **quantidade** ou **lote**. Ajuste:

- Remover `validadeCoincide` da condição de auto-resolução → passa a depender só de
  `loteCoincide` (quando `exigeLote`).
- `determinarTipoDivergencia` deixa de retornar `'VALIDADE'` (só `'LOTE'`).
- `registrarDivergencia` para tipo `VALIDADE_DIVERGENTE` deixa de ser acionado por
  este fluxo.

Ainda na 2ª conferência, aplicar `validarValidadeProduto` sobre a validade reinformada
(vencido + shelf life), como faz a 1ª — para não deixar um produto vencido entrar via
reconferência. Falha → mesmo tratamento de bloqueio.

### 6. Efeito em `DivergenciaConferencia` / notificação fiscal

`VALIDADE_DIVERGENTE` continua existindo como **valor de enum** no schema
(`DivergenciaConferencia.tipo`, `PendenciaCce.tipo = 'VALIDADE'`) — não removemos do
banco para não quebrar registros históricos. Apenas **deixamos de gerar novos**
registros desse tipo. `processarDivergenciasPendentes` continua tratando registros
`VALIDADE_DIVERGENTE` legados normalmente (retrocompatível).

**Abordagem recomendada: sem migration de schema** — nenhuma coluna/tabela precisa
mudar para esta feature. Caso uma evolução futura de estrutura de dados de divergência
se mostre necessária (Requirement 2.6), ela SÓ é permitida acompanhada de migração
idempotente que preserve o processamento dos registros existentes, seguindo o processo
obrigatório de `database-migrations.md` (alterar `schema.prisma` e `migrate-prod.ts` no
mesmo commit, testar 2x local). Para o escopo atual, o checklist de migrations não tem
itens aplicáveis.

## Data Models

Nenhuma alteração de schema Prisma. Os campos envolvidos já existem e permanecem:

- `Produto.shelfLifeMinimo` (`Int?`) — dias mínimos de validade exigidos. Inalterado.
- `Produto.exigeLote` (`Boolean`) — governa a obrigatoriedade de lote+validade. Inalterado.
- `ItemNotaEntrada.validade` (`DateTime?`) — validade capturada do XML da NF-e; passa a
  ser **sobrescrita pela validade digitada** na conferência (antes preferia o valor da NF-e).
- `ItemNotaEntrada.lote` (`String?`) — inalterado (lote continua comparado vs NF-e).
- `SaldoEndereco.validade` (`DateTime?`) — recebe, no endereçamento, a validade do produto
  (mais confiável); melhora o FEFO como efeito colateral. Sem mudança estrutural.
- `DivergenciaConferencia.tipo = 'VALIDADE_DIVERGENTE'` e `PendenciaCce.tipo = 'VALIDADE'`
  — **mantidos no enum** para retrocompatibilidade de registros históricos; apenas deixam
  de receber novos registros. Sem migration.

**Checklist `database-migrations.md`: nenhum item aplicável — `schema.prisma` não muda,
`migrate-prod.ts` não muda.**

## Contrato de API (mudanças observáveis)

| Endpoint | Antes | Depois |
|---|---|---|
| `POST /conferir-item` | 422 `bloqueio: SHELF_LIFE` | + 422 `bloqueio: PRODUTO_VENCIDO` |
| `POST /conferir-por-barras/:notaId` | 422 `bloqueio: SHELF_LIFE` | + 422 `bloqueio: PRODUTO_VENCIDO` |
| `POST /conferir-todos/:notaId` | `VALIDADE_DIVERGENTE` em `itensPendentesSegundaConferencia`; `falhasShelfLife` | Sem `VALIDADE_DIVERGENTE`; validade vencida/curta entra em `falhasShelfLife` (ou novo `falhasValidade`) |
| `POST /segunda-conferencia/:notaId` | reavalia validade vs NF-e | só lote (e quantidade); valida vencido/shelf life da validade reinformada |

> Decisão de compatibilidade a confirmar em requisitos: manter o nome `falhasShelfLife`
> no JSON de resposta (o frontend já o consome) e apenas passar a incluir também as
> falhas de "produto vencido" nele, OU introduzir `falhasValidade` novo. Recomendação:
> **manter `falhasShelfLife`** para não quebrar o frontend, com a mensagem distinguindo
> vencido vs shelf life. Requer verificação do consumo no `VisioFab.Wms.Front`.

## Isolamento multi-tenant

Nenhuma query nova de leitura de outra entidade é introduzida além das já existentes
(`prisma.produto.findFirst({ where: { empresaId, codigo } })`), que já filtram por
`empresaId`. O helper `validarValidadeProduto` é função pura (sem acesso a banco) —
sem risco de vazamento. Mantém o padrão do `ATENCAO-pontos-verificar.md`.

## Correctness Properties

Propriedades formais que a implementação deve satisfazer, verificadas por
property-based testing sobre a função pura `validarValidadeProduto`.

### Property 1: Vencido nunca aprova

Para qualquer `validade ≤ dataAtual`, o resultado é `aprovado: false` com
`bloqueio: 'PRODUTO_VENCIDO'`, independentemente de `shelfLifeMinimo`.

**Validates: Requirements 1.1**

### Property 2: Shelf life curto nunca aprova (se não vencido)

Para `validade > dataAtual` porém `diasRestantes < shelfLifeMinimo`, o resultado é
`aprovado: false` com `bloqueio: 'SHELF_LIFE'`.

**Validates: Requirements 1.2**

### Property 3: Validade adequada sempre aprova

Para `validade > dataAtual` com `diasRestantes >= shelfLifeMinimo` (ou `shelfLifeMinimo`
nulo), o resultado é `aprovado: true`.

**Validates: Requirements 1.3**

### Property 4: Independência da NF-e

O resultado nunca depende de `ItemNotaEntrada.validade` — a função não recebe esse
valor, garantido pelo tipo de entrada.

**Validates: Requirements 2.1**

### Property 5: Ausência de validade não bloqueia por si só

`validade == null` retorna `aprovado: true`; a obrigatoriedade é responsabilidade
separada de `exigeLote`.

**Validates: Requirements 3.1**

## Error Handling

- **Produto vencido / shelf life insuficiente** (conferência individual e por barras):
  responder `HTTP 422` com `{ message, bloqueio: 'PRODUTO_VENCIDO' | 'SHELF_LIFE', ... }`.
  Não persiste a conferência do item.
- **Conferir-todos**: falhas de validade não interrompem o lote; o item entra em
  `falhasShelfLife` (nome mantido por compatibilidade) com mensagem distinguindo vencido
  de shelf life, e é pulado (`continue`), sem marcar CONFERIDO.
- **Data digitada inválida** (`parseDateBR` retorna `null` para string não parseável):
  tratada como validade ausente → não valida (comportamento atual preservado); se o
  produto `exigeLote`, a regra de obrigatoriedade já barra validade vazia antes.
- **Produto não encontrado no cadastro** (`codigoProduto` sem match): `shelfLifeMinimo`
  indisponível → validação de shelf life não roda (aprovado), mas o item recebe a flag
  `produtoNaoEncontrado: true` para alerta visual — comportamento atual preservado.

## Testing Strategy

Property-based (fast-check) sobre `validarValidadeProduto` — as propriedades de
correção P1–P5 acima:

1. **Vencido nunca aprova**: para qualquer `validade ≤ hoje` → `aprovado: false`,
   `bloqueio: 'PRODUTO_VENCIDO'`, independente de shelf life.
2. **Shelf life curto nunca aprova (se não vencido)**: para `validade > hoje` porém
   `diasRestantes < shelfLifeMinimo` → `aprovado: false`, `bloqueio: 'SHELF_LIFE'`.
3. **Validade folgada sempre aprova**: `validade > hoje` e `diasRestantes >= shelfLifeMinimo`
   (ou `shelfLifeMinimo` nulo) → `aprovado: true`.
4. **Independência da NF-e**: o resultado de `validarValidadeProduto` não depende de
   nenhum valor de `item.validade` — não recebe esse parâmetro (garantido por tipo).

Testes de integração das 3 rotas: vencido → 422; shelf life curto → 422/falha;
validade boa → CONFORME e persiste a validade digitada; validade da NF-e divergente
mas produto válido → **não** gera segunda conferência (regressão do bug).

Suíte QA E2E (`test_09_fluxo_recebimento_wms.py`): revisar cenários de validade para
refletir que divergência vs NF-e não bloqueia mais.

## Riscos e pontos de atenção

- **Frontend acoplado a `VALIDADE_DIVERGENTE`**: a tela de segunda conferência e a de
  resultado podem exibir/tratar esse tipo. Verificar no `VisioFab.Wms.Front` antes de
  finalizar (a remoção do gatilho não quebra o backend, mas pode deixar UI órfã).
- **Regra `<=` vs `<` no vencido**: assumido `<=` conforme pedido; confirmar em requisitos.
- **`falhasShelfLife` vs `falhasValidade`**: decisão de contrato, recomendação de manter
  o nome atual — depende de verificação do consumo no frontend.
- **Baseline de `tsc`**: ~65 erros pré-existentes conhecidos (steering). A mudança não
  deve aumentar esse número.
