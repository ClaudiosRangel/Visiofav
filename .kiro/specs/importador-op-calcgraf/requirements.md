# Requirements Document

Importador de OP do Calcgraf (agente desktop → Vizor)

## Introduction

Hoje, as Ordens de Produção (OP) da Carton Wega nascem no Vizor pela
**importação manual de um PDF** gerado pelo Calcgraf/GPrint (parser por regex
sobre o texto do PDF — frágil e trabalhoso). Este recurso elimina essa etapa:
um **aplicativo desktop leve**, instalado no mesmo terminal/servidor (TS) onde o
Calcgraf está instalado, lê **diretamente o banco de dados SQL Server do
Calcgraf (apenas leitura)**, identifica **OPs novas e OPs alteradas**, e as
envia pela internet (HTTPS) para a **API do Vizor na nuvem**
(`https://api.vizorerp.com.br`), autenticado por uma chave/token exclusivo.

No Vizor, as OPs recebidas aparecem no menu **Ordens de Produção** para serem
liberadas e seguirem o roteiro de status normal já existente
(`RASCUNHO → PLANEJADA → PROGRAMADA → LIBERADA → EM_PRODUCAO → CONCLUIDA`),
exatamente como funciona com a importação por PDF hoje.

### Escopo desta fase (MVP)
- Importar **apenas a OP** (cabeçalho, itens/estrutura, etapas/roteiro,
  quantidade, cliente, produto) — **não** os cálculos gráficos ainda. Os
  cálculos (planos, tiragens, tintas, acabamentos) ficam para uma fase futura,
  quando serão usados para estudar e eliminar as diferenças de orçamento que
  ainda existem.
- Reconciliar as **OPs que já estão em programação hoje** no Vizor com o
  Calcgraf: detectar alterações e sinalizá-las.
- Relacionar as **OPs novas** no menu Ordens de Produção para liberação manual.

### Fora de escopo desta fase
- Importação dos cálculos gráficos (OrcamentoGrafico) — fase futura.
- Escrita/alteração de qualquer dado no banco do Calcgraf (o agente é
  estritamente somente-leitura na origem).
- Substituir o importador de PDF existente (ele permanece disponível como
  fallback; os dois caminhos coexistem).

### Convenções
- "Agente" = o aplicativo desktop instalado no TS do Calcgraf.
- "Calcgraf" = o banco SQL Server de origem (nome restaurado localmente
  `CalcgrafCartonWega`; nome interno original "GPrint").
- "Vizor" = o ERP de destino (backend Fastify/Prisma + API na nuvem).
- Chave de identidade de uma OP entre os dois sistemas = **o número da OP do
  Calcgraf** (persistido no Vizor em `OrdemProducao.referenciaExterna`).
- Formato EARS: WHEN/IF/WHILE/WHERE ... THE system SHALL ...

---

## Glossary

- **TS**: Terminal Server / servidor onde o Calcgraf está instalado.
- **OP de origem**: a Ordem de Produção como existe no banco do Calcgraf
  (tabelas `OpHeader`/`OpItem`/`OpItemEstrutura`/`OpLote` e vínculos).
- **OP de destino**: o registro `OrdemProducao` correspondente no Vizor.
- **Sincronização**: ciclo de leitura das OPs de origem, comparação com o estado
  conhecido e envio das diferenças ao Vizor.
- **OP alterada**: OP já importada cujo conteúdo relevante mudou no Calcgraf
  desde a última sincronização (detectada por marca de alteração / hash de
  conteúdo).
- **Alteração pendente**: alteração detectada numa OP que já avançou no Vizor
  (com produção/apontamento), que **não** é aplicada automaticamente e exige
  revisão manual.
- **Token do agente / API key**: credencial exclusiva do agente para autenticar
  na API do Vizor, vinculada a uma empresa (tenant).

---

## Requirements

### Requisito 1: Leitura somente-leitura do banco do Calcgraf

**User Story:** Como responsável de TI/DevOps da Carton Wega, quero que o agente
leia o banco do Calcgraf sem nunca alterá-lo, para garantir que a operação atual
no Calcgraf não seja afetada de forma alguma.

#### Acceptance Criteria
1. THE agente SHALL conectar ao SQL Server do Calcgraf usando exclusivamente
   operações de leitura (`SELECT`), sem jamais executar `INSERT`, `UPDATE`,
   `DELETE`, `DDL` ou qualquer comando que altere a origem.
2. WHERE a conexão suportar, THE agente SHALL usar uma credencial de banco com
   permissão apenas de leitura (ex.: role `db_datareader`), de forma que a
   escrita seja impossível mesmo por engano.
3. IF a conexão com o SQL Server falhar, THEN THE agente SHALL registrar o erro
   localmente e tentar novamente no próximo ciclo, sem interromper o Calcgraf.
4. THE agente SHALL ser compatível com a instância padrão do SQL Server do
   Calcgraf, incluindo o caso de ela não expor TCP/1433 (acesso local por
   named pipes / shared memory).

### Requisito 2: Identificação de OPs novas e alteradas

**User Story:** Como PCP, quero que o agente detecte automaticamente as OPs
novas e as OPs que foram alteradas no Calcgraf, para que eu não precise importar
PDF manualmente nem conferir uma a uma.

#### Acceptance Criteria
1. WHEN o agente executa um ciclo de sincronização, THE agente SHALL identificar
   todas as OPs de origem que ainda não foram enviadas ao Vizor (OPs novas).
2. WHEN o agente executa um ciclo de sincronização, THE agente SHALL identificar
   as OPs já enviadas cujo conteúdo relevante mudou no Calcgraf desde o último
   envio (OPs alteradas), comparando por marca de data/hora de alteração da
   origem quando disponível e/ou por hash do conteúdo relevante.
3. THE agente SHALL usar o **número da OP do Calcgraf** como chave única de
   identidade de uma OP entre os dois sistemas.
4. WHILE não houver OP nova nem alterada em um ciclo, THE agente SHALL concluir o
   ciclo sem enviar nada e sem gerar erro.
5. THE agente SHALL persistir localmente o estado da última sincronização (ex.:
   última OP/registro processado, hash por OP) para que ciclos sucessivos
   enviem apenas diferenças (sincronização incremental).

### Requisito 3: Reconciliação das OPs em programação atual

**User Story:** Como PCP, quero que as OPs que já estão em programação hoje no
Vizor sejam comparadas com o Calcgraf, para que alterações feitas no Calcgraf
após a programação sejam detectadas.

#### Acceptance Criteria
1. WHEN o agente sincroniza, THE agente SHALL incluir na análise de alterações as
   OPs que no Vizor estão em status de programação ativa
   (`PROGRAMADA`/`LIBERADA`/`EM_PRODUCAO`), além das novas.
2. WHEN uma OP em programação no Vizor tiver conteúdo divergente do Calcgraf,
   THE Vizor SHALL sinalizar a divergência para revisão.
3. THE sistema SHALL preservar o roteiro de status já existente da OP durante a
   reconciliação (não forçar regressão de status).

### Requisito 4: Criação de OP nova no Vizor

**User Story:** Como PCP, quero que cada OP nova do Calcgraf apareça no menu
Ordens de Produção do Vizor, para liberá-la e seguir o roteiro de status normal.

#### Acceptance Criteria
1. WHEN o Vizor recebe uma OP de origem cujo número ainda não existe como
   `OrdemProducao.referenciaExterna` na empresa, THE Vizor SHALL criar uma nova
   `OrdemProducao` com `origemImportacao` indicando a origem Calcgraf.
2. THE Vizor SHALL preencher na OP criada: número de referência (número da OP do
   Calcgraf), quantidade, cliente e produto (vínculo formal quando houver
   de-para; senão como tags em `observacoes`, no mesmo padrão da importação por
   PDF — `[Cliente]`, `[Produto]`, etc.), itens/estrutura e etapas/roteiro.
3. THE Vizor SHALL criar a OP num status inicial que a torne visível e liberável
   no menu Ordens de Produção, seguindo o fluxo normal já existente.
4. THE Vizor SHALL isolar a OP criada pela `empresaId` correta (a empresa dona
   da chave/token do agente), nunca pela empresa de outro tenant.

### Requisito 5: Atualização de OP já importada

**User Story:** Como PCP, quero que uma OP já importada seja atualizada quando
mudar no Calcgraf, desde que isso não corrompa uma OP que já está em produção.

#### Acceptance Criteria
1. WHEN o Vizor recebe uma OP de origem cujo número já existe como
   `referenciaExterna` na empresa E a OP de destino **não** possui apontamento
   de produção nem etapa iniciada/concluída, THE Vizor SHALL atualizar a OP
   (itens, etapas, quantidade, dados do cabeçalho) com os dados do Calcgraf.
2. IF a OP de destino já possui apontamento de produção OU etapa
   iniciada/concluída, THEN THE Vizor SHALL **não** sobrescrever a OP
   automaticamente e SHALL registrar a alteração como "alteração pendente" para
   revisão manual, preservando o estado de produção atual.
3. WHEN uma atualização automática é aplicada, THE Vizor SHALL preservar
   vínculos manuais já feitos (ex.: de-para de produto por descrição) no mesmo
   espírito da reextração de PDF existente.
4. THE Vizor SHALL registrar em log/auditoria toda criação e atualização de OP
   originada do agente (o que mudou, quando, origem Calcgraf).

### Requisito 6: Autenticação e isolamento multi-tenant do envio

**User Story:** Como administrador do Vizor, quero que o envio do agente seja
autenticado e isolado por empresa, para que os dados da Carton Wega não vazem
nem se misturem com outros tenants.

#### Acceptance Criteria
1. THE API de recebimento SHALL exigir uma credencial exclusiva do agente
   (API key/token) em toda requisição.
2. THE API de recebimento SHALL associar a credencial a exatamente uma
   `empresaId` e gravar todos os dados recebidos sob essa empresa.
3. IF a credencial estiver ausente, inválida ou revogada, THEN THE API SHALL
   rejeitar a requisição com erro de autenticação e não processar nada.
4. THE API SHALL recusar qualquer tentativa de a requisição gravar sob uma
   empresa diferente da vinculada à credencial.

### Requisito 7: Modos de execução do agente (segundo plano e sob demanda)

**User Story:** Como usuário/PCP, quero poder deixar o agente sincronizando em
segundo plano e também disparar uma sincronização manual quando acessar a
ferramenta, para ter flexibilidade.

#### Acceptance Criteria
1. THE agente SHALL suportar execução em **segundo plano** (serviço/processo
   contínuo) que sincroniza em intervalos configuráveis.
2. THE agente SHALL suportar **sincronização sob demanda** (acionada pelo
   usuário), relacionando as OPs novas e alteradas naquele momento.
3. THE agente SHALL expor ao usuário o resultado de cada sincronização (quantas
   OPs novas, quantas alteradas, quantas pendentes de revisão, erros).
4. THE intervalo de sincronização em segundo plano SHALL ser configurável.

### Requisito 8: Resiliência, idempotência e observabilidade

**User Story:** Como responsável pela operação, quero que a sincronização seja
confiável e repetível, para que falhas de rede ou reinícios não dupliquem nem
percam OPs.

#### Acceptance Criteria
1. THE processo de envio e recebimento SHALL ser **idempotente**: reenviar a
   mesma OP (mesmo número e mesmo conteúdo) não SHALL criar duplicatas no Vizor.
2. IF o envio de uma OP falhar (rede/API), THEN THE agente SHALL manter essa OP
   como pendente e reenviá-la em ciclo futuro, sem bloquear as demais.
3. THE agente SHALL registrar logs locais de cada ciclo (sucessos, falhas,
   contadores) para diagnóstico.
4. THE API de recebimento SHALL validar o payload recebido e rejeitar com
   mensagem clara dados malformados, sem corromper OPs existentes.

### Requisito 9: Instalação e configuração no TS

**User Story:** Como DevOps que cuida do TS, quero instalar e configurar o agente
de forma simples e seguir uma política de segurança clara, para liberar o
recurso com confiança.

#### Acceptance Criteria
1. THE agente SHALL ser distribuível como um instalável desktop para Windows
   (ambiente do TS).
2. THE agente SHALL permitir configurar: string/credencial de conexão ao SQL
   Server local (somente leitura), a URL da API do Vizor, a credencial/token do
   agente e o intervalo de sincronização.
3. THE agente SHALL funcionar com saída HTTPS (443) para `api.vizorerp.com.br`,
   documentando os requisitos de firewall/proxy para o DevOps.
4. THE credencial de conexão ao banco e o token do Vizor SHALL ser armazenados
   de forma protegida no TS (não em texto plano exposto), e nunca enviados a
   terceiros além da própria API do Vizor.
