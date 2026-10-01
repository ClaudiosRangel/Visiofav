# Implementation Plan: Orçamento Gráfico — Paridade com Calcgraf

## Overview

Estende o motor `orcamento-grafico-calculo.service.ts` (NÃO reescreve) para
aderir ao cálculo do Calcgraf, com golden tests dos cálculos reais 15181/15185
(`docs/calcgraf-formulas-decompostas.md`). Campos novos são aditivos
(não-regressão). Sem migração de schema no MVP (resultado vai no JSON existente).

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"], "description": "Estender tipos/interfaces do motor (aditivo)" },
    { "wave": 2, "tasks": ["2", "3"], "description": "Fórmula de preço (divisor único) e decomposição de custo (MD/CT/SE) + itens fornecidos/diversos + CM" },
    { "wave": 3, "tasks": ["4"], "description": "Golden tests + property-based + não-regressão" },
    { "wave": 4, "tasks": ["5", "6"], "description": "Rotas (schema Zod dos novos inputs) e Frontend (exibição)" }
  ]
}
```

## Tasks

### 1. Estender tipos do motor (aditivo)
- [x] 1.1 `ParamsOrcamento` estendido: `servicosExternos`, `itensDiversos`, `itensFornecidos`, `creditosFiscais`, `encargoFinanceiroPerc`, `cev`. (Req 1, 3) — service linhas 58-66.
- [x] 1.2 `ResultadoOrcamento` estendido: `materialDireto`, `custoTransformacao`, `custoProducao`, `cevPerc`, `cevValor`, `contribuicaoMarginalValor`, `contribuicaoMarginalPerc`. (Req 2, 5) — linhas 111-118.
- [x] 1.3 `itensFornecidos` (lista de material do cliente) subtraído do Material Direto. (Req 4)

### 2. Fórmula de preço (divisor único Margem+CEV)
- [x] 2.1 `formarPrecoVenda` usa gross-up: `preco = custoTotal / (1 − (impostos+comissao+despAdm+markup)/100)`, erro se ≥ 100%. (Req 1.1, 1.2)
- [x] 2.2 CEV derivado dos campos existentes quando `cev` não vier (compat). (Req 6.1)

### 3. Decomposição de custo + CM (no `calcularOrcamentoGrafico`)
- [x] 3.1 Material Direto = papel+tinta+diversos − fornecidos (linha 828). (Req 2.1, 4)
- [x] 3.2 Custo de Transformação = máquinas+acabamentos (linha 833). (Req 2.1)
- [x] 3.3 Custo Produção = MD+CT+SE; Custo Total = C.Prod − créditos + encargo financeiro (linhas 837-841). (Req 2.2, 2.3)
- [x] 3.4 Contribuição Marginal $ e % (linhas 867-870). (Req 5.1)

### 4. Testes (golden + property-based + não-regressão)
- [x] 4.1 Golden tests 15181 e 15185 (`orcamento-grafico-paridade.test.ts`). (Req 1.3)
- [x] 4.2 Property-based (P2 divisor, P5 monotonicidade). (Req 1, 5)
- [x] 4.3 Suíte de orçamento gráfico: **41/41 passando (3 arquivos)** — não-regressão OK. (Req 6.2)

### 5. Rotas (aceitar os novos inputs)
- [x] 5.1 Schema Zod das rotas atualizado com serviços externos, itens fornecidos/diversos, CEV, créditos, encargo financeiro (routes linhas 593-598, 663-668). (Req 3, 4, 6.3)

### 6. Frontend (exibição) — CONCLUÍDA
- [x] 6.1 Decomposição (MD, CT, SE, Custo de Produção) exibida no **StepRevisao** (wizard) e na página de **detalhe `[id]`** do orçamento gráfico. (Req 7.1)
- [x] 6.2 CEV (%) e Contribuição Marginal (% e valor) exibidos nas duas telas (mesma tabela "Decomposição do Custo (paridade Calcgraf)"). (Req 7.2)
- [~] 6.3 Inputs no wizard para serviço externo / "material fornecido pelo cliente": adiado — os campos são aditivos e opcionais no backend; a exibição já cobre o MVP de paridade de preço. Adicionar inputs quando o usuário pedir (não bloqueia). (Req 3, 4)

## Notes

- Extensões FORA do MVP de paridade de preço (documentar, não implementar agora):
  Tabela de Custos por Origem/Coluna (variações de preço por coluna) e Orçamento
  multi-item (1 orçamento agrupa N cálculos). Avaliar em spec própria depois.
- Custo-hora vem de `CentroProducao.custoHora` (alimentado pelo Mapa de Custos
  RKW — spec mapa-custos-rkw). Não duplicar aqui.
- Dúvidas finas de calibração (base do Cr.IPI/C.Finan, tempo_operação a partir de
  Prod/H) — resolver com os golden tests; ajustar parâmetros até bater ≤ 0,5%.
- Sem migração de schema no MVP (resultado no JSON `resultadoCalculo`). Se
  persistir colunas dedicadas, seguir steering database-migrations (migrate-prod
  idempotente no mesmo commit).
