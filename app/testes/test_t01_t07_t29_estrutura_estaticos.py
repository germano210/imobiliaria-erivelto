"""T01 estrutura · T07 esqueleto e cabeçalhos · T29 cache e Range."""
import subprocess

import yaml

from conftest import RAIZ, erv


def test_t01_estrutura_de_arquivos():
    for f in ("site/index.html", "site/ponte.js", "app/app.py", "app/requirements.txt", ".env.example", ".gitignore", "Dockerfile",
              "compose.teste.yaml", "backup.sh", "restaurar.sh"):
        assert (RAIZ / f).is_file(), f
    ignora = (RAIZ / ".gitignore").read_text().splitlines()
    for linha in ("dados/", "dados-teste/", ".env", "_to_delete/", "__pycache__/"):
        assert linha in ignora
    assert not any(l.strip().startswith("*.md") for l in ignora)
    docker = (RAIZ / "Dockerfile").read_text()
    assert "\nUSER erv" in docker and "8000" in docker


def test_t01_env_example_sem_valor_real_e_codigo_sem_segredo():
    for linha in (RAIZ / ".env.example").read_text().splitlines():
        if linha.startswith(("ERV_BANCO=", "ERV_CHAVE_DADOS=", "POSTGRES_PASSWORD=", "ERV_BACKUP_CHAVE=")):
            assert linha.endswith("="), linha
    fonte = (RAIZ / "app/app.py").read_text()
    assert "postgresql://erivelto:" not in fonte.replace("postgresql://erivelto:senha@", "") and "5551989498872" not in fonte


def test_t07_saude(c):
    r = c.get("/api/saude")
    assert r.status_code == 200 and r.json() == {"ok": True, "servico": "erivelto"}


def test_t07_paginas_e_cabecalhos(c):
    for url in ("/", "/painel/", "/privacidade/"):
        r = c.get(url)
        assert r.status_code == 200 and "text/html" in r.headers["content-type"], url
        assert r.headers["cache-control"] == "no-cache"
        csp = r.headers["content-security-policy"]
        # só a página inicial pode aparecer em moldura, e só do próprio site (aba "Site" do painel); o resto, nunca
        moldura, xfo = ("frame-ancestors 'self'", "SAMEORIGIN") if url == "/" else ("frame-ancestors 'none'", "DENY")
        assert "default-src 'self'" in csp and moldura in csp and "object-src 'none'" in csp
        assert r.headers["x-frame-options"] == xfo
        assert r.headers["x-content-type-options"] == "nosniff"
        assert r.headers["referrer-policy"] == "strict-origin-when-cross-origin"
        assert "noindex" in r.headers["x-robots-tag"]
        assert "strict-transport-security" not in r.headers   # teste roda sem HTTPS
    assert "__PAGINA='painel'" in c.get("/painel/").text
    for url in ("/painel", "/privacidade"):
        r = c.get(url, follow_redirects=False)
        assert r.status_code == 308 and r.headers["location"] == url + "/"


def test_t07_hsts_so_com_https_e_noindex_pela_variavel(c, monkeypatch):
    monkeypatch.setattr(erv, "HTTPS", True)
    monkeypatch.setattr(erv, "NOINDEX", False)
    r = c.get("/")
    assert "max-age=31536000" in r.headers["strict-transport-security"]
    assert "x-robots-tag" not in r.headers
    assert "noindex" in c.get("/painel/").headers["x-robots-tag"]      # painel, privacidade e API nunca indexam
    assert "noindex" in c.get("/api/saude").headers["x-robots-tag"]


def test_t07_nunca_serve_arquivo_sensivel(c, monkeypatch, tmp_path):
    # pior caso: ERV_SITE apontando para a raiz do projeto (como o nginx antigo fazia)
    for d in (".git", "app", "_to_delete", "dados", "site"):
        (tmp_path / d).mkdir()
    (tmp_path / ".git/config").write_text("x")
    (tmp_path / ".env").write_text("SEGREDO=1")
    (tmp_path / "app/app.py").write_text("x")
    (tmp_path / "app/a.js").write_text("x")
    (tmp_path / "_to_delete/a.html").write_text("x")
    (tmp_path / "dados/a.webp").write_text("x")
    (tmp_path / "compose.yaml").write_text("x")
    (tmp_path / "index.html").write_text("oi")
    monkeypatch.setattr(erv, "SITE", tmp_path)
    assert c.get("/").text == "oi"
    for url in ("/.git/config", "/.env", "/app/app.py", "/app/a.js", "/_to_delete/a.html", "/dados/a.webp", "/compose.yaml",
                "/%2e%2e/%2e%2e/etc/passwd", "/..%2f..%2fetc/passwd", "/site/../.env", "/APP/a.js"):
        assert c.get(url).status_code == 404, url


def test_t07_api_desconhecida_responde_json(c):
    r = c.get("/api/nao-existe")
    assert r.status_code == 404 and r.json()["erro"] == "nao_encontrado"
    assert c.get("/docs").status_code == 404 and c.get("/openapi.json").status_code == 404


def test_t29_cache_longo_para_midia_e_curto_para_codigo(c):
    for url in ("/t0/t0_1280.mp4", "/casa/fachada.jpg"):
        assert c.get(url).headers["cache-control"] == "public, max-age=31536000, immutable", url
    for url in ("/ponte.js", "/ponte.css", "/painel/c.js", "/fontes/fontes.css", "/privacidade/privacidade.js"):
        r = c.get(url)
        assert r.status_code == 200 and r.headers["cache-control"] == "no-cache", url
    assert c.get("/api/saude").headers["cache-control"] == "no-store"


def test_t29_etag_304(c):
    r = c.get("/ponte.js")
    r2 = c.get("/ponte.js", headers={"If-None-Match": r.headers["etag"]})
    assert r2.status_code == 304 and r2.content == b""


def test_t29_range_nos_videos(c):
    inteiro = (RAIZ / "site/t0/t0_1280.mp4").read_bytes()
    r = c.get("/t0/t0_1280.mp4", headers={"Range": "bytes=100-199"})
    assert r.status_code == 206 and r.content == inteiro[100:200]
    assert r.headers["content-range"] == f"bytes 100-199/{len(inteiro)}"
    assert c.get("/t0/t0_1280.mp4").headers.get("accept-ranges") == "bytes"


def test_compose_de_teste():
    novo = yaml.safe_load((RAIZ / "compose.teste.yaml").read_text())
    s = novo["services"]
    assert set(s) == {"erivelto", "banco", "tunel"}
    assert s["erivelto"]["ports"] == ["127.0.0.1:8090:8000"]
    # banco e fotos em volumes nomeados (pasta do Windows quebra o PGDATA; pasta criada pelo Docker no Linux nasce como root)
    assert s["banco"]["volumes"] == ["banco:/var/lib/postgresql/data"] and "fotos:/dados" in s["erivelto"]["volumes"]
    assert set(novo["volumes"]) == {"banco", "fotos"}
    assert not any(str(v).startswith(("./dados", "/")) for v in s["banco"]["volumes"] + s["erivelto"]["volumes"] if "site" not in str(v))
    texto = (RAIZ / "compose.teste.yaml").read_text()
    for trecho in ("up -d --build", "logs tunel", "python app.py usuario", "compose.teste.yaml down\n", "down -v"):
        assert trecho in texto, trecho
    docker = (RAIZ / "Dockerfile").read_text()
    assert "mkdir -p /dados/midia && chown -R erv /dados" in docker      # o volume de fotos herda este dono
    antigo = RAIZ / "compose.teste.yaml.antigo"
    if antigo.is_file():
        assert s["tunel"] == yaml.safe_load(antigo.read_text())["services"]["tunel"]
    assert "SÓ TESTE" in (RAIZ / "compose.teste.yaml").read_text()


def test_scripts_tem_sintaxe_valida():
    for f in ("backup.sh", "restaurar.sh"):
        assert subprocess.run(["bash", "-n", str(RAIZ / f)]).returncode == 0
