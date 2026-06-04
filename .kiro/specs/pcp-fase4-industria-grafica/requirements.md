# Documento de Requisitos — Fase 4: Particularidades da Indústria Gráfica

## Introdução

Este documento especifica os requisitos para as funcionalidades específicas da indústria gráfica dentro do módulo PCP integrado ao WMS. Inclui: gestão de bobinas com consumo parcial e retorno de sobras, controle de lotes de cor (Pantone), estoque de terceiros (material consignado de clientes), paletização dinâmica para produtos com dimensões variáveis, e regras de armazenagem específicas para insumos gráficos (inflamáveis, sensíveis à umidade). Estas funcionalidades são extensões opcionais — ativadas por configuração da empresa — que não afetam o funcionamento genérico do WMS/PCP para outros nichos.

## Glossário

- **Sistema**: O backend VisioFab.Wms.Back (Fastify + Prisma + PostgreSQL)
- **Empresa**: Entidade multi-tenant
- **Bobina**: Rolo de papel ou filme com controle por peso (kg), largura (mm) e diâmetro (mm), sujeito a consumo parcial
- **ControleBobina**: Registro que rastreia o ciclo de vida de uma bobina individual (peso original, peso atual, fragmentações)
- **ConsumoParcia**: Situação onde apenas parte de uma bobina é utilizada na produção, gerando um retorno de sobra com novo código de barras
- **LoteCorrespondencia**: Agrupamento de lotes de tinta que garantem uniformidade de cor em tiragens repetidas
- **EstoqueTerceiro**: Material armazenado na gráfica que pertence a um cliente (papel consignado)
- **ProprietarioEstoque**: Classificação do estoque: PROPRIO (da gráfica) ou TERCEIRO (do cliente)
- **PaletizacaoDinamica**: Cálculo de cubagem e peso de paletes customizados para produtos acabados com dimensões variáveis
- **Apara**: Refugo de papel gerado no acerto de máquina (corte/refile)
- **GramaturaGm2**: Peso do papel em gramas por metro quadrado
- **FEFO**: First Expired, First Out — regra de separação por validade (já implementada no WMS)
- **ZonaSegregada**: Área de armazenamento com restrições especiais (inflamáveis, controlados)

## Requisitos

### Requisito 1: Cadastro e Controle de Bobinas

**User Story:** Como almoxarife de gráfica, quero controlar individualmente cada bobina de papel com seu peso real, para que o estoque reflita a quantidade física exata disponível.

#### Critérios de Aceitação

1. THE Sistema SHALL permitir criar um registro ControleBobina com os campos: produtoId (obrigatório), codigoBarrasUnico (obrigatório, gerado automaticamente ou informado), pesoOriginalKg (decimal > 0), pesoAtualKg (decimal > 0, inicialmente = pesoOriginalKg), larguraMm (inteiro > 0), diametroBobinaOriginalMm (inteiro, opcional), diametroBobinaAtualMm (inteiro, opcional), lote (opcional), bobinaPaiId (opcional — referência à bobina original se for retorno), empresaId, status (enum: DISPONIVEL, RESERVADA, NA_MAQUINA, CONSUMIDA, RETORNADA)
2. THE Sistema SHALL gerar automaticamente o codigoBarrasUnico no formato: `BOB-{ANO}-{SEQUENCIAL:5}` (ex: BOB-2026-00941)
3. WHEN uma bobina é fragmentada (retorno de sobra), THE Sistema SHALL gerar código filho no formato: `{codigoPai}-R{sequencial:2}` (ex: BOB-2026-00941-R01)
4. THE Sistema SHALL vincular o ControleBobina ao SaldoEndereco correspondente (endereço onde a bobina está fisicamente)
5. THE Sistema SHALL permitir listar bobinas com filtros: produtoId, status, larguraMm, pesoMinimo, pesoMaximo, lote, enderecoId
6. THE Sistema SHALL exibir o histórico de movimentações de cada bobina (criação, reserva, envio à máquina, consumo parcial, retorno)
7. THE Sistema SHALL impedir que uma bobina com status diferente de DISPONIVEL seja reservada ou enviada à máquina

---

### Requisito 2: Fluxo de Consumo Parcial de Bobina

**User Story:** Como operador de produção, quero registrar que usei apenas parte de uma bobina e devolver o restante ao almoxarifado com novo peso, para que o estoque seja preciso.

#### Critérios de Aceitação

1. THE Sistema SHALL fornecer um endpoint `POST /api/bobinas/:id/consumo-parcial` com campos: pesoConsumidoKg (decimal > 0), perdaAcertoKg (decimal >= 0, default 0), ordemProducaoId (obrigatório), pesoRetornoBalancaKg (decimal, obrigatório se houver sobra)
2. THE Sistema SHALL validar que: pesoConsumidoKg + perdaAcertoKg + pesoRetornoBalancaKg <= pesoAtualKg (com tolerância de 2% para variação de umidade)
3. WHEN pesoRetornoBalancaKg > 0, THE Sistema SHALL:
   - Criar um novo registro ControleBobina filho com pesoOriginalKg = pesoRetornoBalancaKg, bobinaPaiId = id da bobina original, status = DISPONIVEL
   - Gerar novo codigoBarrasUnico (formato -R01, -R02, etc.)
   - Criar novo SaldoEndereco para a bobina filha
   - Atualizar a bobina original: status = CONSUMIDA, pesoAtualKg = 0
4. WHEN pesoRetornoBalancaKg = 0 (bobina totalmente consumida), THE Sistema SHALL atualizar: status = CONSUMIDA, pesoAtualKg = 0
5. THE Sistema SHALL registrar LogMovimentacao com tipo = `CONSUMO_BOBINA` contendo: bobinaId, pesoAnterior, pesoConsumido, perdaAcerto, pesoRetorno
6. THE Sistema SHALL atualizar o Estoque.quantidade do produto: decrementar pesoConsumidoKg + perdaAcertoKg (o retorno mantém no estoque)
7. THE Sistema SHALL vincular o consumo ao ApontamentoProducao da OP para custeio

---

### Requisito 3: Separação de Bobinas com Critérios Gráficos

**User Story:** Como almoxarife, quero que a separação de bobinas para produção priorize bobinas já iniciadas (parciais) e respeite a largura exata exigida pela máquina, para minimizar desperdício.

#### Critérios de Aceitação

1. WHEN uma LiberacaoMaterial solicita um produto do tipo bobina (papel_bobina), THE Sistema SHALL aplicar a seguinte prioridade de separação:
   - 1º: Bobinas parciais (bobinaPaiId != null) com larguraMm compatível e peso suficiente
   - 2º: Bobinas inteiras com larguraMm exata
   - 3º: Bobinas inteiras com larguraMm maior (que pode ser refilada)
2. THE Sistema SHALL filtrar bobinas pela larguraMm exigida na OP (campo do ItemOrdemProducao ou do AtributoGrafico do produto)
3. THE Sistema SHALL aplicar FEFO (validade) como critério secundário quando múltiplas bobinas atendem os critérios primários
4. THE Sistema SHALL retornar na sugestão de separação: codigoBarrasUnico, enderecoWms, pesoDisponivel, larguraMm, lote, dataValidade
5. IF nenhuma bobina com largura exata estiver disponível, THEN THE Sistema SHALL sugerir bobinas com largura superior e calcular a apara prevista
6. THE Sistema SHALL reservar a bobina selecionada (status = RESERVADA) ao criar a onda de separação

---

### Requisito 4: Controle de Lotes de Cor (Tintas)

**User Story:** Como gestor de qualidade, quero garantir que tiragens repetidas do mesmo cliente usem o mesmo lote de tinta, para manter uniformidade de cor entre impressões.

#### Critérios de Aceitação

1. THE Sistema SHALL permitir criar um registro LoteCorrespondencia com: clienteId, produtoTintaId, loteFornecedor, codigoPantone, ordemProducaoOriginalId (primeira OP que usou este lote), observacoes, status (ATIVO, ESGOTADO)
2. WHEN uma LiberacaoMaterial solicita tinta para uma OP vinculada a um cliente que possui LoteCorrespondencia ativo para aquele produto, THE Sistema SHALL priorizar a separação do lote correspondente
3. IF o lote correspondente não possuir saldo suficiente, THEN THE Sistema SHALL alertar o operador com mensagem: "Lote de cor {lote} insuficiente para manter correspondência. Saldo: {saldo}kg. Necessário: {necessario}kg"
4. THE Sistema SHALL permitir que o operador force a separação de outro lote (com justificativa obrigatória registrada)
5. THE Sistema SHALL atualizar LoteCorrespondencia.status para ESGOTADO quando o saldo do lote no WMS chegar a zero
6. THE Sistema SHALL fornecer um relatório de correspondência de cores por cliente: cliente, produto tinta, lote, Pantone, OPs vinculadas, saldo restante

---

### Requisito 5: Estoque de Terceiros (Material Consignado)

**User Story:** Como almoxarife, quero separar o estoque próprio do estoque de clientes (papel consignado), para que o controle patrimonial e fiscal seja correto.

#### Critérios de Aceitação

1. THE Sistema SHALL adicionar o campo `proprietarioTipo` ao modelo SaldoEndereco com valores: `PROPRIO` (default), `TERCEIRO`
2. THE Sistema SHALL adicionar o campo `clienteProprietarioId` ao modelo SaldoEndereco (nullable, obrigatório quando proprietarioTipo = TERCEIRO)
3. WHEN um material de terceiro é recebido (NotaEntrada com flag `materialTerceiro = true`), THE Sistema SHALL criar SaldoEndereco com proprietarioTipo = TERCEIRO e clienteProprietarioId preenchido
4. THE Sistema SHALL fornecer um endpoint `GET /api/estoque-terceiros` que lista: clienteId, clienteNome, produtoId, produtoDescricao, quantidade, enderecoWms, dataEntrada
5. THE Sistema SHALL impedir que material de terceiro seja consumido em OPs de outros clientes (validação na liberação de material)
6. THE Sistema SHALL permitir filtrar o estoque geral por proprietarioTipo (PROPRIO, TERCEIRO, TODOS)
7. THE Sistema SHALL fornecer um relatório de posição de estoque de terceiros por cliente para fins de prestação de contas
8. THE Sistema SHALL separar o custo: material de terceiro não entra no custo da OP (custo zero para a gráfica)

---

### Requisito 6: Paletização Dinâmica

**User Story:** Como operador de expedição, quero que o sistema calcule automaticamente a cubagem e peso de paletes customizados para cada pedido, para otimizar o carregamento e gerar romaneios precisos.

#### Critérios de Aceitação

1. THE Sistema SHALL fornecer um endpoint `POST /api/paletizacao/calcular` que aceita: itens (array de: produtoId, quantidade, pesoUnitarioKg, larguraCm, alturaCm, profundidadeCm), tipoPalete (enum: MADEIRA_1000x1200, MADEIRA_800x1200, PLASTICO, CUSTOMIZADO), pesoMaximoPaleteKg (decimal, default 1000), alturaMaximaPaleteCm (decimal, default 180)
2. THE Sistema SHALL calcular para cada palete sugerido: quantidadeItens, pesoTotalKg (itens + palete), volumeTotalM3, alturaTotalCm, percentualOcupacao
3. THE Sistema SHALL distribuir os itens em paletes respeitando: pesoMaximo, alturaMaxima, e compatibilidade de empilhamento (itens pesados embaixo)
4. THE Sistema SHALL retornar: numeroPaletes, listagemPorPalete (itens, peso, dimensões), pesoTotalExpedicao, volumeTotalExpedicao
5. THE Sistema SHALL usar os dados de dimensão do SKU (campos largura, altura, profundidade, peso já existentes no modelo SKU) quando disponíveis
6. IF as dimensões do produto não estiverem cadastradas no SKU, THEN THE Sistema SHALL exigir que sejam informadas no request
7. THE Sistema SHALL integrar o cálculo de paletização com o módulo de Volume existente (criar Volumes com tipo PALETE e dimensões calculadas)

---

### Requisito 7: Registro de Aparas (Refugo de Papel)

**User Story:** Como operador de produção, quero registrar as aparas (refugo de corte/refile) separadamente das perdas de processo, para controle ambiental e possível venda de reciclagem.

#### Critérios de Aceitação

1. THE Sistema SHALL fornecer um endpoint `POST /api/apontamentos-producao/:id/aparas` com campos: produtoOrigemId (papel que gerou a apara), pesoAparaKg (decimal > 0), tipoApara (enum: ACERTO_MAQUINA, REFILE, CORTE_VINCO, IMPRESSAO_DEFEITUOSA), destinoApara (enum: RECICLAGEM, DESCARTE, ESTOQUE_APARA), ordemProducaoId
2. WHEN destinoApara = ESTOQUE_APARA, THE Sistema SHALL incrementar o estoque de um produto genérico "APARA-PAPEL" (configurável por empresa) com a quantidade em kg
3. THE Sistema SHALL acumular o total de aparas por OP para cálculo de eficiência: `percentualApara = (totalAparasKg / pesoTotalMPConsumidaKg) × 100`
4. THE Sistema SHALL fornecer um relatório de aparas por: período, centroProducao, tipoApara, produtoOrigem
5. THE Sistema SHALL comparar o percentualApara real com o percentualPerda previsto na BOM e alertar quando a diferença exceder 5 pontos percentuais
6. THE Sistema SHALL registrar LogMovimentacao com tipo = `APARA` para rastreabilidade

---

### Requisito 8: Zonas de Armazenagem Segregada (Inflamáveis/Químicos)

**User Story:** Como gestor de segurança, quero que tintas, solventes e vernizes sejam armazenados apenas em zonas segregadas, para cumprir normas de segurança e evitar contaminação.

#### Critérios de Aceitação

1. THE Sistema SHALL adicionar o campo `restricaoArmazenagem` ao modelo Zona com valores: `NENHUMA` (default), `INFLAMAVEL`, `QUIMICO`, `TEMPERATURA_CONTROLADA`, `UMIDADE_CONTROLADA`
2. THE Sistema SHALL adicionar o campo `restricaoArmazenagem` ao modelo Produto (ou DadosLogisticosArmazenagem) com os mesmos valores
3. WHEN o endereçamento inteligente aloca um produto com restricaoArmazenagem != NENHUMA, THE Sistema SHALL filtrar apenas endereços em Zonas com a mesma restricaoArmazenagem
4. IF nenhum endereço compatível estiver disponível, THEN THE Sistema SHALL retornar erro com mensagem: "Não há endereços disponíveis na zona {restricao} para o produto {produto}"
5. THE Sistema SHALL impedir endereçamento manual de produtos restritos em zonas incompatíveis (validação no confirmar-coletor)
6. THE Sistema SHALL exibir alertas visuais (ícone/badge) para produtos com restrição de armazenagem nas telas de estoque e endereçamento
7. THE Sistema SHALL fornecer um relatório de ocupação por zona segregada: zona, capacidade, ocupação atual, produtos armazenados

---

### Requisito 9: Controle de Umidade para Papéis

**User Story:** Como gestor de qualidade, quero registrar a umidade residual de bobinas de papel no recebimento, para garantir que papéis fora da especificação sejam bloqueados.

#### Critérios de Aceitação

1. THE Sistema SHALL adicionar o campo `umidadeResidualPercent` (decimal, opcional) ao modelo ControleBobina
2. THE Sistema SHALL adicionar os campos `umidadeMinPercent` e `umidadeMaxPercent` ao modelo Produto (ou DadosLogisticosArmazenagem) para definir a faixa aceitável
3. WHEN uma bobina é recebida com umidadeResidualPercent fora da faixa (< umidadeMin ou > umidadeMax), THE Sistema SHALL bloquear a bobina com status = BLOQUEADO_QUALIDADE e criar uma PendenciaLogistica com tipo = UMIDADE_FORA_ESPECIFICACAO
4. THE Sistema SHALL permitir que um gestor de qualidade libere a bobina bloqueada (com justificativa) ou a rejeite (devolução ao fornecedor)
5. THE Sistema SHALL registrar o histórico de medições de umidade por bobina
6. THE Sistema SHALL alertar na separação se uma bobina está próxima do limite de umidade (dentro de 1% do máximo)

---

### Requisito 10: Configuração de Funcionalidades Gráficas por Empresa

**User Story:** Como administrador, quero ativar/desativar funcionalidades específicas da indústria gráfica por empresa, para que o sistema seja genérico e sirva outros nichos sem funcionalidades desnecessárias.

#### Critérios de Aceitação

1. THE Sistema SHALL adicionar ao modelo Empresa (ou a um modelo ParametroPcp vinculado) os seguintes flags de configuração:
   - `usaControleBobina` (boolean, default false) — ativa gestão de bobinas
   - `usaLoteCorrespondencia` (boolean, default false) — ativa controle de lotes de cor
   - `usaEstoqueTerceiro` (boolean, default false) — ativa estoque consignado
   - `usaPaletizacaoDinamica` (boolean, default false) — ativa cálculo de paletização
   - `usaControleApara` (boolean, default false) — ativa registro de aparas
   - `usaControleUmidade` (boolean, default false) — ativa controle de umidade
   - `usaZonaSegregada` (boolean, default false) — ativa restrições de zona
2. WHEN um flag está desativado, THE Sistema SHALL ocultar os endpoints e campos relacionados (retornar 404 ou omitir campos opcionais)
3. THE Sistema SHALL fornecer um endpoint `GET /api/pcp/configuracao` que retorna todos os flags ativos para a empresa
4. THE Sistema SHALL fornecer um endpoint `PATCH /api/pcp/configuracao` que permite ativar/desativar flags (apenas SUPER_ADMIN ou ADMIN)
5. THE Sistema SHALL aplicar os flags como validação nos fluxos: ex: se `usaControleBobina = false`, o endpoint de consumo parcial retorna 404
6. THE Sistema SHALL manter os dados existentes intactos ao desativar um flag (soft-disable, não deleta dados)
