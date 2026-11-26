r"""Erivelto Santos · site do corretor de imóveis

Um app serve tudo: o site (pasta site/), o painel (/painel/), o aviso de privacidade (/privacidade/), os termos de uso (/termos/) e a API (/api/...).
Banco PostgreSQL (ERV_BANCO) e fotos em ERV_DADOS/midia. O contrato da API é o site/ponte.js: o servidor se adapta a ele.

Rodar local:   cd app && ERV_HTTPS=0 ERV_ORIGENS=http://localhost:8000 uvicorn app:app --port 8000
Criar acesso:  python app.py usuario email@exemplo.com "Nome"   (mostra a senha temporária uma vez)
Senha nova:    python app.py senha email@exemplo.com             (gera outra senha temporária e derruba as sessões)
Trocar e-mail: python app.py email antigo@exemplo.com novo@exemplo.com
Listar:        python app.py usuarios                            (mostra também quem já aceitou o termo do painel)
Limpeza:       python app.py limpar                              (também roda sozinha 1 vez por dia)
Chave nova:    python app.py chave                               (valor para ERV_CHAVE_DADOS; não precisa de banco)
"""
import asyncio, base64, contextlib, copy, hashlib, hmac, io, json, os, pathlib, re, secrets, sys, time, unicodedata
from urllib.parse import urlsplit

from fastapi import Depends, FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, RedirectResponse, Response

E = lambda k, d=None: os.environ.get(k) or d  # variável vazia = padrão
BASE = pathlib.Path(__file__).resolve().parent
SITE = pathlib.Path(E("ERV_SITE", str(BASE.parent / "site"))).resolve()
DADOS = pathlib.Path(E("ERV_DADOS", str(BASE.parent / "dados"))).resolve()
MIDIA = DADOS / "midia"
BANCO = E("ERV_BANCO")                          # postgresql://usuario:senha@host:5432/banco (obrigatória)
# R87: e-mail provisório do acesso do Erivelto -> e-mail dele (John 26/11)
TROCA_EMAIL_PARA = "eriveltosantoscorretor@gmail.com"
TROCA_EMAIL_DE = ["erivelto@gmail.com"]
CHAVE_DADOS = E("ERV_CHAVE_DADOS")              # 32 bytes em base64 (obrigatória): python app.py chave
HTTPS = E("ERV_HTTPS", "1") == "1"              # 0 só em teste local sem https (HSTS e cookie Secure)
NOINDEX = E("ERV_NOINDEX", "1") == "1"          # 1 = pede aos buscadores para não indexar nada
ORIGENS = {o.strip().rstrip("/").lower() for o in E("ERV_ORIGENS", "").split(",") if o.strip()}
TUNEL_TESTE = E("ERV_TUNEL_TESTE", "0") == "1"  # compose.yaml (teste): aceita o link aleatório *.trycloudflare.com
IP_CABECALHO = E("ERV_IP_CABECALHO", "")        # ex.: CF-Connecting-IP quando só o cloudflared fala com o app
PLANO = E("ERV_PLANO", "erivelto")              # basico | fasico | erivelto (os mesmos nomes do painel)
AVISO_VERSAO = E("ERV_AVISO_VERSAO", "v3")      # versão do aviso de privacidade que o visitante aceita (site/privacidade)
TERMO_VERSAO = E("ERV_TERMO_VERSAO", "v1")      # versão do termo que o corretor aceita no 1º acesso (site/painel/termo.html)
LEADS_MESES = int(E("ERV_LEADS_MESES", "0"))    # 0 = contatos ficam até a pessoa pedir para apagar
FOTO_LADO = int(E("ERV_FOTO_LADO", "2560"))     # lado maior da foto guardada (o ponte.js envia até 2560 px)
WHATSAPP_INICIAL = E("ERV_WHATSAPP", "")        # número do site enquanto o corretor não salvar outro no painel

SESSAO_H = 12                   # sessão do painel
VISITA_DIAS = 180               # sessão do visitante (cookie)
SENHA_MIN = 10
FOTO_MAX = 3 * 2**20            # o ponte.js nunca envia mais de 2,9 MB
ESTADO_MAX = 2 * 2**20
IMOVEL_MAX = 200 * 1024
COOKIE_P, COOKIE_V = "erv_p", "erv_v"
TIPOS = ("casa", "sobrado", "apartamento", "terreno", "sitio", "sala", "galpao")   # T41: sobrado, sítio/chácara, sala comercial, galpão
SITUACOES_IMOVEL = ("disp", "res", "vend")    # T39: disponível, reservado, vendido
FINALIDADES = ("venda", "aluguel")             # T40
PERIODOS_ALUGUEL = ("dia", "mes", "ano")        # aluguel: como o site mostra o valor (o guardado é sempre o do mês)
SITUACOES_LEAD = ("novo", "falei", "visita", "proposta", "fechado", "perdido")   # T43
RE_COD = re.compile(r"ES-\d{3,5}")             # T42: código do imóvel
PLANOS = {"basico": {"cid": 3, "im": 3}, "fasico": {"cid": 20, "im": 10}, "erivelto": {"cid": None, "im": None}}
RE_ID = re.compile(r"[A-Za-z0-9_-]{1,40}")
RE_FOTO = re.compile(r"(?!api/)(?!.*\.\.)(?!.*//)[A-Za-z0-9_][A-Za-z0-9_./-]{0,150}\.(?:webp|jpe?g|png|avif)")
RE_MIDIA = re.compile(r"[a-f0-9]{32}\.webp")
RE_WA_SITE = re.compile(r"55[1-9][1-9]9\d{8}")          # igual ao RE_WA do ponte.js
RE_EMAIL = re.compile(r"[^@\s]{1,64}@[^@\s]{1,180}\.[^@\s]{2,}")
RE_TUNEL = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")
RE_VIA = re.compile(r"[a-z0-9_]{1,24}")
CSP = ("default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
       "img-src 'self' data: blob: https://*.arcgis.com https://*.arcgisonline.com; media-src 'self' blob:; font-src 'self' data:; "
       "connect-src 'self' https://*.arcgis.com https://*.arcgisonline.com; "
       "worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'")
# a página inicial pode aparecer dentro do painel (aba "Site", mesmo endereço); em outro site, nunca
CSP_INICIO = CSP.replace("frame-ancestors 'none'", "frame-ancestors 'self'")
# as páginas atuais têm script e estilo inline (site minificado num arquivo só): por isso 'unsafe-inline'
EXT_LONGO = {".webp", ".jpg", ".jpeg", ".png", ".avif", ".gif", ".svg", ".ico", ".mp4", ".webm", ".woff2", ".woff"}
EXT_CURTO = {".html", ".js", ".css", ".json", ".txt", ".xml", ".webmanifest"}
PASTAS_PROIBIDAS = {"app", "dados", "dados-teste", "_to_delete", "node_modules"}
CACHE_LONGO = "public, max-age=31536000, immutable"


class Erro(Exception):
    def __init__(self, status, **j):
        self.status, self.j = status, j


# ---------------- banco (T08) ----------------
POOL = None
ESQUEMA = """
create table if not exists usuarios(
  id serial primary key, email text unique not null, nome text not null default '', senha_hash text not null,
  temp boolean not null default true,                    -- senha temporária: obriga trocar na 1ª entrada
  criado timestamptz not null default now());
create table if not exists sessoes(
  hash text primary key,                                 -- sha256 do token; o token só existe no cookie
  usuario_id integer not null references usuarios(id) on delete cascade,
  criado timestamptz not null default now(), expira timestamptz not null);
create table if not exists estado(
  id integer primary key check(id = 1), rev bigint not null default 1,
  tipos jsonb not null, mapa jsonb, mapa_pub jsonb, atualizado timestamptz not null default now());
create table if not exists imoveis(
  id text primary key, ordem serial, rascunho jsonb not null, publicado jsonb,
  criado timestamptz not null default now(), atualizado timestamptz not null default now(), publicado_em timestamptz);
create table if not exists fotos(
  id serial primary key, arquivo text unique not null, bytes integer not null, largura integer not null, altura integer not null,
  por integer references usuarios(id) on delete set null, criado timestamptz not null default now());
create table if not exists contas(
  id serial primary key, wa_hmac text unique not null,   -- HMAC do número normalizado: acha a conta sem abrir a cifra
  nome_cif bytea not null, wa_cif bytea not null,        -- AES-256-GCM com ERV_CHAVE_DADOS
  criado timestamptz not null default now(), atualizado timestamptz not null default now());
create table if not exists visitas(
  hash text primary key, conta_id integer not null references contas(id) on delete cascade,
  historico boolean not null default false,              -- só vê o histórico quem entrou com o mesmo nome da conta
  criado timestamptz not null default now(), expira timestamptz not null);
create table if not exists aceites(
  id serial primary key, conta_id integer not null references contas(id) on delete cascade,
  versao text not null, criado timestamptz not null default now());
create table if not exists leads(
  id serial primary key, conta_id integer unique not null references contas(id) on delete cascade,
  via jsonb not null default '[]', imovel_id text, imovel text, cidade text,
  criado timestamptz not null default now(), atualizado timestamptz not null default now());
create table if not exists chamadas(
  id serial primary key, imovel_id text not null, nm text, o text, cidade text,
  criado timestamptz not null default now());            -- anônimo: sem IP, sem conta, sem nome
create table if not exists config(chave text primary key, valor text not null, atualizado timestamptz not null default now());
create table if not exists tentativas(
  chave text primary key,                                -- HMAC de (tipo, e-mail ou IP): o IP não fica legível aqui
  n integer not null, inicio timestamptz not null default now(), ate timestamptz);
create table if not exists acessos(
  id serial primary key, usuario_id integer references usuarios(id) on delete set null, email text, ip text,
  acao text not null, criado timestamptz not null default now());   -- registro de acesso ao painel: guardar 6 meses
create table if not exists termos(
  id serial primary key, usuario_id integer references usuarios(id) on delete set null, email text not null,
  versao text not null, ip text, criado timestamptz not null default now());   -- T24: aceite do termo do painel (fica guardado)
create index if not exists ix_termos_usuario on termos(usuario_id, versao);
alter table leads add column if not exists situacao text not null default 'novo';   -- T43: em que pé está (o corretor marca)
alter table leads add column if not exists nota text;                               -- T43: anotação curta do corretor
alter table leads add column if not exists pedido text;                             -- T44: dia e período da visita pedida
alter table leads add column if not exists vender jsonb;                            -- T45: {tipo, cidade, obs} de quem quer vender
create index if not exists ix_sessoes_expira on sessoes(expira);
create index if not exists ix_visitas_expira on visitas(expira);
create index if not exists ix_acessos_criado on acessos(criado);
create index if not exists ix_chamadas_criado on chamadas(criado);
create table if not exists aberturas(
  dia date not null, imovel_id text not null default '', n integer not null default 0,
  primary key (dia, imovel_id));                       -- R86: contador do Desempenho. Só soma por dia e imóvel ('' = o site): sem IP, sem conta, sem cookie
"""


def abrir():
    """Abre o banco (espera ele subir) e aplica a migração. Chamado ao subir o app e pelos comandos."""
    global POOL
    if POOL is not None:
        return
    if not BANCO:
        sys.exit("Falta ERV_BANCO (ex.: postgresql://erivelto:senha@banco:5432/erivelto). Veja o .env.example.")
    chaves()
    from psycopg.rows import dict_row
    from psycopg_pool import ConnectionPool
    p = ConnectionPool(BANCO, min_size=1, max_size=10, open=False, kwargs={"row_factory": dict_row})
    p.open(wait=True, timeout=90)
    POOL = p
    try:   # a pasta das fotos precisa ser gravável pelo usuário do container (1000); criada pelo Docker, ela nasce do root
        MIDIA.mkdir(parents=True, exist_ok=True)
        (MIDIA / ".gravavel").touch(); (MIDIA / ".gravavel").unlink()
    except PermissionError:
        sys.exit(f"Sem permissão para gravar as fotos em {MIDIA}. No servidor, na pasta do projeto: "
                 "sudo mkdir -p dados/midia && sudo chown -R 1000:1000 dados  (depois: docker compose ... restart erivelto)")
    migrar()


def fechar():
    global POOL
    if POOL is not None:
        POOL.close()
        POOL = None


def migrar():
    """Idempotente: pode rodar a cada subida. A trava evita duas subidas criando tabela ao mesmo tempo."""
    from psycopg.types.json import Jsonb
    with POOL.connection() as c:
        c.execute("select pg_advisory_xact_lock(7313401)")
        c.execute(ESQUEMA)
        c.execute("insert into estado(id, tipos) values (1, %s) on conflict (id) do nothing",
                  (Jsonb({t: True for t in TIPOS}),))
        # T42: imóveis antigos sem código ganham um (no rascunho e no publicado, para não aparecer "mudança não publicada")
        usados = {r["cod"] for r in c.execute("select rascunho->>'cod' as cod from imoveis").fetchall() if r["cod"]}
        n = max([int(x[3:]) for x in usados if RE_COD.fullmatch(x)] or [0])
        for r in c.execute("select id from imoveis where coalesce(rascunho->>'cod', '') !~ '^ES-[0-9]{3,5}$' order by ordem").fetchall():
            n += 1
            cod = f"ES-{n:03d}"
            c.execute("""update imoveis set rascunho = jsonb_set(rascunho, '{cod}', to_jsonb(%s::text)),
                         publicado = case when publicado is null then null else jsonb_set(publicado, '{cod}', to_jsonb(%s::text)) end
                         where id = %s""", (cod, cod, r["id"]))
        # R87 (John 26/11): o acesso do Erivelto foi criado com um e-mail provisório. Na subida, passa para o e-mail
        # dele, só se o novo ainda não existe. A senha e as sessões continuam as mesmas (ele troca a senha no painel › Perfil).
        for velho in TROCA_EMAIL_DE:
            if not c.execute("select 1 from usuarios where email = %s", (TROCA_EMAIL_PARA,)).fetchone():
                c.execute("update usuarios set email = %s where email = %s", (TROCA_EMAIL_PARA, velho))


def q(sql, *a):
    with POOL.connection() as c:
        cur = c.execute(sql, a)
        return cur.fetchall() if cur.description else []


def q1(sql, *a):
    r = q(sql, *a)
    return r[0] if r else None


def J(v):
    from psycopg.types.json import Jsonb
    return Jsonb(v)


# ---------------- cifra dos contatos (T16) ----------------
_CH = None


def chaves():
    """Três subchaves da ERV_CHAVE_DADOS: cifra (AES-GCM), índice (HMAC do WhatsApp) e limite (chaves de tentativas)."""
    global _CH
    if _CH is None:
        try:
            bruta = base64.b64decode(CHAVE_DADOS or "", validate=True)
        except Exception:
            bruta = b""
        if len(bruta) != 32:
            sys.exit("Falta ERV_CHAVE_DADOS (32 bytes em base64). Gere com: python app.py chave")
        d = lambda r: hmac.new(bruta, r, hashlib.sha256).digest()
        _CH = {"cifra": d(b"erv/cifra/v1"), "indice": d(b"erv/indice/v1"), "limite": d(b"erv/limite/v1")}
    return _CH


def cifrar(texto, campo):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    n = secrets.token_bytes(12)
    return n + AESGCM(chaves()["cifra"]).encrypt(n, texto.encode(), campo.encode())


def decifrar(dado, campo):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    dado = bytes(dado)
    return AESGCM(chaves()["cifra"]).decrypt(dado[:12], dado[12:], campo.encode()).decode()


def indice_wa(numero):
    return hmac.new(chaves()["indice"], numero.encode(), hashlib.sha256).hexdigest()


def wa_visitante(v):
    """WhatsApp do visitante -> '55' + DDD + número (10 ou 11 dígitos), ou None."""
    d = re.sub(r"\D", "", str(v or ""))[:20]
    if len(d) in (12, 13) and d.startswith("55"):
        d = d[2:]
    if len(d) not in (10, 11) or d[0] == "0" or d[1] == "0" or (len(d) == 11 and d[2] != "9"):
        return None
    return "55" + d


def wa_bonito(n):
    d = n[2:]
    return f"({d[:2]}) {d[2:-4]}-{d[-4:]}"


def nome_limpo(v):
    return re.sub(r"\s+", " ", "".join(ch for ch in str(v or "") if ch.isprintable())).strip()


def nome_chave(v):
    s = unicodedata.normalize("NFKD", nome_limpo(v))
    return "".join(ch for ch in s if not unicodedata.combining(ch)).casefold()


# ---------------- senhas (T09) ----------------
def hash_senha(senha, n=15):
    sal = secrets.token_bytes(16)
    h = hashlib.scrypt(senha.encode(), salt=sal, n=2**n, r=8, p=1, maxmem=2**27, dklen=32)
    return f"scrypt${n}$8$1${base64.b64encode(sal).decode()}${base64.b64encode(h).decode()}"


def confere_senha(senha, guardado):
    try:
        _, n, r, p, sal, h = guardado.split("$")
        h = base64.b64decode(h)
        t = hashlib.scrypt(senha.encode(), salt=base64.b64decode(sal), n=2**int(n), r=int(r), p=int(p), maxmem=2**27, dklen=len(h))
        return hmac.compare_digest(t, h)
    except Exception:
        return False


HASH_FALSO = hash_senha(secrets.token_urlsafe(16))  # gasta o mesmo tempo quando o e-mail não existe


def hash_token(t):
    return hashlib.sha256(t.encode()).hexdigest()


# ---------------- limite de tentativas ----------------
def chave_lim(tipo, valor):
    return hmac.new(chaves()["limite"], f"{tipo}:{valor}".encode(), hashlib.sha256).hexdigest()


def bloqueio(chave):
    """Segundos que faltam para a chave poder tentar de novo (0 = liberada)."""
    r = q1("select greatest(0, ceil(extract(epoch from ate - now())))::int as s from tentativas where chave=%s and ate > now()", chave)
    return r["s"] if r else 0


def falha(chave, maximo, janela, castigo):
    """Conta uma tentativa; na de número `maximo` dentro da `janela` (s), bloqueia por `castigo` (s)."""
    q("""insert into tentativas(chave, n, inicio) values (%s, 1, now())
         on conflict (chave) do update set
           n = case when tentativas.inicio < now() - make_interval(secs => %s) then 1 else tentativas.n + 1 end,
           inicio = case when tentativas.inicio < now() - make_interval(secs => %s) then now() else tentativas.inicio end""",
      chave, janela, janela)
    q("update tentativas set ate = now() + make_interval(secs => %s), n = 0, inicio = now() where chave=%s and n >= %s", castigo, chave, maximo)


def gasta(chave, maximo, janela):
    """Limite de uso: devolve 0 se pode, ou os segundos de espera."""
    s = bloqueio(chave)
    if s:
        return s
    falha(chave, maximo + 1, janela, janela)
    return bloqueio(chave)


def zera(chave):
    q("delete from tentativas where chave=%s", chave)


# ---------------- app, cabeçalhos e origem (T07, T12) ----------------
def limpar():
    """T20: apaga o que venceu. Contatos (leads) só saem se ERV_LEADS_MESES > 0."""
    r = {}
    with POOL.connection() as c:
        if not c.execute("select pg_try_advisory_xact_lock(7313402) as ok").fetchone()["ok"]:
            return {"ocupado": True}
        n = lambda sql, *a: c.execute(sql, a).rowcount
        r["sessoes"] = n("delete from sessoes where expira < now()")
        r["visitas"] = n("delete from visitas where expira < now()")
        r["tentativas"] = n("delete from tentativas where coalesce(ate, inicio) < now() - interval '1 day'")
        r["acessos"] = n("delete from acessos where criado < now() - interval '6 months'")
        r["contatos"] = 0
        if LEADS_MESES > 0:
            r["contatos"] = n("delete from contas where atualizado < now() - make_interval(months => %s)", LEADS_MESES)
        # fotos enviadas há mais de 7 dias que nenhum imóvel usa (rascunho ou publicado)
        usados = json.dumps([[i["rascunho"], i["publicado"]] for i in c.execute("select rascunho, publicado from imoveis").fetchall()])
        r["fotos"] = 0
        for f in c.execute("select id, arquivo from fotos where criado < now() - interval '7 days'").fetchall():
            if f["arquivo"] not in usados:
                c.execute("delete from fotos where id=%s", (f["id"],))
                with contextlib.suppress(OSError):
                    (MIDIA / f["arquivo"]).unlink()
                r["fotos"] += 1
    return r


async def _limpeza_diaria():
    while True:
        try:
            await run_in_threadpool(limpar)
        except Exception as e:  # nunca derruba o app
            print("limpeza falhou:", type(e).__name__, file=sys.stderr)
        await asyncio.sleep(24 * 3600)


@contextlib.asynccontextmanager
async def vida(_app):
    await run_in_threadpool(abrir)
    tarefa = asyncio.create_task(_limpeza_diaria())
    yield
    tarefa.cancel()
    await run_in_threadpool(fechar)


app = FastAPI(title="Erivelto", docs_url=None, redoc_url=None, openapi_url=None, lifespan=vida)


def ip_de(request):
    if IP_CABECALHO:
        v = request.headers.get(IP_CABECALHO)
        if v:
            return v.split(",")[0].strip()[:45]
    return request.client.host if request.client else ""


def origem_ok(request):
    o = request.headers.get("origin")
    if not o or o == "null":
        ref = request.headers.get("referer")
        if not ref:
            return False
        p = urlsplit(ref)
        o = f"{p.scheme}://{p.netloc}"
    o = o.rstrip("/").lower()
    return o in ORIGENS or bool(TUNEL_TESTE and RE_TUNEL.fullmatch(o))


def cabecalhos(request, resp):
    h, caminho = resp.headers, request.url.path
    inicio = caminho in ("/", "/index.html")
    h.setdefault("Content-Security-Policy", CSP_INICIO if inicio else CSP)
    h.setdefault("X-Content-Type-Options", "nosniff")
    h.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    h.setdefault("X-Frame-Options", "SAMEORIGIN" if inicio else "DENY")
    if HTTPS:
        h.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    if NOINDEX or caminho.startswith(("/api/", "/painel", "/privacidade", "/termos", "/midia/")):
        h.setdefault("X-Robots-Tag", "noindex, nofollow")
    if caminho.startswith("/api/"):
        h["Cache-Control"] = "no-store"
    return resp


@app.middleware("http")
async def guarda(request, call_next):
    if request.url.path.startswith("/api/") and request.method not in ("GET", "HEAD"):
        if request.headers.get("x-requested-with") != "tlh" or not origem_ok(request):
            return cabecalhos(request, JSONResponse({"erro": "origem"}, 403))
    return cabecalhos(request, await call_next(request))


@app.exception_handler(Erro)
async def _erro(request, e):
    return JSONResponse(e.j, e.status)


def Corpo(limite=16 * 1024):
    async def ler(request: Request):
        try:
            if int(request.headers.get("content-length") or 0) > limite:
                raise Erro(413, erro="grande_demais")
        except ValueError:
            raise Erro(400, erro="invalido")
        dados = b""
        async for parte in request.stream():
            dados += parte
            if len(dados) > limite:
                raise Erro(413, erro="grande_demais")
        try:
            j = json.loads(dados or b"{}")
        except Exception:
            raise Erro(400, erro="invalido")
        if not isinstance(j, dict):
            raise Erro(400, erro="invalido")
        return j
    return ler


def cookie(resp, nome, valor, segundos):
    if valor is None:
        resp.delete_cookie(nome, path="/", httponly=True, secure=HTTPS, samesite="lax")
    else:
        resp.set_cookie(nome, valor, max_age=segundos, path="/", httponly=True, secure=HTTPS, samesite="lax")
    return resp


def registrar(acao, request, email=None, usuario_id=None):
    q("insert into acessos(usuario_id, email, ip, acao) values (%s, %s, %s, %s)", usuario_id, (email or "")[:200], ip_de(request), acao)


# ---------------- painel: entrar, sair, sessão, senha (T10, T11) ----------------
def admin_de(request):
    t = request.cookies.get(COOKIE_P)
    if not t:
        return None
    return q1("""select u.id, u.email, u.nome, u.temp, u.senha_hash, s.hash,
                   exists(select 1 from termos t where t.usuario_id = u.id and t.versao = %s) as termo
                 from sessoes s join usuarios u on u.id = s.usuario_id
                 where s.hash=%s and s.expira > now()""", TERMO_VERSAO, hash_token(t))


def logado(request: Request):
    """Qualquer sessão válida do painel (inclusive com senha temporária)."""
    u = admin_de(request)
    if not u:
        raise Erro(401, erro="sem_sessao")
    return u


def sem_temp(request: Request):
    """Sessão válida e senha definitiva: com senha temporária só dá para trocar a senha."""
    u = logado(request)
    if u["temp"]:
        raise Erro(403, erro="trocar_senha")
    return u


def admin(request: Request):
    """Senha definitiva e termo do painel aceito na versão atual (T24). Sem o aceite, o ponte.js mostra a tela do termo."""
    u = sem_temp(request)
    if not u["termo"]:
        raise Erro(403, erro="aceitar_termo", versao=TERMO_VERSAO)
    return u


def nova_sessao(usuario_id):
    t = secrets.token_urlsafe(32)
    q("insert into sessoes(hash, usuario_id, expira) values (%s, %s, now() + make_interval(hours => %s))", hash_token(t), usuario_id, SESSAO_H)
    return t


@app.get("/api/saude")
def saude():
    return {"ok": True, "servico": "erivelto"}


@app.post("/api/painel/entrar")
def painel_entrar(request: Request, corpo: dict = Depends(Corpo())):
    email = str(corpo.get("email") or "").strip().lower()[:200]
    senha = str(corpo.get("senha") or "")[:500]
    k_email, k_ip = chave_lim("login-email", email), chave_lim("login-ip", ip_de(request))
    espera = max(bloqueio(k_email), bloqueio(k_ip))
    if espera:
        raise Erro(429, erro="muitas_tentativas", espera=espera)
    u = q1("select * from usuarios where email=%s", email)
    certo = confere_senha(senha, u["senha_hash"] if u else HASH_FALSO)
    if not (u and certo):
        falha(k_email, 5, 900, 900)       # 5 erros no mesmo e-mail (exista ou não) = 15 min
        falha(k_ip, 30, 900, 900)
        registrar("login_falhou", request, email)
        raise Erro(401, erro="credenciais")  # uma resposta só para e-mail errado e senha errada
    zera(k_email)
    velho = request.cookies.get(COOKIE_P)
    if velho:
        q("delete from sessoes where hash=%s", hash_token(velho))
    q("delete from sessoes where usuario_id=%s and expira < now()", u["id"])
    t = nova_sessao(u["id"])              # id novo a cada login
    registrar("login", request, email, u["id"])
    return cookie(JSONResponse({"ok": True, "email": u["email"], "nome": u["nome"], "trocar": u["temp"]}), COOKIE_P, t, SESSAO_H * 3600)


# ---------------- painel: termo do 1º acesso (T24) ----------------
@app.get("/api/painel/termo")
def painel_termo(u=Depends(logado)):
    a = q1("select versao, criado from termos where usuario_id=%s and versao=%s order by id limit 1", u["id"], TERMO_VERSAO)
    return {"versao": TERMO_VERSAO, "aceito": bool(a), "em": a["criado"].isoformat(timespec="seconds") if a else None}


@app.post("/api/painel/termo/aceitar")
def painel_termo_aceitar(request: Request, corpo: dict = Depends(Corpo()), u=Depends(sem_temp)):
    """Guarda quem aceitou, qual versão, quando e de qual IP. A versão vem da tela: aceitar um texto antigo não vale."""
    if corpo.get("aceite") is not True or corpo.get("versao") != TERMO_VERSAO:
        raise Erro(400, erro="versao_termo", versao=TERMO_VERSAO)
    if not u["termo"]:
        q("insert into termos(usuario_id, email, versao, ip) values (%s, %s, %s, %s)", u["id"], u["email"], TERMO_VERSAO, ip_de(request))
        registrar("termo_aceito", request, u["email"], u["id"])
    return {"ok": True, "versao": TERMO_VERSAO}


@app.post("/api/painel/sair")
def painel_sair(request: Request):
    t = request.cookies.get(COOKIE_P)
    if t:
        q("delete from sessoes where hash=%s", hash_token(t))
    return cookie(JSONResponse({"ok": True}), COOKIE_P, None, 0)


@app.get("/api/painel/sessao")
def painel_sessao(request: Request):
    u = admin_de(request)
    if not u:
        return {"logado": False}
    return {"logado": True, "email": u["email"], "nome": u["nome"], "trocar": u["temp"], "termo": u["termo"]}


@app.post("/api/painel/senha")
def painel_senha(request: Request, corpo: dict = Depends(Corpo()), u=Depends(logado)):
    atual, nova = str(corpo.get("atual") or "")[:500], str(corpo.get("nova") or "")
    k = chave_lim("senha", u["id"])
    if bloqueio(k):
        raise Erro(429, erro="muitas_tentativas", espera=bloqueio(k))
    if not confere_senha(atual, u["senha_hash"]):
        falha(k, 5, 900, 900)
        registrar("senha_falhou", request, u["email"], u["id"])
        raise Erro(403, erro="senha_atual")
    if len(nova) < SENHA_MIN or len(nova) > 200 or nova == atual or nova.lower() == u["email"]:
        raise Erro(400, erro="senha_fraca", minimo=SENHA_MIN)
    zera(k)
    q("update usuarios set senha_hash=%s, temp=false where id=%s", hash_senha(nova), u["id"])
    q("delete from sessoes where usuario_id=%s", u["id"])   # derruba todas, inclusive em outros aparelhos
    t = nova_sessao(u["id"])                                 # e este aparelho ganha uma sessão nova
    registrar("senha_trocada", request, u["email"], u["id"])
    return cookie(JSONResponse({"ok": True}), COOKIE_P, t, SESSAO_H * 3600)


@app.put("/api/painel/email")
def painel_email(request: Request, corpo: dict = Depends(Corpo()), u=Depends(admin)):
    """Trocar o e-mail de login. O ponte.js atual não tem tela para isto: a rota fica pronta."""
    novo = str(corpo.get("email") or "").strip().lower()
    k = chave_lim("senha", u["id"])
    if bloqueio(k):
        raise Erro(429, erro="muitas_tentativas", espera=bloqueio(k))
    if not confere_senha(str(corpo.get("senha") or "")[:500], u["senha_hash"]):
        falha(k, 5, 900, 900)
        raise Erro(403, erro="senha_atual")
    if len(novo) > 200 or not RE_EMAIL.fullmatch(novo):
        raise Erro(400, erro="invalido", campo="email")
    if q1("select 1 as x from usuarios where email=%s and id<>%s", novo, u["id"]):
        raise Erro(409, erro="email_em_uso")
    q("update usuarios set email=%s where id=%s", novo, u["id"])
    q("delete from sessoes where usuario_id=%s and hash<>%s", u["id"], u["hash"])
    registrar("email_trocado", request, novo, u["id"])
    return {"ok": True, "email": novo}


# ---------------- painel: estado e imóveis (T13) ----------------
def limite_plano(qual):
    return PLANOS.get(PLANO, PLANOS["erivelto"])[qual]


def whatsapp_numero():
    r = q1("select valor from config where chave='whatsapp'")
    n = r["valor"] if r else WHATSAPP_INICIAL
    return n if RE_WA_SITE.fullmatch(n or "") else None


def campo_errado(o):
    """Confere um imóvel como o painel manda. Devolve o nome do campo com problema, ou None."""
    if not isinstance(o, dict) or not isinstance(o.get("id"), str) or not RE_ID.fullmatch(o["id"]):
        return "id"
    if len(json.dumps(o)) > IMOVEL_MAX:
        return "tamanho"
    if o.get("tipo") not in TIPOS:
        return "tipo"
    if not isinstance(o.get("cidade", ""), str) or len(o.get("cidade", "")) > 80:
        return "cidade"
    p = o.get("preco", 0)
    if isinstance(p, bool) or not isinstance(p, (int, float)) or not 0 <= p <= 1e12:
        return "preço"
    fotos = o.get("fotos", [])
    if not isinstance(fotos, list) or len(fotos) > 60:
        return "fotos"
    for f in fotos:
        if not isinstance(f, dict) or not isinstance(f.get("s"), str) or not RE_FOTO.fullmatch(f["s"]):
            return "fotos"
        if f.get("g") is not None and not (isinstance(f["g"], str) and RE_FOTO.fullmatch(f["g"])):
            return "fotos"
        if f.get("l") is not None and not isinstance(f["l"], bool):   # R86k: foto livre (True) ou só com login (False)
            return "fotos"
    for k in ("end", "nomes", "loc", "fn"):
        if o.get(k) is not None and not isinstance(o[k], dict):
            return k
    if o.get("sit") is not None and o["sit"] not in SITUACOES_IMOVEL:
        return "situação"
    if o.get("vendMostra") is not None and not isinstance(o["vendMostra"], bool):
        return "situação"
    if o.get("final") is not None and o["final"] not in FINALIDADES:
        return "finalidade"
    if o.get("perAlug") is not None and o["perAlug"] not in PERIODOS_ALUGUEL:
        return "período do aluguel"
    if o.get("cod") is not None and not (isinstance(o["cod"], str) and RE_COD.fullmatch(o["cod"])):
        return "código"
    for k in ("infos", "px", "ar"):
        if o.get(k) is not None and not isinstance(o[k], list):
            return k
    return None


def confere_mapa(m):
    if not isinstance(m, dict) or m.get("modo") not in ("rs", "foco", "perto") or not isinstance(m.get("cidade"), str):
        return False
    r = m.get("raio")
    if isinstance(r, bool) or not isinstance(r, (int, float)) or not 0 < r <= 2000 or len(json.dumps(m)) > 20000:
        return False
    return all(isinstance(m.get(k, []), list) and all(isinstance(x, str) and len(x) <= 80 for x in m.get(k, [])) for k in ("nomes", "atende"))


def sobe_rev(c, rev):
    """Dentro da transação: sobe a revisão só se ninguém salvou antes. Senão, 409 (o ponte pede para recarregar)."""
    if isinstance(rev, bool) or not isinstance(rev, int):
        raise Erro(400, erro="invalido", campo="rev")
    r = c.execute("update estado set rev = rev + 1, atualizado = now() where id = 1 and rev = %s returning rev", (rev,)).fetchone()
    if not r:
        atual = c.execute("select rev from estado where id = 1").fetchone()["rev"]
        raise Erro(409, erro="conflito", rev=atual)
    return r["rev"]


def sobe_rev_livre(c):
    return c.execute("update estado set rev = rev + 1, atualizado = now() where id = 1 returning rev").fetchone()["rev"]


@app.get("/api/painel/estado")
def painel_estado(u=Depends(logado)):
    adm = {"email": u["email"], "nome": u["nome"], "trocar": u["temp"]}
    if u["temp"]:
        return {"admin": adm, "rev": 0}  # senha temporária: nada de dados antes de trocar
    if not u["termo"]:
        raise Erro(403, erro="aceitar_termo", versao=TERMO_VERSAO)
    e = q1("select * from estado where id=1")
    ims = []
    for i in q("select rascunho, publicado from imoveis order by ordem"):
        o = i["rascunho"]
        o["pub"] = i["publicado"]
        ims.append(o)
    return {"v": 3, "rev": e["rev"], "admin": adm, "plano": PLANO, "tipos": e["tipos"], "exemplo": False, "imoveis": ims,
            "mapa": e["mapa"], "mapa_pub": e["mapa_pub"], "whatsapp_numero": whatsapp_numero()}


@app.put("/api/painel/estado")
def painel_salvar(corpo: dict = Depends(Corpo(ESTADO_MAX)), u=Depends(admin)):
    ims = corpo.get("imoveis", [])
    if not isinstance(ims, list) or len(ims) > 500:
        raise Erro(400, erro="invalido", campo="imóveis")
    for o in ims:
        errado = campo_errado(o)
        if errado:
            raise Erro(400, erro="invalido", campo=errado)
    tipos = corpo.get("tipos")
    if tipos is not None:
        if not isinstance(tipos, dict):
            raise Erro(400, erro="invalido", campo="tipos")
        tipos = {t: bool(tipos.get(t)) for t in TIPOS}
    with POOL.connection() as c:
        rev = sobe_rev(c, corpo.get("rev"))
        for o in ims:
            o = {k: v for k, v in o.items() if k != "pub"}   # o publicado só muda em /publicar
            c.execute("""insert into imoveis(id, rascunho) values (%s, %s)
                         on conflict (id) do update set rascunho = excluded.rascunho, atualizado = now()""", (o["id"], J(o)))
        if tipos is not None:
            c.execute("update estado set tipos = %s where id = 1", (J(tipos),))
    return {"ok": True, "rev": rev}


def falta_para_publicar(o):
    f = []
    if not str(o.get("cidade") or "").strip():
        f.append("cidade")
    if not (isinstance(o.get("preco"), (int, float)) and o["preco"] > 0):
        f.append("preço")
    if not o.get("fotos"):
        f.append("1 foto")
    return f


@app.post("/api/painel/imoveis/{iid}/publicar")
def painel_publicar(iid: str, u=Depends(admin)):
    with POOL.connection() as c:
        c.execute("select 1 from estado where id = 1 for update")   # um publicar por vez (conta do plano)
        i = c.execute("select rascunho, publicado from imoveis where id = %s", (iid,)).fetchone()
        if not i:
            raise Erro(404, erro="nao_encontrado")
        falta = falta_para_publicar(i["rascunho"])
        if falta:
            raise Erro(422, erro="incompleto", falta=falta)
        lim = limite_plano("im")
        if lim is not None and i["publicado"] is None:
            if c.execute("select count(*) as n from imoveis where publicado is not null").fetchone()["n"] >= lim:
                raise Erro(403, erro="limite_plano", limite=lim)
        c.execute("update imoveis set publicado = rascunho, publicado_em = now() where id = %s", (iid,))
        rev = sobe_rev_livre(c)
    return {"ok": True, "rev": rev}


@app.post("/api/painel/imoveis/{iid}/despublicar")
def painel_despublicar(iid: str, u=Depends(admin)):
    """Tira do site e mantém o rascunho. O ponte.js atual não chama esta rota (o painel só publica ou exclui)."""
    with POOL.connection() as c:
        if not c.execute("update imoveis set publicado = null, publicado_em = null where id = %s", (iid,)).rowcount:
            raise Erro(404, erro="nao_encontrado")
        rev = sobe_rev_livre(c)
    return {"ok": True, "rev": rev}


@app.delete("/api/painel/imoveis/{iid}")
def painel_excluir(iid: str, u=Depends(admin)):
    with POOL.connection() as c:
        if not c.execute("delete from imoveis where id = %s", (iid,)).rowcount:
            raise Erro(404, erro="nao_encontrado")
        rev = sobe_rev_livre(c)
    return {"ok": True, "rev": rev}


# ---------------- painel: mapa e WhatsApp (T18) ----------------
@app.put("/api/painel/mapa")
def painel_mapa(corpo: dict = Depends(Corpo(64 * 1024)), u=Depends(admin)):
    if not confere_mapa(corpo.get("mapa")):
        raise Erro(400, erro="invalido", campo="mapa")
    with POOL.connection() as c:
        rev = sobe_rev(c, corpo.get("rev"))
        c.execute("update estado set mapa = %s where id = 1", (J(corpo["mapa"]),))
    return {"ok": True, "rev": rev}


@app.post("/api/painel/mapa/publicar")
def painel_mapa_publicar(u=Depends(admin)):
    with POOL.connection() as c:
        e = c.execute("select mapa from estado where id = 1 for update").fetchone()
        if not e["mapa"]:
            raise Erro(400, erro="invalido", campo="mapa")
        lim = limite_plano("cid")
        if lim is not None and len(e["mapa"].get("atende") or []) > lim:
            raise Erro(403, erro="limite_plano", limite=lim)
        c.execute("update estado set mapa_pub = mapa where id = 1")
        rev = sobe_rev_livre(c)
    return {"ok": True, "rev": rev}


@app.put("/api/painel/whatsapp")
def painel_whatsapp(corpo: dict = Depends(Corpo()), u=Depends(admin)):
    n = re.sub(r"\D", "", str(corpo.get("numero") or ""))
    if not RE_WA_SITE.fullmatch(n):
        raise Erro(400, erro="invalido", campo="numero")
    q("""insert into config(chave, valor) values ('whatsapp', %s)
         on conflict (chave) do update set valor = excluded.valor, atualizado = now()""", n)
    return {"ok": True, "whatsapp_numero": n}


# ---------------- painel: fotos (T15) ----------------
def tratar_foto(dados):
    """JPEG/PNG/WebP -> WebP sem EXIF/GPS, lado maior até FOTO_LADO (nunca amplia)."""
    from PIL import Image, ImageOps
    Image.MAX_IMAGE_PIXELS = 50_000_000
    try:
        im = Image.open(io.BytesIO(dados))
        if im.format not in ("JPEG", "PNG", "WEBP"):
            raise Erro(415, erro="tipo")
        im = ImageOps.exif_transpose(im)     # aplica a rotação do EXIF antes de jogar o EXIF fora
        im.load()
    except Erro:
        raise
    except Image.DecompressionBombError:
        raise Erro(413, erro="grande_demais")
    except Exception:
        raise Erro(415, erro="tipo")
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        fundo = Image.new("RGB", im.size, (255, 255, 255))
        fundo.paste(im, mask=im.getchannel("A"))
        limpa = fundo
    else:
        limpa = Image.new("RGB", im.size)    # imagem nova: nenhum metadado (EXIF, GPS, XMP, ICC) vem junto
        limpa.paste(im.convert("RGB"))
    limpa.thumbnail((FOTO_LADO, FOTO_LADO), Image.LANCZOS)
    saida = io.BytesIO()
    limpa.save(saida, "WEBP", quality=84, method=4)
    return saida.getvalue(), limpa.width, limpa.height


@app.post("/api/painel/fotos")
async def painel_fotos(request: Request):
    u = await run_in_threadpool(admin, request)
    tipo = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
    if tipo not in ("image/jpeg", "image/png", "image/webp"):
        raise Erro(415, erro="tipo")
    try:
        if int(request.headers.get("content-length") or 0) > FOTO_MAX:
            raise Erro(413, erro="grande_demais")
    except ValueError:
        raise Erro(400, erro="invalido")
    dados = b""
    async for parte in request.stream():
        dados += parte
        if len(dados) > FOTO_MAX:
            raise Erro(413, erro="grande_demais")

    def guardar():
        espera = gasta(chave_lim("fotos", u["id"]), 240, 600)
        if espera:
            raise Erro(429, erro="muitas_fotos", espera=espera)
        webp, w, h = tratar_foto(dados)
        nome = secrets.token_hex(16) + ".webp"
        tmp = MIDIA / (nome + ".tmp")
        tmp.write_bytes(webp)
        tmp.replace(MIDIA / nome)
        q("insert into fotos(arquivo, bytes, largura, altura, por) values (%s, %s, %s, %s, %s)", nome, len(webp), w, h, u["id"])
        return {"ok": True, "s": "midia/" + nome, "w": w, "h": h}
    return await run_in_threadpool(guardar)


# ---------------- site: estado público (T14) ----------------
FAIXAS = (400, 800, 1200, 2400, 5000, 10000, 20000)   # as faixas de distância que o site mostra antes do contato


def para_visitante(pub, com_conta):
    """O que sai do imóvel publicado. Sem conta: nada de rua, número, ponto do mapa, nem nome/posição dos lugares perto.
    Com conta: só o que o corretor marcou para aparecer (nomes.rua, nomes.num, nomes.bairro)."""
    o = copy.deepcopy(pub)
    end = o.get("end") if isinstance(o.get("end"), dict) else {}
    nomes = o.get("nomes") if isinstance(o.get("nomes"), dict) else {}
    novo = {}
    if nomes.get("bairro") and end.get("bairro"):
        novo["bairro"] = end["bairro"]
    if com_conta and nomes.get("rua") and end.get("rua"):
        novo["rua"] = end["rua"]
        if nomes.get("num") and end.get("num"):
            novo["num"] = end["num"]
    o.pop("end", None)
    if novo:
        o["end"] = novo
    if not com_conta:
        o.pop("loc", None)
        if "nomes" in o:
            o["nomes"] = {"bairro": bool(nomes.get("bairro")), "rua": False, "num": False}
        px = []
        for p in o.get("px") or []:
            if not isinstance(p, dict):
                continue
            d = p.get("d")
            if isinstance(d, (int, float)) and not isinstance(d, bool) and d > 0:
                d = next((f for f in FAIXAS if d <= f), 20001)   # só a faixa: várias distâncias exatas achariam a rua
            else:
                d = 0
            px.append({"t": p.get("t"), "d": d, "u": p.get("u", "m")})
        if "px" in o:
            o["px"] = px
    return o


def vai_ao_site(pub):
    """T39: vendido só aparece se o corretor marcou "mostrar como vendido"."""
    return pub.get("sit") != "vend" or pub.get("vendMostra") is True


def conta_de(request):
    t = request.cookies.get(COOKIE_V)
    if not t:
        return None
    return q1("""select c.*, v.hash, v.historico from visitas v join contas c on c.id = v.conta_id
                 where v.hash=%s and v.expira > now()""", hash_token(t))


@app.get("/api/estado")
def estado_publico(request: Request):
    c = conta_de(request)
    e = q1("select tipos, mapa_pub from estado where id=1")
    ims = [para_visitante(i["publicado"], bool(c)) for i in q("select publicado from imoveis where publicado is not null order by ordem")
           if vai_ao_site(i["publicado"])]
    n = whatsapp_numero()
    conta = {"nome": decifrar(c["nome_cif"], "nome"), "wa": wa_bonito(decifrar(c["wa_cif"], "wa"))} if c else None
    return {"plano": PLANO, "whatsapp": bool(n), "whatsapp_numero": n, "tipos": e["tipos"], "imoveis": ims, "mapa": e["mapa_pub"], "conta": conta}


# ---------------- site: conta do visitante, leads e chamadas (T16, T17) ----------------
def conta_gravar(c, nome, wa):
    """Dentro da transação: acha a conta pelo WhatsApp (ou cria), corrige o nome e guarda o aceite do aviso. Devolve (id, historico)."""
    idx = indice_wa(wa)
    conta = c.execute("select id, nome_cif from contas where wa_hmac = %s for update", (idx,)).fetchone()
    if conta:
        # mesmo número com outro nome: o nome é corrigido (como o aviso promete), mas esta sessão não vê o histórico
        historico = nome_chave(decifrar(conta["nome_cif"], "nome")) == nome_chave(nome)
        c.execute("update contas set nome_cif = %s, atualizado = now() where id = %s", (cifrar(nome, "nome"), conta["id"]))
        cid = conta["id"]
    else:
        historico = True
        cid = c.execute("insert into contas(wa_hmac, nome_cif, wa_cif) values (%s, %s, %s) returning id",
                        (idx, cifrar(nome, "nome"), cifrar(wa, "wa"))).fetchone()["id"]
    c.execute("insert into aceites(conta_id, versao) values (%s, %s)", (cid, AVISO_VERSAO))
    return cid, historico


@app.post("/api/contas")
def contas_entrar(request: Request, corpo: dict = Depends(Corpo())):
    espera = gasta(chave_lim("contas-ip", ip_de(request)), 20, 600)
    if espera:
        raise Erro(429, erro="muitas_tentativas", espera=espera)
    nome = nome_limpo(corpo.get("nome"))
    if not 2 <= len(nome) <= 60:
        raise Erro(400, erro="invalido", campo="nome")
    wa = wa_visitante(corpo.get("whatsapp"))
    if not wa:
        raise Erro(400, erro="invalido", campo="whatsapp")
    if corpo.get("aceite") is not True or corpo.get("versao_aviso") != AVISO_VERSAO:
        raise Erro(400, erro="aceite_obrigatorio", versao=AVISO_VERSAO)
    with POOL.connection() as c:
        cid, historico = conta_gravar(c, nome, wa)
        velho = request.cookies.get(COOKIE_V)
        if velho:
            c.execute("delete from visitas where hash = %s", (hash_token(velho),))
        t = secrets.token_urlsafe(32)
        c.execute("insert into visitas(hash, conta_id, historico, expira) values (%s, %s, %s, now() + make_interval(days => %s))",
                  (hash_token(t), cid, historico, VISITA_DIAS))
    return cookie(JSONResponse({"ok": True, "conta": {"nome": nome, "wa": wa_bonito(wa)}}), COOKIE_V, t, VISITA_DIAS * 86400)


@app.post("/api/contas/sair")
def contas_sair(request: Request):
    t = request.cookies.get(COOKIE_V)
    if t:
        q("delete from visitas where hash=%s", hash_token(t))
    return cookie(JSONResponse({"ok": True}), COOKIE_V, None, 0)


def texto_curto(v, n):
    return "".join(ch for ch in str(v) if ch.isprintable())[:n].strip() if isinstance(v, str) else None


@app.post("/api/leads")
def leads_novo(request: Request, corpo: dict = Depends(Corpo())):
    conta = conta_de(request)
    if not conta:
        raise Erro(401, erro="sem_conta")
    if gasta(chave_lim("leads", conta["id"]), 60, 600):
        raise Erro(429, erro="muitas_tentativas")
    via = corpo.get("via")
    if not isinstance(via, str) or not RE_VIA.fullmatch(via):
        raise Erro(400, erro="invalido", campo="via")
    iid = corpo.get("imovel_id")
    if iid is not None and not (isinstance(iid, str) and q1("select 1 as x from imoveis where id=%s and publicado is not null", iid)):
        iid = None
    imovel, cidade = texto_curto(corpo.get("imovel"), 200), texto_curto(corpo.get("cidade"), 80)
    pedido = texto_curto(corpo.get("pedido"), 120) if via == "visita" else None    # T44: "sáb, 23/11, à tarde"
    with POOL.connection() as c:
        l = c.execute("select * from leads where conta_id = %s for update", (conta["id"],)).fetchone()
        if not l:
            c.execute("insert into leads(conta_id, via, imovel_id, imovel, cidade, pedido) values (%s, %s, %s, %s, %s, %s)",
                      (conta["id"], J([via]), iid, imovel, cidade, pedido))
        else:
            vias = l["via"] if via in l["via"] else (l["via"] + [via])[:12]
            if iid:        # como o site faz: o imóvel novo substitui; sem imóvel, a cidade só preenche o que faltava
                c.execute("update leads set via=%s, imovel_id=%s, imovel=%s, cidade=%s, atualizado=now() where id=%s",
                          (J(vias), iid, imovel, cidade, l["id"]))
            else:
                c.execute("update leads set via=%s, cidade=%s, atualizado=now() where id=%s",
                          (J(vias), l["cidade"] if l["cidade"] not in (None, "", "-") else cidade, l["id"]))
            if pedido:
                c.execute("update leads set pedido=%s where id=%s", (pedido, l["id"]))
        c.execute("update contas set atualizado = now() where id = %s", (conta["id"],))
    return {"ok": True}


@app.get("/api/painel/leads")
def painel_leads(u=Depends(admin)):
    saida = []
    for l in q("""select l.*, c.nome_cif, c.wa_cif, (extract(epoch from l.atualizado) * 1000)::bigint as t
                  from leads l join contas c on c.id = l.conta_id order by l.atualizado"""):
        m = re.match(r'"(.*)" · ', l["imovel"] or "")
        o = {"nome": decifrar(l["nome_cif"], "nome"), "wa": wa_bonito(decifrar(l["wa_cif"], "wa")), "imovel": l["imovel"] or "-",
             "id": l["imovel_id"], "cidade": l["cidade"] or "-", "t": l["t"], "via": l["via"],
             "lid": l["id"], "sit": l["situacao"], "nota": l["nota"] or "", "pedido": l["pedido"], "vender": l["vender"]}
        if m:
            o["nm"] = m.group(1)
        saida.append(o)
    return {"leads": saida}


@app.put("/api/painel/leads/{lid}")
def painel_lead_mudar(lid: int, corpo: dict = Depends(Corpo()), u=Depends(admin)):
    """T43: o corretor marca em que pé está a conversa e escreve uma anotação curta."""
    sit, nota = corpo.get("sit"), corpo.get("nota")
    if sit is not None and sit not in SITUACOES_LEAD:
        raise Erro(400, erro="invalido", campo="situação")
    if nota is not None and (not isinstance(nota, str) or len(nota) > 1000):
        raise Erro(400, erro="invalido", campo="nota")
    if sit is None and nota is None:
        raise Erro(400, erro="invalido", campo="nada")
    nota = "".join(ch for ch in nota if ch.isprintable() or ch == "\n").strip() if nota is not None else None
    r = q("""update leads set situacao = coalesce(%s, situacao), nota = case when %s then %s else nota end
             where id = %s returning id""", sit, nota is not None, nota, lid)
    if not r:
        raise Erro(404, erro="nao_encontrado")
    return {"ok": True}


# ---------------- T45: "Quero vender meu imóvel" ----------------
TIPOS_VENDER = TIPOS + ("outro",)


@app.post("/api/vender")
def vender(request: Request, corpo: dict = Depends(Corpo())):
    if gasta(chave_lim("vender-ip", ip_de(request)), 10, 3600):
        raise Erro(429, erro="muitas_tentativas")
    nome = nome_limpo(corpo.get("nome"))
    if not 2 <= len(nome) <= 60:
        raise Erro(400, erro="invalido", campo="nome")
    wa = wa_visitante(corpo.get("whatsapp"))
    if not wa:
        raise Erro(400, erro="invalido", campo="whatsapp")
    if corpo.get("tipo") not in TIPOS_VENDER:
        raise Erro(400, erro="invalido", campo="tipo")
    cidade, obs = texto_curto(corpo.get("cidade"), 80), texto_curto(corpo.get("obs"), 300) or ""
    if not cidade or len(cidade) < 2:
        raise Erro(400, erro="invalido", campo="cidade")
    if corpo.get("aceite") is not True or corpo.get("versao_aviso") != AVISO_VERSAO:
        raise Erro(400, erro="aceite_obrigatorio", versao=AVISO_VERSAO)
    dados = {"tipo": corpo["tipo"], "cidade": cidade, "obs": obs}
    with POOL.connection() as c:
        cid, _ = conta_gravar(c, nome, wa)
        l = c.execute("select * from leads where conta_id = %s for update", (cid,)).fetchone()
        if not l:
            c.execute("insert into leads(conta_id, via, cidade, vender) values (%s, %s, %s, %s)", (cid, J(["vender"]), cidade, J(dados)))
        else:
            vias = l["via"] if "vender" in l["via"] else (l["via"] + ["vender"])[:12]
            c.execute("update leads set via=%s, vender=%s, atualizado=now() where id=%s", (J(vias), J(dados), l["id"]))
    return {"ok": True}


@app.post("/api/chamadas")
def chamadas_nova(request: Request, corpo: dict = Depends(Corpo())):
    # o limite usa o IP só como chave de HMAC que vence sozinha; a chamada guardada não tem IP nem conta
    if gasta(chave_lim("chamadas-ip", ip_de(request)), 60, 600):
        raise Erro(429, erro="muitas_tentativas")
    iid = corpo.get("id")
    i = q1("select publicado from imoveis where id=%s and publicado is not null", iid) if isinstance(iid, str) else None
    if not i:
        raise Erro(400, erro="invalido", campo="id")
    q("insert into chamadas(imovel_id, nm, o, cidade) values (%s, %s, %s, %s)", iid, texto_curto(corpo.get("nm"), 120),
      texto_curto(corpo.get("o"), 240), texto_curto(i["publicado"].get("cidade"), 80))
    return {"ok": True}


@app.post("/api/visto")
def visto(request: Request, corpo: dict = Depends(Corpo())):
    """R86 · Desempenho: conta uma abertura do site (sem id) ou de um imóvel publicado (id). Guarda só o total do dia."""
    if gasta(chave_lim("visto-ip", ip_de(request)), 120, 3600):
        return {"ok": True}   # passou do limite: não conta, mas não dá erro ao visitante
    iid = corpo.get("id") or ""
    if iid:
        if not (isinstance(iid, str) and RE_ID.fullmatch(iid)) or not q1("select 1 from imoveis where id=%s and publicado is not null", iid):
            raise Erro(400, erro="invalido", campo="id")
    q("""insert into aberturas(dia, imovel_id, n) values ((now() at time zone 'America/Sao_Paulo')::date, %s, 1)
         on conflict (dia, imovel_id) do update set n = aberturas.n + 1""", iid)
    return {"ok": True}


@app.get("/api/painel/desempenho")
def painel_desempenho(u=Depends(admin)):
    r = q("""select to_char(dia, 'YYYY-MM-DD') as dia, imovel_id as id, n from aberturas
             where dia > (now() at time zone 'America/Sao_Paulo')::date - 400 order by dia""")
    return {"aberturas": r}


def _viacep(cep: str):
    """Consulta o ViaCEP do lado do servidor (o navegador não pode: connect-src é 'self'). Separado para os testes trocarem."""
    import urllib.request
    with urllib.request.urlopen(f"https://viacep.com.br/ws/{cep}/json/", timeout=6) as r:
        return json.loads(r.read().decode("utf-8"))


@app.get("/api/painel/cep/{cep}")
def painel_cep(cep: str, request: Request, u=Depends(admin)):
    """Atalho de endereço do painel: CEP -> rua, bairro, cidade. Só admin; 60 por hora por IP."""
    c = re.sub(r"\D", "", cep or "")
    if len(c) != 8:
        raise Erro(400, erro="invalido", campo="cep")
    if gasta(chave_lim("cep-ip", ip_de(request)), 60, 3600):
        raise Erro(429, erro="muitas_tentativas")
    try:
        d = _viacep(c)
    except Exception:
        raise Erro(502, erro="indisponivel")
    if not isinstance(d, dict) or d.get("erro"):
        raise Erro(404, erro="nao_achou")
    return {"rua": str(d.get("logradouro") or "")[:80], "bairro": str(d.get("bairro") or "")[:60], "cidade": str(d.get("localidade") or "")[:60], "uf": str(d.get("uf") or "")[:2]}


@app.get("/api/painel/chamadas")
def painel_chamadas(u=Depends(admin)):
    r = q("""select (extract(epoch from criado) * 1000)::bigint as t, cidade as c, imovel_id as id, nm, o
             from (select * from chamadas order by id desc limit 2000) x order by id""")
    return {"chamadas": r}


# ---------------- privacidade (T19) ----------------
@app.post("/api/privacidade/apagar")
def privacidade_apagar(request: Request, corpo: dict = Depends(Corpo())):
    wa = wa_visitante(corpo.get("whatsapp"))
    if not wa:
        raise Erro(400, erro="invalido", campo="whatsapp")
    k_ip, k_wa = chave_lim("apagar-ip", ip_de(request)), chave_lim("apagar-wa", wa)
    if max(gasta(k_ip, 8, 3600), gasta(k_wa, 5, 3600)):
        raise Erro(429, erro="muitas_tentativas")
    idx, nome = indice_wa(wa), nome_chave(corpo.get("nome"))
    sessao = conta_de(request)
    conta = q1("select id, nome_cif from contas where wa_hmac=%s", idx)
    # confirma quem: (a) está logado neste aparelho com este número, ou (b) escreve o nome como entrou no site.
    # número que não existe e nome que não confere dão a MESMA resposta: não dá para descobrir se um número está aqui.
    confirmado = bool(conta) and ((sessao is not None and sessao["id"] == conta["id"]) or
                                  (bool(nome) and hmac.compare_digest(nome_chave(decifrar(conta["nome_cif"], "nome")).encode(), nome.encode())))
    if not confirmado:
        return {"ok": True, "apagado": False, "confirmado": False}
    q("delete from contas where id=%s", conta["id"])   # leva junto: sessões do visitante, aceites e o contato (lead)
    zera(k_wa)
    resp = JSONResponse({"ok": True, "apagado": True, "confirmado": True})
    return cookie(resp, COOKIE_V, None, 0) if sessao is not None and sessao["id"] == conta["id"] else resp


@app.get("/api/privacidade/meus-dados")
def privacidade_meus_dados(request: Request):
    c = conta_de(request)
    if not c:
        raise Erro(401, erro="sem_conta")
    iso = lambda d: d.isoformat(timespec="seconds")
    j = {"nome": decifrar(c["nome_cif"], "nome"), "whatsapp": wa_bonito(decifrar(c["wa_cif"], "wa"))}
    if not c["historico"]:
        j["observacao"] = "Você entrou com um nome diferente do que estava guardado para este WhatsApp: por segurança, o histórico não aparece aqui."
        return j
    j["primeira_vez"] = iso(c["criado"])
    j["aceites_do_aviso"] = [{"versao": a["versao"], "data": iso(a["criado"])} for a in q("select versao, criado from aceites where conta_id=%s order by id", c["id"])]
    j["contatos"] = [{k: v for k, v in {"imovel": l["imovel"] or "-", "cidade": l["cidade"] or "-", "por": l["via"], "data": iso(l["atualizado"]),
                      "visita_pedida": l["pedido"], "quero_vender": l["vender"], "situacao_marcada_pelo_corretor": l["situacao"],
                      "anotacao_do_corretor": l["nota"]}.items() if v not in (None, "")}
                     for l in q("select * from leads where conta_id=%s", c["id"])]
    return j


# ---------------- arquivos: mídia e site (T07, T29) ----------------
def arquivo(request, caminho, cache):
    st = caminho.stat()
    etag = f'"{st.st_mtime_ns:x}-{st.st_size:x}"'
    h = {"Cache-Control": cache, "ETag": etag}
    if request.headers.get("if-none-match") == etag and "range" not in request.headers:
        return Response(status_code=304, headers=h)
    return FileResponse(caminho, headers=h)   # o FileResponse atende Range (vídeos) e HEAD


NAO = lambda: PlainTextResponse("Não encontrado.", 404)

# Versão dos scripts e estilos nas páginas: o HTML sai com "ponte.js?v=…", "painel/c.js?v=…" etc. Um cache no caminho
# (Cloudflare, navegador) pode guardar o ponte.js por horas; com o endereço mudando a cada versão, página nova nunca
# roda com script velho (aconteceu em 23/11: HTML novo + ponte.js do site antigo vindo do cache do Cloudflare).
ATIVOS = ("ponte.js", "ponte.css", "painel/c.js", "painel/c.css", "privacidade/privacidade.js", "privacidade/privacidade.css", "fontes/fontes.css")
TROCAS_HTML = (("s.src='ponte.js'", "s.src='ponte.js?v={v}'"), ('src="painel/c.js"', 'src="painel/c.js?v={v}"'),
               ('href="fontes/fontes.css"', 'href="fontes/fontes.css?v={v}"'), ('href="/fontes/fontes.css"', 'href="/fontes/fontes.css?v={v}"'),
               ('href="/privacidade/privacidade.css"', 'href="/privacidade/privacidade.css?v={v}"'),
               ('src="/privacidade/privacidade.js"', 'src="/privacidade/privacidade.js?v={v}"'))
_HTML = {}


def versao_ativos():
    h = hashlib.sha256()
    for a in ATIVOS:
        try:
            st = (SITE / a).stat()
            h.update(f"{a}:{st.st_mtime_ns}:{st.st_size};".encode())
        except OSError:
            pass
    return h.hexdigest()[:10]


def html_versionado(request, alvo):
    st, v = alvo.stat(), versao_ativos()
    chave = (str(alvo), st.st_mtime_ns, st.st_size, v)
    if _HTML.get(str(alvo), (None,))[0] != chave:
        t = alvo.read_text(encoding="utf-8")
        for a, b in TROCAS_HTML:
            t = t.replace(a, b.format(v=v))
        _HTML[str(alvo)] = (chave, t.encode("utf-8"), '"' + hashlib.sha256(t.encode("utf-8")).hexdigest()[:20] + '"')
    _, corpo, etag = _HTML[str(alvo)]
    h = {"Cache-Control": "no-cache", "ETag": etag, "Cloudflare-CDN-Cache-Control": "no-store"}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=h)
    return Response(b"" if request.method == "HEAD" else corpo, media_type="text/html; charset=utf-8", headers=h)


@app.api_route("/api/{resto:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
def api_desconhecida(resto: str):
    raise Erro(404, erro="nao_encontrado")


@app.api_route("/midia/{nome}", methods=["GET", "HEAD"])
def midia(nome: str, request: Request):
    if not RE_MIDIA.fullmatch(nome) or not (MIDIA / nome).is_file():
        return NAO()
    return arquivo(request, MIDIA / nome, CACHE_LONGO)


@app.api_route("/{caminho:path}", methods=["GET", "HEAD"])
def site(caminho: str, request: Request):
    if caminho in ("painel", "privacidade", "termos"):
        return RedirectResponse("/" + caminho + "/", 308)
    partes = caminho.split("/") if caminho else []
    if partes and partes[-1] == "":
        partes[-1] = "index.html"
    if not partes:
        partes = ["index.html"]
    # nunca: .git, .env, arquivos ocultos, app/, dados/, _to_delete/ (mesmo se ERV_SITE apontar para a pasta errada)
    if any(p in ("", ".", "..") or p[0] in "._" or "\\" in p or "\0" in p for p in partes) or partes[0].lower() in PASTAS_PROIBIDAS:
        return NAO()
    alvo = SITE.joinpath(*partes)
    try:
        alvo.resolve().relative_to(SITE)
    except ValueError:
        return NAO()
    ext = alvo.suffix.lower()
    if ext not in EXT_LONGO and ext not in EXT_CURTO:
        if alvo.is_dir():
            return RedirectResponse("/" + caminho + "/", 308)
        return NAO()
    if not alvo.is_file():
        return NAO()
    if ext == ".html":
        return html_versionado(request, alvo)
    r = arquivo(request, alvo, CACHE_LONGO if ext in EXT_LONGO else "no-cache")
    if ext in EXT_CURTO:
        r.headers["Cloudflare-CDN-Cache-Control"] = "no-store"     # o Cloudflare não guarda script/estilo sem versão
    return r


# ---------------- comandos (T09, T20) ----------------
def comando(args):
    if args[:1] == ["chave"]:
        print(base64.b64encode(secrets.token_bytes(32)).decode())
        return 0
    abriu = POOL is None
    abrir()
    try:
        if args[:1] == ["usuario"] and len(args) >= 2:
            email, nome = args[1].strip().lower(), (args[2] if len(args) > 2 else "")
            if not RE_EMAIL.fullmatch(email):
                print("E-mail inválido.")
                return 1
            if q1("select 1 as x from usuarios where email=%s", email):
                print("Já existe um acesso com esse e-mail. Para gerar outra senha: python app.py senha", email)
                return 1
            senha = secrets.token_urlsafe(12)
            q("insert into usuarios(email, nome, senha_hash, temp) values (%s, %s, %s, true)", email, nome, hash_senha(senha))
            print(f"Acesso criado: {email}\nSenha temporária (aparece só agora; o painel pede para trocar na 1ª entrada): {senha}")
            return 0
        if args[:1] == ["senha"] and len(args) == 2:
            email = args[1].strip().lower()
            u = q1("select id from usuarios where email=%s", email)
            if not u:
                print("Não existe acesso com esse e-mail.")
                return 1
            senha = secrets.token_urlsafe(12)
            q("update usuarios set senha_hash=%s, temp=true where id=%s", hash_senha(senha), u["id"])
            q("delete from sessoes where usuario_id=%s", u["id"])
            zera(chave_lim("login-email", email))
            print(f"Senha temporária nova para {email} (aparece só agora): {senha}")
            return 0
        if args[:1] == ["email"] and len(args) == 3:
            velho, novo = args[1].strip().lower(), args[2].strip().lower()
            if not RE_EMAIL.fullmatch(novo) or q1("select 1 as x from usuarios where email=%s", novo):
                print("E-mail novo inválido ou já em uso.")
                return 1
            if not q("update usuarios set email=%s where email=%s returning id", novo, velho):
                print("Não existe acesso com esse e-mail.")
                return 1
            print(f"E-mail de login trocado: {velho} -> {novo}")
            return 0
        if args[:1] == ["usuarios"]:
            for u in q("""select email, nome, temp, criado, (select max(criado) from termos t where t.usuario_id = usuarios.id
                          and t.versao = %s) as termo from usuarios order by id""", TERMO_VERSAO):
                termo = f"termo {TERMO_VERSAO} aceito em {u['termo']:%Y-%m-%d %H:%M}" if u["termo"] else f"termo {TERMO_VERSAO} ainda não aceito"
                print(f"{u['email']}\t{u['nome']}\t{'senha temporária' if u['temp'] else 'senha definida'}\t{u['criado']:%Y-%m-%d}\t{termo}")
            return 0
        if args[:1] == ["limpar"]:
            print("Limpeza:", ", ".join(f"{k} {v}" for k, v in limpar().items()))
            return 0
        print(__doc__)
        return 1
    finally:
        if abriu:
            fechar()


if __name__ == "__main__":
    sys.exit(comando(sys.argv[1:]))
