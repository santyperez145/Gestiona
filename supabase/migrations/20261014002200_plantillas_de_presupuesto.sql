-- Presupuestos: las plantillas pasan del navegador a la base.
--
-- Hasta 2026-10-14 se guardaban en localStorage: no se veían desde otro
-- equipo ni las compartía el resto del negocio, y se perdían al limpiar el
-- navegador. Ahora son del negocio: cualquier miembro las usa y guarda; las
-- borra quien las creó, el dueño o un administrador. Un nombre por negocio
-- (guardar con el mismo nombre la reemplaza).
-- Idempotente.
BEGIN;

CREATE TABLE IF NOT EXISTS public.plantillas_de_presupuesto (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  nombre text NOT NULL CHECK (length(btrim(nombre)) BETWEEN 1 AND 80),
  items jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) <= 200),
  notas text CHECK (notas IS NULL OR length(notas) <= 2000),
  creada_por uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, nombre)
);
ALTER TABLE public.plantillas_de_presupuesto ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS plantillas_presupuesto_leer ON public.plantillas_de_presupuesto;
CREATE POLICY plantillas_presupuesto_leer ON public.plantillas_de_presupuesto
  FOR SELECT TO authenticated USING (public.is_org_member(org_id, auth.uid()));
DROP POLICY IF EXISTS plantillas_presupuesto_crear ON public.plantillas_de_presupuesto;
CREATE POLICY plantillas_presupuesto_crear ON public.plantillas_de_presupuesto
  FOR INSERT TO authenticated WITH CHECK (public.is_org_member(org_id, auth.uid()));
DROP POLICY IF EXISTS plantillas_presupuesto_editar ON public.plantillas_de_presupuesto;
CREATE POLICY plantillas_presupuesto_editar ON public.plantillas_de_presupuesto
  FOR UPDATE TO authenticated USING (public.is_org_member(org_id, auth.uid())) WITH CHECK (public.is_org_member(org_id, auth.uid()));
DROP POLICY IF EXISTS plantillas_presupuesto_borrar ON public.plantillas_de_presupuesto;
CREATE POLICY plantillas_presupuesto_borrar ON public.plantillas_de_presupuesto
  FOR DELETE TO authenticated USING (creada_por = auth.uid() OR public.has_org_role(org_id, auth.uid(), ARRAY['owner', 'admin']));

REVOKE ALL ON public.plantillas_de_presupuesto FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plantillas_de_presupuesto TO authenticated;
GRANT ALL ON public.plantillas_de_presupuesto TO service_role;

COMMIT;
