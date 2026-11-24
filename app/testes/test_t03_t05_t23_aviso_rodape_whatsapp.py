"""T03 (aviso de privacidade v3 coerente com o servidor), T05 (CRECI + link Privacidade) e T23 (WhatsApp sem número de teste).
Aqui fica o que dá para conferir sem navegador; o resto está no roteiro de navegador (testes/e2e/roteiro.py)."""
import re

from conftest import RAIZ, cliente, erv, publicar

AVISO = (RAIZ / "site/privacidade/index.html").read_text()
PONTE = (RAIZ / "site/ponte.js").read_text()
MARIA = {"nome": "Maria Silva", "whatsapp": "(51) 99999-1234", "aceite": True}


def test_t03_versao_v2_igual_em_todo_lugar():
    assert re.search(r'id="pv-versao" data-versao="v3">Versão v3 ', AVISO)
    assert re.search(r"var AVISO_VERSAO = 'v3';", PONTE) and "versao_aviso: AVISO_VERSAO" in PONTE and "'v1'" not in PONTE
    assert 'AVISO_VERSAO = E("ERV_AVISO_VERSAO", "v3")' in (RAIZ / "app/app.py").read_text()
    assert "\nERV_AVISO_VERSAO=v3\n" in (RAIZ / ".env.example").read_text()
    assert erv.AVISO_VERSAO == "v3"


def test_t03_servidor_so_aceita_a_versao_atual(c):
    r = c.post("/api/contas", json=dict(MARIA, versao_aviso="v1"))
    assert r.status_code == 400 and r.json() == {"erro": "aceite_obrigatorio", "versao": "v3"}
    assert c.post("/api/contas", json=dict(MARIA, versao_aviso="v3")).status_code == 200
    assert erv.q1("select versao from aceites")["versao"] == "v3"


def test_t03_pagina_tem_as_secoes_o_aviso_de_modelo_e_o_formulario(c):
    r = c.get("/privacidade/")
    assert r.status_code == 200 and re.sub(r"\?v=[0-9a-f]+", "", r.text) == AVISO
    assert "modelo, sem revisão jurídica (pendente: T02)" in AVISO.split("<html")[0]
    for i in ("quem", "dados", "base", "tempo", "quem-ve", "cookies", "seguranca", "direitos", "apagar", "mudancas", "versao"):
        assert f'<h2 id="{i}">' in AVISO, i
    for trecho in ("Erivelto Santos", "CRECI 63.464", "Controlador", "Operadora", "Loud House", "art. 7º", "art. 18", "Cloudflare", "ANPD"):
        assert trecho in AVISO, trecho
    # os ids que o privacidade.js usa
    js = (RAIZ / "site/privacidade/privacidade.js").read_text()
    usados = set(re.findall(r"getElementById\('([a-z-]+)'\)", js))
    assert {"pv-apagar", "pv-nome", "pv-wa", "pv-msg", "pv-ver", "pv-dados", "pv-wa-link"} <= usados
    for i in usados:
        assert AVISO.count(f'id="{i}"') == 1, i
    assert "termos" not in AVISO.lower()      # o aviso v3 não cita os Termos de uso (T04); se passar a citar, é texto novo: subir a versão


def test_t03_o_que_o_aviso_promete_e_o_que_o_servidor_faz():
    fonte = (RAIZ / "app/app.py").read_text()
    assert "por 180 dias" in AVISO and erv.VISITA_DIAS == 180
    assert "(12 horas)" in AVISO and erv.SESSAO_H == 12
    assert "registradas por 6 meses" in AVISO and "delete from acessos where criado < now() - interval '6 months'" in fonte
    assert "até você pedir para apagar" in AVISO and 'int(E("ERV_LEADS_MESES", "0"))' in fonte      # padrão: não apaga sozinho
    assert "depois de 14 dias" in AVISO and "-mtime +14 -delete" in (RAIZ / "backup.sh").read_text()
    assert "<b>erv_v:</b>" in AVISO and "<b>erv_p:</b>" in AVISO and (erv.COOKIE_V, erv.COOKIE_P) == ("erv_v", "erv_p")
    assert "cifrados" in AVISO and "nome_cif bytea" in fonte and "wa_cif bytea" in fonte
    # toque no WhatsApp: a tabela não tem coluna para IP, conta, nome da pessoa nem número
    colunas = {l["column_name"] for l in erv.q("select column_name from information_schema.columns where table_name = 'chamadas'")}
    assert colunas == {"id", "imovel_id", "nm", "o", "cidade", "criado"}
    # nada sai para terceiros pelo navegador: a página só fala com o próprio endereço
    assert "connect-src 'self'" in erv.CSP and "script-src 'self'" in erv.CSP


def test_t03_apagar_leva_tudo_que_o_aviso_diz(c, painel):
    publicar(painel)
    assert c.post("/api/contas", json=dict(MARIA, versao_aviso="v3")).status_code == 200
    assert c.post("/api/leads", json={"via": "login", "imovel_id": "casa1", "imovel": "Casa", "cidade": "Osório"}).status_code == 200
    r = cliente().post("/api/privacidade/apagar", json={"nome": "maria silva", "whatsapp": "51 99999 1234"})
    assert r.json()["apagado"] is True
    for tabela in ("contas", "visitas", "aceites", "leads"):
        assert erv.q1(f"select count(*) as n from {tabela}")["n"] == 0, tabela


def test_t05_rodape_com_creci_e_link_privacidade_no_ponte():
    assert "CRECI 63.464" in PONTE and "href: 'privacidade/', texto: 'Privacidade'" in PONTE and "id: 'pt-rodape'" in PONTE
    assert "href: 'termos/', texto: 'Termos'" in PONTE      # T04
    assert ".pt-rodape{" in (RAIZ / "site/ponte.css").read_text()


def test_t23_modo_servidor_nao_usa_numero_padrao(c, painel):
    # o número de teste só existe na definição do padrão da prévia; o caminho do modo servidor devolve '' sem número salvo
    assert PONTE.count("5551989498872") == 1 and PONTE.count("WA_PADRAO") == 2
    corpo = PONTE.split("P.waSite = function () {")[1].split("};")[0]
    assert re.search(r"if \(P\.srv\) \{[^}]*: '';\s*\}\s*return waLocal\(\) \|\| WA_PADRAO;", corpo)
    e = c.get("/api/estado").json()
    assert e["whatsapp"] is False and e["whatsapp_numero"] is None
    assert painel.put("/api/painel/whatsapp", json={"numero": "+55 (51) 99876-5432"}).status_code == 200
    e = c.get("/api/estado").json()
    assert e["whatsapp"] is True and e["whatsapp_numero"] == "5551998765432"
