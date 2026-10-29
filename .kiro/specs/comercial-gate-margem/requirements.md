# Requirements — Gate de Margem na Conversão (Bloco B7)

## Introdução

Na conversão do orçamento em pedido, se o desconto/margem sair da alçada do
comercial, deve abrir uma aprovação (gate) antes de virar pedido. O **backend já
está pronto** (helper puro `gate-margem.puro.ts` + `converter-orcamento.service`
busca `RegraAprovacao` tipo DESCONTO, avalia, abre `SolicitacaoAprovacao` e
retorna `MARGEM_PENDENTE`). Falta expor no **frontend**: informar o desconto na
conversão e tratar o `MARGEM_PENDENTE`.

Fonte de verdade: `docs/PROJETO-MODULO-COMERCIAL.md` (bloco B7).

## Requisitos

### Requisito 1: Informar desconto na conversão

1. QUANDO o comercial converter um orçamento ENTÃO o sistema DEVE permitir
   informar um desconto (%) opcional.
2. O desconto DEVE ser enviado ao backend (`descontoPercent`) na conversão.

### Requisito 2: Tratar o gate de margem

1. QUANDO o desconto estiver acima da alçada (`MARGEM_PENDENTE`) ENTÃO a UI DEVE
   avisar que uma solicitação de aprovação foi aberta e NÃO converter.
2. QUANDO o desconto estiver dentro da alçada ENTÃO a conversão DEVE ocorrer
   normalmente (pedido com itens).
3. Sem desconto (0) ENTÃO não há gate (não-regressão).

### Requisito 3: Não-regressão
1. O backend do gate NÃO é alterado (já pronto e testado).
