# Orçamento Gráfico — prazos, cliente, margem e buscas (pedido de 25/11/2026)

Escopo: itens 1 a 7 do pedido do usuário. O item 0 (limpeza da Carton Wega) já foi executado
(`scripts/limpar-comercial-orcamento-empresa.mjs`, backup em `cartoon/backups/`).

Decisões já tomadas com o usuário:
- Item 5: quem altera o valor unitário é definido no menu de Permissões (Orçamento → Permissões).
- Item 6: regra (b), valor total mínimo para permitir parcelamento; abaixo dele, só pagamento em uma vez.

Glossário:
- **Prazo**: registro de `CondicaoPagamentoComercial` (descrição, dias, parcelas) do Comercial.
- **Orçamento com cálculo**: orçamento com preço (`precoVenda > 0`, ou `valorTotalConsolidado > 0`,
  ou algum item com `valorTotal > 0`).
- **Condição do Pedido de Venda**: `CondicaoPagamento` da tabela de preço (cadastro de Vendas).

## R1 — Prazo travado depois do cálculo
1. O orçamento passa a ter prazo próprio (`prazoPagamentoId` + texto). Ao encaminhar o Pedido/Proposta
   ou converter a solicitação do Portal, o prazo é copiado para o orçamento.
2. Com o orçamento com cálculo, o prazo NÃO pode ser alterado no Pedido/Proposta (Comercial) nem no
   Portal: a tela mostra o campo bloqueado com o motivo, e o back recusa a alteração (409).
3. O prazo só muda dentro do orçamento, em RASCUNHO. Se o orçamento já tem cálculo, trocar o prazo
   marca o orçamento como "precisa recalcular": a etapa de cálculo volta para EM_CALCULO e Enviar e
   Validar ficam bloqueados até um item ser recalculado.
4. O prazo do orçamento é refletido no Pedido/Proposta e na solicitação do Portal vinculados.
5. O Pedido de Venda gerado na aprovação recebe a condição de pagamento correspondente, quando houver
   condição com os mesmos dias e parcelas na tabela de preço usada.

## R2 — Último cálculo do cliente
1. Ao escolher o cliente no orçamento (novo orçamento e cabeçalho), a busca de cálculo continua igual
   e, ao lado dela, aparece o último cálculo do cliente: nº, data, produto/descrição, tiragem e valor.
2. Botão "Usar": puxa esse cálculo para o orçamento, igual ao "Localizar Cálculo".
3. Último cálculo = o mais recente entre os cálculos da biblioteca do cliente (por cliente, CNPJ ou
   código legado) e os cálculos usados em orçamentos do cliente. Sem nenhum: "Nenhum cálculo anterior".
4. A busca de cálculo abre já filtrada pelo cliente escolhido (o filtro pode ser limpo).

## R3 — Cliente novo pelo orçamento (cadastro rápido)
1. Em orçamento RASCUNHO (novo orçamento e trocar cliente no cabeçalho), quando o cliente não existe,
   o usuário abre o cadastro rápido sem sair da tela.
2. Campos: CNPJ/CPF (obrigatório, com consulta à Receita para CNPJ), Razão Social (obrigatória),
   Nome Fantasia, Telefone, E-mail, UF, Cidade.
3. Ao gravar, o cliente é criado na empresa e já selecionado no orçamento.
4. CNPJ/CPF já cadastrado: não duplica; informa e oferece selecionar o existente.

## R4 — Histórico de prazos do cliente e prazo padrão
1. Cada cliente tem o histórico dos prazos praticados: prazo, quantas vezes, última vez e onde
   (orçamento, pedido/proposta, pedido de venda). Visível na ficha do cliente e no orçamento.
2. Ao abrir novo orçamento, novo pedido/proposta, nova solicitação no Portal ou novo pedido de venda,
   o prazo padrão é o mais usado pelo cliente (empate: o mais recente). O usuário pode trocar.
3. O histórico é derivado dos documentos existentes (sem digitação manual).

## R5 — Valor unitário manual com permissão, log e margem mínima
1. Nova permissão "Alterar valor unitário do orçamento" no menu Orçamento → Permissões, desligada por
   padrão (ADMIN/SUPER_ADMIN sempre podem).
2. Com a permissão, o usuário digita o valor unitário (ou o total) de cada tiragem; sem ela, o campo
   fica somente leitura e o back recusa (403).
3. Toda alteração grava log: orçamento, item, tiragem, valor anterior e novo, margem anterior e nova,
   usuário, data e se ficou abaixo da margem mínima. O log é consultável no orçamento.
4. Parâmetro do orçamento "Margem mínima (%)" (margem = (preço − custo) ÷ preço).
5. Cada tiragem e o Fechamento sinalizam: verde "Dentro da margem" (≥ mínima) ou vermelho
   "Abaixo da margem". Abaixo da margem é permitido, mas fica sinalizado e registrado no log.

## R6 — Valor mínimo para parcelar
1. Parâmetro do Comercial "Valor mínimo para parcelamento (R$)". Zero/vazio = sem limite.
2. Prazo com mais de 1 parcela só é aceito se o valor total do documento for ≥ o mínimo.
3. Vale onde o valor é conhecido: orçamento (ao escolher prazo, ao Enviar e ao Aprovar) e pedido de
   venda. No Pedido/Proposta e no Portal (sem valor ainda) a tela avisa a regra, e a checagem ocorre no
   orçamento.
4. A mensagem informa o mínimo e o valor atual.

## R7 — Busca sem botão "Pesquisar" em todo o orçamento
1. Nas buscas do módulo do orçamento, o botão "Pesquisar" sai; a pesquisa roda enquanto se digita
   (espera de 300 ms) e por "contém", sem diferenciar maiúsculas.
2. Telas: Localizar Cálculo, Cálculo Padrão (biblioteca), Cliente Principal, Pesquisa de Acabados,
   Pipeline Comercial e lista de orçamentos.
3. Código do cliente e nº do orçamento passam a casar por "contém".
