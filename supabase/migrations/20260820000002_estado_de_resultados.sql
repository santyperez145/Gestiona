-- I1 — el estado de resultados, derivado del libro.
--
-- ── Qué falta hoy ────────────────────────────────────────────────────────
--
-- `ledger_saldos` da el saldo de cada cuenta, que es un balance de sumas y
-- saldos. Es correcto y es ilegible: nadie mira su negocio cuenta por cuenta.
--
-- Lo que un comercio mira es otra cosa, y en este orden:
--
--     Ventas
--   − Costo de la mercadería vendida
--   ─────────────────────────────────
--   = MARGEN BRUTO          ← el número que decide si el negocio funciona
--   − Comisiones, fletes, otros gastos
--   ─────────────────────────────────
--   = Resultado del período
--
-- El margen bruto recién existe desde H7. Antes de descargar la mercadería
-- esta vista habría mostrado un margen igual a las ventas, que es la mentira
-- que H7 vino a arreglar.
--
-- ── Las decisiones ───────────────────────────────────────────────────────
--
-- **Se filtra por fecha del asiento, no por fecha de creación.** Un asiento
-- puede cargarse hoy con fecha de ayer —el outbox reintenta, una corrección
-- entra después— y el período al que pertenece es el de su fecha contable.
--
-- **Los asientos anulados y sus anulaciones quedan afuera.** Sumarlos daría
-- cero entre los dos, así que el resultado sería igual; pero los conteos de
-- movimientos mentirían y el detalle mostraría filas fantasma.
--
-- **El signo se normaliza acá.** En el libro un ingreso vive por el haber y un
-- gasto por el debe. Devolver eso crudo obliga a que cada pantalla se acuerde
-- de la convención, y la primera que se olvide muestra el margen al revés.
-- Acá salen todos positivos y con el significado ya resuelto.
--
-- Idempotente.

CREATE OR REPLACE FUNCTION public.ledger_resultado(
  p_org   uuid,
  p_desde date DEFAULT NULL,
  p_hasta date DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_desde     date := COALESCE(p_desde, date_trunc('month', CURRENT_DATE)::date);
  v_hasta     date := COALESCE(p_hasta, CURRENT_DATE);
  v_ventas    numeric := 0;
  v_fletes    numeric := 0;
  v_costo     numeric := 0;
  v_com_mp    numeric := 0;
  v_com_plat  numeric := 0;
  v_flete_pag numeric := 0;
  v_otros     numeric := 0;
  v_asientos  int := 0;
  v_sin_costo int := 0;
BEGIN
  -- La organización se verifica siempre: esta función devuelve el resultado
  -- economico completo de un comercio, que es de lo mas sensible que hay.
  IF NOT public.is_org_member(p_org, auth.uid()) THEN
    RAISE EXCEPTION 'No tenés permiso para ver el resultado de esta organización';
  END IF;

  SELECT
    -- Ingresos: viven por el haber, se devuelven positivos.
    COALESCE(SUM(l.haber - l.debe) FILTER (WHERE a.codigo = '4.1.01'), 0),
    COALESCE(SUM(l.haber - l.debe) FILTER (WHERE a.codigo = '4.1.02'), 0),
    -- Gastos: viven por el debe, se devuelven positivos.
    COALESCE(SUM(l.debe - l.haber) FILTER (WHERE a.codigo = '5.1.01'), 0),
    COALESCE(SUM(l.debe - l.haber) FILTER (WHERE a.codigo = '5.2.01'), 0),
    COALESCE(SUM(l.debe - l.haber) FILTER (WHERE a.codigo = '5.2.02'), 0),
    COALESCE(SUM(l.debe - l.haber) FILTER (WHERE a.codigo = '5.3.01'), 0),
    COALESCE(SUM(l.debe - l.haber) FILTER (WHERE a.codigo = '5.9.01'), 0),
    COUNT(DISTINCT e.id)
  INTO v_ventas, v_fletes, v_costo, v_com_mp, v_com_plat, v_flete_pag, v_otros, v_asientos
  FROM public.ledger_lines l
  JOIN public.ledger_entries e ON e.id = l.entry_id
  JOIN public.ledger_accounts a ON a.id = l.account_id
  WHERE l.org_id = p_org
    AND e.fecha BETWEEN v_desde AND v_hasta
    -- Un asiento anulado y su anulación se cancelan entre sí en los importes,
    -- pero contarlos inflaría `asientos` y ensuciaría el detalle.
    AND e.anulado_por IS NULL AND e.anula_a IS NULL;

  -- ⚠️ Cuántas ventas se asentaron sin costo. Es la advertencia que hace que
  -- el margen bruto sea creíble: si este número no es cero, el margen que se
  -- muestra está mejor de lo que la realidad es, y hay que decirlo en la
  -- pantalla, no esconderlo en un log.
  SELECT COUNT(DISTINCT e.id) INTO v_sin_costo
    FROM public.ledger_entries e
   WHERE e.org_id = p_org
     AND e.fecha BETWEEN v_desde AND v_hasta
     AND e.anulado_por IS NULL AND e.anula_a IS NULL
     AND e.referencia_tipo = 'orden'
     AND NOT EXISTS (
       SELECT 1 FROM public.ledger_lines l2
         JOIN public.ledger_accounts a2 ON a2.id = l2.account_id
        WHERE l2.entry_id = e.id AND a2.codigo = '5.1.01' AND l2.debe > 0);

  RETURN jsonb_build_object(
    'desde', v_desde,
    'hasta', v_hasta,
    'ventas', v_ventas,
    'fletes_cobrados', v_fletes,
    'ingresos', v_ventas + v_fletes,
    'costo_mercaderia', v_costo,
    'margen_bruto', v_ventas - v_costo,
    'comision_medios_pago', v_com_mp,
    'comision_plataforma', v_com_plat,
    'fletes_pagados', v_flete_pag,
    'otros_gastos', v_otros,
    'gastos_operativos', v_com_mp + v_com_plat + v_flete_pag + v_otros,
    'resultado', (v_ventas + v_fletes) - v_costo - v_com_mp - v_com_plat - v_flete_pag - v_otros,
    'asientos', v_asientos,
    'ventas_sin_costo', v_sin_costo);
END;
$$;

COMMENT ON FUNCTION public.ledger_resultado IS
  'Estado de resultados derivado del libro, con margen bruto. Normaliza el signo (ingresos y gastos salen positivos) y excluye asientos anulados. Informa ventas_sin_costo: si no es cero, el margen esta mejor que la realidad.';

REVOKE ALL ON FUNCTION public.ledger_resultado(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ledger_resultado(uuid, date, date) TO authenticated;

-- ── La serie para el gráfico ─────────────────────────────────────────────
--
-- Se devuelve agregada por día desde la base y no se mandan los asientos al
-- navegador para que los sume: un comercio con movimiento tiene miles, y el
-- principio de que la analítica no bloquee ni infle la transacción vale también
-- para el ancho de banda.
CREATE OR REPLACE FUNCTION public.ledger_resultado_diario(
  p_org   uuid,
  p_desde date DEFAULT NULL,
  p_hasta date DEFAULT NULL
) RETURNS TABLE (fecha date, ventas numeric, costo numeric, margen numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_org_member(p_org, auth.uid()) THEN
    RAISE EXCEPTION 'No tenés permiso para ver el resultado de esta organización';
  END IF;

  RETURN QUERY
  SELECT e.fecha,
         COALESCE(SUM(l.haber - l.debe) FILTER (WHERE a.codigo = '4.1.01'), 0)::numeric,
         COALESCE(SUM(l.debe - l.haber) FILTER (WHERE a.codigo = '5.1.01'), 0)::numeric,
         (COALESCE(SUM(l.haber - l.debe) FILTER (WHERE a.codigo = '4.1.01'), 0)
        - COALESCE(SUM(l.debe - l.haber) FILTER (WHERE a.codigo = '5.1.01'), 0))::numeric
    FROM public.ledger_lines l
    JOIN public.ledger_entries e ON e.id = l.entry_id
    JOIN public.ledger_accounts a ON a.id = l.account_id
   WHERE l.org_id = p_org
     AND e.fecha BETWEEN COALESCE(p_desde, date_trunc('month', CURRENT_DATE)::date)
                     AND COALESCE(p_hasta, CURRENT_DATE)
     AND e.anulado_por IS NULL AND e.anula_a IS NULL
     AND a.codigo IN ('4.1.01', '5.1.01')
   GROUP BY e.fecha
   ORDER BY e.fecha;
END;
$$;

COMMENT ON FUNCTION public.ledger_resultado_diario IS
  'Serie diaria de ventas, costo y margen para el grafico. Agrega en la base: mandar los asientos al navegador para que los sume no escala.';

REVOKE ALL ON FUNCTION public.ledger_resultado_diario(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ledger_resultado_diario(uuid, date, date) TO authenticated;
