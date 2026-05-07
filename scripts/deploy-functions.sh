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

# ── SIN JWT (webhooks externos + crons) ──────────────────────
deploy "stripe-webhook"              "--no-verify-jwt"
deploy "mercadopago-webhook"         "--no-verify-jwt"
deploy "tiendanube-webhook"          "--no-verify-jwt"
deploy "tiendanube-oauth"            "--no-verify-jwt"
deploy "resend-webhook"              "--no-verify-jwt"
deploy "public-api"                  "--no-verify-jwt"
deploy "weekly-backup"               "--no-verify-jwt"
deploy "check-alerts"                "--no-verify-jwt"
deploy "execute-automations"         "--no-verify-jwt"
deploy "run-automation-flows"        "--no-verify-jwt"
deploy "check-overdue-debts"         "--no-verify-jwt"
deploy "check-stock-alerts"          "--no-verify-jwt"
deploy "daily-kpi-alert"             "--no-verify-jwt"
deploy "weekly-performance-digest"   "--no-verify-jwt"
deploy "send-scheduled-campaigns"    "--no-verify-jwt"
deploy "auto-recurring-expenses"     "--no-verify-jwt"
deploy "customer-reactivation-alerts" "--no-verify-jwt"
deploy "fetch-usd-rate"              "--no-verify-jwt"

# ── CON JWT (llamadas desde el frontend) ─────────────────────
deploy "ai-analysis"
deploy "ai-chat"
deploy "ai-offer-recommender"
deploy "afip-authorize"
deploy "cancel-subscription"
deploy "create-billing-portal"
deploy "create-checkout"
deploy "generate-description"
deploy "mercadopago-link"
deploy "platform-admin-action"
deploy "predict-sales"
deploy "seed-demo"
deploy "send-email-campaign"
deploy "send-invoice-email"
deploy "send-webhook"
deploy "tiendanube-export"
deploy "tiendanube-register-webhooks"
deploy "tiendanube-sync"

# ── RESUMEN ───────────────────────────────────────────────────
TOTAL=36
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

echo ""
echo "URL base: https://$PROJECT_REF.supabase.co/functions/v1/<nombre>"
echo ""
