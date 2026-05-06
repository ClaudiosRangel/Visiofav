import { Prisma } from '@prisma/client'

const ISOLATED_MODELS: string[] = [
  'Produto', 'Fornecedor', 'Cliente', 'Transportadora', 'Vendedor',
  'PedidoCompra', 'PedidoVenda', 'ContaPagar', 'ContaReceber',
  'Nfe', 'Cte', 'Estoque', 'AgendaWms', 'ApiKey', 'WebhookConfig',
  'OndaSeparacao', 'Parametro', 'FichaOperacional', 'CentroDistribuicao',
  'Deposito', 'Zona', 'Estrutura', 'Endereco', 'Funcionario', 'Doca',
  'EquipamentoMovimentacao', 'Funcao', 'FormaArmazenagem',
  'AmbienteArmazenagem', 'ClassificacaoProduto', 'TipoCarroceria',
  'TipoCarga', 'VeiculoWms', 'NotaEntrada', 'SaldoEndereco', 'Sku',
]

export function createTenantExtension(empresaId: string) {
  return Prisma.defineExtension({
    name: 'tenantIsolation',
    query: {
      $allOperations({ model, operation, args, query }) {
        if (!model || !ISOLATED_MODELS.includes(model)) {
          return query(args)
        }

        // Read operations: inject empresaId into where
        if (['findMany', 'findFirst', 'findUnique', 'findFirstOrThrow',
             'findUniqueOrThrow', 'count', 'aggregate', 'groupBy'].includes(operation)) {
          args.where = { ...args.where, empresaId }
          return query(args)
        }

        // Create: set empresaId
        if (operation === 'create') {
          args.data = { ...args.data, empresaId }
          return query(args)
        }

        // CreateMany: set empresaId on each item
        if (operation === 'createMany') {
          if (Array.isArray(args.data)) {
            args.data = args.data.map((d: any) => ({ ...d, empresaId }))
          } else {
            args.data = { ...args.data, empresaId }
          }
          return query(args)
        }

        // Update/UpdateMany: scope where
        if (['update', 'updateMany'].includes(operation)) {
          args.where = { ...args.where, empresaId }
          return query(args)
        }

        // Delete/DeleteMany: scope where
        if (['delete', 'deleteMany'].includes(operation)) {
          args.where = { ...args.where, empresaId }
          return query(args)
        }

        // Upsert: scope where + set empresaId on create
        if (operation === 'upsert') {
          args.where = { ...args.where, empresaId }
          args.create = { ...args.create, empresaId }
          return query(args)
        }

        return query(args)
      },
    },
  })
}
