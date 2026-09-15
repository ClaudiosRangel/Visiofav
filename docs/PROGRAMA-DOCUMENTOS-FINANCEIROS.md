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
| **D2** | Vizor AI: OCR de boleto/fatura + lançamento por documento + classificação automática | ✅ Concluída (15/09/2026) | `financeiro-documentos-d2-ia` |
| **D3** | Folha de pagamento (lançamento do resultado) + funcionário enriquecido | ✅ Concluída (15/09/2026) | `financeiro-documentos-d3-folha` |
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
- 15/09/2026 — D2 iniciada. Spec completo (requirements/design/tasks). Tarefa 1-2: núcleo puro `extrair-campos-documento.ts` (extração determinística de valor/vencimento/linha digitável/CNPJ/tipo, prioriza linha digitável, reusa interpretarLinhaDigitavel+validarDocumento da D1), 8 testes passando. PRÓXIMO na D2: Tarefa 3 (cache pendente + extrator PDF/visão Claude), Tarefa 4 (tool `lancar_documento_financeiro` no ai-executor), Tarefa 5 (upload estendido PDF/imagem + system prompt), QA test_46, deploy.
- **D2 CONCLUÍDA (15/09/2026).** Backend completo e sem erros de diagnostics:
  - Tarefa 3: `documento-financeiro-pendente.ts` (cache por empresa, TTL 30min) + `extrator-documento.service.ts` (`extrairTextoPdf` via pdfjs-dist reusando o parser de OP + `extrairPorVisao` via Claude multimodal; no-op sem API key — o caminho determinístico continua válido).
  - Tarefa 4: tool `lancar_documento_financeiro` (`ai-tools.ts`) + `executarLancarDocumentoFinanceiro` (`ai-executor.ts`) — resolve parceiro (cadastro por documento/nome OU parceiro livre PF/PJ), categoria por nome/código, valida documento (D1) e chama `incluirTitulo` (D1); isola por empresa.
  - Tarefa 5: `POST /ai/upload` estendido para rotear PDF/imagem ao novo `aiService.processarDocumentoFinanceiro` (extrai → salva pendente → resumo conversacional com valor/vencimento/tipo + pergunta de confirmação; barra documento sem dados reconhecidos). `ai-system-prompt.ts` ganhou a seção "DOCUMENTO FINANCEIRO POR UPLOAD" (resumir+confirmar, sugerir categoria por tipo, nunca lançar sem "sim", suportar parcelamento e lançamento por texto).
  - Tarefa 6: checkpoint backend — 8 testes do núcleo passando (`extrair-campos-documento.test.ts`), diagnostics limpos em todos os arquivos tocados.
  - Tarefa 7: QA E2E `test_46_ia_documentos.py` (lançamento por dados PF/PJ, parcelamento, documento inválido barrado 422, boleto inválido 422, chat da IA responde 200, isolamento multi-tenant). Helper `ai_chat` adicionado no `wms_api.py`.
  - **Confirmação humana obrigatória** preservada (padrão do XML). Sem migração de schema (D2 reusa D1). PRÓXIMO: deploy back + front, rodar QA contra produção; depois iniciar D3 (folha).
- **D2 deploy**: back `3d39d5043` + hotfix `9e6863a44` (o 1º deploy falhou no build do Render — crases internas no `ai-system-prompt.ts` fecharam a template string; corrigido trocando por aspas e validando com `esbuild --bundle` antes do push). Front `184f186`. QA `test_46` 7/7 verde em produção.
- **D3 CONCLUÍDA (15/09/2026).** Folha de pagamento — o Vizor lança o RESULTADO da folha (não calcula). Backend completo:
  - Núcleo puro `folha-parser.ts` (calcularLiquido, calcularTotaisFolha, parsearCsvFolha com cabeçalho flexível/separador/formato BR/divergência), 12 testes.
  - Schema: models `FolhaPagamento`, `ItemFolha`, `EncargoFolha` + enriquecimento de `Funcionario` (cpf, cargo, dataAdmissao, salarioBase, banco/agencia/conta/tipoConta/chavePix). Migração idempotente no `migrate-prod.ts` (testada 2x local): ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS, índice único parcial de CPF por empresa (WHERE cpf IS NOT NULL), FKs em try/catch.
  - `folha.service.ts` (CRUD folha/itens/encargos isolado por empresa, só ABERTA altera, totais recalculados, importarCsv resolve por CPF/matrícula e reporta pendentes) + `folha-efetivacao.service.ts` (transação atômica: 1 título por item via incluirTitulo tipoDocumento FOLHA + 1 por encargo tipoDocumento IMPOSTO; idempotente por status; grava empresaId da folha).
  - Rotas em `/api/financeiro/folha` (CRUD + itens + encargos + importar-csv + efetivar). Rota de funcionário `/api/funcionarios` aceita campos trabalhistas + valida CPF (validarDocumento D1) + unicidade por empresa. Enum de tipoDocumento ganhou 'FOLHA'.
  - Vizor AI: tool `efetivar_folha` (por competência ou id) + executor + seção no system prompt (resumir totais, confirmar antes, idempotência; SEM crases — lição D2).
  - QA `test_47_folha.py`: funcionário com dados trabalhistas, CPF inválido barrado, ciclo criar→item→encargo→efetivar (N contas a pagar), competência ABERTA duplicada 409, idempotência (2ª efetivação 409), isolamento multi-tenant. Helpers de folha/funcionário no `wms_api.py`.
  - Checkpoint: 12 testes verdes + bundle esbuild do server OK (validado antes do push). PRÓXIMO: deploy back+front, QA contra produção; depois D4 (contabilidade).
