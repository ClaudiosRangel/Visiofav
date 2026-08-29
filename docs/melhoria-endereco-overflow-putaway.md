# Melhoria de negócio — Endereço de Overflow (transbordo) no put-away

## Contexto

Descoberto durante a expansão da suíte de QA automatizada do fluxo WMS
(`VisioFab.Wms.Front/tests/e2e-qa`). Ao endereçar (put-away) um produto quando
**todos os endereços de armazenagem já estão ocupados**, a distribuição
inteligente retorna `alocacoes: []` e `quantidadeRestante` cheio — ou seja, o
put-away **falha silenciosamente** e a mercadoria conferida fica sem destino.

## Onde está a lacuna

`src/modules/enderecamento-inteligente/enderecamento-inteligente.routes.ts`
(rota `POST /enderecamento-inteligente/distribuir`).

A distribuição tem 3 prioridades para escolher endereço de destino:

1. **Endereço fixo** do produto (`dadosArmazenagem.enderecoFixoId`), se houver.
2. **Consolidação**: endereços que já têm `SaldoEndereco > 0` **do mesmo
   produto** (agrupa no mesmo lugar).
3. **Endereços livres**: `prisma.endereco.findMany({ where: { tipo:
   ['ARMAZENAGEM','LIVRE'], status: true, saldos: { none: { quantidade: { gt:
   0 } } } } })` — ou seja, endereço **sem NENHUM saldo de qualquer produto**.

Se as três falharem (produto sem endereço fixo, sem saldo próprio, e nenhum
endereço 100% vazio), `enderecosComCapacidade` fica vazio e o motor retorna:

```ts
return {
  alocacoes: [],
  quantidadeTotal: quantidadeMaster,
  quantidadeAlocada: 0,
  quantidadeRestante: quantidadeMaster,
  completa: false,
}
```

**Não há 4ª prioridade de "overflow / transbordo".** A mercadoria conferida
simplesmente não é endereçada.

## O que o mercado faz (nome apropriado)

O conceito ausente é o de **endereço/área de overflow** (também chamado
**transbordo**, **staging dinâmico**, **pulmão de overflow** ou **holding
area**). Em WMS maduros (SAP EWM, Manhattan, TOTVS WMS), quando não há
endereço fixo/livre compatível para o put-away, o sistema roteia a mercadoria
para uma **área de overflow provisória** (um endereço/zona marcado como
"transbordo") e gera uma tarefa de re-alocação para quando um endereço
definitivo liberar — em vez de falhar o recebimento.

## Sugestão de implementação (alto nível)

1. **Marcar endereços de overflow**: um tipo/flag no `Endereco` (ex.: `tipo =
   'OVERFLOW'` ou um booleano `permiteOverflow`) para uma zona de transbordo
   que aceita saldo de qualquer produto acima da capacidade normal.
2. **4ª prioridade na distribuição**: quando as prioridades 1–3 não cobrirem
   a quantidade, alocar o restante em endereço(s) de overflow (admitindo
   saldo temporário), retornando `alocacoes` com `areaArmazenagem: 'OVERFLOW'`.
3. **Tarefa de re-alocação**: gerar uma `OrdemServicoWms` (ou reaproveitar o
   ressuprimento) para mover do overflow para um endereço definitivo quando
   algum liberar.
4. **Alternativa mínima** (se overflow dedicado for muito): permitir que a
   prioridade 3 aceite endereços com saldo abaixo da capacidade do palete
   (hoje só aceita endereço 100% vazio) — isso já reduziria o "put-away
   travado" sem criar uma zona nova.

## Impacto observado no QA

A empresa demo tem 40 endereços de armazenagem, todos ocupados (saldo
acumulado de execuções). Sem overflow, os cenários de QA que dependem de
put-away de produto novo não conseguem endereçar e a suíte precisa tratar isso
como pré-requisito de ambiente indisponível (skip) — o que mascara a lacuna
real do produto. Com overflow implementado, o put-away nunca "trava" por falta
de endereço definitivo, e os testes rodam de forma determinística.

## Prioridade sugerida

Média-alta: hoje, em operação real, se o armazém encher, o recebimento de
mercadoria conferida fica sem destino no sistema (a mercadoria física existe,
mas não há SaldoEndereco), gerando divergência entre físico e sistema.
