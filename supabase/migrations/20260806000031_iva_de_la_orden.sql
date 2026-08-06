-- ═══════════════════════════════════════════════════════════════════════════
-- A3 — El IVA de la orden deja de ser cero
--
-- `ecommerce_orders.tax_amount` se insertaba con el literal `0`. Verificado
-- contra producción: **6 órdenes, $1.549.574 facturados, IVA cero en todas**.
-- La organización está configurada en 21% con precios IVA incluido, así que ahí
-- adentro hay unos $268.900 de IVA que la orden no discriminaba.
--
-- No es un campo decorativo: **sin discriminarlo no se puede emitir la factura
-- desde la orden**, que es lo que bloquea el circuito AFIP entero. Por eso el
-- ROADMAP lo pone en la tanda A.
--
-- ── Las dos formas de cotizar ────────────────────────────────────────────
--
--   incluido:     neto = total / (1 + t)      iva = total − neto
--   no incluido:  iva  = base × t             total = base + iva
--
-- Confundirlas es un error de 21% sobre la base imponible: tomar un precio que
-- ya trae el IVA adentro y sumarle 21% factura de más.
--
-- ── El redondeo ──────────────────────────────────────────────────────────
--
-- `neto + iva` tiene que dar **exactamente** el total. Si se redondean los dos
-- por separado la suma se va uno o dos centavos y la factura no cierra contra
-- la orden. Se redondea el neto y el IVA sale por diferencia, nunca al revés.
--
-- ── La base imponible ────────────────────────────────────────────────────
--
-- Es **todo lo que se cobra**: la mercadería ya con sus descuentos, más el
-- envío. El flete es un servicio gravado en Argentina; dejarlo afuera
-- subdeclararía el IVA de cada venta con envío. Y los descuentos van antes: se
-- tributa sobre lo que efectivamente se cobra, no sobre el precio de lista.
--
-- Espejo de `src/lib/ivaCalc.ts`, que tiene 18 tests. Si se toca una cuenta, se
-- toca la otra.
--
-- ── Por qué un trigger ───────────────────────────────────────────────────
--
-- `create_store_order` la está editando la otra PC en paralelo. Un trigger
-- BEFORE INSERT calcula el campo sin tocar su cuerpo, y cubre cualquier camino
-- futuro que cree una orden — incluida la importación de MercadoLibre.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── El desglose, como función ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.desglosar_iva(
  p_importe  numeric,
  p_tasa     numeric,
  p_incluido boolean
) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v_total numeric; v_neto numeric; v_iva numeric;
BEGIN
  IF p_importe IS NULL OR p_importe <= 0 THEN
    RETURN jsonb_build_object('neto', 0, 'iva', 0, 'total', 0, 'tasa', COALESCE(GREATEST(p_tasa,0),0));
  END IF;

  -- Exento: IVA cero, no IVA desconocido.
  IF p_tasa IS NULL OR p_tasa <= 0 THEN
    v_total := round(p_importe, 2);
    RETURN jsonb_build_object('neto', v_total, 'iva', 0, 'total', v_total, 'tasa', 0);
  END IF;

  IF p_incluido THEN
    v_total := round(p_importe, 2);
    -- El neto se redondea y el IVA sale por diferencia: así la suma cierra.
    v_neto  := round(v_total / (1 + p_tasa / 100.0), 2);
    v_iva   := round(v_total - v_neto, 2);
  ELSE
    v_neto  := round(p_importe, 2);
    v_iva   := round(v_neto * (p_tasa / 100.0), 2);
    v_total := round(v_neto + v_iva, 2);
  END IF;

  RETURN jsonb_build_object('neto', v_neto, 'iva', v_iva, 'total', v_total, 'tasa', p_tasa);
END;
$$;

COMMENT ON FUNCTION public.desglosar_iva IS
  'Separa un importe en neto e IVA. Con `p_incluido` el IVA se saca de adentro; sin él se suma. El neto se redondea y el IVA sale por diferencia para que neto + iva dé exactamente el total. Espejo de desglosarIva() en src/lib/ivaCalc.ts.';

-- ── Al crear la orden, calcular el IVA ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_iva_de_orden()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_habilitado boolean;
  v_tasa       numeric;
  v_incluido   boolean;
  v_desglose   jsonb;
BEGIN
  -- Si alguien ya lo calculó, se respeta: quien lo sabe con certeza gana.
  IF COALESCE(NEW.tax_amount, 0) > 0 THEN RETURN NEW; END IF;

  SELECT s.tax_enabled, s.tax_iva_percent, s.tax_prices_include_iva
    INTO v_habilitado, v_tasa, v_incluido
    FROM public.settings s WHERE s.org_id = NEW.org_id LIMIT 1;

  -- Un monotributista no discrimina IVA. Sin configuración tampoco se inventa.
  IF NOT COALESCE(v_habilitado, false) OR COALESCE(v_tasa, 0) <= 0 THEN
    NEW.tax_amount := 0;
    RETURN NEW;
  END IF;

  -- La base es el total cobrado: mercadería con descuentos + envío. El flete
  -- está gravado, y dejarlo afuera subdeclararía el IVA de cada venta con
  -- envío.
  v_desglose := public.desglosar_iva(NEW.total, v_tasa, COALESCE(v_incluido, true));
  NEW.tax_amount := (v_desglose->>'iva')::numeric;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_iva_de_orden IS
  'Calcula tax_amount al crear la orden, desde la configuración de la organización. Antes se insertaba el literal 0 y ninguna orden discriminaba IVA, lo que impedía facturarla.';

DROP TRIGGER IF EXISTS trg_iva_de_orden ON public.ecommerce_orders;
CREATE TRIGGER trg_iva_de_orden
BEFORE INSERT ON public.ecommerce_orders
FOR EACH ROW EXECUTE FUNCTION public.trg_iva_de_orden();

-- ── Lo que la vitrina necesita mostrar ───────────────────────────────────
--
-- Se agrega a `get_store_by_slug` para que el checkout pueda decir "IVA
-- incluido" donde corresponde. Al consumidor final NO se le discrimina el
-- monto: eso es de mayorista y confunde al comprador minorista.
DROP FUNCTION IF EXISTS public.store_iva_config(text);

CREATE OR REPLACE FUNCTION public.store_iva_config(p_slug text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'habilitado', COALESCE(s.tax_enabled, false),
    'tasa',       COALESCE(s.tax_iva_percent, 0),
    'incluido',   COALESCE(s.tax_prices_include_iva, true)
  )
  FROM public.ecommerce_stores e
  JOIN public.settings s ON s.org_id = e.org_id
  WHERE lower(e.slug) = lower(p_slug) AND e.is_active
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.store_iva_config IS
  'Configuración de IVA de la tienda, para la leyenda del checkout. Devuelve sólo si está habilitado, la alícuota y si los precios lo incluyen — nada de la configuración impositiva interna.';

REVOKE ALL ON FUNCTION public.store_iva_config(text) FROM public;
GRANT EXECUTE ON FUNCTION public.store_iva_config(text) TO anon, authenticated;

-- ── Control ──────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.ordenes_sin_iva
WITH (security_invoker = true) AS
SELECT o.org_id, o.id, o.order_number, o.created_at, o.total, o.tax_amount
FROM public.ecommerce_orders o
JOIN public.settings s ON s.org_id = o.org_id
WHERE COALESCE(s.tax_enabled, false)
  AND COALESCE(s.tax_iva_percent, 0) > 0
  AND COALESCE(o.tax_amount, 0) = 0
  AND o.total > 0;

COMMENT ON VIEW public.ordenes_sin_iva IS
  'Órdenes de una organización que factura con IVA y que quedaron sin discriminarlo. Cada fila es una orden que no se puede facturar. Las anteriores a esta migración van a aparecer acá hasta que se recalculen.';

GRANT SELECT ON public.ordenes_sin_iva TO authenticated;

-- ── Recalcular lo viejo ──────────────────────────────────────────────────
--
-- Las 6 órdenes existentes quedaron con IVA cero. Se recalculan con la misma
-- función, no con un UPDATE a mano: si la cuenta cambia alguna vez, hay un solo
-- lugar donde cambiarla.
--
-- Es seguro: sólo toca `tax_amount`, que hoy es 0 en todas, y no mueve totales
-- ni stock.
UPDATE public.ecommerce_orders o
   SET tax_amount = (public.desglosar_iva(
         o.total,
         COALESCE(s.tax_iva_percent, 0),
         COALESCE(s.tax_prices_include_iva, true)
       )->>'iva')::numeric
  FROM public.settings s
 WHERE s.org_id = o.org_id
   AND COALESCE(s.tax_enabled, false)
   AND COALESCE(s.tax_iva_percent, 0) > 0
   AND COALESCE(o.tax_amount, 0) = 0
   AND o.total > 0;
