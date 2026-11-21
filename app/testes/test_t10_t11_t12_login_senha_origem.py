"""T10 entrar/sair/sessão · T11 troca de senha · T12 CSRF e origem."""
from conftest import H, cliente, criar_usuario, erv


def test_t10_login_cookie_e_sessao(c):
    email, senha = criar_usuario()
    assert c.get("/api/painel/sessao").json() == {"logado": False}
    r = c.post("/api/painel/entrar", json={"email": " Corretor@Exemplo.com ", "senha": senha})
    assert r.status_code == 200 and r.json() == {"ok": True, "email": email, "nome": "Corretor", "trocar": False}
    ck = r.headers["set-cookie"]
    assert "HttpOnly" in ck and "SameSite=lax" in ck and "Max-Age=43200" in ck and "Path=/" in ck and "Secure" not in ck
    s = c.get("/api/painel/sessao").json()
    assert s["logado"] and s["email"] == email
    d = erv.q1("select extract(epoch from expira - criado) as s from sessoes")
    assert abs(float(d["s"]) - 12 * 3600) < 5
    assert c.post("/api/painel/sair", json={}).status_code == 200
    assert c.get("/api/painel/sessao").json() == {"logado": False}
    assert erv.q1("select count(*) as n from sessoes")["n"] == 0
    assert c.get("/api/painel/estado").status_code == 401


def test_t10_cookie_secure_com_https(c, monkeypatch):
    email, senha = criar_usuario()
    monkeypatch.setattr(erv, "HTTPS", True)
    r = c.post("/api/painel/entrar", json={"email": email, "senha": senha})
    assert "Secure" in r.headers["set-cookie"] and "HttpOnly" in r.headers["set-cookie"]


def test_t10_id_novo_a_cada_login(c):
    email, senha = criar_usuario()
    c.post("/api/painel/entrar", json={"email": email, "senha": senha})
    t1 = c.cookies["erv_p"]
    c.post("/api/painel/entrar", json={"email": email, "senha": senha})
    t2 = c.cookies["erv_p"]
    assert t1 != t2
    velho = cliente()
    velho.cookies.set("erv_p", t1)
    assert velho.get("/api/painel/sessao").json() == {"logado": False}   # o id antigo morreu


def test_t10_sessao_vencida_nao_vale(painel):
    erv.q("update sessoes set expira = now() - interval '1 second'")
    assert painel.get("/api/painel/sessao").json() == {"logado": False}
    assert painel.get("/api/painel/leads").status_code == 401


def test_t10_mensagem_unica_e_bloqueio_apos_5_erros(c):
    email, senha = criar_usuario()
    r1 = c.post("/api/painel/entrar", json={"email": email, "senha": "errada-errada"})
    r2 = c.post("/api/painel/entrar", json={"email": "naoexiste@exemplo.com", "senha": "errada-errada"})
    assert r1.status_code == r2.status_code == 401 and r1.json() == r2.json()
    for _ in range(4):
        assert c.post("/api/painel/entrar", json={"email": email, "senha": "errada-errada"}).status_code == 401
    r = c.post("/api/painel/entrar", json={"email": email, "senha": senha})    # a certa também fica bloqueada
    assert r.status_code == 429 and 890 <= r.json()["espera"] <= 900
    assert erv.q1("select count(*) as n from acessos where acao = 'login_falhou'")["n"] == 6
    erv.q("update tentativas set ate = now() - interval '1 second'")           # passaram os 15 min
    assert c.post("/api/painel/entrar", json={"email": email, "senha": senha}).status_code == 200


def test_t10_senha_temporaria_so_deixa_trocar(c):
    email, senha = criar_usuario(temp=True)
    r = c.post("/api/painel/entrar", json={"email": email, "senha": senha})
    assert r.json()["trocar"] is True
    e = c.get("/api/painel/estado")
    assert e.status_code == 200 and e.json()["admin"]["trocar"] is True and "imoveis" not in e.json()
    assert c.get("/api/painel/leads").status_code == 403
    assert c.put("/api/painel/estado", json={"rev": 1, "imoveis": []}).status_code == 403
    assert c.post("/api/painel/senha", json={"atual": senha, "nova": "definitiva-12345"}).status_code == 200
    assert c.get("/api/painel/estado").json()["admin"]["trocar"] is False
    assert c.get("/api/painel/leads").status_code == 200


def test_t11_troca_de_senha(painel):
    senha = "senha-bem-comprida"
    outro = cliente()
    assert outro.post("/api/painel/entrar", json={"email": "corretor@exemplo.com", "senha": senha}).status_code == 200
    assert painel.post("/api/painel/senha", json={"atual": "nao-e-essa", "nova": "nova-senha-123"}).status_code == 403
    r = painel.post("/api/painel/senha", json={"atual": senha, "nova": "curta9999"})
    assert r.status_code == 400 and r.json()["erro"] == "senha_fraca"
    assert painel.post("/api/painel/senha", json={"atual": senha, "nova": senha}).json()["erro"] == "senha_fraca"
    antes = painel.cookies["erv_p"]
    assert painel.post("/api/painel/senha", json={"atual": senha, "nova": "nova-senha-123"}).status_code == 200
    assert painel.cookies["erv_p"] != antes
    assert painel.get("/api/painel/sessao").json()["logado"] is True          # este aparelho continua
    assert outro.get("/api/painel/sessao").json() == {"logado": False}        # o outro caiu
    novo = cliente()
    assert novo.post("/api/painel/entrar", json={"email": "corretor@exemplo.com", "senha": senha}).status_code == 401
    assert novo.post("/api/painel/entrar", json={"email": "corretor@exemplo.com", "senha": "nova-senha-123"}).status_code == 200


def test_t11_muitas_senhas_atuais_erradas(painel):
    for _ in range(5):
        assert painel.post("/api/painel/senha", json={"atual": "errada", "nova": "nova-senha-123"}).status_code == 403
    assert painel.post("/api/painel/senha", json={"atual": "senha-bem-comprida", "nova": "nova-senha-123"}).status_code == 429


def test_t11_trocar_email_de_login(painel):
    assert painel.put("/api/painel/email", json={"email": "novo@exemplo.com", "senha": "errada"}).status_code == 403
    assert painel.put("/api/painel/email", json={"email": "sem-arroba", "senha": "senha-bem-comprida"}).status_code == 400
    r = painel.put("/api/painel/email", json={"email": "Novo@Exemplo.com", "senha": "senha-bem-comprida"})
    assert r.status_code == 200 and r.json()["email"] == "novo@exemplo.com"
    assert painel.get("/api/painel/sessao").json()["email"] == "novo@exemplo.com"
    assert cliente().post("/api/painel/entrar", json={"email": "novo@exemplo.com", "senha": "senha-bem-comprida"}).status_code == 200


def test_t12_exige_cabecalho_e_origem(servidor, monkeypatch):
    from fastapi.testclient import TestClient
    email, senha = criar_usuario()
    corpo = {"email": email, "senha": senha}
    cru = TestClient(erv.app)
    casos = [({}, 403), ({"X-Requested-With": "tlh"}, 403), ({"Origin": H["Origin"]}, 403),
             ({"X-Requested-With": "tlh", "Origin": "https://malvado.example"}, 403),
             ({"X-Requested-With": "tlh", "Origin": "null", "Referer": "https://malvado.example/x"}, 403),
             ({"X-Requested-With": "tlh", "Origin": "https://abc-def.trycloudflare.com"}, 403),
             ({"X-Requested-With": "outro", "Origin": H["Origin"]}, 403),
             ({"X-Requested-With": "tlh", "Referer": H["Origin"] + "/painel/"}, 200),
             (H, 200)]
    for cab, esperado in casos:
        r = cru.post("/api/painel/entrar", json=corpo, headers=cab)
        assert r.status_code == esperado, cab
        if esperado == 403:
            assert r.json() == {"erro": "origem"}
    for metodo, url in (("put", "/api/painel/estado"), ("delete", "/api/painel/imoveis/x"), ("post", "/api/contas"), ("post", "/api/leads"),
                        ("post", "/api/chamadas"), ("post", "/api/privacidade/apagar"), ("put", "/api/painel/whatsapp"), ("post", "/api/painel/fotos")):
        assert getattr(cru, metodo)(url).status_code == 403, url
    assert cru.get("/api/estado").status_code == 200       # leitura não precisa


def test_t12_tunel_de_teste_so_com_a_variavel(servidor, monkeypatch):
    from fastapi.testclient import TestClient
    email, senha = criar_usuario()
    monkeypatch.setattr(erv, "TUNEL_TESTE", True)
    cru = TestClient(erv.app)
    ok = {"X-Requested-With": "tlh", "Origin": "https://abc-def-123.trycloudflare.com"}
    assert cru.post("/api/painel/entrar", json={"email": email, "senha": senha}, headers=ok).status_code == 200
    for ruim in ("http://abc.trycloudflare.com", "https://abc.trycloudflare.com.malvado.example", "https://x.y.trycloudflare.com"):
        assert cru.post("/api/painel/sair", json={}, headers={"X-Requested-With": "tlh", "Origin": ruim}).status_code == 403, ruim
