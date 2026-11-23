# Orçamento Gráfico — comportamento por linha de produto (Calcgraf × Vizor)

Levantamento de **20/11/2026**. Objetivo: saber, para cada linha de produto, como o Calcgraf se comporta e o que o
Vizor tem hoje em produção, para implementar uma vez só, sem retrabalho. Este documento é a base para a conferência
com os prints de tela do Calcgraf que o usuário vai enviar, linha por linha.

> **Leia primeiro `docs/orcamento-planos-calcgraf-HANDOFF.md`** (sessões de 13 e 14/11/2026). Ele já traz as telas das
> 5 linhas, o fluxograma do Calcgraf, a tabela `RelTabelas` e a lista do que o Vizor precisa configurar. Este arquivo
> só **confere o que está em produção em 20/11/2026** e lista as divergências. Os "prints pedidos" da seção 8 já
> existiam em sua maior parte no handoff; ver a atualização de 23/11/2026 no fim deste arquivo.

## 1. Fontes e nível de confiança

| Marca | Fonte | Confiança |
|---|---|---|
| **[CALC-BD]** | Banco restaurado do Calcgraf (`CalcgrafCartonWega`, backup `CartonWega.bak`), só leitura | Alta para cadastro e estatística; não mostra regras de tela escritas em código |
| **[VIZOR-PROD]** | Banco de produção do Vizor (Neon), Carton Wega, só leitura (transação `READ ONLY`), em 20/11/2026 | Alta (dado real) |
| **[PRINT]** | Prints de tela enviados pelo usuário (Cartucho Composto, Lâminas/Display, Cartucho, Lâmina Simples, Fechamento) | Alta para o que está visível |
| **[CÓDIGO]** | Leitura do código do Vizor (back e front) | Alta para o que o código faz; não prova o que a tela mostra |
| **[INFERÊNCIA]** | Conclusão minha a partir das fontes acima | Média; sempre listada em "a confirmar" |

Não foi feita nenhuma escrita em produção. Credenciais não constam deste documento.

## 2. Como o Calcgraf organiza o comportamento

1. **Linha de Produto** (`_LinhasProduto`): tem a coluna `IdExpressa`, o **"especialista"**: motor de cálculo e tela
   próprios da linha. Valores: `SIMPLES`, `EDITORIAL`, `CARTUCHO COMPOSTO` (e outros de linhas canceladas). **[CALC-BD]**
2. **Produto** (`Produtos`): pertence a uma linha e define o **Formato** (`3 dimensões`, `2 dimensões`,
   `2 dim (aberto+fechado)` ou **vazio**), o formato padrão, flags de exibição e o prazo. **[CALC-BD]**
3. **Tipo de Plano** (`Planos`, com `CODLINHAPRODUTO`): `ATIVO` (vários planos) ou **`FIXO`** (plano único).
   As características de cada tipo estão em `_CaracteristicasPlano` (Cálc.Autom.Formato, Plano Miolo, Somar lombada,
   Somar orelhas, Tipo Largura LF/LFX2, **Tipo Ocorrência** `1` ou `LIVRE`). **[CALC-BD]**
4. **Produto × Plano** (`ProdutosxPlanos`), **× Atividades**, **× Restrições**, **× Itens Diversos**,
   **× Campos Livres**: o que cada produto permite e pré-marca. **[CALC-BD]**
5. **Tiragens**: lista por item (`2.000,4.000,...`), vale para todos os planos; uma linha de Fechamento por tiragem. **[PRINT]**

## 3. Quadro por linha (as 5 linhas ativas)

Estatística sobre os 8.062 cálculos do Calcgraf (último registro por nº de cálculo). **[CALC-BD]**

| Linha | Especialista | Produtos | Tipos de plano | Estrutura | Cálculos | Vários planos | Várias tiragens (máx.) |
|---|---|---|---|---|---|---|---|
| **CARTUCHO** | SIMPLES | Cartuchos, TESTE (cancelado no Vizor) | CARTUCHO (**fixo**) | Plano único | 4.934 | 149 (3%) | 1.357 (27%) (6) |
| **CARTUCHO COMPOSTO** | CARTUCHO COMPOSTO | Cartucho Composto, Cartelas, Caixa, Invólucros | Cartão, Microondulado, Berço, Invólucros | Vários planos | 1.994 | 1.793 (90%) | 829 (42%) (6) |
| **LÂMINAS** | EDITORIAL | Envelope, Display, Impressos (nº 11) | Base, Envelope, Impressos | Vários planos (na prática 1) | 706 | 36 (5%) | 150 (21%) (6) |
| **LÂMINA SIMPLES** | SIMPLES | Impressos (nº 7), Venda de Cartão | LÂMINA SIMPLES (**fixo**) | Plano único | 252 | 2 (1%) | 70 (28%) (6) |
| **SACOLA** | SIMPLES | Sacola | SACOLA (**fixo**) | Plano único | 176 | 31 (18%) | 42 (24%) (4) |

Observações:
- Existem **3** linhas de plano único (Cartucho, Lâmina Simples e **Sacola**). A regra escrita em
  `orcamento-grafico-visao-front-calcgraf` citava só duas; foi corrigida.
- Linhas canceladas no Calcgraf (Editorial, Contínuo, Rótulo, Blocado, Pré-impressão, Tampa/Fundo, Display, Flexível,
  Cards, Etiqueta Flexo, Revenda) não aparecem no Vizor, que mostra só as 5 ativas.
- **Várias tiragens existem em todas as linhas** (21% a 42% dos cálculos), inclusive nas de plano único.

### 3.1 Produtos e formato (Calcgraf × Vizor produção)

| Cód. | Produto | Linha | Formato no Calcgraf | `modo_formato` no Vizor | Bate? |
|---|---|---|---|---|---|
| 1 | Cartuchos | Cartucho | 3 dimensões | TRES_DIMENSOES | sim |
| 2 | Cartucho Composto | Cartucho Composto | 3 dimensões | TRES_DIMENSOES | sim |
| 3 | Sacola | Sacola | 3 dimensões | TRES_DIMENSOES | sim |
| 4 | Cartelas | Cartucho Composto | 2 dimensões | DUAS_DIMENSOES | sim |
| 5 | Caixa | Cartucho Composto | 3 dimensões | TRES_DIMENSOES | sim |
| 6 | Invólucros | Cartucho Composto | 3 dimensões | TRES_DIMENSOES | sim |
| 7 | Impressos | Lâmina Simples | 2 dim (aberto+fechado) | ABERTO_FECHADO | sim |
| 8 | **Envelope** | Lâminas | **vazio** | TRES_DIMENSOES | **não** |
| 9 | **Display** | Lâminas | **vazio** | TRES_DIMENSOES | **não** |
| 10 | TESTE | Cartucho | 3 dimensões | (não importado) | n/a |
| 11 | **Impressos** | Lâminas | **vazio** | TRES_DIMENSOES | **não** |
| 12 | Venda de Cartão | Lâmina Simples | 2 dimensões (660 x 960) | DUAS_DIMENSOES 660x960 | sim |

Causa: o importador (`cadastros-graficos/importacao/mapeamento.ts`) só reconhece três textos de formato. Com o campo
vazio, o valor fica `undefined` e o banco assume o padrão `TRES_DIMENSOES`. **[CÓDIGO]**

## 4. Estado do Vizor em produção (Carton Wega, 20/11/2026) **[VIZOR-PROD]**

- Catálogo: 5 linhas, 11 produtos, 14 tipos de plano, 21 tipos de embalagem, 16 padrões de plano, 1.575 relações.
- Migração de tiragens aplicada: tabela `item_tiragem_orcamento_grafico` com a coluna `contexto`; 0 linhas (ninguém
  salvou várias tiragens ainda).
- Cálculos migrados: 7.951 (Cartucho 4.871, Cartucho Composto 1.962, Lâminas 695, Lâmina Simples 250, Sacola 173).
- Orçamentos: 7 (testes). Itens: 6, **nenhum com `produto_grafico_id`**. O orçamento nº 7 não tem item salvo.
- **Todos os produtos têm `tipo_embalagem_id` vinculado** (ex.: Display → `CG-EMB-9`).
- Plano único (`fixo = true`): CARTUCHO, LÂMINA SIMPLES, SACOLA (e RÓTULO, sem linha).
- Planos permitidos por produto (relação PRODUTO→PLANO):
  - Cartuchos: CARTUCHO. Cartucho Composto e Cartelas: Cartão, Microondulado. Caixa: Berço, Cartão, Microondulado.
    Invólucros: Invólucros.
  - Lâminas (Impressos nº 11, Envelope, **Display**): Base, Envelope, Impressos.
  - Lâmina Simples (Impressos nº 7, Venda de Cartão): LÂMINA SIMPLES. Sacola: SACOLA.
- Display: 5 atividades (Caixa Padrão, Colagem Manual, Colocação de Alça, Embalar, Envase), 0 itens diversos.
- Tipos de plano de Lâminas: ocorrências `UMA`, cálculo automático de formato `OPCIONAL`, formato "3 dimensões".
  Os demais: ocorrências `LIVRE`, cálculo automático `NAO`.
- Padrões de plano (`default_produto_plano`): 16 linhas, quase todas com cores 0/0 e sem atividades pré-marcadas.
  Exceção: Venda de Cartão (sem impressão, 2 atividades pré-marcadas). Coerente com o Calcgraf (`ProdutosxPlanos` zerado).
- **Previsões de bloco do plano** (`prev_capa_externa`, `prev_microondulado`, `prev_capa_interna`, `prev_fibra`):
  `null` nos 14 tipos. No front, `null` significa "mostrar" (`BlocosPorTipoPlano`).
- Atividades com `acondicionamento = true`: 2 de 67.

## 5. Divergências encontradas

| # | Divergência | Evidência | Causa | Correção proposta | Gravidade |
|---|---|---|---|---|---|
| D1 | Display, Envelope e Impressos (nº 11) mostram Comprimento/Largura/Altura/Abas; no Calcgraf só "Formato Página" | §3.1; print do Display | Importador sem regra para formato vazio | Definir o modo desses 3 produtos (provável `PAGINA`, a confirmar com prints) e corrigir o importador | Alta |
| D2 | "Tipo de Produto" não vem preenchido ao escolher o produto | Display está vinculado a `CG-EMB-9`; print mostra o campo vazio | A tela aplica padrões de plano e atividades, mas não copia o tipo do produto | Preencher o tipo a partir de `produto.tipoEmbalagemId` (item novo, campo vazio) | Alta |
| D3 | Tela do plano mostra capa externa + microondulado + capa interna em **todo** tipo | `prev_*` = `null` nos 14 tipos | Previsões nunca foram cadastradas (o Calcgraf resolve isso em código por especialista) | Cadastrar as previsões por tipo, conforme os prints de cada linha | Alta |
| D4 | Plano só pode ser incluído depois de salvar o item | Print do Vizor: "Salve o item para incluir planos" | Desenho do grid (cada plano grava no servidor) | Decidir: aceitar, ou salvar automaticamente ao clicar em Incluir | Média |
| D5 | Tipo "Display" tem fórmula 2D (`L`, `A`) mas o produto está em 3 dimensões | `CG-EMB-9` × `modo_formato` | Consequência de D1 | Resolvido junto com D1 | Média |
| D6 | Linhas de plano único com mais de um plano no Calcgraf | Cartucho 149, Sacola 31, Lâmina Simples 2 | Existe "plano adicional" no especialista Simples; a tabela de adicionais está vazia no backup | A confirmar com o usuário como isso é usado; hoje o Vizor não cria plano em item de plano único | Média |
| D7 | Tela de Acabamentos mostra "Acondicionamento" dentro da lista **e** como bloco separado | Prints do Vizor | Apresentação duplicada | Conferir com o print do Calcgraf (2 listas em bloco próprio) | Baixa |
| D8 | ~~Nota antiga "39/53 atividades com acondicionamento" × 2 de 67 em produção~~ **Resolvido, sem divergência** | §4; HANDOFF §12.1 | "39" e "53" são os **códigos** das atividades Caixa Padrão e Embalar, não contagens | Nenhuma: só essas duas atividades têm a chave Acondicionamento, e produção tem exatamente 2 | — |
| D9 | 4 tipos de plano sem linha (RÓTULO fixo, Laminas, Capa, Miolo), vindos de linhas canceladas | §4 | Importação de tipos de linhas inativas | Inativar ou ignorar; só aparecem se relacionados a um produto | Baixa |
| D10 | Fechamento por tiragem editável e escolha da tiragem na aprovação | Spec `orcamento-grafico-tiragens-por-item` | Tarefas 6 e 7 pendentes | Implementar após a aprovação do desenho | Alta |

## 6. Dúvidas já sanadas

- *O Display está vinculado a um tipo de embalagem?* **Sim**, a `CG-EMB-9`. O problema é só da tela (D2).
- *Quais linhas são plano único?* **Cartucho, Lâmina Simples e Sacola**, no Calcgraf e no Vizor.
- *O Vizor aceita Base/Envelope/Impressos para o Display?* **Sim**, igual ao Calcgraf.
- *Por que o Calcgraf mostra "Formato Página" no Display?* Porque o produto tem Formato vazio (D1).
- *As 5 linhas do diálogo "Novo Item" estão certas?* **Sim**, são as 5 ativas do Calcgraf.
- *As tiragens funcionam em produção?* A estrutura e o cálculo, sim. Falta a edição por tiragem e a escolha na aprovação.

## 7. Dúvidas em aberto (dependem dos prints ou do usuário)

1. **Modo de formato** correto de Display, Envelope e Impressos (nº 11): o que o Calcgraf mostra na tela de cada um.
2. **Tela do plano por tipo e por linha**: campos exatos e quais blocos aparecem (Cartão, Microondulado, Berço,
   Invólucros, Base, Envelope, Impressos, Cartucho, Lâmina Simples, Sacola). É o que define as previsões (D3).
3. **Plano adicional** em Cartucho, Sacola e Lâmina Simples: como é criado e se ainda é usado (D6).
4. **Ocorrências**: nas Lâminas é fixa em 1 (`UMA`); nas demais é livre. Confirmar se o campo fica bloqueado.
5. **"Cálc.Autom.Formato = OPCIONAL"** das Lâminas: o que o usuário vê (botão? valor sugerido?).
6. **Fechamento**: mostra o item selecionado ou o total do orçamento? Há botões por tiragem?
7. **Aprovação com várias tiragens**: confirmar que o pedido recebe uma só (a evidência do banco é de 1 lote de OP por cálculo).
8. **Cálculo por especialista**: o Vizor usa um motor único; pode haver regra própria de Cartucho Composto ou Editorial
   que o motor único não reproduz. Verificar com casos reais por linha.

## 8. Prints pedidos ao usuário (por linha)

Para cada linha (Lâminas, Lâmina Simples, Cartucho, Sacola, Cartucho Composto), com o **mesmo orçamento** aberto:
1. Tela do **Orçamento** (grid de itens, "Dados do Item" e aba **Fechamento** do item selecionado).
2. Tela do **Item** de cada produto da linha (Lâminas: Display, Envelope, Impressos; Lâmina Simples: Impressos, Venda de
   Cartão; Cartucho Composto: Cartucho Composto, Cartelas, Caixa, Invólucros).
3. Tela de **Inclusão/Alteração de Tipo de Plano** de **cada tipo** (Base, Envelope, Impressos, Cartão, Microondulado,
   Berço, Invólucros), com o campo "Tipo de Plano" aberto mostrando as opções.
4. Para as linhas de plano único, a tela do item com a lista de atividades de acabamento e o botão de plano adicional.
5. O botão **Propriedades/Preview** (ícone ao lado de "Formato Página" ou do formato).
Sugestão de nome do arquivo: `linha-produto-tela.png` (ex.: `lâminas-display-item.png`).

## 9. Pendências de implementação consolidadas

Já entregue (back e front em produção): várias tiragens por item (schema, serviço, rotas, Fechamento por tiragem,
campo "Tiragens"). Fica para depois da conferência: D1, D2, D3, D4, tarefas 6 e 7 da spec de tiragens, e o que os prints
revelarem. Ordem sugerida: D2 (rápido, só tela) → D1 e D3 (dados e importador, com os prints) → tarefa 6 → tarefa 7.

## 10. Como esta conferência foi feita (para repetir)

- Calcgraf: consultas somente leitura no banco restaurado (`_LinhasProduto`, `Produtos`, `Planos`,
  `_CaracteristicasPlano`, `CalculoHeader`, `CalculoPlanos`, `CalculoTiragens`).
- Vizor: transação `READ ONLY` no banco de produção (`linha_produto`, `produto_grafico`, `tipo_plano_grafico`,
  `default_produto_plano`, `relacao_cadastro_grafico`, `tipo_embalagem`, `orcamento_grafico`, `item_orcamento_grafico`,
  `calculo_grafico`, `acabamento_grafico`). Nenhuma escrita.

## 11. Atualização de 23/11/2026 (novos prints das 5 linhas + dados do Calcgraf)

**Correções ao handoff e a este documento**
- HANDOFF §12.3 diz que os planos de Lâminas **não têm** "Ocor."; os prints novos (Display, Envelope, Impressos) **mostram**
  o campo "Ocor." no plano. Em produção o tipo tem `ocorrencias = UMA`. Tratar como campo presente e fixo em 1.
- D8 era leitura errada minha (ver tabela de divergências).

**Novo nos prints**
- Item de **Cartelas** (2 dimensões) mostra "Comp. x Largura" **e** "Alt Tampa"; **Invólucros** mostra Comp x Larg x Alt,
  Aba Cola, Aba Fec e Alt Tampa. Em produção `possui_altura_tampa` está **nulo nos 11 produtos**: precisa ser cadastrado.
- O item de **Cartucho** (plano único) tem combo **Microondulado** com botão de cópia e **Ajuste Corte Micro** com o botão
  Propriedades/Preview na própria tela.
- Em todos os prints o campo Produto está vazio ou o Tipo de Plano não foi escolhido: eles mostram a tela **vazia**. Os campos
  ficam ocultos até escolher o produto e habilitados até escolher o tipo de plano. Por isso **não provam** quais blocos
  do plano cada tipo usa (D3 continua aberto).

**Achado nos dados do Calcgraf (Cartucho Composto, 1.793 cálculos com vários planos)** **[CALC-BD]**
- Cada "plano" que o usuário inclui pode virar **mais de uma linha** em `CalculoPlanos`, marcadas por `FlagMicro` (a
  camada microondulada) e `FlagCapaMicro` (a capa do micro). No print do Cartucho Composto, "PARTE 02" aparece duas vezes
  no grid: a capa (Stora Enzo, Cortadeira/Guilhotina/CVM) e o micro (Micro Pardo, Mazola (acoplagem)), cada um com seu roteiro.
- O tipo de plano **não** decide se há micro: o tipo **Cartão** tem micro em 1.869 linhas e capa-do-micro em 258
  (de 4.479); o tipo **Microondulado** quase não é usado (19 linhas). Logo os 3 blocos do formulário valem para os dois
  tipos e quem decide é o que o usuário preenche.
- Sentido da onda e Ajuste de Corte Micro estão em zero em todas as linhas lidas (nessas colunas).
- **Consequência para o Vizor:** hoje 1 plano = 1 linha, com os 3 blocos dentro de `especificacao` e um só custo. Se o custo
  do Calcgraf é por linha (cada camada com seu roteiro), o Vizor precisa decidir se cada camada vira uma linha de custo.
  **Não verificado:** a regra que gera as linhas e como o roteiro de cada camada é escolhido (Mazola entrando só no micro).

