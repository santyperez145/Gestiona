-- ═══════════════════════════════════════════════════════════════════════════
-- Sello «Hecha con Nerqia» en las tiendas, con referido medible
-- ═══════════════════════════════════════════════════════════════════════════
--
-- TESIS §5 (distribución: «Hecha con Nerqia» en tiendas y tickets) y §6
-- (altas referidas por comercio activo). Desde 20261010002200 el alta guarda
-- `?ref=`; falta la puerta: un enlace en cada tienda que lleve el slug del
-- comercio. Medido 2026-10-10: ninguna tienda tenía sello.
--
-- `marca_nerqia_de_tienda(p_slug)` (pública) dice si la tienda muestra el
-- sello y con qué `ref`. Respeta lo que el plan promete: con «Marca propia
-- sin identificación de Nerqia» (`custom_branding` vigente) no hay sello. El
-- derecho se lee de `org_entitlements`, la única fuente; como esa función
-- rechaza a un usuario logueado que no es del comercio (un comprador con
-- cuenta), se la consulta como anónima y después se restaura la identidad.
--
-- Idempotente. Reversible: DROP FUNCTION.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.marca_nerqia_de_tienda(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_ref text;
  v_claims text := current_setting('request.jwt.claims', true);
  v_sub text := current_setting('request.jwt.claim.sub', true);
  v_marca_propia boolean;
BEGIN
  SELECT s.org_id, o.slug INTO v_org, v_ref
  FROM public.ecommerce_stores s
  JOIN public.organizations o ON o.id = s.org_id
  WHERE lower(s.slug) = lower(btrim(p_slug)) AND s.is_active
  ORDER BY s.is_primary DESC, s.created_at
  LIMIT 1;
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('mostrar', false);
  END IF;

  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    v_marca_propia := COALESCE((public.org_entitlements(v_org)->>'branding')::boolean, false);
  EXCEPTION WHEN others THEN
    -- Sin poder leer el derecho, no se pone el sello: nunca se muestra en una
    -- tienda que pagó por no tenerlo.
    v_marca_propia := true;
  END;
  PERFORM set_config('request.jwt.claims', COALESCE(v_claims, ''), true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(v_sub, ''), true);

  IF v_marca_propia THEN
    RETURN jsonb_build_object('mostrar', false);
  END IF;
  RETURN jsonb_build_object('mostrar', true, 'ref', v_ref);
END;
$$;

REVOKE ALL ON FUNCTION public.marca_nerqia_de_tienda(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.marca_nerqia_de_tienda(text) TO anon, authenticated;

COMMENT ON FUNCTION public.marca_nerqia_de_tienda(text) IS
  'Si la tienda muestra «Hecha con Nerqia» (no, con marca propia vigente) y el ref del comercio para medir altas referidas. Pública.';

COMMIT;
