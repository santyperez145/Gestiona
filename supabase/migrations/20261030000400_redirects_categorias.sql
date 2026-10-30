-- Redirects de categorías al migrar desde Tiendanube (2026-10-30).
--
-- La importación ya redirigía /productos/<handle> de la tienda vieja al
-- producto nuevo. Las categorías (/remeras, /hombre/remeras) caían en la
-- portada: se perdía el posicionamiento y los links compartidos. Al terminar
-- una importación, el panel manda las rutas de categoría del archivo y la base
-- las registra apuntando al catálogo filtrado, atadas al primer lote de la
-- sesión para que «Deshacer» también las borre.
--
-- Reglas: sólo owner/admin; destino únicamente /productos?cat=<categoría
-- codificada para URL>; no pisa
-- un redirect existente (los de productos mandan); no registra rutas propias
-- de la tienda (nunca llegarían al redirect); hasta 500 por llamada.

BEGIN;

CREATE OR REPLACE FUNCTION public.registrar_redirects_categorias(p_session_id uuid, p_redirects jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_sesion public.catalog_import_sessions%ROWTYPE;
  v_store uuid;
  v_batch uuid;
  v_item jsonb;
  v_origen text;
  v_cat text;
  v_creados integer := 0;
  v_omitidos integer := 0;
  v_reservadas text[] := ARRAY['productos', 'producto', 'carrito', 'orden', 'seguimiento', 'cuenta',
                               'recuperar-clave', 'pagina', 'arrepentimiento', 'checkout'];
BEGIN
  SELECT * INTO v_sesion FROM public.catalog_import_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Importación inexistente' USING ERRCODE = '22023'; END IF;
  IF auth.uid() IS NULL OR NOT public.has_org_role(v_sesion.org_id, auth.uid(), ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'Sólo owner o admin puede registrar redirects de la tienda' USING ERRCODE = '42501';
  END IF;
  IF v_sesion.status <> 'completed' OR v_sesion.deshecha_at IS NOT NULL THEN
    RAISE EXCEPTION 'Los redirects se registran al terminar la importación' USING ERRCODE = '22023';
  END IF;
  v_store := NULLIF(v_sesion.options->>'destination_store_id', '')::uuid;
  IF v_store IS NULL OR NOT EXISTS (SELECT 1 FROM public.ecommerce_stores s WHERE s.id = v_store AND s.org_id = v_sesion.org_id) THEN
    RETURN jsonb_build_object('ok', true, 'creados', 0, 'omitidos', 0, 'motivo', 'sin_tienda');
  END IF;
  IF jsonb_typeof(p_redirects) IS DISTINCT FROM 'array' OR jsonb_array_length(p_redirects) > 500 THEN
    RAISE EXCEPTION 'Hasta 500 redirects por vez' USING ERRCODE = '22023';
  END IF;
  SELECT c.batch_id INTO v_batch FROM public.catalog_import_chunks c
   WHERE c.session_id = p_session_id ORDER BY c.position LIMIT 1;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_redirects) LOOP
    v_origen := regexp_replace(lower(btrim(COALESCE(v_item->>'source_path', ''))), '/+$', '');
    v_cat := btrim(COALESCE(v_item->>'category', ''));
    IF v_origen !~ '^(/[a-z0-9][a-z0-9-]{0,80}){1,4}$'
       OR split_part(v_origen, '/', 2) = ANY (v_reservadas)
       OR v_cat !~ '^[A-Za-z0-9%._~!*''()-]{1,240}$' THEN
      v_omitidos := v_omitidos + 1;
      CONTINUE;
    END IF;
    INSERT INTO public.store_url_redirects(store_id, org_id, source_path, destination_path, status_code, import_batch_id, created_by, updated_at)
    VALUES (v_store, v_sesion.org_id, v_origen, '/productos?cat=' || v_cat, 301, v_batch, auth.uid(), now())
    ON CONFLICT (store_id, source_path) DO NOTHING;
    IF FOUND THEN v_creados := v_creados + 1; ELSE v_omitidos := v_omitidos + 1; END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'creados', v_creados, 'omitidos', v_omitidos);
END;
$fn$;
REVOKE ALL ON FUNCTION public.registrar_redirects_categorias(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_redirects_categorias(uuid, jsonb) TO authenticated;

WITH c(function_name, audience, rationale) AS (VALUES
  ('registrar_redirects_categorias', 'authenticated_delegate', 'Owner/admin registra redirects de categorías de su importación terminada; destino fijo al catálogo filtrado.')
)
INSERT INTO public.security_function_contracts(function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on)
SELECT p.proname, pg_get_function_identity_arguments(p.oid), c.audience, c.rationale, md5(pg_get_functiondef(p.oid)), DATE '2026-10-30'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN c ON c.function_name = p.proname
 WHERE n.nspname = 'public'
ON CONFLICT (function_name, identity_arguments) DO UPDATE
  SET audience = EXCLUDED.audience, rationale = EXCLUDED.rationale,
      definition_hash = EXCLUDED.definition_hash, reviewed_on = EXCLUDED.reviewed_on;

COMMIT;
