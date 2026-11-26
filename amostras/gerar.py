#!/usr/bin/env python3
"""Gera a amostra de um corretor a partir do site atual do Erivelto (pasta site/).

Muda só: nome, logo, CRECI, cidade, WhatsApp e os 3 imóveis. Mecânica, intro,
loading, painel e cor de destaque ficam iguais. A amostra é estática (modo prévia:
o painel salva no navegador de quem abre), pronta para o Cloudflare.

Uso:  python3 amostras/gerar.py amostras/velleda/config.json
Sai:  amostras/<slug>/site/  (a pasta inteira vai para loudhouse.com.br/amostra/<slug>/)
"""
import json, pathlib, re, shutil, sys

RAIZ = pathlib.Path(__file__).resolve().parent.parent
SITE = RAIZ / "site"
TEXTOS = {".html", ".js", ".css"}


def trocas(c):
    n1, n2, nome = c["nome1"], c["nome2"], c["nome"]
    fem = c.get("artigo", "o") == "a"
    art = {"o": "a", "O": "A", "do": "da", "Do": "Da", "ao": "à", "Ao": "À",
           "pelo": "pela", "Pelo": "Pela", "no": "na", "No": "Na"} if fem else {}
    lista = [
        (re.compile(r"Erivelto <em([^>]*)>Santos</em>"), lambda m: f"{n1} <em{m.group(1)}>{n2}</em>"),
        ("Erivelto Santos", nome),
        (re.compile(r"\b(o|O|do|Do|ao|Ao|pelo|Pelo|no|No) Erivelto\b"), lambda m: f"{art.get(m.group(1), m.group(1))} {n1}"),
        ("Erivelto", n1),
        ("Corretor de imóveis", c["sub"]),
        ("corretor de imóveis", c["sub_min"]),
        ("CRECI 63.464", "CRECI " + c["creci"]),
        ("63.464", c["creci"]),
        ("Santo Antônio da Patrulha e região", c["cidade"] + " e região"),
        ("5551989498872", c["whatsapp"]),
        ("eriveltosantosimoveis.com.br", c["dominio"]),
        ("contatos-erivelto-", f"contatos-{c['slug']}-"),
        ("/^ES-", "/^" + c.get("cod", "ES") + "-"),
        ("return 'ES-' +", "return '" + c.get("cod", "ES") + "-' +"),
        ("(ES-001…)", "(" + c.get("cod", "ES") + "-001…)"),
        ('return["Santo Antônio da Patrulha"]', f'return["{c["cidade"]}"]'),
        ('atende:["Santo Antônio da Patrulha"]', f'atende:["{c["cidade"]}"]'),
        ('l.atende=["Santo Antônio da Patrulha"]', f'l.atende=["{c["cidade"]}"]'),
        ('modo:"perto",cidade:"Santo Antônio da Patrulha"', f'modo:"perto",cidade:"{c["cidade"]}"'),
        ('nomes:["Osório","Tramandaí","Taquara","Caraá"]', "nomes:" + json.dumps(c.get("vizinhas", []), ensure_ascii=False)),
    ]
    for k in ["site_v11_cid", "site_v126_sim", "site_v12_estado", "erivelto_fotos_liberadas",
              "erivelto_conta", "erivelto_fila", "erivelto_wa_site"]:
        lista.append((k, f"{c['slug']}_{k}"))   # cada amostra guarda no navegador separada das outras
    lista.append(('src="lg/logo.webp" alt="Logo', 'src="lg/logo_full.webp" alt="Logo'))
    lista.append(('.blogo").src="lg/logo.webp"', '.blogo").src="lg/logo_full.webp"'))
    return lista


def troca_imoveis(s, c):
    a = s.find('imoveis:[{id:"sap1"')
    if a < 0:
        return s, 0
    b = s.find("],leads:[]", a)
    novo = "imoveis:" + json.dumps(c["imoveis"], ensure_ascii=False)
    s = s[:a] + novo + s[b + 1:]
    s = s.replace('tipos:{casa:!0,apartamento:!0,terreno:!0},exemplo:!1,imoveis:',
                  "tipos:" + json.dumps({t: True for t in c["tipos"]}) + ",exemplo:!1,imoveis:")
    return s, 1


def main(cfg_path):
    cfg_path = pathlib.Path(cfg_path).resolve()
    c = json.loads(cfg_path.read_text(encoding="utf-8"))
    base = cfg_path.parent
    out = base / "site"
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(SITE, out, ignore=shutil.ignore_patterns("casa"))
    (out / "casa").mkdir()
    for f in (base / "fotos").iterdir():
        shutil.copy2(f, out / "casa" / f.name)
    for nome, src in c["logo"].items():   # logo_full, logo (marca), es (marca), ring/q* (vazios)
        shutil.copy2(base / src, out / "lg" / nome)
    lista = trocas(c)
    rel = {}
    for p in out.rglob("*"):
        if p.suffix not in TEXTOS or not p.is_file():
            continue
        s = p.read_text(encoding="utf-8")
        s0 = s
        if p.name == "index.html":
            s, n = troca_imoveis(s, c)
            rel[str(p.relative_to(out)) + " (imóveis)"] = n
        for a, b in lista:
            s = a.sub(b, s) if hasattr(a, "sub") else s.replace(a, b)
        if s != s0:
            p.write_text(s, encoding="utf-8")
            rel[str(p.relative_to(out))] = "ok"
    sobra = {str(p.relative_to(out)): p.read_text(encoding="utf-8").count("Erivelto")
             for p in out.rglob("*") if p.suffix in TEXTOS and p.is_file()}
    print(json.dumps({"saida": str(out), "trocados": rel, "Erivelto_que_sobrou": {k: v for k, v in sobra.items() if v}}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main(sys.argv[1])
