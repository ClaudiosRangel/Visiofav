import requests, json

API = "https://visiofav.onrender.com/api"
r = requests.post(f"{API}/auth/login", json={"email": "admin@visiofab.com", "senha": "987123"})
token = r.json()["token"]
headers = {"Authorization": f"Bearer {token}"}

# Check notas
r2 = requests.get(f"{API}/notas-entrada", headers=headers, params={"limit": 5})
notas = r2.json().get("data", [])
print(f"Notas: {len(notas)}")
for n in notas:
    print(f"  NF {n['numero']} status={n['status']}")
    for item in n.get("itens", []):
        print(f"    item: lote={item.get('lote')} validade={item.get('validade')} cod={item.get('codigoProduto')}")

# Check agendamento pedidoCompraId
r3 = requests.get(f"{API}/portaria/agendamentos-hoje", headers=headers)
ags = r3.json().get("data", [])
print(f"\nAgendamentos: {len(ags)}")
for a in ags:
    print(f"  status={a['status']} pedidoCompraId={a.get('pedidoCompraId')} fornecedorId={a.get('fornecedorId')}")
    if a.get("pedido"):
        print(f"    pedido #{a['pedido'].get('numero')} itens={len(a['pedido'].get('itens',[]))}")
