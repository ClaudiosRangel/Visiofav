# Design Document

Restrições e Materiais por Atividade de Acabamento (informativos) — P16

## Overview

Cadastro + seleção + exibição de **Restrições** e **Materiais** por atividade de
acabamento, **sem efeito no cálculo** (confirmado nas duas bases — ver
requirements). Reaproveita o máximo do que já existe:
- `RestricaoAcabamento` (model já no schema, hoje vazio/sem uso) vira o cadastro
  de restrições por atividade — usado como TEXTO (os campos `tempoAcertoMin`/
  `tempoOperacaoMin` ficam como estão, não usados).
- Materiais por atividade: **campo Json `materiais` no `AcabamentoGrafico`**
  (lista de nomes) — menor risco que tabela nova, e materiais são só texto.
- A seleção no orçamento é gravada em `ItemOrcamentoGrafico.acabamentosRicos`
  (Json já existente), em campos novos por item de acabamento
  (`restricaoNome`, `materialNome`, `medidaMm`) — texto, sem custo.

**Motor NÃO é tocado.** O golden 15.235 e a suíte `orcamento-grafico` continuam
idênticos (Req 5).

## Decisões de modelagem (menor risco)

| Dado | Onde | Por quê |
|---|---|---|
| Restrições por atividade | model `RestricaoAcabamento` (JÁ existe) | reuso; só expõe CRUD de nome |
| Materiais por atividade | `AcabamentoGrafico.materiais` (Json String[] NOVO) | evita tabela nova; é só texto |
| Seleção no orçamento | `acabamentosRicos[].{restricaoNome, materialNome, medidaMm}` | Json já existe; aditivo |

**Schema:** única mudança = adicionar coluna `materiais Json?` em
`AcabamentoGrafico`. Segue `database-migrations`: `schema.prisma` +
`migrate-prod.ts` (ADD COLUMN IF NOT EXISTS) no MESMO commit, idempotente.
`RestricaoAcabamento` já existe — sem mudança de schema para restrições.

## Componentes

### Backend (`VisioFab.Wms.Back`)

1. **Schema:** `AcabamentoGrafico.materiais Json? @map("materiais")` (lista de
   nomes). `migrate-prod.ts`: `ALTER TABLE acabamento_grafico ADD COLUMN IF NOT
   EXISTS materiais JSONB`. Rodar 2× local se Postgres disponível; senão, roda no
   deploy (padrão do projeto).

2. **CRUD de acabamentos** (`orcamento-grafico.routes.ts`): estender o
   `acabamentoBodySchema` para aceitar `materiais: string[]` (opcional) e
   `restricoes: {nome}[]` (opcional — já há suporte a restrições? verificar:
   a tela de cadastro já tem interface `Restricao`, confirmar se o POST/PUT já
   grava `RestricaoAcabamento`; se não, adicionar). `acabamentoGraficoSelect`
   passa a devolver `materiais` + `restricoes` (via include/select).

3. **Request de acabamento rico** (`montarAcabamentosRicos` /
   `acabamentoRicoRequestSchema` em `orcamento-grafico.routes.ts` e
   `orcamento-grafico-item.service.ts`): aceitar e **repassar inalterados** os
   campos `restricaoNome?`, `materialNome?`, `medidaMm?` para persistência em
   `acabamentosRicos`. **Não** entram em nenhum cálculo de custo — só são
   gravados e devolvidos. Garantir que o motor ignora esses campos (eles não
   existem no tipo `ItemAcabamentoRico` do motor; ficam só na persistência do
   item).

4. **Relatório** (`orcamento-grafico-relatorio.service.ts` / PDF): quando o
   acabamento do item tiver `restricaoNome`/`materialNome`/`medidaMm`, exibir
   como texto junto do acabamento (sem coluna de custo).

### Frontend (`VisioFab.Wms.Front`)

1. **Cadastro** `cadastros/acabamentos/page.tsx` (já tem interface `Restricao`):
   garantir CRUD de restrições (lista de nomes por atividade) e adicionar CRUD
   de materiais (lista de nomes). UI simples (TagsInput/lista).

2. **StepAcabamentos** (`novo/StepAcabamentos.tsx`): ao marcar a atividade, se
   ela tiver restrições/materiais, mostrar: Select de Restrição (opcional),
   checklist/Select de Material (opcional) e NumberInput "Medida em mm". Gravar
   em `acabamentosRicos[i].{restricaoNome, materialNome, medidaMm}`. Se a
   atividade não tiver restrições/materiais, ocultar as sub-listas.

3. **WizardFormData** (`novo/page.tsx`): o tipo `AcabamentoRicoSelecionado` já
   tem `restricaoAcabamentoId?` — estender/renomear para carregar os campos
   textuais (`restricaoNome?`, `materialNome?`, `medidaMm?`) enviados ao salvar.

4. **Detalhe/relatório do item:** exibir a restrição/material/medida escolhidos.

## Data Models

- **ALTERAÇÃO:** `AcabamentoGrafico.materiais Json?` (lista de nomes de material).
- **REUSO (sem mudança):** `RestricaoAcabamento` (nome por atividade).
- **REUSO (sem mudança de schema):** `ItemOrcamentoGrafico.acabamentosRicos`
  (Json) ganha campos textuais por item de acabamento — não altera colunas.

Migração: só o ADD COLUMN de `materiais`. `schema.prisma` + `migrate-prod.ts`
juntos, idempotente.

## Error Handling

- Seleção de restrição/material inexistente para a atividade → ignora (grava o
  texto como veio; sem efeito de custo). Nunca bloqueia o cálculo.
- `medidaMm` inválida → trata como vazia (campo descritivo).

## Testing Strategy

- **Não-regressão (Req 5):** rodar a suíte `orcamento-grafico` (inclui golden
  15.235) e confirmar valores idênticos. Como o motor não muda, espera-se verde
  sem ajuste.
- **Backend:** `get_diagnostics` nos arquivos tocados; teste de exemplo opcional
  confirmando que um item com `restricaoNome`/`materialNome` salva e recarrega
  esses campos e NÃO muda `custoProducao`/`valorTotal`.
- **Frontend:** `get_diagnostics`; verificação manual (marcar atividade com
  restrições → escolher → salvar → ver no relatório).
- Correctness Properties: não se aplica (sem lógica de cálculo nova; é
  cadastro/persistência textual). Omissão justificada aqui.
