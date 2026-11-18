# Orçamento Gráfico — hierarquia Item/Plano: ponto P3 (regra de plano fixo)

Spec: `.kiro/specs/orcamento-grafico-hierarquia-item-plano` · Tarefa 1.1 · Requisitos 15.8, 15.9.
Status: **decisão P3 CONFIRMADA em 17/11/2026: seguir a regra R8.4.** Medição feita em 17/11/2026 na empresa Carton Wega, somente leitura.

## O que muda

| Regra | Definição | Onde |
|---|---|---|
| Atual (editor) | Plano único se algum tipo permitido tem `fixo = true` **ou** se o produto permite um único tipo de plano, mesmo não fixo. | front `editor/catalogo/catalogo-puro.ts` (`planoFixoDoCatalogo`) |
| Nova (R8.4) | Plano único **somente** se algum `TipoPlanoGrafico` permitido tem `fixo = true`. | `resolverLayoutItem` (Fase 2) |

Produto afetado = tem **exatamente 1** tipo de plano permitido e esse tipo **não** é fixo. Hoje a tela o trata como plano único. Pela regra nova passa a ser multi-plano (aparece o grid de planos).

## Decisão P3

**Confirmada em 17/11/2026 pelo usuário: seguir R8.4.** O cadastro decide, sem exceção implícita para "único tipo permitido".

## Produtos afetados (medição de 17/11/2026)

Dos 11 produtos ativos da Carton Wega, **1** muda de plano único para multi-plano:

| Produto (código) | Tipo de plano único permitido | Estrutura hoje | Estrutura pela regra nova |
|---|---|---|---|
| Invólucros (`CG-PROD-6`, 3 dimensões) | Invólucros (`fixo = false`) | Plano único | **Multi-plano** |

**Ação antes da Fase 2:** se o comportamento atual (plano único) deve ser preservado para Invólucros, marcar o tipo de plano "Invólucros" como `fixo` no cadastro. Se não for marcado, o item de Invólucros passa a exibir o grid de planos.

Quadro completo (tipos permitidos e `fixo` por produto):

| Código | Produto | Modo formato | Tipos permitidos | Fixos | Hoje | Regra nova |
|---|---|---|---|---|---|---|
| CG-PROD-1 | Cartuchos | 3 dimensões | CARTUCHO | 1 | Plano único | Plano único |
| CG-PROD-2 | Cartucho Composto | 3 dimensões | Cartão, Microondulado | 0 | Multi | Multi |
| CG-PROD-3 | Sacola | 3 dimensões | SACOLA | 1 | Plano único | Plano único |
| CG-PROD-4 | Cartelas | 2 dimensões | Cartão, Microondulado | 0 | Multi | Multi |
| CG-PROD-5 | Caixa | 3 dimensões | Berço, Cartão, Microondulado | 0 | Multi | Multi |
| CG-PROD-6 | Invólucros | 3 dimensões | Invólucros | 0 | Plano único | **Multi** |
| CG-PROD-7 | Impressos | aberto/fechado | LÂMINA SIMPLES | 1 | Plano único | Plano único |
| CG-PROD-8 | Envelope | 3 dimensões | Base, Envelope, Impressos | 0 | Multi | Multi |
| CG-PROD-9 | Display | 3 dimensões | Base, Envelope, Impressos | 0 | Multi | Multi |
| CG-PROD-11 | Impressos | 3 dimensões | Base, Envelope, Impressos | 0 | Multi | Multi |
| CG-PROD-12 | Venda de Cartão | 2 dimensões | LÂMINA SIMPLES | 1 | Plano único | Plano único |

## Classificação de T1 a T5

Derivada do cadastro: cálculo → `tipo_embalagem_id` → `produto_grafico` → `TipoPlanoGrafico.fixo`.

| Item | Cálculo | Produto no cadastro | Planos na foto | Classificação (R8.4) |
|---|---|---|---|---|
| T1 | 12992 | CG-PROD-11 Impressos (linha LÂMINAS) | 1 | Multi-plano (nenhum tipo fixo). Ver ponto aberto 1. |
| T2 | 13296 | CG-PROD-1 Cartuchos | 1 | Plano único (tipo CARTUCHO fixo) |
| T3 | 11122 | CG-PROD-2 Cartucho Composto | 2 | Multi-plano |
| T4 | 12540 | CG-PROD-2 Cartucho Composto | 2 | Multi-plano |
| T5 | sintético | — | 2 | Multi-plano (criado na fixture) |

Cobertura mínima exigida (1 plano único + 1 multi-plano): atendida por T2 (único) e T3, T4, T5 (multi).

## Valores medidos (T1 a T4)

Fonte: `calculo_grafico` da Carton Wega, SELECT em transação READ ONLY. Cada cálculo migrado tem uma única tiragem (a coluna `quantidade`).

| Item | Cálculo | Tiragem | Custo de produção (foto) | Valor total | Confere com o validado |
|---|---|---|---|---|---|
| T1 | 12992 | 4.000 | 5.192,05 | 15.084,04 | sim |
| T2 | 13296 | 300 | 357,14 | 477,46 | sim |
| T3 | 11122 | 100.000 | 60.407,80 | 100.744,92 | sim |
| T4 | 12540 | 15.000 | 9.236,32 | 18.150,00 | sim |

O 15.084,04 do T1 é o mesmo valor do PedidoVenda gerado na validação de 23/10/2026.

## Divergências e pontos abertos

1. **T1 (12992) muda de classificação.** A fixture dizia plano único. O cadastro liga o cálculo ao produto CG-PROD-11 "Impressos" (3 dimensões, sem tipo fixo), que é multi-plano pela R8.4. A foto do cálculo tem 1 plano, então o comportamento atual do item é de plano único. Opções para a Fase 2: (a) aceitar que T1 passa a abrir como multi-plano com 1 plano; (b) revincular o cálculo ao CG-PROD-7 "Impressos" (aberto/fechado, LÂMINA SIMPLES, fixo). Decisão do usuário.
2. **Coluna `custo_producao` difere da foto.** A coluna é menor que `resultado_calculo.custos.custoProducao` em todos os quatro (5.104,36 contra 5.192,05; 354,83 contra 357,14; 59.110,80 contra 60.407,80; 9.068,14 contra 9.236,32). A diferença é o crédito de IPI, já descrito no steering. O valor validado contra o legado é o da foto. Nenhum dado foi alterado.
3. **Sem Fechamento por tiragem.** Os cálculos migrados guardam uma tiragem só. O legado pode ter mostrado outras tiragens, mas elas não foram migradas, então o baseline de T1 a T4 tem uma linha por item.

## Como a medição foi feita

`scripts/baseline-hierarquia-medir.mjs` abre `BEGIN READ ONLY`, executa só `SELECT` e termina com `ROLLBACK`. A conexão foi passada por variável de ambiente da sessão e removida ao final; nada foi gravado em arquivo do repositório. Para repetir:

```powershell
$env:BASELINE_DATABASE_URL = "<string de conexão somente-leitura>"
node scripts/baseline-hierarquia-medir.mjs <empresaId>
Remove-Item Env:BASELINE_DATABASE_URL
```

T5 é sintético e foi medido com o motor atual (entradas em `src/modules/orcamento-grafico/hierarquia/t5-entrada.ts`). O teste `custo-baseline.fixture.test.ts` recalcula T5 e exige diferença 0,00 em centavos.
