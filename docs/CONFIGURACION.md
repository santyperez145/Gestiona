# Qué falta configurar

**Estado:** checklist operativo vigente. **Corte:** 2026-09-04.

Lo que **no** esté acá, ya funciona sin tocar nada.

## Resumen

| Área | Estado |
|---|---|
| Base de datos, RLS, migraciones | ✅ Listo |
| Cron jobs (13) | ✅ Arreglados, ver `docs/CRON.md` |
| Tienda online `<slug>.nerqia.app` | ✅ Wildcard operativo y verificado en producción (2026-09-03) |
| Catálogo público `/catalogo/:userId` | ✅ Funciona |
| Notificaciones push | ✅ VAPID cargado |
| **IA** (chat, descripciones, insights, OCR) | ⚠️ Falta `ANTHROPIC_API_KEY` para IA generativa; el comprobante de Gastos exige además aprobación legal y `EXPENSE_RECEIPT_EXTRACTION_ENABLED=true`. `predict-sales` conserva un respaldo estadístico |
| **Emails** (campañas, secuencias, facturas) | 🟡 `nerqia.app` está verificado en Resend y `RESEND_API_KEY`/`FROM_EMAIL` están cargados. Emisores, errores por audiencia, idempotencia y ledger de eventos están desplegados (2026-09-05). Faltan activar Resend, crear el webhook firmado, configurar Auth SMTP y ejecutar la matriz real. |
| **WhatsApp automático** | ⚠️ Requiere una conexión Evolution por comercio o una configuración global de plataforma |
| **Cobros con tarjeta** | ❌ Falta Stripe |
| **MercadoPago** | ⚠️ Token por org en Integraciones; falta el webhook |
| **Tiendanube** | ❌ Falta `TIENDANUBE_CLIENT_SECRET` |
| **MercadoLibre** | ❌ Falta crear la app |

---

## 1. En el `.env` (frontend)

Ya están cargadas `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
`VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID` y
`VITE_VAPID_PUBLIC_KEY`.

Faltan dos, ambas **públicas** (viajan en el bundle, no son secretos):

```bash
# Solo si vas a usar MercadoLibre
VITE_MELI_CLIENT_ID=tu_client_id

# Solo si vas a usar Tiendanube
VITE_TIENDANUBE_APP_ID=tu_app_id
```

## 2. Secretos de Edge Functions

Se cargan una sola vez y **no** van al `.env` — son del lado del servidor.
Desde el Dashboard (Edge Functions → Secrets) o por CLI:

```bash
npx supabase secrets set NOMBRE=valor
```

El diagnóstico de Plataforma muestra presencia/ausencia sin devolver valores.
No se copian secretos a este documento ni al navegador.

### Prioridad alta

| Secreto | Para qué | Dónde se saca |
|---|---|---|
| `ANTHROPIC_API_KEY` | Chat con IA, descripciones automáticas, insights, copy de Instagram, OCR asistido y recomendador | [console.anthropic.com](https://console.anthropic.com) |
| `RESEND_API_KEY` | **Todos** los emails: campañas, secuencias, facturas, órdenes a proveedores | [resend.com](https://resend.com) |
| `FROM_EMAIL` | Remitente de esos emails (dominio verificado en Resend) | — |
| `PUBLIC_BASE_URL` | Links dentro de los emails (desuscripción, ver factura) | tu dominio |

Sin `ANTHROPIC_API_KEY`, las funciones de IA generativa responden con error;
`predict-sales` sigue disponible con una estimación estadística explícita. Sin
`RESEND_API_KEY`, los crons de email corren pero no envían nada.

> `EXPENSE_RECEIPT_EXTRACTION_ENABLED=true` no es una credencial sino una
> aprobación operativa separada. Se carga **sólo después** de firmar/validar el
> tratamiento documental con el proveedor (DPA, región, subencargados,
> entrenamiento, retención y borrado) y medir exactitud/costo con comprobantes
> autorizados. Tener IA general configurada no habilita este flujo.

> Alternativa a Resend: conectar un SMTP propio en Plataforma → Mensajería.
> El proveedor activo se elige explícitamente; guardar un SMTP de respaldo ya no
> lo activa por accidente. Cambiar de proveedor invalida la prueba anterior y la
> nueva prueba llega al email del staff que la ejecuta. La contraseña vive en los
> secretos de Edge Functions y nunca vuelve a la pantalla, a un snapshot ni a
> `settings`. Preferí OAuth o una credencial específica del proveedor; no uses la
> contraseña normal de la cuenta.

### Según lo que uses

| Secreto | Para qué |
|---|---|
| `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE` | Alternativa global de plataforma para WhatsApp. Un comercio carga su propia conexión desde Integraciones; URL y clave entran por Edge Function y nunca se guardan en `settings` ni se devuelven al navegador. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Cobro de suscripciones del SaaS |
| `MP_WEBHOOK_SECRET` | Validar el webhook de MercadoPago (el token va por org en Integraciones) |
| `TIENDANUBE_CLIENT_SECRET` | Sincronización con Tiendanube |
| `RESEND_WEBHOOK_SECRET` | Firma de eventos de entrega, demora, fallo, rebote, supresión, queja, apertura y click desde Resend |
| `MELI_CLIENT_ID`, `MELI_CLIENT_SECRET`, `MELI_REDIRECT_URI`, `MELI_CRON_SECRET` | MercadoLibre — ver `docs/MERCADOLIBRE.md` |

## 3. Vault de Supabase (los crons)

Ya están cargados. **No los borres**: sin ellos los 20 cron jobs (2026-08-25) fallan en
silencio. Detalle en `docs/CRON.md`.

| Secreto | Valor |
|---|---|
| `SUPABASE_URL` | la URL del proyecto |
| `SUPABASE_ANON_KEY` | la clave publicable |

## 4. Dominio propio

`nerqia.app` está registrado en Vercel, usa sus nameservers, sirve el proyecto
y tiene TLS activo desde 2026-09-03. `www.nerqia.app` está asignado al mismo
proyecto y redirige al dominio raíz mediante `vercel.json`.

El storefront incluido usa `<slug>.nerqia.app` y conserva
`/tienda/:slug` como compatibilidad. No es otra tienda: router, catálogo,
carrito, checkout y órdenes son los mismos. `*.nerqia.app` está asociado y
verificado en el proyecto Vercel `nerqia`; la tienda publicada
`exentryimports.nerqia.app` respondió por HTTPS con TLS válido, catálogo,
robots, sitemap y feed el 2026-09-03.

Los dominios propios del comercio se administran dentro de **Commerce →
Publicar**, no en una segunda página. `store-domain` agrega, verifica y retira
el host por API; `get_store_slug_by_host` monta el mismo storefront y sólo
resuelve tiendas publicadas con estado `active`. La pantalla muestra los TXT,
A o CNAME que Vercel recomiende en ese momento, distingue titularidad, DNS y
TLS, y advierte no borrar MX/TXT del correo. La propagación externa puede tardar
hasta 48 horas.

Secreto operativo requerido para habilitar el autoservicio:

| Secreto de Edge Functions | Alcance |
|---|---|
| `VERCEL_TOKEN` | Token dedicado con acceso al team/proyecto `nerqia`; crear, verificar y retirar Project Domains. Nunca va en Vite, la base ni el repo. |

`VERCEL_PROJECT_ID` y `VERCEL_TEAM_ID` son overrides opcionales; el proyecto y
team actuales están fijados como defaults no secretos en la función. Sin
`VERCEL_TOKEN`, la UI conserva el subdominio incluido y devuelve explícitamente
`provider_not_configured`: no simula una conexión.

Supabase Auth declara `https://nerqia.app` como Site URL. Los callbacks de
producción, `www`, `*.nerqia.app`, previews de Vercel y localhost se versionan en
`supabase/config.toml`; después de editarlos hay que ejecutar
`npx supabase config push`.

Los dominios de terceros no se agregan a esa allowlist global. Los enlaces de
confirmación/reset del comprador usan el subdominio canónico de la tienda; así
no se abre Auth a un wildcard que podría apuntar a otra organización.

Las Edge Functions usan `PUBLIC_BASE_URL=https://nerqia.app`,
`PUBLIC_APP_URL=https://nerqia.app` y una lista exacta en
`PLATFORM_ALLOWED_ORIGINS`. No usar `*`: `platform-admin-action` administra
organizaciones, planes, accesos y roles. El origen Vercel anterior permanece
sólo durante la transición y se retirará cuando no haya callbacks ni clientes
activos sobre él.

Vercel no provee casillas, pero sí administra el DNS usado por Resend. El
2026-09-04 quedaron publicados y resueltos DKIM, SPF, MX y DMARC; Resend marcó
`nerqia.app` como `verified` en la región São Paulo. El dominio puede emitir
`noreply@nerqia.app`, `marketing@nerqia.app` y las demás casillas lógicas sin
crear buzones.

El backend acepta Resend API o SMTP propio con una selección explícita. Usa
claves de idempotencia, etiquetas compatibles con webhooks, deduplicación por
`svix-id`, ventana anti-replay de cinco minutos, contadores atómicos y supresión
automática ante rebote/queja. Los errores tienen código, reintento y referencia:
el staff ve el diagnóstico del proveedor, el comercio recibe una acción segura
y el comprador nunca ve Resend, SMTP, Supabase ni roles internos.

Para cerrar producción todavía hay que: seleccionar Resend y enviar la prueba
desde Plataforma → Mensajería; crear en Resend el webhook
`https://hummeopatkniwkyrrhwc.supabase.co/functions/v1/resend-webhook`, guardar
su firma como `RESEND_WEBHOOK_SECRET`; y configurar Authentication → SMTP con
`smtp.resend.com`, usuario `resend`, puerto `465` o `587` y una API key dedicada.
La matriz de aceptación debe observar recepción, demora/fallo, rebote, queja,
supresión, reset de contraseña, magic link e invitación. Ninguno se declara
productivo por DNS o por un deploy solamente.

---

## Cómo verificar que algo quedó bien

```bash
# Secretos cargados
npx supabase secrets list

# Crons sanos (no debería haber 'failed' reciente)
# ver la consulta en docs/CRON.md
```
