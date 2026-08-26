-- ═══════════════════════════════════════════════════════════════════════════
-- Una policy de lectura que no nombra al tenant tiene que verse
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `rls_audit_open_policies` ya existía y detecta el caso más crudo: una policy
-- cuyo `USING` es literalmente `true` o está vacío. Son 3, y las 3 son catálogos
-- públicos a propósito (`plans`, `payment_providers`, `payment_provider_fees`).
--
-- ⚠️ Pero no detectaba el caso de `20260826000150`: cinco policies escritas como
-- `active = true` sobre tablas **con columna `org_id`**. No son `true`, así que
-- pasaban el filtro de esa vista, y sin embargo dejaban que cualquier usuario
-- logueado leyera las filas de cualquier comercio. En `brand_knowledge` eso ya
-- estaba conectado a la app.
--
-- ── Cómo distingue una fuga de un caso legítimo ───────────────────────────
--
-- No todas las filas de una tabla con `org_id` pertenecen a un comercio. Hay
-- siete policies donde la fila es de una **persona**, y filtrar por organización
-- ahí sería incorrecto: el comprador que ve su propia orden, su reseña, su
-- pregunta, su lista de deseos; el usuario que ve su suscripción a push.
--
-- Entonces la regla no es "tiene que nombrar `org_id`", es **"tiene que acotar a
-- alguien"** — al comercio (`org_id`, `is_org_member`, `has_org_role`), al staff
-- (`is_platform_admin`, `has_platform_role`) o a la persona (`user_id`,
-- `store_customer_id`, `auth.uid()`).
--
-- Una policy que no nombra a ninguno no acota a nadie.
--
-- 📌 Se prefirió esta definición a una allowlist de nombres: una allowlist se
-- desactualiza sola en cuanto alguien renombra una policy, y este repo ya tiene
-- la regla de que un guard ruidoso o roto enseña a ignorar los guards.
--
-- Medido al crearla (2026-08-26): **0 filas**, después del arreglo de
-- `20260826000150`. Antes de ese arreglo habría devuelto 5.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.audit_policies_sin_tenant AS
SELECT
  c.relname                                          AS tabla,
  p.polname                                          AS policy,
  CASE p.polcmd WHEN 'r' THEN 'SELECT' WHEN '*' THEN 'ALL' END AS comando,
  CASE WHEN p.polroles = '{0}' THEN 'PUBLIC'
       ELSE (SELECT string_agg(r.rolname, ', ' ORDER BY r.rolname)
               FROM pg_roles r WHERE r.oid = ANY(p.polroles)) END AS roles,
  COALESCE(pg_get_expr(p.polqual, p.polrelid), '(sin USING)') AS expresion,
  (SELECT n_live_tup FROM pg_stat_user_tables s WHERE s.relid = c.oid) AS filas_aprox
FROM pg_policy p
JOIN pg_class c ON c.oid = p.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'org_id' AND a.attnum > 0
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relrowsecurity
  AND p.polcmd IN ('r', '*')
  AND COALESCE(pg_get_expr(p.polqual, p.polrelid), '') NOT ILIKE '%org_id%'
  AND COALESCE(pg_get_expr(p.polqual, p.polrelid), '') NOT ILIKE '%is_org_member%'
  AND COALESCE(pg_get_expr(p.polqual, p.polrelid), '') NOT ILIKE '%has_org_role%'
  AND COALESCE(pg_get_expr(p.polqual, p.polrelid), '') NOT ILIKE '%is_platform_admin%'
  AND COALESCE(pg_get_expr(p.polqual, p.polrelid), '') NOT ILIKE '%has_platform_role%'
  AND COALESCE(pg_get_expr(p.polqual, p.polrelid), '') NOT ILIKE '%user_id%'
  AND COALESCE(pg_get_expr(p.polqual, p.polrelid), '') NOT ILIKE '%store_customer_id%'
  AND COALESCE(pg_get_expr(p.polqual, p.polrelid), '') NOT ILIKE '%auth.uid()%';

COMMENT ON VIEW public.audit_policies_sin_tenant IS
  'Policies de lectura sobre tablas con org_id que no acotan a nadie: ni al comercio, ni al staff, ni a la persona. Tiene que estar VACIA. Complementa a rls_audit_open_policies, que solo detecta USING true.';

REVOKE ALL ON public.audit_policies_sin_tenant FROM anon, authenticated;

-- ── Verificación ───────────────────────────────────────────────────────────
DO $verif$
DECLARE
  v_n int;
  v_detalle text;
BEGIN
  SELECT count(*), COALESCE(string_agg(tabla || '.' || policy, ', '), '')
    INTO v_n, v_detalle
    FROM public.audit_policies_sin_tenant;

  ASSERT v_n = 0,
    'hay ' || v_n || ' policies de lectura que no acotan a nadie: ' || v_detalle;

  -- ⚠️ Y en el otro sentido: una vista que no devuelve nada nunca tampoco
  --    serviría de guarda. Se comprueba que SÍ detecta el caso, creando una
  --    policy mala a propósito sobre una tabla con org_id y borrándola.
  CREATE POLICY "zz_prueba_sin_tenant" ON public.brand_knowledge
    FOR SELECT TO authenticated USING (active = true);

  SELECT count(*) INTO v_n FROM public.audit_policies_sin_tenant
   WHERE policy = 'zz_prueba_sin_tenant';
  DROP POLICY "zz_prueba_sin_tenant" ON public.brand_knowledge;

  ASSERT v_n = 1, 'la vista NO detecto una policy sin filtro de tenant: no sirve como guarda';

  ASSERT (SELECT count(*) FROM public.audit_policies_sin_tenant) = 0,
    'quedo la policy de prueba';

  RAISE NOTICE 'OK: la vista esta vacia, y se probo que detecta el caso cuando existe';
END $verif$;
