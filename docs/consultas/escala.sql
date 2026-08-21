SELECT jsonb_pretty(jsonb_build_object(
  'escala', jsonb_build_object(
    'tablas',        (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'),
    'con_org_id',    (SELECT count(DISTINCT table_name) FROM information_schema.columns
                       WHERE table_schema='public' AND column_name='org_id'),
    'vistas',        (SELECT count(*) FROM information_schema.views WHERE table_schema='public'),
    'funciones',     (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                       WHERE n.nspname='public' AND p.prokind IN ('f','p')),
    'triggers',      (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal),
    'indices',       (SELECT count(*) FROM pg_indexes WHERE schemaname='public'),
    'policies_rls',  (SELECT count(*) FROM pg_policies WHERE schemaname='public'),
    'migraciones',   (SELECT count(*) FROM supabase_migrations.schema_migrations),
    'cron_jobs',     (SELECT count(*) FROM cron.job)
  ),
  'uso_real', jsonb_build_object(
    'organizaciones',  (SELECT count(*) FROM public.organizations),
    'usuarios',        (SELECT count(*) FROM auth.users),
    'productos',       (SELECT count(*) FROM public.products),
    'ventas_pos',      (SELECT count(*) FROM public.sales),
    'ordenes_online',  (SELECT count(*) FROM public.ecommerce_orders),
    'clientes',        (SELECT count(*) FROM public.customers),
    'tiendas',         (SELECT count(*) FROM public.ecommerce_stores),
    'tiendas_publicadas', (SELECT count(*) FROM public.ecommerce_stores WHERE is_active),
    'facturas',        (SELECT count(*) FROM public.invoices),
    'asientos',        (SELECT count(*) FROM public.ledger_entries),
    'eventos',         (SELECT count(*) FROM public.domain_events),
    'suscripciones',   (SELECT count(*) FROM public.subscriptions),
    'pagos_ok',        (SELECT count(*) FROM public.payment_transactions WHERE status IN ('approved','accredited'))
  ),
  'seguridad', jsonb_build_object(
    'tablas_sin_rls', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                        WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity),
    'policies_abiertas', (SELECT count(*) FROM pg_policies
                           WHERE schemaname='public' AND qual = 'true'),
    'tablas_credenciales_sin_policy',
      (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity
          AND c.relname IN ('afip_credentials','afip_platform_credentials','payment_connections','meli_connections')
          AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.tablename=c.relname))
  ),
  'motores', jsonb_build_object(
    'idempotencia', EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='idempotency_keys'),
    'outbox',       EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='outbox_events'),
    'ledger',       EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='ledger_entries'),
    'billetera',    EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='wallet_entries'
                            OR table_name='wallets'),
    'rate_limit',   EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='rate_limits'),
    'auditoria',    EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='audit_log'),
    'suscripciones_eventos', (SELECT count(*) FROM public.event_subscriptions)
  ),
  'salud_ops', jsonb_build_object(
    'crons_fallando_7d', (SELECT count(*) FROM cron.job_run_details
                           WHERE status <> 'succeeded' AND end_time > now() - interval '7 days'),
    'crons_ok_7d',       (SELECT count(*) FROM cron.job_run_details
                           WHERE status = 'succeeded' AND end_time > now() - interval '7 days'),
    'outbox_pendiente',  (SELECT count(*) FROM public.outbox_events WHERE estado <> 'enviado'),
    'stock_negativo',    (SELECT count(*) FROM public.products WHERE stock < 0)
  )
)) AS j;
