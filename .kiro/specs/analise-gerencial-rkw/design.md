# Design Document — Análise Gerencial RKW (Bloco 4)

## Visão geral

O Bloco 4 é uma camada de **leitura/agregação**. Não cria custeio nem toca o
motor de orçamento/mapa. Ele consome dois dados que já existem:

- **Custo Fixo mensal** → `MapaCusto.custoFixoTotal` (Bloco 3), por competência.
- **Contribuição Marginal por orçamento** → `OrcamentoGrafico` (Bloco 1):
  `precoVenda`, `custoTotal`, `margemReal`, e o `resultadoCalculo` (JSON) que
  contém `contribuicaoMarginalValor`/`contribuicaoMarginalPerc`.

A partir daí calcula, com um **motor puro** (Decimal, testável), os indicadores
gerenciais: CM consolidada, Ponto de Equilíbrio, cobertura do CF, simulação e
(incremental) pós-cálculo e confronto com DRE.

## Arquitetura

```
Frontend (PCP → Custos → Análise Gerencial)
      │  GET /api/pcp/analise-gerencial/painel?inicio&fim&competencia
      ▼
analise-gerencial.routes.ts  (Fastify, /api/pcp, auth + moduloGuard('PCP'),
      │                        filtro empresaId EXPLÍCITO)
      ├─ carrega orçamentos do período (select enxuto, sem JSON pesado quando dá)
      ├─ carrega MapaCusto da competência (custoFixoTotal)
      ▼
analise-gerencial-calculo.service.ts  (PURO, Decimal)
      ├─ consolidarCM(orcamentos)            → Req 1
      ├─ pontoEquilibrio(cf, cmMediaPerc)    → Req 2
      ├─ cobertura(cmAcumulada, cf)          → Req 2
      └─ simular(faturamento, cmPerc, cf)[]  → Req 3
```

Sem novos models. Nenhuma migração de schema (Bloco 4 não persiste — só lê).
Se no futuro quisermos "congelar" um fechamento gerencial mensal, aí sim
criaríamos um model — fora do escopo agora.

## Componentes

### 1. Motor puro — `analise-gerencial-calculo.service.ts`

Tipos de entrada minimalistas (o service NÃO conhece Prisma):

```ts
export interface OrcamentoResumo {
  id: string
  status: string
  precoVenda: Decimal | number
  custoTotal: Decimal | number
  cmValor?: Decimal | number | null   // do resultadoCalculo, se houver
  cmPerc?: Decimal | number | null
}

export interface ConsolidadoCM {
  totalOrcamentos: number
  fechados: number
  taxaConversao: Decimal            // fechados/total
  somaPrecoVendaFechados: Decimal
  somaCMFechados: Decimal
  cmMediaPerc: Decimal              // ponderada pelo preço de venda
  algumFallback: boolean            // true se algum orçamento usou CM aproximada
}
```

Regras:
- **Status "fechado/ganho"**: conjunto configurável, default `['APROVADO']` +
  qualquer orçamento com `pedidoVendaId` preenchido. (Confirmar os valores reais
  de status no dado — ver "Decisões em aberto".)
- **CM por orçamento**: usar `cmValor`/`cmPerc` quando presentes; senão fallback
  `precoVenda − custoTotal` e marcar `algumFallback = true` (Req 1.4).
- **CM% média ponderada** = Σ cmValor ÷ Σ precoVenda × 100 (não média aritmética
  das %; pondera pelo tamanho do pedido).
- **Ponto de Equilíbrio** = CF ÷ (cmMediaPerc/100); se `cmMediaPerc ≤ 0` →
  retorna `null`/"indefinido" (sem divisão por zero, Req 2.2).
- **Cobertura** = somaCMFechados ÷ CF (%); faltante = max(0, CF − somaCMFechados).
- **Resultado do período** = somaCMFechados − CF.
- **Simulação**: para cada cenário `{ faturamento, cmPerc }`:
  `cmProjetada = faturamento × cmPerc/100`; `resultado = cmProjetada − CF`;
  `cobertura = cmProjetada ÷ CF`.
- Tudo em `Prisma.Decimal`. Funções puras, idempotentes, sem I/O.

### 2. Rotas — `analise-gerencial.routes.ts` (prefixo `/api/pcp`)

Registrada em `server.ts` ao lado de `mapaCustoRoutes`. `authenticate` +
`moduloGuard('PCP')`. **Filtro `empresaId` explícito** em toda query (steering
ATENCAO seção 2.1 — não confiar no prismaScoped, que vaza sob SUPER_ADMIN).

| Método | Rota | Descrição |
|---|---|---|
| GET | `/analise-gerencial/painel` | Query `inicio`, `fim` (datas), `competencia?` (AAAA-MM). Retorna consolidado CM + CF + ponto de equilíbrio + cobertura + resultado. (Req 1, 2) |
| POST | `/analise-gerencial/simular` | Body `{ competencia?, cenarios: [{faturamento, cmPerc?}] }`. Retorna resultado por cenário. (Req 3) |
| GET | `/analise-gerencial/pos-calculo` | Query período. Compara previsto×realizado quando os vínculos existirem; senão retorna "sem realizado". (Req 4 — incremental) |

Carregamento do CF (Req 2.1): busca `MapaCusto` FECHADO da `competencia`
informada; se não houver, pega o mais recente (qualquer status) e seta
`avisoMapa`. Se não houver nenhum, CF = 0 + `avisoMapa` (Req 2.5).

Seleção de orçamentos: `select` enxuto (`id, status, precoVenda, custoTotal,
pedidoVendaId, criadoEm`). O `resultadoCalculo` (JSON) só é lido quando
necessário para extrair a CM — para não materializar JSON grande em listagens
amplas (mesmo princípio do steering PCP §9.1 sobre `select` vs `omit`).

### 3. Frontend — `/pcp/analise-gerencial/page.tsx`

Padrão do PCP: `api` direto + `useState` (sem hooks dedicados), Mantine 7,
tokens de tema (sem cores fixas — steering CT-e §9.2). Item no `ModuleSidebar`
do PCP: "Análise Gerencial (RKW)", ao lado de "Mapa de Custos (RKW)".

Layout:
- Seletor de período (DatePickerInput range) + competência do mapa.
- Cards: CM Total, CM% Média, Custo Fixo, Ponto de Equilíbrio, Cobertura %,
  Resultado do Período (verde/vermelho conforme sinal).
- Simulador: inputs de faturamento + cenários (80/100/120%) → tabela de resultado.
- Avisos quando CM é aproximada (fallback) ou quando o mapa da competência não
  está fechado.

## Fluxo de dados (Req 1 + 2)

```
período (inicio, fim), competência
   │
   ├─ orçamentos = prisma.orcamentoGrafico.findMany({ empresaId, criadoEm∈período })
   │        → OrcamentoResumo[] (CM do resultadoCalculo ou fallback)
   ├─ cf = mapaCusto(competência).custoFixoTotal  (ou mais recente + aviso)
   ▼
consolidarCM(orçamentos) → { somaCM, cmMediaPerc, taxaConversão, ... }
pontoEquilibrio(cf, cmMediaPerc) → valor de faturamento p/ break-even
cobertura(somaCM, cf) → % coberto + faltante
resultado = somaCM − cf
   ▼
resposta JSON única para o painel
```

## Testes (Vitest + fast-check)

Motor puro → testável sem I/O:
- **Golden**: dado 3 orçamentos com CM conhecida e um CF, conferir somaCM,
  cmMediaPerc ponderada, ponto de equilíbrio (CF ÷ CM%), cobertura e resultado.
- **Fallback**: orçamento sem CM usa `preco − custo` e marca `algumFallback`.
- **Property-based**:
  - CM% média sempre entre a menor e a maior CM% dos itens (ponderação).
  - Ponto de equilíbrio × (CM%/100) ≈ CF (inverso), quando CM% > 0.
  - Cobertura ≥ 0; resultado = somaCM − CF (identidade).
  - CM% ≤ 0 → ponto de equilíbrio indefinido (nunca divide por zero).
- Não importar nada que puxe Fastify/Prisma no teste do motor.

## Decisões em aberto (confirmar, não bloqueiam)

- **Valores reais de `status`** — CONFIRMADO: enum
  `RASCUNHO | ENVIADO | APROVADO | RECUSADO | VENCIDO`. "Ganho" = `APROVADO`
  (gera PedidoVenda; o dashboard existente já usa APROVADO como convertido).
  Motor usa `statusGanho = ['APROVADO']` (configurável).
- **Pós-cálculo (Req 4)** depende dos vínculos orçamento→pedido→OP concluída
  estarem populados. Entregar incremental: mostra o que existir, sem quebrar.
- **DRE (Req 5)** depende do módulo Contábil ter resultado por período; se não
  tiver API pronta, exibir só a coluna gerencial (menor prioridade).
