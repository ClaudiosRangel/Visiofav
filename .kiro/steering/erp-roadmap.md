---
inclusion: manual
---

# VisioFab ERP — Roadmap Completo e Contexto do Projeto

## Visão Geral

O VisioFab está evoluindo de um WMS especializado para um **ERP completo** focado no mercado brasileiro. O diferencial competitivo é a combinação de WMS nativo sofisticado + ERP com UX moderna + preço acessível.

## Stack Backend

| Recurso | Tecnologia |
|---------|-----------|
| Runtime | Node.js + tsx |
| Framework | Fastify |
| ORM | Prisma 6 |
| Banco | PostgreSQL (Neon serverless) |
| Validação | Zod |
| Linguagem | TypeScript 100% |
| Deploy | Render (automático via push main) |

## Módulos — Ordem de Implementação

### Prioridade 1 (Sem isso não vende ERP no Brasil)

| # | Módulo | Status | Spec |
|---|--------|--------|------|
| 1 | **Fiscal** | ✅ Implementado | `erp-modulo-fiscal` |
| 2 | **Financeiro** | 🔲 Próximo | — |
| 3 | **Cadastros Completos** | 🔲 Não iniciado | — |

### Prioridade 2 (Diferencial competitivo)

| # | Módulo | Status |
|---|--------|--------|
| 4 | Vendas completo (PDV, força de vendas, comissões) | Parcial |
| 5 | Compras com MRP | Parcial |
| 6 | Régua de cobrança | 🔲 |

### Prioridade 3 (Amadurecimento)

| # | Módulo | Status |
|---|--------|--------|
| 7 | Contábil (exportação para Domínio/Fortes) | 🔲 |
| 8 | Integrações (marketplaces, Open Finance) | 🔲 |
| 9 | CRM integrado | 🔲 |

## Próximo Módulo: Financeiro

### Escopo
- Integração bancária (CNAB 240/400, PIX API, DDA, OFX)
- Contas a pagar (provisão, borderô, rateio centro de custo)
- Contas a receber (boleto registrado, aging, régua de cobrança)
- Tesouraria (fluxo de caixa, multi-conta, cheques, conciliação cartões)
- Contratos recorrentes

## Módulo Fiscal (já implementado)

### Endpoints existentes em `/api/fiscal/`:
- Motor tributário (CRUD + simulação com fallback)
- NF-e (emissão, cancelamento, CC-e, inutilização)
- NFC-e, CT-e, MDF-e, NFS-e
- SPED (geração + histórico)
- Apuração (ICMS, ICMS-ST, PIS/COFINS, IPI)
- Certificados digitais (upload A1, validação)
- Contingência (fila, retransmissão, status SEFAZ)
- GNRE (geração, pagamento)
- Importação XML (upload, de-para, gerar entrada)
- Manifesto destinatário
- Auditoria fiscal
- Dashboard métricas

## Padrões de Desenvolvimento

1. Cada módulo vive em `src/modules/{modulo}/`
2. Rotas Fastify com prefixo `/api/{modulo}/`
3. Validação com Zod em todas as rotas
4. Middleware `moduloGuard` para controle de acesso por módulo
5. `ALL_MODULOS` em `empresa-selector.routes.ts` deve ser atualizado ao adicionar módulo novo
6. Prisma migrations para schema do banco
7. Testes com vitest

## Referências
- Spec fiscal: `.kiro/specs/erp-modulo-fiscal/`
- WMS specs: `.kiro/specs/wms-*`
