-- ═══════════════════════════════════════════════════════════════════════════
-- Métricas de inventario: la matemática que faltaba y la que estaba mal
--
-- `run_abc_analysis` venía calculando algo desde hace meses. Auditado contra los
-- datos reales de esta organización, daba números sin información.
--
-- ── 1. División entera ────────────────────────────────────────────────────
--
--     total_units / NULLIF(p_period_days, 0)
--
-- Los dos son `int`, así que Postgres **trunca**. Verificado: `5 / 90 = 0` y
-- `179 / 90 = 1`. Todos los productos de esta organización venden entre 0,011 y
-- 0,022 por día, así que la cuenta daba **cero para los 60** y los 16 analizados
-- quedaron clasificados `slow`. Una clasificación donde todo cae en la misma
-- clase no clasifica nada.
--
-- ── 2. Seis columnas decorativas ──────────────────────────────────────────
--
-- `reorder_point`, `safety_stock`, `eoq`, `days_on_hand`, `stockout_risk` y
-- `xyz_class` existen en la tabla desde que se creó y la función **nunca las
-- escribía**: NULL en las 16 filas. Es el mismo patrón que ya apareció tres
-- veces en este repo — estructura sin sustancia, que se ve completa hasta que
-- alguien la mira.
--
-- ── 3. Umbrales absolutos que no aplican ──────────────────────────────────
--
-- "Rápido = 2 unidades por día" es razonable en un kiosco y absurdo importando
-- perfumes, donde vender 20 por mes es un éxito. Ahora la velocidad se mide con
-- **días de cobertura**, que es adimensional: cuántos días aguanta el stock al
-- ritmo actual significa lo mismo en cualquier rubro.
--
-- ── 4. Se filtraba por `created_at` en vez de `date` ──────────────────────
--
-- `sales.date` es la fecha del negocio y `created_at` la de carga. Hay 12 ventas
-- donde difieren, así que el período analizado no era el que se pedía. El resto
-- del sistema usa `date`.
--
-- ── La regla que ordena todo ──────────────────────────────────────────────
--
-- **Lo que no se puede calcular queda en NULL, no en un número plausible.** Hoy
-- no hay un solo lead time cargado —`forecast_configs` y `vendor_catalog_items`
-- están vacías— así que el punto de reposición y el stock de seguridad van a
-- salir NULL. Es correcto: sin saber cuánto tarda el proveedor, ese número no
-- existe. Se llenan solos el día que se configure uno.
--
-- Espejo de `src/lib/stockMetrics.ts`, que tiene 32 tests. Si se toca una
-- cuenta, se toca la otra.
-- ═══════════════════════════════════════════════════════════════════════════

-- Dónde se configuran los parámetros que hoy no existen. Sin esto no hay forma
-- de calcular lote óptimo sin inventar los costos.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS lead_time_days integer;

COMMENT ON COLUMN public.products.lead_time_days IS
  'Días que tarda el proveedor en entregar. Sin esto no hay punto de reposición: el número no existe, y suponer 7 días es la clase de dato que después se usa para comprar.';

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS costo_por_pedido numeric,
  ADD COLUMN IF NOT EXISTS costo_almacenamiento_anual_pct numeric;

COMMENT ON COLUMN public.settings.costo_por_pedido IS
  'Costo administrativo de emitir una orden de compra. Entra en el lote óptimo (Wilson). Sin esto el EOQ queda NULL a propósito.';
COMMENT ON COLUMN public.settings.costo_almacenamiento_anual_pct IS
  'Costo anual de mantener stock, como % del costo del producto. Junto con costo_por_pedido habilita el lote óptimo.';

-- ⚠️ Las seis columnas eran NOT NULL con default `0` y `'low'`, y la función
-- nunca las escribía. O sea que **no estaban vacías: estaban llenas de mentiras
-- con cara de dato**. Verificado en las 16 filas:
--
--     stockout_risk  reorder_point  safety_stock  eoq  days_on_hand
--     low            0              0             0    0.00
--
-- Productos con **stock 0** figuraban con `stockout_risk = 'low'` — el sistema
-- informaba "riesgo bajo de quiebre" de mercadería ya agotada. Y en la misma
-- fila `days_on_hand = 0` decía lo contrario. Un default silencioso es peor que
-- un NULL: el NULL se ve, el default se usa.
--
-- Se afloja el NOT NULL en las seis para que lo que no se puede calcular quede
-- en NULL. Un producto sin stock no tiene velocidad ni cobertura; sin lead time
-- no hay punto de reposición. Eso tiene que poder representarse.
ALTER TABLE public.inventory_abc
  ALTER COLUMN velocity      DROP NOT NULL,
  ALTER COLUMN reorder_point DROP NOT NULL,
  ALTER COLUMN safety_stock  DROP NOT NULL,
  ALTER COLUMN eoq           DROP NOT NULL,
  ALTER COLUMN days_on_hand  DROP NOT NULL,
  ALTER COLUMN stockout_risk DROP NOT NULL;

-- Y se sacan los defaults, que son los que rellenaban el hueco en silencio.
ALTER TABLE public.inventory_abc
  ALTER COLUMN velocity      DROP DEFAULT,
  ALTER COLUMN reorder_point DROP DEFAULT,
  ALTER COLUMN safety_stock  DROP DEFAULT,
  ALTER COLUMN eoq           DROP DEFAULT,
  ALTER COLUMN days_on_hand  DROP DEFAULT,
  ALTER COLUMN stockout_risk DROP DEFAULT;

COMMENT ON COLUMN public.inventory_abc.velocity IS
  'Velocidad por días de cobertura: rapido <30, normal <90, lento <365, muerto >=365. NULL cuando el producto no tiene stock — ahí la cobertura no está definida.';

-- Los CHECK traían el vocabulario viejo en inglés ('fast'/'medium'/'slow' y
-- 'critical'/'high'/...). La semántica cambió —velocidad ahora se mide por
-- cobertura, no por unidades por día— así que las etiquetas cambian con ella.
-- Ninguna pantalla lee estas columnas hoy, así que no rompe nada; los matches de
-- "velocity" en la UI son de otros módulos con su propio cálculo.
ALTER TABLE public.inventory_abc DROP CONSTRAINT IF EXISTS inventory_abc_velocity_check;
ALTER TABLE public.inventory_abc DROP CONSTRAINT IF EXISTS inventory_abc_stockout_risk_check;

-- Las filas viejas tienen el vocabulario anterior y valores que no significan
-- nada: todas 'slow' por la división entera, todas 'low' por el default. Se
-- borran ANTES de poner la restricción nueva —si no, la restricción no se puede
-- crear— y se borran en vez de traducirse: traducir un dato equivocado lo
-- perpetúa con otra etiqueta.
DELETE FROM public.inventory_abc
 WHERE velocity IN ('fast','medium','slow','dead')
    OR stockout_risk IN ('critical','high','medium','low');

ALTER TABLE public.inventory_abc
  ADD CONSTRAINT inventory_abc_velocity_check
  CHECK (velocity IS NULL OR velocity IN ('rapido', 'normal', 'lento', 'muerto'));

ALTER TABLE public.inventory_abc
  ADD CONSTRAINT inventory_abc_stockout_risk_check
  CHECK (stockout_risk IS NULL OR stockout_risk IN ('quebrado', 'critico', 'atencion', 'ok'));

-- ── Z de la normal, para el stock de seguridad ───────────────────────────
CREATE OR REPLACE FUNCTION public.z_nivel_servicio(p_nivel numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE round(COALESCE(p_nivel, 95))
    WHEN 90 THEN 1.28 WHEN 95 THEN 1.65
    WHEN 98 THEN 2.05 WHEN 99 THEN 2.33
    ELSE NULL END;
$$;

COMMENT ON FUNCTION public.z_nivel_servicio IS
  'Z de la distribución normal para los niveles de servicio que se usan en la práctica. NULL para un nivel no soportado: interpolar sin saber es inventar.';

-- ── El análisis, con la matemática correcta ──────────────────────────────
CREATE OR REPLACE FUNCTION public.run_abc_analysis(p_org_id uuid, p_period_days int DEFAULT 90)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total_revenue numeric;
  v_count         int := 0;
  v_costo_pedido  numeric;
  v_costo_alm_pct numeric;
  v_nivel         numeric := 95;
BEGIN
  IF NOT public.is_org_member(p_org_id, auth.uid()) THEN
    RAISE EXCEPTION 'Sin permiso sobre esta organización' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT s.costo_por_pedido, s.costo_almacenamiento_anual_pct
    INTO v_costo_pedido, v_costo_alm_pct
    FROM public.settings s WHERE s.org_id = p_org_id LIMIT 1;

  -- `date`, no `created_at`: la primera es la fecha del negocio.
  SELECT COALESCE(SUM(total_ars), 0) INTO v_total_revenue
  FROM public.sales
  WHERE org_id = p_org_id
    AND date >= now() - (p_period_days || ' days')::interval;

  WITH product_stats AS (
    SELECT s.product_id,
           SUM(s.total_ars)          AS total_revenue,
           SUM(s.quantity)::numeric  AS total_units,
           COUNT(*)                  AS total_orders,
           -- Serie mensual para medir variabilidad. Con menos de 3 meses el
           -- desvío no significa nada y el CV queda NULL.
           COUNT(DISTINCT date_trunc('month', s.date)) AS meses,
           stddev_pop(m.unidades)    AS desvio_mensual,
           avg(m.unidades)           AS promedio_mensual
    FROM public.sales s
    LEFT JOIN LATERAL (
      SELECT sum(s2.quantity)::numeric AS unidades
      FROM public.sales s2
      WHERE s2.product_id = s.product_id AND s2.org_id = s.org_id
        AND s2.date >= now() - (p_period_days || ' days')::interval
      GROUP BY date_trunc('month', s2.date)
    ) m ON true
    WHERE s.org_id = p_org_id
      AND s.date >= now() - (p_period_days || ' days')::interval
      AND s.product_id IS NOT NULL
    GROUP BY s.product_id
  ),
  ranked AS (
    SELECT ps.*,
      ROUND((ps.total_revenue / NULLIF(v_total_revenue, 0)) * 100, 3) AS revenue_pct,
      ROUND(SUM(ps.total_revenue / NULLIF(v_total_revenue, 0) * 100)
        OVER (ORDER BY ps.total_revenue DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW), 3) AS cumulative_pct
    FROM product_stats ps
  ),
  calculado AS (
    SELECT r.*,
      p.stock,
      p.lead_time_days,
      COALESCE(p.total_cost_usd, 0) AS costo_unitario,
      -- ⚠️ La división que estaba en enteros. `total_units` ya viene numeric.
      r.total_units / NULLIF(p_period_days, 0)::numeric AS por_dia,
      -- Coeficiente de variación: NULL con menos de 3 meses.
      CASE WHEN r.meses >= 3 AND COALESCE(r.promedio_mensual, 0) > 0
           THEN r.desvio_mensual / r.promedio_mensual
           ELSE NULL END AS cv
    FROM ranked r
    JOIN public.products p ON p.id = r.product_id
  ),
  final AS (
    SELECT c.*,
      -- Días de cobertura: NULL sin ventas, porque "alcanza para siempre" no es
      -- un número y un 9999 se termina graficando.
      CASE WHEN c.por_dia > 0 THEN round(c.stock / c.por_dia, 1) ELSE NULL END AS cobertura,
      -- Desvío diario derivado del CV, para el stock de seguridad.
      CASE WHEN c.cv IS NOT NULL AND c.por_dia > 0 THEN c.cv * c.por_dia ELSE NULL END AS desvio_diario
    FROM calculado c
  )
  INSERT INTO public.inventory_abc (
    org_id, product_id, analysis_date, period_days,
    total_revenue, total_units, total_orders,
    revenue_pct, cumulative_pct,
    abc_class, xyz_class, velocity,
    days_on_hand, safety_stock, reorder_point, eoq, stockout_risk
  )
  SELECT
    p_org_id, f.product_id, CURRENT_DATE, p_period_days,
    f.total_revenue, f.total_units::int, f.total_orders,
    f.revenue_pct, f.cumulative_pct,
    CASE WHEN f.cumulative_pct <= 80 THEN 'A'
         WHEN f.cumulative_pct <= 95 THEN 'B' ELSE 'C' END,
    -- XYZ por variabilidad de la demanda. NULL cuando no se puede medir.
    CASE WHEN f.cv IS NULL THEN NULL
         WHEN f.cv <= 0.5 THEN 'X'
         WHEN f.cv <= 1.0 THEN 'Y'
         ELSE 'Z' END,
    -- Velocidad por COBERTURA, no por unidades por día.
    CASE WHEN f.stock <= 0 THEN NULL
         WHEN f.cobertura IS NULL THEN 'muerto'
         WHEN f.cobertura <  30 THEN 'rapido'
         WHEN f.cobertura <  90 THEN 'normal'
         WHEN f.cobertura < 365 THEN 'lento'
         ELSE 'muerto' END,
    f.cobertura,
    -- Stock de seguridad = Z × σ × √L. La raíz no es un detalle: el desvío
    -- acumulado en L días crece con √L, y usar L de frente sobredimensiona el
    -- colchón, que es plata quieta.
    CASE WHEN f.desvio_diario IS NOT NULL AND f.lead_time_days > 0
         THEN ceil(public.z_nivel_servicio(v_nivel) * f.desvio_diario * sqrt(f.lead_time_days))::int
         ELSE NULL END,
    -- Punto de reposición = consumo del lead time + colchón. NULL sin lead time.
    CASE WHEN f.lead_time_days > 0
         THEN ceil(f.por_dia * f.lead_time_days +
              COALESCE(CASE WHEN f.desvio_diario IS NOT NULL
                            THEN public.z_nivel_servicio(v_nivel) * f.desvio_diario * sqrt(f.lead_time_days)
                            ELSE 0 END, 0))::int
         ELSE NULL END,
    -- Lote óptimo (Wilson). NULL sin los dos costos: con S y H puestos a ojo el
    -- número sale redondo, se ve serio y manda a comprar la cantidad equivocada.
    CASE WHEN v_costo_pedido > 0 AND v_costo_alm_pct > 0 AND f.costo_unitario > 0 AND f.por_dia > 0
         THEN ceil(sqrt((2 * (f.por_dia * 365) * v_costo_pedido)
                        / (f.costo_unitario * v_costo_alm_pct / 100)))::int
         ELSE NULL END,
    -- Riesgo: contra el punto de reposición si existe, si no contra la
    -- cobertura. Lo que no se hace es inventar el lead time para poder mostrar
    -- el número "bueno".
    CASE WHEN f.stock <= 0 THEN 'quebrado'
         WHEN f.lead_time_days > 0 THEN
           CASE WHEN f.stock <= f.por_dia * f.lead_time_days THEN 'critico'
                WHEN f.stock <= f.por_dia * f.lead_time_days * 1.5 THEN 'atencion'
                ELSE 'ok' END
         WHEN f.cobertura IS NULL THEN 'ok'
         WHEN f.cobertura < 15 THEN 'critico'
         WHEN f.cobertura < 30 THEN 'atencion'
         ELSE 'ok' END
  FROM final f
  ON CONFLICT (org_id, product_id, analysis_date)
  DO UPDATE SET
    total_revenue = EXCLUDED.total_revenue,
    total_units   = EXCLUDED.total_units,
    total_orders  = EXCLUDED.total_orders,
    revenue_pct   = EXCLUDED.revenue_pct,
    cumulative_pct = EXCLUDED.cumulative_pct,
    abc_class     = EXCLUDED.abc_class,
    xyz_class     = EXCLUDED.xyz_class,
    velocity      = EXCLUDED.velocity,
    days_on_hand  = EXCLUDED.days_on_hand,
    safety_stock  = EXCLUDED.safety_stock,
    reorder_point = EXCLUDED.reorder_point,
    eoq           = EXCLUDED.eoq,
    stockout_risk = EXCLUDED.stockout_risk;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.run_abc_analysis IS
  'Clasifica el catálogo por facturación (ABC) y variabilidad (XYZ), y calcula cobertura, punto de reposición, stock de seguridad y lote óptimo. Lo que no se puede calcular queda NULL: sin lead time no hay punto de reposición, sin costos no hay EOQ. Espejo de src/lib/stockMetrics.ts.';

REVOKE ALL ON FUNCTION public.run_abc_analysis(uuid, int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.run_abc_analysis(uuid, int) TO authenticated;

-- ── Lo que hay que mirar, en una vista ───────────────────────────────────
CREATE OR REPLACE VIEW public.stock_a_reponer
WITH (security_invoker = true) AS
SELECT a.org_id, a.product_id, p.name AS producto,
       p.stock, a.days_on_hand AS cobertura_dias,
       a.abc_class, a.xyz_class, a.velocity, a.stockout_risk,
       a.reorder_point, a.safety_stock, a.eoq,
       a.total_units AS vendidas_en_el_periodo,
       -- Cuánto falta para volver al punto de reposición. NULL cuando no hay
       -- punto de reposición: "comprá 20" sin lead time es una opinión.
       CASE WHEN a.reorder_point IS NOT NULL AND p.stock < a.reorder_point
            THEN a.reorder_point - p.stock + COALESCE(a.eoq, 0)
            ELSE NULL END AS sugerencia_compra
FROM public.inventory_abc a
JOIN public.products p ON p.id = a.product_id
WHERE a.analysis_date = (
        SELECT max(a2.analysis_date) FROM public.inventory_abc a2 WHERE a2.org_id = a.org_id)
  AND a.stockout_risk IN ('quebrado', 'critico', 'atencion');

COMMENT ON VIEW public.stock_a_reponer IS
  'Productos en riesgo de quiebre según el último análisis. Ordenar por abc_class: quedarse sin un producto A cuesta mucho más que sin uno C.';

GRANT SELECT ON public.stock_a_reponer TO authenticated;

CREATE OR REPLACE VIEW public.stock_inmovilizado
WITH (security_invoker = true) AS
SELECT a.org_id, a.product_id, p.name AS producto,
       p.stock, a.days_on_hand AS cobertura_dias, a.velocity, a.abc_class,
       p.stock * COALESCE(p.total_cost_usd, 0) AS capital_inmovilizado_usd,
       a.total_units AS vendidas_en_el_periodo
FROM public.inventory_abc a
JOIN public.products p ON p.id = a.product_id
WHERE a.analysis_date = (
        SELECT max(a2.analysis_date) FROM public.inventory_abc a2 WHERE a2.org_id = a.org_id)
  AND a.velocity IN ('lento', 'muerto')
  AND p.stock > 0;

COMMENT ON VIEW public.stock_inmovilizado IS
  'Mercadería que no rota: más de 90 días de cobertura y stock encima. Es la contracara de stock_a_reponer — plata quieta en el estante.';

GRANT SELECT ON public.stock_inmovilizado TO authenticated;
