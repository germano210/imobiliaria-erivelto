"""T16 contas e leads · T17 chamadas · T19 privacidade."""
import json

from conftest import cliente, erv, imovel, publicar

MARIA = {"nome": "Maria Silva", "whatsapp": "(51) 99999-1234", "aceite": True, "versao_aviso": "v3"}


def test_t16_validacao_como_o_ponte_espera(c):
    r = c.post("/api/contas", json=dict(MARIA, nome="M"))
    assert r.status_code == 400 and r.json()["campo"] == "nome"
    for ruim in ("99999-1234", "(00) 99999-1234", "(51) 89999-1234", "abc", "+1 555 123 4567 89"):
        r = c.post("/api/contas", json=dict(MARIA, whatsapp=ruim))
        assert r.status_code == 400 and r.json()["campo"] == "whatsapp", ruim
    for extra in ({"aceite": False}, {"aceite": "sim"}, {"versao_aviso": "v0"}):
        r = c.post("/api/contas", json=dict(MARIA, **extra))
        assert r.status_code == 400 and r.json()["erro"] == "aceite_obrigatorio", extra
    assert erv.q1("select count(*) as n from contas")["n"] == 0
    for bom in ("51 3333-4444", "+55 (51) 99999-1234", "5551999991234"):
        assert cliente().post("/api/contas", json=dict(MARIA, whatsapp=bom)).status_code == 200, bom


def test_t16_contato_cifrado_em_repouso_e_aceite_registrado(c):
    r = c.post("/api/contas", json=MARIA)
    assert r.status_code == 200 and r.json()["conta"] == {"nome": "Maria Silva", "wa": "(51) 99999-1234"}
    ck = r.headers["set-cookie"]
    assert "erv_v=" in ck and "HttpOnly" in ck and "SameSite=lax" in ck
    linha = erv.q1("select * from contas")
    bruto = bytes(linha["nome_cif"]) + bytes(linha["wa_cif"]) + linha["wa_hmac"].encode()
    for claro in (b"Maria", b"Silva", b"99999", b"1234", b"5551999991234"):
        assert claro not in bruto
    assert erv.decifrar(linha["nome_cif"], "nome") == "Maria Silva" and erv.decifrar(linha["wa_cif"], "wa") == "5551999991234"
    assert linha["wa_hmac"] == erv.indice_wa("5551999991234") and len(linha["wa_hmac"]) == 64
    a = erv.q("select * from aceites")
    assert len(a) == 1 and a[0]["versao"] == "v3" and a[0]["conta_id"] == linha["id"] and a[0]["criado"] is not None
    # nenhuma tabela guarda o contato em texto puro
    tudo = json.dumps([erv.q(f"select * from {t}") for t in ("visitas", "leads", "aceites", "tentativas", "acessos")], default=str)
    assert "Maria" not in tudo and "99999" not in tudo
    v = erv.q1("select hash from visitas")
    assert v["hash"] == erv.hash_token(c.cookies["erv_v"])


def test_t16_mesmo_numero_e_a_mesma_conta(c):
    c.post("/api/contas", json=MARIA)
    outro = cliente()
    assert outro.post("/api/contas", json=dict(MARIA, whatsapp="51999991234", nome="maria  silva")).status_code == 200
    assert erv.q1("select count(*) as n from contas")["n"] == 1 and erv.q1("select count(*) as n from aceites")["n"] == 2


def test_t16_lead_so_com_conta_e_so_o_corretor_le(painel, c):
    publicar(painel)
    corpo = {"via": "login", "imovel_id": "casa1", "imovel": '"Casa de 3 quartos" · R$ 850.000', "cidade": "Santo Antônio da Patrulha"}
    assert c.post("/api/leads", json=corpo).status_code == 401
    c.post("/api/contas", json=MARIA)
    assert c.post("/api/leads", json={"via": "<script>"}).status_code == 400
    assert c.post("/api/leads", json=corpo).status_code == 200
    assert c.post("/api/leads", json={"via": "fin", "cidade": "Osório"}).status_code == 200
    assert c.post("/api/leads", json=dict(corpo, via="login")).status_code == 200
    assert c.get("/api/painel/leads").status_code == 401                      # visitante não lê
    assert cliente().get("/api/painel/leads").status_code == 401
    leads = painel.get("/api/painel/leads").json()["leads"]
    assert len(leads) == 1
    l = leads[0]
    assert l["nome"] == "Maria Silva" and l["wa"] == "(51) 99999-1234" and l["via"] == ["login", "fin"] and l["id"] == "casa1"
    assert l["imovel"] == '"Casa de 3 quartos" · R$ 850.000' and l["nm"] == "Casa de 3 quartos" and l["cidade"] == "Santo Antônio da Patrulha"
    assert isinstance(l["t"], int) and l["t"] > 1_700_000_000_000


def test_t16_estado_publico_de_outro_visitante_nao_mostra_contatos(painel, c):
    publicar(painel)
    c.post("/api/contas", json=MARIA)
    c.post("/api/leads", json={"via": "login"})
    outro = cliente().get("/api/estado").text
    assert "Maria" not in outro and "99999" not in outro


def test_t16_sair_do_visitante(c):
    c.post("/api/contas", json=MARIA)
    assert c.get("/api/estado").json()["conta"]["nome"] == "Maria Silva"
    assert c.post("/api/contas/sair", json={}).status_code == 200
    assert c.get("/api/estado").json()["conta"] is None and erv.q1("select count(*) as n from visitas")["n"] == 0
    assert erv.q1("select count(*) as n from contas")["n"] == 1        # sair não apaga os dados


def test_t16_limite_de_contas_por_ip(c):
    for n in range(20):
        assert cliente().post("/api/contas", json=dict(MARIA, whatsapp=f"519999912{n:02d}")).status_code == 200
    assert cliente().post("/api/contas", json=MARIA).status_code == 429
    assert "testclient" not in json.dumps(erv.q("select * from tentativas"), default=str)    # o IP não fica legível


def test_t17_chamadas_sem_ip_e_sem_dado_pessoal(painel, c):
    publicar(painel)
    c.post("/api/contas", json=MARIA)          # mesmo logado, a chamada não leva a pessoa junto
    corpo = {"id": "casa1", "nm": "Casa de 3 quartos", "o": '"Casa de 3 quartos" · R$ 850.000 · "Pedir mais informações"'}
    assert c.post("/api/chamadas", json=corpo).status_code == 200
    assert cliente().post("/api/chamadas", json=corpo).status_code == 200
    assert c.post("/api/chamadas", json=dict(corpo, id="nao-existe")).status_code == 400
    assert c.post("/api/chamadas", json={}).status_code == 400
    linhas = erv.q("select * from chamadas")
    assert len(linhas) == 2 and set(linhas[0]) == {"id", "imovel_id", "nm", "o", "cidade", "criado"}
    texto = json.dumps(linhas, default=str)
    assert "Maria" not in texto and "99999" not in texto and "testclient" not in texto
    assert c.get("/api/painel/chamadas").status_code == 401
    ch = painel.get("/api/painel/chamadas").json()["chamadas"]
    assert len(ch) == 2 and set(ch[0]) == {"t", "c", "id", "nm", "o"}
    assert ch[0]["c"] == "Santo Antônio da Patrulha" and ch[0]["id"] == "casa1" and ch[0]["o"] == corpo["o"] and ch[0]["t"] > 1_700_000_000_000


def test_t19_apagar_confirmando_o_nome(painel, c):
    publicar(painel)
    c.post("/api/contas", json=MARIA)
    c.post("/api/leads", json={"via": "login", "imovel_id": "casa1"})
    fora = cliente()        # outro aparelho, sem sessão
    assert fora.post("/api/privacidade/apagar", json={"whatsapp": "123", "nome": "x"}).status_code == 400
    nao_existe = fora.post("/api/privacidade/apagar", json={"whatsapp": "(51) 98888-0000", "nome": "Maria Silva"})
    nome_errado = fora.post("/api/privacidade/apagar", json={"whatsapp": "(51) 99999-1234", "nome": "João"})
    sem_nome = fora.post("/api/privacidade/apagar", json={"whatsapp": "(51) 99999-1234", "nome": ""})
    # quem não confirma o nome não descobre se o número existe: as três respostas são iguais
    assert nao_existe.status_code == nome_errado.status_code == sem_nome.status_code == 200
    assert nao_existe.json() == nome_errado.json() == sem_nome.json() == {"ok": True, "apagado": False, "confirmado": False}
    assert erv.q1("select count(*) as n from contas")["n"] == 1
    r = fora.post("/api/privacidade/apagar", json={"whatsapp": "51 99999 1234", "nome": "  maria SILVA "})
    assert r.status_code == 200 and r.json()["apagado"] is True and r.json()["confirmado"] is True
    for t in ("contas", "visitas", "leads", "aceites"):
        assert erv.q1(f"select count(*) as n from {t}")["n"] == 0, t
    assert painel.get("/api/painel/leads").json()["leads"] == []
    assert c.get("/api/estado").json()["conta"] is None              # a sessão antiga do visitante morreu junto
    assert c.get("/api/privacidade/meus-dados").status_code == 401


def test_t19_apagar_logado_no_aparelho_nao_precisa_do_nome(c):
    c.post("/api/contas", json=MARIA)
    r = c.post("/api/privacidade/apagar", json={"whatsapp": "(51) 99999-1234", "nome": ""})
    assert r.json()["apagado"] is True and erv.q1("select count(*) as n from contas")["n"] == 0
    assert "erv_v" not in c.cookies


def test_t19_limite_de_tentativas(c):
    c.post("/api/contas", json=MARIA)
    fora = cliente()
    for n in range(5):
        assert fora.post("/api/privacidade/apagar", json={"whatsapp": "(51) 99999-1234", "nome": f"chute {n}"}).status_code == 200
    r = fora.post("/api/privacidade/apagar", json={"whatsapp": "(51) 99999-1234", "nome": "Maria Silva"})
    assert r.status_code == 429 and erv.q1("select count(*) as n from contas")["n"] == 1


def test_t19_meus_dados(painel, c):
    publicar(painel)
    assert c.get("/api/privacidade/meus-dados").status_code == 401
    c.post("/api/contas", json=MARIA)
    c.post("/api/leads", json={"via": "login", "imovel_id": "casa1", "imovel": '"Casa" · R$ 850.000', "cidade": "Osório"})
    j = c.get("/api/privacidade/meus-dados").json()
    assert j["nome"] == "Maria Silva" and j["whatsapp"] == "(51) 99999-1234"
    assert j["aceites_do_aviso"][0]["versao"] == "v3" and j["aceites_do_aviso"][0]["data"]
    assert j["contatos"] == [{"imovel": '"Casa" · R$ 850.000', "cidade": "Osório", "por": ["login"], "data": j["contatos"][0]["data"],
                              "situacao_marcada_pelo_corretor": "novo"}]   # T43: a situação que o corretor marca aparece aqui


def test_t19_quem_entra_com_o_numero_de_outra_pessoa_nao_ve_o_historico(painel, c):
    publicar(painel)
    c.post("/api/contas", json=MARIA)
    c.post("/api/leads", json={"via": "login", "imovel_id": "casa1", "imovel": '"Casa" · R$ 850.000', "cidade": "Osório"})
    curioso = cliente()
    r = curioso.post("/api/contas", json=dict(MARIA, nome="Curioso"))
    assert r.status_code == 200 and r.json()["conta"]["nome"] == "Curioso"      # mesma resposta de uma conta nova
    j = curioso.get("/api/privacidade/meus-dados").json()
    assert "contatos" not in j and "aceites_do_aviso" not in j and "Osório" not in json.dumps(j, ensure_ascii=False) and "Maria" not in json.dumps(j)
