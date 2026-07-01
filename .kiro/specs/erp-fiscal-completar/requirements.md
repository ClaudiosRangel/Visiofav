# Requirements Document

## Introduction

Este documento especifica os requisitos para completar o módulo fiscal do VisioFab ERP, tornando-o 100% funcional para uso em produção. O escopo abrange: geração de DANFE em PDF, integração do fluxo de Vendas e Compras com o módulo fiscal novo (DocumentoFiscal), deprecação do modelo legado Nfe, e implementação dos builders XML para NFC-e (modelo 65), CT-e (modelo 57) e MDF-e (modelo 58).

## Glossary

- **Sistema_Fiscal**: Módulo fiscal do VisioFab ERP localizado em `src/modules/fiscal/`
- **Emissor_DFe**: Subsistema responsável por construir XML, assinar e transmitir documentos fiscais eletrônicos à SEFAZ
- **DANFE**: Documento Auxiliar da Nota Fiscal Eletrônica — representação gráfica simplificada em PDF da NF-e
- **NF-e**: Nota Fiscal Eletrônica modelo 55
- **NFC-e**: Nota Fiscal de Consumidor Eletrônica modelo 65
- **CT-e**: Conhecimento de Transporte Eletrônico modelo 57
- **MDF-e**: Manifesto Eletrônico de Documentos Fiscais modelo 58
- **DocumentoFiscal**: Tabela unificada `documento_fiscal` do novo módulo fiscal
- **Modelo_Legado_Nfe**: Tabela `nfe` usada pelo módulo de Vendas antes da integração com o Sistema_Fiscal
- **SEFAZ**: Secretaria da Fazenda estadual — autoridade que autoriza documentos fiscais
- **Chave_Acesso**: Código numérico de 44 dígitos que identifica univocamente um documento fiscal
- **QRCode_NFCe**: Código QR obrigatório na NFC-e para consulta pelo consumidor
- **Motor_Tributario**: Subsistema de cálculo de tributos (ICMS, IPI, PIS, COFINS, etc.)
- **XML_Autorizado**: XML do documento fiscal com protocolo de autorização da SEFAZ
- **Tomador_Servico**: Responsável pelo pagamento do frete em um CT-e
- **Venda_Efetivada**: Registro criado ao efetivar um pedido de venda confirmado
- **Compra_Efetivada**: Registro criado ao efetivar um pedido de compra com XML do fornecedor

## Requirements

### Requisito 1: Geração de DANFE em PDF

**User Story:** Como um usuário do ERP, eu quero gerar o DANFE em PDF a partir de uma NF-e autorizada, para que eu possa imprimir e anexar ao transporte de mercadorias.

#### Critérios de Aceitação

1. WHEN o endpoint GET /nfe/:id/danfe é chamado com um ID de DocumentoFiscal autorizado, THE Emissor_DFe SHALL retornar um buffer PDF válido com Content-Type application/pdf
2. THE DANFE SHALL renderizar os dados do emitente incluindo razão social, CNPJ, inscrição estadual, endereço completo e telefone
3. THE DANFE SHALL renderizar os dados do destinatário incluindo nome/razão social, CPF/CNPJ, inscrição estadual (quando aplicável) e endereço completo
4. THE DANFE SHALL renderizar a tabela de itens contendo: número do item, código do produto, descrição, NCM, CST, CFOP, unidade, quantidade, valor unitário, valor total, base ICMS, valor ICMS, valor IPI
5. THE DANFE SHALL renderizar os totais da nota incluindo base de cálculo ICMS, valor ICMS, base ICMS-ST, valor ICMS-ST, valor total dos produtos, valor do frete, valor do seguro, desconto, outras despesas, valor IPI, valor total da NF-e
6. THE DANFE SHALL renderizar a representação do código de barras Code128 da Chave_Acesso de 44 dígitos
7. THE DANFE SHALL renderizar o número do protocolo de autorização e data/hora de autorização
8. WHEN o DocumentoFiscal não possui status AUTORIZADO, THE Emissor_DFe SHALL retornar erro HTTP 422 com mensagem indicando que o DANFE só pode ser gerado para documentos autorizados
9. THE DANFE SHALL ser gerado utilizando a biblioteca pdfkit disponível nas devDependencies do projeto
10. WHEN a geração do PDF falha por erro interno, THE Emissor_DFe SHALL retornar erro HTTP 500 com mensagem descritiva do problema

### Requisito 2: Integração Vendas → Fiscal

**User Story:** Como um gestor comercial, eu quero que ao efetivar uma venda o sistema emita automaticamente uma NF-e real via SEFAZ, para que o processo fiscal seja integrado e não dependa de emissão manual posterior.

#### Critérios de Aceitação

1. WHEN o endpoint POST /vendas/efetivar é chamado com um pedido CONFIRMADO, THE Sistema_Fiscal SHALL emitir uma NF-e chamando nfeEmissaoService.emitir() dentro da transação de efetivação
2. THE Sistema_Fiscal SHALL montar os dados da NF-e a partir do pedido de venda incluindo: dados do cliente como destinatário, itens com NCM e CFOP do produto, natureza da operação como saída (tipoOperacao=1)
3. WHEN a emissão da NF-e é autorizada pela SEFAZ, THE Sistema_Fiscal SHALL criar um registro DocumentoFiscal com status AUTORIZADO e vincular à Venda_Efetivada
4. WHEN a emissão da NF-e é rejeitada pela SEFAZ, THE Sistema_Fiscal SHALL reverter a transação de efetivação e retornar erro HTTP 422 com o código de rejeição e mensagem da SEFAZ
5. WHEN a SEFAZ está indisponível e o modo contingência é ativado, THE Sistema_Fiscal SHALL criar o DocumentoFiscal com status CONTINGENCIA e enfileirar para retransmissão posterior, permitindo que a efetivação prossiga
6. THE Sistema_Fiscal SHALL deixar de criar registros na tabela legada nfe durante a efetivação de vendas
7. WHEN a empresa não possui certificado digital válido cadastrado, THE Sistema_Fiscal SHALL retornar erro HTTP 422 indicando que a emissão fiscal requer certificado digital configurado

### Requisito 3: Integração Compras → Fiscal

**User Story:** Como um gestor de compras, eu quero que ao efetivar uma compra com XML do fornecedor o sistema crie automaticamente um DocumentoFiscal de entrada, para que a nota participe da escrituração fiscal e geração do SPED.

#### Critérios de Aceitação

1. WHEN uma compra é efetivada com xmlNfe preenchido, THE Sistema_Fiscal SHALL criar um registro DocumentoFiscal com tipoOperacao=0 (Entrada) e tipoDocumento=NFE
2. THE Sistema_Fiscal SHALL extrair do XML do fornecedor: chave de acesso, número, série, data emissão, dados do emitente (fornecedor), valor total, e protocolo de autorização
3. THE Sistema_Fiscal SHALL criar os registros de ItemDocumentoFiscal correspondentes aos itens presentes no XML, incluindo dados tributários (ICMS, IPI, PIS, COFINS)
4. THE Sistema_Fiscal SHALL vincular o DocumentoFiscal de entrada à Compra_Efetivada
5. WHEN o XML fornecido não é um XML de NF-e válido, THE Sistema_Fiscal SHALL retornar erro HTTP 422 com mensagem indicando que o XML é inválido
6. THE Sistema_Fiscal SHALL armazenar o XML completo do fornecedor no campo xmlAutorizado do DocumentoFiscal
7. WHEN uma compra é efetivada sem xmlNfe, THE Sistema_Fiscal SHALL criar a Compra_Efetivada sem gerar DocumentoFiscal de entrada

### Requisito 4: Deprecação do Modelo Legado Nfe

**User Story:** Como um desenvolvedor, eu quero migrar os dados da tabela legada nfe para documento_fiscal e remover o modelo antigo, para que o sistema tenha uma única fonte de verdade para documentos fiscais.

#### Critérios de Aceitação

1. THE Sistema_Fiscal SHALL fornecer uma migration Prisma que copie todos os registros existentes da tabela nfe para documento_fiscal preservando: número, série, status, dados do destinatário, itens, valores e vínculo com Venda_Efetivada
2. THE Sistema_Fiscal SHALL mapear os campos da tabela nfe para os campos equivalentes em documento_fiscal, preenchendo tipoDocumento=NFE e tipoOperacao=1 (Saída) para todas as notas migradas
3. THE Sistema_Fiscal SHALL migrar os itens da tabela nfe_item para item_documento_fiscal preservando todos os dados tributários
4. WHEN a migração é concluída, THE Sistema_Fiscal SHALL remover o modelo Nfe e NfeItem do schema Prisma
5. THE Sistema_Fiscal SHALL atualizar todas as referências ao modelo Nfe em rotas, serviços e queries para utilizar DocumentoFiscal
6. THE Sistema_Fiscal SHALL manter a integridade referencial de vendas_efetivadas que apontam para registros na tabela legada, redirecionando o vínculo para documento_fiscal
7. IF a migração encontra registros com dados inconsistentes (campos obrigatórios nulos), THEN THE Sistema_Fiscal SHALL registrar log de aviso e preencher com valores padrão documentados

### Requisito 5: NFC-e XML Builder (Modelo 65)

**User Story:** Como um operador de PDV, eu quero emitir NFC-e (cupom fiscal eletrônico) para vendas ao consumidor, para que a empresa esteja em conformidade com a legislação de varejo.

#### Critérios de Aceitação

1. THE Emissor_DFe SHALL construir XML de NFC-e no layout 4.00 (modelo 65) contendo os grupos obrigatórios: ide, emit, det, total, pag, infAdic
2. WHEN o valor total da NFC-e é inferior a R$ 200,00, THE Emissor_DFe SHALL permitir emissão sem identificação do destinatário
3. WHEN o valor total da NFC-e é igual ou superior a R$ 200,00, THE Emissor_DFe SHALL exigir CPF ou CNPJ do consumidor no grupo dest
4. THE Emissor_DFe SHALL gerar o campo qrCode com a URL de consulta contendo: chave de acesso, ambiente, CSC ID e hash HMAC-SHA1 do CSC
5. THE Emissor_DFe SHALL gerar o campo urlChave com a URL de consulta por chave da UF do emitente
6. THE Emissor_DFe SHALL omitir o grupo transp (transporte) do XML da NFC-e conforme especificação do modelo 65
7. THE Emissor_DFe SHALL definir idDest=1 (operação interna), indFinal=1 (consumidor final) e indPres=1 (presencial) no grupo ide
8. WHEN o endpoint POST /nfce/emitir é chamado com dados válidos, THE Emissor_DFe SHALL calcular tributos via Motor_Tributario, construir XML, assinar, transmitir à SEFAZ e retornar o resultado da autorização
9. THE Emissor_DFe SHALL gerar a Chave_Acesso de 44 dígitos com modelo=65 e dígito verificador módulo 11
10. THE Emissor_DFe SHALL preencher tpEmis=1 (normal) por padrão e tpEmis=9 (contingência offline) quando em contingência
11. FOR ALL NFC-e válidas, construir o XML e depois parseá-lo de volta SHALL produzir dados equivalentes aos dados de entrada (propriedade round-trip)

### Requisito 6: CT-e XML Builder (Modelo 57)

**User Story:** Como um gestor de logística, eu quero emitir CT-e (Conhecimento de Transporte Eletrônico) para documentar prestações de serviço de transporte, para que a empresa esteja em conformidade com a legislação fiscal de transporte.

#### Critérios de Aceitação

1. THE Emissor_DFe SHALL construir XML de CT-e no layout 4.00 (modelo 57) contendo os grupos obrigatórios: ide, compl, emit, rem (remetente), dest (destinatário), vPrest (valor da prestação), imp, infCTeNorm, infAdic
2. THE Emissor_DFe SHALL incluir o grupo do tomador do serviço conforme tpTom (0=remetente, 1=expedidor, 2=recebedor, 3=destinatário, 4=outros)
3. THE Emissor_DFe SHALL incluir o grupo infCarga com valor total da carga, produto predominante e quantidades (peso bruto, peso cubado, volumes)
4. THE Emissor_DFe SHALL incluir os componentes de valor da prestação no grupo vPrest (nome do componente e valor)
5. THE Emissor_DFe SHALL incluir o grupo infDoc com as chaves das NF-e vinculadas ao transporte
6. THE Emissor_DFe SHALL incluir o grupo infModal com os dados específicos do modal rodoviário (RNTRC, veículos)
7. THE Emissor_DFe SHALL calcular ICMS do CT-e conforme CST informada (00, 20, 40, 41, 51, 60, 90, SN)
8. WHEN o endpoint POST /cte/emitir é chamado com dados válidos, THE Emissor_DFe SHALL construir XML, assinar, transmitir à SEFAZ e retornar o resultado da autorização
9. THE Emissor_DFe SHALL gerar a Chave_Acesso de 44 dígitos com modelo=57 e dígito verificador módulo 11
10. THE Emissor_DFe SHALL utilizar o serviço SEFAZ CTeAutorizacao e CTeRetAutorizacao para transmissão e consulta do lote
11. FOR ALL CT-e válidos, construir o XML e depois parseá-lo de volta SHALL produzir dados equivalentes aos dados de entrada (propriedade round-trip)

### Requisito 7: MDF-e XML Builder (Modelo 58)

**User Story:** Como um gestor de logística, eu quero emitir MDF-e (Manifesto Eletrônico) para vincular documentos fiscais aos veículos em trânsito, para que o transporte esteja regularizado perante a fiscalização.

#### Critérios de Aceitação

1. THE Emissor_DFe SHALL construir XML de MDF-e no layout 3.00 (modelo 58) contendo os grupos obrigatórios: ide, emit, infDoc, seg, prodPred, tot, infModal, infAdic
2. THE Emissor_DFe SHALL incluir no grupo ide as UFs de carregamento e descarregamento com os respectivos municípios
3. THE Emissor_DFe SHALL incluir no grupo infDoc os documentos vinculados, contendo chaves de NF-e e/ou CT-e agrupados por UF de descarregamento e município
4. THE Emissor_DFe SHALL incluir no grupo infModal os dados do modal rodoviário: veículo de tração (placa, RENAVAM, tara, capacidade), reboques, condutores (CPF, nome), CIOT e vale-pedágio
5. THE Emissor_DFe SHALL incluir no grupo seg informações de seguros (responsável, apólice, averbação)
6. THE Emissor_DFe SHALL incluir totalizadores: quantidade de CT-e, quantidade de NF-e, peso total da carga e valor total da carga
7. WHEN o endpoint POST /mdfe/emitir é chamado com dados válidos, THE Emissor_DFe SHALL construir XML, assinar, transmitir à SEFAZ e retornar o resultado da autorização
8. THE Emissor_DFe SHALL gerar a Chave_Acesso de 44 dígitos com modelo=58 e dígito verificador módulo 11
9. THE Emissor_DFe SHALL utilizar o serviço SEFAZ MDFeRecepcao e MDFeRetRecepcao para transmissão e consulta do lote
10. THE Emissor_DFe SHALL validar que ao menos um documento fiscal (NF-e ou CT-e) esteja vinculado antes de construir o XML
11. IF nenhum documento fiscal é vinculado ao MDF-e, THEN THE Emissor_DFe SHALL retornar erro de validação indicando que o manifesto requer ao menos um documento
12. FOR ALL MDF-e válidos, construir o XML e depois parseá-lo de volta SHALL produzir dados equivalentes aos dados de entrada (propriedade round-trip)
