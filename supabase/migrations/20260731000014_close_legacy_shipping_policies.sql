-- ═══════════════════════════════════════════════════════════════════════════
-- Cerrar las políticas de envío de la logística vieja, y arreglar el auditor
--
-- Dos cosas que la verificación encontró después de aplicar todo:
--
-- 1. `org_zones` y `org_rates` (de 20260523000075_logistics.sql) seguían vivas.
--    Dan acceso TOTAL a cualquier miembro de la org, y como las políticas son
--    aditivas conviven con las nuevas: un vendedor podía editar zonas y tarifas
--    por más que la política nueva limite la escritura a owner/admin.
--
--    El DROP existe en 20260730000027 pero se agregó DESPUÉS de que esa
--    migración ya estuviera aplicada, y una versión ya registrada no se vuelve
--    a correr. Editar una migración aplicada no cambia la base: hace falta una
--    nueva. Por eso este archivo.
--
-- 2. `rls_audit_open_policies` marcaba 17 falsos positivos. Miraba `qual` en
--    todas las políticas, pero en las de INSERT `qual` es SIEMPRE null — INSERT
--    valida con `with_check`. Un auditor que grita en falso 17 veces es un
--    auditor que se deja de leer, y ahí se cuela el hallazgo real.
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "org_zones" ON public.shipping_zones;
DROP POLICY IF EXISTS "org_rates" ON public.shipping_rates;

-- ── Auditor de políticas sin filtro de tenant ─────────────────────────────
CREATE OR REPLACE VIEW public.rls_audit_open_policies AS
SELECT
  schemaname,
  tablename,
  policyname,
  roles::text  AS applies_to,
  cmd          AS command,
  COALESCE(qual, with_check) AS using_expression
FROM pg_policies
WHERE schemaname = 'public'
  AND CASE
        -- INSERT no tiene `qual`: lo que decide es `with_check`
        WHEN cmd = 'INSERT' THEN
          with_check IS NULL OR btrim(with_check) IN ('true', '(true)')
        -- El resto filtra con `qual`
        ELSE
          qual IS NULL OR btrim(qual) IN ('true', '(true)')
      END;

COMMENT ON VIEW public.rls_audit_open_policies IS
  'Políticas que no filtran por tenant. INSERT se evalúa por with_check, el resto por qual. Debería estar casi vacía: `plans` es pricing público y `payment_provider_fees` son los aranceles, que el comercio tiene derecho a leer.';

REVOKE ALL ON public.rls_audit_open_policies FROM anon, authenticated;
