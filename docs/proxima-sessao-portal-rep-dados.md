# Próxima Sessão — Script de Dados E2E Completo para Portal do Representante

## Objetivo

Criar um script que popule dados de teste que apareçam corretamente em TODOS os módulos:
1. `https://representante.vizorerp.com.br/` (portal externo)
2. `https://app.vizorerp.com.br/portal-representante/` (admin)
3. `https://app.vizorerp.com.br/orcamento-grafico` (orçamentos gráficos)
4. `https://app.vizorerp.com.br/vendas/pedidos` (pedidos de venda)
5. `https://app.vizorerp.com.br/pcp/ordens-producao` (OPs com etapas/materiais)

## Dados de Referência (empresa CARTON WEGA em produção)

### Empresa
- **Empresa ID**: Usar a empresa principal CARTON WEGA (NÃO a VisioFab Demo)
- Buscar por: `prisma.empresa.findFirst({ where: { razaoSocial: { contains: 'CARTON', mode: 'insensitive' } } })`

### Produtos e Clientes da OP (screenshot da listagem de OPs reais)

| Código Produto | Produto | Cliente |
|---|---|---|
| 4758 | STORA ENZO 181 - 700X960 | Acimpel Embalagens |
| 4575 | BOARDONE 230 - 1130X770 | Acimpel Embalagens |
| 3021 | ETIQUETA EMBAL RODEIO 100M | BELGO BEKAERT ARAMES LTDA. |
| 2709 | CAIXA DE PAPELÃO P/5KG DE ELETRODO SERRALHEIRO CÓD. | ESAB INDÚSTRIA E COMÉRCIO LTDA |
| 4528 | CARTUCHO KIT BEST SELLERS CÓD. 1020100094 | FARMATIVA INDUSTRIA E COMERCIO LTDA |
| 4041217 | CART. MAE PREMIUM INTENSE FRAGANCE 08 UNID 100ML | ESTACAO Y |
| 1041607 | Lâmina Cola Rato Letal | LAIPPE |
| 1041592 | Lâmina Cola Rato Ligeirinho / Cola Mosca - KAOCID | LAIPPE |
| 4718 | Cartucho Eletrodo Ok Cód. 1001376 | ESAB INDÚSTRIA E COMÉRCIO LTDA |
| 1051976 | Caixa Papelão Ciclone Vaquinha - Cod: 8522731 | SOL & NEVE |
| 1041535 | CARTUCHO HAMB TRADICIONAL CARAPRETA | CARAPRETA |
| 1021057 | RÓTULO P/FARPADO GIR 500 | GERDAU ACOS LONGOS S.A. |
| 4707 | PROVA IMPRESSÃO CAIXA IMPÉRIO ULTRA ZERO 275ML 12 | CERVEJARIA CIDADE IMPERIAL PETROPOLIS |
| 3570 | Cartucho Display para 50 sachês de 20g | CAFÉ 3 CORAÇÕES |
| 3231 | Caixa Garrafa Império Gold 210ml 610040039 | CERVEJARIA CIDADE IMPERIAL PETROPOLIS |

## O que o script deve fazer

### Passo 1: Buscar/validar dados existentes
- Encontrar a empresa CARTON WEGA pelo nome
- Encontrar o vendedor "Eduardo" (já existe, ATIVO)
- Encontrar ou criar RepresentanteCredencial para esse vendedor
- Encontrar pelo menos 3 dos produtos acima por código
- Encontrar pelo menos 2 dos clientes acima por nome

### Passo 2: Associar clientes ao vendedor
- `UPDATE cliente SET vendedor_id = :vendedorId WHERE id IN (:clienteIds)`
- Isso faz os clientes aparecerem no portal externo (GET /portal-rep/clientes)

### Passo 3: Criar OrcamentoGrafico (aparece em /orcamento-grafico)
- Criar 2 registros no model `OrcamentoGrafico` com:
  - clienteId, vendedorId, empresaId
  - tipoEmbalagem, quantidade, medidas
  - precoVenda, precoUnitario (fictícios)
  - status: 'CALCULADO'
- Isso preenche a tela de Orçamentos Gráficos no ERP

### Passo 4: Criar SolicitacaoOrcamentoRep (aparece no portal externo + admin)
- Criar 2 registros vinculados ao representante
- clienteId referenciando os clientes encontrados
- status 'CALCULADO' com preços
- Esses aparecem em:
  - Portal externo: /portal-rep/orcamentos
  - Admin ERP: /portal-representante/solicitacoes-orcamento

### Passo 5: Criar PedidoVenda (aparece em /vendas/pedidos)
- Criar 2 PedidoVenda com:
  - status 'CONFIRMADO'
  - origemPedido: 'ORCAMENTO'
  - clienteId, vendedorId, tabelaPrecoId
  - itens: criar ItemPedidoVenda com produtoId, quantidade, precoBase, precoFinal, valorTotal
- Buscar/criar TabelaPreco se não existir

### Passo 6: Criar OrdemProducao COM etapas e materiais (aparece em /pcp/ordens-producao)
- Criar 2 OrdemProducao com:
  - status 'PROGRAMADA'
  - produtoId (produto real encontrado)
  - clienteId
  - pedidoVendaId (vinculando ao PV criado)
  - quantidade real (ex: 10000, 50000)
- Para CADA OP, criar:
  - **EtapaOrdemProducao** (3-4 etapas):
    - Cortadeira (sequencia 1, centroProducaoId de um centro tipo CORTADEIRA)
    - Impressão (sequencia 2, centro IMPRESSÃO)
    - Acabamento (sequencia 3, centro ACABAMENTO)
    - status: PENDENTE, posicaoFila: 1
  - **ItemOrdemProducao** (2-3 materiais):
    - Papel (tipoMaterial: 'PAPEL', quantidadePrevista, unidade: 'KG')
    - Tinta (tipoMaterial: 'TINTA', quantidadePrevista, unidade: 'KG')
    - status: PENDENTE
  - **ProgramacaoEntrega** (entregas parciais):
    - 2 entregas com datas diferentes e quantidades parciais
  - **LogOrdemProducao** (histórico):
    - Transição de RASCUNHO → PLANEJADA → PROGRAMADA

### Passo 7: Atualizar solicitações para ENVIADO
- Vincular as solicitações aos pedidos criados
- status → 'ENVIADO'

## Correções de Frontend necessárias ANTES do script

### A. Tipo SolicitacaoOrcamento no frontend (portal externo)

O backend retorna objetos com campos diretos (tipoEmbalagem, quantidade, etc.),
NÃO um array `itens[]`. O frontend `types.ts` precisa ser corrigido:

```typescript
// ERRADO (atual):
export interface SolicitacaoOrcamento {
  itens: ItemSolicitacao[]
}

// CORRETO (alinhado com backend):
export interface SolicitacaoOrcamento {
  id: string
  clienteId: string | null
  clienteNome: string | null
  status: StatusSolicitacao
  criadoEm: string
  tipoEmbalagem: string
  quantidade: number
  medidaLargura?: number
  medidaAltura?: number
  medidaComprimento?: number
  acabamentos?: string
  observacoes?: string
  precoVenda?: number
  precoUnitario?: number
}
```

E adaptar `orcamentos/page.tsx` para renderizar esses campos.

### B. Comissões — tornar mes/ano opcionais

No backend `portal-rep-comissao.routes.ts`, o schema Zod exige mes e ano.
Tornar opcionais com default do mês/ano atual.

### C. Nome do representante na sidebar

Após o fix do JWT (já feito), o layout precisa decodificar `payload.nome` e
mostrar na sidebar sob "Vizor Rep".

## DATABASE_URL de produção

```
postgresql://neondb_owner:npg_qy58nLxvrMhj@ep-withered-mountain-aqtjul2j-pooler.c-8.us-east-1.aws.neon.tech/neondb?sslmode=require
```

## Como rodar

```powershell
$env:DATABASE_URL="postgresql://neondb_owner:npg_qy58nLxvrMhj@ep-withered-mountain-aqtjul2j-pooler.c-8.us-east-1.aws.neon.tech/neondb?sslmode=require"
npx tsx scripts/teste-fluxo-representante-e2e.ts
```

## Credenciais existentes

- **Representante teste**: teste-rep@vizor.test / Teste123! (empresa VisioFab Demo)
- **Representante prod (Claudio)**: claudiosilvarangel1974@gmail.com (empresa CARTON WEGA)
- **Representante prod (Eduardo)**: eduardo@visiofab.com (empresa CARTON WEGA)
