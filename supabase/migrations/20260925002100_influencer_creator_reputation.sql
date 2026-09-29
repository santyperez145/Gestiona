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

CREATE OR REPLACE FUNCTION public.influencer_reputation_map(p_org_id uuid)
RETURNS TABLE (
  influencer_id uuid,
  rating numeric,
  reviews_count bigint,
  collaborations_count bigint,
  on_time_rate numeric,
  verified_publications bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH reputacion AS (
    SELECT r.influencer_id,
           avg(r.rating)::numeric AS rating,
           count(*)::bigint AS reviews_count
    FROM public.influencer_reviews r
    WHERE r.org_id = p_org_id
    GROUP BY r.influencer_id
  ),
  entregas AS (
    SELECT d.influencer_id,
           count(*) FILTER (
             WHERE d.status = 'completado'
               AND d.delivery_date IS NOT NULL
           )::bigint AS done,
           count(*) FILTER (
             WHERE d.status = 'completado'
               AND d.delivery_date IS NOT NULL
               AND d.delivery_date <= d.due_date
           )::bigint AS on_time
    FROM public.influencer_deliverables d
    WHERE d.org_id = p_org_id AND d.influencer_id IS NOT NULL
    GROUP BY d.influencer_id
  ),
  campanas AS (
    SELECT cc.influencer_id,
           count(DISTINCT cc.campaign_id)::bigint AS collaborations_count
    FROM public.influencer_campaign_creators cc
    WHERE cc.org_id = p_org_id
    GROUP BY cc.influencer_id
  ),
  pruebas AS (
    SELECT p.influencer_id,
           count(*)::bigint AS verified_publications
    FROM public.influencer_publication_proofs p
    WHERE p.org_id = p_org_id AND p.verified_by IS NOT NULL
    GROUP BY p.influencer_id
  )
  SELECT i.id,
         COALESCE(rep.rating, NULL::numeric) AS rating,
         COALESCE(rep.reviews_count, 0)::bigint AS reviews_count,
         COALESCE(cam.collaborations_count, 0)::bigint AS collaborations_count,
         CASE WHEN ent.done > 0
              THEN round(100.0 * ent.on_time / ent.done, 0)
              ELSE NULL::numeric END AS on_time_rate,
         COALESCE(pr.verified_publications, 0)::bigint AS verified_publications
  FROM public.influencers i
  LEFT JOIN reputacion rep ON rep.influencer_id = i.id
  LEFT JOIN entregas ent ON ent.influencer_id = i.id
  LEFT JOIN campanas cam ON cam.influencer_id = i.id
  LEFT JOIN pruebas pr ON pr.influencer_id = i.id
  WHERE i.org_id = p_org_id
    -- Guard: solo el equipo con permiso de ver influencers de ESA org obtiene
    -- filas. Sin esta línea, un usuario autenticado de otra org podría pedir
    -- reputación ajena pasando un org_id ajeno (SECURITY DEFINER salta RLS).
    AND public.can_manage_influencers(p_org_id, 'view');
$$;

REVOKE ALL ON FUNCTION public.influencer_reputation_map(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.influencer_reputation_map(uuid) TO authenticated;
