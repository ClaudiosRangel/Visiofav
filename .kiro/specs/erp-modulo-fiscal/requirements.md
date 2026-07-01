# Requirements Document

## Introduction

Módulo Fiscal completo para o sistema VisioFab ERP, cobrindo toda a cadeia de obrigações fiscais brasileiras: emissão de documentos fiscais eletrônicos (NF-e, NFC-e, CT-e, MDF-e, NFS-e), motor tributário configurável, apuração de impostos, obrigações acessórias SPED, e utilitários fiscais. O módulo deve atender empresas nos regimes Simples Nacional, Lucro Presumido e Lucro Real, sendo competitivo com os líderes de mercado (TOTVS, Sankhya, Omie).

## Glossary

- **Sistema_Fiscal**: O módulo fiscal do VisioFab ERP responsável pelo processamento de documentos e cálculos tributários
- **Motor_Tributario**: Componente do Sistema_Fiscal responsável por determinar e calcular tributos automaticamente
- **Emissor_DFe**: Componente do Sistema_Fiscal responsável pela emissão de documentos fiscais eletrônicos
- **Gerador_SPED**: Componente do Sistema_Fiscal responsável pela geração de arquivos das obrigações acessórias
- **Apurador_Impostos**: Componente do Sistema_Fiscal responsável pela apuração periódica de impostos
- **Gestor_Certificado**: Componente do Sistema_Fiscal responsável pelo gerenciamento de certificados digitais
- **SEFAZ**: Secretaria da Fazenda Estadual — webservice que autoriza documentos fiscais eletrônicos
- **NF-e**: Nota Fiscal Eletrônica (modelo 55) para operações B2B
- **NFC-e**: Nota Fiscal do Consumidor Eletrônica (modelo 65) para varejo
- **CT-e**: Conhecimento de Transporte Eletrônico (modelo 57)
- **MDF-e**: Manifesto Eletrônico de Documentos Fiscais (modelo 58)
- **NFS-e**: Nota Fiscal de Serviços Eletrônica (padrão municipal)
- **MDe**: Manifesto do Destinatário Eletrônico
- **CC-e**: Carta de Correção Eletrônica
- **ICMS**: Imposto sobre Circulação de Mercadorias e Serviços
- **ICMS-ST**: ICMS Substituição Tributária
- **DIFAL**: Diferencial de Alíquota de ICMS entre estados
- **FCP**: Fundo de Combate à Pobreza
- **PIS**: Programa de Integração Social
- **COFINS**: Contribuição para o Financiamento da Seguridade Social
- **IPI**: Imposto sobre Produtos Industrializados
- **ISS**: Imposto sobre Serviços
- **NCM**: Nomenclatura Comum do Mercosul (classificação fiscal de produtos)
- **CFOP**: Código Fiscal de Operações e Prestações
- **CEST**: Código Especificador da Substituição Tributária
- **CST**: Código de Situação Tributária
- **CSOSN**: Código de Situação da Operação no Simples Nacional
- **MVA**: Margem de Valor Agregado (para cálculo de ICMS-ST)
- **SPED**: Sistema Público de Escrituração Digital
- **EFD**: Escrituração Fiscal Digital
- **ECD**: Escrituração Contábil Digital
- **ECF**: Escrituração Contábil Fiscal
- **GNRE**: Guia Nacional de Recolhimento de Tributos Estaduais
- **DFe**: Documento Fiscal Eletrônico (termo genérico)
- **XML_Fiscal**: Arquivo XML no padrão definido pela SEFAZ/RFB
- **Regime_Tributario**: Classificação da empresa (Simples Nacional, Lucro Presumido, Lucro Real)
- **Regra_Tributaria**: Configuração que define impostos aplicáveis para uma combinação NCM × CFOP × UF × Regime
- **Certificado_Digital**: Certificado e-CNPJ tipo A1 ou A3 usado para assinar documentos fiscais
- **Contingencia**: Modo de operação alternativo quando a SEFAZ está indisponível

## Requirements

### Requirement 1: Emissão de NF-e

**User Story:** As a usuário do ERP, I want to emitir Notas Fiscais Eletrônicas (NF-e modelo 55), so that I can documentar operações de venda, transferência e devolução conforme legislação.

#### Acceptance Criteria

1. WHEN o usuário solicita a emissão de uma NF-e com todos os campos obrigatórios preenchidos conforme o schema XSD do layout 4.00 da SEFAZ (emitente, destinatário, itens com NCM/CFOP/CST, valores e totais), THE Emissor_DFe SHALL validar os dados localmente contra o schema XSD, gerar o XML, assinar digitalmente com o Certificado_Digital A1 ou A3 da empresa emitente e transmitir ao webservice da SEFAZ correspondente à UF do emitente dentro de no máximo 30 segundos de timeout por tentativa
2. WHEN a SEFAZ retorna autorização com protocolo (cStat=100), THE Emissor_DFe SHALL armazenar o XML autorizado com protocolo incorporado, registrar o número do protocolo de autorização e a data/hora de autorização, e atualizar o status do documento para "Autorizado"
3. WHEN a SEFAZ rejeita a NF-e (cStat diferente de 100 e de códigos de erro de infraestrutura), THE Emissor_DFe SHALL armazenar o código de rejeição (cStat) e a descrição (xMotivo), manter o status como "Rejeitado" e apresentar o código e a descrição do erro ao usuário
4. IF a comunicação com o webservice da SEFAZ falhar por timeout ou indisponibilidade após 3 tentativas com intervalo de 5 segundos entre elas, THEN THE Emissor_DFe SHALL registrar a falha de comunicação, manter o status do documento como "Pendente de Envio" e notificar o usuário sobre a indisponibilidade do serviço
5. WHEN o usuário solicita o cancelamento de uma NF-e autorizada, IF o tempo decorrido desde a autorização for inferior a 24 horas, THEN THE Emissor_DFe SHALL gerar o evento de cancelamento (tpEvento=110111) com justificativa de no mínimo 15 e no máximo 255 caracteres, transmitir à SEFAZ e atualizar o status para "Cancelado" após confirmação
6. IF o usuário solicita o cancelamento de uma NF-e autorizada há mais de 24 horas, THEN THE Emissor_DFe SHALL impedir a transmissão e apresentar mensagem indicando que o prazo legal de cancelamento foi excedido
7. WHEN o usuário solicita uma Carta de Correção (CC-e), THE Emissor_DFe SHALL gerar o evento de CC-e (tpEvento=110110) com texto corretivo de no mínimo 15 e no máximo 1000 caracteres, registrar o número sequencial do evento (máximo 20 CC-e por NF-e), transmitir à SEFAZ e vincular ao documento original
8. WHEN o usuário solicita inutilização de numeração, THE Emissor_DFe SHALL transmitir o pedido de inutilização à SEFAZ para a faixa de números especificada (máximo 1000 números por requisição), com justificativa de no mínimo 15 e no máximo 255 caracteres, e registrar a inutilização com status "Inutilizado"
9. WHEN uma NF-e atinge o status "Autorizado", THE Emissor_DFe SHALL gerar o DANFE (Documento Auxiliar da NF-e) em formato PDF a partir do XML autorizado, em layout retrato ou paisagem conforme configuração da empresa, e disponibilizá-lo para visualização e download em até 5 segundos após a autorização
10. IF a validação local dos dados da NF-e detectar campos obrigatórios ausentes ou valores fora do schema XSD, THEN THE Emissor_DFe SHALL impedir a transmissão e apresentar a lista de campos com erro ao usuário

### Requirement 2: Emissão de NFC-e

**User Story:** As a operador de varejo, I want to emitir NFC-e (modelo 65) no ponto de venda, so that I can documentar vendas ao consumidor final com agilidade.

#### Acceptance Criteria

1. WHEN o operador finaliza uma venda no PDV, THE Emissor_DFe SHALL gerar o XML da NFC-e (modelo 65), assinar digitalmente com certificado A1 e transmitir à SEFAZ em no máximo 5 segundos, exibindo indicação visual de sucesso ou falha ao operador
2. WHEN a SEFAZ autoriza a NFC-e, THE Emissor_DFe SHALL armazenar o XML autorizado com protocolo de autorização e disponibilizar a impressão do DANFE-NFC-e em layout simplificado conforme leiaute MOC vigente
3. WHERE o estado exige integração SAT/MFe, THE Emissor_DFe SHALL transmitir o documento fiscal ao equipamento SAT/MFe em no máximo 10 segundos e armazenar o cupom fiscal eletrônico resultante
4. WHEN o operador solicita cancelamento de NFC-e dentro de 30 minutos da autorização, THE Emissor_DFe SHALL gerar o evento de cancelamento, transmitir à SEFAZ e exibir confirmação de cancelamento ou motivo da rejeição ao operador
5. IF a SEFAZ rejeitar a NFC-e, THEN THE Emissor_DFe SHALL exibir ao operador mensagem indicando o motivo da rejeição (código e descrição retornados pela SEFAZ) e manter os dados da venda para correção e retransmissão
6. IF a comunicação com a SEFAZ estiver indisponível por mais de 5 segundos, THEN THE Emissor_DFe SHALL ativar o modo de contingência offline, gerar a NFC-e em contingência conforme modalidade configurada para o estabelecimento e enfileirar a transmissão para envio automático quando a conectividade for restabelecida
7. IF a comunicação com o equipamento SAT/MFe falhar, THEN THE Emissor_DFe SHALL exibir ao operador mensagem indicando falha de comunicação com o SAT/MFe e impedir a conclusão da venda até que a comunicação seja restabelecida ou o modo de contingência seja ativado manualmente

### Requirement 3: Emissão de CT-e

**User Story:** As a empresa de transporte, I want to emitir CT-e (modelo 57), so that I can documentar prestações de serviço de transporte conforme legislação.

#### Acceptance Criteria

1. WHEN o usuário solicita emissão de CT-e com dados da prestação de transporte, THE Emissor_DFe SHALL gerar o XML no layout do CT-e, assinar e transmitir à SEFAZ
2. WHEN a SEFAZ autoriza o CT-e, THE Emissor_DFe SHALL armazenar o XML autorizado e gerar o DACTE (Documento Auxiliar do CT-e) em PDF
3. WHEN o usuário solicita cancelamento de CT-e dentro do prazo legal, THE Emissor_DFe SHALL gerar o evento de cancelamento e transmitir à SEFAZ
4. WHEN o usuário solicita CC-e para CT-e, THE Emissor_DFe SHALL gerar e transmitir o evento de carta de correção

### Requirement 4: Emissão de MDF-e

**User Story:** As a transportador, I want to emitir MDF-e (modelo 58), so that I can vincular documentos fiscais ao manifesto de carga para transporte interestadual e intermunicipal.

#### Acceptance Criteria

1. WHEN o usuário solicita emissão de MDF-e vinculando CT-e ou NF-e, THE Emissor_DFe SHALL gerar o XML do MDF-e com os documentos vinculados, assinar e transmitir à SEFAZ
2. WHEN a SEFAZ autoriza o MDF-e, THE Emissor_DFe SHALL armazenar o XML autorizado e gerar o DAMDFE em PDF
3. WHEN o motorista conclui a viagem, THE Emissor_DFe SHALL gerar o evento de encerramento do MDF-e e transmitir à SEFAZ
4. WHEN o usuário solicita cancelamento de MDF-e dentro do prazo legal, THE Emissor_DFe SHALL gerar o evento de cancelamento e transmitir à SEFAZ
5. WHEN o usuário precisa incluir condutor ou veículo após autorização, THE Emissor_DFe SHALL gerar o evento de inclusão e transmitir à SEFAZ

### Requirement 5: Emissão de NFS-e

**User Story:** As a prestador de serviços, I want to emitir NFS-e, so that I can documentar prestações de serviço conforme legislação municipal.

#### Acceptance Criteria

1. WHEN o usuário solicita emissão de NFS-e, THE Emissor_DFe SHALL identificar o webservice da prefeitura do município do prestador e transmitir a nota de serviço no formato exigido pelo município
2. WHEN a prefeitura autoriza a NFS-e, THE Emissor_DFe SHALL armazenar o retorno (XML ou identificador) e registrar o número da nota atribuído pela prefeitura
3. WHEN o usuário solicita cancelamento de NFS-e, THE Emissor_DFe SHALL transmitir o pedido de cancelamento ao webservice da prefeitura
4. THE Emissor_DFe SHALL suportar múltiplos padrões de webservice municipal (ABRASF, GINFES, ISS.NET, Betha, padrão nacional) configuráveis por município
5. IF o webservice da prefeitura estiver indisponível, THEN THE Emissor_DFe SHALL enfileirar a NFS-e para reenvio automático e notificar o usuário sobre a pendência

### Requirement 6: Manifesto do Destinatário (MDe)

**User Story:** As a destinatário de NF-e, I want to registrar ciência, confirmação, desconhecimento ou operação não realizada, so that I can cumprir a obrigação de manifestação e proteger a empresa contra uso indevido do CNPJ.

#### Acceptance Criteria

1. WHEN o usuário seleciona uma NF-e recebida e registra "Ciência da Operação", THE Emissor_DFe SHALL gerar o evento de ciência e transmitir à SEFAZ
2. WHEN o usuário confirma a operação de uma NF-e, THE Emissor_DFe SHALL gerar o evento de "Confirmação da Operação" e transmitir à SEFAZ
3. WHEN o usuário registra desconhecimento de operação, THE Emissor_DFe SHALL gerar o evento de "Desconhecimento da Operação" e transmitir à SEFAZ
4. WHEN o usuário registra "Operação Não Realizada", THE Emissor_DFe SHALL gerar o evento com justificativa e transmitir à SEFAZ
5. THE Sistema_Fiscal SHALL apresentar lista de NF-e pendentes de manifestação com prazo restante para cada documento

### Requirement 7: Motor Tributário - Regras por NCM × CFOP × UF × Regime

**User Story:** As a responsável fiscal, I want to configurar regras tributárias por combinação NCM, CFOP, UF origem, UF destino e regime tributário, so that I can automatizar o cálculo de impostos para todas as operações.

#### Acceptance Criteria

1. THE Motor_Tributario SHALL permitir cadastro de regras tributárias com os campos obrigatórios: NCM (8 dígitos numéricos), CFOP (4 dígitos numéricos), UF origem (sigla 2 caracteres), UF destino (sigla 2 caracteres), Regime_Tributario, e para cada imposto aplicável (ICMS, PIS, COFINS, IPI, ISS, FCP, ICMS-ST) os campos: alíquota (0,00% a 100,00% com 2 casas decimais), CST/CSOSN, percentual de base de cálculo (0,00% a 100,00%) e percentual de redução (0,00% a 100,00%), rejeitando cadastro duplicado para a mesma combinação exata de NCM+CFOP+UF origem+UF destino+Regime_Tributario
2. WHEN uma operação fiscal é iniciada (criação ou edição de item em documento fiscal), THE Motor_Tributario SHALL buscar a Regra_Tributaria aplicável pela combinação exata de NCM do produto, CFOP da operação, UF de origem, UF de destino e Regime_Tributario da empresa, retornando o resultado em no máximo 500ms por item
3. IF nenhuma Regra_Tributaria for encontrada para a combinação exata, THEN THE Motor_Tributario SHALL buscar regras seguindo a hierarquia de fallback em ordem: 1º NCM parcial (primeiros 4 dígitos) com demais campos exatos, 2º CFOP com último dígito zero (genérico) com NCM exato, 3º regra padrão do Regime_Tributario sem filtro de NCM/CFOP, utilizando a primeira regra encontrada nesta sequência e exibindo indicação visual no item do documento informando o nível de fallback utilizado
4. IF nenhuma Regra_Tributaria for encontrada em nenhum nível da hierarquia de fallback, THEN THE Motor_Tributario SHALL bloquear o preenchimento automático do item, exibir mensagem indicando ausência de regra para a combinação NCM+CFOP+UF+Regime, e impedir a emissão do documento fiscal até que o usuário configure uma regra aplicável ou preencha manualmente os campos tributários
5. WHEN uma Regra_Tributaria é encontrada (exata ou por fallback), THE Motor_Tributario SHALL preencher automaticamente CST/CSOSN, alíquotas e bases de cálculo nos campos tributários do item do documento fiscal, permitindo que o usuário sobrescreva manualmente qualquer valor preenchido antes da emissão

### Requirement 8: Cálculo de ICMS

**User Story:** As a responsável fiscal, I want that the system calculate ICMS automatically in all modalities, so that I can guarantee fiscal compliance in operations across all states.

#### Acceptance Criteria

1. WHEN a operação é tributada normalmente (CST 00), THE Motor_Tributario SHALL calcular o ICMS aplicando a alíquota correspondente à combinação UF origem/destino sobre a base de cálculo (valor do produto + frete + seguro + outras despesas - descontos), arredondando o resultado para 2 casas decimais conforme regra ABNT NBR 5891
2. WHEN a operação envolve DIFAL (venda interestadual a consumidor final não contribuinte, CST 00/20/60/90), THE Motor_Tributario SHALL calcular a diferença entre alíquota interna do estado de destino e alíquota interestadual aplicável, destinando 100% do diferencial ao estado de destino
3. WHEN a operação possui redução de base de cálculo (CST 20), THE Motor_Tributario SHALL aplicar o percentual de redução cadastrado na regra fiscal do item antes do cálculo do imposto, registrando o valor da base reduzida e o valor do ICMS resultante
4. WHEN a operação é de desoneração de ICMS (CST 30, 40, 41, 50, 60), THE Motor_Tributario SHALL calcular o valor desonerado e informar o código do motivo da desoneração (valores 1 a 16 conforme tabela de motivos da NT 2011/004) no XML da NF-e
5. WHEN a operação envolve diferimento parcial (CST 51), THE Motor_Tributario SHALL calcular separadamente o ICMS diferido (alíquota × base × percentual de diferimento cadastrado) e o ICMS a recolher na operação (alíquota × base × percentual não diferido), garantindo que a soma dos dois valores seja igual ao ICMS total
6. THE Motor_Tributario SHALL utilizar as alíquotas interestaduais: 7% (origem Sul/Sudeste exceto ES para destino N/NE/CO/ES), 12% (demais combinações interestaduais entre contribuintes), 4% (produtos com conteúdo de importação superior a 40% conforme Resolução SF 13/2012)
7. IF a alíquota ou regra fiscal necessária para o cálculo do ICMS não estiver cadastrada para a combinação UF origem/destino e NCM do item, THEN THE Motor_Tributario SHALL bloquear a emissão do documento fiscal e apresentar mensagem indicando o parâmetro fiscal ausente, a UF e o NCM afetados
8. WHEN o Motor_Tributario concluir o cálculo de ICMS em qualquer modalidade, THE Motor_Tributario SHALL registrar o CST utilizado, a base de cálculo, a alíquota aplicada e o valor do imposto com precisão de 2 casas decimais, mantendo rastreabilidade para auditoria

### Requirement 9: Cálculo de ICMS-ST

**User Story:** As a responsável fiscal, I want that the system calculate ICMS Substituição Tributária correctly, so that I can recolher o imposto antecipado conforme exigido por protocolo/convênio.

#### Acceptance Criteria

1. WHEN a operação está sujeita a ICMS-ST, THE Motor_Tributario SHALL calcular a base de cálculo ST aplicando MVA (original ou ajustada) sobre o valor da operação
2. WHEN existir IVA-ST ajustado conforme protocolo/convênio entre estados, THE Motor_Tributario SHALL utilizar o MVA ajustado para cálculo da base ST
3. THE Motor_Tributario SHALL calcular o ICMS-ST como: (Base ST × Alíquota interna destino) - ICMS próprio da operação
4. WHEN o produto possuir preço de pauta (PMPF), THE Motor_Tributario SHALL utilizar o preço de pauta como base de cálculo ST ao invés de MVA
5. WHEN a operação envolver FCP-ST, THE Motor_Tributario SHALL calcular o FCP sobre a base de cálculo ST com a alíquota do FCP do estado de destino

### Requirement 10: Cálculo de PIS/COFINS

**User Story:** As a responsável fiscal, I want that the system calculate PIS and COFINS in cumulative and non-cumulative regimes, so that I can apurar corretamente as contribuições e aproveitar créditos.

#### Acceptance Criteria

1. WHILE a empresa está no regime não-cumulativo (Lucro Real), THE Motor_Tributario SHALL calcular PIS à alíquota de 1,65% e COFINS à alíquota de 7,6% sobre a receita, e calcular créditos sobre aquisições
2. WHILE a empresa está no regime cumulativo (Lucro Presumido), THE Motor_Tributario SHALL calcular PIS à alíquota de 0,65% e COFINS à alíquota de 3% sobre a receita, sem direito a crédito
3. WHEN existir alíquota diferenciada por NCM (monofásico, alíquota zero, substituição tributária), THE Motor_Tributario SHALL aplicar a alíquota específica do produto conforme tabela TIPI/legislação
4. WHEN a operação gera direito a crédito de PIS/COFINS (regime não-cumulativo), THE Motor_Tributario SHALL registrar o crédito com vínculo à nota fiscal de entrada
5. THE Motor_Tributario SHALL preencher corretamente CST de PIS e CST de COFINS em cada item do documento fiscal

### Requirement 11: Cálculo de IPI

**User Story:** As a indústria, I want that the system calculate IPI automatically, so that I can destacar o imposto correto nas notas de saída e aproveitar créditos nas entradas.

#### Acceptance Criteria

1. WHEN o produto possui alíquota de IPI na TIPI, THE Motor_Tributario SHALL calcular o IPI aplicando a alíquota sobre a base de cálculo (valor do produto + frete + seguro + outras despesas)
2. WHEN o produto possui tributação por pauta de IPI, THE Motor_Tributario SHALL calcular o IPI pelo valor fixo por unidade conforme tabela de pauta
3. WHEN o produto é isento, imune ou com suspensão de IPI, THE Motor_Tributario SHALL aplicar CST correspondente e não calcular o imposto
4. WHEN a entrada gera crédito de IPI, THE Motor_Tributario SHALL registrar o crédito vinculado à nota fiscal de entrada para apuração

### Requirement 12: Cálculo de ISS

**User Story:** As a prestador de serviços, I want that the system calculate ISS with retention when applicable, so that I can recolher o imposto municipal corretamente.

#### Acceptance Criteria

1. WHEN a operação é prestação de serviço, THE Motor_Tributario SHALL calcular o ISS aplicando a alíquota do município sobre o valor do serviço
2. WHEN o serviço exige retenção de ISS na fonte (tomador retém), THE Motor_Tributario SHALL calcular o ISS retido e indicar a retenção no documento fiscal
3. WHEN o local de prestação difere do local do prestador (ISS devido no destino), THE Motor_Tributario SHALL aplicar a alíquota do município de prestação conforme lista de serviços LC 116/2003
4. THE Motor_Tributario SHALL respeitar alíquota mínima de 2% e máxima de 5% conforme legislação

### Requirement 13: Cálculo de FCP

**User Story:** As a responsável fiscal, I want that the system calculate FCP (Fundo de Combate à Pobreza) automatically, so that I can recolher o adicional estadual quando exigido.

#### Acceptance Criteria

1. WHEN o estado de destino possui FCP, THE Motor_Tributario SHALL calcular o adicional FCP sobre a base de cálculo do ICMS com a alíquota de FCP do estado
2. WHEN a operação envolve ICMS-ST com FCP, THE Motor_Tributario SHALL calcular o FCP-ST sobre a base de cálculo da substituição tributária
3. WHEN a operação envolve DIFAL com FCP, THE Motor_Tributario SHALL calcular o FCP-DIFAL sobre a base de cálculo do diferencial de alíquota
4. THE Motor_Tributario SHALL destacar o valor do FCP em campo próprio no XML do documento fiscal

### Requirement 14: SPED Fiscal (EFD ICMS/IPI)

**User Story:** As a contador, I want to generate the SPED Fiscal file (EFD ICMS/IPI), so that I can cumprir a obrigação acessória mensal perante a Receita Federal e SEFAZ.

#### Acceptance Criteria

1. WHEN o usuário solicita geração do SPED Fiscal informando mês/ano de referência e versão do layout (conforme Guia Prático EFD ICMS/IPI publicado pela RFB), THE Gerador_SPED SHALL gerar o arquivo texto contendo todos os blocos obrigatórios (0, C, D, E, G, H, K, 1, 9) com registros de abertura e encerramento em cada bloco, dentro de no máximo 120 segundos para períodos com até 100.000 documentos fiscais
2. THE Gerador_SPED SHALL incluir no Bloco C todos os documentos fiscais de entrada e saída (modelos 01, 1B, 04, 55, 65) do mês/ano de referência com detalhamento por item, limitando-se a documentos com data de emissão entre o primeiro e o último dia do mês informado
3. THE Gerador_SPED SHALL incluir no Bloco D todos os documentos de transporte (CT-e modelo 57) do mês/ano de referência com registros de conhecimento e itens conforme layout
4. THE Gerador_SPED SHALL incluir no Bloco E a apuração de ICMS, ICMS-ST e IPI com valores de débito, crédito, estornos de débito, estornos de crédito, ajustes e saldo apurado, todos com precisão de 2 casas decimais e arredondamento half-up
5. THE Gerador_SPED SHALL gerar o arquivo com encoding ISO-8859-1, delimitador de campo pipe (|), delimitador de registro CR+LF, e validar a estrutura verificando: presença de todos os blocos obrigatórios, sequência correta de registros pai-filho, totalização do Bloco 9 consistente com a contagem real de registros por bloco, e campos obrigatórios preenchidos conforme layout
6. IF a validação estrutural do arquivo identificar inconsistências, THEN THE Gerador_SPED SHALL impedir a disponibilização do arquivo ao usuário e apresentar mensagem indicando os registros com erro e a descrição da inconsistência encontrada
7. IF não existirem documentos fiscais no período solicitado, THEN THE Gerador_SPED SHALL gerar o arquivo com os blocos obrigatórios contendo apenas registros de abertura e encerramento (movimento zerado) conforme exigido pelo layout

### Requirement 15: SPED Contribuições (EFD PIS/COFINS)

**User Story:** As a contador, I want to generate the SPED Contribuições file, so that I can cumprir a obrigação acessória de PIS/COFINS perante a Receita Federal.

#### Acceptance Criteria

1. WHEN o usuário solicita geração do SPED Contribuições para um período, THE Gerador_SPED SHALL gerar o arquivo texto no layout vigente com todos os blocos obrigatórios (0, A, C, D, F, M, 1, 9)
2. THE Gerador_SPED SHALL incluir no Bloco A receitas de serviços (NFS-e) do período
3. THE Gerador_SPED SHALL incluir no Bloco C documentos fiscais de mercadorias com detalhamento de PIS/COFINS por item
4. THE Gerador_SPED SHALL incluir no Bloco F demais receitas e deduções (receitas financeiras, aluguéis, etc.)
5. THE Gerador_SPED SHALL incluir no Bloco M a apuração consolidada de PIS e COFINS com créditos e contribuição devida
6. WHILE a empresa está no regime não-cumulativo, THE Gerador_SPED SHALL detalhar os créditos por base de cálculo no Bloco M

### Requirement 16: ECD (Escrituração Contábil Digital)

**User Story:** As a contador, I want to generate ECD data, so that I can cumprir a obrigação de escrituração contábil digital junto à Receita Federal.

#### Acceptance Criteria

1. WHEN o usuário solicita geração de dados para ECD, THE Gerador_SPED SHALL exportar os lançamentos contábeis do período no layout da ECD com blocos obrigatórios (0, I, J, 9)
2. THE Gerador_SPED SHALL incluir plano de contas, saldos periódicos e lançamentos diários conforme escrituração contábil
3. THE Gerador_SPED SHALL gerar o arquivo no formato e encoding especificados pelo manual da ECD

### Requirement 17: ECF (Escrituração Contábil Fiscal)

**User Story:** As a contador, I want to generate ECF data, so that I can cumprir a obrigação de declarar IRPJ e CSLL à Receita Federal.

#### Acceptance Criteria

1. WHEN o usuário solicita geração de dados para ECF, THE Gerador_SPED SHALL exportar dados fiscais e contábeis no layout da ECF com blocos obrigatórios
2. THE Gerador_SPED SHALL incluir dados de apuração de IRPJ e CSLL conforme regime tributário da empresa (Lucro Real ou Presumido)
3. THE Gerador_SPED SHALL recuperar dados da ECD para compor os blocos contábeis da ECF

### Requirement 18: SPED Reinf (EFD-Reinf)

**User Story:** As a responsável fiscal, I want to transmit EFD-Reinf events, so that I can cumprir a obrigação de informar retenções e contribuições previdenciárias.

#### Acceptance Criteria

1. WHEN existem retenções de serviços no período, THE Gerador_SPED SHALL gerar o evento R-2010 (retenções de serviços tomados) com dados das notas fiscais e valores retidos
2. WHEN a empresa presta serviços com retenção, THE Gerador_SPED SHALL gerar o evento R-2020 (retenções de serviços prestados)
3. WHEN o usuário solicita fechamento do período, THE Gerador_SPED SHALL gerar o evento R-2099 (fechamento dos eventos periódicos)
4. THE Gerador_SPED SHALL transmitir os eventos via webservice da RFB assinados com Certificado_Digital
5. THE Gerador_SPED SHALL gerar evento R-1000 (informações do contribuinte) para abertura de movimento quando necessário

### Requirement 19: DCTF-Web

**User Story:** As a responsável fiscal, I want to generate data for DCTF-Web, so that I can informar débitos e créditos tributários federais para confissão de dívida.

#### Acceptance Criteria

1. WHEN o usuário solicita geração de dados para DCTF-Web, THE Gerador_SPED SHALL consolidar débitos de contribuições federais (PIS, COFINS, IRRF, CSLL, INSS) do período
2. THE Gerador_SPED SHALL exportar os dados no formato aceito pelo sistema e-CAC/DCTF-Web da Receita Federal
3. THE Gerador_SPED SHALL conciliar os valores com as apurações mensais de PIS/COFINS e folha de pagamento (Reinf/eSocial)

### Requirement 20: Apuração de ICMS

**User Story:** As a responsável fiscal, I want to perform monthly ICMS assessment, so that I can determinar o valor a recolher ou o saldo credor acumulado.

#### Acceptance Criteria

1. WHEN o usuário solicita apuração de ICMS para um período, THE Apurador_Impostos SHALL calcular o total de débitos (saídas tributadas), total de créditos (entradas com direito a crédito), estornos de débito e estornos de crédito
2. THE Apurador_Impostos SHALL calcular o saldo devedor (débitos - créditos) ou saldo credor (créditos - débitos) do período
3. WHEN existe saldo credor do período anterior, THE Apurador_Impostos SHALL transportar o crédito acumulado para o período corrente
4. WHEN o usuário registra transferência de crédito acumulado, THE Apurador_Impostos SHALL registrar a transferência com nota fiscal de transferência de crédito
5. WHEN existem ajustes de apuração (GIA, outros créditos, deduções), THE Apurador_Impostos SHALL incluir os ajustes no cálculo final do saldo
6. THE Apurador_Impostos SHALL gerar o livro de apuração de ICMS (Registro E110 do SPED) com todos os valores consolidados

### Requirement 21: Apuração de ICMS-ST

**User Story:** As a responsável fiscal, I want to perform ICMS-ST assessment, so that I can controlar recolhimentos de substituição tributária e solicitar ressarcimento quando cabível.

#### Acceptance Criteria

1. WHEN o usuário solicita apuração de ICMS-ST para um período, THE Apurador_Impostos SHALL calcular os débitos de ST (retido nas saídas) e créditos de ST (retido nas entradas) do período
2. THE Apurador_Impostos SHALL calcular o saldo de ICMS-ST a recolher por UF de destino
3. WHEN existe direito a ressarcimento de ICMS-ST (venda a consumidor final por valor inferior à base ST), THE Apurador_Impostos SHALL calcular o valor do ressarcimento e registrar o crédito
4. THE Apurador_Impostos SHALL separar a apuração de ICMS-ST por UF quando existirem operações interestaduais com ST

### Requirement 22: Apuração de PIS/COFINS

**User Story:** As a responsável fiscal, I want to perform monthly PIS/COFINS assessment, so that I can determinar o valor das contribuições a recolher.

#### Acceptance Criteria

1. WHEN o usuário solicita apuração de PIS/COFINS para um período, THE Apurador_Impostos SHALL calcular débitos sobre receitas e créditos sobre aquisições conforme regime (cumulativo ou não-cumulativo)
2. WHILE a empresa está no regime não-cumulativo, THE Apurador_Impostos SHALL detalhar os créditos por natureza (bens para revenda, insumos, energia, aluguéis, depreciação, etc.)
3. THE Apurador_Impostos SHALL calcular o valor líquido a recolher (débitos - créditos) de PIS e COFINS separadamente
4. WHEN existe crédito excedente de PIS/COFINS, THE Apurador_Impostos SHALL transportar o saldo credor para o período seguinte
5. WHEN existem receitas com alíquota diferenciada (monofásico, ST), THE Apurador_Impostos SHALL segregar a apuração por tipo de receita

### Requirement 23: Apuração de IPI

**User Story:** As a indústria, I want to perform quarterly IPI assessment, so that I can determinar o saldo de IPI a recolher ou crédito acumulado.

#### Acceptance Criteria

1. WHEN o usuário solicita apuração de IPI para um período, THE Apurador_Impostos SHALL calcular os débitos de IPI (saídas tributadas) e créditos de IPI (entradas de insumos, matérias-primas e produtos intermediários)
2. THE Apurador_Impostos SHALL calcular o saldo devedor ou credor de IPI do período
3. WHEN existe saldo credor de IPI do período anterior, THE Apurador_Impostos SHALL transportar o crédito para o período corrente
4. THE Apurador_Impostos SHALL gerar registros de apuração de IPI para o SPED Fiscal (Registro E520)

### Requirement 24: Livros Fiscais Digitais

**User Story:** As a contador, I want to generate fiscal books (entry, exit, assessment), so that I can manter a escrituração fiscal da empresa conforme legislação.

#### Acceptance Criteria

1. THE Sistema_Fiscal SHALL gerar o Livro de Registro de Entradas com todos os documentos fiscais de aquisição do período, classificados por CFOP
2. THE Sistema_Fiscal SHALL gerar o Livro de Registro de Saídas com todos os documentos fiscais de venda/transferência do período, classificados por CFOP
3. THE Sistema_Fiscal SHALL gerar o Livro de Apuração de ICMS com débitos, créditos, ajustes e saldo do período
4. THE Sistema_Fiscal SHALL gerar o Livro de Apuração de IPI com débitos, créditos e saldo do período
5. THE Sistema_Fiscal SHALL disponibilizar os livros fiscais em formato PDF para impressão e em dados estruturados para o SPED

### Requirement 25: GNRE - Guia de Recolhimento

**User Story:** As a responsável fiscal, I want to generate GNRE automatically for interstate ST operations, so that I can recolher ICMS-ST ao estado de destino sem atrasos.

#### Acceptance Criteria

1. WHEN uma NF-e com ICMS-ST interestadual é emitida, THE Sistema_Fiscal SHALL gerar automaticamente a GNRE com dados do documento fiscal, valor do ICMS-ST e UF de destino
2. THE Sistema_Fiscal SHALL gerar a GNRE no formato aceito pelo Portal GNRE Online (webservice ou dados para preenchimento)
3. THE Sistema_Fiscal SHALL vincular a GNRE gerada à NF-e de origem e registrar o pagamento quando confirmado
4. WHEN múltiplas NF-e para o mesmo estado são emitidas no período, THE Sistema_Fiscal SHALL permitir geração de GNRE consolidada por UF

### Requirement 26: Consulta de Situação na SEFAZ

**User Story:** As a usuário fiscal, I want to check the status of issued documents at SEFAZ, so that I can confirmar a situação cadastral dos documentos e identificar divergências.

#### Acceptance Criteria

1. WHEN o usuário solicita consulta de situação de NF-e ou CT-e, THE Sistema_Fiscal SHALL consultar o webservice da SEFAZ pela chave de acesso e retornar o status atualizado (autorizada, cancelada, denegada)
2. THE Sistema_Fiscal SHALL atualizar o status local do documento quando a situação na SEFAZ divergir do status armazenado
3. THE Sistema_Fiscal SHALL registrar data e hora da última consulta realizada para cada documento

### Requirement 27: Download Automático de XMLs (Distribuição DFe)

**User Story:** As a responsável fiscal, I want to automatically download XMLs of documents issued against my CNPJ, so that I can receber e processar notas de entrada sem depender do fornecedor enviar o XML.

#### Acceptance Criteria

1. THE Sistema_Fiscal SHALL consultar periodicamente o webservice de Distribuição DFe (AN) para buscar documentos emitidos contra o CNPJ da empresa
2. WHEN novos documentos são encontrados na distribuição, THE Sistema_Fiscal SHALL fazer download do XML completo e armazenar na base de dados
3. THE Sistema_Fiscal SHALL classificar os documentos recebidos como pendentes de manifestação e pendentes de entrada fiscal
4. THE Sistema_Fiscal SHALL registrar o NSU (Número Sequencial Único) da última consulta para buscar apenas documentos novos nas próximas consultas

### Requirement 28: Importação de XML de Entrada

**User Story:** As a responsável fiscal, I want to import supplier XML files to create fiscal entries, so that I can agilizar a entrada de mercadorias e garantir conformidade com o documento fiscal.

#### Acceptance Criteria

1. WHEN o usuário faz upload de um XML de NF-e, THE Sistema_Fiscal SHALL validar a estrutura do XML, verificar assinatura digital e consultar situação na SEFAZ
2. WHEN o XML é válido e autorizado na SEFAZ, THE Sistema_Fiscal SHALL extrair dados do emitente, destinatário, produtos, impostos e totais para pré-preencher o documento de entrada
3. THE Sistema_Fiscal SHALL realizar de-para entre produtos do fornecedor (código, descrição) e produtos cadastrados no ERP, sugerindo vinculação quando possível
4. IF o XML já foi importado anteriormente, THEN THE Sistema_Fiscal SHALL informar a duplicidade e impedir nova importação do mesmo documento
5. IF a situação na SEFAZ indica documento cancelado ou inexistente, THEN THE Sistema_Fiscal SHALL rejeitar a importação e informar o motivo ao usuário

### Requirement 29: Gestão de Certificado Digital

**User Story:** As a administrador do sistema, I want to manage digital certificates, so that I can garantir que documentos fiscais sejam assinados com certificados válidos e vigentes.

#### Acceptance Criteria

1. THE Gestor_Certificado SHALL permitir upload de certificados digitais tipo A1 (arquivo PFX/P12) com tamanho máximo de 10 MB, armazenando a senha do certificado com criptografia simétrica e o arquivo em storage não acessível publicamente
2. WHEN o administrador realiza upload de um certificado digital, THE Gestor_Certificado SHALL validar a cadeia de certificação ICP-Brasil, verificar que a data de validade não está expirada e confirmar que o CNPJ do titular corresponde ao CNPJ da empresa cadastrada
3. IF a validação do certificado no upload falhar (cadeia inválida, certificado expirado ou CNPJ divergente), THEN THE Gestor_Certificado SHALL rejeitar o arquivo, não persistir o certificado e exibir mensagem de erro indicando o motivo específico da rejeição
4. THE Gestor_Certificado SHALL verificar diariamente a data de vencimento dos certificados ativos e, WHEN um certificado está a 30 dias ou menos do vencimento, THE Gestor_Certificado SHALL enviar notificação via alerta no sistema e e-mail para os administradores uma vez por dia até a renovação ou expiração
5. IF o certificado digital associado ao CNPJ emitente está com data de validade expirada no momento da assinatura, THEN THE Gestor_Certificado SHALL impedir a emissão do documento fiscal e exibir mensagem de erro indicando que o certificado está vencido e necessita renovação
6. WHERE a empresa utiliza certificado A3 (token/smartcard), THE Gestor_Certificado SHALL disponibilizar endpoint para serviço externo de assinatura submeter o XML assinado, com timeout de resposta de 30 segundos
7. THE Gestor_Certificado SHALL permitir até 100 certificados ativos por empresa, associando cada certificado ao CNPJ da filial correspondente e selecionando automaticamente o certificado válido cujo CNPJ coincide com o CNPJ emitente do documento fiscal

### Requirement 30: Contingência Fiscal

**User Story:** As a emissor de documentos fiscais, I want to operate in contingency mode when SEFAZ is unavailable, so that I can continuar emitindo documentos sem interrupção da operação comercial.

#### Acceptance Criteria

1. IF a SEFAZ rejeitar conexão ou não responder dentro do timeout configurado (padrão 30 segundos, configurável entre 5 e 120 segundos) por 3 tentativas consecutivas, THEN THE Emissor_DFe SHALL ativar automaticamente o modo de contingência configurado para a UF do emitente
2. WHILE o sistema está em modo de contingência SVC (Servidor Virtual de Contingência), THE Emissor_DFe SHALL transmitir NF-e ao SVC-AN ou SVC-RS conforme UF do emitente
3. WHILE o sistema está em contingência offline (FS-DA), THE Emissor_DFe SHALL gerar o documento em formulário de segurança (DANFE em contingência) com indicação de "emitido em contingência" e enfileirar o XML para transmissão posterior, respeitando o limite máximo de 500 documentos na fila
4. WHEN a SEFAZ responder com sucesso a 1 consulta de status do serviço (NfeStatusServico) após período de indisponibilidade, THE Emissor_DFe SHALL transmitir automaticamente os documentos pendentes em fila de contingência em ordem cronológica (FIFO) e atualizar o status de cada documento conforme resposta da SEFAZ
5. THE Emissor_DFe SHALL registrar log de entrada e saída do modo contingência com timestamp, motivo, modalidade utilizada e quantidade de documentos pendentes na fila
6. IF a retransmissão de um documento da fila de contingência falhar após 3 tentativas, THEN THE Emissor_DFe SHALL marcar o documento com status "falha na retransmissão", manter os demais documentos da fila em processamento e notificar o operador fiscal sobre a pendência

### Requirement 31: Cadastro de NCM

**User Story:** As a responsável fiscal, I want to maintain an NCM registry with TEC, so that I can classificar produtos corretamente e vincular regras tributárias.

#### Acceptance Criteria

1. THE Sistema_Fiscal SHALL manter tabela de NCM atualizada com código (8 dígitos), descrição e unidade estatística
2. THE Sistema_Fiscal SHALL vincular a cada NCM os dados da TEC (Tarifa Externa Comum): alíquota de Imposto de Importação (II) e IPI quando aplicável
3. THE Sistema_Fiscal SHALL permitir busca de NCM por código ou descrição com resultado paginado
4. WHEN uma atualização da tabela NCM é publicada pela RFB, THE Sistema_Fiscal SHALL permitir importação da nova versão sem perda dos vínculos existentes com produtos

### Requirement 32: Cadastro de CFOP

**User Story:** As a responsável fiscal, I want to maintain a CFOP registry with usage rules, so that I can classificar operações corretamente e automatizar tributação.

#### Acceptance Criteria

1. THE Sistema_Fiscal SHALL manter tabela de CFOP com código (4 dígitos), descrição e classificação (entrada/saída, dentro/fora do estado, exterior)
2. THE Sistema_Fiscal SHALL vincular a cada CFOP as regras de uso: tipo de operação permitida, se gera crédito de ICMS, se gera crédito de PIS/COFINS, se incide IPI
3. THE Sistema_Fiscal SHALL validar que o CFOP utilizado é compatível com a operação (entrada vs. saída, interna vs. interestadual vs. exterior)
4. THE Sistema_Fiscal SHALL sugerir CFOP apropriado com base no tipo de operação e localização do destinatário

### Requirement 33: Cadastro de CEST

**User Story:** As a responsável fiscal, I want to maintain a CEST registry, so that I can vincular corretamente produtos sujeitos a substituição tributária.

#### Acceptance Criteria

1. THE Sistema_Fiscal SHALL manter tabela de CEST com código (7 dígitos), descrição e segmento
2. THE Sistema_Fiscal SHALL vincular CEST aos NCMs correspondentes conforme tabela Convênio ICMS 142/2018
3. WHEN um produto com NCM sujeito a ST é incluído em documento fiscal sem CEST, THE Sistema_Fiscal SHALL alertar o usuário sobre a obrigatoriedade do CEST
4. THE Sistema_Fiscal SHALL permitir busca de CEST por código, descrição ou NCM vinculado

### Requirement 34: Cadastro de CST/CSOSN

**User Story:** As a responsável fiscal, I want to maintain CST and CSOSN registries, so that I can classificar a tributação de cada item nos documentos fiscais.

#### Acceptance Criteria

1. THE Sistema_Fiscal SHALL manter tabelas de CST para ICMS, PIS, COFINS e IPI com código e descrição
2. THE Sistema_Fiscal SHALL manter tabela de CSOSN para empresas do Simples Nacional com código e descrição
3. WHILE a empresa está no Simples Nacional, THE Sistema_Fiscal SHALL utilizar CSOSN ao invés de CST de ICMS nos documentos fiscais
4. THE Sistema_Fiscal SHALL validar que o CST/CSOSN informado é compatível com o tipo de operação e regime tributário da empresa

### Requirement 35: Natureza de Operação

**User Story:** As a responsável fiscal, I want to configure operation natures linked to CFOP and tax rules, so that I can padronizar operações e automatizar tributação ao selecionar a natureza.

#### Acceptance Criteria

1. THE Sistema_Fiscal SHALL permitir cadastro de Natureza de Operação com: descrição, CFOP de entrada correspondente, CFOP de saída correspondente, tipo de operação (venda, devolução, transferência, remessa, etc.)
2. THE Sistema_Fiscal SHALL vincular cada Natureza de Operação a um conjunto de Regras_Tributarias padrão
3. WHEN o usuário seleciona uma Natureza de Operação ao criar um documento fiscal, THE Sistema_Fiscal SHALL preencher automaticamente o CFOP e aplicar as regras tributárias vinculadas
4. THE Sistema_Fiscal SHALL ajustar automaticamente o CFOP (1xxx/2xxx/3xxx para entrada, 5xxx/6xxx/7xxx para saída) com base na localização do remetente/destinatário (mesma UF, outra UF, exterior)

### Requirement 36: Validação de XML Fiscal

**User Story:** As a desenvolvedor do sistema, I want to validate fiscal XML against SEFAZ schemas, so that I can garantir que documentos tenham estrutura correta antes da transmissão.

#### Acceptance Criteria

1. WHEN um XML fiscal é gerado para transmissão, THE Emissor_DFe SHALL validar o XML contra o schema XSD vigente do tipo de documento (NF-e, NFC-e, CT-e, MDF-e)
2. IF a validação contra schema XSD detectar erros, THEN THE Emissor_DFe SHALL informar os campos com erro e impedir a transmissão
3. THE Emissor_DFe SHALL validar regras de negócio (totais, CNPJ, IE, datas) antes da transmissão à SEFAZ
4. FOR ALL XML fiscais gerados, serializar e depois parsear o XML SHALL produzir um documento equivalente ao original (propriedade round-trip)

### Requirement 37: Auditoria e Rastreabilidade Fiscal

**User Story:** As a auditor fiscal, I want to trace all fiscal operations, so that I can rastrear a origem de cada cálculo tributário e identificar alterações.

#### Acceptance Criteria

1. THE Sistema_Fiscal SHALL registrar log de auditoria para toda operação fiscal: emissão, cancelamento, inutilização, alteração de regra tributária, importação de XML
2. THE Sistema_Fiscal SHALL armazenar no log: usuário, timestamp, operação realizada, dados anteriores e posteriores da alteração
3. THE Sistema_Fiscal SHALL manter rastreabilidade do cálculo tributário: para cada item de documento fiscal, registrar qual Regra_Tributaria foi utilizada e quais valores foram calculados
4. THE Sistema_Fiscal SHALL impedir exclusão de registros do log de auditoria fiscal
