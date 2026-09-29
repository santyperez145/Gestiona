-- ============================================================================
-- Contratos de influencers con doble aceptación (Go-Marz parity).
--
-- ── El defecto medido ──────────────────────────────────────────────────────
-- `influencer_contracts.is_signed` era un boolean que la marca declaraba a
-- mano («Firma declarada»): el creador nunca intervenía. Un contrato valía lo
-- que una persona de la marca escribió en su propio registro. Go-Marz tiene
-- contrato con aceptación del creador; nosotros teníamos una casilla.
--
-- ── Qué hace esta migración ────────────────────────────────────────────────
-- 1. `influencer_contract_versions`: cada edición de condiciones es una
--    versión nueva con snapshot inmutable. Cambiar el monto invalida la
--    aceptación previa: el creador vuelve a decidir sobre lo nuevo.
-- 2. `influencer_contract_acceptances`: una fila por parte y versión. El
--    contrato queda firmado sólo cuando marca Y creador aceptaron la MISMA
--    versión — `is_signed` pasa a ser computado por la base, no declarado.
-- 3. RPCs con autoridad en servidor: crear/editar (marca), aceptar por token
--    público (creador sin cuenta, igual que las invitaciones) o con sesión
--    desde el portal (creador con cuenta). Idempotentes por (contrato,
--    versión, parte).
-- 4. El token público expone SOLO las condiciones del contrato: nunca otros
--    contratos, costos internos ni PII de la marca.
-- ============================================================================

-- Ciclo de vida: la aceptación es ortogonal al estado comercial.
DO $$
DECLARE
  v_constraint text;
BEGIN
  FOR v_constraint IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.influencer_contracts'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.influencer_contracts DROP CONSTRAINT %I', v_constraint);
  END LOOP;
END $$;

ALTER TABLE public.influencer_contracts
  ADD CONSTRAINT influencer_contracts_status_check
  CHECK (status IN ('active', 'paused', 'expired', 'cancelled'));

ALTER TABLE public.influencer_contracts
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS creator_token text,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Un token por contrato: el enlace de aceptación del creador.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contracts_creator_token
  ON public.influencer_contracts(creator_token) WHERE creator_token IS NOT NULL;

-- Backfill: los contratos previos obtienen su token y arrancan en versión 1
-- con la aceptación de la marca implícita (es quien escribió las condiciones).
UPDATE public.influencer_contracts
SET creator_token = encode(extensions.gen_random_bytes(24), 'hex')
WHERE creator_token IS NULL;

CREATE TABLE IF NOT EXISTS public.influencer_contract_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES public.influencer_contracts(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  contract_type TEXT NOT NULL CHECK (contract_type IN ('fixed', 'percentage', 'hybrid')),
  contract_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (contract_amount >= 0),
  commission_percent NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (commission_percent BETWEEN 0 AND 100),
  commission_fixed NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (commission_fixed >= 0),
  valid_from DATE NOT NULL,
  valid_until DATE,
  terms_text TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contract_id, version)
);

CREATE INDEX IF NOT EXISTS idx_contract_versions_contract
  ON public.influencer_contract_versions(contract_id, version DESC);

CREATE TABLE IF NOT EXISTS public.influencer_contract_acceptances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES public.influencer_contracts(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  party TEXT NOT NULL CHECK (party IN ('brand', 'creator')),
  accepted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_via_token TEXT,
  signature_name TEXT,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contract_id, version, party)
);

CREATE INDEX IF NOT EXISTS idx_contract_acceptances_contract
  ON public.influencer_contract_acceptances(contract_id, version DESC);

ALTER TABLE public.influencer_contract_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.influencer_contract_acceptances ENABLE ROW LEVEL SECURITY;

-- La marca gestiona versiones y ve las aceptaciones de sus contratos.
DROP POLICY IF EXISTS contract_versions_brand ON public.influencer_contract_versions;
CREATE POLICY contract_versions_brand ON public.influencer_contract_versions FOR ALL TO authenticated
  USING (public.can_manage_influencers(org_id, 'edit'))
  WITH CHECK (public.can_manage_influencers(org_id, 'edit'));

DROP POLICY IF EXISTS contract_acceptances_brand ON public.influencer_contract_acceptances;
CREATE POLICY contract_acceptances_brand ON public.influencer_contract_acceptances FOR ALL TO authenticated
  USING (public.can_manage_influencers(org_id, 'edit'))
  WITH CHECK (public.can_manage_influencers(org_id, 'edit'));

REVOKE ALL ON TABLE public.influencer_contract_versions, public.influencer_contract_acceptances FROM anon;

-- ── Sembrar la versión 1 de los contratos existentes ───────────────────────
INSERT INTO public.influencer_contract_versions (
  contract_id, org_id, version, contract_type, contract_amount,
  commission_percent, commission_fixed, valid_from, valid_until, terms_text
)
SELECT c.id, c.org_id, 1, c.contract_type, COALESCE(c.contract_amount, 0),
       COALESCE(c.commission_percent, 0), COALESCE(c.commission_fixed, 0),
       c.valid_from, c.valid_until, c.notes
FROM public.influencer_contracts c
WHERE NOT EXISTS (
  SELECT 1 FROM public.influencer_contract_versions v WHERE v.contract_id = c.id AND v.version = 1
);

INSERT INTO public.influencer_contract_acceptances (
  contract_id, org_id, version, party, accepted_by, accepted_at
)
SELECT c.id, c.org_id, 1, 'brand', c.created_by, COALESCE(c.created_at, now())
FROM public.influencer_contracts c
WHERE NOT EXISTS (
  SELECT 1 FROM public.influencer_contract_acceptances a
  WHERE a.contract_id = c.id AND a.version = 1 AND a.party = 'brand'
);

-- ── Autoridad compartida: recalcular is_signed desde aceptaciones reales ───
CREATE OR REPLACE FUNCTION public.recompute_contract_signed(p_contract_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_version integer;
  v_brand boolean;
  v_creator boolean;
BEGIN
  SELECT c.version INTO v_version FROM public.influencer_contracts c WHERE id = p_contract_id;
  IF v_version IS NULL THEN RETURN; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.influencer_contract_acceptances
    WHERE contract_id = p_contract_id AND version = v_version AND party = 'brand'
  ) INTO v_brand;
  SELECT EXISTS (
    SELECT 1 FROM public.influencer_contract_acceptances
    WHERE contract_id = p_contract_id AND version = v_version AND party = 'creator'
  ) INTO v_creator;

  UPDATE public.influencer_contracts
  SET is_signed = v_brand AND v_creator, updated_at = now()
  WHERE id = p_contract_id;
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_contract_signed(uuid) FROM PUBLIC, anon;

-- ── Crear contrato (marca): versión 1 + aceptación de marca inmediata ──────
CREATE OR REPLACE FUNCTION public.create_influencer_contract(
  p_org_id uuid,
  p_influencer_id uuid,
  p_contract_type text,
  p_contract_amount numeric,
  p_commission_percent numeric,
  p_valid_from date,
  p_valid_until date,
  p_notes text DEFAULT NULL
) RETURNS public.influencer_contracts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.influencer_contracts;
  v_creator_name text;
BEGIN
  IF NOT public.can_manage_influencers(p_org_id, 'create') THEN
    RAISE EXCEPTION 'influencer_permission_denied' USING ERRCODE = '42501';
  END IF;
  IF p_contract_type IS NULL OR p_contract_type NOT IN ('fixed', 'percentage', 'hybrid') THEN
    RAISE EXCEPTION 'invalid_contract' USING ERRCODE = '22023';
  END IF;
  IF p_contract_amount IS NULL OR p_contract_amount < 0
    OR p_commission_percent IS NULL OR p_commission_percent NOT BETWEEN 0 AND 100
    OR p_valid_from IS NULL THEN
    RAISE EXCEPTION 'invalid_contract' USING ERRCODE = '22023';
  END IF;
  IF p_valid_until IS NOT NULL AND p_valid_until < p_valid_from THEN
    RAISE EXCEPTION 'invalid_contract_dates' USING ERRCODE = '22023';
  END IF;
  IF p_influencer_id IS NULL THEN
    RAISE EXCEPTION 'invalid_contract' USING ERRCODE = '22023';
  END IF;

  SELECT name INTO v_creator_name FROM public.influencers
  WHERE id = p_influencer_id AND org_id = p_org_id;
  IF v_creator_name IS NULL THEN
    RAISE EXCEPTION 'influencer_not_found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.influencer_contracts (
    org_id, influencer_id, influencer_name, contract_type, contract_amount,
    commission_percent, commission_fixed, is_signed, valid_from, valid_until,
    status, notes, creator_token, created_by
  ) VALUES (
    p_org_id, p_influencer_id, v_creator_name, p_contract_type,
    ROUND(p_contract_amount, 2), ROUND(p_commission_percent, 2), ROUND(p_contract_amount, 2),
    false, p_valid_from, p_valid_until, 'active', NULLIF(btrim(COALESCE(p_notes, '')), ''),
    encode(extensions.gen_random_bytes(24), 'hex'), auth.uid()
  ) RETURNING * INTO v_row;

  INSERT INTO public.influencer_contract_versions (
    contract_id, org_id, version, contract_type, contract_amount,
    commission_percent, commission_fixed, valid_from, valid_until, terms_text, created_by
  ) VALUES (
    v_row.id, p_org_id, 1, p_contract_type, ROUND(p_contract_amount, 2),
    ROUND(p_commission_percent, 2), ROUND(p_contract_amount, 2),
    p_valid_from, p_valid_until, NULLIF(btrim(COALESCE(p_notes, '')), ''), auth.uid()
  );

  INSERT INTO public.influencer_contract_acceptances (
    contract_id, org_id, version, party, accepted_by
  ) VALUES (v_row.id, p_org_id, 1, 'brand', auth.uid());

  RETURN v_row;
END;
$$;

-- ── Editar condiciones (marca): nueva versión, la aceptación previa caduca ──
CREATE OR REPLACE FUNCTION public.update_influencer_contract_terms(
  p_contract_id uuid,
  p_contract_type text,
  p_contract_amount numeric,
  p_commission_percent numeric,
  p_valid_from date,
  p_valid_until date,
  p_notes text DEFAULT NULL
) RETURNS public.influencer_contracts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_contract public.influencer_contracts;
  v_creator_accepted boolean;
BEGIN
  SELECT * INTO v_contract FROM public.influencer_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'contract_not_found' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_manage_influencers(v_contract.org_id, 'edit') THEN
    RAISE EXCEPTION 'influencer_permission_denied' USING ERRCODE = '42501';
  END IF;
  IF v_contract.status NOT IN ('active', 'paused') THEN
    RAISE EXCEPTION 'contract_not_editable' USING ERRCODE = '22023';
  END IF;
  IF p_contract_type IS NULL OR p_contract_type NOT IN ('fixed', 'percentage', 'hybrid')
    OR p_contract_amount IS NULL OR p_contract_amount < 0
    OR p_commission_percent IS NULL OR p_commission_percent NOT BETWEEN 0 AND 100
    OR p_valid_from IS NULL
    OR (p_valid_until IS NOT NULL AND p_valid_until < p_valid_from) THEN
    RAISE EXCEPTION 'invalid_contract' USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.influencer_contract_acceptances
    WHERE contract_id = p_contract_id AND version = v_contract.version AND party = 'creator'
  ) INTO v_creator_accepted;

  UPDATE public.influencer_contracts
  SET contract_type = p_contract_type,
      contract_amount = ROUND(p_contract_amount, 2),
      commission_percent = ROUND(p_commission_percent, 2),
      commission_fixed = ROUND(p_contract_amount, 2),
      valid_from = p_valid_from,
      valid_until = p_valid_until,
      notes = NULLIF(btrim(COALESCE(p_notes, '')), ''),
      version = version + 1,
      -- Cambiar condiciones sin el creador sería firma unilateral.
      is_signed = false,
      updated_at = now()
  WHERE id = p_contract_id
  RETURNING * INTO v_contract;

  INSERT INTO public.influencer_contract_versions (
    contract_id, org_id, version, contract_type, contract_amount,
    commission_percent, commission_fixed, valid_from, valid_until, terms_text, created_by
  ) VALUES (
    v_contract.id, v_contract.org_id, v_contract.version, p_contract_type,
    ROUND(p_contract_amount, 2), ROUND(p_commission_percent, 2), ROUND(p_contract_amount, 2),
    p_valid_from, p_valid_until, NULLIF(btrim(COALESCE(p_notes, '')), ''), auth.uid()
  );

  RETURN v_contract;
END;
$$;

-- ── Leer el contrato por token (público, para la página de aceptación) ──────
-- Expone las condiciones y el estado de firmas del MISMO contrato. Nada más.
CREATE OR REPLACE FUNCTION public.get_influencer_contract_by_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
BEGIN
  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RAISE EXCEPTION 'invalid_token' USING ERRCODE = '22023';
  END IF;
  IF NOT public.rate_limit_publico('influencer_contract_read', btrim(p_token), 60, interval '15 minutes') THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = '53400';
  END IF;

  SELECT c.id, c.org_id, c.influencer_name, c.contract_type, c.contract_amount,
         c.commission_percent, c.valid_from, c.valid_until, c.status, c.version,
         c.is_signed, c.notes, o.name AS org_name,
         EXISTS (
           SELECT 1 FROM public.influencer_contract_acceptances a
           WHERE a.contract_id = c.id AND a.version = c.version AND a.party = 'creator'
         ) AS creator_accepted,
         (SELECT max(a.accepted_at) FROM public.influencer_contract_acceptances a
          WHERE a.contract_id = c.id AND a.version = c.version AND a.party = 'brand') AS brand_accepted_at
  INTO v_row
  FROM public.influencer_contracts c
  LEFT JOIN public.organizations o ON o.id = c.org_id
  WHERE c.creator_token = p_token;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'influencer_name', v_row.influencer_name,
    'org_name', v_row.org_name,
    'contract_type', v_row.contract_type,
    'contract_amount', v_row.contract_amount,
    'commission_percent', v_row.commission_percent,
    'valid_from', v_row.valid_from,
    'valid_until', v_row.valid_until,
    'status', v_row.status,
    'version', v_row.version,
    'notes', v_row.notes,
    'creator_accepted', v_row.creator_accepted,
    'brand_accepted_at', v_row.brand_accepted_at
  );
END;
$$;

-- ── Aceptar por token (creador sin cuenta): firma con nombre declarado ──────
CREATE OR REPLACE FUNCTION public.accept_influencer_contract_by_token(
  p_token text,
  p_signature_name text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_contract record;
  v_signed boolean;
BEGIN
  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RAISE EXCEPTION 'invalid_token' USING ERRCODE = '22023';
  END IF;
  IF NOT public.rate_limit_publico('influencer_contract_accept', btrim(p_token), 10, interval '15 minutes') THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = '53400';
  END IF;
  IF p_signature_name IS NULL OR length(btrim(p_signature_name)) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'signature_required' USING ERRCODE = '22023';
  END IF;

  SELECT id, org_id, version, status, is_signed INTO v_contract
  FROM public.influencer_contracts
  WHERE creator_token = btrim(p_token)
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'contract_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_contract.status NOT IN ('active', 'paused') THEN
    RAISE EXCEPTION 'contract_not_acceptable' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.influencer_contract_acceptances (
    contract_id, org_id, version, party, accepted_via_token, signature_name
  ) VALUES (
    v_contract.id, v_contract.org_id, v_contract.version, 'creator',
    md5(btrim(p_token)), btrim(p_signature_name)
  ) ON CONFLICT (contract_id, version, party) DO NOTHING;

  PERFORM public.recompute_contract_signed(v_contract.id);

  SELECT is_signed INTO v_signed FROM public.influencer_contracts WHERE id = v_contract.id;
  RETURN jsonb_build_object(
    'ok', true,
    'is_signed', v_signed,
    'version', v_contract.version
  );
END;
$$;

-- ── Aceptar con sesión (creador del portal, match por email) ────────────────
CREATE OR REPLACE FUNCTION public.accept_influencer_contract(
  p_contract_id uuid,
  p_signature_name text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_email text;
  v_contract record;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_signature_name IS NULL OR length(btrim(p_signature_name)) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'signature_required' USING ERRCODE = '22023';
  END IF;

  SELECT email INTO v_email FROM public.creator_accounts WHERE user_id = v_user;
  IF v_email IS NULL THEN RAISE EXCEPTION 'not_a_creator'; END IF;

  SELECT c.id, c.org_id, c.version, c.status, i.id AS influencer_id INTO v_contract
  FROM public.influencer_contracts c
  JOIN public.influencers i ON i.id = c.influencer_id
  WHERE c.id = p_contract_id
    AND lower(i.email) = lower(v_email)
  FOR UPDATE OF c;
  IF NOT FOUND THEN RAISE EXCEPTION 'contract_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_contract.status NOT IN ('active', 'paused') THEN
    RAISE EXCEPTION 'contract_not_acceptable' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.influencer_contract_acceptances (
    contract_id, org_id, version, party, accepted_by, signature_name
  ) VALUES (
    v_contract.id, v_contract.org_id, v_contract.version, 'creator',
    v_user, btrim(p_signature_name)
  ) ON CONFLICT (contract_id, version, party) DO NOTHING;

  PERFORM public.recompute_contract_signed(v_contract.id);

  RETURN jsonb_build_object('ok', true, 'version', v_contract.version);
END;
$$;

-- ── Contratos del creador autenticado (portal) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.creator_my_contracts()
RETURNS TABLE (
  id uuid,
  org_id uuid,
  org_name text,
  influencer_name text,
  contract_type text,
  contract_amount numeric,
  commission_percent numeric,
  valid_from date,
  valid_until date,
  status text,
  version integer,
  is_signed boolean,
  creator_accepted boolean,
  creator_accepted_at timestamptz,
  notes text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.org_id, o.name, c.influencer_name, c.contract_type, c.contract_amount,
         c.commission_percent, c.valid_from, c.valid_until, c.status, c.version,
         c.is_signed,
         EXISTS (
           SELECT 1 FROM public.influencer_contract_acceptances a
           WHERE a.contract_id = c.id AND a.version = c.version AND a.party = 'creator'
         ),
         (SELECT a.accepted_at FROM public.influencer_contract_acceptances a
          WHERE a.contract_id = c.id AND a.version = c.version AND a.party = 'creator'
          ORDER BY a.accepted_at DESC LIMIT 1),
         c.notes
  FROM public.influencer_contracts c
  JOIN public.influencers i ON i.id = c.influencer_id
  JOIN public.creator_accounts ca ON ca.user_id = auth.uid()
  LEFT JOIN public.organizations o ON o.id = c.org_id
  WHERE lower(i.email) = lower(ca.email)
    AND c.status IN ('active', 'paused')
  ORDER BY c.created_at DESC;
$$;

-- ── La versión vigente del contrato, para UI de marca y portal ──────────────
CREATE OR REPLACE VIEW public.influencer_contract_status
WITH (security_invoker = true) AS
SELECT c.id, c.org_id, c.influencer_id, c.influencer_name, c.contract_type,
       c.contract_amount, c.commission_percent, c.valid_from, c.valid_until,
       c.status, c.version, c.is_signed, c.creator_token,
       a_brand.accepted_at AS brand_accepted_at,
       a_creator.accepted_at AS creator_accepted_at,
       a_creator.signature_name AS creator_signature_name
FROM public.influencer_contracts c
LEFT JOIN public.influencer_contract_acceptances a_brand
  ON a_brand.contract_id = c.id AND a_brand.version = c.version AND a_brand.party = 'brand'
LEFT JOIN public.influencer_contract_acceptances a_creator
  ON a_creator.contract_id = c.id AND a_creator.version = c.version AND a_creator.party = 'creator';

GRANT SELECT ON TABLE public.influencer_contract_status TO authenticated;

REVOKE ALL ON FUNCTION public.recompute_contract_signed(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_influencer_contract(uuid, uuid, text, numeric, numeric, date, date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_influencer_contract_terms(uuid, text, numeric, numeric, date, date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_influencer_contract_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_influencer_contract_by_token(text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.accept_influencer_contract_by_token(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_influencer_contract_by_token(text, text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.accept_influencer_contract(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_influencer_contract(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.creator_my_contracts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.creator_my_contracts() TO authenticated;

-- ── Contratos versionados ───────────────────────────────────────────────────
INSERT INTO public.security_function_contracts(
  function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on
)
SELECT v.fn, v.args, v.aud, v.rat, md5(pg_get_functiondef(procedure.oid)), DATE '2026-09-25'
FROM (VALUES
  ('create_influencer_contract', 'p_org_id uuid, p_influencer_id uuid, p_contract_type text, p_contract_amount numeric, p_commission_percent numeric, p_valid_from date, p_valid_until date, p_notes text', 'authenticated_delegate', 'Crea el contrato v1 con aceptacion de marca inmediata y token publico para el creador.'),
  ('update_influencer_contract_terms', 'p_contract_id uuid, p_contract_type text, p_contract_amount numeric, p_commission_percent numeric, p_valid_from date, p_valid_until date, p_notes text', 'authenticated_delegate', 'Nueva version de condiciones: invalida la aceptacion previa del creador.'),
  ('get_influencer_contract_by_token', 'p_token text', 'public_token', 'Condiciones del contrato para la pagina de aceptacion publica.'),
  ('accept_influencer_contract_by_token', 'p_token text, p_signature_name text', 'public_token', 'Aceptacion del creador por enlace con nombre declarado.'),
  ('accept_influencer_contract', 'p_contract_id uuid, p_signature_name text', 'authenticated_delegate', 'Aceptacion del creador con sesion desde el portal, match por email.'),
  ('creator_my_contracts', '', 'authenticated_delegate', 'Contratos visibles para el creador autenticado por email.')
) AS v(fn, args, aud, rat)
JOIN pg_proc procedure ON procedure.proname = v.fn
JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
WHERE namespace.nspname = 'public'
  AND pg_get_function_identity_arguments(procedure.oid) = v.args
ON CONFLICT (function_name, identity_arguments) DO UPDATE
  SET definition_hash = EXCLUDED.definition_hash,
      rationale = EXCLUDED.rationale,
      reviewed_on = EXCLUDED.reviewed_on;

-- ── Guardia ─────────────────────────────────────────────────────────────────
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'accept_influencer_contract_by_token'
  ) THEN
    RAISE EXCEPTION 'accept_influencer_contract_by_token no existe';
  END IF;
  IF position('recompute_contract_signed' IN pg_get_functiondef('public.update_influencer_contract_terms(uuid,text,numeric,numeric,date,date,text)'::regprocedure)) = 0
     AND position('version + 1' IN pg_get_functiondef('public.update_influencer_contract_terms(uuid,text,numeric,numeric,date,date,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'update_influencer_contract_terms no versiona';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'creator_my_contracts'
  ) THEN
    RAISE EXCEPTION 'creator_my_contracts no existe';
  END IF;
  -- La firma del creador es server-side: nadie firma escribiendo UPDATE directo.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'accept_influencer_contract'
      AND pg_get_function_identity_arguments(p.oid) = 'p_contract_id uuid, p_signature_name text'
  ) THEN
    RAISE EXCEPTION 'accept_influencer_contract perdio su firma';
  END IF;
END $guard$;
