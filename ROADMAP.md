# ROADMAP — Gestiona / Exentry Imports
### Enterprise ERP/CRM SaaS · Competing at Salesforce Level

```
Última actualización : 2026-05-29
DB producción        : hummeopatkniwkyrrhwc (Supabase / Postgres 15)
Versión de producto  : MVP Avanzado → Enterprise Platform
Sesiones completadas : 77
```

---

## 1. VISIÓN ESTRATÉGICA

> **Ser el sistema operativo de las pymes latinoamericanas.**
> No un ERP de escritorio, no un CRM con Excel disfrazado.
> Una plataforma de inteligencia de negocio en tiempo real, accesible, y con IA integrada que cualquier comercio puede operar sin IT.

### Propuesta de valor única
| Dimensión | Gestiona / Exentry | Salesforce | Odoo | HubSpot |
|-----------|-------------------|------------|------|---------|
| Foco LATAM / Argentina | ✅ Nativo | ❌ Adaptado | ⚠️ Parcial | ❌ |
| AFIP / facturación fiscal | ✅ | ❌ | ❌ | ❌ |
| Dólar blue / FX local | ✅ | ❌ | ❌ | ❌ |
| IA generativa integrada | ✅ Claude | ⚠️ Einstein | ❌ | ⚠️ Copilot |
| POS + caja nativo | ✅ | ❌ | ✅ | ❌ |
| WhatsApp marketing nativo | ✅ Evolution API | ❌ | ❌ | ❌ |
| Precio por pyme | ✅ USD 29-99 | ❌ USD 300+ | ⚠️ USD 15+ | ❌ USD 50+ |
| Setup sin IT | ✅ | ❌ | ❌ | ⚠️ |
| Tiempo al valor | < 10 min | Semanas | Días | Horas |

### North Star Metric
**Ventas registradas por organización activa por día** — cuando una org registra ≥3 ventas/día durante 14 días consecutivos, no se va. Todo el producto está diseñado para llegar a ese umbral lo más rápido posible.

---

## 2. POSICIONAMIENTO COMPETITIVO — SALESFORCE CLOUD POR CLOUD

### Sales Cloud ↔ Gestiona CRM
- Pipeline Kanban con drag-drop nativo
- Deal scoring 0–100 (valor + actividad + fecha + stage)
- Activity timeline por deal (nota/llamada/email/reunión/WhatsApp)
- Forecast de revenue mensual con regresión OLS
- Pipeline ponderado por probabilidad de cierre
- Win/Loss recording con razones y análisis
- Churn Risk Score por cliente (0–100)
- Customer Health Score (R+F+M percentil)
- Customer Lifetime Value proyectado
- Segmentación RFM con 7 segmentos automáticos
- Cuotas por vendedor con leaderboard

### Service Cloud ↔ Gestiona Support
- Tickets con numeración automática (SP-YYYYMMDD-XXXX)
- SLA automático con countdown y alerta de breach
- Thread interno/externo por ticket
- Notas privadas para el equipo
- Estados: open → in_progress → waiting_customer → resolved → closed
- Prioridades: low / medium / high / urgent
- Realtime subscriptions para nuevas respuestas

### Marketing Cloud ↔ Gestiona Marketing
- Email campaigns con branding propio (SMTP o Resend)
- WhatsApp masivo vía Evolution API (self-hosted, sin Twilio)
- 7 segmentos de audiencia automáticos
- Templates de email con preview HTML
- Campañas de cumpleaños automáticas
- Drip sequences por evento
- Carrito abandonado + follow-up
- Open rate / click rate tracking

### Einstein AI ↔ Gestiona IA
- Chat IA generativo (Claude 3.5 Sonnet, SSE streaming)
- Acciones reales desde chat (crear venta, tarea, compra, presupuesto)
- Análisis proactivo automático (8h cache por org)
- Predicción de demanda por SKU (velocity 60d → proyección 30d)
- Forecast de ventas con OLS (R², slope, horizon configurable)
- Restock inteligente con días de stock y urgencia
- Análisis de cliente / proveedor / producto / deuda / gastos desde chat
- Detección de anomalías (margen caído, bestseller dropout)
- Sugerencia automática diaria al abrir chat

### Finance Cloud ↔ Gestiona Finanzas
- P&L mensual automático con comparativa período anterior
- Conciliación bancaria multi-método
- Control de gastos con presupuesto por categoría y alerta
- Cheques y cuotas
- Facturación electrónica AFIP (A/B/C/NC)
- Caja con apertura/cierre/diferencias por turno
- Tipo de cambio tracking (oficial/blue/MEP) con alerta de desvío
- Multi-divisa & FX con exposición por moneda
- Escenarios financieros P&L + breakeven + cashflow

### Field Service ↔ Gestiona Operaciones
- Inventario aging con recomendaciones automáticas
- Pricing intelligence con scatter precio/margen
- Comisiones automáticas por vendedor
- Metas de equipo con leaderboard
- KPI Dashboard personalizable
- Automatizaciones con motor de ejecución real
- Alert rules configurables (5 tipos + product_expiry)

---

## 3. STACK TECNOLÓGICO DE CLASE MUNDIAL

### Frontend
```
React 18          — Concurrent Mode, Suspense, lazy loading
TypeScript 5      — strict mode, 0 any, tipado fuerte
Vite 5            — HMR < 50ms, bundle split, tree-shaking
Tailwind CSS 3    — design tokens, dark mode, responsive
Radix UI          — accesibilidad WCAG 2.1 AA, primitivos sin estilo
React Query       — cache, invalidation, optimistic updates
Recharts          — charts responsive y accesibles
PWA               — offline, installable, auto-update
```

### Backend & Database
```
Supabase Postgres 15   — RLS por org_id en todas las tablas
Supabase Auth          — JWT, OAuth, MFA (pendiente TOTP)
Supabase Realtime      — WebSocket Presence + Postgres Changes
Supabase Edge Functions — Deno, SSE streaming, TypeScript nativo
Supabase Storage       — imágenes, recibos, logos
pg_cron                — jobs programados en DB
pgvector               — embeddings para búsqueda semántica (roadmap)
pg_trgm                — full-text search con ranking
```

### IA & ML
```
Anthropic Claude 3.5 Sonnet — chat, análisis, streaming SSE
Regresión OLS client-side   — forecast de ventas
Algoritmos heurísticos      — churn risk, health score, deal score
ML (roadmap)                — Prophet/ARIMA para demanda, embeddings
```

### Integraciones
```
Mercado Pago     — checkout, webhooks HMAC-SHA256
Stripe           — billing SaaS, subscriptions, dunning
AFIP             — facturación electrónica A/B/C/NC
Tiendanube       — OAuth, sync productos, webhooks
Evolution API    — WhatsApp self-hosted, sin costo por mensaje
Resend           — email transaccional con fallback
SMTP propio      — cualquier proveedor (Gmail, Outlook, Brevo)
```

### Observabilidad & Calidad
```
Sentry          — error tracking + performance monitoring
Vitest          — 54+ tests unitarios
TypeScript      — 0 errores en todo el codebase
jsPDF           — reportes PDF profesionales
date-fns        — manipulación de fechas (no moment.js)
Fuse.js         — búsqueda fuzzy client-side
ZXing           — lectura de barcodes/QR
canvas-confetti — microinteracciones de celebración
```

---

## 4. PILARES DE SEGURIDAD & COMPLIANCE

> La seguridad no es un sprint, es una disciplina continua. Este plan la trata como tal.

### 4.1 Autenticación & Identidad

| Control | Estado Actual | Target |
|---------|---------------|--------|
| JWT auth + refresh | ✅ Supabase Auth | — |
| Google OAuth | ✅ | — |
| MFA / TOTP (Authenticator App) | ❌ | Sprint A1 |
| MFA SMS backup | ❌ | Sprint A2 |
| Hardware keys (WebAuthn/FIDO2) | ❌ | Sprint A3 |
| SSO SAML 2.0 (Enterprise) | ❌ | Sprint B1 |
| SSO OIDC | ❌ | Sprint B1 |
| SCIM provisioning (AD/Okta) | ❌ | Sprint B2 |
| Biometric auth (mobile) | ❌ | Sprint C1 |
| Passkeys (WebAuthn platform) | ❌ | Sprint C2 |

### 4.2 Autorización & Permisos

| Control | Estado Actual | Target |
|---------|---------------|--------|
| Roles base (admin/vendedor/viewer) | ✅ | — |
| RLS en todas las tablas | ✅ Migration 20260421 | — |
| Permisos granulares por módulo | ⚠️ `usePermissions` parcial | Sprint A1 |
| Permisos por feature (caja, ventas, inventario) | ❌ | Sprint A1 |
| IP allowlist por org | ❌ | Sprint B1 |
| Session management (dispositivos activos) | ❌ | Sprint A2 |
| Forced logout remoto | ❌ | Sprint A2 |
| Field-level security (enmascarar datos) | ❌ | Sprint B2 |
| Audit log inmutable | ⚠️ Parcial | Sprint A1 |

### 4.3 Datos & Privacidad

| Control | Estado Actual | Target |
|---------|---------------|--------|
| Encriptación en tránsito (TLS 1.3) | ✅ Supabase | — |
| Encriptación en reposo (AES-256) | ✅ Supabase | — |
| PII masking en logs | ❌ | Sprint A2 |
| Right to deletion (GDPR Art. 17) | ❌ | Sprint A2 |
| Data export (portabilidad) | ⚠️ CSV parcial | Sprint A2 |
| Ley 25.326 (privacidad AR) | ✅ Privacy page | Sprint A2 mejoras |
| Retention policies | ❌ | Sprint B1 |
| Tokenización datos de pago | ✅ Stripe handles | — |
| PCI DSS scope reduction | ✅ No almacenamos PAN | — |

### 4.4 API & Integrations Security

| Control | Estado Actual | Target |
|---------|---------------|--------|
| API keys SHA-256 con scopes | ✅ | — |
| Rate limiting por plan | ✅ | Sprint A1 mejorar |
| OAuth 2.0 + PKCE para terceros | ❌ | Sprint B1 |
| Webhook signatures HMAC-SHA256 | ✅ | — |
| Dead letter queue + retries | ✅ | — |
| API versioning (/v1/) | ✅ | — |
| Certificate pinning (mobile) | ❌ | Sprint C1 |

### 4.5 Infraestructura & Operaciones

| Control | Estado Actual | Target |
|---------|---------------|--------|
| WAF (Web Application Firewall) | ✅ Supabase/Vercel | — |
| DDoS protection | ✅ Vercel Edge | — |
| Backups automáticos | ✅ Supabase PITR | Sprint A1: 30d retention |
| Disaster recovery plan | ❌ | Sprint A2 |
| Incident response playbook | ❌ | Sprint A2 |
| Penetration testing | ❌ | Sprint B1 anual |
| Dependency audit (npm audit) | ❌ CI | Sprint A1 |
| Secret scanning en CI | ❌ | Sprint A1 |
| SBOM (Software Bill of Materials) | ❌ | Sprint B2 |

### 4.6 Compliance Roadmap

| Standard | Relevancia | Timeline |
|----------|-----------|---------|
| Ley 25.326 (AR) | Alta — datos personales | ✅ base + mejoras Sprint A2 |
| GDPR (clientes EU) | Media — exportar a EU | Sprint B1 |
| SOC 2 Type I | Alta — ventas enterprise | Sprint B2 |
| SOC 2 Type II | Alta — credibilidad | Sprint C1 |
| ISO 27001 | Media — enterprise grandes | 2028 |
| PCI DSS SAQ A | Baja — Stripe lo maneja | Documentar Sprint A2 |

---

## 5. ARQUITECTURA DE INFRAESTRUCTURA

### 5.1 Stack actual (production-ready)
```
Frontend:  Vercel Edge Network (CDN global, SSR, preview deploys)
Database:  Supabase (Postgres 15, pgBouncer pool, PITR backups)
Auth:      Supabase GoTrue (JWT, refresh tokens, MFA pendiente)
Storage:   Supabase Storage (S3-compatible, CDN con signed URLs)
Functions: Supabase Edge Functions (Deno, geo-distributed)
Crons:     pg_cron en DB (7 jobs activos)
Email:     Resend + SMTP propio (fallback chain)
WA:        Evolution API (self-hosted, Railway/Render)
Sentry:    Error tracking + performance traces
```

### 5.2 Limitaciones actuales identificadas

| Componente | Problema | Impacto | Solución |
|-----------|---------|---------|---------|
| Supabase plan | Free/Pro → límite connections | Escala a 500+ orgs | Upgrade a Supabase Team + pgBouncer |
| Realtime channels | 1 canal por feature/org | Multiplica con orgs | Channel multiplexer o Supabase Broadcast |
| Edge Functions cold start | ~200ms en Deno | Latencia IA | Keep-warm via cron |
| Bundle size | 427kB inicial (post-split) | TTI mobile 3G | Preload critical routes |
| Images | Sin optimización automática | LCP > 2.5s | next/image equivalent en Vite |
| DB queries | Sin query analyzer | N+1 silencioso | pg_stat_statements + slow query log |
| Sin staging env | Deploy directo a prod | Riesgo regresión | Supabase branch + Vercel preview |

### 5.3 Arquitectura target (Enterprise-scale)
```
                         ┌──────────────────────────────┐
                         │     Vercel Edge Network      │
                         │  (CDN + WAF + DDoS protect)  │
                         └──────────────┬───────────────┘
                                        │
              ┌─────────────────────────▼──────────────────────────┐
              │                   API Gateway                       │
              │  (rate limiting · auth · versioning · tracing)     │
              └───┬───────────────────┬───────────────────┬────────┘
                  │                   │                   │
         ┌────────▼──────┐  ┌─────────▼──────┐  ┌────────▼───────┐
         │  Edge Fns     │  │  Supabase DB   │  │  AI Services   │
         │  (Deno)       │  │  (Postgres 15) │  │  (Claude API)  │
         │  · auth       │  │  · RLS + RLS   │  │  · streaming   │
         │  · webhooks   │  │  · realtime    │  │  · embeddings  │
         │  · AI proxy   │  │  · crons       │  │  · batch jobs  │
         │  · email/WA   │  │  · vector      │  └────────────────┘
         └───────────────┘  └────────────────┘
                  │                   │
         ┌────────▼──────────────────▼────────┐
         │           Observability Stack       │
         │  Sentry · PostHog · Grafana (plan) │
         └─────────────────────────────────────┘
```

### 5.4 Escalabilidad — planes por etapa

| Etapa | Orgs | Estrategia |
|-------|------|-----------|
| MVP (actual) | < 200 | Supabase Pro, Vercel Pro |
| Growth | 200–1.000 | Supabase Team, read replica, CDN caching |
| Scale | 1.000–5.000 | Supabase Enterprise, multi-region, queue |
| Enterprise | 5.000+ | Dedicated infra, Kubernetes, data warehouse |

---

## 6. HISTORIAL DE SESIONES COMPLETADAS

> Resumen condensado. El registro completo detallado está en el archivo.

### Sesiones 1–10 — Base técnica + módulos core
- Infraestructura: PWA, Realtime, JWT, code splitting 427kB, Sentry
- Auth: roles, invitaciones, platform admin, RLS completa
- Inventario: Kardex, ajustes auditados, alertas, toma física
- Ventas: POS, caja, presupuestos, devoluciones, cupones
- Clientes: CRM 360°, pipeline Kanban, RFM, segmentos
- Finanzas: gastos, deudas, conciliación, cheques, cuotas, AFIP
- Reportes: P&L, inventario valorado, exportaciones CSV/PDF
- IA: forecast OLS, chat generativo, análisis proactivo

### Sesiones 11–20 — IA accionable + UX empresarial
- Chat IA con acciones reales (crear venta/compra/tarea/cliente)
- Segmentos RFM en DB (migrado de localStorage)
- Kanban de tareas con subtareas y drag-drop
- Analytics: ABC analysis, cohorts, canales de venta
- POS: split de pago, variantes, offline mode, keyboard shortcuts
- Presupuestos: automatización completa + recordatorios WA
- Email: SMTP propio, branding, test-send, tracking

### Sesiones 21–40 — Enterprise features
- Facturas: notas de crédito, envío masivo, filtros
- Deals: activity timeline, deal scoring, pipeline analytics
- Clientes: CLV, churn risk score, importación CSV avanzada
- Vendedores: cuotas, leaderboard, comisiones, metas
- WhatsApp: Evolution API, campañas masivas, digest diario
- Links de pago: CRUD completo, MP integration, público
- Integraciones: Tiendanube, health checks, dead-letter queue

### Sesiones 41–60 — Diferenciación competitiva
- Dashboard: temperatura del negocio, forecast 7d, comparativa semanal
- POS: bundles/kits, VIP discount automático, recibo por email
- IA chat: análisis por segmento WA, resumen ventas/deudas/gastos
- Reportes: comparativa dual de períodos, semanas, tendencia
- Soporte: SupportPage completo (Service Cloud)
- Realtime: SSE streaming IA, Presence WebSocket, KPIs live
- Expensas: stacked chart, vencimientos recurrentes, adjuntos

### Sesiones 61–77 — Madurez del sistema
- Pages nuevas: ActivityFeed, SellerGoals, InventoryAging, FollowUp
- Pages nuevas: PricingIntelligence, TeamPerformance
- Pipeline: deal_stage_change automation, forecast chart
- CustomersPage: exportCSV 18 cols, ficha 360 PDF, estado de cuenta
- ProductsPage: vista grilla, bulk delete, precio/stock inline
- Dashboard: 8h chart, temperatura 5 señales, objetivos por vendedor
- UX audit: 0 subtitle=, 0 icon JSX, 134/146 páginas con KPICards

### Sesión 78 — Refocus de producto + rediseño visual (2026-07-24)
- Refocus de alcance: 160 → 83 páginas (bloque2/bloque3), eliminando
  módulos enterprise fuera de foco (HR/payroll, fleet, project mgmt,
  e-learning, territorios, contratos B2B, revenue recognition, etc.)
  y consolidando duplicados (fidelidad, CRM, analytics, pricing,
  inventario, marketing) en tabs dentro de páginas padre
- Nav reconstruido alrededor del alcance final: Principal / Inventario
  / Ventas & CRM / Ecommerce & Multi-Tienda / Finanzas / Marketing &
  Influencers / Analytics / Administración
- Nuevo: multi-tienda (sucursales), portal de influencers, atribución
  de campañas vía cupones, kardex de canjes con influencers
- Rediseño visual completo: tema "oscuro premium" (dorado → zafiro),
  tema claro real + toggle persistente (next-themes), sidebar con
  rail de íconos fijo en tablet (768-1023px, antes se comportaba
  igual que celular), 10 primitivos de UI + Dashboard corregidos para
  no depender de fondos oscuros hardcodeados

---

## 7. ROADMAP DE PRODUCTO 2026–2028

### PRINCIPIOS DE PRIORIZACIÓN
```
P0 — Bloquea el crecimiento o genera riesgo legal/seguridad
P1 — Diferenciador clave vs competidores directos
P2 — Mejora de retención y NPS
P3 — Nice-to-have, monetización adicional
```

---

## FASE 1 — ENTERPRISE HARDENING (Q3 2026)
> **Objetivo:** Ser un sistema en el que una empresa mediana confíe con datos reales de producción.

### Sprint A1 — Seguridad & Permisos granulares
| P | Feature | Detalle técnico |
|---|---------|----------------|
| P0 | **MFA / TOTP obligatorio para admins** | Supabase Auth MFA: `supabase.auth.mfa.enroll()` TOTP; QR setup dialog en ProfilePage; challenge en login; enforcement por rol |
| P0 | **Permisos granulares por módulo** | Tabla `role_permissions (org_id, role, module, can_create, can_edit, can_delete, can_export)`; RPC `has_permission()`; middleware en cada página crítica |
| P0 | **Audit log inmutable** | Tabla `audit_log (id, org_id, user_id, action, entity, entity_id, before JSONB, after JSONB, ip, user_agent, ts)`; triggers en ventas/compras/productos/clientes; UI en Settings→Auditoría |
| P0 | **npm audit en CI** | GitHub Actions: `npm audit --audit-level=high`; bloqueante; dependabot alerts |
| P0 | **Secret scanning** | git-secrets + gitleaks en pre-commit hook + CI |
| P1 | **Session management UI** | Ver dispositivos activos; sesión activa con browser/OS/IP/fecha; botón "Cerrar sesión en este dispositivo" y "Cerrar todas" |
| P1 | **Backup retention 30 días** | Supabase PITR habilitado; documentar RTO < 1h, RPO < 15min |
| P1 | **Rate limiting granular por plan** | Edge function middleware: límites distintos por plan (Starter 100/min, Pro 500/min, Business 2000/min); headers `X-RateLimit-*` |

### Sprint A2 — Compliance & Data Privacy
| P | Feature | Detalle técnico |
|---|---------|----------------|
| P0 | **Right to deletion (Art. 17 Ley 25.326)** | RPC `delete_org_data(org_id)` → anonimiza clientes, elimina ventas históricas, purga storage; soft-delete en 30d, hard-delete en 90d; UI en Settings→Datos |
| P0 | **Data export completo** | Exportar TODO los datos de la org en ZIP: ventas CSV, clientes CSV, productos CSV, facturas PDF, adjuntos; Edge Function `export-org-data`; notificación por email cuando esté listo |
| P1 | **PII masking en logs** | Sentry beforeSend: strip emails, teléfonos, CUIT de error reports; sanitizer global |
| P1 | **Consent management** | Banner de cookies RGPD; registro de consentimiento con timestamp; política actualizada |
| P1 | **Disaster recovery playbook** | Documento runbook: procedimiento de restore desde PITR; contactos de emergencia; checklist post-incident |
| P2 | **Staging environment** | Supabase branch para staging; Vercel preview env con `.env.staging`; CI despliega a staging automáticamente en PRs |

### Sprint A3 — Infraestructura & Performance
| P | Feature | Detalle técnico |
|---|---------|----------------|
| P0 | **Slow query log + pg_stat_statements** | Identificar queries > 500ms; indexar `sales.org_id+date`, `customers.org_id`, `products.org_id+category`; `EXPLAIN ANALYZE` en todas las queries críticas |
| P0 | **Migración a Supabase Team plan** | Connection pooling (pgBouncer); 100k MAU; priority support; Sin cold starts en edge fns |
| P1 | **Image optimization** | Supabase Storage transformations: `?width=400&quality=80`; lazy loading con IntersectionObserver; AVIF/WebP auto-convert |
| P1 | **Critical path preload** | Preload Dashboard + Sales + POS routes en idle time; `<link rel="prefetch">` en sidebar links hover |
| P1 | **Status page público** | Instatus/Betterstack: uptime público en `status.gestiona.app`; webhook desde Sentry en P0 alerts |
| P2 | **Error budget tracking** | SLO 99.9% uptime (8.7h downtime/año permitido); weekly report automático desde Sentry |
| P2 | **Feature flags** | Supabase Flags o LaunchDarkly lite: roll out features por % de orgs; A/B testing server-side |

---

## FASE 2 — CRM & SALES INTELLIGENCE (Q3 2026)
> **Objetivo:** Superar a HubSpot CRM en profundidad de datos de ventas para LATAM.

### Sprint B1 — AI Lead Scoring & Deal Intelligence
| P | Feature | Detalle técnico |
|---|---------|----------------|
| P0 | **AI Lead Scoring automático (0–100)** | `leadScore()` heurístico en SalesPipelinePage: días abierto × stage × valor × actividad_reciente × close_date_proximity; badge color-coded en DealCard; sort pipeline por score; CSV export con columna score |
| P0 | **Win/Loss recording** | Form al cerrar deal: razón (precio/competidor/timing/producto/otro) + texto libre; tabla `deal_outcomes`; `WinLossPage`: win rate por razón, etapa, período; BarChart win rate mensual; CSV export |
| P0 | **Email drip sequences** | Tablas `drip_sequences + drip_enrollments`; secuencias de hasta 10 pasos con delay configurable (días desde evento); triggers: nuevo lead, presupuesto enviado, deal perdido, primera compra; `run-drip-sequences` edge function diaria |
| P1 | **Account hierarchy** | Tabla `companies (id, org_id, name, parent_id, industry, website, employees, country)`; clientes vinculados a empresa; vista "Empresa" con todos sus contactos y deals; B2B mode toggle |
| P1 | **Contact roles en deals** | Tabla `deal_contacts (deal_id, customer_id, role: decision_maker/influencer/champion/blocker)`; selector en ActivityPanel; vista de stakeholders por deal |
| P1 | **Territory management** | Tabla `territories (id, org_id, name, region, assigned_user_id)`; asignación de clientes/deals a territorio; SellerGoalsPage filtrado por territorio |
| P2 | **Competitor intelligence** | Campo `competitors` en deals; análisis de win rate contra X competidor; tag deals perdidos por competidor |
| P2 | **Deal templates** | Plantillas de deal predefinidas por categoría (producto/servicio/proyecto); auto-popula etapas y tareas estándar |

### Sprint B2 — Customer Intelligence
| P | Feature | Detalle técnico |
|---|---------|----------------|
| P0 | **NPS Score automático** | Edge function `send-nps-survey`: email post-compra a los 7 días con escala 0–10; tabla `nps_responses`; cálculo NPS = %promoters - %detractors; widget en Dashboard y CustomersPage |
| P0 | **CSAT en tickets de soporte** | Rating 1–5 al cerrar ticket; email automático al resolver; `avg_csat` por agente; SupportPage: CSAT panel |
| P1 | **Customer journey mapping** | Timeline visual en ficha 360: cada touchpoint (venta/email/WA/soporte/presupuesto) en cronología; filtro por tipo; exportable a PDF |
| P1 | **Predictive churn ML** | Modelo de regresión logística client-side con features: recency, frequency, monetary, sesiones de soporte, respuesta a emails; threshold configurable; lista "En riesgo de churn" con acción recomendada |
| P1 | **Smart segmentation con IA** | AIChatPage: "segmentá clientes que compraron X pero no Y"; genera filtro RFM complejo desde lenguaje natural; guarda segmento |
| P2 | **Customer communities** | Portal básico donde el cliente puede ver sus facturas, presupuestos y tickets; login con email mágico; branded con logo del negocio |

---

## FASE 3 — AI/ML PLATFORM (Q4 2026)
> **Objetivo:** Que la IA no sea un chat, sino el tejido conectivo de todo el sistema.

### Sprint C1 — ML Avanzado
| P | Feature | Detalle técnico |
|---|---------|----------------|
| P0 | **Demand forecasting con ML** | Prophet-like: estacionalidad semanal + mensual + tendencia; `useDemandForecast` hook; AnalyticsPage tab "Forecast" con intervalos de confianza; exportar CSV con predicciones |
| P0 | **Dynamic pricing con ML** | Sugerir precio óptimo por SKU basado en: elasticidad histórica, margen objetivo, inventario actual, estacionalidad; `OptimalPriceSuggestion` component en ProductsPage |
| P0 | **OCR de facturas/recibos** | Upload de imagen/PDF de compra → Edge function → Anthropic Vision → extraer: proveedor, ítems, montos, fecha; pre-popular form de Compras; PurchasesPage: botón "Importar desde foto" |
| P1 | **Sentiment analysis en soporte** | Clasificar mensajes de tickets como positivo/negativo/urgente; `urgency_score` auto-calculado; alerta si sentiment < umbral; SupportPage: heat map de sentimiento por período |
| P1 | **Product recommendation engine** | Collaborative filtering: "clientes que compraron X también compran Y"; `ProductRecommendations` en CustomerDetail y POS |
| P1 | **AI workflow builder** | Editor visual de automatizaciones con lenguaje natural: "cuando un cliente no compre en 60 días, enviarle WhatsApp con su producto favorito"; convierte descripción a automation flow |
| P2 | **Voice-to-text notas** | Web Speech API en notas de cliente, tareas y deals; botón microfono en inputs de nota; transcripción en tiempo real |
| P2 | **Embeddings para búsqueda semántica** | pgvector: embeddings de clientes+productos; búsqueda por similitud "clientes parecidos a X"; `similar_customers` query |

### Sprint C2 — BI Platform
| P | Feature | Detalle técnico |
|---|---------|----------------|
| P0 | **Custom dashboard builder** | Drag-drop widgets: KPICard, BarChart, LineChart, Table, Map, Funnel; guardar layouts por usuario en DB; compartir dashboard con equipo; fullscreen mode |
| P0 | **Saved reports con scheduling** | Guardar cualquier reporte con nombre; scheduler: diario/semanal/mensual; enviar por email como PDF o como link; tabla `saved_reports + report_schedules` |
| P1 | **Multi-dimensional OLAP** | ReportsPage: pivot table con filas/columnas configurables (mes × categoría × vendedor × segmento); drilldown inline |
| P1 | **Live Google Sheets sync** | Edge function + Google Sheets API: exportar ventas/inventario en tiempo real a una hoja; configurar en IntegrationsPage |
| P2 | **Embedded analytics API** | Endpoint `/embed/chart?token=xxx` que devuelve chart como SVG o iFrame; para clientes que quieren embeber datos en su web |
| P2 | **Data warehouse lite** | Read-only Supabase branch con vistas materializadas para BI pesado; no afecta producción |

---

## FASE 4 — ECOSYSTEM & INTEGRATIONS (Q4 2026 – Q1 2027)
> **Objetivo:** Ser el hub de todas las herramientas que una pyme LATAM ya usa.

### Sprint D1 — E-commerce & Marketplaces
| P | Feature | Detalle técnico |
|---|---------|----------------|
| P0 | **MercadoLibre** | OAuth2 + webhooks; sync de publicaciones (precio, stock); recepción de órdenes → venta automática; tracking de envío; `MercadoLibrePage` con status de publicaciones |
| P0 | **Shopify** | OAuth partner app; sync bidireccional de productos; órdenes Shopify → venta; inventory sync; webhooks `orders/create, products/update` |
| P1 | **WooCommerce** | REST API; mismo flujo que Shopify; para clientes con WordPress |
| P1 | **Amazon Seller** | SP-API; sync de órdenes FBA/FBM; inventory sync; fees automáticos |
| P2 | **Rappi / PedidosYa** | Webhooks de órdenes; integración con POS para delivery |

### Sprint D2 — Contabilidad & Bancos
| P | Feature | Detalle técnico |
|---|---------|----------------|
| P0 | **Bank feed Argentina (BCRA Open Banking)** | API BCRA 2024; importar movimientos CBU automáticamente; matcher automático ventas ↔ transferencias (fuzzy match por monto+fecha); conciliación con un click |
| P0 | **Exportación Tango / Bejerman** | CSV con formato estándar Tango: plan de cuentas, asientos contables; botón en ReportsPage |
| P1 | **QuickBooks / Xero sync** | OAuth; exportar P&L, gastos, compras; sync bidireccional de clientes |
| P1 | **Double-entry bookkeeping básico** | Chart of accounts simplificado; journal entries automáticos en cada venta/compra/gasto; balance sheet básico; para orgs que quieren contabilidad más formal |
| P2 | **Payroll básico** | Registro de empleados, sueldos, liquidación mensual simplificada; no reemplaza DR NÓMINA |

### Sprint D3 — Comunicaciones & Productividad
| P | Feature | Detalle técnico |
|---|---------|----------------|
| P0 | **n8n / Make / Zapier** | Webhook trigger desde Gestiona + action de Gestiona como receptor; documentar en API docs; IntegrationsPage: sección "Automatizaciones externas" |
| P1 | **Google Workspace** | Calendar sync (deals + tasks → Google Calendar); Contacts sync (clientes ↔ Google Contacts); Gmail: ver emails de clientes en ficha 360 |
| P1 | **Microsoft 365** | Outlook sync; Teams notifications (nueva venta, deal cerrado, alerta stock) |
| P1 | **Slack** | Webhook a canal: nueva venta, deal cerrado, alerta stock bajo, meta alcanzada; configurar en IntegrationsPage |
| P2 | **DocuSign / Firma digital** | Link de presupuesto con firma electrónica; PDF firmado guardado en Storage; `signature_status` en quotes |
| P2 | **SMS (Twilio / InfoBIP)** | Fallback si no hay WhatsApp; SMS transaccional (confirmación de venta, deuda); campañas SMS masivo |

### Sprint D4 — Logística
| P | Feature | Detalle técnico |
|---|---------|----------------|
| P1 | **OCA / Correo Argentino / Andreani** | API de cotización de envío; generar etiqueta desde venta; tracking de envío embebido en ficha de venta; `shipping_label_url` en sales |
| P2 | **Route optimization para delivery** | Google Maps Routes API; ordenar secuencia óptima de entregas del día; export a Google Maps |

---

## FASE 5 — MOBILE NATIVE & FIELD SERVICE (Q1–Q2 2027)
> **Objetivo:** El vendedor en la calle tiene la misma experiencia que en escritorio.

### Sprint E1 — App Mobile Nativa
| P | Feature | Detalle técnico |
|---|---------|----------------|
| P0 | **Capacitor wrapper (Android + iOS)** | `@capacitor/core`; build targets Android APK + iOS IPA desde el mismo codebase React; publicar en Play Store + App Store |
| P0 | **Push notifications nativas** | `@capacitor/push-notifications` + Firebase Cloud Messaging; triggers: nueva venta, stock bajo, deuda vencida, mensaje de soporte, meta alcanzada |
| P0 | **Biometric auth** | `@capacitor/biometrics`; FaceID / TouchID / huella; unlock session en mobile |
| P1 | **Scanner nativo de barcode/QR** | `@capacitor/barcode-scanner`; escanear productos en POS; escanear QR de catálogo; sin ZXing en mobile |
| P1 | **Cámara nativa optimizada** | `@capacitor/camera`; capturar foto de producto/recibo; mejor que `<input capture>` |
| P1 | **Offline-first completo** | PouchDB / SQLite local; sync bidireccional al reconectar; conflict resolution (last-write-wins + manual merge); indicador de cola de sincronización |
| P2 | **NFC para pagos** | `@capacitor/nfc`; leer tarjeta NFC; trigger de pago |
| P2 | **GPS para visitas** | Log de ubicación en visitas a clientes; mapa de cobertura por vendedor |

### Sprint E2 — Field Service
| P | Feature | Detalle técnico |
|---|---------|----------------|
| P1 | **Work orders** | Tabla `work_orders`; órdenes de servicio con técnico asignado, cliente, descripción, materiales, costo; estados; firma digital de conformidad |
| P1 | **Scheduling de servicios** | CalendarPage: vista de técnicos; drag-drop asignación de work orders; notificación push al técnico |
| P2 | **Asset management** | Tabla `assets (id, org_id, customer_id, name, serial, install_date, warranty_exp, service_history)`; historial de servicios por equipo instalado |
| P2 | **Preventive maintenance** | Crear WO automática antes del vencimiento de garantía o service schedule; cron diario |

---

## FASE 6 — EXPANSIÓN LATAM & INTERNACIONALIZACIÓN (Q2–Q3 2027)
> **Objetivo:** El mejor ERP de la región para pymes, no solo de Argentina.

### Sprint F1 — Localización
| P | Feature | Detalle técnico |
|---|---------|----------------|
| P0 | **Multi-idioma (i18n)** | `i18next` + `react-i18next`; archivos `locales/es-AR, es-MX, es-CO, es-CL, pt-BR, en-US`; fallback en cascada; formato de moneda/fecha/número por locale |
| P0 | **Multi-timezone** | Selección de timezone en Settings; todas las fechas en UI en timezone del usuario; `date-fns-tz`; almacenar en UTC siempre |
| P1 | **Facturación Colombia** | DIAN API; facturas electrónicas Colombia formato CUFE; catálogo de impuestos (IVA 19%, retención) |
| P1 | **Facturación México** | SAT CFDI 4.0; certificado digital; PAC connector |
| P1 | **Facturación Chile** | SII boletas/facturas electrónicas; folio electrónico |
| P1 | **Facturación Brasil** | NF-e / NFS-e; SPED; CPF/CNPJ |
| P2 | **Monedas LATAM** | CLP, COP, MXN, BRL, UYU, PEN; tipo de cambio automático por país; multi-currency reporting |

### Sprint F2 — Enterprise Multi-tenant
| P | Feature | Detalle técnico |
|---|---------|----------------|
| P0 | **SSO SAML 2.0** | Supabase Auth Enterprise o Supabase-compatible; IdP: Okta, Azure AD, Google Workspace; JIT provisioning; atributos de rol desde SAML assertions |
| P0 | **SCIM provisioning** | Auto-provisionar y desactivar usuarios desde el IdP; sincronización de grupos → roles |
| P1 | **Multi-org federation** | "Holding": org padre con N orgs hijas; vista consolidada del grupo; P&L consolidado; transferencias inter-org |
| P1 | **White-label** | Custom domain (`erp.cliente.com`); logo propio; colores primarios; powered-by oculto; facturación al revendedor |
| P2 | **Dedicated infrastructure** | Supabase dedicado por cliente enterprise; VPC aislado; SLA 99.99% |

---

## FASE 7 — DEVELOPER PLATFORM & MARKETPLACE (Q3–Q4 2027)
> **Objetivo:** Convertirse en plataforma, no solo producto.

### Sprint G1 — API Pública & Developer Portal
| P | Feature | Detalle técnico |
|---|---------|----------------|
| P0 | **OpenAPI 3.0 spec** | Auto-generar desde Edge Functions + PostgREST; Swagger UI en `developers.gestiona.app`; ejemplos en curl/Node/Python; changelog versionado |
| P0 | **OAuth 2.0 para developers** | `Authorization Code + PKCE`; scopes granulares; app registration; secret rotation |
| P1 | **Webhook builder UI** | Crear webhooks salientes desde UI (URL + eventos + secret); test manual; historial + retry; filtros por evento |
| P1 | **Sandbox environment** | Org de sandbox con datos demo para developers; API key separada; rate limit relajado |
| P2 | **SDK oficial** | `@gestiona/sdk-js`; TypeScript nativo; wrappers de las operaciones más comunes; publicar en npm |

### Sprint G2 — App Marketplace
| P | Feature | Detalle técnico |
|---|---------|----------------|
| P1 | **Plugin framework** | Micro-frontend: apps externas embebidas como iFrames con postMessage API; auth pass-through; contexto de org disponible |
| P1 | **Marketplace de automatizaciones** | Plantillas de flows compartidas por la comunidad; instalar con un click; rating + reviews |
| P2 | **Revenue sharing** | 70/30 para developers externos en el marketplace; Stripe Connect para payouts |
| P2 | **No-code builder** | Editor visual de tablas custom + formularios + vistas; para industrias específicas sin código |

---

## FASE 8 — FULL ENTERPRISE & ESCALA GLOBAL (2028)
> **Objetivo:** Ser el sistema que empresas de 100–5.000 empleados elijan sin dudarlo.

| P | Feature | Notas |
|---|---------|-------|
| P0 | **ISO 27001 certification** | Auditoría externa, ISMS formal, penetration test anual |
| P0 | **SOC 2 Type II** | Trust service criteria: security, availability, confidentiality |
| P0 | **99.99% SLA** | Multi-region active-active; automático failover; < 4min downtime/año |
| P0 | **Data residency** | Elegir región de datos (AR / BR / EU / US); separación física por región |
| P1 | **Advanced RBAC con atributos** | ABAC: permisos por departamento + región + horario + datos |
| P1 | **Dedicated AI models** | Fine-tuning sobre datos agregados del sector (con opt-in); respuestas más contextualizadas |
| P1 | **ERP completo: producción** | MRP básico: ordenes de producción, materias primas, BOM, planificación de capacidad |
| P2 | **Cotización en bolsa / M&A readiness** | Métricas SaaS: ARR, MRR, churn, LTV/CAC, Rule of 40; datos auditados |

---

## 8. ESTADO POR MÓDULO (Q2 2026)

| Módulo | % Actual | Target Q3 2026 | Target Q4 2026 | Target Q2 2027 |
|--------|----------|----------------|----------------|----------------|
| Infraestructura | 87% | 95% (+MFA, staging, audit) | 98% | 99.9% |
| Seguridad & Compliance | 60% | 85% (+RBAC granular, audit log) | 92% | 98% |
| Auth + Orgs | 85% | 92% (+MFA, session mgmt) | 96% (+SSO) | 99% |
| Inventario | 88% | 92% (+OCR facturas) | 95% | 98% |
| Ventas + POS | 96% | 97% (+offline nativo) | 98% | 99% |
| Clientes + CRM | 92% | 95% (+account hierarchy) | 97% (+NPS, journey) | 99% |
| Finanzas | 90% | 94% (+double-entry) | 97% (+bank feed) | 99% |
| Facturación AFIP | 72% | 80% (+NC integration) | 85% | 90% |
| Facturación LATAM | 0% | 0% | 30% (+CO+MX) | 75% (+CL+BR) |
| Marketing + Email | 85% | 90% (+drip sequences) | 95% (+A/B testing) | 98% |
| WhatsApp | 88% | 92% (+drip WA) | 95% | 97% |
| IA + Analytics | 92% | 96% (+ML forecast, OCR) | 98% (+custom dashboard) | 99% |
| Integraciones | 75% | 82% (+MeLi, n8n) | 88% (+Shopify, banks) | 95% |
| SaaS + Billing | 82% | 87% (+granular limits) | 92% (+enterprise plan) | 97% |
| Mobile + UX | 80% | 85% (+offline completo) | 88% | 95% (+native app) |
| Field Service | 30% | 40% | 60% | 80% |
| Developer Platform | 20% | 30% | 50% | 80% |
| LATAM expansion | 0% | 5% | 20% | 70% |
| Testing + Calidad | 42% | 60% (+E2E) | 75% | 90% |
| **TOTAL** | **75%** | **83%** | **89%** | **95%** |

---

## 9. DEUDA TÉCNICA (priorizada)

### Crítica (P0 — resolver en Sprint A)
| Ítem | Riesgo | Esfuerzo |
|------|--------|---------|
| Sin MFA → cuenta comprometida destruye todo el negocio | Seguridad crítica | M |
| Audit log incompleto → no hay trazabilidad en litigios | Legal/Compliance | M |
| Sin staging → bugs van directo a producción | Operacional | S |
| Queries sin índices en tablas grandes | Performance a escala | M |
| `as any` residuales en Edge Functions | Bugs silenciosos | S |

### Alta (P1 — resolver en Sprint B)
| Ítem | Riesgo | Esfuerzo |
|------|--------|---------|
| Sin E2E tests (Playwright) | Regresiones en deploys | L |
| LocalStorage para config sensible (SMTP pass) | Fuga de credenciales | M |
| Sin dead letter queue para IA | Pérdida de jobs | M |
| Realtime channels sin garbage collection | Memory leak en sesiones largas | S |
| Sin rate limiting en Edge Functions de IA | Cost explosion | S |

### Media (P2 — próximo trimestre)
| Ítem | Riesgo | Esfuerzo |
|------|--------|---------|
| Sin Web Vitals tracking | LCP/FID degradados invisibles | S |
| Bundle JS sin precompresión Brotli | TTI en 3G alto | S |
| Sin retry automático en webhooks fallidos de Evolution API | Mensajes perdidos | M |
| AFIP: numeración de puntos de venta poco robusta | Factura con CAE duplicado | M |
| Sin documentación de API pública (OpenAPI) | Fricción para integraciones | L |

---

## 10. SUITE DE TESTING (target)

### Pirámide actual vs target
```
                    ┌─────────┐
                    │  E2E    │  Actual: 0  →  Target: 40 flows (Playwright)
                   ┌┤─────────┤┐
                   ││ Integr. ││  Actual: 0  →  Target: 30 tests (Vitest)
                  ┌┤┤─────────┤┤┐
                  ││││  Unit  ││││  Actual: 54  →  Target: 200+ (Vitest)
                  └┴┴─────────┴┴┘
```

### Flows E2E prioritarios (Playwright)
1. Registro → onboarding → primera venta → caja cierre
2. Crear producto → POS → descuento VIP → recibo email
3. Crear cliente → deal → presupuesto → factura AFIP
4. Alerta stock bajo → pedido de compra → recepción → kardex
5. Campaña de email → tracking → seguimiento
6. Deal estancado → automation → tarea asignada
7. Ticket soporte → SLA breach → escalación
8. Import Excel productos → validación → bulk update
9. Admin: suspender org → reactivar → audit log
10. MFA: enroll → challenge → forzar logout

---

## 11. MÉTRICAS DE PRODUCTO & NEGOCIO

### Product Metrics (North Star + Supporting)
| Métrica | Target Q3 2026 | Target Q4 2026 | Target Q2 2027 |
|---------|----------------|----------------|----------------|
| Ventas/org activa/día (North Star) | ≥ 3 | ≥ 5 | ≥ 8 |
| Time to first sale (TTFSale) | < 15 min | < 10 min | < 5 min |
| DAU/MAU ratio | 30% | 40% | 55% |
| Feature adoption (IA chat) | 40% | 55% | 70% |
| Orgs con ≥3 módulos activos | 50% | 65% | 80% |
| NPS | > 40 | > 50 | > 60 |
| Uptime | 99.9% | 99.9% | 99.95% |
| P95 API latency | < 500ms | < 300ms | < 200ms |

### SaaS Business Metrics
| Métrica | Target Q3 2026 | Target Q4 2026 | Target Q2 2027 |
|---------|----------------|----------------|----------------|
| MRR | USD 8k | USD 15k | USD 35k |
| Orgs activas (pagando) | 100 | 200 | 450 |
| ARPU | USD 80 | USD 75 | USD 78 |
| Churn mensual | < 5% | < 4% | < 3% |
| Trial → Paid conversion | 20% | 25% | 30% |
| LTV/CAC ratio | > 3x | > 4x | > 5x |
| Enterprise orgs (>USD 200/mes) | 5 | 15 | 40 |

### Plans estructura
```
Starter     USD 29/mes  — 1 usuario, 500 productos, 500 ventas/mes
Pro         USD 59/mes  — 5 usuarios, 5.000 productos, ilimitadas ventas
Business    USD 99/mes  — 15 usuarios, ilimitado, IA avanzada, API
Enterprise  Custom      — SSO, white-label, SLA, soporte dedicado, on-prem
```

---

## 12. RISK REGISTER

| ID | Riesgo | Probabilidad | Impacto | Mitigación |
|----|--------|-------------|---------|-----------|
| R01 | Cuenta comprometida sin MFA → pérdida de datos del negocio | Alta | Crítico | **Sprint A1**: MFA obligatorio para admins |
| R02 | Brecha de datos entre orgs por bug en RLS | Baja | Crítico | Audit test de RLS en CI; pen test trimestral |
| R03 | Costo de IA sin límites → bill explosion | Media | Alto | Token counter por plan; hard cap con fallback |
| R04 | Supabase outage > 1h → 0 disponibilidad | Baja | Crítico | Status page; runbook de restore; PITR |
| R05 | AFIP cambia API → facturación rota | Media | Alto | Abstracción AFIP service; monitoring de endpoint |
| R06 | Evolution API de bajada → WA muerto | Media | Medio | Fallback a SMS; retry con backoff |
| R07 | Datos mezclados entre orgs (user_id en lugar de org_id) | Baja | Crítico | CI check: `grep -r "user_id" src/lib/ \| grep -v org_id` |
| R08 | Webhooks duplicados crean stock inconsistente | Media | Alto | Idempotency keys en todos los webhooks |
| R09 | PWA cacheando data vieja en pantallas críticas | Media | Medio | Cache-busting en routes críticas; skipWaiting activo |
| R10 | Burnout del equipo de desarrollo (solopreneur) | Alta | Alto | Documentación completa; feature flags para pausa segura |
| R11 | Cambio de ley 25.326 / GDPR para pymes | Baja | Medio | Compliance review semestral |
| R12 | Competidor local copia features clave | Media | Medio | Velocidad de iteración; moat en datos y red |
| R13 | Play Store / App Store rechazo de la app | Media | Medio | Política de privacidad completa; no MDM restrictions |
| R14 | Anthropic Claude pricing change | Baja | Alto | Model cost tracking; prepay créditos; caché agresivo |

---

## 13. PROYECCIÓN FINANCIERA

### Modelo SaaS Conservador
```
Q3 2026  →  100 orgs  →  USD 8.000 MRR  →  USD 96k ARR
Q4 2026  →  200 orgs  →  USD 15.000 MRR  →  USD 180k ARR
Q1 2027  →  300 orgs  →  USD 22.000 MRR  →  USD 264k ARR
Q2 2027  →  450 orgs  →  USD 35.000 MRR  →  USD 420k ARR
Q4 2027  →  700 orgs  →  USD 56.000 MRR  →  USD 672k ARR
Q2 2028  → 1.200 orgs  →  USD 100.000 MRR →  USD 1.2M ARR
```

### Supuestos clave
- Churn mensual: 4% en Q3 2026, mejorando a 2.5% en 2028
- Gross margin: 82% (Supabase + infra + Anthropic = ~18%)
- CAC: USD 150 (inbound heavy, producto-led growth)
- LTV (Plan Pro, 3% churn): USD 59 / 0.03 = USD 1.967 → LTV/CAC = 13x
- Upsell Enterprise a los 12 meses de uso: 8% de las orgs Business

### Modelo Agresivo (con inversión)
```
Q4 2027  → 2.000 orgs → USD 180k MRR → USD 2.1M ARR
```

---

## 14. DEFINICIÓN DE TERMINADO (Definition of Done)

Una funcionalidad se considera **production-ready** cuando:
- [ ] TypeScript strict: 0 errores en `npx tsc --noEmit`
- [ ] Tests unitarios cubriendo happy path + edge cases críticos
- [ ] RLS: datos filtrados por `org_id` en TODAS las queries
- [ ] Loading / empty state / error state manejados
- [ ] Responsive: funciona en 375px (iPhone SE) y 1440px
- [ ] Accesible: navegable con teclado, aria-labels en interactivos
- [ ] Audit log: operaciones destructivas registradas
- [ ] Permisos: respeta `usePermissions(module)` por rol
- [ ] Performance: no degrada LCP > 2.5s ni TTI > 3.5s
- [ ] No rompe: stock, caja, deuda, reportes ni facturación
- [ ] Documentado en ROADMAP con sesión y estado

---

## 15. PRINCIPIOS DE ARQUITECTURA (ADRs)

### ADR-001: Multi-tenant por org_id en todas las tablas
**Decision:** Toda tabla de datos de negocio tiene `org_id` como primera columna del índice compuesto. NUNCA filtrar solo por `user_id`.
**Rationale:** Aislamiento de datos, RLS simple, multi-usuario por org.

### ADR-002: Edge Functions para lógica de servidor
**Decision:** Toda lógica que requiere secretos, llama APIs externas o envía emails/WA va en Edge Functions. El frontend es read-optimized.
**Rationale:** Seguridad (secrets no expuestos), escalabilidad, vendor-agnostic.

### ADR-003: Optimistic UI + server validation
**Decision:** Actualizaciones locales inmediatas + rollback en error. Nunca esperar al servidor para mostrar feedback.
**Rationale:** UX percibida instantánea, crítica para POS y ventas.

### ADR-004: Realtime solo donde aporta valor real
**Decision:** Realtime para: Dashboard KPIs, SupportPage tickets, TeamChat, POSPage. No para reportes históricos o listas paginadas.
**Rationale:** Cada canal consume recursos. Racionalizar.

### ADR-005: localStorage solo para preferencias de UI
**Decision:** Datos de negocio van a Supabase DB. Config sensible (SMTP, API keys) va en `settings` table. localStorage solo para: tema, sidebar open/closed, IA cache 8h.
**Rationale:** Seguridad, multi-device, soporte desde admin.

### ADR-006: IA como capa de presentación, no de datos
**Decision:** Claude no lee directamente la DB. Los prompts incluyen datos pre-calculados y estructurados del frontend. Outputs de IA son siempre human-in-the-loop para operaciones destructivas.
**Rationale:** Latencia controlada, costos predecibles, riesgo de prompt injection mitigado.

### ADR-007: Mobile-first en todos los componentes nuevos
**Decision:** Diseñar primero para 375px, luego escalar. No al revés.
**Rationale:** 60%+ de usuarios acceden desde mobile en LATAM.

---

## 16. PRÓXIMAS SESIONES — BACKLOG PRIORIZADO

### P0 — Crítico (resolver primero)
| # | Feature | Sprint | Esfuerzo |
|---|---------|--------|---------|
| 1 | **MFA / TOTP para admins** — enroll dialog, QR, challenge en login, enforcement | A1 | M |
| 2 | **Permisos granulares por módulo** — tabla `role_permissions`, RPC, enforcement | A1 | L |
| 3 | **Audit log completo** — tabla, triggers, UI en Settings | A1 | M |
| 4 | **npm audit + secret scanning en CI** | A1 | S |
| 5 | **Staging environment** — Supabase branch + Vercel preview | A2 | M |
| 6 | **Right to deletion + data export** | A2 | M |
| 7 | **Slow query analysis + indexación crítica** | A3 | M |

### P1 — Alta prioridad
| # | Feature | Sprint | Esfuerzo |
|---|---------|--------|---------|
| 8 | **Win/Loss recording** — form, tabla `deal_outcomes`, análisis | B1 | M |
| 9 | **AI Lead Scoring** — heurísticas en pipeline, badge, sort | B1 | S |
| 10 | **Email drip sequences** — scheduler, flows, enroll | B1 | L |
| 11 | **NPS automático** — post-compra, tabla, widget dashboard | B2 | M |
| 12 | **E2E tests Playwright** — 10 flows críticos | A2 | L |
| 13 | **OCR de facturas/recibos** — Anthropic Vision, form pre-populate | C1 | M |
| 14 | **Custom dashboard builder** — drag-drop widgets | C2 | XL |
| 15 | **MercadoLibre integration** — OAuth, sync, órdenes | D1 | L |

### P2 — Media prioridad
| # | Feature | Sprint | Esfuerzo |
|---|---------|--------|---------|
| 16 | **Bank feed BCRA Open Banking** | D2 | XL |
| 17 | **Account hierarchy (empresas)** | B1 | M |
| 18 | **Contact roles en deals** | B1 | S |
| 19 | **Capacitor app (Android)** | E1 | XL |
| 20 | **Shopify integration** | D1 | L |
| 21 | **n8n / Zapier webhook bridge** | D3 | M |
| 22 | **Saved reports con scheduling** | C2 | M |
| 23 | **Google Calendar sync** | D3 | M |
| 24 | **Double-entry bookkeeping básico** | D2 | XL |
| 25 | **SupportPage: escalation rules** | B2 | S |
| 26 | **KB (base de conocimientos)** | B2 | M |
| 27 | **CSAT en tickets** | B2 | S |
| 28 | **Customer journey map visual** | B2 | M |
| 29 | **Facturación Colombia (DIAN)** | F1 | XL |
| 30 | **Facturación México (SAT CFDI)** | F1 | XL |

---

*Última revisión: 2026-05-29 · Autor: Gestiona Engineering*
*Este documento es el único source of truth del estado del producto.*
