# CT-e — Emissão e Comunicação SEFAZ (Conhecimento de Transporte Eletrônico)

Este arquivo documenta as decisões técnicas, padrões e armadilhas
descobertas na implementação da emissão de CT-e modelo 57 versão 4.00
no Vizor ERP. Leia antes de tocar em qualquer código de CT-e.

---

## 1. Comunicação SOAP com SEFAZ SVRS

O CT-e 4.00 é transmitido em modo **síncrono** via `CTeRecepcaoSincV4`.
Todas as UFs usam o **SVRS** (Sefaz Virtual Rio Grande do Sul) como
autorizador nacional para CT-e.

### Envelope SOAP — formato correto (descoberto empiricamente em 17/08/2026)

```xml
<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    <cteDadosMsg xmlns="http://www.portalfiscal.inf.br/cte/wsdl/CTeRecepcaoSincV4">
      {GZip+Base64 do XML do <CTe>...</CTe> assinado}
    </cteDadosMsg>
  </soap12:Body>
</soap12:Envelope>
```

### Regras críticas (cada uma causou horas de debug)

| Regra | Se errar | Comportamento |
|-------|----------|---------------|
| `<cteDadosMsg>` DEVE ter `xmlns="...CTeRecepcaoSincV4"` | Sem xmlns | cStat 244 "Falha na descompactação" |
| Conteúdo DEVE ser **GZip+Base64** | Plain-text XML | cStat 244 |
| **NÃO** usar `<enviCTe>` wrapper | Com `<enviCTe>` | cStat 215 "enviCTe element is not declared" |
| **NÃO** colocar xmlns com plain-text | xmlns + plain-text | HTTP 400 body vazio |
| `action=` DEVE estar dentro do Content-Type | Sem action | HTTP 500 "invalid action parameter" |
| `SOAPAction` header separado é redundância segura | — | Funciona com ou sem |

### Headers HTTP obrigatórios

```
Content-Type: application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/cte/wsdl/CTeRecepcaoSincV4/cteRecepcao"
SOAPAction: "http://www.portalfiscal.inf.br/cte/wsdl/CTeRecepcaoSincV4/cteRecepcao"
```

### URLs dos WebServices CT-e

| Serviço | Produção | Homologação |
|---------|----------|-------------|
| Autorização (síncrono) | `https://cte.svrs.rs.gov.br/ws/CTeRecepcaoSincV4/CTeRecepcaoSincV4.asmx` | `https://cte-homologacao.svrs.rs.gov.br/ws/CTeRecepcaoSincV4/CTeRecepcaoSincV4.asmx` |
| Status Serviço | `.../CTeStatusServicoV4/CTeStatusServicoV4.asmx` | idem com `-homologacao` |
| Eventos | `.../CTeRecepcaoEventoV4/CTeRecepcaoEventoV4.asmx` | idem |
| Consulta | `.../CTeConsultaV4/CTeConsultaV4.asmx` | idem |

### Certificado e TLS

- Certificado A1 (PFX) armazenado criptografado no banco (`certificado_digital`)
- TLS 1.2 obrigatório (`minVersion: 'TLSv1.2'`)
- `rejectUnauthorized: false` (a cadeia de CAs da SEFAZ nem sempre é reconhecida pelo Node)
- mTLS: o certificado é usado tanto para assinar o XML quanto para autenticação na conexão HTTPS

---

## 2. Estrutura do XML do CT-e

### Ordem dos elementos dentro de `<CTe>`

```xml
<CTe xmlns="http://www.portalfiscal.inf.br/cte">
  <infCte versao="4.00" Id="CTe{chave44}">
    <ide>...</ide>
    <compl>...</compl>
    <emit>...</emit>
    <rem>...</rem>
    <exped>...</exped>     <!-- opcional -->
    <receb>...</receb>     <!-- opcional -->
    <dest>...</dest>
    <vPrest>...</vPrest>
    <imp>...</imp>
    <infCTeNorm>
      <infCarga>...</infCarga>
      <infDoc>...</infDoc>
      <infModal versaoModal="4.00">...</infModal>
      <veicNovos>...</veicNovos>  <!-- opcional -->
    </infCTeNorm>
  </infCte>
  <infCTeSupl>
    <qrCodCTe>URL do QR Code</qrCodCTe>
  </infCTeSupl>
  <Signature xmlns="http://www.w3.org/2000/09/xmldsig#">...</Signature>
</CTe>
```

**Ordem obrigatória**: `<infCte>` → `<infCTeSupl>` → `<Signature>`

O `xml-signer.ts` insere a `<Signature>` após `<infCTeSupl>` (último filho
de `<CTe>`). Se colocar a Signature entre `</infCte>` e `<infCTeSupl>`,
a SEFAZ retorna cStat 215 "Falha no schema XML".

### Assinatura digital

- Algoritmo: RSA-SHA1 + Canonicalization C14N
- Reference URI: `#CTe{chave44}` (aponta para `<infCte Id="CTe...">`)
- Transforms: `enveloped-signature` + `c14n`
- A `<Signature>` fica FORA de `<infCte>` (dentro de `<CTe>`, após `<infCTeSupl>`)
- O `<infCTeSupl>` NÃO é coberto pela assinatura (está fora de `<infCte>`)

### Data/Hora de emissão (`<dhEmi>`)

**ATENÇÃO — bug já corrigido**: a função `fmtDataHora` usava
`date.toISOString()` (que retorna UTC) e concatenava `-03:00`. Isso gerava
uma hora 3h no futuro, causando cStat 228 "Data de emissão posterior à
data de recebimento".

**Correção**: subtrair 3h antes de formatar para obter hora local Brasília:
```typescript
function fmtDataHora(date: Date): string {
  const brDate = new Date(date.getTime() - 3 * 60 * 60 * 1000)
  const iso = brDate.toISOString().slice(0, 19)
  return `${iso}-03:00`
}
```

---

## 3. Arquivos do módulo CT-e

### Backend (`src/modules/fiscal/emissor-dfe/cte/`)

| Arquivo | Responsabilidade |
|---------|-----------------|
| `cte.routes.ts` | Rotas: gravar, transmitir, cancelar, CC-e, DACTE, importar NF-e, preview XML |
| `cte-xml-builder.ts` | Montagem do XML CT-e layout 4.00 (função pura `buildCTeXml`) |
| `cte-emissao.service.ts` | Orquestrador: gerar → validar → assinar → transmitir → processar resposta |
| `cte-dacte-pdf.service.ts` | Geração do DACTE em PDF (pdfkit) |
| `cte-importar-nfe.service.ts` | Importar XML de NF-e para gerar CT-e |
| `cte-danfe-parser.service.ts` | Extrair dados de DANFE PDF |
| `cte-municipios.routes.ts` | Consulta municípios IBGE |

### Infraestrutura compartilhada

| Arquivo | Papel no CT-e |
|---------|--------------|
| `sefaz/sefaz-client.ts` | Cliente SOAP (envelope, GZip, mTLS, retry) |
| `sefaz/sefaz-urls.ts` | URLs dos WebServices por UF/ambiente |
| `xml/xml-signer.ts` | Assinatura digital XML-DSig |
| `certificado/certificado.service.ts` | Busca certificado do banco |
| `certificado/certificado-crypto.ts` | Encrypt/decrypt do PFX armazenado |

---

## 4. Tratamento de respostas da SEFAZ

O `sefaz-client.ts` trata HTTP 422/500 com body XML como resposta
processável (não como exceção), permitindo extrair `cStat`/`xMotivo`.

- **HTTP 200 + cStat 100** = Autorizado ✓
- **HTTP 200 + cStat 2xx** = Rejeição de negócio (schema, dados, etc.)
- **HTTP 422/500 + body com `<cStat>`** = Rejeição processável
- **HTTP 400 body vazio** = Envelope SOAP malformado (ver regras acima)
- **HTTP 500 SOAP Fault** = Erro no endpoint (action errada, namespace errado)

---

## 5. Erros já enfrentados e soluções

| cStat | Motivo | Causa | Solução |
|-------|--------|-------|---------|
| 244 | Falha na descompactação | Conteúdo não está em GZip+Base64 OU xmlns ausente no cteDadosMsg | Comprimir com GZip e enviar Base64 COM xmlns |
| 215 | Falha no schema XML | `<enviCTe>` não aceito no síncrono, ou Signature na posição errada | Enviar só `<CTe>`, Signature após infCTeSupl |
| 228 | Data emissão posterior | `fmtDataHora` gerava hora UTC+offset errado | Subtrair 3h antes de formatar |
| 252 | Ambiente informado diverge do Ambiente de recebimento | XML gerado com `tpAmb` do cadastro da empresa (produção) mas URL do webservice resolvida por `SEFAZ_AMBIENTE` (default homologação no Render) | Ambiente da URL agora segue o do documento — ver seção 8.1 |
| — | Código de Município diverge do nome | `cMunIni`/`cMunFim` gravado com código IBGE errado (ex.: Petrópolis com 3303906/Paty do Alferes) | Validação/correção pelo nome+UF via IBGE antes de transmitir — seção 8.2 |
| — | HTTP 400 body vazio | xmlns no cteDadosMsg + XML plain-text | Usar xmlns COM GZip+Base64 |
| — | HTTP 500 "invalid action" | Falta action no Content-Type | Incluir `; action="..."` no Content-Type |

---

## 6. Scripts de teste (pasta `scripts/`)

| Script | Função |
|--------|--------|
| `teste-status-cte.ts` | Testa comunicação TLS com StatusServico |
| `teste-envio-cte.ts` | Envia envelope de debug para a SEFAZ |
| `teste-namespace-cte.ts` | Testa variações de namespace/action |
| `teste-cte-acbr.ts` | Envia CT-e 3111 (ACBr) em vários formatos |
| `teste-cte-final.ts` | Testa com xmlns + GZip |

Esses scripts ficam para debug futuro — rodam com `npx tsx scripts/nome.ts`.

---

## 7. Pendências (documentadas em `docs/proxima-sessao-cte.md`)

1. DACTE layout ACBr (paisagem, QR Code, completo)
2. Envio de XML+PDF por e-mail
3. Busca de município IBGE sem acento
4. Cadastro de cores (tabela CorVeiculo)
5. Validação pré-transmissão (campos obrigatórios)
6. Campos Data Emissão / Data Autorização + filtros
7. Seleção em lote + ações em massa

---

## 8. Correções da sessão de 02/09/2026 (ambiente, município, veículo novo)

Quatro bugs reais que apareceram ao emitir CT-e de veículos novos em produção
(transportadora Miguez / destinatário HAYASA). Todos corrigidos e deployados
na `main` (commits `5776ee89f`, `5aa806e9e`, `c19542071`). Nenhum tocou schema
Prisma — sem migration.

### 8.1 cStat 252 — Ambiente diverge (fonte única do ambiente)

O XML era gerado com `tpAmb` vindo do cadastro da empresa
(`empresa.ambienteCTe || ambienteNFe`), mas a URL do webservice era resolvida
por `CTeEmissaoService.obterAmbiente()`, que lia **`process.env.SEFAZ_AMBIENTE`
(default 2/homologação)** — e essa env NÃO está setada no Render. Resultado: XML
com `tpAmb=1` (produção) enviado para a URL de homologação → rejeição 252.

**Correção** (`cte-emissao.service.ts`): `obterAmbiente(ambienteDoc?)` agora
prioriza o ambiente do documento; a env var é só fallback. O ambiente é
propagado explicitamente de `dadosCTe.ambiente`/`documento.ambiente` para
`transmitirSefaz`, `consultarResultadoLote` e os eventos (cancelamento/CC-e). O
protocolo (`protCTe`) em `montarXmlAutorizado` extrai o `tpAmb` do próprio XML
assinado (`extrairTpAmbDoXml`) em vez de env var.

**Regra daqui pra frente:** ambiente do CT-e tem UMA fonte — o cadastro da
empresa (que gera o `tpAmb` do XML). Nunca resolver URL de webservice por env
var isolada; sempre derivar do mesmo valor que foi para o XML, senão volta o 252.

### 8.2 Código IBGE de município diverge do nome

O `cMunIni`/`cMunFim` vinha direto do `body` (frontend/cadastro) sem validar
coerência com o nome. Um CT-e saiu com `cMunIni=3303906` (Paty do Alferes) e
`xMunIni=PETROPOLIS` (correto seria 3304557) — rejeição "Código de Município
diverge do nome".

**Correção** (`cte.routes.ts`, rota `POST /cte/emitir`): helper
`resolverCodigoMunicipio(codigo, nome, uf)` consulta a lista oficial do IBGE por
UF (`buscarMunicipiosIBGE`) e, se o código informado não corresponder ao nome,
corrige o código pelo nome (match exato normalizado sem acento). Aplicado a
`cMunIni`, `cMunFim` e `cMunEnv` (município do emitente) antes de montar
`dadosCTe`. Loga aviso quando corrige. Fonte de dado errado (cadastro do cliente)
NÃO foi corrigida — só a emissão está protegida; o cadastro pode continuar
propagando o código errado para outras telas.

### 8.3 `cMod` (Código Marca Modelo) do veículo novo — 6 chars + derivação do PDF

Layout CT-e 4.00: `veicNovos.cMod` tem **1 a 6 caracteres** (tabela
RENAVAM/DENATRAN), e o grupo `veicNovos` só tem `chassi/cCor/xCor/cMod/vUnit/
vFrete` (NÃO existe `xMod` nem RENAVAM próprio do veículo transportado). Dois
problemas encontrados:

- O schema Zod aceitava `cMod` com `max(20)` — corrigido para `min(1).max(6)`
  (`cCor` para `max(4)`, `xCor` para `max(40)`). Antes, a descrição textual
  longa ("Modelo NEW HRV EXL HS") passava na validação e o XML builder a cortava
  silenciosamente com `.substring(0,6)` gerando lixo (`<cMod>Modelo</cMod>`).
- Na importação por **PDF/DANFE** não existe `cMod` no texto — o parser jogava a
  descrição textual do modelo no campo. **Corrigido** com
  `derivarCodModelo(descricao)` (`cte-danfe-parser.service.ts`): remove a palavra
  "Modelo" e usa os **6 primeiros caracteres alfanuméricos sem espaço**. Ex.:
  `NEW HRV EXL HS` → `NEWHRV`, `CIVIC HYB TOURING` → `CIVICH`.

**Importante — `cMod` é texto livre, a SEFAZ NÃO cruza** esse dado (o dado fiscal
relevante do veículo é o **chassi**). Confirmado por XML autorizado do ACBr que
usou `<cMod>NHRV</cMod>` e `<cCor>PRAT</cCor>`/`<xCor>PRATA</xCor>` (cor também é
texto livre). Por isso a regra "seguir o PDF do cliente solicitante" é aceitável.

**Importação por XML da NF-e** (`cte-importar-nfe.service.ts`) continua lendo o
`cMod` do próprio `<veicProd>` da nota (código de fábrica correto) — NÃO alterada.
Ou seja: XML traz o código oficial; PDF deriva a abreviação do nome. Se o cliente
tem o XML da nota, importar por XML é o caminho mais correto.

### 8.4 DACTE modelo 2 (ACBr) — NOME/MODELO vazio e coluna COR

O DACTE lia a tag inexistente `xMod` para o campo NOME/MODELO (saía sempre
vazio) e mostrava o **código** da cor (`cCor`, ex.: "04") em vez da descrição.
**Corrigido** (`cte-dacte-pdf.service.ts`): NOME/MODELO lê `cMod`; COR exibe
`xCor` (descrição) com fallback para `cCor`. Só o modelo 2 imprime a seção de
veículos novos (o modelo 1 não tem esse quadro).

### 8.5 Mensagem de erro 400 legível

`formatarErroZod()` (`cte.routes.ts`) transforma o `ZodError` numa mensagem
"campo: motivo" (com rótulos amigáveis para `cMod`, município, etc.) em vez do
genérico "Dados inválidos" — aplicado nas rotas `gravar`, `PUT /:id` e `emitir`.
Assim o usuário vê na tela qual campo reprovou.
