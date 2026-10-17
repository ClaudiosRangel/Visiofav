/**
 * Funções puras de ingestão de OP do Calcgraf — motor testável.
 *
 * Este módulo NÃO depende de Prisma, I/O ou framework: apenas do módulo
 * `crypto` nativo do Node. Isso o torna 100% determinístico e testável com
 * property-based tests (fast-check), e portável para o agente desktop.
 *
 * Responsabilidade desta tarefa (2.1):
 *  - `normalizarOpParaHash(dto)`: produz uma representação canônica
 *    determinística do conteúdo relevante da OP (ordem-insensível nos arrays
 *    filhos, strings com trim, números com precisão fixa).
 *  - `calcularHashOp(dto)`: sha256 (hex) da string normalizada.
 *
 * Correctness Property 1 (design.md): a MESMA OP com os arrays filhos em
 * ordem diferente deve produzir SEMPRE o mesmo hash.
 */

import { createHash } from 'node:crypto'

// ---------------------------------------------------------------------------
// DTO — shape do payload de UMA OP de origem (Calcgraf).
// Espelha o payload versionado do design (`schemaVersion` / `ops[]`), aqui
// focado no conteúdo de uma única OP. Todos os tipos são simples/serializáveis.
// ---------------------------------------------------------------------------

/** Item/estrutura (componente) de uma OP de origem. */
export interface ItemOpOrigemDTO {
  /** Número/sequência do item dentro da OP (chave estável de ordenação). */
  item?: number
  /** Código do item de estoque no Calcgraf. */
  codItemEstoque?: string
  /** Descrição do componente. */
  descricao?: string
  /** Quantidade do componente. */
  quantidade?: number
  /** Unidade de medida. */
  unidadeMedida?: string
  /** Status do item na origem. */
  status?: string
}

/** Etapa/operação do roteiro de uma OP de origem (quando disponível). */
export interface EtapaOpOrigemDTO {
  /** Sequência da etapa (chave estável de ordenação). */
  sequencia?: number
  /** Nome/código do centro de produção ou operação. */
  centro?: string
  /** Descrição/detalhe da etapa. */
  descricao?: string
  /** Status da etapa na origem. */
  status?: string
  // ── Fase 2 (roteiro completo) — campos aditivos/opcionais ──
  /** Tipo da operação no Calcgraf: 'I' (impressão) | 'A' (acabamento). */
  tipo?: string
  /** Tempo de setup/acerto em minutos (quantAcertos*tempoPorAcerto + tempoPrimeiroAcerto). */
  setupMinutos?: number
  /** Tempo de operação/produção em minutos (tiragem / producaoHora * 60). */
  operacaoMinutos?: number
  /**
   * Código do centro de produção no Calcgraf (para o de-para no backend —
   * resolve o centro REAL antes de reusar por nome/criar). Aditivo/opcional:
   * quando ausente, o backend reusa por nome (comportamento atual).
   * Spec importador-calcgraf-paridade-pdf.
   */
  centroCodigo?: string
}

/** Variação/plano (componente) de uma OP de origem — Fase 2 (CalculoPlanos). */
export interface VariacaoOpOrigemDTO {
  /** Sequência/ordem do plano (CalculoPlanos.Ordem). Chave estável de ordenação. */
  sequencia?: number
  /** Código do plano (CalculoPlanos.codPlano). */
  codigoPlano?: string
  /** Nome do plano (CalculoPlanos.nomePlano — ex.: "Impressos", "TAMPA"). */
  nome?: string
  /** Quantidade/tiragem do plano. */
  quantidade?: number
  /** Nome do papel/suporte resolvido (de codSuporte). */
  suporte?: string
  /** Gramatura do papel do plano. */
  gramatura?: number
  /** Dimensão do plano ("dimensao1 x dimensao2"). */
  dimensao?: string
  /** Aproveitamento (peças por folha/puxada). */
  aproveitamento?: number
}

/** Lote/tiragem de uma OP de origem (OpLote). */
export interface LoteOpOrigemDTO {
  /** Tiragem do lote (chave estável de ordenação, junto com dataPrometida). */
  tiragem?: number
  /** Data prometida de entrega (ISO string). */
  dataPrometida?: string
  /** Posição na fila de entregas. */
  ordemFila?: number
  /** Status do lote na origem. */
  status?: string
}

/** Entrega parcial programada de uma OP de origem — paridade PDF (T4). */
export interface EntregaOpOrigemDTO {
  /** Data da entrega (ISO string). */
  data?: string
  /** Quantidade dessa entrega parcial. */
  quantidade?: number
}

/** Plano/componente de uma OP de origem — paridade PDF (T4). Substitui, no
 *  destino, o uso de `VariacaoOrdemProducao` por `PlanoOrdemProducao`. */
export interface PlanoOpOrigemDTO {
  /** Nome do plano/componente (ex.: "TAMPA", "CAIXA", "Impressos"). */
  nome: string
  /** 'COMPONENTE' (padrão) | 'FACE' (frente/verso de retiração). */
  tipo?: string
  formato?: string
  cores?: string
  tiragem?: number
  montagem?: string
  material?: string
  gramatura?: number
  aproveitamento?: number
  matriz?: string
  /** `true` → gera 2 FACES (FRENTE/VERSO) na confirmação. */
  retiracao?: boolean
  coresFrente?: string
  coresVerso?: string
  /** Ordem/sequência do plano. */
  sequencia?: number
}

/** Payload de uma OP de origem do Calcgraf (shape de UMA OP). */
export interface OpOrigemDTO {
  /** Número da OP no Calcgraf (OpHeader.Numero) — chave de identidade. */
  numero: number
  /** Descrição da OP. */
  descricao: string
  /** Data de emissão (ISO string). */
  dataEmissao?: string
  /** Nome do produto (via CodItemEstoque). */
  produtoNome?: string
  /** Código do produto. */
  produtoCodigo?: string
  /** Nome do cliente. */
  clienteNome?: string
  /** Quantidade (tiragem do lote principal). */
  quantidade?: number
  /** Data de entrega (OpLote.DataPrometida). */
  dataEntrega?: string
  /** Tiragem. */
  tiragem?: number
  /** Itens/estrutura (BOM) — fase MVP: mínimo para liberar. */
  itens?: ItemOpOrigemDTO[]
  /** Etapas/roteiro — quando disponível. */
  etapas?: EtapaOpOrigemDTO[]
  /** Lotes/tiragens (OpLote). */
  lotes?: LoteOpOrigemDTO[]
  // ── Fase 2 (roteiro completo) — campos aditivos/opcionais ──
  /** Variações/planos do cálculo (CalculoPlanos). */
  variacoes?: VariacaoOpOrigemDTO[]
  /** Tintas/cores resumidas como texto (ex.: "AMARELO 123C (85%), VERDE CW0138 (15%)"). */
  tintasTexto?: string
  /**
   * Observação textual da OP (campo memo do Calcgraf — `TabelaMemos`,
   * NomeTabela='CalculoOp'). Contém "Serviço Novo/Repetição", bobinas
   * "em estoque/encomendado (N kg)", LXL, Montagem e instruções — mesmo texto
   * do PDF. É anexada a `OrdemProducao.observacoes`, o que faz a regra
   * "Aguardando Cartão" (lê "em estoque/encomendado") funcionar também nas OPs
   * sincronizadas. Aditivo. Spec op-visualizacao-observacoes-calcgraf.
   */
  observacaoTexto?: string
  // ── Paridade PDF (T4) — todos aditivos/opcionais; ausência = preserva ──
  /** Código do cliente no Calcgraf (para de-para CLIENTE). */
  clienteCodigo?: string
  /** CNPJ/CPF do cliente (chave de vínculo com o cadastro). */
  clienteDoc?: string
  /** Programação de entrega: TODAS as datas parciais (não só a 1ª). */
  programacaoEntrega?: EntregaOpOrigemDTO[]
  /** Planos/componentes + retiração (frente/verso). */
  planos?: PlanoOpOrigemDTO[]
  /** Matriz/faca (tag [Matriz]). */
  matriz?: string
  /** Formato (tag [Formato]). */
  formato?: string
  /** Bobinas (tags [Bobina]). */
  bobinasTexto?: string[]
}

// ---------------------------------------------------------------------------
// Normalização determinística
// ---------------------------------------------------------------------------

/** Casas decimais fixas para serializar números (evita 1 vs 1.0 vs 1.00). */
const PRECISAO_DECIMAL = 4

/**
 * Normaliza um valor escalar para a forma canônica:
 *  - string → trim; vazia após trim vira null (equivale a ausente).
 *  - number → precisão fixa (toFixed) para eliminar divergências de formato;
 *    NaN/Infinity viram null (não representáveis de forma estável).
 *  - undefined → null (undefined e ausência de campo devem gerar o mesmo hash).
 */
function normalizarEscalar(valor: unknown): string | number | boolean | null {
  if (valor === undefined || valor === null) return null
  if (typeof valor === 'string') {
    const t = valor.trim()
    return t.length === 0 ? null : t
  }
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) return null
    // Número com precisão fixa; parseFloat remove zeros à direita redundantes
    // mantendo o valor estável (ex.: 1, 1.0, 1.000 → mesma representação).
    return parseFloat(valor.toFixed(PRECISAO_DECIMAL))
  }
  if (typeof valor === 'boolean') return valor
  return null
}

/** Normaliza um item/componente para a forma canônica (campos ordenados). */
function normalizarItem(item: ItemOpOrigemDTO): Record<string, unknown> {
  return {
    item: normalizarEscalar(item.item),
    codItemEstoque: normalizarEscalar(item.codItemEstoque),
    descricao: normalizarEscalar(item.descricao),
    quantidade: normalizarEscalar(item.quantidade),
    unidadeMedida: normalizarEscalar(item.unidadeMedida),
    status: normalizarEscalar(item.status),
  }
}

/** Normaliza uma etapa/operação para a forma canônica. */
function normalizarEtapa(etapa: EtapaOpOrigemDTO): Record<string, unknown> {
  return {
    sequencia: normalizarEscalar(etapa.sequencia),
    centro: normalizarEscalar(etapa.centro),
    descricao: normalizarEscalar(etapa.descricao),
    status: normalizarEscalar(etapa.status),
    // Fase 2: tempos/tipo entram no hash para detectar mudança de roteiro.
    tipo: normalizarEscalar(etapa.tipo),
    setupMinutos: normalizarEscalar(etapa.setupMinutos),
    operacaoMinutos: normalizarEscalar(etapa.operacaoMinutos),
    centroCodigo: normalizarEscalar(etapa.centroCodigo),
  }
}

/** Normaliza uma variação/plano para a forma canônica — Fase 2. */
function normalizarVariacao(v: VariacaoOpOrigemDTO): Record<string, unknown> {
  return {
    sequencia: normalizarEscalar(v.sequencia),
    codigoPlano: normalizarEscalar(v.codigoPlano),
    nome: normalizarEscalar(v.nome),
    quantidade: normalizarEscalar(v.quantidade),
    suporte: normalizarEscalar(v.suporte),
    gramatura: normalizarEscalar(v.gramatura),
    dimensao: normalizarEscalar(v.dimensao),
    aproveitamento: normalizarEscalar(v.aproveitamento),
  }
}

/** Normaliza uma entrega parcial para a forma canônica — paridade PDF (T4). */
function normalizarEntrega(e: EntregaOpOrigemDTO): Record<string, unknown> {
  return {
    data: normalizarEscalar(e.data),
    quantidade: normalizarEscalar(e.quantidade),
  }
}

/** Normaliza um plano (paridade PDF) para a forma canônica — T4. */
function normalizarPlano(p: PlanoOpOrigemDTO): Record<string, unknown> {
  return {
    nome: normalizarEscalar(p.nome),
    tipo: normalizarEscalar(p.tipo),
    formato: normalizarEscalar(p.formato),
    cores: normalizarEscalar(p.cores),
    tiragem: normalizarEscalar(p.tiragem),
    montagem: normalizarEscalar(p.montagem),
    material: normalizarEscalar(p.material),
    gramatura: normalizarEscalar(p.gramatura),
    aproveitamento: normalizarEscalar(p.aproveitamento),
    matriz: normalizarEscalar(p.matriz),
    retiracao: normalizarEscalar(p.retiracao),
    coresFrente: normalizarEscalar(p.coresFrente),
    coresVerso: normalizarEscalar(p.coresVerso),
    sequencia: normalizarEscalar(p.sequencia),
  }
}

/** Normaliza um lote para a forma canônica. */
function normalizarLote(lote: LoteOpOrigemDTO): Record<string, unknown> {
  return {
    tiragem: normalizarEscalar(lote.tiragem),
    dataPrometida: normalizarEscalar(lote.dataPrometida),
    ordemFila: normalizarEscalar(lote.ordemFila),
    status: normalizarEscalar(lote.status),
  }
}

/**
 * Ordena uma lista de objetos já normalizados por uma chave estável. A chave é
 * a própria serialização JSON canônica do objeto — garante ordem total e
 * determinística mesmo quando os campos "naturais" de ordenação (sequencia,
 * item) estão ausentes ou repetidos. Como os objetos já foram normalizados com
 * as chaves na mesma ordem, a comparação lexicográfica é estável.
 */
function ordenarEstavel(itens: Record<string, unknown>[]): Record<string, unknown>[] {
  return [...itens].sort((a, b) => {
    const sa = JSON.stringify(a)
    const sb = JSON.stringify(b)
    if (sa < sb) return -1
    if (sa > sb) return 1
    return 0
  })
}

/**
 * Produz a representação canônica determinística do conteúdo relevante da OP.
 *
 * Garantias:
 *  - Arrays filhos (itens, estrutura/etapas, lotes) são ordenados por uma chave
 *    estável ANTES de serializar → a ordem de entrada não altera a saída.
 *  - Strings sofrem trim; números recebem precisão fixa.
 *  - As chaves do objeto são escritas numa ordem fixa (não dependemos da ordem
 *    de inserção do objeto de entrada).
 *
 * O conteúdo normalizado segue o design (seção "Detecção de alteração (hash)"):
 * numero, descricao, dataEmissao + arrays itens/estrutura/lotes. Os demais
 * campos de cabeçalho relevantes (produto/cliente/quantidade/entrega/tiragem)
 * também entram para que mudanças neles sejam detectadas como alteração.
 */
export function normalizarOpParaHash(dto: OpOrigemDTO): string {
  const itensNorm = ordenarEstavel((dto.itens ?? []).map(normalizarItem))
  const etapasNorm = ordenarEstavel((dto.etapas ?? []).map(normalizarEtapa))
  const lotesNorm = ordenarEstavel((dto.lotes ?? []).map(normalizarLote))
  const variacoesNorm = ordenarEstavel((dto.variacoes ?? []).map(normalizarVariacao))
  const entregasNorm = ordenarEstavel((dto.programacaoEntrega ?? []).map(normalizarEntrega))
  const planosNorm = ordenarEstavel((dto.planos ?? []).map(normalizarPlano))
  const bobinasNorm = [...(dto.bobinasTexto ?? [])]
    .map((b) => normalizarEscalar(b))
    .filter((b) => b !== null)
    .sort((a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0))

  // Objeto canônico com chaves em ordem fixa e previsível.
  const canonico = {
    numero: normalizarEscalar(dto.numero),
    descricao: normalizarEscalar(dto.descricao),
    dataEmissao: normalizarEscalar(dto.dataEmissao),
    produtoNome: normalizarEscalar(dto.produtoNome),
    produtoCodigo: normalizarEscalar(dto.produtoCodigo),
    clienteNome: normalizarEscalar(dto.clienteNome),
    quantidade: normalizarEscalar(dto.quantidade),
    dataEntrega: normalizarEscalar(dto.dataEntrega),
    tiragem: normalizarEscalar(dto.tiragem),
    itens: itensNorm,
    etapas: etapasNorm,
    lotes: lotesNorm,
    // Fase 2: variações e tintas (texto) entram no hash.
    variacoes: variacoesNorm,
    tintasTexto: normalizarEscalar(dto.tintasTexto),
    // Observação textual (memo) entra no hash → mudança de observação (ex.:
    // bobina passou de "encomendado" para "em estoque") é detectada como
    // alteração e re-sincronizada.
    observacaoTexto: normalizarEscalar(dto.observacaoTexto),
    // Paridade PDF (T4): cliente (doc/código), entregas, planos, tags.
    clienteCodigo: normalizarEscalar(dto.clienteCodigo),
    clienteDoc: normalizarEscalar(dto.clienteDoc),
    programacaoEntrega: entregasNorm,
    planos: planosNorm,
    matriz: normalizarEscalar(dto.matriz),
    formato: normalizarEscalar(dto.formato),
    bobinasTexto: bobinasNorm,
  }

  return JSON.stringify(canonico)
}

/**
 * Retorna o sha256 (hex) da representação canônica da OP.
 * Determinístico: mesma OP (independente da ordem dos arrays filhos) ⇒ mesmo
 * hash. Base da idempotência da ingestão (Property 1 / Requirement 2.2).
 */
export function calcularHashOp(dto: OpOrigemDTO): string {
  const normalizado = normalizarOpParaHash(dto)
  return createHash('sha256').update(normalizado, 'utf8').digest('hex')
}

// ---------------------------------------------------------------------------
// Classificação da ingestão (tarefa 2.2)
//
// Decide, de forma PURA e determinística, qual é o resultado da ingestão de
// uma OP recebida do agente, a partir do estado atual da OP de destino no
// Vizor e do hash recebido. Não depende de Prisma/IO: o chamador (serviço de
// ingestão) é responsável por carregar o `OpDestinoResumo` a partir do banco e
// por aplicar o efeito correspondente ao resultado retornado.
//
// Mapeia diretamente a tabela-verdade do design (Serviço
// `ingestao-op-calcgraf.service.ts`) e as Correctness Properties 2, 3 e 4.
// ---------------------------------------------------------------------------

/** Resultado possível da ingestão de uma OP (por OP do payload). */
export type ResultadoIngestao = 'criada' | 'atualizada' | 'pendente' | 'ignorada'

/**
 * Resumo do estado atual da OP de destino no Vizor, do ponto de vista da
 * decisão de ingestão. É montado pelo serviço a partir do banco (nunca aqui).
 */
export interface OpDestinoResumo {
  /**
   * `true` se já existe uma `OrdemProducao` com a mesma
   * `referenciaExterna` + `origemImportacao` na empresa da API key.
   */
  existe: boolean
  /**
   * Hash (`hashImportacaoOrigem`) salvo na OP de destino na última ingestão por
   * hash. `null` quando a OP nunca foi importada por hash (ex.: OP legada ou
   * recém-criada sem hash) — nesse caso o hash recebido nunca "casa", então a
   * OP é tratada como alterada.
   */
  hashSalvo: string | null
  /**
   * `true` se o status da OP é terminal (CONCLUIDA ou CANCELADA). OP finalizada
   * é protegida: nunca é tocada automaticamente.
   */
  statusFinalizado: boolean
  /**
   * `true` se há produção na OP: apontamento registrado OU etapa
   * iniciada/concluída (status EM_ANDAMENTO/CONCLUIDA). Bloqueia a sobrescrita
   * automática (vira alteração pendente).
   */
  temProducao: boolean
}

/**
 * Classifica o resultado da ingestão de UMA OP conforme a tabela-verdade do
 * design. A ordem de avaliação das regras é significativa (as proteções têm
 * precedência sobre a idempotência e a atualização):
 *
 *  1. NÃO existe (`destino.existe === false`)
 *       → `'criada'` (cria uma OP nova). Requirement 4.1 / Property 3.
 *  2. Existe E `statusFinalizado` (CONCLUIDA/CANCELADA)
 *       → `'ignorada'` (proteção: OP finalizada não é tocada). Mesma proteção
 *         do importador de PDF. Avaliada ANTES do hash para que nem uma
 *         mudança de conteúdo reabra uma OP terminal.
 *  3. Existe E `hashRecebido === hashSalvo`
 *       → `'ignorada'` (idempotência — nada mudou). Requirement 8.1 /
 *         Property 2. Observação: `hashSalvo === null` nunca casa (OP nunca
 *         importada por hash é tratada como alterada no passo seguinte).
 *  4. Existe E hash difere E NÃO tem produção
 *       → `'atualizada'` (pode sobrescrever header/itens/etapas/quantidade).
 *         Requirement 5.1.
 *  5. Existe E hash difere E tem produção
 *       → `'pendente'` (não sobrescreve; vira `AlteracaoOpPendente` para
 *         revisão manual, preservando o estado de produção). Requirement 5.2 /
 *         Property 4.
 *
 * Determinística e sem efeitos colaterais: a mesma entrada sempre produz o
 * mesmo resultado.
 */
export function classificarIngestao(
  destino: OpDestinoResumo,
  hashRecebido: string,
): ResultadoIngestao {
  // Regra 1 — OP inexistente na empresa: cria nova.
  if (!destino.existe) return 'criada'

  // Regra 2 — proteção de OP finalizada (terminal): nunca tocar.
  if (destino.statusFinalizado) return 'ignorada'

  // Regra 3 — idempotência: hash recebido igual ao salvo ⇒ nada mudou.
  // (hashSalvo null nunca casa, caindo para as regras de alteração abaixo.)
  if (destino.hashSalvo !== null && destino.hashSalvo === hashRecebido) {
    return 'ignorada'
  }

  // Regra 4 — hash difere e sem produção: atualização automática permitida.
  if (!destino.temProducao) return 'atualizada'

  // Regra 5 — hash difere e com produção: não sobrescreve; vira pendente.
  return 'pendente'
}
