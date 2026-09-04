-- ============================================================================
-- CRM-001 — `deals` era la sexta tabla, y cruzaba por nombre
-- ============================================================================
--
-- CONTRIBUTING.md afirma: «**Ya no queda nada del CRM cruzando por nombre.** `quotes`
-- y `customer_communications` recibieron la columna en `20260802000001` y usan
-- el mismo trigger genérico que las otras tres, así que
-- `trg_sales_link_customer` sirve hoy a cinco tablas».
--
-- Medido el 2026-08-26, y la afirmación es incompleta. El trigger sirve a
-- **cinco** tablas —`sales`, `quotes`, `debts`, `loyalty_points` y
-- `customer_communications`— y `deals` no está entre ellas: tiene
-- `customer_name text` y **ni la columna ni el trigger**. Es la sexta, y quedó
-- afuera de aquella pasada.
--
-- El costo es el que ya se conoce y está documentado: con el mismo cliente
-- escrito de tres formas, la ficha muestra 1 de 3. Para `sales`, `quotes` y
-- `customer_communications` se verificó forzando el caso; `deals` sigue
-- expuesta al mismo problema.
--
-- Se arregla igual que las otras cinco —misma columna, mismo trigger genérico—
-- y no con una variante propia. Es lo que pide el criterio de la casa: se hace
-- como lo hacen los que ya funcionan.
--
-- ── Sobre el momento ──────────────────────────────────────────────────────
--
-- `deals` tiene **0 filas** (medido). No hay backfill, no hay ambigüedad que
-- resolver y no hay riesgo de atribuirle una oportunidad al cliente
-- equivocado. Esto es lo más barato que va a ser: con la primera fila real
-- aparece la cola de ambiguos que el backlog describe.
-- ============================================================================

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS customer_id uuid
  REFERENCES public.customers(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.deals.customer_id IS
  'Cliente canonico. `customer_name` queda como lo que el vendedor escribio; '
  'el vinculo real es este. Lo completa trg_deals_link_customer.';

CREATE INDEX IF NOT EXISTS deals_customer_id_idx
  ON public.deals(customer_id) WHERE customer_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_deals_link_customer ON public.deals;
CREATE TRIGGER trg_deals_link_customer
  BEFORE INSERT OR UPDATE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.trg_sales_link_customer();

-- ── Verificación ────────────────────────────────────────────────────────────
DO $verif$
DECLARE
  v_org uuid; v_user uuid; v_cli uuid; v_deal uuid; v_link uuid; v_n int;
BEGIN
  SELECT p.org_id INTO v_org FROM public.products p
   GROUP BY p.org_id ORDER BY count(*) DESC LIMIT 1;
  SELECT m.user_id INTO v_user FROM public.memberships m
   WHERE m.org_id = v_org AND m.role IN ('owner','admin') LIMIT 1;

  INSERT INTO public.customers (org_id, user_id, name)
  VALUES (v_org, v_user, 'ZZ Cliente De Prueba') RETURNING id INTO v_cli;

  -- 1. El nombre escrito distinto igual encuentra al cliente. Es el caso que
  --    hacia que la ficha mostrara 1 de 3.
  INSERT INTO public.deals (org_id, user_id, title, customer_name, stage)
  VALUES (v_org, v_user, 'ZZ Oportunidad', '  zz   cliente  de  prueba ', 'lead')
  RETURNING id, customer_id INTO v_deal, v_link;
  ASSERT v_link = v_cli,
    'el trigger no enlazo por nombre normalizado: ' || COALESCE(v_link::text, '(null)');

  -- 2. Un customer_id explicito manda sobre el matcheo por nombre.
  UPDATE public.deals SET customer_id = v_cli WHERE id = v_deal;
  SELECT customer_id INTO v_link FROM public.deals WHERE id = v_deal;
  ASSERT v_link = v_cli, 'se perdio un customer_id provisto a proposito';

  -- 3. Un renombre sin match limpia el vinculo en vez de dejar el viejo: es
  --    preferible no saber de quien es antes que atribuirselo al equivocado.
  UPDATE public.deals SET customer_name = 'ZZ Otro Que No Existe' WHERE id = v_deal;
  SELECT customer_id INTO v_link FROM public.deals WHERE id = v_deal;
  ASSERT v_link IS NULL,
    'un renombre sin match dejo el vinculo anterior: ' || COALESCE(v_link::text,'(null)');

  -- 4. Borrar el cliente no borra la oportunidad, la desvincula.
  UPDATE public.deals SET customer_name = 'ZZ Cliente De Prueba' WHERE id = v_deal;
  DELETE FROM public.customers WHERE id = v_cli;
  SELECT customer_id INTO v_link FROM public.deals WHERE id = v_deal;
  ASSERT v_link IS NULL, 'el ON DELETE SET NULL no actuo';

  DELETE FROM public.deals WHERE id = v_deal;

  -- Los restos se cuentan por los nombres EXACTOS que crea este bloque, no por
  -- el prefijo `ZZ`: la base tiene 9 clientes `ZZ ...` de verificaciones
  -- anteriores que no se limpiaron, y contarlos aca haria fallar esta migracion
  -- por la suciedad de otra. Quedan anotados en el ROADMAP para limpiarlos
  -- aparte; borrar filas ajenas no es trabajo de una migracion de esquema.
  SELECT count(*) INTO v_n FROM public.deals WHERE title = 'ZZ Oportunidad';
  ASSERT v_n = 0, 'quedaron oportunidades de prueba: ' || v_n;
  SELECT count(*) INTO v_n FROM public.customers WHERE name = 'ZZ Cliente De Prueba';
  ASSERT v_n = 0, 'quedaron clientes de prueba: ' || v_n;

  -- 5. Ahora el trigger sirve a las SEIS tablas, no a cinco.
  SELECT count(*) INTO v_n
    FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE NOT t.tgisinternal AND p.proname = 'trg_sales_link_customer';
  ASSERT v_n = 6, 'esperaba 6 tablas enlazadas, hay ' || v_n;

  RAISE NOTICE 'ZZ_OK deals enlaza por customer_id como las otras cinco';
END
$verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260826000210', 'deals_por_cliente') ON CONFLICT DO NOTHING;
