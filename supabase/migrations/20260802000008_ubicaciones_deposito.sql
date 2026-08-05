-- ═══════════════════════════════════════════════════════════════════════════
-- Ubicaciones dentro del depósito: zonas, posiciones y picking
--
-- Es el eslabón que convierte "stock por sucursal" en "stock por posición":
-- saber que hay 12 unidades en la sucursal Centro no ayuda a nadie a buscarlas
-- si el depósito tiene diez estanterías.
--
-- ── Dos problemas que había que resolver antes de construir encima ────────
--
-- **1. El lugar físico estaba modelado dos veces.** `locations` (sucursales) y
-- `warehouses` (depósitos) tienen las mismas columnas —nombre, dirección,
-- teléfono, activo, principal— y ningún vínculo entre sí. El stock vive en
-- `location_stock`; las posiciones colgaban de `warehouses`. O sea que
-- `bin_stock` y `location_stock` hablaban de lugares distintos y no había forma
-- de que cerraran.
--
-- Las cuatro tablas están en cero y las usa un solo componente, así que se
-- unifica ahora: **zonas y posiciones cuelgan de `locations`**, que es lo que
-- el resto del sistema ya usa. `warehouses` queda huérfana y anotada para
-- borrar; no se dropea en esta migración para que el cambio sea reversible.
--
-- **2. `bin_stock` se escribía desde el navegador.** `WarehouseZonesTab` hacía
-- un `upsert` directo, sin validar contra lo que hay. Es exactamente el patrón
-- que hizo que una transferencia entre sucursales inventara 40 unidades: sin
-- control, se pueden cargar 500 unidades en una posición de un producto del que
-- hay 10.
--
-- ── El invariante ────────────────────────────────────────────────────────
--
--   products.stock            total de la organización
--     └─ location_stock       cuánto hay en cada sucursal
--         └─ bin_stock        en qué posición está, dentro de esa sucursal
--
-- La suma de las posiciones de una sucursal **nunca** puede superar el stock de
-- esa sucursal. Puede ser menor: mercadería recién recibida que todavía no se
-- guardó en ningún lado es un estado real y hay que poder representarlo.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Zonas y posiciones cuelgan de la sucursal ────────────────────────────
ALTER TABLE public.warehouse_zones
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id) ON DELETE CASCADE;

ALTER TABLE public.warehouse_bins
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id) ON DELETE CASCADE;

-- `warehouse_id` era NOT NULL. Se afloja en vez de borrarse: las tablas están
-- vacías, pero dejar la columna permite volver atrás sin perder nada.
ALTER TABLE public.warehouse_zones  ALTER COLUMN warehouse_id DROP NOT NULL;
ALTER TABLE public.warehouse_bins   ALTER COLUMN warehouse_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_zones_location ON public.warehouse_zones(location_id) WHERE location_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bins_location  ON public.warehouse_bins(location_id)  WHERE location_id IS NOT NULL;

COMMENT ON COLUMN public.warehouse_zones.location_id IS
  'Sucursal a la que pertenece la zona. Reemplaza a warehouse_id: `locations` es el lugar físico que usa el resto del sistema, y `warehouses` lo duplicaba sin vincularse al stock.';

-- El orden de recorrido dentro de la sucursal. Sin esto, armar un pedido de
-- cinco productos manda a la persona a cruzar el depósito cinco veces.
ALTER TABLE public.warehouse_bins
  ADD COLUMN IF NOT EXISTS pick_order integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.warehouse_bins.pick_order IS
  'Posición en la ruta de picking. Menor = se visita antes. Empatados, ordena por código.';

-- ── Escribir una posición, con validación ────────────────────────────────
--
-- Reemplaza al `upsert` que hacía la pantalla. Valida tres cosas que el cliente
-- no puede garantizar: que la posición sea de la organización, que la cantidad
-- no sea negativa, y —la que importa— que las posiciones de esa sucursal no
-- sumen más de lo que la sucursal tiene.
CREATE OR REPLACE FUNCTION public.asignar_a_ubicacion(
  p_bin_id     uuid,
  p_product_id uuid,
  p_cantidad   numeric
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org      uuid;
  v_user     uuid := auth.uid();
  v_location uuid;
  v_nombre   text;
  v_en_sucursal numeric;
  v_otras    numeric;
BEGIN
  IF p_cantidad IS NULL OR p_cantidad < 0 THEN
    RAISE EXCEPTION 'La cantidad no puede ser negativa'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT b.org_id, b.location_id INTO v_org, v_location
    FROM public.warehouse_bins b WHERE b.id = p_bin_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'La posición no existe' USING ERRCODE = 'no_data_found';
  END IF;

  -- SECURITY DEFINER saltea la RLS: el control de acceso es esta línea.
  IF NOT public.is_org_member(v_org, v_user) THEN
    RAISE EXCEPTION 'Sin permiso sobre esta posición' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_location IS NULL THEN
    RAISE EXCEPTION 'La posición no está asignada a ninguna sucursal'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT p.name INTO v_nombre FROM public.products p
   WHERE p.id = p_product_id AND p.org_id = v_org;
  IF v_nombre IS NULL THEN
    RAISE EXCEPTION 'El producto no existe en esta organización'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Cuánto tiene la sucursal de ese producto.
  SELECT COALESCE(ls.stock, 0) INTO v_en_sucursal
    FROM public.location_stock ls
   WHERE ls.location_id = v_location AND ls.product_id = p_product_id;

  -- Cuánto ya está guardado en OTRAS posiciones de la misma sucursal.
  SELECT COALESCE(sum(bs.quantity), 0) INTO v_otras
    FROM public.bin_stock bs
    JOIN public.warehouse_bins b ON b.id = bs.bin_id
   WHERE b.location_id = v_location
     AND bs.product_id = p_product_id
     AND bs.bin_id <> p_bin_id;

  IF v_otras + p_cantidad > COALESCE(v_en_sucursal, 0) THEN
    RAISE EXCEPTION
      'En esa sucursal hay % unidades de "%" y ya hay % ubicadas: no se pueden poner % más',
      COALESCE(v_en_sucursal, 0), v_nombre, v_otras, p_cantidad
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_cantidad = 0 THEN
    -- Cero es "sacar de esta posición", no una fila con cero.
    DELETE FROM public.bin_stock WHERE bin_id = p_bin_id AND product_id = p_product_id;
  ELSE
    INSERT INTO public.bin_stock (org_id, bin_id, product_id, quantity, updated_at)
    VALUES (v_org, p_bin_id, p_product_id, p_cantidad, now())
    ON CONFLICT (bin_id, product_id) DO UPDATE
      SET quantity = EXCLUDED.quantity, updated_at = now();
  END IF;

  RETURN jsonb_build_object(
    'producto', v_nombre,
    'en_sucursal', COALESCE(v_en_sucursal, 0),
    'ubicado', v_otras + p_cantidad,
    'sin_ubicar', COALESCE(v_en_sucursal, 0) - (v_otras + p_cantidad)
  );
END;
$$;

COMMENT ON FUNCTION public.asignar_a_ubicacion IS
  'Escribe bin_stock validando que las posiciones de la sucursal no sumen más de lo que la sucursal tiene. Reemplaza el upsert directo desde el navegador, que permitía ubicar 500 unidades de un producto del que hay 10.';

REVOKE ALL ON FUNCTION public.asignar_a_ubicacion(uuid, uuid, numeric) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.asignar_a_ubicacion(uuid, uuid, numeric) TO authenticated;

-- `bin_stock` deja de escribirse desde la UI, igual que `location_stock`.
--
-- ⚠️ Se dropea **por permisividad, no por nombre**. La primera versión de esta
-- migración listaba dos nombres a mano y la verificación la agarró: quedaba viva
-- una tercera policy, `org_bin_stock`, con `ALL`, así que el navegador seguía
-- pudiendo escribir. Es el mismo error que ya había dejado sobrevivir una fuga
-- entre organizaciones — las policies se recrean con nombres distintos y una
-- lista a mano siempre se queda corta.
DO $limpiar$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT pol.polname
    FROM pg_policy pol
    WHERE pol.polrelid = 'public.bin_stock'::regclass
      -- Todo lo que no sea exclusivamente SELECT: 'r' es SELECT.
      AND pol.polcmd <> 'r'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.bin_stock', r.polname);
    RAISE NOTICE 'policy de escritura eliminada: %', r.polname;
  END LOOP;
END
$limpiar$;

DO $pol$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy WHERE polrelid = 'public.bin_stock'::regclass
      AND polname = 'bin_stock_org_read'
  ) THEN
    CREATE POLICY bin_stock_org_read ON public.bin_stock
      FOR SELECT USING (public.is_org_member(org_id, auth.uid()));
  END IF;
END
$pol$;

COMMENT ON TABLE public.bin_stock IS
  'Stock por posición dentro de una sucursal. Sólo lectura desde la UI: lo escribe asignar_a_ubicacion(), que valida contra location_stock. La suma de las posiciones de una sucursal nunca puede superar el stock de esa sucursal.';

-- Necesario para el ON CONFLICT de arriba.
CREATE UNIQUE INDEX IF NOT EXISTS bin_stock_bin_product_key
  ON public.bin_stock(bin_id, product_id);

-- ── Dónde buscar cada producto, y en qué orden ───────────────────────────
--
-- Devuelve las posiciones de una sucursal que tienen un producto, ordenadas por
-- la ruta de picking. Es lo que evita cruzar el depósito una vez por renglón.
CREATE OR REPLACE FUNCTION public.ruta_de_picking(
  p_location_id uuid,
  p_items       jsonb
)
RETURNS TABLE (
  product_id   uuid,
  producto     text,
  bin_id       uuid,
  posicion     text,
  zona         text,
  disponible   numeric,
  a_tomar      numeric,
  pick_order   integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid;
BEGIN
  SELECT l.org_id INTO v_org FROM public.locations l WHERE l.id = p_location_id;
  IF v_org IS NULL OR NOT public.is_org_member(v_org, auth.uid()) THEN
    RAISE EXCEPTION 'Sin permiso sobre esa sucursal' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  WITH pedido AS (
    SELECT (x->>'product_id')::uuid AS pid,
           GREATEST(0, COALESCE((x->>'quantity')::numeric, 0)) AS qty
    FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) x
  ),
  -- Se acumula por posición siguiendo la ruta: la primera posición aporta lo
  -- que tiene, la siguiente completa el resto. Así el pedido se arma en un solo
  -- recorrido en vez de volver por lo que faltó.
  posiciones AS (
    SELECT p.pid, bs.bin_id, bs.quantity,
           b.code, b.pick_order,
           z.name AS zona,
           sum(bs.quantity) OVER (
             PARTITION BY p.pid ORDER BY b.pick_order, b.code
             ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
           ) AS acumulado_antes,
           p.qty
    FROM pedido p
    JOIN public.bin_stock bs ON bs.product_id = p.pid
    JOIN public.warehouse_bins b ON b.id = bs.bin_id AND b.location_id = p_location_id
    LEFT JOIN public.warehouse_zones z ON z.id = b.zone_id
    WHERE bs.quantity > 0
  )
  SELECT
    po.pid,
    pr.name,
    po.bin_id,
    po.code,
    COALESCE(po.zona, 'Sin zona'),
    po.quantity,
    LEAST(po.quantity, GREATEST(0, po.qty - COALESCE(po.acumulado_antes, 0))),
    po.pick_order
  FROM posiciones po
  JOIN public.products pr ON pr.id = po.pid
  -- Se descartan las posiciones que ya no hacen falta: si las dos primeras
  -- cubren el pedido, la tercera no se visita.
  WHERE GREATEST(0, po.qty - COALESCE(po.acumulado_antes, 0)) > 0
  ORDER BY po.pick_order, po.code;
END;
$$;

COMMENT ON FUNCTION public.ruta_de_picking IS
  'Qué posiciones visitar y cuánto tomar de cada una para armar un pedido, ordenadas por la ruta del depósito. Descarta las posiciones que ya no hacen falta una vez cubierta la cantidad.';

REVOKE ALL ON FUNCTION public.ruta_de_picking(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ruta_de_picking(uuid, jsonb) TO authenticated;

-- ── Controles ────────────────────────────────────────────────────────────
--
-- Dos vistas, porque son dos preguntas distintas y las dos importan.

-- 1. ¿Hay más ubicado que existente? Nunca debería pasar; una fila acá es
--    mercadería inventada.
CREATE OR REPLACE VIEW public.ubicaciones_descuadradas
WITH (security_invoker = true) AS
SELECT b.location_id, l.name AS sucursal, bs.product_id, p.name AS producto,
       sum(bs.quantity)              AS ubicado,
       COALESCE(max(ls.stock), 0)    AS en_sucursal,
       sum(bs.quantity) - COALESCE(max(ls.stock), 0) AS de_mas
FROM public.bin_stock bs
JOIN public.warehouse_bins b ON b.id = bs.bin_id
JOIN public.locations l ON l.id = b.location_id
JOIN public.products p ON p.id = bs.product_id
LEFT JOIN public.location_stock ls
       ON ls.location_id = b.location_id AND ls.product_id = bs.product_id
GROUP BY b.location_id, l.name, bs.product_id, p.name
HAVING sum(bs.quantity) > COALESCE(max(ls.stock), 0);

COMMENT ON VIEW public.ubicaciones_descuadradas IS
  'Productos con más unidades ubicadas que existentes en la sucursal. Tiene que estar vacía: una fila es mercadería que el sistema cree tener en una estantería y no tiene.';

-- 2. ¿Qué hay en la sucursal sin guardar en ninguna posición? No es un error
--    —mercadería recién recibida está así— pero es lo que hay que ubicar.
CREATE OR REPLACE VIEW public.stock_sin_ubicar
WITH (security_invoker = true) AS
SELECT ls.location_id, l.name AS sucursal, ls.product_id, p.name AS producto,
       ls.stock AS en_sucursal,
       COALESCE((SELECT sum(bs.quantity)
                   FROM public.bin_stock bs
                   JOIN public.warehouse_bins b ON b.id = bs.bin_id
                  WHERE b.location_id = ls.location_id AND bs.product_id = ls.product_id), 0) AS ubicado,
       ls.stock - COALESCE((SELECT sum(bs.quantity)
                   FROM public.bin_stock bs
                   JOIN public.warehouse_bins b ON b.id = bs.bin_id
                  WHERE b.location_id = ls.location_id AND bs.product_id = ls.product_id), 0) AS sin_ubicar
FROM public.location_stock ls
JOIN public.locations l ON l.id = ls.location_id
JOIN public.products p ON p.id = ls.product_id
WHERE ls.stock > COALESCE((SELECT sum(bs.quantity)
                   FROM public.bin_stock bs
                   JOIN public.warehouse_bins b ON b.id = bs.bin_id
                  WHERE b.location_id = ls.location_id AND bs.product_id = ls.product_id), 0);

COMMENT ON VIEW public.stock_sin_ubicar IS
  'Mercadería que está en la sucursal pero todavía no se guardó en ninguna posición. No es un error: es la lista de lo que falta ubicar.';

GRANT SELECT ON public.ubicaciones_descuadradas TO authenticated;
GRANT SELECT ON public.stock_sin_ubicar TO authenticated;
