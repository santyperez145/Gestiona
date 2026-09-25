-- ═══════════════════════════════════════════════════════════════════════════
-- F5.4 (fila 12) — Conciliación bancaria contra el ledger
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `PaymentSettlementsPanel` explica el neto de cada cobro digital y F5.3
-- exporta el libro; falta el eslabón real: contrastar el extracto del banco
-- con los asientos de la cuenta 1.1.02 y decidir qué matchea. Esta migración
-- agrega:
--
--   1. `finance_bank_statements`: un extracto importado (banco, período,
--      totales, hash de contenido).
--   2. `finance_bank_lines`: cada movimiento (fecha, concepto, monto firmado)
--      con estado de match: pendiente → propuesto → confirmado | sin_match.
--   3. RPC `bank_statement_upload`: arma lote + líneas. Idempotente por hash
--      del contenido: reimportar el mismo archivo no duplica nada.
--   4. RPC `bank_lines_match`: propone matches contra asientos que mueven la
--      cuenta 1.1.02 con igual monto firmado, tolerancia ±3 días, un asiento
--      por movimiento (nadie matchea dos veces).
--   5. RPC `bank_line_confirm`: confirma o rechaza. Lo confirmado es
--      historial: no se re-decide. Deja traza en audit_logs.
--
-- ⚠️ Lo que NO es: no escribe en el ledger ni "ajusta" asientos. Conciliar es
-- constatar que el banco y el libro cuentan lo mismo; si no cuentan lo mismo,
-- el movimiento queda visible como sin_match para revisión.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.finance_bank_statements (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  banco         text        NOT NULL CHECK (length(btrim(banco)) BETWEEN 1 AND 120),
  -- Rango civil del extracto, igual que los lotes de exportación.
  fecha_desde   date        NOT NULL,
  fecha_hasta   date        NOT NULL,
  -- Mismo archivo reimportado no duplica: hash de banco+período+filas.
  content_hash  text        NOT NULL,
  row_count     int         NOT NULL DEFAULT 0,
  matched_count int         NOT NULL DEFAULT 0,
  total_ingresos numeric(18,2) NOT NULL DEFAULT 0,
  total_egresos  numeric(18,2) NOT NULL DEFAULT 0,
  -- importado → parcial → conciliado.
  status        text        NOT NULL DEFAULT 'importado'
                  CHECK (status IN ('importado', 'parcial', 'conciliado')),
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rango_valido CHECK (fecha_hasta >= fecha_desde),
  UNIQUE (org_id, banco, fecha_desde, fecha_hasta, content_hash)
);

CREATE INDEX IF NOT EXISTS finance_bank_statements_org_idx
  ON public.finance_bank_statements (org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.finance_bank_lines (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_id   uuid        NOT NULL REFERENCES public.finance_bank_statements(id) ON DELETE CASCADE,
  org_id         uuid        NOT NULL,
  fecha          date        NOT NULL,
  concepto       text        NOT NULL CHECK (length(btrim(concepto)) BETWEEN 1 AND 500),
  referencia     text,
  -- Importe firmado: ingreso > 0, egreso < 0. El cero no concilia nada.
  monto          numeric(18,2) NOT NULL CHECK (monto <> 0),
  match_status   text        NOT NULL DEFAULT 'pendiente'
                   CHECK (match_status IN ('pendiente', 'propuesto', 'confirmado', 'sin_match')),
  match_entry_id uuid       REFERENCES public.ledger_entries(id) ON DELETE SET NULL,
  matched_by     uuid,
  matched_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- Un match (propuesto o confirmado) siempre apunta a un asiento real.
  CONSTRAINT match_requiere_entry CHECK (
    match_status NOT IN ('propuesto', 'confirmado') OR match_entry_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS finance_bank_lines_statement_idx
  ON public.finance_bank_lines (statement_id, fecha);
CREATE INDEX IF NOT EXISTS finance_bank_lines_match_idx
  ON public.finance_bank_lines (org_id, match_status)
  WHERE match_status IN ('pendiente', 'propuesto');

ALTER TABLE public.finance_bank_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_bank_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS finance_bank_statements_org ON public.finance_bank_statements;
CREATE POLICY finance_bank_statements_org ON public.finance_bank_statements
  FOR ALL USING (
    public.has_permission(org_id, 'expenses', 'view')
    AND public.is_org_member(org_id, auth.uid())
  );

DROP POLICY IF EXISTS finance_bank_lines_org ON public.finance_bank_lines;
CREATE POLICY finance_bank_lines_org ON public.finance_bank_lines
  FOR ALL USING (
    public.has_permission(org_id, 'expenses', 'view')
    AND public.is_org_member(org_id, auth.uid())
  );

-- ── RPC 1: importar extracto ────────────────────────────────────────────────
-- p_lines: [{ fecha: 'YYYY-MM-DD', concepto, referencia?, monto }]
-- Misma autoridad que F5.3: org explícita + permiso de gastos.
CREATE OR REPLACE FUNCTION public.bank_statement_upload(
  p_org         uuid,
  p_banco       text,
  p_fecha_desde date,
  p_fecha_hasta date,
  p_lines       jsonb
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_actor    uuid := auth.uid();
  v_hash     text;
  v_existing uuid;
  v_id       uuid;
  v_line     jsonb;
  v_fecha    date;
  v_concepto text;
  v_monto    numeric;
  v_ingresos numeric := 0;
  v_egresos  numeric := 0;
  v_count    int := 0;
BEGIN
  IF v_actor IS NULL
     OR NOT public.has_permission(p_org, 'expenses', 'view')
     OR NOT public.is_org_member(p_org, v_actor) THEN
    RAISE EXCEPTION 'Sin permiso para importar extractos en esta organizacion'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_banco IS NULL OR length(btrim(p_banco)) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'Banco invalido';
  END IF;
  IF p_fecha_desde IS NULL OR p_fecha_hasta IS NULL OR p_fecha_hasta < p_fecha_desde THEN
    RAISE EXCEPTION 'Rango de fechas invalido';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'El extracto no tiene movimientos';
  END IF;
  IF jsonb_array_length(p_lines) > 2000 THEN
    RAISE EXCEPTION 'El extracto supera el maximo de 2000 movimientos';
  END IF;

  -- Hash estable del contenido: mismo banco+período+filas = mismo extracto.
  v_hash := md5(
    lower(btrim(p_banco)) || '|' || p_fecha_desde::text || '|' || p_fecha_hasta::text
    || '|' || p_lines::text
  );

  -- Reimportar el mismo archivo no duplica nada.
  SELECT s.id INTO v_existing
    FROM public.finance_bank_statements s
   WHERE s.org_id = p_org
     AND s.banco = btrim(p_banco)
     AND s.fecha_desde = p_fecha_desde
     AND s.fecha_hasta = p_fecha_hasta
     AND s.content_hash = v_hash;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- Validar todas las filas antes de insertar nada: un extracto entra entero
  -- o no entra.
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    BEGIN
      v_fecha := (v_line->>'fecha')::date;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Movimiento con fecha invalida';
    END;
    v_concepto := btrim(COALESCE(v_line->>'concepto', ''));
    BEGIN
      v_monto := round((v_line->>'monto')::numeric, 2);
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Movimiento con monto invalido';
    END;
    IF v_fecha IS NULL OR v_fecha < p_fecha_desde OR v_fecha > p_fecha_hasta THEN
      RAISE EXCEPTION 'Movimiento fuera del rango del extracto (%)', v_line->>'fecha';
    END IF;
    IF v_concepto = '' OR length(v_concepto) > 500 THEN
      RAISE EXCEPTION 'Movimiento sin concepto o concepto demasiado largo';
    END IF;
    IF v_monto IS NULL OR v_monto = 0 OR v_monto = 'NaN'::numeric
       OR abs(v_monto) = 'Infinity'::numeric THEN
      RAISE EXCEPTION 'Movimiento con monto invalido';
    END IF;
    IF v_monto > 0 THEN v_ingresos := v_ingresos + v_monto;
    ELSE v_egresos := v_egresos + abs(v_monto); END IF;
    v_count := v_count + 1;
  END LOOP;

  INSERT INTO public.finance_bank_statements (
    org_id, banco, fecha_desde, fecha_hasta, content_hash,
    row_count, total_ingresos, total_egresos, created_by
  ) VALUES (
    p_org, btrim(p_banco), p_fecha_desde, p_fecha_hasta, v_hash,
    v_count, v_ingresos, v_egresos, v_actor
  ) RETURNING id INTO v_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    INSERT INTO public.finance_bank_lines (
      statement_id, org_id, fecha, concepto, referencia, monto
    ) VALUES (
      v_id, p_org,
      (v_line->>'fecha')::date,
      btrim(COALESCE(v_line->>'concepto', '')),
      NULLIF(left(btrim(COALESCE(v_line->>'referencia', '')), 200), ''),
      round((v_line->>'monto')::numeric, 2)
    );
  END LOOP;

  RETURN v_id;
END;
$fn$;

COMMENT ON FUNCTION public.bank_statement_upload(uuid, text, date, date, jsonb) IS
  'Importa un extracto bancario (lote + movimientos). Idempotente por hash de contenido; exige permiso de gastos.';

-- ── RPC 2: proponer matches contra asientos de banco ───────────────────────
-- Candidato: asiento vigente que mueve 1.1.02 (banco) con el mismo monto
-- firmado — ingreso = banco al debe, egreso = banco al haber — en ±3 días,
-- que todavía no matchea otro movimiento. Cada movimiento propone a lo sumo
-- un asiento; la confirmación queda en manos de la marca.
CREATE OR REPLACE FUNCTION public.bank_lines_match(p_statement_id uuid)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_actor  uuid := auth.uid();
  v_org    uuid;
  v_line   record;
  v_entry  uuid;
  v_count  int := 0;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT org_id INTO v_org FROM public.finance_bank_statements WHERE id = p_statement_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'El extracto no existe';
  END IF;
  IF NOT public.has_permission(v_org, 'expenses', 'view')
     OR NOT public.is_org_member(v_org, v_actor) THEN
    RAISE EXCEPTION 'Sin permiso para conciliar en esta organizacion'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- La propuesta es cálculo, no decisión: se recalcula en cada corrida.
  DELETE FROM public.finance_bank_lines
   WHERE statement_id = p_statement_id AND match_status = 'propuesto';

  FOR v_line IN
    SELECT id, fecha, monto
      FROM public.finance_bank_lines
     WHERE statement_id = p_statement_id
       AND match_status IN ('pendiente', 'sin_match')
     ORDER BY fecha
  LOOP
    SELECT e.id INTO v_entry
      FROM public.ledger_entries e
      JOIN public.ledger_lines l ON l.entry_id = e.id
      JOIN public.ledger_accounts a ON a.id = l.account_id
     WHERE e.org_id = v_org
       AND e.anulado_por IS NULL
       AND a.codigo = '1.1.02'
       AND e.fecha BETWEEN (v_line.fecha - 3) AND (v_line.fecha + 3)
       AND (
         (v_line.monto > 0 AND l.debe = v_line.monto)
         OR (v_line.monto < 0 AND l.haber = abs(v_line.monto))
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.finance_bank_lines other
          WHERE other.org_id = v_org
            AND other.match_entry_id = e.id
            AND other.match_status IN ('propuesto', 'confirmado')
       )
     ORDER BY abs(e.fecha - v_line.fecha)
     LIMIT 1;

    IF v_entry IS NOT NULL THEN
      UPDATE public.finance_bank_lines
         SET match_status = 'propuesto', match_entry_id = v_entry
       WHERE id = v_line.id;
      v_count := v_count + 1;
    END IF;
  END LOOP;

  -- Lo que quedó sin candidato queda visible para revisión manual.
  UPDATE public.finance_bank_lines
     SET match_status = 'sin_match', match_entry_id = NULL
   WHERE statement_id = p_statement_id AND match_status = 'pendiente';

  UPDATE public.finance_bank_statements
     SET matched_count = (
       SELECT count(*) FROM public.finance_bank_lines
        WHERE statement_id = p_statement_id AND match_status = 'confirmado'
     )
   WHERE id = p_statement_id;

  RETURN v_count;
END;
$fn$;

COMMENT ON FUNCTION public.bank_lines_match(uuid) IS
  'Propone matches entre movimientos del extracto y asientos que mueven la cuenta banco (1.1.02), ±3 dias, un asiento por movimiento.';

-- ── RPC 3: confirmar o rechazar un match ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.bank_line_confirm(
  p_line_id uuid,
  p_accept  boolean
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_line  public.finance_bank_lines;
  v_org   uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_accept IS NULL OR p_accept NOT IN (true, false) THEN
    RAISE EXCEPTION 'Accion invalida';
  END IF;

  SELECT * INTO v_line FROM public.finance_bank_lines WHERE id = p_line_id FOR UPDATE;
  IF v_line.id IS NULL THEN
    RAISE EXCEPTION 'El movimiento no existe';
  END IF;
  v_org := v_line.org_id;
  -- Confirmar es una decisión contable: exige permiso de edición, no sólo vista.
  IF NOT public.has_permission(v_org, 'expenses', 'edit')
     OR NOT public.is_org_member(v_org, v_actor) THEN
    RAISE EXCEPTION 'Sin permiso para conciliar en esta organizacion'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Lo confirmado es historial: no se re-decide.
  IF v_line.match_status = 'confirmado' THEN
    RETURN jsonb_build_object('ok', true, 'already_confirmed', true, 'line_id', v_line.id);
  END IF;

  IF p_accept THEN
    IF v_line.match_status <> 'propuesto' OR v_line.match_entry_id IS NULL THEN
      RAISE EXCEPTION 'El movimiento no tiene un match propuesto para confirmar';
    END IF;
  END IF;

  UPDATE public.finance_bank_lines
     SET match_status   = CASE WHEN p_accept THEN 'confirmado' ELSE 'pendiente' END,
         match_entry_id = CASE WHEN p_accept THEN match_entry_id ELSE NULL END,
         matched_by     = CASE WHEN p_accept THEN v_actor ELSE NULL END,
         matched_at     = CASE WHEN p_accept THEN now() ELSE NULL END
   WHERE id = v_line.id;

  UPDATE public.finance_bank_statements s
     SET status = CASE
           WHEN EXISTS (
             SELECT 1 FROM public.finance_bank_lines l
              WHERE l.statement_id = s.id
                AND l.match_status IN ('pendiente', 'propuesto', 'sin_match')
           ) THEN 'parcial'
           ELSE 'conciliado'
         END,
         matched_count = (
           SELECT count(*) FROM public.finance_bank_lines l
            WHERE l.statement_id = s.id AND l.match_status = 'confirmado'
         )
   WHERE s.id = v_line.statement_id;

  INSERT INTO public.audit_logs (
    user_id, org_id, action, entity_type, entity_id, details, severity, tags
  ) VALUES (
    v_actor, v_org,
    CASE WHEN p_accept THEN 'confirm' ELSE 'reject' END,
    'bank_line_match', v_line.id::text,
    jsonb_build_object(
      'statement_id', v_line.statement_id,
      'match_entry_id', v_line.match_entry_id,
      'monto', v_line.monto
    ),
    'info', ARRAY['finance', 'bank_reconciliation']::text[]
  );

  RETURN jsonb_build_object(
    'ok', true, 'line_id', v_line.id,
    'match_status', CASE WHEN p_accept THEN 'confirmado' ELSE 'pendiente' END
  );
END;
$fn$;

COMMENT ON FUNCTION public.bank_line_confirm(uuid, boolean) IS
  'Confirma o rechaza un match propuesto. Lo confirmado es historial inmutable y deja traza de auditoria.';

REVOKE ALL ON FUNCTION public.bank_statement_upload(uuid, text, date, date, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bank_lines_match(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bank_line_confirm(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bank_statement_upload(uuid, text, date, date, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bank_lines_match(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bank_line_confirm(uuid, boolean) TO authenticated;
