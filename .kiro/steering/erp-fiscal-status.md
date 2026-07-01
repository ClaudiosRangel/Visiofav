---
inclusion: manual
---

# Módulo Fiscal — Documentação Técnica Completa

## Resumo Executivo

O módulo fiscal do VisioFab ERP é uma **implementação real e funcional** (não placeholder) que cobre o fluxo completo de emissão de documentos fiscais eletrônicos brasileiros. Está ~90% completo para NF-e em produção.

## Arquitetura Backend

### Estrutura de Diretórios

```
src/modules/fiscal/
├── apuracao/            — Apuração ICMS, ICMS-ST, IPI, PIS/COFINS
├── auditoria/           — Trail de auditoria fiscal (middleware + service)
├── cadastros/           — NCM, CFOP, CST/CSOSN, CEST, Natureza Operação
├── certificado/         — Gestão de certificados A1 (upload, crypto, parsing PFX)
├── contingencia/        — Modo contingência (fila + ativação automática após 3 falhas)
├── dctf/                — DCTFWeb service
├── emissor-dfe/         — CORE: Emissor DFe (NF-e, NFC-e, CT-e, MDF-e, NFS-e, Manifesto)
│   ├── nfe/             — NF-e XML builder, emissão service, eventos, DANFE
│   ├── sefaz/           — Cliente SOAP, URLs por UF, tipos
│   └── xml/             — Assinatura digital (XML-DSig), validação XSD
├── gnre/                — GNRE (guias recolhimento interestadual)
├── importacao/          — Importação XML de fornecedores
├── motor-tributario/    — Motor de cálculo tributário (ICMS, ST, IPI, PIS, COFINS, ISS, FCP)
├── sped/                — Geradores SPED (Fiscal, Contribuições, ECD, ECF, Reinf)
├── erros.ts             — Códigos de erro fiscais tipados
├── fiscal.routes.ts     — Registro de sub-rotas com auth + auditoria
└── schemas.ts           — Schemas Zod para validação de input
```

### Endpoints (prefixo /api/fiscal/)

| Endpoint | Método | Status | Descrição |
|----------|--------|--------|-----------|
| `/nfe/emitir` | POST | ✅ Real | Emissão completa (tributos → XML → assina → SEFAZ) |
| `/nfe/:id/cancelar` | POST | ✅ Real | Cancelamento com validação 24h |
| `/nfe/:id/carta-correcao` | POST | ✅ Real | CC-e com limite 20 eventos |
| `/nfe/inutilizar` | POST | ✅ Real | Inutilização de faixa |
| `/nfe/:id/danfe` | GET | ⚠️ Fallback | Endpoint existe, renderer PDF não implementado |
| `/nfe` | GET | ✅ Real | Listagem com filtros e paginação |
| `/motor-tributario/*` | CRUD | ✅ Real | Regras tributárias com fallback hierárquico |
| `/motor-tributario/simular` | POST | ✅ Real | Simulação de busca com nível de fallback |
| `/certificados/*` | CRUD | ✅ Real | Upload PFX, validação, crypto |
| `/contingencia/*` | GET/POST | ✅ Real | Status SEFAZ, fila, retransmissão |
| `/sped/:tipo/gerar` | POST | ✅ Estrutura | Geração de arquivos SPED |
| `/apuracao/:tipo` | GET/POST | ✅ Estrutura | Consulta e cálculo de apuração |
| `/cadastros/ncm|cfop|cest|cst-csosn|natureza-operacao` | CRUD | ✅ Real | Cadastros auxiliares |
| `/gnre/*` | CRUD | ✅ Real | Guias GNRE |
| `/importacao/*` | GET/POST | ✅ Real | Upload XML, de-para, gerar entrada |

## Componentes Implementados (Backend)

### 1. Assinatura Digital XML-DSig ✅

**Arquivo:** `emissor-dfe/xml/xml-signer.ts`
**Bibliotecas:** `xml-crypto` (SignedXml) + `node-forge` (PFX parsing)
**Funcionalidades:**
- Extração de chave privada + certificado X509 de arquivo PFX (PKCS#12)
- Validação de expiração do certificado
- Enveloped signature com RSA-SHA1
- Canonicalization C14N
- Inclusão de X509Certificate na KeyInfo/X509Data
- Suporta: infNFe, infCTe, infMDFe, infEvento, infInut

### 2. Geração de XML NF-e (Layout 4.00) ✅

**Arquivo:** `emissor-dfe/nfe/nfe-xml-builder.ts`
**Funcionalidades:**
- Geração completa do XML da NF-e layout 4.00
- Chave de acesso 44 dígitos com dígito verificador módulo 11
- Todos os grupos obrigatórios: ide, emit, dest, det, imposto, total, transp, pag, infAdic
- ICMS completo (CST 00, 10, 20, 30, 40, 41, 50, 51, 60, 70, 90)
- PIS/COFINS (PISAliq, PISNT, PISOutr / COFINSAliq, COFINSNT, COFINSOutr)
- IPI (IPITrib, IPINT)
- Escape de entidades XML, formatação decimal, datas ISO

### 3. Cliente SOAP SEFAZ (mTLS) ✅

**Arquivo:** `emissor-dfe/sefaz/sefaz-client.ts`
**Funcionalidades:**
- SOAP 1.2 sobre HTTPS com mTLS (mutual TLS via certificado A1)
- `node:https` nativo para requisições HTTP
- Envelope SOAP com namespaces corretos
- Retry: 3 tentativas, intervalo 5s, pula retry para rejeições de negócio
- Timeout configurável (5s–120s, padrão 30s)
- Parsing de resposta via `fast-xml-parser`
- Métodos: `transmitir()`, `consultarStatus()`, `consultarProtocolo()`, `distribuicaoDFe()`
- Detecção de SOAP Fault

### 4. URLs SEFAZ (todos os 27 estados) ✅

**Arquivo:** `emissor-dfe/sefaz/sefaz-urls.ts`
**Cobertura:**
- 9 UFs autorizadoras (SP, MG, BA, PR, RS, MT, MS, GO, PE) com produção + homologação
- Demais UFs via SVRS
- Contingência: SVC-AN e SVC-RS
- Serviços: Autorização, RetAutorização, ConsultaProtocolo, StatusServiço, Inutilização, RecepçãoEvento, ConsultaCadastro

### 5. Serviço de Emissão NF-e (Fluxo Completo) ✅

**Arquivo:** `emissor-dfe/nfe/nfe-emissao.service.ts`
**Fluxo:**
1. Calcula tributos nos itens (motor tributário)
2. Gera XML (NF-e layout 4.00)
3. Valida XML contra schema XSD
4. Assina digitalmente com certificado A1
5. Cria registro DocumentoFiscal no banco (status PENDENTE)
6. Transmite à SEFAZ via SOAP + mTLS
7. Processa resposta: cStat=100 → AUTORIZADO, outro → REJEITADO
8. Contingência automática: após 3 falhas → enfileira

### 6. Eventos (Cancelamento, CC-e, Inutilização) ✅

**Arquivo:** `emissor-dfe/nfe/nfe-eventos.ts`
**Funcionalidades:**
- Cancelamento: validação prazo 24h, justificativa 15-255 chars, gera XML evento 110111
- Carta de Correção: texto 15-1000 chars, limite 20 CC-e por NF-e, evento 110110
- Inutilização: faixa max 1000 números, gera XML infInut
- Todos: assinam XML → transmitem SEFAZ → processam resposta

### 7. Motor Tributário ✅

**Arquivo:** `motor-tributario/motor-tributario.service.ts`
**Funcionalidades:**
- Busca de regra por NCM × CFOP × UF Origem × UF Destino × Regime Tributário
- Fallback hierárquico: EXATO → NCM_PARCIAL → CFOP_GENERICO → PADRAO_REGIME
- Cálculo automático: ICMS, ICMS-ST (MVA), IPI, PIS, COFINS, ISS, FCP, DIFAL
- Preenchimento tributário automático por item

### 8. Contingência ✅

**Funcionalidades:**
- Detecção automática: após 3 falhas consecutivas de comunicação
- Enfileiramento de documentos com XML assinado
- Retransmissão individual e em lote
- Log de entrada/saída de contingência
- Tipo automático por UF (SVC_RS para autorizadoras, SVC_AN para demais)

## Schema do Banco (Prisma)

### Tabelas Fiscais

| Tabela | Descrição |
|--------|-----------|
| `documento_fiscal` | Documento unificado (NFE, NFCE, CTE, MDFE, NFSE) com XML, protocolo, status |
| `item_documento_fiscal` | Itens com tributos completos (ICMS, ST, DIFAL, FCP, IPI, PIS, COFINS, ISS) |
| `evento_documento_fiscal` | Eventos (cancelamento, CC-e) |
| `certificado_digital` | Certificados A1 (PFX criptografado + metadata) |
| `fila_contingencia` | Fila de contingência (XML assinado, tentativas, status) |
| `log_contingencia` | Log de entrada/saída de contingência |
| `regra_tributaria` | Regras do motor tributário |
| `apuracao_fiscal` | Fechamento de período (ICMS, ST, PIS, COFINS, IPI) |
| `natureza_operacao` | Naturezas de operação |
| `gnre` | Guias GNRE |
| `xml_importado` | XMLs importados de fornecedores |
| `auditoria_fiscal` | Trail de auditoria |

### Campos Fiscais na Empresa

```
regimeTributario, certificadoPfx, senhaCertificado, ambienteNFe,
serieNFe, proximoNumeroNFe, serieCTe, proximoNumeroCTe
```

### Campos Fiscais no Produto

```
ncm, cfopEstadual, cfopInterest, cst, csosn, aliqICMS, aliqIPI,
cstPIS, aliqPIS, cstCOFINS, aliqCOFINS, origemProd, cEAN
```

## O que FALTA (Gaps)

### Crítico (impede uso em produção)

| Gap | Descrição | Esforço |
|-----|-----------|---------|
| **DANFE PDF** | Renderer PDF do documento auxiliar (endpoint existe, falta `nfe-danfe.ts`) | Médio |
| **Testes em homologação** | Validar fluxo completo contra SEFAZ com certificado real | Médio |
| **Integração Vendas → Fiscal** | Vendas ainda cria NF-e no modelo legado (`Nfe`), não no `DocumentoFiscal` | Alto |

### Importante (competitividade)

| Gap | Descrição | Esforço |
|-----|-----------|---------|
| NFC-e builder (modelo 65) | XML específico para cupom fiscal | Médio |
| CT-e builder (modelo 57) | XML específico para transporte | Alto |
| MDF-e builder (modelo 58) | XML específico para manifesto | Alto |
| NFS-e multi-município | Adapters por prefeitura (ABRASF, Ginfes, Betha) | Muito Alto |
| SPED registros completos | Ajustes, ressarcimento ST, crédito acumulado | Alto |
| SPED Reinf / DCTF-Web | Obrigações acessórias adicionais | Alto |

### Nice-to-have

| Gap | Descrição |
|-----|-----------|
| DIFAL automático | Cálculo para vendas interestaduais a consumidor final |
| FCI | Ficha de Conteúdo de Importação |
| Bloco K (SPED) | Controle de produção (indústria) |
| Regime especial ICMS-ST | MVA por convênio |

## Pacotes NPM Utilizados

| Pacote | Versão | Uso |
|--------|--------|-----|
| `xml-crypto` | ^6.1.2 | Assinatura XML-DSig |
| `node-forge` | (peer dep) | Parsing PFX/PKCS12 |
| `fast-xml-parser` | ^5.9.3 | Parsing de respostas SEFAZ |
| `pdfkit` | ^0.19.1 (dev) | Reservado para DANFE |

## Frontend (Next.js 15 + Mantine 7)

### Páginas Implementadas ✅

- Dashboard fiscal (5 métricas)
- NF-e (listagem + emissão + cancelamento + CC-e)
- NFC-e, CT-e, MDF-e, NFS-e (listagem + emissão)
- Motor Tributário (CRUD regras + simulação)
- Cadastros (NCM, CFOP, CEST, CST/CSOSN, Natureza Operação)
- SPED (geração + histórico)
- Apuração (ICMS, ICMS-ST, PIS/COFINS, IPI)
- Certificados (upload + listagem)
- Contingência (status SEFAZ + fila + retransmissão)
- GNRE (listagem + criação + pagamento)
- Importação XML (upload + de-para + gerar entrada)
- Manifesto Destinatário (listagem + ações)
- Auditoria (listagem + detalhes)

### Componentes Reutilizáveis

- `ListagemFiscal` — tabela genérica paginada com filtros
- `FormularioEmissao` — form multi-step com validação por etapa
- `StatusBadge` — badge colorido por status
- `FiltrosPeriodo` — filtros de data início/fim
- `ModalCancelamento` — modal com justificativa (min 15 chars)
- `ModalCartaCorrecao` — modal com texto correção (min 15 chars)

### Hooks de Dados

16 hooks React Query cobrindo todos os endpoints fiscais, com cache invalidation, staleTime, refetchInterval (contingência 30s).
