# Acompanhamento — Fluxo Integrado da Fase 1

**Cliente:** Carton Wega  
**Data:** 26/08/2026  
**Sistema:** Vizor ERP (VisioFab)

---

## Fluxo Principal — Status Atual

| # | Etapa do Fluxo | Status | Observações |
|---|---------------|:------:|-------------|
| 1 | **REPRESENTANTE** | ✅ | Portal PWA funcionando (login dedicado, mobile-first, instalável no celular). 3 representantes com acesso ativo. |
| 2 | **SOLICITAÇÃO DE ORÇAMENTO** | ✅ | Representante solicita orçamento pelo portal: tipo de embalagem, medidas, quantidade, acabamentos. Solicitação chega no painel admin do ERP. |
| 3 | **CÁLCULO GRÁFICO** | ✅ | Motor de cálculo completo: wizard 7 etapas, planificação, custo papel/tinta/máquina/acabamento, margem, variações de tiragem. |
| 4 | **APROVAÇÃO DO ORÇAMENTO** | ✅ | Fluxo Enviar → Aprovar/Recusar. Aprovação gera Pedido de Venda automaticamente. PDF de proposta para o cliente. |
| 5 | **PEDIDO DE VENDA** | ✅ | Gerado automaticamente a partir do orçamento aprovado. Controle de status (Rascunho → Confirmado → Em Produção → Faturado). |
| 6 | **VERIFICAÇÃO DE ESTOQUE** | ✅ | Automática ao programar OP. Verifica disponibilidade de cada material (WMS + ERP - reservas). Se faltar material, gera sugestão de compra automaticamente. |
| 7 | **PLANEJAMENTO / PCP** | ✅ | Cadastros completos (BOM, roteiro, centros, tipos de processo). Explosão de BOM e geração de etapas automáticas. Cálculo de consumo gráfico. |
| 8 | **ORDEM DE PRODUÇÃO** | ✅ | Criação nativa no Vizor + importação via PDF GPrint. Geração automática a partir de pedido confirmado. Máquina de estados completa. |
| 9 | **PROGRAMAÇÃO DE MÁQUINAS** | ✅ | Painel de programação com drag-and-drop por centro/máquina. Desmembramento de etapas entre máquinas. Controle de prioridades. OPs avulsas. |
| 10 | **PRODUÇÃO E APONTAMENTOS** | ✅ | Iniciar/pausar/retomar/concluir etapas. Registro de quantidades, perdas, paradas com motivo. App mobile para chão de fábrica. |
| 11 | **CONTROLE DE MATÉRIA-PRIMA** | ✅ | Reserva automática de materiais ao liberar OP (empenho impede uso por outra OP). Liberação de material com integração WMS (onda de separação). Cancelamento/conclusão gerenciam reservas automaticamente. |
| 12 | **ESTOQUE / EXPEDIÇÃO** | ✅ | WMS completo: recebimento, conferência de entrada, endereçamento, separação (picking), expedição, inventário. Integração automática PCP → WMS ao concluir produção. |

---

## Resumo Visual

```
REPRESENTANTE                    ✅ Funcionando
       ↓
SOLICITAÇÃO DE ORÇAMENTO         ✅ Funcionando
       ↓
CÁLCULO GRÁFICO                  ✅ Funcionando
       ↓
APROVAÇÃO DO ORÇAMENTO           ✅ Funcionando
       ↓
PEDIDO DE VENDA                  ✅ Funcionando
       ↓
VERIFICAÇÃO DE ESTOQUE           ✅ Funcionando (automática ao programar OP)
       ↓
PLANEJAMENTO / PCP               ✅ Funcionando
       ↓
ORDEM DE PRODUÇÃO                ✅ Funcionando
       ↓
PROGRAMAÇÃO DE MÁQUINAS          ✅ Funcionando
       ↓
PRODUÇÃO E APONTAMENTOS          ✅ Funcionando
       ↓
CONTROLE DE MATÉRIA-PRIMA        ✅ Funcionando (reserva automática ao liberar)
       ↓
ESTOQUE / EXPEDIÇÃO              ✅ Funcionando
```

---

## ✅ 12 de 12 etapas do fluxo implementadas e em produção

---

## Integrações funcionando no fluxo

| De → Para | Status |
|-----------|:------:|
| Representante → Solicitação de Orçamento | ✅ |
| Solicitação → Cálculo Gráfico (orçamento) | ✅ |
| Orçamento Aprovado → Pedido de Venda | ✅ |
| Pedido Confirmado → Ordem de Produção | ✅ |
| OP Programada → Verificação de Estoque automática | ✅ |
| OP Programada → Sugestão de Compra (se faltar material) | ✅ |
| OP Liberada → Reserva automática de materiais | ✅ |
| OP Liberada → Onda de Separação WMS (almoxarifado) | ✅ |
| OP Concluída → Entrada no WMS (estoque produto acabado) | ✅ |
| OP Cancelada → Liberação automática das reservas | ✅ |
| Importação PDF GPrint → OP completa | ✅ |

---

## Detalhamento das automações implementadas nesta sessão

### Verificação de Estoque (ao programar OP)
- Ao transitar OP para PROGRAMADA, o sistema verifica automaticamente:
  - Saldo disponível de cada matéria-prima da BOM
  - Combina WMS (SaldoEndereco) + ERP (Estoque) - reservas ativas de outras OPs
  - Retorna situação por item: SUFICIENTE / PARCIAL / SEM_ESTOQUE
- Se houver falta: gera `SugestaoCompra` automática (PENDENTE) com quantidade, produto e data de necessidade
- A verificação NÃO bloqueia a programação — é informativa/preventiva

### Reserva de Materiais (ao liberar OP)
- Ao transitar OP para LIBERADA, o sistema cria `ReservaProducao` (ATIVA) para cada material da BOM
- Reserva impede que o mesmo saldo seja prometido a outra OP (empenho)
- Idempotente: se a OP já tem reservas, não duplica
- Ao CANCELAR OP → reservas canceladas automaticamente
- Ao CONCLUIR OP → reservas marcadas como consumidas

---

*Vizor ERP — Desenvolvido por Claudio Rangel*
