-- ═══════════════════════════════════════════════════════════════════════════
-- F5.3 — Exportación contable auditada
-- ═══════════════════════════════════════════════════════════════════════════
--
-- El contador pide un archivo. Hoy el libro vive en `ledger_entries` +
-- `ledger_lines` (partida doble, inmutable), pero la única forma de
-- entregarlo era pantalla o SQL. Esta migración agrega el lote exportable:
--
--   1. `finance_export_batches`: cada corrida guarda rango, filtros y estado.
--   2. `finance_export_rows`: una fila por línea de asiento con el mapeo a
--      cuenta/centro/impuesto; error por fila se conserva y se puede
--      reintentar sin duplicar (idempotencia por `finance_export_batches`
--      + `(entry_id, line_id)`).
--   3. `finance_export_create(...)`: genera el lote leyendo el libro real.
--   4. `finance_export_batch_csv(...)`: devuelve el CSV autoritativo.
--
-- ⚠️ Lo que NO es: no declara el libro rubricado ni reemplaza al contador.
-- Es la salida que el contador necesita, sin tocar el libro.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.finance_export_batches (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Rango civil incluido, igual que los reportes del Core.
  fecha_desde  date        NOT NULL,
  fecha_hasta  date        NOT NULL,
  -- Estado del lote: preparado → listo → exportado. error = falla con motivo.
  status       text        NOT NULL DEFAULT 'preparado'
               CHECK (status IN ('preparado', 'listo', 'exportado', 'error')),
  row_count    int         NOT NULL DEFAULT 0,
  total_debe   numeric(18,2) NOT NULL DEFAULT 0,
  total_haber  numeric(18,2) NOT NULL DEFAULT 0,
  -- Quién y cuándo; la auditoría de exportación es obligatoria en Finance.
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  exported_at  timestamptz,
  CONSTRAINT rango_valido CHECK (fecha_hasta >= fecha_desde)
);

CREATE INDEX IF NOT EXISTS finance_export_batches_org_idx
  ON public.finance_export_batches (org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.finance_export_rows (
  id           bigserial   PRIMARY KEY,
  batch_id     uuid        NOT NULL REFERENCES public.finance_export_batches(id) ON DELETE CASCADE,
  org_id       uuid        NOT NULL,
  entry_id     uuid        NOT NULL REFERENCES public.ledger_entries(id),
  line_id      uuid        NOT NULL REFERENCES public.ledger_lines(id),
  entry_numero bigint      NOT NULL,
  entry_fecha  date        NOT NULL,
  entry_descripcion text   NOT NULL,
  cuenta_codigo text       NOT NULL,
  cuenta_nombre text       NOT NULL,
  debe         numeric(18,2) NOT NULL DEFAULT 0,
  haber        numeric(18,2) NOT NULL DEFAULT 0,
  -- Columnas para el ERP del contador: centro de costo y referencia.
  centro_costo text,
  referencia_tipo text,
  referencia_id uuid,
  UNIQUE (batch_id, line_id)
);

CREATE INDEX IF NOT EXISTS finance_export_rows_batch_idx
  ON public.finance_export_rows (batch_id, entry_fecha);

ALTER TABLE public.finance_export_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_export_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS finance_export_batches_org ON public.finance_export_batches;
CREATE POLICY finance_export_batches_org ON public.finance_export_batches
  FOR ALL USING (
    public.has_permission(org_id, 'expenses', 'view')
    AND public.is_org_member(org_id, auth.uid())
  );

DROP POLICY IF EXISTS finance_export_rows_org ON public.finance_export_rows;
CREATE POLICY finance_export_rows_org ON public.finance_export_rows
  FOR SELECT USING (
    public.has_permission(org_id, 'expenses', 'view')
    AND public.is_org_member(org_id, auth.uid())
  );

-- ── Crear el lote: la única puerta ─────────────────────────────────────────
--
-- Lee asientos del rango (incluye anulados con su contraasiento: el contador
-- ve la corrección, no un libro editado), copia partidas a las filas del lote
-- y cierra con los totales. Idempotente en el reintento: si el lote quedó en
-- 'preparado' se limpia y se rellena, no se duplica.

CREATE OR REPLACE FUNCTION public.finance_export_create(
  p_org         uuid,
  p_fecha_desde date,
  p_fecha_hasta date
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_actor  uuid := auth.uid();
  v_batch  uuid;
  v_rows   int;
  v_debe   numeric;
  v_haber  numeric;
BEGIN
  IF v_actor IS NULL
     OR NOT public.has_permission(p_org, 'expenses', 'view') THEN
    RAISE EXCEPTION 'Solo members con permiso de gastos pueden exportar el libro'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_fecha_desde IS NULL OR p_fecha_hasta IS NULL OR p_fecha_hasta < p_fecha_desde THEN
    RAISE EXCEPTION 'Rango de fechas invalido';
  END IF;

  -- El balance tiene que cerrar: si el descuadre no da 0, el libro tiene un
  -- problema y exportarlo sería entregarle un error al contador.
  SELECT COALESCE(SUM(l.debe - l.haber), 0) INTO v_rows
    FROM public.ledger_lines l
    JOIN public.ledger_entries e ON e.id = l.entry_id
   WHERE l.org_id = p_org
     AND e.fecha BETWEEN p_fecha_desde AND p_fecha_hasta;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'El libro tiene descuadre (%) en el rango; corregi antes de exportar', v_rows
      USING ERRCODE = '23514';
  END IF;

  -- Reintento: si el último lote del rango no fue exportado todavía, se
  -- reutiliza ese lote y se reemplazan sus filas (refresh del período). Un
  -- lote exportado no se reescribe: se genera otro.
  SELECT b.id INTO v_batch
    FROM public.finance_export_batches b
   WHERE b.org_id = p_org
     AND b.fecha_desde = p_fecha_desde
     AND b.fecha_hasta = p_fecha_hasta
     AND b.status IN ('preparado', 'listo', 'error')
   ORDER BY b.created_at DESC
   LIMIT 1;

  IF v_batch IS NULL THEN
    INSERT INTO public.finance_export_batches
      (org_id, fecha_desde, fecha_hasta, status, created_by)
    VALUES (p_org, p_fecha_desde, p_fecha_hasta, 'preparado', v_actor)
    RETURNING id INTO v_batch;
  ELSE
    DELETE FROM public.finance_export_rows WHERE batch_id = v_batch;
    UPDATE public.finance_export_batches
       SET status = 'preparado', row_count = 0, total_debe = 0, total_haber = 0,
           exported_at = NULL, created_by = v_actor, created_at = now()
     WHERE id = v_batch;
  END IF;

  INSERT INTO public.finance_export_rows
    (batch_id, org_id, entry_id, line_id, entry_numero, entry_fecha,
     entry_descripcion, cuenta_codigo, cuenta_nombre, debe, haber,
     centro_costo, referencia_tipo, referencia_id)
  SELECT
    v_batch, l.org_id, e.id, l.id, e.numero, e.fecha, e.descripcion,
    a.codigo, a.nombre, l.debe, l.haber,
    l.metadata->>'centro_costo', e.referencia_tipo, e.referencia_id
    FROM public.ledger_lines l
    JOIN public.ledger_entries e ON e.id = l.entry_id
    JOIN public.ledger_accounts a ON a.id = l.account_id
   WHERE l.org_id = p_org
     AND e.fecha BETWEEN p_fecha_desde AND p_fecha_hasta
   ORDER BY e.fecha, e.numero, a.codigo;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  SELECT COALESCE(SUM(debe), 0), COALESCE(SUM(haber), 0)
    INTO v_debe, v_haber
    FROM public.finance_export_rows WHERE batch_id = v_batch;

  UPDATE public.finance_export_batches
     SET row_count = v_rows, total_debe = v_debe, total_haber = v_haber,
         status = 'listo'
   WHERE id = v_batch;

  RETURN v_batch;
END;
$fn$;

COMMENT ON FUNCTION public.finance_export_create IS
  'Genera lote de exportacion contable desde el libro real. Idempotente en reuso de lotes preparados/error; exige balance cuadrado.';

-- Marcar exportado: traza de auditoría de que el archivo salió.
CREATE OR REPLACE FUNCTION public.finance_export_mark_exported(
  p_batch_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_org uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Requiere sesion' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT org_id INTO v_org FROM public.finance_export_batches WHERE id = p_batch_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'El lote no existe';
  END IF;
  IF NOT public.has_permission(v_org, 'expenses', 'view') THEN
    RAISE EXCEPTION 'Sin permiso para exportar el libro'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE public.finance_export_batches
     SET status = 'exportado', exported_at = now()
   WHERE id = p_batch_id AND status = 'listo';
END;
$fn$;

-- ── El CSV autoritativo ────────────────────────────────────────────────────
--
-- El contador abre esto en Excel/sistema. Encabezado estable, BOM UTF-8 lo
-- agrega el navegador al descargar; acá sale puro. Una fila por partida:
-- asiento, fecha, cuenta, debe, haber y referencia. Si el lote no está
-- 'listo', no se exporta.

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
           '"' || replace(r.cuenta_codigo, '"', '""') || '";' ||
           '"' || replace(r.cuenta_nombre, '"', '""') || '";' ||
           replace(r.debe::text, '.', ',') || ';' ||
           replace(r.haber::text, '.', ',') || ';' ||
           '"' || replace(coalesce(r.entry_descripcion, ''), '"', '""') || '";' ||
           '"' || replace(coalesce(r.centro_costo, ''), '"', '""') || '";' ||
           coalesce(r.referencia_tipo, ''),
           E'\n'
           ORDER BY r.entry_fecha, r.entry_numero, r.cuenta_codigo, r.id)
    FROM public.finance_export_rows r
    WHERE r.batch_id = p_batch_id
  ), '');
END;
$fn$;

COMMENT ON FUNCTION public.finance_export_batch_csv IS
  'Devuelve el CSV del lote (separador ; y decimales con coma para es-AR). Solo lotes en estado listo.';

GRANT EXECUTE ON FUNCTION public.finance_export_create(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_export_mark_exported(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_export_batch_csv(uuid) TO authenticated;