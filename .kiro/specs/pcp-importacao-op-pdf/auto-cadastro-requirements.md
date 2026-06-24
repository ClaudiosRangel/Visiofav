# Requisitos — Auto-Cadastro durante Importação de OP (Wizard Passo-a-Passo)

## Introdução

Ao importar uma OP via PDF, entidades referenciadas (cliente, produto acabado, materiais, máquinas) podem não existir no sistema. Em vez de criar a OP com campos nulos e exigir cadastro manual posterior, o sistema guiará o usuário por um wizard sequencial para cadastrar as entidades faltantes durante o próprio fluxo de importação.

## Fluxo do Wizard

```
Upload PDF → Preview (dados extraídos) → Wizard Auto-Cadastro → Confirmar OP
                                              │
                                              ├─ Passo 1: Cliente
                                              ├─ Passo 2: Produto Acabado
                                              ├─ Passo 3: Materiais/Insumos
                                              ├─ Passo 4: Centros/Máquinas
                                              └─ Passo 5: Resumo e Confirmação
```

## Requisitos

### Requisito 1: Passo 1 — Cliente

**Comportamento:** Se o cliente extraído do PDF não foi encontrado no sistema (sugestão = null), exibir formulário para cadastro rápido.

#### Critérios:
1. Exibir nome extraído do PDF (ex: "ICEFRESH") como sugestão pré-preenchida
2. Campos do formulário:
   - Razão Social (pré-preenchido com nome do PDF) — obrigatório
   - Nome Fantasia (opcional)
   - CPF/CNPJ — obrigatório
   - Telefone, Email — opcionais
3. Opções do usuário:
   - "Cadastrar" → cria o cliente e vincula à OP
   - "Pular" → OP é criada sem cliente (null)
   - "Vincular existente" → dropdown para selecionar cliente já cadastrado
4. Se o cliente JÁ foi encontrado (sugestão ≠ null), mostrar confirmação: "Cliente encontrado: {nome} — Usar este?" com opção de trocar

---

### Requisito 2: Passo 2 — Produto Acabado

**Comportamento:** Se o produto acabado (código acabado do PDF) não foi encontrado, exibir formulário para cadastro.

#### Critérios:
1. Exibir dados extraídos: descrição (ex: "CART SUPER FRESH CREME DENTAL 90G MENTA"), código (4590)
2. Campos do formulário:
   - Código (pré-preenchido com cód. acabado) — obrigatório
   - Nome/Descrição (pré-preenchido) — obrigatório
   - Unidade de Medida (default: UN)
   - Classificação PCP = PRODUTO_ACABADO (fixo)
3. Opções:
   - "Cadastrar" → cria produto e vincula como produtoId da OP
   - "Pular" → OP sem produto vinculado
   - "Vincular existente" → busca por código ou nome

---

### Requisito 3: Passo 3 — Materiais e Insumos

**Comportamento:** Para cada material extraído do PDF que não foi encontrado no cadastro, permitir criação em lote.

#### Critérios:
1. Exibir tabela com todos os materiais extraídos, separando:
   - ✓ Encontrados (já vinculados) — mostrar com badge verde
   - ✗ Não encontrados — mostrar com opção de ação
2. Para cada material não encontrado, opções:
   - "Criar" → abre campos inline: código (sugerido automaticamente), nome (pré-preenchido com descrição do PDF), unidade, classificação PCP (MATERIA_PRIMA, INSUMO, EMBALAGEM)
   - "Pular" → material fica sem vínculo (apenas descritivo)
   - "Vincular" → busca produto existente por nome/código
3. Botão "Criar Todos" que cria em lote todos os materiais marcados para criação
4. Sugestão automática de código baseado no tipo: "PAP-" (papel), "TINTA-" (tinta), "VERN-" (verniz), "COLA-" (cola)

---

### Requisito 4: Passo 4 — Centros de Produção (Máquinas)

**Comportamento:** Para cada máquina/centro extraído do PDF que não foi encontrado, permitir criação.

#### Critérios:
1. Exibir tabela com etapas e suas máquinas:
   - ✓ Encontrados — badge verde
   - ✗ Não encontrados — opção de criar
2. Para cada centro não encontrado:
   - "Criar" → campos: código (sugerido), descrição (pré-preenchida com nome da máquina), tipo (MAQUINA padrão)
   - "Pular" → etapa sem centro vinculado
   - "Vincular" → selecionar centro existente
3. Botão "Criar Todos"

---

### Requisito 5: Passo 5 — Resumo e Confirmação

**Comportamento:** Exibir resumo final antes de criar a OP.

#### Critérios:
1. Mostrar resumo:
   - Cliente: {nome} (criado/existente/sem vínculo)
   - Produto: {nome} (criado/existente/sem vínculo)
   - Materiais: X de Y vinculados
   - Centros: X de Y vinculados
2. Avisos se houver itens sem vínculo
3. Botão "Criar OP" que executa tudo:
   - Cria entidades marcadas para criação
   - Cria a OP com todos os vínculos
   - Salva De/Para para próximas importações
4. Checkbox "Salvar vínculos para próximas importações" (De/Para) — marcado por padrão

---

### Requisito 6: API Backend — Criação em lote

1. O backend já possui endpoints de criação para cada entidade (POST /clientes, POST /produtos, POST /centros-producao)
2. O frontend fará chamadas sequenciais: cria cliente → cria produto → cria materiais → cria centros → confirma OP
3. Em caso de erro em qualquer passo, exibir mensagem e permitir corrigir sem perder os dados já preenchidos

---

### Requisito 7: Navegação do Wizard

1. Botões "Anterior" e "Próximo" em cada passo
2. Indicador de progresso (stepper): Passo 1/5, 2/5, etc.
3. Se uma entidade já foi encontrada (não precisa criar), o passo é simplificado (mostra confirmação rápida)
4. Passos podem ser pulados individualmente
5. Se TODAS as entidades foram encontradas, o wizard é pulado e vai direto para confirmação
