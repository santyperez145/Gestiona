-- ═══════════════════════════════════════════════════════════════════════════
-- La respuesta de NPS tiene que pertenecer a una encuesta abierta
--
-- `public_nps_response_insert` tenía `WITH CHECK (true)`: cualquiera podía
-- insertar respuestas, con el `org_id` y el puntaje que quisiera. No expone
-- datos — por eso no era una fuga — pero deja inflar o hundir el NPS de
-- cualquier comercio de la plataforma, que es una métrica sobre la que después
-- se toman decisiones.
--
-- El insert público es legítimo: el cliente responde desde un link sin estar
-- logueado. Lo que faltaba era atarlo a algo real.
--
-- Ahora la respuesta sólo entra si:
--   · apunta a una encuesta que EXISTE y está ACTIVA, y
--   · su `org_id` coincide con el de esa encuesta — si no, se podían meter
--     respuestas en el tablero de otro comercio, y
--   · el puntaje está en el rango de NPS.
--
-- El id de la encuesta es un uuid: quien no tiene el link no lo adivina. Es el
-- mismo criterio que el link de pago.
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "public_nps_response_insert" ON public.nps_responses;

CREATE POLICY "public_nps_response_insert" ON public.nps_responses
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    score BETWEEN 0 AND 10
    AND EXISTS (
      SELECT 1 FROM public.nps_surveys s
      WHERE s.id = nps_responses.survey_id
        AND s.active
        AND s.org_id = nps_responses.org_id
    )
  );

COMMENT ON POLICY "public_nps_response_insert" ON public.nps_responses IS
  'Respuesta pública, atada a una encuesta activa de la misma organización. El uuid de la encuesta es el secreto, igual que en los links de pago.';
