import requests, json

API = "https://visiofav.onrender.com/api"
r = requests.post(f"{API}/auth/login", json={"email": "admin@visiofab.com", "senha": "987123"})
token = r.json()["token"]
headers = {"Authorization": f"Bearer {token}"}

# Fornecedor do agendamento
print("=== Agendamento ===")
r2 = requests.get(f"{API}/portaria/agendamentos-hoje", headers=headers)
ags = r2.json().get("data", [])
for a in ags:
    forn_id = a.get("fornecedorId")
    print(f"  fornecedorId: {forn_id}")
    print(f"  fornecedor: {a.get('fornecedor')}")

# CompraEfetivada
print("\n=== CompraEfetivada ===")
r3 = requests.get(f"{API}/compras", headers=headers, params={"limit": 5})
compras = r3.json().get("data", [])
for c in compras:
    print(f"  id: {c['id']}")
    print(f"  pedidoCompraId: {c['pedidoCompraId']}")
    forn = c.get("pedidoCompra", {}).get("fornecedor", {})
    print(f"  fornecedor: {forn}")

# Pedido de compra - verificar fornecedorId
print("\n=== PedidoCompra ===")
r4 = requests.get(f"{API}/pedidos-compra", headers=headers, params={"limit": 5})
pedidos = r4.json().get("data", [])
for p in pedidos:
    print(f"  id: {p['id']} fornecedorId: {p.get('fornecedorId')} numero: {p.get('numero')}")
