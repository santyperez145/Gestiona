-- ═══════════════════════════════════════════════════════════════════════════
-- El panel de plataforma mostraba números silenciosamente equivocados
--
-- `organizations` tiene la excepción para staff de plataforma desde
-- 20260421111259 (`... OR public.is_platform_admin(auth.uid())`), pero
-- `subscriptions` y `memberships` no la tienen: sólo se ven las de las orgs
-- donde el usuario es miembro.
--
-- `PlatformAdminPage` lee las tres tablas directo y las cruza en el cliente. O
-- sea que listaba TODAS las organizaciones, pero sin plan, sin estado y sin
-- miembros para las que el staff no integra. Y como el MRR se suma de esos
-- planes, el panel reportaba el MRR de la organización propia del staff como si
-- fuera el de la plataforma entera. Sin error, sin advertencia: un número mal
-- que parece bien.
--
-- Se agregan políticas de SELECT para staff de plataforma. Sólo lectura: crear,
-- cambiar o borrar sigue pasando por `platform-admin-action`, que valida el
-- nivel y deja auditoría en `admin_audit_logs`.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Suscripciones ─────────────────────────────────────────────────────────
-- Las necesita cualquier nivel de staff: soporte para entender el estado de un
-- tenant, finanzas para el MRR.
DROP POLICY IF EXISTS "platform_staff_read_subscriptions" ON public.subscriptions;
CREATE POLICY "platform_staff_read_subscriptions" ON public.subscriptions
  FOR SELECT TO authenticated
  USING (public.has_platform_role(ARRAY['support', 'finance']));

-- ── Membresías ────────────────────────────────────────────────────────────
-- Para saber quién integra cada organización al dar soporte, y para contar
-- usuarios por tenant.
DROP POLICY IF EXISTS "platform_staff_read_memberships" ON public.memberships;
CREATE POLICY "platform_staff_read_memberships" ON public.memberships
  FOR SELECT TO authenticated
  USING (public.has_platform_role(ARRAY['support', 'finance']));

-- ── Planes ────────────────────────────────────────────────────────────────
-- `plans` ya es de lectura pública (es el pricing de /precios), así que no
-- hace falta nada. Se documenta para que no se busque el hueco acá.

COMMENT ON POLICY "platform_staff_read_subscriptions" ON public.subscriptions IS
  'Staff de plataforma: sólo lectura. Los cambios de plan van por platform-admin-action, que audita.';
COMMENT ON POLICY "platform_staff_read_memberships" ON public.memberships IS
  'Staff de plataforma: sólo lectura. Alta/baja de miembros va por platform-admin-action, que audita.';
