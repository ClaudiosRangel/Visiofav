# Estudo — Reaproveitar cálculo / Orçamento de Repetição (mercado + Calcgraf + Vizor)

Data: 22/10/2026. Contexto: ao "Puxar Cálculo" na Biblioteca (7.951 migrados) e
ao Editar um item do orçamento, os campos dos steps vêm incompletos (papel,
gramatura, máquina, acabamentos nulos). Pergunta do usuário: qual é o
comportamento CORRETO (padrão de mercado + Calcgraf), e como tratar repetição.

---

## 1. O que os melhores sistemas do mercado fazem (pesquisa)

Pesquisa em MIS/estimating de impressão e em estimating genérico (Sage
Estimating, Certinia CPQ, WorkflowMax, RFMS, Printavo, CERM, Logic Print,
PressWise, Ordant, OnPrintShop, InfoFlo Print, Codefacture Packaging).
Convergência **unânime**:

### 1.1 "Duplicar / Clonar / Reorder" traz TUDO preenchido e editável
Sem exceção, a ação de reaproveitar um orçamento/estimate **copia todos os itens
de linha e especificações para um novo registro editável**:

- **Sage Estimating** — "Duplicate Estimate … cria um novo orçamento com as
  configurações de um existente como ponto de partida. Você pode então **editar
  os detalhes da cópia**." Há opção de "limpar quantidades" (reorder com nova
  tiragem).
- **Certinia CPQ** — "Clonar um estimate copia os detalhes **e todos os
  registros associados** para um novo estimate."
- **Contractor+ / ConstructionOnline** — "a cópia carrega **todos os itens de
  linha, taxas e demais detalhes**."
- **InfoFlo Print / PressWise / Printavo** — "reorder a partir do histórico de
  cotação" gera o pedido com os dados **pré-preenchidos**, sem recriar do zero.
- **Codefacture (packaging)** — descreve o caso exato da Wega: *"o cliente
  reencomenda o que teve da última vez, com a MESMA faca, o MESMO material e a
  MESMA arte; ninguém fica escavando jobs antigos."* (rephrased — conteúdo
  reescrito para conformidade de licença.)

**Conclusão de mercado:** reaproveitar um cálculo/orçamento = **cópia completa e
editável** de toda a engenharia. É inaceitável abrir a edição com campos vazios.
O usuário está logicamente certo.

### 1.2 Repetição é um tipo/flag de 1ª classe, com rastro da origem
Sistemas de packaging/print distinguem **NOVO** × **REPETIÇÃO** (reorder/repeat)
e guardam o vínculo com o job/estimate de origem (para reusar faca, material,
arte e o preço base). Repetição normalmente:
- herda 100% da engenharia do cálculo-origem;
- muda só o que precisa (tiragem/quantidade, eventualmente preço de insumo
  atualizado);
- mantém **rastreabilidade** (de qual cálculo veio).

### 1.3 Revisão × Nova versão
Padrão (RFMS, Printavo, PressWise): editar um orçamento gera **revisão/versão**
(V1→V2) preservando o histórico — o que o Vizor já faz (vimos "Comparação de
Versões" na tela do 5347).

---

## 2. O que o Calcgraf faz (confirmado na base restaurada)

- **"Localiza o Cálculo Padrão"**: o operador puxa um cálculo existente; o
  Calcgraf materializa um cálculo com **todas as tabelas-filhas** (planos,
  tintas, atividades/roteiro, materiais) — engenharia COMPLETA, editável. Ex.:
  o 11121 tem 2 planos + 2 tintas + 8 atividades, cada `Codigo` (versão) com as
  SUAS filhas.
- **Rastreabilidade nativa da origem**: `CalculoHeader` tem os campos
  **`CodCalculoPadrao`** e **`CodCalculoOrigemLer`** — ou seja, o Calcgraf grava
  de qual cálculo-padrão/origem o novo cálculo foi lido. O conceito de
  "puxar com vínculo de origem" é de 1ª classe.
- **Tipo de OP (Novo/Repetição/Alteração/Piloto)**: o Calcgraf classifica a OP
  — o Vizor já captura isso na importação de PDF via tag `[TipoOp]`
  (Novo/Repetição/Alteração/Piloto — ver steering pcp-modulo §3.2).

**Conclusão Calcgraf:** confirma o padrão de mercado — puxar cálculo traz a
engenharia inteira preenchida e editável, com vínculo à origem e noção de
repetição.

---

## 3. Onde o Vizor está hoje (diagnóstico com dado real)

### 3.1 O código está CERTO; o DADO migrado é que está incompleto
- O fluxo de cópia (`copiarCalculoParaItem` → `calculoParaItemBody` →
  `dadosPersistenciaItem`) copia FIELMENTE o que houver na engenharia do
  `CalculoGrafico`. O wizard de edição (`itemParaForm`) mapeia corretamente.
- **Porém** os 7.951 cálculos foram migrados em LOTE só com a **foto**
  (`resultado_calculo`, que faz a tela de detalhe e o C.PROD/valor baterem
  100%). A **engenharia estruturada** ficou parcialmente nula.

Prova no 11121 (produção), que foi puxado no orçamento 5347:
```
tipo_embalagem_id : ✅ preenchido
cores             : ✅ array (2) — porém precoKg=0 e rendimentoM2Kg=0
quantidade        : ✅ 107.000
papel_id          : ❌ null
gramatura         : ❌ null
suporte_id        : ❌ null
maquina_id        : ❌ null
acabamentos_ricos : ❌ null
```

### 3.2 Consequência (o que o usuário viu)
- Puxar cálculo migrado → item nasce com a foto correta, MAS papel/gramatura/
  máquina/acabamentos vazios e cores com preço 0.
- Editar item → wizard abre com esses campos em branco.
- Recalcular → "Dados inválidos" (falta gramatura/preço) — já melhorado para
  mensagem por campo (back `0f4d47116`, front `973fa25`), mas a RAIZ é o dado
  faltante.

### 3.3 Por que a foto bate e a engenharia não
A foto (`resultado_calculo`) é o RESULTADO congelado (valores finais, que batem
100%). A engenharia estruturada (IDs de cadastro: papel, máquina, acabamento;
preços por cor) exige **de-para dos nomes do Calcgraf → cadastros do Vizor** —
trabalho que, no lote, não foi feito (os nomes divergem; foi exatamente o
esforço manual do 7343).

---

## 4. Recomendação (o correto a acontecer)

Alinhado a mercado + Calcgraf + à lógica que o usuário descreveu:

### 4.1 Princípio
**Puxar um cálculo gravado = orçamento de REPETIÇÃO = traz TUDO preenchido e
editável.** Editar um item = todos os campos já populados. Sem campo vazio.

### 4.2 Para isso, a engenharia do cálculo precisa estar COMPLETA
Como a foto sozinha não basta para editar, é preciso **enriquecer a engenharia**
dos cálculos migrados a partir da própria foto rica (que JÁ tem suporte, tintas,
acabamentos, planos nominais) + de-para para os cadastros do Vizor:
- `papel`/`suporte` (nome na foto) → `PrecoMateriaPrima`/`SuporteGrafico` (id);
- `gramatura` → do plano/suporte;
- `cores` → preço/rendimento do cadastro de tinta (hoje vêm 0);
- `acabamentos` (nome na foto) → `AcabamentoGrafico` (id) → `acabamentosRicos`;
- `máquina` → `CentroProducao` (id).

Onde o de-para não casar com segurança, **marcar o campo como "a completar"** em
vez de inventar — e sinalizar na tela (o usuário completa 1x; dali em diante a
repetição vem redonda).

### 4.3 Marcar REPETIÇÃO como informação de 1ª classe
Adicionar ao orçamento/item a noção de **tipo** (NOVO | REPETIÇÃO) + o vínculo de
origem (já temos `calculoGraficoOrigemId` no item). Equivale ao
`CodCalculoPadrao`/`[TipoOp]` do Calcgraf. Exibir na tela (badge "Repetição") e
no relatório/proposta.

### 4.4 Precedência de edição (regra de ouro)
Ao editar/recalcular uma repetição, o Vizor deve priorizar a ENGENHARIA copiada
(não recalcular do zero com defaults). Só recalcula o que o operador alterar. A
foto permanece como referência de conferência (camada 2 — anti-vergonha).

---

## 5. Proposta de implementação (faseável)

1. **Spec nova `orcamento-repeticao-engenharia-completa`** (requirements→design→
   tasks). Escopo:
   - **Enriquecedor da engenharia** dos `CalculoGrafico` migrados a partir da
     foto rica + de-para (papel/suporte/cores/acabamentos/máquina/gramatura).
     Idempotente, produção, por lote; relatório do que casou e do que ficou "a
     completar". NÃO toca PCP.
   - **Tipo NOVO|REPETIÇÃO** no orçamento (+ badge na UI + no relatório).
     Repetição já grava `calculoGraficoOrigemId`.
   - **Aviso no wizard** quando a engenharia estiver incompleta ("cálculo
     migrado como foto; complete papel/gramatura/acabamentos para recalcular").
   - **Precedência de edição**: editar repetição parte da engenharia copiada.
2. **Camada 2 (conferência foto × recálculo)** entra junto para garantir que,
   após completar a engenharia, o recálculo bate com a foto (≤0,5%).

### Decisão pendente do usuário
- (a) Enriquecer os **7.951 de uma vez** (ambicioso; depende da qualidade do
  de-para — risco de "a completar" em muitos) OU
- (b) Enriquecer **sob demanda** (quando um cálculo é puxado pela 1ª vez, tenta
  completar a engenharia na hora a partir da foto) OU
- (c) Enriquecer um **lote prioritário** (os cálculos que a Wega mais reusa).

Recomendação: **(b) sob demanda + aviso** — resolve o caso real (o operador puxa,
completa o que faltar 1x, e a partir daí a repetição vem redonda), sem o risco de
um batch de 7.951 com muitos "a completar". O (c) complementa para os campeões de
uso.
