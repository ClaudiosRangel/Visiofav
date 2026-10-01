# Implementation Plan: Análise Gerencial RKW (Bloco 4)

## Overview

Referências: `design.md`, `requirements.md`, `docs/calcgraf-plano-de-acao.md`
(Bloco 4), `docs/calcgraf-gprint-levantamento.md` (GAP 2). Camada de
leitura/agregação: consome `MapaCusto.custoFixoTotal` (Bloco 3) e
`OrcamentoGrafico` + CM (Bloco 1). **Sem alteração de schema** (não persiste).
Seguir steering `ATENCAO-pontos-verificar.md` (filtro empresaId explícito) e o
padrão de `select` enxuto (evitar materializar `resultadoCalculo` à toa).

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"], "description": "Motor puro de análise gerencial" },
    { "wave": 2, "tasks": ["2", "3"], "description": "Testes do motor (paralelo) e rotas backend" },
    { "wave": 3, "tasks": ["4"], "description": "Frontend do painel (depende das rotas)" },
    { "wave": 4, "tasks": ["5"], "description": "Pós-cálculo e DRE (incremental, opcional)" }
  ]
}
```

## Tasks

### 1. Motor de cálculo puro (Backend) — CONCLUÍDA
- [x] 1.1 Criado `src/modules/pcp/analise-gerencial/analise-gerencial-calculo.service.ts` com tipos I/O (`OrcamentoResumo`, `ConsolidadoCM`, `CenarioSimulacao`, `IndicadoresPeriodo`, `ResultadoCenario`), tudo em Decimal. (Req 1–3)
- [x] 1.2 `consolidarCM`: soma preço/CM dos fechados, CM% média PONDERADA pelo preço, taxa de conversão, flag `algumFallback`. `cmDoOrcamento` usa CM do resultadoCalculo ou fallback `preco − custo`. `statusGanho=['APROVADO']` + `temPedido`. (Req 1.2–1.4)
- [x] 1.3 `pontoEquilibrio`: CF ÷ (CM%/100); null se CM% ≤ 0. (Req 2.2)
- [x] 1.4 `cobertura`: % coberto + faltante (max 0) + `resultado = ΣCM − CF`. `calcularIndicadores` monta o pacote completo. (Req 2.3, 2.4)
- [x] 1.5 `simular`: por cenário → cmProjetada, cobertura, resultado. Puro/idempotente. (Req 3)

### 2. Testes do motor (golden + property-based) — CONCLUÍDA
- [x] 2.1 `analise-gerencial-calculo.test.ts` (Vitest): golden (3 orçamentos + CF; CM% média ponderada 35,71%; PE; cobertura; resultado; fallback; temPedido; simulação 80/100/120%). (Req 1, 2, 3)
- [x] 2.2 Property-based (fast-check): P1 CM% média entre min/max; P2 PE×(CM%/100)≈CF; P3 cobertura ≥ 0 + identidade resultado; P4 CM%≤0 → PE null. **23/23 passando** (vitest run, ~2,9s, `--reporter=dot`). (Req 2)

### 3. Rotas backend — CONCLUÍDA
- [x] 3.1 Criado `analise-gerencial.routes.ts` (`/api/pcp`), registrado em `server.ts`. `authenticate` + `moduloGuard('PCP')` + filtro empresaId EXPLÍCITO. get_diagnostics sem erros. (Req 6.5)
- [x] 3.2 GET `/analise-gerencial/painel`: orçamentos do período (select enxuto; CM via `extrairCM` do resultadoCalculo), `carregarCustoFixo` (FECHADO da competência; senão mais recente + aviso; senão 0 + aviso), consolidado + PE + cobertura + resultado. (Req 1, 2)
- [x] 3.3 POST `/analise-gerencial/simular`: body `{competencia?, cmPercPadrao?, cenarios[]}` → resultado por cenário. (Req 3)
- [x] 3.4 Status "ganho" CONFIRMADO no enum: `APROVADO` (+ `pedidoVendaId != null` como sinal). (design)

### 4. Frontend — Painel Gerencial (PCP → Custos) — CONCLUÍDA
- [x] 4.1 Página `/pcp/analise-gerencial/page.tsx` com seletor de competência + período (De/Até); `api` direto + useState (padrão PCP). (Req 6.1)
- [x] 4.2 Cards: CM Total, CM% Média, Custo Fixo, Ponto de Equilíbrio, Cobertura %, Resultado (teal/red por sinal), tokens Mantine (sem cor fixa). (Req 6.2, 6.4)
- [x] 4.3 Simulador: faturamento base → cenários 80/100/120% com CM% média do período → tabela de resultado. (Req 6.3)
- [x] 4.4 Avisos (Alert): CM aproximada (fallback) e mapa da competência não fechado. (Req 1.4, 2.1)
- [x] 4.5 Item "Análise Gerencial (RKW)" no ModuleSidebar do PCP (IconReportAnalytics), ao lado do Mapa de Custos. `npm run build` PASSOU (rota `/pcp/analise-gerencial` gerada, 11,3 kB). (Req 6)

### 5. Pós-cálculo e DRE (incremental) — CONCLUÍDA
- [x] 5.1 Motor: `calcularPosCalculo` (desvio de quantidade + valor previsto proporcional à produzida; `semRealizado` preservado; sem divisão por zero). Rota GET `/analise-gerencial/pos-calculo`: vincula orçamento→OP por `pedidoVendaId`, agrega produção realizada por pedido, marca "sem realizado" quando não há produção. Frontend: seção Pós-Cálculo com tabela (prevista/produzida/desvio/valor). HONESTIDADE: custo realizado NÃO é persistido no PCP — comparamos quantidade (real) e valor previsto proporcional, com aviso explícito. (Req 4)
- [x] 5.2 Motor: `confrontarDRE` (gerencial × contábil; null-safe). Helper `confrontarComDRE` na rota do painel calcula o resultado contábil (Σ receitas − Σ despesas por competência de ContaReceber/ContaPagar) e confronta; se não houver dado/módulo, retorna `contabilDisponivel=false` + aviso. Frontend: card "Confronto Gerencial × Contábil (DRE)". Testes: **29/29 passando**. `npm run build` do front PASSOU. (Req 5)

## Notes

- **Sem migração de schema**: Bloco 4 é leitura/agregação. Se um dia quisermos
  "congelar" um fechamento mensal, criar model então (fora do escopo).
- Todo cálculo em `Prisma.Decimal` (nunca number) — precisão monetária.
- Não confiar no `prismaScoped` para isolamento (vaza sob SUPER_ADMIN) — filtro
  `empresaId` explícito em toda query (steering ATENCAO §2.1).
- CM% média é PONDERADA pelo preço de venda, não média aritmética das %.
- Reusar a CM já calculada pelo motor do Bloco 1 (`resultadoCalculo`); só cair
  no fallback `preco − custo` quando faltar.
