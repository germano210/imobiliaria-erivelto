"""T26 backup e restauração de verdade (modo local: pg_dump/pg_restore desta máquina + age), contra o Postgres dos testes."""
import os, shutil, subprocess

import pytest

from conftest import BANCO, PG, RAIZ, erv, imovel, jpeg, publicar


@pytest.mark.skipif(not (shutil.which("age") and shutil.which("age-keygen") and PG), reason="precisa de age e do Postgres temporário dos testes")
def test_t26_backup_e_restauracao(painel, tmp_path):
    foto = painel.post("/api/painel/fotos", content=jpeg(), headers={"Content-Type": "image/jpeg"}).json()["s"]
    publicar(painel, imovel(fotos=[{"s": foto, "a": ""}]))
    chave = tmp_path / "chave-teste.txt"
    subprocess.run(["age-keygen", "-o", str(chave)], check=True, capture_output=True)
    publica = [l.split(": ")[1] for l in chave.read_text().splitlines() if "public key" in l][0]
    destino = tmp_path / "backups"
    amb = dict(os.environ, PATH=PG["bin"] + ":" + os.environ["PATH"], ERV_ENV="/dev/null", ERV_BACKUP_CHAVE=publica, ERV_BACKUP_DESTINO=str(destino),
               ERV_BACKUP_DADOS=str(erv.DADOS), ERV_BACKUP_BANCO_URL=BANCO, ERV_RESTAURAR_LOCAL="1",
               PGHOST=PG["host"], PGPORT=PG["porta"], PGUSER=PG["usuario"])
    velho = destino / "erivelto-2000-01-01_0000.tar.age"
    destino.mkdir()
    velho.write_text("x")
    os.utime(velho, (0, 0))
    r = subprocess.run(["bash", str(RAIZ / "backup.sh")], env=amb, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    arquivos = list(destino.glob("erivelto-*.tar.age"))
    assert len(arquivos) == 1 and not velho.exists()                       # o de mais de 14 dias saiu
    bruto = arquivos[0].read_bytes()
    assert bruto.startswith(b"age-encryption.org/v1") and b"corretor@exemplo.com" not in bruto and b"PGDMP" not in bruto

    restaurado = tmp_path / "restaurado"
    r = subprocess.run(["bash", str(RAIZ / "restaurar.sh"), str(arquivos[0]), str(chave), str(restaurado), "erv_restaurado_teste"],
                       env=amb, capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "usuários 1 · imóveis 1 (no site: 1)" in r.stdout and "faltando 0" in r.stdout
    assert (restaurado / foto).read_bytes() == (erv.MIDIA / foto[6:]).read_bytes()
    try:
        # o banco em uso não foi tocado, e o restaurado tem o mesmo conteúdo
        assert erv.q1("select count(*) as n from imoveis")["n"] == 1
        import psycopg
        with psycopg.connect(BANCO.rsplit("/", 1)[0] + "/erv_restaurado_teste") as c:
            assert c.execute("select publicado->>'cidade' from imoveis").fetchone()[0] == "Santo Antônio da Patrulha"
        # pasta que já existe = recusa (não sobrescreve nada)
        r2 = subprocess.run(["bash", str(RAIZ / "restaurar.sh"), str(arquivos[0]), str(chave), str(restaurado), "erv_outro"], env=amb, capture_output=True, text=True)
        assert r2.returncode == 1 and "já existe" in r2.stdout
        # chave errada = falha
        outra = tmp_path / "outra.txt"
        subprocess.run(["age-keygen", "-o", str(outra)], check=True, capture_output=True)
        r3 = subprocess.run(["bash", str(RAIZ / "restaurar.sh"), str(arquivos[0]), str(outra), str(tmp_path / "r3"), "erv_r3"], env=amb, capture_output=True, text=True)
        assert r3.returncode != 0
    finally:
        with psycopg.connect(BANCO, autocommit=True) as c:
            c.execute("drop database if exists erv_restaurado_teste")
            c.execute("drop database if exists erv_r3")
