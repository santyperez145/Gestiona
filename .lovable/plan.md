

# Plan: Transformar Exentry Imports en SaaS Multi-Tenant Reventible

## Estado actual vs objetivo SaaS

**Lo que ya tenés (bueno):**
- Multi-tenant **parcial**: cada usuario tiene `user_id` en todas las tablas con RLS scoped por `auth.uid()`. Funciona aislamiento por usuario.
- Branding configurable por usuario (`settings.business_name`, `logo_url`, `primary_color`).
- Sistema de roles 3-tier (admin/vendedor/viewer).
- Backend completo (Cloud + edge functions + cron).

**Lo que falta para ser SaaS profesional reventible:**
1. **Concepto de "organización/workspace"** — hoy cada usuario es su propia isla. Para SaaS real necesitás que un *cliente* (negocio) tenga múltiples usuarios (admin, vendedores, viewers) bajo la misma cuenta.
2. **Sistema de planes/suscripciones** (Free / Pro / Enterprise) con límites de uso.
3. **Onboarding self-service** (registro → wizard → trial 14 días → primer producto).
4. **Landing page comercial** pública con pricing.
5. **Panel super-admin** (vos como dueño del SaaS) para ver todos los tenants, métricas, MRR.
6. **Facturación automática** (Stripe/MercadoPago).
7. **White-label completo** (cada cliente con su dominio o subdominio + sin marca Lovable).
8. **Observabilidad** (Sentry, analytics) + límites por plan.
9. **Documentación + términos legales** (TOS, Privacidad).

---

## Fase 1: Migración a arquitectura Organization-based (CRÍTICO)

### Cambio de modelo de datos

```text
ANTES:                          DESPUÉS:
auth.users                      auth.users
   └─ user_id en todas tablas      └─ memberships
                                       └─ organization_id
                                          └─ org_id en todas las tablas
```

**Migración SQL:**
- Tabla `organizations`: id, name, slug, logo_url, plan, trial_ends_at, subscription_status, created_at, owner_id
- Tabla `memberships`: id, org_id, user_id, role (owner/admin/vendedor/viewer), invited_by, joined_at
- Agregar `org_id` a TODAS las tablas existentes (products, sales, purchases, debts, expenses, settings, etc.)
- Migrar datos: para cada user_id existente → crear org → asignar membership owner → backfill org_id en todas las tablas
- Reescribir TODAS las RLS policies para usar `org_id IN (SELECT org_id FROM memberships WHERE user_id = auth.uid())`
- Función `get_user_orgs()` y `has_org_role(_org_id, _role)` SECURITY DEFINER
- `settings` pasa a ser `org_settings` (un settings por org, no por user)

### Selector de organización
- Si un usuario pertenece a múltiples orgs, dropdown en el header
- Persiste org activa en `localStorage` + claim JWT custom

---

## Fase 2: Sistema de Planes y Suscripciones

### Planes definidos
| Plan | Precio | Productos | Ventas/mes | Usuarios | IA | Backups |
|---|---|---|---|---|---|---|
| Trial | 14 días gratis | ∞ | ∞ | 3 | Sí | Sí |
| Starter | $29 USD/mes | 100 | 500 | 2 | No | Manual |
| Pro | $79 USD/mes | 1000 | 5000 | 5 | Sí | Auto semanal |
| Business | $199 USD/mes | ∞ | ∞ | ∞ | Sí + custom | Auto diario |

### Implementación
- Tabla `plans` (configurable desde super-admin)
- Tabla `subscriptions` (org_id, plan_id, status, current_period_end, stripe_subscription_id)
- Middleware/hook `useEntitlements()` que valida límites antes de crear recursos
- Componente `<UpgradePrompt />` cuando se alcanza límite
- Integración **Stripe** (recomendado — usar `payments--enable_stripe_payments` con Lovable seamless, sin credenciales propias)

---

## Fase 3: Landing + Onboarding + Pricing

### Nueva estructura de rutas
```
/                  → Landing comercial (público)
/pricing           → Tabla de planes
/login, /signup    → Auth (existente)
/onboarding        → Wizard 4 pasos (nombre negocio, rubro, primer producto, invitar equipo)
/app/*             → La app actual (rutas protegidas, requiere org activa)
/admin             → Super-admin global (solo SaaS owner)
/catalogo/:slug    → Catálogo público (existente, ahora por org slug en vez de userId)
```

### Componentes nuevos
- `LandingPage.tsx`: hero, features, testimonios, pricing, CTA
- `PricingPage.tsx`: comparativa planes con botones checkout
- `OnboardingWizard.tsx`: stepper con validación
- `InviteTeamModal.tsx`: invitar por email con role

---

## Fase 4: Super-Admin Dashboard (para vos)

Ruta `/super-admin` accesible solo a usuarios con `super_admin` flag (tabla `platform_admins`):
- Lista de todas las orgs con MRR, plan, usuarios activos, último login
- Métricas globales: ingresos totales, churn, conversion trial→paid
- Acciones: suspender org, cambiar plan manualmente, regalar créditos
- Logs de auditoría globales
- Health check de edge functions y cron jobs

---

## Fase 5: White-Label y Branding

- **Quitar marca Lovable**: usar `publish_settings--set_badge_visibility { hide_badge: true }` (requiere plan Pro de Lovable)
- **Custom domain por SaaS**: vos comprás un dominio principal (ej. `gestiona.app`) y lo conectás vía Lovable → Settings → Domains
- **Subdominios por tenant** (Fase futura avanzada): `cliente1.gestiona.app` — requiere DNS wildcard + edge logic
- **Por ahora viable**: cada org tiene su `slug` y comparte catálogo en `gestiona.app/c/:slug`
- **Branding del producto**: renombrar todas las referencias "Exentry Imports" hardcoded a leerse desde `org_settings.business_name`

---

## Fase 6: Observabilidad + Producción

- **Sentry**: agregar `@sentry/react` para error tracking (requiere DSN del usuario)
- **PostHog/Plausible**: analytics de uso por org
- **Rate limiting** en edge functions críticas
- **Healthchecks** públicos
- **Términos y Privacidad**: páginas `/terms` y `/privacy` (placeholders editables)
- **Email transaccional**: configurar dominio en Cloud → Emails para signup, reset password, invitaciones

---

## Fase 7: Cómo descargar y desplegar fuera de Lovable

### Opción A: Seguir en Lovable (más simple)
- Conectar tu propio dominio en Settings → Domains
- Activar "Hide badge" (Pro plan Lovable)
- Lovable hostea, vos vendés acceso. Costo: tu plan Lovable + Cloud usage.
- Pros: cero ops. Contras: dependencia de Lovable.

### Opción B: Auto-hospedaje (control total)
1. **Conectar GitHub**: GitHub → Connect en Lovable → repo privado en tu cuenta
2. **Clonar localmente**: `git clone <repo-url>`
3. **Backend Supabase propio**:
   - Crear proyecto en supabase.com
   - Copiar todas las migraciones de `supabase/migrations/` y ejecutarlas
   - Deploy edge functions con `supabase functions deploy`
   - Configurar secrets, storage buckets, cron jobs
   - Actualizar `.env` con nuevas URLs/keys
4. **Frontend deploy**:
   - **Vercel** (recomendado): import repo → auto-deploy en cada push, dominio gratis + SSL
   - Alternativas: Netlify, Cloudflare Pages, Railway
5. **Stripe propio**: crear cuenta Stripe, agregar webhook endpoint
6. **Costos estimados mensual**: Supabase Pro $25 + Vercel Pro $20 + dominio $1 = ~$46/mes para empezar

Te dejo guía completa en `DEPLOYMENT.md` dentro del repo.

---

## Mejoras técnicas pendientes detectadas

1. **Eliminar últimos hardcodeos**: `seedData.ts` (solo para demos, condicionar a flag), referencias a "Exentry Imports" en componentes
2. **Tests E2E** con Playwright (ya existe fixture, expandir cobertura)
3. **i18n** (es-AR / en) con `react-i18next` para vender fuera de Argentina
4. **PWA** con `vite-plugin-pwa` para instalación móvil
5. **Versionado de API**: prefijo `/v1/` en edge functions
6. **Rate limiting** en `predict-sales` y `generate-description` (cuesta créditos IA)
7. **Soft delete** en lugar de DELETE en tablas críticas (auditoría)
8. **Indexes faltantes** en `org_id`, `created_at` para performance a escala

---

## Decisiones que necesito de vos antes de empezar

Esto es trabajo muy grande (~3-4 sesiones intensas). Antes de codear, necesito que me confirmes algunas decisiones clave para no rehacer trabajo.

---

## Archivos principales (resumen)

| Categoría | Archivos |
|---|---|
| Migración SQL | `organizations`, `memberships`, `plans`, `subscriptions`, `platform_admins`, backfill de `org_id`, reescritura de RLS |
| Auth/Org context | `src/lib/orgContext.tsx`, `useEntitlements.ts`, `OrgSwitcher.tsx` |
| Comercial | `LandingPage.tsx`, `PricingPage.tsx`, `OnboardingWizard.tsx`, `terms/`, `privacy/` |
| Super-admin | `pages/SuperAdminPage.tsx` + edge function `platform-metrics` |
| Pagos | Integración Stripe seamless + webhooks + edge function `stripe-webhook` |
| White-label | Refactor de `business_name` en TODOS los componentes que lo hardcodean |
| Deploy guide | `DEPLOYMENT.md`, `.env.example`, scripts `setup.sh` |
| Observabilidad | Sentry init, analytics, rate limit middleware en edge functions |

**Orden de ejecución sugerido (sesión por sesión):**
1. **Sesión 1**: Migración a organizaciones + RLS + UI org switcher
2. **Sesión 2**: Planes + entitlements + Stripe + landing + pricing + onboarding
3. **Sesión 3**: Super-admin + white-label + observabilidad
4. **Sesión 4**: Guía deploy + i18n + PWA + tests + pulido final

