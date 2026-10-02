#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
node scripts/validate-deploy.mjs
worker_args=(--config apps/worker/wrangler.jsonc --env '')
[[ "${GITHUB_REF_NAME:-}" == main ]] || { echo 'Somente main publica no ambiente único.' >&2; exit 1; }
branch=main
pnpm exec wrangler deploy "${worker_args[@]}" --var "SUPABASE_URL:$SUPABASE_URL"
# Somente GitHub Actions / ambiente com valores reais. Não copiar placeholders de proxy.
node -e 'process.stdout.write(JSON.stringify({SUPABASE_PUBLISHABLE_KEY:process.env.SUPABASE_PUBLISHABLE_KEY,SUPABASE_SERVICE_ROLE_KEY:process.env.SUPABASE_SERVICE_ROLE_KEY}))' |
 pnpm exec wrangler secret bulk "${worker_args[@]}"
(cd apps/web && pnpm exec wrangler pages deploy dist --project-name eddias-financeiro --branch "$branch" --commit-hash "$GITHUB_SHA")
