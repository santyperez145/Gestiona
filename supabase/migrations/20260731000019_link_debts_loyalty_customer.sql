-- ═══════════════════════════════════════════════════════════════════════════
-- Deudas y puntos de fidelidad también se vinculan al cliente por id
--
-- `sales` ya se vinculó en 20260731000016, pero el CRM cruza tres tablas por
-- `customer_name` en texto libre, no una: ventas, deudas y puntos. Migrar sólo
-- una deja la mitad de las pantallas mirando por id y la otra mitad por nombre,
-- que es peor que la fragilidad actual — al menos hoy es consistente.
--
-- Esta migración completa la base para las tres. La UI sigue leyendo por nombre
-- y no se rompe: la columna es adicional y nullable. Cuando se cambie el front,
-- el dato ya va a estar poblado y ese cambio pasa a ser sólo de lectura.
--
-- Es deuda que importa: una deuda mal atribuida es plata que se le reclama a
-- quien no la debe, y puntos mal atribuidos son un beneficio que se le da a
-- quien no lo ganó.
-- ═══════════════════════════════════════════════════════════════════════════

DO $migrar$
DECLARE
  t text;
  tablas text[] := ARRAY['debts', 'loyalty_points'];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    -- Sólo si la tabla existe y tiene con qué matchear
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'customer_name'
    ) THEN
      RAISE NOTICE 'Salteando %: no tiene customer_name', t;
      CONTINUE;
    END IF;

    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS customer_id uuid '
      'REFERENCES public.customers(id) ON DELETE SET NULL', t);

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_%s_customer ON public.%I(customer_id) '
      'WHERE customer_id IS NOT NULL', t, t);

    -- Mismo criterio de normalización que en `sales`: minúsculas, sin acentos,
    -- espacios colapsados. Si difiriera, un cliente quedaría vinculado en una
    -- tabla y no en la otra.
    EXECUTE format(
      'UPDATE public.%I x SET customer_id = c.id FROM public.customers c '
      'WHERE x.customer_id IS NULL AND c.org_id = x.org_id '
      'AND public.normalize_person_name(c.name) = public.normalize_person_name(x.customer_name)', t);

    RAISE NOTICE 'Vinculada %', t;
  END LOOP;
END
$migrar$;

-- ── Resolver el cliente al escribir ───────────────────────────────────────
-- Reutiliza la función de `sales`: es genérica, sólo lee NEW.org_id y
-- NEW.customer_name. Una sola implementación para las tres tablas.
DO $triggers$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['debts', 'loyalty_points'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'customer_id'
    ) THEN CONTINUE; END IF;

    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_link_customer ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_link_customer BEFORE INSERT OR UPDATE OF customer_name '
      'ON public.%I FOR EACH ROW EXECUTE FUNCTION public.trg_sales_link_customer()', t, t);
  END LOOP;
END
$triggers$;

COMMENT ON FUNCTION public.trg_sales_link_customer IS
  'Resuelve customer_id desde customer_name. Genérica: la usan sales, debts y loyalty_points. Respeta un customer_id ya provisto y deja null si no matchea, en vez de inventar un cliente.';
