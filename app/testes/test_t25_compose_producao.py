"""T25: compose.producao.yaml (produção). Aqui só se confere o ARQUIVO (sem Docker): o "up" de verdade é no servidor."""
import re

import yaml

from conftest import RAIZ

TEXTO = (RAIZ / "compose.producao.yaml").read_text()
C = yaml.safe_load(TEXTO)
S = C["services"]


def test_t25_servicos_e_reinicio():
    assert C["name"] == "erivelto" and set(S) == {"banco", "erivelto", "tunel"}
    for nome, s in S.items():
        assert s["restart"] == "unless-stopped", nome
        assert s["logging"]["options"] == {"max-size": "10m", "max-file": "3"}, nome
    assert S["erivelto"]["depends_on"] == {"banco": {"condition": "service_healthy"}}
    assert "healthcheck" in S["banco"] and "api/saude" in " ".join(S["erivelto"]["healthcheck"]["test"])


def test_t25_nada_aberto_para_fora():
    assert S["erivelto"]["ports"] == ["127.0.0.1:${ERV_PORTA:-8080}:8000"]
    assert "ports" not in S["banco"] and "ports" not in S["tunel"]
    assert S["erivelto"]["cap_drop"] == ["ALL"] and "no-new-privileges:true" in S["erivelto"]["security_opt"]
    assert "user" not in S["erivelto"] and "\nUSER erv" in (RAIZ / "Dockerfile").read_text()      # sem root: vem da imagem


def test_t25_sem_segredo_no_arquivo_e_sem_valores_do_teste():
    teste = (RAIZ / "compose.yaml").read_text()
    for segredo in re.findall(r'"(SO-TESTE[^"]*|VEVT[^"]*)"', teste) + ["trycloudflare", "SO-TESTE"]:
        assert segredo not in TEXTO, segredo
    banco, app = S["banco"]["environment"], S["erivelto"]["environment"]
    assert banco["POSTGRES_PASSWORD"].startswith("${POSTGRES_PASSWORD:?")
    assert app["ERV_BANCO"] == "postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@banco:5432/${POSTGRES_DB}"
    assert app["ERV_CHAVE_DADOS"].startswith("${ERV_CHAVE_DADOS:?") and app["ERV_ORIGENS"].startswith("${ERV_ORIGENS:?")
    assert app["ERV_HTTPS"] == "1" and app["ERV_TUNEL_TESTE"] == "0"
    assert "env_file" not in S["erivelto"]            # o token do túnel e a chave do backup não entram no container do app
    assert S["tunel"]["environment"] == {"TUNNEL_TOKEN": "${ERV_TUNEL_TOKEN:-}"} and S["tunel"]["profiles"] == ["tunel"]


def test_t25_toda_variavel_do_app_esta_no_compose_e_no_env_example():
    usadas = set(re.findall(r'E\("(ERV_[A-Z_]+)"', (RAIZ / "app/app.py").read_text()))
    assert usadas and usadas <= set(S["erivelto"]["environment"]), usadas - set(S["erivelto"]["environment"])
    modelo = (RAIZ / ".env.example").read_text()
    for v in sorted(usadas) + ["POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB", "ERV_PORTA", "ERV_TUNEL_TOKEN", "COMPOSE_PROFILES"]:
        assert re.search(rf"^{v}=", modelo, re.M), v
    for v in ("ERV_PORTA", "ERV_TUNEL_TOKEN", "COMPOSE_PROFILES", "POSTGRES_PASSWORD"):
        assert re.search(rf"^{v}=$", modelo, re.M), v      # sem valor real no modelo


def test_t25_dados_onde_o_backup_espera():
    assert S["erivelto"]["volumes"] == ["./dados:/dados"] and S["banco"]["volumes"] == ["banco:/var/lib/postgresql/data"]
    backup = (RAIZ / "backup.sh").read_text()
    assert 'PASTA_DADOS="${ERV_BACKUP_DADOS:-dados}"' in backup and 'SERVICO="${ERV_BACKUP_SERVICO:-banco}"' in backup
    assert "dados/" in (RAIZ / ".gitignore").read_text().splitlines() and "dados" in (RAIZ / ".dockerignore").read_text().splitlines()


def test_t25_producao_sempre_com_f_e_scripts_apontam_para_ela():
    """O compose.yaml da pasta é o de TESTE (padrão do Docker). Produção nunca pode cair nele sem querer."""
    assert not (RAIZ / "docker-compose.yml").exists() and not (RAIZ / "compose.teste.yaml").exists()
    import re
    sem_f = [l for l in TEXTO.splitlines() if re.search(r"docker compose (?!-f compose\.producao\.yaml)", l)]
    assert sem_f == [], sem_f
    for f in ("backup.sh", "restaurar.sh"):
        t = (RAIZ / f).read_text()
        assert 'DC=(docker compose -f "${ERV_BACKUP_COMPOSE:-compose.producao.yaml}")' in t, f
        assert not re.search(r"docker compose (?!-f)", t.replace("(docker compose exec", "")), f
    assert 'troque POSTGRES_DB para "$NOVO"' in (RAIZ / "restaurar.sh").read_text()   # ERV_BANCO do .env não vale na produção
    leia = (RAIZ / "README.md").read_text()
    assert "docker compose -f compose.producao.yaml exec erivelto python app.py usuario" in leia
    assert "docker compose exec erivelto python app.py usuario voce@exemplo.com" in leia
