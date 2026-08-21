# Módulo de Orçamento Gráfico — Tasks

## Task 1: Schema e Migração (Backend)
- [ ] 1.1 Criar models no schema.prisma (TipoEmbalagem, PrecoMateriaPrima, ParametroPerda, TabelaMargem, OrcamentoGrafico)
- [ ] 1.2 Adicionar campos no CentroProducao (velocidade, unidadeVelocidade, formatoFolhaLargura, formatoFolhaAltura, pincaMm)
- [ ] 1.3 Atualizar migrate-prod.ts com CREATE TABLE + ALTER TABLE idempotentes
- [ ] 1.4 Rodar prisma generate localmente para validar

## Task 2: Motor de Cálculo (Backend)
- [ ] 2.1 Criar service `orcamento-grafico-calculo.service.ts` com função principal `calcularOrcamentoGrafico()`
- [ ] 2.2 Implementar `calcularEncaixe()` — imposição com rotação e fibra
- [ ] 2.3 Implementar `calcularPapel()` — peso e custo
- [ ] 2.4 Implementar `calcularTinta()` — por cor com cobertura e rendimento
- [ ] 2.5 Implementar `calcularMaquinas()` — setup + operação × custo/hora
- [ ] 2.6 Implementar `calcularAcabamentos()` — corte/vinco, colagem, verniz, laminação
- [ ] 2.7 Implementar `formarPrecoVenda()` — markup sobre custo com impostos/comissão
- [ ] 2.8 Implementar avaliador de fórmulas para planificação (expressões matemáticas seguras)
- [ ] 2.9 Testes unitários do motor de cálculo com dados reais das OPs da Wega

## Task 3: Rotas CRUD Cadastros (Backend)
- [ ] 3.1 Criar `orcamento-grafico.routes.ts` com CRUD de TipoEmbalagem
- [ ] 3.2 CRUD de PrecoMateriaPrima
- [ ] 3.3 CRUD de ParametroPerda
- [ ] 3.4 CRUD de TabelaMargem
- [ ] 3.5 Atualizar rota de CentroProducao para aceitar/retornar campos de velocidade/formato
- [ ] 3.6 Registrar rotas no server.ts

## Task 4: Rotas de Orçamento (Backend)
- [ ] 4.1 POST `/calcular` — rota de preview (calcula sem salvar)
- [ ] 4.2 POST `/` — cria orçamento (salva)
- [ ] 4.3 GET `/` — lista paginada com filtros (status, cliente, vendedor, data)
- [ ] 4.4 GET `/:id` — detalhe completo
- [ ] 4.5 PUT `/:id` — atualiza orçamento em rascunho
- [ ] 4.6 POST `/:id/enviar` — muda status para ENVIADO
- [ ] 4.7 POST `/:id/aprovar` — marca aprovado + gera Pedido de Venda
- [ ] 4.8 POST `/:id/recusar` — marca recusado com motivo
- [ ] 4.9 POST `/:id/copiar` — duplica como nova versão
- [ ] 4.10 POST `/simular-tiragens` — retorna cálculo para múltiplas quantidades

## Task 5: Seed de Tipos Pré-Configurados (Backend)
- [ ] 5.1 Criar seed/migração com tipos de embalagem padrão (Cartucho, Caixa, Display, Rótulo, Sacola)
- [ ] 5.2 Incluir fórmulas de planificação corretas para cada tipo
- [ ] 5.3 Incluir parâmetros e processos obrigatórios

## Task 6: Frontend — Cadastros
- [ ] 6.1 Página de Tipos de Embalagem (CRUD com preview de fórmula)
- [ ] 6.2 Página de Preços de Matéria-Prima (tabela editável)
- [ ] 6.3 Página de Parâmetros de Perda (por processo)
- [ ] 6.4 Página de Tabelas de Margem
- [ ] 6.5 Atualizar tela de Centros de Produção (campos velocidade, formato folha)
- [ ] 6.6 Menu lateral do módulo (novo item "Orçamento" no sidebar)

## Task 7: Frontend — Wizard de Orçamento
- [ ] 7.1 Página `/orcamento-grafico/novo` com Stepper (7 steps)
- [ ] 7.2 Step 1: Seleção de cliente (autocomplete existente + prospect novo)
- [ ] 7.3 Step 2: Seleção de tipo de embalagem (cards visuais)
- [ ] 7.4 Step 3: Medidas (campos dinâmicos baseados nos parâmetros do tipo)
- [ ] 7.5 Step 4: Seleção de papel/cartão (gramatura, tipo)
- [ ] 7.6 Step 5: Definição de cores (CMYK + Pantone com slider de cobertura)
- [ ] 7.7 Step 6: Acabamentos (checkboxes: verniz, laminação, colagem, etc.)
- [ ] 7.8 Step 7: Revisão — breakdown de custos, gráfico pizza, preço final, opções de tiragem
- [ ] 7.9 Botão "Salvar Orçamento" e "Enviar Proposta"

## Task 8: Frontend — Lista e Detalhe de Orçamentos
- [ ] 8.1 Página `/orcamento-grafico` — grid com filtros (status, cliente, período)
- [ ] 8.2 Badges de status coloridos (Rascunho/Enviado/Aprovado/Recusado/Vencido)
- [ ] 8.3 Página de detalhe com breakdown visual
- [ ] 8.4 Ações: Editar, Copiar, Enviar, Aprovar, Recusar
- [ ] 8.5 Comparativo de versões lado a lado

## Task 9: Integração Orçamento → Pedido → OP
- [ ] 9.1 Ao aprovar: criar PedidoVenda automaticamente com itens do orçamento
- [ ] 9.2 Ao confirmar pedido: criar OrdemProducao com BOM e Roteiro derivados
- [ ] 9.3 Gerar etapas da OP com tempos calculados pelo orçamento

## Task 10: Proposta Comercial (PDF)
- [ ] 10.1 Template PDF com pdfkit (logo, dados cliente, tabela de preços por tiragem)
- [ ] 10.2 Rota GET `/orcamento-grafico/:id/proposta-pdf`
- [ ] 10.3 Envio por e-mail (usar config SMTP existente)

## Task 11: Importação em Massa
- [ ] 11.1 Rota POST `/orcamento-grafico/importar` para CSV/Excel
- [ ] 11.2 Parser de materiais + preços
- [ ] 11.3 Preview + confirmação antes de gravar
- [ ] 11.4 Tela frontend de importação (upload + preview)

## Task 12: Dashboard Comercial
- [ ] 12.1 GET `/orcamento-grafico/dashboard` — indicadores (total, convertidos, taxa conversão, ticket médio)
- [ ] 12.2 Frontend: cards de resumo + gráficos
- [ ] 12.3 Ranking de clientes por volume/margem
- [ ] 12.4 Pipeline comercial (funil orçamento → pedido → faturamento)
