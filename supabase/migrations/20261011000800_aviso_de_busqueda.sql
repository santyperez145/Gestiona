-- ═══════════════════════════════════════════════════════════════════════════
-- Tienda: «avisame cuando lo tengas» en una búsqueda sin resultados
-- ═══════════════════════════════════════════════════════════════════════════
--
-- META_FINALIZACION §2 (búsqueda) y TESIS §3 (tienda ↔ Growth): cuando el
-- cliente busca algo que la tienda no tiene, hoy se va sin dejar rastro; el
-- comercio sólo ve el término (20261011000500). Con esto puede dejar su email
-- y el comercio, cuando lo consiga, tiene a quién avisarle: demanda concreta
-- en lugar de un contador.
--
--   · `store_avisos_de_busqueda`: comercio, tienda, término normalizado y
--     email. Un email pide una vez por término (repetir no duplica). Se borran
--     solos a los 180 días (`retener_hasta`).
--   · `pedir_aviso_de_busqueda(p_slug, p_termino, p_email)` (pública): valida
--     el email y el término con la misma normalización que el registro de
--     búsquedas; tope de 300 pedidos por comercio y día contra el abuso.
--   · Leer y borrar («Ya les avisé»): quien puede editar la tienda (es un dato
--     personal; ver la tienda no alcanza). Insertar: sólo la función.
--
-- Idempotente. Reversible: DROP FUNCTION, DROP TABLE.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE TABLE IF NOT EXISTS public.store_avisos_de_busqueda (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.ecommerce_stores(id) ON DELETE CASCADE,
  termino text NOT NULL CHECK (char_length(termino) BETWEEN 2 AND 60),
  email text NOT NULL CHECK (char_length(email) BETWEEN 5 AND 254),
  created_at timestamptz NOT NULL DEFAULT now(),
  retener_hasta timestamptz NOT NULL DEFAULT now() + interval '180 days',
  UNIQUE (org_id, termino, email)
);

CREATE INDEX IF NOT EXISTS store_avisos_de_busqueda_store_idx ON public.store_avisos_de_busqueda (store_id);
CREATE INDEX IF NOT EXISTS store_avisos_de_busqueda_org_dia_idx ON public.store_avisos_de_busqueda (org_id, created_at);

ALTER TABLE public.store_avisos_de_busqueda ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS store_avisos_de_busqueda_leer ON public.store_avisos_de_busqueda;
CREATE POLICY store_avisos_de_busqueda_leer ON public.store_avisos_de_busqueda
  FOR SELECT TO authenticated
  USING (public.has_permission(org_id, 'ecommerce', 'edit') AND retener_hasta > now());

DROP POLICY IF EXISTS store_avisos_de_busqueda_borrar ON public.store_avisos_de_busqueda;
CREATE POLICY store_avisos_de_busqueda_borrar ON public.store_avisos_de_busqueda
  FOR DELETE TO authenticated
  USING (public.has_permission(org_id, 'ecommerce', 'edit'));

REVOKE ALL ON public.store_avisos_de_busqueda FROM PUBLIC, anon;
REVOKE INSERT, UPDATE ON public.store_avisos_de_busqueda FROM authenticated;
GRANT SELECT, DELETE ON public.store_avisos_de_busqueda TO authenticated;

COMMENT ON TABLE public.store_avisos_de_busqueda IS
  'Clientes que buscaron algo que la tienda no tenía y dejaron su email para que les avisen. Sólo la escribe pedir_aviso_de_busqueda; la leen y borran quienes editan la tienda. Vence a los 180 días.';

CREATE OR REPLACE FUNCTION public.pedir_aviso_de_busqueda(p_slug text, p_termino text, p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_termino text;
  v_store record;
BEGIN
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR char_length(v_email) > 254 THEN
    RAISE EXCEPTION 'Revisá el email';
  END IF;

  v_termino := left(btrim(regexp_replace(public.texto_catalogo(p_termino), '\s+', ' ', 'g')), 60);
  IF v_termino IS NULL OR char_length(v_termino) < 2 OR v_termino !~ '^[a-z0-9 ]+$' THEN
    RAISE EXCEPTION 'Escribí qué estás buscando';
  END IF;

  SELECT s.id, s.org_id INTO v_store FROM public.ecommerce_stores s
  WHERE lower(s.slug) = lower(btrim(p_slug)) AND s.is_active
  ORDER BY s.is_primary DESC, s.created_at
  LIMIT 1;
  IF v_store.id IS NULL THEN
    RAISE EXCEPTION 'Tienda no encontrada';
  END IF;

  IF (SELECT count(*) FROM public.store_avisos_de_busqueda a
      WHERE a.org_id = v_store.org_id AND a.created_at > now() - interval '1 day') >= 300 THEN
    RAISE EXCEPTION 'Probá de nuevo más tarde';
  END IF;

  DELETE FROM public.store_avisos_de_busqueda WHERE retener_hasta <= now() AND org_id = v_store.org_id;

  INSERT INTO public.store_avisos_de_busqueda (org_id, store_id, termino, email)
  VALUES (v_store.org_id, v_store.id, v_termino, v_email)
  ON CONFLICT (org_id, termino, email) DO UPDATE
    SET created_at = now(), retener_hasta = now() + interval '180 days';

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.pedir_aviso_de_busqueda(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pedir_aviso_de_busqueda(text, text, text) TO anon, authenticated;

COMMENT ON FUNCTION public.pedir_aviso_de_busqueda(text, text, text) IS
  'Un cliente de la tienda deja su email para que le avisen cuando haya lo que buscó y no encontró. Pública.';

COMMIT;
