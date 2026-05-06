# Infraestructura y Operaciones

## Migraciones

- Fuente principal: `migration_bundle.sql`
- Carpeta incremental: `supabase/migrations`
- Recomendado:
  - aplicar primero en entorno de prueba
  - validar RLS y políticas tras cada release
  - versionar cambios de esquema siempre en SQL

## Storage buckets

Buckets detectados por uso funcional:

- Imagenes de productos y catalogo
- Archivos exportables (reportes/documentos)
- Recursos de marketing

Nota: confirmar nombres reales en panel de Supabase Storage y alinear políticas por `org_id`.

## Edge Functions operativas

Funciones críticas:

- `create-checkout`, `cancel-subscription`, `stripe-webhook`
- `tiendanube-oauth`, `tiendanube-sync`, `tiendanube-webhook`
- `mercadopago-link`
- `afip-authorize`
- `public-api`

Funciones de automatización y observabilidad:

- `run-automation-flows`
- `send-email-campaign`, `send-scheduled-campaigns`
- `daily-kpi-alert`, `weekly-performance-digest`
- `weekly-backup`

## Secrets necesarios (Supabase)

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `TIENDANUBE_CLIENT_ID`
- `TIENDANUBE_CLIENT_SECRET`
- `ANTHROPIC_API_KEY`
- `LOVABLE_API_KEY`
- `RESEND_API_KEY`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_WHATSAPP_FROM`

## Checklist de operación

- Revisar estado de cron jobs y últimas ejecuciones
- Verificar errores de funciones en logs de Supabase
- Monitorear Sentry para frontend y edge flows críticos
- Probar restauración de backup regularmente
- Rotar secrets con política definida
