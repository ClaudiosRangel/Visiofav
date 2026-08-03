# Requirements Document

## Introduction

Este documento define os requisitos para implementação de regras de decisão de abastecimento de picking baseadas em comparação de validade (FEFO — First Expired, First Out) durante o endereçamento na entrada de mercadorias. O objetivo é garantir que o picking sempre contenha o produto com a validade mais próxima do vencimento, respeitando o princípio FEFO: só abastece picking se a mercadoria entrando vence antes ou no mesmo dia do que já está armazenado ali.

Além das regras de comparação de validade, o sistema deve suportar um modo de bypass configurável que permite direcionar toda mercadoria diretamente ao pulmão sem verificar o picking.

## Glossary

- **Motor_Enderecamento**: Módulo de endereçamento inteligente (`enderecamento-inteligente.routes.ts`) responsável por orquestrar a cadeia de prioridade de alocação (picking → pulmão)
- **Servico_Abastecimento_Picking**: Função pura (`abastecimento-picking.service.ts`) que calcula a quantidade a ser alocada no picking antes de distribuir o restante ao pulmão
- **SaldoEndereco_Picking**: Registro de saldo existente em um endereço de picking, incluindo campo `validade` (DateTime nullable)
- **Validade_Entrada**: Data de validade da mercadoria que está sendo recebida/conferida na entrada
- **Validade_Picking**: Data de validade do saldo existente no endereço de picking para o mesmo produto
- **Modo_Operacao**: Configuração que determina se o sistema aplica as regras FEFO (`VERIFICAR_PK`) ou envia tudo ao pulmão sem verificação (`BYPASS_PULMAO`)
- **DadosLogisticosPicking**: Cadastro que define capacidade, ponto de reposição e endereço de picking por produto
- **Capacidade_Picking**: Quantidade máxima que cabe no endereço de picking (campo `capacidade` de `DadosLogisticosPicking`)
- **Saldo_Picking**: Quantidade física atual armazenada no endereço de picking

## Requirements

### Requisito 1: Decisão FEFO — Validade da Entrada Menor que Validade do Picking

**User Story:** Como operador de armazém, eu quero que mercadoria com validade mais próxima do vencimento que a do picking seja automaticamente direcionada ao picking, para que o FEFO seja respeitado na expedição.

#### Critérios de Aceite

1. WHEN a Validade_Entrada é anterior à Validade_Picking para o mesmo produto AND o Saldo_Picking está abaixo da Capacidade_Picking, THE Servico_Abastecimento_Picking SHALL direcionar mercadoria ao picking até completar a Capacidade_Picking e direcionar o restante ao pulmão
2. WHEN a Validade_Entrada é anterior à Validade_Picking AND a quantidade de entrada é menor ou igual ao espaço disponível no picking, THE Servico_Abastecimento_Picking SHALL direcionar toda a quantidade ao picking

### Requisito 2: Decisão FEFO — Validade da Entrada Igual à Validade do Picking

**User Story:** Como operador de armazém, eu quero que mercadoria com a mesma validade do picking seja direcionada ao picking quando há espaço, para manter o picking abastecido sem violar FEFO.

#### Critérios de Aceite

1. WHEN a Validade_Entrada é igual à Validade_Picking para o mesmo produto AND o Saldo_Picking está abaixo da Capacidade_Picking, THE Servico_Abastecimento_Picking SHALL direcionar mercadoria ao picking até completar a Capacidade_Picking e direcionar o restante ao pulmão
2. WHEN a Validade_Entrada é igual à Validade_Picking AND o Saldo_Picking já atingiu a Capacidade_Picking, THE Servico_Abastecimento_Picking SHALL direcionar toda a mercadoria ao pulmão

### Requisito 3: Decisão FEFO — Validade da Entrada Maior que Validade do Picking

**User Story:** Como gestor logístico, eu quero que mercadoria com validade mais distante do vencimento que a do picking seja direcionada ao pulmão, para que o picking mantenha sempre o produto que vence primeiro.

#### Critérios de Aceite

1. WHEN a Validade_Entrada é posterior à Validade_Picking para o mesmo produto, THE Servico_Abastecimento_Picking SHALL direcionar toda a mercadoria ao pulmão, independentemente do saldo ou capacidade do picking
2. WHEN a Validade_Entrada é posterior à Validade_Picking AND o Saldo_Picking já atingiu a Capacidade_Picking, THE Servico_Abastecimento_Picking SHALL direcionar toda a mercadoria ao pulmão

### Requisito 4: Picking sem Saldo Existente (Picking Vazio)

**User Story:** Como operador de armazém, eu quero que quando o picking estiver vazio a mercadoria de entrada seja direcionada ao picking normalmente, para que o picking não fique desabastecido aguardando comparação impossível.

#### Critérios de Aceite

1. WHEN o endereço de picking não possui SaldoEndereco_Picking com quantidade maior que zero para o produto, THE Servico_Abastecimento_Picking SHALL direcionar mercadoria ao picking até completar a Capacidade_Picking e direcionar o restante ao pulmão
2. WHEN o endereço de picking não possui SaldoEndereco_Picking com validade registrada (validade null no saldo existente), THE Servico_Abastecimento_Picking SHALL direcionar mercadoria ao picking até completar a Capacidade_Picking e direcionar o restante ao pulmão

### Requisito 5: Entrada sem Validade Informada

**User Story:** Como operador de armazém, eu quero que produtos sem controle de validade continuem sendo endereçados normalmente sem que a regra FEFO bloqueie o abastecimento do picking.

#### Critérios de Aceite

1. WHEN a Validade_Entrada não é informada (null) para a mercadoria de entrada, THE Servico_Abastecimento_Picking SHALL ignorar a regra FEFO e direcionar mercadoria ao picking conforme a lógica de capacidade existente (comportamento atual)
2. WHEN a Validade_Entrada não é informada AND o Modo_Operacao é `VERIFICAR_PK`, THE Servico_Abastecimento_Picking SHALL aplicar apenas a lógica de capacidade e ponto de reposição, sem comparação de datas

### Requisito 6: Modo de Operação — Bypass Pulmão

**User Story:** Como gestor logístico, eu quero poder configurar que determinado produto (ou globalmente) ignore a verificação de picking e envie toda entrada direto ao pulmão, para cenários onde o abastecimento de picking é feito manualmente ou por outro processo.

#### Critérios de Aceite

1. WHILE o Modo_Operacao está configurado como `BYPASS_PULMAO` para o produto, THE Servico_Abastecimento_Picking SHALL direcionar toda a mercadoria ao pulmão sem consultar validade nem capacidade do picking
2. WHILE o Modo_Operacao está configurado como `BYPASS_PULMAO` para o produto, THE Motor_Enderecamento SHALL excluir os endereços de picking da cadeia de prioridade de alocação
3. WHILE o Modo_Operacao está configurado como `VERIFICAR_PK` para o produto, THE Servico_Abastecimento_Picking SHALL aplicar as regras de comparação de validade FEFO (Requisitos 1 a 5) antes de direcionar ao pulmão

### Requisito 7: Configuração do Modo de Operação

**User Story:** Como administrador do sistema, eu quero cadastrar o modo de operação por produto, para ter controle granular sobre quais produtos usam a regra FEFO no picking.

#### Critérios de Aceite

1. THE DadosLogisticosPicking SHALL possuir um campo `modoAbastecimento` com valores possíveis `VERIFICAR_PK` e `BYPASS_PULMAO`, com valor padrão `VERIFICAR_PK`
2. WHEN o campo `modoAbastecimento` não existir ou estiver com valor padrão para um produto, THE Servico_Abastecimento_Picking SHALL aplicar as regras FEFO (modo `VERIFICAR_PK`)
3. WHEN o administrador alterar o campo `modoAbastecimento` de um produto para `BYPASS_PULMAO`, THE Servico_Abastecimento_Picking SHALL passar a ignorar o picking para aquele produto a partir da próxima operação de entrada

### Requisito 8: Obtenção da Validade do Picking para Comparação

**User Story:** Como desenvolvedor, eu quero que o serviço de abastecimento obtenha a validade mais próxima do vencimento dentre os saldos existentes no picking, para comparar corretamente com a validade da entrada.

#### Critérios de Aceite

1. WHEN existem múltiplos registros de SaldoEndereco_Picking com validades diferentes para o mesmo produto no mesmo endereço de picking, THE Servico_Abastecimento_Picking SHALL usar a menor validade (mais próxima do vencimento) como Validade_Picking para a comparação FEFO
2. WHEN existe apenas um registro de SaldoEndereco_Picking para o produto no endereço de picking, THE Servico_Abastecimento_Picking SHALL usar a validade desse registro como Validade_Picking
3. THE Servico_Abastecimento_Picking SHALL receber a Validade_Entrada como parâmetro de entrada na interface `AbastecimentoPickingInput`

### Requisito 9: Interface do Serviço de Abastecimento (Contrato)

**User Story:** Como desenvolvedor, eu quero que o serviço de abastecimento mantenha sua natureza de função pura recebendo todos os dados necessários como parâmetros, para facilitar testes e manter a separação de responsabilidades.

#### Critérios de Aceite

1. THE Servico_Abastecimento_Picking SHALL receber um campo `validadeEntrada` (DateTime nullable) na interface `AbastecimentoPickingInput`
2. THE Servico_Abastecimento_Picking SHALL receber um campo `validadePicking` (DateTime nullable) na interface `DadosPickingConfig` representando a menor validade encontrada no picking para aquele endereço
3. THE Servico_Abastecimento_Picking SHALL receber um campo `modoAbastecimento` (`VERIFICAR_PK` ou `BYPASS_PULMAO`) na interface `DadosPickingConfig`
4. THE Servico_Abastecimento_Picking SHALL retornar no campo `avisos` uma mensagem descritiva quando a mercadoria for direcionada ao pulmão por regra FEFO, informando as datas comparadas

### Requisito 10: Propriedade Round-Trip — Regra FEFO Determinística

**User Story:** Como desenvolvedor, eu quero garantir que a decisão FEFO seja determinística e consistente independentemente da ordem de processamento, para evitar comportamento imprevisível.

#### Critérios de Aceite

1. FOR ALL combinações válidas de Validade_Entrada e Validade_Picking com o mesmo produto e endereço de picking, THE Servico_Abastecimento_Picking SHALL produzir o mesmo resultado de alocação independentemente de quantas vezes a função for invocada com os mesmos parâmetros (idempotência da decisão)
2. FOR ALL valores de Validade_Entrada menores ou iguais à Validade_Picking, THE Servico_Abastecimento_Picking SHALL alocar ao picking uma quantidade maior ou igual a zero e menor ou igual ao espaço disponível (propriedade metamórfica: validade menor/igual implica alocação possível no picking)
3. FOR ALL valores de Validade_Entrada maiores que a Validade_Picking (ambas não-null), THE Servico_Abastecimento_Picking SHALL retornar quantidade abastecida no picking igual a zero (propriedade invariante: validade maior nunca abastece picking)
