-- ═══════════════════════════════════════════════════════════════════════════
-- H3 — Ledger financiero por partida doble
-- ═══════════════════════════════════════════════════════════════════════════
--
-- El último de los tres huecos de `docs/ARQUITECTURA.md`. Hoy el dinero vive en
-- columnas de importe repartidas en quince tablas —`payment_transactions`,
-- `expenses`, `cash_entries`, `settlements`…— y ninguna es un libro. Medido
-- antes de escribir esto: no existe ninguna tabla de ledger.
--
-- ── Por qué un ledger y no un saldo ───────────────────────────────────────
--
-- Un saldo en una columna es un número que alguien tiene que acordarse de
-- actualizar. Cuando se desincroniza —y se desincroniza— no hay forma de saber
-- cuál de las mil operaciones lo rompió, porque el rastro es justamente lo que
-- no se guardó.
--
-- Este repo ya vivió eso con el stock: la venta descontaba dos veces, durante
-- meses, y se veía porque el Kardex y la columna no coincidían. **El Kardex
-- salvó al inventario.** `stock_movements` es un ledger, y por eso el stock se
-- puede reconstruir. La plata todavía no tiene su Kardex.
--
-- ── Por qué partida doble y no una lista de movimientos ───────────────────
--
-- Porque una lista de movimientos responde "cuánto entró" pero no "de dónde
-- salió". Con partida doble cada operación dice las dos cosas a la vez, y eso
-- habilita la única verificación que importa: **la suma de los debe tiene que
-- ser igual a la suma de los haber, siempre**. Si no cuadra, hay un error, y se
-- sabe en el momento en vez de tres meses después conciliando a mano.
--
-- Es lo que hacen Stripe, Adyen y cualquier procesador serio, y no es
-- ceremonia contable: es la propiedad que permite detectar que algo se perdió.
--
-- ── Las tres reglas que hacen que esto sirva ──────────────────────────────
--
-- 1. **Todo asiento cuadra.** Lo verifica la base al cerrar la transacción, no
--    el programador.
-- 2. **Un asiento no se modifica ni se borra.** Se corrige con un
--    contraasiento, que es otro asiento. La historia no se reescribe.
-- 3. **El saldo se deriva.** No hay columna de saldo en ningún lado: se suma.
--
-- ── Lo que este ledger NO es ──────────────────────────────────────────────
--
-- No reemplaza al contador ni pretende ser el libro rubricado. Es el registro
-- interno que permite conciliar, cerrar caja y saber cuánto se debe cobrar de
-- MercadoPago. Lo que el contador necesita se exporta desde acá; lo que
-- presenta ante ARCA lo arma él.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. El plan de cuentas ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ledger_accounts (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL,
  -- Código jerárquico: '1.1.01'. Ordena el plan y deja agrupar por rama sin
  -- una tabla de padres.
  codigo      text        NOT NULL,
  nombre      text        NOT NULL,
  -- Los cinco tipos clásicos. El tipo decide el signo natural del saldo, que
  -- es lo que evita mostrar un pasivo en negativo y confundir a todo el mundo.
  tipo        text        NOT NULL
                CHECK (tipo IN ('activo', 'pasivo', 'patrimonio', 'ingreso', 'gasto')),
  moneda      text        NOT NULL DEFAULT 'ARS',
  -- Sólo las hojas reciben partidas. Una cuenta de agrupación con movimientos
  -- propios hace que los totales por rama dejen de cerrar.
  imputable   boolean     NOT NULL DEFAULT true,
  is_active   boolean     NOT NULL DEFAULT true,
  descripcion text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ledger_accounts_codigo_unico
  ON public.ledger_accounts (org_id, codigo);
CREATE INDEX IF NOT EXISTS ledger_accounts_org_idx
  ON public.ledger_accounts (org_id, tipo, codigo);

COMMENT ON TABLE public.ledger_accounts IS
  'Plan de cuentas por organizacion. Solo las imputables reciben partidas.';

ALTER TABLE public.ledger_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ledger_accounts_org ON public.ledger_accounts;
CREATE POLICY ledger_accounts_org ON public.ledger_accounts
  FOR SELECT USING (public.is_org_member(org_id, auth.uid()));

-- ── 2. El asiento ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ledger_entries (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL,
  -- Correlativo por organización. Un asiento sin número no se puede citar.
  numero          bigint      NOT NULL,
  fecha           date        NOT NULL DEFAULT CURRENT_DATE,
  descripcion     text        NOT NULL,
  moneda          text        NOT NULL DEFAULT 'ARS',
  -- De dónde salió: una orden, un pago, un gasto. Permite ir del asiento al
  -- hecho y del hecho al asiento.
  referencia_tipo text,
  referencia_id   uuid,
  -- Un asiento anulado sigue existiendo: lo que cambia es que hay otro que lo
  -- compensa. `anula_a` apunta del contraasiento al original.
  anula_a         uuid        REFERENCES public.ledger_entries(id),
  anulado_por     uuid        REFERENCES public.ledger_entries(id),
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ledger_entries_numero_unico
  ON public.ledger_entries (org_id, numero);
CREATE INDEX IF NOT EXISTS ledger_entries_fecha_idx
  ON public.ledger_entries (org_id, fecha DESC, numero DESC);
CREATE INDEX IF NOT EXISTS ledger_entries_referencia_idx
  ON public.ledger_entries (org_id, referencia_tipo, referencia_id);

ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ledger_entries_org ON public.ledger_entries;
CREATE POLICY ledger_entries_org ON public.ledger_entries
  FOR SELECT USING (public.is_org_member(org_id, auth.uid()));

-- ── 3. Las partidas ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ledger_lines (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id    uuid        NOT NULL REFERENCES public.ledger_entries(id) ON DELETE CASCADE,
  org_id      uuid        NOT NULL,
  account_id  uuid        NOT NULL REFERENCES public.ledger_accounts(id),
  -- Una partida es debe **o** haber, nunca las dos ni ninguna. Permitir las dos
  -- deja armar una línea que se cancela sola y no significa nada.
  debe        numeric(18,2) NOT NULL DEFAULT 0 CHECK (debe  >= 0),
  haber       numeric(18,2) NOT NULL DEFAULT 0 CHECK (haber >= 0),
  descripcion text,
  metadata    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_lines_debe_o_haber
    CHECK ((debe > 0 AND haber = 0) OR (haber > 0 AND debe = 0))
);

CREATE INDEX IF NOT EXISTS ledger_lines_entry_idx   ON public.ledger_lines (entry_id);
CREATE INDEX IF NOT EXISTS ledger_lines_cuenta_idx  ON public.ledger_lines (account_id, created_at);
CREATE INDEX IF NOT EXISTS ledger_lines_org_idx     ON public.ledger_lines (org_id);

ALTER TABLE public.ledger_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ledger_lines_org ON public.ledger_lines;
CREATE POLICY ledger_lines_org ON public.ledger_lines
  FOR SELECT USING (public.is_org_member(org_id, auth.uid()));

-- ── 4. Las tres reglas, en la base ─────────────────────────────────────────

-- Regla 1: todo asiento cuadra.
--
-- Va como CONSTRAINT TRIGGER DEFERRABLE: la verificación corre **al cerrar la
-- transacción**, no en cada INSERT. Si corriera por línea, el primer INSERT de
-- cualquier asiento fallaría siempre — un asiento a medio escribir nunca cuadra.
CREATE OR REPLACE FUNCTION public.trg_ledger_asiento_cuadra()
RETURNS trigger LANGUAGE plpgsql
AS $fn$
DECLARE
  v_debe  numeric;
  v_haber numeric;
  v_n     int;
BEGIN
  SELECT COALESCE(SUM(debe), 0), COALESCE(SUM(haber), 0), count(*)
    INTO v_debe, v_haber, v_n
    FROM public.ledger_lines WHERE entry_id = COALESCE(NEW.entry_id, NEW.id);

  -- Un asiento sin partidas es un asiento que no dice nada.
  IF v_n = 0 THEN
    RAISE EXCEPTION 'El asiento % no tiene partidas', COALESCE(NEW.entry_id, NEW.id)
      USING ERRCODE = '23514';
  END IF;

  IF v_debe <> v_haber THEN
    RAISE EXCEPTION
      'El asiento no cuadra: debe % contra haber % (diferencia %)',
      v_debe, v_haber, v_debe - v_haber
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_ledger_cuadra ON public.ledger_lines;
CREATE CONSTRAINT TRIGGER trg_ledger_cuadra
  AFTER INSERT ON public.ledger_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.trg_ledger_asiento_cuadra();

-- Regla 2: no se modifica ni se borra. Se corrige con un contraasiento.
CREATE OR REPLACE FUNCTION public.trg_ledger_inmutable()
RETURNS trigger LANGUAGE plpgsql
AS $fn$
BEGIN
  -- ⚠️ El chequeo de la excepción va en un IF anidado y no en una sola
  -- condición con AND. PL/pgSQL evalúa la expresión entera, así que
  -- `OLD.anulado_por` se resolvía también cuando el trigger corría sobre
  -- `ledger_lines` —que no tiene esa columna— y el UPDATE fallaba con
  -- «record "old" has no field "anulado_por"» en vez del mensaje que explica
  -- qué hacer. Bloqueaba igual, pero por accidente y sin decir nada útil.
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'ledger_entries' THEN
    -- La única excepción: marcar el original como anulado cuando se le crea el
    -- contraasiento. Es un puntero, no un cambio de importe.
    IF OLD.anulado_por IS NULL AND NEW.anulado_por IS NOT NULL
       AND NEW.numero = OLD.numero AND NEW.fecha = OLD.fecha
       AND NEW.descripcion = OLD.descripcion THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION
    'El libro es inmutable: % sobre % no esta permitido. Para corregir, usar ledger_contraasentar().',
    TG_OP, TG_TABLE_NAME
    USING ERRCODE = '42501';
END;
$fn$;

DROP TRIGGER IF EXISTS trg_ledger_entries_inmutable ON public.ledger_entries;
CREATE TRIGGER trg_ledger_entries_inmutable
  BEFORE UPDATE OR DELETE ON public.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.trg_ledger_inmutable();

DROP TRIGGER IF EXISTS trg_ledger_lines_inmutable ON public.ledger_lines;
CREATE TRIGGER trg_ledger_lines_inmutable
  BEFORE UPDATE OR DELETE ON public.ledger_lines
  FOR EACH ROW EXECUTE FUNCTION public.trg_ledger_inmutable();

-- Regla 3 (soporte): sólo cuentas imputables, activas y de la misma
-- organización y moneda reciben partidas.
CREATE OR REPLACE FUNCTION public.trg_ledger_cuenta_valida()
RETURNS trigger LANGUAGE plpgsql
AS $fn$
DECLARE v_c public.ledger_accounts; v_e public.ledger_entries;
BEGIN
  SELECT * INTO v_c FROM public.ledger_accounts WHERE id = NEW.account_id;
  SELECT * INTO v_e FROM public.ledger_entries  WHERE id = NEW.entry_id;

  IF v_c.id IS NULL THEN
    RAISE EXCEPTION 'La cuenta no existe' USING ERRCODE = '23503';
  END IF;
  IF v_c.org_id <> NEW.org_id OR v_e.org_id <> NEW.org_id THEN
    RAISE EXCEPTION 'La cuenta y el asiento tienen que ser de la misma organizacion'
      USING ERRCODE = '23514';
  END IF;
  IF NOT v_c.imputable THEN
    RAISE EXCEPTION 'La cuenta % (%) es de agrupacion: no recibe partidas', v_c.codigo, v_c.nombre
      USING ERRCODE = '23514';
  END IF;
  IF NOT v_c.is_active THEN
    RAISE EXCEPTION 'La cuenta % esta inactiva', v_c.codigo USING ERRCODE = '23514';
  END IF;
  IF v_c.moneda <> v_e.moneda THEN
    RAISE EXCEPTION 'La cuenta % esta en % y el asiento en %', v_c.codigo, v_c.moneda, v_e.moneda
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_ledger_lines_cuenta ON public.ledger_lines;
CREATE TRIGGER trg_ledger_lines_cuenta
  BEFORE INSERT ON public.ledger_lines
  FOR EACH ROW EXECUTE FUNCTION public.trg_ledger_cuenta_valida();

-- ── 5. Asentar ─────────────────────────────────────────────────────────────
--
-- La única puerta de entrada al libro. Recibe las partidas juntas porque un
-- asiento es una unidad: no existe medio asiento.

CREATE OR REPLACE FUNCTION public.ledger_asentar(
  p_org         uuid,
  p_descripcion text,
  p_lineas      jsonb,               -- [{cuenta:'1.1.02', debe:100} , {cuenta:'4.1.01', haber:100}]
  p_fecha       date    DEFAULT CURRENT_DATE,
  p_ref_tipo    text    DEFAULT NULL,
  p_ref_id      uuid    DEFAULT NULL,
  p_moneda      text    DEFAULT 'ARS'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_numero bigint;
  v_id     uuid;
  v_l      jsonb;
  v_cta    uuid;
  v_debe   numeric;
  v_haber  numeric;
  v_sum_debe  numeric;
  v_sum_haber numeric;
BEGIN
  IF p_org IS NULL OR btrim(COALESCE(p_descripcion, '')) = '' THEN
    RAISE EXCEPTION 'ledger_asentar: falta organizacion o descripcion';
  END IF;
  IF jsonb_typeof(p_lineas) <> 'array' OR jsonb_array_length(p_lineas) < 2 THEN
    -- Menos de dos partidas no puede cuadrar contra nada.
    RAISE EXCEPTION 'ledger_asentar: un asiento necesita al menos dos partidas';
  END IF;

  -- Candado por organización para el correlativo: sin esto, dos asientos
  -- simultáneos eligen el mismo número y uno falla contra el índice único.
  PERFORM pg_advisory_xact_lock(hashtextextended('ledger:' || p_org::text, 0));

  SELECT COALESCE(MAX(numero), 0) + 1 INTO v_numero
    FROM public.ledger_entries WHERE org_id = p_org;

  INSERT INTO public.ledger_entries (
    org_id, numero, fecha, descripcion, moneda, referencia_tipo, referencia_id, created_by)
  VALUES (p_org, v_numero, p_fecha, btrim(p_descripcion), p_moneda, p_ref_tipo, p_ref_id, auth.uid())
  RETURNING id INTO v_id;

  FOR v_l IN SELECT * FROM jsonb_array_elements(p_lineas) LOOP
    -- La cuenta se pasa por código y no por id: un asiento escrito con códigos
    -- se lee, se revisa y sobrevive a que se regenere el plan.
    SELECT a.id INTO v_cta FROM public.ledger_accounts a
     WHERE a.org_id = p_org AND a.codigo = v_l->>'cuenta';

    IF v_cta IS NULL THEN
      RAISE EXCEPTION 'La cuenta % no existe en el plan de esta organizacion', v_l->>'cuenta';
    END IF;

    v_debe  := ROUND(COALESCE((v_l->>'debe')::numeric, 0), 2);
    v_haber := ROUND(COALESCE((v_l->>'haber')::numeric, 0), 2);

    -- Una partida en cero no aporta nada y ensucia el libro. Se saltea en vez
    -- de fallar: quien arma el asiento no tiene por qué filtrar los ceros.
    IF v_debe = 0 AND v_haber = 0 THEN CONTINUE; END IF;

    INSERT INTO public.ledger_lines (
      entry_id, org_id, account_id, debe, haber, descripcion, metadata)
    VALUES (
      v_id, p_org, v_cta, v_debe, v_haber,
      NULLIF(btrim(COALESCE(v_l->>'detalle', '')), ''),
      COALESCE(v_l->'metadata', '{}'::jsonb));
  END LOOP;

  -- ⚠️ Se verifica que cuadre **acá también**, no sólo en el trigger diferido.
  --
  -- El trigger corre al cerrar la transacción, y eso tiene dos problemas para
  -- quien llama: el error llega tarde —cuando ya no se sabe qué asiento lo
  -- causó— y no se puede atrapar con un EXCEPTION alrededor de esta llamada,
  -- porque todavía no ocurrió. Se descubrió verificando: el bloque de prueba
  -- que esperaba el rechazo no lo veía nunca.
  --
  -- El trigger diferido se queda igual, como red para quien inserte partidas
  -- sin pasar por esta función.
  SELECT COALESCE(SUM(debe), 0), COALESCE(SUM(haber), 0)
    INTO v_sum_debe, v_sum_haber
    FROM public.ledger_lines WHERE entry_id = v_id;

  IF v_sum_debe = 0 AND v_sum_haber = 0 THEN
    RAISE EXCEPTION 'El asiento no tiene partidas con importe' USING ERRCODE = '23514';
  END IF;

  IF v_sum_debe <> v_sum_haber THEN
    RAISE EXCEPTION
      'El asiento no cuadra: debe % contra haber % (diferencia %)',
      v_sum_debe, v_sum_haber, v_sum_debe - v_sum_haber
      USING ERRCODE = '23514';
  END IF;

  RETURN v_id;
END;
$fn$;

COMMENT ON FUNCTION public.ledger_asentar IS
  'Unica puerta de entrada al libro. Las cuentas se referencian por codigo. Que cuadre lo verifica la base al commit.';

-- ── 6. Contraasentar ───────────────────────────────────────────────────────
--
-- Corregir es agregar, nunca modificar. El contraasiento invierte cada partida
-- del original: lo que era debe pasa a haber. Los dos quedan en el libro y la
-- suma da cero, que es exactamente lo que tiene que pasar.

CREATE OR REPLACE FUNCTION public.ledger_contraasentar(
  p_entry_id uuid,
  p_motivo   text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_orig   public.ledger_entries;
  v_numero bigint;
  v_id     uuid;
BEGIN
  SELECT * INTO v_orig FROM public.ledger_entries WHERE id = p_entry_id;
  IF v_orig.id IS NULL THEN
    RAISE EXCEPTION 'El asiento no existe';
  END IF;
  IF v_orig.anulado_por IS NOT NULL THEN
    RAISE EXCEPTION 'El asiento % ya fue anulado', v_orig.numero;
  END IF;
  IF v_orig.anula_a IS NOT NULL THEN
    -- Anular un contraasiento deja el libro en un estado que nadie puede leer.
    -- Si hace falta volver atrás, se asienta de nuevo el original.
    RAISE EXCEPTION 'No se puede anular un contraasiento';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('ledger:' || v_orig.org_id::text, 0));

  SELECT COALESCE(MAX(numero), 0) + 1 INTO v_numero
    FROM public.ledger_entries WHERE org_id = v_orig.org_id;

  INSERT INTO public.ledger_entries (
    org_id, numero, fecha, descripcion, moneda,
    referencia_tipo, referencia_id, anula_a, created_by)
  VALUES (
    v_orig.org_id, v_numero, CURRENT_DATE,
    'Anulación del asiento ' || v_orig.numero ||
      COALESCE(' — ' || NULLIF(btrim(COALESCE(p_motivo, '')), ''), ''),
    v_orig.moneda, v_orig.referencia_tipo, v_orig.referencia_id, v_orig.id, auth.uid())
  RETURNING id INTO v_id;

  -- Cada partida al revés.
  INSERT INTO public.ledger_lines (entry_id, org_id, account_id, debe, haber, descripcion)
  SELECT v_id, l.org_id, l.account_id, l.haber, l.debe,
         'Anula: ' || COALESCE(l.descripcion, '')
    FROM public.ledger_lines l WHERE l.entry_id = v_orig.id;

  UPDATE public.ledger_entries SET anulado_por = v_id WHERE id = v_orig.id;

  RETURN v_id;
END;
$fn$;

-- ── 7. El saldo se deriva ──────────────────────────────────────────────────
--
-- No hay columna de saldo en ninguna parte, a propósito. El signo natural sale
-- del tipo de cuenta: un activo o un gasto crecen por el debe, y un pasivo,
-- patrimonio o ingreso crecen por el haber. Mostrar un pasivo en negativo
-- porque se restó al revés es cómo se pierde la confianza en un tablero.

CREATE OR REPLACE FUNCTION public.ledger_saldo(
  p_account_id uuid,
  p_hasta      date DEFAULT NULL
) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT COALESCE(SUM(
    CASE WHEN a.tipo IN ('activo', 'gasto') THEN l.debe - l.haber
         ELSE l.haber - l.debe END), 0)
    FROM public.ledger_lines l
    JOIN public.ledger_accounts a ON a.id = l.account_id
    JOIN public.ledger_entries  e ON e.id = l.entry_id
   WHERE l.account_id = p_account_id
     AND (p_hasta IS NULL OR e.fecha <= p_hasta);
$fn$;

CREATE OR REPLACE VIEW public.ledger_saldos AS
SELECT
  a.org_id, a.id AS account_id, a.codigo, a.nombre, a.tipo, a.moneda,
  COALESCE(SUM(l.debe), 0)  AS total_debe,
  COALESCE(SUM(l.haber), 0) AS total_haber,
  COALESCE(SUM(
    CASE WHEN a.tipo IN ('activo', 'gasto') THEN l.debe - l.haber
         ELSE l.haber - l.debe END), 0) AS saldo,
  count(l.id) AS movimientos
FROM public.ledger_accounts a
LEFT JOIN public.ledger_lines l ON l.account_id = a.id
WHERE public.is_org_member(a.org_id, auth.uid())
GROUP BY a.org_id, a.id, a.codigo, a.nombre, a.tipo, a.moneda;

COMMENT ON VIEW public.ledger_saldos IS
  'Saldo por cuenta, derivado de las partidas. No hay columna de saldo en ningun lado.';

GRANT SELECT ON public.ledger_saldos TO authenticated;

-- El balance de sumas y saldos: la verificación de que el libro entero cierra.
-- Si `descuadre` no da cero, hay un problema y se ve en una sola fila.
CREATE OR REPLACE VIEW public.ledger_balance AS
SELECT
  l.org_id,
  SUM(l.debe)             AS total_debe,
  SUM(l.haber)            AS total_haber,
  SUM(l.debe - l.haber)   AS descuadre,
  count(DISTINCT l.entry_id) AS asientos,
  max(e.fecha)            AS ultimo_asiento
FROM public.ledger_lines l
JOIN public.ledger_entries e ON e.id = l.entry_id
WHERE public.is_org_member(l.org_id, auth.uid())
GROUP BY l.org_id;

COMMENT ON VIEW public.ledger_balance IS
  'Balance de sumas y saldos. descuadre tiene que dar 0: si no, el libro tiene un problema.';

GRANT SELECT ON public.ledger_balance TO authenticated;

-- ── 8. El plan de cuentas de un comercio argentino ─────────────────────────
--
-- No es un plan contable completo: es el mínimo con el que se puede registrar
-- lo que este sistema realmente mueve —vender, cobrar por MercadoPago, pagar
-- comisiones, deber IVA— sin inventar cuentas que nadie va a usar.

CREATE OR REPLACE FUNCTION public.ledger_plan_default(p_org uuid)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_n int := 0;
BEGIN
  INSERT INTO public.ledger_accounts (org_id, codigo, nombre, tipo, imputable, descripcion)
  VALUES
    (p_org, '1',      'Activo',                     'activo',     false, NULL),
    (p_org, '1.1',    'Disponibilidades',           'activo',     false, NULL),
    (p_org, '1.1.01', 'Caja',                       'activo',     true,  'Efectivo en el mostrador'),
    (p_org, '1.1.02', 'Banco',                      'activo',     true,  'Cuenta bancaria'),
    (p_org, '1.1.03', 'MercadoPago a liquidar',     'activo',     true,  'Cobrado y todavia no acreditado'),
    (p_org, '1.1.04', 'MercadoPago disponible',     'activo',     true,  'Acreditado en la cuenta de MercadoPago'),
    (p_org, '1.2',    'Creditos',                   'activo',     false, NULL),
    (p_org, '1.2.01', 'Deudores por ventas',        'activo',     true,  'Lo que los clientes deben'),
    (p_org, '1.3',    'Bienes de cambio',           'activo',     false, NULL),
    (p_org, '1.3.01', 'Mercaderia',                 'activo',     true,  'Stock valorizado'),

    (p_org, '2',      'Pasivo',                     'pasivo',     false, NULL),
    (p_org, '2.1.01', 'Proveedores',                'pasivo',     true,  'Lo que se debe a proveedores'),
    (p_org, '2.1.02', 'IVA debito fiscal',          'pasivo',     true,  'IVA cobrado que se le debe a ARCA'),
    (p_org, '2.1.03', 'Comision de plataforma a pagar', 'pasivo',  true,  'Comision retenida por la plataforma'),

    (p_org, '3',      'Patrimonio neto',            'patrimonio', false, NULL),
    (p_org, '3.1.01', 'Resultado del ejercicio',    'patrimonio', true,  NULL),

    (p_org, '4',      'Ingresos',                   'ingreso',    false, NULL),
    (p_org, '4.1.01', 'Ventas',                     'ingreso',    true,  'Ventas netas de IVA'),
    (p_org, '4.1.02', 'Fletes cobrados',            'ingreso',    true,  'Envio facturado al comprador'),

    (p_org, '5',      'Gastos',                     'gasto',      false, NULL),
    (p_org, '5.1.01', 'Costo de mercaderia vendida','gasto',      true,  NULL),
    (p_org, '5.2.01', 'Comisiones de medios de pago','gasto',     true,  'Lo que cobra MercadoPago'),
    (p_org, '5.2.02', 'Comision de plataforma',     'gasto',      true,  'El marketplace_fee de Gestiona'),
    (p_org, '5.3.01', 'Fletes pagados',             'gasto',      true,  'Lo que se le paga al correo'),
    (p_org, '5.9.01', 'Otros gastos',               'gasto',      true,  NULL)
  ON CONFLICT (org_id, codigo) DO NOTHING;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;
