-- ============================================================================
-- Ficha premium de perfume — detalles 1:1 con products
-- ============================================================================
-- Tabla separada (no columnas sobre products) porque solo las filas de
-- categoría perfume necesitan estos campos; vapers/electrónicos cargarían
-- ~15 columnas siempre-null. getProductsDB (Dashboard/POS/PublicCatalog)
-- queda intacto — no se ensancha su payload.

CREATE TABLE IF NOT EXISTS public.product_perfume_details (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id        UUID NOT NULL UNIQUE REFERENCES public.products(id) ON DELETE CASCADE,
  org_id            UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  modelo            TEXT,
  familia_olfativa  TEXT CHECK (familia_olfativa IN (
                      'amaderada','oriental','ambar','gourmand','floral',
                      'citrica','acuatica','chipre','fougere','aromatica')),
  notas_salida      TEXT[] NOT NULL DEFAULT '{}',
  notas_corazon     TEXT[] NOT NULL DEFAULT '{}',
  notas_fondo       TEXT[] NOT NULL DEFAULT '{}',
  duracion          TEXT CHECK (duracion IN ('corta','moderada','larga','muy_larga')),
  proyeccion        TEXT CHECK (proyeccion IN ('intima','moderada','fuerte','enorme')),
  estacion          TEXT[] NOT NULL DEFAULT '{}',   -- verano/invierno/primavera/otono
  ocasion           TEXT[] NOT NULL DEFAULT '{}',   -- diario/oficina/noche/formal/deportivo
  edad_recomendada  TEXT,
  inspiracion       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índice btree en la faceta más consultada en solitario. Sin GIN en los
-- arrays: catálogo de cientos/pocos miles de filas, seq scan es suficiente.
CREATE INDEX IF NOT EXISTS idx_ppd_familia ON public.product_perfume_details(org_id, familia_olfativa);

DROP TRIGGER IF EXISTS trg_ppd_updated_at ON public.product_perfume_details;
CREATE TRIGGER trg_ppd_updated_at
  BEFORE UPDATE ON public.product_perfume_details
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.product_perfume_details ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members read perfume details" ON public.product_perfume_details;
CREATE POLICY "Org members read perfume details"
  ON public.product_perfume_details FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));

DROP POLICY IF EXISTS "Org admins write perfume details" ON public.product_perfume_details;
CREATE POLICY "Org admins write perfume details"
  ON public.product_perfume_details FOR ALL TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));
