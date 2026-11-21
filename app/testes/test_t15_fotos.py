"""T15 envio de fotos."""
import io

from PIL import Image

from conftest import cliente, erv, jpeg


def enviar(p, dados, tipo="image/jpeg"):
    return p.post("/api/painel/fotos", content=dados, headers={"Content-Type": tipo})


def test_t15_converte_para_webp_e_tira_exif_gps(painel, c):
    original = jpeg(800, 600, exif=True)
    assert b"CameraSecreta" in original and Image.open(io.BytesIO(original)).getexif().get_ifd(0x8825)
    r = enviar(painel, original)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["s"].startswith("midia/") and len(j["s"]) == len("midia/") + 32 + 5 and j["w"] == 800 and j["h"] == 600
    g = c.get("/" + j["s"])        # qualquer visitante vê a foto
    assert g.status_code == 200 and g.headers["content-type"] == "image/webp"
    assert g.headers["cache-control"] == "public, max-age=31536000, immutable" and g.headers["x-content-type-options"] == "nosniff"
    im = Image.open(io.BytesIO(g.content))
    assert im.format == "WEBP" and im.size == (800, 600)
    assert not im.getexif() and "exif" not in im.info and "xmp" not in im.info and "icc_profile" not in im.info
    assert b"CameraSecreta" not in g.content and b"Exif" not in g.content
    f = erv.q1("select * from fotos")
    assert "midia/" + f["arquivo"] == j["s"] and f["largura"] == 800 and f["bytes"] == len(g.content)
    assert enviar(painel, jpeg()).json()["s"] != j["s"]      # nome aleatório


def test_t15_reduz_para_o_lado_maximo_e_respeita_a_rotacao(painel, monkeypatch):
    monkeypatch.setattr(erv, "FOTO_LADO", 1600)
    j = enviar(painel, jpeg(2400, 1200)).json()
    assert (j["w"], j["h"]) == (1600, 800)
    assert enviar(painel, jpeg(640, 480)).json()["w"] == 640     # nunca amplia
    im = Image.new("RGB", (400, 200))
    e = Image.Exif()
    e[0x0112] = 6       # deitada no arquivo, em pé na tela
    b = io.BytesIO()
    im.save(b, "JPEG", exif=e)
    j = enviar(painel, b.getvalue()).json()
    assert (j["w"], j["h"]) == (200, 400)


def test_t15_png_com_transparencia_vira_fundo_branco(painel, c):
    b = io.BytesIO()
    Image.new("RGBA", (50, 50), (0, 0, 0, 0)).save(b, "PNG")
    j = enviar(painel, b.getvalue(), "image/png").json()
    im = Image.open(io.BytesIO(c.get("/" + j["s"]).content)).convert("RGB")
    assert im.getpixel((10, 10))[0] > 245


def test_t15_tipo_e_tamanho(painel):
    assert enviar(painel, b"<svg xmlns='http://www.w3.org/2000/svg'/>", "image/svg+xml").status_code == 415
    assert enviar(painel, b"isto nao e uma foto", "image/jpeg").status_code == 415
    assert enviar(painel, b"GIF89a" + b"\0" * 50, "image/jpeg").status_code == 415
    b = io.BytesIO()
    Image.new("RGB", (10, 10)).save(b, "GIF")
    assert enviar(painel, b.getvalue(), "image/png").status_code == 415      # GIF disfarçado de PNG
    assert enviar(painel, jpeg(), "application/octet-stream").status_code == 415
    assert enviar(painel, b"\xff\xd8" + b"0" * (3 * 2**20 + 10)).status_code == 413
    assert erv.q1("select count(*) as n from fotos")["n"] == 0 and not list(erv.MIDIA.glob("*"))


def test_t15_so_logado_envia_e_midia_nao_lista_nem_escapa(c, painel):
    assert enviar(c, jpeg()).status_code == 401
    for url in ("/midia/", "/midia/../app.py", "/midia/x.webp", "/midia/" + "a" * 32 + ".webp", "/midia/%2e%2e%2f%2e%2e%2fapp%2fapp.py"):
        assert c.get(url).status_code == 404, url


def test_t15_muitas_fotos_seguidas(painel, monkeypatch):
    u = erv.q1("select id from usuarios")["id"]
    erv.q("insert into tentativas(chave, n, ate) values (%s, 0, now() + interval '5 minutes')", erv.chave_lim("fotos", u))
    assert enviar(painel, jpeg()).status_code == 429
