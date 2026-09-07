#!/usr/bin/env bash
# Servidor de desarrollo de Vite (frontend Nerqia) en http://localhost:8080.
set -euo pipefail

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use 24 >/dev/null
export PATH="$HOME/.deno/bin:$PATH"

# La app valida VITE_SUPABASE_* al arrancar. Si el usuario cargó sus secretos
# reales de Supabase, se usan tal cual; si no, caen a los mismos placeholders
# públicos que usa el CI para que la UI levante y se pueda explorar. Sin datos
# reales las pantallas con backend muestran su estado de recuperación, no una
# pantalla de error de configuración.
export VITE_SUPABASE_URL="${VITE_SUPABASE_URL:-https://placeholder.supabase.co}"
export VITE_SUPABASE_PUBLISHABLE_KEY="${VITE_SUPABASE_PUBLISHABLE_KEY:-placeholder-anon-key}"

npm run dev
