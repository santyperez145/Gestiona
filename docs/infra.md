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
- Archivos exportables (reportes/documentos) y snapshots privados por organización (`backups`)
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

El estado público `/estado` consulta el RPC `get_public_service_status()`. Sólo
expone una señal agregada de aplicación, tareas programadas y respaldos; no se
debe reemplazar por una lectura directa de `cron`, organizaciones o logs.

`weekly-backup` crea snapshots privados por organización para planes con
`backups_enabled`. La Edge Function controla owner/plan para acciones manuales
y un secreto de cron para las programadas; los objetos se guardan bajo
`backups/org/<org_id>/` y sólo se descargan a través de URL firmada de 60 s.
Cada snapshot completo se relee y verifica por hash, cobertura y filas; se
retienen ocho durante 56 días. El contrato v3 incorpora ocho relaciones hijas
operativas sin `org_id` propio (kits, precios por lista, solicitudes de compra,
segmentos, registro de emails de pedidos, eventos de entrega, renglones de
factura y envíos de secuencias), alcanzadas sólo desde los IDs de su padre ya
exportado. Los archivos v1 y v2 se siguen verificando con su contrato original;
ampliar cobertura no invalida un snapshot histórico sano. Esto prueba
recuperabilidad del **archivo**, no un restore destructivo: D8b sigue pendiente
hasta ensayar una restauración en un sandbox aislado.

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
- `BACKUP_CRON_SECRET` (mismo valor en Edge Functions y Vault; nunca en el cliente)

## Checklist de operación

- Revisar estado de cron jobs y últimas ejecuciones
- Verificar errores de funciones en logs de Supabase
- Monitorear Sentry para frontend y edge flows críticos
- Revisar semanalmente `weekly-org-backups` y los snapshots con integridad fallida
- Ejecutar y documentar el restore drill aislado antes de ofrecer restauración en producción
- Rotar secrets con política definida
