"""T13 estado do painel e imóveis · T14 estado público · T18 mapa e WhatsApp."""
import json

from conftest import cliente, erv, imovel, publicar

MAPA = {"modo": "perto", "cidade": "Santo Antônio da Patrulha", "raio": 42, "nomes": ["Osório"], "atende": ["Santo Antônio da Patrulha", "Osório"]}


def test_t13_estado_inicial_no_formato_do_painel(painel):
    e = painel.get("/api/painel/estado").json()
    assert e["v"] == 3 and e["rev"] == 1 and e["imoveis"] == [] and e["exemplo"] is False
    assert e["tipos"] == {t: True for t in erv.TIPOS} and set(erv.TIPOS) >= {"casa", "apartamento", "terreno"}
    assert e["admin"] == {"email": "corretor@exemplo.com", "nome": "Corretor", "trocar": False} and e["plano"] == "erivelto"


def test_t13_salvar_rascunho_nao_vai_para_o_site(painel, c):
    r = painel.put("/api/painel/estado", json={"rev": 1, "imoveis": [imovel()], "tipos": {"casa": True, "apartamento": False, "terreno": True}})
    assert r.status_code == 200 and r.json() == {"ok": True, "rev": 2}
    e = painel.get("/api/painel/estado").json()
    assert e["rev"] == 2 and e["tipos"]["apartamento"] is False
    assert e["imoveis"][0]["id"] == "casa1" and e["imoveis"][0]["pub"] is None
    assert {k: v for k, v in e["imoveis"][0].items() if k != "pub"} == imovel()
    pub = c.get("/api/estado").json()
    assert pub["imoveis"] == [] and pub["tipos"]["apartamento"] is False


def test_t13_conflito_de_revisao(painel):
    assert painel.put("/api/painel/estado", json={"rev": 1, "imoveis": [imovel()]}).json()["rev"] == 2
    # outro aparelho ainda acha que a revisão é 1
    r = painel.put("/api/painel/estado", json={"rev": 1, "imoveis": [imovel(preco=1)]})
    assert r.status_code == 409 and r.json() == {"erro": "conflito", "rev": 2}
    assert painel.get("/api/painel/estado").json()["imoveis"][0]["preco"] == 850000      # nada foi gravado
    assert painel.put("/api/painel/mapa", json={"rev": 1, "mapa": MAPA}).status_code == 409
    assert painel.put("/api/painel/estado", json={"rev": "2", "imoveis": []}).status_code == 400


def test_t13_imovel_invalido_diz_o_campo(painel):
    casos = [({"id": "a b"}, "id"), ({"tipo": "castelo"}, "tipo"), ({"preco": -1}, "preço"), ({"preco": "caro"}, "preço"),
             ({"fotos": [{"s": "https://malvado.example/x.jpg"}]}, "fotos"), ({"fotos": [{"s": "../.env.jpg"}]}, "fotos"),
             ({"fotos": [{"s": "midia/a.webp", "g": "javascript:alert(1)"}]}, "fotos"), ({"end": "rua"}, "end")]
    for extra, campo in casos:
        r = painel.put("/api/painel/estado", json={"rev": 1, "imoveis": [imovel(**extra)]})
        assert r.status_code == 400 and r.json()["campo"] == campo, extra
    assert painel.get("/api/painel/estado").json()["rev"] == 1


def test_t13_publicar_mudar_e_excluir(painel, c):
    publicar(painel)
    e = painel.get("/api/painel/estado").json()
    assert e["rev"] == 3 and e["imoveis"][0]["pub"]["preco"] == 850000
    assert [i["id"] for i in c.get("/api/estado").json()["imoveis"]] == ["casa1"]
    # mudar o rascunho não muda o site até publicar de novo
    painel.put("/api/painel/estado", json={"rev": 3, "imoveis": [imovel(preco=790000)]})
    assert c.get("/api/estado").json()["imoveis"][0]["preco"] == 850000
    e = painel.get("/api/painel/estado").json()
    assert e["imoveis"][0]["preco"] == 790000 and e["imoveis"][0]["pub"]["preco"] == 850000
    assert painel.post("/api/painel/imoveis/casa1/publicar", json={}).json()["rev"] == 5
    assert c.get("/api/estado").json()["imoveis"][0]["preco"] == 790000
    # tirar do site (rota pronta; o painel atual não chama)
    assert painel.post("/api/painel/imoveis/casa1/despublicar", json={}).json()["rev"] == 6
    assert c.get("/api/estado").json()["imoveis"] == []
    assert painel.get("/api/painel/estado").json()["imoveis"][0]["pub"] is None
    painel.post("/api/painel/imoveis/casa1/publicar", json={})
    # excluir
    r = painel.delete("/api/painel/imoveis/casa1")
    assert r.status_code == 200 and r.json()["rev"] == 8
    assert painel.delete("/api/painel/imoveis/casa1").status_code == 404
    assert c.get("/api/estado").json()["imoveis"] == [] and painel.get("/api/painel/estado").json()["imoveis"] == []


def test_t13_publicar_incompleto_e_limite_do_plano(painel, monkeypatch):
    painel.put("/api/painel/estado", json={"rev": 1, "imoveis": [imovel("vazio", cidade="", preco=0, fotos=[])]})
    r = painel.post("/api/painel/imoveis/vazio/publicar", json={})
    assert r.status_code == 422 and r.json()["falta"] == ["cidade", "preço", "1 foto"]
    assert painel.post("/api/painel/imoveis/nao-existe/publicar", json={}).status_code == 404
    monkeypatch.setattr(erv, "PLANO", "basico")
    for n in range(3):
        publicar(painel, imovel(f"im{n}"))
    rev = painel.get("/api/painel/estado").json()["rev"]
    painel.put("/api/painel/estado", json={"rev": rev, "imoveis": [imovel("im3")]})
    r = painel.post("/api/painel/imoveis/im3/publicar", json={})
    assert r.status_code == 403 and r.json() == {"erro": "limite_plano", "limite": 3}
    assert painel.post("/api/painel/imoveis/im0/publicar", json={}).status_code == 200     # republicar um que já está no site pode


def test_t13_rotas_do_painel_exigem_login(c):
    for metodo, url in (("get", "/api/painel/estado"), ("put", "/api/painel/estado"), ("post", "/api/painel/imoveis/x/publicar"),
                        ("delete", "/api/painel/imoveis/x"), ("get", "/api/painel/leads"), ("get", "/api/painel/chamadas"),
                        ("put", "/api/painel/mapa"), ("post", "/api/painel/mapa/publicar"), ("put", "/api/painel/whatsapp"),
                        ("post", "/api/painel/senha"), ("put", "/api/painel/email")):
        r = getattr(c, metodo)(url, **({} if metodo in ("get", "delete") else {"json": {}}))
        assert r.status_code == 401, url
    assert c.post("/api/painel/fotos", content=b"x", headers={"Content-Type": "image/jpeg"}).status_code == 401


def test_t14_sem_conta_nao_sai_rua_numero_nem_ponto(painel, c):
    publicar(painel)
    e = c.get("/api/estado").json()
    im = e["imoveis"][0]
    texto = json.dumps(e, ensure_ascii=False)
    for segredo in ("Rua das Flores", "123", "-50.5201", "-29.8183", "Escola Santa Inês", "Mercado do Zé", "-29.81"):
        assert segredo not in texto, segredo
    assert "loc" not in im and im["end"] == {"bairro": "Centro"} and im["nomes"] == {"bairro": True, "rua": False, "num": False}
    assert im["px"] == [{"t": "escola", "d": 400, "u": "m"}, {"t": "mercado", "d": 2400, "u": "m"}]   # só a faixa de distância
    assert im["cidade"] == "Santo Antônio da Patrulha" and im["preco"] == 850000 and im["fotos"] and "pub" not in im
    assert e["conta"] is None and "leads" not in e and "admin" not in e and "rev" not in e


def test_t14_com_conta_sai_so_o_que_o_corretor_marcou(painel, c):
    publicar(painel)
    publicar(painel, imovel("casa2", nomes={"rua": False, "num": True, "bairro": False}))
    assert c.post("/api/contas", json={"nome": "Maria Silva", "whatsapp": "(51) 99999-1234", "aceite": True, "versao_aviso": "v3"}).status_code == 200
    e = c.get("/api/estado").json()
    a, b = e["imoveis"]
    assert a["end"] == {"bairro": "Centro", "rua": "Rua das Flores", "num": "123"} and a["loc"] == {"ll": [-50.5201, -29.8183]}
    assert a["px"][0]["n"] == "Escola Santa Inês" and a["px"][0]["d"] == 350
    assert "end" not in b                                     # rua desmarcada: nem com conta
    assert e["conta"] == {"nome": "Maria Silva", "wa": "(51) 99999-1234"}
    c.post("/api/contas/sair", json={})
    assert "loc" not in c.get("/api/estado").json()["imoveis"][0]


def test_t14_rascunho_nunca_vaza(painel, c):
    publicar(painel)
    painel.put("/api/painel/estado", json={"rev": 3, "imoveis": [imovel(nome="RASCUNHO SECRETO"), imovel("outro", nome="NAO PUBLICADO")]})
    texto = c.get("/api/estado").text
    assert "RASCUNHO SECRETO" not in texto and "NAO PUBLICADO" not in texto


def test_t18_mapa_rascunho_e_publicado(painel, c):
    assert painel.put("/api/painel/mapa", json={"rev": 1, "mapa": {"modo": "lua", "cidade": "", "raio": 1}}).status_code == 400
    assert painel.put("/api/painel/mapa", json={"rev": 1, "mapa": dict(MAPA, raio=0)}).status_code == 400
    assert painel.post("/api/painel/mapa/publicar", json={}).status_code == 400          # ainda não há mapa salvo
    r = painel.put("/api/painel/mapa", json={"rev": 1, "mapa": MAPA})
    assert r.status_code == 200 and r.json()["rev"] == 2
    e = painel.get("/api/painel/estado").json()
    assert e["mapa"] == MAPA and e["mapa_pub"] is None and c.get("/api/estado").json()["mapa"] is None
    assert painel.post("/api/painel/mapa/publicar", json={}).json() == {"ok": True, "rev": 3}
    assert c.get("/api/estado").json()["mapa"] == MAPA and painel.get("/api/painel/estado").json()["mapa_pub"] == MAPA


def test_t18_mapa_limite_de_cidades_do_plano(painel, monkeypatch):
    monkeypatch.setattr(erv, "PLANO", "basico")
    painel.put("/api/painel/mapa", json={"rev": 1, "mapa": dict(MAPA, atende=["A", "B", "C", "D"])})
    r = painel.post("/api/painel/mapa/publicar", json={})
    assert r.status_code == 403 and r.json()["limite"] == 3


def test_t18_whatsapp_do_site(painel, c, monkeypatch):
    assert c.get("/api/estado").json()["whatsapp_numero"] is None and c.get("/api/estado").json()["whatsapp"] is False
    for ruim in ("5551333344445", "51999991234", "abc", ""):
        assert painel.put("/api/painel/whatsapp", json={"numero": ruim}).status_code == 400, ruim
    r = painel.put("/api/painel/whatsapp", json={"numero": "5551999991234"})
    assert r.status_code == 200 and r.json()["whatsapp_numero"] == "5551999991234"
    e = c.get("/api/estado").json()
    assert e["whatsapp_numero"] == "5551999991234" and e["whatsapp"] is True
    assert painel.get("/api/painel/estado").json()["whatsapp_numero"] == "5551999991234"
    assert painel.get("/api/painel/estado").json()["rev"] == 1       # o ponte não atualiza a revisão nesta rota
    erv.q("delete from config")
    monkeypatch.setattr(erv, "WHATSAPP_INICIAL", "5551988887777")
    assert c.get("/api/estado").json()["whatsapp_numero"] == "5551988887777"
