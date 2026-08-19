-- ═══════════════════════════════════════════════════════════════════════════
-- El comercio elige su medio de pago, sin pegar credenciales
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Como lo hace Tiendanube: una lista de medios, un botón "Conectar", y el
-- comercio autoriza en el sitio del proveedor. Nunca copia y pega una clave.
--
-- Ya es la doctrina de este repo —`docs/CONFIGURACION.md`, el test
-- `noPastedCredentials`— y ahora se vuelve estructura: el catálogo dice **cómo**
-- se conecta cada proveedor, y el que se conecta por OAuth no tiene dónde pegar
-- nada.
--
-- ── ⚠️ Lo que está integrado y lo que no ──────────────────────────────────
--
-- Esta es la parte que hay que decir sin adornos. El catálogo lista los medios
-- que se usan en Argentina, pero **listar no es integrar**:
--
--   mercadopago    ✅ integrado y cobrando de verdad (dos compras acreditadas)
--   transferencia  ✅ integrado (sin API: el comercio confirma a mano)
--   efectivo       ✅ integrado (sin API)
--   gestionapay    🟡 orquestación sobre MercadoPago — ver abajo
--   modo           🔴 declarado, NO integrado
--   naranjax       🔴 declarado, NO integrado
--   gocuotas       🔴 declarado, NO integrado
--
-- `integracion` guarda ese estado y la UI **tiene que mostrarlo**. Ofrecer un
-- botón "Conectar" que no conecta nada es peor que no ofrecerlo: el comercio
-- cree que puede cobrar por ahí y descubre que no el día de la primera venta.
--
-- ── ⚠️ Qué es GestionaPay y qué no ────────────────────────────────────────
--
-- Es la **marca del orquestador**, no un procesador. El comercio conecta una
-- vez y por abajo se rutea al adquirente que corresponda; hoy ese adquirente es
-- MercadoPago vía la relación de marketplace que ya existe y ya cobra
-- `marketplace_fee`.
--
-- **No custodia fondos ni es un PSP regulado.** `docs/ARQUITECTURA.md` §6 lo
-- dice: el peldaño 4 —cuentas de pago propias— exige inscripción en el registro
-- del BCRA, capital, compliance y auditoría. Es otra empresa adentro de la
-- empresa y no se empieza en el código. Llamarlo "nuestro medio de pago" sin
-- esa estructura sería una afirmación que no se puede sostener frente a un
-- inversor que pregunte, y esa pregunta se hace siempre.
--
-- Lo que sí es GestionaPay hoy: **un solo lugar donde conectar, ruteo por costo
-- real, failover entre adquirentes y conciliación contra el libro**. Eso ya es
-- más de lo que ofrecen Tiendanube y Empretienda, y es verdad.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. Los índices que faltaban, y son míos ────────────────────────────────
--
-- Medido: de 288 tablas con `org_id`, sólo 5 no tenían un índice que empiece
-- por esa columna — **y 4 las introduje yo** en las migraciones de los motores.
-- Toda política RLS filtra por `org_id`, así que sin ese índice cada consulta
-- es un escaneo secuencial. Con un comercio no se nota; con quinientos es la
-- pared.

CREATE INDEX IF NOT EXISTS payment_routing_org_idx      ON public.payment_routing (org_id, metodo);
CREATE INDEX IF NOT EXISTS event_subscriptions_org_idx  ON public.event_subscriptions (org_id);
CREATE INDEX IF NOT EXISTS outbox_events_org_idx        ON public.outbox_events (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_attempts_org_idx     ON public.payment_attempts (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS stock_count_items_org_idx    ON public.stock_count_items (org_id);

-- ── 1. El catálogo, con la verdad adentro ──────────────────────────────────

ALTER TABLE public.payment_providers
  ADD COLUMN IF NOT EXISTS nombre_publico text,
  -- Cómo se conecta. `oauth` = el comercio autoriza en el sitio del proveedor y
  -- nunca ve una clave. `ninguna` = no hace falta conectar nada (efectivo).
  ADD COLUMN IF NOT EXISTS conexion text NOT NULL DEFAULT 'oauth',
  -- ⚠️ El estado real de la integración. Sin esto se ofrecen botones que no
  -- hacen nada.
  ADD COLUMN IF NOT EXISTS integracion text NOT NULL DEFAULT 'declarado',
  ADD COLUMN IF NOT EXISTS descripcion text,
  ADD COLUMN IF NOT EXISTS pais text NOT NULL DEFAULT 'AR',
  ADD COLUMN IF NOT EXISTS orden int NOT NULL DEFAULT 100;

ALTER TABLE public.payment_providers DROP CONSTRAINT IF EXISTS payment_providers_conexion_valida;
ALTER TABLE public.payment_providers ADD CONSTRAINT payment_providers_conexion_valida
  CHECK (conexion IN ('oauth', 'ninguna', 'plataforma'));

ALTER TABLE public.payment_providers DROP CONSTRAINT IF EXISTS payment_providers_integracion_valida;
ALTER TABLE public.payment_providers ADD CONSTRAINT payment_providers_integracion_valida
  CHECK (integracion IN ('produccion', 'beta', 'declarado'));

COMMENT ON COLUMN public.payment_providers.integracion IS
  'produccion = cobra de verdad. beta = anda pero sin volumen. declarado = esta en el catalogo y NO esta integrado.';

INSERT INTO public.payment_providers
  (codigo, nombre, nombre_publico, metodos, soporta_split, soporta_cuotas,
   conexion, integracion, descripcion, orden)
VALUES
  ('gestionapay', 'GestionaPay', 'GestionaPay',
   ARRAY['tarjeta','mercadopago','qr'], true, true,
   'plataforma', 'beta',
   'Cobrás con la cuenta de la plataforma. Un solo lugar para conectar, y el sistema elige el adquirente más barato.', 5),

  ('mercadopago', 'MercadoPago', 'Mercado Pago',
   ARRAY['tarjeta','mercadopago','qr'], true, true,
   'oauth', 'produccion',
   'Tarjetas, dinero en cuenta y QR. Se conecta con tu cuenta de Mercado Pago.', 10),

  ('modo', 'MODO', 'MODO',
   ARRAY['tarjeta','qr'], false, true,
   'oauth', 'declarado',
   'Pagos con la app de los bancos. Todavía no está integrado.', 20),

  ('naranjax', 'Naranja X', 'Naranja X',
   ARRAY['tarjeta'], false, true,
   'oauth', 'declarado',
   'Tarjeta Naranja y cuotas. Todavía no está integrado.', 30),

  ('gocuotas', 'Go Cuotas', 'Go Cuotas',
   ARRAY['tarjeta'], false, true,
   'oauth', 'declarado',
   'Cuotas sin interés con tarjeta de débito. Todavía no está integrado.', 40),

  ('transferencia', 'Transferencia bancaria', 'Transferencia',
   ARRAY['transferencia'], false, false,
   'ninguna', 'produccion',
   'El comprador transfiere y vos confirmás el pago.', 50),

  ('efectivo', 'Efectivo', 'Efectivo',
   ARRAY['efectivo'], false, false,
   'ninguna', 'produccion',
   'Se paga al retirar o al recibir.', 60)
ON CONFLICT (codigo) DO UPDATE SET
  nombre_publico = EXCLUDED.nombre_publico,
  metodos        = EXCLUDED.metodos,
  soporta_split  = EXCLUDED.soporta_split,
  soporta_cuotas = EXCLUDED.soporta_cuotas,
  conexion       = EXCLUDED.conexion,
  integracion    = EXCLUDED.integracion,
  descripcion    = EXCLUDED.descripcion,
  orden          = EXCLUDED.orden;

-- ── 2. Qué conectó cada comercio ───────────────────────────────────────────
--
-- ⚠️ Acá NO va ninguna credencial. El token de OAuth vive en
-- `payment_connections`, que tiene RLS habilitada y **cero policies**: sólo la
-- tocan Edge Functions con `service_role`. Esta tabla dice que la conexión
-- existe y con qué cuenta, que es lo que la UI necesita mostrar.

CREATE TABLE IF NOT EXISTS public.org_payment_providers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL,
  provider    text NOT NULL REFERENCES public.payment_providers(codigo),
  -- El comercio lo activó en su tienda. Distinto de "está conectado": se puede
  -- tener la conexión y no ofrecerlo mientras se prueba.
  habilitado  boolean NOT NULL DEFAULT false,
  -- Nombre de la cuenta del proveedor, para que el comercio confirme que
  -- conectó la que quería. Nunca el token.
  cuenta      text,
  conectado_at timestamptz,
  -- Preferencias por comercio: cuotas máximas que quiere ofrecer, etc.
  config      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS org_payment_providers_unico
  ON public.org_payment_providers (org_id, provider);
CREATE INDEX IF NOT EXISTS org_payment_providers_org_idx
  ON public.org_payment_providers (org_id) WHERE habilitado;

ALTER TABLE public.org_payment_providers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_payment_providers_org ON public.org_payment_providers;
CREATE POLICY org_payment_providers_org ON public.org_payment_providers
  FOR ALL USING (public.is_org_member(org_id, auth.uid()))
  WITH CHECK (public.is_org_member(org_id, auth.uid()));

-- ── 3. El ruteo exige que esté conectado ───────────────────────────────────
--
-- ⚠️ Sin esto, el orquestador podía elegir un proveedor que el comercio nunca
-- conectó, y el cobro fallaba recién al llamar a la API — con el comprador
-- esperando. La regla es la misma que ya rige para el stock: se valida antes,
-- no después.

CREATE OR REPLACE FUNCTION public.pago_proveedores_para(
  p_org      uuid,
  p_metodo   text,
  p_monto    numeric,
  p_cuotas   int DEFAULT 1,
  p_moneda   text DEFAULT 'ARS'
) RETURNS TABLE (
  provider    text,
  prioridad   int,
  costo       numeric,
  costo_pct   numeric,
  dias_acredita int
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  WITH reglas AS (
    SELECT DISTINCT ON (r.metodo, r.provider) r.provider, r.prioridad
      FROM public.payment_routing r
     WHERE r.is_active AND r.metodo = p_metodo
       AND (r.org_id IS NULL OR r.org_id = p_org)
       AND (r.monto_min IS NULL OR p_monto >= r.monto_min)
       AND (r.monto_max IS NULL OR p_monto <= r.monto_max)
     ORDER BY r.metodo, r.provider, (r.org_id IS NOT NULL) DESC
  ),
  capaces AS (
    SELECT g.provider, g.prioridad
      FROM reglas g
      JOIN public.payment_providers pp ON pp.codigo = g.provider
     WHERE pp.is_active
       AND p_metodo = ANY(pp.metodos)
       AND p_moneda = ANY(pp.monedas)
       AND (COALESCE(p_cuotas, 1) = 1 OR pp.soporta_cuotas)
       -- ⚠️ Un proveedor declarado pero no integrado NO cobra. Está en el
       -- catálogo para que el comercio lo vea venir, no para rutearle plata.
       AND pp.integracion <> 'declarado'
       -- Y tiene que estar conectado y habilitado por este comercio, salvo los
       -- que no necesitan conexión (efectivo, transferencia).
       AND (pp.conexion = 'ninguna'
            OR EXISTS (SELECT 1 FROM public.org_payment_providers o
                        WHERE o.org_id = p_org AND o.provider = pp.codigo
                          AND o.habilitado))
  ),
  tarifa AS (
    SELECT c.provider, c.prioridad, f.percent_fee, f.fixed_fee,
           f.iva_on_fee_pct, f.release_days
      FROM capaces c
      LEFT JOIN LATERAL (
        SELECT * FROM public.payment_provider_fees x
         WHERE x.provider = c.provider
           AND x.method   = public.pago_metodo_de_tarifa(p_metodo, p_cuotas)
           AND x.currency = p_moneda
           AND COALESCE(x.installments, 0) IN (COALESCE(p_cuotas, 1), 0)
           AND (x.effective_from IS NULL OR x.effective_from <= CURRENT_DATE)
         ORDER BY (COALESCE(x.installments, 0) = COALESCE(p_cuotas, 1)) DESC,
                  x.effective_from DESC NULLS LAST
         LIMIT 1) f ON true
  )
  SELECT
    t.provider, t.prioridad,
    CASE WHEN t.percent_fee IS NULL AND t.fixed_fee IS NULL THEN NULL
         ELSE ROUND((p_monto * COALESCE(t.percent_fee, 0) / 100.0 + COALESCE(t.fixed_fee, 0))
                    * (1 + COALESCE(t.iva_on_fee_pct, 0) / 100.0), 2)
    END AS costo,
    t.percent_fee AS costo_pct,
    t.release_days AS dias_acredita
  FROM tarifa t
  ORDER BY t.prioridad, (t.percent_fee IS NULL),
           ROUND((p_monto * COALESCE(t.percent_fee, 0) / 100.0 + COALESCE(t.fixed_fee, 0))
                 * (1 + COALESCE(t.iva_on_fee_pct, 0) / 100.0), 2);
$fn$;

REVOKE ALL ON FUNCTION public.pago_proveedores_para(uuid, text, numeric, int, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pago_proveedores_para(uuid, text, numeric, int, text) TO service_role;

-- ── 4. Lo que el comercio ve para elegir ───────────────────────────────────
--
-- Una fila por medio disponible, con su estado de conexión. Es la pantalla de
-- "Medios de pago" de Tiendanube, con la diferencia de que dice la verdad sobre
-- qué está integrado.

CREATE OR REPLACE FUNCTION public.medios_de_pago_de(p_org uuid)
RETURNS TABLE (
  provider     text,
  nombre       text,
  descripcion  text,
  conexion     text,
  integracion  text,
  conectado    boolean,
  habilitado   boolean,
  cuenta       text,
  soporta_cuotas boolean,
  orden        int
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT
    pp.codigo,
    COALESCE(pp.nombre_publico, pp.nombre),
    pp.descripcion,
    pp.conexion,
    pp.integracion,
    -- Lo que no necesita conexión cuenta como conectado siempre.
    (pp.conexion = 'ninguna' OR o.conectado_at IS NOT NULL) AS conectado,
    COALESCE(o.habilitado, false),
    o.cuenta,
    pp.soporta_cuotas,
    pp.orden
  FROM public.payment_providers pp
  LEFT JOIN public.org_payment_providers o
         ON o.provider = pp.codigo AND o.org_id = p_org
  WHERE pp.is_active
    AND public.is_org_member(p_org, auth.uid())
  ORDER BY pp.orden, pp.codigo;
$fn$;

COMMENT ON FUNCTION public.medios_de_pago_de IS
  'Los medios que el comercio puede ofrecer, con su estado real de integracion. Un "declarado" no cobra: esta para que lo vea venir.';

-- ── 5. Habilitar o apagar un medio ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.medio_de_pago_habilitar(
  p_org      uuid,
  p_provider text,
  p_activo   boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_pp public.payment_providers; v_conectado boolean;
BEGIN
  IF NOT public.is_org_member(p_org, auth.uid()) THEN
    RAISE EXCEPTION 'Sin permiso sobre esa organización' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_pp FROM public.payment_providers WHERE codigo = p_provider AND is_active;
  IF v_pp.codigo IS NULL THEN
    RAISE EXCEPTION 'Ese medio de pago no existe';
  END IF;

  -- ⚠️ No se puede habilitar algo que no cobra. Dejarlo pasar haría que el
  -- comprador elija ese medio y el checkout falle en el último paso.
  IF p_activo AND v_pp.integracion = 'declarado' THEN
    RAISE EXCEPTION '% todavía no está integrado. Está en la lista para que sepas que viene.', v_pp.nombre;
  END IF;

  SELECT (o.conectado_at IS NOT NULL) INTO v_conectado
    FROM public.org_payment_providers o
   WHERE o.org_id = p_org AND o.provider = p_provider;

  IF p_activo AND v_pp.conexion <> 'ninguna' AND NOT COALESCE(v_conectado, false) THEN
    RAISE EXCEPTION 'Primero conectá tu cuenta de %', v_pp.nombre;
  END IF;

  INSERT INTO public.org_payment_providers (org_id, provider, habilitado)
  VALUES (p_org, p_provider, p_activo)
  ON CONFLICT (org_id, provider) DO UPDATE
    SET habilitado = EXCLUDED.habilitado, updated_at = now();

  PERFORM public.emitir_evento(p_org, 'medio_de_pago', gen_random_uuid(),
    CASE WHEN p_activo THEN 'medio_de_pago.habilitado' ELSE 'medio_de_pago.deshabilitado' END,
    jsonb_build_object('provider', p_provider));

  RETURN jsonb_build_object('ok', true, 'provider', p_provider, 'habilitado', p_activo);
END;
$fn$;

-- ── 6. Registrar una conexión (la llama la Edge Function del OAuth) ────────
--
-- ⚠️ Recibe el nombre de la cuenta, **nunca el token**. El token lo guarda la
-- Edge Function en `payment_connections`, que tiene cero policies.

CREATE OR REPLACE FUNCTION public.medio_de_pago_conectado(
  p_org      uuid,
  p_provider text,
  p_cuenta   text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  INSERT INTO public.org_payment_providers (org_id, provider, cuenta, conectado_at, habilitado)
  VALUES (p_org, p_provider, p_cuenta, now(), true)
  ON CONFLICT (org_id, provider) DO UPDATE
    SET cuenta = EXCLUDED.cuenta, conectado_at = now(),
        habilitado = true, updated_at = now();

  PERFORM public.emitir_evento(p_org, 'medio_de_pago', gen_random_uuid(),
    'medio_de_pago.conectado',
    jsonb_build_object('provider', p_provider, 'cuenta', p_cuenta));

  RETURN jsonb_build_object('ok', true, 'provider', p_provider, 'cuenta', p_cuenta);
END;
$fn$;

REVOKE ALL ON FUNCTION public.medio_de_pago_conectado(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.medio_de_pago_conectado(uuid, text, text) TO service_role;

-- ── 7. Migrar lo que ya estaba conectado ───────────────────────────────────
--
-- El comercio que ya tiene MercadoPago por OAuth no tiene que volver a
-- conectarlo: se le da por hecho a partir de `payment_connections`.

INSERT INTO public.org_payment_providers (org_id, provider, cuenta, conectado_at, habilitado)
SELECT pc.org_id, 'mercadopago', NULL, COALESCE(pc.updated_at, now()), true
  FROM public.payment_connections pc
 WHERE pc.provider = 'mercadopago'
ON CONFLICT (org_id, provider) DO NOTHING;
