# Requirements — Cancelar Apontamento com Autorização do Gerente (Checkout)

## Introdução

O cliente (Caio Filho, Carton Wega) relatou: "Precisamos criar uma forma de
apagar um apontamento errado usando um login do gerente". No chão de fábrica, é
comum o operador registrar um apontamento de produção/perda/retrabalho com
quantidade ou tipo errados; hoje não há como desfazer isso pelo Checkout.

Esta feature permite **cancelar (estornar) um apontamento** mediante
**autorização de um supervisor/gerente** (e-mail + senha), revertendo o efeito do
apontamento nos totais da etapa, de forma **auditável** (quem cancelou, quando e
por quê).

Decisão central de design (ver design.md): **cancelamento lógico (soft) com
estorno**, NÃO exclusão física. Apagar fisicamente o `ApontamentoEtapa`
destruiria a rastreabilidade (o apontamento já incrementou
`quantidadeProduzida`/`quantidadePerda`/`quantidadeRetrabalho` da etapa). O
cancelamento marca o apontamento como cancelado, reverte o incremento e preserva
o registro para auditoria.

## Glossário

- **Apontamento**: um `ApontamentoEtapa` dos tipos que afetam contagem
  (`PRODUCAO`, `PERDA`, `RETRABALHO`). Setup/parada/retomada ficam fora do escopo
  desta feature.
- **Cancelamento**: marcação lógica do apontamento como inválido, com estorno dos
  totais da etapa e trilha de auditoria (autor + motivo + data).
- **Autorização_Do_Gerente**: validação de credenciais (e-mail + senha) de um
  usuário com perfil de supervisor/gerente, pelo mesmo fluxo já usado em
  `validarCredenciaisSupervisorTerminal` (apontamento retroativo / conclusão com
  bloqueio).

## Requirements

### Requisito 1 — Cancelar apontamento com autorização do gerente

**User Story:** Como supervisor/gerente, quero cancelar um apontamento errado
informando minhas credenciais, para corrigir a contagem sem precisar de acesso ao
ERP.

#### Acceptance Criteria

1. QUANDO o cancelamento é solicitado com `apontamentoId`, `motivo` e
   `Autorizacao_Do_Gerente` (e-mail+senha) válidos THEN o sistema SHALL marcar o
   apontamento como cancelado, gravando `canceladoPorUsuarioId`, `canceladoEm` e
   `motivoCancelamento`.
2. QUANDO as credenciais do gerente são inválidas THEN o sistema SHALL recusar o
   cancelamento (401/403) e NÃO SHALL alterar o apontamento nem a etapa.
3. O `motivo` SHALL ser obrigatório (mínimo 1 caractere).
4. O cancelamento SHALL ser isolado por `empresaId` (multi-tenant explícito); um
   apontamento de outra empresa NÃO SHALL ser cancelável por este terminal (404,
   indistinguível de "não encontrado").

### Requisito 2 — Estorno dos totais da etapa

**User Story:** Como gestor, quero que o cancelamento reverta a quantidade que o
apontamento somou, para que o total da etapa fique correto.

#### Acceptance Criteria

1. QUANDO um apontamento `PRODUCAO` é cancelado THEN o sistema SHALL decrementar
   `EtapaOrdemProducao.quantidadeProduzida` no valor que o apontamento havia
   somado.
2. QUANDO um apontamento `PERDA` é cancelado THEN o sistema SHALL decrementar
   `quantidadePerda`; QUANDO `RETRABALHO`, decrementar o total correspondente.
3. O estorno SHALL ser simétrico ao incremento original (mesmo valor), numa
   transação atômica junto da marcação de cancelado.
4. Os totais da etapa NÃO SHALL ficar negativos: se o estorno levaria a negativo
   (dado inconsistente), o sistema SHALL limitar a 0 (nunca abaixo).

### Requisito 3 — Idempotência / proteções

#### Acceptance Criteria

1. Um apontamento já cancelado NÃO SHALL ser cancelado de novo (400, mensagem
   clara); o estorno ocorre uma única vez.
2. Apontamentos de tipo `SETUP`/`PARADA`/`RETOMADA` NÃO SHALL ser alvo desta
   operação (400, fora de escopo — essas não afetam contagem).
3. Um apontamento que é ORIGEM de um apontamento retroativo pode ser cancelado;
   o cancelamento NÃO SHALL apagar o retroativo vinculado (cada um é tratado
   individualmente).

### Requisito 4 — Visibilidade no histórico

**User Story:** Como supervisor, quero ver no histórico quais apontamentos foram
cancelados e por quem, para auditar as correções.

#### Acceptance Criteria

1. O histórico de apontamentos da etapa (`listarHistoricoApontamentos`) SHALL
   incluir, por apontamento: `cancelado` (bool), `canceladoEm`,
   `canceladoPorUsuarioId` e `motivoCancelamento`.
2. Apontamentos cancelados SHALL permanecer na listagem (não somem), sinalizados
   como cancelados, para preservar a trilha de auditoria.

### Requisito 5 — Frontend do Checkout

**User Story:** Como operador/supervisor no terminal, quero cancelar um
apontamento errado direto na tela, com o gerente digitando a senha dele.

#### Acceptance Criteria

1. Na tela de histórico de apontamentos da etapa (Checkout), cada apontamento
   que afeta contagem e NÃO está cancelado SHALL oferecer a ação "Cancelar".
2. QUANDO "Cancelar" é acionado THEN o sistema SHALL pedir o motivo e as
   credenciais do gerente (e-mail + senha) antes de enviar.
3. Apontamentos cancelados SHALL ser exibidos com marcação visual (ex.: riscado/
   badge "Cancelado") e não oferecer a ação novamente.

### Requisito 6 — Não-regressão

#### Acceptance Criteria

1. A mudança de schema SHALL ser **aditiva** (colunas nullable em
   `ApontamentoEtapa`), com equivalente idempotente em `prisma/migrate-prod.ts`
   no mesmo commit.
2. O apontamento, o retroativo e a conclusão existentes NÃO SHALL mudar de
   comportamento; o cancelamento é uma operação nova e paralela.
3. Toda query nova SHALL filtrar `empresaId` explicitamente.
