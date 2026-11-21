"""T24: termo do painel no 1º acesso. Sem aceite, as rotas do painel dão 403 "aceitar_termo"; o aceite fica no banco."""
import re

from conftest import RAIZ, cliente, criar_usuario, erv, imovel, jpeg

SENHA = "senha-bem-comprida"


def entrar(email="corretor@exemplo.com", **k):
    criar_usuario(email=email, **k)
    p = cliente()
    assert p.post("/api/painel/entrar", json={"email": email, "senha": SENHA}).status_code == 200
    return p


def test_t24_sem_aceite_o_painel_nao_abre_dados(servidor):
    p = entrar(termo=False)
    assert p.get("/api/painel/sessao").json()["termo"] is False
    bloqueadas = [("GET", "/api/painel/estado", None), ("PUT", "/api/painel/estado", {"rev": 1, "imoveis": [imovel()]}),
                  ("GET", "/api/painel/leads", None), ("GET", "/api/painel/chamadas", None),
                  ("POST", "/api/painel/imoveis/casa1/publicar", {}), ("POST", "/api/painel/imoveis/casa1/despublicar", {}),
                  ("DELETE", "/api/painel/imoveis/casa1", None), ("PUT", "/api/painel/mapa", {"rev": 1, "mapa": {}}),
                  ("POST", "/api/painel/mapa/publicar", {}), ("PUT", "/api/painel/whatsapp", {"numero": "5551999990000"}),
                  ("PUT", "/api/painel/email", {"email": "novo@exemplo.com", "senha": SENHA})]
    for metodo, url, corpo in bloqueadas:
        r = p.request(metodo, url, json=corpo)
        assert r.status_code == 403 and r.json() == {"erro": "aceitar_termo", "versao": "v1"}, url
    r = p.post("/api/painel/fotos", content=jpeg(), headers={"Content-Type": "image/jpeg"})
    assert r.status_code == 403 and r.json()["erro"] == "aceitar_termo"
    assert erv.q1("select count(*) as n from imoveis")["n"] == 0 and erv.q1("select count(*) as n from fotos")["n"] == 0
    assert erv.q1("select count(*) as n from config")["n"] == 0
    # continuam abertas: ver a sessão, ler o termo, trocar a senha e sair
    assert p.get("/api/painel/termo").json() == {"versao": "v1", "aceito": False, "em": None}
    assert p.post("/api/painel/senha", json={"atual": SENHA, "nova": "outra-senha-123"}).status_code == 200
    assert p.post("/api/painel/sair", json={}).status_code == 200


def test_t24_aceite_fica_registrado_com_usuario_versao_data_e_ip(servidor, monkeypatch):
    monkeypatch.setattr(erv, "IP_CABECALHO", "CF-Connecting-IP")
    p = entrar(termo=False)
    r = p.post("/api/painel/termo/aceitar", json={"aceite": True, "versao": "v1"}, headers={"CF-Connecting-IP": "203.0.113.7"})
    assert r.status_code == 200 and r.json() == {"ok": True, "versao": "v1"}
    linhas = erv.q("select t.*, u.email as dono from termos t join usuarios u on u.id = t.usuario_id")
    assert len(linhas) == 1
    t = linhas[0]
    assert t["dono"] == t["email"] == "corretor@exemplo.com" and t["versao"] == "v1" and t["ip"] == "203.0.113.7" and t["criado"] is not None
    assert erv.q1("select count(*) as n from acessos where acao = 'termo_aceito'")["n"] == 1
    # o painel abre; aceitar de novo não cria outra linha
    assert p.get("/api/painel/estado").status_code == 200 and p.get("/api/painel/leads").status_code == 200
    j = p.get("/api/painel/termo").json()
    assert j["aceito"] is True and j["em"]
    assert p.post("/api/painel/termo/aceitar", json={"aceite": True, "versao": "v1"}).status_code == 200
    assert erv.q1("select count(*) as n from termos")["n"] == 1
    assert p.get("/api/painel/sessao").json()["termo"] is True


def test_t24_aceite_precisa_ser_explicito_e_da_versao_atual(servidor):
    p = entrar(termo=False)
    for corpo in ({}, {"aceite": True}, {"aceite": True, "versao": "v0"}, {"aceite": False, "versao": "v1"}, {"aceite": "sim", "versao": "v1"}):
        r = p.post("/api/painel/termo/aceitar", json=corpo)
        assert r.status_code == 400 and r.json() == {"erro": "versao_termo", "versao": "v1"}, corpo
    assert erv.q1("select count(*) as n from termos")["n"] == 0
    assert cliente().post("/api/painel/termo/aceitar", json={"aceite": True, "versao": "v1"}).status_code == 401   # sem sessão
    assert cliente().get("/api/painel/termo").status_code == 401


def test_t24_senha_temporaria_troca_antes_de_aceitar(servidor):
    criar_usuario(temp=True, termo=False)
    p = cliente()
    assert p.post("/api/painel/entrar", json={"email": "corretor@exemplo.com", "senha": SENHA}).json()["trocar"] is True
    r = p.post("/api/painel/termo/aceitar", json={"aceite": True, "versao": "v1"})
    assert r.status_code == 403 and r.json()["erro"] == "trocar_senha"
    assert p.get("/api/painel/leads").json()["erro"] == "trocar_senha"          # a ordem das telas: 1º a senha, depois o termo
    assert p.post("/api/painel/senha", json={"atual": SENHA, "nova": "definitiva-12345"}).status_code == 200
    assert p.get("/api/painel/leads").json()["erro"] == "aceitar_termo"
    assert p.post("/api/painel/termo/aceitar", json={"aceite": True, "versao": "v1"}).status_code == 200
    assert p.get("/api/painel/leads").status_code == 200


def test_t24_versao_nova_pede_aceite_de_novo_e_o_antigo_fica(servidor, monkeypatch):
    p = entrar()                                   # já aceitou a v1
    assert p.get("/api/painel/estado").status_code == 200
    monkeypatch.setattr(erv, "TERMO_VERSAO", "v9")
    r = p.get("/api/painel/estado")
    assert r.status_code == 403 and r.json() == {"erro": "aceitar_termo", "versao": "v9"}
    assert p.post("/api/painel/termo/aceitar", json={"aceite": True, "versao": "v1"}).status_code == 400
    assert p.post("/api/painel/termo/aceitar", json={"aceite": True, "versao": "v9"}).status_code == 200
    assert p.get("/api/painel/estado").status_code == 200
    assert [t["versao"] for t in erv.q("select versao from termos order by id")] == ["v1", "v9"]


def test_t24_aceite_e_de_cada_usuario_e_sobrevive_a_senha_nova(servidor, capsys):
    a = entrar()
    b = entrar(email="outra@exemplo.com", termo=False)
    assert a.get("/api/painel/leads").status_code == 200 and b.get("/api/painel/leads").status_code == 403
    assert erv.comando(["senha", "corretor@exemplo.com"]) == 0     # senha temporária nova: não precisa aceitar de novo
    temporaria = re.search(r": (\S{12,})\s*$", capsys.readouterr().out).group(1)
    n = cliente()
    assert n.post("/api/painel/entrar", json={"email": "corretor@exemplo.com", "senha": temporaria}).status_code == 200
    assert n.post("/api/painel/senha", json={"atual": temporaria, "nova": "mais-uma-senha-1"}).status_code == 200
    assert n.get("/api/painel/leads").status_code == 200
    assert erv.comando(["usuarios"]) == 0
    saida = capsys.readouterr().out
    assert "termo v1 aceito em" in saida and "termo v1 ainda não aceito" in saida
    erv.q("delete from usuarios where email = 'corretor@exemplo.com'")          # o registro do aceite não some com o usuário
    assert erv.q1("select usuario_id, email from termos") == {"usuario_id": None, "email": "corretor@exemplo.com"}


def test_t24_texto_do_termo_no_site(c):
    r = c.get("/painel/termo.html")
    assert r.status_code == 200 and "noindex" in r.headers["x-robots-tag"]
    t = r.text
    assert "modelo, sem revisão jurídica" in t.split("<html")[0]                # o aviso fica no topo do arquivo
    assert 'id="pt-termo-texto"' in t and f"Versão {erv.TERMO_VERSAO}" in t      # a versão da tela é a que o servidor exige
    for trecho in ("controlador", "operadora", "Loud House", "domínio", "marca", "fotos", "pessoal"):
        assert trecho in t, trecho
    ponte = (RAIZ / "site/ponte.js").read_text()
    assert "aceitar_termo" in ponte and "api/painel/termo/aceitar" in ponte and "painel/termo.html" in ponte
