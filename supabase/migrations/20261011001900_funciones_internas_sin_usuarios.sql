-- ═══════════════════════════════════════════════════════════════════════════
-- P0.2: dos funciones internas dejan de poder llamarse desde la app
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Medido 2026-10-11 (barrido de funciones con privilegios que escriben y no
-- miran quién llama, ejecutables por cualquier usuario con sesión):
--
--   · `avisar_a_los_que_mandan(p_org, p_titulo, p_mensaje, …, p_por_correo)`
--     crea avisos —y con `p_por_correo`, correos de Nerqia— a los dueños y
--     administradores de **cualquier** comercio, con el texto que quiera quien
--     llama. Un usuario de otro comercio podía usarla para phishing con
--     nuestro remitente.
--   · `aplicar_limites_del_plan(p_org)` recalcula qué miembros de cualquier
--     comercio quedan suspendidos por plan.
--
-- Las dos son internas: las llaman otras funciones con privilegios
-- (disparadores, cambio de plan), que corren como dueñas y no necesitan este
-- permiso. Ninguna pantalla las llama. Quedan sólo para el servidor
-- (`service_role`), igual que `upsert_customer_from_order` (20261011000200).
-- Las otras 19 del barrido son públicas a propósito (tienda y enlaces con
-- token).
--
-- Idempotente. Reversible: GRANT EXECUTE … TO authenticated.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

REVOKE ALL ON FUNCTION public.avisar_a_los_que_mandan(uuid, text, text, text, text, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aplicar_limites_del_plan(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.avisar_a_los_que_mandan(uuid, text, text, text, text, uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.aplicar_limites_del_plan(uuid) TO service_role;

COMMIT;
