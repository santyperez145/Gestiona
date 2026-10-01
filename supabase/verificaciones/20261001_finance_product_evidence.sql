-- Read-only adoption evidence; counts do not certify provider calls or bank payments.
SELECT jsonb_build_object(
  'measured_at', current_date,
  'finance_documents', (SELECT count(*) FROM public.finance_documents),
  'document_states', (SELECT coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
    FROM (SELECT status, count(*) n FROM public.finance_documents GROUP BY status) s),
  'approval_policies', (SELECT count(*) FROM public.finance_approval_policies),
  'export_batches', (SELECT count(*) FROM public.finance_export_batches)
) AS adoption_evidence;
