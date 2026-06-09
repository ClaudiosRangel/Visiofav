# Design Document

## Overview

A Fase 2 de escalonamento do WMS adiciona 5 módulos ao sistema existente seguindo a mesma arquitetura da Fase 1: backend Fastify com Prisma/PostgreSQL, frontend Next.js 15 com Mantine v7 e TanStack Query, mobile React Native (Expo). Cada módulo é implementado como um conjunto de routes/services no backend e páginas/componentes no frontend, reutilizando os padrões já estabelecidos (middleware de auth JWT, tenant-context via empresaId, auditoria via LogMovimentoWms, validação Zod, transações Prisma.$transaction).

## Architecture

A arquitetura segue o padrão monolítico modular existente: cada módulo é um diretório em `src/modules/` com arquivos de routes, service, schemas e types. Workers são implementados como setInterval no processo Fastify principal. Frontend segue o padrão App Router do Next.js 15 com páginas em `app/wms/`.

## Components and Interfaces

Os 5 módulos interagem entre si e com módulos existentes:
- **Faturamento** → lê dados de Estoque, recebimento e separação existentes
- **Picking por Zona** → integra com OndaSeparacao e OrdemServicoWms existentes
- **LMS** → integra com OrdemServicoWms existente (hook em início/conclusão)
- **Pátio** → integra com AgendaWms e Docas existentes
- **Multi-CD** → integra com Estoque e CentroDistribuicao existentes

## Data Models

---

## Módulo 1: Faturamento de Armazenagem

### Modelo de Dados

```prisma
model ContratoArmazenagem {
  id                  String   @id @default(uuid())
  empresaId           String   @map("empresa_id")
  clienteId           String   @map("cliente_id")
  dataInicio          DateTime @map("data_inicio")
  dataFim             DateTime @map("data_fim")
  periodicidade       String   @db.VarChar(20) @default("MENSAL") // SEMANAL, QUINZENAL, MENSAL
  moeda               String   @db.VarChar(3) @default("BRL")
  status              String   @db.VarChar(20) @default("ATIVO") // ATIVO, SUSPENSO, ENCERRADO
  observacao          String?  @db.Text
  criadoPorId         String   @map("criado_por_id")
  criadoEm            DateTime @default(now()) @map("criado_em")
  atualizadoEm        DateTime @updatedAt @map("atualizado_em")

  tarifas             TarifaContrato[]
  medicoes            MedicaoOcupacao[]
  faturas             FaturaArmazenagem[]

  @@unique([empresaId, clienteId, status], name: "contrato_ativo_por_cliente")
  @@index([empresaId, status])
  @@map("contrato_armazenagem")
}

model TarifaContrato {
  id                  String   @id @default(uuid())
  contratoId          String   @map("contrato_id")
  contrato            ContratoArmazenagem @relation(fields: [contratoId], references: [id], onDelete: Cascade)
  tipo                String   @db.VarChar(30) // PALLET_DIA, METRO_CUBICO, MOVIMENTACAO_ENTRADA, MOVIMENTACAO_SAIDA, PERMANENCIA, PICKING_UNITARIO
  valorUnitario       Decimal  @db.Decimal(12, 4) @map("valor_unitario")
  carenciaDias        Int?     @map("carencia_dias") // usado apenas para PERMANENCIA
  descricao           String?  @db.VarChar(200)

  @@unique([contratoId, tipo])
  @@map("tarifa_contrato")
}

model MedicaoOcupacao {
  id                  String   @id @default(uuid())
  empresaId           String   @map("empresa_id")
  contratoId          String   @map("contrato_id")
  contrato            ContratoArmazenagem @relation(fields: [contratoId], references: [id])
  clienteId           String   @map("cliente_id")
  dataMedicao         DateTime @map("data_medicao")
  quantidadePallets   Int      @map("quantidade_pallets")
  volumeM3            Decimal  @db.Decimal(12, 4) @map("volume_m3")
  posicoesOcupadas    Int      @map("posicoes_ocupadas")
  detalhamento        Json?    // { produtoId: { pallets, m3 } }
  criadoEm            DateTime @default(now()) @map("criado_em")

  @@index([empresaId, contratoId, dataMedicao])
  @@map("medicao_ocupacao")
}

model MovimentacaoFaturavel {
  id                  String   @id @default(uuid())
  empresaId           String   @map("empresa_id")
  contratoId          String   @map("contrato_id")
  clienteId           String   @map("cliente_id")
  tipo                String   @db.VarChar(20) // ENTRADA, SAIDA, PICKING
  data                DateTime
  produtoId           String   @map("produto_id")
  quantidade          Decimal  @db.Decimal(12, 4)
  referenciaId        String?  @map("referencia_id") // notaEntradaId, ondaSeparacaoId, etc.
  faturado            Boolean  @default(false)
  criadoEm            DateTime @default(now()) @map("criado_em")

  @@index([empresaId, contratoId, faturado])
  @@map("movimentacao_faturavel")
}

model FaturaArmazenagem {
  id                  String   @id @default(uuid())
  empresaId           String   @map("empresa_id")
  contratoId          String   @map("contrato_id")
  contrato            ContratoArmazenagem @relation(fields: [contratoId], references: [id])
  clienteId           String   @map("cliente_id")
  numero              String   @db.VarChar(20) // FAT-YYYY-NNNNNN
  periodoInicio       DateTime @map("periodo_inicio")
  periodoFim          DateTime @map("periodo_fim")
  valorTotal          Decimal  @db.Decimal(12, 2) @map("valor_total")
  dataVencimento      DateTime @map("data_vencimento")
  status              String   @db.VarChar(20) @default("GERADA") // GERADA, ENVIADA, PAGA, CANCELADA
  motivoCancelamento  String?  @db.Text @map("motivo_cancelamento")
  observacao          String?  @db.Text
  criadoPorId         String   @map("criado_por_id")
  criadoEm            DateTime @default(now()) @map("criado_em")
  atualizadoEm        DateTime @updatedAt @map("atualizado_em")

  itens               ItemFatura[]

  @@unique([empresaId, numero])
  @@index([empresaId, status])
  @@map("fatura_armazenagem")
}

model ItemFatura {
  id                  String   @id @default(uuid())
  faturaId            String   @map("fatura_id")
  fatura              FaturaArmazenagem @relation(fields: [faturaId], references: [id], onDelete: Cascade)
  tipoTarifa          String   @db.VarChar(30) @map("tipo_tarifa")
  descricao           String   @db.VarChar(200)
  quantidade          Decimal  @db.Decimal(12, 4)
  valorUnitario       Decimal  @db.Decimal(12, 4) @map("valor_unitario")
  subtotal            Decimal  @db.Decimal(12, 2)

  @@map("item_fatura")
}
```

### API Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | /api/faturamento/contratos | Lista contratos |
| POST | /api/faturamento/contratos | Cria contrato |
| PUT | /api/faturamento/contratos/:id | Atualiza contrato |
| PUT | /api/faturamento/contratos/:id/encerrar | Encerra contrato |
| GET | /api/faturamento/medicoes | Lista medições por contrato/período |
| POST | /api/faturamento/medicoes/reprocessar | Reprocessa medição de data faltante |
| GET | /api/faturamento/faturas | Lista faturas com filtros |
| POST | /api/faturamento/faturas/gerar | Gera fatura para contrato/período |
| PUT | /api/faturamento/faturas/:id | Atualiza fatura (ajustes manuais) |
| PUT | /api/faturamento/faturas/:id/enviar | Marca fatura como enviada |
| PUT | /api/faturamento/faturas/:id/pagar | Marca fatura como paga |
| PUT | /api/faturamento/faturas/:id/cancelar | Cancela fatura |
| GET | /api/faturamento/relatorio | Relatório consolidado |
| GET | /api/faturamento/relatorio/exportar | Exporta relatório CSV |

### Lógica de Negócio

1. **Medição Diária (Worker)**: Job agendado (cron ou setInterval) que para cada contrato ATIVO executa query de saldo por cliente agrupando por endereço → pallet/m³. Registra snapshot na tabela MedicaoOcupacao.
2. **Registro de Movimentações**: Hooks nos services existentes de recebimento/expedição/separação criam MovimentacaoFaturavel quando o item pertence a um cliente com contrato ativo.
3. **Geração de Fatura**: Ao atingir período, calcula somatórios por tarifa, gera ItemFatura para cada tipo, calcula total e cria fatura com vencimento = periodoFim + 10 dias úteis (configurável).
4. **Transação**: Toda geração de fatura dentro de `$transaction` para garantir consistência entre itens, total e marcação de movimentações como faturadas.

---

## Módulo 2: Picking por Zona/Cluster

### Modelo de Dados

```prisma
model ZonaPicking {
  id                  String   @id @default(uuid())
  empresaId           String   @map("empresa_id")
  cdId                String   @map("cd_id")
  nome                String   @db.VarChar(50)
  codigo              String   @db.VarChar(10)
  cor                 String   @db.VarChar(7) // hex color #FF0000
  status              String   @db.VarChar(10) @default("ATIVA") // ATIVA, INATIVA
  pontoConsolidacaoId String?  @map("ponto_consolidacao_id")
  criadoEm            DateTime @default(now()) @map("criado_em")
  atualizadoEm        DateTime @updatedAt @map("atualizado_em")

  enderecos           EnderecoZonaPicking[]
  separadores         SeparadorZona[]
  subOndas            SubOnda[]

  @@unique([empresaId, cdId, codigo])
  @@index([empresaId, status])
  @@map("zona_picking")
}

model EnderecoZonaPicking {
  id                  String   @id @default(uuid())
  zonaPickingId       String   @map("zona_picking_id")
  zonaPicking         ZonaPicking @relation(fields: [zonaPickingId], references: [id], onDelete: Cascade)
  enderecoId          String   @map("endereco_id")

  @@unique([enderecoId])
  @@map("endereco_zona_picking")
}

model SeparadorZona {
  id                  String   @id @default(uuid())
  zonaPickingId       String   @map("zona_picking_id")
  zonaPicking         ZonaPicking @relation(fields: [zonaPickingId], references: [id], onDelete: Cascade)
  usuarioId           String   @map("usuario_id")
  tipo                String   @db.VarChar(15) @default("PRINCIPAL") // PRINCIPAL, SECUNDARIA
  criadoEm            DateTime @default(now()) @map("criado_em")

  @@unique([zonaPickingId, usuarioId])
  @@map("separador_zona")
}

model PontoConsolidacao {
  id                  String   @id @default(uuid())
  empresaId           String   @map("empresa_id")
  cdId                String   @map("cd_id")
  nome                String   @db.VarChar(50)
  enderecoId          String   @map("endereco_id")
  ativo               Boolean  @default(true)
  criadoEm            DateTime @default(now()) @map("criado_em")

  @@map("ponto_consolidacao")
}

model SubOnda {
  id                  String   @id @default(uuid())
  empresaId           String   @map("empresa_id")
  ondaSeparacaoId     String   @map("onda_separacao_id")
  zonaPickingId       String   @map("zona_picking_id")
  zonaPicking         ZonaPicking @relation(fields: [zonaPickingId], references: [id])
  separadorId         String?  @map("separador_id")
  status              String   @db.VarChar(30) @default("PENDENTE") // PENDENTE, AGUARDANDO_SEPARADOR, EM_SEPARACAO, CONCLUIDA
  totalItens          Int      @map("total_itens")
  itensConcluidos     Int      @default(0) @map("itens_concluidos")
  iniciadaEm          DateTime? @map("iniciada_em")
  concluidaEm         DateTime? @map("concluida_em")
  criadoEm            DateTime @default(now()) @map("criado_em")
  atualizadoEm        DateTime @updatedAt @map("atualizado_em")

  itens               ItemSubOnda[]

  @@index([empresaId, ondaSeparacaoId])
  @@index([zonaPickingId, status])
  @@map("sub_onda")
}

model ItemSubOnda {
  id                  String   @id @default(uuid())
  subOndaId           String   @map("sub_onda_id")
  subOnda             SubOnda  @relation(fields: [subOndaId], references: [id], onDelete: Cascade)
  itemOndaId          String   @map("item_onda_id") // referência ao item da onda original
  produtoId           String   @map("produto_id")
  enderecoOrigemId    String   @map("endereco_origem_id")
  quantidade          Decimal  @db.Decimal(12, 4)
  separado            Boolean  @default(false)
  separadoEm          DateTime? @map("separado_em")

  @@map("item_sub_onda")
}
```

### API Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | /api/picking-zona/zonas | Lista zonas |
| POST | /api/picking-zona/zonas | Cria zona |
| PUT | /api/picking-zona/zonas/:id | Atualiza zona |
| POST | /api/picking-zona/zonas/:id/enderecos | Vincula endereços à zona |
| DELETE | /api/picking-zona/zonas/:id/enderecos/:enderecoId | Remove endereço da zona |
| GET | /api/picking-zona/separadores | Lista separadores por zona |
| POST | /api/picking-zona/separadores | Atribui separador a zona |
| DELETE | /api/picking-zona/separadores/:id | Remove separador |
| GET | /api/picking-zona/pontos-consolidacao | Lista pontos de consolidação |
| POST | /api/picking-zona/pontos-consolidacao | Cria ponto |
| GET | /api/picking-zona/sub-ondas | Lista sub-ondas com filtros |
| GET | /api/picking-zona/sub-ondas/:id | Detalhes da sub-onda |
| POST | /api/picking-zona/dividir-onda/:ondaId | Divide onda em sub-ondas por zona |
| PUT | /api/picking-zona/sub-ondas/:id/atribuir | Atribui separador à sub-onda |
| GET | /api/picking-zona/painel | Painel de acompanhamento por zona |

### Lógica de Negócio

1. **Divisão de Onda**: Ao gerar/dividir onda, agrupa itens por endereço → zona. Para cada zona com itens, cria SubOnda com lista de ItemSubOnda. Atribui separador disponível da zona (round-robin ou menor carga).
2. **Balanceamento**: Se zona tem múltiplos separadores, distribui sub-ondas equilibrando por quantidade total de itens.
3. **Consolidação**: Quando todas as sub-ondas de uma onda estão CONCLUIDA, gera tarefa (OrdemServicoWms tipo CONSOLIDACAO) no PontoConsolidacao configurado.
4. **Integração**: Hook no service de separação existente que verifica se há sub-onda ativa e filtra itens por zona do separador logado.

---

## Módulo 3: Labor Management System (LMS)

### Modelo de Dados

```prisma
model MetaOperacao {
  id                  String   @id @default(uuid())
  empresaId           String   @map("empresa_id")
  tipoOperacao        String   @db.VarChar(30) @map("tipo_operacao") // CONFERENCIA, ENDERECAMENTO, SEPARACAO, CARREGAMENTO, INVENTARIO
  tempoMetaMinutos    Decimal  @db.Decimal(8, 2) @map("tempo_meta_minutos")
  unidadeMedida       String   @db.VarChar(20) @map("unidade_medida") // POR_ITEM, POR_PALLET, POR_LINHA, POR_VOLUME
  toleranciaPercentual Decimal @db.Decimal(5, 2) @default(15) @map("tolerancia_percentual")
  categoriaProduto    String?  @db.VarChar(30) @map("categoria_produto") // PESADO, FRAGIL, NORMAL, REFRIGERADO
  ativo               Boolean  @default(true)
  criadoPorId         String   @map("criado_por_id")
  criadoEm            DateTime @default(now()) @map("criado_em")
  atualizadoEm        DateTime @updatedAt @map("atualizado_em")

  historico           HistoricoMetaOperacao[]

  @@index([empresaId, tipoOperacao, ativo])
  @@map("meta_operacao")
}

model HistoricoMetaOperacao {
  id                  String   @id @default(uuid())
  metaOperacaoId      String   @map("meta_operacao_id")
  metaOperacao        MetaOperacao @relation(fields: [metaOperacaoId], references: [id])
  usuarioId           String   @map("usuario_id")
  campo               String   @db.VarChar(50)
  valorAnterior       String?  @db.Text @map("valor_anterior")
  valorNovo           String?  @db.Text @map("valor_novo")
  criadoEm            DateTime @default(now()) @map("criado_em")

  @@map("historico_meta_operacao")
}

model RegistroProdutividade {
  id                  String   @id @default(uuid())
  empresaId           String   @map("empresa_id")
  operadorId          String   @map("operador_id")
  ordemServicoId      String   @map("ordem_servico_id")
  tipoOperacao        String   @db.VarChar(30) @map("tipo_operacao")
  tempoMetaMinutos    Decimal  @db.Decimal(8, 2) @map("tempo_meta_minutos")
  tempoRealMinutos    Decimal  @db.Decimal(8, 2) @map("tempo_real_minutos")
  tempoPausaMinutos   Decimal  @db.Decimal(8, 2) @default(0) @map("tempo_pausa_minutos")
  indiceProdutividade Decimal  @db.Decimal(8, 2) @map("indice_produtividade") // (meta/real)*100
  quantidadeItens     Int      @map("quantidade_itens")
  faixaDesempenho     String   @db.VarChar(15) @map("faixa_desempenho") // ACIMA_META, NA_META, ABAIXO_META
  iniciadoEm          DateTime @map("iniciado_em")
  concluidoEm         DateTime @map("concluido_em")
  criadoEm            DateTime @default(now()) @map("criado_em")

  @@index([empresaId, operadorId, criadoEm])
  @@index([empresaId, tipoOperacao, criadoEm])
  @@map("registro_produtividade")
}

model ConfigIncentivo {
  id                  String   @id @default(uuid())
  empresaId           String   @map("empresa_id")
  faixa               String   @db.VarChar(15) // ACIMA_META, NA_META, ABAIXO_META
  pontosIncentivo     Int      @map("pontos_incentivo") // positivo = incentivo, negativo = penalidade
  descricao           String?  @db.VarChar(200)
  ativo               Boolean  @default(true)
  criadoEm            DateTime @default(now()) @map("criado_em")

  @@unique([empresaId, faixa])
  @@map("config_incentivo")
}

model PausaOperador {
  id                  String   @id @default(uuid())
  empresaId           String   @map("empresa_id")
  operadorId          String   @map("operador_id")
  ordemServicoId      String?  @map("ordem_servico_id")
  tipo                String   @db.VarChar(20) // INTERVALO, ALMOCO, BANHEIRO, OUTROS
  inicioEm            DateTime @map("inicio_em")
  fimEm               DateTime? @map("fim_em")
  duracaoMinutos      Decimal? @db.Decimal(8, 2) @map("duracao_minutos")

  @@index([empresaId, operadorId, inicioEm])
  @@map("pausa_operador")
}
```

### API Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | /api/lms/metas | Lista metas por operação |
| POST | /api/lms/metas | Cria meta |
| PUT | /api/lms/metas/:id | Atualiza meta |
| GET | /api/lms/produtividade | Lista registros de produtividade |
| GET | /api/lms/ranking | Ranking de funcionários |
| GET | /api/lms/relatorio/funcionario/:id | Relatório individual |
| GET | /api/lms/relatorio/operacao/:tipo | Relatório por tipo de operação |
| GET | /api/lms/relatorio/exportar | Exporta CSV |
| GET | /api/lms/incentivos | Lista configurações de incentivo |
| POST | /api/lms/incentivos | Configura incentivo/penalidade |
| PUT | /api/lms/incentivos/:id | Atualiza configuração |
| POST | /api/lms/pausas/iniciar | Registra início de pausa |
| PUT | /api/lms/pausas/:id/encerrar | Encerra pausa |

### Lógica de Negócio

1. **Medição Automática**: Integração com services de OrdemServicoWms existente. Ao iniciar OS → registra timestamp + operadorId. Ao concluir OS → calcula tempo real, busca meta correspondente, gera RegistroProdutividade.
2. **Cálculo de Meta por Tarefa**: `tempoMeta = metaOperacao.tempoMetaMinutos × quantidadeItens`. Se categoria de produto específica → usa meta da categoria.
3. **Desconto de Pausa**: Soma pausas registradas entre início e conclusão da tarefa. `tempoReal = (conclusão - início) - totalPausas`.
4. **Índice**: `indiceProdutividade = (tempoMeta / tempoRealLiquido) × 100`.
5. **Faixa**: Se índice > 100 + tolerância → ACIMA_META. Se índice entre (100 - tolerância) e (100 + tolerância) → NA_META. Senão → ABAIXO_META.
6. **Alerta 3x meta**: Worker verifica OS abertas com tempo > 3 × meta. Gera alerta ao gestor.

---

## Módulo 4: Yard Management (Gestão de Pátio)

### Modelo de Dados

```prisma
model VeiculoPatio {
  id                  String    @id @default(uuid())
  empresaId           String    @map("empresa_id")
  cdId                String    @map("cd_id")
  placa               String    @db.VarChar(10)
  motoristaNome       String    @db.VarChar(150) @map("motorista_nome")
  motoristaDocumento  String    @db.VarChar(20) @map("motorista_documento")
  transportadoraId    String?   @map("transportadora_id")
  tipoOperacao        String    @db.VarChar(20) @map("tipo_operacao") // CARGA, DESCARGA, DEVOLUCAO, TRANSFERENCIA
  agendamentoId       String?   @map("agendamento_id")
  status              String    @db.VarChar(20) @default("AGUARDANDO") // AGUARDANDO, NA_DOCA, LIBERADO
  docaId              String?   @map("doca_id")
  entradaEm           DateTime  @map("entrada_em")
  chamadaDocaEm       DateTime? @map("chamada_doca_em")
  chegadaDocaEm       DateTime? @map("chegada_doca_em")
  saidaEm             DateTime? @map("saida_em")
  tempoPermMinutos    Int?      @map("tempo_perm_minutos")
  criadoPorId         String    @map("criado_por_id")
  criadoEm            DateTime  @default(now()) @map("criado_em")
  atualizadoEm        DateTime  @updatedAt @map("atualizado_em")

  filaPosicao         FilaEsperaPatio?

  @@index([empresaId, cdId, status])
  @@index([placa])
  @@map("veiculo_patio")
}

model FilaEsperaPatio {
  id                  String   @id @default(uuid())
  empresaId           String   @map("empresa_id")
  cdId                String   @map("cd_id")
  veiculoId           String   @unique @map("veiculo_id")
  veiculo             VeiculoPatio @relation(fields: [veiculoId], references: [id])
  posicao             Int
  prioridade          Int      @default(0) // maior = mais prioritário
  justificativaPrioridade String? @db.Text @map("justificativa_prioridade")
  entradaFilaEm       DateTime @map("entrada_fila_em")

  @@index([empresaId, cdId, prioridade, posicao])
  @@map("fila_espera_patio")
}

model ChamadaDoca {
  id                  String    @id @default(uuid())
  empresaId           String    @map("empresa_id")
  veiculoId           String    @map("veiculo_id")
  docaId              String    @map("doca_id")
  status              String    @db.VarChar(20) @default("CHAMADO") // CHAMADO, ATENDIDO, CANCELADO
  chamadoEm           DateTime  @map("chamado_em")
  atendidoEm          DateTime? @map("atendido_em")
  canceladoEm         DateTime? @map("cancelado_em")
  motivoCancelamento  String?   @db.Text @map("motivo_cancelamento")
  tempoRespostaMin    Int?      @map("tempo_resposta_min")
  chamadoPorId        String    @map("chamado_por_id")
  criadoEm            DateTime  @default(now()) @map("criado_em")

  @@index([empresaId, status])
  @@map("chamada_doca")
}

model ConfigPatio {
  id                  String @id @default(uuid())
  empresaId           String @map("empresa_id")
  cdId                String @map("cd_id")
  limitePermMinutos   Int    @default(240) @map("limite_perm_minutos") // 4 horas padrão
  alertaPermAtivo     Boolean @default(true) @map("alerta_perm_ativo")
  prioridadeAgendado  Int    @default(10) @map("prioridade_agendado")
  prioridadeDescarga  Int    @default(5) @map("prioridade_descarga")
  prioridadeCarga     Int    @default(3) @map("prioridade_carga")
  prioridadePadrao    Int    @default(1) @map("prioridade_padrao")

  @@unique([empresaId, cdId])
  @@map("config_patio")
}
```

### API Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | /api/patio/veiculos | Lista veículos no pátio (painel tempo real) |
| POST | /api/patio/veiculos/entrada | Registra entrada de veículo |
| PUT | /api/patio/veiculos/:id/saida | Registra saída |
| GET | /api/patio/fila | Exibe fila de espera ordenada |
| PUT | /api/patio/fila/:id/prioridade | Altera prioridade na fila |
| POST | /api/patio/chamada | Emite chamada à doca |
| PUT | /api/patio/chamada/:id/atender | Confirma atendimento da chamada |
| PUT | /api/patio/chamada/:id/cancelar | Cancela chamada |
| GET | /api/patio/sugestao-chamada/:docaId | Sugere próximo veículo para doca |
| GET | /api/patio/config | Retorna configuração do pátio |
| PUT | /api/patio/config | Atualiza configuração |
| GET | /api/patio/relatorio/permanencia | Relatório de permanência |
| GET | /api/patio/relatorio/fila | Relatório de fila de espera |
| GET | /api/patio/relatorio/ocupacao | Relatório de ocupação |
| GET | /api/patio/relatorio/exportar | Exporta relatório CSV |

### Lógica de Negócio

1. **Entrada**: Valida placa (regex), verifica se não há duplicata (placa já no pátio com status != LIBERADO). Insere na fila com prioridade baseada em ConfigPatio (agendado > descarga > carga > padrão).
2. **Fila**: Ordenação por prioridade DESC, posição ASC. Ao alterar prioridade, reordena.
3. **Chamada**: Ao emitir chamada, remove veículo da fila, atualiza status para NA_DOCA, registra ChamadaDoca. Envia SSE.
4. **Saída**: Calcula `tempoPermMinutos = diff(saidaEm, entradaEm)`. Atualiza status LIBERADO.
5. **Alerta Permanência (Worker)**: Job periódico (a cada 5 min) verifica veículos com status AGUARDANDO/NA_DOCA cujo tempo excede limitePermMinutos. Gera notificação.
6. **Validação Placa**: Regex `^[A-Z]{3}[0-9]{4}$` (antigo) ou `^[A-Z]{3}[0-9][A-Z][0-9]{2}$` (Mercosul).

---

## Módulo 5: Multi-CD com Transferências

### Modelo de Dados

```prisma
model SolicitacaoTransferencia {
  id                  String    @id @default(uuid())
  empresaId           String    @map("empresa_id")
  numero              String    @db.VarChar(20) // TRF-YYYY-NNNNNN
  cdOrigemId          String    @map("cd_origem_id")
  cdDestinoId         String    @map("cd_destino_id")
  motivo              String    @db.VarChar(200)
  prioridade          String    @db.VarChar(10) @default("NORMAL") // NORMAL, URGENTE
  dataPrevistaEnvio   DateTime? @map("data_prevista_envio")
  status              String    @db.VarChar(20) @default("PENDENTE") // PENDENTE, APROVADA, EM_SEPARACAO, EXPEDIDA, EM_TRANSITO, RECEBIDA, CANCELADA
  criadoPorId         String    @map("criado_por_id")
  aprovadoPorId       String?   @map("aprovado_por_id")
  aprovadoEm          DateTime? @map("aprovado_em")
  criadoEm            DateTime  @default(now()) @map("criado_em")
  atualizadoEm        DateTime  @updatedAt @map("atualizado_em")

  itens               ItemSolicitacaoTransferencia[]
  documentoSaida      DocumentoSaidaTransferencia?

  @@unique([empresaId, numero])
  @@index([empresaId, status])
  @@map("solicitacao_transferencia")
}

model ItemSolicitacaoTransferencia {
  id                       String   @id @default(uuid())
  solicitacaoTransferenciaId String  @map("solicitacao_transferencia_id")
  solicitacaoTransferencia SolicitacaoTransferencia @relation(fields: [solicitacaoTransferenciaId], references: [id], onDelete: Cascade)
  produtoId                String   @map("produto_id")
  quantidadeSolicitada     Decimal  @db.Decimal(12, 4) @map("quantidade_solicitada")
  quantidadeExpedida       Decimal? @db.Decimal(12, 4) @map("quantidade_expedida")
  quantidadeRecebida       Decimal? @db.Decimal(12, 4) @map("quantidade_recebida")

  @@map("item_solicitacao_transferencia")
}

model DocumentoSaidaTransferencia {
  id                       String    @id @default(uuid())
  empresaId                String    @map("empresa_id")
  solicitacaoTransferenciaId String  @unique @map("solicitacao_transferencia_id")
  solicitacaoTransferencia SolicitacaoTransferencia @relation(fields: [solicitacaoTransferenciaId], references: [id])
  numero                   String    @db.VarChar(20) // DST-YYYY-NNNNNN
  veiculoPlaca             String?   @db.VarChar(10) @map("veiculo_placa")
  motoristaId              String?   @map("motorista_id")
  dataSaida                DateTime  @map("data_saida")
  previsaoChegada          DateTime? @map("previsao_chegada")
  criadoPorId              String    @map("criado_por_id")
  criadoEm                 DateTime  @default(now()) @map("criado_em")

  @@unique([empresaId, numero])
  @@map("documento_saida_transferencia")
}

model MercadoriaTransito {
  id                       String    @id @default(uuid())
  empresaId                String    @map("empresa_id")
  solicitacaoTransferenciaId String  @map("solicitacao_transferencia_id")
  produtoId                String    @map("produto_id")
  quantidade               Decimal   @db.Decimal(12, 4)
  cdOrigemId               String    @map("cd_origem_id")
  cdDestinoId              String    @map("cd_destino_id")
  dataSaida                DateTime  @map("data_saida")
  previsaoChegada          DateTime? @map("previsao_chegada")
  status                   String    @db.VarChar(20) @default("EM_TRANSITO") // EM_TRANSITO, RECEBIDA
  recebidoEm               DateTime? @map("recebido_em")
  criadoEm                 DateTime  @default(now()) @map("criado_em")

  @@index([empresaId, status])
  @@map("mercadoria_transito")
}
```

### API Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | /api/multi-cd/solicitacoes | Lista solicitações de transferência |
| POST | /api/multi-cd/solicitacoes | Cria solicitação |
| GET | /api/multi-cd/solicitacoes/:id | Detalhes da solicitação |
| PUT | /api/multi-cd/solicitacoes/:id/aprovar | Aprova solicitação |
| PUT | /api/multi-cd/solicitacoes/:id/cancelar | Cancela solicitação |
| POST | /api/multi-cd/solicitacoes/:id/expedir | Registra expedição (gera doc saída + baixa estoque + cria trânsito) |
| POST | /api/multi-cd/solicitacoes/:id/receber | Registra recebimento no CD destino |
| GET | /api/multi-cd/transito | Lista mercadorias em trânsito |
| GET | /api/multi-cd/painel | Painel consolidado de transferências |
| GET | /api/multi-cd/painel/exportar | Exporta dados CSV |

### Lógica de Negócio

1. **Criação**: Valida CDs pertencem à empresa. Valida saldo disponível (Estoque.quantidade - reservado) no CD origem para cada item. Gera número TRF-YYYY-NNNNNN.
2. **Aprovação**: Marca como APROVADA. Registra aprovador e data.
3. **Expedição** (dentro de `$transaction`):
   - Gera OS de separação no CD origem (fluxo existente)
   - Cria DocumentoSaidaTransferencia
   - Baixa saldo no Estoque do CD origem por item
   - Cria MercadoriaTransito por item com status EM_TRANSITO
   - Atualiza solicitação para EM_TRANSITO
4. **Recebimento** (dentro de `$transaction`):
   - Vincula ao DocumentoSaidaTransferencia
   - Conferência quantitativa (compara expedido × recebido)
   - Credita saldo no Estoque do CD destino
   - Baixa MercadoriaTransito (status RECEBIDA)
   - Atualiza solicitação para RECEBIDA
   - Registra divergências se houver
5. **Alerta Trânsito (Worker)**: Job periódico verifica MercadoriaTransito com dataSaida + 48h < agora. Gera alerta.

---

## Error Handling

- Todas as operações compostas (faturamento, expedição, recebimento de transferência) utilizam `$transaction` — falha parcial reverte tudo
- APIs retornam HTTP 422 com detalhamento Zod para dados inválidos
- APIs retornam HTTP 403 para operações cross-tenant
- APIs retornam HTTP 409 para conflitos de negócio (contrato duplicado, veículo já no pátio, saldo insuficiente)
- Workers registram falhas no log e geram alerta ao administrador
- Mensagens de erro ao usuário não expõem detalhes de implementação

## Testing Strategy

- **Testes unitários**: Fórmulas de cálculo de faturamento, divisão de onda por zona, cálculo de produtividade, validação de placa, validação de saldo
- **Testes de integração**: Fluxo completo de faturamento (contrato → medição → fatura), fluxo de transferência (solicitação → expedição → recebimento), fluxo de picking por zona (onda → divisão → consolidação)
- **Testes manuais**: Drag-and-drop na fila de pátio, painel tempo real, notificações SSE

## Correctness Properties

### Property 1: Invariante de Saldo em Transferência

Para toda transferência RECEBIDA, a soma (baixa no CD origem + crédito no CD destino) deve preservar a quantidade total de estoque do sistema.

**Validates: Requirements 13.3, 14.3**

### Property 2: Invariante de Faturamento

O valor total da fatura deve ser igual à soma dos subtotais de todos os ItemFatura vinculados.

**Validates: Requirements 3.2, 3.3**

### Property 3: Invariante de Zona

Cada endereço pertence a no máximo uma ZonaPicking ativa — não pode haver sobreposição.

**Validates: Requirements 4.3**

### Property 4: Invariante de Fila

A fila de espera do pátio mantém ordenação consistente (prioridade DESC, posição ASC) e cada veículo aparece no máximo uma vez.

**Validates: Requirements 10.1, 10.2**

### Property 5: Idempotência de Medição

Executar a medição de ocupação duas vezes para o mesmo dia/contrato deve produzir o mesmo resultado (ou atualizar sem duplicar).

**Validates: Requirements 2.2**

### Property 6: Round-trip de Transferência

Para cada item: quantidade_solicitada >= quantidade_expedida >= quantidade_recebida.

**Validates: Requirements 13.2, 14.2**

---

## Decisões Técnicas Transversais

### Auditoria

Todos os módulos utilizam o mesmo padrão existente:
```typescript
await tx.logMovimentoWms.create({
  data: { empresaId, entidade: 'CONTRATO_ARMAZENAGEM', entidadeId: contrato.id, acao: 'CRIAR', usuarioId, dadosNovos: JSON.stringify(contrato) }
})
```

### Validação de Entrada

Schemas Zod para todas as rotas:
```typescript
const criarContratoSchema = z.object({
  clienteId: z.string().uuid(),
  dataInicio: z.string().datetime(),
  dataFim: z.string().datetime(),
  periodicidade: z.enum(['SEMANAL', 'QUINZENAL', 'MENSAL']),
  tarifas: z.array(z.object({
    tipo: z.enum(['PALLET_DIA', 'METRO_CUBICO', 'MOVIMENTACAO_ENTRADA', 'MOVIMENTACAO_SAIDA', 'PERMANENCIA', 'PICKING_UNITARIO']),
    valorUnitario: z.number().positive(),
    carenciaDias: z.number().int().min(0).optional(),
  })).min(1),
  observacao: z.string().optional(),
})
```

### Multi-Tenancy

Middleware `tenant-context` existente garante empresaId em todas as queries:
```typescript
const empresaId = request.empresaId // extraído do JWT pelo middleware
```

### Transações

Operações compostas usam `prisma.$transaction()`:
```typescript
await prisma.$transaction(async (tx) => {
  // 1. Baixa estoque CD origem
  // 2. Cria MercadoriaTransito
  // 3. Cria DocumentoSaidaTransferencia
  // 4. Atualiza status solicitação
  // 5. Registra AuditLog
})
```

### Workers (Jobs Periódicos)

| Worker | Frequência | Módulo | Função |
|--------|-----------|--------|--------|
| medicaoOcupacaoWorker | 1x/dia (configurável) | Faturamento | Medição de ocupação por cliente |
| geracaoFaturaWorker | conforme periodicidade contrato | Faturamento | Geração automática de faturas |
| alertaPermWorker | 5 min | Pátio | Alerta permanência excessiva |
| alertaTransitoWorker | 1h | Multi-CD | Alerta trânsito > 48h |
| lmsAlertaWorker | 5 min | LMS | Alerta tarefas > 3x meta |

---

## Estrutura de Diretórios (Backend)

```
src/modules/
├── faturamento/
│   ├── faturamento.routes.ts
│   ├── faturamento.service.ts
│   ├── faturamento.worker.ts       (medição + geração faturas)
│   ├── faturamento.schemas.ts
│   └── faturamento.types.ts
├── picking-zona/
│   ├── picking-zona.routes.ts
│   ├── picking-zona.service.ts
│   ├── picking-zona.schemas.ts
│   └── picking-zona.types.ts
├── lms/
│   ├── lms.routes.ts
│   ├── lms.service.ts
│   ├── lms.worker.ts              (alerta tarefas lentas)
│   ├── lms.schemas.ts
│   └── lms.types.ts
├── patio/
│   ├── patio.routes.ts
│   ├── patio.service.ts
│   ├── patio.worker.ts            (alerta permanência)
│   ├── patio.schemas.ts
│   └── patio.types.ts
├── multi-cd/
│   ├── multi-cd.routes.ts
│   ├── multi-cd.service.ts
│   ├── multi-cd.worker.ts         (alerta trânsito)
│   ├── multi-cd.schemas.ts
│   └── multi-cd.types.ts
```

## Estrutura de Diretórios (Frontend)

```
app/wms/
├── faturamento/
│   ├── page.tsx                  (dashboard faturamento)
│   ├── contratos/page.tsx        (listagem contratos)
│   ├── contratos/novo/page.tsx   (criar contrato)
│   ├── contratos/[id]/page.tsx   (detalhes contrato)
│   ├── faturas/page.tsx          (listagem faturas)
│   ├── faturas/[id]/page.tsx     (detalhes fatura)
│   └── relatorios/page.tsx       (relatórios)
├── picking-zona/
│   ├── page.tsx                  (painel de zonas)
│   ├── zonas/page.tsx            (configuração zonas)
│   ├── separadores/page.tsx      (atribuição separadores)
│   ├── sub-ondas/page.tsx        (acompanhamento sub-ondas)
│   └── consolidacao/page.tsx     (pontos consolidação)
├── lms/
│   ├── page.tsx                  (dashboard produtividade)
│   ├── metas/page.tsx            (configuração metas)
│   ├── ranking/page.tsx          (ranking funcionários)
│   ├── funcionario/[id]/page.tsx (relatório individual)
│   └── operacao/[tipo]/page.tsx  (relatório por operação)
├── patio/
│   ├── page.tsx                  (painel pátio tempo real)
│   ├── fila/page.tsx             (fila de espera)
│   ├── chamada/page.tsx          (chamada à doca)
│   ├── config/page.tsx           (configurações)
│   └── relatorios/page.tsx       (relatórios)
├── multi-cd/
│   ├── page.tsx                  (painel transferências)
│   ├── solicitar/page.tsx        (criar solicitação)
│   ├── [id]/page.tsx             (detalhes solicitação + timeline)
│   ├── transito/page.tsx         (mercadorias em trânsito)
│   └── receber/page.tsx          (recebimento no destino)
```
