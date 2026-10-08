-- ============================================================================
-- REPUTACIÓN VERIFICADA EN EL DESCUBRIMIENTO DE CREADORES (Go-Marz parity)
-- Medido en Go-Marz (2026-09-25): la marca elige creador viendo historial de
-- colaboraciones reales, reviews con rating y performance medida — no a ciegas.
--
-- Antes: el descubrimiento mostraba seguidores/engagement/tier y decidía sin
-- reputación. La reputación ya se calcula para el perfil público (get_
-- influencer_public_profile) pero solo por token, una fila por llamada.
--
-- Ahora: RPC batch `influencer_reputation_map(p_org_id)` en UNA llamada:
-- rating, cantidad de reviews, colaboraciones cerradas, cumplimiento a tiempo
-- y verificaciones de publicación por creador. Con permisos can_manage_
-- influencers('view') + RLS, nunca datos de otra org, nunca anon.
-- ============================================================================

-- 20260925001900 sorts BEFORE this file and already defines the complete map
-- with verified_metrics and last_verified_at. Do not replace its eight-column
-- return type with this earlier six-column draft or remove measured evidence.
DO $reputation_contract$
DECLARE
  v_oid regprocedure := to_regprocedure('public.influencer_reputation_map(uuid)');
BEGIN
  ASSERT v_oid IS NOT NULL, 'El mapa canonico de reputacion no fue instalado';
  ASSERT pg_get_function_result(v_oid) LIKE '%verified_metrics%'
    AND pg_get_function_result(v_oid) LIKE '%last_verified_at%',
    'El mapa perdio su evidencia de metricas verificadas';
  ASSERT pg_get_functiondef(v_oid) LIKE '%can_manage_influencers%',
    'El mapa de reputacion perdio su guarda de organizacion';
END;
$reputation_contract$;

REVOKE ALL ON FUNCTION public.influencer_reputation_map(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.influencer_reputation_map(uuid) TO authenticated;
