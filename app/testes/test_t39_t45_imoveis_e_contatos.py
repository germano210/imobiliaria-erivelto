"""T39 situação · T40 venda e aluguel · T41 tipos novos · T42 código · T43 contatos com situação · T44 visita · T45 quero vender.
O que depende do navegador (selos, filtro, telas) está no roteiro testes/e2e/roteiro.py; aqui ficam a API, o banco e os remendos."""
import subprocess
import sys

from conftest import RAIZ, cliente, erv, imovel, publicar

MARIA = {"nome": "Maria Silva", "whatsapp": "(51) 99999-1234", "aceite": True, "versao_aviso": "v3"}
VENDER = {"nome": "Pedro Lima", "whatsapp": "(51) 98888-7777", "tipo": "sobrado", "cidade": "Osório",
          "obs": "3 quartos, pátio grande", "aceite": True, "versao_aviso": "v3"}


def salvar(p, *ims):
    rev = p.get("/api/painel/estado").json()["rev"]
    return p.put("/api/painel/estado", json={"rev": rev, "imoveis": list(ims)})


def ids_no_site(c):
    return [i["id"] for i in c.get("/api/estado").json()["imoveis"]]


# ---------- T39 ----------
def test_t39_situacao_valida(painel):
    assert salvar(painel, imovel(sit="xx")).json() == {"erro": "invalido", "campo": "situação"}
    assert salvar(painel, imovel(sit="vend", vendMostra="sim")).json()["campo"] == "situação"
    for sit in ("disp", "res", "vend"):
        assert salvar(painel, imovel(sit=sit)).status_code == 200, sit


def test_t39_vendido_sai_do_site_a_nao_ser_que_marque_mostrar(painel, c):
    publicar(painel, imovel("a1", sit="disp"))
    publicar(painel, imovel("a2", sit="res"))
    publicar(painel, imovel("a3", sit="vend"))
    publicar(painel, imovel("a4", sit="vend", vendMostra=True))
    assert ids_no_site(c) == ["a1", "a2", "a4"]
    # o servidor só não lista o vendido escondido: ele continua publicado e o painel continua vendo todos
    assert [i["id"] for i in painel.get("/api/painel/estado").json()["imoveis"]] == ["a1", "a2", "a3", "a4"]


# ---------- T40 ----------
def test_t40_finalidade(painel, c):
    assert salvar(painel, imovel(final="temporada")).json()["campo"] == "finalidade"
    publicar(painel, imovel("al1", final="aluguel", preco=2500, fin=False))
    pub = c.get("/api/estado").json()["imoveis"][0]
    assert pub["final"] == "aluguel" and pub["preco"] == 2500


def test_t40_periodo_do_aluguel(painel, c):
    """O valor guardado é o do mês; perAlug diz como o site mostra (dia = mês ÷ 30, ano = mês × 12; a conta é no ponte.js)."""
    assert salvar(painel, imovel(final="aluguel", perAlug="semana")).json()["campo"] == "período do aluguel"
    for per in ("dia", "mes", "ano"):
        assert salvar(painel, imovel(final="aluguel", perAlug=per, preco=1100)).status_code == 200, per
    publicar(painel, imovel("al2", final="aluguel", perAlug="dia", preco=1100, fin=False))
    assert c.get("/api/estado").json()["imoveis"][0]["perAlug"] == "dia"
    ponte = (RAIZ / "site/ponte.js").read_text()
    assert "var PER_ALUG = { dia: ['/dia', 1 / 30], mes: ['/mês', 1], ano: ['/ano', 12] };" in ponte


def test_t40_precos_de_aluguel_no_node():
    """1100/mês = R$ 36,67/dia = R$ 1.100/mês = R$ 13.200/ano (centavos só quando não dá inteiro)."""
    import shutil, json
    if not shutil.which("node"):
        import pytest; pytest.skip("sem node")
    ponte = (RAIZ / "site/ponte.js").read_text()
    ini = ponte.index("  var PER_ALUG = {"); fim = ponte.index("  };", ini) + 4
    js = "var P = {};" + ponte[ini:fim] + ";console.log(JSON.stringify(['dia','mes','ano',undefined].map(function(p){return P.precoAlug({preco:1100, perAlug:p})}).concat([P.precoAlug({preco:3000, perAlug:'dia'})])))"
    out = json.loads(subprocess.run(["node", "-e", js], capture_output=True, text=True, check=True).stdout)
    assert out == ["R$ 36,67/dia", "R$ 1.100/mês", "R$ 13.200/ano", "R$ 1.100/mês", "R$ 100/dia"], out


# ---------- T41 ----------
def test_t41_tipos_novos(painel, c):
    assert set(erv.TIPOS) == {"casa", "sobrado", "apartamento", "terreno", "sitio", "sala", "galpao"}
    for t in ("sobrado", "sitio", "sala", "galpao"):
        assert salvar(painel, imovel("t-" + t, tipo=t)).status_code == 200, t
    assert salvar(painel, imovel(tipo="castelo")).json()["campo"] == "tipo"
    assert salvar(painel, imovel(tipo="aluguel")).json()["campo"] == "tipo"     # "Para alugar" é categoria do site, não tipo


def test_t41_estado_novo_liga_todos_os_tipos(painel):
    e = painel.get("/api/painel/estado").json()
    assert all(e["tipos"][t] is True for t in erv.TIPOS)


# ---------- T42 ----------
def test_t42_codigo_valido(painel):
    assert salvar(painel, imovel(cod="ES-012")).status_code == 200
    assert salvar(painel, imovel(cod="12")).json()["campo"] == "código"
    assert salvar(painel, imovel(cod="ES-1")).json()["campo"] == "código"


def test_t42_migracao_da_codigo_aos_imoveis_antigos(painel, c):
    publicar(painel, imovel("v1"))
    publicar(painel, imovel("v2", cod="ES-007"))
    erv.q("insert into imoveis(id, rascunho) values ('v3', %s)", erv.J(imovel("v3")))
    erv.migrar()
    r = {i["id"]: (i["rascunho"].get("cod"), (i["publicado"] or {}).get("cod")) for i in erv.q("select * from imoveis")}
    assert r == {"v1": ("ES-008", "ES-008"), "v2": ("ES-007", "ES-007"), "v3": ("ES-009", None)}
    erv.migrar()   # de novo: não muda nada
    assert {i["id"]: i["rascunho"]["cod"] for i in erv.q("select * from imoveis")} == {"v1": "ES-008", "v2": "ES-007", "v3": "ES-009"}
    assert {i["id"]: i.get("cod") for i in c.get("/api/estado").json()["imoveis"]} == {"v1": "ES-008", "v2": "ES-007"}


# ---------- T43 ----------
def test_t43_painel_marca_situacao_e_nota(painel, c):
    publicar(painel)
    assert c.post("/api/contas", json=MARIA).status_code == 200
    assert c.post("/api/leads", json={"via": "login", "imovel_id": "casa1", "imovel": '"Casa" · R$ 850 mil', "cidade": "Osório"}).status_code == 200
    l = painel.get("/api/painel/leads").json()["leads"][0]
    assert l["sit"] == "novo" and l["nota"] == "" and isinstance(l["lid"], int)
    assert painel.put(f"/api/painel/leads/{l['lid']}", json={"sit": "visita"}).json() == {"ok": True}
    assert painel.put(f"/api/painel/leads/{l['lid']}", json={"nota": "  Prefere sábado.\nTem FGTS. "}).json() == {"ok": True}
    l = painel.get("/api/painel/leads").json()["leads"][0]
    assert (l["sit"], l["nota"]) == ("visita", "Prefere sábado.\nTem FGTS.")
    # a situação não volta para "novo" quando a pessoa pede outra coisa
    c.post("/api/leads", json={"via": "fin", "imovel_id": "casa1"})
    assert painel.get("/api/painel/leads").json()["leads"][0]["sit"] == "visita"
    # a pessoa vê a situação e a anotação em "ver os meus dados"
    d = c.get("/api/privacidade/meus-dados").json()["contatos"][0]
    assert d["situacao_marcada_pelo_corretor"] == "visita" and d["anotacao_do_corretor"] == "Prefere sábado.\nTem FGTS."


def test_t43_validacao_e_permissao(painel, c):
    c.post("/api/contas", json=MARIA)
    c.post("/api/leads", json={"via": "login"})
    lid = painel.get("/api/painel/leads").json()["leads"][0]["lid"]
    assert painel.put(f"/api/painel/leads/{lid}", json={"sit": "ganho"}).json()["campo"] == "situação"
    assert painel.put(f"/api/painel/leads/{lid}", json={"nota": "x" * 1001}).json()["campo"] == "nota"
    assert painel.put(f"/api/painel/leads/{lid}", json={}).status_code == 400
    assert painel.put("/api/painel/leads/999999", json={"sit": "falei"}).status_code == 404
    assert c.put(f"/api/painel/leads/{lid}", json={"sit": "falei"}).status_code == 401           # visitante não muda
    assert cliente().put(f"/api/painel/leads/{lid}", json={"sit": "falei"}).status_code == 401


# ---------- T44 ----------
def test_t44_visita_pedida_vira_contato(painel, c):
    publicar(painel)
    c.post("/api/contas", json=MARIA)
    assert c.post("/api/leads", json={"via": "visita", "imovel_id": "casa1", "imovel": '"Casa"', "cidade": "Osório",
                                      "pedido": "sáb, 22/11, à tarde"}).status_code == 200
    l = painel.get("/api/painel/leads").json()["leads"][0]
    assert l["via"] == ["visita"] and l["pedido"] == "sáb, 22/11, à tarde" and l["id"] == "casa1"
    c.post("/api/leads", json={"via": "login", "pedido": "não vale"})                  # só a via "visita" grava o pedido
    assert painel.get("/api/painel/leads").json()["leads"][0]["pedido"] == "sáb, 22/11, à tarde"
    assert c.post("/api/leads", json={"via": "visita", "pedido": "x" * 500}).status_code == 200
    assert len(painel.get("/api/painel/leads").json()["leads"][0]["pedido"]) == 120


def test_t44_visita_sem_entrar_nao_vira_contato(c):
    assert c.post("/api/leads", json={"via": "visita", "pedido": "hoje"}).status_code == 401


# ---------- T45 ----------
def test_t45_quero_vender_cai_nos_contatos(painel):
    v = cliente()
    assert v.post("/api/vender", json=VENDER).json() == {"ok": True}
    l = painel.get("/api/painel/leads").json()["leads"]
    assert len(l) == 1 and l[0]["nome"] == "Pedro Lima" and l[0]["via"] == ["vender"] and l[0]["cidade"] == "Osório"
    assert l[0]["vender"] == {"tipo": "sobrado", "cidade": "Osório", "obs": "3 quartos, pátio grande"}
    assert erv.q1("select versao from aceites")["versao"] == "v3"
    linha = erv.q1("select * from contas")
    assert b"98888" not in bytes(linha["wa_cif"]) and b"Pedro" not in bytes(linha["nome_cif"])     # cifrado, como o login
    # a mesma pessoa entrando no site depois: o mesmo contato, com as duas vias
    v.post("/api/contas", json=dict(MARIA, nome="Pedro Lima", whatsapp="51988887777"))
    v.post("/api/leads", json={"via": "login"})
    l = painel.get("/api/painel/leads").json()["leads"]
    assert len(l) == 1 and l[0]["via"] == ["vender", "login"]
    # apagar os dados leva o pedido de venda junto
    assert cliente().post("/api/privacidade/apagar", json={"nome": "pedro lima", "whatsapp": "51 98888 7777"}).json()["apagado"] is True
    assert painel.get("/api/painel/leads").json()["leads"] == []


def test_t45_validacao(c):
    assert c.post("/api/vender", json=dict(VENDER, aceite=False)).json()["erro"] == "aceite_obrigatorio"
    assert c.post("/api/vender", json=dict(VENDER, versao_aviso="v2")).json()["erro"] == "aceite_obrigatorio"
    assert c.post("/api/vender", json=dict(VENDER, tipo="castelo")).json()["campo"] == "tipo"
    assert c.post("/api/vender", json=dict(VENDER, cidade=" ")).json()["campo"] == "cidade"
    assert c.post("/api/vender", json=dict(VENDER, whatsapp="123")).json()["campo"] == "whatsapp"
    assert c.post("/api/vender", json=dict(VENDER, nome="P")).json()["campo"] == "nome"
    assert c.post("/api/vender", json=dict(VENDER, tipo="outro", obs="x" * 900)).status_code == 200
    assert len(erv.q1("select vender from leads")["vender"]["obs"]) == 300
    r = cliente().post("/api/vender", json=VENDER, headers={"Origin": "https://outro.site"})
    assert r.status_code == 403


def test_t45_limite_por_ip():
    v = cliente()
    for i in range(10):
        assert v.post("/api/vender", json=dict(VENDER, whatsapp=f"519888877{i:02d}")).status_code == 200
    assert v.post("/api/vender", json=VENDER).status_code == 429


# ---------- remendos e ponte ----------
def test_remendos_do_site_aplicados():
    r = subprocess.run([sys.executable, str(RAIZ / "remendos.py"), "--conferir"], capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr
    import importlib.util
    spec = importlib.util.spec_from_file_location("remendos", RAIZ / "remendos.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    ponte = (RAIZ / "site/ponte.js").read_text()
    for f in ("vitrine", "selos", "msg", "botaoVisita"):                  # o que os remendos chamam existe no ponte.js
        assert f"P.{f} = function" in ponte, f
        assert any(f"PONTE.{f}" in novo for _, _, _, novo in m.REMENDOS), f
    assert "P.leadMudar = function" in ponte and "P.telaVender = function" in ponte
