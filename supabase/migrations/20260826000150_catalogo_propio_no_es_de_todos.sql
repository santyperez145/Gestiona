-- ═══════════════════════════════════════════════════════════════════════════
-- Un catálogo global se lee entre todos; uno propio, no
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Cinco tablas tenían la policy de lectura escrita como `active = true`, sin
-- ninguna mención al tenant, **teniendo columna `org_id`**:
--
--     brand_knowledge        Read brand knowledge
--     exchange_configs       Read exchange configs
--     marketing_post_types   Read post types
--     marketing_themes       Read themes
--     story_templates        Read templates
--
-- La intención original era correcta: son catálogos que la plataforma siembra
-- —tipos de publicación, temas de marketing, plantillas de historias— y que todo
-- comercio tiene que poder leer. El problema es que la columna `org_id` existe,
-- así que la tabla **también** puede guardar filas de un comercio.
--
-- ── Y en una de las cinco ya no era latente ───────────────────────────────
--
-- ⚠️ `brand_knowledge` se escribe desde la app: `marketingExtraDB.ts:161` hace
-- `insert({ ...payload, org_id: orgId })`, y su policy de INSERT **exige**
-- `org_id IS NOT NULL`. O sea que toda fila que carga un comercio lleva su
-- organización — y la de SELECT no la miraba.
--
-- Es el conocimiento comercial del comercio: sus marcas, sus categorías, sus
-- descripciones, las notas con las que después la IA le escribe los textos.
--
-- Probado en ROJO contra producción, dentro de un ROLLBACK:
--
--     1  el dueño de B ve el conocimiento de marca de A .... LO VE   *** FUGA ***
--     2  total de filas de A visibles para B ................. 1     *** FUGA ***
--     3  anon ve el conocimiento de marca de A .... no lo ve          OK
--     4  B sigue viendo el catálogo global ......... 16 filas         OK
--
-- 📌 Hoy las cinco tablas tienen **0 filas con `org_id`** (medido 2026-08-26:
-- 16, 7, 4, 10 y 10 filas, todas globales), así que **no se filtró nada
-- todavía**. Es una fuga que se activa con el primer uso, y por eso se cierra
-- ahora y no después.
--
-- ── El arreglo, y por qué no cambia nada de lo que hoy funciona ───────────
--
--     active = true
--     AND (org_id IS NULL OR is_org_member(org_id, auth.uid()))
--
-- Una fila global (`org_id IS NULL`) se sigue leyendo igual que antes, por
-- cualquiera que tenga el rol de la policy. Una fila de un comercio sólo la lee
-- ese comercio. `anon` no tiene `auth.uid()`, así que `is_org_member` da false y
-- sigue viendo únicamente el catálogo global — que es lo que ya veía.
--
-- Se conservan los roles exactos de cada policy: `story_templates` es la única
-- que incluye `anon`, porque la usa la tienda pública.
--
-- ⚠️ No se toca ninguna policy de escritura. Las de INSERT/UPDATE ya exigían
-- `has_org_role`; el agujero era sólo de lectura.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Read brand knowledge" ON public.brand_knowledge;
CREATE POLICY "Read brand knowledge" ON public.brand_knowledge
  FOR SELECT TO authenticated
  USING (active = true AND (org_id IS NULL OR public.is_org_member(org_id, auth.uid())));

DROP POLICY IF EXISTS "Read exchange configs" ON public.exchange_configs;
CREATE POLICY "Read exchange configs" ON public.exchange_configs
  FOR SELECT TO authenticated
  USING (active = true AND (org_id IS NULL OR public.is_org_member(org_id, auth.uid())));

DROP POLICY IF EXISTS "Read post types" ON public.marketing_post_types;
CREATE POLICY "Read post types" ON public.marketing_post_types
  FOR SELECT TO authenticated
  USING (active = true AND (org_id IS NULL OR public.is_org_member(org_id, auth.uid())));

DROP POLICY IF EXISTS "Read themes" ON public.marketing_themes;
CREATE POLICY "Read themes" ON public.marketing_themes
  FOR SELECT TO authenticated
  USING (active = true AND (org_id IS NULL OR public.is_org_member(org_id, auth.uid())));

-- La única que la tienda pública necesita: conserva `anon`.
DROP POLICY IF EXISTS "Read templates" ON public.story_templates;
CREATE POLICY "Read templates" ON public.story_templates
  FOR SELECT TO authenticated, anon
  USING (active = true AND (org_id IS NULL OR public.is_org_member(org_id, auth.uid())));

COMMENT ON TABLE public.brand_knowledge IS
  'Conocimiento de marca. org_id NULL = catalogo sembrado por la plataforma, lo lee todo comercio. org_id NOT NULL = del comercio, y solo lo lee el. La policy de SELECT tiene que mirar las dos cosas: hasta 2026-08-26 decia solo active = true.';

-- ── Verificación: la misma prueba que salió en rojo, ahora tiene que dar verde
DO $verif$
DECLARE
  v_org_a uuid; v_org_b uuid; v_user_b uuid; v_id uuid; v_n int; v_global int;
BEGIN
  SELECT o.id INTO v_org_a FROM public.organizations o
   ORDER BY (SELECT count(*) FROM public.products p WHERE p.org_id = o.id) DESC LIMIT 1;
  SELECT m.org_id, m.user_id INTO v_org_b, v_user_b
    FROM public.memberships m
   WHERE m.org_id <> v_org_a
     AND NOT EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = m.user_id)
   LIMIT 1;

  IF v_user_b IS NULL THEN
    RAISE NOTICE 'sin una segunda organizacion con usuario propio; se omite la verificacion';
    RETURN;
  END IF;

  -- Cuántas filas globales ve B antes de tocar nada.
  SELECT count(*) INTO v_global FROM public.brand_knowledge WHERE org_id IS NULL AND active;

  INSERT INTO public.brand_knowledge (org_id, brand, category, description, active)
  VALUES (v_org_a, 'ZZ verificacion de aislamiento', 'perfume_arabe',
          'ZZ fila de prueba, se borra al final', true)
  RETURNING id INTO v_id;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user_b, 'role', 'authenticated')::text, true);

  SELECT count(*) INTO v_n FROM public.brand_knowledge WHERE id = v_id;
  ASSERT v_n = 0, 'el duenio de otra organizacion sigue viendo la fila ajena';

  SELECT count(*) INTO v_n FROM public.brand_knowledge WHERE org_id = v_org_a;
  ASSERT v_n = 0, 'sigue viendo ' || v_n || ' filas de la otra organizacion';

  -- ⚠️ Y en el otro sentido: el catálogo global tiene que seguir viéndose. Una
  --    policy que no deje ver nada también pasaría los dos asserts de arriba.
  SELECT count(*) INTO v_n FROM public.brand_knowledge WHERE org_id IS NULL AND active;
  ASSERT v_n = v_global,
    'se rompio el catalogo global: veia ' || v_global || ' filas y ahora ve ' || v_n;

  RESET ROLE;

  -- Y el comercio dueño sí la ve.
  DECLARE v_user_a uuid;
  BEGIN
    SELECT m.user_id INTO v_user_a FROM public.memberships m WHERE m.org_id = v_org_a LIMIT 1;
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_user_a, 'role', 'authenticated')::text, true);
    SELECT count(*) INTO v_n FROM public.brand_knowledge WHERE id = v_id;
    RESET ROLE;
    ASSERT v_n = 1, 'el comercio duenio dejo de ver su propia fila';
  END;

  -- Limpieza: se borra POR ID, nunca por orden.
  DELETE FROM public.brand_knowledge WHERE id = v_id;
  ASSERT (SELECT count(*) FROM public.brand_knowledge WHERE brand LIKE 'ZZ%') = 0,
    'quedaron restos ZZ en brand_knowledge';

  RAISE NOTICE 'OK: la fila del comercio A es invisible para B, el catalogo global sigue visible y A ve la suya';
END $verif$;
