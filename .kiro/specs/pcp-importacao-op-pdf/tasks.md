# Tarefas — Importação de OP via PDF (GPrint/Calcograf)

## Task 1: Instalar dependência pdf-parse e configurar upload
- [x] Adicionar `pdf-parse` ao package.json
- [x] Configurar multipart upload no Fastify (@fastify/multipart)
- [x] Definir limite de 10MB para upload

## Task 2: Criar serviço de extração de texto do PDF
- [x] Criar `src/modules/pcp/importacao-op/pdf-extractor.service.ts`
- [x] Implementar função que recebe Buffer do PDF e retorna texto extraído
- [x] Tratar erros (PDF corrompido, sem texto, protegido)

## Task 3: Criar parser GPrint/Calcograf
- [x] Criar `src/modules/pcp/importacao-op/parsers/gprint-parser.ts`
- [x] Implementar detecção do sistema de origem
- [x] Implementar extração do cabeçalho (OP, cliente, produto, quantidade, datas)
- [x] Implementar extração de materiais (papel, tintas, vernizes, colas)
- [x] Implementar extração de etapas (impressão, acabamentos, cortadeira)
- [x] Implementar extração de observações e múltiplas vias

## Task 4: Criar endpoint de importação (preview)
- [x] Criar `src/modules/pcp/importacao-op/importacao-op.routes.ts`
- [x] Endpoint POST /api/pcp/importar-op-pdf (retorna preview)
- [x] Incluir auto-match com entidades existentes (cliente, produto, centros)

## Task 5: Criar endpoint de confirmação
- [x] Endpoint POST /api/pcp/importar-op-pdf/confirmar
- [x] Criar OrdemProducao + ItemOrdemProducao + EtapaOrdemProducao
- [x] Registrar origem e referência externa

## Task 6: Criar modelo e CRUD De/Para
- [x] Criar modelo DeParaImportacao (ou usar tabela Parametro)
- [x] Endpoints CRUD /api/pcp/de-para-importacao
- [x] Usar De/Para no auto-match durante importação
