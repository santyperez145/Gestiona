-- Progreso de los tutoriales de la plataforma.
--
-- Cada usuario ve el recorrido guiado de cada pantalla y las lecciones de la
-- Academia (/aprender). Lo completado u omitido se guarda por usuario, no por
-- navegador: cambiar de computadora no vuelve a ofrecer lo que ya vio.

CREATE TABLE IF NOT EXISTS public.tutorial_progress (
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  tutorial_id text NOT NULL CHECK (tutorial_id ~ '^[a-z0-9_.-]{1,80}$'),
  estado text NOT NULL CHECK (estado IN ('completado', 'omitido')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tutorial_id)
);

COMMENT ON TABLE public.tutorial_progress IS
  'Recorridos guiados y lecciones vistos por cada usuario. Sólo el propio usuario lee y escribe sus filas.';

ALTER TABLE public.tutorial_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own tutorial progress" ON public.tutorial_progress;
CREATE POLICY "Users manage own tutorial progress" ON public.tutorial_progress
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

REVOKE ALL ON public.tutorial_progress FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tutorial_progress TO authenticated;
GRANT ALL ON public.tutorial_progress TO service_role;
