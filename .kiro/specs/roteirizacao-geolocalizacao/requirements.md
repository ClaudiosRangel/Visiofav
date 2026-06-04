# Requirements Document

## Introduction

Este documento especifica os requisitos para a funcionalidade de Roteirização com Geolocalização (Nível 1 - Básico) do sistema VisioFab WMS. A funcionalidade adiciona coordenadas geográficas (latitude/longitude) aos cadastros de Cliente e Empresa, implementa geocodificação automática de endereços, cálculo de distâncias entre pontos, otimização de sequência de entrega dentro de um mapa de carregamento, sugestão de ordem de entrega no romaneio, indicador visual de distância total estimada, sugestão automática de rota para novos clientes por proximidade, e visualização da área de cobertura de cada rota.

A funcionalidade integra-se ao módulo de Vendas existente (PedidoVenda → NF-e → Montagem de Carga → Roteirização) e complementa a spec "wms-roteirizacao-montagem-carga" já implementada.

## Glossary

- **Sistema**: A aplicação WMS (backend Fastify + Prisma + PostgreSQL, frontend React, mobile React Native)
- **Empresa**: Entidade tenant representando uma empresa no sistema multi-tenant; ponto de origem das entregas
- **Cliente**: Entidade de cliente com campos de endereço (logradouro, número, bairro, cidade, UF, CEP)
- **Rota**: Entidade de rota de entrega contendo código, descrição, transportadora vinculada e status
- **Mapa_de_Carregamento**: Documento sequencial que agrupa NFs/volumes para despacho de um veículo/motorista
- **Romaneio**: Relatório de lista de entrega (packing list) associado a um Mapa_de_Carregamento
- **Coordenadas**: Par de valores latitude e longitude em formato decimal (WGS84)
- **Geocodificação**: Processo de conversão de endereço textual (CEP, cidade, logradouro) em coordenadas geográficas
- **Haversine**: Fórmula matemática para cálculo de distância entre dois pontos na superfície terrestre usando coordenadas geográficas
- **Vizinho_Mais_Próximo**: Algoritmo heurístico de otimização que seleciona o próximo ponto de entrega com base na menor distância ao ponto atual
- **Sequência_de_Entrega**: Ordem otimizada de visita aos clientes dentro de um Mapa_de_Carregamento
- **Área_de_Cobertura**: Conjunto de cidades e bairros atendidos por uma Rota específica
- **NF**: Nota Fiscal (tax invoice) emitida para uma venda, representada pelo modelo Nfe
- **Pedido_de_Venda**: Pedido de venda vinculado a um cliente e opcionalmente a uma rota
- **Usuário**: Usuário autenticado do sistema

## Requirements

### Requisito 1: Coordenadas Geográficas no Cadastro de Cliente

**User Story:** Como operador de cadastro, quero armazenar latitude e longitude no cadastro de clientes, para que o sistema possa calcular distâncias e otimizar rotas de entrega.

#### Critérios de Aceitação

1. THE Sistema SHALL armazenar campos opcionais latitude (Decimal, precisão 10, escala 7) e longitude (Decimal, precisão 10, escala 7) no modelo Cliente
2. THE Sistema SHALL aceitar latitude e longitude na criação e atualização de um Cliente via API
3. WHEN latitude é fornecida sem longitude ou longitude é fornecida sem latitude, THE Sistema SHALL rejeitar a requisição com mensagem de erro indicando que ambas as coordenadas são obrigatórias em conjunto
4. WHEN latitude é fornecida com valor fora do intervalo -90 a 90, THE Sistema SHALL rejeitar a requisição com mensagem de erro de validação
5. WHEN longitude é fornecida com valor fora do intervalo -180 a 180, THE Sistema SHALL rejeitar a requisição com mensagem de erro de validação
6. THE Sistema SHALL retornar latitude e longitude nos endpoints de consulta de Cliente (listagem e detalhe)

---

### Requisito 2: Coordenadas Geográficas no Cadastro de Empresa

**User Story:** Como administrador, quero armazenar latitude e longitude no cadastro da empresa, para que o sistema utilize a localização da empresa como ponto de origem no cálculo de rotas.

#### Critérios de Aceitação

1. THE Sistema SHALL armazenar campos opcionais latitude (Decimal, precisão 10, escala 7) e longitude (Decimal, precisão 10, escala 7) no modelo Empresa
2. THE Sistema SHALL aceitar latitude e longitude na atualização de uma Empresa via API
3. WHEN latitude é fornecida sem longitude ou longitude é fornecida sem latitude, THE Sistema SHALL rejeitar a requisição com mensagem de erro indicando que ambas as coordenadas são obrigatórias em conjunto
4. WHEN latitude é fornecida com valor fora do intervalo -90 a 90, THE Sistema SHALL rejeitar a requisição com mensagem de erro de validação
5. WHEN longitude é fornecida com valor fora do intervalo -180 a 180, THE Sistema SHALL rejeitar a requisição com mensagem de erro de validação
6. THE Sistema SHALL retornar latitude e longitude nos endpoints de consulta de Empresa

---

### Requisito 3: Serviço de Geocodificação

**User Story:** Como operador de cadastro, quero que o sistema converta automaticamente endereços em coordenadas geográficas, para que eu não precise inserir latitude e longitude manualmente.

#### Critérios de Aceitação

1. THE Sistema SHALL fornecer um endpoint de API para geocodificar o endereço de um Cliente específico, utilizando os campos CEP, cidade, UF e logradouro
2. WHEN uma requisição de geocodificação é recebida para um Cliente com CEP preenchido, THE Sistema SHALL consultar um serviço externo de geocodificação e armazenar as coordenadas retornadas no Cliente
3. WHEN o serviço externo de geocodificação retorna coordenadas válidas, THE Sistema SHALL atualizar os campos latitude e longitude do Cliente
4. IF o serviço externo de geocodificação não encontrar coordenadas para o endereço fornecido, THEN THE Sistema SHALL retornar uma resposta indicando falha na geocodificação sem alterar os campos do Cliente
5. IF o serviço externo de geocodificação estiver indisponível, THEN THE Sistema SHALL retornar um erro 503 com mensagem descritiva
6. THE Sistema SHALL fornecer um endpoint de API para geocodificação em lote (batch), aceitando uma lista de IDs de clientes e processando cada um individualmente
7. WHEN uma geocodificação em lote é solicitada, THE Sistema SHALL retornar um resumo com quantidade de sucessos e falhas
8. THE Sistema SHALL fornecer um endpoint de API para geocodificar o endereço da Empresa autenticada

---

### Requisito 4: Cálculo de Distância entre Pontos

**User Story:** Como coordenador logístico, quero que o sistema calcule a distância entre dois pontos geográficos, para que eu possa avaliar distâncias de entrega.

#### Critérios de Aceitação

1. THE Sistema SHALL implementar o cálculo de distância usando a fórmula de Haversine com raio da Terra de 6.371 km
2. THE Sistema SHALL fornecer um endpoint de API que aceite dois pares de coordenadas (origem e destino) e retorne a distância em quilômetros com precisão de 2 casas decimais
3. WHEN coordenadas de origem são omitidas, THE Sistema SHALL utilizar as coordenadas da Empresa autenticada como origem
4. IF alguma das coordenadas fornecidas for inválida (fora dos intervalos permitidos), THEN THE Sistema SHALL rejeitar a requisição com mensagem de erro de validação
5. THE Sistema SHALL fornecer um endpoint de API que calcule a distância entre a Empresa e um Cliente específico (por ID)
6. IF o Cliente especificado não possuir coordenadas cadastradas, THEN THE Sistema SHALL retornar um erro indicando que o Cliente não possui geolocalização

---

### Requisito 5: Otimização de Sequência de Entrega

**User Story:** Como coordenador logístico, quero que o sistema otimize a ordem de entrega dos clientes dentro de um mapa de carregamento, para que o motorista percorra a menor distância possível.

#### Critérios de Aceitação

1. THE Sistema SHALL fornecer um endpoint de API para calcular a sequência otimizada de entrega para um Mapa_de_Carregamento específico
2. WHEN a otimização é solicitada, THE Sistema SHALL utilizar o algoritmo de Vizinho_Mais_Próximo partindo das coordenadas da Empresa como ponto de origem
3. WHEN a otimização é solicitada, THE Sistema SHALL considerar apenas os clientes (destinatários das NFs) que possuem coordenadas cadastradas
4. THE Sistema SHALL retornar a sequência otimizada contendo: ordem numérica, clienteId, razão social, endereço, coordenadas, e distância parcial ao ponto anterior em km
5. THE Sistema SHALL retornar a distância total estimada do percurso em quilômetros
6. IF a Empresa não possuir coordenadas cadastradas, THEN THE Sistema SHALL rejeitar a requisição com mensagem indicando que a empresa precisa ter geolocalização configurada
7. WHEN clientes sem coordenadas existem no Mapa_de_Carregamento, THE Sistema SHALL incluí-los ao final da sequência com indicador de "sem geolocalização" e distância parcial nula
8. THE Sistema SHALL fornecer um endpoint de API para salvar a sequência otimizada (ou manualmente ajustada) no Mapa_de_Carregamento, armazenando a ordem de entrega por NF

---

### Requisito 6: Sequência de Entrega no Romaneio

**User Story:** Como coordenador logístico, quero que o romaneio exiba a ordem sugerida de entrega, para que o motorista siga a rota otimizada durante as entregas.

#### Critérios de Aceitação

1. WHEN um romaneio é gerado para um Mapa_de_Carregamento que possui sequência de entrega salva, THE Sistema SHALL ordenar as NFs conforme a sequência de entrega armazenada
2. THE Sistema SHALL exibir no romaneio o número de ordem de cada entrega (1, 2, 3...)
3. THE Sistema SHALL exibir no romaneio a distância parcial entre cada ponto de entrega em quilômetros
4. THE Sistema SHALL exibir no romaneio a distância total estimada do percurso
5. WHEN um romaneio é gerado para um Mapa_de_Carregamento sem sequência de entrega salva, THE Sistema SHALL ordenar as NFs pela ordem original de inclusão no mapa

---

### Requisito 7: Indicador de Distância Total Estimada

**User Story:** Como coordenador logístico, quero visualizar a distância total estimada de um mapa de carregamento, para que eu possa avaliar a viabilidade logística antes do despacho.

#### Critérios de Aceitação

1. THE Sistema SHALL retornar o campo distanciaTotalKm no endpoint de detalhe do Mapa_de_Carregamento quando a sequência de entrega estiver salva
2. THE Sistema SHALL calcular a distância total como a soma das distâncias parciais entre todos os pontos da sequência de entrega (Empresa → Cliente1 → Cliente2 → ... → ClienteN)
3. WHEN a sequência de entrega é salva ou atualizada, THE Sistema SHALL recalcular e persistir a distância total estimada no Mapa_de_Carregamento
4. WHEN NFs são adicionadas ou removidas de um Mapa_de_Carregamento que possui sequência salva, THE Sistema SHALL invalidar a sequência de entrega e a distância total, sinalizando necessidade de reotimização
5. THE Sistema SHALL retornar o campo distanciaTotalKm com precisão de 2 casas decimais

---

### Requisito 8: Sugestão Automática de Rota para Novos Clientes

**User Story:** Como operador de cadastro, quero que o sistema sugira uma rota para novos clientes com base na proximidade geográfica, para que a atribuição de rotas seja mais precisa e ágil.

#### Critérios de Aceitação

1. THE Sistema SHALL fornecer um endpoint de API que retorne sugestões de Rota para um Cliente específico com base em proximidade geográfica
2. WHEN uma sugestão de rota é solicitada, THE Sistema SHALL calcular a distância média entre o Cliente e todos os clientes geocodificados de cada Rota ativa da mesma Empresa
3. THE Sistema SHALL retornar as rotas sugeridas ordenadas pela menor distância média, limitando a 5 sugestões
4. THE Sistema SHALL retornar para cada sugestão: rotaId, código da rota, descrição, distância média em km, e quantidade de clientes na rota
5. IF o Cliente não possuir coordenadas cadastradas, THEN THE Sistema SHALL rejeitar a requisição com mensagem indicando que o Cliente precisa ter geolocalização
6. IF nenhuma Rota ativa possuir clientes geocodificados, THEN THE Sistema SHALL retornar lista vazia de sugestões
7. THE Sistema SHALL considerar apenas clientes ativos (status = true) e geocodificados no cálculo de proximidade

---

### Requisito 9: Visualização de Área de Cobertura por Rota

**User Story:** Como gerente logístico, quero visualizar as cidades e bairros atendidos por cada rota, para que eu possa entender a distribuição geográfica e identificar sobreposições ou lacunas.

#### Critérios de Aceitação

1. THE Sistema SHALL fornecer um endpoint de API que retorne a Área_de_Cobertura de uma Rota específica
2. THE Sistema SHALL calcular a Área_de_Cobertura com base nos campos cidade e bairro dos clientes ativos associados à Rota
3. THE Sistema SHALL retornar a lista de cidades atendidas pela Rota, e para cada cidade a lista de bairros distintos
4. THE Sistema SHALL retornar a quantidade de clientes por cidade e por bairro
5. THE Sistema SHALL retornar a quantidade total de clientes geocodificados e não-geocodificados na Rota
6. THE Sistema SHALL fornecer um endpoint de API que retorne a Área_de_Cobertura consolidada de todas as Rotas ativas da Empresa, permitindo identificar sobreposições (cidades/bairros atendidos por mais de uma rota)
7. WHEN a consulta consolidada é solicitada, THE Sistema SHALL indicar para cada cidade/bairro quais rotas o atendem

---

### Requisito 10: Integração com Fluxo de Vendas e Montagem de Carga

**User Story:** Como coordenador logístico, quero que a geolocalização se integre ao fluxo existente de vendas e montagem de carga, para que a otimização de rotas funcione de forma transparente no processo operacional.

#### Critérios de Aceitação

1. WHEN um Mapa_de_Carregamento é gerado com NFs de clientes geocodificados, THE Sistema SHALL disponibilizar automaticamente a opção de otimizar a sequência de entrega
2. THE Sistema SHALL incluir o campo distanciaTotalKm na listagem de Mapas de Carregamento quando disponível
3. WHEN a montagem de carga filtra NFs por Rota, THE Sistema SHALL exibir a quantidade de clientes geocodificados e não-geocodificados no resumo da rota
4. THE Sistema SHALL manter compatibilidade total com o fluxo existente: PedidoVenda → NF-e → Montagem de Carga → Mapa de Carregamento → Romaneio → Fechamento
5. WHEN um Cliente tem suas coordenadas atualizadas, THE Sistema SHALL invalidar as sequências de entrega de Mapas de Carregamento em status AGUARDANDO_SEPARACAO ou EM_CARREGAMENTO que contenham NFs desse Cliente
