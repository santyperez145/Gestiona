-- Destinos de cobro de creadores y liquidacion auditable.
--
-- El checkout de tiendas cobra directamente con el OAuth del comercio y
-- application_fee. Las comisiones de creadores son otro flujo: cada creador
-- elige un destino y la marca registra la transferencia externa. No se declara
-- automatizacion salvo que el proveedor tenga una capacidad contractual activa.

BEGIN;

CREATE TABLE IF NOT EXISTS public.creator_payout_destinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.creator_accounts(user_id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('mercadopago', 'bank_transfer', 'virtual_wallet', 'other')),
  destination_type text NOT NULL CHECK (destination_type IN ('email', 'cbu', 'cvu', 'alias', 'wallet_handle')),
  provider_label text NOT NULL CHECK (char_length(provider_label) BETWEEN 2 AND 80),
  holder_name text NOT NULL CHECK (char_length(holder_name) BETWEEN 2 AND 120),
  identifier_encrypted text NOT NULL,
  identifier_masked text NOT NULL,
  currency text NOT NULL DEFAULT 'ARS' CHECK (currency = 'ARS'),
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS creator_payout_destination_default
  ON public.creator_payout_destinations(user_id) WHERE is_default AND is_active;
CREATE INDEX IF NOT EXISTS creator_payout_destination_owner
  ON public.creator_payout_destinations(user_id, is_active);

ALTER TABLE public.creator_payout_destinations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.creator_payout_destinations FROM PUBLIC, anon, authenticated;

ALTER TABLE public.influencer_withdrawal_requests
  ADD COLUMN IF NOT EXISTS payout_destination_id uuid REFERENCES public.creator_payout_destinations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payout_provider text,
  ADD COLUMN IF NOT EXISTS payout_provider_label text,
  ADD COLUMN IF NOT EXISTS payout_destination_type text,
  ADD COLUMN IF NOT EXISTS payout_identifier_encrypted text,
  ADD COLUMN IF NOT EXISTS payout_identifier_masked text,
  ADD COLUMN IF NOT EXISTS payout_holder_name text,
  ADD COLUMN IF NOT EXISTS payment_reference text,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

-- La politica previa permitia leer retiros de todas las organizaciones a
-- cualquier usuario autenticado. El creador usa RPCs propias; la tabla queda
-- limitada a los responsables de la organizacion.
DROP POLICY IF EXISTS withdrawals_org_read ON public.influencer_withdrawal_requests;
DROP POLICY IF EXISTS withdrawals_org_manage ON public.influencer_withdrawal_requests;
CREATE POLICY withdrawals_org_manage ON public.influencer_withdrawal_requests
  FOR ALL TO authenticated
  USING (public.can_manage_influencers(org_id, 'edit'))
  WITH CHECK (public.can_manage_influencers(org_id, 'edit'));

REVOKE ALL ON TABLE public.influencer_withdrawal_requests FROM authenticated;
GRANT SELECT ON TABLE public.influencer_withdrawal_requests TO authenticated;

CREATE OR REPLACE FUNCTION public.creator_payout_destinations_list()
RETURNS TABLE (
  id uuid,
  provider text,
  destination_type text,
  provider_label text,
  holder_name text,
  identifier_masked text,
  currency text,
  is_default boolean,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT d.id, d.provider, d.destination_type, d.provider_label,
         d.holder_name, d.identifier_masked, d.currency, d.is_default, d.created_at
  FROM public.creator_payout_destinations d
  WHERE d.user_id = auth.uid() AND d.is_active
  ORDER BY d.is_default DESC, d.created_at DESC;
$fn$;

CREATE OR REPLACE FUNCTION public.creator_payout_destination_save(
  p_provider text,
  p_destination_type text,
  p_provider_label text,
  p_holder_name text,
  p_identifier text,
  p_is_default boolean DEFAULT true
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user uuid := auth.uid();
  v_provider text := lower(btrim(COALESCE(p_provider, '')));
  v_type text := lower(btrim(COALESCE(p_destination_type, '')));
  v_identifier text := btrim(COALESCE(p_identifier, ''));
  v_label text := btrim(COALESCE(p_provider_label, ''));
  v_holder text := btrim(COALESCE(p_holder_name, ''));
  v_masked text;
  v_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.creator_accounts WHERE user_id = v_user) THEN
    RAISE EXCEPTION 'Perfil de creador no encontrado' USING ERRCODE = '42501';
  END IF;
  IF v_provider NOT IN ('mercadopago', 'bank_transfer', 'virtual_wallet', 'other') THEN
    RAISE EXCEPTION 'Proveedor de cobro no valido' USING ERRCODE = '22023';
  END IF;
  IF v_type NOT IN ('email', 'cbu', 'cvu', 'alias', 'wallet_handle') THEN
    RAISE EXCEPTION 'Tipo de destino no valido' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_label) NOT BETWEEN 2 AND 80 OR char_length(v_holder) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'Completa el proveedor y el titular' USING ERRCODE = '22023';
  END IF;
  IF v_type IN ('cbu', 'cvu') AND v_identifier !~ '^[0-9]{22}$' THEN
    RAISE EXCEPTION 'El CBU o CVU debe tener 22 digitos' USING ERRCODE = '22023';
  ELSIF v_type = 'email' AND v_identifier !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'El email de cobro no es valido' USING ERRCODE = '22023';
  ELSIF v_type IN ('alias', 'wallet_handle') AND char_length(v_identifier) NOT BETWEEN 3 AND 120 THEN
    RAISE EXCEPTION 'El alias o usuario de billetera no es valido' USING ERRCODE = '22023';
  END IF;

  v_masked := CASE
    WHEN v_type IN ('cbu', 'cvu') THEN '•••• •••• •••• •••• ••' || right(v_identifier, 4)
    WHEN v_type = 'email' THEN left(v_identifier, 2) || '••••@' || split_part(v_identifier, '@', 2)
    ELSE left(v_identifier, LEAST(3, char_length(v_identifier))) || '••••' || right(v_identifier, LEAST(3, char_length(v_identifier)))
  END;

  IF COALESCE(p_is_default, true) OR NOT EXISTS (
    SELECT 1 FROM public.creator_payout_destinations WHERE user_id = v_user AND is_active
  ) THEN
    UPDATE public.creator_payout_destinations SET is_default = false, updated_at = now()
    WHERE user_id = v_user AND is_default;
    p_is_default := true;
  END IF;

  INSERT INTO public.creator_payout_destinations (
    user_id, provider, destination_type, provider_label, holder_name,
    identifier_encrypted, identifier_masked, is_default
  ) VALUES (
    v_user, v_provider, v_type, v_label, v_holder,
    public.secret_encrypt(v_identifier), v_masked, COALESCE(p_is_default, false)
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.creator_payout_destination_disable(p_destination_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE v_was_default boolean;
BEGIN
  SELECT is_default INTO v_was_default FROM public.creator_payout_destinations
  WHERE id = p_destination_id AND user_id = auth.uid() AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Destino no encontrado' USING ERRCODE = 'P0002'; END IF;
  UPDATE public.creator_payout_destinations
  SET is_active = false, is_default = false, updated_at = now()
  WHERE id = p_destination_id AND user_id = auth.uid() AND is_active;
  IF v_was_default THEN
    UPDATE public.creator_payout_destinations SET is_default = true, updated_at = now()
    WHERE id = (
      SELECT id FROM public.creator_payout_destinations
      WHERE user_id = auth.uid() AND is_active ORDER BY created_at DESC LIMIT 1
    );
  END IF;
END;
$fn$;

-- Un monto global puede corresponder a varias marcas. La funcion reparte el
-- retiro entre los perfiles con saldo, sin mezclar organizaciones ni permitir
-- doble gasto concurrente.
DROP FUNCTION IF EXISTS public.creator_request_withdrawal(numeric, text);
CREATE OR REPLACE FUNCTION public.creator_request_withdrawal(
  p_amount_ars numeric,
  p_destination_id uuid,
  p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user uuid := auth.uid();
  v_email text;
  v_destination public.creator_payout_destinations;
  v_remaining numeric := round(COALESCE(p_amount_ars, 0), 2);
  v_available numeric;
  v_take numeric;
  v_ids uuid[] := ARRAY[]::uuid[];
  v_id uuid;
  v_inf record;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'No autenticado' USING ERRCODE = '42501'; END IF;
  IF v_remaining <= 0 THEN RAISE EXCEPTION 'El monto debe ser mayor a cero' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('creator-withdrawal:' || v_user::text, 0));

  SELECT * INTO v_destination FROM public.creator_payout_destinations
  WHERE id = p_destination_id AND user_id = v_user AND is_active;
  IF v_destination.id IS NULL THEN RAISE EXCEPTION 'Elegi un destino de cobro valido' USING ERRCODE = '22023'; END IF;
  SELECT email INTO v_email FROM public.creator_accounts WHERE user_id = v_user;

  FOR v_inf IN
    SELECT i.* FROM public.influencers i
    WHERE lower(i.email) = lower(v_email) AND COALESCE(i.status, 'activo') NOT IN ('inactivo', 'blocked')
    ORDER BY i.created_at
  LOOP
    SELECT GREATEST(
      COALESCE((SELECT SUM(s.commission_ars) FROM public.influencer_sales s WHERE s.influencer_id = v_inf.id), 0)
      - COALESCE((SELECT SUM(p.amount_ars) FROM public.influencer_payouts p WHERE p.influencer_id = v_inf.id), 0)
      - COALESCE((SELECT SUM(w.amount_ars) FROM public.influencer_withdrawal_requests w WHERE w.influencer_id = v_inf.id AND w.status IN ('pending', 'approved')), 0),
      0
    ) INTO v_available;
    IF v_available <= 0 OR v_remaining <= 0 THEN CONTINUE; END IF;
    v_take := LEAST(v_available, v_remaining);
    INSERT INTO public.influencer_withdrawal_requests (
      org_id, influencer_id, token, amount_ars, status, notes,
      payout_destination_id, payout_provider, payout_provider_label,
      payout_destination_type, payout_identifier_encrypted,
      payout_identifier_masked, payout_holder_name
    ) VALUES (
      v_inf.org_id, v_inf.id, COALESCE(v_inf.referral_code, v_inf.id::text), v_take, 'pending',
      NULLIF(left(btrim(COALESCE(p_notes, '')), 500), ''),
      v_destination.id, v_destination.provider, v_destination.provider_label,
      v_destination.destination_type, v_destination.identifier_encrypted,
      v_destination.identifier_masked, v_destination.holder_name
    ) RETURNING id INTO v_id;
    v_ids := array_append(v_ids, v_id);
    v_remaining := v_remaining - v_take;
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'El monto supera tu saldo disponible' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object('ok', true, 'request_ids', v_ids, 'requests_count', cardinality(v_ids), 'amount_ars', p_amount_ars);
END;
$fn$;

DROP FUNCTION IF EXISTS public.creator_my_withdrawals();
CREATE FUNCTION public.creator_my_withdrawals()
RETURNS TABLE (
  id uuid, amount_ars numeric, status text, created_at timestamptz,
  processed_at timestamptz, payout_provider_label text,
  payout_identifier_masked text, payment_reference text, paid_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT w.id, w.amount_ars, w.status, w.created_at, w.processed_at,
         w.payout_provider_label, w.payout_identifier_masked,
         w.payment_reference, w.paid_at
  FROM public.influencer_withdrawal_requests w
  JOIN public.influencers i ON i.id = w.influencer_id
  JOIN public.creator_accounts ca ON ca.user_id = auth.uid()
  WHERE lower(i.email) = lower(ca.email)
  ORDER BY w.created_at DESC LIMIT 50;
$fn$;

CREATE OR REPLACE FUNCTION public.creator_withdrawal_settlement_details(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE v_row public.influencer_withdrawal_requests;
BEGIN
  SELECT * INTO v_row FROM public.influencer_withdrawal_requests WHERE id = p_request_id;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'Solicitud no encontrada' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_manage_influencers(v_row.org_id, 'edit') THEN RAISE EXCEPTION 'Sin permiso' USING ERRCODE = '42501'; END IF;
  IF v_row.payout_identifier_encrypted IS NULL THEN
    RETURN jsonb_build_object('provider_label', 'Destino anterior', 'identifier', NULL, 'masked', NULL, 'holder_name', NULL);
  END IF;
  RETURN jsonb_build_object(
    'provider', v_row.payout_provider,
    'provider_label', v_row.payout_provider_label,
    'destination_type', v_row.payout_destination_type,
    'identifier', public.secret_decrypt(v_row.payout_identifier_encrypted),
    'masked', v_row.payout_identifier_masked,
    'holder_name', v_row.payout_holder_name
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.settle_creator_withdrawal(
  p_request_id uuid,
  p_payment_reference text,
  p_payment_method text DEFAULT 'transferencia'
) RETURNS public.influencer_withdrawal_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE v_row public.influencer_withdrawal_requests;
BEGIN
  SELECT * INTO v_row FROM public.influencer_withdrawal_requests WHERE id = p_request_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'Solicitud no encontrada' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_manage_influencers(v_row.org_id, 'edit') THEN RAISE EXCEPTION 'Sin permiso' USING ERRCODE = '42501'; END IF;
  IF v_row.status = 'paid' THEN RETURN v_row; END IF;
  IF v_row.status <> 'approved' THEN RAISE EXCEPTION 'Primero aproba la solicitud' USING ERRCODE = '22023'; END IF;
  IF char_length(btrim(COALESCE(p_payment_reference, ''))) < 3 THEN
    RAISE EXCEPTION 'Ingresa la referencia de la transferencia' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.influencer_payouts (org_id, influencer_id, amount_ars, payment_method, notes, created_by)
  SELECT v_row.org_id, v_row.influencer_id, v_row.amount_ars,
         left(btrim(COALESCE(p_payment_method, 'transferencia')), 40),
         'withdrawal:' || v_row.id::text, auth.uid()
  WHERE NOT EXISTS (
    SELECT 1 FROM public.influencer_payouts
    WHERE influencer_id = v_row.influencer_id AND notes = 'withdrawal:' || v_row.id::text
  );

  UPDATE public.influencer_withdrawal_requests
  SET status = 'paid', payment_reference = left(btrim(p_payment_reference), 160),
      payment_method = left(btrim(COALESCE(p_payment_method, 'transferencia')), 40),
      paid_at = now(), processed_at = COALESCE(processed_at, now()), processed_by = auth.uid()
  WHERE id = p_request_id RETURNING * INTO v_row;
  RETURN v_row;
END;
$fn$;

REVOKE ALL ON FUNCTION public.creator_payout_destinations_list() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.creator_payout_destination_save(text, text, text, text, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.creator_payout_destination_disable(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.creator_request_withdrawal(numeric, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.creator_my_withdrawals() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.creator_withdrawal_settlement_details(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.settle_creator_withdrawal(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.creator_payout_destinations_list() TO authenticated;
GRANT EXECUTE ON FUNCTION public.creator_payout_destination_save(text, text, text, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.creator_payout_destination_disable(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.creator_request_withdrawal(numeric, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.creator_my_withdrawals() TO authenticated;
GRANT EXECUTE ON FUNCTION public.creator_withdrawal_settlement_details(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_creator_withdrawal(uuid, text, text) TO authenticated;

INSERT INTO public.security_function_contracts(function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on)
SELECT v.fn, v.args, 'authenticated_delegate', v.rationale, md5(pg_get_functiondef(p.oid)), DATE '2026-09-29'
FROM (VALUES
  ('creator_payout_destinations_list', '', 'El creador ve destinos enmascarados.'),
  ('creator_payout_destination_save', 'p_provider text, p_destination_type text, p_provider_label text, p_holder_name text, p_identifier text, p_is_default boolean', 'El creador guarda un destino cifrado.'),
  ('creator_payout_destination_disable', 'p_destination_id uuid', 'El creador desactiva su destino.'),
  ('creator_request_withdrawal', 'p_amount_ars numeric, p_destination_id uuid, p_notes text', 'Retiro distribuido por marca con snapshot cifrado del destino.'),
  ('creator_withdrawal_settlement_details', 'p_request_id uuid', 'La marca autorizada obtiene el destino para ejecutar la transferencia.'),
  ('settle_creator_withdrawal', 'p_request_id uuid, p_payment_reference text, p_payment_method text', 'Liquida con referencia e idempotencia contable.')
) AS v(fn, args, rationale)
JOIN pg_proc p ON p.proname = v.fn
JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
WHERE pg_get_function_identity_arguments(p.oid) = v.args
ON CONFLICT (function_name, identity_arguments) DO UPDATE SET
  audience = EXCLUDED.audience, rationale = EXCLUDED.rationale,
  definition_hash = EXCLUDED.definition_hash, reviewed_on = EXCLUDED.reviewed_on;

COMMIT;
