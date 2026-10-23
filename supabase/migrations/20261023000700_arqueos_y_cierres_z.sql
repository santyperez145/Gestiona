-- Arqueos de caja y cierres Z (2026-10-23).
--
-- Lo que el contador necesita del mostrador, y que hasta hoy no quedaba en
-- ningún lado:
--
--   1. ARQUEO. Contar la caja (parcial, en medio del turno, o al cerrarla) y
--      dejar constancia: billetes por denominación, lo declarado de tarjetas,
--      QR y transferencias contra lo que dice el sistema, quién contó y el
--      motivo de cada diferencia. El arqueo de cierre cierra el turno con la
--      misma función de siempre (`pos_cash_session_close`). No se edita.
--
--   2. CIERRE Z. Con controlador fiscal, ARCA pide registrar los tiques por día
--      con un asiento resumen que totalice las operaciones con el primer y el
--      último número emitidos («Libro de IVA Digital — modalidades especiales
--      de registración», d): eso es el Z. Se guarda el Z del equipo (leído del
--      controlador o cargado a mano desde el ticket), con su número, fecha y,
--      por tipo de comprobante, desde/hasta, cantidad, total y alícuotas. Nace
--      en borrador con los controles de consistencia y sólo entra al Libro IVA
--      confirmado; confirmado no se edita.
--
--   3. CIERRE DIARIO ELECTRÓNICO. Quien factura electrónico no tiene Z, pero
--      el comercio y el contador necesitan el mismo corte numerado del día. La
--      base lo acepta sólo si coincide con lo autorizado por ARCA ese día en ese
--      punto de venta (cantidad, numeración y total por tipo).
--
-- Reversible: DROP de las tablas y funciones nuevas.
BEGIN;

-- ── 1. Arqueos ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.arqueos_caja (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.cash_sessions(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('parcial', 'cierre')),
  efectivo_contado numeric(14,2) NOT NULL CHECK (efectivo_contado >= 0),
  efectivo_esperado numeric(14,2) NOT NULL,
  diferencia numeric(14,2) NOT NULL,
  denominaciones jsonb NOT NULL DEFAULT '{}'::jsonb,
  otros_medios jsonb NOT NULL DEFAULT '[]'::jsonb,
  motivo text,
  realizado_por uuid NOT NULL REFERENCES auth.users(id),
  realizado_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS arqueos_caja_sesion_idx ON public.arqueos_caja(session_id, realizado_at);
CREATE INDEX IF NOT EXISTS arqueos_caja_org_idx ON public.arqueos_caja(org_id, realizado_at DESC);
ALTER TABLE public.arqueos_caja ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS arqueos_caja_lectura ON public.arqueos_caja;
CREATE POLICY arqueos_caja_lectura ON public.arqueos_caja
  FOR SELECT TO authenticated USING (public.is_org_member(org_id, auth.uid()));
REVOKE ALL ON public.arqueos_caja FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.arqueos_caja TO authenticated;

-- ── 2. Cierres Z ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cierres_z (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  origen text NOT NULL CHECK (origen IN ('controlador', 'manual', 'electronico')),
  punto_venta integer NOT NULL CHECK (punto_venta BETWEEN 1 AND 99998),
  numero integer NOT NULL CHECK (numero > 0),
  fecha date NOT NULL,
  equipo jsonb NOT NULL DEFAULT '{}'::jsonb,
  comprobantes jsonb NOT NULL DEFAULT '[]'::jsonb,
  total numeric(16,2) NOT NULL DEFAULT 0,
  iva numeric(16,2) NOT NULL DEFAULT 0,
  observaciones jsonb NOT NULL DEFAULT '[]'::jsonb,
  estado text NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'confirmado')),
  creado_por uuid NOT NULL REFERENCES auth.users(id),
  creado_at timestamptz NOT NULL DEFAULT now(),
  confirmado_por uuid REFERENCES auth.users(id),
  confirmado_at timestamptz
);
-- Los Z del controlador (leídos o cargados a mano) comparten la numeración del
-- equipo; los cierres electrónicos llevan la suya, uno por día y punto de venta.
CREATE UNIQUE INDEX IF NOT EXISTS cierres_z_numero_uq
  ON public.cierres_z(org_id, (origen = 'electronico'), punto_venta, numero);
CREATE UNIQUE INDEX IF NOT EXISTS cierres_z_dia_electronico_uq
  ON public.cierres_z(org_id, punto_venta, fecha) WHERE origen = 'electronico';
CREATE INDEX IF NOT EXISTS cierres_z_periodo_idx ON public.cierres_z(org_id, fecha);
ALTER TABLE public.cierres_z ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cierres_z_lectura ON public.cierres_z;
CREATE POLICY cierres_z_lectura ON public.cierres_z
  FOR SELECT TO authenticated USING (public.is_org_member(org_id, auth.uid()));
REVOKE ALL ON public.cierres_z FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cierres_z TO authenticated;

-- Un Z confirmado es un registro fiscal: no se edita ni se borra.
CREATE OR REPLACE FUNCTION public.trg_cierres_z_inmutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF OLD.estado = 'confirmado' THEN
    RAISE EXCEPTION 'El cierre Z % ya está confirmado: no se puede modificar', OLD.numero
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$fn$;
DROP TRIGGER IF EXISTS trg_cierres_z_inmutable ON public.cierres_z;
CREATE TRIGGER trg_cierres_z_inmutable
  BEFORE UPDATE OR DELETE ON public.cierres_z
  FOR EACH ROW EXECUTE FUNCTION public.trg_cierres_z_inmutable();

CREATE OR REPLACE FUNCTION public.trg_arqueos_caja_inmutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  RAISE EXCEPTION 'Un arqueo registrado no se modifica: hacé uno nuevo' USING ERRCODE = 'check_violation';
END;
$fn$;
DROP TRIGGER IF EXISTS trg_arqueos_caja_inmutable ON public.arqueos_caja;
CREATE TRIGGER trg_arqueos_caja_inmutable
  BEFORE UPDATE OR DELETE ON public.arqueos_caja
  FOR EACH ROW EXECUTE FUNCTION public.trg_arqueos_caja_inmutable();

-- ── 3. Validación de un Z ───────────────────────────────────────────────
-- Notas de crédito: restan en los totales (tiques del controlador y ARCA).
CREATE OR REPLACE FUNCTION public.z_es_nota_de_credito(p_tipo integer)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT p_tipo IN (110, 112, 113, 114, 119, 3, 8, 13, 53, 203, 208, 213, 21);
$fn$;

-- Revisa la estructura (errores que impiden guardar) y la consistencia
-- (observaciones: 'error' impide confirmar, 'aviso' no).
CREATE OR REPLACE FUNCTION public.validar_comprobantes_z(p_origen text, p_comprobantes jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_c jsonb;
  v_a jsonb;
  v_tipo integer;
  v_desde bigint;
  v_hasta bigint;
  v_total numeric;
  v_desglose numeric;
  v_obs jsonb := '[]'::jsonb;
  v_tipos integer[] := ARRAY[]::integer[];
  v_tasas numeric[] := ARRAY[0, 2.5, 5, 10.5, 21, 27];
BEGIN
  IF p_comprobantes IS NULL OR jsonb_typeof(p_comprobantes) <> 'array' THEN
    RAISE EXCEPTION 'Los comprobantes del cierre tienen que ser una lista' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_comprobantes) > 40 THEN
    RAISE EXCEPTION 'Demasiados tipos de comprobante en un cierre' USING ERRCODE = '22023';
  END IF;
  FOR v_c IN SELECT * FROM jsonb_array_elements(p_comprobantes) LOOP
    v_tipo := (v_c->>'tipo')::integer;
    IF v_tipo IS NULL OR v_tipo < 1 OR v_tipo > 999 THEN
      RAISE EXCEPTION 'Tipo de comprobante inválido en el cierre' USING ERRCODE = '22023';
    END IF;
    IF p_origen IN ('controlador', 'manual') AND v_tipo NOT IN (81, 82, 83, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120) THEN
      RAISE EXCEPTION 'El tipo % no es un comprobante de controlador fiscal', v_tipo USING ERRCODE = '22023';
    END IF;
    IF v_tipo = ANY(v_tipos) THEN
      RAISE EXCEPTION 'El tipo % figura dos veces en el cierre', v_tipo USING ERRCODE = '22023';
    END IF;
    v_tipos := v_tipos || v_tipo;
    v_desde := (v_c->>'desde')::bigint;
    v_hasta := (v_c->>'hasta')::bigint;
    IF v_desde IS NULL OR v_hasta IS NULL OR v_desde < 1 OR v_hasta < v_desde OR v_hasta > 99999999 THEN
      RAISE EXCEPTION 'Tipo %: la numeración desde/hasta no es válida', v_tipo USING ERRCODE = '22023';
    END IF;
    IF COALESCE((v_c->>'cantidad')::integer, -1) < 0 OR (v_c->>'cantidad')::integer > v_hasta - v_desde + 1 THEN
      RAISE EXCEPTION 'Tipo %: la cantidad no entra en la numeración informada', v_tipo USING ERRCODE = '22023';
    END IF;
    v_total := (v_c->>'total')::numeric;
    IF v_total IS NULL OR v_total < 0 THEN
      RAISE EXCEPTION 'Tipo %: falta el total', v_tipo USING ERRCODE = '22023';
    END IF;

    v_desglose := COALESCE((v_c->>'exento')::numeric, 0) + COALESCE((v_c->>'no_gravado')::numeric, 0)
                + COALESCE((v_c->>'internos')::numeric, 0) + COALESCE((v_c->>'otros_tributos')::numeric, 0);
    IF jsonb_typeof(COALESCE(v_c->'alicuotas', '[]'::jsonb)) <> 'array' THEN
      RAISE EXCEPTION 'Tipo %: las alícuotas tienen que ser una lista', v_tipo USING ERRCODE = '22023';
    END IF;
    FOR v_a IN SELECT * FROM jsonb_array_elements(COALESCE(v_c->'alicuotas', '[]'::jsonb)) LOOP
      IF NOT ((v_a->>'tasa')::numeric = ANY(v_tasas)) THEN
        RAISE EXCEPTION 'Tipo %: la alícuota % no existe', v_tipo, v_a->>'tasa' USING ERRCODE = '22023';
      END IF;
      v_desglose := v_desglose + COALESCE((v_a->>'neto')::numeric, 0) + COALESCE((v_a->>'iva')::numeric, 0);
    END LOOP;

    -- Los C no discriminan IVA: su total no se desglosa por alícuota.
    IF v_tipo NOT IN (111, 114, 117, 11, 12, 13, 15, 211, 212, 213)
       AND jsonb_array_length(COALESCE(v_c->'alicuotas', '[]'::jsonb)) > 0
       AND abs(v_desglose - v_total) > 1 THEN
      v_obs := v_obs || jsonb_build_array(jsonb_build_object('nivel', 'error', 'texto',
        format('Tipo %s: lo desglosado (%s) no da el total (%s). Revisá contra el ticket.', v_tipo, round(v_desglose, 2), round(v_total, 2))));
    END IF;
    IF (v_c->>'cantidad')::integer < v_hasta - v_desde + 1 - COALESCE((v_c->>'cancelados')::integer, 0) THEN
      v_obs := v_obs || jsonb_build_array(jsonb_build_object('nivel', 'aviso', 'texto',
        format('Tipo %s: en la numeración %s–%s hay más números que comprobantes emitidos y cancelados.', v_tipo, v_desde, v_hasta)));
    END IF;
  END LOOP;
  RETURN v_obs;
END;
$fn$;

-- Totales con signo: las notas de crédito restan.
CREATE OR REPLACE FUNCTION public.totales_z(p_comprobantes jsonb, OUT total numeric, OUT iva numeric)
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT COALESCE(sum(CASE WHEN public.z_es_nota_de_credito((c->>'tipo')::integer) THEN -1 ELSE 1 END * (c->>'total')::numeric), 0),
         COALESCE(sum(CASE WHEN public.z_es_nota_de_credito((c->>'tipo')::integer) THEN -1 ELSE 1 END
           * (SELECT COALESCE(sum((a->>'iva')::numeric), 0) FROM jsonb_array_elements(COALESCE(c->'alicuotas', '[]'::jsonb)) a)), 0)
    FROM jsonb_array_elements(p_comprobantes) c;
$fn$;

-- Avisos de numeración: el Z anterior del mismo punto de venta tiene que
-- estar, y el desde de cada tipo seguir al hasta del Z anterior.
CREATE OR REPLACE FUNCTION public.avisos_secuencia_z(
  p_org uuid, p_electronico boolean, p_punto_venta integer, p_numero integer, p_comprobantes jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_anterior public.cierres_z;
  v_obs jsonb := '[]'::jsonb;
  v_c jsonb;
  v_prev jsonb;
BEGIN
  SELECT * INTO v_anterior FROM public.cierres_z z
   WHERE z.org_id = p_org AND (z.origen = 'electronico') = p_electronico
     AND z.punto_venta = p_punto_venta AND z.numero < p_numero AND z.estado = 'confirmado'
   ORDER BY z.numero DESC LIMIT 1;
  IF v_anterior.id IS NULL THEN
    RETURN v_obs;
  END IF;
  IF v_anterior.numero <> p_numero - 1 THEN
    v_obs := v_obs || jsonb_build_array(jsonb_build_object('nivel', 'aviso', 'texto',
      format('Falta cargar del Z %s al %s: el Libro IVA del mes queda incompleto sin ellos.', v_anterior.numero + 1, p_numero - 1)));
    RETURN v_obs;
  END IF;
  FOR v_c IN SELECT * FROM jsonb_array_elements(p_comprobantes) LOOP
    SELECT p INTO v_prev FROM jsonb_array_elements(v_anterior.comprobantes) p WHERE (p->>'tipo') = (v_c->>'tipo') LIMIT 1;
    IF v_prev IS NOT NULL AND (v_c->>'desde')::bigint <> (v_prev->>'hasta')::bigint + 1 THEN
      v_obs := v_obs || jsonb_build_array(jsonb_build_object('nivel', 'aviso', 'texto',
        format('Tipo %s: el Z anterior terminó en %s y éste empieza en %s.', v_c->>'tipo', v_prev->>'hasta', v_c->>'desde')));
    END IF;
  END LOOP;
  RETURN v_obs;
END;
$fn$;

-- ── 4. Registrar y confirmar un Z del controlador ───────────────────────
CREATE OR REPLACE FUNCTION public.registrar_cierre_z(
  p_org uuid,
  p_origen text,
  p_punto_venta integer,
  p_numero integer,
  p_fecha date,
  p_equipo jsonb,
  p_comprobantes jsonb,
  p_confirmar boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_obs jsonb;
  v_tot record;
  v_existente public.cierres_z;
  v_id uuid;
  v_hoy date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_org_member(p_org, auth.uid()) THEN
    RAISE EXCEPTION 'No sos miembro de esta organizacion' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.exigir_permiso(p_org, 'pos', 'edit', 'registrar un cierre Z');
  IF p_origen NOT IN ('controlador', 'manual') THEN
    RAISE EXCEPTION 'Origen de cierre Z inválido' USING ERRCODE = '22023';
  END IF;
  IF p_punto_venta IS NULL OR p_punto_venta < 1 OR p_punto_venta > 99998 THEN
    RAISE EXCEPTION 'Escribí el punto de venta del controlador' USING ERRCODE = '22023';
  END IF;
  IF p_numero IS NULL OR p_numero < 1 THEN
    RAISE EXCEPTION 'Escribí el número del Z' USING ERRCODE = '22023';
  END IF;
  IF p_fecha IS NULL OR p_fecha > v_hoy OR p_fecha < v_hoy - 3650 THEN
    RAISE EXCEPTION 'La fecha del Z no es válida' USING ERRCODE = '22023';
  END IF;

  v_obs := public.validar_comprobantes_z(p_origen, p_comprobantes)
        || public.avisos_secuencia_z(p_org, false, p_punto_venta, p_numero, p_comprobantes);
  SELECT * INTO v_tot FROM public.totales_z(p_comprobantes);

  SELECT * INTO v_existente FROM public.cierres_z z
   WHERE z.org_id = p_org AND z.origen <> 'electronico' AND z.punto_venta = p_punto_venta AND z.numero = p_numero
   FOR UPDATE;
  IF v_existente.estado = 'confirmado' THEN
    RAISE EXCEPTION 'El Z % del punto de venta % ya está confirmado', p_numero, p_punto_venta USING ERRCODE = 'unique_violation';
  END IF;
  IF p_confirmar AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_obs) o WHERE o->>'nivel' = 'error') THEN
    RAISE EXCEPTION 'No se puede confirmar el Z: %',
      (SELECT string_agg(o->>'texto', ' ') FROM jsonb_array_elements(v_obs) o WHERE o->>'nivel' = 'error')
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_existente.id IS NOT NULL THEN
    UPDATE public.cierres_z SET
      origen = p_origen, fecha = p_fecha, equipo = COALESCE(p_equipo, '{}'::jsonb), comprobantes = p_comprobantes,
      total = round(v_tot.total, 2), iva = round(v_tot.iva, 2), observaciones = v_obs,
      estado = CASE WHEN p_confirmar THEN 'confirmado' ELSE 'borrador' END,
      confirmado_por = CASE WHEN p_confirmar THEN auth.uid() END,
      confirmado_at = CASE WHEN p_confirmar THEN now() END
    WHERE id = v_existente.id
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.cierres_z (org_id, origen, punto_venta, numero, fecha, equipo, comprobantes, total, iva,
                                  observaciones, estado, creado_por, confirmado_por, confirmado_at)
    VALUES (p_org, p_origen, p_punto_venta, p_numero, p_fecha, COALESCE(p_equipo, '{}'::jsonb), p_comprobantes,
            round(v_tot.total, 2), round(v_tot.iva, 2), v_obs,
            CASE WHEN p_confirmar THEN 'confirmado' ELSE 'borrador' END, auth.uid(),
            CASE WHEN p_confirmar THEN auth.uid() END, CASE WHEN p_confirmar THEN now() END)
    RETURNING id INTO v_id;
  END IF;

  INSERT INTO public.audit_logs (user_id, org_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), p_org, CASE WHEN p_confirmar THEN 'confirm' ELSE 'create' END, 'cierre_z', v_id,
          jsonb_build_object('punto_venta', p_punto_venta, 'numero', p_numero, 'fecha', p_fecha, 'origen', p_origen, 'total', round(v_tot.total, 2)));

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'estado', CASE WHEN p_confirmar THEN 'confirmado' ELSE 'borrador' END,
                            'total', round(v_tot.total, 2), 'iva', round(v_tot.iva, 2), 'observaciones', v_obs);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.confirmar_cierre_z(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_z public.cierres_z;
BEGIN
  SELECT * INTO v_z FROM public.cierres_z WHERE id = p_id FOR UPDATE;
  IF v_z.id IS NULL THEN
    RAISE EXCEPTION 'Ese cierre Z no existe' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_z.estado = 'confirmado' THEN
    RETURN jsonb_build_object('ok', true, 'id', v_z.id, 'estado', 'confirmado', 'ya_confirmado', true);
  END IF;
  RETURN public.registrar_cierre_z(v_z.org_id, v_z.origen, v_z.punto_venta, v_z.numero, v_z.fecha, v_z.equipo, v_z.comprobantes, true);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.descartar_cierre_z(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_z public.cierres_z;
BEGIN
  SELECT * INTO v_z FROM public.cierres_z WHERE id = p_id FOR UPDATE;
  IF v_z.id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'ya_descartado', true);
  END IF;
  IF auth.uid() IS NULL OR NOT public.is_org_member(v_z.org_id, auth.uid()) THEN
    RAISE EXCEPTION 'No sos miembro de esta organizacion' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.exigir_permiso(v_z.org_id, 'pos', 'edit', 'descartar un cierre Z');
  DELETE FROM public.cierres_z WHERE id = v_z.id;  -- el trigger rechaza un confirmado
  RETURN jsonb_build_object('ok', true);
END;
$fn$;

-- ── 5. Cierre diario electrónico ────────────────────────────────────────
-- Lo autorizado por ARCA ese día en ese punto de venta, por tipo: la base
-- compara contra esto el informe que arma la pantalla (con el mismo código
-- que el Libro IVA) antes de guardarlo.
CREATE OR REPLACE FUNCTION public.autorizado_del_dia(p_org uuid, p_punto_venta integer, p_fecha date)
RETURNS TABLE (tipo integer, cantidad integer, desde bigint, hasta bigint, total numeric)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT i.tipo_comprobante::integer, count(*)::integer, min(i.numero_afip)::bigint, max(i.numero_afip)::bigint, round(sum(i.total), 2)
    FROM public.invoices i
   WHERE i.org_id = p_org
     AND i.punto_venta = p_punto_venta
     AND i.issue_date::date = p_fecha
     AND i.afip_status = 'authorized'
     AND i.cae IS NOT NULL
     AND COALESCE(i.afip_environment, '') <> 'homologacion'
   GROUP BY i.tipo_comprobante;
$fn$;

CREATE OR REPLACE FUNCTION public.cerrar_dia_electronico(
  p_org uuid, p_punto_venta integer, p_fecha date, p_comprobantes jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_obs jsonb;
  v_tot record;
  v_aut record;
  v_c jsonb;
  v_numero integer;
  v_id uuid;
  v_hoy date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_diferencias text := '';
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_org_member(p_org, auth.uid()) THEN
    RAISE EXCEPTION 'No sos miembro de esta organizacion' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.exigir_permiso(p_org, 'pos', 'edit', 'cerrar el día');
  IF p_punto_venta IS NULL OR p_punto_venta < 1 OR p_punto_venta > 99998 THEN
    RAISE EXCEPTION 'Elegí el punto de venta' USING ERRCODE = '22023';
  END IF;
  IF p_fecha IS NULL OR p_fecha > v_hoy THEN
    RAISE EXCEPTION 'No se puede cerrar un día que todavía no llegó' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.cierres_z z WHERE z.org_id = p_org AND z.origen = 'electronico'
                AND z.punto_venta = p_punto_venta AND z.fecha = p_fecha) THEN
    RAISE EXCEPTION 'El % ya está cerrado en el punto de venta %', to_char(p_fecha, 'DD/MM/YYYY'), p_punto_venta
      USING ERRCODE = 'unique_violation';
  END IF;

  v_obs := public.validar_comprobantes_z('electronico', p_comprobantes);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_obs) o WHERE o->>'nivel' = 'error') THEN
    RAISE EXCEPTION 'El informe del día no es consistente: %',
      (SELECT string_agg(o->>'texto', ' ') FROM jsonb_array_elements(v_obs) o WHERE o->>'nivel' = 'error')
      USING ERRCODE = 'check_violation';
  END IF;

  -- Cada tipo autorizado tiene que estar, igual, en el informe; y nada más.
  FOR v_aut IN SELECT * FROM public.autorizado_del_dia(p_org, p_punto_venta, p_fecha) LOOP
    SELECT c INTO v_c FROM jsonb_array_elements(p_comprobantes) c WHERE (c->>'tipo')::integer = v_aut.tipo LIMIT 1;
    IF v_c IS NULL THEN
      v_diferencias := v_diferencias || format(' Falta el tipo %s (%s autorizados).', v_aut.tipo, v_aut.cantidad);
    ELSIF (v_c->>'cantidad')::integer <> v_aut.cantidad OR (v_c->>'desde')::bigint <> v_aut.desde
          OR (v_c->>'hasta')::bigint <> v_aut.hasta OR abs((v_c->>'total')::numeric - v_aut.total) > 0.01 THEN
      v_diferencias := v_diferencias || format(' Tipo %s: ARCA autorizó %s del %s al %s por %s.',
        v_aut.tipo, v_aut.cantidad, v_aut.desde, v_aut.hasta, v_aut.total);
    END IF;
  END LOOP;
  FOR v_c IN SELECT * FROM jsonb_array_elements(p_comprobantes) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.autorizado_del_dia(p_org, p_punto_venta, p_fecha) a WHERE a.tipo = (v_c->>'tipo')::integer) THEN
      v_diferencias := v_diferencias || format(' El tipo %s no tiene comprobantes autorizados ese día.', v_c->>'tipo');
    END IF;
  END LOOP;
  IF v_diferencias <> '' THEN
    RAISE EXCEPTION 'El informe no coincide con lo autorizado por ARCA:%', v_diferencias USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('cierre_electronico:' || p_org || ':' || p_punto_venta, 0));
  SELECT COALESCE(max(z.numero), 0) + 1 INTO v_numero FROM public.cierres_z z
   WHERE z.org_id = p_org AND z.origen = 'electronico' AND z.punto_venta = p_punto_venta;
  SELECT * INTO v_tot FROM public.totales_z(p_comprobantes);

  INSERT INTO public.cierres_z (org_id, origen, punto_venta, numero, fecha, comprobantes, total, iva, observaciones,
                                estado, creado_por, confirmado_por, confirmado_at)
  VALUES (p_org, 'electronico', p_punto_venta, v_numero, p_fecha, p_comprobantes, round(v_tot.total, 2), round(v_tot.iva, 2),
          v_obs, 'confirmado', auth.uid(), auth.uid(), now())
  RETURNING id INTO v_id;

  INSERT INTO public.audit_logs (user_id, org_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), p_org, 'confirm', 'cierre_z', v_id,
          jsonb_build_object('punto_venta', p_punto_venta, 'numero', v_numero, 'fecha', p_fecha, 'origen', 'electronico', 'total', round(v_tot.total, 2)));

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'numero', v_numero, 'total', round(v_tot.total, 2), 'iva', round(v_tot.iva, 2));
END;
$fn$;

-- ── 6. Arqueo ────────────────────────────────────────────────────────────
-- Lo que dice el sistema por medio de pago (sin efectivo): entradas menos salidas.
CREATE OR REPLACE FUNCTION public.cash_session_por_medio(p_session_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(jsonb_object_agg(medio, monto), '{}'::jsonb) FROM (
    SELECT lower(btrim(COALESCE(e.payment_method, 'efectivo'))) AS medio,
           round(sum(CASE WHEN e.entry_type IN ('sale_in', 'debt_payment', 'manual_in') THEN e.amount_ars
                          WHEN e.entry_type IN ('refund_out', 'expense_out', 'supplier_out', 'manual_out') THEN -e.amount_ars
                          ELSE 0 END), 2) AS monto
      FROM public.cash_entries e
     WHERE e.session_id = p_session_id
       AND e.entry_type NOT IN ('opening', 'closing')
       AND lower(btrim(COALESCE(e.payment_method, 'efectivo'))) <> 'efectivo'
     GROUP BY 1
  ) t;
$fn$;

CREATE OR REPLACE FUNCTION public.registrar_arqueo(
  p_session_id uuid,
  p_tipo text,
  p_efectivo numeric,
  p_denominaciones jsonb DEFAULT '{}'::jsonb,
  p_otros_medios jsonb DEFAULT '{}'::jsonb,
  p_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_session public.cash_sessions;
  v_esperado numeric;
  v_dif numeric;
  v_sistema jsonb;
  v_otros jsonb := '[]'::jsonb;
  v_medio text;
  v_sis numeric;
  v_decl numeric;
  v_suma numeric := 0;
  v_k text;
  v_v jsonb;
  v_hay_dif boolean := false;
  v_motivo text := NULLIF(left(btrim(COALESCE(p_motivo, '')), 1000), '');
  v_id uuid;
  v_cierre jsonb;
  v_billetes text[] := ARRAY['20000', '10000', '2000', '1000', '500', '200', '100', '50', '20', '10', '5', '2', '1'];
BEGIN
  SELECT * INTO v_session FROM public.cash_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_session.id IS NULL OR auth.uid() IS NULL OR NOT public.is_org_member(v_session.org_id, auth.uid()) THEN
    RAISE EXCEPTION 'La sesión no existe o no pertenece a tu organización' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.exigir_permiso(v_session.org_id, 'pos', 'edit', 'hacer un arqueo de caja');
  IF v_session.status <> 'open' THEN
    RAISE EXCEPTION 'La caja ya está cerrada' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF p_tipo NOT IN ('parcial', 'cierre') THEN
    RAISE EXCEPTION 'Tipo de arqueo inválido' USING ERRCODE = '22023';
  END IF;
  IF p_efectivo IS NULL OR p_efectivo < 0 THEN
    RAISE EXCEPTION 'El efectivo contado no puede ser negativo' USING ERRCODE = '22023';
  END IF;

  -- Billetes: la suma tiene que dar lo declarado (si se contó por billete).
  IF p_denominaciones IS NOT NULL AND p_denominaciones <> '{}'::jsonb THEN
    IF jsonb_typeof(p_denominaciones) <> 'object' THEN
      RAISE EXCEPTION 'Las denominaciones tienen que ser billete → cantidad' USING ERRCODE = '22023';
    END IF;
    FOR v_k, v_v IN SELECT * FROM jsonb_each(p_denominaciones) LOOP
      IF v_k = 'monedas' THEN
        IF (v_v #>> '{}')::numeric < 0 THEN RAISE EXCEPTION 'Las monedas no pueden ser negativas' USING ERRCODE = '22023'; END IF;
        v_suma := v_suma + (v_v #>> '{}')::numeric;
      ELSIF v_k = ANY(v_billetes) THEN
        IF (v_v #>> '{}')::numeric < 0 OR (v_v #>> '{}')::numeric <> trunc((v_v #>> '{}')::numeric) THEN
          RAISE EXCEPTION 'La cantidad de billetes de $% no es válida', v_k USING ERRCODE = '22023';
        END IF;
        v_suma := v_suma + v_k::numeric * (v_v #>> '{}')::numeric;
      ELSE
        RAISE EXCEPTION 'No existe el billete de $%', v_k USING ERRCODE = '22023';
      END IF;
    END LOOP;
    IF abs(v_suma - p_efectivo) > 0.01 THEN
      RAISE EXCEPTION 'Los billetes suman $% y el efectivo declarado es $%', v_suma, p_efectivo USING ERRCODE = '22023';
    END IF;
  END IF;

  v_esperado := public.cash_session_expected_cash(v_session.id);
  v_dif := round(p_efectivo, 2) - v_esperado;
  v_hay_dif := abs(v_dif) >= 1;

  -- Otros medios: lo declarado (lote del posnet, resumen de QR) contra el sistema.
  v_sistema := public.cash_session_por_medio(v_session.id);
  FOR v_medio IN
    SELECT k FROM jsonb_object_keys(v_sistema) k
    UNION SELECT k FROM jsonb_object_keys(COALESCE(NULLIF(p_otros_medios, 'null'::jsonb), '{}'::jsonb)) k
  LOOP
    v_sis := COALESCE((v_sistema->>v_medio)::numeric, 0);
    v_decl := (p_otros_medios->>v_medio)::numeric;
    IF v_decl IS NOT NULL AND v_decl < 0 THEN
      RAISE EXCEPTION 'Lo declarado de % no puede ser negativo', v_medio USING ERRCODE = '22023';
    END IF;
    v_otros := v_otros || jsonb_build_array(jsonb_build_object(
      'medio', v_medio, 'sistema', v_sis, 'declarado', v_decl,
      'diferencia', CASE WHEN v_decl IS NULL THEN NULL ELSE round(v_decl - v_sis, 2) END));
    IF v_decl IS NOT NULL AND abs(v_decl - v_sis) >= 1 THEN
      v_hay_dif := true;
    END IF;
  END LOOP;

  IF v_hay_dif AND v_motivo IS NULL THEN
    RAISE EXCEPTION 'El arqueo tiene diferencias contra el sistema: escribí el motivo.' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.arqueos_caja (org_id, session_id, tipo, efectivo_contado, efectivo_esperado, diferencia,
                                   denominaciones, otros_medios, motivo, realizado_por)
  VALUES (v_session.org_id, v_session.id, p_tipo, round(p_efectivo, 2), v_esperado, v_dif,
          COALESCE(p_denominaciones, '{}'::jsonb), v_otros, v_motivo, auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO public.audit_logs (user_id, org_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), v_session.org_id, 'create', 'arqueo_caja', v_id,
          jsonb_build_object('session_id', v_session.id, 'tipo', p_tipo, 'contado', round(p_efectivo, 2),
                             'esperado', v_esperado, 'diferencia', v_dif, 'motivo', v_motivo));

  -- El arqueo de cierre cierra el turno por el camino de siempre.
  IF p_tipo = 'cierre' THEN
    v_cierre := public.pos_cash_session_close(v_session.id, round(p_efectivo, 2), v_motivo);
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'esperado', v_esperado, 'diferencia', v_dif,
                            'otros_medios', v_otros, 'cierre', v_cierre);
END;
$fn$;

-- ── 7. Permisos y contratos ─────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.validar_comprobantes_z(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.totales_z(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.avisos_secuencia_z(uuid, boolean, integer, integer, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.autorizado_del_dia(uuid, integer, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cash_session_por_medio(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.z_es_nota_de_credito(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.z_es_nota_de_credito(integer) TO authenticated;
REVOKE ALL ON FUNCTION public.registrar_cierre_z(uuid, text, integer, integer, date, jsonb, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_cierre_z(uuid, text, integer, integer, date, jsonb, jsonb, boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.confirmar_cierre_z(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirmar_cierre_z(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.descartar_cierre_z(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.descartar_cierre_z(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.cerrar_dia_electronico(uuid, integer, date, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cerrar_dia_electronico(uuid, integer, date, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.registrar_arqueo(uuid, text, numeric, jsonb, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_arqueo(uuid, text, numeric, jsonb, jsonb, text) TO authenticated;

WITH c(function_name, audience, rationale) AS (VALUES
  ('registrar_cierre_z', 'authenticated_delegate', 'Exige ser miembro con permiso de editar la caja; sólo cierres Z de su negocio.'),
  ('confirmar_cierre_z', 'authenticated_delegate', 'Confirma pasando por registrar_cierre_z, que exige miembro y permiso de caja.'),
  ('descartar_cierre_z', 'authenticated_delegate', 'Exige miembro y permiso de caja; un Z confirmado no se borra (trigger).'),
  ('cerrar_dia_electronico', 'authenticated_delegate', 'Exige miembro y permiso de caja; sólo guarda lo que coincide con lo autorizado.'),
  ('registrar_arqueo', 'authenticated_delegate', 'Exige miembro y permiso de caja; sólo arqueos de turnos abiertos de su negocio.')
)
INSERT INTO public.security_function_contracts(function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on)
SELECT p.proname, pg_get_function_identity_arguments(p.oid), c.audience, c.rationale, md5(pg_get_functiondef(p.oid)), DATE '2026-10-23'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN c ON c.function_name = p.proname
 WHERE n.nspname = 'public'
ON CONFLICT (function_name, identity_arguments) DO UPDATE
  SET audience = EXCLUDED.audience, rationale = EXCLUDED.rationale,
      definition_hash = EXCLUDED.definition_hash, reviewed_on = EXCLUDED.reviewed_on;

COMMIT;
