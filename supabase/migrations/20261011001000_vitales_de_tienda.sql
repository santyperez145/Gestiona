-- ═══════════════════════════════════════════════════════════════════════════
-- Tienda: Core Web Vitals medidos con visitas reales
-- ═══════════════════════════════════════════════════════════════════════════
--
-- META_FINALIZACION §2 («Core Web Vitals medidos»). Medido 2026-10-11: la
-- tienda no medía su velocidad en ningún lado (ni web-vitals ni
-- PerformanceObserver); sólo había presupuestos de carga en el build. Google
-- usa estas tres métricas de visitas reales para el posicionamiento y una
-- tienda lenta vende menos, así que hay que verlas antes de que lo diga un
-- comercio.
--
--   · `store_vitales`: por comercio, día, tipo de página (inicio, productos,
--     producto, otra) y métrica (lcp, cls, inp), cuántas visitas cayeron en
--     cada rango de Google: buena / a mejorar / mala. Sin datos del visitante
--     ni URL: sólo contadores.
--       LCP ≤ 2,5 s / ≤ 4 s · CLS ≤ 0,1 / ≤ 0,25 · INP ≤ 200 ms / ≤ 500 ms.
--   · `registrar_vitales_tienda(p_slug, p_pagina, p_lcp, p_cls, p_inp)`
--     (pública, la tienda la llama una vez por página vista al salir):
--     clasifica en la base, descarta valores absurdos, contadores cortados en
--     1.000.000.
--   · `platform_vitales_tiendas(p_dias)`: sólo administradores de plataforma;
--     por comercio y métrica, visitas y % buenas (la meta de Google es ≥ 75%).
--
-- Idempotente. Reversible: DROP FUNCTION x2, DROP TABLE.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE TABLE IF NOT EXISTS public.store_vitales (
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  dia date NOT NULL DEFAULT current_date,
  pagina text NOT NULL CHECK (pagina IN ('inicio', 'productos', 'producto', 'otra')),
  metrica text NOT NULL CHECK (metrica IN ('lcp', 'cls', 'inp')),
  buenas integer NOT NULL DEFAULT 0 CHECK (buenas BETWEEN 0 AND 1000000),
  regulares integer NOT NULL DEFAULT 0 CHECK (regulares BETWEEN 0 AND 1000000),
  malas integer NOT NULL DEFAULT 0 CHECK (malas BETWEEN 0 AND 1000000),
  PRIMARY KEY (org_id, dia, pagina, metrica)
);

ALTER TABLE public.store_vitales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS store_vitales_leer ON public.store_vitales;
CREATE POLICY store_vitales_leer ON public.store_vitales
  FOR SELECT TO authenticated
  USING (public.has_permission(org_id, 'ecommerce', 'view'));

REVOKE ALL ON public.store_vitales FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON public.store_vitales FROM authenticated;
GRANT SELECT ON public.store_vitales TO authenticated;

COMMENT ON TABLE public.store_vitales IS
  'Core Web Vitals de visitas reales a la tienda: por comercio, día, tipo de página y métrica, cuántas buenas / a mejorar / malas. Sin datos del visitante. Sólo la escribe registrar_vitales_tienda.';

CREATE OR REPLACE FUNCTION public.registrar_vitales_tienda(
  p_slug text, p_pagina text, p_lcp numeric, p_cls numeric, p_inp numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_pagina text := CASE WHEN p_pagina IN ('inicio', 'productos', 'producto') THEN p_pagina ELSE 'otra' END;
  m record;
BEGIN
  SELECT s.org_id INTO v_org FROM public.ecommerce_stores s
  WHERE lower(s.slug) = lower(btrim(p_slug)) AND s.is_active
  ORDER BY s.is_primary DESC, s.created_at
  LIMIT 1;
  IF v_org IS NULL THEN
    RETURN;
  END IF;

  FOR m IN
    SELECT * FROM (VALUES
      -- metrica, valor, límite bueno, límite malo, máximo creíble
      ('lcp', p_lcp, 2500::numeric, 4000::numeric, 120000::numeric),
      ('cls', p_cls, 0.1, 0.25, 50),
      ('inp', p_inp, 200, 500, 60000)
    ) AS t(metrica, valor, bueno, malo, maximo)
  LOOP
    CONTINUE WHEN m.valor IS NULL OR m.valor < 0 OR m.valor > m.maximo;
    INSERT INTO public.store_vitales AS v (org_id, dia, pagina, metrica, buenas, regulares, malas)
    VALUES (
      v_org, current_date, v_pagina, m.metrica,
      (m.valor <= m.bueno)::int,
      (m.valor > m.bueno AND m.valor <= m.malo)::int,
      (m.valor > m.malo)::int
    )
    ON CONFLICT (org_id, dia, pagina, metrica) DO UPDATE SET
      buenas = LEAST(v.buenas + EXCLUDED.buenas, 1000000),
      regulares = LEAST(v.regulares + EXCLUDED.regulares, 1000000),
      malas = LEAST(v.malas + EXCLUDED.malas, 1000000);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_vitales_tienda(text, text, numeric, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_vitales_tienda(text, text, numeric, numeric, numeric) TO anon, authenticated;

COMMENT ON FUNCTION public.registrar_vitales_tienda(text, text, numeric, numeric, numeric) IS
  'La tienda registra los Core Web Vitals de una página vista (LCP ms, CLS, INP ms), ya clasificados. Pública; sin datos del visitante.';

CREATE OR REPLACE FUNCTION public.platform_vitales_tiendas(p_dias integer DEFAULT 28)
RETURNS TABLE (
  org_id uuid, comercio text, metrica text,
  visitas bigint, buenas bigint, regulares bigint, malas bigint, pct_buenas numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Sólo administradores de plataforma' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT v.org_id, o.name::text, v.metrica,
         sum(v.buenas + v.regulares + v.malas)::bigint,
         sum(v.buenas)::bigint, sum(v.regulares)::bigint, sum(v.malas)::bigint,
         round(100.0 * sum(v.buenas) / NULLIF(sum(v.buenas + v.regulares + v.malas), 0), 1)
  FROM public.store_vitales v
  JOIN public.organizations o ON o.id = v.org_id
  WHERE v.dia >= current_date - LEAST(GREATEST(coalesce(p_dias, 28), 1), 365)
  GROUP BY v.org_id, o.name, v.metrica
  ORDER BY o.name, v.metrica;
END;
$$;

REVOKE ALL ON FUNCTION public.platform_vitales_tiendas(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_vitales_tiendas(integer) TO authenticated;

COMMIT;
