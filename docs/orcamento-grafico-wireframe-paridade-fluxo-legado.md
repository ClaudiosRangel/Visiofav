# Wireframes — Paridade do fluxo Orçamento / Cálculo Padrão (para aprovação)

Status: AGUARDANDO APROVAÇÃO. Nada implementado.

## Dois momentos separados

```
VENDAS → Orçamento
 ├─ Orçamentos (manutenção)      ← COMERCIAL: cliente, itens, fechamento, comissões
 ├─ Cálculo Padrão               ← ENGENHARIA: biblioteca de cálculos reutilizáveis
 ├─ Listagem de Cálculos         ← consulta/relatório (fase posterior)
 ├─ Emissão de Pré-Cálculo       ← memória de cálculo em PDF (fase posterior)
 └─ Propostas
```

Regra: o item do orçamento É um cálculo próprio (cópia do padrão). Editar o item
nunca altera o cálculo padrão de origem.

## Tela 1 — Orçamento (novo, em branco)

```
Orçamento  Série [____]  Nº [auto]  Data [19/11/2026]
Cliente Principal [Código][ Nome ............ ][🔍 Pesquisar]
Itens do Orçamento
 item | Cálculo | Linha | Tipo | Tiragens | Descrição | Status
 (vazio)
[Incluir item] [Copiar] [Excluir]            [Salvar]
```
- Só grava no banco ao clicar Salvar.
- Escolher cliente com observação abre modal "Observações da Empresa" (OK).

## Tela 2 — Incluir item: Linha de Produto

```
┌ Novo Item — Selecione a Linha de Produto ┐
│  ( ) CARTUCHO        ( ) CARTUCHO COMPOSTO │
│  ( ) LÂMINA SIMPLES  ( ) LÂMINAS  ( ) SACOLA│
│                      [Confirmar] [Cancelar] │
└─────────────────────────────────────────────┘
```
Confirmar → abre a Tela 3 já filtrada pela linha. Cancelar → também abre a Tela 3
(sem filtro de linha), como no legado.

## Tela 3 — Cálculo Padrão (seletor dentro do orçamento)

```
Cálculo Padrão
Cliente [ ] Sem cliente definido  [Código][Nome ........][🔍]
Linha [LÂMINAS ▼]  Produto [▼]  Descrição [......]
Sigla Acabado [....]  Nº cálculo [12992]  [ ] Cálculo cancelado   [Buscar]
┌───────────────────────────────────────────────────────────────────┐
│☑ Cliente  Linha  Produto  Descrição  Formato Final  Sigla  Tiragem Nº │
│☑ GERDAU…  LÂMINAS Impressos RÓTULO…  190 x 1200  (vários) 4.000 12992│
└───────────────────────────────────────────────────────────────────┘
Quantidade de cálculos: 1                          [✓ Usar] [Sair]
```
[✓ Usar] → cria um cálculo NOVO por cópia (ex.: 15680) e lança o item na grade.

## Tela 4 — Orçamento com o item lançado

```
item | Cálculo | Linha   | Tipo      | Tiragens | Descrição            | Status
 1   | 15680   | LÂMINAS | Impressos | 4.000    | RÓTULO P/FARPADO…    | Liberado
Dados do Item (1º item já selecionado): formato, suporte, cores, acabamentos…
[Fechamento] [Comissões]
 Tiragem | Margem | C.Marg. | Valor Unitário | Valor Total
 4.000   | 47,62% | 55,01%  | 3,77101        | 15.084,04
```
Duplo clique no item → Tela 5.

## Tela 5 — Editor do item/cálculo (mesma tela no orçamento e no Cálculo Padrão)

```
Editor — Cálculo Nº 15680   Linha [LÂMINAS]  Tiragem [4000 ▼]  Sigla [(vários)]
Produto   | Tiragem | Formato   | Acabamento
Impressos | 4.000   | 190x1200  |
Planos (grid)  [Incluir][Copiar][Excluir][Reordenar]
 Base | 4.000 | Stora Enzo Bobina 415 | 190x1200 | 3x0 Offset Plana | Cortadeira…
Atividades de Acabamento: ☑ Cortadeira (Grande) ☑ Laminação maior ☑ Guilhotina de envol …
[Itens Diversos] [Itens Fornecidos] [Campos Livres] [Observação]
```
Clicar no plano → Tela 6 (já existe como TelaPlano).

## Tela 6 — Plano (já existe; só passa a vir preenchida)
Suporte, formato de corte, cores/cobertura, atividades e custo do plano, vindos do
cálculo copiado (hoje o plano "Base" nasce vazio).

## Tela 7 — Menu Cálculo Padrão (biblioteca, fora do orçamento)

```
Cálculo Padrão (mesmos filtros da Tela 3)         [Incluir][Editar][Copiar][Cancelar]
lista de cálculos…
```
- Editar abre a Tela 5 sobre o cálculo.
- Cálculo migrado (ancorado): editar gera cálculo NOVO (cópia); o original fica intacto.

## Ordem de implementação
1. Orçamento: Telas 1–4 + cópia por item + produto/margem/CM/estrutura ao puxar.
2. Menu Cálculo Padrão + editor (Telas 5–7) reaproveitando Item/Plano.
3. Listagem de Cálculos e Pré-Cálculo PDF.
