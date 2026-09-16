-- Products use the same action permissions as navigation and the editor.
-- Membership remains mandatory; platform staff does not inherit tenant access.
BEGIN;
DROP POLICY IF EXISTS "Org members read products" ON public.products;
DROP POLICY IF EXISTS "Org admins manage products" ON public.products;
DROP POLICY IF EXISTS "Org admins update products" ON public.products;
DROP POLICY IF EXISTS "Org admins delete products" ON public.products;

CREATE POLICY "Org members read products" ON public.products FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()) AND public.has_permission(org_id, 'products', 'view'));
CREATE POLICY "Org admins manage products" ON public.products FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(org_id, auth.uid()) AND user_id = auth.uid()
    AND public.has_permission(org_id, 'products', 'view') AND public.has_permission(org_id, 'products', 'create'));
CREATE POLICY "Org admins update products" ON public.products FOR UPDATE TO authenticated
  USING (public.is_org_member(org_id, auth.uid()) AND public.has_permission(org_id, 'products', 'view') AND public.has_permission(org_id, 'products', 'edit'))
  WITH CHECK (public.is_org_member(org_id, auth.uid()) AND public.has_permission(org_id, 'products', 'view') AND public.has_permission(org_id, 'products', 'edit'));
CREATE POLICY "Org admins delete products" ON public.products FOR DELETE TO authenticated
  USING (public.is_org_member(org_id, auth.uid()) AND public.has_permission(org_id, 'products', 'view') AND public.has_permission(org_id, 'products', 'delete'));
COMMIT;
