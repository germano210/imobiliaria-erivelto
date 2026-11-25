#!/usr/bin/env python3
"""Remendos do site/index.html (o site minificado que veio do artefato "Erivelto Santos · Corretor de imóveis").

O index.html é um arquivo só, minificado, gerado no artefato. As tarefas T39–T45 precisaram mexer nele. Para não perder
as mudanças quando o artefato for trazido de novo, cada mudança é uma troca pequena (texto antigo -> texto novo) listada
aqui. Quase todas só chamam funções do site/ponte.js (PONTE.vitrine, PONTE.selos, PONTE.msg, PONTE.botaoVisita), onde
fica a lógica legível.

Uso (na raiz do projeto):
    python3 remendos.py             aplica no site/index.html (pode rodar de novo: o que já está aplicado fica como está)
    python3 remendos.py --conferir  só confere; sai com erro se faltar algum (o pytest roda isto)
    python3 remendos.py ARQUIVO     aplica em outro arquivo (ex.: um index.html novo do artefato)

Se uma troca não achar o texto antigo, o artefato mudou naquele trecho: abra o index.html novo, ache o trecho
equivalente e ajuste o "antigo" daqui. Não aplique pela metade.
"""
import pathlib
import sys

RAIZ = pathlib.Path(__file__).resolve().parent
ALVO = RAIZ / "site" / "index.html"

P = "window.PONTE&&PONTE"

G1_NOVOS = (',sobrado:{s:"sobrado",p:"sobrados",a:"do",o:"o",n:"Nenhum",S:"Sobrado"}'
            ',sitio:{s:"sítio",p:"sítios e chácaras",a:"do",o:"o",n:"Nenhum",S:"Sítio ou chácara"}'
            ',sala:{s:"sala comercial",p:"salas comerciais",a:"da",o:"a",n:"Nenhuma",S:"Sala comercial"}'
            ',galpao:{s:"galpão",p:"galpões",a:"do",o:"o",n:"Nenhum",S:"Galpão"}'
            ',aluguel:{s:"imóvel",p:"imóveis para alugar",a:"do",o:"o",n:"Nenhum",S:"Para alugar"}')
K4_NOVOS = ("sobrado:'<path d=\"M4 10.5 12 4l8 6.5\"/><path d=\"M6 9v11h12V9\"/><path d=\"M6 14.4h12\"/><path d=\"M10.5 20v-3.4h3V20\"/><path d=\"M9 11.4h2M13 11.4h2\"/>',"
            "sitio:'<path d=\"M3.6 19.6h16.8\"/><circle cx=\"8\" cy=\"9\" r=\"3.6\"/><path d=\"M8 12.6v7\"/><path d=\"M13 19.6v-5M16.5 19.6v-5M20 19.6v-5M12.4 16.2h7.6\"/>',"
            "sala:'<rect x=\"4.5\" y=\"8\" width=\"15\" height=\"11\" rx=\"1.5\"/><path d=\"M9.5 8V6.2a1.2 1.2 0 0 1 1.2-1.2h2.6a1.2 1.2 0 0 1 1.2 1.2V8M4.5 13h15\"/>',"
            "galpao:'<path d=\"M3.6 19.6V10L12 5l8.4 5v9.6\"/><path d=\"M3.6 19.6h16.8\"/><path d=\"M8 19.6v-6h8v6M8 16.6h8\"/>',"
            "aluguel:'<circle cx=\"8\" cy=\"12\" r=\"3.6\"/><path d=\"M11.6 12h8.4M17 12v3M19.8 12v2.4\"/>',")

# (nome, tarefa, texto antigo, texto novo). Cada texto antigo aparece UMA vez no artefato.
REMENDOS = [
    ("fotos livres: o corretor escolhe no painel (foto.l); sem escolha, 3 livres e borra da 4ª", "R86k",
     'function s4(L){return L>=2&&!o.lib}',
     'function s4(L){if(o.lib)return!1;var m=v1&&J1(v1.id),f=m&&m.fotos&&m.fotos[L];return f&&typeof f.l==="boolean"?!f.l:L>=3}'),
    ("miniaturas da ficha: todas as fotos (antes só 4)", "R86k",
     'R.innerHTML=L.fotos.slice(0,4).map(function(M,B){',
     'R.innerHTML=L.fotos.map(function(M,B){'),
    ("cartão de entrar: mostra as fotos que estão travadas para este imóvel", "R86k",
     'Q=B&&B.fotos.length>=3?B.fotos.slice(2,4):[]',
     'Q=B?B.fotos.filter(function(x,i){return x&&(typeof x.l==="boolean"?!x.l:i>=3)}).slice(0,2):[]'),
    ("teclado do celular não encolhe o site (o cenário não deforma)", "R86f",
     '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
     '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,interactive-widget=resizes-visual">'),
    ("tipos novos e a categoria Para alugar", "T41/T40",
     'terreno:{s:"terreno",p:"terrenos",a:"do",o:"o",n:"Nenhum",S:"Terreno"}},E7=["casa","apartamento","terreno"]',
     'terreno:{s:"terreno",p:"terrenos",a:"do",o:"o",n:"Nenhum",S:"Terreno"}' + G1_NOVOS
     + '},E7=["casa","sobrado","apartamento","terreno","sitio","sala","galpao","aluguel"]'),
    ("ícones dos tipos novos no mapa", "T41/T40", "k4={casa:", "k4={" + K4_NOVOS + "casa:"),
    ("tipo sem chave em tipos conta como ligado (lista)", "T41",
     "function X0(){return E7.filter(function(a){return G1.d.tipos[a]})}",
     "function X0(){return E7.filter(function(a){return G1.d.tipos[a]!==!1})}"),
    ("tipo sem chave em tipos conta como ligado (imóveis)", "T41",
     "return VL().filter(function(e){return a.tipos[e.tipo]})}",
     "return VL().filter(function(e){return a.tipos[e.tipo]!==!1})}"),
    ("tipo sem chave em tipos conta como ligado (busca)", "T41",
     "i.t=i.t.filter(function(t){return G1.d.tipos[t]})",
     "i.t=i.t.filter(function(t){return G1.d.tipos[t]!==!1})"),
    ("vitrine: vendido sai, aluguel vira categoria, código", "T39/T40/T42",
     "e.push(r)}return e}function X0(){",
     "e.push(r)}return " + P + ".vitrine?PONTE.vitrine(e):e}function X0(){"),
    ("nome automático usa o tipo de verdade (não 'Para alugar')", "T40",
     "var e=g1[a&&a.tipo]||g1.casa,r=a&&a.infos||[]",
     "var e=g1[a&&(a.tr||a.tipo)]||g1.casa,r=a&&a.infos||[]"),
    ("preço do aluguel por dia, mês ou ano, sem preço do m²", "T40",
     "function E8(a,e,r){var n=S8(a),l=E1(a.preco),",
     'function E8(a,e,r){var n=a.alug?0:S8(a),l=a.alug?(' + P + '.precoAlug?PONTE.precoAlug(a):E1(a.preco)):E1(a.preco),'),
    ("preço do aluguel por dia, mês ou ano na ficha", "T40",
     "d.textContent=E1(L.preco),d.dataset.fin=L.id,",
     'd.textContent=L.alug?(' + P + '.precoAlug?PONTE.precoAlug(L):E1(L.preco)):E1(L.preco),d.dataset.fin=L.id,'),
    ("filtro de preço não vale para aluguel", "T40",
     'function o6(L){return i.p==="qualquer"||',
     'function o6(L){return!!L.alug||i.p==="qualquer"||'),
    ("selos no cartão (código, aluguel, reservado, vendido)", "T39/T40/T42",
     "(a.ex?'<span class=\"ex12\">exemplo</span>':\"\")+\"</div>\"",
     "(a.ex?'<span class=\"ex12\">exemplo</span>':\"\")+(" + P + ".selos?PONTE.selos(a):\"\")+\"</div>\""),
    ("selos na ficha", "T39/T40/T42",
     'e(".pt12t",T).innerHTML="Informações "+t.a+" <b>"+t.s+"</b>";',
     'e(".pt12t",T).innerHTML="Informações "+t.a+" <b>"+t.s+"</b>"+(' + P + '.selos?PONTE.selos(L,1):"");'),
    ("selos no topo da ficha (layout com abas)", "T39/T40/T42",
     '"<small>"+j(R2(a))+" · "+j(a.cidade)+"</small></div>"',
     '"<small>"+j(R2(a))+" · "+j(a.cidade)+"</small>"+(' + P + '.selos?PONTE.selos(a,1):"")+"</div>"'),
    ("mensagem do WhatsApp (cartão)", "T39/T40/T42",
     'quero mais informações.";return"https://wa.me/"+h8+"?text="+encodeURIComponent(r)}',
     'quero mais informações.";return"https://wa.me/"+h8+"?text="+encodeURIComponent(' + P + '.msg?PONTE.msg(a,r):r)}'),
    ("mensagem do WhatsApp (ficha)", "T39/T40/T42",
     '"https://wa.me/"+h8+"?text="+encodeURIComponent(c)}',
     '"https://wa.me/"+h8+"?text="+encodeURIComponent(' + P + '.msg?PONTE.msg(L,c):c)}'),
    ("botão Pedir visita na ficha", "T44",
     "'\">Pedir mais informações '+t.a+\" \"+t.s+\".</a>\",",
     "'\">Pedir mais informações '+t.a+\" \"+t.s+\".</a>\"+(" + P + ".botaoVisita?PONTE.botaoVisita(L):\"\"),"),
]


def aplicar(texto):
    """Devolve (texto novo, relatório). Erro se um remendo não encaixar."""
    rel = []
    for nome, tarefa, antigo, novo in REMENDOS:
        if texto.count(novo) == 1 and antigo not in texto.replace(novo, ""):
            rel.append(("já", tarefa, nome))
            continue
        n = texto.count(antigo)
        if n != 1:
            raise SystemExit(f"Remendo não encaixa ({tarefa} · {nome}): o texto antigo aparece {n} vezes. Nada foi gravado.")
        texto = texto.replace(antigo, novo)
        rel.append(("novo", tarefa, nome))
    return texto, rel


def faltando(texto):
    return [f"{t} · {n}" for n, t, a, novo in REMENDOS if texto.count(novo) != 1]


def main(args):
    conferir = "--conferir" in args
    arqs = [a for a in args if not a.startswith("--")]
    alvo = pathlib.Path(arqs[0]) if arqs else ALVO
    texto = alvo.read_text(encoding="utf-8")
    if conferir:
        f = faltando(texto)
        print("Todos os remendos estão aplicados." if not f else "Faltam:\n  " + "\n  ".join(f))
        return 1 if f else 0
    novo, rel = aplicar(texto)
    if novo != texto:
        alvo.write_text(novo, encoding="utf-8")
    for s, t, n in rel:
        print(f"{'aplicado ' if s == 'novo' else 'já estava'}  {t:12} {n}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
