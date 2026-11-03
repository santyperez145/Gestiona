-- Publicar la tienda exige en la base lo mismo que el checklist del panel.
--
-- 2026-11-03: los bloqueantes de «Publicar la tienda» (src/lib/storeReadiness.ts)
-- vivían sólo en el navegador. La base aceptaba is_active = true de cualquier
-- sesión del dueño: una versión vieja del panel, la API o un cliente propio
-- dejaban online una tienda sin términos, sin forma de cobrar o sin dirección
-- de retiro, y el comprador fallaba en silencio al final de la compra. El único
-- trigger sobre is_active (trg_ecommerce_store_publication) sólo sellaba
-- published_at.
--
-- La regla:
--   · Sólo mira el paso a activa: INSERT ya activa, o UPDATE de no activa a
--     activa. Una tienda que ya está online se sigue editando y guardando
--     entera (el panel manda la fila completa): las de producción no se rompen.
--   · Sólo frena a los roles del navegador y la API (authenticated, anon). Las
--     semillas, las matrices y las migraciones corren como dueño de la base y
--     arman sus vitrinas de prueba directo. Hoy ninguna función SECURITY
--     DEFINER ni Edge Function activa tiendas; si alguna lo hiciera, tiene que
--     llamar a tienda_bloqueos_para_publicar por su cuenta.
--   · Los bloqueantes son los de storeReadiness: link de la tienda, un producto
--     publicado (mismo criterio que get_store_assortment_summary), una forma de
--     cobrar (transferencia, efectivo o Nerqia Pay listo), CBU o alias si se
--     ofrece transferencia, dirección si hay retiro, términos y privacidad
--     publicados y sin plantilla (mismas marcas que esPlantillaSinCompletar y
--     organization_activation_readiness), y con envío por zonas sin retiro,
--     tarifas cargadas y al menos medio país cubierto.
--   · Falla con check_violation (23514) y un mensaje que nombra cada
--     bloqueante, para que el panel lo muestre tal cual.

BEGIN;

CREATE OR REPLACE FUNCTION public.tienda_bloqueos_para_publicar(p_store public.ecommerce_stores)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_bloqueos text[] := ARRAY[]::text[];
  v_medios text[] := COALESCE(p_store.payment_methods, ARRAY[]::text[]);
  v_retiro boolean := COALESCE(p_store.pickup_enabled, false);
  v_legales integer;
  v_zonas_con_tarifa integer;
  v_provincias integer;
BEGIN
  -- Mismo criterio que seed_default_shipping_zones: con sesión, sólo un
  -- miembro (o la plataforma) pregunta por su tienda.
  IF auth.uid() IS NOT NULL
     AND NOT public.is_org_member(p_store.org_id, auth.uid())
     AND NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Sin permiso sobre esa tienda' USING ERRCODE = '42501';
  END IF;

  IF NULLIF(btrim(COALESCE(p_store.slug, '')), '') IS NULL THEN
    v_bloqueos := array_append(v_bloqueos, 'falta elegir el link de la tienda');
  END IF;

  -- El «published» de get_store_assortment_summary (20260904000130).
  IF NOT EXISTS (
    SELECT 1
      FROM public.products product
      LEFT JOIN public.store_product_publications publication
        ON publication.store_id = p_store.id
       AND publication.product_id = product.id
     WHERE product.org_id = p_store.org_id
       AND COALESCE(publication.visibility, 'published') = 'published'
       AND COALESCE(product.is_active, true)
       AND CASE
         WHEN publication.price_ars IS NOT NULL THEN publication.price_ars
         ELSE COALESCE(NULLIF(product.discount_price_ars, 0), product.sale_price_ars)
       END > 0
  ) THEN
    v_bloqueos := array_append(v_bloqueos, 'no hay ningún producto publicado con precio');
  END IF;

  IF NOT (
    v_medios && ARRAY['transferencia', 'efectivo']::text[]
    OR (v_medios && ARRAY['gestiona_pay', 'mercadopago']::text[]
        AND public.gestiona_pay_listo(p_store.org_id))
  ) THEN
    v_bloqueos := array_append(v_bloqueos,
      'no hay una forma de cobrar: habilitá transferencia o efectivo, o activá Nerqia Pay');
  END IF;

  IF 'transferencia' = ANY (v_medios)
     AND NOT public.transferencia_tienda_lista(p_store.org_id) THEN
    v_bloqueos := array_append(v_bloqueos, 'transferencia está habilitada sin CBU ni alias');
  END IF;

  IF v_retiro AND NULLIF(btrim(COALESCE(p_store.pickup_address, '')), '') IS NULL THEN
    v_bloqueos := array_append(v_bloqueos, 'retiro en tienda está activo sin dirección de retiro');
  END IF;

  SELECT count(DISTINCT page.slug) INTO v_legales
    FROM public.store_pages page
   WHERE page.store_id = p_store.id
     AND page.slug IN ('politica-de-privacidad', 'terminos-y-condiciones')
     AND page.status = 'published'
     AND COALESCE(page.content, '') ~ '[^[:space:]]'
     AND lower(page.content) NOT LIKE '%completá acá%'
     AND lower(page.content) NOT LIKE '%completa aca%'
     AND lower(page.content) NOT LIKE '%mi tienda online%'
     AND lower(page.content) NOT LIKE '%[completar]%'
     AND lower(page.content) NOT LIKE '%lorem ipsum%';
  IF v_legales < 2 THEN
    v_bloqueos := array_append(v_bloqueos,
      'falta publicar los términos y la política de privacidad, completos y sin plantilla');
  END IF;

  -- Con retiro el comprador tiene salida: en el checklist las tarifas y la
  -- cobertura pasan a aviso.
  IF COALESCE(p_store.shipping_mode, 'flat') = 'zones' AND NOT v_retiro THEN
    SELECT count(*) INTO v_zonas_con_tarifa
      FROM public.shipping_zones zone
     WHERE zone.org_id = p_store.org_id
       AND zone.is_active
       AND EXISTS (
         SELECT 1 FROM public.shipping_rates rate
          WHERE rate.zone_id = zone.id
            AND rate.org_id = p_store.org_id
            AND rate.is_active
       );
    IF v_zonas_con_tarifa = 0 THEN
      v_bloqueos := array_append(v_bloqueos,
        'la tienda cotiza envíos por zona y ninguna zona tiene tarifas');
    ELSE
      SELECT count(DISTINCT province) INTO v_provincias
        FROM public.shipping_zones zone
        CROSS JOIN LATERAL unnest(COALESCE(zone.provinces, ARRAY[]::text[])) AS province
       WHERE zone.org_id = p_store.org_id
         AND zone.is_active
         AND EXISTS (
           SELECT 1 FROM public.shipping_rates rate
            WHERE rate.zone_id = zone.id
              AND rate.org_id = p_store.org_id
              AND rate.is_active
         );
      -- storeReadiness: faltan más de 12 de las 24 provincias.
      IF 24 - v_provincias > 12 THEN
        v_bloqueos := array_append(v_bloqueos,
          'más de la mitad del país queda sin tarifa de envío');
      END IF;
    END IF;
  END IF;

  RETURN v_bloqueos;
END;
$fn$;

COMMENT ON FUNCTION public.tienda_bloqueos_para_publicar(public.ecommerce_stores) IS
  'Bloqueantes para publicar la tienda, uno por mensaje. Espejo de src/lib/storeReadiness.ts; vacío = se puede publicar.';

-- La llama el trigger, que corre como quien guarda (authenticated). anon no.
REVOKE ALL ON FUNCTION public.tienda_bloqueos_para_publicar(public.ecommerce_stores) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tienda_bloqueos_para_publicar(public.ecommerce_stores) TO authenticated, service_role;

-- SECURITY INVOKER a propósito: current_user tiene que ser el rol de quien
-- guarda. Como definer sería siempre el dueño y no frenaría a nadie.
CREATE OR REPLACE FUNCTION public.trg_tienda_publicar_exige_checklist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_bloqueos text[];
BEGIN
  IF NOT COALESCE(NEW.is_active, false) THEN
    RETURN NEW;
  END IF;
  -- Ya estaba online: se edita sin volver a pedir el checklist.
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.is_active, false) THEN
    RETURN NEW;
  END IF;
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  v_bloqueos := public.tienda_bloqueos_para_publicar(NEW);
  IF cardinality(v_bloqueos) > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = 'No se puede publicar la tienda: ' || array_to_string(v_bloqueos, '; ') || '.',
      HINT = 'Resolvé lo que marca el checklist de «Publicar la tienda» y volvé a publicar.';
  END IF;
  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.trg_tienda_publicar_exige_checklist() IS
  'Impide que el navegador o la API publiquen una tienda con bloqueantes del checklist. No mira tiendas ya activas.';

REVOKE ALL ON FUNCTION public.trg_tienda_publicar_exige_checklist() FROM PUBLIC, anon, authenticated;

-- Nombre «trg_tienda_p…»: corre después de trg_tienda_mayorista_medios, que
-- reescribe payment_methods, y mira los medios como van a quedar.
DROP TRIGGER IF EXISTS trg_tienda_publicar_exige_checklist ON public.ecommerce_stores;
CREATE TRIGGER trg_tienda_publicar_exige_checklist
  BEFORE INSERT OR UPDATE OF is_active ON public.ecommerce_stores
  FOR EACH ROW EXECUTE FUNCTION public.trg_tienda_publicar_exige_checklist();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.ecommerce_stores'::regclass
       AND tgname = 'trg_tienda_publicar_exige_checklist'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'falta el trigger que exige el checklist al publicar';
  END IF;

  IF (SELECT prosecdef FROM pg_proc
       WHERE oid = 'public.trg_tienda_publicar_exige_checklist()'::regprocedure) THEN
    RAISE EXCEPTION 'el trigger del checklist no puede ser SECURITY DEFINER: no vería el rol de quien publica';
  END IF;

  IF has_function_privilege('anon', 'public.tienda_bloqueos_para_publicar(public.ecommerce_stores)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon no debe poder revisar tiendas';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.tienda_bloqueos_para_publicar(public.ecommerce_stores)', 'EXECUTE') THEN
    RAISE EXCEPTION 'el trigger corre como authenticated y necesita llamar a tienda_bloqueos_para_publicar';
  END IF;
END $$;

COMMIT;
