# Requirements Document

Visualização e Observações da OP (paridade Calcgraf)

## Introduction

As OPs importadas do PDF do Calcgraf têm um PDF original salvo no Vizor
(`OrdemProducao.pdfData`), aberto pelo botão "Visualizar" (ícone olho), com
TODAS as informações e observações do documento. As OPs trazidas pelo **agente
de sincronização do Calcgraf** NÃO têm esse PDF — hoje o "Visualizar" não tem o
que mostrar, e algumas observações (ex.: tipo de serviço, acondicionamento,
bobinas em estoque/encomendadas) não são trazidas.

Esta feature garante que, independentemente da origem da OP, o usuário tenha uma
visualização completa para consulta — e que as regras de negócio que dependiam
de observações (notadamente o "Aguardando Cartão") passem a ser alimentadas por
**campos confiáveis de tabela** do Calcgraf, sem quebrar o comportamento atual
das OPs já importadas por PDF.

Objetivos:
1. Preservar o "Visualizar PDF" das OPs que têm PDF do Calcgraf (importadas por
   PDF ou com PDF enviado/substituído pelo botão de upload).
2. Para OPs sem PDF (sincronizadas), oferecer um **relatório gerado pelo Vizor**
   com as MESMAS informações do PDF do Calcgraf, incluindo TODAS as observações.
3. Levar ao Vizor as observações da OP, priorizando **campo de tabela
   confiável**; quando não houver campo que reflita a mesma informação, derivar
   de forma documentada.
4. Migrar a regra "Aguardando Cartão" (material em estoque vs. encomendado) para
   um **dado confiável** (saldo físico de `EstSaldos`), mantendo compatibilidade
   com as OPs de PDF existentes (fallback do texto atual).

Repositórios envolvidos (separados): backend `VisioFab.Wms.Back`, frontend
`VisioFab.Wms.Front`, e o agente `VisioFab.AgenteCalcgraf` (quando precisar
trazer dado cru novo — exige reinstalação no servidor).

## Glossary

- **OP com PDF**: `OrdemProducao.pdfData` preenchido (origem PDF, ou upload manual).
- **OP sincronizada**: `origemImportacao = 'AGENTE_CALCGRAF'`, sem `pdfData`.
- **Relatório Vizor**: documento (HTML→PDF) gerado pelo backend a partir dos
  dados da OP, com layout equivalente ao PDF do Calcgraf.
- **Observações da OP**: blocos "Obs.:" do PDF do Calcgraf (tipo de serviço,
  acondicionamento, faturamento, bobinas, ficha técnica, nº pedido interno, etc.).
- **Aguardando Cartão**: regra que retém (total ou parcialmente) a produção de
  uma OP cujo material (bobina/cartão) não está em estoque suficiente.
- **EstSaldos**: tabela de saldo físico de estoque do Calcgraf
  (`CodItem`, `SaldoFisico`, `OrigemSaldo`, `CodOrigem`).

## Requirements

### Requirement 1: Preservar a visualização do PDF do Calcgraf

**User Story:** Como usuário do PCP, quero que as OPs que têm o PDF do Calcgraf
continuem abrindo esse PDF original no "Visualizar", para não perder a consulta
que já existe.

#### Acceptance Criteria
1. WHEN a OP tem `pdfData` THEN o botão "Visualizar" SHALL abrir o PDF original
   salvo (comportamento atual inalterado).
2. WHEN o usuário usa "Enviar/substituir PDF" THEN o PDF enviado SHALL passar a
   ser o documento aberto pelo "Visualizar" dessa OP.
3. O comportamento de visualização de OPs com PDF NÃO SHALL ser alterado por
   esta feature.

### Requirement 2: Relatório do Vizor para OP sem PDF

**User Story:** Como usuário do PCP, quero que uma OP sincronizada (sem PDF)
abra, no "Visualizar", um relatório gerado pelo Vizor com as mesmas informações
do PDF do Calcgraf, para consulta completa.

#### Acceptance Criteria
1. WHEN a OP NÃO tem `pdfData` THEN o "Visualizar" SHALL exibir o relatório
   gerado pelo Vizor (não erro / não vazio).
2. O relatório SHALL conter, no mínimo: cabeçalho (nº OP, cliente, produto,
   descrição, formato final, quantidade, data de emissão, data de entrega),
   programação de entrega (todas as parcelas), planos/componentes (com cores e
   frente/verso), materiais (papel/suporte, tintas/pantones, acabamentos),
   roteiro de etapas (centro + tempos) e TODAS as observações (Requisito 3).
3. O layout SHALL ser equivalente ao PDF do Calcgraf (mesma informação
   organizada em seções legíveis); não precisa ser pixel-a-pixel.
4. WHEN a OP tem PDF THEN o relatório Vizor NÃO SHALL substituir o PDF original
   (o PDF tem prioridade na visualização).

### Requirement 3: Observações completas para consulta

**User Story:** Como usuário do PCP, quero ver TODAS as observações da OP (como
no PDF do Calcgraf) para consulta, independentemente da origem da OP.

#### Acceptance Criteria
1. A visualização SHALL exibir todas as observações disponíveis: tipo de serviço
   (Novo/Repetição/Alteração), acondicionamento, faturamento, ficha técnica,
   número do pedido interno, bobinas (com estoque/encomenda) e observações
   gerais/produção, quando existirem.
2. WHEN existir campo de tabela no Calcgraf que reflita a observação THEN o
   sistema SHALL usar esse campo (fonte confiável).
3. IF não houver campo de tabela que reflita a mesma informação THEN o sistema
   PODE derivar a observação de forma documentada (ex.: regra do GPrint), desde
   que o critério fique registrado no design.
4. As observações trazidas pelo agente SHALL ser gravadas na OP de forma que a
   visualização (Requisito 2) e as regras (Requisito 4) as consumam.

### Requirement 4: Regra "Aguardando Cartão" por campo confiável

**User Story:** Como PCP, quero que a retenção por material (Aguardando Cartão)
seja decidida por um dado confiável de estoque, para a regra não depender de
texto e não falhar.

#### Acceptance Criteria
1. O agente SHALL trazer, por bobina/suporte da OP, o status de disponibilidade
   derivado de `EstSaldos` (saldo físico) — em estoque vs. a comprar — e os kg
   envolvidos, de forma determinística.
2. WHEN o dado confiável de estoque estiver disponível THEN a regra de
   "Aguardando Cartão" (retenção total e liberação parcial por kg) SHALL usá-lo.
3. WHEN o dado confiável NÃO estiver disponível (ex.: OP antiga de PDF) THEN a
   regra SHALL manter o comportamento atual (parsing do texto "encomendado"),
   como fallback — sem regressão.
4. A regra existente de liberação parcial (fração = kgEstoque / kgTotal) SHALL
   ser preservada.

### Requirement 5: Não regressão e compatibilidade

**User Story:** Como responsável pela produção, quero que nada do que já
funciona quebre com esta mudança.

#### Acceptance Criteria
1. OPs já importadas por PDF SHALL manter PDF, observações e regras atuais.
2. A sincronização do agente SHALL continuar respeitando os cintos de segurança
   (payload sem etapas não zera roteiro; OP com produção vira pendente;
   idempotência por hash).
3. Campos novos no payload do agente SHALL ser aditivos (ausência = preserva).
4. WHEN houver mudança de schema THEN `migrate-prod.ts` SHALL ser atualizado no
   mesmo commit, idempotente, testado 2× (steering database-migrations).
5. Multi-tenant: toda leitura/gravação SHALL filtrar por `empresaId` da OP real.

### Requirement 6: Isolamento e segurança da visualização

**User Story:** Como administrador, quero que o relatório da OP respeite o
isolamento entre empresas.

#### Acceptance Criteria
1. O relatório Vizor de uma OP SHALL ser acessível somente a usuários da empresa
   dona da OP.
2. A rota do relatório SHALL aceitar token via query param (abrir em nova aba),
   no mesmo padrão da rota `GET /pcp/op-pdf/:opId`.
3. WHEN o token é passado via query param THEN ele SHALL ser validado em
   conjunto com a sessão/empresa do usuário autenticado (o token identifica o
   usuário e sua empresa; o acesso só é concedido se a empresa do token for a
   dona da OP) — o token NÃO concede acesso independente da autenticação.
4. IF o token for inválido, expirado, ou de usuário de outra empresa que não a
   dona da OP THEN a rota SHALL negar o acesso (401/403), sem servir o relatório.
