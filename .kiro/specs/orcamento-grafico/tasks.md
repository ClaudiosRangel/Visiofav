# Módulo de Orçamento Gráfico — Tasks

## Task 1: Schema e Migração (Backend)
- [x] 1.1 Criar models no schema.prisma (TipoEmbalagem, PrecoMateriaPrima, ParametroPerda, TabelaMargem, OrcamentoGrafico)
- [x] 1.2 Adicionar campos no CentroProducao (velocidade, unidadeVelocidade, formatoFolhaLargura, formatoFolhaAltura, pincaMm)
- [x] 1.3 Atualizar migrate-prod.ts com CREATE TABLE + ALTER TABLE idempotentes
- [x] 1.4 Rodar prisma generate localmente para validar

## Task 2: Motor de Cálculo (Backend)
- [x] 2.1 Criar service `orcamento-grafico-calculo.service.ts` com função principal `calcularOrcamentoGrafico()`
- [x] 2.2 Implementar `calcularEncaixe()` — imposição com rotação e fibra
- [x] 2.3 Implementar `calcularPapel()` — peso e custo
- [x] 2.4 Implementar `calcularTinta()` — por cor com cobertura e rendimento
- [x] 2.5 Implementar `calcularMaquinas()` — setup + operação × custo/hora
- [x] 2.6 Implementar `calcularAcabamentos()` — corte/vinco, colagem, verniz, laminação
- [x] 2.7 Implementar `formarPrecoVenda()` — markup sobre custo com impostos/comissão
- [x] 2.8 Implementar avaliador de fórmulas para planificação (expressões matemáticas seguras)
- [x] 2.9 Testes unitários do motor de cálculo com dados reais das OPs da Wega

## Task 3: Rotas CRUD Cadastros (Backend)
- [x] 3.1 Criar `orcamento-grafico.routes.ts` com CRUD de TipoEmbalagem
- [x] 3.2 CRUD de PrecoMateriaPrima
- [x] 3.3 CRUD de ParametroPerda
- [x] 3.4 CRUD de TabelaMargem
- [x] 3.5 Atualizar rota de CentroProducao para aceitar/retornar campos de velocidade/formato
- [x] 3.6 Registrar rotas no server.ts

## Task 4: Rotas de Orçamento (Backend)
- [x] 4.1 POST `/calcular` — rota de preview (calcula sem salvar)
- [x] 4.2 POST `/` — cria orçamento (salva)
- [x] 4.3 GET `/` — lista paginada com filtros (status, cliente, vendedor, data)
- [x] 4.4 GET `/:id` — detalhe completo
- [x] 4.5 PUT `/:id` — atualiza orçamento em rascunho
- [x] 4.6 POST `/:id/enviar` — muda status para ENVIADO
- [x] 4.7 POST `/:id/aprovar` — marca aprovado + gera Pedido de Venda
- [x] 4.8 POST `/:id/recusar` — marca recusado com motivo
- [x] 4.9 POST `/:id/copiar` — duplica como nova versão
- [x] 4.10 POST `/simular-tiragens` — retorna cálculo para múltiplas quantidades

## Task 5: Seed de Tipos Pré-Configurados (Backend)
- [x] 5.1 Criar seed/migração com tipos de embalagem padrão (Cartucho, Caixa, Display, Rótulo, Sacola)
- [x] 5.2 Incluir fórmulas de planificação corretas para cada tipo
- [x] 5.3 Incluir parâmetros e processos obrigatórios

## Task 6: Frontend — Cadastros
- [x] 6.1 Página de Tipos de Embalagem (CRUD com preview de fórmula)
- [x] 6.2 Página de Preços de Matéria-Prima (tabela editável)
- [x] 6.3 Página de Parâmetros de Perda (por processo)
- [x] 6.4 Página de Tabelas de Margem
- [x] 6.5 Atualizar tela de Centros de Produção (campos velocidade, formato folha)
- [x] 6.6 Menu lateral do módulo (novo item "Orçamento" no sidebar)

## Task 7: Frontend — Wizard de Orçamento
- [x] 7.1 Página `/orcamento-grafico/novo` com Stepper (7 steps)
- [x] 7.2 Step 1: Seleção de cliente (autocomplete existente + prospect novo)
- [x] 7.3 Step 2: Seleção de tipo de embalagem (cards visuais)
- [x] 7.4 Step 3: Medidas (campos dinâmicos baseados nos parâmetros do tipo)
- [x] 7.5 Step 4: Seleção de papel/cartão (gramatura, tipo)
- [x] 7.6 Step 5: Definição de cores (CMYK + Pantone com slider de cobertura)
- [x] 7.7 Step 6: Acabamentos (checkboxes: verniz, laminação, colagem, etc.)
- [x] 7.8 Step 7: Revisão — breakdown de custos, gráfico pizza, preço final, opções de tiragem
- [x] 7.9 Botão "Salvar Orçamento" e "Enviar Proposta"

## Task 8: Frontend — Lista e Detalhe de Orçamentos
- [x] 8.1 Página `/orcamento-grafico` — grid com filtros (status, cliente, período)
- [x] 8.2 Badges de status coloridos (Rascunho/Enviado/Aprovado/Recusado/Vencido)
- [x] 8.3 Página de detalhe com breakdown visual
- [x] 8.4 Ações: Editar, Copiar, Enviar, Aprovar, Recusar
- [x] 8.5 Comparativo de versões lado a lado

## Task 9: Integração Orçamento → Pedido → OP
- [x] 9.1 Ao aprovar: criar PedidoVenda automaticamente com itens do orçamento
- [x] 9.2 Ao confirmar pedido: criar OrdemProducao com BOM e Roteiro derivados
- [x] 9.3 Gerar etapas da OP com tempos calculados pelo orçamento

## Task 10: Proposta Comercial (PDF)
- [x] 10.1 Template PDF com pdfkit (logo, dados cliente, tabela de preços por tiragem)
- [x] 10.2 Rota GET `/orcamento-grafico/:id/proposta-pdf`
- [x] 10.3 Envio por e-mail (usar config SMTP existente)

## Task 11: Importação em Massa
- [x] 11.1 Rota POST `/orcamento-grafico/importar` para CSV/Excel
- [x] 11.2 Parser de materiais + preços
- [x] 11.3 Preview + confirmação antes de gravar
- [x] 11.4 Tela frontend de importação (upload + preview)

## Task 12: Dashboard Comercial
- [x] 12.1 GET `/orcamento-grafico/dashboard` — indicadores (total, convertidos, taxa conversão, ticket médio)
- [x] 12.2 Frontend: cards de resumo + gráficos
- [x] 12.3 Ranking de clientes por volume/margem
- [x] 12.4 Pipeline comercial (funil orçamento → pedido → faturamento)
