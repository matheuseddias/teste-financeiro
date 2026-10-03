#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
node scripts/validate-deploy.mjs
node scripts/deploy-secrets.mjs --check
worker_args=(--config apps/worker/wrangler.jsonc --env '')
[[ "${GITHUB_REF_NAME:-}" == main ]] || { echo 'Somente main publica no ambiente único.' >&2; exit 1; }
branch=main
pnpm exec wrangler deploy "${worker_args[@]}" --var "SUPABASE_URL:$SUPABASE_URL"
# Somente GitHub Actions / ambiente com valores reais. Não copiar placeholders de proxy.
node scripts/deploy-secrets.mjs |
 pnpm exec wrangler secret bulk "${worker_args[@]}"
(cd apps/web && pnpm exec wrangler pages deploy dist --project-name eddias-financeiro --branch "$branch" --commit-hash "$GITHUB_SHA")
