# Design — Pausa de fim de turno + contagem por contador em OP que vira o dia

## Decisões do usuário (confirmadas)

1. **Cálculo esperto** (sem job de cron): o tempo fora do turno é descontado no
   momento da leitura. Nenhuma infra de agendamento.
2. Motivo (quando persistir pausa explícita no futuro) = **"Fim de Turno"**.
3. Aplicar **onde influencia o controle**: quadro de produção (TV), painel do
   checkout (alerta de parada prolongada) e tempos ao vivo.
4. **Ligado por padrão**: como a regra deriva do Turno do centro, ela já vale
   automaticamente para todo centro com turno vinculado (sem flag). Centro sem
   turno (24h) = comportamento corrido (não-regressão).

## Frente 1 — Tempo trabalhável dentro do turno (cálculo esperto)

### Motor puro `src/modules/pcp/tempo-trabalhavel.service.ts`
`minutosDentroDoTurno(inicio, fim, turno | null)`:
- Sem turno → duração corrida (não-regressão).
- Com turno → soma, dia a dia (data civil Brasília -3h), a interseção de
  [inicio, fim] com a janela [horaInicio, horaFim] nos `diasSemana`. Suporta
  turno que cruza a meia-noite (janela parte em duas). Determinístico, limite de
  400 dias de varredura, nunca excede o corrido.
- Testado (vitest + fast-check) em `tempo-trabalhavel.service.test.ts`: 9/9
  (sem turno = corrido; OP que vira a noite; exemplo do Caio 16:30→07:00 = 30
  min; pula fim de semana; turno noturno; fora do turno = 0; 2 properties).

### Aplicação (onde influencia o controle)
- **Quadro de produção** (`GET /pcp/quadro-producao`, etapa-operacional.routes):
  `tempoNaEtapa` e `tempoParadaMinutos` passam por `minutosDentroDoTurno`
  (antes era `agora − início` corrido). O `include` do centro ganhou
  `turnoProducao`.
- **Checkout — alerta de parada prolongada**
  (`listarEtapasEmAlertaParadaProlongada`, checkout.service): `minutosParada`
  passa por `minutosDentroDoTurno` — a parada que cruza o fim do turno não gera
  falso alerta pela madrugada. O select ganhou `centroProducao.turnoProducao`.
- `GET /pcp/etapas/:id/apontamentos`: `tempoParadaTotal` soma os
  `tempoParadaMinutos` JÁ gravados nas paradas fechadas (não é cálculo ao vivo),
  então NÃO precisou de ajuste.

### Não-regressão / multi-tenant
- Centro sem turno: idêntico ao atual.
- Nenhuma mudança de schema; nenhum apontamento reescrito. Só o
  CÁLCULO/EXIBIÇÃO do tempo muda (mesma filosofia da Base de Contagem).
- As queries continuam filtrando `empresaId` da OP/centro real.

## Frente 2 — Contagem por contador em OP que vira o dia (problema da imagem)

Problema do Caio: OP roda hoje (contador fecha em 10.000) e continua amanhã. No
dia seguinte a inicial derivada volta a **0** (porque o centro estava com
"Zera diariamente" ligado) → a quantidade do dia = 20.000 − 0 = 20.000, somando
30.000 em vez de 20.000. E o operador não conseguia corrigir a inicial 0.

### Causa raiz e correção (abordagem A, aprovada)
Para a Wega o contador é **acumulativo contínuo** (não zera fisicamente). Logo:
1. **Manter "Zera diariamente" DESMARCADO** nesses centros → `derivarInicial`
   já usa a última leitura final como inicial do dia seguinte (10.000), e a
   quantidade do dia fica correta (20.000 − 10.000 = 10.000 → total 20.000).
   (Regra já existente no motor; é cadastro, não código.)
2. **Edição manual da leitura inicial** (checkout.service +
   checkout.routes): `POST /checkout/etapas/:id/apontar` aceita
   `leituraInicialManual` opcional. Quando presente: valida 0 ≤ inicial ≤
   final, usa-a no lugar da derivada, grava `resetDoDia=false` e registra o
   ajuste em `LogLeituraContador` (valorAnterior=derivada → valorNovo=manual)
   para auditoria. `GET /checkout/etapas/:id/contador` passou a expor
   `temLeituraAnterior` para o terminal sinalizar que a inicial é uma SUGESTÃO
   editável.
3. **Correção pelo ERP** (já existia): a tela
   `pcp/cadastros/centros/[id]/contador` permite corrigir a leitura inicial de
   qualquer leitura, com preview de quantidade e validação da cadeia (409 com
   valor esperado). Isso cobre a correção pelo supervisor.

### Frontend do terminal (VisioFab.Checkout — DENTRO do repo do backend)
O `VisioFab.Checkout` fica em `VisioFab.Wms.Back/VisioFab.Checkout/` (sem git
próprio — mesmo repositório do backend). O apontar produção em modo CONTADOR
(`src/app/etapa/[id]/apontar/page.tsx`) agora tem o campo "Leitura inicial"
EDITÁVEL, pré-preenchido com a sugestão derivada. Quando `temLeituraAnterior` é
true, exibe o aviso "Sugerida a partir da última leitura (N). Ajuste se o
contador continuou de ontem." e envia `leituraInicialManual` SÓ quando o
operador altera o valor. A validação final ≥ inicial é preservada. A correção
pelo ERP (tela de histórico) continua disponível.

## Correctness Properties (Frente 1)
- P1: sem turno == duração corrida (não-regressão). ✓ testada
- P2: 0 ≤ resultado ≤ duração corrida. ✓ testada
