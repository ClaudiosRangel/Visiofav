# Tasks

## 1. Infraestrutura e Modelos de Dados

- [x] 1.1 Criar migration Prisma com modelos CrossDockItem e StagingArea
- [x] 1.2 Criar migration Prisma com modelos AutorizacaoRetorno e ItemAutorizacaoRetorno
- [x] 1.3 Criar migration Prisma com modelos RegraKpi, AlertaKpi, HistoricoRegraKpi e SnapshotKpi
- [x] 1.4 Criar migration Prisma com modelos BloqueioSlotDoca e ConfigDoca, e adicionar campos horaChegadaReal e tempoPermDocaMin ao AgendaWms
- [x] 1.5 Criar migration Prisma com modelos TemplateEtiqueta, VersaoTemplateEtiqueta, ImpressoraRede e FilaImpressao
- [x] 1.6 Atualizar schema.prisma com relações entre novos modelos e modelos existentes (Empresa, Produto, Doca, etc.)

## 2. Módulo Cross-Docking — Backend

- [x] 2.1 Criar schemas Zod de validação para cross-dock (cross-dock.schemas.ts)
- [x] 2.2 Implementar service de identificação automática de itens elegíveis (match NF-e → PedidoVenda)
- [x] 2.3 Implementar service de confirmação de cross-dock (trânsito e oportunístico) com geração de OS
- [x] 2.4 Implementar roteamento para staging area (seleção de staging por doca de saída, fallback se ocupação > 90%)
- [x] 2.5 Implementar lógica de priorização em ondas de separação para itens cross-dock
- [x] 2.6 Implementar baixa automática de saldo da staging area ao expedir
- [x] 2.7 Criar rotas Fastify para cross-dock (CRUD + identificar + confirmar + cancelar)
- [x] 2.8 Criar rotas Fastify para staging areas (CRUD)
- [x] 2.9 Adicionar registros de auditoria para todas as operações de cross-dock

## 3. Módulo Logística Reversa — Backend

- [x] 3.1 Criar schemas Zod de validação para logística reversa
- [x] 3.2 Implementar service de criação de RA (validação NF-e, geração número sequencial, verificação duplicidade)
- [x] 3.3 Implementar service de recebimento de devolução (vinculação à RA, criação OS inspeção, validação quantidades)
- [x] 3.4 Implementar service de inspeção (registro condição + fotos + parecer, atualização status RA)
- [x] 3.5 Implementar service de disposição (REESTOQUE → endereçamento, AVARIA → endereço avaria, DESCARTE → baixa, RETORNO_FORNECEDOR → pendência)
- [x] 3.6 Implementar geração de nota de crédito na conclusão da RA
- [x] 3.7 Criar rotas Fastify para logística reversa (RA CRUD + receber + inspecionar + dispor + motivos)
- [x] 3.8 Adicionar registros de auditoria para todas as operações de logística reversa

## 4. Módulo KPI/SLA com Alertas — Backend

- [x] 4.1 Criar schemas Zod de validação para regras KPI e alertas
- [x] 4.2 Implementar CRUD de regras KPI com histórico de alterações
- [x] 4.3 Implementar evaluators por entidade (PEDIDO, CONFERENCIA, RECEBIMENTO, OCUPACAO, SEPARACAO)
- [x] 4.4 Implementar worker de avaliação periódica (job a cada 60s com cooldown)
- [x] 4.5 Implementar disparo de alertas (criação + notificação SSE + email)
- [x] 4.6 Implementar resolução automática de alertas quando condição normaliza
- [x] 4.7 Implementar gravação de snapshots para histórico de tendências
- [x] 4.8 Criar rotas Fastify para KPI (regras CRUD + alertas + dashboard + histórico + exportar CSV)
- [x] 4.9 Integrar notificações SSE com módulo websocket existente

## 5. Módulo Dock Scheduling Avançado — Backend

- [x] 5.1 Criar schemas Zod de validação para agenda de docas
- [x] 5.2 Implementar service de validação de conflitos (sobreposição + buffer + horário operacional + bloqueios)
- [x] 5.3 Implementar service de criação/movimentação de agendamento com validação de conflitos
- [x] 5.4 Implementar registro de chegada real e cálculo de aderência (previsto vs. real)
- [x] 5.5 Implementar detecção automática de atraso (agendamentos CONFIRMADO sem chegada após tolerância)
- [x] 5.6 Implementar bloqueio de slots para manutenção
- [x] 5.7 Implementar cálculo de estatísticas de aderência (% no prazo, tempo médio atraso, permanência)
- [x] 5.8 Criar rotas Fastify para agenda-doca (timeline + agendar + mover + chegada + bloqueios + config + estatísticas)

## 6. Módulo Impressão de Etiquetas ZPL — Backend

- [x] 6.1 Criar schemas Zod de validação para etiquetas ZPL
- [x] 6.2 Implementar CRUD de templates com versionamento (grava versão anterior ao atualizar)
- [x] 6.3 Implementar validação de sintaxe ZPL básica (^XA/^XZ, placeholders {{campo}})
- [x] 6.4 Implementar renderização de preview do template com dados de exemplo
- [x] 6.5 Implementar CRUD de impressoras de rede com teste de conexão TCP
- [x] 6.6 Implementar health-check periódico de impressoras (a cada 5 minutos)
- [x] 6.7 Implementar worker de processamento de fila de impressão (substituição placeholders + envio TCP)
- [x] 6.8 Implementar impressão em lote (recebimento: itens NF-e, separação: volumes onda, expedição: volumes carregamento)
- [x] 6.9 Implementar retry com 3 tentativas e redirecionamento para impressora alternativa
- [x] 6.10 Criar rotas Fastify para etiquetas-zpl (templates + impressoras + imprimir + fila)
- [x] 6.11 Criar templates padrão pré-configurados (produto EAN, endereço, palete QR, expedição)
- [x] 6.12 Adicionar registros de auditoria para impressões realizadas

## 7. Frontend — Cross-Docking

- [x] 7.1 Criar página "Painel Cross-Dock" com listagem, filtros por status e indicadores
- [x] 7.2 Criar componente de identificação cross-dock na tela de conferência de entrada
- [x] 7.3 Criar página de gerenciamento de staging areas
- [x] 7.4 Adicionar indicador visual "CROSS-DOCK" na tela de ondas de separação
- [x] 7.5 Implementar confirmação cross-dock no app mobile (destino em destaque)

## 8. Frontend — Logística Reversa

- [x] 8.1 Criar página de listagem de RAs com filtros (status, cliente, período, número)
- [x] 8.2 Criar formulário de criação de RA (busca NF-e, seleção itens, motivo)
- [x] 8.3 Criar página de detalhes da RA com timeline visual do ciclo de vida
- [x] 8.4 Criar tela de inspeção de devolução (checklist condição, fotos, parecer)
- [x] 8.5 Criar tela de disposição (listagem itens inspecionados + seletor de ação)
- [x] 8.6 Implementar tela de inspeção no app mobile (captura fotos + classificação)

## 9. Frontend — KPI/SLA com Alertas

- [x] 9.1 Criar dashboard com cards de KPI (valor, tendência, status, meta) com atualização automática
- [x] 9.2 Criar tela de gráfico de tendência histórica (7 dias, granularidade horária) ao clicar no card
- [x] 9.3 Criar painel de alertas ativos com filtros (severidade, entidade, período)
- [x] 9.4 Criar tela de configuração de regras KPI (formulário CRUD)
- [x] 9.5 Implementar notificações toast em tempo real via SSE para alertas
- [x] 9.6 Implementar exportação CSV dos dados de KPI

## 10. Frontend — Dock Scheduling Avançado

- [x] 10.1 Criar componente de timeline visual (eixo X = horas, eixo Y = docas, blocos coloridos por status)
- [x] 10.2 Implementar drag-and-drop de agendamentos na timeline com validação de conflito
- [x] 10.3 Implementar criação de agendamento ao clicar em slot vazio (modal pré-preenchido)
- [x] 10.4 Implementar alternância de visualização (dia, semana, mês)
- [x] 10.5 Criar tela de bloqueios de slot (listagem + criação)
- [x] 10.6 Criar tela de estatísticas de aderência (% no prazo, tempo médio, permanência por doca)
- [x] 10.7 Adicionar indicadores visuais de aderência (verde/amarelo/vermelho) nos blocos da timeline

## 11. Frontend — Impressão de Etiquetas ZPL

- [x] 11.1 Criar tela de gerenciamento de templates (listagem + formulário + editor ZPL)
- [x] 11.2 Implementar preview renderizado de etiqueta com dados de exemplo
- [x] 11.3 Criar tela de gerenciamento de impressoras (listagem + cadastro + indicador status)
- [x] 11.4 Criar tela de fila de impressão (listagem com status, reenvio, cancelamento)
- [x] 11.5 Implementar botões de impressão rápida nas telas de recebimento, separação e expedição
- [x] 11.6 Implementar impressão em lote (seleção múltipla + template + impressora)

## 12. Testes e Qualidade

- [x] 12.1 Escrever testes unitários para service de identificação cross-dock (match produto/quantidade)
- [x] 12.2 Escrever testes unitários para service de validação de conflitos de doca
- [x] 12.3 Escrever testes unitários para evaluators de KPI (cada entidade/condição)
- [x] 12.4 Escrever testes unitários para validação de sintaxe ZPL e substituição de placeholders
- [x] 12.5 Escrever testes unitários para validação de RA (quantidades, duplicidade, NF-e)
- [x] 12.6 Escrever testes de integração para fluxo completo cross-dock (NF-e → staging → expedição)
- [x] 12.7 Escrever testes de integração para fluxo completo logística reversa (RA → inspeção → disposição)

## 13. Registros e Documentação

- [x] 13.1 Registrar rotas dos 5 módulos no server.ts
- [x] 13.2 Documentar APIs dos módulos (comentários JSDoc nas rotas)
- [x] 13.3 Criar seed de dados de exemplo para demonstração (templates etiqueta padrão, regras KPI exemplo, staging areas)
