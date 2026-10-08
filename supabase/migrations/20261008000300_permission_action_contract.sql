BEGIN;

-- Preserve current role overrides; malformed requests never inherit defaults.
CREATE OR REPLACE FUNCTION public.has_permission(p_org_id uuid, p_module text, p_action text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
  v_result boolean;
BEGIN
  IF auth.uid() IS NULL OR p_org_id IS NULL OR p_module IS NULL
    OR btrim(p_module) = '' OR p_action IS NULL
    OR p_action NOT IN ('view','create','edit','delete','export') THEN
    RETURN false;
  END IF;
  SELECT role INTO v_role FROM public.memberships
    WHERE org_id = p_org_id AND user_id = auth.uid();
  IF v_role IS NULL THEN RETURN false; END IF;

  SELECT CASE p_action
    WHEN 'view' THEN can_view WHEN 'create' THEN can_create
    WHEN 'edit' THEN can_edit WHEN 'delete' THEN can_delete
    WHEN 'export' THEN can_export ELSE false END
  INTO v_result FROM public.role_permissions
  WHERE org_id = p_org_id
    AND role = CASE WHEN v_role IN ('owner','admin') THEN 'admin' ELSE v_role END
    AND module = p_module;

  IF v_result IS NOT NULL THEN RETURN v_result; END IF;
  RETURN CASE
    WHEN v_role IN ('owner','admin') THEN true
    WHEN v_role = 'vendedor' AND p_action IN ('view','create') THEN true
    WHEN v_role = 'viewer' AND p_action = 'view' THEN true
    ELSE false END;
END $$;

-- CREATE OR REPLACE preserves existing ACLs and every legitimate caller.
UPDATE public.security_function_contracts
SET definition_hash = md5(pg_get_functiondef('public.has_permission(uuid,text,text)'::regprocedure)),
  reviewed_on = DATE '2026-10-08'
WHERE function_name = 'has_permission';
COMMIT;
