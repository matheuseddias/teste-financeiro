#!/usr/bin/env bash
set -euo pipefail
cd /workspace/teste-financeiro
export XDG_DATA_HOME=/workspace/.local/share
export XDG_CACHE_HOME=/workspace/.cache
export XDG_CONFIG_HOME=/workspace/.config
export PNPM_HOME=/workspace/.pnpm-home
export npm_config_cache=/workspace/.npm-cache
pnpm install --frozen-lockfile
pnpm check && pnpm test:browser
