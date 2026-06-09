# Design Document

## Visão Geral da Arquitetura

A Fase 1 de profissionalização do WMS adiciona 5 módulos ao sistema existente seguindo a mesma arquitetura: backend Fastify com Prisma/PostgreSQL, frontend Next.js 15 com Mantine v7 e TanStack Query, mobile React Native (Expo). Cada módulo é implementado como um conjunto de routes/services/repositories no backend e páginas/componentes no frontend, reutilizando os padrões já estabelecidos (middleware de auth JWT, tenant-context, auditoria via AuditLog).

---

## Módulo 1: Cross-Docking

### Modelo de Dados

```prisma
model CrossDockItem {
  id               String    @id @default(uuid())
  empresaId        String    @map("empresa_id")
  notaEntradaId    String    @map("nota_entrada_id")
  itemNotaEntradaId String   @map("item_nota_entrada_id")
  pedidoVendaId    String    @map("pedido_venda_id")
  produtoId        String    @map("produto_id")
  quantidade       Decimal   @db.Decimal(12, 4)
  tipo             String    @db.VarChar(20) // TRANSITO, OPORTUNISTICO
  status           String    @default("IDENTIFICADO") @db.VarChar(20) // IDENTIFICADO, EM_TRANSITO, EM_STAGING, EXPEDIDO, CANCELADO
  stagingEnderecoId String?  @map("staging_endereco_id")
  docaSaidaId      String?   @map("doca_saida_id")
  ordemServicoId   String?   @map("ordem_servico_id")
  justificativa    String?   @db.Text // para oportunístico
  criadoPorId      String    @map("criado_por_id")
  criadoEm         DateTime  @default(now()) @map("criado_em")
  atualizadoEm     DateTime  @updatedAt @map("atualizado_em")
  expedidoEm       DateTime? @map("expedido_em")

  @@index([empresaId, status])
  @@index([pedidoVendaId])
  @@index([notaEntradaId])
  @@map("cross_dock_item")
}

model StagingArea {
  id           String @id @default(uuid())
  empresaId    String @map("empresa_id")
  enderecoId   String @map("endereco_id")
  docaId       String @map("doca_id") // doca de saída próxima
  nome         String @db.VarChar(50)
  capacidade   Int    @default(100) // percentual máximo de ocupação
  ativo        Boolean @default(true)

  @@unique([empresaId, enderecoId])
  @@map("staging_area")
}
```

### API Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | /api/cross-dock/identificar | Identifica itens elegíveis em uma nota de entrada |
| POST | /api/cross-dock/confirmar | Confirma item(s) como cross-dock (trânsito ou oportunístico) |
| GET | /api/cross-dock | Lista itens cross-dock com filtros |
| GET | /api/cross-dock/:id | Detalhes de um item cross-dock |
| PUT | /api/cross-dock/:id/cancelar | Cancela item cross-dock (retorna ao fluxo normal) |
| GET | /api/cross-dock/staging-areas | Lista staging areas |
| POST | /api/cross-dock/staging-areas | Cria staging area |
| PUT | /api/cross-dock/staging-areas/:id | Atualiza staging area |

### Lógica de Negócio

1. **Identificação automática**: Ao conferir nota de entrada, o service busca PedidoVenda com status PENDENTE/SEPARANDO que tenham itens com o mesmo produtoId. Match por produto + quantidade disponível.
2. **Roteamento**: Usa a relação StagingArea → Doca para determinar destino. Se doca de saída do pedido é conhecida (via MapaCarregamento ou OndaSeparacao), busca staging_area vinculada a essa doca.
3. **Priorização**: Ao gerar onda de separação, pedidos com CrossDockItem em status EM_STAGING recebem campo `prioridadeCrossDock` somado à prioridade base.

### Fluxo

```
NF-e Conferida → Motor identifica match com pedidos pendentes
  → Operador confirma (automático para trânsito, manual para oportunístico)
    → Gera OS tipo CROSS_DOCK (doca entrada → staging)
      → Operador executa movimentação
        → Item fica em staging
          → Onda de separação coleta → Expede
```

---

## Módulo 2: Logística Reversa

### Modelo de Dados

```prisma
model AutorizacaoRetorno {
  id             String    @id @default(uuid())
  empresaId      String    @map("empresa_id")
  numero         String    @db.VarChar(20) // RA-2025-000001
  clienteId      String    @map("cliente_id")
  nfeOrigemId    String    @map("nfe_origem_id") // NF-e de saída original
  motivo         String    @db.VarChar(100) // seleção de lista configurável
  observacao     String?   @db.Text
  dataLimite     DateTime? @map("data_limite")
  status         String    @default("ABERTA") @db.VarChar(20) // ABERTA, RECEBIDA, INSPECIONADA, CONCLUIDA, CANCELADA
  criadoPorId    String    @map("criado_por_id")
  criadoEm       DateTime  @default(now()) @map("criado_em")
  atualizadoEm   DateTime  @updatedAt @map("atualizado_em")
  recebidoEm     DateTime? @map("recebido_em")
  concluidoEm    DateTime? @map("concluido_em")

  itens          ItemAutorizacaoRetorno[]

  @@unique([empresaId, numero])
  @@index([empresaId, status])
  @@index([clienteId])
  @@map("autorizacao_retorno")
}

model ItemAutorizacaoRetorno {
  id                   String   @id @default(uuid())
  autorizacaoRetornoId String   @map("autorizacao_retorno_id")
  autorizacaoRetorno   AutorizacaoRetorno @relation(fields: [autorizacaoRetornoId], references: [id], onDelete: Cascade)
  produtoId            String   @map("produto_id")
  quantidade           Decimal  @db.Decimal(12, 4)
  quantidadeRecebida   Decimal? @db.Decimal(12, 4) @map("quantidade_recebida")
  condicao             String?  @db.VarChar(20) // PERFEITO, AVARIADO, INCOMPLETO
  disposicao           String?  @db.VarChar(30) // REESTOQUE, AVARIA, DESCARTE, RETORNO_FORNECEDOR
  parecerInspecao      String?  @db.Text @map("parecer_inspecao")
  fotos                String[] @default([]) // URLs das fotos
  inspecionadoPorId    String?  @map("inspecionado_por_id")
  inspecionadoEm       DateTime? @map("inspecionado_em")

  @@map("item_autorizacao_retorno")
}
```

### API Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | /api/logistica-reversa/ra | Cria autorização de retorno |
| GET | /api/logistica-reversa/ra | Lista RAs com filtros |
| GET | /api/logistica-reversa/ra/:id | Detalhes da RA |
| PUT | /api/logistica-reversa/ra/:id/cancelar | Cancela RA |
| POST | /api/logistica-reversa/ra/:id/receber | Registra recebimento da devolução |
| POST | /api/logistica-reversa/ra/:id/inspecionar | Registra inspeção de itens |
| POST | /api/logistica-reversa/ra/:id/dispor | Define disposição dos itens |
| GET | /api/logistica-reversa/motivos | Lista motivos configuráveis |
| POST | /api/logistica-reversa/motivos | Cria motivo |

### Lógica de Negócio

1. **Criação de RA**: Valida NF-e original (deve ser de saída, mesma empresa), valida quantidades (sum dos itens RA ≤ NF-e), gera número sequencial.
2. **Recebimento**: Vincula à RA, registra hora, cria OS de inspeção por item. Valida quantidades recebidas vs autorizadas.
3. **Inspeção**: Conferente avalia cada item (condição + fotos + parecer). Quando todos inspecionados → RA status INSPECIONADA.
4. **Disposição**: Para cada item, executa ação conforme tipo:
   - REESTOQUE: Chama endereçamento inteligente existente, credita saldo
   - AVARIA: Move para endereço de avaria, credita saldo avaria
   - DESCARTE: Baixa fiscal, registra perda
   - RETORNO_FORNECEDOR: Gera pendência para compras

### Fluxo

```
Atendente cria RA (vinculada à NF-e de saída)
  → Mercadoria chega → Conferente registra recebimento
    → OS de inspeção por item → Conferente inspeciona (condição + fotos)
      → RA status INSPECIONADA → Gestor define disposição por item
        → Sistema executa ação (reestoque/avaria/descarte/retorno)
          → RA CONCLUIDA → Nota de crédito (se aplicável)
```

---

## Módulo 3: KPI/SLA com Alertas

### Modelo de Dados

```prisma
model RegraKpi {
  id               String   @id @default(uuid())
  empresaId        String   @map("empresa_id")
  nome             String   @db.VarChar(100)
  descricao        String?  @db.Text
  entidade         String   @db.VarChar(30) // PEDIDO, CONFERENCIA, RECEBIMENTO, OCUPACAO, SEPARACAO
  condicao         String   @db.VarChar(30) // TEMPO_EXCEDIDO, PERCENTUAL_ACIMA, PERCENTUAL_ABAIXO, QUANTIDADE_ACIMA, QUANTIDADE_ABAIXO
  threshold        Decimal  @db.Decimal(12, 4)
  unidade          String   @db.VarChar(20) // MINUTOS, PERCENTUAL, UNIDADES
  janelaMinutos    Int?     @map("janela_minutos") // janela de avaliação
  cooldownMinutos  Int      @default(30) @map("cooldown_minutos")
  severidade       String   @default("WARNING") @db.VarChar(20) // INFO, WARNING, CRITICAL
  acoes            String[] @default([]) // NOTIFICACAO_APP, EMAIL, WEBHOOK, ESCALAR_GESTOR
  destinatarios    String[] @default([]) // emails ou userIds
  ativo            Boolean  @default(true)
  criadoPorId      String   @map("criado_por_id")
  criadoEm         DateTime @default(now()) @map("criado_em")
  atualizadoEm     DateTime @updatedAt @map("atualizado_em")

  alertas          AlertaKpi[]
  historico        HistoricoRegraKpi[]

  @@index([empresaId, ativo])
  @@map("regra_kpi")
}

model AlertaKpi {
  id           String    @id @default(uuid())
  empresaId    String    @map("empresa_id")
  regraKpiId   String    @map("regra_kpi_id")
  regraKpi     RegraKpi  @relation(fields: [regraKpiId], references: [id])
  severidade   String    @db.VarChar(20) // INFO, WARNING, CRITICAL
  valorAtual   Decimal   @db.Decimal(12, 4) @map("valor_atual")
  threshold    Decimal   @db.Decimal(12, 4)
  entidadeId   String?   @map("entidade_id") // ID da entidade violada (pedidoId, etc)
  mensagem     String    @db.Text
  status       String    @default("ABERTO") @db.VarChar(20) // ABERTO, RESOLVIDO, RECONHECIDO
  criadoEm     DateTime  @default(now()) @map("criado_em")
  resolvidoEm  DateTime? @map("resolvido_em")

  @@index([empresaId, status])
  @@index([regraKpiId])
  @@map("alerta_kpi")
}

model HistoricoRegraKpi {
  id          String   @id @default(uuid())
  regraKpiId  String   @map("regra_kpi_id")
  regraKpi    RegraKpi @relation(fields: [regraKpiId], references: [id])
  usuarioId   String   @map("usuario_id")
  campo       String   @db.VarChar(50)
  valorAnterior String? @db.Text @map("valor_anterior")
  valorNovo   String?  @db.Text @map("valor_novo")
  criadoEm    DateTime @default(now()) @map("criado_em")

  @@map("historico_regra_kpi")
}

model SnapshotKpi {
  id        String   @id @default(uuid())
  empresaId String   @map("empresa_id")
  indicador String   @db.VarChar(50) // nome do KPI calculado
  valor     Decimal  @db.Decimal(12, 4)
  criadoEm  DateTime @default(now()) @map("criado_em")

  @@index([empresaId, indicador, criadoEm])
  @@map("snapshot_kpi")
}
```

### API Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | /api/kpi/regras | Lista regras de KPI |
| POST | /api/kpi/regras | Cria regra |
| PUT | /api/kpi/regras/:id | Atualiza regra |
| DELETE | /api/kpi/regras/:id | Desativa regra (soft delete) |
| GET | /api/kpi/alertas | Lista alertas com filtros |
| PUT | /api/kpi/alertas/:id/reconhecer | Marca alerta como reconhecido |
| GET | /api/kpi/dashboard | Retorna cards KPI em tempo real |
| GET | /api/kpi/historico/:indicador | Histórico de valores de um KPI |
| GET | /api/kpi/exportar | Exporta dados KPI em CSV |

### Motor de Avaliação (Background Worker)

O motor de KPI é implementado como um job recorrente (setInterval no processo Fastify ou worker separado via BullMQ):

1. A cada 60 segundos, busca regras ativas por empresa
2. Para cada regra, executa query específica conforme entidade + condição:
   - PEDIDO + TEMPO_EXCEDIDO: Pedidos pendentes há mais de X minutos sem separação
   - CONFERENCIA + PERCENTUAL_ACIMA: % divergência na conferência
   - RECEBIMENTO + TEMPO_EXCEDIDO: Agendamentos com status NA_DOCA há mais de X min
   - OCUPACAO + PERCENTUAL_ACIMA: % de ocupação dos endereços
   - SEPARACAO + TEMPO_EXCEDIDO: Ondas abertas há mais de X minutos
3. Se violação detectada e cooldown respeitado → gera alerta + executa ações
4. Salva snapshot a cada avaliação para histórico de tendências

### Notificações

- **SSE (Server-Sent Events)**: Já existe módulo websocket no server.ts. Alertas NOTIFICACAO_APP são enviados via SSE para clientes conectados.
- **E-mail**: Integração com serviço de e-mail (nodemailer ou similar). Configura-se SMTP nos parâmetros da empresa.

---

## Módulo 4: Dock Scheduling Avançado

### Modelo de Dados

Reutiliza o model `AgendaWms` existente com extensões:

```prisma
// Extensão do AgendaWms existente (novos campos)
// horaChegadaReal    DateTime? @map("hora_chegada_real")
// tempoPermDocaMin   Int?      @map("tempo_perm_doca_min")
// prioridadeExtra    Int       @default(0) @map("prioridade_extra")

model BloqueioSlotDoca {
  id         String   @id @default(uuid())
  empresaId  String   @map("empresa_id")
  docaId     String   @map("doca_id")
  dataInicio DateTime @map("data_inicio")
  dataFim    DateTime @map("data_fim")
  motivo     String   @db.VarChar(200)
  criadoPorId String  @map("criado_por_id")
  criadoEm   DateTime @default(now()) @map("criado_em")

  @@index([empresaId, docaId, dataInicio, dataFim])
  @@map("bloqueio_slot_doca")
}

model ConfigDoca {
  id                String @id @default(uuid())
  empresaId         String @map("empresa_id")
  horaAberturaOp    String @db.VarChar(5) @map("hora_abertura_op") // "06:00"
  horaFechamentoOp  String @db.VarChar(5) @map("hora_fechamento_op") // "22:00"
  bufferMinutos     Int    @default(15) @map("buffer_minutos") // tempo entre agendamentos
  toleranciaAtraso  Int    @default(30) @map("tolerancia_atraso") // minutos p/ marcar como atrasado

  @@unique([empresaId])
  @@map("config_doca")
}
```

### API Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | /api/agenda-doca/timeline | Retorna dados para visualização timeline (doca x horário) |
| POST | /api/agenda-doca/agendar | Cria agendamento com validação de conflito |
| PUT | /api/agenda-doca/:id/mover | Move agendamento (drag-and-drop) com validação |
| PUT | /api/agenda-doca/:id/chegada | Registra chegada real |
| GET | /api/agenda-doca/bloqueios | Lista bloqueios |
| POST | /api/agenda-doca/bloqueios | Cria bloqueio de slot |
| DELETE | /api/agenda-doca/bloqueios/:id | Remove bloqueio |
| GET | /api/agenda-doca/config | Retorna configuração de docas |
| PUT | /api/agenda-doca/config | Atualiza configuração |
| GET | /api/agenda-doca/estatisticas | Métricas de aderência |

### Lógica de Conflitos

```typescript
async function validarConflito(empresaId, docaId, dataInicio, dataFim, excluirId?) {
  // 1. Busca agendamentos na mesma doca que sobreponham o período
  // 2. Considera buffer configurado (ConfigDoca.bufferMinutos)
  // 3. Verifica bloqueios de slot
  // 4. Verifica horário operacional
  // Retorna: { conflito: boolean, agendamentoConflitante?: AgendaWms }
}
```

### Frontend - Timeline

Componente React usando biblioteca de timeline (react-calendar-timeline ou custom com Mantine):
- Eixo Y: docas do CD
- Eixo X: horas do dia (6h-22h)
- Blocos coloridos por status
- Drag-and-drop nativo
- Tooltip com detalhes ao hover
- Clique em slot vazio → modal de criação

---

## Módulo 5: Impressão de Etiquetas ZPL

### Modelo de Dados

```prisma
model TemplateEtiqueta {
  id          String   @id @default(uuid())
  empresaId   String   @map("empresa_id")
  nome        String   @db.VarChar(100)
  tipo        String   @db.VarChar(20) // PRODUTO, ENDERECO, PALETE, EXPEDICAO
  codigoZpl   String   @db.Text @map("codigo_zpl")
  larguraMm   Int      @map("largura_mm")
  alturaMm    Int      @map("altura_mm")
  versao      Int      @default(1)
  ativo       Boolean  @default(true)
  criadoPorId String   @map("criado_por_id")
  criadoEm    DateTime @default(now()) @map("criado_em")
  atualizadoEm DateTime @updatedAt @map("atualizado_em")

  versoes     VersaoTemplateEtiqueta[]

  @@index([empresaId, tipo])
  @@map("template_etiqueta")
}

model VersaoTemplateEtiqueta {
  id                 String   @id @default(uuid())
  templateEtiquetaId String   @map("template_etiqueta_id")
  templateEtiqueta   TemplateEtiqueta @relation(fields: [templateEtiquetaId], references: [id])
  versao             Int
  codigoZpl          String   @db.Text @map("codigo_zpl")
  criadoPorId        String   @map("criado_por_id")
  criadoEm           DateTime @default(now()) @map("criado_em")

  @@unique([templateEtiquetaId, versao])
  @@map("versao_template_etiqueta")
}

model ImpressoraRede {
  id           String   @id @default(uuid())
  empresaId    String   @map("empresa_id")
  nome         String   @db.VarChar(100)
  modelo       String   @db.VarChar(20) // ZEBRA, ELGIN, GENERICA
  ip           String   @db.VarChar(45)
  porta        Int      @default(9100)
  localizacao  String?  @db.VarChar(100) // setor/zona do CD
  zonaId       String?  @map("zona_id")
  status       String   @default("OFFLINE") @db.VarChar(20) // ONLINE, OFFLINE, ERRO
  ultimoCheck  DateTime? @map("ultimo_check")
  ativo        Boolean  @default(true)
  criadoEm     DateTime @default(now()) @map("criado_em")
  atualizadoEm DateTime @updatedAt @map("atualizado_em")

  @@unique([empresaId, ip, porta])
  @@map("impressora_rede")
}

model FilaImpressao {
  id              String    @id @default(uuid())
  empresaId       String    @map("empresa_id")
  templateId      String    @map("template_id")
  impressoraId    String    @map("impressora_id")
  dadosVariaveis  Json      @map("dados_variaveis") // { campo1: "valor1", ... }
  quantidade      Int       @default(1)
  prioridade      String    @default("NORMAL") @db.VarChar(10) // URGENTE, NORMAL, BAIXA
  status          String    @default("PENDENTE") @db.VarChar(20) // PENDENTE, PROCESSANDO, SUCESSO, FALHA
  tentativas      Int       @default(0)
  erro            String?   @db.Text
  operacao        String?   @db.VarChar(30) // RECEBIMENTO, SEPARACAO, EXPEDICAO
  referenciaId    String?   @map("referencia_id") // notaEntradaId, ondaId, carregamentoId
  solicitadoPorId String    @map("solicitado_por_id")
  criadoEm        DateTime  @default(now()) @map("criado_em")
  processadoEm    DateTime? @map("processado_em")

  @@index([empresaId, status, prioridade])
  @@map("fila_impressao")
}
```

### API Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | /api/etiquetas-zpl/templates | Lista templates |
| POST | /api/etiquetas-zpl/templates | Cria template |
| PUT | /api/etiquetas-zpl/templates/:id | Atualiza template (gera versão) |
| GET | /api/etiquetas-zpl/templates/:id/versoes | Lista versões |
| PUT | /api/etiquetas-zpl/templates/:id/reverter/:versao | Reverte para versão |
| POST | /api/etiquetas-zpl/templates/:id/preview | Renderiza preview com dados de exemplo |
| GET | /api/etiquetas-zpl/impressoras | Lista impressoras |
| POST | /api/etiquetas-zpl/impressoras | Cadastra impressora |
| PUT | /api/etiquetas-zpl/impressoras/:id | Atualiza impressora |
| POST | /api/etiquetas-zpl/impressoras/:id/testar | Testa conexão |
| POST | /api/etiquetas-zpl/imprimir | Envia para fila de impressão |
| POST | /api/etiquetas-zpl/imprimir-lote | Impressão em lote |
| GET | /api/etiquetas-zpl/fila | Lista fila de impressão |
| DELETE | /api/etiquetas-zpl/fila/:id | Cancela item da fila |

### Lógica de Impressão

```typescript
// Processamento da fila (worker a cada 2 segundos)
async function processarFilaImpressao(empresaId: string) {
  // 1. Busca próximo item PENDENTE (ordenado por prioridade + criadoEm)
  // 2. Carrega template ZPL
  // 3. Substitui placeholders {{campo}} pelos dados variáveis
  // 4. Abre conexão TCP com impressora (timeout 10s)
  // 5. Envia ZPL via socket
  // 6. Marca como SUCESSO ou FALHA
  // 7. Se FALHA e tentativas < 3 → reenfileira
  // 8. Se FALHA definitiva → notifica operador
}
```

### Validação ZPL

```typescript
function validarZplBasico(zpl: string): { valido: boolean; erros: string[] } {
  // Verifica ^XA no início e ^XZ no final
  // Verifica balanceamento de comandos
  // Verifica placeholders com formato {{nome_campo}}
}
```

---

## Decisões Técnicas Transversais

### Auditoria

Todos os módulos utilizam o mesmo padrão de AuditLog existente:
```typescript
await prisma.logMovimentoWms.create({
  data: { empresaId, entidade: 'CROSS_DOCK', entidadeId: item.id, acao: 'CRIAR', ... }
})
```

### Validação de Entrada

Schemas Zod para todas as rotas:
```typescript
const criarRaSchema = z.object({
  nfeOrigemId: z.string().uuid(),
  clienteId: z.string().uuid(),
  motivo: z.string().min(3).max(100),
  itens: z.array(z.object({
    produtoId: z.string().uuid(),
    quantidade: z.number().positive(),
  })).min(1),
  dataLimite: z.string().datetime().optional(),
  observacao: z.string().optional(),
})
```

### Multi-Tenancy

Middleware `tenant-context` existente garante empresaId em todas as queries. Endpoints novos seguem o mesmo padrão:
```typescript
const empresaId = request.empresaId // extraído do JWT pelo middleware
```

### Transações

Operações compostas usam `prisma.$transaction()`:
```typescript
await prisma.$transaction(async (tx) => {
  // 1. Cria CrossDockItem
  // 2. Reserva saldo na staging
  // 3. Gera OrdemServicoWms
  // 4. Registra AuditLog
})
```

---

## Estrutura de Diretórios (Backend)

```
src/modules/
├── cross-dock/
│   ├── cross-dock.routes.ts
│   ├── cross-dock.service.ts
│   ├── cross-dock.schemas.ts
│   └── cross-dock.types.ts
├── logistica-reversa/
│   ├── logistica-reversa.routes.ts
│   ├── logistica-reversa.service.ts
│   ├── logistica-reversa.schemas.ts
│   └── logistica-reversa.types.ts
├── kpi/
│   ├── kpi.routes.ts
│   ├── kpi.service.ts
│   ├── kpi.worker.ts          (motor de avaliação)
│   ├── kpi.evaluators.ts     (queries por entidade)
│   ├── kpi.schemas.ts
│   └── kpi.types.ts
├── agenda-doca/
│   ├── agenda-doca.routes.ts
│   ├── agenda-doca.service.ts
│   ├── agenda-doca.schemas.ts
│   └── agenda-doca.types.ts
├── etiquetas-zpl/
│   ├── etiquetas-zpl.routes.ts
│   ├── etiquetas-zpl.service.ts
│   ├── etiquetas-zpl.worker.ts  (processador de fila)
│   ├── etiquetas-zpl.printer.ts (conexão TCP)
│   ├── etiquetas-zpl.schemas.ts
│   └── etiquetas-zpl.types.ts
```

## Estrutura de Diretórios (Frontend)

```
app/wms/
├── cross-dock/
│   ├── page.tsx              (painel cross-dock)
│   └── staging/page.tsx      (staging areas)
├── logistica-reversa/
│   ├── page.tsx              (listagem RAs)
│   ├── nova/page.tsx         (criar RA)
│   ├── [id]/page.tsx         (detalhes RA)
│   └── inspecao/page.tsx     (tela inspeção)
├── kpi/
│   ├── page.tsx              (dashboard KPI)
│   ├── regras/page.tsx       (configuração regras)
│   └── alertas/page.tsx      (painel alertas)
├── agenda-doca/
│   ├── page.tsx              (timeline)
│   ├── config/page.tsx       (configurações)
│   └── estatisticas/page.tsx (métricas)
├── etiquetas/
│   ├── page.tsx              (fila impressão)
│   ├── templates/page.tsx    (gerenciamento templates)
│   ├── impressoras/page.tsx  (gerenciamento impressoras)
│   └── designer/page.tsx     (editor de template)
```
