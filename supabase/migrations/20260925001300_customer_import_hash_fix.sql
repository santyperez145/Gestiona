-- Reparación de stage_customer_import: digest() vive en el schema `extensions`
-- y el RPC lo llamó sin calificar. Se reemplaza por md5, que es built-in.
CREATE OR REPLACE FUNCTION public.stage_customer_import(
  p_org_id uuid,
  p_filename text,
  p_source_format text,
  p_rows jsonb,
  p_source_system text DEFAULT 'generic'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_batch_id uuid;
  v_hash text;
  v_row jsonb;
  v_index integer := 0;
  v_name text;
  v_email text;
  v_phone text;
  v_address text;
  v_tags text[];
  v_notes text;
  v_company text;
  v_birthday date;
  v_match_key text;
  v_action text;
  v_target uuid;
  v_errors text[];
  v_warnings text[];
BEGIN
  IF v_actor IS NULL OR NOT public.has_org_role(p_org_id, v_actor, ARRAY['owner','admin']) THEN
    RAISE EXCEPTION 'Sólo owner o admin pueden importar clientes' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'El lote no tiene filas' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_rows) > 20000 THEN
    RAISE EXCEPTION 'El lote supera 20.000 clientes por archivo' USING ERRCODE = '22023';
  END IF;

  v_hash := md5(p_rows::text || p_source_system);

  SELECT id INTO v_batch_id
  FROM public.customer_import_batches
  WHERE org_id = p_org_id AND payload_hash = v_hash AND status IN ('staged', 'applying')
  ORDER BY created_at DESC LIMIT 1;

  IF v_batch_id IS NULL THEN
    INSERT INTO public.customer_import_batches (
      org_id, created_by, filename, source_format, source_system, payload_hash, total_rows
    ) VALUES (
      p_org_id, v_actor,
      COALESCE(NULLIF(btrim(p_filename), ''), 'clientes'),
      p_source_format, p_source_system, v_hash, jsonb_array_length(p_rows)
    ) RETURNING id INTO v_batch_id;

    FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
      v_index := v_index + 1;
      v_errors := '{}';
      v_warnings := '{}';

      v_name := public.customer_import_text(v_row->'name', 300);
      v_email := lower(public.customer_import_text(v_row->'email', 320));
      v_phone := public.customer_import_phone(v_row->'phone');
      v_address := public.customer_import_text(v_row->'address', 500);
      v_notes := public.customer_import_text(v_row->'notes', 2000);
      v_company := public.customer_import_text(v_row->'company', 300);

      BEGIN
        v_birthday := public.customer_import_text(v_row->'birthday', 10)::date;
      EXCEPTION WHEN OTHERS THEN
        v_birthday := NULL;
      END;

      SELECT COALESCE(array_agg(left(btrim(tag), 60)) FILTER (WHERE btrim(tag) <> ''), ARRAY[]::text[])
        INTO v_tags
      FROM jsonb_array_elements_text(COALESCE(v_row->'tags', '[]'::jsonb)) AS tag;

      IF v_name IS NULL AND v_email IS NULL AND v_phone IS NULL THEN
        v_errors := array_append(v_errors, 'La fila no tiene nombre, email ni teléfono');
      END IF;
      IF v_email IS NOT NULL AND v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
        v_warnings := array_append(v_warnings, 'El email no tiene formato válido; se guarda igual para no perder al cliente');
      END IF;

      IF v_email IS NOT NULL THEN
        v_match_key := 'email:' || v_email;
      ELSIF v_phone IS NOT NULL THEN
        v_match_key := 'phone:' || v_phone;
      ELSE
        v_match_key := 'row:' || v_index::text;
      END IF;

      v_target := NULL;
      IF v_email IS NOT NULL THEN
        SELECT id INTO v_target FROM public.customers
        WHERE org_id = p_org_id AND lower(btrim(COALESCE(email, ''))) = v_email LIMIT 1;
      END IF;
      IF v_target IS NULL AND v_phone IS NOT NULL THEN
        SELECT id INTO v_target FROM public.customers
        WHERE org_id = p_org_id
          AND public.customer_import_phone(to_jsonb(phone)) = v_phone LIMIT 1;
      END IF;

      IF array_length(v_errors, 1) IS NOT NULL THEN
        v_action := 'invalid';
      ELSIF v_target IS NOT NULL THEN
        v_action := 'update';
      ELSE
        v_action := 'create';
      END IF;

      INSERT INTO public.customer_import_rows (
        batch_id, org_id, row_number, match_key, normalized, action,
        target_customer_id, validation_errors, validation_warnings
      ) VALUES (
        v_batch_id, p_org_id, v_index, v_match_key,
        jsonb_strip_nulls(jsonb_build_object(
          'name', v_name, 'email', v_email, 'phone', v_phone,
          'address', v_address, 'notes', v_notes, 'company', v_company,
          'birthday', v_birthday, 'tags', to_jsonb(v_tags)
        )),
        v_action, v_target, v_errors, v_warnings
      );
    END LOOP;

    UPDATE public.customer_import_batches b SET
      valid_rows = s.valid, invalid_rows = s.invalid,
      create_rows = s.creates, update_rows = s.updates
    FROM (
      SELECT
        count(*) FILTER (WHERE action IN ('create','update'))::int AS valid,
        count(*) FILTER (WHERE action = 'invalid')::int AS invalid,
        count(*) FILTER (WHERE action = 'create')::int AS creates,
        count(*) FILTER (WHERE action = 'update')::int AS updates
      FROM public.customer_import_rows WHERE batch_id = v_batch_id
    ) s
    WHERE b.id = v_batch_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'batch_id', v_batch_id,
    'reused', (SELECT total_rows > 0 FROM public.customer_import_batches WHERE id = v_batch_id),
    'total', (SELECT total_rows FROM public.customer_import_batches WHERE id = v_batch_id),
    'valid', (SELECT valid_rows FROM public.customer_import_batches WHERE id = v_batch_id),
    'invalid', (SELECT invalid_rows FROM public.customer_import_batches WHERE id = v_batch_id),
    'creates', (SELECT create_rows FROM public.customer_import_batches WHERE id = v_batch_id),
    'updates', (SELECT update_rows FROM public.customer_import_batches WHERE id = v_batch_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.stage_customer_import(uuid, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stage_customer_import(uuid, text, text, jsonb, text) TO authenticated;
