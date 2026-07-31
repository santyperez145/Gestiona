-- ═══════════════════════════════════════════════════════════════════════════
-- Al renombrar, el vínculo se vuelve a resolver
--
-- `trg_sales_link_customer` salía temprano si `customer_id` ya tenía valor. En
-- un INSERT eso está bien: quien lo provee lo sabe con certeza. En un UPDATE del
-- nombre no: la fusión de clientes de CustomersPage reescribe `customer_name` en
-- sales, debts y loyalty_points, y con la salida temprana esas filas quedaban
-- apuntando al cliente VIEJO — el que se acaba de fusionar.
--
-- El resultado sería silencioso y caro: la ficha muestra un historial, la deuda
-- figura a nombre de otro, y los puntos se le acreditan a quien no compró.
--
-- Ahora se distingue el caso. Si el nombre cambió, se vuelve a resolver; si no,
-- se respeta lo que ya estaba.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.trg_sales_link_customer()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id       uuid;
  v_renombre boolean;
BEGIN
  -- ¿Es un cambio de nombre? Ahí el vínculo anterior deja de ser confiable.
  v_renombre := TG_OP = 'UPDATE'
    AND public.normalize_person_name(NEW.customer_name)
        IS DISTINCT FROM public.normalize_person_name(OLD.customer_name);

  -- Sin renombre, un customer_id ya provisto manda: quien lo sabe con certeza
  -- gana sobre el matcheo por nombre.
  IF NEW.customer_id IS NOT NULL AND NOT v_renombre THEN
    RETURN NEW;
  END IF;

  IF public.normalize_person_name(NEW.customer_name) IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT c.id INTO v_id
  FROM public.customers c
  WHERE c.org_id = NEW.org_id
    AND public.normalize_person_name(c.name) = public.normalize_person_name(NEW.customer_name)
  ORDER BY c.created_at
  LIMIT 1;

  -- En un renombre sin match, se limpia en vez de dejar el vínculo viejo: es
  -- preferible no saber a quién pertenece antes que atribuírselo al equivocado.
  NEW.customer_id := v_id;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_sales_link_customer IS
  'Resuelve customer_id desde customer_name. Genérica: sales, debts y loyalty_points. En un renombre vuelve a resolver (la fusión de clientes depende de esto); si no, respeta el id ya provisto. Sin match deja null en vez de atribuir mal.';

-- ── Corregir vínculos que quedaron apuntando mal ──────────────────────────
-- Filas cuyo customer_id no coincide con el cliente que corresponde al nombre
-- que tienen hoy. Si hubo fusiones antes de este arreglo, están acá.
DO $corregir$
DECLARE t text; n int;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales', 'debts', 'loyalty_points'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=t AND column_name='customer_id'
    ) THEN CONTINUE; END IF;

    EXECUTE format($q$
      UPDATE public.%I x
         SET customer_id = sub.id
        FROM (
          SELECT c.id, c.org_id, public.normalize_person_name(c.name) AS n
          FROM public.customers c
        ) sub
       WHERE sub.org_id = x.org_id
         AND sub.n = public.normalize_person_name(x.customer_name)
         AND x.customer_id IS DISTINCT FROM sub.id
    $q$, t);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN RAISE NOTICE '% : % filas reapuntadas', t, n; END IF;
  END LOOP;
END
$corregir$;
