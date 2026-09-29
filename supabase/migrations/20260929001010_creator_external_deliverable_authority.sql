BEGIN;

CREATE OR REPLACE FUNCTION public.creator_submit_deliverable(
  p_campaign_id uuid,
  p_campaign_name text,
  p_description text,
  p_content_url text
)
RETURNS public.influencer_deliverables
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_user uuid := auth.uid();
  v_campaign public.influencer_campaigns%ROWTYPE;
  v_influencer public.influencers%ROWTYPE;
  v_row public.influencer_deliverables%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Iniciá sesión para entregar contenido' USING ERRCODE = '42501'; END IF;
  IF p_content_url IS NULL OR p_content_url !~ '^https://[^[:space:]]+$' THEN
    RAISE EXCEPTION 'El enlace debe ser una URL HTTPS válida' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(COALESCE(p_description, '')), '') IS NULL OR char_length(p_description) > 4000 THEN
    RAISE EXCEPTION 'La descripción es obligatoria y admite hasta 4000 caracteres' USING ERRCODE = '22023';
  END IF;

  SELECT campaign.* INTO v_campaign
  FROM public.influencer_campaigns campaign
  WHERE campaign.id = p_campaign_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Campaña no encontrada' USING ERRCODE = 'P0002'; END IF;

  SELECT influencer.* INTO v_influencer
  FROM public.influencers influencer
  JOIN public.creator_accounts account ON account.user_id = v_user
  JOIN public.influencer_campaign_creators assignment
    ON assignment.org_id = influencer.org_id
   AND assignment.campaign_id = p_campaign_id
   AND assignment.influencer_id = influencer.id
  WHERE influencer.org_id = v_campaign.org_id
    AND lower(influencer.email) = lower(account.email)
  LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'No estás asignado a esta campaña' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.influencer_invitations invitation
    JOIN public.creator_accounts account ON account.user_id = v_user
    WHERE invitation.campaign_id = p_campaign_id
      AND lower(invitation.email) = lower(account.email)
      AND invitation.status = 'accepted'
  ) THEN
    RAISE EXCEPTION 'Aceptá la invitación antes de entregar contenido' USING ERRCODE = '55000';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_campaign_id::text || v_influencer.id::text, 0));
  SELECT deliverable.* INTO v_row
  FROM public.influencer_deliverables deliverable
  WHERE deliverable.campaign_id = p_campaign_id
    AND deliverable.influencer_id = v_influencer.id
  ORDER BY deliverable.created_at DESC, deliverable.id DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND AND v_row.status = 'completado' THEN
    RAISE EXCEPTION 'El entregable ya fue aprobado y no admite reemplazos' USING ERRCODE = '55000';
  END IF;
  IF FOUND AND v_row.status = 'entregado' THEN
    RAISE EXCEPTION 'La última versión todavía está en revisión' USING ERRCODE = '55000';
  END IF;

  IF NOT FOUND THEN
    INSERT INTO public.influencer_deliverables(
      org_id, influencer_id, influencer_name, campaign_id, campaign_name,
      description, due_date, content_url, status, delivery_date
    ) VALUES (
      v_campaign.org_id, v_influencer.id, v_influencer.name, v_campaign.id, v_campaign.title,
      btrim(p_description), COALESCE(v_campaign.due_date, current_date + 14), p_content_url, 'entregado', now()
    ) RETURNING * INTO v_row;
  ELSE
    UPDATE public.influencer_deliverables
    SET campaign_name = v_campaign.title,
        description = btrim(p_description),
        content_url = p_content_url,
        status = 'entregado',
        delivery_date = now()
    WHERE id = v_row.id
    RETURNING * INTO v_row;
  END IF;

  RETURN v_row;
END;
$fn$;

REVOKE ALL ON FUNCTION public.creator_submit_deliverable(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.creator_submit_deliverable(uuid, text, text, text) TO authenticated;

-- Sólo una operación con rol de servicio puede purgar metadatos luego de la
-- retención. Los usuarios y administradores de marca no pueden borrar versiones.
CREATE OR REPLACE FUNCTION public.influencer_deliverable_files_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF auth.role() = 'service_role' AND OLD.retention_until <= current_date THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Las versiones de entregables están protegidas durante su retención' USING ERRCODE = '55000';
  END IF;
  IF OLD.org_id IS DISTINCT FROM NEW.org_id
     OR OLD.campaign_id IS DISTINCT FROM NEW.campaign_id
     OR OLD.deliverable_id IS DISTINCT FROM NEW.deliverable_id
     OR OLD.influencer_id IS DISTINCT FROM NEW.influencer_id
     OR OLD.version_number IS DISTINCT FROM NEW.version_number
     OR OLD.storage_path IS DISTINCT FROM NEW.storage_path
     OR OLD.original_filename IS DISTINCT FROM NEW.original_filename
     OR OLD.mime_type IS DISTINCT FROM NEW.mime_type
     OR OLD.size_bytes IS DISTINCT FROM NEW.size_bytes
     OR OLD.sha256 IS DISTINCT FROM NEW.sha256
     OR OLD.retention_until IS DISTINCT FROM NEW.retention_until
     OR OLD.created_by IS DISTINCT FROM NEW.created_by
     OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'La evidencia original de una versión no se puede editar' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$fn$;

UPDATE public.security_function_contracts contract
SET rationale = 'Entrega un enlace externo sólo para el creador asignado que aceptó la campaña; conserva revisión y reentrega sobre el mismo expediente.',
    definition_hash = md5(pg_get_functiondef(procedure.oid)),
    reviewed_on = DATE '2026-09-29'
FROM pg_proc procedure
JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
WHERE contract.function_name = 'creator_submit_deliverable'
  AND contract.identity_arguments = 'p_campaign_id uuid, p_campaign_name text, p_description text, p_content_url text'
  AND namespace.nspname = 'public'
  AND procedure.proname = 'creator_submit_deliverable'
  AND pg_get_function_identity_arguments(procedure.oid) = contract.identity_arguments;

COMMIT;
