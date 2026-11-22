"""T04: página de Termos de uso do site (modelo, com os dados do Erivelto entre colchetes) e link no rodapé."""
import re

from conftest import RAIZ

TERMOS = (RAIZ / "site/termos/index.html").read_text()
CAMPOS = ["[CPF ou CNPJ do Erivelto]", "[endereço profissional]", "[comarca do foro]", "[e-mail de contato]"]


def test_t04_pagina_servida_sem_indexar(c):
    r = c.get("/termos/")
    assert r.status_code == 200 and r.text == TERMOS and "text/html" in r.headers["content-type"]
    assert "noindex" in r.headers["x-robots-tag"] and "frame-ancestors 'none'" in r.headers["content-security-policy"]
    r = c.get("/termos", follow_redirects=False)
    assert r.status_code == 308 and r.headers["location"] == "/termos/"


def test_t04_e_modelo_com_versao_secoes_e_campos_entre_colchetes():
    assert "modelo, sem revisão jurídica (pendente: T02)" in TERMOS.split("<html")[0]
    assert re.search(r'id="tu-versao" data-versao="v1">Versão v1 · \d+ de \w+ de 20\d\d<', TERMOS) and "Versão v1, de " in TERMOS
    for i in ("quem", "o-que-e", "imoveis", "simulacao", "entrar", "whatsapp", "uso", "conteudo", "funcionamento", "mudancas", "lei", "contato", "versao"):
        assert TERMOS.count(f'<h2 id="{i}">') == 1, i
    for trecho in ("Erivelto Santos", "CRECI 63.464", "Loud House", "estimativa", "Código de Defesa do Consumidor", 'href="/privacidade/"'):
        assert trecho in TERMOS, trecho
    # os campos que faltam são exatamente estes (PUBLICAR.md lista os mesmos); nenhum outro colchete no texto
    corpo = TERMOS.split("<body>")[1]
    assert sorted(set(re.findall(r"\[[^\]]+\]", corpo))) == sorted(CAMPOS)
    publicar = (RAIZ / "PUBLICAR.md").read_text()
    for campo in CAMPOS:
        assert campo in publicar, campo


def test_t04_pagina_nao_busca_nada_fora_e_nao_tem_script():
    assert "<script" not in TERMOS and "<img" not in TERMOS and "http://" not in TERMOS
    fora = [h for h in re.findall(r'(?:href|src)="([^"]+)"', TERMOS) if not h.startswith("/")]
    assert fora == ["https://s2maps.eu", "https://www.openstreetmap.org/copyright"]      # só os links de crédito dos mapas (abrem em outra aba)
    assert TERMOS.count('rel="noopener noreferrer"') == 2
    for href in re.findall(r'(?:href|src)="(/[^"]*)"', TERMOS):
        alvo = RAIZ / "site" / href.strip("/")
        assert alvo.is_file() or (alvo / "index.html").is_file() or href == "/", href


def test_t04_o_que_os_termos_dizem_bate_com_o_site():
    site = (RAIZ / "site/index.html").read_text()
    assert "sem seguros e tarifas" in TERMOS and "Simulação sem seguros e tarifas" in site
    assert "área aproximada" in TERMOS and "em área aproximada" in site
    # T06: os créditos completos dos mapas citam as mesmas fontes que o site mostra junto dos mapas
    for fonte in ("Sentinel-2 cloudless", "OpenStreetMap", "ESA WorldCover 2021", "Microsoft Building Footprints", "SRTM/NASA"):
        assert fonte in TERMOS and fonte in site, fonte
    assert "CC BY 4.0" in TERMOS and "ODbL" in TERMOS and "2016 e 2017" in TERMOS
