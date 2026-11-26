"""R87 (John 26/11): o acesso provisório erivelto@gmail.com passa sozinho para o e-mail do Erivelto na subida; a senha continua."""
from conftest import cliente, criar_usuario, erv


def test_r87_troca_email_provisorio_na_subida():
    criar_usuario(email="erivelto@gmail.com", senha="senha-bem-comprida")
    erv.migrar()
    assert erv.q1("select email from usuarios")["email"] == "eriveltosantoscorretor@gmail.com"
    p = cliente()
    assert p.post("/api/painel/entrar", json={"email": "eriveltosantoscorretor@gmail.com", "senha": "senha-bem-comprida"}).status_code == 200
    assert cliente().post("/api/painel/entrar", json={"email": "erivelto@gmail.com", "senha": "senha-bem-comprida"}).status_code == 401
    erv.migrar()   # repetir não muda nada
    assert erv.q1("select count(*) as n from usuarios")["n"] == 1


def test_r87_nao_mexe_se_o_novo_ja_existe():
    criar_usuario(email="erivelto@gmail.com")
    criar_usuario(email="eriveltosantoscorretor@gmail.com")
    erv.migrar()
    assert sorted(r["email"] for r in erv.q("select email from usuarios")) == ["erivelto@gmail.com", "eriveltosantoscorretor@gmail.com"]
