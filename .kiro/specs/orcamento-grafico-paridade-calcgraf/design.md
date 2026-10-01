# Orçamento Gráfico — Paridade com Calcgraf — Design Técnico

## Overview

Ajustar o módulo **Orçamento Gráfico** já existente do Vizor (spec
`orcamento-grafico`, implementada) para aderir ao cálculo do desktop
Calcgraf/G-Print, de modo que o **preço de um trabalho bata** com o do sistema
atual da Carton Wega. É o Bloco 1+2 do plano (`docs/calcgraf-plano-de-acao.md`)
— OBRIGATÓRIO para a migração.

Fórmulas de referência já decompostas e validadas em
`docs/calcgraf-formulas-decompostas.md` (2 golden cases: cálculos 15181 e 15185).
Estrutura da camada 2 em `docs/calcgraf-gprint-levantamento.md` (§V2, RI-7).

**O que já existe e está correto (não reescrever):** `orcamento-grafico-calculo.service.ts`
com encaixe/imposição, papel (peso), tinta (cobertura/rendimento), máquinas
(setup+operação × custo-hora), acabamentos, e `formarPrecoVenda` já usa o
**método divisor (gross-up)** `custo / (1 − impostos − comissão − despAdm)`.

**Gaps de paridade (foco desta feature):**
1. Fórmula de preço: o Calcgraf coloca a **margem DENTRO do divisor** junto ao
   CEV — `Preço = Custo / (1 − Margem% − CEV%)` — enquanto o Vizor aplica markup
   por fora. Alinhar ao divisor único.
2. **CEV (Custos de Venda)** como grupo explícito: ICMS + Juros + Pis/Cofins +
   Comissões (some num % que entra no divisor). Hoje o Vizor tem
   impostos/comissao/despAdm soltos.
3. **Custo de Produção** decomposto como no Calcgraf: Material Direto +
   Custo de Transformação + **Serviço Externo**; menos créditos fiscais
   (Cr.IPI etc.) + encargo financeiro (C.Finan %).
4. **Serviço Externo** (terceirização) como componente de custo.
5. **Itens Fornecidos** (material do cliente — não cobra material) — NOVO.
6. **Itens Diversos** (custos avulsos no cálculo) — NOVO/validar.
7. **Contribuição Marginal** (%/$) como saída do cálculo.
8. **Tabela de Custos por Origem/Coluna** (opcional nesta fase): hoje o
   custo-hora vem de `CentroProducao.custoHora` (alimentado pelo Mapa de Custos
   RKW — Bloco 3). Manter esse vínculo; a "tabela por coluna" (variações de
   preço) fica como extensão futura, não bloqueia a paridade de preço.

Escopo: ajustes no motor de cálculo + testes golden (Bloco 2). NÃO recria o
wizard/telas já existentes (só estende onde precisar exibir CEV/CM/serviço
externo). Multi-item de orçamento e Tabela de Custos por Coluna ficam como
extensões posteriores (documentadas, fora do MVP de paridade de preço).

## Architecture

Backend Fastify + Prisma. O núcleo é o service puro
`orcamento-grafico-calculo.service.ts` (já existe) — estendido, não reescrito.
Frontend Next.js/Mantine — a tela de resultado ganha as linhas de CEV, Serviço
Externo e Contribuição Marginal.

Fluxo de custo (alinhado ao Calcgraf, ver formulas-decompostas §Golden #1/#2):

```
Material Direto (MD) = Σ (papel + tinta + matriz + mat. acabamento + itens diversos)
                       − itens fornecidos pelo cliente (não entram no custo cobrado)
Custo Transformação (CT) = Σ (impressão + acabamentos) = Σ (horas × custo-hora)
Serviço Externo (SE)  = Σ terceirizações
Custo de Produção     = MD + CT + SE
Custo Total           = Custo de Produção − créditos fiscais + encargo financeiro%
CEV%                  = ICMS + Juros + Pis/Cofins + Comissões
Preço de Venda        = Custo Total / (1 − Margem% − CEV%)      [divisor único, gross-up]
Contribuição Marginal $ = Preço − (custos variáveis)            [MD variável + CEV$]
Contribuição Marginal % = CM$ / Preço
```

## Components and Interfaces

### Backend (service puro — estende o existente)
- `formarPrecoVenda(...)` → refatorar para o **divisor único** com Margem + CEV:
  `preco = custoTotal / (1 − (margem + cev)/100)`. Manter proteção divisor ≤ 0.
- `calcularOrcamentoGrafico(...)` → acrescentar no `ParamsOrcamento`:
  `servicosExternos: Array<{ descricao; valor }>`, `itensFornecidos: boolean`
  por material (ou lista), `itensDiversos: Array<{ descricao; valor }>`,
  `creditosFiscais: number`, `encargoFinanceiroPerc: number`,
  `cev: { icms; juros; pisCofins; comissoes }` (ou manter compat e derivar).
- `ResultadoOrcamento` → acrescentar: `materialDireto`, `custoTransformacao`,
  `servicoExterno`, `custoProducao`, `custoTotal`, `cevPerc`, `cevValor`,
  `contribuicaoMarginalValor`, `contribuicaoMarginalPerc`.
- Compatibilidade: manter os campos atuais; novos campos são aditivos.

### Rotas
Sem novas rotas obrigatórias — `POST /calcular` e `POST /` já existem e passam a
retornar os campos novos. (Se necessário, aceitar os novos inputs no schema Zod.)

### Frontend
- Tela de resultado do orçamento (Step Revisão / detalhe): exibir bloco "Custo de
  Produção" (MD + CT + SE), "Custos de Venda (CEV)" e "Contribuição Marginal".

## Data Models

Sem novas tabelas obrigatórias para a paridade de preço. Campos novos podem ser
persistidos no JSON `resultadoCalculo` do `OrcamentoGrafico` (já existe como
`Json?`), sem migração de schema. Caso se decida persistir CEV/serviço externo
como colunas dedicadas, será um `ALTER TABLE ADD COLUMN IF NOT EXISTS` idempotente
em `migrate-prod.ts` (steering database-migrations) — avaliado na task, não no MVP.

Extensões documentadas (fora do MVP, não implementar agora):
- Tabela de Custos por Origem/Coluna (máquina × valor-hora × coluna × %aplicação).
- Orçamento multi-item (1 orçamento agrupa N cálculos).

## Correctness Properties

Property 1: Preço reproduz o Calcgraf — para os golden cases 15181 e 15185, o
preço calculado bate o valor do relatório dentro de tolerância ≤ 0,5% no valor
unitário. **Validates: Requirements 1, 6**

Property 2: Divisor único válido — Preço = Custo Total / (1 − (Margem+CEV)/100),
e a função rejeita (erro) quando Margem+CEV ≥ 100%. **Validates: Requirements 1**

Property 3: Composição de custo conserva — Custo de Produção = Material Direto +
Custo de Transformação + Serviço Externo (soma exata). **Validates: Requirements 2, 3**

Property 4: Itens fornecidos não entram no custo — marcar um material como
fornecido reduz o Material Direto exatamente pelo valor daquele material.
**Validates: Requirements 4**

Property 5: Contribuição Marginal coerente — 0 ≤ CM% ≤ 100 e CM$ = Preço × CM%/100;
CM cresce quando a margem cresce (monotonicidade). **Validates: Requirements 5**

Property 6: Compatibilidade — cálculos sem serviço externo / itens fornecidos /
CEV detalhado produzem o mesmo custo de produção que hoje (não regride).
**Validates: Requirements 6**

## Error Handling

- Margem + CEV ≥ 100% → erro claro (divisor ≤ 0), como já faz hoje.
- Material marcado como fornecido sem valor conhecido → tratado como 0 (não
  quebra), com aviso.
- Campos novos ausentes no input → defaults neutros (serviço externo 0, CEV
  derivado dos campos atuais, itens fornecidos vazio) — preserva comportamento.

## Testing Strategy

- **Golden tests (Bloco 2):** reproduzir os cálculos reais 15181 e 15185
  (`docs/calcgraf-formulas-decompostas.md`) como testes Vitest sobre o motor
  puro — material, transformação, custo de produção, custo total, e **preço**
  (as 3 linhas de margem de cada relatório). Tolerância ≤ 0,5% no unitário.
- **Property-based (fast-check):** P2 (divisor), P4 (itens fornecidos), P5 (CM),
  P6 (compatibilidade/não-regressão).
- Rodar a suíte existente do orçamento para garantir não-regressão
  (`orcamento-grafico-calculo.test.ts` e `.service.test.ts`).
