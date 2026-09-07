#!/usr/bin/env bash
# Bootstrap idempotente del entorno de Cloud Agent para Nerqia.
# Instala el toolchain que el repo fija y refresca dependencias con el lockfile.
# Se puede correr varias veces: cada paso comprueba antes de instalar.
set -euo pipefail

# --- Node 24 -----------------------------------------------------------------
# package.json exige Node >=24. La imagen base trae 22, así que se usa nvm
# (ya presente en la imagen) para fijar 24 como versión por defecto.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
fi
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm install 24 >/dev/null
nvm alias default 24 >/dev/null
nvm use 24 >/dev/null
echo "node $(node --version) / npm $(npm --version)"

# --- Deno 2.x ----------------------------------------------------------------
# Autoridad de tipos de las Edge Functions (npm run check:functions). Corren en
# Deno, fuera de tsconfig.app.json.
if ! command -v deno >/dev/null 2>&1; then
  export DENO_INSTALL="$HOME/.deno"
  curl -fsSL https://deno.land/install.sh | sh -s v2.9.5
fi
export PATH="$HOME/.deno/bin:$PATH"
echo "$(deno --version | head -n1)"

# --- Dependencias del proyecto ----------------------------------------------
# npm ci respeta package-lock.json y deja node_modules reproducible.
npm ci
