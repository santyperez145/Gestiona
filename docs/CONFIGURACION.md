# Qué falta configurar

Estado al 2026-08-21. Lo que **no** esté acá, ya funciona sin tocar nada.

## Resumen

| Área | Estado |
|---|---|
| Base de datos, RLS, migraciones | ✅ Listo |
| Cron jobs (13) | ✅ Arreglados, ver `docs/CRON.md` |
| Tienda online `/tienda/:slug` | ✅ Funciona |
| Catálogo público `/catalogo/:userId` | ✅ Funciona |
| Notificaciones push | ✅ VAPID cargado |
| **IA** (chat, descripciones, insights, OCR) | ⚠️ Falta `ANTHROPIC_API_KEY` para IA generativa; `predict-sales` conserva un respaldo estadístico |
| **Emails** (campañas, secuencias, facturas) | ❌ Falta `RESEND_API_KEY` |
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

Hoy solo están los `SUPABASE_*` (automáticos) y los `VAPID_*`.

### Prioridad alta

| Secreto | Para qué | Dónde se saca |
|---|---|---|
| `ANTHROPIC_API_KEY` | Chat con IA, descripciones automáticas, insights, copy de Instagram, OCR de facturas, recomendador | [console.anthropic.com](https://console.anthropic.com) |
| `RESEND_API_KEY` | **Todos** los emails: campañas, secuencias, facturas, órdenes a proveedores | [resend.com](https://resend.com) |
| `FROM_EMAIL` | Remitente de esos emails (dominio verificado en Resend) | — |
| `PUBLIC_BASE_URL` | Links dentro de los emails (desuscripción, ver factura) | tu dominio |

Sin `ANTHROPIC_API_KEY`, las funciones de IA generativa responden con error;
`predict-sales` sigue disponible con una estimación estadística explícita. Sin
`RESEND_API_KEY`, los crons de email corren pero no envían nada.

> Alternativa a Resend: cargar un SMTP propio en Configuración → Email. Las
> funciones intentan SMTP primero y caen a Resend.

### Según lo que uses

| Secreto | Para qué |
|---|---|
| `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE` | Alternativa global de plataforma para WhatsApp. Un comercio carga su propia conexión desde Integraciones; URL y clave entran por Edge Function y nunca se guardan en `settings` ni se devuelven al navegador. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Cobro de suscripciones del SaaS |
| `MP_WEBHOOK_SECRET` | Validar el webhook de MercadoPago (el token va por org en Integraciones) |
| `TIENDANUBE_CLIENT_SECRET` | Sincronización con Tiendanube |
| `RESEND_WEBHOOK_SECRET` | Rebotes y desuscripciones desde Resend |
| `MELI_CLIENT_ID`, `MELI_CLIENT_SECRET`, `MELI_REDIRECT_URI`, `MELI_CRON_SECRET` | MercadoLibre — ver `docs/MERCADOLIBRE.md` |

## 3. Vault de Supabase (los crons)

Ya están cargados. **No los borres**: sin ellos los 13 cron jobs fallan en
silencio. Detalle en `docs/CRON.md`.

| Secreto | Valor |
|---|---|
| `SUPABASE_URL` | la URL del proyecto |
| `SUPABASE_ANON_KEY` | la clave publicable |

## 4. Dominio propio

El panel de la tienda usa `window.location.origin`, así que la URL pública
sigue al dominio donde esté desplegada la app. Si comprás un dominio, apuntalo
al hosting y la tienda queda en `tudominio.com/tienda/<slug>` sin tocar código.

`gestiona.app` **no existe** — estaba hardcodeado en el panel y por eso el
botón "Ver tienda" daba `ERR_CONNECTION_REFUSED`. Ya se corrigió.

`platform-admin-action` acepta CORS por coincidencia exacta. El dominio actual
`https://exentryimports.vercel.app` y localhost están versionados; al sumar un
dominio propio o un frontend adicional hay que declararlo, separado por comas,
en el secret `PLATFORM_ALLOWED_ORIGINS` y volver a desplegar la función. No usar
`*`: esta función administra organizaciones, planes, accesos y roles.

---

## Cómo verificar que algo quedó bien

```bash
# Secretos cargados
npx supabase secrets list

# Crons sanos (no debería haber 'failed' reciente)
# ver la consulta en docs/CRON.md
```
