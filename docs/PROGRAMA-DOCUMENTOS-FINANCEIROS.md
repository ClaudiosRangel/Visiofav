# Programa: Central de Documentos Financeiros — Documento-Mestre

> **FONTE ÚNICA DE VERDADE deste programa.** Toda sessão do Kiro que for
> trabalhar em lançamento de documentos financeiros DEVE ler este arquivo
> primeiro para saber a fase atual e o que já foi feito, e DEVE atualizá-lo ao
> concluir cada fase (status + data + resumo). Não perder contexto entre
> sessões é objetivo explícito deste documento.

## Objetivo

Transformar o lançamento financeiro do Vizor numa **central de documentos
tipados** nível de mercado (Totvs/Sankhya/Omie): o *tipo* do documento governa
campos, parcelas, contabilização e automação. Cobrir todos os casos comuns e
excepcionais de uma empresa: NF/boleto, despesa, folha, impostos/guias,
financiamentos parcelados, recorrências, e a ponte para a contabilidade.

## Princípio de continuidade entre sessões

1. **Sempre comece** lendo este documento + o spec da fase atual em `.kiro/specs/`.
2. **Sempre atualize** este documento ao concluir uma fase/tarefa (status/data/resumo).
3. **Uma fase = um spec** (`requirements → design → tasks`). Ordem deliberada D1→D5.
4. Cada fase entrega backend testado + frontend testado + QA E2E + deploy, e só então avança.
5. Estender o que existe, nunca reescrever. Migração idempotente no mesmo commit.

## Estado atual do código (baseline verificado em 15/09/2026)

- **ContaPagar/ContaReceber**: ricas (número doc, data emissão, categoria, centro de custo, conta financeira, parcela/total, anexo, código de barras). Falta: `tipoDocumento`, recorrência.
- **Fornecedor**: campo `cnpj` (VarChar 20, aceita CPF), sem `tipoPessoa`. Cliente usa `cpfCnpj`.
- **CategoriaFinanceira**: plano de contas GERENCIAL (RECEITA/DESPESA, hierárquico). Sem plano CONTÁBIL nem de/para.
- **Funcionario**: cadastro operacional WMS (sem salário/cargo/admissão/CPF). Folha = greenfield.
- **Contábil**: greenfield total.
- **Vizor AI** (`src/modules/ai/`): function calling (Anthropic), tools em `ai-tools.ts`, executor `ai-executor.ts`. Já tem `criar_conta_pagar`, `importar_xml_compras_real` (upload XML no chat → cache → confirmação → importa). Base para automação.
- **Inclusão de título rica**: `src/modules/financeiro/inclusao-titulo.service.ts` já existe (parcelas, parse linha digitável) — criado na sessão anterior, ainda não fiado às rotas/tela.

## Fases do programa

| Fase | Tema | Status | Spec |
|------|------|--------|------|
| **D1** | Central de Documento Financeiro tipado + fornecedor PF/PJ + formulário rico + contrato parcelado | ✅ Concluída (15/09/2026) | `financeiro-documentos-d1` |
| **D2** | Vizor AI: OCR de boleto/fatura + lançamento por documento + classificação automática | 🔲 A iniciar | `financeiro-documentos-d2-ia` |
| **D3** | Folha de pagamento (lançamento do resultado) + funcionário enriquecido | 🔲 A iniciar | `financeiro-documentos-d3-folha` |
| **D4** | Plano de contas contábil + de/para categoria→conta + partidas dobradas automáticas | 🔲 A iniciar | `financeiro-documentos-d4-contabil` |
| **D5** | Exportação contábil (ECD/Domínio/Fortes) — conecta ao F5 do roadmap | 🔲 A iniciar | `financeiro-documentos-d5-exportacao` |

## Detalhamento por fase

### D1 — Central de Documento Financeiro tipado
- `tipoDocumento` em ContaPagar/ContaReceber (NF, NFS, BOLETO, DESPESA, FOLHA, IMPOSTO, FINANCIAMENTO, RECORRENTE, REEMBOLSO, OUTRO) + `subtipo` livre.
- Fornecedor PF/PJ: detecção automática CPF(11)/CNPJ(14), validação DV, `tipoPessoa` inferido; parceiro por autocomplete (opção A) com opção de nome+documento livre.
- Formulário rico (4 blocos: Dados Gerais, Financeiros, Classificação/Pagamento, Anexos) — fia o `inclusao-titulo.service` já criado.
- Contrato/Parcelamento: entidade que consolida N parcelas (financiamento/dívida), com total, entrada, taxa, saldo devedor.

### D2 — Vizor AI autônoma
- Tools novas: lançar documento por foto/PDF de boleto (OCR + linha digitável), lançar por PDF de fatura/guia, classificação automática de categoria/centro por histórico.
- Sempre com confirmação humana (padrão do XML atual).

### D3 — Folha de pagamento (lançamento do resultado)
- Funcionário enriquecido (CPF, cargo, admissão, salário, dados bancários).
- Rotina de folha mensal: gera lote de títulos (líquido por funcionário + guias INSS/FGTS/IRRF). Vizor NÃO calcula folha — lança o resultado (importado/manual).

### D4 — Contabilidade
- Plano de contas contábil (hierárquico, código legal).
- De/para: categoria financeira → conta contábil débito/crédito.
- Geração de lançamento contábil (partidas dobradas) em cada evento (título gerado/pago).

### D5 — Exportação contábil
- SPED Contábil (ECD) + export Domínio/Fortes/Alterdata. Conecta ao F5 do roadmap.

## Log de execução

_(atualizar a cada avanço)_

- 15/09/2026 — Programa criado. Baseline verificado. `inclusao-titulo.service.ts` já existe (parcelas + parse boleto). D1 iniciando.
- 15/09/2026 — D1 spec completo. Tarefa 1 (schema) + migração 2x OK. Tarefas 2-3 (núcleo `documento-validacao.ts`, 7 testes). BACKEND D1 COMPLETO: Tarefa 4 (inclusao-titulo estendido; `contrato-parcelamento.service`), Tarefa 5 (POST rico + interpretar-boleto + /contratos), Tarefa 6 (13 testes). FRONTEND D1 COMPLETO: `lib/financeiro/documento.ts` (7 testes), `ParceiroAutocomplete` (PF/PJ dinâmico), `DocumentoFinanceiroForm` (4 blocos) integrado em pagar/receber, tela `/financeiro/contratos` (saldo devedor). Build front OK. QA `test_45` criado. PRÓXIMO: deploy + rodar QA contra produção (ambiente local de teste instável nesta sessão — validar QA pós-deploy).
- **D1 CONCLUÍDA.** Próxima fase: D2 (Vizor AI — OCR de boleto/fatura + lançamento autônomo).
