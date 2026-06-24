# Implementation Plan

## Overview
Implementação do módulo de Programação de Produção por Máquina, substituindo controle em planilha Excel por módulo sistêmico integrado ao PCP. Inclui tabs por tipo de máquina, campos extras, status editável, drag-and-drop, indicadores visuais e filtros.

## Tasks

- [x] 1. Adicionar tabs por tipo de máquina na tela de Programação
  - [x] 1.1. Criar tabs: Todos | Impressão | Cortadeira | Acabamento
  - [x] 1.2. Filtrar centros exibidos com base no tipo selecionado
  - [x] 1.3. Definir tipo de cada centro baseado na descrição/código (ou campo `tipo` do CentroProducao)
- [x] 2. Campos extras na tabela de etapas
  - [x] 2.1. Adicionar colunas: Tiragem, Cartão/Material, Gramatura, Formato, KG
  - [x] 2.2. Buscar dados do material principal (PAPEL) da OP
  - [x] 2.3. Calcular tiragem (quantidade / aproveitamento se disponível)
  - [x] 2.4. Endpoint: expandir GET /pcp/programacao/painel para incluir dados de materiais
- [x] 3. Status textual editável inline
  - [x] 3.1. Tornar campo `observacaoOperador` editável com click na célula
  - [x] 3.2. Salvar via PATCH /api/pcp/etapas/:id (campo observacaoOperador)
  - [x] 3.3. Exibir como texto editável na tabela
- [x] 4. Drag-and-drop para reordenação
  - [x] 4.1. Instalar @dnd-kit/core e @dnd-kit/sortable (ou usar Mantine DnD)
  - [x] 4.2. Implementar drag nas linhas da tabela dentro de cada centro
  - [x] 4.3. Endpoint PATCH /api/pcp/etapas/reordenar para persistir nova ordem
  - [x] 4.4. Adicionar campo `posicaoFila` ao schema se necessário
- [x] 5. Indicadores visuais
  - [x] 5.1. Colorir linhas: verde (concluída), amarelo (andamento), vermelho (atrasada), cinza (pendente)
  - [x] 5.2. Badge de progresso (% produzido da tiragem)
  - [x] 5.3. Destaque visual para prioridade URGENTE/ALTA
- [x] 6. Filtros e busca
  - [x] 6.1. Campo de busca por OS/cliente/produto
  - [x] 6.2. Filtro por período de entrega
  - [x] 6.3. Filtro por status
  - [x] 6.4. Filtro por prioridade

## Task Dependency Graph
1 -> 2
2 -> 3
3 -> 4
4 -> 5
5 -> 6

## Notes
- A tela já existe em /pcp/programacao e será evoluída
- Campos como observacaoOperador já existem no schema EtapaOrdemProducao
- O endpoint GET /pcp/programacao/painel já existe e será expandido
