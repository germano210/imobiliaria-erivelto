"""T20 limpeza."""
from conftest import cliente, erv, imovel, jpeg, publicar

MARIA = {"nome": "Maria Silva", "whatsapp": "(51) 99999-1234", "aceite": True, "versao_aviso": "v2"}


def test_t20_limpar(painel, c, monkeypatch, capsys):
    c.post("/api/contas", json=MARIA)
    c.post("/api/leads", json={"via": "login"})
    velho = cliente()
    velho.post("/api/contas", json=dict(MARIA, whatsapp="51988887777"))
    erv.q("update visitas set expira = now() - interval '1 minute' where hash = %s", erv.hash_token(velho.cookies["erv_v"]))
    uid = erv.q1("select id from usuarios")["id"]
    erv.q("insert into sessoes(hash, usuario_id, expira) values ('vencida', %s, now() - interval '1 hour')", uid)
    erv.q("insert into tentativas(chave, n, inicio, ate) values ('antiga', 3, now() - interval '3 days', null), ('recente', 1, now(), null)")
    erv.q("insert into acessos(acao, ip, criado) values ('login', '1.2.3.4', now() - interval '7 months'), ('login', '1.2.3.4', now() - interval '5 months')")
    erv.q("update contas set atualizado = now() - interval '30 months', criado = now() - interval '30 months'")
    erv.q("update leads set atualizado = now() - interval '30 months'")
    # foto usada, foto órfã velha e foto órfã nova
    usada = painel.post("/api/painel/fotos", content=jpeg(), headers={"Content-Type": "image/jpeg"}).json()["s"]
    orfa = painel.post("/api/painel/fotos", content=jpeg(), headers={"Content-Type": "image/jpeg"}).json()["s"]
    nova = painel.post("/api/painel/fotos", content=jpeg(), headers={"Content-Type": "image/jpeg"}).json()["s"]
    publicar(painel, imovel(fotos=[{"s": usada, "a": ""}]))
    erv.q("update fotos set criado = now() - interval '8 days' where arquivo <> %s", nova[6:])

    r = erv.limpar()
    assert r == {"sessoes": 1, "visitas": 1, "tentativas": 1, "acessos": 1, "contatos": 0, "fotos": 1}
    assert erv.q1("select count(*) as n from sessoes")["n"] == 1 and painel.get("/api/painel/sessao").json()["logado"]
    assert erv.q1("select count(*) as n from leads")["n"] == 1          # contatos ficam: ERV_LEADS_MESES = 0
    assert erv.q1("select count(*) as n from acessos where criado < now() - interval '6 months'")["n"] == 0
    assert (erv.MIDIA / usada[6:]).is_file() and (erv.MIDIA / nova[6:]).is_file() and not (erv.MIDIA / orfa[6:]).exists()

    monkeypatch.setattr(erv, "LEADS_MESES", 24)
    assert erv.comando(["limpar"]) == 0
    assert "contatos 2" in capsys.readouterr().out
    erv.abrir()
    for t in ("contas", "leads", "aceites", "visitas"):
        assert erv.q1(f"select count(*) as n from {t}")["n"] == 0, t


def test_t20_tarefa_diaria_ligada_no_app(servidor):
    import asyncio
    assert asyncio.iscoroutinefunction(erv._limpeza_diaria)
    assert "_limpeza_diaria" in erv.vida.__wrapped__.__code__.co_names
