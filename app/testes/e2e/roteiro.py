"""Roteiro de navegador (Playwright) do site + painel em modo servidor, ponta a ponta (T22, T23, T24, T05, T03).

Como rodar (na raiz do projeto):
    pip install -r app/requirements-teste.txt playwright && python3 -m playwright install chromium     (uma vez)
    python3 app/testes/e2e/roteiro.py                 -> roda no celular (iPhone 13) e no PC (1366x768)
    python3 app/testes/e2e/roteiro.py celular         -> só um dos dois (celular | pc)
    python3 app/testes/e2e/roteiro.py --capturas      -> guarda imagens das telas em dados-teste/e2e-capturas/
Sobe sozinho um PostgreSQL temporário e o app (ERV_HTTPS=0) numa porta livre; no fim apaga tudo. Não usa Docker nem internet.
O navegador é o Chromium com o tamanho/toque/identificação do iPhone 13: não é o Safari de verdade (ver LEIA-ME.md).
Sai com código 0 se todos os passos passaram.
"""
import os, pathlib, re, sys, tempfile, time, traceback

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from servidor_local import RAIZ, Servidor  # noqa: E402

from playwright.sync_api import expect, sync_playwright  # noqa: E402

EMAIL, SENHA1, SENHA2 = "e2e@exemplo.com", "primeira-senha-e2e-1", "segunda-senha-e2e-2"
WA1, WA2 = "5551998765432", "5551991112222"            # números inventados, só para o teste
VISITANTE, VISITANTE_WA = "Maria Teste da Silva", "(51) 99999-1234"
CIDADE = "Santo Antônio da Patrulha"
CAPTURAS = RAIZ / "dados-teste" / "e2e-capturas"
T = 30000


def foto_de_teste(pasta):
    """JPEG 2000x1500 claro e nítido (retângulos coloridos), com EXIF de GPS para conferir que o servidor tira."""
    import random
    from PIL import Image, ImageDraw
    rnd = random.Random(7)
    im = Image.new("RGB", (2000, 1500), (190, 205, 215))
    d = ImageDraw.Draw(im)
    for _ in range(400):
        x, y = rnd.randrange(2000), rnd.randrange(1500)
        d.rectangle([x, y, x + rnd.randrange(20, 260), y + rnd.randrange(20, 200)], fill=tuple(rnd.randrange(60, 255) for _ in range(3)), outline=(20, 20, 20))
    e = Image.Exif()
    e[0x010F] = "CameraSecreta"
    e[0x8825] = {1: "S", 2: (29.0, 49.0, 5.9), 3: "W", 4: (50.0, 31.0, 12.3)}
    caminho = os.path.join(pasta, "fachada-teste.jpg")
    im.save(caminho, "JPEG", quality=92, exif=e)
    return caminho


RODAPE_JS = """() => {
  const r = document.getElementById('pt-rodape');
  if (!r || r.hidden || getComputedStyle(r).display === 'none') return { visivel: false };
  const b = r.getBoundingClientRect(), a = r.querySelector('a'), cobre = [];
  for (let i = 0; i <= 8; i++) for (const y of [b.top + 2, (b.top + b.bottom) / 2, b.bottom - 2]) {
    const x = b.left + 2 + (b.width - 4) * i / 8;
    for (const e of document.elementsFromPoint(x, y)) {
      if (r.contains(e)) continue;
      const c = e.closest('button, a, input, select, textarea');
      if (c) cobre.push((c.className || c.tagName) + ': ' + (c.innerText || '').slice(0, 30));
      break;                                   // só o que está logo embaixo da linha
    }
  }
  const topo = document.elementFromPoint((a.getBoundingClientRect().left + a.getBoundingClientRect().right) / 2, (a.getBoundingClientRect().top + a.getBoundingClientRect().bottom) / 2);
  return { visivel: true, texto: r.innerText.replace(/\\s+/g, ' ').trim(), link: a.innerText, href: a.getAttribute('href'), destino: a.href, links: [...r.querySelectorAll('a')].map(x => [x.innerText, x.getAttribute('href')]),
           dentro: b.top >= 0 && b.left >= 0 && b.bottom <= innerHeight && b.right <= innerWidth, altura: Math.round(b.height),
           linkPorCima: topo === a, cobre: [...new Set(cobre)] };
}"""


class Roteiro:
    def __init__(self, nome, navegador, opcoes, srv, capturas, arq_foto):
        self.nome, self.b, self.opcoes, self.s, self.capturas, self.arq_foto = nome, navegador, opcoes, srv, capturas, arq_foto
        self.passos, self.erros_js, self.wa_pedidos, self.n = [], [], [], 0
        self.painel = self.site = None

    # ---------- apoio ----------
    def contexto(self):
        c = self.b.new_context(locale="pt-BR", **self.opcoes)
        c.set_default_timeout(T)
        # o WhatsApp de verdade não é aberto: a chamada a wa.me é anotada e respondida aqui mesmo
        c.route(re.compile(r"^https://wa\.me/"), lambda rota: (self.wa_pedidos.append(rota.request.url), rota.fulfill(status=200, content_type="text/html", body="<title>wa</title>ok")))
        return c

    def pagina(self, ctx, quem):
        p = ctx.new_page()
        p.on("pageerror", lambda e: self.erros_js.append(f"{quem}: {str(e)[:200]}"))
        return p

    def foto(self, pagina, nome):
        if self.capturas:
            CAPTURAS.mkdir(parents=True, exist_ok=True)
            pagina.screenshot(path=str(CAPTURAS / f"{self.nome}-{nome}.png"))

    def api(self, pagina, metodo, url, corpo=None):
        """Chama a API de dentro da página (mesmos cookies e cabeçalhos do ponte.js)."""
        return pagina.evaluate("""([m, u, c]) => fetch(u, { method: m, credentials: 'same-origin', cache: 'no-store',
            headers: Object.assign({ 'X-Requested-With': 'tlh' }, c ? { 'Content-Type': 'application/json' } : {}), body: c ? JSON.stringify(c) : undefined })
            .then(r => r.json().then(j => ({ status: r.status, j }), () => ({ status: r.status, j: {} })))""", [metodo, "/" + url.lstrip("/"), corpo])

    def espera(self, cond, segundos=15, msg="condição não aconteceu"):
        fim = time.time() + segundos
        while time.time() < fim:
            v = cond()
            if v:
                return v
            time.sleep(0.25)
        raise AssertionError(msg)

    def passo(self, titulo, fn):
        self.n += 1
        if any(not ok for _, ok, _ in self.passos):
            self.passos.append((titulo, None, "não executado (um passo anterior falhou)"))
            return
        try:
            fn()
            self.passos.append((titulo, True, ""))
            print(f"  ok   {self.n:02d} {titulo}", flush=True)
        except Exception as e:
            det = (str(e).strip().splitlines() or [type(e).__name__])[0][:300]
            self.passos.append((titulo, False, det))
            print(f"  FALHOU {self.n:02d} {titulo}\n         {det}", flush=True)
            if os.environ.get("E2E_DEBUG"):
                traceback.print_exc()
            for nome, pg in (("painel", self.painel), ("site", self.site)):
                try:
                    CAPTURAS.mkdir(parents=True, exist_ok=True)
                    pg.screenshot(path=str(CAPTURAS / f"{self.nome}-FALHA-{self.n:02d}-{nome}.png"))
                except Exception:
                    pass

    def abrir_site(self):
        st = self.site
        st.goto(self.s.url + "/")
        st.locator(".go12").wait_for(state="visible")
        expect(st.locator("#pt-rodape")).to_be_visible()

    def abrir_resultados(self):
        self.abrir_site()
        self.site.locator(".go12").click()
        self.site.locator(".ci12[data-open]").first.wait_for(state="visible")

    def abrir_ficha(self):
        self.abrir_resultados()
        self.site.locator(".vm12").first.click()
        self.site.locator("a.nw12").wait_for(state="visible")
        self.espera(lambda: "f5" in self.site.evaluate("document.querySelector('.sc12').className"), msg="a ficha não abriu")
        time.sleep(0.8)   # animação da ficha

    def entrar_painel(self, senha):
        p = self.painel
        p.locator("#pt-login").wait_for()
        p.fill("#pt-email", EMAIL)
        p.fill("#pt-senha", senha)
        p.click("#pt-login button[type=submit]")

    def aba(self, qual):
        self.painel.locator(f'#c-app nav.tabs [data-tab="{qual}"]').click()

    def recarregar_painel(self):
        self.painel.reload()
        self.painel.locator("#c-app nav.tabs").wait_for()

    # ---------- o roteiro ----------
    def rodar(self):
        s = self.s
        print(f"\n=== {self.nome} ({s.url}) ===", flush=True)
        ctx_p, ctx_v = self.contexto(), self.contexto()          # dois navegadores separados: corretor e visitante
        p = self.painel = self.pagina(ctx_p, "painel")
        st = self.site = self.pagina(ctx_v, "site")
        g = {"foto": self.arq_foto}

        def criar_usuario():
            saida = s.comando("usuario", EMAIL, "Corretor de Teste")
            m = re.search(r": (\S{12,})\s*$", saida)
            assert m and "Acesso criado" in saida, saida
            g["temp"] = m.group(1)
            assert "senha temporária" in s.comando("usuarios")
        self.passo("cria o usuário pela linha de comando (python app.py usuario) e recebe a senha temporária", criar_usuario)

        def painel_fechado():
            st.goto(s.url + "/privacidade/")
            for rota in ("estado", "leads", "chamadas", "termo"):
                assert self.api(st, "GET", "api/painel/" + rota)["status"] == 401, rota
            for url in ("/.git/config", "/app/app.py", "/.env", "/dados/", "/compose.yaml", "/compose.producao.yaml"):
                assert st.request.get(s.url + url).status == 404, url
            p.goto(s.url + "/painel/")
            p.locator("#pt-login").wait_for()
            assert p.locator("#c-app").count() == 0, "o painel abriu sem login"
            self.entrar_painel("senha-errada-123")
            expect(p.locator("#pt-login .pt-msg")).to_have_text("E-mail ou senha incorretos.")
        self.passo("segurança básica: painel sem login não abre dados (401) e senha errada não entra; /.git/config e /app/app.py dão 404", painel_fechado)

        def primeiro_acesso():
            self.entrar_painel(g["temp"])
            p.locator("#pt-troca").wait_for()
            assert self.api(p, "GET", "api/painel/leads")["j"]["erro"] == "trocar_senha"
            self.foto(p, "01-troca-senha")
            # recarregar com a senha temporária volta para a troca (antes caía em "Não consegui carregar o painel agora")
            p.reload(); p.locator("#pt-troca").wait_for()
            expect(p.locator("body")).not_to_contain_text("Não consegui carregar o painel")
            p.fill("#pt-atual", g["temp"]); p.fill("#pt-nova", SENHA1); p.fill("#pt-rep", SENHA1)
            p.click("#pt-troca button[type=submit]")
            p.locator("#pt-troca").wait_for(state="detached")
        self.passo("entra no painel com a senha temporária e troca a senha (obrigatório)", primeiro_acesso)

        def termo():
            p.locator("#pt-termo").wait_for()
            assert p.locator("#c-app").count() == 0, "o painel abriu antes do aceite"
            r = self.api(p, "GET", "api/painel/estado")
            assert r["status"] == 403 and r["j"] == {"erro": "aceitar_termo", "versao": "v1"}, r
            expect(p.locator("#pt-termo-corpo")).to_contain_text("Você é o controlador")
            expect(p.locator("#pt-termo-corpo")).to_contain_text("A Loud House é a operadora")
            expect(p.locator("#pt-termo-corpo")).to_contain_text("Versão v1")
            expect(p.locator("#pt-termo-aceitar")).to_be_disabled()
            self.foto(p, "02-termo")
            caixa = p.locator("#pt-termo .pt-cartao").bounding_box()
            assert caixa["x"] >= 0 and caixa["x"] + caixa["width"] <= p.viewport_size["width"], "o termo passa da largura da tela"
            p.reload()                                   # recarregar não pula o termo
            p.locator("#pt-termo").wait_for()
            p.locator("#pt-termo-ok").check()
            p.click("#pt-termo-aceitar")
            p.locator("#c-app nav.tabs").wait_for()
            linhas = s.sql("select t.*, u.email as dono from termos t join usuarios u on u.id = t.usuario_id")
            assert len(linhas) == 1 and linhas[0]["dono"] == EMAIL and linhas[0]["versao"] == "v1" and linhas[0]["ip"] == "127.0.0.1" and linhas[0]["criado"], linhas
            p.reload()                                   # depois do aceite, não pede de novo
            p.locator("#c-app nav.tabs").wait_for()
            assert p.locator("#pt-termo").count() == 0
        self.passo("T24: a tela do termo aparece depois da senha; sem aceite a API dá 403; aceite fica no banco (usuário, versão, data, IP)", termo)

        def imovel():
            p.locator("#c-app [data-novo]").click()
            p.locator('#c-app [data-sheet] [data-t="casa"]').click()                     # tipo
            p.locator('#c-app [data-f="preco"]').click()
            p.locator('#c-app [data-sheet] input[aria-label="Preço"]').fill("850000")     # preço
            p.locator("#c-app [data-sheet] [data-k]").click()
            p.locator('#c-app [data-f="cidade"]').click()
            p.locator(f'#c-app [data-sheet] [data-c="{CIDADE}"]').click()                # cidade
            p.locator('#c-app [data-card] [data-foto="0"]').first.click()
            with p.expect_file_chooser() as fc:
                p.locator("#c-app [data-sheet] [data-add]").click()
            fc.value.set_files(g["foto"])                                                 # foto enviada pelo painel
            alvo = p.locator('#c-app [data-sheet] .fv img[src^="midia/"]')
            fim = time.time() + 40
            while not alvo.count():
                if p.locator("#pt-usar").count():        # aviso de foto pequena/escura/tremida: a de teste não deveria cair aqui
                    g["aviso_foto"] = True
                    p.click("#pt-usar")
                assert time.time() < fim, "a foto não chegou: " + (p.locator("#pt-aviso").inner_text() if p.locator("#pt-aviso").count() else "sem aviso")
                time.sleep(0.2)
            assert p.evaluate("e => e.complete && e.naturalWidth", alvo.element_handle()) > 0, "a miniatura da foto não carregou"
            self.foto(p, "03-foto")
            p.locator("#c-app [data-sheet] [data-fecha]").click()
            expect(p.locator("#c-app [data-pub]")).to_have_text("Publicar no site")
            self.foto(p, "04-cartao")
            assert self.api(st, "GET", "api/estado")["j"]["imoveis"] == [], "apareceu no site antes de publicar"
            p.locator("#c-app [data-pub]").click()
            expect(p.locator("#c-app .toast")).to_contain_text("Publicado")
            expect(p.locator("#c-app .item .tag").first).to_have_text(re.compile("site", re.I))
            expect(p.locator("#c-app .item .tag.cod")).to_have_text(re.compile(r"^ES-\d{3}$"))       # T42
            fotos = s.sql("select arquivo, largura from fotos order by id")
            assert [f["largura"] for f in fotos] == [1280, 2000], fotos          # 2 tamanhos, sem ampliar
            from PIL import Image
            im = Image.open(os.path.join(s.dados, "midia", fotos[0]["arquivo"]))
            assert im.format == "WEBP" and not im.getexif() and "exif" not in im.info, "a foto guardada ainda tem EXIF"
            pub = self.api(st, "GET", "api/estado")["j"]["imoveis"]
            assert len(pub) == 1 and pub[0]["tipo"] == "casa" and pub[0]["cidade"] == CIDADE and pub[0]["preco"] == 850000, pub
            assert pub[0]["fotos"][0]["s"] == "midia/" + fotos[0]["arquivo"] and pub[0]["fotos"][0]["g"] == "midia/" + fotos[1]["arquivo"]
        self.passo("cadastra um imóvel pela interface (tipo, preço, cidade, 1 foto enviada pelo painel) e publica", imovel)

        def site_mostra():
            self.abrir_site()
            self.foto(st, "05-site-inicio")
            g["rodape_inicio"] = st.evaluate(RODAPE_JS)
            st.locator(".go12").click()
            cartao = st.locator(".ci12[data-open]").first
            cartao.wait_for(state="visible")
            expect(st.locator(".sc12")).to_contain_text("1 casa disponível em " + CIDADE)
            expect(st.locator(".sc12")).to_contain_text("R$850 mil")
            img = cartao.locator("img").first
            self.espera(lambda: st.evaluate("e => e.complete && e.naturalWidth > 0 && /\\/midia\\/[a-f0-9]{32}\\.webp/.test(e.currentSrc)", img.element_handle()), msg="a foto do imóvel não carregou no site")
            time.sleep(1)
            self.foto(st, "06-site-resultados")
            g["rodape_resultados"] = st.evaluate(RODAPE_JS)
        self.passo("abre o site em outro navegador e vê o imóvel publicado (cidade, preço e a foto enviada)", site_mostra)

        def rodape():
            for tela in ("rodape_inicio", "rodape_resultados"):
                r = g[tela]
                assert r["visivel"], f"{tela}: a linha não aparece"
                assert r["texto"] == "Erivelto Santos · Corretor de imóveis · CRECI 63.464 · Privacidade · Termos · Quero vender", r["texto"]
                assert r["links"] == [["Privacidade", "privacidade/"], ["Termos", "termos/"], ["Quero vender", "#vender"]], r["links"]
                assert r["link"] == "Privacidade" and r["href"] == "privacidade/" and r["destino"] == s.url + "/privacidade/", r
                assert r["dentro"] and r["linkPorCima"], f"{tela}: fora da tela ou o link está coberto: {r}"
                assert not r["cobre"], f"{tela}: a linha cobre {r['cobre']}"
                assert r["altura"] <= 44, f"{tela}: a linha ficou alta demais ({r['altura']} px)"
            st.locator(".vm12").first.click()
            st.locator("a.nw12").wait_for(state="visible")
            self.espera(lambda: not st.evaluate(RODAPE_JS)["visivel"], msg="na ficha do imóvel a linha deveria sumir (ali ficam os botões)")
            st.locator(".x12").click()
            self.espera(lambda: st.evaluate(RODAPE_JS)["visivel"], msg="ao voltar da ficha a linha deveria reaparecer")
            st.locator("#pt-rodape a").nth(1).click()
            st.wait_for_url(s.url + "/termos/")
            expect(st.locator("h1")).to_have_text("Termos de uso")
            st.locator("a.pv-volta").click()
            st.wait_for_url(s.url + "/")
            st.locator("#pt-rodape a").first.click()
            st.wait_for_url(s.url + "/privacidade/")
            expect(st.locator("h1")).to_have_text("Aviso de privacidade")
        self.passo("T05, T04 e T45: linha com nome, CRECI 63.464 e links Privacidade, Termos e Quero vender visível na busca e nos resultados, sem cobrir botão; os links abrem /privacidade/ e /termos/", rodape)

        def whatsapp_sem_numero():
            assert self.api(st, "GET", "api/estado")["j"]["whatsapp_numero"] is None
            self.abrir_ficha()
            href = st.locator("a.nw12").get_attribute("href")
            assert href.startswith("https://wa.me/?text=") and "5551989498872" not in href, href
            antes = len(ctx_v.pages)
            st.locator("a.nw12").click()
            expect(st.locator("#pt-aviso")).to_contain_text("WhatsApp do corretor ainda não está disponível")
            assert st.locator(".tw11").count() == 0, "apareceu também a mensagem de prévia"
            self.foto(st, "07-whatsapp-sem-numero")
            time.sleep(1.2)
            assert len(ctx_v.pages) == antes and not self.wa_pedidos, f"abriu o WhatsApp sem número salvo: {self.wa_pedidos}"
            assert s.sql("select count(*) as n from chamadas")[0]["n"] == 0, "contou chamada sem abrir o WhatsApp"
            assert "5551989498872" not in st.content().replace('"5551989498872"', ""), "o número de teste aparece na página"
        self.passo("T23: sem número salvo no painel, o botão do WhatsApp avisa e não abre número nenhum (nem o de teste)", whatsapp_sem_numero)

        def visitante():
            self.abrir_resultados()
            st.locator(".li12").click()
            nome, wa, entrar = st.locator(".ui12.un:visible"), st.locator(".ui12.uw:visible"), st.locator(".ub12:visible")
            nome.fill(VISITANTE)
            wa.fill(VISITANTE_WA)
            expect(entrar).to_be_disabled()                       # sem marcar o aceite, não entra
            link = st.locator(".ak12:visible a")
            expect(link).to_have_text("aviso de privacidade")
            assert st.evaluate("a => a.href", link.element_handle()).rstrip("/") == s.url + "/privacidade"
            self.foto(st, "08-login-visitante")
            assert s.sql("select count(*) as n from contas")[0]["n"] == 0
            st.locator(".uk12:visible").check()
            expect(entrar).to_be_enabled()
            entrar.click()
            self.espera(lambda: (self.api(st, "GET", "api/estado")["j"].get("conta") or {}).get("nome") == VISITANTE, msg="o visitante não ficou conectado")
            assert s.sql("select versao from aceites") == [{"versao": "v3"}]
            c = s.sql("select nome_cif, wa_cif from contas")[0]
            assert VISITANTE.encode() not in bytes(c["nome_cif"]) and b"99999" not in bytes(c["wa_cif"]), "nome/WhatsApp sem cifra no banco"
            self.espera(lambda: s.sql("select count(*) as n from leads")[0]["n"] == 1, msg="o contato não chegou ao servidor")
            self.recarregar_painel()
            self.aba("contatos")
            expect(p.locator("#c-app .main")).to_contain_text(VISITANTE)
            expect(p.locator("#c-app .main a.wa")).to_have_attribute("href", "https://wa.me/5551999991234")
            expect(p.locator('#c-app nav.tabs [data-tab="contatos"] .n')).to_have_text("1")
            self.foto(p, "09-painel-contatos")
        self.passo("visitante entra com nome + WhatsApp (só com o aceite do aviso v3) e vira contato no painel", visitante)

        def troca_whatsapp(numero, digitado, bonito):
            def f():
                self.aba("perfil")
                p.locator('#pt-conta [data-pt="wa"]').click()
                p.locator("#pt-wa #ep34w").fill(digitado)
                expect(p.locator("#pt-wa #ep34l")).to_have_attribute("href", "https://wa.me/" + numero)
                p.locator("#pt-wa #ep34s").click()
                expect(p.locator("#pt-wa #ep34m")).to_have_text("Salvo. O site já usa este número.")
                self.foto(p, "10-painel-whatsapp")
                p.locator("#pt-wa-fechar").click()
                expect(p.locator("#pt-conta-wa")).to_have_text(bonito)
                assert self.api(st, "GET", "api/estado")["j"]["whatsapp_numero"] == numero
            return f
        self.passo("salva o WhatsApp do site no painel (Perfil > Conta)", troca_whatsapp(WA1, "(51) 99876-5432", "+55 51 99876-5432"))

        def whatsapp_de_verdade():
            self.abrir_ficha()
            href = st.locator("a.nw12").get_attribute("href")
            assert href.startswith(f"https://wa.me/{WA1}?text="), href
            with ctx_v.expect_page() as nova:
                st.locator("a.nw12").click()
            aba = nova.value
            aba.wait_for_load_state()
            from urllib.parse import parse_qs, urlsplit
            u = urlsplit(aba.url)
            msg = parse_qs(u.query)["text"][0]
            assert u.netloc == "wa.me" and u.path == "/" + WA1, aba.url
            assert msg.startswith("Olá, Erivelto! Vi no seu site") and CIDADE in msg and "850" in msg, msg
            g["msg"] = msg
            aba.close()
            assert st.locator("#pt-aviso").count() == 0 and st.locator(".tw11").count() == 0, "apareceu o aviso de prévia no lugar do WhatsApp"
            self.espera(lambda: s.sql("select count(*) as n from chamadas")[0]["n"] == 1, msg="a chamada não chegou ao servidor")
            ch = s.sql("select * from chamadas")[0]
            assert ch["cidade"] == CIDADE and set(ch) == {"id", "imovel_id", "nm", "o", "cidade", "criado"}, ch
            r = self.api(p, "GET", "api/painel/chamadas")["j"]["chamadas"]
            assert len(r) == 1 and r[0]["c"] == CIDADE, r
            self.recarregar_painel()
            self.aba("perfil")
            expect(p.locator("#pt-conta-toques")).to_have_text("Toques no botão do WhatsApp do site: 1")
            self.foto(p, "11-painel-perfil")
        self.passo("T23: com número salvo, o botão abre https://wa.me/55… com a mensagem pronta; a chamada aparece no painel", whatsapp_de_verdade)

        self.passo("troca o WhatsApp no painel por outro número", troca_whatsapp(WA2, "51 99111 2222", "+55 51 99111-2222"))

        def site_reflete():
            self.abrir_ficha()
            assert st.locator("a.nw12").get_attribute("href").startswith(f"https://wa.me/{WA2}?text=")
            st.goto(s.url + "/privacidade/")
            expect(st.locator("#pv-wa-link")).to_have_attribute("href", "https://wa.me/" + WA2)
        self.passo("o site (e a página de privacidade) passam a usar o número novo", site_reflete)

        def tarefas_39_45():
            from urllib.parse import parse_qs, urlsplit
            # T42: o imóvel criado pelo painel ganhou código. T39: marcar "Reservado" pela tela e publicar.
            cod = self.api(p, "GET", "api/painel/estado")["j"]["imoveis"][0]["cod"]
            assert re.fullmatch(r"ES-\d{3}", cod), cod
            self.recarregar_painel(); self.aba("imoveis")
            p.locator("#c-app [data-abrir]").first.click()
            p.locator('#c-app [data-si="res"]').click()
            expect(p.locator("#c-app [data-pub]")).to_have_text("Publicar mudanças")
            p.locator("#c-app [data-pub]").click()
            expect(p.locator("#c-app [data-abrir]").first).to_contain_text("Reservado")
            # T40 e T41: um sobrado para alugar e um galpão vendido (escondido), pela API do painel
            e = self.api(p, "GET", "api/painel/estado")["j"]
            base = {k: v for k, v in e["imoveis"][0].items() if k not in ("pub", "id", "cod", "sit")}
            novos = [dict(base, id="alug1", cod="ES-901", tipo="sobrado", final="aluguel", preco=2500, fin=False),
                     dict(base, id="vend1", cod="ES-902", tipo="galpao", sit="vend")]
            assert self.api(p, "PUT", "api/painel/estado", {"rev": e["rev"], "imoveis": novos})["status"] == 200
            for i in novos:
                assert self.api(p, "POST", f"api/painel/imoveis/{i['id']}/publicar", {})["status"] == 200
            self.abrir_resultados()
            ids = st.evaluate("[...document.querySelectorAll('article.cd12')].map(a => a.dataset.id)")
            assert sorted(ids) == sorted([e["imoveis"][0]["id"], "alug1"]), ids                     # o vendido escondido não aparece
            selos = st.evaluate("Object.fromEntries([...document.querySelectorAll('article.cd12')].map(a => [a.dataset.id, a.querySelector('.pt-selos') ? a.querySelector('.pt-selos').innerText.replace(/\\s+/g, ' ') : '']))")
            assert "RESERVADO" in selos[e["imoveis"][0]["id"]].upper() and cod in selos[e["imoveis"][0]["id"]], selos
            assert selos["alug1"].replace("\n", " ") in ("Para alugar ES-901",), selos
            assert "2.500/mês" in st.locator("article.cd12[data-id=alug1]").inner_text()
            self.foto(st, "13b-site-selos")
            # filtro de tipo: "Para alugar" é uma categoria
            st.locator(".fd12[data-f='t']").first.click()
            opcoes = st.locator("[role=menuitemcheckbox]").all_inner_texts()
            assert any(o.startswith("Para alugar") for o in opcoes) and any(o.startswith("Casa") for o in opcoes), opcoes
            assert not any(o.startswith("Galpão") for o in opcoes), opcoes
            st.keyboard.press("Escape"); st.mouse.click(5, 5)
            # T44: pedir visita na ficha do imóvel reservado (o visitante entrou no site no passo 9)
            self.abrir_ficha()
            st.locator(".pt-visita").click()
            st.locator("#pt-visita .pt-chip").nth(1).click()          # amanhã
            st.locator("#pt-visita .pt-chip[data-v=tarde]").click()
            with ctx_v.expect_page() as nova:
                st.locator("#pt-visita-ir").click()
            aba = nova.value; aba.wait_for_load_state()
            msg = parse_qs(urlsplit(aba.url).query)["text"][0]; aba.close()
            assert "(cód. " + cod + ")" in msg and "que está reservado, e quero marcar uma visita amanhã" in msg and "à tarde." in msg, msg
            self.espera(lambda: (s.sql("select pedido from leads where pedido is not null") or [{}])[0].get("pedido", "").startswith("amanhã"),
                        msg="a visita pedida não chegou ao contato")
            # T45: quero vender (outro navegador, sem login)
            o = self.pagina(self.contexto(), "outro")
            o.goto(s.url + "/"); o.locator("#pt-rodape a[data-pt-vender]").click()
            o.locator("#pt-vender .pt-chip[data-v=terreno]").click()
            o.fill("#pt-v-cidade", "Rolante"); o.fill("#pt-v-nome", "Pedro Lima"); o.fill("#pt-v-wa", "(51) 98888-7777")
            expect(o.locator("#pt-v-enviar")).to_be_disabled()
            o.check("#pt-v-aceite"); o.click("#pt-v-enviar")
            expect(o.locator("#pt-v-ok")).to_contain_text("O Erivelto vai falar com você")
            assert s.sql("select vender from leads where vender is not null")[0]["vender"]["cidade"] == "Rolante"
            # T43: no painel, o contato da visita muda de situação e ganha anotação; a planilha sai com os dois
            self.recarregar_painel(); self.aba("contatos")
            caixa = p.locator("#c-app .lead", has_text="Pediu visita")
            expect(caixa).to_contain_text(cod)
            caixa.locator("[data-sit-l]").select_option("visita")
            self.espera(lambda: s.sql("select count(*) as n from leads where situacao = 'visita'")[0]["n"] == 1, msg="a situação não foi salva")
            caixa = p.locator("#c-app .lead", has_text="Pediu visita")
            caixa.locator("[data-nota-l]").fill("Confirmar no sábado"); p.locator("#c-app h1").click()
            self.espera(lambda: s.sql("select count(*) as n from leads where nota = 'Confirmar no sábado'")[0]["n"] == 1, msg="a anotação não foi salva")
            expect(p.locator("#c-app .lead", has_text="Quer vender")).to_contain_text("Terreno em Rolante")
            with p.expect_download() as d:
                p.locator("#c-app [data-csv]").click()
            csv = open(d.value.path(), encoding="utf-8-sig").read()
            assert "Visita marcada" in csv and "Confirmar no sábado" in csv and "Terreno em Rolante" in csv, csv[:300]
            self.foto(p, "13c-painel-contatos")
            # quem pediu para vender também apaga os próprios dados pela página de privacidade (e o pedido sai junto)
            o.goto(s.url + "/privacidade/"); o.fill("#pv-nome", "pedro lima"); o.fill("#pv-wa", "51 98888-7777")
            o.click("#pv-apagar button[type=submit]")
            expect(o.locator("#pv-msg")).to_have_text("Pronto: seus dados foram apagados.")
            assert s.sql("select count(*) as n from leads where vender is not null")[0]["n"] == 0
            o.context.close()
        self.passo("T39–T45: reservado e código no site; vendido escondido; aluguel na categoria Para alugar; pedir visita; quero vender; situação, anotação e planilha dos contatos", tarefas_39_45)

        def privacidade():
            st.goto(s.url + "/privacidade/")
            expect(st.locator("#pv-versao")).to_contain_text("Versão v3")
            for i in ("quem", "dados", "base", "tempo", "quem-ve", "cookies", "seguranca", "direitos", "mudancas", "versao"):
                expect(st.locator("h2#" + i)).to_be_visible()
            assert st.evaluate("document.documentElement.scrollWidth <= innerWidth"), "a página de privacidade passa da largura da tela"
            self.foto(st, "12-privacidade")
            st.click("#pv-ver")
            expect(st.locator("#pv-dados")).to_contain_text(VISITANTE)
            expect(st.locator("#pv-dados")).to_contain_text('"versao": "v3"')
            outro = self.contexto()                         # outro aparelho, sem estar conectado: nome errado não apaga
            o = self.pagina(outro, "outro")
            o.goto(s.url + "/privacidade/")
            o.fill("#pv-nome", "Outra Pessoa"); o.fill("#pv-wa", VISITANTE_WA)
            o.click("#pv-apagar button[type=submit]")
            expect(o.locator("#pv-msg")).to_contain_text("Não conseguimos confirmar")
            assert s.sql("select count(*) as n from contas")[0]["n"] == 1
            o.fill("#pv-nome", VISITANTE.lower())
            o.click("#pv-apagar button[type=submit]")
            expect(o.locator("#pv-msg")).to_have_text("Pronto: seus dados foram apagados.")
            outro.close()
            for tabela in ("contas", "visitas", "aceites", "leads"):
                assert s.sql(f"select count(*) as n from {tabela}")[0]["n"] == 0, tabela
            st.click("#pv-ver")
            expect(st.locator("#pv-dados")).to_contain_text("Para ver os dados, entre no site")
            self.recarregar_painel()
            self.aba("contatos")
            expect(p.locator("#c-app .main")).to_contain_text("pelo site aparece aqui.")
        self.passo("T03: aviso de privacidade v3 com as seções; ver os meus dados; apagar os dados some com o contato do painel", privacidade)

        def aba_site():
            self.aba("site")
            quadro = p.frame_locator("#c-app iframe.sitef")
            quadro.locator(".go12").wait_for(state="visible")
            self.foto(p, "13-painel-aba-site")
        self.passo("a aba Site do painel mostra o site dentro do painel", aba_site)

        def trocar_senha():
            self.aba("perfil")
            p.locator('#pt-conta [data-pt="senha"]').click()
            p.fill("#pt-atual", "senha-que-nao-e"); p.fill("#pt-nova", SENHA2); p.fill("#pt-rep", SENHA2)
            p.click("#pt-troca button[type=submit]")
            expect(p.locator("#pt-troca .pt-msg")).to_have_text("A senha atual não confere.")
            p.fill("#pt-atual", SENHA1)
            p.click("#pt-troca button[type=submit]")
            p.locator("#pt-troca").wait_for(state="detached")
            assert self.api(p, "GET", "api/painel/leads")["status"] == 200
        self.passo("troca a senha pelo painel (Perfil > Conta > Trocar senha)", trocar_senha)

        def sair():
            self.aba("perfil")
            self.foto(p, "14-painel-conta")
            p.locator('#pt-conta [data-pt="sair"]').click()
            p.locator("#pt-login").wait_for()
            assert p.locator("#c-app").count() == 0
            assert self.api(p, "GET", "api/painel/estado")["status"] == 401
            assert s.sql("select count(*) as n from sessoes")[0]["n"] == 0
            self.entrar_painel(SENHA1)                              # a senha antiga não vale mais
            expect(p.locator("#pt-login .pt-msg")).to_have_text("E-mail ou senha incorretos.")
            self.entrar_painel(SENHA2)                              # a nova entra direto: sem troca e sem termo de novo
            p.locator("#c-app nav.tabs").wait_for()
            assert p.locator("#pt-termo").count() == 0 and p.locator("#pt-troca").count() == 0
            expect(p.locator("#c-app .item .pr").first).to_have_text("R$ 850 mil")
            self.aba("perfil")
            p.locator('#pt-conta [data-pt="sair"]').click()
            p.locator("#pt-login").wait_for()
        self.passo("sai do painel: volta para o login, a sessão acaba no servidor; senha antiga não entra, a nova entra", sair)

        def sem_erros():
            assert not self.erros_js, self.erros_js
            acoes = [a["acao"] for a in s.sql("select acao from acessos order by id")]
            assert acoes == ["login_falhou", "login", "senha_trocada", "termo_aceito", "senha_falhou", "senha_trocada", "login_falhou", "login"], acoes
        self.passo("nenhum erro de JavaScript nas páginas; registro de acessos do painel completo", sem_erros)

        ctx_p.close(); ctx_v.close()
        return self.passos


def main(args):
    capturas = "--capturas" in args
    quais = [a for a in args if not a.startswith("--")] or ["celular", "pc"]
    resultado = {}
    with tempfile.TemporaryDirectory(prefix="erv-e2e-") as tmp, sync_playwright() as pw:
        foto = foto_de_teste(tmp)
        iphone = {k: v for k, v in pw.devices["iPhone 13"].items() if k != "default_browser_type"}
        perfis = {"celular": iphone, "pc": {"viewport": {"width": 1366, "height": 768}}}
        navegador = pw.chromium.launch()
        for nome in quais:
            with Servidor() as srv:                      # banco e fotos novos para cada aparelho
                resultado[nome] = Roteiro(nome, navegador, perfis[nome], srv, capturas, foto).rodar()
        navegador.close()
    print("\n=== resumo ===")
    falhou = False
    for nome, passos in resultado.items():
        ok = sum(1 for _, o, _ in passos if o)
        print(f"{nome}: {ok} de {len(passos)} passos passaram")
        for titulo, o, det in passos:
            if not o:
                falhou = True
                print(f"   {'FALHOU' if o is False else 'não rodou'}: {titulo} {('· ' + det) if det else ''}")
    if capturas:
        print("Imagens em", CAPTURAS)
    return 1 if falhou else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
