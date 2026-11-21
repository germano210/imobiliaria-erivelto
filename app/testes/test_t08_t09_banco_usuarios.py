"""T08 tabelas e migração · T09 senhas e comandos."""
import re

from conftest import erv


def test_t08_tabelas_existem_e_migracao_repete_sem_erro():
    erv.migrar()
    erv.migrar()
    nomes = {r["table_name"] for r in erv.q("select table_name from information_schema.tables where table_schema = 'public'")}
    assert {"usuarios", "sessoes", "estado", "imoveis", "fotos", "contas", "visitas", "leads", "chamadas", "config", "aceites",
            "tentativas", "acessos"} <= nomes
    assert erv.q1("select count(*) as n from estado")["n"] == 1


def test_t08_sessao_guarda_so_o_hash(painel):
    token = painel.cookies["erv_p"]
    linhas = erv.q("select hash from sessoes")
    assert len(linhas) == 1 and linhas[0]["hash"] == erv.hash_token(token) and token not in str(linhas)


def test_t08_chamadas_sem_coluna_de_ip_ou_pessoa():
    colunas = {r["column_name"] for r in erv.q("select column_name from information_schema.columns where table_name = 'chamadas'")}
    assert colunas == {"id", "imovel_id", "nm", "o", "cidade", "criado"}


def test_t09_scrypt():
    h = erv.hash_senha("minha senha boa")
    assert h.startswith("scrypt$15$8$1$") and "minha" not in h
    assert erv.confere_senha("minha senha boa", h) and not erv.confere_senha("outra", h) and not erv.confere_senha("x", "lixo")
    assert erv.hash_senha("minha senha boa") != h


def test_t09_comandos(capsys, servidor):
    # os comandos abrem e fecham o banco por conta própria; aqui o banco do app já está aberto
    assert erv.comando(["usuario", "Novo@Exemplo.com", "Fulano de Tal"]) == 0
    saida = capsys.readouterr().out
    senha = re.search(r": (\S{12,})\s*$", saida).group(1)
    erv.abrir()
    u = erv.q1("select * from usuarios where email = 'novo@exemplo.com'")
    assert u["temp"] and u["nome"] == "Fulano de Tal" and senha not in u["senha_hash"] and erv.confere_senha(senha, u["senha_hash"])

    assert erv.comando(["usuario", "novo@exemplo.com", "De novo"]) == 1          # não sobrescreve
    capsys.readouterr()
    erv.abrir()
    erv.q("update usuarios set temp = false")
    assert erv.comando(["senha", "novo@exemplo.com"]) == 0
    senha2 = re.search(r": (\S{12,})\s*$", capsys.readouterr().out).group(1)
    erv.abrir()
    u2 = erv.q1("select * from usuarios where email = 'novo@exemplo.com'")
    assert senha2 != senha and u2["temp"] and erv.confere_senha(senha2, u2["senha_hash"]) and not erv.confere_senha(senha, u2["senha_hash"])

    assert erv.comando(["usuarios"]) == 0
    lista = capsys.readouterr().out
    assert "novo@exemplo.com" in lista and "senha temporária" in lista and senha2 not in lista
    erv.abrir()
    assert erv.comando(["senha", "ninguem@exemplo.com"]) == 1
    erv.abrir()
    assert erv.comando(["email", "novo@exemplo.com", "outro@exemplo.com"]) == 0
    erv.abrir()
    assert erv.q1("select email from usuarios")["email"] == "outro@exemplo.com"


def test_t09_comando_chave_nao_precisa_de_banco(capsys):
    import base64
    assert erv.comando(["chave"]) == 0
    assert len(base64.b64decode(capsys.readouterr().out.strip())) == 32
