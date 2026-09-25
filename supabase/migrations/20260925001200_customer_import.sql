-- ═══════════════════════════════════════════════════════════════════════════
-- C22.2 · Migración de clientes desde el marketplace de origen
--
-- El migrador de catálogo trae productos, variantes y stock, pero dejaba atrás
-- la cartera: quien cambia de Tiendanube/Shopify aterriza con su catálogo y sin
-- un solo cliente. RFM, campañas, fidelidad y recuperación quedan vacíos hasta
-- que el comercio los vuelve a cargar a mano — justo lo que no va a hacer.
--
-- Este contrato reutiliza el patrón del migrador de productos: staging auditable
-- → aprobación owner/admin → aplicación atómica e idempotente. El matcheo es por
-- email normalizado y, cuando falta, por teléfono normalizado. Nunca por nombre:
-- "Juan Pérez" y "juan perez" son la misma persona y no dos filas.
--
-- No pisa lo que el comercio cargó a mano (COALESCE sobre el valor existente) y
-- no revive el opt-out de marketing: si el cliente ya se dio de baja, se respeta.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.customer_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  filename text NOT NULL,
  source_format text NOT NULL CHECK (source_format IN ('xlsx', 'xls', 'csv')),
  source_system text NOT NULL DEFAULT 'generic' CHECK (
    source_system IN ('shopify', 'tiendanube', 'empretienda', 'nerqia', 'generic')
  ),
  payload_hash text NOT NULL,
  status text NOT NULL DEFAULT 'staged' CHECK (
    status IN ('staged', 'applying', 'completed', 'completed_with_errors', 'failed', 'cancelled')
  ),
  total_rows integer NOT NULL DEFAULT 0,
  valid_rows integer NOT NULL DEFAULT 0,
  invalid_rows integer NOT NULL DEFAULT 0,
  create_rows integer NOT NULL DEFAULT 0,
  update_rows integer NOT NULL DEFAULT 0,
  created_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  cancelled_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.customer_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.customer_import_batches(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  row_number integer NOT NULL CHECK (row_number > 0),
  match_key text NOT NULL,
  normalized jsonb NOT NULL,
  action text NOT NULL CHECK (action IN ('create', 'update', 'invalid')),
  target_customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  validation_errors text[] NOT NULL DEFAULT '{}',
  validation_warnings text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'staged' CHECK (status IN ('staged', 'applied', 'skipped')),
  result_customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  applied_at timestamptz,
  UNIQUE (batch_id, row_number)
);

CREATE INDEX IF NOT EXISTS customer_import_rows_batch_action_idx
  ON public.customer_import_rows(batch_id, action, row_number);

-- Se reutiliza un retry mientras el lote sigue abierto; una vez cerrado se puede
-- volver a importar el mismo archivo a propósito (la idempotencia vive en el id).
DROP INDEX IF EXISTS public.customer_import_batches_active_payload_uidx;
CREATE UNIQUE INDEX customer_import_batches_active_payload_uidx
  ON public.customer_import_batches(org_id, payload_hash)
  WHERE status IN ('staged', 'applying');

ALTER TABLE public.customer_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_import_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members read customer import batches" ON public.customer_import_batches;
CREATE POLICY "members read customer import batches"
  ON public.customer_import_batches FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));

DROP POLICY IF EXISTS "members read customer import rows" ON public.customer_import_rows;
CREATE POLICY "members read customer import rows"
  ON public.customer_import_rows FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));

-- Sin policies de escritura: sólo los RPC auditados crean o mutan lotes.
REVOKE ALL ON public.customer_import_batches, public.customer_import_rows FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.customer_import_batches, public.customer_import_rows TO authenticated;

COMMENT ON TABLE public.customer_import_batches IS
  'Cabecera auditable de una importación de clientes. Se prepara antes de tocar el CRM y conserva la reconciliación final.';
COMMENT ON TABLE public.customer_import_rows IS
  'Filas normalizadas de un lote de clientes. Sólo datos de contacto y CRM; nunca credenciales ni datos de pago.';

-- Normaliza teléfonos argentinos a una forma canónica: quita el prefijo
-- internacional 54/0054, el 9 de móvil y el 0 de larga distancia. Así
-- "+54 9 11 5555-4444", "01155554444" y "541155554444" son la misma persona.
CREATE OR REPLACE FUNCTION public.customer_import_phone(p_value jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_digits text;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'string' THEN RETURN NULL; END IF;
  v_digits := regexp_replace(p_value #>> '{}', '[^0-9]', '', 'g');
  IF v_digits = '' THEN RETURN NULL; END IF;
  v_digits := regexp_replace(v_digits, '^0054', '');
  v_digits := regexp_replace(v_digits, '^54', '');
  v_digits := regexp_replace(v_digits, '^9(?=[0-9]{10})', '');
  v_digits := regexp_replace(v_digits, '^0', '');
  IF length(v_digits) < 6 THEN RETURN NULL; END IF;
  RETURN right(v_digits, 15);
END;
$$;

REVOKE ALL ON FUNCTION public.customer_import_phone(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.customer_import_text(p_value jsonb, p_max integer DEFAULT 500)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_value IS NULL OR jsonb_typeof(p_value) <> 'string' THEN NULL
    ELSE NULLIF(left(btrim(p_value #>> '{}'), p_max), '')
  END;
$$;

REVOKE ALL ON FUNCTION public.customer_import_text(jsonb, integer) FROM PUBLIC, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- stage_customer_import — prepara el lote sin tocar el CRM
-- ═══════════════════════════════════════════════════════════════════════════
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
  v_tags_raw text;
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

    -- Duplicados dentro del mismo archivo: el segundo con el mismo email se
    -- actualiza contra el primero, no se crea dos veces.
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
    'ok', true, 'batch_id', v_batch_id, 'reused', (SELECT total_rows > 0 FROM public.customer_import_batches WHERE id = v_batch_id),
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

-- ═══════════════════════════════════════════════════════════════════════════
-- apply_customer_import — aplica el lote atómico, idempotente y sin pisar datos
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.apply_customer_import(
  p_batch_id uuid,
  p_skip_invalid boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch public.customer_import_batches;
  v_actor uuid := auth.uid();
  v_owner uuid;
  v_row public.customer_import_rows;
  v_created int := 0;
  v_updated int := 0;
  v_skipped int := 0;
  v_target uuid;
  v_name text;
  v_email text;
  v_phone text;
  v_tags text[];
BEGIN
  SELECT * INTO v_batch FROM public.customer_import_batches WHERE id = p_batch_id FOR UPDATE;
  IF v_batch.id IS NULL THEN
    RAISE EXCEPTION 'El lote no existe' USING ERRCODE = '22023';
  END IF;
  IF NOT public.has_org_role(v_batch.org_id, v_actor, ARRAY['owner','admin']) THEN
    RAISE EXCEPTION 'Sólo owner o admin pueden aplicar la importación' USING ERRCODE = '42501';
  END IF;

  -- Idempotencia: un lote ya cerrado devuelve el mismo resultado sin re-aplicar.
  IF v_batch.status IN ('completed', 'completed_with_errors') THEN
    RETURN jsonb_build_object(
      'ok', true, 'reused', true, 'status', v_batch.status,
      'created', v_batch.created_count, 'updated', v_batch.updated_count,
      'skipped', v_batch.skipped_count
    );
  END IF;
  IF v_batch.status NOT IN ('staged', 'failed') THEN
    RAISE EXCEPTION 'El lote no está en estado de aplicarse' USING ERRCODE = '22023';
  END IF;

  IF v_batch.invalid_rows > 0 AND NOT p_skip_invalid THEN
    RAISE EXCEPTION 'El lote tiene filas inválidas; confirmá omitirlas' USING ERRCODE = '22023';
  END IF;

  UPDATE public.customer_import_batches SET status = 'applying' WHERE id = p_batch_id;

  SELECT m.user_id INTO v_owner
  FROM public.memberships m
  WHERE m.org_id = v_batch.org_id AND m.role = 'owner'
  ORDER BY m.joined_at LIMIT 1;
  IF v_owner IS NULL THEN
    SELECT user_id INTO v_owner FROM public.memberships
    WHERE org_id = v_batch.org_id ORDER BY joined_at LIMIT 1;
  END IF;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'La organización no tiene un miembro que firme los clientes importados';
  END IF;

  FOR v_row IN
    SELECT * FROM public.customer_import_rows
    WHERE batch_id = p_batch_id AND status = 'staged'
    ORDER BY row_number FOR UPDATE
  LOOP
    IF v_row.action = 'invalid' THEN
      UPDATE public.customer_import_rows SET status = 'skipped' WHERE id = v_row.id;
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_name := NULLIF(v_row.normalized->>'name', '');
    v_email := NULLIF(v_row.normalized->>'email', '');
    v_phone := NULLIF(v_row.normalized->>'phone', '');
    SELECT COALESCE(array_agg(t), ARRAY[]::text[]) INTO v_tags
      FROM jsonb_array_elements_text(COALESCE(v_row.normalized->'tags', '[]'::jsonb)) AS t;

    v_target := v_row.target_customer_id;

    IF v_target IS NULL THEN
      INSERT INTO public.customers (
        org_id, user_id, name, email, phone, address, notes, company, birthday, tags
      ) VALUES (
        v_batch.org_id, v_owner,
        COALESCE(v_name, v_email, v_phone),
        v_email, v_phone,
        NULLIF(v_row.normalized->>'address', ''),
        NULLIF(v_row.normalized->>'notes', ''),
        NULLIF(v_row.normalized->>'company', ''),
        NULLIF(v_row.normalized->>'birthday', '')::date,
        COALESCE(v_tags, ARRAY['importado'])
      )
      RETURNING id INTO v_target;
      v_created := v_created + 1;
      UPDATE public.customer_import_rows
        SET status = 'applied', result_customer_id = v_target, applied_at = now()
        WHERE id = v_row.id;
    ELSE
      -- Sólo completa lo vacío. Nunca pisa lo que el comercio escribió a mano,
      -- y nunca revierte un opt-out: si ya se dio de baja, sigue de baja.
      UPDATE public.customers SET
        name      = CASE WHEN NULLIF(btrim(COALESCE(name, '')), '') IS NULL THEN COALESCE(v_name, email) ELSE name END,
        email     = COALESCE(email, v_email),
        phone     = COALESCE(NULLIF(btrim(COALESCE(phone, '')), ''), v_phone),
        address   = COALESCE(NULLIF(btrim(COALESCE(address, '')), ''), NULLIF(v_row.normalized->>'address', '')),
        notes     = COALESCE(NULLIF(btrim(COALESCE(notes, '')), ''), NULLIF(v_row.normalized->>'notes', '')),
        company   = COALESCE(NULLIF(btrim(COALESCE(company, '')), ''), NULLIF(v_row.normalized->>'company', '')),
        birthday  = COALESCE(birthday, NULLIF(v_row.normalized->>'birthday', '')::date),
        tags      = CASE
                      WHEN COALESCE(v_tags, ARRAY[]::text[]) = ARRAY[]::text[] THEN tags
                      ELSE ARRAY(SELECT DISTINCT unnest(COALESCE(tags, ARRAY[]::text[]) || v_tags))
                    END,
        updated_at = now()
      WHERE id = v_target;
      v_updated := v_updated + 1;
      UPDATE public.customer_import_rows
        SET status = 'applied', result_customer_id = v_target, applied_at = now()
        WHERE id = v_row.id;
    END IF;
  END LOOP;

  UPDATE public.customer_import_batches SET
    status = CASE WHEN invalid_rows > 0 AND p_skip_invalid THEN 'completed_with_errors' ELSE 'completed' END,
    created_count = v_created, updated_count = v_updated, skipped_count = v_skipped,
    applied_at = now()
  WHERE id = p_batch_id;

  RETURN jsonb_build_object(
    'ok', true, 'reused', false,
    'status', (SELECT status FROM public.customer_import_batches WHERE id = p_batch_id),
    'created', v_created, 'updated', v_updated, 'skipped', v_skipped,
    'reconciled', (SELECT count(*) FROM public.customer_import_rows
                   WHERE batch_id = p_batch_id AND status = 'staged') = 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_customer_import(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_customer_import(uuid, boolean) TO authenticated;

COMMIT;
