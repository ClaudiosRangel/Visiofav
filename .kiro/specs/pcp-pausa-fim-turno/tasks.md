# Implementation Plan — Pausa de fim de turno + contador em OP que vira o dia

## Tasks

- [x] 1. Motor puro `tempo-trabalhavel.service.ts` (`minutosDentroDoTurno`)
  - [x] 1.1 Interseção [inicio,fim] × janela do turno por dia civil (BRT -3h);
    suporta turno que cruza meia-noite; sem turno = corrido; limite 400 dias.
  - [x] 1.2 Testes vitest + fast-check (9/9): sem turno, vira a noite, exemplo
    do Caio, fim de semana, turno noturno, fora do turno, 2 properties.
  - _Requisitos: 1.1, 1.2, 1.3, 4.1_

- [x] 2. Aplicar o cálculo esperto onde influencia o controle
  - [x] 2.1 Quadro de produção: `tempoNaEtapa` e `tempoParadaMinutos` via
    `minutosDentroDoTurno`; include do centro ganhou `turnoProducao`.
  - [x] 2.2 Checkout alerta parada prolongada: `minutosParada` via
    `minutosDentroDoTurno`; select ganhou `centroProducao.turnoProducao`.
  - [x] 2.3 `get_diagnostics` limpo.
  - _Requisitos: 1.1, 3.1, 4.1, 4.2_

- [x] 3. Frente 2 — edição manual da leitura inicial do contador (backend)
  - [x] 3.1 `registrarApontamentoContador` aceita `leituraInicialManual`
    opcional (valida 0 ≤ inicial ≤ final; `resetDoDia=false`; log em
    `LogLeituraContador` com empresaId). Rota `POST /checkout/etapas/:id/apontar`
    repassa o campo. `GET /checkout/etapas/:id/contador` expõe `temLeituraAnterior`.
  - [x] 3.2 `get_diagnostics` limpo.
  - _Requisitos: 2.1, 2.2, 4.3_

- [x] 4. Verificação e commit
  - [x] 4.1 Backend: testes 9/9, `get_diagnostics` limpo.
  - [x] 4.2 Commit + push (sem schema — nenhuma migração).
  - _Requisitos: 4.1, 4.2, 4.3_

- [ ] 5. FOLLOW-UP (app VisioFab.Checkout, repo separado — fora desta sessão)
  - [ ] 5.1 Campo "Leitura inicial" editável no modal de apontar produção
    (modo CONTADOR), pré-preenchido com a sugestão (`leituraInicial` +
    `temLeituraAnterior` do GET), enviando `leituraInicialManual` quando alterado.
  - [ ] 5.2 Garantir no cadastro: centros de contador acumulativo da Wega com
    "Zera diariamente" DESMARCADO (ação de cadastro, não código).

## Notas
- Nenhuma mudança de schema (sem migração). A regra deriva do Turno do centro.
- "Ligado por padrão" = aplica a todo centro com turno; 24h = corrido (legado).
