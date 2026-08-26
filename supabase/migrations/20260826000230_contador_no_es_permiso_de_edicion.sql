-- ═══════════════════════════════════════════════════════════════════════════
-- Sumar un "me gusta" no puede ser permiso para reescribir la plantilla
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Continuación del barrido de aislamiento. `20260826000150` cerró las policies
-- de **lectura** que no acotaban al tenant; ésta es la que faltaba del lado de
-- la **escritura**, que es peor: leer lo ajeno es una fuga, escribirlo es un
-- destrozo.
--
-- De las 277 tablas con `org_id` y RLS, había **una sola** policy de escritura
-- sin filtro de tenant (medido 2026-08-26), y no era un descuido: era una
-- necesidad real resuelta demasiado ancha.
--
--     marketing_templates_public_update
--     UPDATE  TO authenticated
--     USING       (is_public = true)
--     WITH CHECK  (is_public = true)
--
-- ── Para qué existía ──────────────────────────────────────────────────────
--
-- `MarketingTemplatesTab` deja usar y marcar como favorita una plantilla que
-- otro comercio publicó, y eso incrementa dos contadores:
--
--     .update({ uses_count: tpl.uses_count + 1 }).eq("id", tpl.id)
--     .update({ likes: tpl.likes + 1 }).eq("id", tpl.id)
--
-- Para que eso funcione hacía falta que un comercio pudiera escribir la fila de
-- otro. La policy lo permitió — **y de paso le permitió escribir todo lo demás**:
-- `title`, `content`, `post_type`, `tags`, e incluso mover la fila a otro
-- `org_id`, porque el `WITH CHECK` sólo exige que siga siendo pública.
--
-- ⚠️ Y el `WITH CHECK (is_public = true)` no protege lo que parece: valida la
-- fila **resultante**, no que se haya tocado sólo el contador.
--
-- 📌 Hoy la tabla tiene **0 filas**, así que no se rompió nada todavía. Pero el
-- alta está cableada (`insert({ ...data, org_id: activeOrg.id })`), así que se
-- activa con la primera plantilla que alguien publique.
--
-- ── Y el contador tenía un segundo problema, más silencioso ───────────────
--
-- `tpl.likes + 1` es leer-modificar-escribir **desde el cliente**. Dos personas
-- que marcan la misma plantilla en el mismo momento leen N las dos y escriben
-- N+1 las dos: se pierde un voto y nadie se entera. Es el mismo error que
-- `products.stock` escrito desde el cliente, que en este repo ya costó caro.
--
-- Además `likes` podía venir NULL, y `null + 1` es NULL, no 1.
--
-- ── El arreglo ────────────────────────────────────────────────────────────
--
-- Dos funciones que incrementan **en la base**, con `likes = likes + 1`, que es
-- atómico. El cliente pide "sumá uno", no manda el número.
--
-- Sólo tocan el contador: no hay forma de que reescriban el contenido. Y sólo
-- sobre plantillas públicas — la propia se administra con la policy de siempre.
--
-- 📌 **No se agrega deduplicación de "me gusta".** Hoy una persona puede sumar
-- varias veces, y eso ya era así. Arreglarlo necesita una tabla de votos por
-- persona, que es una decisión de producto y no de seguridad; se deja anotado
-- en vez de inventarlo acá.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── El contador, del lado del servidor ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.marketing_template_sumar_uso(p_template_id uuid)
RETURNS int
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_n int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Necesitás iniciar sesión';
  END IF;

  UPDATE public.marketing_templates
     SET uses_count = COALESCE(uses_count, 0) + 1
   WHERE id = p_template_id
     AND (is_public OR public.is_org_member(org_id, auth.uid()))
  RETURNING uses_count INTO v_n;

  IF v_n IS NULL THEN
    RAISE EXCEPTION 'La plantilla no existe o no es pública';
  END IF;
  RETURN v_n;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.marketing_template_sumar_like(p_template_id uuid)
RETURNS int
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_n int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Necesitás iniciar sesión';
  END IF;

  UPDATE public.marketing_templates
     SET likes = COALESCE(likes, 0) + 1
   WHERE id = p_template_id
     AND (is_public OR public.is_org_member(org_id, auth.uid()))
  RETURNING likes INTO v_n;

  IF v_n IS NULL THEN
    RAISE EXCEPTION 'La plantilla no existe o no es pública';
  END IF;
  RETURN v_n;
END;
$fn$;

REVOKE ALL ON FUNCTION public.marketing_template_sumar_uso(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.marketing_template_sumar_like(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marketing_template_sumar_uso(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.marketing_template_sumar_like(uuid) TO authenticated;

COMMENT ON FUNCTION public.marketing_template_sumar_uso(uuid) IS
  'Incrementa uses_count en la base. El cliente pide sumar uno, no manda el numero: leer-modificar-escribir desde el navegador pierde votos concurrentes.';
COMMENT ON FUNCTION public.marketing_template_sumar_like(uuid) IS
  'Incrementa likes en la base, atomico. Sin deduplicacion por persona: eso necesita una tabla de votos y es una decision de producto.';

-- ── Y la policy ancha se va ───────────────────────────────────────────────

DROP POLICY IF EXISTS "marketing_templates_public_update" ON public.marketing_templates;

COMMENT ON TABLE public.marketing_templates IS
  'Plantillas de marketing. org_id NOT NULL = del comercio. Una publica la puede LEER cualquiera y sus contadores se suman con marketing_template_sumar_uso/like; editarla solo su dueno. Hasta 2026-08-26 una policy de UPDATE con USING (is_public) dejaba a cualquier usuario reescribir el contenido ajeno.';

-- ── Verificación ───────────────────────────────────────────────────────────
DO $verif$
DECLARE
  v_org_a uuid; v_org_b uuid; v_user_a uuid; v_user_b uuid;
  v_id uuid; v_n int; v_fallo text; v_titulo text;
BEGIN
  SELECT o.id INTO v_org_a FROM public.organizations o
   ORDER BY (SELECT count(*) FROM public.products p WHERE p.org_id = o.id) DESC LIMIT 1;
  SELECT m.user_id INTO v_user_a FROM public.memberships m WHERE m.org_id = v_org_a LIMIT 1;
  SELECT m.org_id, m.user_id INTO v_org_b, v_user_b
    FROM public.memberships m
   WHERE m.org_id <> v_org_a
     AND NOT EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = m.user_id)
   LIMIT 1;

  IF v_user_b IS NULL THEN
    RAISE NOTICE 'sin una segunda organizacion; se omite la verificacion';
    RETURN;
  END IF;

  -- El comercio A publica una plantilla.
  INSERT INTO public.marketing_templates
    (org_id, created_by, title, content, post_type, is_public, likes, uses_count)
  VALUES (v_org_a, v_user_a, 'ZZ plantilla de A', 'ZZ contenido original de A',
          'promo', true, 0, 0)
  RETURNING id INTO v_id;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user_b, 'role', 'authenticated')::text, true);

  -- 1. B ya NO puede reescribir el contenido ajeno.
  UPDATE public.marketing_templates
     SET content = 'ZZ B pisó el contenido de A'
   WHERE id = v_id;
  RESET ROLE;

  SELECT content INTO v_titulo FROM public.marketing_templates WHERE id = v_id;
  ASSERT v_titulo = 'ZZ contenido original de A',
    'un comercio ajeno reescribio la plantilla: ' || v_titulo;

  -- 2. Pero SÍ puede sumar un uso y un like. ⚠️ Si sólo se probara el rechazo,
  --    una policy que bloquee todo también pasaría el punto 1.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user_b, 'role', 'authenticated')::text, true);
  v_n := public.marketing_template_sumar_like(v_id);
  ASSERT v_n = 1, 'el like no se sumo: ' || COALESCE(v_n::text, 'null');
  v_n := public.marketing_template_sumar_uso(v_id);
  ASSERT v_n = 1, 'el uso no se sumo: ' || COALESCE(v_n::text, 'null');

  -- 3. Y una plantilla privada de otro comercio no se toca ni por el contador.
  UPDATE public.marketing_templates SET is_public = false WHERE id = v_id;
  RESET ROLE;
  UPDATE public.marketing_templates SET is_public = false WHERE id = v_id;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user_b, 'role', 'authenticated')::text, true);
  v_fallo := NULL;
  BEGIN
    PERFORM public.marketing_template_sumar_like(v_id);
  EXCEPTION WHEN others THEN v_fallo := SQLERRM;
  END;
  RESET ROLE;
  ASSERT v_fallo IS NOT NULL, 'se pudo sumar un like a una plantilla privada ajena';

  -- 4. El dueño sigue pudiendo editar la suya.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user_a, 'role', 'authenticated')::text, true);
  UPDATE public.marketing_templates SET content = 'ZZ A edita lo suyo' WHERE id = v_id;
  RESET ROLE;
  SELECT content INTO v_titulo FROM public.marketing_templates WHERE id = v_id;
  ASSERT v_titulo = 'ZZ A edita lo suyo',
    'el duenio dejo de poder editar su propia plantilla: ' || v_titulo;

  -- Limpieza por id.
  DELETE FROM public.marketing_templates WHERE id = v_id;
  ASSERT (SELECT count(*) FROM public.marketing_templates WHERE title LIKE 'ZZ%') = 0,
    'quedaron restos ZZ';

  RAISE NOTICE 'OK 4/4: no se reescribe lo ajeno, el contador si suma, lo privado no se toca y el duenio edita lo suyo';
END $verif$;
