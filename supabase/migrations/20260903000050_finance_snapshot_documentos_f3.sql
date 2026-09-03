-- Finance Pulse: el KPI «documentos por revisar» debe contar la bandeja F3,
-- no la tabla legacy ocr_documents (Core/compras). Mentir el número manda al
-- comercio a una cola vacía o esconde trabajo real (Mendel: evidencia).

CREATE OR REPLACE FUNCTION public.finance_core_snapshot(p_org_id uuid)
RETURNS TABLE (
  suppliers_count bigint,
  open_purchase_orders bigint,
  open_payables_count bigint,
  open_payables_ars numeric,
  ledger_entries_count bigint,
  precursor_ocr_documents bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_access record;
BEGIN
  SELECT * INTO v_access
  FROM public.product_surface_access(p_org_id, 'finance');

  IF NOT COALESCE(v_access.allowed, false) THEN
    RAISE EXCEPTION 'Finance no está habilitado para esta sesión'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT
    (SELECT count(*) FROM public.suppliers s WHERE s.org_id = p_org_id AND s.active),
    (SELECT count(*) FROM public.purchase_orders po WHERE po.org_id = p_org_id AND po.status NOT IN ('received', 'cancelled')),
    (SELECT count(*) FROM public.supplier_debts sd WHERE sd.org_id = p_org_id AND sd.status IN ('pending', 'partial')),
    (SELECT COALESCE(sum(sd.remaining_ars), 0) FROM public.supplier_debts sd WHERE sd.org_id = p_org_id AND sd.status IN ('pending', 'partial')),
    (SELECT count(*) FROM public.ledger_entries le WHERE le.org_id = p_org_id),
    -- Nombre histórico de columna; el valor es finance_documents abiertos (F3).
    (SELECT count(*) FROM public.finance_documents fd
      WHERE fd.org_id = p_org_id
        AND fd.status IS DISTINCT FROM 'approved');
END;
$fn$;

COMMENT ON FUNCTION public.finance_core_snapshot(uuid) IS
  'Snapshot agregado del Core + documentos Finance F3 abiertos (precursor_ocr_documents = finance_documents ≠ approved). No crea un Core paralelo.';

DO $guard$
BEGIN
  IF position('finance_documents' IN pg_get_functiondef('public.finance_core_snapshot(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'finance_core_snapshot no cuenta finance_documents';
  END IF;
  IF pg_get_functiondef('public.finance_core_snapshot(uuid)'::regprocedure) ~ 'ocr_documents\s+(od|o)\b' THEN
    RAISE EXCEPTION 'finance_core_snapshot sigue leyendo ocr_documents legacy';
  END IF;
END;
$guard$;
