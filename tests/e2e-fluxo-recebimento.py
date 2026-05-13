"""
E2E Test: Fluxo Completo de Recebimento WMS
============================================
Testa ponta a ponta: Compras → Portaria → Conferência → Endereçamento

Uso:
  pip install requests
  python tests/e2e-fluxo-recebimento.py

Configuração via variáveis de ambiente:
  API_URL       - URL base da API (default: https://visiofab.onrender.com/api)
  TEST_EMAIL    - Email do usuário de teste
  TEST_PASSWORD - Senha do usuário de teste
"""

import os
import sys
import json
import time
import requests
from datetime import datetime, timedelta

# ══════════════════════════════════════════════════════════════════════════════
# CONFIGURAÇÃO
# ══════════════════════════════════════════════════════════════════════════════

API_URL = os.environ.get("API_URL", "https://visiofav.onrender.com/api")
EMAIL = os.environ.get("TEST_EMAIL", "admin@visiofab.com")
PASSWORD = os.environ.get("TEST_PASSWORD", "123456")

# XML de teste com rastro (lote + validade)
TEST_XML = """<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://portalfiscal.inf.br" versao="4.00">
  <NFe>
    <infNFe versao="4.00" Id="NFe33240505999999000199550010000001231000001234">
      <ide>
        <cUF>33</cUF><cNF>00000123</cNF><natOp>Venda</natOp><mod>55</mod>
        <serie>1</serie><nNF>999</nNF><dhEmi>2024-05-20T10:00:00-03:00</dhEmi>
        <tpNF>1</tpNF><idDest>1</idDest><cMunFG>3304557</cMunFG>
        <tpImp>1</tpImp><tpEmis>1</tpEmis><cDV>4</cDV><tpAmb>2</tpAmb>
        <finNFe>1</finNFe><indFinal>0</indFinal><indPres>1</indPres>
        <procEmi>0</procEmi><verProc>4.0</verProc>
      </ide>
      <emit>
        <CNPJ>05999999000199</CNPJ>
        <xNome>Vende Tudos testes LTda</xNome>
        <enderEmit><xlps>Rua teste</xlps><nro>SN</nro><xBairro>Centro</xBairro>
        <cMun>3304557</cMun><xMun>Rio de Janeiro</xMun><UF>RJ</UF><CEP>25870001</CEP>
        <cPais>1058</cPais><xPais>BRASIL</xPais></enderEmit>
        <IE>888888888</IE><CRT>3</CRT>
      </emit>
      <dest>
        <CNPJ>00000000000000</CNPJ><xNome>EMPRESA TESTE</xNome>
        <enderDest><xlps>Rua</xlps><nro>1</nro><xBairro>B</xBairro>
        <cMun>3304557</cMun><xMun>RJ</xMun><UF>RJ</UF><CEP>20000000</CEP>
        <cPais>1058</cPais><xPais>BRASIL</xPais></enderDest>
        <indIEDest>1</indIEDest><IE>123456789</IE>
      </dest>
      <det nItem="1">
        <prod>
          <cProd>MOCA395CX48</cProd>
          <cEAN>17891000010010</cEAN>
          <xProd>LEITE CONDENSADO MOCA LATA 395G - CAIXA COM 48 UN</xProd>
          <NCM>04029900</NCM><CFOP>5102</CFOP>
          <uCom>CX</uCom><qCom>100.0000</qCom><vUnCom>350.00</vUnCom>
          <vProd>35000.00</vProd>
          <cEANTrib>7891000010013</cEANTrib><uTrib>UN</uTrib>
          <qTrib>4800.0000</qTrib><vUnTrib>7.29</vUnTrib><indTot>1</indTot>
          <rastro>
            <nLote>LOTE-E2E-TEST</nLote>
            <qLote>100.000</qLote>
            <dFab>2024-05-01</dFab>
            <dVal>2027-06-01</dVal>
          </rastro>
        </prod>
        <imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><modBC>3</modBC>
        <vBC>35000.00</vBC><pICMS>18.00</pICMS><vICMS>6300.00</vICMS>
        </ICMS00></ICMS></imposto>
      </det>
      <total><ICMSTot><vBC>35000.00</vBC><vICMS>6300.00</vICMS>
      <vProd>35000.00</vProd><vNF>35000.00</vNF></ICMSTot></total>
      <transp><modFrete>0</modFrete></transp>
    </infNFe>
  </NFe>
</nfeProc>"""

# ══════════════════════════════════════════════════════════════════════════════
# HELPERS
# ══════════════════════════════════════════════════════════════════════════════

class TestResult:
    def __init__(self):
        self.results = []
        self.passed = 0
        self.failed = 0

    def ok(self, step, msg=""):
        self.results.append(("PASS", step, msg))
        self.passed += 1
        print(f"  ✅ {step}" + (f" — {msg}" if msg else ""))

    def fail(self, step, msg=""):
        self.results.append(("FAIL", step, msg))
        self.failed += 1
        print(f"  ❌ {step}" + (f" — {msg}" if msg else ""))

    def summary(self):
        print(f"\n{'='*60}")
        print(f"RESULTADO: {self.passed} passed, {self.failed} failed, {self.passed + self.failed} total")
        if self.failed > 0:
            print("\nFALHAS:")
            for status, step, msg in self.results:
                if status == "FAIL":
                    print(f"  ❌ {step}: {msg}")
        print(f"{'='*60}")
        return self.failed == 0


def api_get(path, token, params=None):
    r = requests.get(f"{API_URL}{path}", headers={"Authorization": f"Bearer {token}"}, params=params, timeout=30)
    return r

def api_post(path, token, json_data=None, files=None):
    headers = {"Authorization": f"Bearer {token}"}
    if files:
        r = requests.post(f"{API_URL}{path}", headers=headers, files=files, timeout=30)
    else:
        r = requests.post(f"{API_URL}{path}", headers=headers, json=json_data, timeout=30)
    return r


# ══════════════════════════════════════════════════════════════════════════════
# TESTES
# ══════════════════════════════════════════════════════════════════════════════

def run_tests():
    t = TestResult()
    print(f"\n{'='*60}")
    print(f"E2E TEST: Fluxo Recebimento WMS")
    print(f"API: {API_URL}")
    print(f"Data: {datetime.now().strftime('%d/%m/%Y %H:%M')}")
    print(f"{'='*60}\n")

    # ── STEP 0: Health Check ──────────────────────────────────────────────
    print("▶ STEP 0: Health Check")
    try:
        r = requests.get(f"{API_URL}/health", timeout=15)
        if r.status_code == 200:
            data = r.json()
            t.ok("Health check", f"buildDate={data.get('buildDate', '?')}")
        else:
            t.fail("Health check", f"status={r.status_code}")
            return t
    except Exception as e:
        t.fail("Health check", f"Conexão falhou: {e}")
        return t

    # ── STEP 1: Login ─────────────────────────────────────────────────────
    print("\n▶ STEP 1: Login")
    try:
        r = requests.post(f"{API_URL}/auth/login", json={"email": EMAIL, "senha": PASSWORD}, timeout=15)
        if r.status_code == 200:
            token = r.json()["token"]
            t.ok("Login", f"user={r.json()['usuario']['nome']}")
        else:
            t.fail("Login", f"status={r.status_code} body={r.text[:200]}")
            return t
    except Exception as e:
        t.fail("Login", str(e))
        return t

    # ── STEP 2: Verificar produto existe (MOCA395CX48) ────────────────────
    print("\n▶ STEP 2: Verificar produto e SKU")
    r = api_get("/produtos", token, {"search": "MOCA395CX48", "limit": 5})
    if r.status_code == 200:
        produtos = r.json().get("data", [])
        if len(produtos) > 0:
            produto = produtos[0]
            produto_id = produto["id"]
            t.ok("Produto encontrado", f"id={produto_id} nome={produto.get('nome','?')}")
        else:
            t.fail("Produto MOCA395CX48 não encontrado", "Cadastre o produto antes de rodar o teste")
            return t
    else:
        t.fail("GET /produtos", f"status={r.status_code}")
        return t

    # Verificar SKU com lastro/camada
    r = api_get("/skus", token, {"produtoId": produto_id})
    if r.status_code == 200:
        skus = r.json().get("data", [])
        sku_com_palete = [s for s in skus if s.get("lastro") and s.get("camada")]
        if sku_com_palete:
            sku = sku_com_palete[0]
            t.ok("SKU com paletização", f"lastro={sku['lastro']} camada={sku['camada']} → {sku['lastro']*sku['camada']} cx/palete")
        else:
            t.fail("SKU sem lastro/camada", f"SKUs encontrados: {len(skus)}")
    else:
        # Tentar endpoint alternativo
        t.fail("GET /skus", f"status={r.status_code} — endpoint pode não existir")

    # ── STEP 3: Importar XML (parser test) ────────────────────────────────
    print("\n▶ STEP 3: Importar XML (testar parser)")
    files = {"file": ("test-nfe.xml", TEST_XML.encode("utf-8"), "application/xml")}
    r = api_post("/notas-entrada/importar-xml", token, files=files)
    if r.status_code == 200:
        parsed = r.json()
        itens = parsed.get("itens", [])
        if len(itens) > 0:
            item = itens[0]
            lote = item.get("lote", "")
            validade = item.get("validade", "")
            t.ok("Parser XML", f"itens={len(itens)} lote='{lote}' validade='{validade}'")
            if lote == "LOTE-E2E-TEST":
                t.ok("Lote extraído do rastro")
            else:
                t.fail("Lote NÃO extraído", f"esperado='LOTE-E2E-TEST' obtido='{lote}'")
            if validade == "2027-06-01":
                t.ok("Validade extraída do rastro")
            else:
                t.fail("Validade NÃO extraída", f"esperado='2027-06-01' obtido='{validade}'")
        else:
            t.fail("Parser XML sem itens", json.dumps(parsed)[:200])
    else:
        t.fail("POST /notas-entrada/importar-xml", f"status={r.status_code} body={r.text[:200]}")

    # ── STEP 4: Verificar endereços livres existem ────────────────────────
    print("\n▶ STEP 4: Verificar endereços livres")
    r = api_get("/enderecos", token, {"limit": 50})
    if r.status_code == 200:
        enderecos = r.json().get("data", [])
        livres = [e for e in enderecos if e.get("tipo") in ("ARMAZENAGEM", "LIVRE") and e.get("status") == True]
        t.ok("Endereços encontrados", f"total={len(enderecos)} livres/armazenagem={len(livres)}")
        if len(livres) == 0:
            t.fail("Nenhum endereço livre", "Gere endereços antes de testar endereçamento")
    else:
        t.fail("GET /enderecos", f"status={r.status_code}")

    # ── STEP 5: Criar nota de entrada com lote/validade ───────────────────
    print("\n▶ STEP 5: Criar nota de entrada com lote/validade")
    nota_data = {
        "numero": 9999,
        "serie": "1",
        "fornecedor": "Vende Tudos testes LTda",
        "fornecedorDoc": "05.999.999/0001-99",
        "tipo": "COMPRA",
        "itens": [{
            "item": 1,
            "descricao": "LEITE CONDENSADO MOCA LATA 395G - CAIXA COM 48 UN",
            "codigoProduto": "MOCA395CX48",
            "unidade": "CX",
            "quantidade": 100,
            "lote": "LOTE-E2E-TEST",
            "validade": "2027-06-01",
        }]
    }
    r = api_post("/notas-entrada", token, nota_data)
    if r.status_code == 201:
        nota = r.json()
        nota_id = nota["id"]
        itens_nota = nota.get("itens", [])
        t.ok("Nota criada", f"id={nota_id} numero={nota.get('numero')}")
        if itens_nota:
            item_nota = itens_nota[0]
            if item_nota.get("lote") == "LOTE-E2E-TEST":
                t.ok("Lote salvo na nota")
            else:
                t.fail("Lote NÃO salvo", f"lote={item_nota.get('lote')}")
            if item_nota.get("validade"):
                t.ok("Validade salva na nota", item_nota["validade"])
            else:
                t.fail("Validade NÃO salva")
    else:
        t.fail("POST /notas-entrada", f"status={r.status_code} body={r.text[:300]}")
        nota_id = None

    # ── STEP 6: Iniciar conferência ───────────────────────────────────────
    if nota_id:
        print("\n▶ STEP 6: Iniciar conferência")
        r = api_post(f"/conferencia-entrada/iniciar/{nota_id}", token)
        if r.status_code == 200:
            conf = r.json()
            itens_conf = conf.get("itens", [])
            t.ok("Conferência iniciada", f"itens={len(itens_conf)}")
            if itens_conf:
                item_conf = itens_conf[0]
                lote_conf = item_conf.get("lote", "")
                validade_conf = item_conf.get("validade", "")
                shelf_life = item_conf.get("shelfLifeMinimo")
                if lote_conf == "LOTE-E2E-TEST":
                    t.ok("Lote retornado na conferência")
                else:
                    t.fail("Lote NÃO retornado na conferência", f"lote='{lote_conf}'")
                if validade_conf:
                    t.ok("Validade retornada na conferência", validade_conf)
                else:
                    t.fail("Validade NÃO retornada na conferência")
                if shelf_life:
                    t.ok("ShelfLifeMinimo retornado", f"{shelf_life} dias")
                else:
                    t.fail("ShelfLifeMinimo NÃO retornado", "Verifique se produto tem shelfLifeMinimo configurado")

                # ── STEP 7: Conferir todos (verificar resultado) ──────────
                print("\n▶ STEP 7: Conferir todos (verificar resultado)")
                conferir_body = {
                    "itens": [{
                        "itemNotaEntradaId": item_conf["id"],
                        "quantidadeConferida": 100,
                        "lote": "LOTE-E2E-TEST",
                        "validade": "01/06/2027",
                    }]
                }
                r = api_post(f"/conferencia-entrada/conferir-todos/{nota_id}", token, conferir_body)
                if r.status_code == 200:
                    resultado = r.json()
                    t.ok("Conferir todos", f"totalItens={resultado.get('totalItens')} conformes={resultado.get('conformes')} divergentes={resultado.get('divergentes')}")
                    if resultado.get("totalItens", 0) > 0:
                        t.ok("Itens processados no resultado")
                    else:
                        t.fail("Nenhum item no resultado", f"falhasShelfLife={resultado.get('falhasShelfLife')}")
                elif r.status_code == 422:
                    t.fail("Conferir bloqueado", r.json().get("message", r.text[:200]))
                else:
                    t.fail("POST conferir-todos", f"status={r.status_code} body={r.text[:300]}")

                # ── STEP 8: Aprovar conferência ───────────────────────────
                print("\n▶ STEP 8: Aprovar conferência")
                r = api_post(f"/conferencia-entrada/confirmar/{nota_id}", token)
                if r.status_code == 200:
                    t.ok("Conferência aprovada", r.json().get("message", ""))
                else:
                    t.fail("POST confirmar", f"status={r.status_code} body={r.text[:200]}")

        else:
            t.fail("POST iniciar conferência", f"status={r.status_code} body={r.text[:300]}")

    # ── STEP 9: Sugerir endereçamento ─────────────────────────────────────
    if nota_id:
        print("\n▶ STEP 9: Sugerir endereçamento (sugerir-lote)")
        r = api_get("/enderecamento-wms/sugerir-lote", token, {"notaEntradaId": nota_id})
        if r.status_code == 200:
            sugestoes = r.json().get("sugestoes", [])
            t.ok("Sugerir-lote respondeu", f"sugestoes={len(sugestoes)}")
            if sugestoes:
                sug = sugestoes[0]
                distribuicao = sug.get("distribuicao")
                sugestao = sug.get("sugestao")
                if distribuicao and distribuicao.get("alocacoes"):
                    t.ok("Distribuição com alocações", f"alocacoes={len(distribuicao['alocacoes'])} completa={distribuicao.get('completa')}")
                elif sugestao and sugestao.get("enderecoId"):
                    t.ok("Sugestão de endereço", f"endereco={sugestao.get('enderecoCompleto')}")
                else:
                    t.fail("Sem sugestão de endereço", json.dumps(sug)[:300])
            else:
                t.fail("Nenhuma sugestão retornada")
        elif r.status_code == 422:
            t.fail("Sugerir-lote bloqueado", r.json().get("message", r.text[:200]))
        else:
            t.fail("GET sugerir-lote", f"status={r.status_code} body={r.text[:300]}")

    # ── STEP 10: Shelf Life bloqueio (validade curta) ─────────────────────
    print("\n▶ STEP 10: Shelf Life bloqueio (validade curta)")
    # Criar nota com validade curta para testar bloqueio
    nota_shelf = {
        "numero": 9998,
        "serie": "1",
        "fornecedor": "Teste Shelf Life",
        "tipo": "COMPRA",
        "itens": [{
            "item": 1,
            "descricao": "LEITE CONDENSADO MOCA - SHELF TEST",
            "codigoProduto": "MOCA395CX48",
            "unidade": "CX",
            "quantidade": 10,
            "lote": "LOTE-SHELF",
            "validade": (datetime.now() + timedelta(days=10)).strftime("%Y-%m-%d"),  # 10 dias (< 30 min)
        }]
    }
    r = api_post("/notas-entrada", token, nota_shelf)
    if r.status_code == 201:
        nota_shelf_id = r.json()["id"]
        # Iniciar
        r2 = api_post(f"/conferencia-entrada/iniciar/{nota_shelf_id}", token)
        if r2.status_code == 200:
            item_id = r2.json()["itens"][0]["id"]
            # Conferir com validade curta
            r3 = api_post(f"/conferencia-entrada/conferir-todos/{nota_shelf_id}", token, {
                "itens": [{"itemNotaEntradaId": item_id, "quantidadeConferida": 10, "validade": (datetime.now() + timedelta(days=10)).strftime("%d/%m/%Y")}]
            })
            if r3.status_code == 200:
                res = r3.json()
                if res.get("falhasShelfLife"):
                    t.ok("Shelf Life BLOQUEOU corretamente", res["falhasShelfLife"][0].get("mensagem", "")[:100])
                else:
                    t.fail("Shelf Life NÃO bloqueou", f"totalItens={res.get('totalItens')} — deveria ter bloqueado (validade 10 dias < mínimo 30)")
            else:
                t.fail("Conferir shelf test", f"status={r3.status_code}")
        else:
            t.fail("Iniciar shelf test", f"status={r2.status_code} body={r2.text[:200]}")
        # Cleanup: excluir nota de teste
        requests.delete(f"{API_URL}/notas-entrada/{nota_shelf_id}", headers={"Authorization": f"Bearer {token}"})
    else:
        t.fail("Criar nota shelf test", f"status={r.status_code}")

    # ── CLEANUP ───────────────────────────────────────────────────────────
    print("\n▶ CLEANUP")
    if nota_id:
        # Tentar excluir nota de teste
        r = requests.delete(f"{API_URL}/notas-entrada/{nota_id}", headers={"Authorization": f"Bearer {token}"})
        if r.status_code in (200, 204):
            t.ok("Nota de teste excluída")
        else:
            t.ok("Nota de teste mantida (pode estar conferida)", f"status={r.status_code}")

    # ── SUMMARY ───────────────────────────────────────────────────────────
    return t


if __name__ == "__main__":
    t = run_tests()
    success = t.summary()
    sys.exit(0 if success else 1)
