# Implementation Plan: Módulo Fiscal ERP

## Overview

Implementação do Módulo Fiscal completo para o VisioFab ERP, cobrindo emissão de documentos fiscais eletrônicos, motor tributário configurável, cálculos de impostos, obrigações acessórias SPED, apuração, contingência, certificados digitais e auditoria. A implementação segue a arquitetura modular Fastify existente com Prisma 6, Zod e TypeScript.

## Tasks

- [x] 1. Estrutura base e modelos de dados do módulo fiscal
  - [x] 1.1 Criar migration Prisma com todos os modelos fiscais
    - Adicionar ao schema.prisma os modelos: RegraTributaria, DocumentoFiscal, ItemDocumentoFiscal, EventoDocumentoFiscal, CertificadoDigital, FilaContingencia, LogContingencia, ApuracaoFiscal, DetalheApuracao, Ncm, Cfop, Cest, CestNcm, NaturezaOperacao, Gnre, XmlImportado, AuditoriaFiscal
    - Criar índices compostos e constraints de unicidade conforme design
    - Executar `npx prisma migrate dev` para gerar migration
    - _Requirements: 7.1, 14.1, 20.1, 28.1, 29.1, 37.1_

  - [x] 1.2 Criar estrutura de diretórios do módulo fiscal
    - Criar `src/modules/fiscal/` com subpastas: motor-tributario, emissor-dfe, emissor-dfe/nfe, emissor-dfe/nfce, emissor-dfe/cte, emissor-dfe/mdfe, emissor-dfe/nfse, emissor-dfe/sefaz, emissor-dfe/xml, emissor-dfe/manifesto, contingencia, certificado, sped, apuracao, cadastros, gnre, importacao, auditoria, dctf
    - Criar arquivo `fiscal.routes.ts` com registro do plugin Fastify principal
    - _Requirements: 1.1, 7.1_

  - [x] 1.3 Criar tipos e interfaces compartilhados do módulo fiscal
    - Criar `src/modules/fiscal/motor-tributario/tipos.ts` com interfaces: RegraTributaria, ResultadoCalculoTributario, NivelFallback
    - Criar `src/modules/fiscal/emissor-dfe/tipos.ts` com interfaces: EmissaoRequest, EmissaoResponse, StatusDocumento
    - Criar `src/modules/fiscal/emissor-dfe/sefaz/tipos.ts` com interfaces: SefazClient, RespostaSefaz, ServicoSefaz
    - Criar `src/modules/fiscal/sped/tipos.ts` com interfaces: GeradorSPED, ArquivoSPED, PeriodoParams
    - Criar `src/modules/fiscal/erros.ts` com enum CodigoErroFiscal e classe de erro customizada
    - _Requirements: 7.1, 1.1, 14.1_

  - [x] 1.4 Criar schemas Zod de validação para o módulo fiscal
    - Criar schemas para: RegraTributariaInput, EmissaoNFeInput, EmissaoNFCeInput, CancelamentoInput, CCeInput, InutilizacaoInput, CertificadoUploadInput, ApuracaoInput, PeriodoSPEDInput, ImportacaoXMLInput
    - Validar NCM (8 dígitos), CFOP (4 dígitos), UF (2 caracteres), alíquotas (0-100 com 2 decimais)
    - _Requirements: 1.1, 1.10, 7.1, 29.1_

- [x] 2. Checkpoint - Verificar estrutura base
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Motor Tributário - Regras e busca
  - [x] 3.1 Implementar CRUD de regras tributárias
    - Criar `motor-tributario.routes.ts` com rotas POST, GET, PUT, DELETE para regras tributárias
    - Criar `motor-tributario.service.ts` com lógica de criação, leitura, atualização e exclusão
    - Implementar validação de unicidade (NCM + CFOP + UF_orig + UF_dest + Regime) rejeitando duplicatas
    - _Requirements: 7.1_

  - [ ]* 3.2 Write property test: Motor Tributário rejeita duplicatas
    - **Property 4: Motor Tributário — busca exata rejeita duplicatas**
    - **Validates: Requirements 7.1**

  - [x] 3.3 Implementar busca de regra com fallback hierárquico
    - Implementar busca exata por combinação NCM + CFOP + UF_orig + UF_dest + Regime
    - Implementar fallback: 1º NCM parcial (4 dígitos), 2º CFOP genérico (último dígito zero), 3º padrão do regime
    - Retornar nível de fallback utilizado no resultado
    - Bloquear item se nenhuma regra encontrada em nenhum nível
    - Implementar cache LRU com TTL de 5min para performance (≤500ms/item)
    - _Requirements: 7.2, 7.3, 7.4_

  - [ ]* 3.4 Write property test: Fallback hierárquico determinístico
    - **Property 5: Motor Tributário — fallback hierárquico determinístico**
    - **Validates: Requirements 7.2, 7.3, 7.4**

  - [x] 3.5 Implementar preenchimento automático de campos tributários
    - Quando regra é encontrada, preencher CST/CSOSN, alíquotas e bases no item
    - Registrar regraTributariaId e nivelFallback no item do documento
    - Permitir sobrescrita manual antes da emissão
    - _Requirements: 7.5_

  - [ ]* 3.6 Write property test: Preenchimento automático correto
    - **Property 6: Preenchimento automático de campos tributários a partir de regra**
    - **Validates: Requirements 7.5**

- [x] 4. Motor Tributário - Cálculos de impostos
  - [x] 4.1 Implementar cálculo de ICMS (normal, redução, desoneração, diferimento)
    - Criar `calculo-icms.ts` com funções: calcularICMSNormal (CST 00), calcularICMSReduzido (CST 20), calcularICMSDesonerado (CST 30/40/41/50/60), calcularICMSDiferido (CST 51)
    - Base = vProd + vFrete + vSeg + vOutras - vDesc
    - Arredondamento ABNT NBR 5891 (half-up, 2 casas decimais)
    - Para diferimento: garantir que ICMS_diferido + ICMS_recolher = ICMS_total
    - _Requirements: 8.1, 8.3, 8.4, 8.5, 8.8_

  - [ ]* 4.2 Write property test: ICMS normal correto e arredondado
    - **Property 7: Cálculo de ICMS normal é correto e arredondado**
    - **Validates: Requirements 8.1, 8.8**

  - [ ]* 4.3 Write property test: Invariante do diferimento parcial
    - **Property 8: Invariante do diferimento parcial (CST 51)**
    - **Validates: Requirements 8.5**

  - [x] 4.4 Implementar cálculo de DIFAL e alíquotas interestaduais
    - Calcular DIFAL = base × (alíq_interna_destino - alíq_interestadual) / 100
    - 100% do diferencial ao estado de destino
    - Tabela de alíquotas interestaduais: 7% (Sul/Sudeste exceto ES → N/NE/CO/ES), 12% (demais), 4% (importados >40%)
    - _Requirements: 8.2, 8.6_

  - [ ]* 4.5 Write property test: DIFAL correto
    - **Property 9: DIFAL = alíquota interna destino - alíquota interestadual**
    - **Validates: Requirements 8.2**

  - [ ]* 4.6 Write property test: Alíquotas interestaduais tabela legal
    - **Property 10: Alíquotas interestaduais seguem tabela legal**
    - **Validates: Requirements 8.6**

  - [x] 4.7 Implementar cálculo de ICMS-ST
    - Criar funções para: base ST com MVA, base ST com MVA ajustado, base ST com PMPF
    - ICMS-ST = (Base_ST × alíq_interna) - ICMS_próprio
    - Priorizar PMPF sobre MVA quando disponível
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [ ]* 4.8 Write property test: ICMS-ST fórmula correta
    - **Property 11: ICMS-ST = (Base ST × alíq interna) - ICMS próprio**
    - **Validates: Requirements 9.3**

  - [ ]* 4.9 Write property test: Base ST com MVA vs PMPF
    - **Property 12: Base ST com MVA vs PMPF**
    - **Validates: Requirements 9.1, 9.2, 9.4**

  - [x] 4.10 Implementar cálculo de FCP (normal, ST, DIFAL)
    - FCP = base_ICMS × alíq_FCP / 100
    - FCP-ST = base_ST × alíq_FCP / 100
    - FCP-DIFAL = base_DIFAL × alíq_FCP / 100
    - Destacar FCP em campo próprio
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

  - [ ]* 4.11 Write property test: FCP sobre base correta
    - **Property 16: FCP é calculado sobre base do imposto correspondente**
    - **Validates: Requirements 13.1, 13.2, 13.3**

  - [x] 4.12 Implementar cálculo de PIS/COFINS
    - Criar `calculo-pis-cofins.ts` com cálculo por regime: não-cumulativo (1,65% PIS, 7,6% COFINS) e cumulativo (0,65% PIS, 3% COFINS)
    - Suportar alíquotas diferenciadas por NCM (monofásico, alíquota zero, ST)
    - Registrar créditos sobre aquisições no regime não-cumulativo
    - Preencher CST de PIS e COFINS
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [ ]* 4.13 Write property test: PIS/COFINS alíquotas por regime
    - **Property 13: PIS/COFINS aplica alíquotas corretas por regime**
    - **Validates: Requirements 10.1, 10.2, 10.3**

  - [x] 4.14 Implementar cálculo de IPI
    - Criar `calculo-ipi.ts` com cálculo ad valorem e por pauta
    - Base ad valorem = vProd + vFrete + vSeg + vOutras
    - IPI pauta = quantidade × valor_fixo_unidade
    - CST isenção/imunidade/suspensão → IPI = 0
    - Registrar créditos nas entradas
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

  - [ ]* 4.15 Write property test: IPI ad valorem e pauta
    - **Property 14: IPI = base × alíquota (ou quantidade × valor_pauta)**
    - **Validates: Requirements 11.1, 11.2, 11.3**

  - [x] 4.16 Implementar cálculo de ISS
    - Criar `calculo-iss.ts` com cálculo sobre valor do serviço
    - Suportar retenção na fonte (tomador retém)
    - Aplicar alíquota do município de prestação quando ISS devido no destino
    - Validar limites: mínimo 2%, máximo 5%
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

  - [ ]* 4.17 Write property test: ISS limites 2%-5%
    - **Property 15: ISS respeita limites de alíquota (2% a 5%)**
    - **Validates: Requirements 12.1, 12.4**

- [x] 5. Checkpoint - Verificar motor tributário
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Gestão de Certificados Digitais
  - [x] 6.1 Implementar criptografia de certificados (AES-256-GCM)
    - Criar `certificado-crypto.ts` com funções: encryptPfx, decryptPfx, encryptSenha, decryptSenha
    - Chave derivada de env var FISCAL_CERT_ENCRYPTION_KEY
    - IV gerado aleatoriamente por operação
    - _Requirements: 29.1_

  - [x] 6.2 Implementar serviço de gestão de certificados
    - Criar `certificado.service.ts` com: upload (validação cadeia ICP-Brasil, verificação CNPJ, data validade), obterParaAssinatura (seleção por CNPJ ativo), verificarVencimentos
    - Rejeitar upload se: cadeia inválida, CNPJ divergente, expirado
    - Limite: até 100 certificados ativos por empresa
    - _Requirements: 29.1, 29.2, 29.3, 29.5, 29.7_

  - [ ]* 6.3 Write property test: Certificado vencido bloqueia assinatura
    - **Property 22: Certificado vencido bloqueia assinatura**
    - **Validates: Requirements 29.5**

  - [ ]* 6.4 Write property test: Seleção automática de certificado por CNPJ
    - **Property 23: Seleção automática de certificado por CNPJ**
    - **Validates: Requirements 29.7**

  - [x] 6.5 Implementar rotas de certificados
    - Criar `certificado.routes.ts` com: POST /fiscal/certificados (upload PFX), GET /fiscal/certificados (listar), GET /fiscal/certificados/vencimentos (alertas), DELETE /fiscal/certificados/:id
    - Suportar endpoint para assinatura externa (A3) com timeout 30s
    - _Requirements: 29.1, 29.4, 29.6_

- [x] 7. XML - Geração, Validação e Assinatura
  - [x] 7.1 Implementar XML builder para NF-e
    - Criar `nfe-xml-builder.ts` que monta XML NF-e layout 4.00 a partir dos dados tipados
    - Incluir todos os grupos: ide, emit, dest, det (itens), total, transp, cobr, pag, infAdic
    - Gerar chave de acesso de 44 dígitos
    - _Requirements: 1.1, 36.3_

  - [x] 7.2 Implementar validação XSD de documentos fiscais
    - Criar `xml-validator.ts` usando libxmljs2 para validação contra schemas XSD
    - Suportar schemas: NF-e 4.00, NFC-e 4.00, CT-e 4.00, MDF-e 3.00
    - Retornar lista de campos com erro quando inválido
    - _Requirements: 1.1, 1.10, 36.1, 36.2_

  - [ ]* 7.3 Write property test: Validação XSD aceita/rejeita corretamente
    - **Property 1: Validação XSD rejeita dados inválidos e aceita dados válidos**
    - **Validates: Requirements 1.1, 1.10, 36.1, 36.2**

  - [x] 7.4 Implementar assinatura digital XML (XML-DSig)
    - Criar `xml-signer.ts` usando xml-crypto + node-forge
    - Assinar com enveloped signature sobre infNFe/infCTe/infMDFe
    - Algoritmo: RSA-SHA1, canonicalization C14N
    - Incluir X509 certificate na KeyInfo
    - _Requirements: 1.1, 29.5_

  - [x] 7.5 Implementar parser XML → objetos tipados
    - Criar `xml-parser.ts` para converter XML de NF-e autorizada em objetos TypeScript tipados
    - Suportar parsing de retornos SEFAZ (protocolos, eventos)
    - _Requirements: 36.4_

  - [ ]* 7.6 Write property test: Round-trip XML
    - **Property 20: Round-trip de XML fiscal**
    - **Validates: Requirements 36.4, 28.2**

- [x] 8. Cliente SEFAZ e comunicação
  - [x] 8.1 Implementar cliente SOAP genérico para SEFAZ
    - Criar `sefaz-client.ts` com: transmitir(), consultarStatus(), consultarProtocolo(), distribuicaoDFe()
    - SOAP 1.2 sobre HTTPS com mTLS via certificado A1
    - Retry: 3 tentativas com 5s de intervalo
    - Timeout configurável (padrão 30s, 5-120s)
    - _Requirements: 1.1, 1.4, 30.1_

  - [x] 8.2 Implementar resolução de URLs SEFAZ por UF e ambiente
    - Criar `sefaz-urls.ts` com mapeamento de UFs autorizadoras (SP, MG, BA, PR, RS, MT, MS, GO, PE) e via SVRS
    - Incluir URLs de contingência SVC-AN e SVC-RS
    - Separar URLs por serviço e ambiente (produção/homologação)
    - _Requirements: 1.1, 30.2_

  - [x] 8.3 Implementar consulta de status do serviço SEFAZ
    - Criar `sefaz-status.ts` com consulta NfeStatusServico4
    - Usado para probe de contingência (verificar retorno ao normal)
    - _Requirements: 26.1, 30.4_

  - [x] 8.4 Implementar distribuição DFe (download automático de XMLs)
    - Criar `distribuicao-dfe.ts` com consulta ao webservice AN por NSU
    - Download de XML completo de documentos emitidos contra o CNPJ
    - Armazenar NSU da última consulta
    - _Requirements: 27.1, 27.2, 27.3, 27.4_

- [x] 9. Checkpoint - Verificar infraestrutura XML e SEFAZ
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Emissão de NF-e
  - [x] 10.1 Implementar serviço de emissão de NF-e
    - Criar `nfe-emissao.service.ts` orquestrando: calcular tributos → gerar XML → validar XSD → assinar → transmitir SEFAZ
    - Armazenar XML autorizado com protocolo quando cStat=100
    - Armazenar rejeição (cStat, xMotivo) quando rejeitada
    - Ativar contingência após 3 falhas de comunicação
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 10.2 Implementar validador de NF-e (regras de negócio)
    - Criar `nfe-validador.ts` com validações pré-transmissão
    - Validar campos obrigatórios, totais, CNPJ, IE, datas
    - Bloquear transmissão se inválido, retornar lista de erros
    - _Requirements: 1.1, 1.10_

  - [x] 10.3 Implementar eventos de NF-e (cancelamento, CC-e, inutilização)
    - Criar `nfe-eventos.ts` com: cancelar (tpEvento=110111, justificativa 15-255 chars, prazo <24h), cartaCorrecao (tpEvento=110110, texto 15-1000 chars, máx 20 por NF-e), inutilizar (faixa máx 1000 números, justificativa 15-255 chars)
    - Bloquear cancelamento após 24h
    - _Requirements: 1.5, 1.6, 1.7, 1.8_

  - [ ]* 10.4 Write property test: Cancelamento respeita prazo 24h
    - **Property 2: Cancelamento respeita prazo de 24 horas**
    - **Validates: Requirements 1.5, 1.6**

  - [ ]* 10.5 Write property test: CC-e e Inutilização limites
    - **Property 3: CC-e e Inutilização respeitam limites de texto e numeração**
    - **Validates: Requirements 1.7, 1.8**

  - [x] 10.6 Implementar geração de DANFE em PDF
    - Criar `nfe-danfe.ts` para gerar DANFE a partir do XML autorizado
    - Layout retrato/paisagem conforme configuração da empresa
    - Disponibilizar em até 5 segundos após autorização
    - _Requirements: 1.9_

  - [x] 10.7 Implementar rotas de NF-e
    - Criar `emissor-dfe.routes.ts` com: POST /fiscal/nfe/emitir, POST /fiscal/nfe/:id/cancelar, POST /fiscal/nfe/:id/carta-correcao, POST /fiscal/nfe/inutilizar, GET /fiscal/nfe/:id/danfe, GET /fiscal/nfe (listagem com filtros)
    - _Requirements: 1.1, 1.5, 1.7, 1.8, 1.9_

- [x] 11. Emissão de NFC-e
  - [x] 11.1 Implementar serviço de emissão de NFC-e
    - Criar `nfce-emissao.service.ts` com emissão rápida (≤5s), contingência offline automática (>5s sem resposta)
    - DANFE-NFC-e em layout simplificado
    - Cancelamento em até 30 minutos
    - Enfileirar para reenvio automático em contingência
    - _Requirements: 2.1, 2.2, 2.4, 2.5, 2.6_

  - [x] 11.2 Implementar DANFE-NFC-e simplificado
    - Criar `nfce-danfe.ts` com layout conforme MOC vigente
    - Indicação visual de contingência quando aplicável
    - _Requirements: 2.2_

- [x] 12. Emissão de CT-e e MDF-e
  - [x] 12.1 Implementar serviço de emissão de CT-e
    - Criar `cte-emissao.service.ts` e `cte-xml-builder.ts`
    - Emissão, cancelamento, CC-e, geração DACTE em PDF
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 12.2 Implementar serviço de emissão de MDF-e
    - Criar `mdfe-emissao.service.ts` e `mdfe-xml-builder.ts`
    - Vincular CT-e ou NF-e ao manifesto
    - Eventos: encerramento, cancelamento, inclusão de condutor/veículo
    - Gerar DAMDFE em PDF
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 13. Emissão de NFS-e
  - [x] 13.1 Implementar adapters para webservices municipais
    - Criar `adapters/abrasf.adapter.ts`, `ginfes.adapter.ts`, `issnet.adapter.ts`
    - Interface comum para: emitir, cancelar, consultar
    - Seleção do adapter por município configurado
    - _Requirements: 5.1, 5.4_

  - [x] 13.2 Implementar serviço de emissão de NFS-e
    - Criar `nfse-emissao.service.ts` com: identificar webservice por município, transmitir, armazenar retorno, registrar número da nota
    - Enfileirar para reenvio se webservice indisponível
    - _Requirements: 5.1, 5.2, 5.3, 5.5_

- [x] 14. Manifesto do Destinatário (MDe)
  - [x] 14.1 Implementar manifesto do destinatário
    - Criar `manifesto-destinatario.ts` com eventos: Ciência (210210), Confirmação (210200), Desconhecimento (210220), Operação Não Realizada (210240)
    - Listar NF-e pendentes de manifestação com prazo restante
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 15. Checkpoint - Verificar emissão de documentos fiscais
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. Contingência fiscal
  - [x] 16.1 Implementar serviço de contingência
    - Criar `contingencia.service.ts` com máquina de estados: Normal → Contingência → ProbeStatus → Normal
    - Ativação automática após 3 falhas consecutivas
    - Probe a cada 60s com NfeStatusServico
    - Registrar log de entrada/saída com timestamp, motivo, modalidade, docs pendentes
    - _Requirements: 30.1, 30.4, 30.5_

  - [x] 16.2 Implementar fila de contingência
    - Criar `fila-contingencia.ts` com: enfileirar (limite 500/empresa), retransmitir em ordem FIFO, marcar falha após 3 tentativas individuais
    - Falha de um documento não afeta os demais
    - Notificar operador sobre falhas de retransmissão
    - _Requirements: 30.3, 30.6_

  - [ ]* 16.3 Write property test: Fila respeita limite 500 e ordem FIFO
    - **Property 24: Fila de contingência respeita limite de 500 e ordem FIFO**
    - **Validates: Requirements 30.3, 30.4**

  - [ ]* 16.4 Write property test: Falha individual não afeta fila
    - **Property 25: Falha de retransmissão de um documento não afeta os demais**
    - **Validates: Requirements 30.6**

  - [x] 16.5 Implementar rotas de contingência
    - Criar `contingencia.routes.ts` com: GET /fiscal/contingencia/status, GET /fiscal/contingencia/fila, POST /fiscal/contingencia/retransmitir
    - _Requirements: 30.1, 30.4_

- [x] 17. Geração SPED Fiscal (EFD ICMS/IPI)
  - [x] 17.1 Implementar SPED Writer streaming
    - Criar `sped-writer.ts` com: writeRegistro (bloco, tipo, campos), finalize (gera Bloco 9)
    - Encoding ISO-8859-1, delimitador pipe (|), CR+LF
    - Contadores por bloco para Bloco 9
    - _Requirements: 14.5_

  - [ ]* 17.2 Write property test: Block 9 counts match
    - **Property 17: SPED Fiscal — Block 9 counts match actual records**
    - **Validates: Requirements 14.5**

  - [x] 17.3 Implementar gerador SPED Fiscal (EFD ICMS/IPI)
    - Criar `sped-fiscal.generator.ts` com blocos obrigatórios: 0, C, D, E, G, H, K, 1, 9
    - Bloco C: documentos modelos 01, 1B, 04, 55, 65 com detalhamento por item
    - Bloco D: CT-e modelo 57
    - Bloco E: apuração ICMS, ICMS-ST e IPI
    - Performance: ≤120s para 100.000 documentos
    - Gerar movimento zerado se sem documentos no período
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.7_

  - [ ]* 17.4 Write property test: Documentos do período no arquivo SPED
    - **Property 18: SPED Fiscal — todos os documentos do período aparecem nos blocos C/D**
    - **Validates: Requirements 14.2, 14.3**

  - [x] 17.5 Implementar validador estrutural SPED
    - Criar `sped-validator.ts` com: verificar presença de blocos obrigatórios, sequência pai-filho, totalização Bloco 9, campos obrigatórios
    - Impedir disponibilização se inconsistente
    - _Requirements: 14.5, 14.6_

- [x] 18. Geração SPED Contribuições, ECD, ECF, Reinf, DCTF-Web
  - [x] 18.1 Implementar gerador SPED Contribuições (EFD PIS/COFINS)
    - Criar `sped-contribuicoes.generator.ts` com blocos: 0, A, C, D, F, M, 1, 9
    - Bloco A: NFS-e, Bloco C: documentos de mercadoria, Bloco F: receitas/deduções, Bloco M: apuração PIS/COFINS
    - Detalhar créditos por base no regime não-cumulativo
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6_

  - [x] 18.2 Implementar gerador ECD (Escrituração Contábil Digital)
    - Criar `sped-ecd.generator.ts` com blocos: 0, I, J, 9
    - Incluir plano de contas, saldos periódicos, lançamentos diários
    - _Requirements: 16.1, 16.2, 16.3_

  - [x] 18.3 Implementar gerador ECF (Escrituração Contábil Fiscal)
    - Criar `sped-ecf.generator.ts` com dados de IRPJ/CSLL conforme regime
    - Recuperar dados da ECD para blocos contábeis
    - _Requirements: 17.1, 17.2, 17.3_

  - [x] 18.4 Implementar gerador EFD-Reinf
    - Criar `sped-reinf.generator.ts` com eventos: R-1000 (contribuinte), R-2010 (retenções tomados), R-2020 (retenções prestados), R-2099 (fechamento)
    - Transmitir via webservice RFB assinado com certificado digital
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5_

  - [x] 18.5 Implementar consolidação DCTF-Web
    - Criar `dctf-web.service.ts` com consolidação de débitos federais (PIS, COFINS, IRRF, CSLL, INSS)
    - Conciliar com apurações mensais
    - Exportar no formato aceito pelo e-CAC
    - _Requirements: 19.1, 19.2, 19.3_

  - [x] 18.6 Implementar rotas SPED
    - Criar `sped.routes.ts` com: POST /fiscal/sped/fiscal (gerar EFD), POST /fiscal/sped/contribuicoes, POST /fiscal/sped/ecd, POST /fiscal/sped/ecf, POST /fiscal/sped/reinf/transmitir, GET /fiscal/sped/:id/download
    - _Requirements: 14.1, 15.1, 16.1, 17.1, 18.1_

- [x] 19. Checkpoint - Verificar geração SPED
  - Ensure all tests pass, ask the user if questions arise.

- [x] 20. Apuração de impostos
  - [x] 20.1 Implementar apuração de ICMS
    - Criar `apuracao-icms.service.ts` com: calcular débitos (saídas), créditos (entradas), estornos, ajustes
    - Transportar saldo credor do período anterior
    - Suportar transferência de crédito acumulado
    - Gerar registros E110 para SPED
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6_

  - [ ]* 20.2 Write property test: Apuração ICMS saldo correto
    - **Property 19: Apuração ICMS — saldo = débitos - créditos + estornos + ajustes + saldo anterior**
    - **Validates: Requirements 20.1, 20.2, 20.3, 20.5**

  - [x] 20.3 Implementar apuração de ICMS-ST
    - Calcular débitos ST (retido saídas) e créditos ST (retido entradas) por UF destino
    - Calcular ressarcimento quando venda a consumidor final por valor inferior à base ST
    - Separar por UF para operações interestaduais
    - _Requirements: 21.1, 21.2, 21.3, 21.4_

  - [x] 20.4 Implementar apuração de PIS/COFINS
    - Criar `apuracao-pis-cofins.service.ts` com: débitos sobre receitas, créditos sobre aquisições (regime não-cumulativo), detalhar créditos por natureza
    - Valor líquido = débitos - créditos (separado PIS e COFINS)
    - Transportar crédito excedente
    - Segregar por tipo de receita quando alíquotas diferenciadas
    - _Requirements: 22.1, 22.2, 22.3, 22.4, 22.5_

  - [x] 20.5 Implementar apuração de IPI
    - Criar `apuracao-ipi.service.ts` com: débitos (saídas tributadas), créditos (insumos/MP)
    - Transportar saldo credor anterior
    - Gerar registros E520 para SPED
    - _Requirements: 23.1, 23.2, 23.3, 23.4_

  - [x] 20.6 Implementar geração de livros fiscais digitais
    - Criar `livros-fiscais.service.ts` com: Livro de Entradas, Livro de Saídas, Livro de Apuração ICMS, Livro de Apuração IPI
    - Classificar por CFOP
    - Disponibilizar em PDF e dados estruturados
    - _Requirements: 24.1, 24.2, 24.3, 24.4, 24.5_

  - [x] 20.7 Implementar rotas de apuração
    - Criar `apuracao.routes.ts` com: POST /fiscal/apuracao/icms, POST /fiscal/apuracao/icms-st, POST /fiscal/apuracao/pis-cofins, POST /fiscal/apuracao/ipi, GET /fiscal/apuracao/:tipo/:periodo, POST /fiscal/apuracao/:id/fechar
    - _Requirements: 20.1, 21.1, 22.1, 23.1_

- [x] 21. Cadastros auxiliares fiscais
  - [x] 21.1 Implementar CRUD de NCM
    - Criar `ncm.routes.ts` com: GET /fiscal/cadastros/ncm (busca paginada por código/descrição), POST /fiscal/cadastros/ncm/importar (importação em lote)
    - Vincular TEC (alíquota II, IPI)
    - Importar sem perder vínculos com produtos
    - _Requirements: 31.1, 31.2, 31.3, 31.4_

  - [x] 21.2 Implementar CRUD de CFOP
    - Criar `cfop.routes.ts` com: GET /fiscal/cadastros/cfop (listagem com filtros), regras de uso vinculadas
    - Validar compatibilidade CFOP × operação
    - Sugerir CFOP por tipo de operação + localização
    - _Requirements: 32.1, 32.2, 32.3, 32.4_

  - [x] 21.3 Implementar CRUD de CEST
    - Criar `cest.routes.ts` com: GET /fiscal/cadastros/cest (busca por código/descrição/NCM), vincular NCMs (Convênio ICMS 142/2018)
    - Alertar quando NCM sujeito a ST sem CEST em documento
    - _Requirements: 33.1, 33.2, 33.3, 33.4_

  - [x] 21.4 Implementar CRUD de CST/CSOSN
    - Criar `cst-csosn.routes.ts` com tabelas de CST (ICMS, PIS, COFINS, IPI) e CSOSN
    - Usar CSOSN no Simples Nacional, CST nos demais
    - Validar compatibilidade com operação e regime
    - _Requirements: 34.1, 34.2, 34.3, 34.4_

  - [x] 21.5 Implementar CRUD de Natureza de Operação
    - Criar `natureza-operacao.routes.ts` com: descrição, CFOP entrada/saída, tipo operação
    - Vincular a regras tributárias padrão
    - Preencher CFOP automaticamente ao selecionar natureza
    - Ajustar CFOP (1/2/3xxx ou 5/6/7xxx) por localização
    - _Requirements: 35.1, 35.2, 35.3, 35.4_

- [x] 22. GNRE e Consulta SEFAZ
  - [x] 22.1 Implementar geração de GNRE
    - Criar `gnre.service.ts` com: geração automática para NF-e com ICMS-ST interestadual, vincular à NF-e de origem, consolidar por UF
    - Registrar pagamento quando confirmado
    - _Requirements: 25.1, 25.2, 25.3, 25.4_

  - [x] 22.2 Implementar consulta de situação na SEFAZ
    - Consultar webservice pela chave de acesso
    - Atualizar status local quando divergir
    - Registrar data/hora da consulta
    - _Requirements: 26.1, 26.2, 26.3_

  - [x] 22.3 Implementar rotas GNRE e consulta
    - Criar `gnre.routes.ts` com: POST /fiscal/gnre/gerar, GET /fiscal/gnre (listagem), POST /fiscal/gnre/:id/pagar
    - Rota consulta: GET /fiscal/documentos/:id/consultar-sefaz
    - _Requirements: 25.1, 26.1_

- [x] 23. Importação de XML de entrada
  - [x] 23.1 Implementar serviço de importação de XML
    - Criar `importacao-xml.service.ts` com: validar estrutura, verificar assinatura digital, consultar situação SEFAZ
    - Extrair dados para pré-preenchimento de entrada
    - De-para entre produtos do fornecedor e produtos ERP
    - Rejeitar duplicidade (mesmo chaveAcesso)
    - Rejeitar XML cancelado na SEFAZ
    - _Requirements: 28.1, 28.2, 28.3, 28.4, 28.5_

  - [ ]* 23.2 Write property test: Importação rejeita duplicatas
    - **Property 21: Importação de XML rejeita duplicatas (idempotência)**
    - **Validates: Requirements 28.4**

  - [x] 23.3 Implementar rotas de importação XML
    - Criar `importacao-xml.routes.ts` com: POST /fiscal/importacao/upload (upload XML), GET /fiscal/importacao (listagem XMLs importados), POST /fiscal/importacao/:id/gerar-entrada
    - _Requirements: 28.1, 28.2_

- [x] 24. Auditoria fiscal
  - [x] 24.1 Implementar serviço de auditoria fiscal
    - Criar `auditoria-fiscal.service.ts` com registro de: emissão, cancelamento, inutilização, alteração de regra, importação XML
    - Armazenar: usuário, timestamp, operação, dados antes/depois, IP
    - Impedir exclusão de registros (soft-delete bloqueado)
    - Rastreabilidade: vincular regra tributária utilizada em cada item
    - _Requirements: 37.1, 37.2, 37.3, 37.4_

- [x] 25. Checkpoint - Verificar módulos complementares
  - Ensure all tests pass, ask the user if questions arise.

- [x] 26. Integração e wiring final
  - [x] 26.1 Wiring de todas as rotas no plugin Fastify fiscal
    - Registrar todas as sub-rotas (motor-tributario, emissor-dfe, contingencia, certificado, sped, apuracao, cadastros, gnre, importacao) no plugin principal `fiscal.routes.ts`
    - Configurar prefixo `/fiscal` com autenticação
    - _Requirements: 1.1, 7.1, 14.1, 20.1, 29.1_

  - [x] 26.2 Implementar middleware de auditoria fiscal
    - Interceptar operações fiscais para log automático
    - Injetar contexto do usuário e IP nas operações
    - _Requirements: 37.1, 37.2_

  - [x] 26.3 Configurar variáveis de ambiente do módulo fiscal
    - Adicionar FISCAL_CERT_ENCRYPTION_KEY, SEFAZ_AMBIENTE (1=prod, 2=homolog), SEFAZ_TIMEOUT_MS, CONTINGENCIA_MAX_FILA
    - Documentar no README as env vars obrigatórias
    - _Requirements: 29.1, 30.1_

  - [ ]* 26.4 Write integration tests para fluxo completo NF-e
    - Testar fluxo: criar documento → calcular tributos → gerar XML → assinar → mock SEFAZ autoriza → verificar status AUTORIZADO
    - Testar fluxo de rejeição e contingência com mocks
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 27. Final checkpoint - Verificar todos os testes
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (25 properties)
- Unit tests validate specific examples and edge cases
- Dependencies: libxmljs2 (XSD validation), xml-crypto (XML-DSig), node-forge (PFX manipulation)
- O módulo reutiliza a infraestrutura existente do projeto (Fastify, Prisma, Zod)
- Certificados de teste (PFX gerados para homologação) devem ser usados nos testes de integração

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4"] },
    { "id": 1, "tasks": ["3.1", "6.1", "7.1"] },
    { "id": 2, "tasks": ["3.2", "3.3", "6.2", "7.2", "7.4", "7.5"] },
    { "id": 3, "tasks": ["3.4", "3.5", "6.3", "6.4", "6.5", "7.3", "7.6"] },
    { "id": 4, "tasks": ["3.6", "4.1", "4.12", "4.14", "4.16", "8.1", "8.2"] },
    { "id": 5, "tasks": ["4.2", "4.3", "4.4", "4.7", "4.10", "4.13", "4.15", "4.17", "8.3", "8.4"] },
    { "id": 6, "tasks": ["4.5", "4.6", "4.8", "4.9", "4.11"] },
    { "id": 7, "tasks": ["10.1", "10.2", "10.3", "11.1", "11.2"] },
    { "id": 8, "tasks": ["10.4", "10.5", "10.6", "10.7", "12.1", "12.2"] },
    { "id": 9, "tasks": ["13.1", "13.2", "14.1", "16.1", "16.2"] },
    { "id": 10, "tasks": ["16.3", "16.4", "16.5"] },
    { "id": 11, "tasks": ["17.1", "21.1", "21.2", "21.3", "21.4", "21.5"] },
    { "id": 12, "tasks": ["17.2", "17.3", "17.5", "22.1", "22.2", "22.3"] },
    { "id": 13, "tasks": ["17.4", "18.1", "18.2", "18.3", "18.4", "18.5", "18.6"] },
    { "id": 14, "tasks": ["20.1", "20.3", "20.4", "20.5"] },
    { "id": 15, "tasks": ["20.2", "20.6", "20.7"] },
    { "id": 16, "tasks": ["23.1", "24.1"] },
    { "id": 17, "tasks": ["23.2", "23.3"] },
    { "id": 18, "tasks": ["26.1", "26.2", "26.3"] },
    { "id": 19, "tasks": ["26.4"] }
  ]
}
```
