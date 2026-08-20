# Proposta Comercial — Vizor ERP (VisioFab)

**Cliente:** Carton Wega  
**Data:** 20/08/2026  
**Versão:** 1.0

---

## 1. Modelo de Implantação Gradativa

A implantação do ERP será realizada por módulos. Conforme cada módulo for
implantado e validado em produção, o valor mensal será acrescido
proporcionalmente.

---

## 2. Tabela de Módulos e Valores Mensais

| Módulo | Valor Mensal | Acumulado |
|--------|-------------|-----------|
| **PCP** (Planejamento e Controle de Produção) | R$ 900,00 | R$ 900,00 |
| + **WMS** (Gestão de Armazém) | + R$ 600,00 | R$ 1.500,00 |
| + **Compras** (Cotação, Pedidos de Compra, Follow-up) | + R$ 480,00 | R$ 1.980,00 |
| + **Fiscal** (NF-e, CT-e, NFS-e, SPED) | + R$ 600,00 | R$ 2.580,00 |
| + **Vendas** (Pedidos e Faturamento) | + R$ 480,00 | R$ 3.060,00 |
| + **Financeiro** (Contas a Pagar/Receber) | + R$ 420,00 | R$ 3.480,00 |
| + **App Mobile** (Apontamento de Produção) | + R$ 300,00 | R$ 3.780,00 |

**Valor mensal com todos os módulos implantados: R$ 3.780,00/mês**

---

## 3. Escopo por Módulo

| Módulo | Funcionalidades Incluídas |
|--------|--------------------------|
| **PCP** | Importação de OP (PDF GPrint), painel de programação, apontamento de produção, desmembramento de etapas, cálculo de consumo gráfico, controle de prioridades, integração automática com WMS |
| **WMS** | Recebimento, conferência de entrada, endereçamento, separação (picking), expedição, inventário, controle de lotes |
| **Compras** | Cotação de fornecedores, pedido de compra, aprovação, follow-up de entregas, vínculo com NF de entrada |
| **Fiscal** | Emissão de NF-e, CT-e (modelo 57 v4.00), NFS-e, SPED (EFD ICMS/IPI, Contribuições), apuração de impostos |
| **Vendas** | Cadastro de clientes, pedidos de venda, faturamento, acompanhamento de entregas |
| **Financeiro** | Contas a pagar, contas a receber, fluxo de caixa, conciliação |
| **App Mobile** | Apontamento de produção no chão de fábrica, conferência via celular/tablet |

---

## 4. Roteiro de Implantação

A implantação segue uma ordem lógica onde cada fase prepara o terreno para
a próxima. Estimativa total: 4 a 6 meses.

| Fase | Módulo | O que será feito | Depende de |
|------|--------|-----------------|-----------|
| 1 | **PCP** | Cadastros base (clientes, produtos, materiais, BOM, roteiro), criação de OP nativa no Vizor, programação e apontamento de produção | — (já em andamento) |
| 2 | **WMS** | Controle de estoque de matéria-prima e produto acabado, recebimento, conferência, endereçamento e expedição | Fase 1 (cadastros) |
| 3 | **Compras** | Pedido de compra a partir da necessidade da OP, cotação, aprovação, vínculo com recebimento | Fases 1 e 2 |
| 4 | **Fiscal** | Emissão de NF-e (saída), entrada (XML), CT-e, NFS-e, SPED e apurações | Fases 2 e 3 |
| 5 | **Vendas** | Pedido de venda, orçamento, aprovação do cliente, geração automática de OP | Fases 1 e 4 |
| 6 | **Financeiro** | Contas a pagar (fornecedores), contas a receber (clientes), fluxo de caixa, conciliação bancária | Fases 4 e 5 |
| — | **App Mobile** | Pode ser ativado a qualquer momento a partir da Fase 1 (apontamento de produção no celular) | Fase 1 |

> **Nota:** durante todo o período de implantação, o sistema Calcograf/GPrint
> continuará disponível como fallback. A importação via PDF permanece ativa
> até que 100% dos cadastros estejam migrados e a equipe esteja treinada no
> novo fluxo.

---

## 5. Valor do ERP — Licença Completa

Ao final da implantação de todos os módulos, será cobrado o valor total
da licença do sistema ERP:

| Item | Valor |
|------|-------|
| **Licença ERP Vizor — sistema completo** | **R$ 60.000,00** |

Este valor refere-se à propriedade de uso da licença do sistema customizado,
incluindo todas as parametrizações, integrações e desenvolvimentos
específicos realizados para a Carton Wega.

---

## 6. Resumo Financeiro

| Item | Valor |
|------|-------|
| Mensalidade atual (PCP implantado) | R$ 900,00/mês |
| Mensalidade com todos os módulos | R$ 3.780,00/mês |
| Licença ERP (ao final da implantação) | R$ 60.000,00 |

---

## 7. Condições Gerais

- Valores sujeitos a reajuste anual com base na variação cambial (USD/BRL)
  ou índice IGPM, o que for maior
- A mensalidade cobre: hospedagem, manutenção, suporte e atualizações do
  sistema
- Implantação de cada módulo inclui: configuração, migração de dados
  (quando aplicável) e treinamento da equipe
- O valor da licença (R$ 60.000,00) será cobrado após a conclusão e
  validação de todos os módulos em produção

---

*Vizor ERP — Desenvolvido por Claudio Rangel*
