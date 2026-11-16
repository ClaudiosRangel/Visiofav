# Requirements Document

## Introduction

A usuária Amanda (PCP, Carton Wega) precisa de duas ferramentas no Gantt de Produção (`/pcp/gantt`) para fixar um split (etapa) de modo que a importação de novas OPs (PDF, agente Calcgraf, "adicionar OS") não altere a programação já combinada:

1. **Fixar por DATA** ("Travar nesta data"): o trabalho que precisa iniciar na data X não pode ser empurrado, mesmo que outros trabalhos atrasem.
2. **Fixar SEQUÊNCIA** (NOVO): o split fica sequenciado daquela forma na fila da máquina e só pode ser alterado manualmente por pessoas autorizadas.

### Estado atual verificado no código (levantamento)

**Trava por data (já existe).** Campos `EtapaOrdemProducao.agendaTravada` e `inicioAgendadoManual`; rotas `PATCH /pcp/etapas/:id/agendar` e `/destravar` (permissão `podeMover`); motor `timeline-agenda.service.ts` trata a etapa travada como ponto fixo (`calcularInicioPorFila`, `calcularTimelineOp`, `resolverNoOverlap`), e as etapas não travadas desviam das janelas travadas. O requisito "não pode ser empurrado mesmo que outros atrasem" **já é atendido pelo motor**, e os testes de `timeline-agenda.service.test.ts` cobrem isso.

**Lacunas identificadas na trava por data:**
- L1. Reimportação de uma OP existente (`importacao-op.routes.ts`, `deleteMany` de etapas) e atualização pelo agente (`ingestao-op-calcgraf.service.ts`, `deleteMany` de etapas) apagam e recriam as etapas. A trava por data é perdida nesses casos.
- L2. A trava por data usa a mesma permissão de mover (`podeMover`). Quem pode mover pode travar e destravar. Este spec não altera isso (ver Requisito 1).
- L3. A cascata da OP não empurra uma etapa travada. Se a etapa anterior da mesma OP terminar depois da âncora, a dependência fica violada sem sinalização. A existência de um alerta visual para esse caso precisa ser confirmada na fase de design.

**Fila (sequência) hoje.** `posicaoFila` é renumerada 1..N em `PATCH /pcp/etapas/reordenar`, e todas as etapas da fila ficam com `ordemManual=true`. `reordenarFilaAutomaticamente` e `reordenarComIniciadaNoTopo` preservam apenas as etapas `ordemManual=true`. Não existe como proteger uma etapa específica:
- L4. Qualquer usuário com `podeReordenarFila` consegue deslocar qualquer etapa ao arrastar outra.
- L5. Uma etapa nova (`ordemManual=false`) preenche o primeiro slot livre da fila. Quando há "buracos" (etapa concluída ou movida), a etapa nova pode entrar na frente de etapas já sequenciadas e atrasar a data prevista delas no Gantt.
- L6. `PATCH /etapas/:id/mover`, `desmembrar` e `DELETE /etapas/:id` alteram a fila sem verificar nenhuma trava.

### Decisões assumidas (confirmar na revisão)

- A trava de sequência é independente da trava por data. As duas podem coexistir na mesma etapa. A trava de sequência fixa a posição na fila, não a data. Atrasos de outras etapas ainda podem mover a data prevista de uma etapa travada só por sequência.
- A permissão `podeTravarSequencia` tem padrão `false`, igual a `podeRetornarEtapa`. Sem configuração, só ADMIN/SUPER_ADMIN travam e destravam.
- Etapas novas entram sempre depois da última etapa travada por sequência da fila ("zona congelada").
- A trava de sequência é removida quando a etapa é concluída ou muda de máquina.

## Glossary

- **Etapa**: registro `EtapaOrdemProducao`. Também chamada de "split" ou "bloco" no Gantt.
- **Fila**: conjunto das etapas ativas (`PENDENTE`, `EM_ANDAMENTO`, `PAUSADA`) de um `CentroProducao`, ordenadas por `posicaoFila`.
- **Trava_de_Data**: estado `agendaTravada=true` com `inicioAgendadoManual` definido.
- **Trava_de_Sequencia**: estado `sequenciaTravada=true` na Etapa (campo novo). Fixa a `posicaoFila` da Etapa.
- **Etapa_Travada_por_Sequencia**: Etapa com Trava_de_Sequencia ativa.
- **Zona_Congelada**: trecho da Fila do início até a posição da última Etapa_Travada_por_Sequencia.
- **Usuario_Autorizado**: usuário com perfil ADMIN ou SUPER_ADMIN, ou com a permissão `podeTravarSequencia` resolvida para o tipo de processo do centro da Etapa.
- **Permissao_Travar_Sequencia**: permissão `podeTravarSequencia`, disponível no nível global e por tipo de processo, resolvida por `verificarPermissaoAcao`.
- **Motor_de_Fila**: `fila-ordenacao.service.ts` e `fila-ordenacao.utils.ts` (`reordenarFilaAutomaticamente`, `recalcularPosicoesFila`, `reordenarComIniciadaNoTopo`).
- **Motor_de_Agenda**: `timeline-agenda.service.ts`.
- **API_PCP**: rotas Fastify do módulo PCP em `/api/pcp`.
- **Gantt**: tela `/pcp/gantt` (frontend `VisioFab.Wms.Front`).
- **Painel_Programacao**: tela `/pcp/programacao`.
- **Tela_Permissoes**: tela PCP → Permissões.
- **Importador_OP**: fluxo de importação de PDF (`importacao-op.routes.ts`), ingestão do agente Calcgraf (`ingestao-op-calcgraf.service.ts`) e rotas de adicionar etapa manual/avulsa.
- **Log_OP**: registro `LogOrdemProducao`.
- **Migrador_Producao**: `prisma/migrate-prod.ts`.

## Requirements

### Requirement 1: Verificar e garantir a trava por data

**User Story:** Como planejadora de PCP, quero que um split travado em uma data continue iniciando nessa data, para que atrasos de outros trabalhos e novas OPs não o empurrem.

#### Acceptance Criteria

1. WHILE uma Etapa está com Trava_de_Data ativa, THE Motor_de_Agenda SHALL manter o início previsto igual a `inicioAgendadoManual`, ajustado apenas ao próximo horário válido do turno do centro.
2. WHEN o fim previsto de uma Etapa anterior na mesma máquina ultrapassa `inicioAgendadoManual` de uma Etapa com Trava_de_Data, THE Motor_de_Agenda SHALL manter o início da Etapa travada inalterado e deslocar apenas as etapas sem Trava_de_Data.
3. WHEN o Importador_OP cria uma nova Etapa em um centro, THE API_PCP SHALL manter inalterado o início previsto de toda Etapa com Trava_de_Data desse centro.
4. WHEN o Importador_OP recria as etapas de uma OP existente (reimportação de PDF ou atualização pelo agente Calcgraf), THE Importador_OP SHALL restaurar a Trava_de_Data (`agendaTravada` e `inicioAgendadoManual`) em cada etapa recriada que corresponda a uma etapa travada anterior, com o mesmo centro e a mesma descrição normalizada.
5. WHEN a restauração do critério 4 ocorre, THE Importador_OP SHALL registrar no Log_OP da OP a lista das travas restauradas e das travas que não encontraram etapa correspondente.
6. WHEN a Trava_de_Data de uma Etapa fica antes do fim previsto da etapa anterior da mesma OP, THE Gantt SHALL sinalizar o conflito de dependência na Etapa travada, sem alterar a data.
7. THE API_PCP SHALL manter a permissão `podeMover` como requisito de `PATCH /pcp/etapas/:id/agendar` e `PATCH /pcp/etapas/:id/destravar`.

### Requirement 2: Travar e destravar a sequência de uma Etapa

**User Story:** Como planejadora de PCP autorizada, quero travar a posição de um split na fila da máquina, para que a ordem combinada seja mantida.

#### Acceptance Criteria

1. THE API_PCP SHALL expor `PATCH /api/pcp/etapas/:id/travar-sequencia` e `PATCH /api/pcp/etapas/:id/destravar-sequencia`.
2. WHEN um Usuario_Autorizado solicita travar a sequência de uma Etapa `PENDENTE` ou `PAUSADA`, THE API_PCP SHALL definir `sequenciaTravada=true` e registrar o usuário e o instante da trava.
3. WHEN um Usuario_Autorizado solicita travar uma Etapa `EM_ANDAMENTO`, THE API_PCP SHALL definir `sequenciaTravada=true`.
4. IF a Etapa está `CONCLUIDA` ou a OP está `CONCLUIDA` ou `CANCELADA`, THEN THE API_PCP SHALL responder 409 com mensagem em português e não alterar a Etapa.
5. IF o usuário não é um Usuario_Autorizado, THEN THE API_PCP SHALL responder 403 e não alterar a Etapa.
6. WHEN um Usuario_Autorizado solicita destravar uma Etapa_Travada_por_Sequencia, THE API_PCP SHALL definir `sequenciaTravada=false` e limpar o usuário e o instante da trava.
7. WHEN a trava é solicitada em uma Etapa que já está travada por sequência, THE API_PCP SHALL responder 200 e manter o estado (operação idempotente).
8. WHEN o destravamento é solicitado em uma Etapa que não está travada por sequência, THE API_PCP SHALL responder 200 e manter o estado.
9. WHEN uma Etapa passa para `CONCLUIDA`, THE API_PCP SHALL definir `sequenciaTravada=false` nessa Etapa.
10. WHEN uma Etapa `CONCLUIDA` retorna para a fila, THE API_PCP SHALL manter `sequenciaTravada=false` nessa Etapa.
11. THE API_PCP SHALL manter a Trava_de_Data e a Trava_de_Sequencia independentes, sem que a alteração de uma modifique a outra.

### Requirement 3: Preservar a posição travada nas reordenações automáticas

**User Story:** Como planejadora, quero que as rotinas automáticas de fila nunca movam um split travado por sequência, para que a importação de OPs não mude a ordem combinada.

#### Acceptance Criteria

1. WHEN o Motor_de_Fila recalcula posições (`recalcularPosicoesFila`), THE Motor_de_Fila SHALL manter a `posicaoFila` de toda Etapa_Travada_por_Sequencia igual ao valor anterior.
2. WHEN `reordenarComIniciadaNoTopo` é executada, THE Motor_de_Fila SHALL manter a `posicaoFila` de toda Etapa_Travada_por_Sequencia igual ao valor anterior, inclusive quando a Etapa iniciada é outra.
3. WHEN uma Etapa_Travada_por_Sequencia é iniciada, THE Motor_de_Fila SHALL manter a posição dessa Etapa.
4. WHEN o Motor_de_Fila conclui o recálculo, THE Motor_de_Fila SHALL produzir posições sem repetição entre as etapas da Fila.
5. WHEN o Motor_de_Fila é executado duas vezes seguidas sobre a mesma Fila, THE Motor_de_Fila SHALL produzir o mesmo resultado na segunda execução (idempotência).
6. WHILE uma Fila não contém nenhuma Etapa_Travada_por_Sequencia, THE Motor_de_Fila SHALL produzir o mesmo resultado que produzia antes desta funcionalidade.

### Requirement 4: Novas etapas entram depois da zona congelada

**User Story:** Como planejadora, quero que OPs novas importadas entrem depois dos splits travados, para que as datas previstas deles no Gantt não piorem por causa da importação.

#### Acceptance Criteria

1. WHEN o Importador_OP adiciona uma Etapa nova a uma Fila com ao menos uma Etapa_Travada_por_Sequencia, THE Motor_de_Fila SHALL atribuir à Etapa nova uma `posicaoFila` maior que a de toda Etapa_Travada_por_Sequencia dessa Fila.
2. WHEN uma Etapa nova entra em uma Fila com Zona_Congelada, THE Motor_de_Fila SHALL manter inalterada a `posicaoFila` de toda Etapa existente dentro da Zona_Congelada.
3. WHEN uma Etapa é movida (`PATCH /etapas/:id/mover`) para uma Fila com Zona_Congelada, THE API_PCP SHALL posicionar essa Etapa depois da última Etapa_Travada_por_Sequencia do centro de destino.
4. WHEN o Importador_OP chama `reordenarFilaAutomaticamente` para um centro, THE Motor_de_Fila SHALL ordenar por número da OP e data de entrega apenas as etapas posteriores à Zona_Congelada que não tenham `ordemManual=true`.

### Requirement 5: Proteger a reordenação manual

**User Story:** Como gestora de PCP, quero que somente pessoas autorizadas alterem a posição de um split travado, para que ninguém desfaça a sequência por engano ao arrastar outros blocos.

#### Acceptance Criteria

1. WHEN `PATCH /api/pcp/etapas/reordenar` recebe uma lista em que alguma Etapa_Travada_por_Sequencia ficaria em posição diferente da atual, e o usuário não é um Usuario_Autorizado, THEN THE API_PCP SHALL responder 403 com a lista das etapas travadas afetadas e não alterar nenhuma `posicaoFila`.
2. WHEN `PATCH /api/pcp/etapas/reordenar` recebe uma lista em que toda Etapa_Travada_por_Sequencia mantém a posição atual, THE API_PCP SHALL aplicar a reordenação, desde que o usuário tenha `podeReordenarFila`.
3. WHEN um Usuario_Autorizado reordena e altera a posição de uma Etapa_Travada_por_Sequencia, THE API_PCP SHALL aplicar a reordenação e manter `sequenciaTravada=true` na Etapa em sua nova posição.
4. WHEN `PATCH /api/pcp/programacao/reordenar-fila-cortadeira` recebe uma lista que altera a posição de uma Etapa_Travada_por_Sequencia, THE API_PCP SHALL aplicar as mesmas regras dos critérios 1 e 3.
5. WHEN a reordenação do critério 3 é aplicada, THE API_PCP SHALL registrar no Log_OP de cada OP cuja Etapa_Travada_por_Sequencia mudou de posição o usuário, a posição anterior e a nova posição.
6. WHEN a reordenação é aplicada, THE API_PCP SHALL gravar posições sequenciais de 1 a N sem repetição.

### Requirement 6: Proteger operações que alteram a fila fora da reordenação

**User Story:** Como gestora de PCP, quero que mover, desmembrar ou excluir um split travado exija autorização, para que a trava não seja contornada por outro caminho.

#### Acceptance Criteria

1. IF o usuário não é um Usuario_Autorizado e solicita mover uma Etapa_Travada_por_Sequencia para outro centro (`PATCH /etapas/:id/mover` ou `PATCH /etapas/:id/agendar` com `centroProducaoId`), THEN THE API_PCP SHALL responder 403 e não alterar a Etapa.
2. IF o usuário não é um Usuario_Autorizado e solicita desmembrar, reverter parte ou excluir uma Etapa_Travada_por_Sequencia, THEN THE API_PCP SHALL responder 403 e não alterar a Etapa.
3. WHEN um Usuario_Autorizado move uma Etapa_Travada_por_Sequencia para outro centro, THE API_PCP SHALL definir `sequenciaTravada=false` nessa Etapa e registrar o fato no Log_OP.
4. WHEN um Usuario_Autorizado desmembra uma Etapa_Travada_por_Sequencia, THE API_PCP SHALL criar as partes com `sequenciaTravada=false` e registrar o fato no Log_OP.
5. WHEN uma Etapa_Travada_por_Sequencia é excluída por um Usuario_Autorizado, THE API_PCP SHALL registrar a exclusão da trava no Log_OP da OP.
6. WHEN a OP de uma Etapa_Travada_por_Sequencia é cancelada, THE API_PCP SHALL remover a Etapa da Fila e liberar sua trava.

### Requirement 7: Preservar a trava de sequência na reimportação da OP

**User Story:** Como planejadora, quero que reimportar ou atualizar uma OP não destrave a sequência dos seus splits, para que a correção de uma OP não desfaça a programação.

#### Acceptance Criteria

1. WHEN o Importador_OP recria as etapas de uma OP existente, THE Importador_OP SHALL restaurar `sequenciaTravada=true` e a `posicaoFila` anterior em cada etapa recriada que corresponda a uma Etapa_Travada_por_Sequencia anterior, com o mesmo centro e a mesma descrição normalizada.
2. IF não existe etapa recriada correspondente a uma Etapa_Travada_por_Sequencia anterior, THEN THE Importador_OP SHALL registrar no Log_OP da OP o centro, a descrição e a posição da trava perdida.
3. WHEN a posição anterior de uma etapa restaurada está ocupada por outra Etapa_Travada_por_Sequencia, THE Importador_OP SHALL manter a Etapa_Travada_por_Sequencia já existente na posição e posicionar a etapa restaurada na próxima posição livre após a Zona_Congelada.
4. WHEN uma OP existente é atualizada, THE Importador_OP SHALL realizar a restauração dos critérios 1 e 2 e a restauração da Requirement 1 (critério 4) na mesma transação da recriação das etapas.

### Requirement 8: Permissão dedicada podeTravarSequencia

**User Story:** Como administrador, quero configurar quem pode travar a sequência, por perfil e por tipo de processo, para controlar o acesso por máquina.

#### Acceptance Criteria

1. THE API_PCP SHALL aceitar e persistir `podeTravarSequencia` no nível global e em `permissoesPorProcesso` na rota de permissões (`permissoes-pcp.routes.ts`).
2. THE API_PCP SHALL usar o valor padrão `false` para `podeTravarSequencia` quando o usuário não possui configuração explícita.
3. WHERE existe configuração de `podeTravarSequencia` para o tipo de processo do centro da Etapa, THE API_PCP SHALL usar essa configuração; caso contrário, THE API_PCP SHALL usar a permissão global.
4. WHILE o usuário tem perfil ADMIN ou SUPER_ADMIN, THE API_PCP SHALL tratar o usuário como Usuario_Autorizado, independentemente da configuração.
5. THE Tela_Permissoes SHALL exibir o controle "Travar sequência" no nível global e por tipo de processo, com o mesmo comportamento dos controles existentes.
6. WHEN o endpoint de permissões do usuário logado é consultado, THE API_PCP SHALL retornar o valor efetivo de `podeTravarSequencia`.
7. WHEN uma configuração de permissões salva antes desta funcionalidade é lida, THE API_PCP SHALL tratar `podeTravarSequencia` como `false`.

### Requirement 9: Indicador visual e menu de contexto no Gantt

**User Story:** Como planejadora, quero ver e controlar a trava de sequência direto no bloco do Gantt, para saber o que está fixo e agir com o botão direito.

#### Acceptance Criteria

1. THE API_PCP SHALL incluir `sequenciaTravada` por etapa na resposta de `GET /pcp/timeline`.
2. WHILE uma Etapa é Etapa_Travada_por_Sequencia, THE Gantt SHALL exibir no bloco um cadeado visualmente distinto do cadeado da Trava_de_Data.
3. WHILE uma Etapa tem as duas travas, THE Gantt SHALL exibir os dois indicadores sem sobreposição.
4. WHEN o usuário abre o menu de contexto (botão direito) de um bloco sem Trava_de_Sequencia, THE Gantt SHALL exibir o item "Travar sequência na fila".
5. WHEN o usuário abre o menu de contexto de um bloco com Trava_de_Sequencia, THE Gantt SHALL exibir o item "Destravar sequência".
6. WHILE o usuário não possui permissão efetiva `podeTravarSequencia`, THE Gantt SHALL exibir os itens dos critérios 4 e 5 desabilitados com a explicação do motivo.
7. WHEN o usuário passa o cursor sobre um bloco travado por sequência, THE Gantt SHALL exibir no tooltip o texto "Sequência travada" com a posição na fila e o nome de quem travou.
8. WHILE o modo "Reordenar fila" está ativo e o usuário não possui permissão efetiva `podeTravarSequencia`, THE Gantt SHALL impedir o arrasto de um bloco travado por sequência e exibir uma mensagem informando o motivo.
9. IF a API_PCP responde 403 a uma reordenação por causa de Etapa_Travada_por_Sequencia, THEN THE Gantt SHALL exibir a mensagem retornada, listar os blocos travados afetados e restaurar a ordem anterior na tela.
10. WHEN o usuário aciona "Resolver conflitos", THE Gantt SHALL enviar uma ordem que mantenha toda Etapa_Travada_por_Sequencia na posição atual.
11. WHEN uma ação de travar ou destravar é concluída com sucesso, THE Gantt SHALL recarregar a timeline e exibir uma notificação de confirmação.
12. THE Painel_Programacao SHALL exibir o indicador de Trava_de_Sequencia na linha da etapa e SHALL exibir a mensagem da API_PCP quando uma reordenação for recusada por causa da trava.

### Requirement 10: Auditoria

**User Story:** Como gestora, quero um histórico de quem travou, destravou ou alterou uma sequência travada, para auditar a programação.

#### Acceptance Criteria

1. WHEN uma Trava_de_Sequencia é criada, THE API_PCP SHALL gravar um Log_OP com o usuário, a descrição da Etapa, o centro e a posição na fila.
2. WHEN uma Trava_de_Sequencia é removida manualmente, THE API_PCP SHALL gravar um Log_OP com o usuário, a descrição da Etapa e o centro.
3. WHEN uma Trava_de_Sequencia é removida automaticamente (conclusão, mudança de centro, desmembramento, exclusão), THE API_PCP SHALL gravar um Log_OP com o motivo.
4. WHEN um Usuario_Autorizado altera a posição de uma Etapa_Travada_por_Sequencia, THE API_PCP SHALL gravar um Log_OP conforme o Requisito 5, critério 5.
5. WHEN a API_PCP recusa uma operação por causa de Etapa_Travada_por_Sequencia, THE API_PCP SHALL gravar um Log_OP com o usuário e a operação recusada.

### Requirement 11: Isolamento multi-tenant

**User Story:** Como responsável pela plataforma, quero que a trava de uma empresa nunca afete outra, para manter o isolamento entre clientes.

#### Acceptance Criteria

1. THE API_PCP SHALL filtrar por `empresaId` do usuário (via `ordemProducao.empresaId`) toda consulta de Etapa usada nas rotas de travar e destravar sequência e nas validações de reordenação, mover, desmembrar e excluir.
2. IF a Etapa informada pertence a outra empresa, THEN THE API_PCP SHALL responder 404 e não alterar nenhum registro.
3. THE Motor_de_Fila SHALL considerar somente etapas do centro informado, e THE API_PCP SHALL validar que o centro pertence à empresa do usuário.
4. WHEN a permissão é verificada, THE API_PCP SHALL usar as permissões do usuário dentro da empresa da sessão, sem depender apenas de `request.prismaScoped`.

### Requirement 12: Não-regressão

**User Story:** Como usuária do PCP, quero que nada mude para quem não usar a trava de sequência, para não perder o comportamento atual.

#### Acceptance Criteria

1. WHILE nenhuma Etapa de uma Fila está com Trava_de_Sequencia, THE API_PCP SHALL produzir as mesmas `posicaoFila` que produzia antes desta funcionalidade para reordenar, importar, mover, desmembrar e excluir.
2. WHILE nenhuma Etapa de uma empresa está com Trava_de_Sequencia, THE Gantt SHALL exibir e comportar-se de forma idêntica à versão anterior.
3. THE API_PCP SHALL manter inalterados os contratos de resposta existentes, acrescentando somente campos novos opcionais.
4. THE Motor_de_Agenda SHALL manter a saída idêntica à anterior para entradas sem Trava_de_Sequencia.
5. THE API_PCP SHALL manter os testes existentes de `fila-ordenacao.utils.test.ts` e `timeline-agenda.service.test.ts` passando sem alteração.

### Requirement 13: Schema e migração de produção

**User Story:** Como mantenedor, quero que o banco de produção receba os campos novos de forma idempotente, para evitar erro de coluna inexistente após o deploy.

#### Acceptance Criteria

1. THE schema Prisma SHALL declarar em `EtapaOrdemProducao` os campos `sequenciaTravada` (booleano, padrão `false`), `sequenciaTravadaEm` (data/hora opcional) e `sequenciaTravadaPorId` (texto opcional).
2. THE Migrador_Producao SHALL criar as colunas correspondentes com `ADD COLUMN IF NOT EXISTS`, de forma que duas execuções seguidas terminem sem erro e sem alterar dados.
3. THE alteração de `schema.prisma` e a de `prisma/migrate-prod.ts` SHALL estar no mesmo commit.
4. WHEN o Migrador_Producao é executado em um banco com dados existentes, THE Migrador_Producao SHALL manter `sequenciaTravada=false` em todas as etapas existentes.

### Requirement 14: Cobertura de testes das regras puras

**User Story:** Como mantenedor, quero testes automatizados das regras de fila com travas, para impedir regressões na programação.

#### Acceptance Criteria

1. THE Motor_de_Fila SHALL ter testes de propriedade (fast-check) verificando que `recalcularPosicoesFila` e `reordenarComIniciadaNoTopo` preservam a posição de toda Etapa_Travada_por_Sequencia, para quaisquer filas geradas.
2. THE Motor_de_Fila SHALL ter testes de propriedade verificando que posições são únicas após o recálculo e que a segunda execução não altera o resultado.
3. THE Motor_de_Fila SHALL ter testes de propriedade verificando que etapas novas ficam em posição maior que a de toda Etapa_Travada_por_Sequencia.
4. THE Motor_de_Fila SHALL ter teste de propriedade verificando que, sem etapas travadas por sequência, a saída é igual à da implementação anterior.
5. THE validação de reordenação manual SHALL ter testes cobrindo: usuário não autorizado com posição travada alterada (recusa), usuário não autorizado sem alteração de posição travada (aceita) e Usuario_Autorizado (aceita).
6. THE restauração de travas na reimportação SHALL ter testes cobrindo etapa correspondente, etapa sem correspondência e conflito de posição.
