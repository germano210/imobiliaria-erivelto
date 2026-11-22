#!/usr/bin/env bash
# Backup diário do site do Erivelto: banco (pg_dump) + fotos (dados/midia), cifrado com age, guarda 14 dias.
# Cron (todo dia 3h10):  10 3 * * * cd /caminho/do/projeto && ./backup.sh >> dados/backup.log 2>&1
# Precisa no .env: ERV_BACKUP_CHAVE (chave PÚBLICA do age) e POSTGRES_USER / POSTGRES_DB (os mesmos do banco).
# Padrão: usa o pg_dump de dentro do container do banco (docker compose exec). Com ERV_BACKUP_BANCO_URL, usa o pg_dump desta máquina.
# Restaurar: ./restaurar.sh ARQUIVO.tar.age CHAVE-PRIVADA.txt
set -euo pipefail
cd "$(dirname "$0")"
ENV_ARQ="${ERV_ENV:-.env}"
if [ -f "$ENV_ARQ" ]; then set -a; . "$ENV_ARQ"; set +a; fi
: "${ERV_BACKUP_CHAVE:?coloque a chave pública do age em ERV_BACKUP_CHAVE no .env}"
DEST="${ERV_BACKUP_DESTINO:-/mnt/backup/erivelto}"
PASTA_DADOS="${ERV_BACKUP_DADOS:-dados}"          # pasta do host que tem midia/ dentro
SERVICO="${ERV_BACKUP_SERVICO:-banco}"
DC=(docker compose -f "${ERV_BACKUP_COMPOSE:-compose.producao.yaml}")   # o compose.yaml da pasta é o de TESTE
mkdir -p "$DEST" "$PASTA_DADOS/midia"
QUANDO=$(date +%Y-%m-%d_%H%M)
TMP=$(mktemp -d "$DEST/.tmp-XXXXXX"); trap 'rm -rf "$TMP"' EXIT
if [ -n "${ERV_BACKUP_BANCO_URL:-}" ]; then
  pg_dump -Fc --no-owner -d "$ERV_BACKUP_BANCO_URL" > "$TMP/banco.dump"
else
  : "${POSTGRES_USER:?falta POSTGRES_USER no .env}" "${POSTGRES_DB:?falta POSTGRES_DB no .env}"
  "${DC[@]}" exec -T "$SERVICO" pg_dump -Fc --no-owner -U "$POSTGRES_USER" "$POSTGRES_DB" > "$TMP/banco.dump"
fi
[ -s "$TMP/banco.dump" ] || { echo "$QUANDO ERRO: o pg_dump não gerou nada"; exit 1; }
SAIDA="$DEST/erivelto-$QUANDO.tar.age"
tar -cf - -C "$TMP" banco.dump -C "$(cd "$PASTA_DADOS" && pwd)" midia | age -r "$ERV_BACKUP_CHAVE" > "$SAIDA.parte"
mv "$SAIDA.parte" "$SAIDA"
find "$DEST" -maxdepth 1 -name 'erivelto-*.tar.age' -mtime +14 -delete
echo "$QUANDO backup ok: $(du -h "$SAIDA" | cut -f1) em $SAIDA"
