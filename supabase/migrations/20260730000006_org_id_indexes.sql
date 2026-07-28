-- Índices por org_id en las tablas que no los tenían.
--
-- Toda policy de RLS evalúa `is_org_member(org_id, auth.uid())` y toda query
-- de la app filtra `.eq('org_id', ...)`. Sin un índice que lidere con org_id,
-- cada lectura es un seq scan sobre la tabla entera de TODAS las orgs — el
-- costo crece con el total de clientes del SaaS, no con los datos del que
-- consulta. Eran 59 tablas.
--
-- Se crea (org_id, created_at DESC) cuando la tabla tiene created_at (casi
-- todas las listas se ordenan por fecha descendente) y (org_id) si no.
-- Las tablas son chicas, así que CREATE INDEX sin CONCURRENTLY es aceptable
-- y permite correr todo en una transacción. Idempotente.

DO $$
DECLARE
  r          record;
  v_index    text;
  v_has_ts   boolean;
  v_cols     text;
BEGIN
  FOR r IN
    SELECT c.oid, c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'org_id' AND a.attnum > 0
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND NOT EXISTS (
        SELECT 1 FROM pg_index i
        WHERE i.indrelid = c.oid AND i.indkey[0] = a.attnum
      )
    ORDER BY c.relname
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid = r.oid AND attname = 'created_at' AND attnum > 0 AND NOT attisdropped
    ) INTO v_has_ts;

    v_cols  := CASE WHEN v_has_ts THEN 'org_id, created_at DESC' ELSE 'org_id' END;
    v_index := left(r.relname || '_org_idx', 63);

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (%s)', v_index, r.relname, v_cols);
    RAISE NOTICE 'índice % sobre %(%)', v_index, r.relname, v_cols;
  END LOOP;
END $$;

ANALYZE;
