# Requirements Document

## Introduction

Esta feature atende aos 9 pedidos do cliente (Caio Filho — "APONTAMENTO") sobre
o módulo de apontamentos de produção do VisioFab/Carton Wega (Checkout do chão de
fábrica, Painel de Programação, Quadro de Produção e relatórios/BI). O
levantamento do estado atual do código está em
`docs/analise-apontamentos-cliente-caio.md` — esta spec entrega as LACUNAS (o que
falta), preservando o que já funciona.

Eixos: (1) tornar a fila/sequência reativa ao operador; (2) dar visibilidade do
histórico ao concluir; (3/4) melhorar os relatórios de parada (tempo no quadro e
Pareto em minutos); (5/6) detalhar produtividade e metas por máquina; (7) relatório
financeiro (R$) e físico (KG) por máquina com controle de acesso por perfil;
(8) retenção de OP sem cartão com liberação por gestão; (9) integridade do
desmembramento de uma OP entre máquinas.

Restrições transversais: isolamento multi-tenant (`empresaId` explícito em toda
operação), não-regressão do fluxo de apontamento atual, e controle de acesso por
perfil (com destaque para o Requisito 7).

## Glossary

- **Apontamento**: registro de produção, perda, parada ou retomada feito pelo
  operador no chão de fábrica. Persistido em `ApontamentoEtapa`.
- **ApontamentoEtapa**: entidade do apontamento. Campos: `tipo`
  (`PRODUCAO|PERDA|PARADA|RETOMADA`), `quantidadeProduzida`, `quantidadePerda`,
  `motivoParada`, `tempoParadaMinutos`, `codigoParadaId`, `dataHora`,
  `funcionarioId`, `setupInicio/Fim/DuracaoMinutos`.
- **Etapa / OP**: `EtapaOrdemProducao` é a operação executada num centro
  (máquina); pertence a uma Ordem de Produção (`OrdemProducao`).
- **Centro / Máquina**: `CentroProducao` (máquina/setor). Classificado por um
  `TipoProcesso` (ex.: Cortadeira, Impressão, Colagem).
- **Fila do centro / posicaoFila**: ordem das etapas na fila de uma máquina
  (`EtapaOrdemProducao.posicaoFila`). Ordenação automática por nº da OP e data de
  entrega; posições fixadas manualmente (`ordemManual`) são preservadas.
- **Desmembramento / partes**: divisão de uma etapa em N partes em centros
  diferentes (ex.: OP de 100.000 folhas → 50.000 na Doin + 50.000 na CD7). Cada
  parte guarda `quantidadePrevista`.
- **Pareto de paradas**: relatório que ordena os motivos de parada por relevância
  no período.
- **Tempo de parada**: duração em que uma máquina ficou parada (parada atual ou
  acumulada por motivo).
- **Valorização (R$)**: valor monetário da produção de um centro, por custo
  (`custoHora × horas`, com `horas = produção ÷ velocidade`) ou por valor
  unitário.
- **Base de contagem**: unidade de medição da produção por Tipo de Processo —
  COLAGEM conta em UNIDADE (peças); demais processos contam em TIRAGEM (folhas).
- **KG fabricado**: produção apontada convertida em quilogramas, a partir da
  gramatura e do formato do plano.
- **Perfis**: `SUPER_ADMIN`, `ADMIN`, `SUPERVISOR`, `OPERADOR` (`Usuario.perfil`).
- **Checkout**: aplicação do chão de fábrica onde o operador vê a fila do seu
  centro e aponta.
- **Quadro de Produção**: painel (TV) de monitoramento em tempo real por máquina.
- **Aguardando Cartão**: estado de uma OP cujo material (bobina/cartão) não está
  totalmente disponível, retida fora da fila normal de corte.

## Requirements

### Requirement 1: Sequência da fila reativa ao operador

**User Story:** Como operador do chão de fábrica, quero que a etapa que eu iniciar
suba para o topo da fila do meu centro e saia da fila ao concluir, para que a
sequência reflita o que está de fato em produção.

#### Acceptance Criteria

1. WHEN o operador inicia uma etapa de um centro, THE Sistema SHALL posicionar
   essa etapa à frente das etapas ainda não iniciadas (PENDENTES) do mesmo centro.
2. WHEN o operador conclui uma etapa, THE Sistema SHALL remover a etapa da fila
   ativa do centro.
3. WHEN a fila é reordenada por efeito de início/conclusão, THE Sistema SHALL
   manter as posições das etapas fixadas manualmente (`ordemManual`) inalteradas.
4. THE Sistema SHALL preservar a ordenação automática existente (nº da OP, depois
   data de entrega) para as etapas pendentes não fixadas manualmente.

### Requirement 2: Histórico do apontamento ao concluir

**User Story:** Como operador/supervisor, quero ver o histórico de apontamentos de
uma etapa/OP ao concluí-la, para conferir o que foi produzido, perdido e as
paradas antes de fechar.

#### Acceptance Criteria

1. WHEN o operador conclui o apontamento de uma etapa, THE Sistema SHALL exibir o
   histórico de apontamentos daquela etapa (produção, perda, parada e retomada)
   com quantidade, tempo, motivo, operador e data/hora.
2. THE Sistema SHALL exibir os totais consolidados da etapa (total produzido,
   total de perda, total de paradas e tempo total de parada) junto ao histórico.
3. WHEN o usuário consulta o histórico de uma etapa, THE Sistema SHALL retornar
   somente apontamentos cujo `empresaId` corresponde à empresa ativa.

### Requirement 3: Tempo de parada no Quadro de Produção

**User Story:** Como supervisor, quero ver no Quadro de Produção quanto tempo cada
máquina parada está parada, para agir rápido sobre as paradas.

#### Acceptance Criteria

1. WHEN uma máquina está em status PARADA no Quadro de Produção, THE Sistema SHALL
   exibir o tempo decorrido desde o início da parada atual.
2. THE Sistema SHALL exibir, junto ao tempo de parada, o motivo da parada atual.
3. WHILE a máquina permanece parada, THE Sistema SHALL atualizar o tempo de parada
   exibido conforme o tempo passa.

### Requirement 4: Pareto de paradas em minutos por motivo

**User Story:** Como supervisor, quero que o Pareto de paradas some o total de
minutos por motivo no período, para saber onde o tempo de parada está indo (ex.:
"Acerto de Máquina — 500 min em Outubro").

#### Acceptance Criteria

1. WHEN o supervisor consulta o Pareto de paradas de um período, THE Sistema SHALL
   somar o total de minutos de parada por motivo no período.
2. THE Sistema SHALL ordenar os motivos do maior para o menor total de minutos.
3. THE Sistema SHALL exibir, por motivo, o total de minutos e o número de
   ocorrências de parada.
4. WHEN o supervisor consulta o Pareto, THE Sistema SHALL considerar somente
   apontamentos de parada cujo `empresaId` corresponde à empresa ativa.

### Requirement 5: Produtividade por operador separada por máquina

**User Story:** Como supervisor, quero, ao analisar a produtividade de um operador,
ver em quais máquinas ele produziu e o quanto em cada uma, para avaliar o
desempenho por máquina.

#### Acceptance Criteria

1. WHEN o supervisor consulta a produtividade filtrando por operador, THE Sistema
   SHALL apresentar a produção do operador separada por máquina.
2. THE Sistema SHALL identificar cada máquina na visualização da produtividade do
   operador.
3. THE Sistema SHALL preservar a visão agregada de produtividade por operador e
   por máquina já existentes (não-regressão).

### Requirement 6: Metas por processo com máquinas separadas

**User Story:** Como supervisor, quero o relatório de metas por processo com cada
máquina do processo como série separada, para comparar o desempenho entre
máquinas do mesmo processo.

#### Acceptance Criteria

1. WHEN o supervisor consulta o relatório de metas de um processo, THE Sistema
   SHALL apresentar cada máquina do processo como uma série separada.
2. THE Sistema SHALL permitir filtrar o relatório por processo.
3. THE Sistema SHALL exibir a meta aplicável ao processo (ou à máquina, quando a
   meta por máquina estiver definida) junto às séries das máquinas.

### Requirement 7: Relatório de R$ por máquina e KG fabricado, restrito por perfil

**User Story:** Como gestor (SUPER_ADMIN/ADMIN/SUPERVISOR), quero um relatório de
quanto em R$ está rodando em cada máquina e quanto em KG está sendo fabricado,
sem que o operador tenha acesso a esses valores.

#### Acceptance Criteria

1. WHEN um usuário com perfil `SUPER_ADMIN`, `ADMIN` ou `SUPERVISOR` acessa o
   relatório, THE Sistema SHALL apresentar o valor em R$ da produção por máquina
   no período.
2. WHEN um usuário com perfil `SUPER_ADMIN`, `ADMIN` ou `SUPERVISOR` acessa o
   relatório, THE Sistema SHALL apresentar a quantidade produzida em KG por
   máquina no período, convertida a partir da gramatura e do formato do plano.
3. IF um usuário com perfil `OPERADOR` tenta acessar o relatório de R$/KG por
   máquina, THEN THE Sistema SHALL negar o acesso.
4. THE Sistema SHALL ocultar o item de menu do relatório de R$/KG por máquina para
   usuários com perfil `OPERADOR`.
5. WHEN o relatório é gerado, THE Sistema SHALL considerar somente apontamentos
   cujo `empresaId` corresponde à empresa ativa.
6. WHERE um centro não possui custo-hora/velocidade cadastrados, THE Sistema SHALL
   apresentar o valor em R$ daquele centro como zero, sem impedir a geração do
   relatório.

### Requirement 8: OP aguardando cartão liberada por gestão

**User Story:** Como gestor, quero que uma OP cujo material (bobina/cartão) só tem
parte disponível não apareça automaticamente para o operador cortar, ficando
retida até eu liberar, para controlar o uso de bobina parcial.

#### Acceptance Criteria

1. WHILE o material (cartão/bobina) de uma OP não está totalmente disponível, THE
   Sistema SHALL manter a OP retida ("aguardando cartão") fora da fila normal de
   corte do operador.
2. WHEN um usuário com perfil de gestão (`SUPER_ADMIN`, `ADMIN` ou `SUPERVISOR`)
   libera uma OP retida para corte, THE Sistema SHALL inserir a etapa
   correspondente na fila do centro de corte.
3. IF um usuário com perfil `OPERADOR` tenta liberar uma OP retida em "aguardando
   cartão", THEN THE Sistema SHALL negar a ação.
4. THE Sistema SHALL registrar qual usuário liberou a OP retida e quando.

### Requirement 9: Integridade do desmembramento de OP entre máquinas

**User Story:** Como operador, quero ver claramente a quantidade e o percentual da
MINHA parte quando uma OP é dividida entre máquinas, e como gestão quero que a OP
só conclua quando todas as partes terminarem.

#### Acceptance Criteria

1. WHEN uma OP é desmembrada em partes entre centros, THE Sistema SHALL exibir, em
   cada centro, a quantidade da parte atribuída àquele centro.
2. THE Sistema SHALL exibir, por parte, o percentual que a parte representa do
   total da OP.
3. THE Sistema SHALL garantir que a soma das quantidades das partes seja igual à
   quantidade total da OP (dentro da tolerância de arredondamento).
4. THE Sistema SHALL concluir a OP somente quando todas as partes desmembradas
   estiverem concluídas.
5. WHEN o operador consulta a sua parte no Checkout, THE Sistema SHALL apresentar
   a quantidade e o progresso referentes à parte do seu centro.

### Requirement 10: Isolamento multi-tenant e não-regressão

**User Story:** Como administrador, quero que todas as novas consultas e ações
sejam isoladas por empresa e não quebrem o fluxo de apontamento atual.

#### Acceptance Criteria

1. THE Sistema SHALL filtrar toda consulta e agregação de apontamentos pelo
   `empresaId` da empresa ativa de forma explícita.
2. THE Sistema SHALL preservar o comportamento atual de apontar produção, perda,
   parada e retomada (não-regressão).
3. WHEN uma requisição referencia um apontamento ou etapa de empresa diferente da
   ativa, THE Sistema SHALL negar o acesso.
