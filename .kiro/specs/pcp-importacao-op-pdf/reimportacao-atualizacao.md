# Requisito: Reimportação de OP — Detecção de Alterações

## Cenário
Quando o usuário importa um PDF de OP cujo número já existe no sistema (ex: OP 2849 já importada anteriormente), o sistema deve:

1. **Detectar a duplicata** pelo número da OP
2. **Comparar dados** do PDF com os dados da OP existente
3. **Exibir diferenças** em formato visual (tabela de comparação)
4. **Perguntar ao usuário** se deseja atualizar a OP existente

## Campos a Comparar

| Campo | Ação se diferente |
|-------|-------------------|
| Quantidade | Atualiza |
| Data de Entrega | Atualiza |
| Programação de Entrega | Substitui programações |
| Materiais (BOM) | Mostra adicionados/removidos/alterados |
| Etapas (Roteiro) | Mostra adicionados/removidos/alterados |
| Observações | Atualiza |
| Cliente | Atualiza |

## Fluxo no Frontend

```
Upload PDF → Detecta OP existente → Tela de Comparação → Confirma Atualização
                                         │
                                         ├── Cabeçalho: campo | valor atual | valor novo | status (igual/alterado)
                                         ├── Materiais: lista com +adicionados -removidos ~alterados
                                         ├── Etapas: lista com +adicionados -removidos ~alterados
                                         └── Botões: [Atualizar OP] [Criar Nova (duplicar)] [Cancelar]
```

## Regras de Negócio

1. Só pode atualizar OP em status RASCUNHO ou PLANEJADA
2. Se OP está em PROGRAMADA, LIBERADA ou EM_PRODUCAO → bloqueia atualização, permite apenas criar nova
3. Se OP está CONCLUIDA ou CANCELADA → permite criar nova com mesmo número? Não — gera sequencial
4. A atualização registra log: "OP atualizada via reimportação PDF. Alterações: [lista]"
5. Materiais removidos no novo PDF → marca como CANCELADO (não deleta, mantém histórico)
6. Materiais adicionados → cria novos ItemOrdemProducao

## API Backend

- Endpoint existente `POST /api/pcp/importar-op-pdf` já retorna `opDuplicada` com id/numero/status
- Novo endpoint ou extensão: `POST /api/pcp/importar-op-pdf/comparar` que retorna as diferenças
- Novo endpoint: `PATCH /api/pcp/importar-op-pdf/atualizar` que aplica as alterações na OP existente
