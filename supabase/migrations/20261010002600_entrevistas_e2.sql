-- ═══════════════════════════════════════════════════════════════════════════
-- Registro de entrevistas del experimento E2
-- ═══════════════════════════════════════════════════════════════════════════
--
-- E2 de docs/TESIS.md: «Las herramientas sueltas duelen y se pagan». Mínimo:
-- 15 entrevistas, 5 por puerta de §4 (catálogo grande, marca con
-- influencers, negocio con muchos gastos). Éxito si ≥ 10 usan 3 o más
-- herramientas y nombran el margen real como pregunta sin respuesta. Fecha:
-- 2026-10-31. Medido 2026-10-10: no había dónde registrarlas, así que el
-- criterio no se podía evaluar con datos.
--
-- Tabla interna de Nerqia: sólo administradores de plataforma leen y
-- escriben. No guarda datos de contacto: comercio y rubro alcanzan para el
-- aprendizaje.
--
-- Idempotente. Reversible: DROP TABLE.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE TABLE IF NOT EXISTS public.entrevistas_e2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha date NOT NULL DEFAULT current_date,
  puerta text NOT NULL CHECK (puerta IN ('catalogo_grande', 'marca_influencers', 'muchos_gastos')),
  comercio text NOT NULL CHECK (char_length(btrim(comercio)) BETWEEN 1 AND 120),
  rubro text CHECK (rubro IS NULL OR char_length(rubro) <= 80),
  herramientas text[] NOT NULL DEFAULT '{}' CHECK (cardinality(herramientas) <= 20),
  pago_mensual_ars numeric(14, 2) CHECK (pago_mensual_ars IS NULL OR pago_mensual_ars >= 0),
  margen_sin_respuesta boolean NOT NULL DEFAULT false,
  preguntas_sin_respuesta text CHECK (preguntas_sin_respuesta IS NULL OR char_length(preguntas_sin_respuesta) <= 2000),
  notas text CHECK (notas IS NULL OR char_length(notas) <= 4000),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.entrevistas_e2 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS entrevistas_e2_plataforma ON public.entrevistas_e2;
CREATE POLICY entrevistas_e2_plataforma ON public.entrevistas_e2
  FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

REVOKE ALL ON public.entrevistas_e2 FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.entrevistas_e2 TO authenticated;

COMMENT ON TABLE public.entrevistas_e2 IS
  'Entrevistas del experimento E2 de docs/TESIS.md (herramientas sueltas que duelen y se pagan). Sólo administradores de plataforma.';

COMMIT;
