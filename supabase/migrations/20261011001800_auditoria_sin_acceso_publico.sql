-- ═══════════════════════════════════════════════════════════════════════════
-- P0.2: la vista de auditoría `audit_rubro_adivinado` deja de ser pública
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Medido 2026-10-11 (barrido de vistas que no respetan RLS): las vistas de
-- auditoría (`audit_plan_peor_que_la_prueba`, `audit_limite_peor_que_la_prueba`,
-- `audit_org_sin_indice`, `rls_audit_open_policies`) no tienen acceso para la
-- app, pero `audit_rubro_adivinado` (20260827000110) sí: cualquiera, incluso
-- sin sesión, leía id y nombre de los comercios que no eligieron rubro. Es una
-- vista para mirar desde la base, no desde la app. Queda igual que las demás.
--
-- Idempotente. Reversible: GRANT SELECT … TO anon, authenticated.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

REVOKE ALL ON public.audit_rubro_adivinado FROM PUBLIC, anon, authenticated;

COMMIT;
