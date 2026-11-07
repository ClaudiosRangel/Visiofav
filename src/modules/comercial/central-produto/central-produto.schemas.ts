import { z } from 'zod'

export const buscaQuerySchema = z.object({
  // O "mínimo de 2 após trim" é validado no service (Req 1.5) para dar a
  // mensagem de validação correta e não executar query.
  termo: z.string().min(1),
})

export const detalheQuerySchema = z
  .object({
    produtoId: z.string().uuid().optional(),
    calculoId: z.string().uuid().optional(),
  })
  .refine((d) => !!d.produtoId !== !!d.calculoId, {
    message: 'Informe produtoId OU calculoId (apenas um).',
  })

export const edicaoBodySchema = z.object({
  descricao: z.string().min(1).max(200).optional(),
  imagemUrl: z.string().min(1).max(500).nullable().optional(),
  fichaTecnica: z
    .object({
      tipoCartaoId: z.string().uuid().nullable().optional(),
      tipoFormatoId: z.string().uuid().nullable().optional(),
      tipoGramaturaId: z.string().uuid().nullable().optional(),
      tipoPolicromiaId: z.string().uuid().nullable().optional(),
      tipoVernizId: z.string().uuid().nullable().optional(),
      tipoCoresIds: z.array(z.string().uuid()).optional(),
    })
    .optional(),
  adicionarAcabados: z.array(z.string().min(1).max(100)).optional(),
  removerAcabados: z.array(z.string().min(1).max(100)).optional(),
})

export const produtoIdParamSchema = z.object({
  produtoId: z.string().uuid(),
})

// ── Central do Produto v2 (Item Master) ──────────────────────────────────────

const IMG_MAX = 11_000_000 // ~11MB por imagem (dataURL/base64)

export const listarProdutosQuerySchema = z.object({
  status: z.enum(['ATIVO', 'INATIVO', 'TODOS']).optional(),
  situacao: z.enum(['DEFINITIVO', 'PROVISORIO', 'TODOS']).optional(),
  comFicha: z.enum(['true', 'false']).optional(),
  texto: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
})

export const salvarFichaBodySchema = z.object({
  cartao: z.string().max(200).nullable().optional(),
  gramatura: z.string().max(60).nullable().optional(),
  numCores: z.number().int().min(0).max(20).nullable().optional(),
  coresDescricao: z.string().max(2000).nullable().optional(),
  acabamentos: z.string().max(4000).nullable().optional(),
  matrizManual: z.string().max(200).nullable().optional(),
  imagemFaca: z.string().max(IMG_MAX).nullable().optional(),
  modeloFacaId: z.string().uuid().nullable().optional(),
  observacoes: z.string().max(4000).nullable().optional(),
})

export const criarArteBodySchema = z.object({
  imagens: z.array(z.string().min(1).max(IMG_MAX)).min(1).max(4),
  descricao: z.string().max(200).nullable().optional(),
})

export const transicaoArteBodySchema = z.object({
  novoEstado: z.enum(['RASCUNHO', 'EM_APROVACAO', 'APROVADA', 'REPROVADA', 'OBSOLETA']),
  comentario: z.string().max(2000).nullable().optional(),
})

export const salvarDimensaoBodySchema = z.object({
  id: z.string().uuid().optional(),
  tipo: z.enum(['PRODUTO_FINAL', 'PLANIFICADO', 'FOLHA']),
  larguraMm: z.number().min(0).nullable().optional(),
  alturaMm: z.number().min(0).nullable().optional(),
  profundidadeMm: z.number().min(0).nullable().optional(),
  observacao: z.string().max(200).nullable().optional(),
})

export const vendasQuerySchema = z.object({
  meses: z.coerce.number().int().min(1).max(60).optional(),
  topClientes: z.coerce.number().int().min(1).max(20).optional(),
})

export const statusProdutoBodySchema = z.object({
  ativo: z.boolean(),
})

export const revisaoIdParamSchema = z.object({
  revisaoId: z.string().uuid(),
})

export const dimensaoIdParamSchema = z.object({
  id: z.string().uuid(),
})
