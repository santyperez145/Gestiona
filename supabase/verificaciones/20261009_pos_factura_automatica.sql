-- Facturación automática en el POS. Sólo lectura de catálogo; ROLLBACK.
BEGIN;
DO $$
BEGIN
  ASSERT (SELECT is_nullable = 'NO' AND column_default = 'false'
          FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'settings' AND column_name = 'pos_factura_automatica'),
    'Falta settings.pos_factura_automatica NOT NULL DEFAULT false';
  ASSERT NOT EXISTS (SELECT 1 FROM public.settings WHERE pos_factura_automatica IS NULL), 'Hay organizaciones sin valor';
END;
$$;
SELECT 'pos_factura_automatica OK' AS resultado;
ROLLBACK;
