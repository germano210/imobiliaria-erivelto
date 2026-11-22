"""T21 ponta a ponta: um roteiro do corretor e um do visitante, com as mesmas chamadas que o ponte.js faz."""
import re

from conftest import cliente, erv, imovel, jpeg


def test_t21_roteiro_do_corretor(servidor, capsys):
    # 1. a TLH cria o acesso pelo comando; o corretor recebe a senha temporária
    assert erv.comando(["usuario", "erivelto@exemplo.com", "Erivelto"]) == 0
    temporaria = re.search(r": (\S{12,})\s*$", capsys.readouterr().out).group(1)
    p = cliente()
    # 2. ponte: detectar() -> iniciarPainel() -> sessão -> login -> troca obrigatória
    assert p.get("/api/saude").json()["servico"] == "erivelto"
    assert p.get("/api/painel/sessao").json()["logado"] is False
    assert p.post("/api/painel/entrar", json={"email": "erivelto@exemplo.com", "senha": "chute-errado"}).status_code == 401
    l = p.post("/api/painel/entrar", json={"email": "erivelto@exemplo.com", "senha": temporaria}).json()
    assert l["trocar"] is True
    assert p.post("/api/painel/senha", json={"atual": temporaria, "nova": "casa-na-praia-2026"}).status_code == 200
    assert p.get("/api/painel/sessao").json()["logado"] is True
    # 2b. (T24) antes de usar o painel: o termo. Sem aceite, 403 "aceitar_termo"; o ponte mostra a tela e manda o aceite
    t = p.get("/api/painel/estado")
    assert t.status_code == 403 and t.json() == {"erro": "aceitar_termo", "versao": "v1"}
    assert p.post("/api/painel/termo/aceitar", json={"aceite": True, "versao": "v1"}).status_code == 200
    e = p.get("/api/painel/estado").json()
    assert e["admin"] == {"email": "erivelto@exemplo.com", "nome": "Erivelto", "trocar": False}
    rev = e["rev"]
    assert p.get("/api/painel/leads").json() == {"leads": []} and p.get("/api/painel/chamadas").json() == {"chamadas": []}
    # 3. imóvel novo (rascunho), duas fotos em dois tamanhos, como o P.escolherFoto faz
    s = p.post("/api/painel/fotos", content=jpeg(1280, 960, exif=True), headers={"Content-Type": "image/jpeg"}).json()
    g = p.post("/api/painel/fotos", content=jpeg(2560, 1920), headers={"Content-Type": "image/jpeg"}).json()
    assert g["w"] == 2560
    casa = imovel("k3j2h1", fotos=[{"s": s["s"], "w": 1280, "g": g["s"], "gw": 2560, "a": "Fachada", "d": False}])
    r = p.put("/api/painel/estado", json={"rev": rev, "imoveis": [casa], "tipos": {"casa": True, "apartamento": True, "terreno": False}})
    rev = r.json()["rev"]
    assert cliente().get("/api/estado").json()["imoveis"] == []            # rascunho não aparece
    # 4. publicar; mapa; WhatsApp
    rev = p.post("/api/painel/imoveis/k3j2h1/publicar", json={}).json()["rev"]
    mapa = {"modo": "perto", "cidade": "Santo Antônio da Patrulha", "raio": 42, "nomes": ["Osório"], "atende": ["Santo Antônio da Patrulha"]}
    rev = p.put("/api/painel/mapa", json={"rev": rev, "mapa": mapa}).json()["rev"]
    rev = p.post("/api/painel/mapa/publicar", json={}).json()["rev"]
    assert p.put("/api/painel/whatsapp", json={"numero": "5551999990000"}).json()["whatsapp_numero"] == "5551999990000"
    site = cliente().get("/api/estado").json()
    assert site["imoveis"][0]["fotos"][0]["s"] == s["s"] and site["mapa"] == mapa and site["whatsapp_numero"] == "5551999990000"
    assert site["tipos"]["terreno"] is False
    assert cliente().get("/" + s["s"]).status_code == 200
    # 5. outro aparelho (celular) salva; o primeiro tenta salvar com a revisão velha e recebe o conflito
    celular = cliente()
    celular.post("/api/painel/entrar", json={"email": "erivelto@exemplo.com", "senha": "casa-na-praia-2026"})
    rev_cel = celular.get("/api/painel/estado").json()["rev"]
    assert rev_cel == rev
    assert celular.put("/api/painel/estado", json={"rev": rev_cel, "imoveis": [dict(casa, preco=800000)]}).status_code == 200
    assert p.put("/api/painel/estado", json={"rev": rev, "imoveis": [dict(casa, preco=1)]}).status_code == 409
    e = p.get("/api/painel/estado").json()                              # "recarregue a página"
    assert e["imoveis"][0]["preco"] == 800000 and e["imoveis"][0]["pub"]["preco"] == 850000 and e["mapa_pub"] == mapa
    # 6. um visitante entra e pede informações; o corretor vê
    v = cliente()
    v.post("/api/contas", json={"nome": "Ana Souza", "whatsapp": "(51) 98111-2222", "aceite": True, "versao_aviso": "v3"})
    v.post("/api/leads", json={"via": "foto", "imovel_id": "k3j2h1", "imovel": '"Casa de 3 quartos" · R$ 850.000', "cidade": casa["cidade"]})
    v.post("/api/chamadas", json={"id": "k3j2h1", "nm": "Casa de 3 quartos", "o": "pedido"})
    assert [x["nome"] for x in p.get("/api/painel/leads").json()["leads"]] == ["Ana Souza"]
    assert len(p.get("/api/painel/chamadas").json()["chamadas"]) == 1
    # 7. excluir o imóvel (o contato continua em Leads) e sair
    assert p.delete("/api/painel/imoveis/k3j2h1").status_code == 200
    assert cliente().get("/api/estado").json()["imoveis"] == []
    assert len(p.get("/api/painel/leads").json()["leads"]) == 1
    assert p.post("/api/painel/sair", json={}).status_code == 200
    assert p.get("/api/painel/estado").status_code == 401 and p.get("/api/painel/leads").status_code == 401
    acoes = [a["acao"] for a in erv.q("select acao from acessos order by id")]
    assert acoes == ["login_falhou", "login", "senha_trocada", "termo_aceito", "login"]


def test_t21_roteiro_do_visitante(painel):
    # o corretor já publicou uma casa
    rev = painel.get("/api/painel/estado").json()["rev"]
    painel.put("/api/painel/estado", json={"rev": rev, "imoveis": [imovel()]})
    painel.post("/api/painel/imoveis/casa1/publicar", json={})
    v = cliente()
    # 1. ponte: detectar() -> iniciarSite(): estado sem conta
    assert v.get("/api/saude").json() == {"ok": True, "servico": "erivelto"}
    e = v.get("/api/estado").json()
    assert e["conta"] is None and "loc" not in e["imoveis"][0] and "rua" not in e["imoveis"][0]["end"]
    # 2. clica no WhatsApp sem entrar: chamada anônima
    assert v.post("/api/chamadas", json={"id": "casa1", "nm": "Casa", "o": '"Casa" · R$ 850.000 · "Pedir mais informações"'}).status_code == 200
    # 3. tenta entrar sem marcar o aceite, com número ruim, e depois certo (P.entrar)
    assert v.post("/api/contas", json={"nome": "João Pereira", "whatsapp": "(51) 98765-4321", "aceite": False, "versao_aviso": "v3"}).json()["erro"] == "aceite_obrigatorio"
    assert v.post("/api/contas", json={"nome": "João Pereira", "whatsapp": "98765", "aceite": True, "versao_aviso": "v3"}).json()["campo"] == "whatsapp"
    assert v.post("/api/contas", json={"nome": "João Pereira", "whatsapp": "(51) 98765-4321", "aceite": True, "versao_aviso": "v3"}).status_code == 200
    e = v.get("/api/estado").json()
    assert e["conta"] == {"nome": "João Pereira", "wa": "(51) 98765-4321"}
    assert e["imoveis"][0]["end"]["rua"] == "Rua das Flores" and e["imoveis"][0]["loc"]["ll"] == [-50.5201, -29.8183]
    # 4. o site registra o lead (P.lead), duas vezes por caminhos diferentes
    v.post("/api/leads", json={"via": "login", "cidade": "Santo Antônio da Patrulha"})
    v.post("/api/leads", json={"via": "fin", "imovel_id": "casa1", "imovel": '"Casa" · R$ 850.000', "cidade": "Santo Antônio da Patrulha"})
    l = painel.get("/api/painel/leads").json()["leads"]
    assert len(l) == 1 and l[0]["nome"] == "João Pereira" and l[0]["via"] == ["login", "fin"] and l[0]["id"] == "casa1"
    # 5. recarrega a página: continua dentro (cookie); outro navegador não
    assert v.get("/api/estado").json()["conta"]["nome"] == "João Pereira"
    assert cliente().get("/api/estado").json()["conta"] is None
    # 6. página de privacidade: ver os dados e apagar
    d = v.get("/api/privacidade/meus-dados").json()
    assert d["nome"] == "João Pereira" and d["contatos"][0]["por"] == ["login", "fin"] and d["aceites_do_aviso"][0]["versao"] == "v3"
    r = v.post("/api/privacidade/apagar", json={"whatsapp": "(51) 98765-4321", "nome": "João Pereira"})
    assert r.json()["apagado"] is True
    assert v.get("/api/privacidade/meus-dados").status_code == 401
    e = v.get("/api/estado").json()
    assert e["conta"] is None and "loc" not in e["imoveis"][0]
    assert painel.get("/api/painel/leads").json()["leads"] == []
    assert len(painel.get("/api/painel/chamadas").json()["chamadas"]) == 1     # a chamada anônima fica
    # 7. pedir de novo: já não há o que confirmar
    r = v.post("/api/privacidade/apagar", json={"whatsapp": "(51) 98765-4321", "nome": "João Pereira"})
    assert r.json() == {"ok": True, "apagado": False, "confirmado": False}
