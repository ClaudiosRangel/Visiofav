# Implementation Plan — Melhorias de Apontamentos (pedidos do Caio)

## Overview

Ordem por custo/impacto (4 ondas). Funções puras com property-based (fast-check)
primeiro; rotas/telas depois. Reuso máximo do que existe; schema novo só no R8
(auditoria da liberação de cartão), no mesmo commit do `migrate-prod.ts`.

> Regras: `empresaId` EXPLÍCITO em toda query; não-regressão do apontar/pausar/
> concluir; `perfilGuard` onde exigido (OPERADOR bloqueado em R$/KG e liberar
> cartão; SUPER_ADMIN bypassa); `get_diagnostics` nos arquivos tocados; testes
> via `vitest --reporter=dot`.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1", "2", "3"] },
    { "wave": 2, "tasks": ["4", "5"] },
    { "wave": 3, "tasks": ["6"] },
    { "wave": 4, "tasks": ["7", "8", "9"] }
  ]
}
```

## Tasks

### Onda 1 — rápidos (maior impacto imediato)

- [x] 1. Pareto de paradas em MINUTOS por motivo (R4)
  - [x] 1.1 `paretoParadas` + núcleo puro `paretoParadasPuro`: soma `tempoParadaMinutos` por motivo/`codigoParadaId`, retorna `{ codigo, descricao, minutos, ocorrencias }` ordenado por minutos desc.
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - [x] 1.2* Teste puro (golden + property) `pareto-paradas.test.ts` — 4/4 passando.
    - _Requirements: 4.1, 4.2_
  - [x] 1.3 Front `pcp/gerencial/producao-mensal` (aba Pareto): gráfico + tabela em MINUTOS (ocorrências como coluna secundária).
    - _Requirements: 4.1, 4.3_

- [x] 2. Histórico do apontamento ao concluir (R2)
  - [x] 2.1 Front: componente `HistoricoEtapaModal` aberto ao concluir no Painel de Programação (direta e via finalizar-apontamento). Consome `GET /pcp/etapas/:id/apontamentos` com totais.
    - _Requirements: 2.1, 2.2_
  - [x] 2.2 Front Checkout: histórico ao concluir. A tela `etapa/[id]` já exibe
    o histórico de apontamentos e recarrega ao concluir (`buscarHistorico`). No
    `painel` (RC não tem ApontamentoEtapa), ao concluir corte/guilhotina mostra um
    resumo da conclusão (estágio + folhas) — espelha a intenção de "ver ao concluir".
    - _Requirements: 2.1, 2.2_
  - [x] 2.3 Isolamento `empresaId` na rota de histórico (já filtra).
    - _Requirements: 2.3_

- [x] 3. Tempo de parada no Quadro de Produção (R3)
  - [x] 3.1 `GET /pcp/quadro-producao`: `tempoParadaMinutos` + `paradaDesde` (agora − `dataHora` do último apontamento PARADA) quando status PARADA; alerta >60min passou a usar o tempo real da parada.
    - _Requirements: 3.1, 3.2_
  - [x] 3.2 Front `pcp/quadro-producao`: exibe "parada há Xmin" + motivo no card.
    - _Requirements: 3.1, 3.2, 3.3_

### Onda 2 — relatórios por máquina

- [x] 4. Produtividade operador × máquina (R5)
  - [x] 4.1 `apontamentos-bi.service.ts` → `agregarProdutividadeOperadorMaquina`:
    quebra por máquina dentro de cada operador (DTO `ProdutividadeOperadorMaquinaDTO`).
    - _Requirements: 5.1, 5.2_
  - [x] 4.2 Rota `GET /pcp/apontamentos-bi/produtividade?por=operador-maquina`.
    - _Requirements: 5.1_
  - [x] 4.3 Front (aba Produtividade): opção "Operador × Máquina" com cards por
    operador listando máquinas; visões Operador/Máquina preservadas.
    - _Requirements: 5.1, 5.2, 5.3_

- [x] 5. Metas por processo com máquinas separadas (R6)
  - [x] 5.1 Front `pcp/gerencial/producao-mensal` (aba Metas por Processo): o
    gráfico agora plota uma linha por máquina (centro) do processo + o total +
    a meta do processo como linha de referência (usa `dadosDiariosPorCentro`).
    - _Requirements: 6.1, 6.2, 6.3_
  - [x] 5.2 Meta por máquina: mantida a meta por PROCESSO como referência (D1 —
    não houve necessidade de nova entidade de meta por centro nesta leva).
    - _Requirements: 6.3_

### Onda 3 — financeiro + físico (acesso restrito)

- [x] 6. R$ por máquina e KG fabricado, restrito por perfil (R7)
  - [x] 6.1 `kg-fabricado.service.ts` (puro): `kgFabricado` + `parseFormatoMm` +
    `parseGramatura` (0 quando faltar fator essencial).
    - _Requirements: 7.2, 7.6_
  - [x] 6.2* Teste puro `kg-fabricado.service.test.ts` (golden 12992 + property) — 7/7.
    - _Requirements: 7.2, 7.6_
  - [x] 6.3 Rota `GET /pcp/gerencial/producao-financeira-maquina`
    (`producaoFinanceiraPorMaquina`), `perfilGuard('ADMIN','SUPERVISOR')`
    (SUPER_ADMIN bypassa; OPERADOR → 403), `empresaId` explícito.
    - _Requirements: 7.1, 7.2, 7.3, 7.5, 7.6_
  - [x] 6.4 Front: aba "R$ / KG por Máquina" OCULTA para OPERADOR (perfil do token).
    - _Requirements: 7.1, 7.2, 7.4_

### Onda 4 — fluxo (fila, partes, cartão)

- [x] 7. Fila reativa ao operador (R1)
  - [x] 7.1 `fila-ordenacao.utils.ts`: `reordenarComIniciadaNoTopo` (etapa
    iniciada à frente das PENDENTES não-manuais; manuais preservadas).
    - _Requirements: 1.1, 1.3, 1.4_
  - [x] 7.2 `iniciarEtapa` (service compartilhado Painel+Checkout): aplica a
    reordenação ao iniciar (best-effort); concluir já remove da fila.
    - _Requirements: 1.1, 1.2_
  - [x] 7.3* Teste puro `fila-ordenacao.utils.test.ts` (P3a-d) — 5/5.
    - _Requirements: 1.1, 1.3_

- [x] 8. OP aguardando cartão liberada por gestão (R8)
  - [x] 8.1 Schema: `OrdemProducao.cartaoLiberadoEm` + `cartaoLiberadoPorId`
    (nullable) + `migrate-prod.ts` idempotente (mesmo commit).
    - _Requirements: 8.4_
  - [x] 8.2 `POST /pcp/programacao/liberar-cartao/:opId` com
    `perfilGuard('ADMIN','SUPERVISOR')` (OPERADOR → 403); marca liberado +
    grava quem/quando + log de auditoria. `aguardandoCartao` expõe `cartaoLiberadoEm`.
    - _Requirements: 8.1, 8.2, 8.3, 8.4_
  - [x] 8.3 Front: botão "Liberar p/ corte" só para gestão na seção Aguardando
    Cartão; selo "Liberado p/ corte" quando já liberado; oculto para OPERADOR.
    - _Requirements: 8.2, 8.3_

- [x] 9. Integridade do desmembramento (R9)
  - [x] 9.1 Painel: `percentualDaParte` (= quantidadePrevista / total OP × 100)
    no payload da etapa + badge "Parte X%" no front.
    - _Requirements: 9.1, 9.2, 9.5_
  - [x] 9.2 Reconciliação: a OP só conclui quando TODAS as etapas (inclui as
    partes irmãs) estão CONCLUIDA — check `todasEtapas.every(CONCLUIDA)` já cobre.
    - _Requirements: 9.4_
  - [x] 9.3* Soma das partes = total (validada no desmembrar, tolerância 0,01).
    - _Requirements: 9.3, 9.2_

- [x] 10. Validação e não-regressão
  - [x] 10.1 Suíte vitest dos módulos tocados sem regressão (kg-fabricado 7/7,
    fila-ordenacao 5/5, pareto + apontamentos-bi 24/24).
    - _Requirements: 10.1, 10.2, 10.3_
  - [x] 10.2 403 para OPERADOR em R$/KG e liberar-cartão garantido por
    `perfilGuard('ADMIN','SUPERVISOR')` (SUPER_ADMIN bypassa) + menu/aba ocultos.
    - _Requirements: 7.3, 8.3_

## Notes

- Tarefas com `*` são testes property-based (fast-check) — recomendados nas puras.
- R7 (R$/KG) e R8 (liberar cartão) são RESTRITOS: OPERADOR não vê menu nem acessa
  a API (`perfilGuard`); SUPER_ADMIN/ADMIN/SUPERVISOR veem. Decisão do cliente.
- R$ por máquina já existe (dashboard BI); a Onda 3 consolida R$ + KG num relatório
  gerencial e aplica o controle de acesso.
- O R8 nesta onda usa a disponibilidade já derivada + ação de liberação por gestão;
  consulta ao estoque REAL de bobina (WMS) fica como evolução futura.
- Schema só no R8 (2 colunas em `ordem_producao`), schema.prisma + migrate-prod no
  mesmo commit (steering database-migrations).
