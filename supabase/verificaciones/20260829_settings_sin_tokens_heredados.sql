-- Verificación de sólo lectura posterior a 20260828000210.
-- Nunca imprime valores de credenciales.

SELECT
  count(*) AS columnas_heredadas
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'settings'
  AND column_name = ANY (ARRAY[
    'api_key',
    'evolution_api_url',
    'evolution_api_key',
    'evolution_instance',
    'ml_access_token',
    'ml_refresh_token',
    'mp_access_token',
    'mp_webhook_secret'
  ]);

SELECT
  c.relname AS tabla,
  c.relrowsecurity AS rls,
  count(p.policyname) AS policies,
  has_table_privilege('anon', format('%I.%I', n.nspname, c.relname), 'SELECT') AS anon_lee,
  has_table_privilege('authenticated', format('%I.%I', n.nspname, c.relname), 'SELECT') AS authenticated_lee
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policies p ON p.schemaname = n.nspname AND p.tablename = c.relname
WHERE n.nspname = 'public'
  AND c.relname = ANY (ARRAY['payment_connections', 'meli_connections', 'evolution_connections'])
GROUP BY c.relname, c.relrowsecurity, n.nspname
ORDER BY c.relname;

SELECT
  (SELECT count(*) FROM public.payment_connections) AS payment_connections,
  (SELECT count(*) FROM public.meli_connections) AS meli_connections,
  (SELECT count(*) FROM public.evolution_connections) AS evolution_connections,
  (SELECT count(*) FROM supabase_migrations.schema_migrations
   WHERE version = '20260828000210') AS migracion_registrada;
