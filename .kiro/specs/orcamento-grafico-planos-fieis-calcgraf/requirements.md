# Requisitos — Planos fiéis ao Calcgraf no Orçamento Gráfico

## Introdução

No Calcgraf, a engenharia de cada item de orçamento vive em **Planos** (a janela
"Tipo de Plano"): cada plano é uma folha/componente físico com suporte, cores,
formato e acabamentos próprios. Todo cálculo tem ao menos 1 plano; produtos
compostos (Cartucho Composto = Tampa+Fundo, Frente+Costa) têm 2 ou mais.

O Vizor já possui a estrutura de planos (`PlanoCalculoGrafico` + rotas CRUD + a
seção "Planos do Cálculo" na tela de detalhe), mas o fluxo de **Puxar Cálculo**
da biblioteca não materializa os planos — o item nasce "sem plano", divergindo do
Calcgraf. A foto rica de cada cálculo migrado já contém os planos
(`resultado_calculo.planos[]`), então a correção reorganiza dado existente, sem
re-migração nem mudança de schema, e sem alterar o custo já ancorado do item.

## Glossário

- **Plano**: componente/folha física da engenharia (suporte + cores + formato +
  acabamentos). Unidade central do cálculo gráfico no Calcgraf.
- **Foto rica**: snapshot do pré-cálculo do Calcgraf gravado em
  `calculo_grafico.resultado_calculo` (inclui `planos[]`, `FotoPlano`).
- **Puxar Cálculo**: criar um item de orçamento copiando a engenharia de um
  cálculo da biblioteca (rotas `POST /:id/itens/de-calculo` e `POST /de-calculo`).
- **Ancoragem Calcgraf**: o custo/valor do item puxado é o valor real do Calcgraf
  (diferença zero), não o recálculo do motor.
- **Plano único**: cálculo com 1 plano (cartucho/lâmina simples).

## Requisitos

### Requisito 1: Puxar cálculo multi-plano materializa todos os planos

**User Story:** Como operador de orçamento, quero que ao puxar um cálculo com
vários planos (ex.: Cartucho Composto) o item nasça com todos os planos
preenchidos, para refletir fielmente a engenharia do Calcgraf.

#### Acceptance Criteria

1. WHEN o operador puxa um cálculo cuja foto tem 2 ou mais planos THEN o sistema
   SHALL criar um `PlanoCalculoGrafico` por plano da foto, vinculado ao item criado.
2. THE sistema SHALL preencher cada plano com nome, suporte (texto da foto),
   gramatura, número de cores e formato (largura×altura) derivados do `FotoPlano`.
3. WHEN um campo do `FotoPlano` estiver ausente ou nulo THEN o plano SHALL gravar
   esse campo como nulo, sem inventar valor.
4. THE sistema SHALL ordenar os planos criados pela sequência da foto.

### Requisito 2: Puxar cálculo de plano único materializa "Plano 1"

**User Story:** Como operador, quero que mesmo um cálculo de plano único exiba um
"Plano 1" preenchido, para que nenhum item apareça como "sem plano" (fiel ao
Calcgraf, onde todo cálculo tem ao menos 1 plano).

#### Acceptance Criteria

1. WHEN o operador puxa um cálculo cuja foto tem 0 ou 1 plano THEN o sistema SHALL
   criar exatamente 1 `PlanoCalculoGrafico` ("Plano 1") para o item.
2. THE sistema SHALL preencher o "Plano 1" com a engenharia do item (suporte,
   gramatura, cores, formato) quando a foto não trouxer um plano explícito.

### Requisito 3: Custo do item permanece inalterado (não-regressão)

**User Story:** Como gestor, quero que a criação dos planos não altere o custo nem
o valor do item puxado, para preservar a paridade de diferença zero com o Calcgraf
já validada.

#### Acceptance Criteria

1. WHEN os planos são criados ao puxar um cálculo THEN o `custoProducao` e o
   `valorTotal` do item SHALL permanecer iguais aos da ancoragem Calcgraf.
2. THE sistema SHALL tratar os planos como detalhamento de engenharia/exibição, e
   NÃO SHALL recalcular o total do item a partir da soma dos planos.
3. THE total consolidado do orçamento SHALL permanecer inalterado após a criação
   dos planos.

### Requisito 4: A tela de detalhe exibe os planos sem chamada extra

**User Story:** Como operador, quero ver os planos do item já preenchidos ao abrir
o orçamento, para conferir a engenharia sem ações adicionais.

#### Acceptance Criteria

1. WHEN o operador abre um orçamento THEN o GET do orçamento SHALL devolver, para
   cada item, a lista de planos (`itens[].planos`) ordenada por sequência.
2. THE seção "Planos do Cálculo" SHALL exibir os planos a partir desse dado, sem
   requisição adicional.
3. WHERE o item não tiver planos THE seção SHALL continuar funcionando (lista vazia
   tolerada), sem erro.

### Requisito 5: Backfill dos itens já puxados (apenas rascunho)

**User Story:** Como gestor, quero que os orçamentos já criados antes desta
mudança recebam seus planos, para não precisar refazê-los manualmente — sem tocar
em orçamentos já emitidos.

#### Acceptance Criteria

1. THE sistema SHALL oferecer um script de backfill que cria os planos dos itens
   que têm cálculo de origem e nenhum plano.
2. THE backfill SHALL operar SOMENTE em orçamentos com status RASCUNHO.
3. IF um item já possui planos THEN o backfill SHALL ignorá-lo (idempotência).
4. WHEN o backfill é executado duas vezes THEN o resultado SHALL ser o mesmo da
   primeira execução (sem duplicar planos).
5. THE backfill SHALL suportar modo `--dry-run` (relatório sem gravar) e filtro
   por empresa.

### Requisito 6: Isolamento multi-tenant

**User Story:** Como responsável pela segurança, quero que a criação e a leitura
de planos respeite o isolamento por empresa, para não vazar dados entre empresas.

#### Acceptance Criteria

1. THE criação de planos ao puxar SHALL gravar o `empresaId` da entidade de
   negócio real (do orçamento/cálculo), com filtro explícito em toda query.
2. WHEN o GET do orçamento devolve os planos THEN SHALL filtrar por `empresaId`
   explícito.
3. IF o cálculo de origem for de outra empresa THEN o puxar SHALL continuar
   retornando 403 (comportamento atual preservado).

### Requisito 7: Parsing resiliente dos campos de plano

**User Story:** Como operador, quero que formatos e cores vindos de texto sejam
interpretados corretamente, sem o sistema quebrar com dados fora do padrão.

#### Acceptance Criteria

1. WHEN o formato vier como texto "L x A" (ex.: "284 x 488") THEN o sistema SHALL
   extrair largura e altura numéricas.
2. WHEN as cores vierem como texto "NxM" (ex.: "2x0", "6x0", "4/0") THEN o sistema
   SHALL derivar o número de cores de forma consistente.
3. IF o texto de formato/cores for inválido ou ausente THEN o sistema SHALL gravar
   nulo/zero sem lançar erro.

### Requisito 8: Sem mudança de schema e sem alterar o motor

**User Story:** Como mantenedor, quero que a mudança seja aditiva e de baixo risco,
para não introduzir dívida de migração nem regressão de cálculo.

#### Acceptance Criteria

1. THE solução SHALL reutilizar o model `PlanoCalculoGrafico` existente, sem
   `ALTER TABLE` nem alteração em `migrate-prod.ts`.
2. THE solução NÃO SHALL alterar o motor de cálculo (`calcularOrcamentoGrafico`).
3. THE solução NÃO SHALL exigir re-exportação de dados do sistema de origem.
