---
inclusion: manual
---

# VisioFab ERP — Análise de Orquestração e Harmonia entre Módulos

## Diagnóstico Geral

O projeto tem **97 módulos** no backend, cobrindo WMS, PCP, Vendas, Compras, Financeiro, Fiscal, Cadastros e infraestrutura. A integração entre módulos acontece **via banco de dados** (Prisma relations), não por chamadas de serviço runtime — o que é adequado para o porte atual mas precisa de atenção para manter consistência.

## Arquitetura de Integração

```
┌─────────────────────────────────────────────────────────────────┐
│                        EMPRESA (tenant)                          │
│  cnpj, endereço, regimeTributário, certificado, séries NF-e     │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐  │
│  │ CADASTROS │    │  VENDAS  │    │ COMPRAS  │    │   WMS    │  │
│  │ Produto   │    │ Pedido   │    │ Pedido   │    │ Estoque  │  │
│  │ Cliente   │◄──►│ Venda    │    │ Compra   │───►│ Endereço │  │
│  │ Fornecedor│    │ NF-e*    │    │ XML      │    │ Picking  │  │
│  └─────┬─────┘    └────┬─────┘    └────┬─────┘    └──────────┘  │
│        │                │               │                         │
│        ▼                ▼               ▼                         │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │                    FISCAL (novo)                           │    │
│  │  DocumentoFiscal ← Motor Tributário ← Certificado         │    │
│  │  Emissão real SEFAZ (XML-DSig + SOAP + mTLS)             │    │
│  └──────────────────────────┬───────────────────────────────┘    │
│                              │                                    │
│                              ▼                                    │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │                    FINANCEIRO                              │    │
│  │  ContaPagar ← CompraEfetivada                             │    │
│  │  ContaReceber ← VendaEfetivada                            │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

## Problemas de Integração Identificados

### 🔴 CRÍTICO: Modelo Legado vs. Novo (NF-e duplicada)

**Problema:** Existem DOIS modelos de NF-e no sistema:
1. **Legado:** `Nfe` (tabela `nfe`) — criado pelo módulo de Vendas ao efetivar
2. **Novo:** `DocumentoFiscal` (tabela `documento_fiscal`) — criado pelo módulo Fiscal

**Impacto:** O módulo de Vendas (`venda.routes.ts`) cria uma NF-e no modelo **legado** quando efetiva uma venda. O novo módulo Fiscal é auto-contido e não é chamado por ninguém.

**Solução necessária:** Migrar o fluxo de Vendas para usar `DocumentoFiscal` + chamar `nfeEmissaoService.emitir()` em vez de criar registro direto na tabela `nfe`.

### 🟡 IMPORTANTE: Compras não gera entrada fiscal

**Problema:** `CompraEfetivada` armazena `xmlNfe` (XML do fornecedor) mas NÃO cria um `DocumentoFiscal` de entrada. A nota de entrada fica "solta" — não participa da apuração fiscal.

**Solução necessária:** Ao efetivar compra com XML, criar `DocumentoFiscal` tipo NFE com tipoOperacao=0 (Entrada) para que entre na escrituração e apuração.

### 🟡 IMPORTANTE: Financeiro é básico e desconectado

**Problema:** `ContaPagar` e `ContaReceber` são gerados automaticamente por Vendas/Compras, mas não têm:
- Integração bancária (CNAB, PIX, boleto)
- Conciliação
- Fluxo de caixa
- Rateio por centro de custo

**Solução:** Módulo Financeiro completo (próximo a implementar).

### 🟡 IMPORTANTE: Cadastros fragmentados

**Problema:** Clientes, Fornecedores e Produtos têm campos básicos mas faltam:
- Múltiplos endereços
- Múltiplos contatos
- Score de crédito
- Grupo econômico
- Consulta CNPJ automática

**Solução:** Spec "Cadastros Completos" na prioridade 1 do roadmap.

### 🟢 OK: WMS ↔ Vendas/Compras

A integração WMS funciona bem:
- Compra efetivada → cria `AgendaWms` para recebimento (quando `usaWms=true`)
- Venda efetivada → pedido entra no fluxo de separação (OndaSeparacao → OndaPedido)
- Conferência de entrada valida itens contra nota de entrada

### 🟢 OK: Financeiro ↔ Vendas/Compras

A geração automática de contas funciona:
- `VendaEfetivada` → gera `ContaReceber` (parcelas automáticas)
- `CompraEfetivada` → gera `ContaPagar` (parcelas automáticas)

## Fluxo Ideal (como deveria funcionar)

### Venda Completa (circuito ideal)

```
1. Pedido de Venda (Vendas)
   ↓
2. Aprovação / Confirmação
   ↓
3. Efetivação → cria VendaEfetivada
   ├── → gera ContaReceber (Financeiro) ✅ funciona
   ├── → emite NF-e via módulo Fiscal (DocumentoFiscal) ❌ não integrado
   └── → cria OndaSeparacao (WMS) ✅ funciona
   ↓
4. Separação / Conferência / Embalagem (WMS)
   ↓
5. Montagem de Carga → CT-e / MDF-e (Fiscal) ❌ não integrado
   ↓
6. Entrega
   ↓
7. Cobrança → Boleto/PIX (Financeiro) ❌ não existe ainda
   ↓
8. Recebimento → Baixa automática (Financeiro) ❌ não existe ainda
```

### Compra Completa (circuito ideal)

```
1. Pedido de Compra (Compras)
   ↓
2. Confirmação do fornecedor
   ↓
3. Efetivação (XML da NF-e do fornecedor)
   ├── → gera ContaPagar (Financeiro) ✅ funciona
   ├── → registra DocumentoFiscal entrada (Fiscal) ❌ não integrado
   └── → agenda recebimento WMS ✅ funciona
   ↓
4. Recebimento físico + Conferência (WMS)
   ↓
5. Endereçamento (WMS) ✅ funciona
   ↓
6. Manifesto do Destinatário (Fiscal) ❌ não automático
   ↓
7. Pagamento ao fornecedor (Financeiro) ❌ básico
```

## Plano de Harmonização (O que precisa ser feito)

### Fase 1: Integrar Fiscal no Fluxo Principal

1. **Vendas → Fiscal:** Substituir criação de `Nfe` legado por chamada a `nfeEmissaoService.emitir()` no endpoint `/vendas/efetivar`
2. **Compras → Fiscal:** Ao efetivar compra com XML, criar `DocumentoFiscal` tipo entrada
3. **Deprecar modelo Nfe legado:** Migrar dados existentes para `DocumentoFiscal`

### Fase 2: Financeiro Completo

1. Integração bancária (CNAB 240/400, PIX API, OFX)
2. Boleto registrado
3. Conciliação automática
4. Fluxo de caixa projetado
5. Régua de cobrança

### Fase 3: Cadastros Completos

1. Consulta CNPJ automática (BrasilAPI)
2. Múltiplos endereços tipados
3. Score de crédito
4. Grupo econômico
5. Dados bancários em fornecedor (para pagamento CNAB)

### Fase 4: Vendas Avançado

1. PDV / NFC-e integrado
2. Comissionamento avançado
3. Força de vendas mobile
4. Marketplace hub

### Fase 5: Compras Avançado

1. MRP (ponto de pedido automático)
2. Cotação com mapa comparativo
3. Workflow de aprovação por alçada
4. Avaliação de fornecedor

## Entidades Compartilhadas (Hub de Dados)

| Entidade | Usada por | Campos fiscais |
|----------|-----------|----------------|
| **Empresa** | Todos | cnpj, uf, regimeTributario, certificado, séries |
| **Produto** | Vendas, Compras, WMS, Fiscal | ncm, cfop, cst, csosn, alíquotas |
| **Cliente** | Vendas, Financeiro, Fiscal | cpfCnpj, ie, endereço, uf |
| **Fornecedor** | Compras, Financeiro | cnpj, ie, endereço, uf |
| **Transportadora** | WMS, Fiscal (CT-e) | cnpj, ie, uf |

## Regras de Integração (para futuros specs)

1. **Sempre usar DocumentoFiscal** — nunca criar registro direto em tabela legada
2. **Fiscal como serviço interno** — outros módulos devem chamar `nfeEmissaoService.emitir()` em vez de montar XML manualmente
3. **Motor tributário centralizado** — produtos devem ter NCM/CFOP preenchido para cálculo automático
4. **Financeiro gerado por eventos** — cada efetivação de venda/compra gera automaticamente título financeiro
5. **WMS acionado por flag** — se `empresa.usaWms`, vendas/compras acionam fluxo WMS
6. **Auditoria em tudo** — toda operação fiscal/financeira registra log

## Status por Módulo (Frontend ↔ Backend)

| Módulo | Backend | Frontend | Integração |
|--------|---------|----------|------------|
| Fiscal | ✅ Completo | ✅ Completo | ⚠️ Não conectado a Vendas/Compras |
| Vendas | ✅ Básico | ✅ Básico | ⚠️ Usa NF-e legada |
| Compras | ✅ Básico | ✅ Básico | ⚠️ Não gera DocumentoFiscal |
| Financeiro | ⚠️ Mínimo | ⚠️ Mínimo | ✅ Gerado por Vendas/Compras |
| WMS | ✅ Avançado | ✅ Avançado | ✅ Integrado com Vendas/Compras |
| PCP | ✅ Avançado | ✅ Avançado | ✅ Independente |
| Cadastros | ⚠️ Básico | ⚠️ Básico | ✅ Compartilhado |

## Próximos Specs (Ordem Recomendada)

1. **erp-fiscal-completar** — DANFE PDF + migração Vendas→Fiscal + testes homologação
2. **erp-financeiro** — Módulo completo (CNAB, PIX, boleto, conciliação, fluxo de caixa)
3. **erp-cadastros-completos** — Consulta CNPJ, multi-endereço, score crédito
4. **erp-vendas-avancado** — PDV, comissões, força de vendas
5. **erp-compras-mrp** — MRP, cotação, aprovações
