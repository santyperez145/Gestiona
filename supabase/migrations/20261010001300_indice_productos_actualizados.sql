-- Sincronización incremental del catálogo (src/lib/catalogCache.ts).
--
-- Después de la primera carga la app pide sólo los productos con
-- updated_at >= último visto - margen. Sin este índice esa consulta recorría
-- todos los productos de la organización.
CREATE INDEX IF NOT EXISTS products_org_updated_at_idx ON public.products (org_id, updated_at);
