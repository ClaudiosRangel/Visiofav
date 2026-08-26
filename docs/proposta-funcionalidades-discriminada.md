# Proposta Discriminada — Funcionalidades Implementadas e a Implementar

**Cliente:** Carton Wega  
**Data:** 25/08/2026  
**Sistema:** Vizor ERP (VisioFab)

---

## 1. Módulo PCP — Planejamento e Controle de Produção

### ✅ Implementado e em produção

| # | Funcionalidade | Descrição |
|---|---------------|-----------|
| 1.1 | Importação de OP via PDF | Extração automática de dados do PDF do sistema GPrint/Calcograf (cabeçalho, materiais, etapas, cores, formatos, programação de entrega) |
| 1.2 | Painel de Programação | Visualização das OPs por centro de produção (máquina), com drag-and-drop para reordenação de fila, cards colapsáveis por tipo de processo |
| 1.3 | Apontamento de Produção | Iniciar, pausar, retomar e concluir etapas no painel. Registro de quantidades produzidas, perdas, paradas (com motivo) |
| 1.4 | Desmembramento de Etapas | Dividir uma etapa entre múltiplas máquinas com controle proporcional de tempo e quantidade |
| 1.5 | Controle de Prioridades | Alteração de prioridade por OP (Baixa/Normal/Alta/Urgente) com ciclo por clique |
| 1.6 | Cadastro de Centros de Produção | Máquinas, setores, linhas com classificação por Tipo de Processo (dinâmico, reordenável) |
| 1.7 | Cadastro de Tipos de Processo | CORTADEIRA, IMPRESSÃO, ACABAMENTO, COLAGEM, VERNIZ — cadastro livre, define abas do painel |
| 1.8 | Cadastro de Estrutura (BOM) | Lista de materiais versionada por produto, com rendimento, aproveitamento, perda fixa de acerto |
| 1.9 | Cadastro de Roteiro | Sequência de operações por produto, com tempos de setup/operação/espera por etapa |
| 1.10 | Explosão de BOM | Geração automática de itens (materiais) da OP a partir da estrutura |
| 1.11 | Geração de Etapas a partir do Roteiro | Criação automática de etapas da OP com tempos calculados |
| 1.12 | Cálculo de Consumo Gráfico | Cálculo automático de consumo de papel (plana/rotativa) com conversão para KG |
| 1.13 | Integração PCP → WMS | Ao concluir todas as etapas, gera NotaEntrada de produção no WMS automaticamente |
| 1.14 | Dashboard PCP | Indicadores: OPs por status, atrasadas, produção do dia, liberações pendentes |
| 1.15 | Reextração de PDF | Reprocessar PDF de OP para corrigir dados extraídos incorretamente sem reimportar |
| 1.16 | OP Avulsa | Criação rápida de OPs diretamente no painel de programação (com ou sem OP existente) |
| 1.17 | Mapeamento De/Para | Vinculação entre códigos do GPrint e cadastros internos (clientes, produtos, materiais, máquinas) |
| 1.18 | Postergar Entrega | Alterar data de entrega preservando a data original e contador de postergações |
| 1.19 | App Mobile (Apontamento) | Apontamento de produção via celular/tablet no chão de fábrica |

### 🔜 A implementar

| # | Funcionalidade | Descrição |
|---|---------------|-----------|
| 1.20 | **Verificação de Estoque na Programação** | Ao programar OP: consultar saldo WMS disponível (livre de reservas), comparar com necessidade da BOM, alertar faltas |
| 1.21 | **Cálculo Automático de Data de Entrega** | Backward scheduling: calcular data início a partir da data desejada, somando tempos do roteiro por etapa, considerando turnos e calendário |
| 1.22 | **Capacidade Finita (Fila de Produção)** | Ao calcular data: considerar OPs já programadas na fila de cada centro, estimar tempo real de espera |
| 1.23 | **Reserva Automática de Estoque** | Ao firmar/programar OP: reservar (empenhar) materiais disponíveis no WMS, impedindo uso em outra OP |
| 1.24 | **Requisição de Compra Automática** | Quando a verificação de materiais detectar falta: gerar sugestão de compra com quantidade, data necessidade e fornecedor sugerido |
| 1.25 | **Geração de OP a partir de Pedido de Venda** | Botão na tela de pedidos para gerar OPs por item, com explosão de BOM e etapas automáticas |
| 1.26 | **Liberação de Material (completa)** | Fluxo de requisição/separação de material do almoxarifado para a produção com rastreabilidade |

---

## 2. Portal do Representante

### ✅ Implementado e em produção

| # | Funcionalidade | Descrição |
|---|---------------|-----------|
| 2.1 | Portal PWA (Mobile-First) | Aplicação instalável no celular do representante, tema verde/branco, funciona offline |
| 2.2 | Login dedicado (JWT separado) | Autenticação separada do ERP com bloqueio por tentativas, senha temporária, refresh token |
| 2.3 | Solicitação de Orçamento | Representante solicita orçamento preenchendo: cliente, tipo embalagem, medidas, quantidade, acabamentos |
| 2.4 | Catálogo dinâmico | Select de tipos de embalagem e acabamentos buscando do cadastro real da empresa |
| 2.5 | Pipeline de Pedidos | Acompanhamento visual do andamento: Orçamento → PV → OP → Produção → Expedição → Entregue |
| 2.6 | Comissões | Resumo mensal projetado/realizado, detalhamento por pedido, navegação entre meses |
| 2.7 | Carteira de Clientes | Visualização, cadastro, edição de dados complementares, solicitação de alteração fiscal |
| 2.8 | Notificações | Alertas de status (orçamento calculado, pedido atualizado), badge de não-lidas, marcar como lida |
| 2.9 | Perfil e Troca de Senha | Dados do representante, alteração de senha com validação |
| 2.10 | Painel Admin (ERP) | Gestão de contas de representantes, processamento de solicitações, configuração de comissão, aprovações |

### 🔜 A implementar

| # | Funcionalidade | Descrição |
|---|---------------|-----------|
| 2.11 | **Conversão Automática Orçamento → Pedido** | Ao calcular o orçamento, converter automaticamente em Pedido de Venda com origem PORTAL_REP |
| 2.12 | **Tabela de Preço por Representante** | Vincular tabelas de preço específicas por representante/região |
| 2.13 | **Meta de Vendas** | Acompanhamento de meta mensal do representante vs realizado |

---

## 3. Orçamento Gráfico (Motor de Cálculo)

### ✅ Implementado e em produção

| # | Funcionalidade | Descrição |
|---|---------------|-----------|
| 3.1 | Wizard de Orçamento (7 etapas) | Fluxo guiado: Cliente → Tipo Embalagem → Medidas → Papel → Cores → Acabamentos → Revisão |
| 3.2 | Cadastro de Tipos de Embalagem | Com fórmulas de planificação (Largura/Altura), parâmetros exigidos, processos obrigatórios |
| 3.3 | Motor de Cálculo | Cálculo automático: custo papel (planificação + aproveitamento), custo tinta, custo máquina (velocidade), custo acabamento |
| 3.4 | Preços de Matéria-Prima | Cadastro de preços por material (papel, tinta, verniz, cola) com vigência |
| 3.5 | Tabela de Margem | Markup, impostos, comissão, despesas administrativas, desconto máximo |
| 3.6 | Parâmetros de Perda | Perda fixa (folhas de acerto) + perda variável (%) por centro/tipo de processo |
| 3.7 | Variações de Tiragem | Simulação de preço para diferentes quantidades (100, 500, 1000, 5000...) |
| 3.8 | Fluxo de Aprovação | Enviar → Aprovar/Recusar. Aprovação gera PedidoVenda automaticamente |
| 3.9 | Versionamento | Copiar orçamento como nova versão (mesmo número, versão incrementada) |
| 3.10 | Edição de Orçamento | Reabrir wizard em modo edição com dados populados |
| 3.11 | Dashboard de Orçamentos | Funil de conversão, ticket médio, ranking de clientes |
| 3.12 | Geração de PDF (Proposta) | PDF formatado para enviar ao cliente com breakdown de custos |
| 3.13 | Geração de OP ao Confirmar Pedido | Ao confirmar PedidoVenda originado de orçamento gráfico, gera OP automaticamente com etapas |

### 🔜 A implementar

| # | Funcionalidade | Descrição |
|---|---------------|-----------|
| 3.14 | **Cálculo de Data de Entrega no Orçamento** | Ao calcular o orçamento: estimar data de entrega baseada nos tempos de produção, fila atual das máquinas e lead time de compra de materiais |
| 3.15 | **Verificação de Estoque no Orçamento** | Ao calcular: verificar se a matéria-prima (papel) está disponível em estoque. Se não: informar prazo de compra do fornecedor e impacto na data |
| 3.16 | **Previsão de Compra de Material** | Se o estoque é insuficiente para atender ao orçamento: gerar previsão de compra com quantidade, fornecedor e prazo, embutindo no prazo de entrega |
| 3.17 | **Integração CalcGraf → OP completa** | Ao aprovar/confirmar: gerar OP com BOM completa (papéis, tintas, vernizes), etapas do roteiro, materiais reservados e programação de entrega |
| 3.18 | **Custo Real vs Orçado** | Ao concluir OP originada de orçamento: comparar custo real (materiais consumidos + horas apontadas) com custo orçado. Dashboard de rentabilidade |

---

## 4. Integração entre Módulos

### ✅ Implementado

| Integração | Descrição |
|------------|-----------|
| Representante → Orçamento | Solicitação do representante é processada pelo orçamento gráfico |
| Orçamento → Pedido de Venda | Aprovação do orçamento gera pedido automaticamente |
| Pedido → OP | Confirmação do pedido gera OP com BOM e etapas |
| OP → WMS | Conclusão da última etapa gera entrada de produto acabado no WMS |
| PDF GPrint → OP | Importação de OP via PDF com materiais, etapas e programação |

### 🔜 A implementar

| Integração | Descrição |
|------------|-----------|
| **OP → Compras** | Falta de material na OP gera requisição de compra automática |
| **Orçamento → Data de Entrega** | Cálculo de prazo considera estoque + fila de produção + lead time fornecedor |
| **Estoque → Programação** | Verificação em tempo real de disponibilidade ao programar OP |
| **Pedido → Geração de OP (Frontend)** | Botão na tela de pedidos para gerar OPs com um clique |

---

## 5. Resumo Quantitativo

| Categoria | Implementado | A implementar | Total |
|-----------|:---:|:---:|:---:|
| **PCP** | 19 funcionalidades | 7 funcionalidades | 26 |
| **Portal Representante** | 10 funcionalidades | 3 funcionalidades | 13 |
| **Orçamento Gráfico** | 13 funcionalidades | 5 funcionalidades | 18 |
| **Integrações** | 5 | 4 | 9 |
| **TOTAL** | **47** | **19** | **66** |

---

## 6. Cronograma Estimado das Implementações Futuras

| Fase | Funcionalidades | Estimativa |
|------|----------------|-----------|
| Fase A | Verificação de estoque na programação + Reserva automática | 2 semanas |
| Fase B | Cálculo de data de entrega (backward scheduling + fila) | 2 semanas |
| Fase C | Requisição de compra automática + Geração de OP a partir de pedido | 2 semanas |
| Fase D | Integração Orçamento Gráfico com estoque/data/compra | 3 semanas |
| Fase E | Custo real vs orçado + Dashboard de rentabilidade | 2 semanas |

**Total estimado: 11 semanas (~3 meses)**

---

*Vizor ERP — Desenvolvido por Claudio Rangel*
