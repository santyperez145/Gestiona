-- ============================================================================
-- generate_po_number: numeración correlativa de órdenes de compra
-- ============================================================================
-- PurchaseOrdersPage llama a este RPC al crear una orden. Sigue el mismo
-- patrón que next_quote_number (secuencia por org, sin huecos ni choques).

CREATE TABLE IF NOT EXISTS public.po_sequences (
  org_id      UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  last_number INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE public.po_sequences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org read po_sequences" ON public.po_sequences;
CREATE POLICY "org read po_sequences" ON public.po_sequences FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));

CREATE OR REPLACE FUNCTION public.generate_po_number(p_org_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next integer;
BEGIN
  INSERT INTO public.po_sequences (org_id, last_number) VALUES (p_org_id, 1)
  ON CONFLICT (org_id) DO UPDATE SET last_number = po_sequences.last_number + 1
  RETURNING last_number INTO v_next;
  RETURN 'OC-' || LPAD(v_next::text, 4, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_po_number(uuid) TO authenticated;
