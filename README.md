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

# 4. Aplicar migraciones
supabase db push

# 5. Iniciar servidor de desarrollo
npm run dev
```

## Comandos disponibles

```bash
npm run dev          # Servidor de desarrollo en http://localhost:8080
npm run build        # Build de producción
npm run preview      # Preview del build
npm run lint         # ESLint
npm run test         # Tests con Vitest
npm run test:watch   # Tests en modo watch
```

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

El proyecto usa Supabase. Las migraciones están en `supabase/migrations/` (62 archivos al 2026-05-05).

### Aplicar migraciones

```bash
# Conectar al proyecto
supabase link --project-ref <project-id>

# Aplicar todas las migraciones pendientes
supabase db push

# Ver estado de migraciones
supabase migration list
```

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

## Edge Functions

Listado de las 29 funciones serverless en `supabase/functions/`:

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
- [ ] Aplicar migraciones con `supabase db push`
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
