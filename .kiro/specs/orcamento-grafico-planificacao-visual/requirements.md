# Requirements Document

Planificação visual (contorno real da caixa aberta) no encaixe do Orçamento Gráfico.

## Introduction

Hoje o encaixe gráfico desenha cada peça como um **retângulo** (bounding box da
planificação). O objetivo desta feature é desenhar o **formato real da caixa
aberta** (contorno com painéis, abas de colagem, abas de topo/fundo e línguas —
como a planificação de um cartucho) e repetir esse contorno no encaixe da folha.

Decisão de alvo (a confirmar com o usuário):
- (a) Desenho **esquemático paramétrico por família** (cartucho, caixa, cartela)
  derivado de L×A×P + abas. Para proposta comercial. Esforço médio.
- (b) **Faca técnica real** (igual ao CAD): exige gabarito/DXF por produto; o
  Calcgraf não exporta a faca. Fora do escopo até haver fonte do desenho.

O foco é VISUAL (uso em tela/proposta), não alterar o rendimento/custo — o motor
continua calculando o aproveitamento pelo bounding box (ou pelo aproveitamento
real do Calcgraf em repetições).

## Glossary

- **Planificação:** a caixa "aberta" (plano de corte) antes de dobrar/colar.
- **Gabarito:** SVG paramétrico de um tipo de caixa (contorno em função de L×A×P + abas).
- **Faca:** ferramenta de corte/vinco; o contorno técnico real do plano.
- **Bounding box:** menor retângulo que envolve a planificação (usado no encaixe atual).

## Requirements

### Requisito 1 — Gabarito de planificação por tipo de embalagem

**História:** Como orçamentista, quero ver o contorno real da caixa aberta no
orçamento, para validar o produto e usar numa proposta visualmente clara.

#### Critérios de aceitação
1. O `TipoEmbalagem` DEVE poder ter um `gabaritoPlanificacao` (identificador do
   gabarito paramétrico, ex.: CARTUCHO, CAIXA_FUNDO_AUTO, CARTELA, RETANGULO).
2. QUANDO o tipo tiver gabarito, o sistema DEVE gerar o contorno SVG a partir
   das medidas (L, A, P) e das abas (colagem/topo/fundo) do orçamento.
3. QUANDO o tipo NÃO tiver gabarito, o sistema DEVE usar o retângulo (fallback
   atual), sem erro.
4. O contorno DEVE respeitar o bounding box já usado no cálculo (as dimensões
   externas batem com `planificacao.larguraMm/alturaMm`).

### Requisito 2 — Encaixe desenhado com o contorno real

**História:** Como orçamentista, quero o encaixe da folha mostrando o contorno
real repetido, para visualizar como as peças ficam na folha.

#### Critérios de aceitação
1. O `EncaixeVisual` DEVE repetir o contorno do gabarito (quando houver) na grade
   colunas × linhas, em vez do retângulo.
2. A orientação (normal/rotacionada) DEVE girar o contorno junto.
3. O desenho DEVE continuar em tempo real conforme medidas/tiragem mudam.
4. Sem gabarito, mantém o retângulo atual.

### Requisito 3 — Não-regressão e segurança

#### Critérios de aceitação
1. O cálculo de custo/rendimento NÃO muda (feature é visual).
2. Alteração de schema (campo `gabaritoPlanificacao` no TipoEmbalagem) DEVE vir
   com migrate-prod idempotente.
3. Multi-tenant preservado (sem query nova sensível; o gabarito é derivado de
   dados do próprio orçamento).
