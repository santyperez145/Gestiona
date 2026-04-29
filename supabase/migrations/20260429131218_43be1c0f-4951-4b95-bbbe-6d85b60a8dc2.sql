
-- Exchange configs (status y type)
CREATE TABLE IF NOT EXISTS public.exchange_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NULL,
  kind text NOT NULL CHECK (kind IN ('status','type')),
  code text NOT NULL,
  label text NOT NULL,
  color_class text DEFAULT 'bg-muted text-muted-foreground',
  sort_order integer DEFAULT 0,
  active boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, kind, code)
);
ALTER TABLE public.exchange_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read exchange configs" ON public.exchange_configs FOR SELECT TO authenticated USING (active = true);
CREATE POLICY "Org admins manage exchange configs" ON public.exchange_configs FOR ALL TO authenticated
  USING (org_id IS NULL OR has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (org_id IS NOT NULL AND has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));

INSERT INTO public.exchange_configs (org_id, kind, code, label, color_class, sort_order) VALUES
  (NULL, 'status', 'pendiente',  'Pendiente',   'bg-warning/20 text-warning', 1),
  (NULL, 'status', 'entregado',  'Entregado',   'bg-blue-500/20 text-blue-400', 2),
  (NULL, 'status', 'publicado',  'Publicado',   'bg-success/20 text-success', 3),
  (NULL, 'status', 'completado', 'Completado',  'bg-primary/20 text-primary', 4),
  (NULL, 'type',   'canje',         'Canje',         'bg-muted text-muted-foreground', 1),
  (NULL, 'type',   'regalo',        'Regalo',        'bg-muted text-muted-foreground', 2),
  (NULL, 'type',   'colaboracion',  'Colaboración',  'bg-muted text-muted-foreground', 3)
ON CONFLICT DO NOTHING;

-- Marketing post types
CREATE TABLE IF NOT EXISTS public.marketing_post_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NULL,
  code text NOT NULL,
  label text NOT NULL,
  emoji text DEFAULT '📸',
  active boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, code)
);
ALTER TABLE public.marketing_post_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read post types" ON public.marketing_post_types FOR SELECT TO authenticated USING (active = true);
CREATE POLICY "Org admins manage post types" ON public.marketing_post_types FOR ALL TO authenticated
  USING (org_id IS NULL OR has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (org_id IS NOT NULL AND has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));

INSERT INTO public.marketing_post_types (org_id, code, label, emoji, sort_order) VALUES
  (NULL, 'post',     'Post de Feed', '📸', 1),
  (NULL, 'story',    'Historia',     '📱', 2),
  (NULL, 'reel',     'Reel',         '🎬', 3),
  (NULL, 'carousel', 'Carrusel',     '🖼️', 4)
ON CONFLICT DO NOTHING;

-- Marketing themes
CREATE TABLE IF NOT EXISTS public.marketing_themes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NULL,
  industry_code text NULL,
  label text NOT NULL,
  active boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.marketing_themes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read themes" ON public.marketing_themes FOR SELECT TO authenticated USING (active = true);
CREATE POLICY "Org admins manage themes" ON public.marketing_themes FOR ALL TO authenticated
  USING (org_id IS NULL OR has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (org_id IS NOT NULL AND has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));

INSERT INTO public.marketing_themes (org_id, industry_code, label, sort_order) VALUES
  (NULL, 'perfumes', 'Promoción de perfumes árabes', 1),
  (NULL, 'perfumes', 'Fragancias para regalar', 2),
  (NULL, 'perfumes', 'Comparativa de perfumes', 3),
  (NULL, 'perfumes', 'Tips de fragancias', 4),
  (NULL, 'perfumes', 'Perfume del día', 5),
  (NULL, 'vapers',   'Nuevos ingresos de vapers', 6),
  (NULL, 'vapers',   'Combo vaper + líquido', 7),
  (NULL, NULL,       'Descuentos especiales', 8),
  (NULL, NULL,       'Lanzamiento de producto', 9),
  (NULL, NULL,       'Cliente del mes / testimonio', 10)
ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_exchange_configs_org_kind ON public.exchange_configs(org_id, kind);
CREATE INDEX IF NOT EXISTS idx_marketing_themes_org_industry ON public.marketing_themes(org_id, industry_code);
