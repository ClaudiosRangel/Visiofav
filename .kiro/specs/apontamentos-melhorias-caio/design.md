# Design — Melhorias de Apontamentos (pedidos do Caio)

> Base: `requirements.md` desta spec + `docs/analise-apontamentos-cliente-caio.md`
> (estado atual do código). Backend Fastify+Prisma, front Next/Mantine, app
> Checkout. Multi-tenant por `empresaId` explícito.

## Overview

Entrega as lacunas dos 9 pedidos, reusando a base existente (model
`ApontamentoEtapa`, painel/quadro, BI/gerencial). Mudanças pequenas e cirúrgicas,
agrupadas em ondas por custo/impacto. Controle de acesso por `perfilGuard`
(SUPER_ADMIN bypassa; OPERADOR bloqueado onde exigido). Nenhuma reescrita do motor
de apontamento.

Não-objetivos: trocar a base de contagem; reescrever o desmembramento; integração
nova com WMS para estoque de bobina (o Req 8 usa a disponibilidade já derivada +
ação de liberação por gestão — consulta ao estoque real fica como evolução).

## Architecture

```
Checkout (app chão) ───┐
Painel Programação ────┼─► /api/pcp/* (etapa-operacional.routes.ts)
Quadro Produção (TV) ──┘        │
                                ├─ fila-ordenacao (iniciar → topo; concluir → sai)   [R1]
                                ├─ quadro-producao (tempo da parada atual)            [R3]
                                └─ liberar OP aguardando cartão (perfilGuard gestão)  [R8]

Apontamentos BI ───► /api/pcp/apontamentos-bi/* (apontamentos-bi.service.ts)
  ├─ produtividade operador × máquina                                                [R5]
Gerencial ─────────► /api/pcp/gerencial/* (relatorio-producao.service.ts)
  ├─ pareto-paradas em MINUTOS por motivo                                            [R4]
  ├─ metas por processo com máquinas separadas                                       [R6]
  └─ R$/KG por máquina (perfilGuard ADMIN/SUPERVISOR; OPERADOR bloqueado)            [R7]

Conclusão de etapa ─► histórico (GET /pcp/etapas/:id/apontamentos) exibido no modal [R2]
```

## Components and Interfaces

### R1 — Fila reativa ao operador (`etapa-operacional.routes.ts` + `fila-ordenacao`)
- No `PATCH /pcp/etapas/:id/iniciar`: após setar `EM_ANDAMENTO`, reposicionar a
  etapa à frente das PENDENTES do centro (menor `posicaoFila` entre as não
  iniciadas; preserva `ordemManual`). Reusar `recalcularPosicoesFila` tratando
  etapas EM_ANDAMENTO como prioridade.
- `concluir` já remove a etapa da fila ativa (status sai do painel) — manter.
- Pura e testável: estender `fila-ordenacao.utils.ts` com regra "em produção
  primeiro".

### R2 — Histórico ao concluir (frontend)
- Backend já pronto: `GET /pcp/etapas/:id/apontamentos` (histórico + totais).
- Front: ao concluir no Painel e no Checkout, abrir modal "Histórico da etapa"
  consumindo o endpoint (produção/perda/parada, qtd, tempo, operador, data +
  totais). Sem mudança de API.

### R3 — Tempo de parada no Quadro (`GET /pcp/quadro-producao`)
- Hoje retorna `motivoParada` e `tempoNaEtapa` (desde início da etapa). Adicionar
  `tempoParadaMinutos` = agora − `dataHora` do último `ApontamentoEtapa` tipo
  PARADA (quando status PARADA). Front exibe o cronômetro da parada.

### R4 — Pareto em minutos (`relatorio-producao.service.ts` → `paretoParadas`)
- Trocar o acumulador: além de `ocorrencias` (contagem), somar
  `tempoParadaMinutos` por motivo/`codigoParadaId`. Retornar
  `{ codigo, descricao, minutos, ocorrencias }`, ordenado por `minutos` desc.
- Front (gráfico Pareto) passa a usar `minutos`.

### R5 — Produtividade operador × máquina (`apontamentos-bi.service.ts`)
- `agregarProdutividade` hoje agrupa por UMA dimensão. Adicionar modo
  `por='operador-maquina'` (ou retornar, quando filtrado por operador, a quebra
  por centro). Saída: por operador, lista de máquinas com quantidade por mês.
- Rota `GET /pcp/apontamentos-bi/produtividade?por=operador-maquina&operadorId=`.

### R6 — Metas por processo com máquinas separadas (`relatorio-producao.service.ts`)
- Já existe `dadosDiariosPorCentro(empresa, ano, mes, tipoProcessoId)` (matriz
  data×centro). Plugar no gráfico de metas: cada centro = série; meta do processo
  (`MetaProducaoProcesso`) como linha de referência. Opcional: meta por centro.
- Front: gráfico de metas por processo renderiza uma série por máquina.

### R7 — R$/KG por máquina, restrito por perfil (`gerencial` + novo KG)
- R$ por máquina: já existe (`apontamentos-bi` `agregarDashboard` `valorRs`).
  Consolidar num endpoint gerencial por máquina no período.
- **KG fabricado** (novo, puro): `kg = f(produção apontada, gramatura, formato)`
  do plano da etapa. Para base TIRAGEM (folhas): `kg = folhas × larguraM ×
  alturaM × gramatura / 1000`. Serviço puro `kg-fabricado.service.ts` + testes.
- **Acesso**: rota `GET /pcp/gerencial/producao-financeira-maquina` protegida por
  `perfilGuard('ADMIN','SUPERVISOR')` (SUPER_ADMIN bypassa; **OPERADOR → 403**).
  Front: item de menu e tela ocultos para OPERADOR (via perfil do token).

### R8 — OP aguardando cartão liberada por gestão (`etapa-operacional.routes.ts`)
- Hoje a retenção é derivada no painel (texto "encomendado" + liberação parcial).
- Adicionar ação explícita `POST /pcp/programacao/liberar-cartao/:opId` protegida
  por `perfilGuard('ADMIN','SUPERVISOR')` (OPERADOR → 403) que marca a OP/etapa
  como liberada para corte (flag + `liberadoPorUsuarioId`/`liberadoEm`) e insere
  na fila do centro. OPERADOR não vê a ação de liberar.
- (Evolução documentada: trocar a disponibilidade por consulta ao estoque real
  de bobina no WMS — fora do escopo desta onda.)

### R9 — Integridade do desmembramento (`etapa-operacional.routes.ts`)
- Exibição da parte (qtd/%): painel e Checkout já mostram a `quantidade` da parte
  (`quantidadePrevista`). Adicionar o **percentual** da parte sobre o total da OP
  no payload do Checkout/painel.
- Reconciliação: ao concluir uma etapa, a OP só vira `CONCLUIDA` quando TODAS as
  partes (etapas irmãs com `quantidadePrevista>0`) estiverem concluídas — reforçar
  a checagem `todasEtapas.every(CONCLUIDA)` já existente, garantindo que cobre as
  partes desmembradas.
- Soma das partes = total: já validado no desmembrar (tolerância 0,01) — manter.

## Data Models

Mínimo de schema novo (preferir reuso):
- **R8** — flag de liberação de cartão. Opção A (sem schema): usar `Parametro`/tag
  em `observacoes`. Opção B (schema): `OrdemProducao.cartaoLiberadoEm` +
  `cartaoLiberadoPorId` (Date/String nullable) via `ADD COLUMN IF NOT EXISTS` no
  `migrate-prod.ts` (mesmo commit do schema). **Decisão**: Opção B (auditável,
  Req 8.4).
- R4/R3/R5/R6/R7-R$: nenhum schema novo (dados já em `ApontamentoEtapa`/plano).
- R7-KG: nenhum schema novo (gramatura/formato vêm do `plano`/observações).

## Correctness Properties

### Property 1: Pareto soma minutos por motivo
Para qualquer conjunto de paradas no período, o total de minutos de um motivo =
soma de `tempoParadaMinutos` das paradas daquele motivo; a ordenação é por minutos
desc.
**Validates: Requirements 4.1, 4.2**

### Property 2: KG fabricado não-negativo e proporcional
`kgFabricado(folhas, larguraMm, alturaMm, gramatura)` é ≥ 0, cresce com as folhas
e é 0 quando qualquer fator essencial é 0/ausente (nunca NaN).
**Validates: Requirements 7.2, 7.6**

### Property 3: Fila — etapa iniciada vem antes das pendentes
Após iniciar uma etapa, sua `posicaoFila` é menor que a de qualquer etapa PENDENTE
não-manual do mesmo centro; posições manuais permanecem.
**Validates: Requirements 1.1, 1.3, 1.4**

### Property 4: Soma das partes = total da OP
A soma das `quantidadePrevista` das partes de um desmembramento é igual à
quantidade da OP (tolerância 0,01).
**Validates: Requirements 9.3**

### Property 5: Percentual da parte
O percentual exibido de uma parte = `quantidadePrevista / quantidadeTotalOP × 100`,
entre 0 e 100.
**Validates: Requirements 9.2**

### Property 6: Acesso negado a OPERADOR
Para qualquer requisição ao relatório R$/KG por máquina (R7) ou à liberação de
cartão (R8) com perfil OPERADOR, o resultado é negação de acesso (403).
**Validates: Requirements 7.3, 8.3**

## Error Handling

- **R7/R8 acesso OPERADOR** → HTTP 403 (`perfilGuard`), sem vazar dados.
- **R7 centro sem custo/velocidade** → R$ 0 para o centro, relatório segue (Req 7.6).
- **R7 KG sem gramatura/formato** → KG 0 para a etapa, relatório segue.
- **Cross-tenant** → 403/404 (padrão), nunca retorna dado de outra empresa.
- Validações Zod → 400 com campo/motivo.

## Testing Strategy

- **Vitest + fast-check** (puros): `paretoParadas` em minutos (P1), `kg-fabricado`
  (P2), regra de fila "iniciada primeiro" (P3), soma/percentual das partes (P4/P5).
- **Rotas**: 403 para OPERADOR em R$/KG e liberar-cartão (P6); isolamento
  `empresaId`; não-regressão do apontar/pausar/concluir.
- Rodar via `control_pwsh_process` + `--reporter=dot`; validar com `get_diagnostics`.

## Sequência de implementação (ondas por custo/impacto)

1. **Onda rápida**: R4 (Pareto minutos), R3 (tempo parada no quadro), R2
   (histórico ao concluir).
2. **Onda relatórios**: R6 (metas por máquina), R5 (produtividade operador×máquina).
3. **Onda financeira**: R7 (R$ já existe + KG novo + `perfilGuard`, OPERADOR fora).
4. **Onda fluxo**: R1 (fila reativa), R9 (percentual da parte + reconciliação),
   R8 (liberar cartão por gestão + schema de auditoria).
