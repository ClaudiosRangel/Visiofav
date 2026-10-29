# Requirements — Elo PCP + Gatilho de Faturamento (Bloco B8)

## Introdução

Quando a produção (OP) de um pedido de origem comercial conclui, o pedido deve
ficar **pronto para faturar** e o comercial deve ser notificado. O **backend já
está implementado** (`concluirEtapa` em `etapa-operacional.service.ts`): ao
concluir a última etapa da OP, se ela veio de um orçamento gráfico, marca o
`PedidoVenda` como EFETIVADO e cria `NotificacaoComercial` "pronto para faturar".
Falta garantir a visibilidade (sino de notificações) na tela de acompanhamento.

Fonte de verdade: `docs/PROJETO-MODULO-COMERCIAL.md` (bloco B8).

## Requisitos

### Requisito 1: Gatilho OP concluída → pedido pronto para faturar

1. QUANDO todas as etapas da OP concluírem E a OP vier de orçamento gráfico
   ENTÃO o pedido vinculado DEVE ir a EFETIVADO (pronto para faturar).
2. ENTÃO o sistema DEVE criar uma notificação comercial para o setor.
3. O gatilho DEVE ser best-effort (não interrompe a conclusão da etapa) e isolar
   `empresaId` da OP real.

### Requisito 2: Visibilidade da notificação

1. O comercial DEVE ver as notificações (sino) nas telas de acompanhamento
   (a-converter já tinha; o Pipeline também passa a ter).
2. O Pipeline DEVE refletir o estágio Faturamento quando o pedido está EFETIVADO.

### Requisito 3: Não-regressão
1. Backend do gatilho NÃO é alterado (já pronto). Só UI.
