-- ═══════════════════════════════════════════════════════════════════════════
-- Presupuestos y comunicaciones también se vinculan al cliente por id
--
-- Las últimas dos tablas del CRM que seguían cruzando por texto libre. El resto
-- del módulo ya lee por `customer_id` desde 20260731000016 (sales) y
-- 20260731000019 (debts, loyalty_points), así que la ficha mostraba el
-- historial de compras del cliente correcto y, al lado, presupuestos y
-- llamadas de "otro" — el mismo, escrito distinto.
--
-- Cómo cruzaba cada una, que no era ni siquiera consistente entre sí:
--
--   `quotes`                  → `.ilike("customer_name", nombre)`
--   `customer_communications` → `.eq("customer_name", nombre)`
--
-- El `.eq` es el peor de los dos: exacto y sensible a mayúsculas y tildes. Una
-- llamada registrada como "juan perez" no aparecía en la ficha de "Juan Pérez".
-- El `ilike` ignora mayúsculas pero no tildes, así que "Gomez" y "Gómez"
-- seguían siendo dos personas.
--
-- Lo que se pierde con eso no es cosmético. Un presupuesto que no se ve es
-- plata que no se va a cobrar porque nadie lo siguió, y un seguimiento pendiente
-- que no aparece en la ficha es un cliente al que nadie llama.
--
-- No hace falta función nueva: `trg_sales_link_customer` es genérica, sólo lee
-- `NEW.org_id` y `NEW.customer_name`, y las dos tablas tienen las dos columnas.
-- Una sola implementación para las cinco tablas.
-- ═══════════════════════════════════════════════════════════════════════════

DO $vincular$
DECLARE
  t      text;
  tablas text[] := ARRAY['quotes', 'customer_communications'];
  n      int;
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    -- Igual que en 20260731000019: si no hay con qué matchear, se saltea en vez
    -- de romper. La migración se corre más de una vez.
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

    -- Parcial: las filas sin vincular no entran al índice. Son las de gente que
    -- no está en el CRM y se cruzan por nombre, no por acá.
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_%s_customer ON public.%I(customer_id) '
      'WHERE customer_id IS NOT NULL', t, t);

    -- Mismo criterio de normalización que las otras tres tablas. Si difiriera,
    -- un cliente quedaría vinculado en `sales` y no en `quotes`, que es
    -- justamente la mitad-y-mitad que esta migración viene a terminar.
    EXECUTE format(
      'UPDATE public.%I x SET customer_id = c.id FROM public.customers c '
      'WHERE x.customer_id IS NULL AND c.org_id = x.org_id '
      'AND public.normalize_person_name(c.name) = public.normalize_person_name(x.customer_name)', t);
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'Vinculada %: % filas', t, n;

    -- El trigger cubre lo que se escriba de ahora en adelante, venga de donde
    -- venga. `quotes` se inserta desde tres lugares (PresupuestosPage, el
    -- asistente de IA y el kanban del pipeline); tocarlos uno por uno dejaría
    -- el cuarto sin cubrir.
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_link_customer ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_link_customer BEFORE INSERT OR UPDATE OF customer_name '
      'ON public.%I FOR EACH ROW EXECUTE FUNCTION public.trg_sales_link_customer()', t, t);
  END LOOP;
END
$vincular$;

COMMENT ON COLUMN public.quotes.customer_id IS
  'Cliente del CRM. Lo completa el trigger trg_quotes_link_customer desde customer_name. `customer_name` se conserva: es el nombre con el que se emitió el presupuesto y sirve de respaldo si el cliente se borra.';

COMMENT ON COLUMN public.customer_communications.customer_id IS
  'Cliente del CRM. Lo completa el trigger trg_customer_communications_link_customer desde customer_name.';

COMMENT ON FUNCTION public.trg_sales_link_customer IS
  'Resuelve customer_id desde customer_name. Genérica: la usan sales, debts, loyalty_points, quotes y customer_communications. En un renombre vuelve a resolver (la fusión de clientes depende de esto); si no, respeta el id ya provisto. Sin match deja null en vez de atribuir mal.';
