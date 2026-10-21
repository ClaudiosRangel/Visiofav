# Requirements Document

## Introduction

A Carton Wega está migrando do sistema Calcgraf/G-Print (Delphi, PHTech) para o
Vizor ERP. No Calcgraf, "Orçamento" e "Cálculo" são **duas entidades
separadas**: o Orçamento é o documento comercial (cliente + lista de itens), e o
Cálculo (tela "Cálculo Padrão") é a engenharia de custo do trabalho — com número
próprio (ex.: 7343, 15378) e vida independente do orçamento. A tela "Localiza o
Cálculo Padrão" permite que, ao montar um orçamento, o operador **reaproveite um
cálculo já feito** em vez de refazer do zero, buscando por cliente, linha de
produto, produto, descrição, sigla do acabado ou número do cálculo.

Hoje o módulo Orçamento Gráfico do Vizor **não possui o conceito de uma
biblioteca de cálculos reutilizáveis independente do orçamento** com busca no
estilo Calcgraf. O operador da Wega, acostumado a puxar um cálculo existente,
precisaria recriar cada cálculo do zero — o que gera resistência e perda de
produtividade. Além disso, o acervo de 11.561 cálculos do Calcgraf representa a
engenharia histórica da empresa e precisa ser trazido para o Vizor.

Esta feature tem **duas partes**:

1. **Biblioteca de Cálculos Gráficos** — criar no Vizor o conceito de "cálculo
   gráfico" reutilizável e independente do orçamento, com número próprio,
   localização/busca no estilo Calcgraf, e a capacidade de, ao incluir um item
   num orçamento, localizar e reaproveitar um cálculo existente.
2. **Migração do Acervo** — importar os cálculos existentes do Calcgraf (banco
   SQL Server restaurado como `CalcgrafCartonWega`) para a biblioteca do Vizor,
   preservando os valores congelados da foto do cálculo.

> **Observação sobre escopo:** o roadmap de migração havia decidido "sem
> histórico de pedidos/OPs/NF-e; Calcgraf = consulta". Esta feature **revisa essa
> decisão especificamente para os cálculos de orçamento** (o acervo de
> engenharia), que agora serão trazidos para preservar a produtividade do
> operador. A decisão sobre OPs/pedidos/NF-e permanece inalterada.

## Glossary

- **Vizor**: ERP gráfico multi-tenant (multi-empresa) de destino desta migração.
- **Calcgraf**: sistema legado (Delphi/PHTech) de origem; também chamado G-Print.
- **Cálculo Gráfico**: entidade nova no Vizor que representa a engenharia de
  custo de um trabalho gráfico (produto/tipo, suporte, cores, acabamentos,
  faca/montagem, formato), com número próprio e vida independente do orçamento.
  Equivale ao "Cálculo Padrão" do Calcgraf.
- **Biblioteca de Cálculos**: conjunto de Cálculos Gráficos reutilizáveis de uma
  empresa, pesquisável e reaproveitável ao montar orçamentos.
- **Orçamento Gráfico**: documento comercial já existente no Vizor (model
  `OrcamentoGrafico` + `ItemOrcamentoGrafico`), que lista itens para um cliente.
- **Foto do Cálculo**: snapshot congelado dos valores de um cálculo no momento em
  que foi feito (campo `resultadoCalculo` JSON), que **não deve ser recalculado**
  com os preços atuais.
- **Motor_de_Calculo**: função pura `calcularOrcamentoGrafico` que reproduz o
  cálculo do Calcgraf a partir de um input estruturado.
- **Numero_Calculo**: identificador sequencial próprio de um Cálculo Gráfico.
- **Sigla_Acabado**: código/sigla do produto acabado usado como critério de
  busca no Calcgraf.
- **Acervo_Calcgraf**: conjunto de cálculos existentes no banco do Calcgraf
  (tabela `CalculoHeader` + filhas `CalculoAtividades`, `CalculoPlanos`,
  `CalculoTintas`, `CalculoMatAcabamento`).
- **EmpresaId**: identificador da empresa (tenant) a que todo registro pertence
  (Carton Wega em produção: `75848e24-742e-461d-b913-1642c5b83ae9`).

## Requirements

### Requirement 1: Cálculo Gráfico reutilizável independente do orçamento

**User Story:** Como operador de orçamento da Carton Wega, quero que um cálculo
gráfico exista de forma independente do orçamento, com número próprio, para que
eu possa reaproveitá-lo em vários orçamentos sem refazer a engenharia de custo.

#### Acceptance Criteria

1. THE Vizor SHALL armazenar o Cálculo Gráfico como entidade própria, com vida
   independente de qualquer Orçamento Gráfico.
2. WHEN um Cálculo Gráfico é criado, THE Vizor SHALL atribuir a ele um
   Numero_Calculo único dentro da mesma EmpresaId.
3. THE Vizor SHALL armazenar em cada Cálculo Gráfico os dados de engenharia de
   custo: tipo/produto, descrição, suporte, cores, acabamentos, faca/montagem e
   formato.
4. THE Vizor SHALL armazenar em cada Cálculo Gráfico a Foto do Cálculo
   (resultado congelado) separada dos dados de entrada.
5. WHEN um Cálculo Gráfico é criado ou atualizado, THE Vizor SHALL registrar o
   EmpresaId da empresa proprietária.
6. WHILE uma consulta à Biblioteca de Cálculos é executada, THE Vizor SHALL
   restringir os resultados aos cálculos cujo EmpresaId é igual ao EmpresaId da
   empresa da sessão.
7. WHILE uma consulta à Biblioteca de Cálculos é executada, THE Vizor SHALL
   apresentar um snapshot consistente dos cálculos no momento do início da
   consulta, mesmo que alterações concorrentes ocorram durante a execução.

### Requirement 2: Localizar um cálculo na biblioteca (busca estilo Calcgraf)

**User Story:** Como operador de orçamento, quero localizar um cálculo existente
por múltiplos critérios, para que eu encontre rapidamente um cálculo já feito e o
reaproveite.

#### Acceptance Criteria

1. WHEN o operador informa um ou mais critérios de busca, THE Vizor SHALL
   retornar os Cálculos Gráficos da empresa que atendem a todos os critérios
   informados.
2. THE Vizor SHALL aceitar como critérios de busca: cliente, linha de produto,
   produto, descrição, Sigla_Acabado e Numero_Calculo.
3. WHEN nenhum critério é informado, THE Vizor SHALL retornar a lista de Cálculos
   Gráficos da empresa de forma paginada.
4. WHEN a busca por Numero_Calculo encontra correspondência exata, THE Vizor
   SHALL retornar o Cálculo Gráfico correspondente.
5. WHEN a busca por descrição ou produto é textual, THE Vizor SHALL retornar os
   cálculos cujo campo contém o termo informado, sem diferenciar maiúsculas de
   minúsculas.
6. THE Vizor SHALL exibir em cada resultado o Numero_Calculo, o cliente, o
   produto/descrição e a data do cálculo.

### Requirement 3: Reaproveitar um cálculo da biblioteca ao montar um orçamento

**User Story:** Como operador de orçamento, quero reaproveitar um cálculo da
biblioteca ao incluir um item num orçamento, para que eu não precise refazer a
engenharia de custo a cada orçamento.

#### Acceptance Criteria

1. WHEN o operador inclui um item num Orçamento Gráfico, THE Vizor SHALL oferecer
   a opção de localizar e selecionar um Cálculo Gráfico existente da biblioteca.
2. WHEN o operador seleciona um Cálculo Gráfico para reaproveitar, THE Vizor
   SHALL preencher o item do orçamento com os dados e a Foto do Cálculo do
   cálculo selecionado.
3. THE Vizor SHALL manter disponível a opção de criar um item de orçamento a
   partir de um cálculo novo, sem reaproveitar a biblioteca.
4. IF o Cálculo Gráfico selecionado pertence a outra EmpresaId, THEN THE Vizor
   SHALL impedir totalmente o reaproveitamento e retornar um erro de acesso
   negado, sem permitir copiar ou adaptar o cálculo para a empresa atual.

> **[A ESCLARECER 3.A]** Ao reaproveitar, o item do orçamento deve ser uma
> **cópia** (foto congelada, editável de forma isolada) ou um **vínculo**
> (referência ao cálculo da biblioteca, de modo que editar o cálculo reflita no
> item)? Isso impacta edição e recálculo e precisa ser decidido antes do design.

### Requirement 4: Foto do cálculo congelada (não recalcular)

**User Story:** Como responsável pela engenharia de custo, quero que um cálculo
arquivado preserve exatamente os valores com que foi feito, para que a consulta e
o reaproveitamento reproduzam o Calcgraf e não variem com os preços atuais.

#### Acceptance Criteria

1. THE Vizor SHALL preservar a Foto do Cálculo de um Cálculo Gráfico arquivado
   sem recalcular os valores com os cadastros/preços atuais.
2. WHEN um Cálculo Gráfico é exibido em modo de consulta, THE Vizor SHALL
   apresentar os valores da Foto do Cálculo.
3. WHEN o operador solicita explicitamente recalcular um Cálculo Gráfico, THE
   Vizor SHALL recalcular usando o Motor_de_Calculo e os cadastros atuais,
   preservar a Foto do Cálculo original como histórico e criar uma nova Foto/
   versão a partir do recálculo.
4. THE Vizor SHALL preservar, na Foto do Cálculo, os dois valores que vêm da
   memória e não são recalculados: o aproveitamento/folhas (imposição da faca) e
   os valores de laminação/verniz.

### Requirement 5: Cadastro de cálculo novo entra na biblioteca

**User Story:** Como operador de orçamento, quero que um cálculo novo criado no
Vizor fique disponível na biblioteca para reuso futuro, para que o acervo
continue crescendo sem esforço extra.

#### Acceptance Criteria

1. WHEN um Cálculo Gráfico novo é criado no Vizor, THE Vizor SHALL torná-lo
   localizável na Biblioteca de Cálculos da mesma empresa.
2. WHEN um Cálculo Gráfico novo é criado, THE Vizor SHALL atribuir o
   Numero_Calculo e disponibilizá-lo na Biblioteca de Cálculos na mesma operação
   atômica, sem estado intermediário em que o cálculo exista e tenha número mas
   ainda não esteja disponível na biblioteca.

> **[A ESCLARECER 5.A]** Todo cálculo novo entra automaticamente na biblioteca,
> ou o operador decide por cálculo se ele é "reutilizável" (salvo na biblioteca)
> ou descartável (só vinculado àquele orçamento)?

### Requirement 6: Importar o acervo de cálculos do Calcgraf

**User Story:** Como responsável pela migração, quero importar os cálculos
existentes do Calcgraf para a biblioteca do Vizor, para que a engenharia
histórica da empresa seja preservada e reaproveitável.

#### Acceptance Criteria

1. THE Vizor SHALL importar Cálculos Gráficos a partir do Acervo_Calcgraf
   (tabela `CalculoHeader` e filhas `CalculoAtividades`, `CalculoPlanos`,
   `CalculoTintas`, `CalculoMatAcabamento`).
2. WHEN um cálculo do Acervo_Calcgraf é importado, THE Vizor SHALL gravar o
   resultado como Foto do Cálculo congelada, preservando os valores da origem.
3. WHEN um cálculo do Acervo_Calcgraf é importado, THE Vizor SHALL associá-lo ao
   EmpresaId da Carton Wega.
4. IF um cálculo do Acervo_Calcgraf já foi importado anteriormente, THEN THE
   Vizor SHALL ignorar a nova tentativa de importação e manter o registro
   existente inalterado, sem criar duplicado (importação idempotente, sem
   sobrescrita).
5. WHEN a importação de um cálculo encontra um dado de origem corrompido ou
   ausente, THE Vizor SHALL registrar o cálculo afetado em um relatório de
   importação e continuar o processamento dos demais cálculos.
6. WHEN a importação termina, THE Vizor SHALL apresentar um resumo com a
   quantidade de cálculos importados, atualizados e com erro.

> **[A ESCLARECER 6.A]** Escopo da migração: importar **todos os 11.561**
> cálculos, ou aplicar um corte (ex.: por data recente, ou apenas cálculos de
> clientes ativos)?
>
> **[A ESCLARECER 6.B]** Encoding: a exportação do SQL Server deve usar `sqlcmd -u`
> (UTF-16 LE) convertido para UTF-8, para preservar acentos (lição já registrada
> no steering — o modo FOR JSON padrão corrompe acentos). Confirmar a fonte de
> extração (acesso direto ao banco restaurado vs JSON exportado).

### Requirement 7: Numeração dos cálculos migrados

**User Story:** Como responsável pela migração, quero preservar a rastreabilidade
do número original do Calcgraf, para que um cálculo migrado possa ser localizado
pelo mesmo número que a Wega conhece.

#### Acceptance Criteria

1. THE Vizor SHALL registrar, em cada Cálculo Gráfico migrado, o número original
   do cálculo no Calcgraf.
2. WHEN o operador busca pelo número original do Calcgraf, THE Vizor SHALL
   localizar o Cálculo Gráfico migrado correspondente.

> **[A ESCLARECER 7.A]** O Numero_Calculo do Vizor deve **preservar o mesmo
> número** do Calcgraf (ex.: 7343 continua 7343), ou o cálculo recebe um número
> próprio da sequência Vizor **mais** um campo de referência ao número do
> Calcgraf? Decidir considerando que cálculos novos do Vizor também recebem
> número próprio (Req 5.2) e que colisões de numeração precisam ser evitadas.

### Requirement 8: Isolamento multi-tenant e rastreabilidade

**User Story:** Como administrador do Vizor, quero que os cálculos de cada
empresa fiquem isolados e auditáveis, para que não haja vazamento de dados entre
empresas e para que a origem de cada cálculo seja rastreável.

#### Acceptance Criteria

1. THE Vizor SHALL filtrar toda consulta, criação, atualização e exclusão de
   Cálculo Gráfico pelo EmpresaId explícito da empresa da sessão.
2. IF o usuário da sessão é SUPER_ADMIN, THEN THE Vizor SHALL ainda assim
   restringir os Cálculos Gráficos ao EmpresaId da empresa selecionada na sessão.
3. THE Vizor SHALL registrar, em cada Cálculo Gráfico, a origem do cálculo
   (migrado do Calcgraf ou criado no Vizor).

## Pontos a esclarecer (consolidado)

Os itens marcados **[A ESCLARECER]** acima precisam de decisão do usuário antes
ou durante a fase de design:

- **3.A** — Reaproveitamento por **cópia** (foto) ou por **vínculo** (referência)?
- **5.A** — Todo cálculo novo entra na biblioteca automaticamente, ou o operador
  escolhe por cálculo?
- **6.A** — Migrar **todos os 11.561** cálculos ou aplicar um corte?
- **6.B** — Confirmar a fonte/encoding da extração do acervo (acesso direto ao
  banco restaurado vs JSON; `sqlcmd -u` UTF-16 → UTF-8 para acentos).
- **7.A** — Numeração: **preservar o número original** do Calcgraf ou **número
  próprio + referência**?

Além disso, é uma **decisão de design** (não de requisito) se a Biblioteca de
Cálculos será uma entidade nova (ex.: `CalculoGrafico` independente) ou um
`ItemOrcamentoGrafico` marcado como template/biblioteca. Os requisitos acima
capturam a necessidade (cálculo reutilizável, com número próprio e busca) de
forma independente dessa escolha de modelagem.
