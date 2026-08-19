-- ═══════════════════════════════════════════════════════════════════════════
-- La billetera del comercio
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── La decisión que define todo lo demás ──────────────────────────────────
--
-- **La billetera no tiene saldo propio.** Es una lectura del ledger.
--
-- Lo tentador es una tabla `wallets` con una columna `saldo` y sumarle o
-- restarle en cada operación. Eso es exactamente el error que H3 vino a
-- resolver, y el mismo que costó meses con el stock: un número que alguien
-- tiene que acordarse de actualizar, que cuando se desincroniza no dice cuál de
-- las mil operaciones lo rompió.
--
-- Acá el saldo **se deriva** de las cuentas del plan:
--
--     1.1.03  MercadoPago a liquidar   → saldo PENDIENTE
--     1.1.04  MercadoPago disponible   → saldo DISPONIBLE
--     1.1.02  Banco                    → adonde va lo que se retira
--
-- Una venta cobrada ya asienta en 1.1.03 (H3). Cuando el procesador libera la
-- plata, un asiento la mueve a 1.1.04. Un retiro la mueve a Banco. Cada
-- movimiento de la billetera es un asiento, y por eso la billetera **no puede**
-- descuadrar contra la contabilidad: son el mismo dato.
--
-- ── Por qué pendiente y disponible son cosas distintas ────────────────────
--
-- MercadoPago acredita a los 7, 14 o 30 días según la configuración del
-- vendedor. Mostrar un solo número junta plata que se puede usar hoy con plata
-- que todavía no está, y eso hace que un comercio gaste lo que no tiene. Es la
-- distinción que hacen Mercado Pago, Stripe y Shopify, y no es cosmética.
--
-- ── Lo que esta billetera NO es ───────────────────────────────────────────
--
-- ⚠️ No custodia dinero de terceros. La plata está en la cuenta de MercadoPago
-- del comercio; acá se refleja cuánto es y de dónde viene. Custodiar fondos
-- exige inscripción en el registro de PSP del BCRA, capital y auditoría —
-- `docs/ARQUITECTURA.md` lo llama "otra empresa adentro de la empresa" y dice
-- que el peldaño 4 no se empieza en el código.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Adónde se retira ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.wallet_bank_accounts (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL,
  alias       text        NOT NULL,
  titular     text        NOT NULL,
  -- CUIT del titular: un CBU a nombre de otro es la vía más común de fraude en
  -- un retiro, y el banco lo rechaza igual.
  cuit        text,
  -- CBU (22 dígitos) o CVU (22 dígitos, billeteras virtuales).
  cbu         text        NOT NULL,
  banco       text,
  is_default  boolean     NOT NULL DEFAULT false,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wallet_bank_cbu_formato CHECK (cbu ~ '^[0-9]{22}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS wallet_bank_una_default
  ON public.wallet_bank_accounts (org_id) WHERE is_default AND is_active;
CREATE INDEX IF NOT EXISTS wallet_bank_org_idx
  ON public.wallet_bank_accounts (org_id) WHERE is_active;

COMMENT ON TABLE public.wallet_bank_accounts IS
  'Cuentas bancarias a las que el comercio retira. El CBU no es una credencial pero identifica a una persona: RLS por organizacion.';

ALTER TABLE public.wallet_bank_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wallet_bank_org ON public.wallet_bank_accounts;
CREATE POLICY wallet_bank_org ON public.wallet_bank_accounts
  FOR ALL USING (public.is_org_member(org_id, auth.uid()))
  WITH CHECK (public.is_org_member(org_id, auth.uid()));

-- ── 2. Los retiros ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.wallet_withdrawals (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid          NOT NULL,
  bank_account_id uuid          REFERENCES public.wallet_bank_accounts(id),
  monto           numeric(18,2) NOT NULL CHECK (monto > 0),
  moneda          text          NOT NULL DEFAULT 'ARS',
  estado          text          NOT NULL DEFAULT 'solicitado'
                    CHECK (estado IN ('solicitado', 'en_proceso', 'pagado', 'rechazado')),
  -- El asiento que sacó la plata de la billetera. Si el retiro se rechaza, se
  -- contraasienta y la plata vuelve — no se "borra" el movimiento.
  entry_id        uuid          REFERENCES public.ledger_entries(id),
  reversa_id      uuid          REFERENCES public.ledger_entries(id),
  referencia      text,
  motivo_rechazo  text,
  solicitado_por  uuid,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now(),
  pagado_at       timestamptz
);

CREATE INDEX IF NOT EXISTS wallet_withdrawals_org_idx
  ON public.wallet_withdrawals (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS wallet_withdrawals_estado_idx
  ON public.wallet_withdrawals (estado) WHERE estado IN ('solicitado', 'en_proceso');

ALTER TABLE public.wallet_withdrawals ENABLE ROW LEVEL SECURITY;

-- El comercio ve sus retiros. Crearlos es potestad del RPC, que valida el
-- saldo: un INSERT directo podría pedir más de lo que hay.
DROP POLICY IF EXISTS wallet_withdrawals_lectura ON public.wallet_withdrawals;
CREATE POLICY wallet_withdrawals_lectura ON public.wallet_withdrawals
  FOR SELECT USING (public.is_org_member(org_id, auth.uid()));

-- ── 3. El saldo, derivado ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.wallet_saldo(p_org uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_pendiente  numeric := 0;
  v_disponible numeric := 0;
  v_retirado   numeric := 0;
BEGIN
  -- Se suma sobre las partidas, no sobre una columna. Es la propiedad que hace
  -- que este número no pueda mentir: si no coincide con el libro, es que no hay
  -- dos números.
  SELECT
    COALESCE(SUM(CASE WHEN a.codigo = '1.1.03' THEN l.debe - l.haber ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN a.codigo = '1.1.04' THEN l.debe - l.haber ELSE 0 END), 0)
  INTO v_pendiente, v_disponible
  FROM public.ledger_lines l
  JOIN public.ledger_accounts a ON a.id = l.account_id
  WHERE l.org_id = p_org AND a.codigo IN ('1.1.03', '1.1.04');

  SELECT COALESCE(SUM(monto), 0) INTO v_retirado
    FROM public.wallet_withdrawals
   WHERE org_id = p_org AND estado IN ('solicitado', 'en_proceso');

  RETURN jsonb_build_object(
    'pendiente',  ROUND(GREATEST(v_pendiente, 0), 2),
    'disponible', ROUND(v_disponible, 2),
    -- Lo que ya se pidió retirar y todavía no salió sigue descontado del
    -- disponible: si no, se podría pedir dos veces la misma plata.
    'en_retiro',  ROUND(v_retirado, 2),
    'retirable',  ROUND(GREATEST(v_disponible - v_retirado, 0), 2),
    'total',      ROUND(GREATEST(v_pendiente, 0) + v_disponible, 2),
    'moneda',     'ARS');
END;
$fn$;

COMMENT ON FUNCTION public.wallet_saldo IS
  'Saldo de la billetera derivado del ledger. No hay columna de saldo: si difiere del libro es porque no hay dos numeros.';

-- ── 4. Liberar lo pendiente ────────────────────────────────────────────────
--
-- Cuando el procesador acredita, la plata deja de estar "a liquidar". Es un
-- asiento entre dos cuentas del activo: no cambia el patrimonio, cambia dónde
-- está la plata.

CREATE OR REPLACE FUNCTION public.wallet_liberar(
  p_org   uuid,
  p_monto numeric,
  p_detalle text DEFAULT NULL,
  p_ref_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_monto numeric;
BEGIN
  v_monto := ROUND(COALESCE(p_monto, 0), 2);
  IF v_monto <= 0 THEN
    RAISE EXCEPTION 'No hay monto que liberar';
  END IF;

  PERFORM public.ledger_plan_default(p_org);

  RETURN public.ledger_asentar(
    p_org, COALESCE(NULLIF(btrim(p_detalle), ''), 'Acreditación de MercadoPago'),
    jsonb_build_array(
      jsonb_build_object('cuenta', '1.1.04', 'debe',  v_monto, 'detalle', 'Acreditado'),
      jsonb_build_object('cuenta', '1.1.03', 'haber', v_monto, 'detalle', 'Deja de estar a liquidar')),
    CURRENT_DATE, 'liberacion', p_ref_id);
END;
$fn$;

-- ── 5. Pedir un retiro ─────────────────────────────────────────────────────
--
-- ⚠️ Acá está la única regla que realmente importa de una billetera: **no se
-- puede sacar más de lo que hay**. Y no alcanza con leer el saldo y después
-- descontar: entre esas dos cosas puede entrar otro pedido y los dos ven el
-- mismo disponible. Por eso va un candado por organización, y el saldo se
-- recalcula **adentro** del candado.

CREATE OR REPLACE FUNCTION public.wallet_solicitar_retiro(
  p_org      uuid,
  p_monto    numeric,
  p_cuenta   uuid DEFAULT NULL,
  p_clave    text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_monto   numeric;
  v_saldo   jsonb;
  v_cuenta  public.wallet_bank_accounts;
  v_entry   uuid;
  v_id      uuid;
  v_reserva jsonb;
BEGIN
  IF NOT public.is_org_member(p_org, auth.uid()) THEN
    RAISE EXCEPTION 'Sin permiso sobre esa organización';
  END IF;

  v_monto := ROUND(COALESCE(p_monto, 0), 2);
  IF v_monto <= 0 THEN
    RAISE EXCEPTION 'El monto a retirar tiene que ser mayor a cero';
  END IF;

  -- Un retiro es una mutación crítica: si el navegador reintenta, no puede
  -- salir dos veces. H1 ya resuelve esto y se reusa en vez de inventar otra
  -- forma.
  v_reserva := public.idempotencia_reservar(
    p_org, 'wallet_retiro', p_clave,
    jsonb_build_object('monto', v_monto, 'cuenta', p_cuenta));

  IF NOT (v_reserva->>'ejecutar')::boolean THEN
    RETURN (v_reserva->'respuesta') || jsonb_build_object('reintento', true);
  END IF;

  -- ⚠️ El candado va ANTES de leer el saldo. Leer y después bloquear deja
  -- pasar a dos pedidos que vieron el mismo disponible.
  PERFORM pg_advisory_xact_lock(hashtextextended('wallet:' || p_org::text, 0));

  v_saldo := public.wallet_saldo(p_org);

  IF v_monto > (v_saldo->>'retirable')::numeric THEN
    PERFORM public.idempotencia_fallar(p_org, 'wallet_retiro', p_clave, 'saldo insuficiente');
    RAISE EXCEPTION
      'No alcanza el saldo disponible: querés retirar $% y podés retirar $%',
      v_monto, v_saldo->>'retirable';
  END IF;

  -- La cuenta destino: la indicada, o la predeterminada.
  IF p_cuenta IS NOT NULL THEN
    SELECT * INTO v_cuenta FROM public.wallet_bank_accounts
     WHERE id = p_cuenta AND org_id = p_org AND is_active;
  ELSE
    SELECT * INTO v_cuenta FROM public.wallet_bank_accounts
     WHERE org_id = p_org AND is_default AND is_active LIMIT 1;
  END IF;

  IF v_cuenta.id IS NULL THEN
    PERFORM public.idempotencia_fallar(p_org, 'wallet_retiro', p_clave, 'sin cuenta destino');
    RAISE EXCEPTION 'Cargá una cuenta bancaria antes de retirar';
  END IF;

  -- ⚠️ El id del retiro se genera ACÁ, antes del asiento.
  --
  -- La primera versión asentaba, insertaba el retiro y después actualizaba el
  -- asiento para apuntarle. La regla de inmutabilidad del libro lo rechazó —y
  -- tenía razón—: un asiento no se toca después de escrito. Que la propia regla
  -- haya frenado mi código es la señal de que sirve.
  v_id := gen_random_uuid();

  -- El asiento sale primero: si falla, no queda un retiro sin respaldo contable.
  v_entry := public.ledger_asentar(
    p_org, 'Retiro a ' || v_cuenta.alias,
    jsonb_build_array(
      jsonb_build_object('cuenta', '1.1.02', 'debe',  v_monto, 'detalle', 'Ingreso a la cuenta bancaria'),
      jsonb_build_object('cuenta', '1.1.04', 'haber', v_monto, 'detalle', 'Sale de la billetera')),
    CURRENT_DATE, 'retiro', v_id);

  INSERT INTO public.wallet_withdrawals (
    id, org_id, bank_account_id, monto, estado, entry_id, solicitado_por)
  VALUES (v_id, p_org, v_cuenta.id, v_monto, 'solicitado', v_entry, auth.uid());

  PERFORM public.emitir_evento(p_org, 'billetera', v_id, 'retiro.solicitado',
    jsonb_build_object('withdrawal_id', v_id, 'monto', v_monto, 'cuenta', v_cuenta.alias));

  PERFORM public.idempotencia_completar(p_org, 'wallet_retiro', p_clave,
    jsonb_build_object('withdrawal_id', v_id, 'monto', v_monto));

  RETURN jsonb_build_object(
    'withdrawal_id', v_id, 'monto', v_monto, 'estado', 'solicitado',
    'cuenta', v_cuenta.alias, 'entry_id', v_entry);
END;
$fn$;

-- ── 6. Rechazar un retiro devuelve la plata ────────────────────────────────
--
-- Con un contraasiento, no borrando el movimiento. Los dos quedan en el libro:
-- que un retiro se haya intentado y rebotado es información, no ruido.

CREATE OR REPLACE FUNCTION public.wallet_rechazar_retiro(
  p_id     uuid,
  p_motivo text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_w public.wallet_withdrawals; v_rev uuid;
BEGIN
  SELECT * INTO v_w FROM public.wallet_withdrawals WHERE id = p_id;
  IF v_w.id IS NULL THEN RAISE EXCEPTION 'El retiro no existe'; END IF;

  IF NOT public.is_platform_admin(auth.uid()) AND NOT public.is_org_member(v_w.org_id, auth.uid()) THEN
    RAISE EXCEPTION 'Sin permiso sobre ese retiro';
  END IF;

  IF v_w.estado = 'pagado' THEN
    RAISE EXCEPTION 'Un retiro ya pagado no se rechaza: se registra una devolución';
  END IF;
  IF v_w.estado = 'rechazado' THEN
    RETURN v_w.reversa_id;
  END IF;

  v_rev := public.ledger_contraasentar(v_w.entry_id, COALESCE(p_motivo, 'retiro rechazado'));

  UPDATE public.wallet_withdrawals
     SET estado = 'rechazado', motivo_rechazo = p_motivo,
         reversa_id = v_rev, updated_at = now()
   WHERE id = p_id;

  PERFORM public.emitir_evento(v_w.org_id, 'billetera', p_id, 'retiro.rechazado',
    jsonb_build_object('withdrawal_id', p_id, 'monto', v_w.monto, 'motivo', p_motivo));

  RETURN v_rev;
END;
$fn$;

-- ── 7. Los movimientos ─────────────────────────────────────────────────────
--
-- Cada fila es una partida del libro sobre una cuenta de la billetera. No hay
-- una tabla de movimientos aparte, a propósito: sería la segunda versión de la
-- verdad y podría desincronizarse del ledger.

CREATE OR REPLACE VIEW public.wallet_movimientos AS
SELECT
  l.id,
  l.org_id,
  e.fecha,
  e.numero               AS asiento,
  e.descripcion,
  e.referencia_tipo,
  e.referencia_id,
  a.codigo               AS cuenta,
  CASE a.codigo WHEN '1.1.03' THEN 'pendiente' ELSE 'disponible' END AS bolsillo,
  -- Entra o sale, desde el punto de vista del comercio.
  CASE WHEN l.debe > 0 THEN 'entrada' ELSE 'salida' END AS direccion,
  GREATEST(l.debe, l.haber) AS monto,
  l.debe - l.haber       AS delta,
  l.descripcion          AS detalle,
  e.created_at
FROM public.ledger_lines l
JOIN public.ledger_accounts a ON a.id = l.account_id
JOIN public.ledger_entries  e ON e.id = l.entry_id
WHERE a.codigo IN ('1.1.03', '1.1.04')
  AND public.is_org_member(l.org_id, auth.uid());

COMMENT ON VIEW public.wallet_movimientos IS
  'Movimientos de la billetera. Son las partidas del libro sobre las cuentas de billetera: no hay una segunda tabla que pueda desincronizarse.';

GRANT SELECT ON public.wallet_movimientos TO authenticated;

-- ── 8. Auditoría: la billetera nunca puede descuadrar ──────────────────────
--
-- Por construcción no puede, porque es la misma tabla. Esta vista existe para
-- poder **demostrarlo** en cualquier momento en vez de confiar en el argumento.

CREATE OR REPLACE VIEW public.wallet_auditoria AS
SELECT
  w.org_id,
  (public.wallet_saldo(w.org_id)->>'disponible')::numeric AS saldo_disponible,
  COALESCE(SUM(CASE WHEN a.codigo = '1.1.04' THEN l.debe - l.haber ELSE 0 END), 0) AS segun_el_libro,
  (public.wallet_saldo(w.org_id)->>'disponible')::numeric
    - COALESCE(SUM(CASE WHEN a.codigo = '1.1.04' THEN l.debe - l.haber ELSE 0 END), 0) AS diferencia
FROM (SELECT DISTINCT org_id FROM public.ledger_lines) w
LEFT JOIN public.ledger_lines l   ON l.org_id = w.org_id
LEFT JOIN public.ledger_accounts a ON a.id = l.account_id
WHERE public.is_org_member(w.org_id, auth.uid())
GROUP BY w.org_id;

GRANT SELECT ON public.wallet_auditoria TO authenticated;
