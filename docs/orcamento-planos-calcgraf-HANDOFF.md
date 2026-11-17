# HANDOFF — Orçamento Gráfico: Item, Planos e Atividades (fiel ao Calcgraf)

> **Para qualquer agente/sessão:** este é o documento-mestre da conversa de 14/11/2026
> sobre reorganizar a tela do Orçamento Gráfico do Vizor para refletir como os usuários
> do Calcgraf já trabalham (Linha de Produto → Produto → Tipos de Plano → Atividades).
> **Nenhum código foi escrito para este tema ainda.** Estamos na fase de entendimento e
> alinhamento de desenho. Leia tudo antes de agir. Responder sempre em **português**.

---

## 0. Como usar este documento

1. Leia as seções 1 a 8 (pedido, dados da base, telas do Calcgraf, Vizor hoje, lacunas, proposta).
2. A seção 9 lista as **dúvidas que o usuário precisa fechar** (comece a nova sessão por elas).
3. A seção 10 traz o **estado do trabalho relacionado** (o que já foi entregue e commitado).
4. A seção 11 traz as **instruções operacionais** (como consultar a base, armadilhas do ambiente).
5. As imagens citadas estão transcritas na seção 4. Os arquivos originais (se o usuário os
   salvar) ficam em `docs/orcamento-planos-calcgraf/imagens/` (ver o README da pasta).

Documentos relacionados já existentes:
- `docs/fluxo-calculo-grafico-orcamento.md` e `docs/fluxo-orcamento-calcgraf-vs-vizor.md`
- `.kiro/steering/migracao-calcgraf-carton-wega.md` (histórico da migração Calcgraf → Vizor)
- Spec `.kiro/specs/orcamento-grafico-planos-fieis-calcgraf/` (já implementada, ver seção 10)

---

## 1. Pedido original do usuário (transcrição fiel)

> Vamos refinar o Orçamento. Precisamos organizar melhor as telas, e o entendimento dos
> usuários que já utilizavam o Calcgraf. Vou passar alguns pontos:
>
> **1-** Primeiro vamos pensar quando vou criar Linha de produto **Cartucho**: Ela tem um
> único plano, as informações a preencher são o que já conhecemos, e temos, mas verifique
> se há algo que ainda não disponibilizamos para input de informação. Acredito existir um
> cadastro de **Atividades**, que tem **restrições** já cadastradas, e **materiais**. Pois
> cada material que seleciono abre ao lado opções de restrições e materiais para marcar.
> (Seria importante investigar isso na base restaurada.)
>
> **2-** Quando seleciono o **Cartucho composto**, já existem algumas mudanças em relação
> ao cartucho.
> a) Abre opções de **produtos**.
> b) Esses campos de inputs são esses.
> c) Posso criar **infinitos Planos**.
> Conforme a seleção de **Cartão ou microondulados**, Acabamentos/Atividades é preenchido.
> Repare que se mudo o **Tipo de Produto** na tela de trás, as opções de **tipo de plano**
> mudam.
>
> Como existe este comportamento entre o cartucho e cartucho composto, os demais irei
> estudar e passar, mas seguem a mesma ideia de vários Planos. Esse formato de tela acaba
> não seguindo a visualização correta, penso que essas informações deveriam aparecer em
> **formato de grid de seleção ao clicar no item de orçamento**. E nesse grid deveria ter
> opção de **incluir, editar e excluir**, teremos que pensar uma **tela bem moderna** que
> ao clicar mostre ao lado as informações pertinentes desse plano, teremos que fazer um
> desenho para esse formato de forma que se encaixe com o que já temos, **separando as
> informações do todo do orçamento, e as informações detalhadas de cada plano**, isso
> deveria ficar bem claro para o usuário. Entende?
>
> Veja o que entendeu, e me dê parecer, para irmos conversando e refinando **antes de
> codar de fato**.

Fechamento da conversa: o usuário pediu esta documentação e que a conversa continue em
**nova sessão** (contexto da atual está cheio) para responder as dúvidas da seção 9.

---

## 2. Resumo do que foi entendido

O Calcgraf organiza o orçamento em **três níveis**:

| Nível | O que guarda | Exemplo |
|---|---|---|
| **Orçamento** | cliente, série, nº, data, reforma tributária 2027 | cabeçalho |
| **Item** | linha de produto, produto, tipo, descrição, tributação, sigla acabado, tiragens, modelos, medidas (Comp x Larg x Alt), abas, alt. tampa, **atividades de PRODUTO**, acondicionamento, conteúdo por volume, itens diversos/fornecidos, campos livres, observação, obs. áreas de OP | "Caixa" do Cartucho Composto |
| **Plano** | tipo de plano, nome, ocorrências, tiragem, montagem, corte, formatos, cores, processo, cobertura, **3 blocos de suporte**, fibra, sentido onda, ajuste corte micro, **atividades de PLANO** (+ restrições e materiais) | Cartão, Microondulado, Berço |

A cadeia de cadastro que controla as opções da tela:

1. **Linha de Produto** define os **Produtos** possíveis.
2. **Produto** define os **Tipos de Plano** permitidos (tabela `ProdutosxPlanos`).
3. **Tipo de Plano** (com a Linha) define **quais Atividades** aparecem (tabela `Roteiros`).
4. Cada **Atividade** é marcada `PLANO` ou `PRODUTO` (coluna `Atividades.PlanoProduto`):
   as de produto ficam no item; as de plano ficam dentro de cada plano.
5. Algumas atividades têm **Restrições** (sub-opções que alteram acerto/tempo) e **Materiais**.

**Cartucho simples** (linha 5) = 1 plano fixo; a tela junta item e plano (sem grade de planos).
**Cartucho Composto** e demais = N planos; o item tem uma grade "Tipos de Plano" com
Incluir/Editar/Excluir e um formulário de plano em janela separada.

---

## 3. Dados extraídos da base restaurada do Calcgraf

Banco: `CalcgrafCartonWega` (SQL Server local, instância padrão). Todas as consultas abaixo
foram SOMENTE LEITURA em 14/11/2026. Como reproduzir: seção 11.

### 3.1 Linhas de Produto (`_LinhasProduto`, 16)
1 LÂMINAS · 2 EDITORIAL · 3 LÂMINA SIMPLES · 4 CONTÍNUO · 5 CARTUCHO · 6 RÓTULO ·
7 BLOCADO · 8 PRÉ-IMPRESSÃO · 9 TAMPA/FUNDO · 10 DISPLAY · 11 SACOLA · 12 FLEXÍVEL ·
13 CARDS · 14 ETIQUETA FLEXO · 15 CARTUCHO COMPOSTO · 16 REVENDA.

O diálogo "Novo Item" do Calcgraf lista só 5 (as ativas/usadas): **CARTUCHO,
CARTUCHO COMPOSTO, LÂMINA SIMPLES, LÂMINAS, SACOLA**.

### 3.2 Tipos de Plano (`Planos`, 14 registros; coluna `CODLINHAPRODUTO`)
| Cód | Nome | Linha | Situação |
|---|---|---|---|
| 12 | Envelope | 1 LÂMINAS | ATIVO |
| 13 | Base | 1 LÂMINAS | ATIVO |
| 14 | Impressos | 1 LÂMINAS | ATIVO |
| 5 | Laminas | 2 EDITORIAL | ATIVO |
| 6 | Capa | 2 EDITORIAL | ATIVO |
| 7 | Miolo | 2 EDITORIAL | ATIVO |
| 1 | LÂMINA SIMPLES | 3 LÂMINA SIMPLES | FIXO |
| 2 | CARTUCHO | 5 CARTUCHO | FIXO |
| 3 | RÓTULO | 6 RÓTULO | FIXO |
| 4 | SACOLA | 11 SACOLA | FIXO |
| 8 | Cartão | 15 CARTUCHO COMPOSTO | ATIVO |
| 9 | Microondulado | 15 CARTUCHO COMPOSTO | ATIVO |
| 10 | Berço | 15 CARTUCHO COMPOSTO | ATIVO |
| 11 | Invólucros | 15 CARTUCHO COMPOSTO | ATIVO |

"FIXO" = plano único implícito da linha (o usuário não escolhe).

Colunas úteis de `Planos`: `FORMATO, FIBRA, TipoTampaFundo, TipoAcrescimoCorteTf,
AcrescimoCorteTf1/2, CodSuporteDefault, GramaturaSuporteDefault, DistEntreImagens,
CorteDuploMin, CodMontagem, FlagPinca, FlagFrenteIgualVerso, DesconsDistCapaExterna,
FlagNaoConstarProposta, DefFibra, FlagCaderno, FlagNaoSepararComponentesPorOcorrencia,
QUEBRAPADRAO, MARGEM1, MARGEM2`.

### 3.3 Produtos (`Produtos`, 12) e planos permitidos (`ProdutosxPlanos`)
| Cód | Produto | Linha | Tipos de plano permitidos |
|---|---|---|---|
| 1 | Cartuchos | 5 CARTUCHO | CARTUCHO (fixo) |
| 2 | Cartucho Composto | 15 | Cartão, Microondulado |
| 3 | Sacola | 11 SACOLA | SACOLA (fixo) |
| 4 | Cartelas | 15 | Cartão, Microondulado |
| 5 | Caixa | 15 | Cartão, Microondulado, **Berço** |
| 6 | Invólucros | 15 | Invólucros |
| 7 | Impressos | 3 LÂMINA SIMPLES | LÂMINA SIMPLES (fixo) |
| 8 | Envelope | 1 LÂMINAS | Envelope |
| 9 | Display | 1 LÂMINAS | (nenhum cadastrado em ProdutosxPlanos) |
| 10 | TESTE | 5 | CARTUCHO — **CANCELADO** |
| 11 | Impressos | 1 LÂMINAS | Envelope, Base, Impressos |
| 12 | Venda de Cartão | 3 LÂMINA SIMPLES | LÂMINA SIMPLES (fixo) |

(`ProdutosxPlanos` tem 18 registros; a junção listou 17, 1 sem correspondência.)

`ProdutosxPlanos` também guarda **padrões por produto×plano**: `CodProcessoImpressao,
CodCoberturaTinta, CoresF, CoresV, AreaTinta, FlagSemImpressao, NomeFabricanteSup`.
`Produtos` tem ~55 colunas (ex.: `Formato, Fibra, TipoCartucho, CodTributacaoVenda,
AbaColaLateral, AbaColaFundo, PrazoProducao, FlagExibirMontagem, FlagExibirFormatoCorte,
FlagFatMinimo, ValFaturamentoMinimo, refileLateral, flagSanfona*...`).

### 3.4 Atividades (`Atividades`, 68 registros)
Colunas: `Codigo, Ativo, Nome, PlanoProduto, CodNegocio, TipoAtividade, ChaveDicionario,
TextoProposta, FlagExibirNomePlanoProposta, OrdemPrioridadeAtv, FlagAtvForte, AumTempoPerc,
AumTempoMin, FlagUtilizaCTP`.

Distribuição (todas não-inativas): **PLANO/Acabamento 43 · PLANO/Impressão 7 ·
PRODUTO/Acabamento 18** (total 68).

**As 18 atividades de nível PRODUTO** (aparecem no item, não no plano):
Botão de pressão (27) · Caixa Padrão (39) · Colagem Manual (54) · Colar envelopes (35) ·
Colocação de Alça (26) · Colocação Ilhós (30) · Colocação velcro (31) · Embalar (53) ·
Envase (33) · Envelope 2 partes (50) · Envelope Simples (49) · Poliéster (32) ·
Sacola 2 + alça (45) · Sacola 2+alça+ilhós (46) · Sacola s/alça 2 part (48) ·
Sacola sem alça (47) · Sacola+alça+ilhós (44) · Sacola+aplic.alça (36).

### 3.5 Roteiros — QUAL atividade aparece em QUAL plano (`Roteiros`, 422 linhas)
Colunas: `CodLinhaProduto, CodPlanoCad, Ordem, CodAtividade, FlagCheck`.
`CodPlanoCad = 0` ⇒ atividades de **produto** daquela linha; `> 0` ⇒ atividades do **plano**.

| Linha | Plano | Qtd atividades |
|---|---|---|
| 1 LÂMINAS | (produto) 0 | 9 |
| 1 LÂMINAS | Envelope | 38 |
| 1 LÂMINAS | Base | 40 |
| 1 LÂMINAS | Impressos | 40 |
| 3 LÂMINA SIMPLES | (produto) 0 | 5 |
| 3 LÂMINA SIMPLES | LÂMINA SIMPLES | 40 |
| 5 CARTUCHO | (produto) 0 | 5 |
| 5 CARTUCHO | CARTUCHO | 41 |
| 11 SACOLA | (produto) 0 | 13 |
| 11 SACOLA | SACOLA | 36 |
| 15 CARTUCHO COMPOSTO | (produto) 0 | 6 |
| 15 CARTUCHO COMPOSTO | Cartão | 43 |
| 15 CARTUCHO COMPOSTO | **Microondulado** | **28** |
| 15 CARTUCHO COMPOSTO | Berço | 43 |
| 15 CARTUCHO COMPOSTO | Invólucros | 35 |

Isto explica por que a lista de acabamentos muda quando o usuário troca o tipo de plano
(ex.: Microondulado tem lista menor e inclui Dayuan, Destacar, Diana, Fechadora de Caixa,
Fita dupla face 2, Guilhotina de envol).

Tabelas verificadas e **vazias/irrelevantes** para este tema: `AtividadesJuntaPlanos` (0 —
é sobre "juntar planos"), `AtividadesxLinha` (0), `ProdutosxRestricoes` (0).
`ProdutosxAtividades` tem 3 registros (padrões por produto: `CodProduto, CodPlano,
CodAtividade, CodMatAcabamento, ConteudoAcond`).
`_CaracteristicasPlano` (204 registros: `codLinhaProduto, codPlano, NomeCampo, ValorCampo`)
guarda parametrização por plano, principalmente de EDITORIAL/LÂMINAS (ex.: "Plano Miolo",
"Tipo Largura", "Tipo Ocorrencia", "Cálc.Autom.Formato", "Somar orelhas/lombada").

### 3.6 Restrições (`RestricoesManuais`, 59 registros)
Colunas: `Codigo, Ativo, Nome, CodAtividade, flagExibirProposta`.
**Só 12 atividades têm restrições, todas de nível PLANO:**

| Atividade | Qtd |
|---|---|
| AFT70 (Coladeira) | 9 |
| Bobst 68 (Coladeira) | 9 |
| Diana (Coladeira) | 9 |
| Jato (acoplagem) | 6 |
| Bobst E (Corte e Vi | 5 |
| Bobst S (Corte e Vi | 5 |
| Dayuan (Corte e Vinc | 5 |
| Mazola (acoplagem) | 4 |
| Bimac (Acoplagem) | 3 |
| HotStamping | 2 |
| CVM (Corte e vinco) | 1 |
| CVMR (Corte e vinco) | 1 |

Restrições de **AFT70 (Coladeira)** (9): Acerto Acoplado Colagem Lateral · Acerto Acoplado
Fundo Automático · Acerto Lateral Alterando o Tamanho · Acerto Saindo Fundo Aut.para Lateral
· Acerto Saindo Lateral para Fundo Aut. · Acerto Trocando Versão · Fundo Automático Normal ·
Lateral Simples · Lateral Simples Pequeno.
Restrições de **Bimac (Acoplagem)** (3): Cartão+Micro (Bobina Cortada) · Cartão+Micro
Fornecido · Micro.

### 3.7 Materiais por atividade — PARCIALMENTE CONFIRMADO
Na tela do Calcgraf (imagem 2), ao marcar AFT70 aparecem **Materiais: Cola Branca, Cola
Quente**. **Não localizei** na base a tabela de cadastro que liga atividade → lista de
materiais selecionáveis. O que existe: `CalculoMatAcabamento` (uso por cálculo: `Codigo,
CodMaterial, codAtvAcabamento, codPlanoAcabado, ParamAcab1, ParamAcab2, TipoParamAcab`;
nome do material em `Itc.Descritivo`) e `WebCalculoMatAcabamento`. Exemplos de materiais
em uso por atividade: AFT70 → Supera Bobina 265/280; Bimac → Print Kot Bobina 250;
Colagem de acetato → Ritagli Bobina 300/350; Laminação maior → Epicus 230 / Supera 252/265;
Plastificadora → Print Kot 300 / Ritagli 250; HotStamping → Supera White 280 / Epicus 230.
**PENDÊNCIA:** pedir ao usuário a tela de cadastro da atividade (aba Materiais) ou investigar
mais antes de modelar (ver seção 9, item 1).

---

## 4. As 14 imagens que o usuário enviou (transcrição detalhada)

Observação: os arquivos de imagem não puderam ser copiados do chat para o disco pelo agente.
Cada tela está transcrita abaixo. Se o usuário salvar os originais, usar os nomes sugeridos em
`docs/orcamento-planos-calcgraf/imagens/README.md`.

### Imagem 01 — Calcgraf: janela "CARTUCHO" (linha CARTUCHO, plano único)
Janela "CARTUCHO" dentro de "Orçamentos". Campos, na ordem de tela:
- **Produto** (combo, aberto mostrando só "Cartuchos"), **Tipo de Produto** ("Cartuchos"),
  **Descrição**, **Sigla Acabado** (+ ícone binóculos e ícone de documento), **Tributação**
  (combo "ICMS + IPI").
- **Tiragem**, **Modelos** (`x 1`), **Cores** (`0 x 0`), **Processo de Impressão** (combo
  "Offset Plana", desabilitado) + botão **Pre** + **cadeado** amarelo, **Cobertura de Tinta**
  (combo + ícone de pasta).
- **Fabricante** (combo "(todos)"), **Suporte** (combo) + botão **NC**, **Form.Sup.**,
  checkbox **Fornecido**, **Microondulado** (combo) + ícone de cópia.
- **Comp x Larg x Alt** (`0 x 0 x 0`), **Aba Cola**, **Aba Fec.**, checkbox **Fibra**, ícone de
  imposição/faca, **Mont**, **Formato de Corte**, **Ajuste Corte Micro.** (`0` mm) + ícone de
  propriedades.
- Grupo **Acabamento → Atividades** (lista com checkbox): AFT70 (Coladeira), Bimac
  (Acoplagem), Bobst 68 (Coladeira), Bobst E (Corte e Vi, **Bobst E\CV\Relevo** (linha
  destacada), Bobst S (Corte e Vi, CVM (Corte e vinco), CVMR (Corte e vinco), Colagem Manual,
  Colagem de acetato, Colocação de Alça… (com rolagem).
- Grupo **Acondicionamento**: lista (Caixa Padrão, Embalar) + caixa de texto + **Conteúdo por
  volume**.
- Botões inferiores: **Itens Diversos**, **Itens Fornecidos**, **Campos Livres**,
  **Observação**, **Obs.Áreas de Op**, botão de sair (porta verde).
**Leitura:** no Cartucho, item e plano são a MESMA tela; não há grade de planos.

### Imagem 02 — Calcgraf: zoom em "Acabamento" (Atividades → Restrições → Materiais)
Mesma área, ampliada, com **três painéis**:
- **Atividades:** AFT70 (Coladeira) [selecionada], Bimac (Acoplagem), Bobst 68 (Coladeira),
  Bobst E (Corte e Vi, Bobst E\CV\Relevo, Bobst S (Corte e Vi, CVM, CVMR, Colagem Manual,
  Colagem de acetato, Colocação de Alça.
- **Restrições** (painel à direita, lista acinzentada/desabilitada até a atividade ser
  marcada): Acerto Acoplado Colagem Lateral · Acerto Acoplado Fundo Automático · Acerto
  Lateral Alterando o Tamanh… (rolagem).
- **Materiais** (painel abaixo): **Cola Branca** [destacada], **Cola Quente**.
**Leitura:** ao marcar uma atividade, abrem ao lado as suas restrições e materiais. Isto é o
que o usuário pediu para investigar (seção 3.6 e 3.7).

### Imagem 03 — Calcgraf: diálogo "Novo Item" (escolha da Linha de Produto)
Tela "Orçamentos" em modo **Inclusão**: Série (vazia), Nº Orçamento `0000000`, Data
`14/11/2026`, **Cliente Principal** código `78` nome `PROBELLE` (ícones de busca), checkbox
**Reforma Tributária 2027**, grade "Itens do Orçamento" (colunas: item, Cálculo, Linha de
Produto, Tipo de Produto, Tiragem…, Status), painel **Dados do Item**, abas **Fechamento** /
**Comissões**. Sobre ela, o diálogo **"Novo Item — Selecione a Linha de Produto"** com a lista:
CARTUCHO · **CARTUCHO COMPOSTO** (selecionada) · LÂMINA SIMPLES · LÂMINAS · SACOLA; botões ✗ e ✓.

### Imagem 04 — Calcgraf: "CARTUCHO COMPOSTO", combo Produto aberto
Janela "CARTUCHO COMPOSTO" com **Produto** (combo vazio, aberto) listando: **Caixa, Cartelas,
Cartucho Composto, Invólucros**; **Tipo**; **Tributação**; **Descrição**; **Sigla Acabado**
(+ ícones); **Tiragens**; **Modelos** (`x 1`); **Alt Tampa** (`0`) + ícone de propriedades.

### Imagem 05 — Calcgraf: "CARTUCHO COMPOSTO" com produto escolhido
Produto "Cartucho Composto", Tipo "Cartucho Composto", **Tributação** (combo aberto:
"ICMS + IPI"), Descrição, Tiragens, Modelos `x1`, **Comp x Larg x Alt** (`0 x 0`, com ícone de
ajuda), **Aba Cola**, **Aba Fec.**, **Alt Tampa** (`0`) + ícone.

### Imagem 06 — Calcgraf: grade "Tipos de Plano" (vazia)
Grupo **Tipos de Plano** com grade de colunas **Nome · Suporte · Cores · Formato ·
Acabamento**. Botões à direita da grade, em ordem: **Incluir** (verde), **Editar**,
**Excluir** (vermelho), **trocar/mover** (setas azuis), **desfazer** (cinza).
**Leitura:** esta é a grade que o usuário quer modernizar (Incluir/Editar/Excluir).

### Imagem 07 — Calcgraf: "Inclusão de Tipo de Plano" (produto Cartucho Composto), combo aberto
Janela modal "Inclusão de Tipo de Plano". **Tipo de Plano** (combo aberto) lista:
**Cartão, Microondulado**. Estrutura completa do formulário do plano (a mesma em todas as
variações):
1. **Tipo de Plano**, **Nome** (+ ícone de pasta), **Ocor.** (ocorrências), **Tiragem**
   (`(padrão)`).
2. Ícone de imposição, **Mont**, **Corte**, **Formato Aberto**,
   **Form.Final (Comp x Larg x Alt x AltTampa)** (com ajuda).
3. **Cores** (`0 x 0`), **Processo de Impressão** (Offset Plana) + **Pre** + cadeado,
   **Cobertura de Tinta** + ícone de pasta.
4. Bloco **capa externa**: **Fabricante**, **Suporte capa externa** + **NC** + **Fornecido**,
   **Fibra capa externa** (Indiferente).
5. Bloco **microondulado**: **Fabricante**, **Suporte microondulado** + **NC** + **Fornecido**,
   **Sentido onda** (Indiferente); **Ajuste Corte Micro.** (`0` mm).
6. Bloco **capa interna** (moldura própria): **Fabricante**, **Suporte capa interna** + **NC**
   + **Fornecido**; e, abaixo, **Cores**, **Processo de Impressão**, **Cobertura de Tinta**
   da capa interna.
7. Grupo **Acabamento → Atividades**: lista **vazia** enquanto o Tipo de Plano não é escolhido.
Ao fundo, o item mostra "Acabamentos de [produto]": Colagem Manual, Colocação de Alça, Envase.

### Imagem 08 — Calcgraf: tipo de plano "Cartão" selecionado
Nome preenchido "Cartão", Ocor. `1`, Tiragem `(padrão)`, Cores `0 x 0`, Processo "Offset
Plana". Lista de **Acabamento → Atividades** preenchida automaticamente: AFT70 (Coladeira),
Bimac (Acoplagem), Bobst 68 (Coladeira), Bobst E (Corte e Vi, Bobst E\CV\Relevo, Bobst S (Corte
e Vi, CVM (Corte e vinco), CVMR (Corte e vinco), Colagem de acetato, Cortadeira (Grande),
Cortadeira (Pequena)… (rolagem). Fabricantes aparecem como "(todos)".

### Imagem 09 — Calcgraf: tipo de plano "Microondulado" selecionado
Nome "Microondulado". Lista de atividades **diferente e menor**: AFT70 (Coladeira), Bimac
(Acoplagem), Bobst 68 (Coladeira), Bobst E\CV\Relevo, Cortadeira (Grande), Dayuan (Corte e
Vinc), Destacar, Diana (Coladeira), Fechadora de Caixa, Fita dupla face 2, Guilhotina de
envol… **Leitura:** a lista de atividades muda conforme o tipo de plano (regra `Roteiros`).

### Imagem 10 — Calcgraf: produto "Caixa", combo Tipo de Plano aberto
Produto "Caixa". **Tipo de Plano** lista: **Berço, Cartão, Microondulado** (três opções,
diferente do Cartucho Composto que tem duas).

### Imagem 11 — Calcgraf: tipo de plano "Berço" selecionado (produto Caixa)
Nome "Berço". Atividades: AFT70 (Coladeira), Bimac (Acoplagem), Bobst 68 (Coladeira), Bobst E
(Corte e Vi, Bobst E\CV\Relevo, Bobst S (Corte e Vi, CVM (Corte e vinco), CVMR (Corte e vinco),
Colagem de acetato, Cortadeira (Grande), Cortadeira (Pequena)…

### Imagem 12 — Calcgraf: produto "Invólucros", combo Tipo de Plano aberto
Produto "Invólucros". **Tipo de Plano** lista só: **Invólucros**.

### Imagem 13 — Calcgraf: tipo de plano "Invólucros" selecionado
Nome "Invólucros". Atividades: AFT70 (Coladeira), Bimac (Acoplagem), Bobst 68 (Coladeira),
Bobst E (Corte e Vi, Bobst S (Corte e Vi, CVM (Corte e vinco), CVMR (Corte e vinco),
Cortadeira (Grande), Cortadeira (Pequena), Dayuan (Corte e Vinc, Diana (Coladeira)…

### Imagem 14 — VIZOR hoje: item "Caixa Tampa e Fundo (fundo)" com a seção "Planos do Cálculo"
Tela de detalhe do orçamento no Vizor (tema escuro). Seção **Itens do Orçamento** com botões
"Enviar OP em lote", "Localizar Cálculo", "+ Novo Item". Linha do item: Seq 1, Linha de
Produto "Caixa Tampa e Fundo (fundo)", Descrição "CAIXA DE PAPELÃO P/5KG DE ELETRODO
SERRALHEIRO CÓD. 1000841", Tiragem 107.000, Custo Produção R$ 64.491,72, Valor Total
R$ 100.580,00. Expandido: "Qtd. de matrizes: 2 · Preço unitário da matriz: R$ 45,00";
subseção **"Planos do cálculo — Item #1"** com botão "+ Novo plano" e grade (Seq., Nome,
Suporte orçado, Suporte de produção, Formato (L×A), Cores, Custo do plano, Ações) contendo
**2 planos "Cartão"**, formato 284 × 488 mm, cores 0, custo R$ 0,00 (o suporte orçado vem
"—" e o de produção "Selecione o suporte"); "Total dos planos R$ 0,00"; acordeão "Histórico
de trocas de suporte"; rodapé "Total consolidado R$ 64.491,72 / R$ 100.580,00".
**Leitura:** o Vizor mostra os planos como uma tabela simples embaixo do item, separada do
editor do item; faltam os campos ricos do plano do Calcgraf (ver seção 6).

---

## 5. O que o Vizor tem HOJE (verificado no schema e no código)

- `AcabamentoGrafico` (`prisma/schema.prisma`, ~linha 3197): `tipoAtividade` (IMPRESSAO|
  ACABAMENTO), **`planoProduto` (PLANO|PRODUTO)**, `naturezaCusto`, `centroProducaoId`,
  custos/tempos, `exigeRestricao`, **`materiais` (Json, só informativo, não entra em preço)**.
- `RestricaoAcabamento`: sub-opção por atividade com `tempoAcertoMin`/`tempoOperacaoMin`
  (sobrepõe acerto no Custo de Transformação).
- `LinhaProduto` (só `codigo`, `nome`, `ativo`): classifica o trabalho; "é o seletor inicial
  do orçamento e orienta quais campos aparecem (mapeamento fixo no frontend)".
- `TipoEmbalagem` (cadastro separado; usado pelo motor de planificação/fórmulas).
- `MaterialAcabamento` (catálogo com preço de referência), `MaterialMicroondulado`,
  `CoberturaTinta`, `ProcessoImpressao`, `ModeloFaca`.
- `ItemOrcamentoGrafico`: guarda no **item** `processoImpressao`, `coberturaTintaTexto`,
  `fabricante`, `microondulado`, `fornecido`, `fibra`, medidas, abas, montagem, `acondicionamento`,
  `acabamentosRicos` (inclui seleção informativa `restricaoNome/materialNome/medidaMm` — P16).
- `PlanoCalculoGrafico` (filho do item): `sequencia, nome, suporteId, suporteProducaoId,
  gramatura, formatoLarguraMm/AlturaMm, numCores, cores, maquinaId, acabamentosRicos,
  preImpressao, resultadoCalculo, custoSuporte/Impressao/Acabamento`, + histórico de troca de
  suporte. Rotas CRUD em `/api/orcamento-grafico/:id/itens/:itemId/planos`. Front:
  `src/app/(interna)/orcamento-grafico/[id]/PlanosDoItem.tsx` (tabela + modal simples).
- Front do orçamento: `[id]/page.tsx` (detalhe), `[id]/EditorItem.tsx` + pasta `[id]/editor/`
  (editor de página única com âncoras), `[id]/ItemWizardModal.tsx`, `NovoOrcamentoModal.tsx`.

## 6. Lacunas (Calcgraf × Vizor)

1. **Produto** como nível de cadastro (Cartucho Composto, Caixa, Cartelas, Invólucros,
   Impressos, Envelope, Display…) não existe no Vizor (só Linha e Tipo de Embalagem).
2. **Tipo de Plano** como cadastro (Cartão, Microondulado, Berço, Invólucros, Envelope, Base,
   Impressos…) e o vínculo **Produto → Tipos de Plano permitidos** não existem.
3. **Atividades por tipo de plano** (`Roteiros`): hoje todas aparecem sempre.
4. **Campos do plano** ausentes em `PlanoCalculoGrafico`: tipo de plano, ocorrências,
   tiragem própria, montagem, corte, formato aberto, form. final, processo de impressão,
   cobertura de tinta, **3 blocos de suporte** (capa externa / microondulado / capa interna,
   cada um com fabricante, NC, fornecido), fibra da capa externa, sentido da onda, ajuste de
   corte do micro, cores/processo/cobertura da capa interna. Hoje fabricante/processo/cobertura
   vivem só no **item**.
5. **Atividades de produto vs de plano** não separadas na tela (no Calcgraf: produto no item,
   plano dentro do plano).
6. **Restrições e materiais ao lado da atividade marcada** (painel dependente) — o cadastro
   existe, a interação não.
7. **Tela**: Vizor mostra planos como tabela abaixo do item; não há mestre-detalhe.

---

## 7. Proposta de desenho (parecer dado ao usuário — ainda NÃO aprovada)

Painel **mestre-detalhe** ao clicar no item do orçamento, com separação visual explícita:

```
 ORÇAMENTO 3228 › ITEM 1  Caixa (Cartucho Composto)
┌──────────────────────────┬─────────────────────────────────────┐
│ DADOS DO ITEM            │ PLANOS DO ITEM        [+ Incluir]   │
│ (valem p/ o produto todo)│ ┌─────────────────────────────────┐ │
│ Produto, Descrição       │ │ Nome      Suporte  Cores Formato│ │
│ Tiragens, Modelos        │ │▶Cartão    Klafold  4x0   284x488│ │
│ Medidas, Abas, Alt.Tampa │ │ Micro     Pardo    0x0   795x655│ │
│ Atividades de PRODUTO    │ └──────────────[Editar][Excluir]──┘ │
│ Acondicionamento         │ PLANO SELECIONADO: Cartão           │
│ Itens diversos/forn.     │ (abas: Geral | Suportes | Cores |   │
│ Observação               │  Acabamentos | Restrições/Materiais)│
└──────────────────────────┴─────────────────────────────────────┘
```

Princípios:
- **Três níveis visíveis** (Orçamento / Item / Plano) com cor e rótulo próprios e "caminho"
  no topo (Item 1 › Plano Cartão). Totais do orçamento/item sempre fixos.
- Tipo de plano filtrado pelo **Produto**; atividades filtradas pelo **Tipo de Plano**
  (regra `Roteiros`); atividade marcada abre restrições e materiais ao lado.
- **Plano único** (Cartucho, Sacola, Lâmina simples): sem grade; o plano abre direto no
  formulário (existe "Plano 1" por baixo, coerente com a spec já entregue).
- **Um único formulário de plano** para todos os tipos, guiado pelo cadastro (nas telas do
  Calcgraf o formulário é idêntico para Cartão/Micro/Berço/Invólucros; só mudam o Tipo e a
  lista de atividades).
- Proposta de execução em duas frentes: (a) cadastros + importação do Calcgraf (produto, tipo de
  plano, produto×plano, roteiros); (b) nova tela mestre-detalhe. Via spec (design-first).

---

## 8. Restrições que o usuário já impôs (não esquecer)

- **Não codar antes de refinar** o desenho com o usuário.
- Não mencionar a palavra "Calcgraf" em texto visível das telas de orçamento (comentários de
  código e telas de Biblioteca de Cálculos são exceção).
- Não inventar dado sem fonte na base (ex.: campos sem origem ficam manuais).
- Mudança de schema exige `prisma/migrate-prod.ts` idempotente no MESMO commit.
- `empresaId` explícito em toda query (multi-tenant). Empresa Wega produção:
  `75848e24-742e-461d-b913-1642c5b83ae9`.

---

## 9. DÚVIDAS A FECHAR COM O USUÁRIO (começar a nova sessão por aqui)

1. **Materiais por atividade.** Não achei a tabela do cadastro "Atividade → Materiais" (ex.:
   AFT70 → Cola Branca / Cola Quente). Pedir a tela de cadastro da atividade no Calcgraf (aba
   Materiais) ou continuar a investigação na base antes de modelar.
2. **Um único formulário de plano** guiado pelo cadastro (Tipo de Plano + Produto + Roteiros)?
3. **Produto como cadastro novo** no Vizor: importar os 12 produtos, 14 tipos de plano,
   18 `ProdutosxPlanos` e 422 `Roteiros` da base (migração de cadastro, sem mexer em cálculo)?
   Ou reaproveitar `TipoEmbalagem`?
4. **Plano único sem grade** (Cartucho, Sacola, Lâmina simples): aprovado?
5. **Outras linhas** (Lâminas, Editorial, Sacola, Rótulo…): o usuário prometeu passar o
   comportamento. Pelo cadastro, Editorial tem Laminas/Capa/Miolo e Lâminas tem
   Envelope/Base/Impressos, então o mesmo modelo deve servir.
6. **Os 3 blocos de suporte** (capa externa / microondulado / capa interna): em todo tipo de
   plano aparecem os três no Calcgraf? Algum tipo desabilita blocos? (o formulário é igual nas
   telas, mas confirmar regra de uso.)
7. **Tela ao clicar no item**: painel lateral (drawer) ou página dedicada? O usuário falou em
   "mostrar ao lado as informações pertinentes desse plano".
8. **Atividades de produto**: o Calcgraf mostrou só 3 na tela do Cartucho Composto (Colagem
   Manual, Colocação de Alça, Envase) mas `Roteiros` indica 6 para a linha 15 (produto 0).
   Confirmar qual é a regra exata (pode filtrar por Produto).

---

## 10. Estado do trabalho relacionado (já entregue nesta sessão — para não refazer)

Todos commitados na `main`, ambos os repositórios (back `c:\Source\VisioFab.Wms.Back`,
front `c:\Source\VisioFab.Wms.Front`, repos separados; commits só quando o usuário pede).

**Orçamento gráfico**
- Puxar cálculo agora preenche `tributacao`, `siglaAcabado`, `processoImpressao` (Offset Plana)
  quando migrado. Commit back `60bf26df4`. Cobertura de tinta, fabricante, arte, observação
  permanecem manuais (sem fonte).
- **Planos fiéis ao Calcgraf** (spec `.kiro/specs/orcamento-grafico-planos-fieis-calcgraf/`,
  design-first, 7/7 tarefas): ao puxar um cálculo, cria os `PlanoCalculoGrafico` a partir de
  `resultado_calculo.planos[]` da foto rica (2+ planos → todos; 0/1 → "Plano 1"); custos dos
  planos = 0 (detalhamento; o custo do item continua ancorado no valor real). Mapeador puro
  `calculo-grafico/foto-planos.service.ts` (+10 testes). Script de backfill
  `scripts/backfill-planos-itens-orcamento.ts` (só RASCUNHO, `--empresa`, `--dry-run`).
  Commit back `3e1b421f9`. **Pendente:** rodar o backfill sem `--dry-run` (2 itens candidatos
  em produção) e validar na tela puxando o cálculo 11121 (Cartucho Composto, 2 planos reais).
- Dados da base que sustentam isso: no Calcgraf, 8.062 cálculos vigentes, **0 com zero
  planos**; 6.051 com 1 plano; 2.011 com 2+; CARTUCHO COMPOSTO é 90% multi-plano (1.793/1.994).
  A foto rica dos 7.951 migrados já traz `planos[]`.

**PCP (mesma sessão, para contexto)**
- Filtros no Quadro de Produção; permissão `podeRetornarEtapa`; formato do micro na Acoplagem
  (tag `[FormatoMicro]`, parser + tela + impressão; 68 OPs de acoplagem gravadas em produção);
  flag `disponivelQuadroProducao` no centro; aba "Requisições de Corte" na lista de OPs.
  Commits back `6f4c31d4f`, `34be13c6c`; front `0e00dbe`, `33283e4`, `248d064`, `ee7a833`.

---

## 11. Instruções operacionais (armadilhas reais do ambiente)

- **Shell Windows/PowerShell.** O PSReadLine trava com saída grande/linha longa
  (`SetCursorPosition`). Sempre: escrever SQL/scripts em arquivo, redirecionar saída para
  arquivo e ler depois. Para `git`: `git ... 2>&1 | Out-File _tmp-x.txt` e `Get-Content`.
  `git push` retorna exit ≠ 0 mesmo com sucesso; confirmar com `git log origin/main --oneline -1`.
- **Base restaurada do Calcgraf:** `sqlcmd -S localhost -E -C -d CalcgrafCartonWega -W -u
  -i arq.sql -o arq.out` e ler com `Get-Content arq.out -Encoding Unicode` (o `-u` gera
  UTF-16; sem isso os acentos corrompem). `-C` é obrigatório. Não usar `-s "|"` com `-W`
  (corrompe a saída). Alias de tabela `end` é reservado.
  Um `NumCalculo` pode ter várias linhas em `CalculoHeader`: usar a de maior `Codigo`.
- **Produção (Neon):** a connection string vem de variável de ambiente
  (`DATABASE_URL_PROD`), nunca em arquivo versionado. Scripts de produção são só leitura salvo
  autorização explícita do usuário. Remover todo `_tmp-*` ao terminar.
- **Validação:** `get_diagnostics` limpo é a validação confiável. `tsc` inteiro e `next build`
  travam nesta máquina. Vitest: iniciar com `control_pwsh_process`, aguardar ~40s, ler a saída e
  parar o processo. O `migrate-prod.ts` tem 8 erros de tipo preexistentes (`'e' is of type
  'unknown'`, linhas ~4004+), não relacionados.
- **Arquivos que NUNCA entram em commit:** front: `src/app/(interna)/configurador/produtos/page.tsx`
  e `src/data/hooks/useProduto.ts`. Back: `docs/contrato-anexo-I-escopo.txt`, `OP-*.pdf`,
  `docs/AVISO-WHATSAPP-NOVIDADES-PCP.md`. Nunca `git add .`; adicionar arquivos específicos.
- **Fluxo de spec (Kiro):** design-first ou requirements-first; não criar arquivos de spec antes
  de o usuário escolher o ponto de entrada. Specs em `.kiro/specs/<nome>/`.
- **Respostas ao usuário sempre em português.**


---

## 12. SESSÃO 2 (14/11/2026): Lâmina Simples, Lâminas, Sacola e o fluxograma do sistema

O usuário enviou 18 telas das linhas LÂMINA SIMPLES, LÂMINAS (Display / Envelope / Impressos) e
SACOLA. Tudo abaixo foi confirmado na base restaurada (somente leitura). Onde a base não
tem a regra, está marcado como **HIPÓTESE** ou **NÃO ENCONTRADO**.

### 12.1 Fluxograma do Calcgraf (cadeia de cadastros que monta a tela)

```
Novo Item
  └─ LINHA DE PRODUTO (_LinhasProduto; só 5 ativas no diálogo: Cartucho, Cartucho Composto,
  │                     Lâmina Simples, Lâminas, Sacola)
  └─ PRODUTO (Produtos.CodLinhaProduto)  ── combo "Produto"; preenche "Tipo de Produto"
  │      define: Formato do item (Produtos.Formato), unidade (UN/mil), tributação padrão,
  │              CodFechamento, FormatoDef1/2 (formato padrão), flags de aba/sanfona
  └─ TIPOS DE PLANO permitidos (ProdutosxPlanos: CodProduto → CodPlano)
  │      e padrões por produto×plano: CodProcessoImpressao, CoresF/V, FlagSemImpressao, fabricante
  └─ PLANO (Planos): Formato do plano (Planos.FORMATO), fibra, tampa/fundo, margens, quebra
  └─ ATIVIDADES do plano   = Roteiros(CodLinhaProduto, CodPlanoCad = plano)   ← lista muda por plano
  └─ ATIVIDADES do produto = Roteiros(CodLinhaProduto, CodPlanoCad = 0)       ← ficam no item
        cada Atividade (Atividades) tem: PlanoProduto (PLANO|PRODUTO), TipoAtividade
        (Acabamento|Impressão) e ChaveDicionario (define ONDE aparece na tela):
           "Informação Complementar, Simular"                  → lista "Acabamento/Atividades"
           "Informação Complementar, Acondicionamento, Simular" → painel "Acondicionamento"
        e pode ter RestricoesManuais (12 atividades, 59 restrições)
```

Regras confirmadas:
1. **Acondicionamento é um filtro de Atividade, não um cadastro à parte.** Só duas atividades de
   produto têm a chave "Acondicionamento": **Caixa Padrão (39)** e **Embalar (53)**. Por isso o
   painel "Acondicionamento" mostra só essas duas (ou só Embalar, conforme o produto).
2. **Processo de Impressão** = atividade de tipo Impressão do roteiro do plano (Offset Plana).
   Na prática, na Wega, é sempre "Offset Plana" (combo desabilitado). O default vem de
   `ProdutosxPlanos.CodProcessoImpressao` (=2 para Impressos 7, Envelope 8, Impressos 11/14).
3. **Plano de linha "FIXO"** (Cartucho, Lâmina Simples, Sacola, Rótulo): o plano existe, mas o
   usuário não o escolhe nem o vê como grade. A tela junta item e plano.
4. **Linhas com grade de planos** (Lâminas, Cartucho Composto, Editorial): item + grade
   "Tipos de Plano" (Nome, Suporte, Cores, Formato, Acabamento) + janela "Inclusão de Tipo de
   Plano". O mesmo tipo de plano pode se repetir (nomes livres).
5. **Quando o Produto muda, três coisas mudam:** (a) os tipos de plano do combo, (b) o formato
   pedido no item, (c) as atividades de produto e acondicionamento exibidas.

### 12.2 Linha 3 — LÂMINA SIMPLES (plano único FIXO, cód. plano 1)

Produtos (combo): **Impressos** (cód 7) e **Venda de Cartão** (cód 12). Roteiro: 5 atividades de
produto + 40 de plano. Telas 01 a 03.

| Campo/painel | Impressos (7) | Venda de Cartão (12) |
|---|---|---|
| `Produtos.Formato` | "2 dim (aberto+fechado)" | "2 dimensões" |
| Campos de formato na tela | **Formato Fechado** e **Formato Aberto** | só **Formato Final** (vem preenchido 660 x 960 = `FormatoDef1/2`) |
| Painel Restrições | aparece (ex.: AFT70) | **não aparece** |
| Campo extra | — | **Informações Complementares** (texto) |
| Acondicionamento | Caixa Padrão, Embalar | só Embalar |
| `ProdutosxPlanos` | processo 2 (Offset Plana) | `FlagSemImpressao = -1` (sem impressão; processo 0) |
| Atividades pré-marcadas | — | `ProdutosxAtividades`: **Cortadeira (Grande)** e **Guilhotina maior** (aparece Cortadeira marcada na tela) |
| Uso real (cálculos) | 228 | 24 |

Campos comuns do item: Produto, Tipo de Produto, Descrição, Sigla Acabado, Tributação
(ICMS + IPI), Tiragem, Modelos, Cores, Processo de Impressão (+Pre, cadeado), Cobertura de
Tinta, Fabricante, Suporte (+NC, Fornecido), botões Itens Diversos / Itens Fornecidos / Campos
Livres / Observação / Obs. Áreas de Op. Sempre 1 plano (`CalculoPlanos.codPlanoCad = 1`).

### 12.3 Linha 1 — LÂMINAS (grade de planos)

Produtos (combo da tela 04): **Display, Envelope, Impressos** (cód 9, 8 e 11).
Tipos de plano (linha 1): **Envelope (12), Base (13), Impressos (14)**. Em `ProdutosxPlanos`:
- Envelope (8) → só Envelope. Impressos (11) → Envelope, Base, Impressos. **Display (9) → nenhum
  registro** (mas a tela do Display lista Base, Envelope e Impressos; **HIPÓTESE:** sem
  restrição cadastrada o Delphi libera todos os planos da linha).
- Os três tipos usam o **mesmo formulário** (idêntico entre si e ao do Cartucho Composto, sem os
  blocos de micro). Planos têm `FORMATO = "3 dimensões"`; o produto Impressos (11) tem
  `Formato` vazio e mostra "Formato Página" no item (tela 12).
- Campos do plano (telas 05 a 13): Tipo de Plano, Nome, Tiragem `(padrão)`, Mont, Corte, Cores,
  Processo, Cobertura, Formato, Fabricante, Suporte (+NC, Fornecido), **Fibra** (Indiferente /
  1ª medida), grupo Acabamento/Atividades. **Sem** Ocor. nos Lâminas (no Cartucho Composto há).
- **Atividades de plano** (`Roteiros`): Envelope 38, Base 40, Impressos 40. As três listas são
  iguais, exceto **Mazola (acoplagem)** e **Bobst E\CV\Relevo**, que **não existem no plano
  Envelope**.
- **Atividades de produto** (linha 1, plano 0): Envase, Colar envelopes, Caixa Padrão, Envelope
  Simples, Envelope 2 partes, Colagem Manual, Sacola sem alça, Colocação de Alça, Embalar.
  O que a tela mostra por produto:

| Produto | "Acabamentos de Produto" na tela | Acondicionamento |
|---|---|---|
| Display (9) | Colagem Manual, Colocação de Alça, Envase | (vazio na tela) |
| Envelope (8) | Colagem Manual, Colar envelopes, Colocação de Alça, Envelope 2 partes, Envelope Simples | (não visível na imagem) |
| Impressos (11) | Colocação de Alça | Caixa Padrão, Embalar |

- **NÃO ENCONTRADO:** a regra que filtra as atividades de produto **por Produto** (Display ≠
  Envelope ≠ Impressos) não está em nenhuma tabela. `Roteiros` só distingue a linha;
  `ProdutosxAtividades` tem 3 linhas (só Venda de Cartão); `AtividadesxLinha` está vazia. É regra
  do programa (Delphi) ou depende de coluna que não achei. **Precisamos fechar com o usuário**
  qual conjunto cada produto mostra (tabela acima já é o que as telas provam).
- **Uso real:** Impressos (11) = 705 cálculos, média 1,08 plano (730 planos tipo Impressos, 29
  Base, 2 Envelope). Planos repetidos têm nome livre (ex.: "MONT 200 / MONT 400", "MONT01..05",
  nomes de produto). Display = 1 cálculo. Ou seja, a grade existe, mas **quase tudo é 1 plano**.

### 12.4 Linha 11 — SACOLA (plano único FIXO, cód. plano 4)

Produto único: **Sacola** (cód 3). Tela 17 e 18. Diferenças em relação ao Cartucho:
- `Produtos.Formato` = "3 dimensões": campo **Largura x Altura x Sanfona** e campo **Abas
  (fundo x lateral x alça)**.
- Campo **Unidade** ao lado de Modelos (UN). `Produtos.unidade/CodUnidade`.
- Roteiro: 13 atividades de produto + 36 de plano. As atividades de produto específicas de
  sacola (que aparecem **misturadas na mesma lista** "Acabamento/Atividades", em ordem
  alfabética, junto com as de plano): Botão de pressão, Colocação Ilhós, Colocação velcro,
  Poliéster, Sacola+aplic.alça, Sacola+alça+ilhós, Sacola s/alça 2 part, Sacola 2 + alça,
  Sacola 2+alça+ilhós, Sacola sem alça, Colocação de Alça, Colagem Manual.
- Acondicionamento: só **Embalar**. Tem painel de Restrições (as mesmas da AFT70 etc.).
- **Uso real** (176 cálculos): Sacola+aplic.alça 103, Sacola 2 + alça 24, Sacola sem alça 18,
  Botão de pressão 11, Embalar 109.

### 12.5 Padrões que valem para todas as linhas (conclusão)

1. **Um só desenho de tela, dirigido por cadastro.** A diferença entre Cartucho, Lâmina Simples,
   Sacola, Lâminas e Cartucho Composto é: (a) quais campos de formato aparecem
   (`Produtos.Formato`), (b) se há grade de planos, (c) quais atividades aparecem (Roteiros),
   (d) o que vai para Acondicionamento (ChaveDicionario).
2. **Quando só há um plano possível** (FIXO), a tela funde item e plano. **Quando há vários**,
   separa item e grade de planos. Não é por linha, é pela existência de mais de um tipo de
   plano permitido (Lâminas e Cartucho Composto) ou de tipo `ATIVO` (não FIXO).
3. **Atividade de produto vs de plano** é a divisão-chave. Produto: Colagem Manual, Colocação de
   Alça, Envase, Embalar, Caixa Padrão, sacolas, envelopes (18 no total). Plano: as demais 50.
4. **Restrições** só existem em atividades de plano (12 atividades). Venda de Cartão não mostra
   o painel.
5. **Uso real por produto** (cálculos vigentes): Cartuchos 4.934, Cartucho Composto 1.889,
   Impressos (Lâminas) 705, Impressos (Lâmina simples) 228, Sacola 176, Invólucros 86, Venda
   de Cartão 24, Caixa 17, Cartelas 2, Display 1. **Cartucho é 60% do volume.** Sacola, Lâminas
   e Lâmina Simples são secundárias. A grade de planos importa de verdade só no Cartucho
   Composto (média 2,36 planos).

### 12.6 O que continua sem fonte (precisa do usuário)

1. Regra "quais atividades de produto cada Produto mostra" (12.3). Hipótese de trabalho: usar as
   tabelas da seção 12.3 (derivadas das telas) como cadastro inicial editável.
2. Tabela Atividade → Materiais (Cola Branca, Cola Quente). Continua não encontrada.
3. Por que Display não tem plano cadastrado em `ProdutosxPlanos` mas mostra três tipos.
4. Telas das linhas Editorial, Rótulo, Contínuo etc., se algum dia forem usadas (uso real
   deve ser baixo; conferir antes de modelar).

### 12.7 Impacto no desenho proposto (seção 7)

- O modelo de cadastro continua sendo: **Linha → Produto → Tipos de Plano permitidos → Roteiro
  (atividades de plano e de produto) → Atividade (PLANO|PRODUTO, ACONDICIONAMENTO, restrições)**.
- Acrescentar ao cadastro de Produto: **modo de formato** (fechado+aberto, final, 3 dimensões,
  largura×altura×sanfona+abas), **unidade**, **exibe restrições**, **exibe informações
  complementares**, **sem impressão**, **atividades pré-marcadas**.
- Acondicionamento deixa de ser lista fixa: vem das atividades marcadas como acondicionamento
  (Caixa Padrão e Embalar), no nível do item.
- Planos únicos (Cartucho, Lâmina Simples, Sacola) abrem direto o formulário; Lâminas e
  Cartucho Composto mostram a grade com Incluir/Editar/Excluir.
- Priorizar por uso real: Cartucho primeiro, depois Cartucho Composto, depois Lâminas, Lâmina
  Simples e Sacola.


---

## 13. SESSÃO 2 (cont.): a tabela `RelTabelas` é o "Relacionamento entre Tabelas" (RESOLVE as dúvidas 12.6)

O usuário enviou telas de cadastro (Suportes, Tintas, Matrizes de Impressão, Materiais de Acabamento,
Atividades de Acabamento) e a janela **"Relacionamento entre Tabelas"** (botão ao lado do Nome em
cada cadastro). Essa janela grava tudo numa tabela genérica da base: **`RelTabelas`**
(`CodTabela1, CodItem1, CodTabela2, CodItem2`, 2.094 linhas). É o que governa as listas dependentes
da tela de orçamento. As tabelas `Roteiros`, `ProdutosxPlanos` e `ProdutosxAtividades` são legado ou
padrões; **a fonte da verdade da tela é `RelTabelas`**.

### 13.1 Códigos de tabela (decodificados por cruzamento com as telas)

| Cód | Tabela | Itens | Evidência |
|---|---|---|---|
| 0 | **Suportes** | 77 | códigos 7, 19, 1008…1057 |
| 2 | **Planos** | 12 | 1..14 |
| 4 | **Atividades** | 68 | 1..68 |
| 5 | **Linhas de Produto** | 5 | 1, 3, 5, 11, 15 (as 5 ativas) |
| 8 | **Centros de Produção** | 52 | |
| 10 | **Produtos** | 12 | 1..12 |
| 11 | **Tintas** | 9 | 2..9, 49 |
| 12 | **Matrizes de Impressão** | 6 | 10..13, 57, 58 (o "CD" é o 11) |
| 13 | **Materiais de Acabamento** | 36 | 14..62 (Cola Branca 16, Cola Quente 17…) |
| 6 | **Acondicionamento por produto** | 2 | itens 39 e 53 (Caixa Padrão, Embalar), relação só com Produtos |
| 1, 3, 9 | não identificadas | | 1 = itens 42,43,44,48,53,54 (ligados a Produtos e Planos); 3 = itens 1,2 (ligados a Planos). Provável: textos/características. Não afetam as telas já vistas. |

### 13.2 Relações que resolvem as perguntas em aberto

**A) Produto → atividades de PRODUTO (a regra que faltava).** Par (Atividades, Produtos), 56 linhas:

| Produto | Atividades de produto exibidas |
|---|---|
| Cartuchos (1) | Caixa Padrão*, Colagem Manual, Colocação de Alça, Embalar* |
| Cartucho Composto (2) | Caixa Padrão*, Colagem Manual, Colocação de Alça, Embalar*, Envase |
| Sacola (3) | Botão de pressão, Colagem Manual, Colocação de Alça, Colocação Ilhós, Colocação velcro, Embalar*, Poliéster, Sacola 2+alça, Sacola 2+alça+ilhós, Sacola s/alça 2 part, Sacola sem alça, Sacola+alça+ilhós, Sacola+aplic.alça |
| Cartelas (4) | Caixa Padrão*, Colagem Manual, Colocação de Alça, Embalar* |
| Caixa (5) | Caixa Padrão*, Colagem Manual, Colocação de Alça, Embalar*, Envase |
| Invólucros (6) | Colagem Manual, Colocação de Alça, Embalar* |
| Impressos (7, Lâmina Simples) | Caixa Padrão*, Colagem Manual, Colocação de Alça, Embalar* |
| Envelope (8) | Caixa Padrão*, Colagem Manual, Colar envelopes, Colocação de Alça, Embalar*, Envelope 2 partes, Envelope Simples |
| Display (9) | Caixa Padrão*, Colagem Manual, Colocação de Alça, Embalar*, Envase |
| Impressos (11, Lâminas) | Caixa Padrão*, Colocação de Alça, Embalar* |
| Venda de Cartão (12) | Embalar* |

`*` = vai para o painel **Acondicionamento** (atividades 39 e 53). As demais vão para
"Acabamento/Atividades" (ou "Acabamentos de Produto" nas Lâminas). **Isto bate 100% com as telas
enviadas** (Envelope 5 itens, Display 3 + Envase, Impressos 11 só Colocação de Alça, Venda de Cartão
só Embalar). A hipótese da seção 12.3 está confirmada e a tabela da 12.3 está **substituída por esta**.

**B) Produto → tipos de plano permitidos** (par Produtos × Planos). Corrige o `ProdutosxPlanos`:
Envelope (8), Display (9) e Impressos (11) permitem **os três**: Envelope, Base e Impressos.
Cartucho Composto e Cartelas: Cartão, Microondulado. Caixa: Cartão, Microondulado, Berço.
Invólucros: Invólucros. Cartuchos, Sacola, Lâmina Simples, Venda de Cartão: o plano fixo da linha.

**C) Atividade → Linha de Produto** (Atividades × Linhas): quantas atividades por linha:
Lâminas 49, Lâmina Simples 45, Cartucho 46, Sacola 47, Cartucho Composto 49.

**D) Atividade → Planos** (Atividades × Planos, 305 linhas): equivale a `Roteiros`; a atividade só
aparece dentro do plano em que está relacionada (AFT70 está nos planos 1, 2, 4, 8, 9, 10, 11, 12, 13, 14).

**E) Atividade → Materiais de Acabamento** (Atividades × Materiais, ~110 linhas). **Resolve a
dúvida 1.** Exemplos: AFT70, Bobst 68, Diana, Colagem Manual, Envelopes, Sacolas, Fechadora de Caixa e
Serviços manuais → Cola Branca / Cola Quente. Colocação de Alça → 5 tipos de alça + Botão de Pressão.
Laminação maior/menor e SG → BOPP Brilho / Fosco / Holográfico. Plastificadoras → Plástico / Polyéster.
HotStamping 1, 2, 3 → fita colorida / metalizada / holográfica. Acoplagem (Bimac, Jato, Mazola) → Cola
Vegetal. Verniz (genérico) → 8 vernizes; Verniz UV Total → Barrier + UV. Colagem de acetato → Acetato
150/200/300. Caixa Padrão → Caixa Padrão; Embalar → Kraft; Fita dupla face → 2 tipos.

**F) Atividade → Centros de Produção**, **Atividade → Tintas** (Pantone 03 → Offset Plana),
**Matriz de Impressão → Atividades e Centros** (matriz "CD" → Offset Plana), **Suporte → Planos e
Atividades** (o combo Suporte do plano é filtrado pelo tipo de plano).

### 13.3 O que cada cadastro guarda (telas enviadas)

- **Suportes** (código, nome, fabricante, descrição, unid. de custo e cálculo, tipo de suporte
  [CARTÃO...], fibra, **coef. de tinta**, espessura G/1000, permite tira/retira, formato final,
  cobertura de tinta default, listas de **gramaturas** e **formatos**, grade gramatura × formato,
  "Espessura do Papel" por gramatura, "Pacote Fechado" por formato/gramatura/bobinas de (m)).
- **Tintas** (consumo mínimo em g, coeficiente de consumo, escala S/N, embalagem fechada kg,
  tolerância %): relacionadas a Atividades (processo).
- **Matrizes de Impressão** (tempo de gravação, CTP S/N, limite de tiragem, restrição manual,
  centro de custo): relacionadas a Atividades e Centros.
- **Materiais de Acabamento** (tipo: Acondicionamento, Cola para fechar cartucho, Fita dupla face,
  Mat. proporcional à tiragem, Revestimento por kg…; uso obrigatório S/N, texto para proposta,
  medida linear informada S/N, conteúdo do rolo em metros, medida linear por pedaço, consumo mínimo).
- **Atividades de Acabamento** (tipo da atividade, tipo de simulação, **aplicada sobre Plano ou
  Produto**, características: cálculo por perímetro, capa externa/interna do cartucho composto,
  corte otimizado, dados variáveis, estações para alcear, exige hot melt, exibir tiragem em acabados
  (PCP), exige vinco para dobra, flexível, informação complementar…, texto da proposta, exibir nome
  do plano).

### 13.4 Impacto no desenho (substitui 12.6 e ajusta 12.7)

1. **Um único cadastro de relacionamentos** resolve tudo: no Vizor, modelar uma tabela genérica
   (ou tabelas de junção) Atividade × {Produto, Plano, Linha, Material, Centro, Tinta} e
   Produto × Plano, Suporte × Plano. Pode ser importada **sem inventar nada**: vem inteira de
   `RelTabelas` (2.094 linhas).
2. O `ProdutosxPlanos` e o `Roteiros` não devem ser usados como fonte; usar `RelTabelas`.
3. O Vizor já tem `AcabamentoGrafico.materiais` (Json informativo): passa a ser alimentado por esta
   relação (lista de materiais permitidos por atividade).
4. As dúvidas restantes: tabelas 1, 3 e 9 (não identificadas, baixo impacto) e a pergunta de
   produto (quais telas de Editorial/Rótulo virão).


---

## 14. SESSÃO 2 (cont.): cadastros de Plano e de Produto (telas "Planos" e "Produtos")

**Requisito do usuário (14/11/2026):** tudo o que existe nos cadastros do Calcgraf deve ser
configurável também no Vizor. Todo conhecimento novo vai para este documento e **nunca deve ser
perdido**. Confirmado: está tudo na base restaurada do Calcgraf.

### 14.1 Cadastro de PLANOS (tela "Planos" + "Planos (Alteração)")

Lista com filtro por Linha de Produto: LÂMINAS (Base 13, Envelope 12, Impressos 14), CARTUCHO
COMPOSTO (Berço 10, Cartão 8, Invólucros 11, Microondulado 9), CARTUCHO (2, FIXO), LÂMINA SIMPLES
(1, FIXO), SACOLA (4, FIXO). Status ATIVO ou FIXO. Botão Incluir fica desabilitado (planos são
criados só pela PHTech); Alterar existe.

Campos do plano (tabela `Planos`, colunas confirmadas):

| Campo na tela | Coluna | Observação |
|---|---|---|
| Código / Nome | `CODIGO`, `NOME` | |
| Miolo / Não Miolo | `FlagCaderno`? e `_CaracteristicasPlano."Plano Miolo"` | caderno/editorial |
| Cálculo Automático de Formato (Sim / Não / Opcional) | `_CaracteristicasPlano."Cálc.Autom.Formato"` | Base e Envelope: OPCIONAL |
| Cálculo da 1ª medida (L/F, L/Fx2, Lombada) | `_CaracteristicasPlano."Tipo Largura"` (LF, LFX2) | |
| Somar orelhas / Somar lombada | `_CaracteristicasPlano` | |
| Ocorrências (1, 2, Livre) | `_CaracteristicasPlano."Tipo Ocorrencia"` | Base/Envelope/Impressos = 1; Lâmina Simples e Sacola = LIVRE |
| Quebra Padrão, Corte Duplo Mín. | `QUEBRAPADRAO`, `CorteDuploMin` | |
| Suporte Padrão | `CodSuporteDefault`, `GramaturaSuporteDefault` | |
| Montagem (Pré-Impressão), Usar Pinça | `CodMontagem`, `FlagPinca` | |
| Fibra Default | `DefFibra`, `FIBRA` | Indiferente / 1ª medida / 2ª medida |
| Frente igual ao verso (Serigrafia) | `FlagFrenteIgualVerso` | |
| Produto Caderno | `FlagCaderno` | |
| Margem 1, Margem 2 (mm) | `MARGEM1`, `MARGEM2` | |
| (sem campo na tela) | `FORMATO`, `TipoTampaFundo`, `TipoAcrescimoCorteTf`, `AcrescimoCorteTf1/2`, `DistEntreImagens`, `DesconsDistCapaExterna`, `FlagNaoConstarProposta`, `FlagNaoSepararComponentesPorOcorrencia` | existem na base |

**Relacionamentos do plano** (janela "Relacionamento entre Tabelas"): **Atividades** (lista
"LÂMINAS - Offset Plana", "LÂMINAS - Cortadeira (Grande)", … marcadas com ✓; o nome da linha vem
como prefixo), **Coberturas de Tinta**, **Itens Diversos**, **Produtos**, **Suportes**.

### 14.2 Cadastro de PRODUTOS (tela "Produtos" + "Produtos (Alteração)")

Filtro por Linha (as 5 ativas). Lista: Cartucho (Cartuchos), Cartucho Composto (Caixa 5, Cartelas 4,
Cartucho Composto 2, Invólucros 6), etc.

Campos do produto (tabela `Produtos`): Código, Nome, **Classificação Fiscal** (`CodClassFiscal`),
**Tributação 2026** (`CodTributacaoVenda`: 1 ISS, 2 ICMS + IPI) e **Tributação 2027**
(`CodTributacaoVendaRT2027`), **Fechamento** (`CodFechamento`: tabela `Fechamento`, "Padrão" com 3
margens e margem default 2), **Base Preço** (`BaseUnidade`, "Unitário"), **Unidade** (`CodUnidade`:
tabela `Unidades`: 1 Unidade, 2 Kilo, 3 M2, 4 Litros, 5 Milheiro, 6 Pacote, 7 Fardo, 8 Metro,
9 Tonelada), **Prazo prod.** (`PrazoProducao`), **Faturamento Mínimo** (`FlagFatMinimo`,
`ValFaturamentoMinimo`), **Tipo de Cartucho** (`TipoCartucho`: Simples…), **Formato**
(`Formato`: "3 dimensões", "2 dimensões", "2 dim (aberto+fechado)"). Dois ícones: livro (provável
texto da proposta/dicionário) e relacionamento.

**Bloco "Defaults por plano"** (guardado em `ProdutosxPlanos`): Plano (combo dos planos do produto),
**Impressão** (Sem impressão = `FlagSemImpressao`, Processo = `CodProcessoImpressao`, Cobertura de
Tinta = `CodCoberturaTinta`, Cores = `CoresF`/`CoresV` ("0x0"), Área % = `AreaTinta`), **Fabricante
(suporte)** = `NomeFabricanteSup`, abas **"Acab. plano"** (atividades pré-marcadas, com
Restrições e Mat. Acabamento ao lado) e **"Itens div."** (itens diversos do plano).
**Bloco "Defaults por produto"**: abas "Acab. prod." (Caixa Padrão, Colagem Manual, Colocação de
Alça, Embalar, Envase) com Restrições e Mat. Acabamento, e "Itens div.". Pré-marcações ficam em
`ProdutosxAtividades` (hoje só Venda de Cartão: Cortadeira Grande e Guilhotina maior).
**Ou seja:** o cadastro de Produto guarda os VALORES INICIAIS que o orçamento já traz preenchidos.

**Campos livres do produto** (ex.: ARTE, PADRÃO para Cartucho e Cartucho Composto): rótulos extras
que aparecem no botão "Campos Livres" do item. `ProdutosxCamposLivres` na base só tem linhas
zeradas. Os dicionários de campo encontrados: `CampoDicCampos` (5 chaves: CORTE1, CORTE2, APROV,
FORMFOLHA, FORM.CORTE) e `CampoDicxOpHeader` (288 mil valores por OP, ex.: FORMPAG 546x978,
FORMEMB 218x163x73), mais `CamposEspeciais` (152). **Não confirmei qual tabela guarda ARTE/PADRÃO**
(pendência baixa; o valor digitado no orçamento é por item).

### 14.3 Relacionamentos novos decifrados em `RelTabelas`

| Cód | Tabela | Evidência / uso |
|---|---|---|
| 1 | **Itens Diversos** | itens 42 Verniz Local, 43 Chapa Verniz Local, 44 Fotolito verniz local, 48 Colagem Manual, 53 Sacola+alça+ilhós, 54 Sacola 2+alça+ilhós. Ligados a **Planos** (1, 2, 14) e a **Produtos** (tabs "Itens div." do cadastro). São itens que entram sozinhos no orçamento. |
| 3 | **Coberturas de Tinta** | itens 1 Escala e 2 Especial; ligados aos Planos 2 (Cartucho), 5 e 14 (Impressos). |
| 9 | (59 itens) | cada item aponta para um Centro de Produção; **provável tabela de Atividades de Impressão/Recursos por centro**; não afeta o orçamento. |

Códigos agora fechados: 0 Suportes, 1 Itens Diversos, 2 Planos, 3 Coberturas de Tinta, 4 Atividades,
5 Linhas, 6 Acondicionamento por produto, 8 Centros de Produção, 10 Produtos, 11 Tintas, 12 Matrizes,
13 Materiais de Acabamento (9 ainda sem nome certo).

### 14.4 Tabelas de apoio confirmadas (conteúdo real na base)

- **`ItensDiversos`** (62 linhas: Codigo, Nome, Origem, Tipo, FlagItensDiversos, TextoProposta,
  CodAcabadoRevenda, Sigla, FlagPendAutoPcp). É o **catálogo único de itens**: tintas (2 Escala,
  3 Especiais, 4-6 Pantone 01-03, 7 Lumiset, 8 Metálica, 9 Reativa, 49 Preto), matrizes (10 KBA,
  11 CD, 12 SM, 13 RZU, 57 RVU, 58 CD 7 Cores) e **materiais de acabamento** (BOPP, colas, vernizes,
  alças, fitas, acetatos, caixa padrão, kraft, plástico…). Por isso "Material de Acabamento",
  "Tinta" e "Matriz" usam o mesmo espaço de códigos.
- **`CoberturasTinta`** (2): Escala (tinta 2, 20%) e Especial (tinta 8 Metálica, 20%), com
  `CodProcessoImpressao`; `CoberturasTintaxCodTinta` guarda áreas por tinta.
- **`Fechamento`** (1: Padrão, 3 margens, default 2), **`TributacaoVenda`** (ISS, ICMS + IPI),
  **`Unidades`** (10), **`LimiteMontagem`** (limites de formato para montagem).
- **`CalculoItensDiversos`** (12.410) e **`CalculoItensDiversosxCodTipoPlanoAcabado`** (6.462):
  itens diversos usados nos cálculos reais.

### 14.5 Lista consolidada do que o Vizor precisa conseguir configurar

1. Linha de Produto, **Produto** (tributação 2026/2027, fechamento, base de preço, unidade, prazo,
   faturamento mínimo, tipo de cartucho, modo de formato, classificação fiscal).
2. **Tipo de Plano** com seus parâmetros (miolo, cálculo automático de formato, 1ª medida, ocorrências,
   quebra, corte duplo, suporte padrão, montagem/pinça, fibra default, frente=verso, caderno, margens).
3. **Relações** (genéricas): Produto×Plano, Produto×Atividade, Produto×Acondicionamento,
   Produto×Itens Diversos, Plano×Atividade, Plano×Cobertura de Tinta, Plano×Itens Diversos,
   Plano×Suporte, Atividade×Material, Atividade×Centro, Atividade×Linha, Atividade×Tinta,
   Matriz×Atividade/Centro, Suporte×Atividade.
4. **Defaults** do produto por plano (processo, cobertura, cores, área %, fabricante, atividades
   pré-marcadas, itens diversos).
5. Catálogos: Itens Diversos / Materiais de Acabamento, Tintas, Matrizes, Coberturas de Tinta,
   Fechamento, Unidades, Tributação, Campos livres.
6. Atividade: aplicada sobre Plano/Produto, características (flags), restrições, texto da proposta.
7. Suporte: gramaturas, formatos, grade gramatura×formato, espessura, pacote fechado, coeficiente
   de tinta, fibra, tira/retira, formato final, cobertura default.

### 14.6 Pendências de conhecimento (registradas, baixa prioridade)
- Onde fica "ARTE/PADRÃO" (campos livres do produto).
- O que é a tabela 9 de `RelTabelas`.
- Significado exato do ícone de livro no cadastro de Produto.
- Telas de Editorial, Rótulo e demais linhas (se forem usadas).


### 14.7 Correções (telas do Produto "Cartucho Composto", 14/11/2026)

- **O ícone de LIVRO no cadastro de Produto é "Campos Livres"** (confirmado pelo tooltip). O outro
  ícone (diagrama) é o "Relacionamento entre Tabelas". Isto resolve a pendência do ícone (14.6).
- **Campos livres do produto**: janela com título do produto (ex.: "CARTUCHO COMPOSTO") e lista de
  checkboxes **ARTE** e **PADRÃO**, com Desfazer/Confirmar. Cartucho e Cartucho Composto mostram os
  mesmos dois valores. São rótulos de campos livres marcáveis por produto.
- **Onde ARTE/PADRÃO estão gravados continua NÃO ENCONTRADO.** Verificado e descartado:
  `ProdutosxCamposLivres` (12 linhas zeradas), `CamposEspeciais`/`CamposEspeciaisEspecifico`
  (IDs P001… com conteúdo "SUCESSO", são mensagens), `CampoDicCampos` (CORTE1, CORTE2, APROV,
  FORMFOLHA, FORM.CORTE). Hipótese: a lista vem de uma tabela do próprio Delphi ou de `GrCampos` (962).
  No Vizor, tratar como cadastro simples "Campo livre" por produto (nome + marcado) até acharmos a fonte.
- Defaults do produto Cartucho Composto confirmados na tela: plano inicial "Cartão", processo
  "Offset Plana", cores 0x0, área % 0, formato "3 dimensões", fechamento "Padrão", base de preço
  "Unitário", unidade "Unidade", prazo 0, tributação 2026 "ICMS + IPI", tributação 2027 vazia,
  classificação fiscal vazia. Acab. prod. oferecidas: Caixa Padrão, Colagem Manual, Colocação de Alça,
  Embalar, Envase (batem com a relação Produto×Atividade da seção 13.2).


---

## 15. Como o Calcgraf resolve as decisões da proposta (verificado na base, 14/11/2026)

1. **Relações:** o Calcgraf usa UMA tabela genérica (`RelTabelas`) para todos os pares. Não há
   chave estrangeira; a tela de "Relacionamento entre Tabelas" é a mesma para qualquer cadastro.
2. **Material escolhido influencia o preço (não é só informativo).**
   - O cálculo grava a escolha em `CalculoMatAcabamento` (`CodMaterial`, `codAtvAcabamento`,
     `codPlanoAcabado`, `ParamAcab1`, `ParamAcab2`, `TipoParamAcab`).
   - O custo vira uma linha em `CalculoSTC`. Exemplo 12992: material 14 (BOPP Brilho) na atividade 37
     (Laminação maior), plano 1, `ParamAcab1 = 100`, custo R$ 581,82. Exemplo 11121: Cola Branca = R$ 306,23.
   - Preços da Tabela de Custo vigente (2): Cola Branca R$ 29,15/kg, **Cola Quente R$ 56,10/kg**,
     BOPP Brilho e Fosco R$ 0,605/m², Caixa Padrão R$ 7,70, Kraft R$ 1,10. Ou seja, escolher Quente
     em vez de Branca quase dobra o custo da cola.
   - Uso real: Cola Branca em 7.628 cálculos, Cola Quente em 776.
   - `ParamAcab1/2` e `TipoParamAcab`: parâmetro de consumo do material (provável % de cobertura ou
     medida). **Significado exato não confirmado.**
3. **Custo por plano: o Calcgraf calcula por plano.** Cada atividade e cada material grava
   `codPlanoAcabado`, e as linhas de `CalculoSTC` trazem o número do plano como prefixo da descrição
   ("0001Stora Enzo Bobina 181", "0002Micro Pardo Formato 230", "0002Mazola (acoplagem)"). O custo do
   plano é a soma das linhas do plano. No 11121 o plano 2 (Micro) pesa muito mais que o plano 1.
4. **Campos livres:** o Calcgraf guarda valores livres por OP (`CampoDicxOpHeader`, ex.: FORMPAG,
   FORMEMB). Não entram em preço. ARTE e PADRÃO seguem sem fonte localizada.
5. **Defaults e tudo por produto:** o produto define o que vem pré-preenchido, e o usuário altera.


---

## 16. Pendências 1 e 2 esclarecidas (14/11/2026)

### 16.1 `ParamAcab1`, `ParamAcab2`, `TipoParamAcab` (em `CalculoMatAcabamento`)
**Não são valores fixos.** São informados por cálculo (digitados ao marcar o material) e o significado
muda conforme `TipoParamAcab`. Evidência: 37.047 linhas reais, faixa de valores por material.

| TipoParamAcab | Significado (alta confiança) | Materiais | Faixa real |
|---|---|---|---|
| 0 | sem parâmetro | Caixa Padrão, Kraft, Embalar | 0 |
| 1 | **% de cobertura da folha**: Param1 = % frente, Param2 = % verso | Verniz, BOPP, Plástico, Polyéster, Cola Vegetal de acoplagem | 0 a 100 |
| 2 | **dimensões em mm** (largura × comprimento da área aplicada) | Hot Stamping, Acetato | Hot Stamping 12-620 × 5-600; Acetato 82-340 × 70-290 |
| 3 | **medida linear em mm por peça** (comprimento de cola, fita ou alça) | Cola Branca, Cola Quente, Fita Dupla Face, Alça Gorgurão e Nylon | 3 a 820 mm |
| 4 | **quantidade de peças por unidade** | Botão de Pressão, Ilhós, Velcro | 1 a 4 |

- Confere com o cadastro de Materiais de Acabamento: campos "Medida linear informada (S/N)", "Conteúdo
  do rolo em metros" e tipos "Mat. proporcional à tiragem", "Revestimento por kg".
- Exemplo 12992: BOPP Brilho, Laminação maior, `Param1 = 100`, `Param2 = 0` (100% frente, 0% verso),
  custo R$ 581,82. O consumo foi 1.057,86 m², próximo da área total da folha (1.334 folhas × 0,65 × 1,225 =
  1.062 m²) menos pequena diferença de margem.
- Uso mais comum: Cola Branca em AFT70 (7.131 cálculos, tipo 3, 3 a 612 mm), Caixa Padrão (6.700, tipo 0),
  Verniz Base D'Água Brilho (5.726, tipo 1), Cola Vegetal na Mazola (4.223, tipo 1).
- **Ainda não provado:** o significado do `ParamAcab2` quando o tipo é 3 (Fita Dupla Face: 0 a 6; Colagem
  Manual: 0 a 100) e a fórmula exata de consumo. Para o Vizor: guardar os dois parâmetros e o tipo, e só
  aplicar a fórmula nos tipos já provados (0, 1, 4). Os demais ficam informativos até a validação contra
  um cálculo real.

### 16.2 Tabela 9 da `RelTabelas`
- **O que é:** 56 relações entre os códigos 1 a 59 e Centros de Produção. Os códigos 1 a 59 ocupam a mesma
  faixa dos códigos de Atividades.
- **Por que não serve:** comparando com os nomes reais, o vínculo não faz sentido. Offset Plana,
  Offset Rotativa e Formulário Contínuo aparecem ligados ao Bobst E; Rotogravura, Serigrafia e Tipografia ao
  Bobst S; Cortadeira (Grande) ao Bobst E; Laminação maior à AFT70. A ligação correta de Atividade com Centro
  está na tabela 4 × 8 (25 linhas, ex.: AFT70 → centros 11, 12 e 47).
- **Conclusão:** a tabela 9 é resíduo antigo ou desalinhado. **Não importar.**

### 16.3 ARTE e PADRÃO (campos livres do produto)
São opções fixas (rótulos de checkbox), iguais para Cartucho e Cartucho Composto. Aceito o cadastro
simples por produto. A fonte no banco continua não localizada.


---

## 17. Novos cadastros do Calcgraf e o que dá para importar (14/11/2026)

O usuário enviou telas de: Itens Diversos, Roteiros, Centros de Custo, Restrições Manuais, Restrições
Automáticas, Quebras, Ajustes de Produtividade, Limites de Montagem, Campos Livres, Defaults por Origem de
Custo e os Parâmetros de Solicitação, Fechamento e Cálculo. Todos têm tabela na base restaurada.

### 17.1 Resolvido: ARTE e PADRÃO (campos livres)
São **Campos Livres da Solicitação** (tela "Campos Livres", Proprietário = Solicitação ou Recusa). Tabelas:
`ParamCl` (definição, 9 linhas), `ParamClLista` (opções, 13), `ParamClRelacionamentos` (copia SOL para PED) e
`ConteudoCl` (valores digitados: 606 em solicitações, 413 em pedidos).

| Campo | Proprietário | Tipo | Opções | Obrigatório |
|---|---|---|---|---|
| ARTE (cód. 5) | Solicitação | lista | ALTERAÇÃO, NOVO, REPETIÇÃO | sim |
| PADRÃO (cód. 6) | Solicitação | lista | AMOSTRA, CONTRATUAL, PASTA PADRÃO | sim |
| ARTE / PADRÃO | Pedido (7 e 8) | lista | as mesmas | não (copiados da solicitação) |
| Motivos de Recusa | Recusa | lista | "Aprovado com Concorrente" | |
| Gramatura | Insumo; Pedido Cliente em Pedido, ACP e N Item pedido | texto | | |

Ou seja, ARTE diz se a arte é nova, repetição ou alteração, e PADRÃO diz o padrão de referência. A
substituição que usei antes ("cadastro simples por produto") deixa de valer: são **campos de lista por
proprietário (solicitação, pedido)**, definidos em `ParamCl`.

### 17.2 Tabela de importação

| Cadastro | Tabela(s) na base | Linhas | Equivalente no Vizor | Importar? |
|---|---|---|---|---|
| Itens Diversos + vínculo com atividades | `ItensDiversos` (Origem: Mat.Acabamento 40, Tinta 9, Matriz 6, Centro de Custo 3, Serviço Externo 3, Pré-impressão 1), `RelTabelas` tab. 1 | 62 | `MaterialAcabamento`, nova relação | **Sim.** Os 6 itens automáticos (Colagem Manual, Sacola+alça+ilhós, Sacola 2+alça+ilhós, Chapa/Fotolito/Verniz Local) entram sozinhos no orçamento. Campos: qtd por unidade, mínima, custo informado, item de revenda, quebra %, tipo de cálculo (Tiragem), aplicado sobre (Acabado) |
| Roteiros (Linha → Planos → Atividades de plano; Atividades de produto → "Atividades que juntam planos") | `Roteiros` | 422 | relação Plano×Atividade | **Sim**, para **ordem** e escopo por linha (`Ordem`, 999 = sem ordem). A permissão vem da `RelTabelas`; comparar as duas na importação e listar divergências. `AtividadesJuntaPlanos` está vazia |
| Centros de Custo | `CentrosCusto` (Nome, `AgrupamentoCusto` GERAL, `FlagTabelaCusto`) | 52 | `CentroProducao` e Mapa de Custos | **Só mapa de equivalência** (centro de custo × centro de produção) e o flag "utiliza tabela de custo". O custo-hora já está coberto |
| Restrições Manuais | `RestricoesManuais` + relação com Centros | 59 | `RestricaoAcabamento` | **Sim**, incluindo o centro ao qual cada restrição pertence e "exibir na proposta" |
| Restrições Automáticas | **`AjustesProdutividade`** (linhas com `DadoAjustar` = Incondicional) | 2 | novo | **Sim.** Ex.: Offset Plana incompatível com Heidelberg CD 5 e 7 cores quando formato do processo < 390 × 500; impede montagem de cadernos |
| Ajustes de Produtividade | `AjustesProdutividade` (Acerto 30, Produção/Hora 21, Consumo do Material 4, Produção/Hora por atividade 2) | 59 | novo (fator por atividade, centro, restrição) | **Sim.** Fator multiplica acerto, produção por hora ou consumo. Ex.: Bobst S, acerto "Normal Repetição" × 0,2; "Onda B/E Acoplado" × 0,6; Relevo produção × 1,1; Bobst E\CV\Relevo × 0,84. **Afeta o custo de transformação**, usar na fase do motor |
| Quebras | `Quebras` + `QuebrasxLimites` | 10 (9 ativas) | parâmetro de perda | **Sim.** Impressão: 70 pedaços por acerto (Heidelberg SM: 50); acabamento: quebra fixa 50 ou 10 e variável 0,5%. Cada quebra tem o nome da máquina |
| Limites de Montagem | `LimiteMontagem` | 1 | novo | **Sim** (trivial): formato final 40 × 40, mínimo 10, máximo 36 |
| Campos Livres | `ParamCl`, `ParamClLista`, `ParamClRelacionamentos`, `ConteudoCl` | 9, 13, 2 | novo (campo configurável por proprietário) | **Sim**, só a definição. Os valores históricos (606 e 413) pertencem a solicitações e pedidos antigos e não entram |
| Defaults por Origem de Custo | `PscParametrosConformeOrigem` (origem → tabela de custo, 7) e parâmetros em `Parametros` | 7 | defaults do cadastro | **Parcial.** Natureza por origem (crédito ICMS e IPI, prazo, tabela e coluna de custo, integração com estoque, agrupamento: Suporte = Materiais Diretos, crédito IPI 3) |
| Parâmetros de Solicitação, Fechamento e Cálculo | `Parametros` (chave e valor, 867 linhas, 63 tipos) | ~40 relevantes | parâmetros da empresa | **Sim, os relevantes ao cálculo.** Refile folha inteira 2, contra-pinça 8, refile final 1, corte duplo 0, partida de consumo de tinta 200 g, juros 2,00 (aplicação e bancários), juros simples, prazo médio de produção 2 dias, tratar recusados após 210 dias |

### 17.3 O que NÃO importar
- Valores históricos de campos livres (`ConteudoCl`).
- `RelTabelas` tabela 9 (resíduo desalinhado, ver seção 16.2).
- `Parametros` de contas a pagar, fluxo de caixa, SPED, crédito do cliente e demais módulos fora do orçamento.

### 17.4 Impacto na proposta
1. Ficam **dois cadastros novos de comportamento**: `AjusteProdutividade` (fator por atividade/centro/condição) e
   `QuebraGrafica`. O Vizor hoje não aplica fatores; entram na fase do motor, depois de validar contra cálculos.
2. **Campos livres** passam a ser um cadastro configurável (`CampoLivre` + `CampoLivreOpcao`, com proprietário
   solicitação/pedido) em vez de rótulo por produto. Substitui a decisão 3 da proposta.
3. Os **parâmetros gerais** (refile, contra-pinça, partida de tinta, juros, prazo médio) devem ser lidos de
   configuração da empresa, não fixos no código. Conferir o que o motor atual já usa (tinta: partida de 0,2 kg
   já bate).

## 18. FASE 1 ENTREGUE (15/11/2026): cadastros e relações no ar

Spec: `.kiro/specs/orcamento-grafico-cadastros-relacoes/`. Back `a28fa0b33`, front `41dd0c2`, ambos na `main`.

**Back**
- Schema: 12 tabelas novas (`produto_grafico`, `tipo_plano_grafico`, `default_produto_plano`,
  `relacao_cadastro_grafico`, `item_diverso_grafico`, `campo_livre`, `campo_livre_opcao`,
  `ajuste_produtividade`, `quebra_grafica`, `quebra_grafica_limite`, `limite_montagem`,
  `selecao_material_acabamento`) + colunas aditivas (`codigo_origem` em 8 cadastros, campos novos
  em atividade/restrição/material, `produto_grafico_id` no item, `tipo_plano_id` no plano).
  Migração em `migrarOrcamentoGraficoCadastrosRelacoes()` (`migrate-prod.ts`, em `try/catch`).
  Aplicada em produção no deploy (12/12 tabelas confirmadas).
- Rotas em `/api/orcamento-grafico/cadastros/*` (`src/modules/orcamento-grafico/cadastros-graficos/`):
  produtos, tipos-plano, defaults, relações (PUT substitui o conjunto; `/relacoes/verificar`),
  itens-diversos, campos-livres, ajustes-produtividade (+ restrições automáticas), quebras,
  limites-montagem, parâmetros `orc.*`, catálogo (`/catalogo/produto/:id`, `/catalogo/plano/:id`)
  e seleção de material (`/selecao-material`).
- Seleção de material: item puxado do acervo grava `aplicaNoPreco=false` (custo ancorado intacto);
  item novo soma ao Material Direto. As linhas da seleção ficam no Json `materiaisAcabamento` com
  `origem: 'SELECAO'`. O front precisa devolver a lista completa ao salvar o item.
- Ajustes, Quebras e Limites de Montagem: SÓ cadastro/visualização. Nem o motor nem o PCP os leem.

**Importação em produção (Carton Wega)**
- `scripts/exportar-cadastros-orcamento.mjs` (somente leitura) → `cartoon/export/CadastrosOrcamento.json`.
- `scripts/importar-cadastros-orcamento.ts --empresa <id> [--dry-run] [--fase <nome>]`
  (idempotente por `codigoOrigem`; só preenche campo vazio; relatório em
  `cartoon/export/relatorio-importacao-cadastros.json`).
- Gravado: 11 produtos, 14 planos, 16 defaults, 1.575 relações (290 com ordem do roteiro),
  22 itens diversos, 8 campos livres + 13 opções, 49 ajustes, 9 quebras + 7 limites, 1 limite de
  montagem, 9 parâmetros; `codigo_origem` em 67 atividades, 36 materiais, 32 centros, 61 suportes.
- **249 não casados (pendência):** 20 centros sem equivalente por nome (ex.: "Bobst S (Corte e Vi",
  "CVMR (Corte e vinco", colocação de ilhós/alça/velcro, sacolas, verniz localizado), 17 suportes
  (14 inexistentes, 3 duplicados no Vizor: WTL Bobina, Couchê, Billerud Board), 21 relações com
  tinta/matriz (sem `codigoOrigem` no Vizor), campo livre "Pedido Cliente" (proprietário ACP).
  Acertar nomes/duplicatas e rodar o importador de novo (não duplica).

**Front** (`src/app/(interna)/orcamento-grafico/cadastros/`): Produtos (abas Dados, Tributação,
Defaults por plano, Relações), Tipos de Plano, Relações (matriz), Itens Diversos, Campos Livres,
Ajustes de Produtividade, Quebras, Limites de Montagem, Parâmetros do Orçamento; abas Restrições e
Materiais em Acabamentos; campos novos em Materiais de Acabamento. Base comum em `_shared/`.

**Pontos a verificar (não bloqueiam)**
- Aviso "a verificar" em Materiais usa tipo FITA/OUTRO como critério (palpite; o material não tem TipoParam).
- Tintas e matrizes nas Relações vêm de `/orcamento-grafico/precos-mp` (suposição).
- Seletores com limite de 100–200 itens em Ajustes e na aba Relações do Produto.
- Fórmulas dos TipoParam 2 e 3 e parâmetro 2 do TipoParam 3: informativos (custo 0, `A_VERIFICAR`).
- Migração não testada 2x no banco local (Postgres local desligado); em produção rodou sem erro.

**Fase 2 (não iniciada):** usar o catálogo no wizard do orçamento (filtrar planos/atividades por
produto) e a influência de Ajustes/Quebras/Limites no cálculo e no PCP.

**Armadilha do ambiente descoberta:** o PSReadLine do PowerShell quebra com comandos longos
(`ArgumentOutOfRangeException ... SetCursorPosition`) e corta os comandos seguintes com `^C`.
Foi isso que "cancelou" subagentes. Usar comandos curtos, arquivos `.cmd` e saída em arquivo.

## 19. Fase 2 — Catálogo no editor do item

Spec: `.kiro/specs/orcamento-grafico-catalogo-no-editor/`. Usa no editor do item os cadastros da Fase 1 (seção 18).
Implementação feita; **commit/deploy do front e conferência manual pendentes** (tarefa 5.2).

**Commits**
- Back: `dc5a94cb8` + um commit de ajuste do `GET /:id` (**a confirmar o hash**).
- Front: ainda não commitado.

**Back (repo `VisioFab.Wms.Back`)**
- `produtoGraficoId` (item) e `tipoPlanoId` (plano) são aceitos, gravados e devolvidos. Ausente não altera, `null` limpa,
  id de outra empresa responde 422 legível. Validação por `{ id, empresaId }`.
- `GET /orcamento-grafico/:id` passou a devolver também `materiaisAcabamento` de cada item (antes o editor não via as linhas `SELECAO`).
- `DELETE /orcamento-grafico/cadastros/selecao-material` (`itemId`, `acabamentoId`, `planoId?`): apaga a seleção, reflete no Json
  `materiaisAcabamento`, idempotente, 404 se o item não for da empresa. Não recalcula `resultadoCalculo`.
- Coluna `tipoParam` (`tipo_param Int?`) em `MaterialAcabamento` (schema + `migrate-prod.ts` idempotente) e fase `materiais-tipo-param`
  no exportador/importador da Fase 1 (moda de `TipoParamAcab` por `CodMaterial`; só preenche campo vazio; `--dry-run`).
- **A fase `materiais-tipo-param` AINDA NÃO foi rodada em produção.** Depende de um novo export do legado e de dry-run revisado
  com autorização explícita. Até lá `tipoParam` fica nulo e o front usa o mapa provisório por `tipoMaterial` (conservador, cai em informativo).
- Não foram alterados `ancorarCustoCalcgraf`, o motor de cálculo nem os testes de decomposição.

**Front (repo `VisioFab.Wms.Front`, `src/app/(interna)/orcamento-grafico/`)**
- `SeletorProdutoGrafico` em `SecaoProduto`: filtra por linha do orçamento, opcional e limpável; produto inativo aparece como inativo.
- `useCatalogoItem` (carrega produto, plano fixo e tipos de plano sob demanda, com cache) e `[id]/editor/catalogo/catalogo-puro.ts`
  (defaults sem sobrescrever, filtro/ordem de atividades, pré-marcação, `tipoParam`, mescla de linhas, sugestão de itens diversos).
- `useSelecaoMaterial` + `SeletorMaterialAtividade` (com `AvisoAVerificar`): escolha do material por atividade, parâmetros por `tipoParam`,
  resumo de consumo e custo. Item puxado mostra selo "informativo" (custo ancorado intacto).
- `StepAcabamentos` com prop `catalogo` (grupos Atividades, Acondicionamento e Fora do catálogo); o wizard `/novo` não recebe a prop.
- `PlanosDoItem`: Select "Tipo de plano" (obrigatório em plano novo quando há produto e catálogo com tipos), defaults só em campo não tocado,
  atividades do tipo em `acabamentosRicos`, `tipoPlanoId` no POST/PUT. `SecaoPlanos` ganha a coluna "Tipo de plano".
- `SugestaoItensDiversos` em `SecaoItensComplementares`: "Adicionar" e "Adicionar todos"; nunca adiciona sozinho; marca linha sem custo cadastrado.
- Salvar em passes (item, seleções pendentes/remoções com o id devolvido, mescla das linhas, regravação para recalcular) e modal ao
  cancelar o editor quando há escolhas de material gravadas e fora do preço.
- `SecaoMateriaisAcabamento` mostra as linhas `SELECAO` somente leitura.

**Decisões 1 a 7 (design, seção 10) — aprovadas**
1. Campos livres (ARTE/PADRÃO) adiados para a Fase 3.
2. Material em item novo: passes automáticos após o primeiro salvamento.
3. Coluna `tipoParam` criada (importação em produção pendente, ver acima).
4. Tipo de plano obrigatório em plano novo quando o item tem produto; planos antigos seguem sem tipo.
5. Item puxado pode escolher Produto Gráfico (só organização, sem defaults nem mudança de custo).
6. Cálculo ao vivo NÃO passa a considerar `materiaisAcabamento` em itens sem produto nesta fase.
7. Cancelar o editor com escolhas de material já gravadas e fora do preço: perguntar se quer salvar.

**Pendências e pontos a conferir (não bloqueiam)**
- Ids de restrição do catálogo vs cadastro: confirmar que os ids usados nas restrições do catálogo são os mesmos do cadastro de acabamentos/suportes
  (e, no plano, os ids do seletor de suportes são os da relação PLANO→SUPORTE) antes de restringir o seletor.
- Falha de seleção no primeiro salvamento (item novo) fecha o editor: o aviso aparece, mas o usuário precisa reabrir o item para refazer a escolha.
- Produtos com vários planos não fixos não mostram seletor de material (só há plano fixo quando o produto tem um único tipo de plano).
- Limite de 100 acabamentos carregados em `StepAcabamentos`: confirmar se a empresa passa disso; atividade do catálogo fora dos 100 pode não aparecer.
- `abrirEditorPagina` passa `produtoGraficoId`, `materiaisAcabamento` e `planos[].tipoPlanoId`, mas **não repassa ao reabrir** estes campos técnicos do item:
  `modeloFacaId`, `tintaModo`, `tintaConsumoKg`, `siglaAcabado`, `tributacao`, `processoImpressao`, `coberturaTintaTexto`, `fabricante`,
  `microondulado`, `fornecido`, `arte`, `observacao`, medidas técnicas, `montagemLinhas`/`montagemColunas`, formatos de suporte/corte,
  `suporteProducaoId` e `aproveitamentoManual`. Conferir se algum é regravado como vazio ao salvar pelo editor.
- Fórmulas dos TipoParam 2 e 3: informativas (custo 0, `A_VERIFICAR`). Mapa provisório por `tipoMaterial` precisa de conferência contra cálculos reais.
- `reaproveitar` e `de-calculo` ainda não copiam `produtoGraficoId` e `tipoPlanoId`.
- Cobertura do catálogo da Wega com os 249 itens não casados da importação (seção 18): produtos podem aparecer com catálogo incompleto.
- Vínculo entre Produto Gráfico e Tipo de Embalagem segue inexistente (os dois seletores são independentes).

**Adiado para a Fase 3:** campos livres (ARTE, PADRÃO) como sugestão de rótulos no item.

**Ajustes, Quebras e Limites de Montagem continuam SEM influenciar o motor de cálculo nem o PCP** (só cadastro e visualização).
Nenhum texto da tela deve sugerir o contrário.

## 20. Backlog da Fase 3 (definido em 15/11/2026)

Itens que ficaram fora da Fase 2 e entram na Fase 3 (ainda sem spec):

1. **Vínculo Produto Gráfico × Tipo de Embalagem.** Hoje os dois seletores são independentes: ao escolher o Produto Gráfico,
   o Tipo de Embalagem, a gramatura e o preço/kg continuam obrigatórios e em branco (o salvamento responde 400 com
   `tipoEmbalagemId`, `gramatura` e `precoKg`). Objetivo: o produto sugerir o Tipo de Embalagem (e, quando houver, suporte e
   gramatura padrão do plano). Precisa de decisão sobre onde guardar o vínculo (campo no produto ou relação genérica).
2. **Campos livres (ARTE, PADRÃO)** como sugestão de rótulos e opções no item (tarefa 4.14 da Fase 2, adiada).
3. **Acondicionamento:** conferir por que Caixa Padrão e Embalar aparecem no grupo "Atividades" e não em "Acondicionamento"
   no produto Cartucho Composto (provável relação de acondicionamento não importada).
4. **`reaproveitar` e `de-calculo`** copiarem `produtoGraficoId` e `tipoPlanoId`.
5. **Seletor de material em produtos sem plano fixo** (vários tipos de plano): mostrar também no modal de plano.
6. Pendências da Fase 2 que seguem abertas: `tipoParam` (importação em produção), campos técnicos não repassados ao reabrir o item,
   falha de seleção no primeiro salvamento fecha o editor, limite de 100 acabamentos.

## 21. Fase 3 — Produto × Embalagem e pendências do editor (16/11/2026)

Spec `.kiro/specs/orcamento-grafico-fase3-produto-embalagem/`. Back no ar (commit `53e663bf0`); front implementado e **não commitado**.

**Decisões:** vínculo por coluna `produto_grafico.tipo_embalagem_id` (sem FK); `de-calculo` sem cópia nova de produto; `reaproveitar` em transação interativa; acondicionamento por `classificarGrupoAtividade`; campos livres SOLICITACAO e PEDIDO; contrato do `PUT` do item inalterado.

**Produção (Carton Wega), gravado com autorização:**
- Atividades 39 (Caixa Padrão) e 53 (Embalar) com `acondicionamento = true`. Move 8 produtos para o grupo "Acondicionamento".
- `tipo_embalagem_id` preenchido nos 11 produtos pela convenção `CG-EMB-<n>` (11 de 11).
- Consultas: 67 acabamentos ativos (nenhum passa de 100); 366 grupos de papel com preço duplicado por suporte+gramatura (o preço só é sugerido com 1 candidato).

**Back:** `GET /orcamento-grafico/acabamentos/por-ids`; `tipoEmbalagemId` em `POST`/`PATCH /produtos`; `POST /:id/reaproveitar` atômico; scripts `corrigir-acondicionamento-orcamento.ts` (`--dry-run`) e fase `produtos` do importador com vínculo.

**Front (`orcamento-grafico/`):** seletor "Tipo de Embalagem" no `ProdutoModal`; `useSugestoesProduto` (tipo, suporte, gramatura e preço por kg em item novo); validação prévia ao salvar; `itemIdCriado` e painel de seleções não gravadas; `useTodosAcabamentos` (paginação + `por-ids`); seletor de material e sugestões no modal de plano; campos livres sugeridos. Wizard `/novo` e `ItemWizardModal` sem alteração.

**Pontos de atenção:** `PlanosDoItem` é renderizado em `[id]/page.tsx` e cria o próprio catálogo (o cache compartilhado só chega ao `SecaoPlanos`); busca de preços limitada a 100 papéis por suporte; `suporteProducaoId` não é repassado ao reabrir o item; a atividade marcada no modal de plano só vem do tipo ou do plano gravado.

**Conferência manual pendente (usuário):** Cartucho Composto com 39 e 53 em "Acondicionamento"; escolher produto em item novo sugere tipo/suporte/gramatura; salvar sem tipo mostra "Faltam: …"; falha de seleção mantém o editor aberto; item com mais de 100 acabamentos lista todos; modal de plano com seletor de material; campos livres com sugestão.

### 21.1 Fechamento das lacunas da Fase 3 (16/11/2026)

Lacunas do §21 resolvidas: (1) `suporteProducaoId` agora é aceito/gravado só quando enviado (zod opcional, sem schema novo) e repassado ao reabrir o item; (2) `materialMicroonduladoId` é preservado mesmo com `microondulado = false` (nenhum cálculo lê o campo); (3) `GET /precos-mp` aceita `gramatura` opcional e o front pagina até o fim (`buscarPapeisComPreco`), sem truncar em 100; (4) modal de plano permite marcar/desmarcar atividades do catálogo do tipo e usa o catálogo compartilhado (`PlanosDoItemComCatalogo`); (5) testes de componente (ProdutoModal, campos livres) e teste que impede texto visível com a marca do sistema legado (3 telas antigas reescritas: "Nº de origem", "Migrado", "Foto original"). Efeito no wizard `/novo`: desmarcar microondulado depois de escolher o material mantém o id do material no payload.
