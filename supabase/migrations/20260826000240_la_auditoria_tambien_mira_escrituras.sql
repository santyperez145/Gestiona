-- ═══════════════════════════════════════════════════════════════════════════
-- La auditoría de aislamiento también tiene que mirar las escrituras
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `audit_policies_sin_tenant` (20260826000160) sólo miraba policies de
-- **lectura** (`SELECT` y `ALL`). Con eso encontró y cerró las cinco de
-- `active = true`.
--
-- ⚠️ Pero dejaba afuera `INSERT`, `UPDATE` y `DELETE`, y ahí había una:
-- `marketing_templates_public_update`, con `USING (is_public = true)` sobre una
-- tabla con `org_id`. Se encontró con una consulta a mano, no con la vista — o
-- sea que la vista habría dejado pasar la siguiente.
--
-- **Escribir lo ajeno es peor que leerlo**: una fuga se mira, un destrozo no se
-- deshace. Que la mitad más grave quedara sin cubrir es el hueco que cierra
-- esta migración.
--
-- ── Qué cambia ────────────────────────────────────────────────────────────
--
-- Se recorren los cuatro comandos. Para cada policy se evalúa **la unión** de
-- `USING` y `WITH CHECK`: una de INSERT no tiene `USING`, y una de UPDATE puede
-- acotar en una y no en la otra. Si en ninguna de las dos aparece una mención a
-- alguien —comercio, staff o persona—, no acota a nadie.
--
-- 📌 La columna `comando` deja de ser sólo SELECT/ALL, así que ahora la vista
-- dice **qué** se puede hacer sin acotar, que es lo primero que se pregunta.
--
-- Medido al aplicarla: **0 filas** (2026-08-26). Antes de `20260826000230`
-- habría devuelto 1.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- ⚠️ DROP y no CREATE OR REPLACE: la vista cambia de columnas (`expresion`
-- pasa a `usando` + `con_check`) y Postgres no deja renombrar una columna de
-- vista con REPLACE. Falla con 42P16.
DROP VIEW IF EXISTS public.audit_policies_sin_tenant;

CREATE VIEW public.audit_policies_sin_tenant AS
WITH policies AS (
  SELECT
    c.relname AS tabla,
    p.polname AS policy,
    CASE p.polcmd
      WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
      WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE'
      ELSE 'ALL' END AS comando,
    CASE WHEN p.polroles = '{0}' THEN 'PUBLIC'
         ELSE (SELECT string_agg(r.rolname, ', ' ORDER BY r.rolname)
                 FROM pg_roles r WHERE r.oid = ANY(p.polroles)) END AS roles,
    -- ⚠️ La unión de las dos: una policy de INSERT no tiene USING, y una de
    -- UPDATE puede acotar en USING y no en WITH CHECK.
    COALESCE(pg_get_expr(p.polqual, p.polrelid), '')
      || ' ' || COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') AS expr,
    COALESCE(pg_get_expr(p.polqual, p.polrelid), '(sin USING)')      AS usando,
    COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '(sin CHECK)') AS con_check,
    c.oid AS reloid
  FROM pg_policy p
  JOIN pg_class c ON c.oid = p.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'org_id' AND a.attnum > 0
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
)
SELECT
  tabla, policy, comando, roles, usando, con_check,
  (SELECT n_live_tup FROM pg_stat_user_tables s WHERE s.relid = reloid) AS filas_aprox
FROM policies
WHERE expr NOT ILIKE '%org_id%'
  AND expr NOT ILIKE '%is_org_member%'
  AND expr NOT ILIKE '%has_org_role%'
  AND expr NOT ILIKE '%is_platform_admin%'
  AND expr NOT ILIKE '%has_platform_role%'
  AND expr NOT ILIKE '%user_id%'
  AND expr NOT ILIKE '%store_customer_id%'
  AND expr NOT ILIKE '%auth.uid()%';

COMMENT ON VIEW public.audit_policies_sin_tenant IS
  'Policies (SELECT, INSERT, UPDATE, DELETE y ALL) sobre tablas con org_id que no acotan a nadie: ni al comercio, ni al staff, ni a la persona. Tiene que estar VACIA. Complementa a rls_audit_open_policies, que solo detecta USING true.';

REVOKE ALL ON public.audit_policies_sin_tenant FROM anon, authenticated;

-- ── Verificación ───────────────────────────────────────────────────────────
DO $verif$
DECLARE v_n int; v_detalle text;
BEGIN
  SELECT count(*), COALESCE(string_agg(tabla || '.' || policy || ' (' || comando || ')', ', '), '')
    INTO v_n, v_detalle FROM public.audit_policies_sin_tenant;
  ASSERT v_n = 0, 'hay ' || v_n || ' policies que no acotan a nadie: ' || v_detalle;

  -- ⚠️ En los dos sentidos, y ahora para escritura: se crea a propósito una
  --    policy de UPDATE sin filtro y se comprueba que la vista la ve. Antes de
  --    esta migración este bloque habría fallado, que es justamente el punto.
  CREATE POLICY "zz_prueba_update_sin_tenant" ON public.marketing_templates
    FOR UPDATE TO authenticated USING (is_public = true);

  SELECT count(*) INTO v_n FROM public.audit_policies_sin_tenant
   WHERE policy = 'zz_prueba_update_sin_tenant' AND comando = 'UPDATE';
  DROP POLICY "zz_prueba_update_sin_tenant" ON public.marketing_templates;

  ASSERT v_n = 1, 'la vista NO detecto una policy de UPDATE sin filtro de tenant';

  -- Y una de INSERT, que no tiene USING: la unión con WITH CHECK es lo que la
  -- hace visible.
  CREATE POLICY "zz_prueba_insert_sin_tenant" ON public.marketing_templates
    FOR INSERT TO authenticated WITH CHECK (is_public = true);

  SELECT count(*) INTO v_n FROM public.audit_policies_sin_tenant
   WHERE policy = 'zz_prueba_insert_sin_tenant' AND comando = 'INSERT';
  DROP POLICY "zz_prueba_insert_sin_tenant" ON public.marketing_templates;

  ASSERT v_n = 1, 'la vista NO detecto una policy de INSERT sin filtro de tenant';

  ASSERT (SELECT count(*) FROM public.audit_policies_sin_tenant) = 0,
    'quedaron policies de prueba';

  RAISE NOTICE 'OK: la vista esta vacia y detecta UPDATE e INSERT sin filtro de tenant';
END $verif$;
