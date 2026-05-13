# Documento de Requisitos — Formatos de Endereço de Armazém

## Introdução

O sistema WMS atualmente suporta apenas um formato fixo de endereço de armazém: Depósito-Zona-Rua-Prédio-Nível-Apto (6 segmentos, zero-padded com 3 dígitos). Diferentes áreas de armazenagem utilizam estruturas físicas distintas (porta-paletes, picking de chão, flow rack, blocado, docas, áreas de avaria) que demandam formatos de endereço específicos. Esta funcionalidade permite configurar templates de formato de endereço por depósito ou zona, tornando a geração, visualização e operação de endereços flexível e adaptada à realidade física do armazém.

## Glossário

- **Sistema**: O backend WMS (VisioFab.Wms.Back) e seus módulos de endereço
- **Formato_Endereco**: Template que define quais segmentos compõem um endereço e sua ordem (ex: Rua-Prédio-Nível-Apto, Zona-Posição, Código simples)
- **Segmento**: Parte individual de um endereço (ex: Rua, Prédio, Nível, Apto, Zona, Posição, Corredor, Fileira, Coluna, Código)
- **Endereco_Completo**: String concatenada dos segmentos ativos separados por hífen
- **Modal_Geracao**: Interface de geração automática de endereços (EnderecoAutoModal)
- **Mapa_Armazem**: Visualização gráfica do posicionamento de estoque nos endereços
- **Deposito**: Entidade que representa um depósito/armazém físico
- **Zona**: Subdivisão lógica de um depósito
- **Segmento_Ativo**: Segmento que faz parte do formato selecionado e deve ser preenchido
- **Segmento_Inativo**: Segmento que não faz parte do formato selecionado e permanece nulo no banco

## Requisitos

### Requisito 1: Cadastro de Formatos de Endereço

**User Story:** Como administrador do armazém, quero cadastrar templates de formato de endereço, para que cada área de armazenagem utilize o padrão adequado à sua estrutura física.

#### Critérios de Aceitação

1. THE Sistema SHALL permitir o cadastro de um Formato_Endereco com nome, descrição e lista ordenada de segmentos ativos
2. WHEN um Formato_Endereco é criado, THE Sistema SHALL validar que pelo menos um segmento está ativo
3. THE Sistema SHALL disponibilizar os seguintes segmentos configuráveis: codigoDeposito, codigoZona, codigoRua, codigoPredio, codigoNivel, codigoApto
4. WHEN um Formato_Endereco é criado, THE Sistema SHALL armazenar a ordem dos segmentos para composição do Endereco_Completo
5. THE Sistema SHALL fornecer formatos pré-configurados para os padrões comuns: Porta-palete (Depósito-Zona-Rua-Prédio-Nível-Apto), Picking de chão (Zona-Posição), Flow rack (Corredor-Posição), Blocado (Zona-Fileira-Coluna), Doca (Código simples), Área de avaria (Código simples)
6. WHEN um Formato_Endereco possui segmentos que não existem no modelo Prisma atual (Posição, Corredor, Fileira, Coluna), THE Sistema SHALL mapear esses segmentos para os campos existentes (codigoRua, codigoPredio, codigoNivel, codigoApto) conforme a ordem definida no template

### Requisito 2: Associação de Formato ao Depósito ou Zona

**User Story:** Como administrador do armazém, quero associar um formato de endereço a um depósito ou zona, para que os endereços gerados naquela área sigam o padrão correto.

#### Critérios de Aceitação

1. THE Sistema SHALL permitir associar um Formato_Endereco a um Deposito
2. THE Sistema SHALL permitir associar um Formato_Endereco a uma Zona, sobrescrevendo o formato do Deposito para aquela zona
3. WHEN nenhum Formato_Endereco está associado a um Deposito ou Zona, THE Sistema SHALL utilizar o formato padrão de 6 segmentos (Depósito-Zona-Rua-Prédio-Nível-Apto)
4. WHEN uma Zona possui um Formato_Endereco associado, THE Sistema SHALL priorizar o formato da Zona sobre o formato do Deposito

### Requisito 3: Geração de Endereços com Formato Variável

**User Story:** Como administrador do armazém, quero que a geração automática de endereços respeite o formato configurado, para que apenas os campos relevantes sejam exigidos e preenchidos.

#### Critérios de Aceitação

1. WHEN o usuário abre o Modal_Geracao, THE Sistema SHALL carregar o Formato_Endereco associado ao depósito ou zona selecionados
2. WHILE um Formato_Endereco está selecionado, THE Sistema SHALL exibir apenas os campos de faixa (início/fim) correspondentes aos segmentos ativos
3. WHEN endereços são gerados, THE Sistema SHALL preencher apenas os campos correspondentes aos segmentos ativos do Formato_Endereco, mantendo os demais como nulo
4. WHEN endereços são gerados, THE Sistema SHALL compor o Endereco_Completo concatenando apenas os segmentos ativos na ordem definida pelo Formato_Endereco, separados por hífen
5. WHEN um formato possui segmentos com padding numérico, THE Sistema SHALL aplicar zero-padding de 3 dígitos a cada segmento numérico
6. WHEN um formato possui segmentos alfanuméricos (ex: prefixo PICK, DOCA, AVARIA), THE Sistema SHALL permitir a definição de um prefixo fixo para o segmento

### Requisito 4: Composição e Parsing do Endereço Completo

**User Story:** Como desenvolvedor, quero que o sistema componha e interprete o endereço completo de forma consistente com o formato configurado, para que operações de busca e exibição funcionem corretamente.

#### Critérios de Aceitação

1. WHEN um endereço é salvo, THE Sistema SHALL gerar o Endereco_Completo baseado exclusivamente nos segmentos ativos do Formato_Endereco associado
2. WHEN o Sistema precisa interpretar um Endereco_Completo, THE Sistema SHALL utilizar o Formato_Endereco associado ao depósito/zona do endereço para decompor a string em segmentos
3. FOR ALL endereços válidos, compor o Endereco_Completo a partir dos segmentos e decompor o resultado de volta nos segmentos SHALL produzir valores equivalentes aos originais (propriedade round-trip)
4. IF um Endereco_Completo não corresponde ao Formato_Endereco esperado, THEN THE Sistema SHALL retornar um erro descritivo indicando a incompatibilidade

### Requisito 5: Adaptação do Mapa do Armazém

**User Story:** Como operador do armazém, quero que o mapa visual se adapte ao formato de endereço da área visualizada, para que a representação gráfica reflita a estrutura física real.

#### Critérios de Aceitação

1. WHEN o Mapa_Armazem é carregado para uma zona com formato Porta-palete, THE Sistema SHALL renderizar a grade usando Rua como agrupador principal e Prédio como coluna, com Nível-Apto como células
2. WHEN o Mapa_Armazem é carregado para uma zona com formato de 2 segmentos (Picking, Flow rack), THE Sistema SHALL renderizar uma lista linear de posições agrupadas pelo primeiro segmento
3. WHEN o Mapa_Armazem é carregado para uma zona com formato de 1 segmento (Doca, Avaria), THE Sistema SHALL renderizar uma lista simples de posições
4. WHEN o Mapa_Armazem é carregado para uma zona com formato Blocado (3 segmentos), THE Sistema SHALL renderizar uma grade usando o primeiro segmento como agrupador e os demais como coordenadas da célula
5. THE Sistema SHALL exibir os rótulos dos eixos do mapa conforme os nomes dos segmentos definidos no Formato_Endereco

### Requisito 6: Compatibilidade com Endereços Existentes

**User Story:** Como administrador do armazém, quero que os endereços já cadastrados no formato de 6 segmentos continuem funcionando normalmente, para que não haja perda de dados ou interrupção operacional.

#### Critérios de Aceitação

1. THE Sistema SHALL manter o modelo Prisma Endereco com todos os campos atuais (codigoDeposito, codigoZona, codigoRua, codigoPredio, codigoNivel, codigoApto) sem alteração de tipo ou obrigatoriedade
2. WHEN nenhum Formato_Endereco está configurado para um depósito ou zona, THE Sistema SHALL tratar os endereços existentes usando o formato legado de 6 segmentos
3. WHEN o sistema é atualizado, THE Sistema SHALL preservar todos os endereços existentes sem necessidade de migração de dados
4. THE Sistema SHALL permitir que endereços com formato legado e endereços com novos formatos coexistam no mesmo depósito, desde que estejam em zonas diferentes

### Requisito 7: Validação de Endereços por Formato

**User Story:** Como administrador do armazém, quero que o sistema valide endereços conforme o formato configurado, para evitar cadastros inconsistentes.

#### Critérios de Aceitação

1. WHEN um endereço é criado manualmente, THE Sistema SHALL validar que todos os segmentos ativos do Formato_Endereco estão preenchidos
2. WHEN um endereço é criado manualmente, THE Sistema SHALL validar que os segmentos inativos do Formato_Endereco estão vazios ou nulos
3. IF um endereço é submetido com segmentos ativos em branco, THEN THE Sistema SHALL rejeitar a criação e retornar mensagem indicando quais segmentos são obrigatórios
4. IF um endereço é submetido com segmentos inativos preenchidos, THEN THE Sistema SHALL rejeitar a criação e retornar mensagem indicando quais segmentos não pertencem ao formato

### Requisito 8: Geração de Código de Barras por Formato

**User Story:** Como operador do armazém, quero que o código de barras do endereço seja gerado corretamente independente do formato, para que a leitura por coletor funcione em todas as áreas.

#### Critérios de Aceitação

1. WHEN um endereço é gerado ou criado, THE Sistema SHALL gerar o código de barras baseado no Endereco_Completo (que já reflete o formato)
2. THE Sistema SHALL garantir unicidade do código de barras independente do formato de endereço utilizado
3. WHEN um código de barras é lido pelo coletor, THE Sistema SHALL localizar o endereço correspondente independente do formato utilizado na geração
