-- A9 — el redondeo deja de ser una convención implícita.
--
-- ── El problema, que hoy no se ve ────────────────────────────────────────
--
-- Hay `round(x, 2)` repartido por toda la base y `Math.round` por todo el
-- cliente. Mientras la única moneda sea el peso funciona de casualidad: dos
-- decimales es lo correcto para ARS. El día que la tienda cotice en otra
-- moneda, ese literal `2` pasa a estar mal en la mitad de los casos — el peso
-- chileno y el guaraní no tienen centavos, y facturar "1.234,56 CLP" no es un
-- detalle estético: es un importe que no existe.
--
-- B6 (multi-moneda) depende de esto, y por eso va antes.
--
-- ── Qué se declara ───────────────────────────────────────────────────────
--
-- **Los decimales los define la moneda, no quien llama.** `decimales_de_moneda`
-- es la única fuente. Agregar una moneda es editar esa lista, no buscar los
-- `round(x, 2)` del sistema.
--
-- **El modo es media unidad hacia arriba** (`0,005 → 0,01`), que es lo que ya
-- hacía `round()` sobre `numeric` y lo que espera cualquiera que revise una
-- factura a mano. Se deja escrito porque no es universal: `round()` sobre
-- `double precision` en Postgres redondea al par más cercano —"banquero"— y
-- daría `0,00` para el mismo caso. Todo el dinero de este sistema es `numeric`
-- justamente para no caer ahí, y esta función lo fuerza con un cast explícito
-- para que no dependa de qué tipo le llegue.
--
-- **Una moneda desconocida cae en 2, no falla.** Un pedido no se puede caer
-- porque alguien escribió mal el código de moneda; 2 decimales es el caso
-- mayoritario y el error queda acotado a la presentación.
--
-- Espejo de src/lib/rounding.ts. Si se toca una, se toca la otra.
--
-- Idempotente.

-- ── Cuántos decimales tiene cada moneda ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.decimales_de_moneda(p_moneda text)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE upper(btrim(COALESCE(p_moneda, 'ARS')))
           -- Sin subdivisión en uso: un importe con centavos no existe.
           WHEN 'CLP' THEN 0
           WHEN 'PYG' THEN 0
           WHEN 'JPY' THEN 0
           WHEN 'KRW' THEN 0
           WHEN 'COP' THEN 0
           WHEN 'ISK' THEN 0
           WHEN 'VND' THEN 0
           -- ARS, USD, EUR, BRL, UYU, PEN, MXN y el resto.
           ELSE 2
         END;
$$;

COMMENT ON FUNCTION public.decimales_de_moneda IS
  'Decimales con los que se expresa cada moneda. Unica fuente: agregar una moneda es editar esta lista. Espejo de decimalesDeMoneda() en src/lib/rounding.ts.';

-- ── Redondear un importe según su moneda ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.redondear_moneda(
  p_importe numeric,
  p_moneda  text DEFAULT 'ARS'
) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  -- El cast a numeric no es decorativo: sobre double precision, round()
  -- redondea al par mas cercano y 0,005 daria 0,00.
  SELECT round(COALESCE(p_importe, 0)::numeric, public.decimales_de_moneda(p_moneda));
$$;

COMMENT ON FUNCTION public.redondear_moneda IS
  'Redondea un importe con los decimales de su moneda, media unidad hacia arriba. Espejo de redondearMoneda() en src/lib/rounding.ts.';

-- ── Repartir un total entre partes sin que se pierda un centavo ──────────
--
-- Prorratear y redondear cada parte por separado casi nunca suma el total: con
-- tres partes iguales de $100 quedan $33,33 y falta un centavo. La regla
-- declarada es que **el resto va a la ultima parte**, para que la suma cierre
-- exactamente. Cual parte se lleva el resto es arbitrario; que la suma cierre,
-- no.
CREATE OR REPLACE FUNCTION public.prorratear(
  p_total  numeric,
  p_pesos  numeric[],
  p_moneda text DEFAULT 'ARS'
) RETURNS numeric[] LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_suma    numeric := 0;
  v_out     numeric[] := '{}';
  v_acum    numeric := 0;
  v_n       int;
  v_i       int;
  v_parte   numeric;
BEGIN
  v_n := COALESCE(array_length(p_pesos, 1), 0);
  IF v_n = 0 THEN RETURN '{}'; END IF;

  SELECT COALESCE(sum(GREATEST(x, 0)), 0) INTO v_suma FROM unnest(p_pesos) AS x;

  -- Sin pesos positivos se reparte en partes iguales: devolver ceros escondería
  -- el importe en vez de distribuirlo.
  IF v_suma <= 0 THEN
    FOR v_i IN 1..v_n LOOP
      v_parte := CASE WHEN v_i = v_n
                      THEN public.redondear_moneda(p_total, p_moneda) - v_acum
                      ELSE public.redondear_moneda(p_total / v_n, p_moneda) END;
      v_out := v_out || v_parte;
      v_acum := v_acum + v_parte;
    END LOOP;
    RETURN v_out;
  END IF;

  FOR v_i IN 1..v_n LOOP
    IF v_i = v_n THEN
      v_parte := public.redondear_moneda(p_total, p_moneda) - v_acum;
    ELSE
      v_parte := public.redondear_moneda(
        p_total * GREATEST(p_pesos[v_i], 0) / v_suma, p_moneda);
    END IF;
    v_out := v_out || v_parte;
    v_acum := v_acum + v_parte;
  END LOOP;

  RETURN v_out;
END;
$$;

COMMENT ON FUNCTION public.prorratear IS
  'Reparte un total en partes proporcionales cuya suma es exactamente el total: el resto del redondeo va a la ultima parte. Espejo de prorratear() en src/lib/rounding.ts.';

-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación
-- ═══════════════════════════════════════════════════════════════════════════
DO $verif$
DECLARE
  v_partes numeric[];
BEGIN
  ASSERT public.decimales_de_moneda('ARS') = 2, 'ARS deberia tener 2 decimales';
  ASSERT public.decimales_de_moneda('clp') = 0, 'CLP no tiene centavos';
  ASSERT public.decimales_de_moneda(NULL)  = 2, 'sin moneda se asume ARS';
  ASSERT public.decimales_de_moneda('XXX') = 2, 'moneda desconocida cae en 2';

  -- Media unidad hacia arriba, no al par: es la diferencia con double precision.
  ASSERT public.redondear_moneda(0.005, 'ARS') = 0.01,
    format('0,005 deberia dar 0,01 y dio %s', public.redondear_moneda(0.005, 'ARS'));
  ASSERT public.redondear_moneda(0.015, 'ARS') = 0.02,
    format('0,015 deberia dar 0,02 y dio %s', public.redondear_moneda(0.015, 'ARS'));
  ASSERT public.redondear_moneda(1234.56, 'CLP') = 1235, 'CLP redondea a entero';
  ASSERT public.redondear_moneda(NULL, 'ARS') = 0, 'NULL es 0, no NULL';

  -- Lo que importa del prorrateo: la suma cierra exactamente.
  v_partes := public.prorratear(100, ARRAY[1,1,1]::numeric[], 'ARS');
  ASSERT (SELECT sum(x) FROM unnest(v_partes) x) = 100,
    format('tres partes de 100 suman %s', (SELECT sum(x) FROM unnest(v_partes) x));

  v_partes := public.prorratear(1000, ARRAY[3,7]::numeric[], 'ARS');
  ASSERT v_partes[1] = 300 AND v_partes[2] = 700, 'proporcion 3:7 mal repartida';

  v_partes := public.prorratear(0.03, ARRAY[1,1,1]::numeric[], 'ARS');
  ASSERT (SELECT sum(x) FROM unnest(v_partes) x) = 0.03, 'centavos mal repartidos';

  v_partes := public.prorratear(100, ARRAY[0,0]::numeric[], 'ARS');
  ASSERT (SELECT sum(x) FROM unnest(v_partes) x) = 100,
    'sin pesos positivos el total no se puede perder';

  RAISE NOTICE 'A9 OK: redondeo declarado y prorrateo que cierra';
END;
$verif$;
