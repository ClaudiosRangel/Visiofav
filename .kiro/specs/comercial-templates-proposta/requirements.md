# Requirements — Templates de Proposta PDF (Bloco B1 do Módulo Comercial)

## Introdução

O módulo Comercial do Vizor já gera a proposta comercial do orçamento gráfico em
PDF (`gerarPropostaPdf`, pdfkit) e já envia por e-mail (`POST /:id/enviar-email`,
SMTP da empresa). Porém o **layout é fixo/hardcoded** — não dá para ajustar
cabeçalho, logo, textos fixos (introdução/condições/rodapé) nem escolher quais
campos aparecem. A Carton Wega tem um **modelo de proposta próprio** (2 imagens
enviadas pelo Caio) que precisa ser reproduzido, e o usuário quer poder **editar
o formato** e ter um **template default**.

Este bloco (B1) entrega um **cadastro de Templates de Proposta** por empresa,
com um template **default**, campos configuráveis de layout/textos, e a escolha
do template no momento de gerar/baixar/enviar a proposta. **Não** toca o motor
de cálculo nem os valores do orçamento — é só apresentação (camada de PDF).

Fonte de verdade do projeto: `docs/PROJETO-MODULO-COMERCIAL.md` (bloco B1).

## Glossário

- **Template de Proposta**: configuração de layout/textos de uma proposta em PDF
  (cabeçalho, logo, campos exibidos, textos fixos, rodapé), por empresa.
- **Template default**: o template usado quando nenhum é escolhido explicitamente.
- **Proposta**: PDF comercial gerado a partir de um `OrcamentoGrafico`.
- **Campos exibidos**: conjunto de blocos opcionais da proposta (ex.: decomposição
  de custos, variações de tiragem, validade, observações).

## Requisitos

### Requisito 1: Cadastro de Templates de Proposta

**User Story:** Como usuário do Comercial, quero cadastrar e editar templates de
proposta, para que as propostas em PDF sigam o formato visual da minha empresa.

#### Acceptance Criteria

1. QUANDO o usuário acessar o cadastro de Templates de Proposta ENTÃO o sistema
   DEVE listar os templates da empresa (isolados por `empresaId`).
2. QUANDO o usuário criar um template ENTÃO o sistema DEVE exigir um `nome` e
   persistir o template vinculado à `empresaId` do usuário.
3. QUANDO o usuário editar um template existente ENTÃO o sistema DEVE atualizar
   apenas o template da própria empresa (404 para template de outra empresa).
4. QUANDO o usuário excluir um template ENTÃO o sistema DEVE impedir a exclusão
   do template default E DEVE exigir que exista ao menos um template default por
   empresa.
5. O cadastro DEVE expor, por template, os campos configuráveis: `nome`,
   `isDefault`, cabeçalho (mostrar logo S/N, razão social/CNPJ/telefone/e-mail
   S/N), textos fixos (introdução, condições comerciais, rodapé) e a lista de
   blocos/campos exibidos (ver Requisito 3).

### Requisito 2: Template Default por Empresa

**User Story:** Como usuário do Comercial, quero um template default, para que
toda proposta gerada sem escolha explícita use o formato padrão da empresa.

#### Acceptance Criteria

1. QUANDO uma empresa não tiver nenhum template ENTÃO o sistema DEVE tratar como
   default um template embutido que reproduz o layout fixo atual (não-regressão).
2. QUANDO o usuário marcar um template como default ENTÃO o sistema DEVE desmarcar
   o default anterior (apenas um default por empresa).
3. QUANDO uma proposta for gerada sem `templateId` ENTÃO o sistema DEVE usar o
   template default da empresa.

### Requisito 3: Blocos/campos configuráveis da proposta

**User Story:** Como usuário do Comercial, quero escolher quais blocos aparecem
na proposta, para mostrar ou ocultar informações conforme a necessidade.

#### Acceptance Criteria

1. O template DEVE permitir ligar/desligar, no mínimo, os blocos: decomposição de
   custos (MD/CT/acabamento), variações de tiragem (grade), validade da proposta,
   observações, e dados de engenharia (papel/gramatura/cores/acabamentos).
2. QUANDO um bloco estiver desligado no template ENTÃO o PDF gerado NÃO DEVE
   renderizar esse bloco.
3. QUANDO um bloco estiver ligado mas o orçamento não tiver o dado ENTÃO o PDF
   DEVE omitir o bloco graciosamente (sem erro, sem seção vazia).

### Requisito 4: Geração/Download/Envio usando o template

**User Story:** Como usuário do Comercial, quero escolher o template ao
baixar/enviar a proposta, para controlar o formato de cada envio.

#### Acceptance Criteria

1. QUANDO o usuário baixar o PDF da proposta ENTÃO o sistema DEVE aceitar um
   `templateId` opcional e, na ausência, usar o default (Requisito 2.3).
2. QUANDO o usuário enviar a proposta por e-mail ENTÃO o sistema DEVE aceitar um
   `templateId` opcional e gerar o PDF com o template escolhido/default.
3. QUANDO o `templateId` informado não pertencer à empresa ENTÃO o sistema DEVE
   retornar 404 e NÃO gerar o PDF.
4. O conteúdo de VALORES da proposta (custos/preços/margens) DEVE permanecer
   idêntico ao atual — o template altera apenas apresentação (layout/textos/
   blocos), nunca os números.

### Requisito 5: Modelo Carton Wega como default inicial

**User Story:** Como Carton Wega, quero que o template default reproduza o modelo
de proposta da empresa, para enviar propostas no formato que já usamos.

#### Acceptance Criteria

1. O sistema DEVE fornecer um template "Padrão Carton Wega" que reproduza o
   layout do modelo enviado (cabeçalho com logo/empresa, bloco de itens/tiragens,
   condições comerciais e rodapé), configurável como qualquer outro template.
2. O layout DEVE ser fiel às imagens de referência dentro das limitações do
   pdfkit (tipografia/posicionamento aproximados; sem exigir pixel-perfect).

### Requisito 6: Isolamento multi-tenant e não-regressão

#### Acceptance Criteria

1. TODA query de template DEVE filtrar `empresaId` explicitamente (não confiar só
   no `prismaScoped` — bypass SUPER_ADMIN).
2. QUANDO não houver template cadastrado ENTÃO o comportamento DEVE ser idêntico
   ao atual (layout fixo embutido), garantindo não-regressão.
3. A alteração NÃO DEVE tocar `orcamento-grafico-calculo.service.ts` nem qualquer
   lógica de formação de preço.
