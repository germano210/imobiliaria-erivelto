"""Os testes rodam contra um PostgreSQL de verdade.

- Com ERV_TESTE_BANCO (postgresql://...), usam esse banco (ATENÇÃO: as tabelas são esvaziadas a cada teste).
- Sem ela, sobem um Postgres temporário (initdb + pg_ctl) numa pasta temporária do sistema e apagam no fim.
  Como root, o Postgres não sobe: aí o conftest usa o usuário "postgres" via runuser.
"""
import atexit, base64, glob, os, pathlib, shutil, socket, subprocess, sys, tempfile

import pytest

RAIZ = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "app"))
ORIGEM = "http://testserver"
H = {"X-Requested-With": "tlh", "Origin": ORIGEM}
PG = {}


def _bin(nome):
    achado = shutil.which(nome)
    if achado:
        return achado
    cand = sorted(glob.glob(f"/usr/lib/postgresql/*/bin/{nome}"))
    return cand[-1] if cand else None


def _subir_postgres():
    initdb, pg_ctl = _bin("initdb"), _bin("pg_ctl")
    if not initdb or not pg_ctl:
        pytest.exit("Sem PostgreSQL para os testes: instale o postgresql ou defina ERV_TESTE_BANCO.", returncode=3)
    pasta = tempfile.mkdtemp(prefix="erv-pg-")
    os.chmod(pasta, 0o755)
    pre = []
    if os.geteuid() == 0:
        shutil.chown(pasta, "postgres", "postgres")
        pre = ["runuser", "-u", "postgres", "--"]
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        porta = s.getsockname()[1]
    dados = os.path.join(pasta, "pg")
    r = lambda *a: subprocess.run(pre + list(a), check=True, capture_output=True, cwd=pasta)
    r(initdb, "-D", dados, "-A", "trust", "-U", "erv", "-E", "UTF8", "--locale=C")
    r(pg_ctl, "-D", dados, "-w", "-l", os.path.join(pasta, "log"), "-o", f"-p {porta} -c listen_addresses=127.0.0.1 -c unix_socket_directories={pasta} -c fsync=off", "start")

    def parar():
        subprocess.run(pre + [pg_ctl, "-D", dados, "-m", "immediate", "stop"], capture_output=True, cwd="/")
        shutil.rmtree(pasta, ignore_errors=True)
    atexit.register(parar)
    PG.update(host="127.0.0.1", porta=str(porta), usuario="erv", bin=os.path.dirname(pg_ctl))
    return f"postgresql://erv@127.0.0.1:{porta}/postgres"


BANCO = os.environ.get("ERV_TESTE_BANCO") or _subir_postgres()
(RAIZ / "dados-teste").mkdir(exist_ok=True)
DADOS = pathlib.Path(tempfile.mkdtemp(prefix="pytest-", dir=str(RAIZ / "dados-teste")))
atexit.register(lambda: shutil.rmtree(DADOS, ignore_errors=True))
os.environ.update(
    ERV_BANCO=BANCO, ERV_DADOS=str(DADOS), ERV_SITE=str(RAIZ / "site"), ERV_HTTPS="0", ERV_ORIGENS=ORIGEM, ERV_NOINDEX="1",
    ERV_CHAVE_DADOS=base64.b64encode(b"chave-so-dos-testes-0123456789ab").decode(), ERV_TUNEL_TESTE="0", ERV_PLANO="erivelto",
    ERV_LEADS_MESES="0", ERV_IP_CABECALHO="", ERV_WHATSAPP="", ERV_FOTO_LADO="2560", ERV_AVISO_VERSAO="v3", ERV_TERMO_VERSAO="v1")

import app as erv  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

TABELAS = "usuarios, sessoes, imoveis, fotos, contas, visitas, aceites, leads, chamadas, config, tentativas, acessos, termos"


@pytest.fixture(scope="session")
def servidor():
    with TestClient(erv.app):   # liga o app uma vez: abre o banco e migra
        yield erv


@pytest.fixture(autouse=True)
def limpo(servidor):
    erv.q(f"truncate {TABELAS} restart identity cascade")
    erv.q("update estado set rev = 1, mapa = null, mapa_pub = null, tipos = %s where id = 1", erv.J({t: True for t in erv.TIPOS}))
    for f in erv.MIDIA.glob("*"):
        f.unlink()
    yield


def cliente():
    """Um navegador novo (cookies próprios), já com os cabeçalhos que o ponte.js manda."""
    return TestClient(erv.app, headers=H)


@pytest.fixture
def c(servidor):
    return cliente()


def criar_usuario(email="corretor@exemplo.com", senha="senha-bem-comprida", temp=False, termo=True):
    """termo=True: já com o termo do painel aceito (T24), como um corretor que passou pelo 1º acesso."""
    uid = erv.q("insert into usuarios(email, nome, senha_hash, temp) values (%s, 'Corretor', %s, %s) returning id",
                email, erv.hash_senha(senha, n=10), temp)[0]["id"]
    if termo:
        erv.q("insert into termos(usuario_id, email, versao, ip) values (%s, %s, %s, 'teste')", uid, email, erv.TERMO_VERSAO)
    return email, senha


@pytest.fixture
def painel(servidor):
    """Navegador do corretor, já logado."""
    email, senha = criar_usuario()
    p = cliente()
    assert p.post("/api/painel/entrar", json={"email": email, "senha": senha}).status_code == 200
    return p


def imovel(iid="casa1", **extra):
    o = {"id": iid, "tipo": "casa", "cidade": "Santo Antônio da Patrulha", "preco": 850000, "fin": True,
         "infos": [{"i": "cama", "t": "3 (1 suíte)"}], "fotos": [{"s": "casa/fachada.jpg", "a": "Fachada", "d": False}],
         "fn": {"ent": 20, "prazos": [240, 360], "tab": "ambas", "bancos": []},
         "end": {"rua": "Rua das Flores", "num": "123", "bairro": "Centro"}, "nomes": {"rua": True, "num": True, "bairro": True},
         "loc": {"ll": [-50.5201, -29.8183]}, "mapa": "pino",
         "px": [{"t": "escola", "n": "Escola Santa Inês", "d": 350, "u": "m", "ll": [-50.52, -29.81]},
                {"t": "mercado", "n": "Mercado do Zé", "d": 1500, "u": "m"}]}
    o.update(extra)
    return o


def publicar(p, im=None):
    im = im or imovel()
    rev = p.get("/api/painel/estado").json()["rev"]
    assert p.put("/api/painel/estado", json={"rev": rev, "imoveis": [im]}).status_code == 200
    r = p.post(f"/api/painel/imoveis/{im['id']}/publicar", json={})
    assert r.status_code == 200, r.text
    return im


def jpeg(w=800, h=600, exif=False):
    import io
    from PIL import Image
    im = Image.new("RGB", (w, h), (120, 160, 90))
    b = io.BytesIO()
    if exif:
        e = Image.Exif()
        e[0x010F] = "CameraSecreta"                       # fabricante
        e[0x8825] = {1: "S", 2: (29.0, 49.0, 5.9), 3: "W", 4: (50.0, 31.0, 12.3)}   # GPS
        im.save(b, "JPEG", exif=e)
    else:
        im.save(b, "JPEG")
    return b.getvalue()
