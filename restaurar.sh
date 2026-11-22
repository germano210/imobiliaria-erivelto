#!/usr/bin/env bash
# Restaura um backup feito pelo backup.sh num banco NOVO e numa pasta NOVA, e confere se está inteiro.
# Uso: ./restaurar.sh erivelto-AAAA-MM-DD_HHMM.tar.age chave-privada-age.txt [pasta-destino] [nome-do-banco-novo]
# Não mexe no site no ar: o banco em uso e a pasta dados/ ficam como estão. No fim ele mostra como colocar no ar.
# Padrão: fala com o Postgres pelo container (docker compose exec; precisa de POSTGRES_USER no .env).
# Com ERV_RESTAURAR_LOCAL=1 usa psql/pg_restore desta máquina (conexão pelas variáveis PGHOST, PGPORT, PGUSER, PGPASSWORD).
set -euo pipefail
ARQ="${1:?informe o arquivo .tar.age}"; CHAVE="${2:?informe a chave privada do age}"
[ -f "$ARQ" ] || { echo "Não achei o arquivo $ARQ"; exit 1; }
[ -f "$CHAVE" ] || { echo "Não achei a chave $CHAVE"; exit 1; }
ARQ="$(cd "$(dirname "$ARQ")" && pwd)/$(basename "$ARQ")"; CHAVE="$(cd "$(dirname "$CHAVE")" && pwd)/$(basename "$CHAVE")"
MARCA=$(date +%Y%m%d_%H%M%S)
DEST="${3:-restaurado-$MARCA}"; NOVO="${4:-erivelto_restaurado_$MARCA}"
case "$NOVO" in *[!a-z0-9_]*|"") echo "Nome de banco inválido: use só letras minúsculas, números e _"; exit 1;; esac
[ -e "$DEST" ] && { echo "A pasta $DEST já existe; escolha outra."; exit 1; }
mkdir -p "$DEST"; DEST="$(cd "$DEST" && pwd)"
cd "$(dirname "$0")"
ENV_ARQ="${ERV_ENV:-.env}"
if [ -f "$ENV_ARQ" ]; then set -a; . "$ENV_ARQ"; set +a; fi
SERVICO="${ERV_BACKUP_SERVICO:-banco}"
DC=(docker compose -f "${ERV_BACKUP_COMPOSE:-compose.producao.yaml}")   # o compose.yaml da pasta é o de TESTE
if [ "${ERV_RESTAURAR_LOCAL:-0}" = "1" ]; then
  pg() { local f="$1"; shift; "$f" "$@"; }
else
  : "${POSTGRES_USER:?falta POSTGRES_USER no .env}"
  pg() { local f="$1"; shift; "${DC[@]}" exec -T "$SERVICO" "$f" -U "$POSTGRES_USER" "$@"; }
fi

age -d -i "$CHAVE" "$ARQ" | tar -x -C "$DEST"
[ -s "$DEST/banco.dump" ] || { echo "O backup não tem o banco (banco.dump). NÃO use este backup."; exit 1; }
mkdir -p "$DEST/midia"

pg createdb "$NOVO"
pg pg_restore --no-owner --exit-on-error -d "$NOVO" < "$DEST/banco.dump"
sql() { pg psql -d "$NOVO" -At -v ON_ERROR_STOP=1 -c "$1"; }
RESUMO=$(sql "select 'usuários ' || (select count(*) from usuarios) || ' · imóveis ' || (select count(*) from imoveis)
  || ' (no site: ' || (select count(*) from imoveis where publicado is not null) || ') · contatos ' || (select count(*) from leads)
  || ' · chamadas ' || (select count(*) from chamadas) || ' · revisão do painel ' || (select rev from estado where id = 1)")
echo "Banco $NOVO: $RESUMO"
FALTAM=0; TOTAL=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  TOTAL=$((TOTAL + 1))
  [ -s "$DEST/midia/$f" ] || { FALTAM=$((FALTAM + 1)); echo "  falta a foto $f"; }
done < <(sql "select arquivo from fotos order by id")
echo "Fotos: $TOTAL no banco · $(find "$DEST/midia" -type f | wc -l | tr -d ' ') na pasta · faltando $FALTAM"
[ "$FALTAM" = 0 ] || { echo "Backup INCOMPLETO: faltam fotos. Não coloque no ar sem conferir."; exit 1; }
cat <<FIM

Conferido. O banco restaurado é "$NOVO" e as fotos estão em $DEST/midia.
Para colocar no ar (o site fica fora por alguns segundos):
  1. pare o app (docker compose -f compose.producao.yaml stop erivelto)
  2. guarde a pasta atual:  mv dados/midia dados/midia-antes-$MARCA  &&  mv "$DEST/midia" dados/midia
  3. no .env, troque POSTGRES_DB para "$NOVO" (o compose de produção monta o endereço do banco com ele)
  4. suba de novo (docker compose -f compose.producao.yaml up -d) e confira o site e o painel
FIM
