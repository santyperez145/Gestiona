-- Derecho de supresión (Ley 25.326, art. 16) para un cliente.
--
-- En Argentina no se pueden borrar las ventas: AFIP exige conservar los
-- comprobantes. Lo correcto es **anonimizar**: la operación queda en los
-- libros, pero deja de estar vinculada a una persona identificable.
--
-- El PII del cliente está denormalizado como texto (`customer_name`,
-- `customer_email`, `customer_phone`) en decenas de tablas. En vez de listarlas
-- a mano — cualquier tabla nueva quedaría afuera y nadie se enteraría — la
-- función recorre el catálogo y actualiza toda tabla de `public` que tenga esas
-- columnas junto con `org_id`. Idempotente.

CREATE OR REPLACE FUNCTION public.anonymize_customer(
  p_org_id      uuid,
  p_customer_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name       text;
  v_email      text;
  v_phone      text;
  v_alias      text;
  v_touched    jsonb := '[]'::jsonb;
  v_rows       int;
  r            record;
BEGIN
  -- Solo owner/admin de esa organización.
  IF NOT public.has_org_role(p_org_id, auth.uid(), ARRAY['owner','admin']) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  SELECT name, email, phone INTO v_name, v_email, v_phone
  FROM public.customers
  WHERE id = p_customer_id AND org_id = p_org_id;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Cliente no encontrado en esta organización';
  END IF;

  -- Seudónimo estable: permite seguir agrupando las ventas de ese cliente
  -- para estadísticas sin poder identificarlo.
  v_alias := 'Cliente anonimizado ' || substr(replace(p_customer_id::text, '-', ''), 1, 8);

  -- ── Reemplazo del nombre en toda tabla con customer_name + org_id ──────────
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'customer_name' AND a.attnum > 0 AND NOT a.attisdropped)
      AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'org_id'        AND a.attnum > 0 AND NOT a.attisdropped)
  LOOP
    EXECUTE format(
      'UPDATE public.%I SET customer_name = $1 WHERE org_id = $2 AND customer_name = $3',
      r.relname
    ) USING v_alias, p_org_id, v_name;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN
      v_touched := v_touched || jsonb_build_object('tabla', r.relname, 'filas', v_rows);
    END IF;
  END LOOP;

  -- ── Email y teléfono: se ponen en NULL donde existan esas columnas ─────────
  FOR r IN
    SELECT c.relname, a.attname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND a.attname IN ('customer_email', 'customer_phone')
      AND NOT a.attnotnull
      AND EXISTS (SELECT 1 FROM pg_attribute o WHERE o.attrelid = c.oid AND o.attname = 'org_id' AND o.attnum > 0 AND NOT o.attisdropped)
  LOOP
    EXECUTE format(
      'UPDATE public.%I SET %I = NULL WHERE org_id = $1 AND %I IS NOT NULL AND %I = ANY($2)',
      r.relname, r.attname, r.attname, r.attname
    ) USING p_org_id, ARRAY[COALESCE(v_email, '\x00'), COALESCE(v_phone, '\x00')];
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN
      v_touched := v_touched || jsonb_build_object('tabla', r.relname, 'columna', r.attname, 'filas', v_rows);
    END IF;
  END LOOP;

  -- ── La ficha del cliente ───────────────────────────────────────────────────
  UPDATE public.customers
  SET name              = v_alias,
      email             = NULL,
      phone             = NULL,
      whatsapp_number   = NULL,
      instagram_handle  = NULL,
      address           = NULL,
      birthday          = NULL,
      notes             = NULL,
      company           = NULL,
      tags              = '{}',
      custom_fields     = '{}'::jsonb
  WHERE id = p_customer_id AND org_id = p_org_id;

  -- Rastro de que la supresión ocurrió (sin volver a guardar el dato borrado).
  INSERT INTO public.audit_logs (org_id, user_id, action, entity_type, entity_id, entity_label, severity, details)
  VALUES (
    p_org_id, auth.uid(), 'delete', 'customer', p_customer_id, v_alias, 'critical',
    jsonb_build_object('motivo', 'Derecho de supresión (Ley 25.326)', 'tablas', v_touched)
  );

  RETURN jsonb_build_object('alias', v_alias, 'tablas', v_touched);
END;
$$;

REVOKE ALL ON FUNCTION public.anonymize_customer(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.anonymize_customer(uuid, uuid) TO authenticated;
