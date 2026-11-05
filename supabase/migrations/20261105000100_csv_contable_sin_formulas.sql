-- El CSV contable sin fórmulas (2026-11-05).
--
-- finance_export_batch_csv escapaba las comillas pero no neutralizaba lo que
-- Excel lee como fórmula. La descripción de un asiento puede traer texto de
-- afuera (el nombre de un comprador en una venta online): un «=HYPERLINK(…)»
-- se ejecutaba cuando el contador abría el archivo. Mismo criterio que
-- csvCell en el cliente (src/lib/csv.ts): lo que empieza con = + - @ va con
-- un apóstrofo adelante, salvo que sea un número (un monto negativo sigue
-- siendo número).

CREATE OR REPLACE FUNCTION public.csv_celda(p_valor text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT '"' || replace(
    CASE
      WHEN coalesce(p_valor, '') ~ '^[[:space:][:cntrl:]]*[=+@-]'
       AND coalesce(p_valor, '') !~ '^[[:space:]]*[-+]?[0-9]+([.,][0-9]+)*[[:space:]]*$'
        THEN '''' || coalesce(p_valor, '')
      ELSE coalesce(p_valor, '')
    END,
    '"', '""') || '"';
$$;

COMMENT ON FUNCTION public.csv_celda(text) IS
  'Celda de CSV entre comillas, con comillas duplicadas y sin fórmulas (espejo de csvCell).';

REVOKE ALL ON FUNCTION public.csv_celda(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.csv_celda(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.finance_export_batch_csv(
  p_batch_id uuid
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_org uuid;
  v_status text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Requiere sesion' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT org_id, status INTO v_org, v_status
    FROM public.finance_export_batches WHERE id = p_batch_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'El lote no existe';
  END IF;
  IF NOT public.has_permission(v_org, 'expenses', 'view') THEN
    RAISE EXCEPTION 'Sin permiso para exportar el libro'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_status <> 'listo' THEN
    RAISE EXCEPTION 'El lote no esta listo para exportar (estado: %)', v_status;
  END IF;

  RETURN COALESCE((
    SELECT 'asiento;fecha;cuenta;nombre_cuenta;debe;haber;descripcion;centro_costo;referencia'
      || chr(10)
      || string_agg(
           r.entry_numero || ';' ||
           to_char(r.entry_fecha, 'YYYY-MM-DD') || ';' ||
           public.csv_celda(r.cuenta_codigo) || ';' ||
           public.csv_celda(r.cuenta_nombre) || ';' ||
           replace(r.debe::text, '.', ',') || ';' ||
           replace(r.haber::text, '.', ',') || ';' ||
           public.csv_celda(r.entry_descripcion) || ';' ||
           public.csv_celda(r.centro_costo) || ';' ||
           coalesce(r.referencia_tipo, ''),
           E'\n'
           ORDER BY r.entry_fecha, r.entry_numero, r.cuenta_codigo, r.id)
    FROM public.finance_export_rows r
    WHERE r.batch_id = p_batch_id
  ), '');
END;
$fn$;

COMMENT ON FUNCTION public.finance_export_batch_csv IS
  'Devuelve el CSV del lote (separador ; y decimales con coma para es-AR). Solo lotes en estado listo. Celdas de texto sin fórmulas (csv_celda).';

GRANT EXECUTE ON FUNCTION public.finance_export_batch_csv(uuid) TO authenticated;
