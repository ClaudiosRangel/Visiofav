# Reutilização de cálculo entre orçamentos (paridade Calcgraf) — estudo + proposta

Task 15 da spec `orcamento-grafico-calibracao-15086`. Responde à pergunta do
usuário: *"Posso usar um cálculo para outros orçamentos como no Calcgraf?
Importante estudar como o Calcgraf reutiliza os cálculos em outros orçamentos."*

## 1. Como o Calcgraf reutiliza um cálculo

No Calcgraf/G-Print a entidade central do cálculo é o **`CalculoHeader`** (tabela
`CalculoHeader`, PK `Codigo` = `NumCalculo`), com as filhas que guardam toda a
"receita" do trabalho:

- `CalculoPlanos` (geometria/suporte/aproveitamento/tiragem por plano)
- `CalculoAtividades` (impressão + acabamentos: produção/acerto por atividade)
- `CalculoAtvImpressao` (cores/lavagens/chapas)
- `CalculoTintas` (tintas e `areaTinta`/cobertura)
- `CalculoMatAcabamento` (materiais de acabamento e parâmetros)
- `CalculoTiragens` / `CalculoResAgrupamento` (resultados por tiragem/agrupamento)
- `CalculoMargens` / `CalculoTaxas` (margens e CEV)

Um **orçamento** no Calcgraf referencia um `CalculoHeader`. A reutilização
observada no sistema do cliente é por **CLONAGEM**: ao criar um orçamento novo
para um produto igual/parecido (ex.: a mesma embalagem em outra tiragem, outro
cliente, ou uma revisão), o operador parte de um cálculo existente, o sistema
**copia o `CalculoHeader` + filhas para um novo `NumCalculo`** e ajusta só o que
muda (cliente, pedido, tiragem, eventualmente suporte/preços). O cálculo original
permanece intacto (histórico), e o novo é independente a partir da cópia.

Ou seja: **não é um vínculo vivo (N:N) — é um "salvar como" / duplicar**. Isso
casa com o fluxo real da Wega (repetição de trabalhos: "TipoOp = REPETIÇÃO" nas
OPs importadas por PDF, que reaproveitam a receita de um trabalho anterior).

## 2. Equivalente no Vizor (modelo atual)

No Vizor o cálculo gráfico vive em:

- **`OrcamentoGrafico`** (cabeçalho: número, cliente, tipo de embalagem, medidas,
  tiragem, status, consolidados).
- **`ItemOrcamentoGrafico`** (o item calculável: suporte orçado/produção, papel,
  gramatura, cores, acabamentos ricos, máquina, montagem, formato de corte,
  `resultadoCalculo`, custo/valor).
- **`PlanoCalculoGrafico`** (planos do item: suporte/gramatura/formato/cores por
  plano — frente/costa, componentes).

A "receita" de cálculo está TODA no `ItemOrcamentoGrafico` (+ `PlanoCalculoGrafico`).
Logo, o equivalente fiel ao "clonar `CalculoHeader`" do Calcgraf é **clonar o
`ItemOrcamentoGrafico` (+ planos) para um novo `OrcamentoGrafico`**, ajustando o
que muda (cliente/tiragem) e recalculando.

## 3. Decisão de design: CLONAGEM (não relação N:N)

Recomendação: **clonagem**, pela paridade com o Calcgraf e porque:
- Evita acoplamento vivo — alterar o orçamento-base depois NÃO deve mudar os
  derivados (o Calcgraf também isola após copiar; preserva histórico/auditoria).
- Simples e previsível: 1 novo `OrcamentoGrafico` + N `ItemOrcamentoGrafico` +
  planos, com `resultadoCalculo` recalculado para a nova tiragem/cliente.
- Não exige schema novo (sem migração) — só uma rota/serviço de "duplicar".

Uma relação N:N (um cálculo compartilhado por vários orçamentos) traria
complexidade de versionamento e risco de alterar um orçamento já aprovado ao
mexer no cálculo-fonte — rejeitada.

## 4. Proposta de funcionalidade — "Reaproveitar cálculo"

### Backend (sem schema novo)
Nova rota `POST /orcamento-grafico/:id/reaproveitar` (ou
`/itens/:itemId/duplicar-para-orcamento`), em `orcamento-grafico.routes.ts`:
1. Carrega o `OrcamentoGrafico` + `ItemOrcamentoGrafico` (+ `PlanoCalculoGrafico`)
   de origem (multi-tenant: `empresaId` explícito).
2. Cria um novo `OrcamentoGrafico` (número sequencial novo por empresa), copiando
   cabeçalho e aceitando overrides no body: `clienteNome`, `quantidade`
   (tiragem), `observacoes`, opcionalmente novo `tipoEmbalagemId`.
3. Copia cada item (todos os parâmetros de cálculo: suporte/papel/gramatura/
   cores/acabamentosRicos/máquina/montagem/formato) + os planos.
4. **Recalcula** cada item com `calcularItem` (a nova tiragem muda custo unitário/
   total) e grava `resultadoCalculo`/`custoProducao`/`valorTotal` + consolidados.
5. Retorna o novo orçamento. O original fica intacto.

Idempotência/segurança: a rota só LÊ a origem e CRIA um novo registro; não altera
a origem. Validar que a origem pertence ao `empresaId` do usuário.

### Frontend
Botão **"Reaproveitar cálculo"** na listagem/detalhe do orçamento gráfico
(`/orcamento-grafico`), abrindo um modal que pede o que muda (cliente, tiragem)
e chama a rota. Resultado: navega para o novo orçamento já calculado.

## 5. Escopo e próximo passo

Esta é a PROPOSTA (Task 15 — estudo/decisão documentada, conforme o design).
A IMPLEMENTAÇÃO da rota + botão é um incremento à parte (fora da calibração do
15.086), a ser priorizada pelo usuário. Nada aqui altera o motor nem o schema;
é orquestração de cópia + recálculo reusando `calcularItem` (já existente).
