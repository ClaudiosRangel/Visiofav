# Requisitos — Pausa automática de fim de turno (não contabilizar hora fora do turno)

## Introdução

Problema reportado pelo cliente (Caio, Carton Wega): quando o operador inicia
uma etapa/produção numa máquina e **vai embora no fim do turno sem pausar**, o
sistema continua **contabilizando o tempo a noite toda** (do fim do turno até
alguém reabrir/apontar no dia seguinte). Isso infla o tempo da etapa, degrada a
velocidade média, polui os indicadores (produção/parada) e distorce a
valorização por hora.

Pedido literal: *"temos que colocar uma pausa pelo fim do turno e não
contabilizar hora parada"*.

### Como o mercado resolve (pesquisa)

- **Tempo fora do turno = "não-agendado"** e é automaticamente excluído dos
  cálculos (inmation OEE, lean/OEE clássico). O tempo só conta dentro da janela
  de turno definida para o recurso.
- **Auto clock-out / shift-end stop** (Epicor MES, MachineMetrics, sistemas de
  ponto): ao chegar o fim do turno, o sistema **encerra automaticamente** o
  apontamento aberto no horário de fim de turno, em vez de deixar correndo. É a
  prática recomendada (com a ressalva de não virar muleta para o operador não
  apontar).
- **Split na fronteira de turno**: a sessão que cruza o limite é dividida; o
  tempo de cada lado fica no dia certo e o "vão" entre turnos não conta.

### Decisão de produto (a confirmar com o usuário antes de implementar)

A base do turno já existe no Vizor: `CentroProducao.turnoProducaoId →
TurnoProducao (horaInicio/horaFim/diasSemana)`. A solução proposta usa esse
turno como a janela válida de contabilização.

## Requisitos

### Requisito 1 — Não contabilizar tempo fora do turno da máquina

**User Story:** Como gestor de PCP, quero que o tempo decorrido de uma etapa em
andamento/parada **não some o período fora do turno** da máquina, para que a
duração e a velocidade média reflitam só o tempo realmente trabalhável.

#### Acceptance Criteria
1. QUANDO uma etapa está EM_ANDAMENTO/PAUSADA e o centro tem um
   `TurnoProducao` vinculado, ENTÃO o tempo decorrido exibido/contabilizado (no
   quadro de produção, painel, checkout e apontamentos) DEVE considerar apenas
   os minutos **dentro da janela do turno** (horaInicio–horaFim, diasSemana),
   descontando o período fora do turno.
2. QUANDO o centro **não** tem turno vinculado (opera 24h), ENTÃO o
   comportamento atual (tempo corrido) é preservado — não-regressão.
3. O apontamento bruto (`dataInicioReal`/`dataFimReal`/`dataHora`) **não** é
   alterado; a regra afeta apenas o CÁLCULO/EXIBIÇÃO do tempo trabalhável
   (mesma filosofia da Base de Contagem: o dado bruto é preservado).

### Requisito 2 — Pausa automática de fim de turno

**User Story:** Como operador, quando eu esqueço de pausar e o turno termina,
quero que o sistema registre automaticamente uma pausa de fim de turno, para
que a máquina não fique "produzindo/parada" a noite toda.

#### Acceptance Criteria
1. QUANDO uma etapa fica EM_ANDAMENTO após o `horaFim` do turno da máquina sem
   apontamento de conclusão/pausa, ENTÃO o sistema DEVE registrar um
   `ApontamentoEtapa` de PARADA com motivo `TROCA_TURNO` (ou motivo dedicado
   "FIM_TURNO") marcado no horário de fim do turno, encerrando a contabilização
   do dia.
2. O tempo dessa pausa de fim de turno **não** é computado como "hora parada"
   penalizante (é tempo não-agendado, R1), e NÃO dispara o alerta de "parada >
   60 min".
3. A pausa automática deve ser idempotente (não criar duplicatas para o mesmo
   dia/turno/etapa) e claramente identificável como automática
   (`fonteApontamento = 'AUTO_FIM_TURNO'` ou equivalente) para auditoria.
4. QUANDO o operador retoma no dia seguinte (iniciar), ENTÃO a etapa volta a
   EM_ANDAMENTO normalmente e o tempo volta a contar a partir do `horaInicio`.

### Requisito 3 — Configurável por empresa/centro (não impor a todos)

**User Story:** Como administrador, quero ligar/desligar a pausa automática de
fim de turno, para adequar ao modo de operação de cada chão de fábrica.

#### Acceptance Criteria
1. DEVE existir uma flag de configuração (ex.: `pcp.pausaAutomaticaFimTurno`,
   tabela `Parametro`, default a DEFINIR com o usuário) controlando o Requisito
   2. O Requisito 1 (não contar fora do turno) pode ser sempre-ligado quando há
   turno, ou também sob flag — confirmar com o usuário.
2. A regra só se aplica a centros com `TurnoProducao` vinculado.

### Requisito 4 — Não-regressão e multi-tenant

#### Acceptance Criteria
1. Centros sem turno: comportamento idêntico ao atual.
2. Toda query/gravação filtra `empresaId` explícito da OP/centro real (padrão
   do steering ATENCAO-pontos-verificar §2.1 — não confiar só no prismaScoped).
3. Os apontamentos existentes não são reescritos retroativamente sem
   confirmação.

## Pontos a confirmar com o usuário (antes do design final)

1. **Gatilho da pausa automática**: (a) job agendado que roda no fim de cada
   turno e fecha as etapas abertas, OU (b) cálculo "lazy" no momento em que o
   painel/checkout é lido (sem job), apenas descontando o tempo fora do turno
   (R1) e, se quiser persistir a pausa, criando-a na próxima interação. Qual
   preferir? (b) é mais simples e sem infra de cron; (a) é o padrão "auto
   clock-out" literal.
2. **Motivo**: usar o enum existente `TROCA_TURNO` ou criar `FIM_TURNO`
   dedicado?
3. **Escopo de aplicação**: só Checkout (onde o Caio viu), ou também
   painel de Programação + quadro de produção + apontamentos BI?
4. **Default da flag**: ligado ou desligado para a Carton Wega?
