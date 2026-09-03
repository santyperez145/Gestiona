# Qué falta configurar

Estado al 2026-08-30. Lo que **no** esté acá, ya funciona sin tocar nada.

## Resumen

| Área | Estado |
|---|---|
| Base de datos, RLS, migraciones | ✅ Listo |
| Cron jobs (13) | ✅ Arreglados, ver `docs/CRON.md` |
| Tienda online `<slug>.nerqia.app` | 🟠 Implementada; falta prueba publicada del wildcard |
| Catálogo público `/catalogo/:userId` | ✅ Funciona |
| Notificaciones push | ✅ VAPID cargado |
| **IA** (chat, descripciones, insights, OCR) | ⚠️ Falta `ANTHROPIC_API_KEY` para IA generativa; el comprobante de Gastos exige además aprobación legal y `EXPENSE_RECEIPT_EXTRACTION_ENABLED=true`. `predict-sales` conserva un respaldo estadístico |
| **Emails** (campañas, secuencias, facturas) | 🟠 `RESEND_API_KEY` está puesta, pero la cuenta de Resend está en modo de prueba: **sólo envía a la casilla del dueño**. Verificado el 2026-08-27 contra la API. Falta verificar un dominio en resend.com/domains y poner `RESEND_FROM`. |
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

> Alternativa a Resend: conectar un SMTP propio en Configuración → Mensajería.
> La prueba llega al email de la sesión antes de guardar. Sólo owner/admin puede
> administrarlo; la credencial vive en una tabla privada de backend y nunca
> vuelve a la pantalla, a un snapshot ni a `settings`. Las funciones intentan
> SMTP primero y caen a Resend. Preferí OAuth o una credencial específica del
> proveedor; no uses la contraseña normal de la cuenta.

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
carrito, checkout y órdenes son los mismos. Para operarlo hay que asociar
`*.nerqia.app` al proyecto `nerqia`; que el wildcard responda DNS no demuestra
que Vercel lo haya asociado ni emitido el certificado.

Supabase Auth declara `https://nerqia.app` como Site URL. Los callbacks de
producción, `www`, `*.nerqia.app`, previews de Vercel y localhost se versionan en
`supabase/config.toml`; después de editarlos hay que ejecutar
`npx supabase config push`.

Las Edge Functions usan `PUBLIC_BASE_URL=https://nerqia.app`,
`PUBLIC_APP_URL=https://nerqia.app` y una lista exacta en
`PLATFORM_ALLOWED_ORIGINS`. No usar `*`: `platform-admin-action` administra
organizaciones, planes, accesos y roles. El origen Vercel anterior permanece
sólo durante la transición y se retirará cuando no haya callbacks ni clientes
activos sobre él.

Vercel no provee correo. Para que `hola@nerqia.app`, invitaciones y campañas
entreguen mensajes, hay que agregar en Vercel DNS los registros que muestre
Resend y marcar el dominio como verificado desde Nerqia Platform.

---

## Cómo verificar que algo quedó bien

```bash
# Secretos cargados
npx supabase secrets list

# Crons sanos (no debería haber 'failed' reciente)
# ver la consulta en docs/CRON.md
```
