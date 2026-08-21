# Módulo de Orçamento Gráfico — Requirements

## Objetivo

Implementar um módulo completo de orçamento para indústria gráfica de
embalagens, equivalente em funcionalidades ao sistema Calcgraf/GPrint,
permitindo calcular automaticamente custos de produção e formar preço de
venda de forma precisa e ágil.

## Contexto

A Carton Wega (e potenciais futuros clientes gráficos) hoje dependem do
Calcgraf para orçar seus produtos. O Vizor ERP precisa oferecer essa mesma
capacidade nativamente para substituir o sistema legado por completo.

O orçamento gráfico é o motor central que responde: "Quanto custa produzir
esta embalagem e qual o preço de venda?" — é o módulo que mais valor
entrega para a equipe comercial.

---

## REQ-1: Cadastros Base de Orçamento

### REQ-1.1: Tipos de Embalagem (Especialistas)

Cadastro de tipos de produto gráfico com fórmulas de planificação
pré-definidas. Cada tipo define como calcular as dimensões da peça
planificada a partir das medidas informadas pelo vendedor.

**Campos:**
- Código, Descrição
- Fórmula de largura planificada (expressão matemática parametrizável)
- Fórmula de altura planificada
- Parâmetros exigidos (ex: Largura, Altura, Profundidade, Aba)
- Processos obrigatórios (lista de tipos de processo)
- Valores default: aba de colagem (mm), sangria (mm), pinça (mm)
- Imagem ilustrativa (opcional)
- Status (ativo/inativo)

**Tipos pré-configurados para embalagens semi-rígidas:**
- Cartucho simples
- Cartucho com aba dupla
- Cartucho micro-ondulado (com laminação)
- Caixa tampa e fundo (tampa)
- Caixa tampa e fundo (fundo)
- Display (formato livre / faca)
- Rótulo / Envoltório
- Sacola

### REQ-1.2: Tabela de Preços de Matéria-Prima

Cadastro de preços unitários de cada material, vinculado ao produto
(cadastro existente) ou a uma descrição livre.

**Campos:**
- Material (FK para Produto ou texto livre)
- Tipo (PAPEL, TINTA, VERNIZ, COLA, FACA, BOPP, OUTRO)
- Unidade (KG, M2, UN, LT)
- Preço unitário (R$)
- Fornecedor (opcional)
- Data de vigência
- Status

### REQ-1.3: Configuração de Máquinas para Orçamento

Complementar o cadastro de Centro de Produção existente com campos
específicos para orçamento:

**Campos adicionais em CentroProducao:**
- Velocidade (folhas/hora ou metros/hora)
- Unidade de velocidade (FOLHAS_HORA | METROS_HORA | UNIDADES_HORA)
- Formato máximo da folha (largura mm × altura mm)
- Pinça (mm) — área não imprimível
- Custo/hora (já existe)
- Tempo médio de acerto/setup (minutos) — por tipo de trabalho

### REQ-1.4: Parâmetros de Perda por Processo

Percentual de perda (refugo + acerto) parametrizável por:
- Tipo de processo (Impressão, Corte/Vinco, Colagem, etc.)
- Opcionalmente por máquina específica
- Perda fixa (folhas de acerto) + perda variável (%)

### REQ-1.5: Tabelas de Margem e Políticas Comerciais

- Múltiplas tabelas de margem (por cliente, por volume, por tipo de produto)
- Taxas de venda: impostos (%), comissão (%), despesas administrativas (%)
- Markup padrão da empresa
- Desconto máximo permitido por perfil de usuário

---

## REQ-2: Motor de Cálculo de Orçamento

### REQ-2.1: Cálculo de Encaixe (Imposição)

Dado o formato da peça planificada e o formato da folha da máquina:
- Calcular aproveitamento (peças por folha)
- Testar orientação normal e rotacionada (90°)
- Considerar sangria, pinça e margem de gripper
- Respeitar sentido da fibra do papel (quando informado)
- Retornar: aproveitamento, folhas necessárias, % de aproveitamento da folha

### REQ-2.2: Cálculo de Papel

- Folhas necessárias = ceil(Quantidade / Aproveitamento) × (1 + %Perda)
- Peso (kg) = Folhas × Largura(m) × Altura(m) × Gramatura(g/m²) / 1000
- Custo = Peso × Preço/kg

### REQ-2.3: Cálculo de Tinta

Para cada cor:
- Área de impressão total = Folhas × Largura chapa × Altura chapa
- Consumo por cor = Área × %Cobertura / Rendimento(m²/kg)
- Custo por cor = Consumo × Preço/kg
- Total tinta = Σ custos por cor

### REQ-2.4: Cálculo de Tempo de Máquina

Para cada etapa do processo:
- Tempo de setup (fixo, em minutos)
- Tempo de operação = Folhas (ou unidades) / Velocidade da máquina
- Custo = (Setup + Operação) × Custo/hora da máquina / 60

### REQ-2.5: Cálculo de Acabamentos

Cada acabamento é calculado individualmente:
- Corte e Vinco: setup + (Folhas / Velocidade) × Custo/hora
- Colagem: (Quantidade / Velocidade) × Custo/hora + Custo cola
- Verniz UV: Área × Preço/m² + Tempo × Custo/hora
- Laminação (BOPP): Área × Preço/m² + Tempo × Custo/hora
- Hot Stamping: Quantidade × Custo unitário
- Facas: custo da faca (se nova) rateado pela tiragem

### REQ-2.6: Cálculo de Acondicionamento e Frete

- Embalagem secundária: caixas de papelão, paletes
- Frete: tabela por região ou custo por kg/volume

### REQ-2.7: Formação de Preço de Venda

```
PreçoVenda = CustoTotal / (1 - %Impostos - %Comissão - %Margem - %DespAdm)
```

Com opção de:
- Aplicar markup sobre custo
- Definir preço manualmente e ver margem resultante
- Simular variações de tiragem (ex: 10k, 50k, 100k)

---

## REQ-3: Interface do Vendedor (Wizard de Orçamento)

### REQ-3.1: Fluxo do Wizard

1. **Selecionar cliente** (ou prospect novo)
2. **Selecionar tipo de embalagem** (especialista)
3. **Informar medidas** (campos dinâmicos conforme o tipo)
4. **Selecionar cartão/papel** (com sugestão automática por gramatura)
5. **Definir cores** (CMYK + Pantone, com % cobertura)
6. **Acabamentos** (checkboxes: verniz UV, laminação, hot stamp, etc.)
7. **Tiragem e programação** (quantidade, entregas parciais)
8. **Revisão e ajuste de preço** (breakdown de custos, margem, preço final)

### REQ-3.2: Preview Visual

- Mostrar breakdown de custo em gráfico de pizza (% papel, % máquina, % acabamento, % overhead)
- Comparativo por tiragem (tabela com 3-5 opções de quantidade)
- Simulação offset vs digital (quando aplicável)

### REQ-3.3: Múltiplas Variações

Permitir criar variações do mesmo orçamento:
- Diferentes tiragens
- Diferentes tipos de papel
- Com/sem verniz, com/sem laminação
- Comparar lado a lado

---

## REQ-4: Proposta Comercial

### REQ-4.1: Geração de Proposta (PDF/E-mail)

- PDF profissional com logo da empresa, dados do cliente, opções de tiragem
- Envio por e-mail com link de aprovação
- Validade da proposta (dias)
- Histórico de propostas enviadas

### REQ-4.2: Aprovação pelo Cliente

- Link único para o cliente visualizar e aprovar
- Ao aprovar: gera Pedido de Venda automaticamente
- Registro de quem aprovou e quando

---

## REQ-5: Integração com Demais Módulos

### REQ-5.1: Orçamento → Pedido → OP

- Orçamento aprovado gera Pedido de Venda
- Pedido confirmado gera Ordem de Produção com:
  - BOM (materiais) calculada pelo orçamento
  - Roteiro (etapas) definido pelos processos do orçamento
  - Tempos previstos por etapa

### REQ-5.2: Integração com Estoque

- Ao gerar OP, verificar disponibilidade de material
- Sugerir compra se estoque insuficiente
- Reservar material (empenho)

### REQ-5.3: Pós-Cálculo (orçado vs realizado)

- Comparar custo orçado × custo real da OP concluída
- Identificar desvios (material usado a mais, tempo maior que previsto)
- Alimentar indicadores de precisão do orçamento

---

## REQ-6: Funcionalidades Avançadas

### REQ-6.1: CRM Integrado

- Registro de contatos e follow-up por orçamento
- Motivo de recusa (preço, prazo, qualidade, concorrente)
- Taxa de conversão (orçamentos aprovados / total)
- Pipeline comercial

### REQ-6.2: Análise Comercial

- Dashboard: volume orçado, convertido, faturado
- Ranking de clientes (por faturamento, margem, volume)
- Análise de rentabilidade por produto/cliente
- Metas de venda por vendedor

### REQ-6.3: Histórico e Reprodução

- Copiar orçamento anterior para novo (reprodução)
- Reajustar preço em massa (% sobre tabela anterior)
- Versionamento de orçamentos (V1, V2, V3...)

### REQ-6.4: Segurança e Permissões

- Vendedor: cria orçamento, define preço dentro da faixa permitida
- Orçamentista: revisa cálculos, ajusta parâmetros técnicos
- Gestor: aprova descontos acima do limite, visualiza margens
- Restrição de crédito (cliente inadimplente não pode ser orçado)

---

## REQ-7: Importação em Massa

### REQ-7.1: Importação de Cadastros via Arquivo

- Upload de CSV/Excel com materiais e preços
- Upload de máquinas e parâmetros
- Upload de tipos de embalagem customizados
- Validação e preview antes de confirmar

### REQ-7.2: Importação do Calcgraf (futuro)

- Caso o cliente tenha acesso ao banco Firebird do Calcgraf
- Script de migração de: produtos, materiais, preços, histórico de orçamentos
