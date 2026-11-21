"""Sobe um PostgreSQL temporário + o app (uvicorn) numa porta livre, só para os testes de navegador (e2e).

Uso direto (deixa o site no ar até Ctrl+C, para olhar à mão):
    python3 app/testes/e2e/servidor_local.py            -> mostra o endereço (http://127.0.0.1:PORTA)
Os roteiros (roteiro.py) importam Servidor daqui. Nada é gravado fora de dados-teste/ e de uma pasta temporária do sistema.
Com ERV_TESTE_BANCO=postgresql://... usa esse banco em vez de subir um (ATENÇÃO: as tabelas são esvaziadas).
"""
import base64, glob, os, pathlib, shutil, socket, subprocess, sys, tempfile, time, urllib.request

RAIZ = pathlib.Path(__file__).resolve().parents[3]
APP = RAIZ / "app"
TABELAS = "usuarios, sessoes, imoveis, fotos, contas, visitas, aceites, leads, chamadas, config, tentativas, acessos, termos"


def _bin(nome):
    achado = shutil.which(nome)
    if achado:
        return achado
    cand = sorted(glob.glob(f"/usr/lib/postgresql/*/bin/{nome}"))
    return cand[-1] if cand else None


def _porta():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Servidor:
    def __init__(self, **env_extra):
        self.env_extra, self.pg, self.proc, self.pasta = env_extra, None, None, None

    def __enter__(self):
        self.banco = os.environ.get("ERV_TESTE_BANCO") or self._subir_pg()
        (RAIZ / "dados-teste").mkdir(exist_ok=True)
        self.dados = tempfile.mkdtemp(prefix="e2e-", dir=str(RAIZ / "dados-teste"))
        self.porta = _porta()
        self.url = f"http://127.0.0.1:{self.porta}"
        self.env = dict(os.environ, ERV_BANCO=self.banco, ERV_DADOS=self.dados, ERV_SITE=str(RAIZ / "site"), ERV_HTTPS="0",
                        ERV_ORIGENS=self.url, ERV_NOINDEX="1", ERV_TUNEL_TESTE="0", ERV_PLANO="erivelto", ERV_LEADS_MESES="0",
                        ERV_IP_CABECALHO="", ERV_WHATSAPP="", ERV_FOTO_LADO="2560", ERV_AVISO_VERSAO="", ERV_TERMO_VERSAO="",
                        ERV_CHAVE_DADOS=base64.b64encode(b"chave-so-dos-testes-e2e-23456789").decode())
        self.env.update(self.env_extra)
        self.log = open(os.path.join(self.dados, "app.log"), "w")
        self.proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", str(self.porta),
                                      "--no-access-log"], cwd=APP, env=self.env, stdout=self.log, stderr=subprocess.STDOUT)
        for _ in range(150):
            try:
                if urllib.request.urlopen(self.url + "/api/saude", timeout=1).status == 200:
                    return self
            except Exception:
                if self.proc.poll() is not None:
                    break
                time.sleep(0.2)
        self.__exit__()
        raise SystemExit("O app não subiu. Veja o log em " + self.log.name)

    def _subir_pg(self):
        initdb, pg_ctl = _bin("initdb"), _bin("pg_ctl")
        if not initdb or not pg_ctl:
            raise SystemExit("Sem PostgreSQL: instale o postgresql ou defina ERV_TESTE_BANCO.")
        self.pasta = tempfile.mkdtemp(prefix="erv-e2e-pg-")
        os.chmod(self.pasta, 0o755)
        pre = []
        if os.geteuid() == 0:       # como root o Postgres não sobe: usa o usuário "postgres"
            shutil.chown(self.pasta, "postgres", "postgres")
            pre = ["runuser", "-u", "postgres", "--"]
        porta, dados = _porta(), os.path.join(self.pasta, "pg")
        r = lambda *a: subprocess.run(pre + list(a), check=True, capture_output=True, cwd=self.pasta)
        r(initdb, "-D", dados, "-A", "trust", "-U", "erv", "-E", "UTF8", "--locale=C")
        r(pg_ctl, "-D", dados, "-w", "-l", os.path.join(self.pasta, "log"),
          "-o", f"-p {porta} -c listen_addresses=127.0.0.1 -c unix_socket_directories={self.pasta} -c fsync=off", "start")
        self.pg = (pre, pg_ctl, dados)
        return f"postgresql://erv@127.0.0.1:{porta}/postgres"

    def comando(self, *args):
        """python app.py ... (como o dono faz na linha de comando). Devolve o texto que saiu."""
        r = subprocess.run([sys.executable, "app.py", *args], cwd=APP, env=self.env, capture_output=True, text=True)
        return r.stdout + r.stderr

    def sql(self, texto, *a):
        import psycopg
        from psycopg.rows import dict_row
        with psycopg.connect(self.banco, row_factory=dict_row, autocommit=True) as c:
            cur = c.execute(texto, a)
            return cur.fetchall() if cur.description else []

    def zerar(self):
        self.sql(f"truncate {TABELAS} restart identity cascade")
        self.sql("update estado set rev = 1, mapa = null, mapa_pub = null where id = 1")

    def __exit__(self, *a):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(10)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        if self.pg:
            pre, pg_ctl, dados = self.pg
            subprocess.run(pre + [pg_ctl, "-D", dados, "-m", "immediate", "stop"], capture_output=True, cwd="/")
            shutil.rmtree(self.pasta, ignore_errors=True)
            self.pg = None
        if getattr(self, "log", None):
            self.log.close()
        if getattr(self, "dados", None):
            shutil.rmtree(self.dados, ignore_errors=True)


if __name__ == "__main__":
    with Servidor() as s:
        print("No ar em", s.url, "· painel:", s.url + "/painel/", flush=True)
        if len(sys.argv) > 1:
            print(s.comando("usuario", sys.argv[1], "Teste"), flush=True)
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            pass
