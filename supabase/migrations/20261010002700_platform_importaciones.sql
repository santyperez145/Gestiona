-- ═══════════════════════════════════════════════════════════════════════════
-- Importaciones de catálogo en Platform: duración (E3) y trabadas
-- ═══════════════════════════════════════════════════════════════════════════
--
-- E3 de docs/TESIS.md: «Migrar es rápido: catálogo listo en < 30 min».
-- Medido 2026-10-10: no había forma de ver cuánto tarda una importación, y las
-- 12 sesiones de Ferretería Famatina (08–10/10), ninguna terminada, sólo se
-- encontraron revisando la base a mano.
--
-- `platform_importaciones_catalogo`: una fila por sesión con comercio,
-- archivo, estado, filas aplicadas, minutos desde el inicio hasta la última
-- actividad y `trabada` (sin terminar ni cancelar y sin avance hace más de 30
-- minutos). Sólo administradores de plataforma, como las demás
-- `platform_org_*`.
--
-- Idempotente. Reversible: DROP VIEW.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE VIEW public.platform_importaciones_catalogo AS
SELECT
  s.id,
  s.org_id,
  o.name AS org_name,
  s.filename,
  s.status,
  s.total,
  s.prepared,
  s.applied,
  s.created_at,
  s.updated_at,
  round(extract(epoch FROM s.updated_at - s.created_at) / 60.0, 1) AS minutos,
  s.status IN ('preparing', 'ready', 'applying') AND s.updated_at < now() - interval '30 minutes' AS trabada
FROM public.catalog_import_sessions s
JOIN public.organizations o ON o.id = s.org_id
WHERE public.is_platform_admin(auth.uid());

ALTER VIEW public.platform_importaciones_catalogo SET (security_invoker = false);
REVOKE ALL ON public.platform_importaciones_catalogo FROM PUBLIC, anon;
GRANT SELECT ON public.platform_importaciones_catalogo TO authenticated;

COMMENT ON VIEW public.platform_importaciones_catalogo IS
  'Sesiones de importación de catálogo con duración y si están trabadas (E3 de docs/TESIS.md). Sólo administradores de plataforma.';

COMMIT;
