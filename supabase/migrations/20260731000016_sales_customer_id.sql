-- ═══════════════════════════════════════════════════════════════════════════
-- Las ventas se vinculan al cliente por id, no por texto
--
-- `sales` sólo tenía `customer_name`, texto libre. Todo lo que cruza ventas con
-- clientes — RFM, fidelidad, seguimiento, historial en la ficha — matcheaba por
-- ese string. "Juan Perez", "juan pérez" y "Juan  Perez" eran tres clientes, y
-- renombrar a alguien le borraba el historial.
--
-- No es un problema de la tienda: era así en todo el sistema, POS incluido.
--
-- El vínculo se resuelve en un trigger y no en cada lugar que inserta ventas.
-- Hay al menos tres caminos que escriben en `sales` (POS, la tienda online vía
-- `mark_store_order_paid`, e importaciones), y tocarlos uno por uno deja el
-- cuarto sin cubrir. El trigger los cubre a todos, incluso los que se agreguen
-- después.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sales_customer ON public.sales(customer_id)
  WHERE customer_id IS NOT NULL;

COMMENT ON COLUMN public.sales.customer_id IS
  'Cliente del CRM. Lo completa solo el trigger trg_sales_link_customer a partir de customer_name. `customer_name` se conserva: es lo que se escribió en el momento de la venta y sirve de respaldo si el cliente se borra.';

-- ── Normalización de nombres ──────────────────────────────────────────────
-- Sin depender de `unaccent`, que puede no estar instalado: minúsculas, sin
-- acentos y con los espacios colapsados. Es lo mínimo para que dos formas de
-- escribir el mismo nombre se encuentren.
CREATE OR REPLACE FUNCTION public.normalize_person_name(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(
    btrim(regexp_replace(
      translate(lower(COALESCE(p_name, '')),
                'áàäâãéèëêíìïîóòöôõúùüûñç',
                'aaaaaeeeeiiiiooooouuuunc'),
      '\s+', ' ', 'g'
    )), ''
  );
$$;

-- ── Resolver el cliente al insertar o actualizar una venta ────────────────
CREATE OR REPLACE FUNCTION public.trg_sales_link_customer()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  -- Si ya viene resuelto, se respeta: quien lo sabe con certeza gana.
  IF NEW.customer_id IS NOT NULL THEN RETURN NEW; END IF;
  IF public.normalize_person_name(NEW.customer_name) IS NULL THEN RETURN NEW; END IF;

  SELECT c.id INTO v_id
  FROM public.customers c
  WHERE c.org_id = NEW.org_id
    AND public.normalize_person_name(c.name) = public.normalize_person_name(NEW.customer_name)
  ORDER BY c.created_at
  LIMIT 1;   -- si hay homónimos, el más antiguo; mejor uno estable que ninguno

  NEW.customer_id := v_id;   -- null si no existe: no se inventa un cliente
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sales_link_customer ON public.sales;
CREATE TRIGGER trg_sales_link_customer
BEFORE INSERT OR UPDATE OF customer_name ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.trg_sales_link_customer();

-- ── Backfill de lo ya vendido ─────────────────────────────────────────────
-- Sin esto el historial arranca vacío y el RFM cuenta a todos como clientes
-- nuevos, que es peor que no tener el vínculo.
UPDATE public.sales s
   SET customer_id = c.id
  FROM public.customers c
 WHERE s.customer_id IS NULL
   AND c.org_id = s.org_id
   AND public.normalize_person_name(c.name) = public.normalize_person_name(s.customer_name);

-- ── Vista de control ──────────────────────────────────────────────────────
-- Cuántas ventas quedaron sin cliente y con qué nombres: son los que hay que
-- dar de alta o corregir. Que el número sea visible evita que el vínculo se
-- degrade en silencio con el tiempo.
CREATE OR REPLACE VIEW public.sales_sin_cliente AS
SELECT
  s.org_id,
  s.customer_name,
  count(*)      AS ventas,
  sum(s.total_ars) AS total_ars,
  max(s.date)   AS ultima_venta
FROM public.sales s
WHERE s.customer_id IS NULL
  AND public.normalize_person_name(s.customer_name) IS NOT NULL
GROUP BY s.org_id, s.customer_name
ORDER BY count(*) DESC;

COMMENT ON VIEW public.sales_sin_cliente IS
  'Ventas cuyo nombre no matchea ningún cliente del CRM. Cada fila es alguien a quien no se le puede hacer seguimiento.';
