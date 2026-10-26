# Análise — Apontamentos (Checkout, Painel, Relatórios/BI) × pedidos do Caio

> Levantamento feito direto no código (back Fastify+Prisma, front Next/Mantine,
> app Checkout). Para cada ponto: **o que já existe**, **o que falta** e o
> **esforço** estimado. Legenda: 🟢 pronto · 🟡 parcial · 🔴 não existe.

## Visão geral do que já existe hoje

- **Apontamento** grava em `ApontamentoEtapa` (tipo `PRODUCAO | PERDA | PARADA |
  RETOMADA`), com `quantidadeProduzida`, `quantidadePerda`, `motivoParada`,
  `tempoParadaMinutos`, `setupInicio/Fim/DuracaoMinutos`, `fotoUrl`, `dataHora`,
  `funcionarioId`, `codigoParadaId`.
- **Checkout** (chão de fábrica): lista a fila do centro (`GET /checkout/painel`),
  aponta produção/perda/parada, mostra a quantidade da etapa/parte e a base de
  contagem (COLAGEM = unidade; demais = tiragem/folhas).
- **Painel de Programação** (`/pcp/programacao`) e **Quadro de Produção (TV)**
  (`/pcp/quadro-producao`).
- **BI de Apontamentos** (`/pcp/apontamentos`): dashboard, produtividade,
  histórico, relatórios/PDF, metas.
- **Gerencial** (`/pcp/gerencial`): produção mensal, Pareto de paradas, metas por
  processo, dados por centro, trabalhos em máquina.

---

## 1. "As sequências da programação podem mudar; como o sistema trabalha isso com o operador?"

🟡 **Parcial.** A fila de cada centro tem ordenação automática
(`fila-ordenacao.utils.ts`): 1º nº da OP, 2º data de entrega. O supervisor pode
arrastar (drag-and-drop) e a etapa vira **manual** (`ordemManual=true`) — fica
fixa, e só as não-manuais se reordenam quando entra OP nova. O operador vê a fila
na ordem de `posicaoFila`.

**O que NÃO acontece hoje:** o **apontar/iniciar do operador NÃO reordena** a
fila. Iniciar, apontar e concluir só mexem na quantidade/status, não na sequência.

**Falta (se desejado):** definir a regra — por exemplo, ao **iniciar** uma etapa
ela sobe para o topo do centro; ao **concluir** ela sai da fila (já sai, pois
some do painel). Esforço baixo (disparar reordenação no iniciar).

## 2. "O histórico do apontamento de uma OP fica onde no final do apontamento?"

🟡 **Existe no backend, falta a tela no momento da conclusão.**
- Backend pronto: `GET /pcp/etapas/:id/apontamentos` (histórico + totais por
  etapa) e `GET /pcp/apontamentos-bi/historico` (histórico geral, paginado, com
  filtros). O Checkout também tem `listarHistoricoApontamentos`.
- **Falta:** uma tela/modal que mostre o histórico **ao concluir** a etapa/OP
  (hoje o dado existe na API, mas o front não exibe automaticamente no
  fechamento). Esforço baixo-médio (consumir o endpoint num modal de conclusão).

## 3. "No quadro de produção precisa vir o tempo que está parada."

🟡 **Parcial.** O Quadro de Produção já mostra, por máquina, o status
(PRODUZINDO/PARADA/OCIOSA), o **motivo** da parada e um cronômetro `tempoNaEtapa`
(tempo desde o início da etapa) + alerta de parada > 60 min.

**Falta:** o **tempo da PARADA em si** (desde o momento em que pausou), não o
tempo total na etapa. O dado existe (`ApontamentoEtapa` tipo PARADA tem
`dataHora` e `tempoParadaMinutos`) — é expor o tempo correndo desde a última
parada. Esforço baixo.

## 4. "O Pareto (relatório de paradas) precisa trazer o total em minutos por motivo (ex.: Acerto de Máquina = 500 min em Outubro)."

🔴 **Hoje conta ocorrências, não minutos.** `paretoParadas()` agrupa as paradas
do mês por motivo/código e retorna **quantas vezes** cada motivo ocorreu
(`ocorrencias`), ordenado. O campo `tempoParadaMinutos` existe mas **não é
somado**.

**Falta:** trocar o acumulador de "contagem" por **soma de minutos** por motivo
(e, de preferência, mostrar os dois: minutos totais + nº de ocorrências). É
exatamente o exemplo do Caio. Esforço baixo (ajuste no serviço + gráfico).

## 5. "Produtividade por operador separar por máquina também (filtra operador nas cortadeiras e o gráfico mostra as máquinas)."

🟡 **Parcial.** `agregarProdutividade(..., por)` agrega por operador **OU** por
máquina (uma dimensão por vez). O filtro aceita operador e centro juntos, mas a
**saída quebra por uma só dimensão**.

**Falta:** o cruzamento **operador × máquina** num resultado só (filtrar um
operador e o gráfico separar as máquinas dele). Esforço médio (nova dimensão de
agrupamento `operador-maquina` + gráfico agrupado).

## 6. "Relatório de metas por processo deve trazer as máquinas separadas (cada máquina como série, não uma linha só)."

🟡 **Parcial.** O "resumo por processo" é agregado por processo (uma linha por
processo). **Já existe** `dadosDiariosPorCentro` que devolve a matriz **por
máquina** de um processo — ou seja, a quebra por máquina já está na API.

**Falta:** o gráfico de **metas por processo** exibir **cada máquina como série
separada** (plugar o `dados-por-centro` no gráfico de metas) e, se quiserem,
**meta por máquina** (hoje a meta é do processo, model `MetaProducaoProcesso`).
Esforço médio (front + opcional meta por centro).

## 7. "Futuramente: quanto em R$ está rodando em cada máquina e quanto em KG está fabricado."

🟡 **R$ por máquina já existe · KG não existe.**
- **R$ por máquina:** pronto. `GET /pcp/apontamentos-bi/dashboard` entrega
  `valorRs` por centro (motor `valorizar()`: `custoHora × horas` com `horas =
  produção ÷ velocidade`, ou `valorUnitário × qtd`). Depende de `custoHora` e
  `velocidade` cadastrados nos centros (≈46 já preenchidos).
- **KG fabricado:** 🔴 não existe. Os apontamentos são em folhas/unidades; a
  conversão para KG (via gramatura × formato × folhas do plano) só existe no
  **planejamento** (cálculo de consumo), não como "KG produzido" a partir dos
  apontamentos.

**Falta (para o futuro):** relatório de KG fabricado = converter a produção
apontada em KG usando os dados do plano. Esforço médio.

## 8. "OP 'aguardando cartão' não pode aparecer para o operador se só tiver parte da bobina em estoque; o Gerente Geral programa para cortar."

🟡 **Parcial (e com uma ressalva importante).**
- Hoje a OP com material **"encomendado"** vai para a seção **"Aguardando
  Cartão"** no painel (detecção por texto `/encomendad/i` nas observações/itens).
- Já existe **liberação parcial**: se houver bobina **em estoque + encomendada**,
  o sistema calcula `fração = kgEstoque / kgTotal` e **libera só a parcela
  coberta**, deixando o restante em Aguardando Cartão.

**Ressalvas / o que falta:**
- A disponibilidade hoje é lida do **texto das observações** (kg nas tags), **não
  do saldo real de bobina no estoque/WMS**. Para a regra do Caio ("só se tiver
  parte da bobina em estoque") ficar confiável, precisa consultar o **estoque
  real**.
- **Não existe o papel "Gerente Geral"** no sistema (perfis atuais: ADMIN /
  SUPERVISOR / OPERADOR). Para "o Gerente Geral programar para cortar", falta um
  **papel/permissão dedicada** que autorize liberar/cortar a OP retida. Esforço
  médio-alto (papel + trava por estoque real + ação de liberação).

## 9. "Mesma OP em máquinas diferentes — quais as travas? (OP 100.000 folhas: 50.000 na Doin + 50.000 na CD7; cada operador precisa saber que roda 50%)."

🟢🟡 **Já suportado via desmembramento, com travas — e o operador JÁ vê a parte dele.**
- **Como se faz:** `POST /pcp/etapas/:id/desmembrar` divide a etapa em N partes
  (ex.: 50.000 + 50.000) em centros diferentes. Cada parte grava
  `quantidadePrevista` = quantidade da parte.
- **Travas existentes:** só desmembra etapa **PENDENTE**; mínimo 2 partes; a
  **soma das partes tem que bater** com o total (tolerância 0,01).
- **O operador vê a parte dele:** tanto o painel quanto o **Checkout** mostram a
  `quantidade` = `quantidadePrevista` da parte (50.000 na Doin, 50.000 na CD7) e a
  barra de progresso em cima dessa quantidade. Ou seja, a necessidade central do
  Caio **já é atendida**.

**O que falta/limitações:**
- Não dá para desmembrar **depois de começar** a apontar (o "já cortei 50.000,
  mando o resto pra outra máquina" com apontamento no meio não é suportado — só
  antes de iniciar).
- Não há **reconciliação automática** entre as partes (travar a conclusão da OP
  até as duas partes somarem o total) nem um rótulo explícito "você roda X% da
  OP" além da quantidade/progresso.
- `mover` etapa entre centros não valida consistência de quantidade.

---

## Resumo executivo (prioridade sugerida)

| # | Pedido | Status | Esforço |
|---|--------|--------|---------|
| 4 | Pareto em **minutos** por motivo | 🔴 falta somar minutos | Baixo |
| 3 | Quadro: **tempo parada** correndo | 🟡 mostra motivo, falta o tempo | Baixo |
| 2 | **Histórico ao concluir** apontamento | 🟡 API pronta, falta tela | Baixo-médio |
| 1 | Sequência muda com o operador | 🟡 fila existe; apontar não reordena | Baixo |
| 6 | Metas por processo com **máquinas separadas** | 🟡 base existe, falta no gráfico | Médio |
| 5 | Produtividade operador **× máquina** | 🟡 falta cruzamento | Médio |
| 7 | R$ por máquina / **KG fabricado** | 🟡 R$ ok, KG falta | Médio |
| 9 | Mesma OP em máquinas (desmembrar) | 🟢 atende o essencial | — (incrementos) |
| 8 | Aguardando cartão + **Gerente Geral** | 🟡 parcial, falta papel + estoque real | Médio-alto |

**Mais baratos e de maior impacto imediato:** itens 4 (Pareto em minutos), 3
(tempo de parada no quadro) e 2 (histórico ao concluir). O item 9 (mesma OP em
máquinas) já cobre a necessidade central. O item 8 é o mais estrutural (depende de
criar papel "Gerente Geral" e checar estoque real de bobina).
