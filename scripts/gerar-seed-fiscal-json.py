# -*- coding: utf-8 -*-
"""
Converte as planilhas oficiais de NCM, CFOP e CEST (arquivos .xlsx na raiz do
projeto) para os arquivos JSON de fallback local usados por
src/modules/fiscal/seed-fiscal/fonte-externa.service.ts quando a variável de
ambiente SEED_FISCAL_<TABELA>_URL não está configurada.

Uso: python scripts/gerar-seed-fiscal-json.py
"""
import json
import re
import openpyxl

OUT_DIR = 'src/modules/fiscal/seed-fiscal/data'

# ---------------------------------------------------------------------------
# CFOP — 160314_Tabela_CFOP.xlsx (planilha "CFOP", colunas: CFOP, Descrição
# Resumida, indNFe, indComunica, indTransp, indDevol)
# ---------------------------------------------------------------------------
def gerar_cfop():
    wb = openpyxl.load_workbook('160314_Tabela_CFOP.xlsx', data_only=True)
    ws = wb['CFOP']
    rows = list(ws.iter_rows(min_row=2, values_only=True))

    # CFOP 5151 vem sem descrição na planilha oficial; corrigido por analogia
    # ao CFOP 6151 (mesma operação, âmbito interestadual): "Transferência de
    # produção do estabelecimento".
    correcao_descricao = {5151: 'Transferência de produção do estabelecimento'}

    def derivar(codigo):
        primeiro = str(codigo)[0]
        tipo = 'ENTRADA' if primeiro in ('1', '2', '3') else 'SAIDA'
        mapa_ambito = {'1': 'ESTADUAL', '5': 'ESTADUAL', '2': 'INTERESTADUAL',
                       '6': 'INTERESTADUAL', '3': 'EXTERIOR', '7': 'EXTERIOR'}
        return tipo, mapa_ambito.get(primeiro, 'ESTADUAL')

    registros = []
    for cfop, desc_resumida, _indNFe, _indComunica, _indTransp, _indDevol in rows:
        codigo = str(cfop)
        descricao = desc_resumida if desc_resumida is not None else correcao_descricao.get(cfop)
        if descricao is None:
            raise ValueError(f'Sem descricao para CFOP {codigo}')
        descricao = descricao.strip()
        tipo, ambito = derivar(cfop)
        registros.append({
            'codigo': codigo,
            'descricao': descricao,
            'tipo': tipo,
            'ambito': ambito,
            'geraCredIcms': False,
            'geraCredPisCofins': False,
            'incideIpi': False,
        })

    with open(f'{OUT_DIR}/cfop.json', 'w', encoding='utf-8') as f:
        json.dump(registros, f, ensure_ascii=False, indent=2)
    print(f'cfop.json: {len(registros)} registros')


# ---------------------------------------------------------------------------
# NCM — Tabela_NCM_Vigente_20260711.xlsx (planilha "Tabela NCM", cabeçalho na
# linha 5: Código, Descrição, Data Início, Data Fim, Ato Legal Início,
# Número, Ano). Apenas os códigos "folha" (8 dígitos, formato NNNN.NN.NN) são
# NCMs completos — os demais são capítulos/posições/subposições
# intermediárias da hierarquia, não usados como código de produto.
# ---------------------------------------------------------------------------
def gerar_ncm():
    wb = openpyxl.load_workbook('Tabela_NCM_Vigente_20260711.xlsx', data_only=True)
    ws = wb['Tabela NCM']
    rows = list(ws.iter_rows(min_row=6, values_only=True))

    padrao_folha = re.compile(r'^\d{4}\.\d{2}\.\d{2}$')
    registros = []
    for row in rows:
        codigo_raw = row[0]
        descricao = row[1]
        if not codigo_raw or not padrao_folha.match(str(codigo_raw)):
            continue
        codigo = str(codigo_raw).replace('.', '')
        if not descricao:
            continue
        descricao = descricao.strip()[:500]
        registros.append({
            'codigo': codigo,
            'descricao': descricao,
        })

    with open(f'{OUT_DIR}/ncm.json', 'w', encoding='utf-8') as f:
        json.dump(registros, f, ensure_ascii=False, indent=2)
    print(f'ncm.json: {len(registros)} registros')


# ---------------------------------------------------------------------------
# CEST — Tabela_CEST_Estruturada.xlsx (planilha "Detalhes CEST", cabeçalho na
# linha 3: ITEM, CEST, NCM/SH, DESCRIÇÃO; planilha "Segmentos" mapeia o
# código do segmento — 2 primeiros dígitos do CEST — ao nome do segmento).
# ---------------------------------------------------------------------------
def gerar_cest():
    wb = openpyxl.load_workbook('Tabela_CEST_Estruturada.xlsx', data_only=True)

    ws_seg = wb['Segmentos']
    segmentos_rows = list(ws_seg.iter_rows(min_row=4, values_only=True))
    mapa_segmento = {}
    for item, nome, cod_segmento in segmentos_rows:
        if cod_segmento is None or nome is None:
            continue
        mapa_segmento[str(cod_segmento).zfill(2)] = nome.strip()

    ws_det = wb['Detalhes CEST']
    rows = list(ws_det.iter_rows(min_row=4, values_only=True))

    padrao_cest = re.compile(r'^\d{2}\.\d{3}\.\d{2}$')
    registros = []
    for _item, cest_raw, _ncm, descricao in rows:
        if not cest_raw or not padrao_cest.match(str(cest_raw)):
            continue
        codigo = str(cest_raw).replace('.', '')
        if not descricao:
            continue
        descricao = descricao.strip()[:500]
        segmento = mapa_segmento.get(codigo[:2])
        registros.append({
            'codigo': codigo,
            'descricao': descricao,
            'segmento': segmento,
        })

    with open(f'{OUT_DIR}/cest.json', 'w', encoding='utf-8') as f:
        json.dump(registros, f, ensure_ascii=False, indent=2)
    print(f'cest.json: {len(registros)} registros')


if __name__ == '__main__':
    gerar_cfop()
    gerar_ncm()
    gerar_cest()
