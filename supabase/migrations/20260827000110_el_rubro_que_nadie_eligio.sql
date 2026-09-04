-- El rubro que nadie eligió
--
-- ── Qué se encontró ───────────────────────────────────────────────────────
--
-- CONTRIBUTING.md tiene una regla desde el 2026-08-25: «El rubro del comercio no se
-- adivina. `settings.industry_code` tenía `DEFAULT 'perfumes'` desde que esto
-- era la app de un solo negocio. NULL significa *todavía no eligió*».
--
-- El default se sacó de la columna, y eso está bien: hoy no tiene ninguno. ⚠️
-- **Pero no se corrigió lo que ya estaba escrito.** Medido el 2026-08-27:
--
--     organización        perfil aplicado   rubro en settings
--     Exentry Imports     perfumes          perfumes     ← eligió de verdad
--     pruebas Workspace   —                 perfumes     ← nunca eligió
--
-- `pruebas Workspace` tiene 0 productos, 0 tipos de producto y ninguna fila en
-- `organization_business_profiles`. No hay rastro de que nadie haya elegido
-- nada: eso es el default viejo, escrito por la columna.
--
-- El rubro siembra tipos de producto y atributos. Un comercio de cualquier
-- rubro que entre a configurarse arranca con perfumería puesta sin haberlo
-- pedido — que es exactamente lo que la regla vino a evitar.
--
-- ── Cómo se distingue una elección de un default ──────────────────────────
--
-- `complete_business_onboarding` y `configure_business_profile` escriben el
-- rubro **y** dejan una fila en `organization_business_profiles`, en la misma
-- llamada (verificado leyendo las dos funciones). Así que un rubro sin esa
-- fila no lo eligió nadie.
--
-- 📌 La corrección es conservadora a propósito: además de no tener perfil
-- aplicado, se exige **0 tipos de producto y 0 productos**. Un comercio viejo
-- que sí operaba como perfumería no se toca aunque le falte la fila de
-- evidencia — borrar un rubro real es peor que dejar uno de más.

UPDATE public.settings s
   SET industry_code = NULL,
       updated_at    = now()
 WHERE s.industry_code IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.organization_business_profiles p
                    WHERE p.org_id = s.org_id)
   AND NOT EXISTS (SELECT 1 FROM public.product_types t WHERE t.org_id = s.org_id)
   AND NOT EXISTS (SELECT 1 FROM public.products pr    WHERE pr.org_id = s.org_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- La guardia
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.audit_rubro_adivinado AS
SELECT s.org_id,
       o.name AS organizacion,
       s.industry_code AS rubro_sin_respaldo,
       o.created_at
FROM public.settings s
JOIN public.organizations o ON o.id = s.org_id
WHERE s.industry_code IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.organization_business_profiles p
                   WHERE p.org_id = s.org_id)
  AND NOT EXISTS (SELECT 1 FROM public.product_types t WHERE t.org_id = s.org_id)
  AND NOT EXISTS (SELECT 1 FROM public.products pr    WHERE pr.org_id = s.org_id);

COMMENT ON VIEW public.audit_rubro_adivinado IS
  'Organizaciones con un rubro escrito que nadie eligió: sin perfil aplicado, '
  'sin tipos de producto y sin productos. Tiene que estar vacía. Una fila '
  'significa que volvió un default como el `perfumes` que la app arrastraba de '
  'cuando era el sistema de un solo negocio.';

GRANT SELECT ON public.audit_rubro_adivinado TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación — en los dos sentidos
-- ═══════════════════════════════════════════════════════════════════════════

DO $verif$
DECLARE
  v_filas  int;
  v_org    uuid := gen_random_uuid();
  v_user   uuid;
  v_real   text;
BEGIN
  -- ── a. La vista quedó vacía ─────────────────────────────────────────────
  SELECT count(*) INTO v_filas FROM public.audit_rubro_adivinado;
  ASSERT v_filas = 0, 'quedaron ' || v_filas || ' organizaciones con un rubro que nadie eligio';

  -- ── b. ⚠️ Y el rubro REAL sigue en su lugar ─────────────────────────────
  -- Sin esta mitad, un UPDATE demasiado ancho —que borrara el rubro de todos—
  -- dejaría la vista igual de vacía, y el comercio que sí opera como
  -- perfumería perdería sus tipos y atributos sin que nadie lo note.
  SELECT s.industry_code INTO v_real
    FROM public.settings s
    JOIN public.organization_business_profiles p ON p.org_id = s.org_id
   LIMIT 1;
  ASSERT v_real IS NOT NULL,
    'se borro el rubro de una organizacion que SI lo habia elegido';

  -- ── c. Y la vista detecta cuando aparece uno adivinado ──────────────────
  -- Una vista que nunca devuelve nada tampoco sirve de guarda.
  SELECT user_id INTO v_user FROM public.memberships LIMIT 1;
  INSERT INTO public.organizations (id, name, slug, owner_user_id)
  VALUES (v_org, 'ZZ rubro adivinado', 'zz-rubro-' || substr(v_org::text,1,8), v_user);
  UPDATE public.settings SET industry_code = 'perfumes' WHERE org_id = v_org;

  SELECT count(*) INTO v_filas FROM public.audit_rubro_adivinado WHERE org_id = v_org;
  DELETE FROM public.organizations WHERE id = v_org;
  ASSERT v_filas = 1, 'la vista NO detecto un rubro adivinado: no sirve de guarda';

  -- ── d. Sin restos ───────────────────────────────────────────────────────
  SELECT count(*) INTO v_filas FROM public.organizations WHERE name = 'ZZ rubro adivinado';
  ASSERT v_filas = 0, 'quedaron restos ZZ';

  RAISE NOTICE 'OK: vacia, el rubro real intacto, y detecta uno adivinado';
END $verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260827000110', 'el_rubro_que_nadie_eligio')
ON CONFLICT DO NOTHING;
