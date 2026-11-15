# Requisitos — Orçamento Gráfico: Cadastros e Relações (Fase 1)

## Introdução

O sistema legado controla a tela de orçamento por cadastros e por uma tabela genérica de relações: o
**Produto** define os tipos de plano e as atividades de produto; o **Tipo de Plano** define as atividades de
plano, coberturas e suportes; a **Atividade** define restrições, materiais e centros. O Vizor ainda não tem
Produto nem Tipo de Plano como cadastro, nem essas relações, e o material de acabamento não é escolhido por
atividade.

Esta fase entrega a base de dados, a API, a importação e as telas de cadastro e visualização. A tela
mestre-detalhe do item e dos planos é a Fase 2 e consome o catálogo criado aqui. A análise completa está em
`docs/orcamento-planos-calcgraf-HANDOFF.md` e as decisões em `design.md` desta spec.

## Glossário

- **Produto Gráfico**: tipo de produto de uma linha (Cartuchos, Caixa, Envelope, Display, Sacola…).
- **Tipo de Plano**: modelo de plano (Cartão, Microondulado, Berço, Invólucros, Envelope, Base, Impressos e os planos fixos das linhas).
- **Plano fixo**: plano único e implícito de uma linha (Cartucho, Lâmina Simples, Sacola).
- **Relação**: ligação entre dois itens de cadastro na tabela genérica (ex.: Plano → Atividade).
- **Atividade**: acabamento ou impressão (`AcabamentoGrafico`), de nível Plano ou Produto.
- **Seleção de Material**: escolha de um material (Cola Branca, BOPP…) para uma atividade, com parâmetros.
- **TipoParam**: tipo do parâmetro do material (0 sem parâmetro, 1 % de cobertura, 2 dimensões em mm, 3 medida linear em mm, 4 quantidade).
- **Item puxado**: item criado a partir de um cálculo da biblioteca, com custo ancorado.
- **Campo Livre**: campo configurável por proprietário (Solicitação, Pedido, Recusa).
- **Código de origem**: código do registro no sistema legado, usado só para casar a importação.

## Requisitos

### Requisito 1: Cadastro de Produto Gráfico

**User Story:** Como administrador do orçamento, quero cadastrar os produtos de cada linha com seus parâmetros, para que a tela do orçamento mostre apenas o que cada produto permite.

#### Acceptance Criteria

1. THE sistema SHALL permitir criar, listar, editar e inativar produtos gráficos, sempre isolados por `empresaId`.
2. THE sistema SHALL guardar por produto: linha de produto, tributação 2026 e 2027, classificação fiscal, fechamento, base de preço, unidade, prazo de produção, faturamento mínimo (flag e valor), tipo de cartucho e modo de formato.
3. THE sistema SHALL aceitar os modos de formato três dimensões, duas dimensões, aberto e fechado, largura × altura × sanfona com abas, e página.
4. IF já existir produto com o mesmo código na empresa THEN o sistema SHALL responder 409 com mensagem legível.
5. WHEN um produto é inativado THEN o sistema SHALL mantê-lo nos itens já criados e removê-lo das listas de seleção novas.

### Requisito 2: Cadastro de Tipo de Plano

**User Story:** Como administrador, quero cadastrar os tipos de plano com seus parâmetros, para que cada plano nasça com os padrões corretos.

#### Acceptance Criteria

1. THE sistema SHALL permitir criar, listar, editar e inativar tipos de plano por linha de produto.
2. THE sistema SHALL guardar por tipo de plano: indicador de plano fixo, miolo, cálculo automático de formato (sim, não, opcional), cálculo da primeira medida, somar orelhas e lombada, ocorrências (uma, duas, livre), quebra padrão, corte duplo mínimo, suporte e gramatura padrão, montagem, pinça, fibra padrão, frente igual ao verso, caderno e margens 1 e 2 em mm.
3. WHERE o tipo de plano é fixo, THE sistema SHALL impedir a exclusão e permitir só a edição dos parâmetros.
4. IF o código já existir na empresa THEN o sistema SHALL responder 409.

### Requisito 3: Defaults do produto por plano

**User Story:** Como administrador, quero definir os valores iniciais de cada produto por tipo de plano, para o orçamento já vir preenchido.

#### Acceptance Criteria

1. THE sistema SHALL guardar por par produto e tipo de plano: sem impressão, processo de impressão, cobertura de tinta, cores de frente e verso, área de tinta em %, fabricante do suporte e atividades pré-marcadas.
2. THE sistema SHALL permitir um único registro por par produto e tipo de plano.
3. IF o tipo de plano não estiver relacionado ao produto THEN o sistema SHALL rejeitar o default com 422.
4. WHERE o produto tem plano fixo, THE sistema SHALL associar o default ao plano fixo da linha.

### Requisito 4: Tabela genérica de relações

**User Story:** Como administrador, quero marcar quais itens se relacionam (ex.: quais atividades pertencem a um tipo de plano), para controlar o que aparece na tela do orçamento.

#### Acceptance Criteria

1. THE sistema SHALL guardar relações com empresa, tipo e id de origem, tipo e id de destino, ordem e marcação padrão, com unicidade por combinação.
2. THE sistema SHALL aceitar somente os pares definidos na lista fechada: Produto→Plano, Produto→Atividade, Produto→Acondicionamento, Produto→Item Diverso, Plano→Atividade, Plano→Cobertura de Tinta, Plano→Item Diverso, Plano→Suporte, Atividade→Material, Atividade→Centro, Atividade→Linha, Atividade→Tinta, Matriz→Atividade, Matriz→Centro, Suporte→Atividade e Item Diverso→Atividade.
3. IF o par informado não estiver na lista THEN o sistema SHALL responder 400.
4. WHEN o conjunto de uma origem é salvo THEN o sistema SHALL substituir o conjunto inteiro em uma única transação.
5. IF algum id de origem ou destino não existir na mesma empresa THEN o sistema SHALL responder 422 listando os ids inválidos e não gravar nada.
6. WHEN o mesmo conjunto é salvo duas vezes THEN o resultado SHALL ser idêntico à primeira vez (idempotência).
7. THE sistema SHALL oferecer uma verificação que liste relações órfãs (id inexistente) sem alterá-las.

### Requisito 5: Catálogo para o orçamento

**User Story:** Como desenvolvedor da tela do orçamento, quero uma consulta que devolva já filtrado o que pode aparecer para um produto e para um tipo de plano, para a tela não repetir regras.

#### Acceptance Criteria

1. WHEN o catálogo é consultado por produto THEN o sistema SHALL devolver os tipos de plano permitidos, as atividades de produto, o acondicionamento, os itens diversos e os defaults do produto.
2. WHEN o catálogo é consultado por tipo de plano e produto THEN o sistema SHALL devolver as atividades do plano, cada uma com suas restrições e materiais permitidos, mais coberturas, suportes e itens diversos automáticos.
3. THE sistema SHALL ordenar as atividades pela ordem do roteiro importado e, na falta dela, por nome.
4. THE sistema SHALL separar as atividades de acondicionamento das demais atividades de produto.
5. THE sistema SHALL devolver somente registros ativos da empresa informada.

### Requisito 6: Atividades, restrições e materiais

**User Story:** Como administrador, quero ver e ajustar, em cada atividade, suas restrições e seus materiais, para que o orçamento ofereça as opções certas.

#### Acceptance Criteria

1. THE sistema SHALL guardar nas atividades o código de origem, o indicador de acondicionamento, as características, o texto da proposta e o indicador de exibir o nome do plano.
2. THE sistema SHALL guardar nas restrições o código de origem, o indicador de exibir na proposta e o centro de produção a que pertencem.
3. THE sistema SHALL guardar nos materiais de acabamento: tipo do material, unidade de custo, uso obrigatório, medida linear, conteúdo do rolo em metros, consumo mínimo e texto da proposta.
4. THE tela de Acabamentos SHALL ter as abas Restrições e Materiais, esta usando as relações Atividade→Material.
5. THE sistema SHALL manter inalterado o comportamento atual das atividades e restrições já usadas em itens existentes.

### Requisito 7: Seleção de material por atividade com influência no preço

**User Story:** Como orçamentista, quero escolher o material de uma atividade (ex.: Cola Quente em vez de Cola Branca) e ver o custo mudar, para que o preço reflita a escolha.

#### Acceptance Criteria

1. THE sistema SHALL guardar por seleção: item, plano opcional, atividade, material, restrição opcional, TipoParam, parâmetros 1 e 2, consumo, unidade, valor unitário, custo, indicador de aplicar no preço e situação do parâmetro.
2. IF não existir relação Atividade→Material para o material escolhido THEN o sistema SHALL responder 422 com a lista dos materiais permitidos.
3. WHEN o TipoParam é 0, 1 ou 4 e o item é novo ou recalculado THEN o sistema SHALL calcular o consumo e o custo e aplicar o custo ao Material Direto do item.
4. THE sistema SHALL calcular o TipoParam 1 como área impressa × (parâmetro 1 + parâmetro 2) / 100 × preço do material, o TipoParam 4 como parâmetro 1 × tiragem × preço unitário, e o TipoParam 0 conforme a regra de caixa ou embalagem existente.
5. WHEN o TipoParam é 2 ou 3 THEN o sistema SHALL gravar a seleção com situação A_VERIFICAR, exibi-la e NOT alterar o custo.
6. WHERE o item é puxado de um cálculo da biblioteca, THE sistema SHALL gravar a seleção com indicador de aplicar no preço falso e manter o custo ancorado.
7. IF o material não tiver preço cadastrado THEN o sistema SHALL gravar custo zero e situação A_VERIFICAR, sem erro.
8. THE sistema SHALL refletir a seleção no campo `materiaisAcabamento` do item, no formato já aceito pelo motor, marcando as linhas criadas por ela e sem sobrescrever linhas informadas manualmente.
9. WHEN a mesma seleção é gravada duas vezes THEN o resultado SHALL ser idêntico (idempotência).
10. THE sistema SHALL gravar o valor unitário no momento da seleção, de modo que uma mudança futura de preço do material não altere itens já calculados.

### Requisito 8: Custo por plano nos itens novos

**User Story:** Como gestor, quero que o custo de cada plano seja a soma das suas atividades e materiais nos itens novos, para enxergar o custo por componente.

#### Acceptance Criteria

1. WHERE o item é novo ou recalculado, THE sistema SHALL calcular o custo do plano como a soma dos custos das suas atividades e dos seus materiais.
2. WHERE o item é novo ou recalculado, THE total do item SHALL ser a soma dos custos dos planos.
3. WHERE o item é puxado de um cálculo da biblioteca, THE custo dos planos SHALL continuar zero e o custo do item SHALL continuar ancorado.
4. THE sistema SHALL NOT alterar a função de ancoragem do custo nem os resultados dos testes de decomposição já existentes.

### Requisito 9: Itens diversos

**User Story:** Como administrador, quero cadastrar os itens diversos (serviços externos, itens que entram sozinhos), para que sejam adicionados ao orçamento quando a atividade ou o plano os exigir.

#### Acceptance Criteria

1. THE sistema SHALL guardar por item diverso: código de origem, nome, origem, indicador de automático, tipo de cálculo, aplicado sobre, quantidades de aceite, por unidade e mínima, por caderno, custo informado, cálculo por quantidade de cores, item de revenda, quebra %, texto da proposta, sigla e pendência automática de PCP.
2. THE sistema SHALL permitir ligar cada item diverso a atividades, planos e produtos por relações.
3. THE itens diversos de origem Material de Acabamento SHALL ser mantidos no cadastro de materiais e não duplicados.
4. THE sistema SHALL permitir criar, listar, editar e inativar itens diversos.

### Requisito 10: Campos livres por proprietário

**User Story:** Como administrador, quero configurar campos livres (ARTE, PADRÃO, Motivos de Recusa) por proprietário, para que a solicitação e o pedido tenham os mesmos campos do processo atual.

#### Acceptance Criteria

1. THE sistema SHALL permitir cadastrar campos livres com proprietário (Solicitação, Pedido, Recusa), nome, tipo texto ou lista, obrigatoriedade, ordem e status.
2. THE sistema SHALL permitir cadastrar as opções de um campo do tipo lista, com opção padrão e ordem.
3. THE sistema SHALL permitir indicar que um campo da solicitação é copiado para um campo do pedido.
4. THE sistema SHALL carregar os campos ARTE (Alteração, Novo, Repetição) e PADRÃO (Amostra, Contratual, Pasta Padrão) como obrigatórios na solicitação, e os equivalentes no pedido como não obrigatórios.
5. THE sistema SHALL NOT importar valores históricos preenchidos em solicitações e pedidos antigos.
6. THE campos livres SHALL NOT alterar o preço.

### Requisito 11: Ajustes de Produtividade e Restrições Automáticas (somente cadastro e visualização)

**User Story:** Como administrador, quero cadastrar e consultar os ajustes de produtividade e as restrições automáticas, para registrar as regras que depois influenciarão o PCP.

#### Acceptance Criteria

1. THE sistema SHALL guardar por ajuste: atividade, centro de produção opcional, dado a ajustar (acerto, produção por hora, consumo do material, incondicional), função, operador, valor, fator, fator positivo, impede montagem de cadernos e restrição opcional.
2. THE sistema SHALL exibir os ajustes com filtros por atividade, centro, dado a ajustar e função.
3. THE sistema SHALL exibir como Restrições Automáticas os ajustes com dado a ajustar incondicional, informando a condição e o tipo (incompatível).
4. THE sistema SHALL NOT aplicar nenhum ajuste no motor de orçamento nem no PCP nesta fase.

### Requisito 12: Quebras e Limites de Montagem (somente cadastro e visualização)

**User Story:** Como administrador, quero cadastrar as quebras e os limites de montagem, para manter essas regras registradas no Vizor.

#### Acceptance Criteria

1. THE sistema SHALL guardar por quebra: código de origem, nome, tipo de atividade (impressão ou acabamento), pedaços por acerto, por plano, por tipo de plano, ocorrências, pedaços mínimos em %, interpolação e status.
2. THE sistema SHALL guardar a tabela de limites de cada quebra (tiragem até e quebra %).
3. THE sistema SHALL guardar limites de montagem por formato final, com mínimo e máximo.
4. THE sistema SHALL NOT alterar o parâmetro de perda atual nem o motor de orçamento.

### Requisito 13: Parâmetros gerais do orçamento

**User Story:** Como administrador, quero consultar e editar os parâmetros gerais (refile, contra-pinça, partida de tinta, juros, prazo médio), para que fiquem configuráveis por empresa.

#### Acceptance Criteria

1. THE sistema SHALL guardar os parâmetros em `Parametro` com o prefixo `orc.`, por empresa.
2. THE sistema SHALL oferecer leitura com valores padrão iguais aos do sistema atual quando a chave não existir.
3. THE sistema SHALL validar tipo e faixa de cada parâmetro e rejeitar chaves fora da lista fechada.
4. THE motor de orçamento atual SHALL continuar com os valores que já usa; a leitura pelo motor fica para a Fase 2.

### Requisito 14: Importação dos cadastros

**User Story:** Como responsável pela migração, quero importar os cadastros da base restaurada de forma segura e repetível, para não redigitar nada.

#### Acceptance Criteria

1. THE importador SHALL exigir `--empresa` e aceitar `--dry-run`, `--arquivo` e `--fase`.
2. WHEN executado com `--dry-run` THEN o importador SHALL NOT gravar nada e SHALL imprimir o relatório de criados, atualizados, ignorados e não casados.
3. THE importador SHALL ser idempotente por empresa e código de origem; WHEN executado duas vezes seguidas THEN a segunda execução SHALL criar zero registros.
4. THE importador SHALL NOT apagar registros nem sobrescrever campo já preenchido; SHALL preencher apenas campos vazios de registros existentes.
5. THE importador SHALL traduzir cada código de tabela da relação do legado para o tipo do Vizor e SHALL descartar a tabela 9.
6. IF um código não tiver equivalente no Vizor ou o casamento for ambíguo THEN o importador SHALL listar o item como não casado e SHALL NOT inventar dado nem mesclar registros.
7. THE importador SHALL ignorar o produto de teste cancelado e os valores históricos de campos livres.
8. THE importador SHALL aplicar a ordem do roteiro às relações Plano→Atividade e Produto→Atividade e SHALL listar divergências com a relação importada.
9. THE importador SHALL ler a exportação em UTF-8 gerada a partir do arquivo UTF-16 da base e SHALL preservar os acentos.
10. THE execução em produção SHALL ocorrer somente depois de um dry-run revisado e da autorização explícita do usuário, com a conexão de produção vinda de variável de ambiente.

### Requisito 15: Telas de cadastro e visualização

**User Story:** Como usuário administrador, quero telas para cadastrar e consultar tudo acima, para configurar o orçamento sem depender de scripts.

#### Acceptance Criteria

1. THE sistema SHALL oferecer telas para Produtos, Tipos de Plano, Relações, Itens Diversos, Campos Livres, Ajustes de Produtividade com Restrições Automáticas, Quebras, Limites de Montagem e Parâmetros.
2. THE tela de Relações SHALL permitir escolher o par, o item de origem e marcar os destinos em uma matriz, e salvar substituindo o conjunto.
3. THE telas de Ajustes, Quebras e Limites SHALL exibir o aviso de que ainda não influenciam o cálculo nem o PCP.
4. THE telas SHALL exibir indicação discreta quando uma seleção de material estiver com situação A_VERIFICAR.
5. THE telas SHALL NOT exibir o nome do sistema legado em nenhum texto.
6. THE telas SHALL ter estados de carregamento, vazio e erro, mensagens de erro legíveis e funcionar nos temas claro e escuro.
7. THE telas SHALL aparecer no menu Orçamento Gráfico → Cadastros, respeitando a permissão de cadastro do módulo.

### Requisito 16: Isolamento, compatibilidade e migração

**User Story:** Como responsável técnico, quero que a entrega seja aditiva e segura, para não afetar o que já funciona em produção.

#### Acceptance Criteria

1. THE sistema SHALL filtrar por `empresaId` explícito toda consulta e gravação dos cadastros novos, sem depender só do isolamento automático.
2. THE sistema SHALL ser aditivo: colunas e tabelas novas, sem remover nem alterar tipo de coluna existente.
3. THE alteração de `schema.prisma` SHALL vir acompanhada do equivalente idempotente em `prisma/migrate-prod.ts` no mesmo commit, rodando duas vezes sem erro.
4. THE itens e planos existentes SHALL continuar funcionando sem backfill; `produtoGraficoId` e `tipoPlanoId` SHALL ser opcionais.
5. THE suíte existente do módulo de orçamento gráfico e os testes de decomposição do cálculo SHALL continuar passando.
6. THE fórmulas de seleção de material SHALL ficar em módulo puro, sem dependência de banco, de rotas ou do hook de rastreamento.

## Pontos a verificar o funcionamento exato (não bloqueiam a entrega)

- Significado do parâmetro 2 quando o TipoParam é 3 (Fita Dupla Face de 0 a 6; Colagem Manual de 0 a 100).
- Fórmulas dos TipoParam 2 e 3.
- Unidade do preço de cada material (R$/kg ou R$/m²) e gramatura de cada verniz.
- Tabela 9 da relação do legado (descartada) e os itens sem equivalente que o importador listar.
- Influência futura de Ajustes de Produtividade, Quebras e Limites de Montagem no PCP e no motor.
