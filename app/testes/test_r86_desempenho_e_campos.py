"""R86 (23/11): contador do Desempenho (/api/visto e /api/painel/desempenho) e os campos novos do imóvel
(cômodos em linhas com observação, "o que tem", onde fica, preço por mês/dia/ano) passando pelo servidor."""
from conftest import cliente, imovel, publicar


def test_r86_visto_soma_site_e_imovel_sem_dado_pessoal(painel, c):
    publicar(painel, imovel("v1"))
    assert c.post("/api/visto", json={}).json() == {"ok": True}
    assert c.post("/api/visto", json={}).json() == {"ok": True}
    assert c.post("/api/visto", json={"id": "v1"}).json() == {"ok": True}
    ab = painel.get("/api/painel/desempenho").json()["aberturas"]
    por = {a["id"]: a["n"] for a in ab}
    assert por == {"": 2, "v1": 1}
    assert set(ab[0]) == {"dia", "id", "n"}          # só o dia, o imóvel e o total


def test_r86_visto_recusa_imovel_inexistente_ou_nao_publicado(painel, c):
    assert c.post("/api/visto", json={"id": "naoexiste"}).status_code == 400
    assert c.post("/api/visto", json={"id": "../x"}).status_code == 400


def test_r86_desempenho_so_para_o_painel(c):
    assert c.get("/api/painel/desempenho").status_code in (401, 403)


def test_r86_campos_novos_chegam_ao_site(painel, c):
    extra = dict(final="aluguel", per="dia", cm=[{"k": "cama", "n": "Quarto 1", "m2": 9, "o": "pega sol de manhã"}],
                 ot=[{"k": "piscina", "n": "Piscina"}], onde={"t": "cf", "n": "Residencial Teste", "e": "Rua do condomínio, 10"})
    publicar(painel, imovel("n1", **extra))
    i = [x for x in c.get("/api/estado").json()["imoveis"] if x["id"] == "n1"][0]
    for k, v in extra.items():
        assert i[k] == v, k


def test_r86_cep_preenche_endereco_so_para_o_painel(painel, c, monkeypatch):
    import app as erv
    monkeypatch.setattr(erv, "_viacep", lambda cep: {"logradouro": "Rua Teste", "bairro": "Centro", "localidade": "Osório", "uf": "RS"})
    assert c.get("/api/painel/cep/95520000").status_code in (401, 403)
    r = painel.get("/api/painel/cep/95520-000")
    assert r.status_code == 200 and r.json() == {"rua": "Rua Teste", "bairro": "Centro", "cidade": "Osório", "uf": "RS"}
    assert painel.get("/api/painel/cep/123").status_code == 400
    monkeypatch.setattr(erv, "_viacep", lambda cep: {"erro": True})
    assert painel.get("/api/painel/cep/95520000").status_code == 404
    def cai(cep): raise OSError("sem rede")
    monkeypatch.setattr(erv, "_viacep", cai)
    assert painel.get("/api/painel/cep/95520000").status_code == 502


def test_r86k_foto_livre_tem_que_ser_booleano():
    import app as A
    base = {"id": "x1", "tipo": "casa", "cidade": "Santo Antônio da Patrulha", "preco": 1}
    ok = dict(base, fotos=[{"s": "midia/a.webp", "l": True}, {"s": "midia/b.webp", "l": False}, {"s": "midia/c.webp"}])
    ruim = dict(base, fotos=[{"s": "midia/a.webp", "l": "sim"}])
    assert A.campo_errado(ruim) == "fotos"
    assert A.campo_errado(ok) != "fotos"
