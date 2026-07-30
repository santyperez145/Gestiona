# ============================================================
# deploy-functions.ps1
# Redeploy todas las edge functions al proyecto hummeopatkniwkyrrhwc
# Uso: desde la raiz del proyecto -> .\scripts\deploy-functions.ps1
#
# La lista de funciones se DERIVA del filesystem, no se mantiene a mano.
# Antes eran dos arrays hardcodeados y 20 de 56 funciones nunca se
# deployaban — incluido store-pay, que es el checkout de la tienda.
#
# Regla de seguridad: una funcion solo va sin JWT si esta en $noJwt.
# Cualquier funcion nueva queda protegida por default; si necesita ser
# publica hay que agregarla explicitamente aca, y eso se revisa en el PR.
# ============================================================

$PROJECT_REF = "hummeopatkniwkyrrhwc"

# ── FUNCIONES SIN JWT ────────────────────────────────────────────────────────
# Llamadas por webhooks externos, crons, o compradores anonimos del storefront.
# NINGUNA de estas puede confiar en un JWT de usuario, asi que TODAS validan por
# su cuenta: firma HMAC (webhooks), secreto de cron, o revalidacion server-side
# de todo lo que llega del cliente (storefront).
$noJwt = @(
    # Webhooks de terceros — validan firma
    "stripe-webhook",
    "mercadopago-webhook",
    "tiendanube-webhook",
    "tiendanube-oauth",
    "resend-webhook",
    # Storefront publico — el comprador no tiene sesion.
    # Revalidan precios, stock y envio contra la base.
    "shipping-quote",
    "store-pay",
    "store-order-email",
    # Links publicos de un solo uso
    "drip-unsubscribe",
    # API publica con su propio esquema de api keys
    "public-api",
    # Crons / tareas programadas
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
    "fetch-usd-rate",
    "recover-abandoned-carts",
    "send-drip-emails",
    "send-birthday-whatsapp",
    "daily-whatsapp-digest",
    "send-push"
)

Write-Host ""
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host " Exentry - Deploy Edge Functions" -ForegroundColor Cyan
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

# Descubrir funciones desde el filesystem
$root = Join-Path $PSScriptRoot ".." | Resolve-Path
$fnDir = Join-Path $root "supabase\functions"
if (-not (Test-Path $fnDir)) {
    Write-Host "ERROR: No encuentro $fnDir" -ForegroundColor Red
    exit 1
}

$all = Get-ChildItem $fnDir -Directory |
    Where-Object { $_.Name -notlike "_*" -and (Test-Path (Join-Path $_.FullName "index.ts")) } |
    Select-Object -ExpandProperty Name |
    Sort-Object

$withJwt = $all | Where-Object { $noJwt -notcontains $_ }
$publicos = $all | Where-Object { $noJwt -contains $_ }

# Avisar si $noJwt menciona una funcion que ya no existe: es una entrada
# muerta que puede volverse peligrosa si alguien crea una funcion con ese nombre.
$huerfanas = $noJwt | Where-Object { $all -notcontains $_ }

Write-Host ""
Write-Host "[2/3] Deployando $($all.Count) funciones ($($publicos.Count) publicas, $($withJwt.Count) con JWT)..." -ForegroundColor Yellow
Write-Host ""

$errors = @()

foreach ($fn in $publicos) {
    Write-Host "  -> $fn (no-verify-jwt)" -ForegroundColor Gray
    supabase functions deploy $fn --no-verify-jwt --project-ref $PROJECT_REF 2>&1
    if ($LASTEXITCODE -ne 0) {
        $errors += $fn
        Write-Host "     FALLO: $fn" -ForegroundColor Red
    } else {
        Write-Host "     OK" -ForegroundColor Green
    }
}

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
$total = $all.Count
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

if ($huerfanas.Count -gt 0) {
    Write-Host ""
    Write-Host "  AVISO: la lista publica menciona funciones que no existen:" -ForegroundColor Yellow
    foreach ($h in $huerfanas) {
        Write-Host "    - $h (quitala de `$noJwt)" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "URL base de funciones:" -ForegroundColor Cyan
Write-Host "  https://$PROJECT_REF.supabase.co/functions/v1/<nombre>" -ForegroundColor White
Write-Host ""

if ($errors.Count -gt 0) { exit 1 }
