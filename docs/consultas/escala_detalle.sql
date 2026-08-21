SELECT jsonb_pretty(jsonb_build_object(
  -- ⚠️ La primera medicion contaba vistas tambien: information_schema.columns
  -- las incluye. Esto cuenta SOLO tablas base.
  'tablas_base',   (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                     WHERE n.nspname='public' AND c.relkind='r'),
  'con_org_id',    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                     WHERE n.nspname='public' AND c.relkind='r'
                       AND EXISTS (SELECT 1 FROM pg_attribute a
                                    WHERE a.attrelid=c.oid AND a.attname='org_id' AND a.attnum>0 AND NOT a.attisdropped)),
  'tablas_billetera', (SELECT jsonb_agg(c.relname ORDER BY c.relname) FROM pg_class c
                        JOIN pg_namespace n ON n.oid=c.relnamespace
                       WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE '%wallet%'),
  'tablas_auditoria', (SELECT jsonb_agg(c.relname ORDER BY c.relname) FROM pg_class c
                        JOIN pg_namespace n ON n.oid=c.relnamespace
                       WHERE n.nspname='public' AND c.relkind='r'
                         AND (c.relname LIKE '%audit%' OR c.relname LIKE '%log%')),
  'policies_abiertas', (SELECT jsonb_agg(tablename||'.'||policyname ORDER BY tablename)
                          FROM pg_policies WHERE schemaname='public' AND qual='true'),
  'tablas_pagos', (SELECT jsonb_agg(c.relname ORDER BY c.relname) FROM pg_class c
                     JOIN pg_namespace n ON n.oid=c.relnamespace
                    WHERE n.nspname='public' AND c.relkind='r'
                      AND (c.relname LIKE 'payment%' OR c.relname LIKE 'pago%')),
  'filas_auditoria', (SELECT count(*) FROM public.audit_logs),
  'tamano_base_mb', (SELECT round(pg_database_size(current_database())/1024.0/1024.0)::int)
)) AS j;
