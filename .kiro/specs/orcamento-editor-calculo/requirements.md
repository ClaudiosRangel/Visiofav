# Requisitos — Editor do Cálculo (Planos do Cálculo)

Fonte: `docs/estudo-editor-calculo-planos-calcgraf.md` (estudo sobre o banco restaurado do Calcgraf) e as
decisões do usuário de 27/11/2026. Segue a visão obrigatória do front (Orçamento → Item → Plano) do steering
`orcamento-grafico-visao-front-calcgraf.md`; o Editor é uma tela NOVA do item, não substitui a tela do item
nem a janela do Tipo de Plano.

## Glossário
- **Tipo de Plano**: o que o vendedor informa na tela do item (grade "Tipos de Plano" ou plano implícito do
  produto de plano único). Hoje: `PlanoCalculoGrafico` (multi-plano) ou os campos achatados do item.
- **Plano do Cálculo (folha)**: cada folha que o motor custeia. Gerada a partir do Tipo de Plano e refinada
  no Editor.
- **Modelo da linha**: equivalente à "Expressa" do Calcgraf (`_LinhasProduto.IdExpressa`). Define a regra de
  geração: SIMPLES, EDITORIAL, CARTUCHO_COMPOSTO, BLOCADO, OUTRO.

## R1 — Modelo da Linha de Produto
1. `LinhaProduto` ganha o campo `modelo` (SIMPLES | EDITORIAL | CARTUCHO_COMPOSTO | BLOCADO | OUTRO).
2. A importação preenche pelo `IdExpressa` do legado (Cartucho Composto → CARTUCHO_COMPOSTO; Lâminas,
   Editorial, Tampa/Fundo, Display, Cards → EDITORIAL; Lâmina Simples, Cartucho, Rótulo, Sacola → SIMPLES;
   Contínuo, Blocado → BLOCADO; demais → OUTRO).
3. O cadastro de Linhas de Produto permite alterar o modelo. Nenhum comportamento depende do NOME da linha.

## R2 — Geração dos Planos do Cálculo
1. Modelo CARTUCHO_COMPOSTO: cada Tipo de Plano gera a **capa** e, quando informados, o **micro** (suporte
   microondulado, sem impressão, exibido com "(M)") e a **capa interna** (suporte, cores e processo da capa
   interna). Micro e capa interna são opcionais.
2. Demais modelos: cada Tipo de Plano gera 1 Plano do Cálculo (plano único: 1 folha do item).
3. Repartição das atividades marcadas no Tipo de Plano (só CARTUCHO_COMPOSTO): impressão, verniz, corte e
   vinco e destaque na capa; acoplagem no micro (ou na capa interna sem micro); corte inicial (cortadeira e
   guilhotina) em cada folha. Nos demais modelos, todas na única folha.
4. Gerar de novo preserva os campos digitados à mão no Editor e marca a folha "alterada no Editor" quando
   ela diverge do Tipo de Plano.
5. A geração só roda quando o usuário abre o Editor e pede "Gerar planos" (ou ao salvar o Tipo de Plano de
   um item que JÁ tem Planos do Cálculo). Item sem Planos do Cálculo segue o cálculo atual, sem mudança.

## R3 — Editor do Cálculo (tela)
1. Botão "Editor" na tela do item (orçamento em Rascunho; fora disso só leitura).
2. Cabeçalho: nº do cálculo, linha de produto, tiragem, sigla do acabado, "Gerado a partir do cálculo N".
3. Grade Produto (tiragem, formato, acabamento do produto) e grade Planos do Cálculo (nome com "(M)" no
   micro, tiragem, suporte, formato, pré-impressão, impressão, acabamento, custo).
4. Incluir, copiar, excluir e reordenar planos. Plano incluído nasce com tira/retira e pinça ligados,
   refile da folha 2, refile final 1, contra-pinça 8, e aparece também na grade de Tipos de Plano do item.
5. Atividades de Acabamento (marcar/desmarcar) com "Aplicado sobre" (quais planos; atividade do produto
   quando nenhum) e botão "Detalhes...".
6. Itens Diversos e Itens Fornecidos do item (os mesmos que já existem).

## R4 — Janela "Planos" (por Plano do Cálculo)
1. Plano: tipo, nome, tiragem, formato (A), ocorrências, fibra.
2. Suporte: tipo/gramatura, formato da folha (C), fibra, NC (suporte não cadastrado: nome, gramatura,
   espessura, formato, custo/kg, frete/kg, crédito ICMS/IPI), aproveitamento (B/C) e (A/C), quebra fixa,
   variável e total, apara.
3. Opções: não calcular plano, não cobrar impressão, não exibir na proposta, permitir tira/retira,
   considerar pinça, refile folha, refile final, contra-pinça, corte duplo.
4. Grade das atividades do plano: repetições, formato (B), centro de produção, cores, tira/retira, entradas.
5. Impressão em até 3 processos: cores, processo, CTP/fotolito/contatos/montagem, cobertura e tintas.
6. Custo do Plano ao vivo.
7. Campo digitado à mão fica marcado e não é sobrescrito por recálculo nem por "Gerar planos".

## R5 — "Detalhes..." da atividade (por atividade e plano)
1. Tiragem, produção/hora, entradas, repetições, tempo do 1º acerto, quantidade de acertos, tempo por acerto,
   quebra fixa e variável, formato de corte, centro de produção, restrições.
2. Materiais da atividade (ex.: BOPP, filme hot stamping com medida) com área de cobertura % frente/verso.
3. Informação complementar da atividade (texto livre; vai para OP/proposta como hoje).

## R6 — Cálculo
1. Item com Planos do Cálculo: custo = soma das folhas, cada uma calculada pelo motor atual
   (`calcularOrcamentoGrafico` não muda).
2. Item puxado de cálculo existente mantém a ancoragem (`ancorarCustoCalcgraf`) e o valor de hoje.
3. Com Planos do Cálculo, a aproximação de camadas (`camadas-plano.ts`) não é aplicada (o micro e a capa
   interna passam a ser folhas reais); sem Planos do Cálculo ela segue como hoje.
4. Montagem e Formato de Corte na tela do item seguem só leitura (decisão 27/11/2026); passam a mostrar os
   da folha principal quando houver Planos do Cálculo.

## R7 — Status por item
1. A grade de itens do orçamento mostra "Ped: N" e/ou "OP: N" do item, com link para o pedido de venda e
   para a OP.

## R8 — Não regressão e segurança
1. `empresaId` explícito em toda consulta e gravação.
2. Orçamentos existentes não mudam de valor até alguém gerar os Planos do Cálculo deles.
3. Schema + `migrate-prod.ts` no mesmo commit, idempotente.

## Fora do escopo desta spec
- Cópia congelada do cálculo ao emitir OP (opcional, spec própria).
- Cadeado do Processo de Impressão (aguarda definição do usuário).
- Expressas EDITORIAL/BLOCADO com regras próprias além de 1 tipo = 1 folha.
