-- ═══════════════════════════════════════════════════════════════════════════
-- Un vendedor no puede borrar zonas ni tarifas de envío
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `shipping_zones` y `shipping_rates` tenían una sola política `FOR ALL`:
--
--   USING      (cualquier miembro de la organización)
--   WITH CHECK (sólo owner o admin)
--
-- La intención era «todos leen, sólo los encargados escriben». Pero un DELETE
-- no tiene fila nueva que chequear: sólo evalúa USING. Medido el 2026-10-10
-- contra la base vinculada, como un vendedor real (rol authenticated con sus
-- claims) en una transacción revertida: borró 1 tarifa y 1 zona. Desde la
-- interfaz no hay botón para eso, pero la API lo aceptaba, y sin zonas ni
-- tarifas el checkout de la tienda deja de cotizar envíos.
--
-- Se separan las políticas por comando: SELECT para miembros, INSERT, UPDATE
-- y DELETE para owner/admin. Es lo mismo que ya tenía `shipping_carriers`.
-- `deliveries` y `delivery_events` no cambian: despachar es trabajo del
-- vendedor.
--
-- Idempotente. Reversible: recrear la política FOR ALL anterior.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_tabla text;
BEGIN
  FOREACH v_tabla IN ARRAY ARRAY['shipping_zones', 'shipping_rates'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS org_%1$s ON public.%1$I', v_tabla);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_leer ON public.%1$I', v_tabla);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_crear ON public.%1$I', v_tabla);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_editar ON public.%1$I', v_tabla);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_borrar ON public.%1$I', v_tabla);

    EXECUTE format($p$CREATE POLICY %1$s_leer ON public.%1$I FOR SELECT TO authenticated
      USING (public.is_org_member(org_id, auth.uid()))$p$, v_tabla);
    EXECUTE format($p$CREATE POLICY %1$s_crear ON public.%1$I FOR INSERT TO authenticated
      WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner', 'admin']))$p$, v_tabla);
    EXECUTE format($p$CREATE POLICY %1$s_editar ON public.%1$I FOR UPDATE TO authenticated
      USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner', 'admin']))
      WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner', 'admin']))$p$, v_tabla);
    EXECUTE format($p$CREATE POLICY %1$s_borrar ON public.%1$I FOR DELETE TO authenticated
      USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner', 'admin']))$p$, v_tabla);
  END LOOP;
END $$;
