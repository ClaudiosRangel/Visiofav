# Calcgraf — Fluxo de Manutenção de Orçamento (levantamento de telas)

> Registro das sequências de operação do Calcgraf (GPrint) fornecidas pelo
> usuário em 03/10/2026, para o Vizor não perder nenhum recurso ao reproduzir o
> módulo. Fonte: prints reais da tela "Orçamentos" (Carton Wega). Comparação com
> o estado atual do Vizor ao final.

## 1. Sequência observada (prints)

**Contexto:** orçamento nº 5.376, cliente ESTAÇÃO Y, 1 item (cálculo 15.234,
CARTUCHO "Cartucho Kit Intense Fragrance", tiragem 20.000).

### 1.1 Manutenção de um orçamento (tela "Orçamentos → Alteração")
Um ORÇAMENTO é um cabeçalho (Série, Nº Orçamento, Data, Cliente Principal) que
contém uma LISTA DE ITENS ("Itens do Orçamento"). Cada item é um **Cálculo**
(ex.: 15.234) com: Linha de Produto, Tipo de Produto, Tiragens, Descrição,
Status (Proposta). O painel inferior mostra "Dados do Item" (Formato, Suporte,
Cores, Acabamento, Itens Diversos, Fornecidos) e abas **Fechamento** /
**Comissões** com o resultado (Tiragem, Margem, C.Marg., Valor Unitário, Valor
Total). **Um orçamento = N itens** (multi-item) — cada item tem seu próprio
cálculo e fechamento; o orçamento consolida.

### 1.2 Incluir item ("Novo Item")
Botão de novo item abre o diálogo **"Novo Item → Selecione a Linha de Produto"**
com as linhas:
- CARTUCHO
- CARTUCHO COMPOSTO
- LÂMINA SIMPLES
- LÂMINAS
- SACOLA

A **Linha de Produto** determina o especialista de cálculo (geometria/
planificação) do item. No Vizor isso corresponde ao conceito de **TipoEmbalagem**
(com fórmulas de planificação por família).

### 1.3 Alterar um item já incluso (tela "CARTUCHO")
Ao abrir/editar um item, a tela do especialista (ex.: CARTUCHO) tem os campos:
- **Produto / Tipo de Produto / Descrição / Sigla Acabado / Tributação**
  (ICMS + IPI).
- **Tiragem** × **Modelos** (ex.: 20.000 × 1).
- **Cores** (ex.: 4x0, 5x0) · **Processo de Impressão** (Offset Plana) · botão
  "Pre" · **Cobertura de Tinta** (Definição Manual / Escala / Especial).
- **Fabricante** · **Suporte** (ex.: DUPLEX 280) · botão **NC** · **Form.Sup.**
  (formato do suporte, ex.: 605 x 620) · checkbox **Fornecido** ·
  **Microondulado**.
- **Comp x Larg x Alt** (77 x 52 x 189) · **Aba Cola** (13) · **Aba Fec** (13)
  · **Fibra** · **Mont** (montagem, ex.: 2x2) · **Formato de Corte** (605 x 620)
  · **Ajuste Corte Micro.** (mm).
- **Acabamento → Atividades** (lista de checkboxes: AFT70, Bimac, Bobst 68,
  Bobst E, Bobst E\CV\Relevo, Bobst S, CVM, CVMR, Colagem Manual, Colagem de
  acetato, Colocação de Alça, Cortadeira Grande/Pequena, Destacar, ...).
- **Restrições** (lista condicional por acabamento — ex.: para coladeira:
  "Acerto Acoplado Colagem Lateral", "Fundo Automático Normal", "Lateral
  Simples", "Lateral Simples Pequeno", "Acerto Trocando Versão", etc.). ESTE É
  UM RECURSO QUE O VIZOR AINDA NÃO TEM: cada atividade de acabamento pode ter
  SUB-OPÇÕES (restrições) que afetam o acerto/custo.
- **Acondicionamento** (ex.: "Caixa Padrão", "Embalar" + "Conteúdo por volume"
  1000).
- Botões de rodapé: **Itens Diversos** (ex.: FACA NOVA, CLICHÊS HOT — custos
  avulsos), **Itens Fornecidos** (material do cliente), **Campos Livres**
  (ARTE, PADRÃO), **Observação** / **Obs. Áreas de Op**.

### 1.4 Escolher um Formato → "Seleção de Modelos (GCad)"
O botão **NC** (ao lado do Suporte) abre **"Seleção de Modelos (GCad)"** — um
catálogo de MODELOS/FACAS já cadastrados, filtrável por Cliente e Modelo, com
colunas: Cliente, Modelo, Serviço, Dimensões, Repet. (repetição/encaixe),
Form. Corte, Tipo Cartucho, Suporte, Gramatura. Exemplos reais:
- Caixa Panetone — 300x300x350 — Quatro Abas — Ecopack Bobina
- Fechamento Simples do mesmo lado — 150x80x170 — Asa de Avião — Ecopack 280
- Fundo Aut.+Fechamento — 120x60x82 — rep. 2x2 — form. 385x758 — Fundo
  Automático — Supera Bobina 280
- Fechamento Hotmelt — 105x50x210 — rep. 2x1 — Quatro Abas — Stora Korsnas 280
- Caixa Fundo Aut.+Fechamento — 50x50x100 — rep. 3x3 — Aba invertida — Ecopack
  280
- Fech. Simples Lado Oposto — 33x33x77 — rep. 4x3 — Aba invertida — Supera

Ou seja: o "Formato/Modelo" é um GABARITO/FACA real cadastrado (GCad) que já
traz dimensões, repetição (encaixe), formato de corte, tipo de cartucho e
suporte. Selecionar o modelo PREENCHE automaticamente geometria + encaixe do
item. É a camada de **faca técnica real** (vs. o desenho esquemático que o Vizor
faz hoje).

## 2. Mapa Calcgraf → Vizor (o que já temos e o que falta)

| Recurso Calcgraf | Vizor hoje | Status |
|---|---|---|
| Orçamento = cabeçalho + N itens | OrcamentoGrafico = 1 item só | ⚠️ FALTA multi-item |
| Linha de Produto (Cartucho/Sacola/...) | TipoEmbalagem | ✅ equivalente |
| Suporte (Duplex 280) + CoefTinta | SuporteGrafico (importado) | ✅ feito |
| Preço do papel por gramatura | PrecoMateriaPrima | ⚠️ falta vincular ao suporte (CodOrigem) |
| Cores / Cobertura de Tinta (Manual/Escala/Especial) | StepCores | ✅ parcial |
| Acabamento → Atividades | AcabamentoGrafico + StepAcabamentos | ✅ feito |
| Acabamento → **Restrições** (sub-opção por atividade) | — | ❌ FALTA |
| Acondicionamento (Caixa Padrão + conteúdo/volume) | acabamento "Caixa Padrão" (MAT_UN) | ⚠️ parcial |
| Itens Diversos (FACA NOVA, CLICHÊS HOT) | itensDiversos (motor) | ✅ no motor; falta UI |
| Itens Fornecidos (material do cliente) | itensFornecidos (motor) | ✅ no motor; falta UI |
| Campos Livres (ARTE, PADRÃO) | observacoes | ⚠️ parcial |
| **Seleção de Modelos (GCad)** — faca/gabarito real | planificação esquemática | ❌ FALTA catálogo de facas |
| Form.Sup. / Formato de Corte / Mont (encaixe) | encaixe calculado | ✅ parcial (calculado, não escolhido) |
| Fechamento (Margem/C.Marg/Unit/Total por tiragem) | StepRevisao + simular-tiragens | ✅ feito |
| Comissões por agente | CEV único | ❌ fora do MVP (fase futura) |

## 3. Lacunas priorizadas (backlog para novas specs)

1. **Vínculo preço→suporte** (BLOQUEIA a validação do 15.235): os 1.774
   PrecoMateriaPrima de PAPEL estão com `suporteId` NULL. O de-para existe no
   Calcgraf via `Itc.CodOrigem` → `Suportes.Codigo`. Precisa de uma fase no
   importador que, para cada papel, resolva o suporte por `CG-SUP-<CodOrigem>` e
   grave `suporteId`. **FAZER JÁ** (destrava a tela). Ver seção 4.
2. **Orçamento multi-item** (um orçamento com vários cálculos/itens). Hoje o
   Vizor trata 1 orçamento = 1 item. Spec dedicada.
3. **Restrições por atividade de acabamento** (sub-opções que mudam acerto/
   custo — ex.: "Lateral Simples" vs "Fundo Automático Normal" na coladeira).
   Spec dedicada; afeta o cálculo do CT.
4. **Catálogo de Modelos/Facas (GCad)**: cadastro de facas reais com dimensões/
   repetição/formato de corte/suporte, selecionável no item (preenche geometria
   e encaixe reais). Spec dedicada; é a "faca técnica real" (alternativa ao
   desenho esquemático atual).
5. UI para Itens Diversos / Itens Fornecidos / Campos Livres no wizard (o motor
   já suporta; falta expor na tela).

## 4. Solução imediata do vínculo preço→suporte (seção 3.1)

De-para confirmado no `Itc.json`:
- Itc com `Origem='SUPORTE'` tem `CodOrigem` = código do suporte na tabela
  `Suportes` (ex.: "Supera Bobina 200" → CodOrigem 1; Duplex → 1051; Klabin
  Advanced Triplex → 1052).
- O `PrecoMateriaPrima.descricao` foi gravado como `Itc.Descritivo`.
- O `SuporteGrafico.codigo` foi gravado como `CG-SUP-<Suportes.Codigo>`.

Logo, a fase de vínculo deve: para cada Itc Origem=SUPORTE, achar o
PrecoMateriaPrima por `descricao` (= Descritivo, trim/slice 200) e setar
`suporteId` = id do SuporteGrafico `CG-SUP-<CodOrigem>`. Idempotente, por
empresa, só preenche quando `suporteId` está NULL (não sobrescreve vínculo
manual). Gramatura do papel também pode ser preenchida de `Itc.Gramatura`
quando ausente.
