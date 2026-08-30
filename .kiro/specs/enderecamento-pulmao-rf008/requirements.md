# Requirements Document

## Introduction

Esta feature reimplementa o **motor de endereçamento automático de pulmão
(put-away)** do Vizor WMS para que ele obedeça exatamente à regra de negócio
definida pelo consultor logístico no documento oficial **"Regras de Manutenção
dos Estoques — Parte 1 (RF008 e correlatos)"**, e corrige duas falhas
estruturais de isolamento multi-tenant já identificadas no módulo de
endereçamento inteligente (gravação de `SaldoEndereco` sem `empresaId`).

Documentos de referência do consultor (fonte de verdade da regra):
#[[file:../../../1 - Regras de Manutenção dos Estoques.docx]]
#[[file:../../../2 - Regras de Manutenção dos Estoques (1).docx]]

### Problema atual (verificado em código)

Hoje o put-away tem **dois caminhos divergentes**:
- `POST /conferencia-entrada/enderecamento-automatico/:notaId` (usado no fluxo
  real de recebimento) — versão simplificada: distribui só em endereços 100%
  livres, sem compatibilidade de área, sem a regra de proximidade do RF008, sem
  consolidação, sem picking/FEFO.
- `POST /enderecamento-inteligente/distribuir` (motor "inteligente") — tem uma
  cadeia fixo → consolidação → livre → overflow e uma ordenação por proximidade
  **par/ímpar herdada do Delphi**, que **não corresponde** à regra RF008 do
  consultor (que manda buscar 3 prédios à direita, 3 à esquerda, depois lado
  oposto, varrendo a rua antes de mudar de rua), e **não valida compatibilidade
  de área** (RF004).

Além disso, o motor inteligente grava `SaldoEndereco` **sem `empresaId`** em dois
pontos (a distribuição por consolidação lê saldo sem filtro de empresa, e o
`POST /confirmar` cria saldo sem `empresaId`), o que é a classe de bug de
vazamento multi-tenant já documentada no projeto.

### Objetivo

1. Ter **um único motor de put-away** que implemente a ordenação do RF008.
2. Aplicar **compatibilidade de área** (RF004) como primeiro critério.
3. Implementar a **regra de proximidade do consultor** (3 prédios/lado, varredura
   da rua) substituindo o par/ímpar legado.
4. Respeitar **capacidade por nível/peso/cubagem** (RF006/RF007) — já parcialmente
   presente, garantir que seja honrada no caminho unificado.
5. Corrigir o **isolamento multi-tenant** do `SaldoEndereco` (problemas #2 e #7).
6. Nunca deixar mercadoria conferida **sem destino silenciosamente**: quando o
   put-away não conseguir alocar tudo, sinalizar explicitamente.
7. Deixar os **parâmetros** (quantos prédios varrer, faixas de nível, mono/misto)
   configuráveis, sem hardcode.

Esta feature **não** implementa a classificação ABC/giro (documento Parte 2) —
isso é um spec separado (`slotting-abc-giro`). Aqui, quando a classe ABC existir,
o motor apenas a **consome** como critério opcional de ordenação; enquanto não
existir, o motor funciona sem ela.

## Glossary

- **Motor_Putaway**: o serviço único de endereçamento automático de pulmão que esta feature consolida (substitui os dois caminhos divergentes atuais).
- **Endereco**: `Endereco` (schema). Campos relevantes: `tipo` (ARMAZENAGEM|PICKING|PULMAO|LIVRE|BLOQUEADO|TRANSIT_POINT), `areaArmazenagem` (PULMAO|PICKING), `ambienteArmazenagemId` (→ `AmbienteArmazenagem`), `classificacaoProdutoId` (→ `ClassificacaoProduto`), `codigoRua`, `codigoPredio`, `codigoNivel`, `codigoApto`, `status`, `bloqueado`, `quarentena`/`tipoArea`, `permiteOverflow`, `estrutura` (capacidade/dimensões), `empresaId`, `centroDistribuicaoId`.
- **Compatibilidade_Area**: regra do RF004 — um produto só pode ser endereçado em endereço cujo `AmbienteArmazenagem`/`ClassificacaoProduto` seja compatível com o `Produto.ambienteExigido`/`Produto.classificacaoArmazenagemId`.
- **Endereco_Picking_Origem**: o endereço de picking do produto (de `DadosLogisticosPicking`/`DadosLogisticosArmazenagem`), cuja coordenada (rua/prédio) é a **origem** para o cálculo de proximidade do RF008.
- **Regra_Proximidade_RF008**: a ordenação definida pelo consultor — a partir do prédio do picking, buscar N prédios à direita, depois N à esquerda; não achando, o lado oposto da mesma rua; varrer toda a rua antes de sugerir outra rua, mantendo a coordenada do picking.
- **Capacidade_Palete**: `lastro × camada` do SKU master (fallback: capacidade da estrutura), já existente.
- **Capacidade_Nivel**: limites de `pesoMaximo`/`volumeMaximo`/`paletesMaximo` por nível de estrutura (`CapacidadeNivel`), já existente.
- **SaldoEndereco**: saldo físico por endereço/produto/lote. DEVE sempre carregar `empresaId`.
- **Alocacao**: par (endereço, quantidade) proposto pelo Motor_Putaway.
- **Put_Away_Incompleto**: situação em que a soma das Alocacoes é menor que a quantidade a endereçar (mercadoria sem destino).
- **Config_Putaway**: parâmetros configuráveis por empresa (padrão `Parametro` prefixo `wms.putaway.`): número de prédios a varrer por lado, uso de classe ABC na ordenação, política de put-away incompleto.

## Requirements

### Requirement 1: Motor único de endereçamento de pulmão

**User Story:** Como operador de recebimento, quero que o endereçamento automático use uma única regra consistente, para que o resultado seja previsível e conforme a especificação do consultor.

#### Acceptance Criteria

1. THE Motor_Putaway SHALL ser a única implementação de endereçamento automático de pulmão usada tanto pelo fluxo de conferência de entrada quanto pela rota de distribuição inteligente.
2. WHEN o fluxo de conferência solicita endereçamento automático de uma nota conferida, THE sistema SHALL invocar o Motor_Putaway (não a lógica simplificada anterior de "somente endereços livres").
3. THE Motor_Putaway SHALL receber `produtoId`, `quantidade`, `empresaId` e (opcional) `lote`/`validade`, e retornar a lista de Alocacoes com a quantidade restante não alocada.
4. WHERE o produto não tem SKU master (lastro/camada), THE sistema SHALL rejeitar o endereçamento com mensagem explícita de SKU não configurado (HTTP 422), sem alocar.

### Requirement 2: Compatibilidade de área (RF004)

**User Story:** Como gestor do CD, quero que produtos só sejam endereçados em áreas compatíveis, para não armazenar item em ambiente incorreto (ex.: seco em câmara fria).

#### Acceptance Criteria

1. WHEN o Motor_Putaway avalia um endereço candidato, THE sistema SHALL descartar o endereço se o ambiente de armazenagem do endereço for incompatível com o `ambienteExigido` do produto.
2. WHERE o produto tem `classificacaoArmazenagemId` definida, THE sistema SHALL descartar endereços cuja `classificacaoProdutoId` seja incompatível com a classificação do produto.
3. WHERE o produto não tem restrição de ambiente nem de classificação definida, THE sistema SHALL considerar todos os endereços compatíveis nesse critério.
4. THE sistema SHALL aplicar a Compatibilidade_Area como primeiro filtro, antes de qualquer ordenação por proximidade.

### Requirement 3: Ordenação de proximidade conforme RF008

**User Story:** Como gestor do CD, quero que o pulmão seja sugerido perto do picking do produto na ordem definida pelo consultor, para minimizar a distância de reabastecimento.

#### Acceptance Criteria

1. THE Motor_Putaway SHALL usar a coordenada do Endereco_Picking_Origem do produto (rua/prédio) como origem da ordenação; na ausência de picking, SHALL usar o endereço fixo de armazenagem; na ausência de ambos, SHALL usar a menor coordenada da rua.
2. WHEN existem endereços compatíveis e disponíveis, THE sistema SHALL ordená-los buscando até `N` prédios à direita do prédio de origem, depois até `N` prédios à esquerda, onde `N` é configurável (Config_Putaway).
3. IF nenhum endereço é encontrado nos `N` prédios de cada lado, THEN THE sistema SHALL considerar o lado oposto da mesma rua, mantendo a coordenada do picking.
4. THE sistema SHALL esgotar todos os endereços elegíveis da rua de origem antes de considerar endereços de outra rua.
5. WHERE a classe ABC do produto está disponível E o uso de ABC está habilitado na Config_Putaway, THE sistema SHALL usar a classe/rank como critério adicional de ordenação (classe A em posições mais acessíveis) sem violar a ordem de proximidade da rua de origem.
6. THE sistema SHALL restringir os candidatos às faixas de nível configuradas do produto (`nivelMinPP`/`nivelMaxPP` de `DadosLogisticosArmazenagem`) quando definidas.

### Requirement 4: Capacidade por nível, peso e cubagem (RF006/RF007)

**User Story:** Como gestor do CD, quero que o endereçamento respeite os limites físicos do endereço, para não exceder peso/volume/paletes por nível.

#### Acceptance Criteria

1. WHEN o Motor_Putaway avalia um endereço candidato, THE sistema SHALL descartar o endereço cuja capacidade residual de palete (`Capacidade_Palete − saldo atual`) seja menor ou igual a zero.
2. WHERE existe `Capacidade_Nivel` configurada para a estrutura/nível do endereço, THE sistema SHALL descartar o endereço se a inclusão da mercadoria exceder o `pesoMaximo`, `volumeMaximo` ou `paletesMaximo` do nível.
3. THE sistema SHALL calcular a cubagem do produto e do endereço por `Comprimento × Largura × Altura` (RF007) usando as dimensões do SKU master e da estrutura.
4. THE sistema SHALL alocar em cada endereço, no máximo, a quantidade que cabe na sua capacidade residual (algoritmo greedy por ordem de proximidade), podendo dividir a quantidade entre múltiplos endereços (split).

### Requirement 5: Cadeia de destino e consolidação

**User Story:** Como operador, quero que o sistema priorize consolidar o mesmo produto e usar endereço fixo, para não fragmentar o estoque desnecessariamente.

#### Acceptance Criteria

1. WHERE o produto tem endereço fixo de armazenagem definido e com capacidade residual, THE Motor_Putaway SHALL priorizar o endereço fixo antes dos demais.
2. WHEN existem endereços que já contêm saldo do mesmo produto (consolidação) e compatíveis, THE sistema SHALL priorizá-los após o endereço fixo e antes dos endereços vazios, respeitando a Compatibilidade_Area e a capacidade residual.
3. THE consulta de endereços de consolidação SHALL ser filtrada pelo `empresaId` do produto/nota (correção do problema estrutural #2).
4. WHEN não há endereço fixo, consolidação ou endereço compatível disponível, THE sistema SHALL considerar endereços marcados como overflow (`permiteOverflow=true`, não bloqueados, sem inventário ativo) como último recurso.

### Requirement 6: Isolamento multi-tenant do saldo (correção estrutural #2 e #7)

**User Story:** Como responsável pela integridade dos dados, quero que todo saldo de endereço criado carregue a empresa correta, para eliminar vazamento entre empresas.

#### Acceptance Criteria

1. WHEN o sistema grava um `SaldoEndereco` ao confirmar um endereçamento, THE registro SHALL conter o `empresaId` do produto/nota.
2. THE consultas de saldo por endereço usadas na distribuição (consolidação, capacidade residual, overflow) SHALL filtrar por `empresaId`, aceitando registros legados com `empresaId` nulo apenas de forma explícita e documentada.
3. WHEN uma alteração de `SaldoEndereco` for feita, THE sistema SHALL registrar `LogMovimentacao` com o `empresaId` correspondente.
4. THE Suite_QA SHALL verificar que um endereçamento confirmado em uma empresa não produz saldo visível em outra empresa.

### Requirement 7: Put-away incompleto (mercadoria sem destino)

**User Story:** Como operador, quero ser avisado quando a mercadoria não couber em nenhum endereço, para tratar a exceção em vez de perder o rastro.

#### Acceptance Criteria

1. WHEN a soma das Alocacoes propostas é menor que a quantidade a endereçar (mesmo após overflow), THE sistema SHALL sinalizar Put_Away_Incompleto com a quantidade não alocada.
2. THE política de Put_Away_Incompleto SHALL ser configurável (Config_Putaway) entre: (a) bloquear a confirmação e exigir tratamento, ou (b) confirmar o parcial e registrar alerta com a quantidade pendente.
3. IF a política é "bloquear", THEN THE sistema SHALL rejeitar a confirmação do endereçamento incompleto (HTTP 422) informando a quantidade sem destino.
4. IF a política é "confirmar parcial", THEN THE sistema SHALL confirmar as Alocacoes possíveis e retornar a quantidade pendente de forma explícita na resposta.

### Requirement 8: Parametrização (Config_Putaway)

**User Story:** Como administrador, quero configurar o comportamento do put-away por empresa, para adaptar às diferenças de layout e política sem alterar código.

#### Acceptance Criteria

1. THE sistema SHALL expor Config_Putaway por empresa no padrão `Parametro` com prefixo `wms.putaway.` incluindo, no mínimo: número de prédios a varrer por lado (default preservando o comportamento anterior), uso de classe ABC na ordenação (default desligado), política de put-away incompleto (default preservando o comportamento anterior).
2. WHERE uma chave de Config_Putaway não existe para a empresa, THE sistema SHALL aplicar o valor default documentado, sem erro.
3. THE alteração de Config_Putaway SHALL ser restrita a perfis administrativos, no mesmo padrão das configurações WMS/PCP existentes.

### Requirement 9: Compatibilidade com dados existentes e migração

**User Story:** Como responsável pelo deploy, quero que a mudança não quebre os dados já endereçados, para não interromper a operação.

#### Acceptance Criteria

1. WHERE `prisma/schema.prisma` for alterado, THE mesmo commit SHALL incluir a alteração idempotente equivalente em `prisma/migrate-prod.ts` (padrão obrigatório do projeto).
2. THE migração SHALL preencher `empresaId` de `SaldoEndereco` legados sem empresa a partir do endereço/produto correspondente quando determinável, sem descartar saldo real.
3. WHEN o Motor_Putaway substituir os caminhos antigos, THE comportamento default (sem Config_Putaway definida) SHALL preservar a operação atual de forma observável (endereçamento continua funcionando para produtos já operантes).

### Requirement 10: Verificação por QA

**User Story:** Como QA, quero validar o Motor_Putaway contra a regra definida, para garantir conformidade contínua.

#### Acceptance Criteria

1. THE Suite_QA SHALL verificar que um produto incompatível com um ambiente nunca é alocado em endereço daquele ambiente (Req 2).
2. THE Suite_QA SHALL verificar que, dado um picking de origem, a ordem das Alocacoes segue a Regra_Proximidade_RF008 (Req 3).
3. THE Suite_QA SHALL verificar que a soma das quantidades alocadas nunca excede a capacidade residual de cada endereço (Req 4).
4. THE Suite_QA SHALL verificar o isolamento multi-tenant do saldo (Req 6).
5. THE Suite_QA SHALL verificar o comportamento de Put_Away_Incompleto conforme a política configurada (Req 7).
