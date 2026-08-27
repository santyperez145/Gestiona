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
    "resend-webhook",
    "meli-webhook",
    # Storefront publico — el comprador no tiene sesion.
    # Revalidan precios, stock y envio contra la base.
    "shipping-quote",
    "store-pay",
    "store-order-email",
    # Links publicos de un solo uso
    "drip-unsubscribe",
    "whatsapp-unsubscribe",
    # API publica con su propio esquema de api keys
    "public-api",
    # Crons / tareas programadas
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
    "precio-suscripcion",
    "avisos-por-correo",
    "recover-abandoned-carts",
    "notify-back-in-stock",
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

# El CLI global no siempre esta instalado, pero `supabase` es devDependency del
# repo. Se usa el binario global si existe y si no el local, igual que el .sh:
# antes este script fallaba de entrada en cualquier maquina sin instalacion
# global, aunque el CLI estuviera ahi nomas en node_modules.
if (Get-Command supabase -ErrorAction SilentlyContinue) {
    $SB = @("supabase")
} elseif (Test-Path (Join-Path $PSScriptRoot "..\node_modules\supabase\package.json")) {
    Write-Host "Usando el CLI de node_modules (no hay instalacion global)" -ForegroundColor Gray
    $SB = @("npx", "--no-install", "supabase")
} else {
    Write-Host "ERROR: no encuentro el CLI de supabase." -ForegroundColor Red
    Write-Host "  Instalalo con 'npm install -D supabase' o globalmente." -ForegroundColor Red
    exit 1
}

function Invoke-SB {
    param([string[]]$Arguments)
    # OJO con el rango: `$SB[1..($SB.Count - 1)]` con un solo elemento es
    # `$SB[1..0]`, y PowerShell devuelve los rangos descendentes AL REVES —
    # o sea `$null, 'supabase'`. Eso hacia ejecutar `supabase "" supabase ...`,
    # que fallaba, y el script lo reportaba como "no estas autenticado".
    # Pasa justo en el camino mas comun: bajo `npm run`, npm pone
    # node_modules/.bin en el PATH, asi que `Get-Command supabase` lo encuentra
    # y $SB queda con un unico elemento.
    $prefijo = if ($SB.Count -gt 1) { $SB[1..($SB.Count - 1)] } else { @() }
    # `@(...)` es subexpresion de array, NO splatting: pasaba todo junto como un
    # unico argumento y el CLI recibia el subcomando "projects list" en vez de
    # "projects" y "list". Para splatear hace falta `@variable`.
    $argumentos = @($prefijo) + @($Arguments)
    & $SB[0] @argumentos
}

# Sin token no hay deploy posible: mejor decirlo antes de intentar 56 veces.
#
# Se le pregunta AL CLI en vez de buscar el token en el disco: en Windows lo
# guarda en el keyring del sistema, no en ~/.supabase/access-token. Buscar ese
# archivo daba "falta autenticacion" a un usuario perfectamente logueado.
Write-Host "[0/3] Verificando autenticacion..." -ForegroundColor Yellow
$authOut = Invoke-SB @("projects", "list") 2>&1
if ($LASTEXITCODE -ne 0) {
    # Se muestra la salida real: colapsar cualquier falla en "no estas
    # autenticado" ya mando una vez a buscar un problema de login cuando lo que
    # fallaba era como se invocaba el CLI.
    Write-Host "ERROR: no se pudo consultar el CLI. Salida:" -ForegroundColor Red
    $authOut | Select-Object -First 8 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
    Write-Host "  Si dice que falta login: 'npx supabase login', o poner" -ForegroundColor Red
    Write-Host "  SUPABASE_ACCESS_TOKEN como variable de usuario." -ForegroundColor Red
    exit 1
}
Write-Host "  OK" -ForegroundColor Green

# Vincular proyecto
Write-Host "[1/3] Vinculando proyecto..." -ForegroundColor Yellow
Invoke-SB @("link", "--project-ref", $PROJECT_REF)
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Fallo al vincular. Ejecuta 'npx supabase login' primero." -ForegroundColor Red
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

# Deploy con reintentos.
#
# El bundler de Supabase resuelve los imports desde esm.sh y deno.land en cada
# deploy, y bajo 57 seguidos esos CDN devuelven 521 o timeout cada tanto. Dos
# corridas dejaron 12 y 15 funciones "fallando" que deployaban bien al
# reintentarlas a mano. Reintentar es parte del trabajo, no algo que deba hacer
# la persona.
#
# Un import realmente roto (una version que ya no existe, por ejemplo) falla las
# tres veces igual, asi que esto no esconde errores de verdad: solo absorbe la
# red.
function Deploy-Fn {
    param([string]$Nombre, [bool]$Publica)
    $flags = if ($Publica) { @("--no-verify-jwt") } else { @() }
    for ($intento = 1; $intento -le 3; $intento++) {
        Invoke-SB (@("functions", "deploy", $Nombre) + $flags + @("--project-ref", $PROJECT_REF))
        if ($LASTEXITCODE -eq 0) { return $true }
        if ($intento -lt 3) {
            Write-Host "     reintento $intento/2 en $($intento * 3)s..." -ForegroundColor DarkYellow
            Start-Sleep -Seconds ($intento * 3)
        }
    }
    return $false
}

foreach ($fn in $publicos) {
    Write-Host "  -> $fn (no-verify-jwt)" -ForegroundColor Gray
    if (Deploy-Fn -Nombre $fn -Publica $true) {
        Write-Host "     OK" -ForegroundColor Green
    } else {
        $errors += $fn
        Write-Host "     FALLO: $fn" -ForegroundColor Red
    }
}

foreach ($fn in $withJwt) {
    Write-Host "  -> $fn (verify-jwt)" -ForegroundColor Gray
    if (Deploy-Fn -Nombre $fn -Publica $false) {
        Write-Host "     OK" -ForegroundColor Green
    } else {
        $errors += $fn
        Write-Host "     FALLO: $fn" -ForegroundColor Red
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
