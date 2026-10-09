BEGIN;

-- Tipos y atributos no son una segunda matriz de permisos: usan exactamente
-- products.view/edit/create de la autoridad existente. El cajero con permiso
-- sales.create puede leer la estructura descriptiva que necesita para vender.
-- is_org_member añade la condición de membresía activa: has_permission por sí
-- solo todavía puede resolver un override de una membresía suspendida.
-- Ningún claim JWT service_role sustituye al rol PostgreSQL real del servidor.

DROP POLICY IF EXISTS product_types_org_access ON public.product_types;
DROP POLICY IF EXISTS attribute_definitions_org_access ON public.attribute_definitions;
DROP POLICY IF EXISTS product_attribute_values_org_access ON public.product_attribute_values;

DROP POLICY IF EXISTS product_types_read ON public.product_types;
CREATE POLICY product_types_read ON public.product_types FOR SELECT TO authenticated
USING (public.is_org_member(org_id, auth.uid()) AND (
  public.has_permission(org_id, 'products', 'view') OR public.has_permission(org_id, 'sales', 'create')
));
DROP POLICY IF EXISTS product_types_insert ON public.product_types;
CREATE POLICY product_types_insert ON public.product_types FOR INSERT TO authenticated
WITH CHECK (public.is_org_member(org_id, auth.uid()) AND public.has_permission(org_id, 'products', 'edit'));
DROP POLICY IF EXISTS product_types_update ON public.product_types;
CREATE POLICY product_types_update ON public.product_types FOR UPDATE TO authenticated
USING (public.is_org_member(org_id, auth.uid()) AND public.has_permission(org_id, 'products', 'edit'))
WITH CHECK (public.is_org_member(org_id, auth.uid()) AND public.has_permission(org_id, 'products', 'edit'));
DROP POLICY IF EXISTS product_types_delete ON public.product_types;
CREATE POLICY product_types_delete ON public.product_types FOR DELETE TO authenticated
USING (public.is_org_member(org_id, auth.uid()) AND public.has_permission(org_id, 'products', 'edit'));

DROP POLICY IF EXISTS attribute_definitions_read ON public.attribute_definitions;
CREATE POLICY attribute_definitions_read ON public.attribute_definitions FOR SELECT TO authenticated
USING (public.is_org_member(org_id, auth.uid()) AND (
  public.has_permission(org_id, 'products', 'view') OR public.has_permission(org_id, 'sales', 'create')
));
DROP POLICY IF EXISTS attribute_definitions_insert ON public.attribute_definitions;
CREATE POLICY attribute_definitions_insert ON public.attribute_definitions FOR INSERT TO authenticated
WITH CHECK (
  public.is_org_member(org_id, auth.uid()) AND public.has_permission(org_id, 'products', 'edit')
  AND EXISTS (SELECT 1 FROM public.product_types product_type
    WHERE product_type.id = attribute_definitions.product_type_id
      AND product_type.org_id = attribute_definitions.org_id)
);
DROP POLICY IF EXISTS attribute_definitions_update ON public.attribute_definitions;
CREATE POLICY attribute_definitions_update ON public.attribute_definitions FOR UPDATE TO authenticated
USING (public.is_org_member(org_id, auth.uid()) AND public.has_permission(org_id, 'products', 'edit'))
WITH CHECK (
  public.is_org_member(org_id, auth.uid()) AND public.has_permission(org_id, 'products', 'edit')
  AND EXISTS (SELECT 1 FROM public.product_types product_type
    WHERE product_type.id = attribute_definitions.product_type_id
      AND product_type.org_id = attribute_definitions.org_id)
);
DROP POLICY IF EXISTS attribute_definitions_delete ON public.attribute_definitions;
CREATE POLICY attribute_definitions_delete ON public.attribute_definitions FOR DELETE TO authenticated
USING (public.is_org_member(org_id, auth.uid()) AND public.has_permission(org_id, 'products', 'edit'));

DROP POLICY IF EXISTS product_attribute_values_read ON public.product_attribute_values;
CREATE POLICY product_attribute_values_read ON public.product_attribute_values FOR SELECT TO authenticated
USING (public.is_org_member(org_id, auth.uid()) AND (
  public.has_permission(org_id, 'products', 'view') OR public.has_permission(org_id, 'sales', 'create')
));
DROP POLICY IF EXISTS product_attribute_values_insert ON public.product_attribute_values;
CREATE POLICY product_attribute_values_insert ON public.product_attribute_values FOR INSERT TO authenticated
WITH CHECK (public.is_org_member(org_id, auth.uid()) AND (
  public.has_permission(org_id, 'products', 'edit') OR (
    public.has_permission(org_id, 'products', 'create')
    AND EXISTS (SELECT 1 FROM public.products product
      WHERE product.id = product_attribute_values.product_id
        AND product.org_id = product_attribute_values.org_id
        AND product.user_id = auth.uid())
  )
));
DROP POLICY IF EXISTS product_attribute_values_update ON public.product_attribute_values;
CREATE POLICY product_attribute_values_update ON public.product_attribute_values FOR UPDATE TO authenticated
USING (public.is_org_member(org_id, auth.uid()) AND public.has_permission(org_id, 'products', 'edit'))
WITH CHECK (public.is_org_member(org_id, auth.uid()) AND public.has_permission(org_id, 'products', 'edit'));
DROP POLICY IF EXISTS product_attribute_values_delete ON public.product_attribute_values;
CREATE POLICY product_attribute_values_delete ON public.product_attribute_values FOR DELETE TO authenticated
USING (public.is_org_member(org_id, auth.uid()) AND public.has_permission(org_id, 'products', 'edit'));

-- USING/ WITH CHECK impiden escribir un tenant ajeno, pero no impedirían
-- trasladar una fila si el actor pudiera editar ambos. Conservamos org_id
-- inmutable para toda identidad, incluido el servidor; los upserts pueden
-- volver a enviar el mismo org_id sin romper el guardado legítimo.
CREATE OR REPLACE FUNCTION public.catalog_attribute_org_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.org_id IS DISTINCT FROM OLD.org_id THEN
    RAISE EXCEPTION 'La estructura y los atributos del catálogo no pueden cambiar de organización'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.catalog_attribute_org_immutable() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_catalog_attribute_org_immutable ON public.product_types;
CREATE TRIGGER trg_catalog_attribute_org_immutable BEFORE UPDATE OF org_id ON public.product_types
FOR EACH ROW EXECUTE FUNCTION public.catalog_attribute_org_immutable();
DROP TRIGGER IF EXISTS trg_catalog_attribute_org_immutable ON public.attribute_definitions;
CREATE TRIGGER trg_catalog_attribute_org_immutable BEFORE UPDATE OF org_id ON public.attribute_definitions
FOR EACH ROW EXECUTE FUNCTION public.catalog_attribute_org_immutable();
DROP TRIGGER IF EXISTS trg_catalog_attribute_org_immutable ON public.product_attribute_values;
CREATE TRIGGER trg_catalog_attribute_org_immutable BEFORE UPDATE OF org_id ON public.product_attribute_values
FOR EACH ROW EXECUTE FUNCTION public.catalog_attribute_org_immutable();

-- RLS sigue habilitado, sin FORCE ni policies privilegiadas por claim. Las
-- autoridades SECURITY DEFINER existentes conservan su acceso interno y sólo
-- el role PostgreSQL service_role conserva el bypass RLS propio del backend.
ALTER TABLE public.product_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attribute_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_attribute_values ENABLE ROW LEVEL SECURITY;
-- Limpiar todos los privilegios heredados de authenticated también retira
-- TRUNCATE (no sujeto a RLS), REFERENCES/TRIGGER y privilegios de mantenimiento.
REVOKE ALL ON public.product_types, public.attribute_definitions, public.product_attribute_values FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_types, public.attribute_definitions, public.product_attribute_values TO authenticated, service_role;
-- La comprobación de autor/tenant y el trigger de valores consultan el
-- producto canónico. Producción ya tenía este grant; el replay no lo incluía.
-- Sólo lectura bajo las policies existentes: no cambiar permisos de CRUD.
GRANT SELECT ON public.products TO authenticated, service_role;

DO $verification$
DECLARE
  v_table regclass;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['public.product_types'::regclass, 'public.attribute_definitions'::regclass, 'public.product_attribute_values'::regclass]
  LOOP
    IF (SELECT count(*) FROM pg_policy WHERE polrelid = v_table) <> 4
       OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = v_table AND polcmd = '*') THEN
      RAISE EXCEPTION 'El catálogo conserva una policy permisiva inesperada: %', v_table;
    END IF;
  END LOOP;
  IF has_function_privilege('authenticated', 'public.catalog_attribute_org_immutable()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.catalog_attribute_org_immutable()', 'EXECUTE') THEN
    RAISE EXCEPTION 'El guard de identidad del catálogo quedó expuesto al navegador';
  END IF;
END;
$verification$;

COMMIT;
