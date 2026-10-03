#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
name="eddias-financeiro-f1-$RANDOM-$RANDOM"
image='ghcr.io/cloudnative-pg/postgresql@sha256:2114d9615a5c56004ff4f586032d0e61cbaca7c9449d3b57ea240630b28c37b8'
dk() { env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH docker --host=unix:///var/run/docker.sock "$@"; }
cleanup() { dk rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
dk info --format '{{.ServerVersion}}' >/dev/null
dk run -d --name "$name" --network none --mount "type=bind,src=$root,dst=$root" --tmpfs /tmp:rw,mode=1777 "$image" bash -c \
 'initdb -D /tmp/fin-pg --auth=trust >/tmp/init.log && exec postgres -D /tmp/fin-pg -c listen_addresses= -c unix_socket_directories=/tmp' >/dev/null
ready=false
for attempt in {1..15}; do
 if dk exec "$name" pg_isready -h /tmp >/dev/null 2>&1; then ready=true; break; fi
 sleep 1
done
if [ "$ready" != true ]; then dk logs "$name"; exit 1; fi
sql() { dk exec -i "$name" psql -X -h /tmp -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
sql < "$root/supabase/tests/stubs.sql"
for file in "$root"/supabase/migrations/*.sql; do sql < "$file"; done
sql < "$root/supabase/tests/foundation.sql"
sql < "$root/supabase/tests/planning.sql"
sql < "$root/supabase/tests/statements.sql"
sql < "$root/supabase/tests/learning.sql"
sql < "$root/supabase/tests/kamino.sql"
sql < "$root/supabase/tests/backups.sql"
fingerprint="select md5(string_agg(data::text,',' order by data::text)) from (
 select to_jsonb(t) data from public.fin_tenants t union all select to_jsonb(t) from public.fin_memberships t
 union all select to_jsonb(t) from public.fin_companies t union all select to_jsonb(t) from public.fin_bank_accounts t
 union all select to_jsonb(t) from public.fin_plans t union all select to_jsonb(t) from public.fin_commitments t
 union all select to_jsonb(t) from public.fin_transactions t union all select to_jsonb(t) from public.fin_allocations t
 union all select to_jsonb(t) from public.fin_kamino_sources t union all select to_jsonb(t) from public.fin_kamino_documents t union all select to_jsonb(t) from public.fin_rules t union all select to_jsonb(t) from public.fin_import_profiles t union all select to_jsonb(t) from public.fin_audit_log t) all_rows;"
before="$(printf '%s' "$fingerprint" | sql -At)"
for file in "$root"/supabase/migrations/*.sql; do sql < "$file"; done
after="$(printf '%s' "$fingerprint" | sql -At)"
test "$before" = "$after"
printf '%s\n' 'Migrações reaplicadas sobre banco populado: nenhuma linha alterada.'
mkdir -p "$root/.data/validation"
dump="$root/.data/validation/f1-test.dump"
dk exec "$name" pg_dump -h /tmp -U postgres -Fc -d postgres > "$dump"
chmod 600 "$dump"
dk exec "$name" createdb -h /tmp -U postgres restored
dk exec -i "$name" pg_restore -h /tmp -U postgres -d restored --exit-on-error --no-owner < "$dump"
restored="$(printf '%s' "$fingerprint" | dk exec -i "$name" psql -X -h /tmp -U postgres -d restored -At)"
test "$before" = "$restored"
printf '%s\n' 'Backup restaurado em banco isolado: dados idênticos.'
# Exercita os mesmos scripts usados na publicação, contra bancos descartáveis.
export TMPDIR="$root/.data/validation/tmp"
mkdir -p "$TMPDIR" "$root/.data/validation/bin"
export FIN_TEST_CONTAINER="$name"
for bin in psql pg_dump pg_restore; do
 cat > "$root/.data/validation/bin/$bin" <<'WRAPPER'
#!/usr/bin/env bash
exec env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH docker --host=unix:///var/run/docker.sock exec -i --user root "$FIN_TEST_CONTAINER" "$(basename "$0")" "$@"
WRAPPER
 chmod +x "$root/.data/validation/bin/$bin"
done
export PATH="$root/.data/validation/bin:$PATH"
export BANCO_URL='postgresql://postgres@/postgres?host=/tmp'
export BACKUP_SENHA='senha-sintetica-exclusiva-de-teste-2026'
bash "$root/supabase/aplicar-migracoes.sh" --simular
bash "$root/supabase/migracoes/backup.sh" "$root/.data/validation" f1-encrypted
# Backup ensaiado em banco local vazio; origem nunca é o destino.
dk exec "$name" createdb -h /tmp -U postgres rehearsal
export ENSAIO_URL='postgresql://postgres@/rehearsal?host=/tmp'
bash "$root/supabase/migracoes/ensaio.sh"
bash "$root/supabase/aplicar-migracoes.sh"
bash "$root/supabase/aplicar-migracoes.sh" --simular
printf '%s\n' 'F1 banco, backup cifrado, ensaio e aplicador: aprovados.'
