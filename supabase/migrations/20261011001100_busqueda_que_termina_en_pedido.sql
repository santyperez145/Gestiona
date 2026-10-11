-- ═══════════════════════════════════════════════════════════════════════════
-- Tienda: búsquedas que terminan en pedido
-- ═══════════════════════════════════════════════════════════════════════════
--
-- META_FINALIZACION §2 (búsqueda: «falta conversión a venta»).
-- 20261011000700 cuenta las búsquedas con resultado y cuántas terminaron en
-- abrir un producto; faltaba saber si después compraron. La tienda recuerda,
-- sólo durante la visita y en el navegador, los términos con los que el
-- cliente abrió un producto, y al crear el pedido los manda una vez.
--
--   · `store_busquedas.con_pedido`: cuántas de esas búsquedas terminaron en
--     un pedido ese día. Nunca más que las búsquedas.
--   · `registrar_pedido_de_busqueda(p_slug, p_terminos)` (pública): hasta 10
--     términos, misma normalización y resolución de tienda que
--     `registrar_busqueda` (`_busqueda_de_tienda`).
--
-- Idempotente. Reversible: DROP FUNCTION, ALTER TABLE … DROP COLUMN.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

ALTER TABLE public.store_busquedas
  ADD COLUMN IF NOT EXISTS con_pedido integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_busquedas_con_pedido_check') THEN
    ALTER TABLE public.store_busquedas
      ADD CONSTRAINT store_busquedas_con_pedido_check CHECK (con_pedido BETWEEN 0 AND 1000000);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.registrar_pedido_de_busqueda(p_slug text, p_terminos text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v record;
  v_termino text;
  v_vistos text[] := '{}';
BEGIN
  FOREACH v_termino IN ARRAY coalesce(p_terminos[1:10], '{}') LOOP
    v := public._busqueda_de_tienda(p_slug, v_termino);
    CONTINUE WHEN v.org_id IS NULL OR v.termino IS NULL OR v.termino = ANY (v_vistos);
    v_vistos := v_vistos || v.termino;
    INSERT INTO public.store_busquedas AS b (org_id, dia, termino, veces, con_clic, con_pedido)
    VALUES (v.org_id, current_date, v.termino, 1, 1, 1)
    ON CONFLICT (org_id, dia, termino) DO UPDATE
      SET con_pedido = LEAST(b.con_pedido + 1, 1000000),
          con_clic = GREATEST(b.con_clic, LEAST(b.con_pedido + 1, 1000000)),
          veces = GREATEST(b.veces, LEAST(b.con_pedido + 1, 1000000)),
          ultima_vez = now();
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_pedido_de_busqueda(text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_pedido_de_busqueda(text, text[]) TO anon, authenticated;

COMMENT ON FUNCTION public.registrar_pedido_de_busqueda(text, text[]) IS
  'La tienda registra que las búsquedas con las que el cliente abrió productos terminaron en un pedido. Pública; sin datos del visitante.';

COMMIT;
