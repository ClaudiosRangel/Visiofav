# Documento de Requisitos — Importação de OP via PDF (GPrint/Calcograf)

## Introdução

Este documento especifica os requisitos para importação de Ordens de Produção a partir de arquivos PDF gerados por sistemas externos (GPrint/Calcograf). O objetivo é permitir que empresas que migram de outros ERPs gráficos possam importar suas OPs existentes para o VisioFab sem redigitação manual, extraindo automaticamente os dados estruturados do PDF e criando a OP completa com materiais, etapas e informações de produção.

## Glossário

- **Sistema**: O backend VisioFab.Wms.Back (Fastify + Prisma + PostgreSQL)
- **GPrint**: Sistema ERP de indústria gráfica da Calcograf, que gera PDFs de OP com layout padronizado
- **PDF de OP**: Arquivo PDF impresso/exportado contendo todos os dados de uma Ordem de Produção
- **Parser**: Módulo que extrai texto do PDF e identifica os campos estruturados
- **Mapeamento**: Correspondência entre campos do sistema externo e campos do VisioFab
- **OrdemProducao**: Entidade destino no VisioFab
- **ItemOrdemProducao**: Materiais necessários extraídos do PDF
- **EtapaOrdemProducao**: Etapas do roteiro extraídas do PDF (Impressão, Acabamentos)
- **DePara**: Tabela de correspondência entre códigos/nomes do sistema externo e IDs internos do VisioFab

## Requisitos

### Requisito 1: Upload e Extração de Texto do PDF

**User Story:** Como planejador de produção, quero fazer upload de um PDF de OP gerado pelo GPrint, para que o sistema extraia automaticamente os dados sem que eu precise redigitar.

#### Critérios de Aceitação

1. THE Sistema SHALL fornecer um endpoint `POST /api/pcp/importar-op-pdf` que aceita upload de arquivo PDF (multipart/form-data) com limite de 10MB
2. THE Sistema SHALL extrair o texto completo do PDF usando biblioteca de parsing (pdf-parse ou similar)
3. THE Sistema SHALL suportar PDFs com texto selecionável (gerados digitalmente) como formato primário
4. THE Sistema SHALL retornar erro 400 com mensagem descritiva se o arquivo não for PDF válido ou estiver corrompido
5. THE Sistema SHALL registrar o upload em log com: nomeArquivo, tamanho, usuarioId, dataHora, resultado (sucesso/erro)
6. THE Sistema SHALL aceitar PDFs de múltiplas páginas (a OP do GPrint pode ter 2+ vias na mesma página ou continuação)
7. IF o PDF não contiver texto extraível (imagem escaneada), THEN THE Sistema SHALL retornar erro 422 com mensagem "PDF não contém texto extraível. Use um PDF gerado digitalmente ou envie para OCR."

---

### Requisito 2: Identificação do Layout/Sistema de Origem

**User Story:** Como sistema, quero identificar automaticamente qual sistema gerou o PDF, para aplicar o parser correto.

#### Critérios de Aceitação

1. THE Sistema SHALL detectar automaticamente o sistema de origem pelo conteúdo do PDF, procurando por marcadores conhecidos:
   - GPrint/Calcograf: contém "GPrint - Sistema Calcograf" no cabeçalho
   - Outros sistemas futuros: extensível via padrão Strategy
2. IF o sistema de origem não for identificado, THEN THE Sistema SHALL retornar os dados brutos extraídos em formato JSON para mapeamento manual pelo usuário
3. THE Sistema SHALL suportar múltiplos parsers registrados, selecionados automaticamente pelo marcador detectado
4. THE Sistema SHALL retornar no response o campo `sistemaOrigem` indicando qual parser foi utilizado

---

### Requisito 3: Parser GPrint — Extração de Dados do Cabeçalho

**User Story:** Como planejador de produção, quero que o sistema extraia automaticamente os dados do cabeçalho da OP (número, cliente, produto, quantidade, datas), para que a OP seja criada com informações corretas.

#### Critérios de Aceitação

1. THE Sistema SHALL extrair do cabeçalho do PDF GPrint os seguintes campos:
   - Número da OP (campo "O.P.:" — ex: "2.849 R")
   - Cliente (campo "Cliente:" — código e nome)
   - Código do Cliente (campo "Cód. Cliente:")
   - Produto (campo "Produto:")
   - Descrição completa (campo "Descrição:")
   - Formato Final (campo "Formato Final:" — largura x altura x comprimento em mm)
   - Quantidade (campo "Quantidade:" — valor numérico, ignorando excedente)
   - Excedente (percentual ou quantidade extra)
   - Número do Pedido (campo "Pedido:")
   - Código Acabado (campo "Cód. Acabado:")
   - Vendedor (campo "Vendedor:")
   - Cálculo interno (campo "Cálculo:")
2. THE Sistema SHALL tratar variações de formatação (pontos como separador de milhar, vírgula como decimal)
3. THE Sistema SHALL extrair a Programação de Entrega se presente (datas parciais com quantidades)
4. IF algum campo obrigatório não for encontrado, THEN THE Sistema SHALL marcar como `null` e incluir aviso no response

---

### Requisito 4: Parser GPrint — Extração de Materiais (BOM)

**User Story:** Como planejador de produção, quero que o sistema extraia automaticamente a lista de materiais (papel, tintas, vernizes, colas), para que a OP tenha a BOM completa.

#### Critérios de Aceitação

1. THE Sistema SHALL extrair da seção "Materiais" do PDF os seguintes dados por item:
   - Descrição do material (ex: "Stora Enzo Bobina 222")
   - Quantidade (decimal)
   - Unidade de medida (KG, PC, UN, etc.)
2. THE Sistema SHALL extrair da seção de cálculo de matéria-prima:
   - Material principal (tipo de papel/bobina)
   - Formato da folha/bobina (largura x comprimento em mm)
   - Gramatura (g/m²)
   - Quantidade em KG calculada
   - Aproveitamento (produtos por folha)
   - Quantidade de folhas totais
3. THE Sistema SHALL extrair tintas com suas proporções:
   - Escala CMYK com percentual (ex: "(CMYK) (60%)" = 94,63 KG)
   - Cores Pantone com código e percentual (ex: "CW0288 - AMARELO (40%)" = 62,75 KG)
   - Número de cores (campo "CD 7 Cores")
4. THE Sistema SHALL extrair materiais auxiliares: Cola, Verniz Primer, Verniz UV, Faca, etc.
5. EACH material extraído SHALL conter: descricao, quantidade, unidade, tipo (PAPEL, TINTA, VERNIZ, COLA, FACA, OUTRO)

---

### Requisito 5: Parser GPrint — Extração de Etapas de Produção (Roteiro)

**User Story:** Como planejador de produção, quero que o sistema extraia as etapas de produção (impressão, acabamentos, cortadeira), para que o roteiro da OP seja montado automaticamente.

#### Critérios de Aceitação

1. THE Sistema SHALL extrair da seção "Impressão" do PDF:
   - Tipo de impressão (ex: "Offset Plana Heidelberg CD 7cores")
   - Tempo fixo (setup) em formato HH:MM
   - Tempo variável (operação) em formato HH:MM
2. THE Sistema SHALL extrair da seção "Acabamentos" cada etapa com:
   - Descrição da operação (ex: "AFT70 (Cortadeira) Lateral Simples")
   - Sub-operação/detalhe (ex: "Colagem Lateral")
   - Tempo fixo (setup)
   - Tempo variável (operação)
   - Informações adicionais (ex: "Matriz: 2551B - Faca Nova", "Verniz UV - Reserva na Aba de cola")
3. THE Sistema SHALL montar a sequência de etapas na ordem em que aparecem no PDF
4. THE Sistema SHALL identificar a máquina/centro produtivo de cada etapa pelo nome (ex: "Heidelberg CD" → centro de impressão)
5. THE Sistema SHALL extrair observações de produção (campo "Obs.:" e "Seguir contratual")

---

### Requisito 6: Parser GPrint — Extração de Informações de Cortadeira/Montagem

**User Story:** Como planejador, quero que os dados de corte e montagem sejam extraídos para registro completo da OP.

#### Critérios de Aceitação

1. THE Sistema SHALL extrair da seção "Cortadeira":
   - Linhas de corte com: quantidade de folhas, gramatura, dimensões, observação (ex: "entrando direto em máquina")
   - Total de folhas
2. THE Sistema SHALL extrair da seção "Montagem":
   - Descrição da montagem (ex: "Cartucho Super Fresh 90G Menta - (21) - 2.200.000 un")
   - Aproveitamento por folha
   - Quantidade total
3. THE Sistema SHALL extrair informações de formato/layout:
   - LXL (Largura x Largura) ou formato de imposição (ex: "21 - 68,4 X 99,0 CM")
4. THE Sistema SHALL extrair informações de bobina quando aplicável:
   - Bobinas em estoque vs. encomendadas (com peso e dimensões)

---

### Requisito 7: Pré-visualização e Confirmação

**User Story:** Como planejador de produção, quero visualizar os dados extraídos antes de confirmar a criação da OP, para corrigir eventuais erros de interpretação.

#### Critérios de Aceitação

1. THE Sistema SHALL retornar os dados extraídos em formato JSON estruturado SEM criar a OP imediatamente (modo preview)
2. THE response SHALL incluir: dadosExtraidos (todos os campos parseados), avisos (campos não encontrados ou com baixa confiança), sugestoes (matches com produtos/clientes existentes no sistema)
3. THE Sistema SHALL fornecer um endpoint separado `POST /api/pcp/importar-op-pdf/confirmar` que recebe os dados (possivelmente editados pelo usuário) e cria efetivamente a OP
4. THE Sistema SHALL permitir que o usuário corrija campos antes da confirmação (ex: vincular clienteId correto, ajustar quantidade)
5. THE Sistema SHALL manter os dados extraídos em cache temporário (TTL 30 min) para que o usuário possa revisar sem re-uplodar o PDF
6. THE response SHALL incluir campo `confianca` (percentual) indicando quantos campos obrigatórios foram extraídos com sucesso

---

### Requisito 8: Criação da OP a partir dos Dados Importados

**User Story:** Como planejador de produção, quero que ao confirmar a importação o sistema crie a OP completa com todos os materiais e etapas, para que eu possa começar a trabalhar com ela imediatamente.

#### Critérios de Aceitação

1. WHEN o usuário confirma a importação, THE Sistema SHALL criar:
   - Uma OrdemProducao com status `PLANEJADA` (já possui materiais e etapas)
   - ItemOrdemProducao para cada material extraído (vinculando ao produtoId se encontrado no De/Para)
   - EtapaOrdemProducao para cada etapa do roteiro extraído (vinculando ao centroProducaoId se encontrado)
2. THE Sistema SHALL tentar vincular automaticamente (auto-match):
   - Cliente: busca por código ou nome (fuzzy match)
   - Produto acabado: busca por código ou descrição
   - Materiais: busca por descrição ou código nos Produtos cadastrados
   - Centros produtivos: busca por nome da máquina nos CentroProducao cadastrados
3. IF um material não for encontrado no cadastro, THE Sistema SHALL criar o ItemOrdemProducao com `produtoId = null` e `descricaoExterna` preenchida para vinculação posterior
4. THE Sistema SHALL registrar a origem da OP com campo `origemImportacao` = 'PDF_GPRINT' e `referenciaExterna` = número da OP original
5. THE Sistema SHALL impedir importação duplicada: se já existe OP com mesma `referenciaExterna` na empresa, retornar aviso
6. THE Sistema SHALL registrar o PDF original como anexo da OP (armazenamento de arquivo)

---

### Requisito 9: Tabela De/Para (Mapeamento de Códigos Externos)

**User Story:** Como administrador, quero manter uma tabela de correspondência entre códigos/nomes do sistema GPrint e os IDs do VisioFab, para que importações futuras sejam automáticas.

#### Critérios de Aceitação

1. THE Sistema SHALL fornecer um modelo `DeParaImportacao` com campos: empresaId, sistemaOrigem (ex: 'GPRINT'), tipoEntidade (ex: 'CLIENTE', 'PRODUTO', 'CENTRO_PRODUCAO', 'MATERIAL'), codigoExterno (string), nomeExterno (string), entidadeInternaId (UUID — referência ao registro no VisioFab), status (ATIVO, INATIVO), criadoEm, atualizadoEm
2. THE Sistema SHALL fornecer CRUD para DeParaImportacao: `GET/POST/PATCH/DELETE /api/pcp/de-para-importacao`
3. WHEN uma importação encontra um match via De/Para, THE Sistema SHALL usar o mapeamento para vincular automaticamente
4. WHEN o usuário vincula manualmente um item durante a confirmação, THE Sistema SHALL oferecer opção de salvar o vínculo no De/Para para uso futuro
5. THE Sistema SHALL permitir importação em lote do De/Para via CSV (para migração inicial)
6. THE Sistema SHALL filtrar De/Para pelo empresaId do usuário autenticado

---

### Requisito 10: Suporte a Múltiplas Vias e Observações

**User Story:** Como planejador de produção, quero que o sistema lide corretamente com PDFs que contêm múltiplas vias (1ª via produção, 2ª via faturamento), extraindo dados da via correta.

#### Critérios de Aceitação

1. THE Sistema SHALL identificar e separar as múltiplas vias do PDF (geralmente marcadas como "1ª via", "2ª via" ou separadas por quebra visual)
2. THE Sistema SHALL extrair dados prioritariamente da 1ª via (mais completa — dados de produção)
3. THE Sistema SHALL extrair da 2ª ou 3ª via informações complementares:
   - Via de Faturamento: Número do pedido interno, quantidade do pedido, ficha técnica
   - Observações adicionais (campo "Obs.:" de cada via)
4. THE Sistema SHALL consolidar as informações de todas as vias em um único objeto de resultado
5. THE Sistema SHALL extrair campos de controle: "Emitido por", "Reemitido por" com datas
6. THE Sistema SHALL extrair observações de caixa/embalagem: "Caixa Padrão com 900 / Embalagens", "Colagem: Caixa 011 com 900 un"

---

### Requisito 11: Observações e Instruções Especiais de Produção

**User Story:** Como operador de produção, quero que todas as instruções especiais do PDF sejam preservadas na OP importada, para que a produção siga corretamente.

#### Critérios de Aceitação

1. THE Sistema SHALL extrair e armazenar no campo `observacoes` da OrdemProducao:
   - Observações gerais (campo "Obs.:" do cabeçalho — ex: "Serviço Novo")
   - Indicações de bobinas (ex: "Bobina Stora Enzo 222g - 72,0 cm em estoque (13.793,0 kg)")
   - Indicações de material encomendado (ex: "Bobina Stora Enzo 220g - 70,0 cm encomendado (4.549,16 kg)")
   - Instrução "Seguir contratual"
   - Observações de acabamento (ex: "Segue obs de impressão")
2. THE Sistema SHALL preservar a formatação original das observações (quebras de linha)
3. THE Sistema SHALL extrair informações de embalagem/expedição para campo separado `observacoesExpedicao`
