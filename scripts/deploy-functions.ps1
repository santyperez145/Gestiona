# ============================================================
# deploy-functions.ps1
# Redeploy todas las edge functions al proyecto hummeopatkniwkyrrhwc
# Uso: desde la raiz del proyecto -> .\scripts\deploy-functions.ps1
# ============================================================

$PROJECT_REF = "hummeopatkniwkyrrhwc"

Write-Host ""
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host " Exentry — Deploy Edge Functions" -ForegroundColor Cyan
Write-Host " Proyecto: $PROJECT_REF" -ForegroundColor Cyan
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host ""

# Vincular proyecto
Write-Host "[1/3] Vinculando proyecto..." -ForegroundColor Yellow
supabase link --project-ref $PROJECT_REF
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Fallo al vincular. Ejecuta 'supabase login' primero." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[2/3] Deployando funciones..." -ForegroundColor Yellow
Write-Host ""

$errors = @()

# ── FUNCIONES SIN JWT (webhooks externos + crons) ──────────────────────────
# Estas son llamadas por Stripe, Mercado Pago, Tiendanube, Resend,
# pg_cron o el scheduler — NO pueden enviar un JWT de usuario.

$noJwt = @(
    "stripe-webhook",
    "mercadopago-webhook",
    "tiendanube-webhook",
    "tiendanube-oauth",
    "resend-webhook",
    "public-api",
    "weekly-backup",
    "check-alerts",
    "execute-automations",
    "run-automation-flows",
    "check-overdue-debts",
    "check-stock-alerts",
    "daily-kpi-alert",
    "weekly-performance-digest",
    "send-scheduled-campaigns",
    "auto-recurring-expenses",
    "customer-reactivation-alerts",
    "fetch-usd-rate"
)

foreach ($fn in $noJwt) {
    Write-Host "  -> $fn (no-verify-jwt)" -ForegroundColor Gray
    supabase functions deploy $fn --no-verify-jwt --project-ref $PROJECT_REF 2>&1
    if ($LASTEXITCODE -ne 0) {
        $errors += $fn
        Write-Host "     FALLO: $fn" -ForegroundColor Red
    } else {
        Write-Host "     OK" -ForegroundColor Green
    }
}

# ── FUNCIONES CON JWT (llamadas desde el frontend autenticado) ───────────────

$withJwt = @(
    "ai-analysis",
    "ai-chat",
    "ai-offer-recommender",
    "afip-authorize",
    "cancel-subscription",
    "create-billing-portal",
    "create-checkout",
    "generate-description",
    "mercadopago-link",
    "platform-admin-action",
    "predict-sales",
    "seed-demo",
    "send-email-campaign",
    "send-invoice-email",
    "send-webhook",
    "tiendanube-export",
    "tiendanube-register-webhooks",
    "tiendanube-sync"
)

foreach ($fn in $withJwt) {
    Write-Host "  -> $fn (verify-jwt)" -ForegroundColor Gray
    supabase functions deploy $fn --project-ref $PROJECT_REF 2>&1
    if ($LASTEXITCODE -ne 0) {
        $errors += $fn
        Write-Host "     FALLO: $fn" -ForegroundColor Red
    } else {
        Write-Host "     OK" -ForegroundColor Green
    }
}

# ── RESUMEN ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "[3/3] Resumen" -ForegroundColor Yellow
$total = $noJwt.Count + $withJwt.Count
$ok    = $total - $errors.Count

if ($errors.Count -eq 0) {
    Write-Host "  Todas las funciones deployadas exitosamente ($ok/$total)" -ForegroundColor Green
} else {
    Write-Host "  $ok/$total OK | Fallos: $($errors.Count)" -ForegroundColor Red
    Write-Host "  Funciones con error:" -ForegroundColor Red
    foreach ($e in $errors) {
        Write-Host "    - $e" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "URL base de funciones:" -ForegroundColor Cyan
Write-Host "  https://$PROJECT_REF.supabase.co/functions/v1/<nombre>" -ForegroundColor White
Write-Host ""
