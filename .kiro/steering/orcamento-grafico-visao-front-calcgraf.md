# Orçamento Gráfico — VISÃO OBRIGATÓRIA DO FRONT (hierarquia Orçamento → Item → Plano)

**LEIA ANTES DE QUALQUER ALTERAÇÃO DE TELA DO ORÇAMENTO GRÁFICO.** Este arquivo registra a
visão do usuário (passada várias vezes e implementada errada em fases anteriores). Ela tem
prioridade sobre qualquer desenho antigo (`EditorItem` de 8 seções ancoradas, wizard `/novo`,
modal `PlanosDoItem`). Nunca simplificar, juntar ou "otimizar" estas separações. Em dúvida,
perguntar ao usuário antes de implementar. Textos visíveis nunca citam o sistema legado.

Fonte: telas do sistema de referência enviadas pelo usuário em 17/11/2026 (prints do orçamento
nº 5621 "Cartucho Composto", cálculo 15652, e nº 5622 "Cartucho", cálculo 15654).

## 1. Hierarquia (regra central)

```
ORÇAMENTO  (1)
 └─ ITEM  (N itens por orçamento)          ← dados COMUNS do produto
     └─ PLANO  (N planos por item)         ← especificação própria de cada plano
FECHAMENTO = totalizador de TODOS os itens (com seus lançamentos)
```

1. Um orçamento tem **vários itens**.
2. Cada item tem **dados do produto/item** (comuns a todos os planos).
3. Dentro do item, exceto os produtos de **plano único** (linha **Cartucho** e **Lâmina Simples**),
   pode haver **vários planos**; **cada plano tem suas próprias especificações**.
4. O **Fechamento** totaliza todos os itens do orçamento, com os lançamentos de cada um.
5. O Vizor deve mostrar **exatamente** o que é dado do ORÇAMENTO, do ITEM e do PLANO,
   **separados**. Hoje está tudo misturado em uma página só (isso é o erro a corrigir).

## 2. Tela 1 — ORÇAMENTO (lista de itens + totalizador)

- Cabeçalho: Série, Nº do Orçamento, Data, **Cliente Principal** (código + nome + busca).
- Grid "Itens do Orçamento": `item | Cálculo | Linha de Produto | Tipo de Produto | Tiragens | Descrição | Status`
  (ex.: 1 | 15652 | CARTUCHO COMPOSTO | Cartucho Composto | 6.000 | CX. CARTONAGEM P/EXPOSITOR… | Liberado).
  Vários itens por orçamento. Checkbox "Reforma Tributária 2027".
- Painel "Dados do Item" (resumo em texto do item selecionado):
  - multi-plano: *Especificações Gerais* (formato, modelos) · *Tipos de Plano* (suporte, cores,
    formato, acabamentos de cada plano) · *Acabamentos* (de produto) · *Itens Diversos*.
  - plano único: Formato · Suporte · Cores · Acabamento (com detalhes: folhas, fibra, matriz/faca…) · Itens Diversos.
- Abas **Fechamento** e **Comissões**. Fechamento = grid `Tiragem | Margem | C.Marg. | Valor Unitário | Valor Total`
  (uma linha por tiragem), **totalizando os itens**.
- Duplo clique/abrir no item → Tela 2.

## 3. Tela 2 — ITEM (dados do produto, comuns a todos os planos)

Título = nome do produto. Campos do ITEM (nível produto):
`Produto` (fixo) · `Tipo` (tipo de produto) · `Descrição` · `Sigla Acabado` (+ busca/ícones) · `Tributação` ·
`Tiragens` · `Modelos` · `Comp x Larg x Alt` · `Aba Cola` · `Aba Fec` · `Alt Tampa` (quando o produto tem) ·
**Acabamentos de Produto** (lista de atividades marcáveis, ex.: Colagem Manual, Colocação de Alça, Envase) ·
**Acondicionamento** (2 listas marcáveis: Caixa Padrão/Embalar, e a escolhida) + **Conteúdo por volume** ·
botões/linhas **Itens Diversos · Itens Fornecidos · Campos Livres · Observação · Obs. Áreas de Op**.

### 3.A Item de PLANO ÚNICO (linha Cartucho e Lâmina Simples) — NÃO tem grid de planos
Tudo na MESMA tela do item (print do orçamento 5622): além dos campos do item acima, mostra
os campos do único plano, diretamente: `Cores` (ex.: 5x0) · `Processo de Impressão` (+ botão Pré e cadeado) ·
`Cobertura de Tinta` · `Fabricante` · `Suporte` (+ NC) · `Form.Sup.` · `Fornecido` · `Microondulado` ·
`Fibra` · `Mont.` (montagem, ex.: 2x2, calculada) · `Formato de Corte` (calculado) · `Ajuste Corte Micro (mm)` ·
e o bloco **Acabamento → Atividades** (lista longa marcável: AFT70, Bimac, Bobst E, CVM, Colagem Manual…).
Ou seja: no plano único o suporte/cores/formato/acabamentos ficam NA tela do item (é um plano implícito).

**Lâmina Simples (print enviado em 17/11/2026) — também PLANO ÚNICO**, mesma estrutura do Cartucho, sem grid de planos.
Campos vistos: `Produto` (combo; opções vistas: Impressos, Venda de Cartão) · `Tipo de Produto` · `Descrição` · `Sigla Acabado` (+ busca/ícones) ·
`Tributação` · `Modelos` (padrão 1) · `Cores` (0 x 0) · `Processo de Impressão` (+ Pré e cadeado) · `Cobertura de Tinta` ·
`Fabricante` ((todos)) · `Suporte` (+ NC) · `Fornecido` · botão de propriedades à direita (provável Mont./Formato de corte) ·
bloco **Acabamento** com duas listas marcáveis: **Atividades** (AFT70 Coladeira, Bimac Acoplagem, Bobst 68 Coladeira, Bobst E Corte e Vi,
Bobst E\CV\Relevo, Bobst S, CVM, CVMR, Cortadeira Grande/Pequena, Dayuan…) e **Restrições** (Acerto Acoplado Colagem Lateral,
Acerto Acoplado Fundo Automático, Acerto Lateral Alterando o Tamanho, Acerto Saindo Fundo Aut. para Lateral, Acerto Saindo Lateral para
Fundo Aut., Acerto Trocando Versão, Fundo Automático Normal, Lateral Simples, Lateral Simples Pequeno) ·
**Acondicionamento** (2 listas) + `Conteúdo por volume` · botões Itens Diversos / Itens Fornecidos / Campos Livres / Observação / Obs. Áreas de Op.
Diferenças em relação ao Cartucho: tela mais enxuta, sem Microondulado/Fibra visíveis, e **lista de Restrições** ao lado das Atividades
(restrições de acerto/colagem; no Vizor entram como parte do bloco Acabamento do plano implícito). Comp x Larg x Alt não aparece neste print
(área coberta pelo dropdown) — confirmar com o usuário antes de assumir.

**Os campos da tela do item dependem do `Produto` escolhido (dirigido pelo cadastro).** Prints de 17/11/2026, mesma tela "Lâmina Simples":
- Produto **Impressos** (cadastro "2 dim (aberto+fechado)"): `Formato Fechado` + `Formato Aberto` (0 x 0), lista de **Restrições** ao lado das Atividades,
  Acondicionamento com Caixa Padrão/Embalar.
- Produto **Venda de Cartão** (cadastro "2 dimensões", formato padrão 660 x 960): `Formato Final` pré-preenchido, **sem Restrições**, campo
  `Informações Complementares` abaixo das Atividades, Acondicionamento só com Embalar, Atividades pré-marcadas (ex.: Cortadeira Grande).
- No legado, `Produtos` guarda `Formato` (nº de dimensões), `FormatoDef1/2` (formato padrão) e flags de exibição (Montagem, Formato de Corte, Orelha, Aba, Sanfona…);
  `ProdutosxPlanos` (cores/processo/cobertura padrão por plano), `ProdutosxAtividades` (atividades pré-marcadas por produto/plano).
  Logo, no Vizor a visibilidade de cada campo e os padrões vêm do CADASTRO do Produto Gráfico, nunca de nome fixo no código.
- **Verificado em 17/11/2026:** o `ProdutoGrafico` do Vizor JÁ tem `modoFormato` (TRES_DIMENSOES | DUAS_DIMENSOES | ABERTO_FECHADO | SANFONA_ABAS | PAGINA),
  `formatoPadraoLargura/Altura`, `exibeRestricoes`, `exibeInformacoesComplementares`, `semImpressao` e `DefaultProdutoPlano`; o importador já mapeou esses campos.
  As Restrições são filhas da atividade (`RestricaoAcabamento`, ex.: AFT70 → Lateral Simples). **Mas o editor do item (front) NÃO consome esses campos**
  (nenhuma referência a `modoFormato`/`exibeRestricoes` fora do cadastro) — a reforma deve passar a dirigir a tela do item por eles.

### 3.B Item MULTI-PLANO (demais produtos, ex.: Cartucho Composto, Caixa…) — tem grid "Tipos de Plano"
A tela do item mostra o **grid Tipos de Plano** com colunas `Nome | Suporte | Cores | Formato | Acabamento`
e botões **Incluir · Copiar · Excluir · Trocar/Reordenar · Desfazer**. Os campos de suporte/cores/formato/
acabamento do plano **NÃO aparecem soltos no item**; vivem dentro do plano (Tela 3).
Os "Acabamentos de Produto" (atividades do PRODUTO, ex.: Colagem Manual, Envase) continuam no item.

## 4. Tela 3 — PLANO ("Inclusão/Alteração de Tipo de Plano", abre ao incluir ou ao clicar no plano do grid)

Campos do PLANO:
- `Tipo de Plano` (combo conforme o produto: ex. Cartão, Microondulado) · `Nome` · `Ocor.` · `Tiragem` ((padrão) = do item).
- `Mont.` · `Corte` · `Formato Aberto` · `Form.Final (Comp x Larg x Alt x AltTampa)`.
- `Cores` · `Processo de Impressão` (+ Pré/cadeado) · `Cobertura de Tinta`.
- Capa externa: `Fabricante` · `Suporte capa externa` (+ NC, `Fornecido`) · `Fibra capa externa`.
- Microondulado: `Fabricante` · `Suporte microondulado` (+ NC, `Fornecido`) · `Sentido onda` · `Ajuste Corte Micro (mm)`.
- Capa interna: `Fabricante` · `Suporte capa interna` (+ NC, `Fornecido`) · `Cores` · `Processo de Impressão` · `Cobertura de Tinta`.
- **Acabamento → Atividades** (lista marcável do PLANO: AFT70 Coladeira, Bimac Acoplagem, Bobst E Corte e Vi, Cortadeira Grande, Verniz…).
- Ao clicar num plano já inserido no grid → reabre esta tela para alterar.
- Os campos exibidos dependem do **Tipo de Plano** (ex.: Cartão sem microondulado; Microondulado com capa externa/micro/interna).

## 5. Regras para implementar (não negociáveis)

1. **Três níveis visuais distintos**: (a) Orçamento (itens + Fechamento total), (b) Item (dados do produto),
   (c) Plano (especificação). Nunca misturar campos de plano na tela do item multi-plano, nem campos de item na tela do plano.
2. **Plano único (Cartucho / Lâmina Simples):** uma única tela de item com os campos do plano embutidos; sem grid de planos.
   Quem decide é o cadastro do Produto (plano fixo / `TipoPlano.fixo` e linha de produto); não hardcodar nomes.
3. **Multi-plano:** item mostra grid de planos + Incluir/Copiar/Excluir/Reordenar; clicar no plano abre a Tela 3.
4. **Fechamento:** totalizador do orçamento, por tiragem, somando TODOS os itens com os lançamentos de cada item
   (margem, C.Marg., valor unitário, valor total). Não é seção dentro do editor do item.
5. O back já tem a hierarquia (`OrcamentoGrafico` → `ItemOrcamentoGrafico` → `PlanoCalculoGrafico`);
   o item tem hoje campos achatados de plano (papel, cores, máquina, acabamentos) usados para PLANO ÚNICO;
   multi-plano usa `PlanoCalculoGrafico`. Preservar o cálculo e a ancoragem (`ancorarCustoCalcgraf`) sem alterar.
6. Qualquer spec/tarefa nova de front do orçamento deve citar esta visão e conferir contra os 3 níveis antes de codar.
   Aprovar o desenho das telas (wireframe em texto) com o usuário ANTES de implementar.
7. Não reaproveitar o `EditorItem` de 8 âncoras como está: o desenho certo é Item (comum) + Plano (separado).

## 6. Erro histórico (para não repetir)
O front das fases anteriores colocou Produto/Tipo/Medidas/Papel/Cores/Acabamentos/Materiais/Itens/Estrutura/Fechamento
numa página única (`EditorItem`), com "Tipos de Plano" só leitura e condicional, e o plano editado num modal separado
(`PlanosDoItem`). Resultado: não dá para ver o que é do item e o que é do plano. A reforma deve seguir as seções 2 a 4 acima.
