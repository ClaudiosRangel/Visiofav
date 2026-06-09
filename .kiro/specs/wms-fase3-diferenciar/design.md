# Design Document

## Overview

A Fase 3 de diferenciação do WMS adiciona 4 módulos ao sistema existente seguindo a mesma arquitetura das Fases 1 e 2: backend Fastify com Prisma/PostgreSQL, frontend Next.js 15 com Mantine v7 e TanStack Query, mobile React Native (Expo). Cada módulo é implementado como um conjunto de routes/services no backend e páginas/componentes no frontend, reutilizando os padrões já estabelecidos (middleware de auth JWT, tenant-context via empresaId, auditoria via LogMovimentoWms, validação Zod, transações Prisma.$transaction).

## Architecture

A arquitetura segue o padrão monolítico modular existente: cada módulo é um diretório em `src/modules/` com arquivos de routes, service, schemas e types. Workers são implementados como setInterval no processo Fastify principal. Frontend segue o padrão App Router do Next.js 15 com páginas em `app/wms/`.

## Components and Interfaces

Os 4 módulos interagem entre si e com módulos existentes:
- **Previsão de Demanda / Slotting** → lê dados de Estoque, MovimentacaoFaturavel e Endereços existentes para calcular demanda e sugerir realocações
- **Portal 3PL** → integra com ContratoArmazenagem, Estoque, OndaSeparacao e FaturaArmazenagem existentes
- **BI Avançado** → lê dados de todos os módulos para consolidar indicadores e custos operacionais
- **Wave Planning** → integra com OndaSeparacao, AgendaWms, Docas e Rotas existentes

## Data Models

---

## Módulo 1: Previsão de Demanda / Slotting

### Modelo de Dados

```prisma
model PrevisaoDemanda {
  id                  String   @id @default(uuid())
  empresaId           String   @map("empresa_id")
  produtoId           String   @map("produto_id")
  dataPrevisao        DateTime @map("data_previsao")
  quantidadePrevista  Decimal  @db.Decimal(12, 4) @map("quantidade_prevista")
  quantidadeReal      Decimal? @db.Decimal(12, 4) @map("quantidade_real")
  metodo              String   @db.VarChar(20) // MEDIA_MOVEL, SAZONAL
  horizonte           Int      // 7, 14, 30 (dias)
  confianca           Decimal  @db.Decimal(5, 2) // 0-100
  criadoEm            DateTime @default(now()) @map("criado_em")

  @@index([empresaId, produtoId, dataPrevisao])
  @@map("previsao_demanda")
}

model ClassificacaoAbc {
  id                    String   @id @default(uuid())
  empresaId             String   @map("empresa_id")
  produtoId             String   @map("produto_id")
  criterio              String   @db.VarChar(20) // FREQUENCIA, VALOR, VOLUME
  classificacao         String   @db.VarChar(1) // A, B, C
  valor                 Decimal  @db.Decimal(14, 4)
  percentualAcumulado   Decimal  @db.Decimal(5, 2) @map("percentual_acumulado")
  periodoInicio         DateTime @map("periodo_inicio")
  periodoFim            DateTime @map("periodo_fim")
  criadoEm              DateTime @default(now()) @map("criado_em")

  @@unique([empresaId, produtoId, criterio, periodoInicio])
  @@map("classificacao_abc")
}

model SugestaoSlotting {
  id                  String    @id @default(uuid())
  empresaId           String    @map("empresa_id")
  produtoId           String    @map("produto_id")
  enderecoAtualId     String?   @map("endereco_atual_id")
  enderecoSugeridoId  String    @map("endereco_sugerido_id")
  motivo              String    @db.VarChar(200)
  prioridade          String    @db.VarChar(10) // ALTA, MEDIA, BAIXA
  score               Decimal   @db.Decimal(8, 2)
  status              String    @db.VarChar(15) @default("PENDENTE") // PENDENTE, APLICADA, REJEITADA
  aplicadaEm          DateTime? @map("aplicada_em")
  aplicadaPorId       String?   @map("aplicada_por_id")
  criadoEm            DateTime  @default(now()) @map("criado_em")

  @@index([empresaId, status])
  @@map("sugestao_slotting")
}

model ConfigPrevisao {
  id                      String  @id @default(uuid())
  empresaId               String  @map("empresa_id")
  periodoHistoricoDias    Int     @default(90) @map("periodo_historico_dias")
  metodoPreferido         String  @db.VarChar(20) @default("MEDIA_MOVEL") @map("metodo_preferido")
  frequenciaAtualizacao   String  @db.VarChar(15) @default("DIARIA") @map("frequencia_atualizacao") // DIARIA, SEMANAL
  estoqueSegurancaDias    Int     @default(7) @map("estoque_seguranca_dias")
  ativo                   Boolean @default(true)

  @@unique([empresaId])
  @@map("config_previsao")
}
```

### API Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | /api/demanda/previsoes | Lista previsões com filtros (produto, período) |
| POST | /api/demanda/previsoes/gerar | Gera previsões para período/horizonte |
| GET | /api/demanda/previsoes/:produtoId | Previsão detalhada por produto |
| GET | /api/demanda/abc | Lista classificação ABC |
| POST | /api/demanda/abc/recalcular | Recalcula classificação ABC |
| GET | /api/demanda/slotting/sugestoes | Lista sugestões de slotting |
| POST | /api/demanda/slotting/gerar | Gera sugestões de slotting |
| PUT | /api/demanda/slotting/:id/aplicar | Aplica sugestão (move produto) |
| PUT | /api/demanda/slotting/:id/rejeitar | Rejeita sugestão |
| GET | /api/demanda/config | Retorna configuração |
| PUT | /api/demanda/config | Atualiza configuração |

### Lógica de Negócio

1. **Previsão por Média Móvel**: Calcula média de saídas dos últimos N dias (periodoHistoricoDias). Para horizonte H, projeta demanda diária × H dias. Confiança baseada no desvio padrão (menor desvio = maior confiança).
2. **Previsão Sazonal**: Compara período equivalente do ano anterior. Aplica fator de crescimento/retração. Requer mínimo de 365 dias de histórico.
3. **Classificação ABC**: Ordena produtos por critério (frequência de saída, valor movimentado, volume). A = top 20% (80% do total), B = próximos 30%, C = restantes 50%.
4. **Slotting**: Cruza classificação ABC com mapa de endereços. Produtos A → endereços próximos à doca/picking. Score = (classificação × peso) + (frequência × peso) - (distância atual × peso). Gera sugestão se score > threshold.
5. **Aplicação de Slotting** (dentro de `$transaction`): Move estoque do endereço atual para o sugerido. Atualiza saldo. Registra auditoria.
6. **Worker Previsão**: Job diário/semanal (conforme config) que recalcula previsões e atualiza classificação ABC.

---

## Módulo 2: Portal 3PL (Clientes)

### Modelo de Dados

```prisma
model PortalUsuario {
  id                  String    @id @default(uuid())
  empresaId           String    @map("empresa_id")
  clienteId           String    @map("cliente_id")
  nome                String    @db.VarChar(150)
  email               String    @db.VarChar(200)
  senhaHash           String    @map("senha_hash")
  status              String    @db.VarChar(10) @default("ATIVO") // ATIVO, INATIVO
  ultimoAcesso        DateTime? @map("ultimo_acesso")
  criadoEm            DateTime  @default(now()) @map("criado_em")
  atualizadoEm        DateTime  @updatedAt @map("atualizado_em")

  solicitacoes        SolicitacaoExpedicaoPortal[]
  notificacoes        NotificacaoPortal[]

  @@unique([empresaId, email])
  @@map("portal_usuario")
}

model SolicitacaoExpedicaoPortal {
  id                  String    @id @default(uuid())
  empresaId           String    @map("empresa_id")
  clienteId           String    @map("cliente_id")
  portalUsuarioId     String    @map("portal_usuario_id")
  portalUsuario       PortalUsuario @relation(fields: [portalUsuarioId], references: [id])
  numero              String    @db.VarChar(20) // SOL-YYYY-NNNNNN
  observacao          String?   @db.Text
  status              String    @db.VarChar(20) @default("PENDENTE") // PENDENTE, APROVADA, EM_SEPARACAO, EXPEDIDA, CANCELADA
  criadoEm            DateTime  @default(now()) @map("criado_em")
  atualizadoEm        DateTime  @updatedAt @map("atualizado_em")

  itens               ItemSolicitacaoExpedicaoPortal[]

  @@unique([empresaId, numero])
  @@map("solicitacao_expedicao_portal")
}

model ItemSolicitacaoExpedicaoPortal {
  id                  String   @id @default(uuid())
  solicitacaoId       String   @map("solicitacao_id")
  solicitacao         SolicitacaoExpedicaoPortal @relation(fields: [solicitacaoId], references: [id], onDelete: Cascade)
  produtoId           String   @map("produto_id")
  quantidade          Decimal  @db.Decimal(12, 4)
  quantidadeAtendida  Decimal? @db.Decimal(12, 4) @map("quantidade_atendida")

  @@map("item_solicitacao_expedicao_portal")
}

model NotificacaoPortal {
  id                  String   @id @default(uuid())
  empresaId           String   @map("empresa_id")
  clienteId           String   @map("cliente_id")
  portalUsuarioId     String?  @map("portal_usuario_id")
  portalUsuario       PortalUsuario? @relation(fields: [portalUsuarioId], references: [id])
  tipo                String   @db.VarChar(30) // FATURA_GERADA, EXPEDICAO_CONCLUIDA, ESTOQUE_MINIMO, CONTRATO_VENCENDO
  titulo              String   @db.VarChar(200)
  mensagem            String   @db.Text
  lida                Boolean  @default(false)
  enviadaEmail        Boolean  @default(false) @map("enviada_email")
  criadoEm            DateTime @default(now()) @map("criado_em")

  @@index([empresaId, clienteId, lida])
  @@map("notificacao_portal")
}
```

### API Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | /api/portal/auth/login | Login do portal (retorna JWT com scope portal) |
| POST | /api/portal/auth/recuperar-senha | Envio de email para reset |
| GET | /api/portal/perfil | Dados do usuário logado |
| PUT | /api/portal/perfil | Atualiza perfil/senha |
| GET | /api/portal/estoque | Consulta estoque do cliente |
| GET | /api/portal/estoque/exportar | Exporta posição de estoque CSV |
| GET | /api/portal/solicitacoes | Lista solicitações de expedição |
| POST | /api/portal/solicitacoes | Cria solicitação de expedição |
| GET | /api/portal/solicitacoes/:id | Detalhes da solicitação |
| PUT | /api/portal/solicitacoes/:id/cancelar | Cancela solicitação (se PENDENTE) |
| GET | /api/portal/faturas | Lista faturas do cliente |
| GET | /api/portal/faturas/:id | Detalhes da fatura |
| GET | /api/portal/notificacoes | Lista notificações |
| PUT | /api/portal/notificacoes/:id/lida | Marca como lida |
| PUT | /api/portal/notificacoes/ler-todas | Marca todas como lidas |
| GET | /api/portal/admin/usuarios | (Admin) Lista usuários do portal |
| POST | /api/portal/admin/usuarios | (Admin) Cria usuário do portal |
| PUT | /api/portal/admin/usuarios/:id | (Admin) Atualiza/inativa usuário |

### Lógica de Negócio

1. **Autenticação Separada**: JWT com scope `portal` e claims {empresaId, clienteId, portalUsuarioId}. Middleware diferenciado que valida scope e restringe acesso apenas aos dados do cliente.
2. **Solicitação de Expedição**: Cliente cria pedido com itens. Sistema valida saldo disponível por produto/cliente. Gera número SOL-YYYY-NNNNNN. Operador WMS aprova e converte em OndaSeparacao.
3. **Visibilidade**: Portal exibe apenas dados do clienteId do JWT. Estoque filtrado por proprietário. Faturas filtradas por contrato do cliente.
4. **Notificações**: Hooks nos módulos existentes geram NotificacaoPortal automaticamente: fatura gerada → FATURA_GERADA, expedição concluída → EXPEDICAO_CONCLUIDA, estoque abaixo do mínimo → ESTOQUE_MINIMO.
5. **Worker Notificações**: Job periódico verifica contratos com vencimento em 30 dias → CONTRATO_VENCENDO. Envia email se configurado.

---

## Módulo 3: BI Avançado (Business Intelligence)

### Modelo de Dados

```prisma
model CustoOperacao {
  id                    String   @id @default(uuid())
  empresaId             String   @map("empresa_id")
  data                  DateTime
  tipoOperacao          String   @db.VarChar(30) @map("tipo_operacao") // RECEBIMENTO, ENDERECAMENTO, SEPARACAO, EXPEDICAO, INVENTARIO
  custoMaoObra          Decimal  @db.Decimal(12, 2) @map("custo_mao_obra")
  custoEquipamento      Decimal  @db.Decimal(12, 2) @map("custo_equipamento")
  custoEspaco           Decimal  @db.Decimal(12, 2) @map("custo_espaco")
  custoTotal            Decimal  @db.Decimal(12, 2) @map("custo_total")
  quantidadeOperacoes   Int      @map("quantidade_operacoes")
  custoUnitario         Decimal  @db.Decimal(12, 4) @map("custo_unitario")
  criadoEm              DateTime @default(now()) @map("criado_em")

  @@unique([empresaId, data, tipoOperacao])
  @@map("custo_operacao")
}

model ConfigCusto {
  id                      String   @id @default(uuid())
  empresaId               String   @map("empresa_id")
  custoHoraOperador       Decimal  @db.Decimal(10, 2) @map("custo_hora_operador")
  custoHoraEquipamento    Decimal  @db.Decimal(10, 2) @map("custo_hora_equipamento")
  custoM2Mes              Decimal  @db.Decimal(10, 2) @map("custo_m2_mes")
  depreciacao             Decimal  @db.Decimal(5, 2) // percentual
  criadoEm                DateTime @default(now()) @map("criado_em")
  atualizadoEm            DateTime @updatedAt @map("atualizado_em")

  @@unique([empresaId])
  @@map("config_custo")
}

model SnapshotBI {
  id                  String   @id @default(uuid())
  empresaId           String   @map("empresa_id")
  data                DateTime
  indicador           String   @db.VarChar(30) // THROUGHPUT, ACURACIA, OCUPACAO, CUSTO_MEDIO, PRODUTIVIDADE_MEDIA
  valor               Decimal  @db.Decimal(14, 4)
  criadoEm            DateTime @default(now()) @map("criado_em")

  @@index([empresaId, indicador, data])
  @@map("snapshot_bi")
}

model AlertaCorrelacao {
  id                  String    @id @default(uuid())
  empresaId           String    @map("empresa_id")
  tipo                String    @db.VarChar(30) // CORRELACAO, ANOMALIA, TENDENCIA
  indicador1          String    @db.VarChar(30)
  valor1              Decimal   @db.Decimal(14, 4)
  indicador2          String?   @db.VarChar(30)
  valor2              Decimal?  @db.Decimal(14, 4)
  mensagem            String    @db.Text
  severidade          String    @db.VarChar(10) // ALTA, MEDIA, BAIXA
  status              String    @db.VarChar(15) @default("ABERTO") // ABERTO, RESOLVIDO
  criadoEm            DateTime  @default(now()) @map("criado_em")
  resolvidoEm         DateTime? @map("resolvido_em")

  @@index([empresaId, status])
  @@map("alerta_correlacao")
}
```

### API Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | /api/bi/dashboard | Dashboard consolidado (KPIs principais) |
| GET | /api/bi/throughput | Throughput por período |
| GET | /api/bi/acuracia | Acurácia de estoque por período |
| GET | /api/bi/ocupacao | Taxa de ocupação por período |
| GET | /api/bi/produtividade | Produtividade média por período |
| GET | /api/bi/custos | Custos operacionais por período/tipo |
| GET | /api/bi/custos/detalhado | Detalhamento de custos por operação |
| GET | /api/bi/comparativo | Comparativo período atual vs anterior |
| GET | /api/bi/alertas | Lista alertas de correlação |
| PUT | /api/bi/alertas/:id/resolver | Resolve alerta |
| GET | /api/bi/config | Retorna configuração de custos |
| PUT | /api/bi/config | Atualiza configuração de custos |
| GET | /api/bi/exportar | Exporta relatório BI completo (CSV/PDF) |

### Lógica de Negócio

1. **Snapshot Diário (Worker)**: Job diário que calcula e persiste indicadores: THROUGHPUT (total itens movimentados/dia), ACURACIA (inventários sem divergência / total), OCUPACAO (posições ocupadas / total posições), CUSTO_MEDIO (custoTotal / operações), PRODUTIVIDADE_MEDIA (média índice produtividade LMS).
2. **Custeio ABC**: custoMaoObra = horasTrabalhadas × custoHoraOperador. custoEquipamento = horasEquipamento × custoHoraEquipamento. custoEspaco = (m² utilizados / m² total) × custoM2Mes / diasMes. custoTotal = maoObra + equipamento + espaço. custoUnitario = custoTotal / quantidadeOperacoes.
3. **Correlação**: Compara variações de indicadores. Se throughput cai > 15% e produtividade cai > 10% no mesmo período → alerta CORRELACAO. Se ocupação > 90% e acurácia cai → alerta CORRELACAO.
4. **Anomalia**: Se indicador desvia > 2 desvios padrão da média dos últimos 30 dias → alerta ANOMALIA.
5. **Tendência**: Se indicador apresenta queda consistente por 5+ dias consecutivos → alerta TENDENCIA.

---

## Módulo 4: Wave Planning (Planejamento de Ondas)

### Modelo de Dados

```prisma
model RegraOnda {
  id                  String   @id @default(uuid())
  empresaId           String   @map("empresa_id")
  nome                String   @db.VarChar(100)
  prioridade          Int      // ordem de aplicação (menor = primeiro)
  tipo                String   @db.VarChar(30) // CORTE_HORARIO, AGRUPAMENTO_ROTA, CAPACIDADE_DOCA, PRIORIDADE_CLIENTE
  parametros          Json     // configuração específica por tipo
  ativo               Boolean  @default(true)
  criadoEm            DateTime @default(now()) @map("criado_em")

  @@index([empresaId, ativo])
  @@map("regra_onda")
}

model PlanejamentoOnda {
  id                  String    @id @default(uuid())
  empresaId           String    @map("empresa_id")
  dataReferencia      DateTime  @map("data_referencia")
  status              String    @db.VarChar(15) @default("SIMULADO") // SIMULADO, CONFIRMADO, EM_EXECUCAO, CONCLUIDO
  totalOndas          Int       @map("total_ondas")
  totalPedidos        Int       @map("total_pedidos")
  totalItens          Int       @map("total_itens")
  geradoEm            DateTime  @map("gerado_em")
  confirmadoPorId     String?   @map("confirmado_por_id")
  confirmadoEm        DateTime? @map("confirmado_em")
  criadoEm            DateTime  @default(now()) @map("criado_em")

  simulacoes          SimulacaoOnda[]

  @@map("planejamento_onda")
}

model SimulacaoOnda {
  id                    String    @id @default(uuid())
  planejamentoOndaId    String    @map("planejamento_onda_id")
  planejamentoOnda      PlanejamentoOnda @relation(fields: [planejamentoOndaId], references: [id], onDelete: Cascade)
  ondaNumero            Int       @map("onda_numero")
  docaId                String?   @map("doca_id")
  rotaId                String?   @map("rota_id")
  totalPedidos          Int       @map("total_pedidos")
  totalItens            Int       @map("total_itens")
  horaInicioEstimada    DateTime  @map("hora_inicio_estimada")
  horaFimEstimada       DateTime  @map("hora_fim_estimada")
  cargaKg               Decimal?  @db.Decimal(12, 2) @map("carga_kg")
  volumeM3              Decimal?  @db.Decimal(12, 4) @map("volume_m3")

  @@map("simulacao_onda")
}
```

### API Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | /api/wave/regras | Lista regras de onda |
| POST | /api/wave/regras | Cria regra |
| PUT | /api/wave/regras/:id | Atualiza regra |
| DELETE | /api/wave/regras/:id | Remove regra |
| PUT | /api/wave/regras/reordenar | Reordena prioridades |
| POST | /api/wave/simular | Simula planejamento para data |
| GET | /api/wave/planejamentos | Lista planejamentos |
| GET | /api/wave/planejamentos/:id | Detalhes do planejamento com simulações |
| PUT | /api/wave/planejamentos/:id/confirmar | Confirma planejamento (gera ondas reais) |
| DELETE | /api/wave/planejamentos/:id | Descarta simulação |
| GET | /api/wave/painel | Painel de execução das ondas do dia |

### Lógica de Negócio

1. **Simulação**: Busca pedidos pendentes para a data. Aplica regras em ordem de prioridade:
   - CORTE_HORARIO: agrupa pedidos por janela de entrega (parametros: {horaCorte: "14:00", intervaloMinutos: 120})
   - AGRUPAMENTO_ROTA: agrupa pedidos pela mesma rota de entrega
   - CAPACIDADE_DOCA: limita itens por onda baseado na capacidade da doca (parametros: {maxPedidos: 50, maxItens: 500})
   - PRIORIDADE_CLIENTE: clientes prioritários são alocados nas primeiras ondas
2. **Geração de Ondas**: Para cada grupo resultante, cria SimulacaoOnda com estimativas de tempo (baseado em throughput médio do LMS) e carga/volume.
3. **Confirmação** (dentro de `$transaction`): Converte SimulacaoOnda em OndaSeparacao reais (modelo existente). Atualiza status do planejamento. Vincula pedidos às ondas.
4. **Regras Compostas**: Regras são aplicadas em cascata. Primeiro agrupa por corte horário, depois subdivide por rota, depois valida capacidade. Se excede capacidade → split em múltiplas ondas.
5. **Re-simulação**: Permite descartar simulação e re-simular com regras ajustadas antes de confirmar.

---

## Error Handling

Mesmo padrão das Fases 1 e 2:
- Operações compostas utilizam `$transaction` — falha parcial reverte tudo
- HTTP 422 (Zod), 403 (cross-tenant/cross-client), 409 (conflitos de negócio)
- Workers registram falhas no log e geram alerta ao administrador
- Mensagens de erro não expõem detalhes de implementação

## Testing Strategy

- **Unitários**: Algoritmos de previsão, classificação ABC, score slotting, cálculo de custos, agrupamento wave
- **Integração**: Fluxo slotting (classificação → sugestão → aplicação), fluxo portal (solicitação → expedição), fluxo wave (regras → simulação → confirmação)
- **Manuais**: Dashboard BI, portal 3PL (visão cliente), simulação visual de ondas

## Correctness Properties

### Property 1: Invariante de Classificação ABC
A soma dos percentuais acumulados deve totalizar 100%. Produtos A ≤ 20% dos itens, ≥ 70% do valor.

### Property 2: Invariante de Slotting
Aplicar sugestão preserva quantidade total de estoque (baixa origem = crédito destino).

### Property 3: Isolamento de Tenant no Portal
Nenhuma query do portal retorna dados de clienteId diferente do JWT.

### Property 4: Invariante de Custo
custoTotal == custoMaoObra + custoEquipamento + custoEspaco para todo CustoOperacao.

### Property 5: Cobertura Total de Pedidos na Wave
Ao confirmar planejamento, todo pedido pendente está em exatamente uma onda (sem duplicatas, sem órfãos).

### Property 6: Ordenação de Regras
Regras de onda aplicadas em ordem estrita de prioridade. Mesmas regras + mesmos dados = mesmo resultado.

---

## Decisões Técnicas Transversais

### Auditoria
Todos os módulos utilizam o padrão existente de LogMovimentoWms.

### Validação de Entrada
Schemas Zod para todas as rotas, seguindo o padrão existente das Fases 1 e 2.

### Multi-Tenancy
Middleware `tenant-context` existente garante empresaId em todas as queries. Portal usa middleware adicional que injeta clienteId do JWT (scope portal).

### Transações
Operações compostas usam `prisma.$transaction()` seguindo o padrão existente.

### Workers (Jobs Periódicos)

| Worker | Frequência | Módulo | Função |
|--------|-----------|--------|--------|
| previsaoDemandaWorker | 1x/dia | Demanda/Slotting | Recalcula previsões e ABC |
| slottingSugestaoWorker | 1x/semana | Demanda/Slotting | Gera sugestões de realocação |
| notificacaoPortalWorker | 1h | Portal 3PL | Contratos vencendo, estoque mínimo |
| snapshotBIWorker | 1x/dia | BI | Indicadores diários |
| custoOperacaoWorker | 1x/dia | BI | Custos por tipo de operação |
| alertaCorrelacaoWorker | 6h | BI | Correlações e anomalias |

---

## Estrutura de Diretórios (Backend)

```
src/modules/
├── demanda/        (routes, service, worker, schemas, types)
├── portal/         (routes, service, worker, schemas, middleware, types)
├── bi/             (routes, service, worker, schemas, types)
├── wave/           (routes, service, schemas, types)
```

## Estrutura de Diretórios (Frontend)

```
app/wms/
├── demanda/        (dashboard, previsões, ABC, slotting, config)
├── portal/         (dashboard cliente, estoque, solicitações, faturas, admin)
├── bi/             (dashboard BI, custos, alertas, config)
├── wave/           (painel, regras, simulação, planejamentos)
```
