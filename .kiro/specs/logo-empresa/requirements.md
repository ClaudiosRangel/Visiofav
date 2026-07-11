# Requirements Document

## Introduction

Esta funcionalidade adiciona suporte completo ao logo de uma Empresa nos
endpoints de gestão de empresas do backend (`empresa-selector.routes.ts`).
O campo `logo` (Text, base64/data-URL de imagem PNG ou JPEG) já existe no
model `Empresa` do Prisma e já é retornado por `GET /api/empresas/minha`.
O trabalho consiste em: (a) passar a retornar o campo `logo` também na
listagem usada pela tela de seleção de empresa (`GET /api/empresas/minhas`);
(b) permitir definir, atualizar e remover o logo através dos endpoints de
criação/atualização de empresa (`POST /api/empresas`, `PUT /api/empresas/:id`,
`PUT /api/empresas/minha`); e (c) validar no backend, de forma independente
de qualquer validação client-side, que o conteúdo enviado é uma imagem
PNG ou JPEG com no máximo 2MB.

**Premissa validada:** o campo `logo String? @db.Text` já existe no model
`Empresa` em `prisma/schema.prisma`. Nenhuma alteração de schema Prisma é
necessária para esta funcionalidade, e portanto nenhuma alteração em
`prisma/migrate-prod.ts` é necessária (ver Requirement 6).

**Fora de escopo:** `GET /api/empresas` (listagem administrativa completa)
não precisa retornar o campo `logo` nesta versão. Apenas `GET /api/empresas/minhas`
(tela de seleção de empresa) e `GET /api/empresas/minha` (que já retorna o
campo) fazem parte do escopo de leitura.

**Decisão de transporte a confirmar no design:** o mecanismo de envio do
logo (string base64/data-URL embutida no corpo JSON dos endpoints existentes
vs. um endpoint dedicado de upload multipart, ex. `POST /empresas/:id/logo`)
é uma decisão de design, não de requisito. Os requisitos abaixo descrevem o
comportamento observável (validação, persistência, autorização, retorno),
independentemente de qual mecanismo de transporte for escolhido.

## Glossary

- **Sistema**: o backend da aplicação VisioFab Wms (Fastify + Prisma) responsável pelos endpoints de gestão de empresas.
- **Empresa**: entidade persistida no model `Empresa` do Prisma, representando uma empresa cliente do Sistema.
- **Logo_Empresa**: conteúdo de imagem (PNG ou JPEG), representado como string base64/data-URL, persistido no campo `logo` do model `Empresa`.
- **Validador_Logo**: componente do Sistema responsável por validar o mimetype e o tamanho do conteúdo fornecido como Logo_Empresa antes da persistência.
- **Usuário_Autenticado**: usuário que possui uma sessão válida no Sistema, identificado via `request.user`.
- **Usuário_Administrativo**: Usuário_Autenticado cujo perfil pertence ao conjunto `ADMIN_PROFILES` (`SUPER_ADMIN`, `ADMIN`, `DIRETOR`).
- **Endpoint_Listagem_Minhas**: o endpoint `GET /api/empresas/minhas`, que retorna as empresas ativas vinculadas ao Usuário_Autenticado.
- **Endpoint_Criação_Empresa**: o endpoint `POST /api/empresas`.
- **Endpoint_Atualização_Empresa**: o endpoint `PUT /api/empresas/:id`.
- **Endpoint_Atualização_Minha**: o endpoint `PUT /api/empresas/minha`, que atualiza a Empresa atualmente selecionada pelo Usuário_Autenticado.

## Requirements

### Requirement 1: Exibição do logo na listagem de empresas do usuário

**User Story:** Como Usuário_Autenticado, quero visualizar o logo das empresas na tela de seleção de empresa, para identificar visualmente a empresa correta antes de selecioná-la.

#### Acceptance Criteria

1. WHEN um Usuário_Autenticado solicita o Endpoint_Listagem_Minhas, THE Sistema SHALL incluir o campo `logo` para cada Empresa retornada na resposta, contendo a mesma string base64/data-URL persistida no campo `logo` do model `Empresa`, sem transformação de formato.
2. IF uma Empresa retornada pelo Endpoint_Listagem_Minhas não possui Logo_Empresa cadastrado (campo `logo` vazio ou `null` no registro da Empresa), THEN THE Sistema SHALL retornar o campo `logo` com valor `null` para essa Empresa.
3. THE Sistema SHALL manter, no Endpoint_Listagem_Minhas, o filtro por Empresa com status ativo já existente, sem alterar os demais campos hoje retornados (`id`, `razaoSocial`, `nomeFantasia`, `cnpj`). IF o Sistema não conseguir manter simultaneamente o filtro de status ativo e os demais campos hoje retornados, THEN THE Sistema SHALL falhar a requisição inteira, sem retornar uma resposta parcial ou inconsistente.

### Requirement 2: Definição do logo na criação de empresa

**User Story:** Como Usuário_Administrativo, quero definir o logo ao cadastrar uma nova empresa, para que a identidade visual já esteja configurada desde a criação.

#### Acceptance Criteria

1. IF o campo `logo` for fornecido no corpo da requisição do Endpoint_Criação_Empresa, THEN THE Sistema SHALL validar, através do Validador_Logo, que o conteúdo é uma imagem PNG ou JPEG com tamanho entre 1 byte e 2.097.152 bytes (2MB) antes de persistir a Empresa.
2. IF o campo `logo` não for fornecido ou for enviado explicitamente como `null` no corpo da requisição do Endpoint_Criação_Empresa, THEN THE Sistema SHALL criar a Empresa com o campo `logo` definido como `null`.
3. IF um Usuário_Autenticado que não é Usuário_Administrativo solicitar o Endpoint_Criação_Empresa, THEN THE Sistema SHALL rejeitar a requisição com código de status 403 e não criar a Empresa, independentemente do valor do campo `logo`. THE Sistema SHALL verificar a permissão administrativa antes de executar qualquer validação do campo `logo`, e SHALL ignorar a validação do Validador_Logo quando a permissão administrativa não for confirmada.
4. IF o Validador_Logo rejeitar o campo `logo` fornecido no Endpoint_Criação_Empresa, THEN THE Sistema SHALL rejeitar a requisição com código de status 400 sem criar a Empresa.
5. IF uma requisição sem autenticação válida ou sem permissão administrativa confirmada solicitar o Endpoint_Criação_Empresa, THEN THE Sistema SHALL rejeitar a requisição com código de status 401 (sem autenticação) ou 403 (autenticado sem permissão administrativa confirmada) e não criar a Empresa, independentemente do valor do campo `logo`.

### Requirement 3: Atualização e remoção do logo por administrador

**User Story:** Como Usuário_Administrativo, quero atualizar ou remover o logo de uma empresa existente, para manter a identidade visual atualizada.

#### Acceptance Criteria

1. WHEN o campo `logo` é fornecido com um valor diferente de `null` no corpo da requisição do Endpoint_Atualização_Empresa, THE Sistema SHALL validar, através do Validador_Logo, que o conteúdo corresponde a uma imagem válida nos formatos PNG ou JPEG com tamanho máximo de 2MB (2.097.152 bytes).
2. WHEN o campo `logo` é fornecido com valor `null` no corpo da requisição do Endpoint_Atualização_Empresa, THE Sistema SHALL atualizar o campo `logo` da Empresa para `null`.
3. WHEN o campo `logo` não é fornecido no corpo da requisição do Endpoint_Atualização_Empresa, THE Sistema SHALL manter inalterado o valor atual do campo `logo` da Empresa incondicionalmente, ou seja, sem exigir verificação adicional de autenticação ou permissão administrativa além da já aplicada à requisição como um todo.
4. IF um Usuário_Autenticado que não é Usuário_Administrativo solicitar o Endpoint_Atualização_Empresa, THEN THE Sistema SHALL verificar a permissão administrativa antes de executar qualquer validação do campo `logo`, rejeitar a requisição com código de status 403, retornar uma mensagem de erro indicando falta de permissão, e manter inalterado o valor atual do campo `logo` da Empresa, independentemente do valor do campo `logo` (a validação do Validador_Logo SHALL ser ignorada nesse caso).
5. IF o Validador_Logo rejeitar o campo `logo` fornecido no Endpoint_Atualização_Empresa por formato inválido ou por tamanho superior a 2MB, THEN THE Sistema SHALL rejeitar a requisição com código de status 400, retornar uma mensagem de erro indicando o motivo da rejeição, e manter inalterado o valor atual do campo `logo` da Empresa. THE Sistema SHALL aplicar essa rejeição mesmo quando nenhum outro campo da Empresa seria efetivamente alterado pela requisição.
6. WHEN o Validador_Logo aprovar o campo `logo` fornecido no Endpoint_Atualização_Empresa, THE Sistema SHALL persistir no campo `logo` da Empresa o valor resultante do processamento do Validador_Logo, que pode diferir da string originalmente enviada na requisição (por exemplo, após normalização do prefixo de data-URL ou recodificação).

### Requirement 4: Atualização e remoção do logo pela própria empresa selecionada

**User Story:** Como Usuário_Autenticado com uma Empresa selecionada, quero atualizar ou remover o logo da empresa atual através da minha própria tela de configuração, para manter a identidade visual atualizada sem depender de um perfil administrativo distinto.

#### Acceptance Criteria

1. WHEN o campo `logo` é fornecido no corpo da requisição do Endpoint_Atualização_Minha com um valor de string não vazia representando o conteúdo binário da imagem codificado em base64, THE Sistema SHALL validar, através do Validador_Logo, que o conteúdo decodificado corresponde a uma imagem nos formatos PNG ou JPEG (identificados pela assinatura binária do arquivo, independentemente da extensão ou metadado informado) com tamanho máximo de 2.097.152 bytes (2 MB) antes de persistir a atualização.
2. WHEN o campo `logo` é fornecido com valor `null` no Endpoint_Atualização_Minha, THE Sistema SHALL atualizar o campo `logo` da Empresa selecionada para `null`.
3. WHEN o campo `logo` não é fornecido no corpo da requisição do Endpoint_Atualização_Minha, THE Sistema SHALL manter inalterado o valor atual do campo `logo` da Empresa selecionada.
4. THE Sistema SHALL aplicar ao campo `logo` no Endpoint_Atualização_Minha a mesma regra de autorização já vigente para os demais campos desse endpoint, sem exigir perfil administrativo adicional.
5. IF o Validador_Logo rejeitar o campo `logo` fornecido no Endpoint_Atualização_Minha — por valor vazio, string que não seja base64 válida, formato diferente de PNG/JPEG ou tamanho superior a 2.097.152 bytes (2 MB) — THEN THE Sistema SHALL rejeitar a requisição com código de status 400, retornar uma mensagem de erro indicando o motivo da rejeição, e não deve atualizar nenhum campo da Empresa.

### Requirement 5: Validação de formato e tamanho independente do cliente

**User Story:** Como responsável pela integridade dos dados do Sistema, quero que a validação de tipo e tamanho do logo ocorra sempre no backend, para garantir consistência independentemente de qualquer validação realizada no cliente.

#### Acceptance Criteria

1. THE Validador_Logo SHALL receber o Logo_Empresa como uma string base64 (com ou sem prefixo `data:image/...;base64,`) e SHALL decodificá-la para obter o conteúdo binário antes de qualquer verificação de formato ou tamanho.
2. IF a string fornecida como Logo_Empresa não for uma base64 válida, ou se o conteúdo binário decodificado não corresponder, pela assinatura binária do arquivo (magic bytes), a uma imagem PNG ou JPEG, THEN THE Validador_Logo SHALL rejeitar o conteúdo, independentemente de qualquer extensão de arquivo, mimetype declarado pelo cliente ou prefixo de data-URL informado.
3. IF o tamanho em bytes do conteúdo binário decodificado do Logo_Empresa exceder 2.000.000 bytes, THEN THE Validador_Logo SHALL rejeitar o conteúdo. Este limite de 2.000.000 bytes para o conteúdo binário decodificado reserva margem abaixo do limite nominal de 2MB (2.097.152 bytes) para absorver a sobrecarga de codificação base64 e eventuais metadados de data-URL, garantindo que o conteúdo binário real da imagem nunca exceda, na prática, 2MB brutos armazenados.
4. IF o Validador_Logo rejeitar um Logo_Empresa em qualquer um dos Endpoint_Criação_Empresa, Endpoint_Atualização_Empresa ou Endpoint_Atualização_Minha, THEN THE Sistema SHALL retornar código de status 400 com uma mensagem indicando qual regra foi violada (formato inválido ou tamanho excedido), sem persistir qualquer alteração na Empresa.
5. WHEN qualquer requisição aos Endpoint_Criação_Empresa, Endpoint_Atualização_Empresa ou Endpoint_Atualização_Minha incluir o campo `logo` com um valor não vazio e diferente de `null`, THE Sistema SHALL executar a validação do Validador_Logo sobre esse valor antes de persistir qualquer alteração na Empresa, independentemente de qualquer validação equivalente já realizada no cliente.

### Requirement 6: Reaproveitamento do campo de schema já existente

**User Story:** Como desenvolvedor responsável pela manutenção do schema de banco de dados, quero reaproveitar o campo `logo` já existente no model `Empresa`, para evitar uma migração de banco de dados desnecessária.

#### Acceptance Criteria

1. WHEN o Logo_Empresa for definido ou atualizado (conforme especificado nos Requirements 1 a 5), THE Sistema SHALL persistir seu valor no campo `logo` (tipo `Text`, opcional) já existente no model `Empresa` de `prisma/schema.prisma`, substituindo integralmente qualquer valor anteriormente armazenado nesse campo.
2. WHEN o Logo_Empresa for removido pelo usuário, THE Sistema SHALL definir o campo `logo` do registro `Empresa` correspondente como `null`.
3. THE Sistema SHALL implementar os Requirements 1 a 5 deste documento sem exigir qualquer alteração (adição, remoção ou modificação de coluna, tabela, índice ou migration) em `prisma/schema.prisma` nem em `prisma/migrate-prod.ts`.
