-- El semáforo de comercios avisa cuando un negocio al que se le intenta
-- respaldar lleva más de 48 h sin un respaldo válido.
--
-- Del 24/9 al 13/10 (medido 2026-10-13) Exentry y Famatina fallaron el
-- respaldo todas las noches («tablas truncadas», arreglado en 075737fa) y nadie
-- se enteró: el fallo quedaba en `organization_backup_snapshots` y no salía en
-- ninguna pantalla. Un respaldo que falla en silencio es igual a no tener.
-- Misma firma y mismo retorno: CREATE OR REPLACE conserva los permisos.
BEGIN;

CREATE OR REPLACE FUNCTION public.platform_salud_comercios()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_resultado jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Sólo administradores de plataforma' USING ERRCODE = 'insufficient_privilege';
  END IF;

  WITH orgs AS (
    SELECT o.id, o.name, o.created_at, o.trial_ends_at,
      (SELECT count(*) FROM public.catalog_import_sessions s
        WHERE s.org_id = o.id AND s.status IN ('preparing', 'ready', 'applying')
          AND s.updated_at < now() - interval '30 minutes') AS importaciones_trabadas,
      (SELECT count(*) FROM public.products p
        WHERE p.org_id = o.id AND COALESCE(p.cost_currency, 'ARS') = 'ARS'
          AND COALESCE(p.cost_ars, 0) > 0 AND COALESCE(p.sale_price_ars, 0) > 0
          AND p.sale_price_ars < p.cost_ars) AS bajo_costo,
      (SELECT count(*) FROM public.sale_transactions t
        WHERE t.org_id = o.id AND t.occurred_at >= now() - interval '7 days')
      + (SELECT count(*) FROM public.ecommerce_orders e
        WHERE e.org_id = o.id AND e.payment_status IN ('paid', 'partial', 'refunded')
          AND e.created_at >= now() - interval '7 days') AS ventas_7d,
      (SELECT count(*) FROM public.sale_transactions t WHERE t.org_id = o.id AND t.occurred_at >= now() - interval '60 days')
      + (SELECT count(*) FROM public.products p WHERE p.org_id = o.id) AS actividad,
      (SELECT count(*) FROM public.invoices i
        WHERE i.org_id = o.id AND i.afip_status IN ('rejected', 'error', 'config_error', 'network_error', 'validation_error')) AS comprobantes_con_error,
      EXISTS (SELECT 1 FROM public.ecommerce_stores s WHERE s.org_id = o.id AND s.is_active AND s.published_at IS NOT NULL) AS tienda,
      -- Se respalda si hubo algún intento en 30 días. No se usa
      -- `org_entitlements`, que exige ser miembro del comercio.
      EXISTS (SELECT 1 FROM public.organization_backup_snapshots b
        WHERE b.org_id = o.id AND b.created_at >= now() - interval '30 days') AS respalda,
      (SELECT max(b.created_at) FROM public.organization_backup_snapshots b
        WHERE b.org_id = o.id AND b.status = 'completed') AS ultimo_respaldo,
      EXISTS (SELECT 1 FROM public.subscriptions sub JOIN public.plans pl ON pl.id = sub.plan_id
        WHERE sub.org_id = o.id AND sub.status = 'active' AND pl.code <> 'trial') AS paga
    FROM public.organizations o
  ),
  motivos AS (
    SELECT o.*,
      array_remove(ARRAY[
        CASE WHEN importaciones_trabadas > 0 THEN jsonb_build_object('nivel', 'rojo', 'id', 'importacion',
          'texto', importaciones_trabadas || ' importación(es) de catálogo trabada(s)', 'ir', '/productos') END,
        CASE WHEN bajo_costo > 0 THEN jsonb_build_object('nivel', 'rojo', 'id', 'bajo_costo',
          'texto', bajo_costo || ' producto(s) con precio por debajo del costo', 'ir', '/productos?margen=negative') END,
        CASE WHEN ventas_7d = 0 AND created_at < now() - interval '14 days' THEN jsonb_build_object('nivel', 'rojo', 'id', 'sin_ventas',
          'texto', 'Sin ventas en los últimos 7 días', 'ir', '/pos') END,
        CASE WHEN respalda AND created_at < now() - interval '2 days'
               AND (ultimo_respaldo IS NULL OR ultimo_respaldo < now() - interval '48 hours')
          THEN jsonb_build_object('nivel', 'rojo', 'id', 'respaldo',
          'texto', CASE WHEN ultimo_respaldo IS NULL THEN 'Sin ningún respaldo válido'
                        ELSE 'Sin respaldo válido desde el ' || to_char(ultimo_respaldo AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM') END,
          'ir', '/ajustes#system') END,
        CASE WHEN comprobantes_con_error > 0 THEN jsonb_build_object('nivel', 'ambar', 'id', 'arca',
          'texto', comprobantes_con_error || ' comprobante(s) con error en ARCA', 'ir', '/facturas') END,
        CASE WHEN NOT tienda THEN jsonb_build_object('nivel', 'ambar', 'id', 'tienda',
          'texto', 'Sin tienda online publicada', 'ir', '/tienda') END,
        CASE WHEN NOT paga AND trial_ends_at IS NOT NULL AND trial_ends_at BETWEEN now() AND now() + interval '7 days'
          THEN jsonb_build_object('nivel', 'ambar', 'id', 'prueba',
          'texto', 'La prueba vence el ' || to_char(trial_ends_at AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM'), 'ir', '/mi-plan') END
      ], NULL) AS lista
    FROM orgs o
    WHERE o.actividad > 0 OR o.created_at >= now() - interval '60 days'
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'org_id', id,
      'nombre', name,
      'semaforo', CASE
        WHEN EXISTS (SELECT 1 FROM unnest(lista) m WHERE m->>'nivel' = 'rojo') THEN 'rojo'
        WHEN cardinality(lista) > 0 THEN 'ambar'
        ELSE 'verde' END,
      'ventas_7d', ventas_7d,
      'motivos', to_jsonb(lista))
    ORDER BY
      CASE WHEN EXISTS (SELECT 1 FROM unnest(lista) m WHERE m->>'nivel' = 'rojo') THEN 0
           WHEN cardinality(lista) > 0 THEN 1 ELSE 2 END,
      name), '[]'::jsonb)
  INTO v_resultado
  FROM motivos;

  RETURN jsonb_build_object('medido_at', now(), 'comercios', v_resultado);
END;
$function$;

COMMIT;
