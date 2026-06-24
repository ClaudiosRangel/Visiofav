# Tarefas — Auto-Cadastro durante Importação de OP (Wizard)

## Task 1: Refatorar página importar-op para incluir wizard após preview
- [x] Adicionar estado `wizardStep` após o preview
- [x] Fluxo: upload → preview → wizard (5 passos) → sucesso

## Task 2: Passo 1 — Cliente
- [x] Componente WizardStepCliente
- [x] Se sugestão existe: confirmação rápida
- [x] Se não: formulário criar (razão social, cpf/cnpj) ou vincular existente ou pular

## Task 3: Passo 2 — Produto Acabado
- [x] Componente WizardStepProduto
- [x] Formulário com código, nome, unidade pré-preenchidos do PDF

## Task 4: Passo 3 — Materiais
- [x] Componente WizardStepMateriais
- [x] Tabela com todos materiais, checkbox "Criar" para não-encontrados
- [x] Campos inline: código sugerido, nome, unidade, classificação
- [x] Botão "Criar Todos"

## Task 5: Passo 4 — Centros/Máquinas
- [x] Componente WizardStepCentros
- [x] Tabela com etapas/máquinas
- [x] Criação inline com código sugerido, descrição, tipo

## Task 6: Passo 5 — Resumo e Confirmação
- [x] Componente WizardStepResumo
- [x] Resumo de tudo que será criado
- [x] Botão final "Criar OP"
- [x] Lógica de criação sequencial: cliente → produto → materiais → centros → confirmar OP
