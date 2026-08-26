# Gestiona — Sistema de gestión para PyMEs argentinas

Sistema integral de gestión comercial: ventas, stock, finanzas, CRM, marketing, facturación AFIP e integraciones (Tiendanube, Mercado Pago, Stripe).

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS + Radix UI |
| Backend | Supabase (PostgreSQL + Auth + Storage + Edge Functions) |
| Pagos | Stripe (SaaS subscriptions) + Mercado Pago (ventas) |
| Facturación | AFIP (Argentina) |
| E-commerce | Tiendanube OAuth + webhooks |
| IA | Anthropic Claude (insights, chat, predicciones, descripciones) |
| Email | Resend |
| Monitoreo | Sentry |
| PWA | vite-plugin-pwa |

## Requisitos previos

- Node.js 20+
- npm 10+ (o Bun)
- Cuenta Supabase con proyecto creado
- CLI de Supabase: `npm install -g supabase`

## Instalación

```bash
# 1. Clonar el repositorio
git clone <repo-url>
cd exentryimports

# 2. Instalar dependencias
npm install

# 3. Configurar variables de entorno
cp .env.example .env
# Editar .env con tus credenciales (ver sección Variables de entorno)

# 4. Aplicar migraciones (ver "Aplicar migraciones" mas abajo)
npx supabase db query --linked --file supabase/migrations/<archivo>.sql

# 5. Iniciar servidor de desarrollo
npm run dev
```

## Comandos disponibles

```bash
npm run dev          # Servidor de desarrollo en http://localhost:8080
npm run build        # Build de producción
npm run preview      # Preview del build
npm run lint         # ESLint
npm run typecheck    # Chequeo de tipos (ver la nota de abajo)
npm run test         # Tests con Vitest
npm run test:watch   # Tests en modo watch
npm run db -- --file x.sql       # Ejecuta SQL contra la base
npm run deploy:functions         # Despliega las Edge Functions
```

Antes de commitear, los tres chequeos que corre el CI:

```bash
NODE_OPTIONS=--max-old-space-size=6144 npm run typecheck && npm run lint && npm test
```

> **No uses `npx tsc --noEmit`.** El `tsconfig.json` raíz tiene `"files": []`,
> así que ese comando sale con éxito sin chequear ningún archivo. `npm run
> typecheck` apunta a `tsconfig.app.json` y sí chequea; el `NODE_OPTIONS` evita
> que se quede sin memoria (`types.ts` tiene ~20 mil líneas).

## Variables de entorno

### Frontend (.env)

```bash
# Supabase (obligatorio)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
VITE_SUPABASE_PROJECT_ID=your-project-id

# Stripe — clave pública para frontend (obligatorio para checkout)
VITE_STRIPE_PUBLISHABLE_KEY=pk_live_...

# Tiendanube — App ID público
VITE_TIENDANUBE_APP_ID=your_tiendanube_app_id

# Sentry — error tracking (opcional)
VITE_SENTRY_DSN=https://xxxxx@oxxxx.ingest.sentry.io/yyyyyyy
VITE_APP_VERSION=1.0.0
```

### Edge Functions (Supabase Dashboard > Edge Functions > Secrets)

Estos secretos se configuran en Supabase, **nunca** en el `.env` del frontend:

| Secret | Usado en | Descripción |
|---|---|---|
| `STRIPE_SECRET_KEY` | create-checkout, cancel-subscription | Clave secreta Stripe |
| `STRIPE_WEBHOOK_SECRET` | stripe-webhook | Secret para verificar webhooks Stripe |
| `TIENDANUBE_CLIENT_ID` | tiendanube-oauth, tiendanube-sync | App ID de Tiendanube |
| `TIENDANUBE_CLIENT_SECRET` | tiendanube-oauth, tiendanube-sync | Client secret de Tiendanube |
| `MERCADOPAGO_ACCESS_TOKEN` | mercadopago-link | Token de acceso Mercado Pago |
| `ANTHROPIC_API_KEY` | ai-analysis, ai-chat, predict-sales, ai-offer-recommender, generate-description | Clave API Anthropic |
| `RESEND_API_KEY` | send-invoice-email, send-email-campaign, send-scheduled-campaigns | Clave API Resend |
| `AFIP_CERT` | afip-authorize | Certificado AFIP (PEM) |
| `AFIP_KEY` | afip-authorize | Clave privada AFIP (PEM) |

## Base de datos

El proyecto usa Supabase. Las migraciones están en `supabase/migrations/`.

### Aplicar migraciones — un solo procedimiento

> El camino por default es `db query --file`: aplica la migración y corre sus
> bloques de verificación en el mismo paso. `db push` está reconciliado y sirve
> como chequeo de salud del libro (`--dry-run` tiene que responder
> `upToDate:true`), pero no es el camino de aplicación. **Después de aplicar a
> mano, anotar la versión en `supabase_migrations.schema_migrations`** — es lo
> único que evita que el libro se desfase de nuevo. Detalle completo en
> `CLAUDE.md` § Migraciones.

```bash
# Conectar al proyecto (una sola vez)
supabase link --project-ref <project-id>

# Aplicar un archivo
npm run db -- --file supabase/migrations/2026xxxx_lo_que_sea.sql

# Regenerar los tipos DESPUÉS de cada migración
npx supabase gen types typescript --project-id <project-id> > src/integrations/supabase/types.ts
```

Si no hay `SUPABASE_DB_URL`, el mismo SQL se pega en el SQL Editor del
dashboard. Las migraciones se escriben **idempotentes** (`IF NOT EXISTS`,
`CREATE OR REPLACE`) para poder reaplicarlas sin miedo.

### Tablas principales

| Módulo | Tablas |
|---|---|
| Auth | `organizations`, `memberships`, `user_roles` |
| Productos | `products`, `product_variants`, `locations`, `stock_movements` (kardex) |
| Compras | `purchases`, `purchase_items` |
| Ventas | `sales`, `sale_items`, `sale_installments` |
| POS / Caja | `cash_sessions`, `cash_entries` |
| Clientes | `customers`, `customer_notes`, `customer_communications` |
| CRM | `deals` (pipeline), `referrals`, `loyalty_cards` |
| Finanzas | `debts`, `expenses`, `cheques`, `bank_transactions`, `supplier_debts` |
| Facturas | `invoices` |
| Proveedores | `suppliers`, `supplier_debts` |
| Marketing | `marketing_posts`, `marketing_templates`, `email_campaigns`, `influencers`, `combos` |
| IA | `ai_offer_recommendations`, `automation_flows` |
| Integraciones | `tiendanube_tokens`, `webhook_settings`, `payment_links` |
| SaaS | `subscriptions`, `organizations` (plan, trial) |
| Tareas | `tasks` |
| Configuración | `org_settings`, `price_history`, `product_lots`, `product_tags` |

### Buckets de Storage

| Bucket | Contenido |
|---|---|
| `product-images` | Imágenes de productos |
| `invoice-pdfs` | PDFs de facturas |
| `backups` | Backups manuales |

### Crons programados (pg_cron / Supabase Schedules)

| Schedule | Función | Descripción |
|---|---|---|
| `0 3 1 * *` | `auto-recurring-expenses` | Gastos recurrentes (1ro de cada mes, 3 AM UTC) |
| `0 4 * * 0` | `weekly-backup` | Backup semanal (domingos 4 AM UTC) |
| `0 8 * * *` | `check-stock-alerts` | Alertas de stock bajo (diario) |
| `0 9 * * *` | `check-overdue-debts` | Deudas vencidas (diario) |
| `0 10 * * 1` | `customer-reactivation-alerts` | Clientes inactivos (lunes) |
| `0 11 * * 1` | `weekly-performance-digest` | Digest semanal (lunes) |
| `0 18 * * *` | `daily-kpi-alert` | Alerta KPIs (diario) |
| `*/5 * * * *` | `send-scheduled-campaigns` | Campañas programadas (cada 5 min) |
| `* * * * *` | `run-automation-flows` | Automatizaciones (cada minuto) |
| `15 * * * *` | `recover-abandoned-carts` | Carritos abandonados (cada hora) |

> Todos los crons llaman `public.invoke_edge_function(nombre)`, que lee
> `SUPABASE_URL` y `SUPABASE_ANON_KEY` del **vault de Supabase**. Sin esos dos
> secretos fallan todos en silencio. Ver [docs/CRON.md](docs/CRON.md).

## Qué está construido y qué se usa

[docs/CAPACIDADES.md](docs/CAPACIDADES.md) separa las capacidades en cuatro
estados —construido, probado, operado y adoptado— con la evidencia medida al
lado. Es el lugar honesto para responder "¿esto anda?": un README describe
código, y código que existe no es código que funcionó.

## Las cuatro superficies

| Superficie | Ruta | Quién entra | Aislamiento |
|---|---|---|---|
| Gestión | `/` | miembros de una organización (`memberships`) | RLS por `org_id` |
| Finance | `/finance` | miembros **con el producto habilitado** y `finance.view` | entitlement por organización + permiso por persona |
| Plataforma | `/platform` | staff del SaaS (`platform_admins`) | no da permisos dentro de una org |
| Tienda pública | `/tienda/:slug` | comprador anónimo o con cuenta | RPCs `security definer` con columnas saneadas |

Ser staff de plataforma **no** habilita nada dentro de una organización, y un
comprador con cuenta en una tienda **no** es usuario del panel de gestión.
Detalle en [docs/permisos.md](docs/permisos.md).

**Finance es una superficie aparte, no un módulo de Gestión.** Comparte el
deploy y la base, pero tiene su propio shell, su propio gate de acceso y su
propio criterio de producto: gestión de gastos corporativos, al estilo Mendel.
Entrar a Gestión no habilita Finance, y tener Finance no es tener Gestión. El
porqué de esa separación —y cuándo justificaría otra aplicación física— está en
[docs/ADR_001_FINANCE_PRODUCT_SURFACE.md](docs/ADR_001_FINANCE_PRODUCT_SURFACE.md).

## Tienda online

Una tienda completa por organización, en `/tienda/:slug`:

- Home con hero, categorías y filas de ofertas, destacados y novedades
- Listado con filtros (categoría, género, familia olfativa, ofertas) y orden,
  todo reflejado en la URL para poder compartir un filtro
- Ficha con galería, variantes (talle / sabor / mililitraje) con precio y stock
  propios, y perfil olfativo
- Carrito persistente y recuperación de carritos abandonados por email
- Checkout con cupones, envío por zona o transportista, y cobro con MercadoPago
- Cuentas de comprador con historial de pedidos
- Píxeles de Meta, Google Analytics y TikTok, configurables por tienda

Reglas que no se negocian:

- **El precio nunca sale del navegador.** El checkout manda ids y cantidades;
  el servidor relee productos, valida stock y recalcula todo.
- **Las páginas públicas no leen tablas crudas.** Van por
  [`src/lib/publicDataSource.ts`](src/lib/publicDataSource.ts), y
  `publicSurface.test.ts` falla si alguien se saltea la regla o pide una columna
  de costo, margen o credencial.

Configuración de cobros en [docs/PAGOS.md](docs/PAGOS.md): la plataforma tiene
**una** aplicación de MercadoPago y cada comercio conecta su cuenta por OAuth,
igual que Tiendanube. El dinero va directo al comercio.

## Edge Functions

**65 funciones serverless** en `supabase/functions/` (`ls supabase/functions | wc -l`,
2026-08-24). La lista canónica es el filesystem: `npm run deploy:functions` la
deriva de ahí, así que una función nueva no puede quedar sin deployar. La tabla
siguiente describe las principales, no es exhaustiva:

| Función | Descripción |
|---|---|
| `afip-authorize` | Autorización de facturas en AFIP |
| `ai-analysis` | Análisis de negocio con IA |
| `ai-chat` | Chat inteligente |
| `ai-offer-recommender` | Recomendaciones de ofertas |
| `auto-recurring-expenses` | Creación automática de gastos recurrentes |
| `cancel-subscription` | Cancelación de suscripción Stripe |
| `check-overdue-debts` | Detección de deudas vencidas |
| `check-stock-alerts` | Alertas de stock bajo |
| `create-checkout` | Checkout Stripe para suscripciones |
| `customer-reactivation-alerts` | Alertas de clientes inactivos |
| `daily-kpi-alert` | Resumen diario de KPIs |
| `fetch-usd-rate` | Tipo de cambio USD |
| `generate-description` | Descripción de producto con IA |
| `mercadopago-link` | Link de pago Mercado Pago |
| `platform-admin-action` | Acciones de administración de plataforma |
| `predict-sales` | Predicción de ventas con IA |
| `public-api` | API pública con API keys |
| `run-automation-flows` | Ejecución de flujos de automatización |
| `send-email-campaign` | Envío de campañas de email |
| `send-invoice-email` | Envío de factura por email |
| `send-scheduled-campaigns` | Campañas de email programadas |
| `send-webhook` | Webhooks salientes |
| `stripe-webhook` | Receptor de webhooks Stripe |
| `tiendanube-oauth` | OAuth con Tiendanube |
| `tiendanube-register-webhooks` | Registro de webhooks en Tiendanube |
| `tiendanube-sync` | Sincronización de productos/pedidos Tiendanube |
| `tiendanube-webhook` | Receptor de webhooks Tiendanube |
| `weekly-backup` | Backup semanal de datos |
| `weekly-performance-digest` | Digest semanal de rendimiento |

## Despliegue

### Frontend

El proyecto está configurado para Lovable (lovable.dev). Para desplegar manualmente:

```bash
npm run build
# Subir dist/ a Netlify, Vercel, o cualquier host estático
```

### Edge Functions

```bash
# Desplegar todas las funciones
supabase functions deploy

# Desplegar una función específica
supabase functions deploy afip-authorize
```

### Variables secretas en producción

```bash
supabase secrets set STRIPE_SECRET_KEY=sk_live_...
supabase secrets set RESEND_API_KEY=re_...
# etc.
```

## Arquitectura multi-tenant

La aplicación es multi-tenant. Cada registro sensible incluye `org_id` (UUID de organización). Las políticas RLS de Supabase filtran datos por organización en todas las tablas críticas.

Los roles de miembro son: `admin`, `seller`, `viewer`. El acceso a módulos sensibles (finanzas, configuración, plataforma) requiere rol `admin` o permiso explícito.

## Módulos principales

- **Dashboard** — KPIs, gráficos, salud del negocio, predicciones
- **Productos** — CRUD, variantes, imágenes, precios, lotes
- **Inventario** — Stock por ubicación, toma física, kardex, restock automático, transferencias
- **Ventas / POS** — Registro de ventas, caja, turnos, recibos, cuotas, descuentos
- **Presupuestos** — Conversión a venta, PDF
- **Clientes / CRM** — Ficha 360, notas, segmentación, pipeline, fidelidad, referidos
- **Proveedores** — CRUD, compras, deudas, pagos
- **Finanzas** — Deudas, gastos, cheques, conciliación bancaria, flujo de caja
- **Facturas AFIP** — Emisión, PDF, envío por email, autorización AFIP
- **Marketing** — Posts, templates, catálogo público, combos, historias, influencers, campañas
- **Integraciones** — Tiendanube, Mercado Pago, Stripe, AFIP, API pública, webhooks
- **IA** — Insights, chat, predicciones, recomendaciones, generación de textos
- **Automatizaciones** — Flujos trigger-acción con historial
- **Equipo** — Miembros, roles, invitaciones, comisiones
- **Configuración** — Organización, sucursales, facturación, notificaciones

## Checklist de puesta en producción

- [ ] Configurar todas las Edge Function secrets en Supabase Dashboard
- [ ] Aplicar migraciones pendientes (`npx supabase db push --linked --dry-run` tiene que responder `upToDate:true`)
- [ ] Verificar dominio en Resend para envío de emails
- [ ] Configurar webhook URL de Stripe en dashboard Stripe
- [ ] Registrar webhooks Tiendanube llamando a `tiendanube-register-webhooks`
- [ ] Configurar certificado y clave AFIP para ambiente de producción
- [ ] Activar crons en Supabase Dashboard > Edge Functions > Schedules
- [ ] Revisar RLS en Supabase Dashboard > Authentication > Policies
- [ ] Configurar Sentry DSN en variables de entorno del frontend
- [ ] Probar flujo completo: registro → onboarding → venta → caja → factura

## Seguridad

- No versionar el archivo `.env` (ya está en `.gitignore`)
- Los secretos de Edge Functions van **solo** en Supabase Secrets, nunca en el frontend
- Revisar RLS periódicamente cuando se agreguen tablas nuevas
- Rotar API keys si se detecta exposición

## Licencia

Propietario — © 2026 Exentry Imports. Todos los derechos reservados.
