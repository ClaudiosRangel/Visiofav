# Requirements Document

Finalização do Orçamento Gráfico (paridade Calcgraf pronta para uso).

## Introduction

O módulo Orçamento Gráfico já existe e funciona ponta a ponta (wizard de 7 passos
→ cálculo → salvar/enviar → gerar OP). A calibração contra o Calcgraf
(`docs/calcgraf-custo-transformacao.md`, `docs/calcgraf-consumo-tinta.md`)
decifrou e validou os modelos reais de **Custo de Transformação** (acerto por cor
+ produção × custo-hora) e **Consumo de Tinta** (SPANKS + partida), mas esses
modelos vivem em módulos puros isolados (`custo-transformacao.ts`,
`consumo-tinta.ts`) e **ainda não estão plugados** no motor que o wizard usa
(`calcularOrcamentoGrafico`). Além disso, faltam no cadastro os parâmetros que
esses modelos exigem (acerto por cor por máquina, coeficiente de tinta por
suporte), e os **vendedores** da Carton Wega ainda não foram importados do
Calcgraf.

Esta spec finaliza o módulo para uso real na Carton Wega: liga a calibração ao
motor, adiciona os cadastros necessários e importa os vendedores. A importação de
**produtos/SKUs fica fora de escopo** (decisão a tratar depois).

## Escopo

**Dentro do escopo:**
1. Campos de cadastro novos para alimentar os modelos calibrados (máquina:
   acerto por cor, setup; suporte/papel: coeficiente de tinta; tinta: densidade).
2. Integração dos modelos calibrados (CT + tinta SPANKS) ao motor
   `calcularOrcamentoGrafico`, de forma aditiva e com fallback (sem quebrar os
   testes existentes nem orçamentos salvos).
3. Telas/campos de cadastro no frontend para os parâmetros novos.
4. Importação dos vendedores do Calcgraf (fase nova no importador).

**Fora do escopo (tratado depois):**
- Importação de produtos/SKUs de clientes do Calcgraf (conflita com decisão
  anterior; `Produto` é compartilhado com PCP em produção).
- Troca da lista fixa de acabamentos por cadastro (pendência separada, pode ser
  incluída se o usuário pedir).

## Glossary

- **CT (Custo de Transformação):** custo de máquina = (tempo de acerto + tempo de produção) × custo-hora.
- **SPANKS:** fórmula clássica da indústria para consumo de tinta offset.
- **CoefTinta:** coeficiente de tinta por tipo de suporte (fator "Stock" do SPANKS).
- **Partida de consumo de tinta:** consumo fixo/arranque por cor (0,2 kg no Calcgraf da Wega).
- **CEV:** Custos de Venda (ICMS + juros + Pis/Cofins + comissões).
- **CM:** Contribuição Marginal.

## Requirements

### Requisito 1 — Parâmetros de máquina para o Custo de Transformação

**História:** Como orçamentista da Carton Wega, quero que cada máquina de
impressão tenha o tempo de acerto por cor e o setup cadastrados, para que o
cálculo reproduza o Custo de Transformação do Calcgraf em vez de usar 30 min
fixos.

#### Critérios de aceitação
1. QUANDO um `CentroProducao` do tipo IMPRESSÃO é cadastrado/editado, ENTÃO o
   sistema DEVE permitir informar `acertoPorCorMin` (minutos de acerto por cor).
2. O sistema DEVE permitir informar um `tempoSetupMin` (acerto fixo/1º acerto)
   por centro, usado para acabamentos e como fallback.
3. QUANDO o motor calcular o CT de uma etapa de impressão, ENTÃO DEVE usar
   `cores × acertoPorCorMin + tempoSetupMin` (regra validada em 52/53 cálculos).
4. QUANDO os campos novos não estiverem preenchidos, ENTÃO o sistema DEVE manter
   o comportamento atual (fallback para setup fixo) sem erro.
5. A alteração de schema DEVE vir acompanhada da entrada equivalente idempotente
   em `prisma/migrate-prod.ts` (regra `database-migrations`).

### Requisito 2 — Coeficiente de tinta por suporte e densidade

**História:** Como orçamentista, quero que cada papel/suporte tenha seu
coeficiente de tinta (fator Stock do SPANKS) e que a tinta tenha densidade, para
que o consumo de tinta seja calculado como no Calcgraf.

#### Critérios de aceitação
1. O sistema DEVE ter um cadastro de **Suporte** dedicado (model novo
   `SuporteGrafico`) com `coefTinta`, `tipoSuporte` (CARTÃO/KRAFT/OFFSET/...),
   e gramaturas/formatos disponíveis; o papel (PrecoMateriaPrima tipo PAPEL) DEVE
   poder referenciar um suporte (`suporteId` opcional).
2. O sistema DEVE permitir informar a densidade da tinta por cor/tinta (default
   1,0; process 1,3), usada na fórmula SPANKS.
3. QUANDO o motor calcular a tinta, ENTÃO DEVE usar o modelo SPANKS
   (`CoefSuporte × 0,5 × área × lados × cobertura × densidade / 353`) + partida
   (`0,2 kg × cores × ocorrências`) quando os parâmetros estiverem presentes.
4. QUANDO o `coefTinta` não estiver preenchido, ENTÃO o sistema DEVE usar o
   modelo atual (`rendimentoM2Kg`) como fallback, sem quebrar.
5. O parâmetro global "Partida de consumo de tinta" (0,2 kg) DEVE ser
   configurável (default 0,2) e não hardcoded fora do módulo.

### Requisito 3 — Integração calibrada no motor de cálculo

**História:** Como orçamentista, quero que o cálculo do wizard use a fórmula
calibrada do Calcgraf, para que o preço gerado bata com o sistema antigo.

#### Critérios de aceitação
1. QUANDO `POST /orcamento-grafico/calcular` for chamado com os parâmetros novos
   disponíveis, ENTÃO o motor DEVE usar `custo-transformacao.ts` e
   `consumo-tinta.ts` para CT e tinta.
2. O resultado DEVE continuar expondo a decomposição MD/CT/SE/CEV/CM já existente
   no `ResultadoOrcamento` (sem regressão de contrato).
3. TODOS os testes existentes (`orcamento-grafico` — 77 atuais) DEVEM continuar
   passando; os testes de calibração (CT + tinta) permanecem verdes.
4. A rota `POST /simular-tiragens` DEVE usar o mesmo caminho de cálculo (hoje ela
   diverge: não repassa paridade e usa setup fixo) — unificar.
5. O setup hardcoded de 30 min DEVE ser removido do caminho novo (lido do
   cadastro).

### Requisito 4 — Importação de vendedores do Calcgraf

**História:** Como administrador da Carton Wega, quero importar os vendedores do
Calcgraf, para que apareçam no seletor de vendedor do orçamento e no Portal
Representante.

#### Critérios de aceitação
1. O importador DEVE ter uma fase `vendedores` (`scripts/importar-calcgraf.ts
   --fase vendedores`) que lê `cartoon/export/Vendedores.json` (39 registros).
2. O de-para DEVE ser por **nome** quando o CPF estiver ausente/inválido (a
   maioria dos registros não tem CPF), e por CPF quando válido. NUNCA duplicar
   um vendedor já existente.
3. QUANDO um vendedor do JSON já existir (por nome ou CPF), ENTÃO o sistema DEVE
   apenas enriquecer campos vazios (e-mail/telefone/comissão), nunca sobrescrever.
4. Vendedores com `Ativo = "CANCELADO"` DEVEM ser importados com `status=false`.
5. O campo obrigatório `comissao` DEVE receber um default (ex.: 0) quando ausente.
6. A fase DEVE ser idempotente (2ª execução: 0 criados) e suportar `--dry-run`.
7. Após importados, os vendedores DEVEM aparecer em `GET /vendedores` (já
   consumido pelo `StepCliente`), sem mudança no frontend.
8. O import DEVE criar `RepresentanteCredencial` (acesso ao Portal Rep, vinculado
   ao `Vendedor`) para os vendedores que tiverem **e-mail válido**; vendedores sem
   e-mail válido entram apenas como `Vendedor`. A credencial recebe
   `senhaTemporaria=true` com senha inicial aleatória (primeiro acesso força
   troca), sem sobrescrever credencial existente com o mesmo e-mail/vendedor.
   (O Portal Rep usa `RepresentanteCredencial`, não o model `Usuario`.)

### Requisito 5 — Segurança multi-tenant e produção

**História:** Como responsável técnico, quero que nada vaze entre empresas nem
afete produção indevidamente.

#### Critérios de aceitação
1. TODAS as queries novas DEVEM filtrar por `empresaId` explícito (regra
   `ATENCAO-pontos-verificar`).
2. O importador de vendedores DEVE usar o `empresaId` da Carton Wega validado por
   CNPJ, com `--dry-run` por padrão e `--apply` para efetivar.
3. Validação em LOCAL antes de qualquer execução em produção (Neon via env fora
   do git), com confirmação explícita do usuário.
4. A mudança de schema DEVE ser testada rodando `migrate-prod.ts` 2× local
   (idempotência).
