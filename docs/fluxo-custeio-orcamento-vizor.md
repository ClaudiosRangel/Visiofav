# Fluxo de Custeio e Orçamento Gráfico no Vizor (Carton Wega)

Este documento descreve como o custeio e o orçamento da Carton Wega funcionam
no Vizor após a migração do Calcgraf/G-Print (Blocos 1–4 do plano de ação).
É a referência de ponta a ponta: do custo fixo da empresa até o preço do
trabalho e a análise gerencial do resultado.

Fontes: `docs/calcgraf-plano-de-acao.md`, `docs/calcgraf-gprint-levantamento.md`,
specs `.kiro/specs/{orcamento-grafico,orcamento-grafico-paridade-calcgraf,
mapa-custos-rkw,analise-gerencial-rkw}`.

## Visão geral — duas camadas conectadas

No Calcgraf havia duas camadas separadas: a de custeio (Mapa de Custos RKW,
operada pela consultoria WebGraf) e a comercial (Orçamento/OP, operada pela
Wega). No Vizor elas estão integradas:

```
┌─ CAMADA 1 (custeio) ──────────────┐       ┌─ CAMADA 2 (comercial) ───────────┐
│  Mapa de Custos RKW (Bloco 3)     │       │  Orçamento Gráfico (Bloco 1/2)   │
│  calcula CUSTO/HORA por centro    │ ────▶ │  consome custo/hora, calcula o   │
│  (Apurado / A Praticar)           │ alim. │  PREÇO do trabalho + Margem/CM   │
└───────────────────────────────────┘       └───────────────────────────────────┘
                 │                                         │
                 └───────────────┬──────────────────────────┘
                                 ▼
                    ANÁLISE GERENCIAL RKW (Bloco 4)
         custo fixo × contribuição marginal × ponto de equilíbrio
         × cobertura × resultado × pós-cálculo × confronto DRE
```

## Passo 1 — Mapa de Custos RKW (PCP → Mapa de Custos)

A base do custeio. Uma "foto" por competência (mês/ano).

Cadastros do mapa:
- **Centros de custo**: PRODUTIVO (vende horas), AUXILIAR (apoio, rateado) e
  ADMINISTRACAO (rateado). Produtivos têm horas = unidades × base + extras.
- **Bens a depreciar**: valor, estado, anos de vida útil, residual% →
  depreciação mensal por centro.
- **Funcionários por centro**: salário + ajuda de custo; encargos aplicados por
  percentual (Wega = 60%). Funcionários rateados distribuídos por chave.
- **Despesas mensais**: cada uma com sua chave de rateio.
- **Chaves de rateio** reutilizáveis: MANUAL (pesos fixos), HEADCOUNT (nº de
  funcionários), ATIVO (valor dos bens), CENTRO (100% a um centro), FUNCIONARIO.

Ao clicar **Calcular**, o motor (puro, em Decimal):
1. Apropria salários+encargos (A), depreciações (B) e despesas (C) por centro.
2. Custo Fixo do centro D = A + B + C.
3. Rateio em 2 níveis: distribui auxiliares (E) e administração (F) sobre os
   produtivos pelas chaves.
4. Custo Fixo Final G = D + E + F.
5. **Custo/Hora Apurado = G ÷ horas produtivas**; **A Praticar = Apurado ×
   (1 + ajuste%)**.
6. Totais: custo fixo total, taxa administrativa, ativo imobilizado, depreciação.

**Aplicar ao Orçamento** grava o custo/hora "A Praticar" em
`CentroProducao.custoHora` — é isso que o orçamento consome.

> Validação: o seed `scripts/importar-calcgraf.ts --fase mapa` carrega a foto
> oficial de Agosto/2023 (relatórios RI-1..RI-6 reais) e o cálculo bate com o
> relatório: Ativo Imobilizado R$ 5.800.200 (exato), Custo Fixo Total 99,1% do
> real, Taxa Administrativa 32,35% vs 31,7%.

## Passo 2 — Orçamento Gráfico (Orçamento Gráfico → Novo)

Transforma especificação em preço.

1. O vendedor escolhe o **Tipo de Embalagem**, informa medidas, papel, cores,
   acabamentos e quantidade.
2. O motor calcula: planificação (fórmulas do tipo) → encaixe/imposição →
   consumo de papel (geometria × gramatura × folhas) → tinta (cobertura ×
   rendimento) → **máquinas (setup + operação) × custo/hora** → acabamentos →
   formação de preço (markup gross-up + impostos + comissão + despesas adm).
3. Saída com decomposição paridade Calcgraf: Material Direto, Custo de
   Transformação, Serviço Externo, Custo de Produção, CEV e **Contribuição
   Marginal** (valor e %).

> Os **tipos de embalagem** da Wega foram importados do Calcgraf
> (`--fase tipos-embalagem`: 12 tipos como `CG-EMB-n`). As fórmulas de
> planificação são uma base genérica (2D/3D) a calibrar na tela, pois o
> Calcgraf não exporta as fórmulas reais.

## Passo 3 — Aprovação → Pedido → OP (fluxo existente)

- Orçamento aprovado gera `PedidoVenda` → `OrdemProducao` com BOM/roteiro/etapas.
- As OPs entram no painel de **Programação**; operadores apontam produção.
- Decisão do projeto: as **OPs sempre nascem por importação de PDF** (GPrint);
  não importamos SKUs de clientes do Calcgraf — nenhum produto em produção é
  tocado pela migração.

## Passo 4 — Análise Gerencial RKW (PCP → Análise Gerencial)

Cruza as duas camadas e responde às perguntas de gestão. Tela com seletor de
período + competência.

- **Contribuição Marginal consolidada**: soma a CM dos orçamentos ganhos
  (status APROVADO) no período; CM% média ponderada pelo faturamento; taxa de
  conversão.
- **Custo Fixo**: puxado do Mapa de Custos da competência (FECHADO de
  preferência; senão o mais recente, com aviso).
- **Ponto de Equilíbrio**: faturamento necessário para cobrir o custo fixo =
  CF ÷ (CM%/100). "Indefinido" se CM% ≤ 0 (sem divisão por zero).
- **Cobertura do Custo Fixo**: quanto da CM já cobriu o CF (%) e quanto falta.
- **Resultado do Período**: CM acumulada − Custo Fixo (lucro/prejuízo gerencial).
- **Simulador**: faturamento base → cenários 80% / 100% / 120% com resultado de
  cada um.
- **Pós-Cálculo (previsto × realizado)**: vincula orçamento → OP pelo pedido e
  compara a quantidade orçada com a produzida, mostrando o desvio.
- **Confronto DRE**: resultado gerencial (CM − CF) lado a lado com o contábil
  (Σ receitas − Σ despesas por competência), com a diferença.

## Observações honestas (limites conhecidos)

1. **Custo realizado não é persistido no PCP.** O pós-cálculo compara a
   quantidade (dado real) com confiança; para valor, usa o previsto proporcional
   à quantidade produzida, com aviso explícito na tela. Um custo realizado "de
   verdade" exigiria valorizar os apontamentos (consumo real × preço + horas ×
   custo/hora) — trabalho futuro.
2. **Fórmulas dos tipos de embalagem importados são genéricas** (2D/3D) — ponto
   de calibração; conferir ao usar cada tipo num orçamento real.
3. **O custo/hora do orçamento só fica "vivo" após Calcular + Aplicar um Mapa.**
   Sem isso, o orçamento usa o custo/hora já cadastrado no centro.
4. **Dados do seed (mapa/preços/tipos) são locais.** As 8 tabelas do Mapa RKW
   são criadas em produção (vazias) pelo `migrate-prod.ts`; a importação dos
   dados em produção é uma etapa separada, com confirmação, via connection
   string Neon (nunca commitada).

## Mapa de arquivos (referência rápida)

Backend (`VisioFab.Wms.Back`):
- `prisma/schema.prisma` + `prisma/migrate-prod.ts` — 8 models/tabelas do Mapa RKW.
- `src/modules/pcp/mapa-custo/` — motor de cálculo, rotas e testes do Mapa.
- `src/modules/pcp/analise-gerencial/` — motor, rotas e testes da análise gerencial.
- `src/modules/orcamento-grafico/` — motor de orçamento (paridade Calcgraf).
- `scripts/importar-calcgraf.ts` — importador (`--fase precos|mapa|tipos-embalagem`).

Frontend (`VisioFab.Wms.Front`):
- `src/app/(interna)/pcp/mapa-custo/` — tela do Mapa de Custos.
- `src/app/(interna)/pcp/analise-gerencial/` — tela da Análise Gerencial.
- `src/components/layout/ModuleSidebar.tsx` — itens de menu do PCP.
