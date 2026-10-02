#!/usr/bin/env bash
# Ensaio: antes de tocar em produção, restaura só a ESTRUTURA do banco de produção (pg_dump --schema-only
# de public, mais o controle financeiro_admin com as linhas dele) num Postgres descartável e roda lá o mesmo
# aplicador. Se o ensaio falhar, o workflow para e produção não é tocada.
#
# Uso: BANCO_URL=<produção> ENSAIO_URL=<postgres descartável e vazio> bash supabase/migracoes/ensaio.sh
#   PG_BIN: pasta do pg_dump/pg_restore da versão do servidor de produção (ou mais novo).
#   COMMIT: repassado ao aplicador.
# O ensaio pega: migration que não roda sobre o schema real (objeto que não existe ou já existe diferente,
# tipo, assinatura de função, dependência, permissão para um papel que não existe), erro de sintaxe, a
# trava de destrutivas e a conferência de sha256/ordem com o controle real.
# Não pega: o que depende dos DADOS (NOT NULL sem default numa tabela com linhas, índice único sobre
# duplicados, UPDATE que viola check), tempo e travas de tabela grande, e o que só o Supabase tem (roda
# aqui como superusuário, com stubs do auth). Nesses casos a transação do arquivo falha em produção e é
# desfeita inteira — por isso o backup vem antes.
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
falha() { echo "ensaio: ERRO: $*" >&2; exit 1; }
# Espaço ou quebra de linha colados junto no segredo quebram a URL (ver aplicar-migracoes.sh).
BANCO_URL="$(printf '%s' "${BANCO_URL:-}" | tr -d ' \t\r\n')"
[[ -n "${BANCO_URL:-}" && -n "${ENSAIO_URL:-}" ]] || falha "defina BANCO_URL (produção) e ENSAIO_URL (Postgres descartável)"
[[ "$BANCO_URL" != "$ENSAIO_URL" ]] || falha "ENSAIO_URL é igual a BANCO_URL"
# O ensaio só roda num Postgres desta máquina (serviço do job ou banco local de teste).
hospede="${ENSAIO_URL#*://}"; hospede="${hospede##*@}"; hospede="${hospede%%/*}"; hospede="${hospede%%\?*}"; hospede="${hospede%:*}"
if [[ -n "$hospede" && "$hospede" != localhost && "$hospede" != 127.0.0.1 && "$hospede" != "[::1]" ]]; then
  falha "ENSAIO_URL tem de apontar para um Postgres local (localhost, 127.0.0.1 ou socket), não para '$hospede'"
fi
# host=/hostaddr= na query valem mais que o host da URL (postgres://u@/banco?host=outro): também só locais.
if [[ "$ENSAIO_URL" =~ [?\&](host|hostaddr)=([^\&]*) ]]; then
  outro="${BASH_REMATCH[2]}"
  if [[ "$outro" != /* && "$outro" != %2[Ff]* && "$outro" != localhost && "$outro" != 127.0.0.1 && "$outro" != ::1 ]]; then
    falha "ENSAIO_URL tem de apontar para um Postgres local (localhost, 127.0.0.1 ou socket), não para '$outro'"
  fi
fi
# Postgres do ensaio não tem TLS: sslmode=disable na própria URL, que vale mais que o PGSSLMODE=require
# que o workflow põe para falar com produção.
if [[ "$ENSAIO_URL" != *sslmode=* ]]; then
  if [[ "$ENSAIO_URL" == *\?* ]]; then ENSAIO_URL="$ENSAIO_URL&sslmode=disable"; else ENSAIO_URL="$ENSAIO_URL?sslmode=disable"; fi
fi
BIN="${PG_BIN:+$PG_BIN/}"
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-15}"
prod() { PGAPPNAME=financeiro-ensaio psql "$BANCO_URL" -X -q -At -v ON_ERROR_STOP=1 "$@"; }
ensaio() { psql "$ENSAIO_URL" -X -q -At -v ON_ERROR_STOP=1 "$@"; }

[[ "$(ensaio -c "select count(*) from pg_catalog.pg_tables where schemaname in ('public', 'financeiro_admin')")" == 0 ]] \
  || falha "o banco do ensaio não está vazio; use um Postgres novo"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# O ensaio roda como superusuário; em produção o aplicador é o dono dos objetos (postgres). Objeto de public
# com outro dono faria "must be owner" só em produção (a transação desfaz, mas o ensaio não avisaria).
alheios="$(prod -c "select string_agg(distinct pg_get_userbyid(relowner) || ':' || relname, ', ') from (select relowner, relname from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r','p','v','m','S') union all select proowner, proname from pg_proc where pronamespace = 'public'::regnamespace) o where relowner <> (select oid from pg_roles where rolname = current_user)")"
if [[ -n "$alheios" ]]; then
  echo "ensaio: aviso: objetos de public que não são de $(prod -c 'select current_user') (o usuário do aplicador): ${alheios:0:300}"
  echo "ensaio: aviso: migration que recriar um deles falha em produção com 'must be owner' (e é desfeita inteira)."
fi

echo "ensaio: estrutura de produção (pg_dump --schema-only)…"
"${BIN}pg_dump" "$BANCO_URL" --format=custom --schema-only --lock-wait-timeout=60s -n public -f "$TMP/estrutura.dump" \
  || falha "pg_dump --schema-only de produção falhou"
TEM_CONTROLE="$(prod -c "select to_regnamespace('financeiro_admin') is not null")"
if [[ "$TEM_CONTROLE" == t ]]; then
  # O controle vai com as linhas: é ele que diz ao aplicador o que já está em produção.
  "${BIN}pg_dump" "$BANCO_URL" --format=custom -n financeiro_admin -f "$TMP/controle.dump" || falha "pg_dump do controle falhou"
fi

# Mínimo do ambiente Supabase: os stubs dos testes (papéis anon, authenticated, service_role,
# supabase_auth_admin; schemas extensions e auth com auth.users, auth.uid(), auth.jwt()), as extensões
# de produção que existirem nesta imagem do Postgres, e os papéis citados no dump (donos e GRANTs).
ensaio -f "$RAIZ/supabase/tests/stubs.sql" >/dev/null
while IFS='|' read -r extensao esquema; do
  [[ "$extensao" =~ ^[a-z0-9_-]+$ && "$esquema" =~ ^[a-z0-9_]+$ ]] || continue
  if [[ "$(ensaio -c "select count(*) from pg_available_extensions where name = '$extensao'")" == 1 ]]; then
    ensaio -c "create schema if not exists $esquema" -c "create extension if not exists \"$extensao\" with schema $esquema" >/dev/null \
      || echo "ensaio: aviso: extensão $extensao não pôde ser criada aqui" >&2
  else
    echo "ensaio: aviso: extensão $extensao (schema $esquema) não existe nesta imagem do Postgres; o ensaio segue sem ela"
  fi
done < <(prod -F '|' -c "select e.extname, n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname <> 'plpgsql' order by 1")

for dump in "$TMP"/*.dump; do "${BIN}pg_restore" -f - "$dump"; done \
  | grep -E '^(GRANT|REVOKE|ALTER DEFAULT PRIVILEGES|ALTER [A-Z ]+ OWNER TO)' \
  | grep -oE '(OWNER TO|FOR ROLE|TO|FROM) [a-z_][a-z0-9_]*(, [a-z_][a-z0-9_]*)*;?' \
  | sed -E 's/^(OWNER TO|FOR ROLE|TO|FROM) //; s/;$//' | tr ',' '\n' | tr -d ' ' | sort -u > "$TMP/papeis"
while read -r papel; do
  [[ -n "$papel" && "$papel" != public ]] || continue
  ensaio -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname = '$papel') then create role \"$papel\" nologin; end if; end \$\$" >/dev/null
done < "$TMP/papeis"

# O schema public já existe no banco novo: tira só a criação dele da lista; o resto (comentário, ACL,
# default privileges, tabelas, funções, políticas) entra numa transação só, parando no primeiro erro.
"${BIN}pg_restore" --list "$TMP/estrutura.dump" | grep -vE '^[0-9]+; [0-9]+ [0-9]+ SCHEMA - public ' > "$TMP/estrutura.lista"
"${BIN}pg_restore" --exit-on-error --single-transaction -L "$TMP/estrutura.lista" -d "$ENSAIO_URL" "$TMP/estrutura.dump" \
  || falha "a estrutura de produção não restaurou no ensaio (veja o erro acima)"
if [[ -f "$TMP/controle.dump" ]]; then
  "${BIN}pg_restore" --exit-on-error --single-transaction -d "$ENSAIO_URL" "$TMP/controle.dump" \
    || falha "o controle de produção não restaurou no ensaio"
fi
echo "ensaio: estrutura restaurada ($(ensaio -c "select count(*) from pg_tables where schemaname = 'public'") tabelas); aplicando as pendentes…"

BANCO_URL="$ENSAIO_URL" APLICADOR_SAIDA="" bash "$RAIZ/supabase/aplicar-migracoes.sh" \
  || falha "as migrations pendentes falharam no ensaio; produção não foi tocada"
echo "ensaio: ok — as pendentes rodaram sobre a estrutura de produção."
