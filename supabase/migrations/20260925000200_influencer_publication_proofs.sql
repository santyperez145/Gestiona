-- ============================================================================
-- Fila 11 (paridad GoMarz): publicación verificable del entregable.
--
-- El loop marca↔creador ya cierra entrega → revisión → aprobación, pero no
-- deja evidencia de la publicación real ni de los derechos de uso acordados.
-- Este lote agrega:
--   1. `influencer_publication_proofs`: una fila por publicación verificada
--      (URL + captura + plataforma + fecha), validada por trigger contra la
--      asignación creador↔campaña y estados del entregable.
--   2. Derechos de uso versionados: cada fila registra license_type,
--      license_expires_at y note el otorgamiento. Al re-verificar se conserva
--      el historial (no se sobreescribe).
--   3. RPC `register_publication_proof` (marca) y vista del creador vía
--      `creator_campaigns` extendida con publication_url/proof_status.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.influencer_publication_proofs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES public.influencer_campaigns(id) ON DELETE SET NULL,
  deliverable_id uuid NOT NULL REFERENCES public.influencer_deliverables(id) ON DELETE CASCADE,
  influencer_id uuid NOT NULL REFERENCES public.influencers(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('instagram', 'tiktok', 'youtube', 'otro')),
  publication_url text NOT NULL,
  screenshot_url text,
  license_type text NOT NULL DEFAULT 'uso_campaña'
    CHECK (license_type IN ('organico', 'uso_campaña', 'paid_ampliado', 'cesion_total')),
  license_expires_at date,
  license_notes text CHECK (length(license_notes) <= 2000),
  verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT publication_url_https CHECK (publication_url ~ '^https://[^[:space:]]+$'),
  CONSTRAINT screenshot_url_https CHECK (screenshot_url IS NULL OR screenshot_url ~ '^https://[^[:space:]]+$'),
  CONSTRAINT licencia_coherente CHECK (
    license_type IN ('organico', 'uso_campaña') OR license_expires_at IS NOT NULL
  )
);

-- Historial real: cada verificación es una fila nueva; el índice acelera la
-- consulta del portal (último estado por entregable) y del panel de marca.
CREATE INDEX IF NOT EXISTS idx_pub_proofs_deliverable
  ON public.influencer_publication_proofs(deliverable_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pub_proofs_org
  ON public.influencer_publication_proofs(org_id, created_at DESC);

ALTER TABLE public.influencer_publication_proofs ENABLE ROW LEVEL SECURITY;

-- La marca con permiso de edición gestiona sus pruebas de publicación.
DROP POLICY IF EXISTS pub_proofs_org_manage ON public.influencer_publication_proofs;
CREATE POLICY pub_proofs_org_manage ON public.influencer_publication_proofs
  FOR ALL TO authenticated
  USING (public.can_manage_influencers(org_id, 'edit'))
  WITH CHECK (public.can_manage_influencers(org_id, 'edit'));

REVOKE ALL ON TABLE public.influencer_publication_proofs FROM anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.influencer_publication_proofs TO authenticated;

-- ── Trigger: integridad del proof contra el entregable ─────────────────────
-- El proof debe pertenecer a la misma org/campaña del entregable y el
-- entregable debe estar entregado o aprobado (no se verifica lo no entregado).
CREATE OR REPLACE FUNCTION public.validate_publication_proof()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_deliverable record;
BEGIN
  SELECT org_id, influencer_id, campaign_id, status INTO v_deliverable
  FROM public.influencer_deliverables
  WHERE id = NEW.deliverable_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'deliverable_not_found'; END IF;
  IF v_deliverable.org_id <> NEW.org_id THEN
    RAISE EXCEPTION 'org_mismatch'; END IF;
  IF NEW.influencer_id <> v_deliverable.influencer_id THEN
    RAISE EXCEPTION 'influencer_mismatch'; END IF;
  IF v_deliverable.status NOT IN ('entregado', 'completado') THEN
    RAISE EXCEPTION 'deliverable_not_submitted'; END IF;
  IF NEW.campaign_id IS DISTINCT FROM v_deliverable.campaign_id THEN
    NEW.campaign_id := v_deliverable.campaign_id;
  END IF;

  NEW.verified_by := auth.uid();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_publication_proof() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_validate_publication_proof
  BEFORE INSERT ON public.influencer_publication_proofs
  FOR EACH ROW EXECUTE FUNCTION public.validate_publication_proof();

-- ── RPC: registrar la verificación desde el panel de marca ─────────────────
CREATE OR REPLACE FUNCTION public.register_publication_proof(
  p_deliverable_id uuid,
  p_platform text,
  p_publication_url text,
  p_license_type text DEFAULT 'uso_campaña',
  p_license_expires_at date DEFAULT NULL,
  p_license_notes text DEFAULT NULL,
  p_screenshot_url text DEFAULT NULL
)
RETURNS public.influencer_publication_proofs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org uuid;
  v_row public.influencer_publication_proofs;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  IF p_platform NOT IN ('instagram', 'tiktok', 'youtube', 'otro') THEN
    RAISE EXCEPTION 'invalid_platform' USING ERRCODE = '22023'; END IF;
  IF p_publication_url IS NULL OR p_publication_url !~ '^https://[^[:space:]]+$' THEN
    RAISE EXCEPTION 'invalid_url' USING ERRCODE = '22023'; END IF;
  IF p_license_type NOT IN ('organico', 'uso_campaña', 'paid_ampliado', 'cesion_total') THEN
    RAISE EXCEPTION 'invalid_license' USING ERRCODE = '22023'; END IF;
  IF p_license_type IN ('paid_ampliado', 'cesion_total')
     AND (p_license_expires_at IS NULL OR p_license_expires_at < CURRENT_DATE) THEN
    RAISE EXCEPTION 'license_expiry_required' USING ERRCODE = '22023';
  END IF;
  IF p_screenshot_url IS NOT NULL AND p_screenshot_url !~ '^https://[^[:space:]]+$' THEN
    RAISE EXCEPTION 'invalid_screenshot' USING ERRCODE = '22023'; END IF;
  IF p_license_notes IS NOT NULL AND length(p_license_notes) > 2000 THEN
    RAISE EXCEPTION 'invalid_notes' USING ERRCODE = '22023'; END IF;

  SELECT d.org_id INTO v_org
  FROM public.influencer_deliverables d
  WHERE d.id = p_deliverable_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'deliverable_not_found' USING ERRCODE = '22023'; END IF;

  IF NOT public.can_manage_influencers(v_org, 'edit') THEN
    RAISE EXCEPTION 'influencer_permission_denied' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.influencer_publication_proofs (
    org_id, campaign_id, deliverable_id, influencer_id, platform,
    publication_url, screenshot_url, license_type, license_expires_at, license_notes
  )
  SELECT d.org_id, d.campaign_id, d.id, d.influencer_id, p_platform,
         p_publication_url, p_screenshot_url, p_license_type, p_license_expires_at, p_license_notes
  FROM public.influencer_deliverables d
  WHERE d.id = p_deliverable_id
    AND d.status IN ('entregado', 'completado')
  RETURNING * INTO v_row;

  IF NOT FOUND THEN RAISE EXCEPTION 'deliverable_not_submitted' USING ERRCODE = '22023'; END IF;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.register_publication_proof(uuid, text, text, text, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_publication_proof(uuid, text, text, text, date, text, text) TO authenticated;

INSERT INTO public.security_function_contracts(
  function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on
)
SELECT
  'register_publication_proof',
  'p_deliverable_id uuid, p_platform text, p_publication_url text, p_license_type text, p_license_expires_at date, p_license_notes text, p_screenshot_url text',
  'authenticated_delegate',
  'La marca verifica la publicación real del entregable con derechos de uso versionados; el servidor valida permiso, estado y URLs.',
  md5(pg_get_functiondef(procedure.oid)), DATE '2026-09-25'
FROM pg_proc procedure
JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
WHERE namespace.nspname = 'public'
  AND procedure.proname = 'register_publication_proof'
  AND pg_get_function_identity_arguments(procedure.oid) =
    'p_deliverable_id uuid, p_platform text, p_publication_url text, p_license_type text, p_license_expires_at date, p_license_notes text, p_screenshot_url text'
ON CONFLICT (function_name, identity_arguments) DO UPDATE SET
  audience = EXCLUDED.audience,
  rationale = EXCLUDED.rationale,
  definition_hash = EXCLUDED.definition_hash,
  reviewed_on = EXCLUDED.reviewed_on;

-- ── Portal del creador: ver la verificación de su publicación ──────────────
-- Cambia la firma de salida, requiere DROP previo (el ALTER de OUT params no).
DROP FUNCTION IF EXISTS public.creator_campaigns();
CREATE OR REPLACE FUNCTION public.creator_campaigns()
RETURNS TABLE (
  id uuid,
  org_id uuid,
  org_name text,
  title text,
  brief text,
  channel text,
  due_date date,
  status text,
  budget_ars numeric,
  invitation_status text,
  deliverable_url text,
  deliverable_status text,
  publication_url text,
  publication_platform text,
  publication_verified_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.org_id, o.name, c.title, c.brief, c.channel, c.due_date,
         c.status, c.budget_ars,
         (SELECT ii.status FROM public.influencer_invitations ii
          WHERE ii.campaign_id = c.id AND lower(ii.email) = lower(ca.email)
          ORDER BY ii.created_at DESC LIMIT 1),
         (SELECT d.content_url FROM public.influencer_deliverables d
          WHERE d.campaign_id = c.id AND d.influencer_id = i.id
          ORDER BY d.created_at DESC LIMIT 1),
         (SELECT d.status FROM public.influencer_deliverables d
          WHERE d.campaign_id = c.id AND d.influencer_id = i.id
          ORDER BY d.created_at DESC LIMIT 1),
         proof.publication_url,
         proof.platform,
         proof.verified_at
  FROM public.influencer_campaigns c
  JOIN public.influencers i ON i.org_id = c.org_id
  JOIN public.creator_accounts ca ON ca.user_id = auth.uid()
  LEFT JOIN public.organizations o ON o.id = c.org_id
  LEFT JOIN LATERAL (
    SELECT pp.publication_url, pp.platform, pp.created_at AS verified_at
    FROM public.influencer_publication_proofs pp
    WHERE pp.campaign_id = c.id AND pp.influencer_id = i.id
    ORDER BY pp.created_at DESC LIMIT 1
  ) proof ON true
  WHERE lower(i.email) = lower(ca.email)
    AND EXISTS (SELECT 1 FROM public.influencer_campaign_creators cc
                WHERE cc.campaign_id = c.id AND cc.influencer_id = i.id)
  ORDER BY c.due_date NULLS LAST, c.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.creator_campaigns() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.creator_campaigns() TO authenticated;

-- ── Certificación ───────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'register_publication_proof') THEN
    RAISE EXCEPTION 'register_publication_proof no existe';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute a
    JOIN pg_class t ON a.attrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public' AND t.relname = 'influencer_publication_proofs'
      AND a.attname = 'license_type'
  ) THEN
    RAISE EXCEPTION 'influencer_publication_proofs incompleta';
  END IF;
END;
$$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260925000200', 'influencer_publication_proofs')
ON CONFLICT DO NOTHING;
