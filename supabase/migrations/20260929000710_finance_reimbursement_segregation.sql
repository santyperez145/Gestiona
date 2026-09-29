-- Segregacion pragmatica: si hay otro owner/admin, el solicitante no puede
-- aprobar su propio reembolso. Una organizacion unipersonal sigue operativa.

CREATE OR REPLACE FUNCTION public.finance_require_reimbursement_evidence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.request_kind = 'reimbursement'
     AND OLD.status IS DISTINCT FROM 'approved'
     AND NEW.status = 'approved'
     AND NEW.approved_by = NEW.user_id
     AND EXISTS (
       SELECT 1 FROM public.memberships membership
       WHERE membership.org_id = NEW.org_id
         AND membership.user_id <> NEW.user_id
         AND membership.role IN ('owner', 'admin')
     ) THEN
    RAISE EXCEPTION 'Otro responsable debe aprobar este reembolso' USING ERRCODE = '42501';
  END IF;

  IF NEW.request_kind = 'reimbursement' AND NEW.status = 'paid'
     AND (NEW.payment_reference IS NULL OR NEW.paid_at IS NULL) THEN
    RAISE EXCEPTION 'Un reembolso requiere referencia y fecha de pago' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$fn$;
