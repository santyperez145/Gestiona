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

# Usar supabase CLI instalado o npx como fallback
if command -v supabase &> /dev/null; then
  SB="supabase"
else
  echo "supabase CLI no encontrado — usando npx supabase (puede tardar en la primera ejecucion)"
  SB="npx supabase@latest"
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

deploy() {
  local fn=$1
  local flags=${2:-""}
  echo "  -> $fn $flags"
  if $SB functions deploy "$fn" $flags --project-ref "$PROJECT_REF" 2>&1; then
    echo "     OK"
    ((OK++)) || true
  else
    echo "     FALLO: $fn"
    ERRORS+=("$fn")
  fi
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
  "stripe-webhook" "mercadopago-webhook" "tiendanube-webhook"
  "tiendanube-oauth" "resend-webhook"
  # Storefront publico — el comprador no tiene sesion
  "shipping-quote" "store-pay" "store-order-email"
  # Links publicos de un solo uso
  "drip-unsubscribe"
  # API publica con su propio esquema de api keys
  "public-api"
  # Crons / tareas programadas
  "weekly-backup" "check-alerts" "execute-automations" "run-automation-flows"
  "check-overdue-debts" "check-stock-alerts" "daily-kpi-alert"
  "weekly-performance-digest" "send-scheduled-campaigns"
  "auto-recurring-expenses" "customer-reactivation-alerts" "fetch-usd-rate"
  "recover-abandoned-carts" "send-drip-emails" "send-birthday-whatsapp"
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
