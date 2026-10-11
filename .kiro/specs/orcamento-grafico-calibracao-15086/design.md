# Design — Calibração do Orçamento Gráfico ao Calcgraf (golden 15.086)

## Overview

Calibrar o motor de orçamento do Vizor para reproduzir o Calcgraf no cálculo
15.086 (≤ 0,5% por componente), corrigir dois bugs de UI que impedem a
conferência na tela, e estudar/propor a reutilização de cálculo entre orçamentos.

Fonte de verdade dos números reais: `docs/calcgraf-golden-15086-parametros.md`
(extraído do backup SQL Server `CalcgrafCartonWega`). Golden case:
`src/modules/orcamento-grafico/calibracao/golden-15086.{fixture,test}.ts`.

Princípio-mestre: o motor puro `orcamento-grafico-calculo.service.ts` tem 148
testes congelados — toda alteração é cirúrgica e termina com não-regressão. As
mudanças de consumo (tinta/material) e tempo (impressão/acabamento) são
calibradas contra o alvo real, não "chutadas".

## Architecture

Visão em camadas: frontend (telas de item/detalhe) + motor puro de cálculo
(`orcamento-grafico-calculo.service.ts` e módulos `consumo-tinta.ts`) + seed de
produção (`scripts/importar-calcgraf.ts`) + golden tests
(`calibracao/golden-15086.*`). As fases 1-3 calibram o motor; a fase 0 corrige
UI; a fase 4 fecha golden e estuda reutilização de cálculo.

### Arquivos tocados

| Arquivo | Papel | Fase |
|---|---|---|
| `VisioFab.Wms.Front/.../orcamento-grafico/[id]/ItemWizardModal.tsx` ou StepPapel | hidratar Select de Suporte | 0 |
| `VisioFab.Wms.Front/.../orcamento-grafico/[id]/page.tsx` | corrigir render em branco | 0 |
| `orcamento-grafico-calculo.service.ts` | motor (tinta/impressão/acabamento/material) | 1,2,3 |
| `consumo-tinta.ts` | SPANKS (cobertura agregada) | 1 |
| `scripts/importar-calcgraf.ts` (fase golden-15086) | parâmetros do item/consumos | 1,2,3 |
| `calibracao/golden-15086.{fixture,test}.ts` | alvos reais + confronto ≤0,5% | 4 |
| `orcamento-grafico.routes.ts` / novo service | reutilização de cálculo | 5 |

## Fase 0 — Bugs de UI

### Select de Suporte vazio (Req 1)
Causa provável: o Select de suporte no passo Papel usa `data` carregada por
busca server-side (digitar para buscar), e ao editar um item com `suporteId` já
definido o componente não tem a opção correspondente na lista inicial, logo não
exibe o rótulo. **Correção:** ao montar o Select em modo edição, pré-carregar
(ou injetar) a opção do `suporteId` atual (`GET /orcamento-grafico/suportes?busca=`
ou um fetch por id) para que o valor selecionado tenha label. Sem efeito no
cálculo/persistência (Req 1.3).

### Tela de detalhe em branco (Req 2)
Causa provável: erro de runtime no render (campo nulo em `cores`/`planos`/
`resultadoCalculo`, ou acesso a propriedade de objeto undefined) para este
orçamento específico. **Correção:** investigar o console/erro, blindar os
acessos com null-safety (`?.`/defaults) e, se for erro de dados, tratar com
fallback. Preservar telas que já funcionam (Req 2.3).

## Fase 1 — Tinta (SPANKS, Req 3)

Alvo: Escala ~220,00 + Pantone 01 ~39,33 = **259,33**. Hoje: 689,32 (+166%).

Causa: o motor soma a cobertura por cor (80+30+30+40 = 180% agregado p/ CMYK),
inflando o consumo. O Calcgraf usa **cobertura agregada** (areaTinta=60% para a
Escala/CMYK como um todo; 5% para o Pantone).

Correção: no caminho de tinta por cobertura, tratar as cores do MESMO tipo de
tinta (Escala/CMYK) com a cobertura AGREGADA do conjunto (60%), não a soma das
coberturas individuais. Isto é: consumo da Escala = SPANKS(coefSuporte 1,5,
offset 0,5, áreaM², lados, **cobertura 0,60**, densidade a calibrar) × preço 44;
Pantone = SPANKS(..., cobertura 0,05) × 71,50 + partida. Calibrar densidade/
constante até ≤0,5% (ver `docs/calcgraf-consumo-tinta.md`). Opção de implementar
via parâmetro `coberturaAgregadaPorTipo` no input, sem quebrar o caminho legado.

## Fase 2 — Material de Acabamento (Req 4)

Alvo: Cola 154,79 + V.Primer 193,12 + V.UV 529,52 + Caixa 862,40 = **1.739,83**.
Hoje: 0,00 (motor recebe preço mas consumo = 0).

Correção: o acabamento de natureza MATERIAL_KG/MATERIAL_UN precisa de uma regra
de CONSUMO. Pelos alvos:
- Caixa Padrão (UN): 862,40/7,70 = **112 un** → consumo = ceil(tiragem /
  pecasPorCaixa) ou valor informado "112" do pré-cálculo (unidades de caixa).
- Cola Branca (KG): 154,79/29,15 = **5,31 kg** → consumo por colagem (função da
  tiragem/177mm de aba).
- Verniz Primer (KG): 193,12/17,49 = **11,04 kg** → área impressa × gramatura
  de verniz × cobertura.
- Verniz UV (KG): 529,52/57,20 = **9,26 kg** → idem verniz.

Modelar `consumoMaterialAcabamento(natureza, params)` puro, parametrizado por
área/tiragem/gramatura de verniz, calibrado contra os 4 alvos. O acabamento rico
passa a aceitar `consumoKg`/`consumoUn` informado OU calculado por fórmula.

## Fase 3 — Impressão + Acabamento/CT (Req 5, 6)

### Impressão (alvo 3.466,58; hoje 1.756,54)
3.466,58 / 550 = **6,30 h**. Acerto fixo = 5×18+30 = 120 min = 2,0 h. Operação =
4,30 h. Com producaoHora 4.233 e folhas 4.762 → 1,12 h (insuficiente). O
Calcgraf conta a operação de impressão considerando **passagens por cor** ou um
`producaoHora` efetivo menor. Investigar: operação = folhas × fator / producaoHora,
onde fator reproduz 4,30/1,12 ≈ 3,8. Hipótese forte: o `producaoHora` do
cálculo (4.233) já embute a divisão por cores — reavaliar a conta do motor.

### Acabamento/CT (alvo 2.459,92; hoje 1.484,66)
Alinhar a base de cada atividade (folhas da impressão 4.762 vs peças/tiragem
100.000). AFT70 bate com folhas; outros podem usar peças. Calibrar por atividade
até o total ≤0,5%.

## Fase 4 — Fechamento golden + reutilização de cálculo

### Golden 15.086 por componente (Req 7)
Estender `golden-15086.test.ts` para, com o seed calibrado disponível, confrontar
cada componente calculado pelo motor com o alvo real ≤0,5%. Enquanto o motor não
estiver plugado ao teste (depende de cadastros/Prisma), validar via harness de
cálculo puro com os params do 15.086 montados em memória.

### Reutilização de cálculo (Req 8)
Estudo do Calcgraf: `CalculoHeader` é a entidade de cálculo; um orçamento
referencia um cálculo. Reaproveitamento = clonar `CalculoHeader` + filhas para um
novo número, ajustando cliente/pedido/tiragem. No Vizor, o equivalente é clonar
`ItemOrcamentoGrafico` (+ planos) para um novo `OrcamentoGrafico`. Proposta:
funcionalidade "Reaproveitar cálculo" que, dado um item existente, cria um novo
orçamento/item copiando os parâmetros de cálculo e pedindo só o que muda. Decisão
de design (clonagem vs relação N:N) documentada antes de implementar.

## Components and Interfaces

- **consumo-tinta.ts** — `calcularConsumoTinta(ParamsConsumoTinta)`: SPANKS com
  cobertura agregada por tipo de tinta (novo parâmetro aditivo).
- **consumoMaterialAcabamento(natureza, params)** (novo, puro) — consumo KG/UN
  de materiais de acabamento (verniz/cola/caixa).
- **orcamento-grafico-calculo.service.ts** — pontos de cálculo de tinta,
  impressão (tempo acerto/operação) e acabamento (CT), ajustados cirurgicamente.
- **Frontend** — Select de suporte (hidratação) e página de detalhe
  (null-safety).
- **Reutilização de cálculo** — service/rota que clona `ItemOrcamentoGrafico`
  (+planos) para um novo orçamento.

## Data Models

Sem novas tabelas nas fases 0-4 de calibração (ajuste de parâmetros/consumo). A
fase 5 (reutilização de cálculo) pode exigir, no máximo, um vínculo/flag — a
decisão (clonagem vs relação N:N) é documentada antes de qualquer migração. Se
houver schema novo, segue o steering `database-migrations` (schema.prisma +
migrate-prod.ts idempotente no mesmo commit).

## Error Handling

- Frontend: null-safety nos acessos de render (fallback seguro em vez de tela
  branca); mensagens amigáveis quando faltar resultado de cálculo.
- Motor: parâmetros ausentes mantêm o comportamento legado (não quebram); novos
  parâmetros de consumo são opcionais/aditivos.

## Correctness Properties

### Property 1: Não-regressão
A suíte `orcamento-grafico` (148 testes) permanece verde em todas as fases.
**Validates: Requirements 7.3**

### Property 2: Paridade por componente
Cada componente calibrado fica ≤ 0,5% do alvo real do 15.086.
**Validates: Requirements 3.1, 4.2, 5.1, 6.1, 7.1, 7.2**

### Property 3: Aditividade
Parâmetros de calibração ausentes → resultado idêntico ao caminho legado.
**Validates: Requirements 3.3**

### Property 4: Idempotência do seed
Reaplicar o seed não duplica nem corrompe dados.
**Validates: Requirements 7.2**

## Testing Strategy

- Golden `golden-15086` confronta componente a componente ≤ 0,5%.
- Harness de cálculo puro com os params do 15.086 montados em memória.
- Property-based (fast-check) para as funções puras de consumo quando aplicável.
- Verificação por fase: `npx vitest run src/modules/orcamento-grafico
  --reporter=dot` (0 falhas) + `get_diagnostics`. Produção só após validação
  local; connection string via env, nunca commitada.
