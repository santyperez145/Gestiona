#!/usr/bin/env bash
# ============================================================
# deploy-functions.sh
# Redeploy todas las edge functions al proyecto hummeopatkniwkyrrhwc
# Uso: bash scripts/deploy-functions.sh
# ============================================================

set -euo pipefail

PROJECT_REF="hummeopatkniwkyrrhwc"
ERRORS=()
OK=0

# CLI global si existe; si no, el que ya esta en node_modules como devDependency.
# `npx supabase@latest` se descargaba de la red aunque el binario estuviera ahi,
# y ademas podia traer una version distinta a la que el repo fijo.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if command -v supabase &> /dev/null; then
  SB="supabase"
elif [ -f "$ROOT/node_modules/supabase/package.json" ]; then
  echo "Usando el CLI de node_modules (no hay instalacion global)"
  SB="npx --no-install supabase"
else
  echo "ERROR: no encuentro el CLI de supabase."
  echo "  Instalalo con 'npm install -D supabase' o globalmente."
  exit 1
fi

# Sin token no hay deploy posible: mejor avisar antes de intentar 56 veces.
#
# Se le pregunta AL CLI en vez de buscar el token en el disco: segun el sistema
# lo guarda en un keyring y no en ~/.supabase/access-token, asi que buscar ese
# archivo daba "falta autenticacion" a un usuario perfectamente logueado.
echo "[0/3] Verificando autenticacion..."
if ! $SB projects list > /dev/null 2>&1; then
  echo "ERROR: el CLI no esta autenticado."
  echo "  Opcion A: correr 'npx supabase login' (abre el navegador)."
  echo "  Opcion B: exportar SUPABASE_ACCESS_TOKEN."
  exit 1
fi

echo ""
echo "======================================="
echo " Exentry — Deploy Edge Functions"
echo " Proyecto: $PROJECT_REF"
echo "======================================="
echo ""

# Vincular proyecto
echo "[1/3] Vinculando proyecto..."
$SB link --project-ref "$PROJECT_REF" || {
  echo "ERROR: Fallo al vincular. Ejecuta '$SB login' primero."
  exit 1
}

echo ""
echo "[2/3] Deployando funciones..."
echo ""

# Deploy con reintentos.
#
# El bundler de Supabase resuelve los imports desde esm.sh y deno.land en cada
# deploy, y bajo decenas seguidos esos CDN devuelven 521 o timeout cada tanto.
# Dos corridas dejaron 12 y 15 funciones "fallando" que deployaban bien al
# reintentarlas a mano. Un import realmente roto falla las tres veces igual, asi
# que esto absorbe la red sin esconder errores de verdad.
deploy() {
  local fn=$1
  local flags=${2:-""}
  echo "  -> $fn $flags"
  local intento
  for intento in 1 2 3; do
    if $SB functions deploy "$fn" $flags --project-ref "$PROJECT_REF" 2>&1; then
      echo "     OK"
      ((OK++)) || true
      return 0
    fi
    if [ "$intento" -lt 3 ]; then
      echo "     reintento $intento/2 en $((intento * 3))s..."
      sleep $((intento * 3))
    fi
  done
  echo "     FALLO: $fn"
  ERRORS+=("$fn")
}

# ── FUNCIONES SIN JWT ─────────────────────────────────────────
# Webhooks de terceros, crons y storefront publico. Ninguna puede confiar en un
# JWT de usuario, asi que TODAS validan por su cuenta: firma HMAC, secreto de
# cron, o revalidacion server-side de lo que manda el cliente.
#
# Regla de seguridad: una funcion solo va sin JWT si esta en esta lista.
# Cualquier funcion nueva queda protegida por default.
NO_JWT=(
  # Webhooks de terceros — validan firma
  "stripe-webhook" "mercadopago-webhook" "resend-webhook"
  # Storefront publico — el comprador no tiene sesion
  "shipping-quote" "store-pay" "store-order-email"
  # Links publicos de un solo uso
  "drip-unsubscribe" "whatsapp-unsubscribe"
  # API publica con su propio esquema de api keys
  "public-api"
  # Crons / tareas programadas
  "check-alerts" "execute-automations" "run-automation-flows"
  "check-overdue-debts" "check-stock-alerts" "daily-kpi-alert"
  "weekly-performance-digest" "send-scheduled-campaigns"
  "auto-recurring-expenses" "customer-reactivation-alerts" "fetch-usd-rate"
  "recover-abandoned-carts" "notify-back-in-stock" "send-drip-emails" "send-birthday-whatsapp"
  "daily-whatsapp-digest" "send-push"
)

is_public() {
  local needle=$1
  for f in "${NO_JWT[@]}"; do
    [ "$f" = "$needle" ] && return 0
  done
  return 1
}

# La lista de funciones se DERIVA del filesystem, no se mantiene a mano: antes
# eran dos arrays hardcodeados y 20 de 56 funciones nunca se deployaban,
# incluido store-pay, que es el checkout de la tienda.
FN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/supabase/functions"
ALL=()
for d in "$FN_DIR"/*/; do
  name=$(basename "$d")
  case "$name" in _*) continue ;; esac
  [ -f "$d/index.ts" ] || continue
  ALL+=("$name")
done

TOTAL=${#ALL[@]}
echo "  $TOTAL funciones encontradas"
echo ""

for fn in "${ALL[@]}"; do
  if is_public "$fn"; then
    deploy "$fn" "--no-verify-jwt"
  else
    deploy "$fn"
  fi
done

# ── RESUMEN ───────────────────────────────────────────────────
echo ""
echo "[3/3] Resumen"
if [ ${#ERRORS[@]} -eq 0 ]; then
  echo "  Todas las funciones deployadas exitosamente ($OK/$TOTAL)"
else
  echo "  $OK/$TOTAL OK | Fallos: ${#ERRORS[@]}"
  echo "  Funciones con error:"
  for e in "${ERRORS[@]}"; do
    echo "    - $e"
  done
fi

# Entradas muertas en la lista publica: si alguien crea despues una funcion con
# ese nombre, se deployaria sin JWT sin que nadie lo haya revisado.
for f in "${NO_JWT[@]}"; do
  found=0
  for a in "${ALL[@]}"; do [ "$a" = "$f" ] && found=1 && break; done
  [ $found -eq 0 ] && echo "  AVISO: '$f' esta en NO_JWT pero no existe — quitala"
done

echo ""
echo "URL base: https://$PROJECT_REF.supabase.co/functions/v1/<nombre>"
echo ""
