#!/usr/bin/env bash
# Backup cifrado do banco antes de aplicar migration: pg_dump (formato custom) de public e financeiro_admin,
# cifrado com gpg simétrico AES256 e conferido (o arquivo cifrado é decifrado de volta e comparado).
# Se o dump, a conferência ou a cifra falharem, sai com erro e o workflow não aplica nada.
#
# Uso: BANCO_URL=… BACKUP_SENHA=… bash supabase/migracoes/backup.sh <pasta-de-saida> <nome-base>
#   Cria <pasta>/<nome-base>.dump.gpg e só ele (o dump em claro é apagado). A última linha é o caminho.
#   PG_BIN: pasta do pg_dump/pg_restore (o cliente tem de ser da versão do servidor ou mais novo).
# A senha nunca vai na linha de comando: o gpg a lê de um descritor (--passphrase-fd), alimentado pelo bash.
# O que entra: os schemas public (todos os dados do Financeiro) e financeiro_admin (controle das migrations).
# O que não entra: auth (usuários do login; migration nenhuma mexe lá) e os schemas internos do Supabase.
set -euo pipefail
umask 077 # o backup cifrado e os temporários só para o dono
DESTINO="${1:-}"
NOME="${2:-}"
falha() { echo "backup: ERRO: $*" >&2; exit 1; }
[[ -n "$DESTINO" && -n "$NOME" ]] || falha "uso: bash supabase/migracoes/backup.sh <pasta-de-saida> <nome-base>"
[[ "$NOME" =~ ^[A-Za-z0-9._-]+$ ]] || falha "nome-base só com letras, números, ponto, hífen e sublinhado"
# Espaço ou quebra de linha colados junto no segredo quebram a URL (incidente de 26/09/2026 com o
# Account ID da Cloudflare); connection string não tem espaço legítimo (senha com espaço vai codificada).
BANCO_URL="$(printf '%s' "${BANCO_URL:-}" | tr -d ' \t\r\n')"
[[ -n "${BANCO_URL:-}" ]] || falha "defina BANCO_URL"
[[ -n "${BACKUP_SENHA:-}" ]] || falha "defina BACKUP_SENHA (segredo do GitHub; sem ela não há backup e nada é aplicado)"
[[ ${#BACKUP_SENHA} -ge 20 ]] || falha "BACKUP_SENHA curta demais: use 20 caracteres ou mais (docs/deploy.md)"
BIN="${PG_BIN:+$PG_BIN/}"
command -v "${BIN}pg_dump" >/dev/null || falha "pg_dump não encontrado (PG_BIN=${PG_BIN:-})"
command -v gpg >/dev/null || falha "gpg não encontrado"

export PGAPPNAME="financeiro-backup" PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-15}"
SERVIDOR="$(psql "$BANCO_URL" -X -q -At -c "select current_setting('server_version_num')::int / 10000")" \
  || falha "não consegui conectar ao banco"
CLIENTE="$("${BIN}pg_dump" --version | grep -oE '[0-9]+' | head -n1)"
[[ "$CLIENTE" -ge "$SERVIDOR" ]] || falha "pg_dump $CLIENTE é mais velho que o servidor ($SERVIDOR); instale o postgresql-client-$SERVIDOR"

mkdir -p "$DESTINO"
TMP="$(mktemp -d)"
GNUPGHOME="$(mktemp -d)"
export GNUPGHOME
trap 'rm -rf "$TMP" "$GNUPGHOME"' EXIT
chmod 700 "$TMP" "$GNUPGHOME"
DUMP="$TMP/$NOME.dump"
SAIDA="$DESTINO/$NOME.dump.gpg"

ESQUEMAS=(-n public)
if [[ "$(psql "$BANCO_URL" -X -q -At -c "select to_regnamespace('financeiro_admin') is not null")" == t ]]; then
  ESQUEMAS+=(-n financeiro_admin)
fi
echo "backup: pg_dump $CLIENTE de ${ESQUEMAS[*]} (servidor $SERVIDOR)…"
"${BIN}pg_dump" "$BANCO_URL" --format=custom --lock-wait-timeout=60s "${ESQUEMAS[@]}" --file="$DUMP" \
  || falha "o pg_dump falhou; nada foi aplicado"

# Conferência do dump: o arquivo abre, tem tabelas e tem dados.
LISTA="$("${BIN}pg_restore" --list "$DUMP")" || falha "o pg_restore não consegue ler o dump gerado"
TABELAS="$(grep -c ' TABLE public ' <<<"$LISTA" || true)"
DADOS="$(grep -c ' TABLE DATA public ' <<<"$LISTA" || true)"
[[ "$TABELAS" -gt 0 && "$DADOS" -gt 0 ]] || falha "o dump não tem tabelas ($TABELAS) ou dados ($DADOS) de public"

cifrar() {
  gpg --batch --yes --no-tty --quiet --pinentry-mode loopback --passphrase-fd 3 \
    --symmetric --cipher-algo AES256 --s2k-mode 3 --s2k-digest-algo SHA512 --s2k-count 65011712 \
    --compress-algo none --output "$SAIDA" "$DUMP" 3<<<"$BACKUP_SENHA"
}
decifrar() {
  gpg --batch --no-tty --quiet --pinentry-mode loopback --passphrase-fd 3 --decrypt "$SAIDA" 3<<<"$BACKUP_SENHA"
}
cifrar || falha "a cifra do backup falhou; nada foi aplicado"
ORIGINAL="$(sha256sum "$DUMP" | cut -c1-64)"
VOLTA="$(decifrar | sha256sum | cut -c1-64)" || falha "não consegui decifrar o backup recém-cifrado"
[[ "$ORIGINAL" == "$VOLTA" ]] || falha "o backup decifrado não bate com o dump original"
if head -c 5 "$SAIDA" | grep -q 'PGDMP'; then falha "o arquivo de saída não está cifrado"; fi
rm -f "$DUMP"

echo "backup: $TABELAS tabelas de public no dump; cifrado com AES256 e conferido (sha256 do dump ${ORIGINAL:0:12}…)."
echo "$SAIDA"
