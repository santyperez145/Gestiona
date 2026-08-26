-- ═══════════════════════════════════════════════════════════════════════════
-- P0-04 — un proveedor sin token deja de ofrecerse en el checkout
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Encontrado ampliando la matriz de pagos con el escenario "desconexion OAuth"
-- que pedia el backlog del 2026-08-24.
--
-- `pago_proveedores_para` decia en un comentario que el proveedor "tiene que
-- estar **conectado** y habilitado", y el codigo solo miraba
-- `org_payment_providers.habilitado` — el interruptor del comercio, no el
-- token. Son dos tablas distintas, y `mp-connect` no toca la primera.
--
-- Consecuencia: al revocar el OAuth, el flag queda encendido sin credencial, el
-- checkout sigue ofreciendo MercadoPago y **el comprador falla al final**, con
-- el carrito lleno y los datos cargados. Es el peor lugar para fallar.
--
-- Hoy no hay ninguna organizacion en ese estado (medido 2026-08-25: 1 conexion,
-- 1 habilitado, 0 desalineados), asi que esto no le saca ningun medio de pago a
-- nadie. Cierra el caso antes de que ocurra.
--
-- La funcion se regenero desde `pg_get_functiondef` con un script, cambiando
-- solo esa condicion: reescribir de memoria una funcion de ruteo es como casi
-- se rompe `mark_store_order_paid`.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.pago_proveedores_para(p_org uuid, p_metodo text, p_monto numeric, p_cuotas integer DEFAULT 1, p_moneda text DEFAULT 'ARS'::text)
 RETURNS TABLE(provider text, prioridad integer, costo numeric, costo_pct numeric, dias_acredita integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH reglas AS (
    SELECT DISTINCT ON (r.metodo, r.provider) r.provider, r.prioridad
      FROM public.payment_routing r
     WHERE r.is_active AND r.metodo = p_metodo
       AND (r.org_id IS NULL OR r.org_id = p_org)
       AND (r.monto_min IS NULL OR p_monto >= r.monto_min)
       AND (r.monto_max IS NULL OR p_monto <= r.monto_max)
     ORDER BY r.metodo, r.provider, (r.org_id IS NOT NULL) DESC
  ),
  capaces AS (
    SELECT g.provider, g.prioridad
      FROM reglas g
      JOIN public.payment_providers pp ON pp.codigo = g.provider
     WHERE pp.is_active
       AND p_metodo = ANY(pp.metodos)
       AND p_moneda = ANY(pp.monedas)
       AND (COALESCE(p_cuotas, 1) = 1 OR pp.soporta_cuotas)
       -- ⚠️ Un proveedor declarado pero no integrado NO cobra. Está en el
       -- catálogo para que el comercio lo vea venir, no para rutearle plata.
       AND pp.integracion <> 'declarado'
       -- Y tiene que estar conectado y habilitado por este comercio, salvo los
       -- que no necesitan conexión (efectivo, transferencia).
       --
       -- ⚠️ El "conectado" estaba en este comentario y NO en el código: sólo
       -- se miraba `org_payment_providers.habilitado`, que es el interruptor
       -- del comercio, no el token. `mp-connect` no toca esa tabla, así que
       -- al revocar el OAuth el flag quedaba encendido sin credencial: el
       -- checkout seguía ofreciendo MercadoPago y el comprador fallaba **al
       -- final**, con el carrito lleno. Es el peor lugar para fallar.
       --
       -- Es la misma clase de bug que el IVA de monotributo: la regla escrita
       -- en el comentario y a medias en el código.
       AND (pp.conexion = 'ninguna'
            OR (EXISTS (SELECT 1 FROM public.org_payment_providers o
                         WHERE o.org_id = p_org AND o.provider = pp.codigo
                           AND o.habilitado)
                -- 'plataforma' la conecta la plataforma, no el comercio.
                AND (pp.conexion <> 'oauth'
                     OR EXISTS (SELECT 1 FROM public.payment_connections c
                                 WHERE c.org_id = p_org
                                   AND c.provider = pp.codigo
                                   AND COALESCE(c.access_token, '') <> ''))))
  ),
  tarifa AS (
    SELECT c.provider, c.prioridad, f.percent_fee, f.fixed_fee,
           f.iva_on_fee_pct, f.release_days
      FROM capaces c
      LEFT JOIN LATERAL (
        SELECT * FROM public.payment_provider_fees x
         WHERE x.provider = c.provider
           AND x.method   = public.pago_metodo_de_tarifa(p_metodo, p_cuotas)
           AND x.currency = p_moneda
           AND COALESCE(x.installments, 0) IN (COALESCE(p_cuotas, 1), 0)
           AND (x.effective_from IS NULL OR x.effective_from <= CURRENT_DATE)
         ORDER BY (COALESCE(x.installments, 0) = COALESCE(p_cuotas, 1)) DESC,
                  x.effective_from DESC NULLS LAST
         LIMIT 1) f ON true
  )
  SELECT
    t.provider, t.prioridad,
    CASE WHEN t.percent_fee IS NULL AND t.fixed_fee IS NULL THEN NULL
         ELSE ROUND((p_monto * COALESCE(t.percent_fee, 0) / 100.0 + COALESCE(t.fixed_fee, 0))
                    * (1 + COALESCE(t.iva_on_fee_pct, 0) / 100.0), 2)
    END AS costo,
    t.percent_fee AS costo_pct,
    t.release_days AS dias_acredita
  FROM tarifa t
  ORDER BY t.prioridad, (t.percent_fee IS NULL),
           ROUND((p_monto * COALESCE(t.percent_fee, 0) / 100.0 + COALESCE(t.fixed_fee, 0))
                 * (1 + COALESCE(t.iva_on_fee_pct, 0) / 100.0), 2);
$function$
;
