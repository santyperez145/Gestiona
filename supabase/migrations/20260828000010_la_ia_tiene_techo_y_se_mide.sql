-- La IA tiene techo, se mide, y pagar deja de sacarle cosas al comercio
--
-- ── Lo que se midió el 2026-08-28 ─────────────────────────────────────────
--
--     code      precio   ia     backups  branding  ventas/mes
--     trial          0   true   true     true      sin límite
--     starter   19.900   false  false    false     1.500
--     pro       34.900   true   true     true      5.000
--     business  69.900   true   true     true      sin límite
--
-- ⚠️ **Pagar $19.900 sacaba tres cosas que el comercio tenía gratis.** El día
-- 15 del trial no elige entre planes: elige entre pagar y perder la IA, o
-- irse. Es el peor momento posible para quitar una función — justo cuando pone
-- la tarjeta.
--
-- ── Y dos de las tres no existían ─────────────────────────────────────────
--
-- ⚠️ `custom_branding` y `backups_enabled` se calculan en `useEntitlements`
-- como `canCustomBrand` y `canUseBackups`, y **no los lee ninguna pantalla**
-- (medido: cero consumidores fuera del propio hook). O sea que de los tres
-- diferenciadores que la página de precios promete, **uno solo está
-- implementado** — y va al revés.
--
-- 📌 Una grilla de planes que promete restricciones que el código no aplica es
-- la misma clase de problema que un FAQ que miente: el día que alguien las
-- implemente, el comercio que ya pagaba pierde algo sin haber cambiado nada.
--
-- ── La decisión, y por qué ────────────────────────────────────────────────
--
-- **Los planes se diferencian por volumen, no apagando capacidades.** Es lo que
-- hacen los que ya operan: Tiendanube y Shopify reparten por límites, comisión
-- y usuarios, no sacándole el buscador a quien paga menos.
--
-- Y la IA es el diferencial declarado del producto —Business Copilot, no
-- generador de textos—. Dejarla fuera del plan de entrada significa que el
-- comercio que más necesita saber qué comprar y qué canal le deja menos margen
-- **nunca la ve**.
--
-- ⚠️ Pero un booleano no controla el costo: hoy cualquier organización con
-- `ia=true` puede quemar `ANTHROPIC_API_KEY` sin techo, y `ai_usage_stats`
-- —que existe desde hace meses— tiene **0 filas**. Nadie registra lo que la IA
-- cuesta. Para un producto que se va a vender, un costo por cliente sin techo
-- ni medición no es un detalle técnico.
--
-- Entonces: la IA entra en todos los planes **con un cupo mensual medido**. El
-- cupo es el diferenciador real, y reemplaza a los dos que no existían.
--
-- 📌 **El cupo se cuenta en acciones, no en tokens.** Un comercio entiende «te
-- quedan 180 consultas»; no entiende 40.000 tokens. Y el costo por acción está
-- acotado por `max_tokens` de cada función, así que contar acciones alcanza
-- para acotar el gasto. Los tokens se guardan igual, para poder medir el margen
-- real después.
--
-- ⚠️ **El precio no se toca.** Qué cobrar es del dueño; esto reparte
-- capacidades, que es producto. Se deshace con un UPDATE.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. El cupo vive en el plan
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS ai_monthly_credits int;

COMMENT ON COLUMN public.plans.ai_monthly_credits IS
  'Acciones de IA por mes. NULL = sin tope. Se cuenta en acciones y no en '
  'tokens porque es lo que el comercio entiende y lo que ya mide AI Action '
  'Rate; los tokens se guardan en ai_usage_stats para medir el margen.';

UPDATE public.plans SET ai_monthly_credits = 100  WHERE code = 'trial';
UPDATE public.plans SET ai_monthly_credits = 300  WHERE code = 'starter';
UPDATE public.plans SET ai_monthly_credits = 2000 WHERE code = 'pro';
UPDATE public.plans SET ai_monthly_credits = NULL WHERE code = 'business';

-- ⚠️ El trial queda por DEBAJO del plan de entrada a propósito. Antes estaba al
-- revés y era el defecto: la prueba tiene que dejar ganas, no dejar deuda.

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Ningún plan pago ofrece menos que la prueba gratis
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE public.plans
   SET ai_enabled      = true,
       backups_enabled = true,
       custom_branding = true
 WHERE code = 'starter';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. El consumo se registra, y hay una sola puerta para hacerlo
-- ═══════════════════════════════════════════════════════════════════════════

-- `ai_usage_stats` ya existía con la forma correcta y sin una sola fila. No se
-- crea otra tabla: se le pone la llave que faltaba para poder sumar por mes.
CREATE UNIQUE INDEX IF NOT EXISTS ai_usage_stats_org_dia_modelo
  ON public.ai_usage_stats (org_id, date, model, user_id);

-- ⚠️ `estimated_cost_usd` era NOT NULL, así que un consumo sin precio conocido
-- obligaba a escribir 0 — y **0 dice «esto no costó nada»**, que es distinto de
-- «no se calculó». Es la misma distinción que `products.tax_rate`: NULL no es
-- cero. Con 0 filas en la tabla, abrirla no rompe nada.
ALTER TABLE public.ai_usage_stats ALTER COLUMN estimated_cost_usd DROP NOT NULL;

COMMENT ON COLUMN public.ai_usage_stats.estimated_cost_usd IS
  'Costo estimado en USD, o NULL si no se calculó. NULL no es cero: cero '
  'afirmaría que la acción salió gratis. Los tokens de al lado sí son medidos.';

ALTER TABLE public.ai_usage_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_usage_stats_lee_su_comercio ON public.ai_usage_stats;
CREATE POLICY ai_usage_stats_lee_su_comercio ON public.ai_usage_stats
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));

-- Escribe sólo el servidor: si el navegador pudiera escribir acá, el cupo lo
-- decidiría el cliente.
DROP POLICY IF EXISTS ai_usage_stats_escribe_el_servidor ON public.ai_usage_stats;

CREATE OR REPLACE FUNCTION public.ia_registrar_consumo(
  p_org    uuid,
  p_user   uuid,
  p_model  text,
  p_input  int DEFAULT 0,
  p_output int DEFAULT 0,
  p_costo  numeric DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  -- ⚠️ `total_tokens` es una columna **generada** (`input + output`): la base
  -- rechaza el INSERT si se la manda. Se deja que la calcule ella.
  INSERT INTO public.ai_usage_stats AS u
         (org_id, user_id, date, model, input_tokens, output_tokens,
          request_count, estimated_cost_usd)
  VALUES (p_org, p_user, current_date, COALESCE(p_model, 'desconocido'),
          GREATEST(p_input, 0), GREATEST(p_output, 0), 1, p_costo)
  ON CONFLICT (org_id, date, model, user_id) DO UPDATE
     SET input_tokens       = u.input_tokens  + EXCLUDED.input_tokens,
         output_tokens      = u.output_tokens + EXCLUDED.output_tokens,
         request_count      = u.request_count + 1,
         estimated_cost_usd = COALESCE(u.estimated_cost_usd, 0)
                            + COALESCE(EXCLUDED.estimated_cost_usd, 0);
$$;

COMMENT ON FUNCTION public.ia_registrar_consumo IS
  'Única puerta para registrar una acción de IA. La llaman las Edge Functions '
  'con service_role después de que el proveedor contestó: registrar antes '
  'cobraría una acción que falló.';

REVOKE ALL ON FUNCTION public.ia_registrar_consumo(uuid, uuid, text, int, int, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ia_registrar_consumo(uuid, uuid, text, int, int, numeric) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Cuántas acciones lleva el comercio este mes
-- ═══════════════════════════════════════════════════════════════════════════

-- ⚠️ La primera versión de esta función no validaba la organización, y
-- `funcionesExpuestas.test.ts` la marcó apenas se corrió la suite. Es
-- `SECURITY DEFINER` y recibe un `org_id`: sin el chequeo, cualquiera con la
-- clave anónima —que va en el bundle— podía preguntar cuánta IA usa otro
-- comercio. Un contador de uso es una señal de negocio, no un dato inocuo.
--
-- 📌 La forma es la misma que la de `org_entitlements`: se exige membresía
-- cuando hay un usuario, y se deja pasar a `service_role` (donde `auth.uid()`
-- es NULL) porque ahí la organización ya la validó quien llamó.
CREATE OR REPLACE FUNCTION public.ia_consumo_del_mes(p_org uuid)
RETURNS int
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_org_member(p_org, auth.uid()) THEN
    RAISE EXCEPTION 'Sin permiso sobre esta organización'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN COALESCE((
    SELECT SUM(request_count)
      FROM public.ai_usage_stats
     WHERE org_id = p_org
       AND date >= date_trunc('month', current_date)::date
  ), 0)::int;
END $$;

REVOKE ALL ON FUNCTION public.ia_consumo_del_mes(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ia_consumo_del_mes(uuid) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. La autoridad de beneficios devuelve el cupo, como devuelve todo lo demás
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 📌 Se agrega al final del objeto que ya devolvía: quien lee por nombre de
-- campo no se entera. Es la misma regla que para las firmas de RPC.

CREATE OR REPLACE FUNCTION public.org_entitlements(p_org uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sub    public.subscriptions;
  v_plan   public.plans;
  v_dias   int := 0;
  v_motivo text := NULL;
  v_vigente boolean;
  v_nunca_se_cobro boolean;
  v_cupo   int;
  v_usado  int;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_org_member(p_org, auth.uid()) THEN
    RAISE EXCEPTION 'Sin permiso sobre esta organización'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_sub FROM public.subscriptions WHERE org_id = p_org;

  v_nunca_se_cobro := v_sub.id IS NOT NULL
                      AND v_sub.current_period_end IS NULL
                      AND v_sub.status NOT IN ('active', 'trialing')
                      AND v_sub.created_at <= now() - interval '60 minutes';

  SELECT * INTO v_plan FROM public.plans
   WHERE id = CASE
     WHEN v_nunca_se_cobro THEN (SELECT o.plan_id FROM public.organizations o WHERE o.id = p_org)
     ELSE COALESCE(v_sub.plan_id,
                   (SELECT o.plan_id FROM public.organizations o WHERE o.id = p_org))
   END;

  IF v_sub.id IS NULL THEN
    v_vigente := true;
  ELSIF v_sub.status IN ('active', 'trialing') THEN
    v_vigente := true;
  ELSIF v_sub.status = 'canceled' THEN
    v_vigente := false; v_motivo := 'cancelado';
  ELSIF v_sub.status = 'paused' THEN
    v_vigente := false; v_motivo := 'pausado';
  ELSIF v_sub.status = 'past_due' AND v_sub.current_period_end IS NULL THEN
    IF v_sub.created_at > now() - interval '60 minutes' THEN
      v_vigente := true;
      v_motivo  := NULL;
    ELSE
      v_vigente := false;
      v_motivo  := 'sin_pagar';
    END IF;
  ELSIF v_sub.status = 'past_due' THEN
    v_dias := GREATEST(0, 7 - GREATEST(0,
      EXTRACT(day FROM now() - v_sub.current_period_end)::int));
    v_vigente := v_dias > 0;
    IF NOT v_vigente THEN v_motivo := 'impago'; END IF;
  ELSE
    v_vigente := true;
  END IF;

  IF v_nunca_se_cobro AND v_motivo = 'sin_pagar' THEN
    SELECT o.trial_ends_at IS NULL OR o.trial_ends_at > now()
      INTO v_vigente
      FROM public.organizations o WHERE o.id = p_org;
    v_vigente := COALESCE(v_vigente, false);
    IF NOT v_vigente THEN v_motivo := 'sin_pagar'; END IF;
  END IF;

  -- ── El cupo de IA ────────────────────────────────────────────────────────
  -- Cortado el plan, el cupo es 0: no se corta la capacidad y se deja el
  -- consumo abierto, que sería cobrarle el costo a la plataforma.
  v_cupo  := v_plan.ai_monthly_credits;
  v_usado := public.ia_consumo_del_mes(p_org);

  RETURN jsonb_build_object(
    'plan',            v_plan.code,
    'vigente',         v_vigente,
    'motivo_de_corte', v_motivo,
    'dias_de_gracia',  v_dias,
    'estado',          v_sub.status,
    'plan_sin_pagar',  v_nunca_se_cobro,
    'ia',       v_vigente AND COALESCE(v_plan.ai_enabled, false),
    'backups',  v_vigente AND COALESCE(v_plan.backups_enabled, false),
    'branding', v_vigente AND COALESCE(v_plan.custom_branding, false),
    'max_products',        CASE WHEN v_vigente THEN v_plan.max_products
                                ELSE LEAST(COALESCE(v_plan.max_products, 50), 50) END,
    'max_users',           CASE WHEN v_vigente THEN v_plan.max_users
                                ELSE LEAST(COALESCE(v_plan.max_users, 1), 1) END,
    'max_sales_per_month', CASE WHEN v_vigente THEN v_plan.max_sales_per_month
                                ELSE LEAST(COALESCE(v_plan.max_sales_per_month, 50), 50) END,
    -- NULL = sin tope. Se distingue de 0, que es «no le queda ninguna».
    'ia_cupo_mensual',  CASE WHEN v_vigente THEN v_cupo ELSE 0 END,
    'ia_usado',         v_usado,
    'ia_restante',      CASE
                          WHEN NOT v_vigente THEN 0
                          WHEN v_cupo IS NULL THEN NULL
                          ELSE GREATEST(0, v_cupo - v_usado)
                        END
  );
END $$;

GRANT EXECUTE ON FUNCTION public.org_entitlements(uuid) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación — el defecto, el cupo, y que registrar de verdad descuente
-- ═══════════════════════════════════════════════════════════════════════════

DO $verif$
DECLARE
  v_org   uuid := gen_random_uuid();
  v_user  uuid;
  v_start uuid;
  v_trial uuid;
  v_e     jsonb;
  v_peor  int;
  v_restos int;
BEGIN
  SELECT user_id INTO v_user FROM public.memberships LIMIT 1;
  SELECT id INTO v_start FROM public.plans WHERE code = 'starter';
  SELECT id INTO v_trial FROM public.plans WHERE code = 'trial';

  -- ── a. ⚠️ Ningún plan pago ofrece menos que la prueba gratis ────────────
  -- Es el defecto que motivó esta migración, escrito como condición.
  SELECT count(*) INTO v_peor
    FROM public.plans p, public.plans t
   WHERE t.code = 'trial' AND p.code <> 'trial' AND p.active
     AND ( (t.ai_enabled      AND NOT p.ai_enabled)
        OR (t.backups_enabled AND NOT p.backups_enabled)
        OR (t.custom_branding AND NOT p.custom_branding) );
  ASSERT v_peor = 0,
    v_peor || ' plan(es) pago(s) ofrecen menos capacidades que el trial gratis';

  -- ── b. Un comercio nuevo tiene cupo, y arranca sin consumo ──────────────
  INSERT INTO public.organizations (id, name, slug, owner_user_id, plan_id)
  VALUES (v_org, 'ZZ cupo ia', 'zz-ia-'||substr(v_org::text,1,8), v_user, v_start);
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner');

  v_e := public.org_entitlements(v_org);
  ASSERT (v_e->>'ia')::boolean, 'el plan de entrada quedó sin IA';
  ASSERT (v_e->>'ia_restante')::int = 300,
    'el cupo del plan de entrada no llegó: ' || COALESCE(v_e->>'ia_restante','NULL');
  ASSERT (v_e->>'ia_usado')::int = 0, 'un comercio nuevo arrancó con consumo';

  -- ── c. Registrar una acción descuenta una ───────────────────────────────
  PERFORM public.ia_registrar_consumo(v_org, v_user, 'claude-test', 1200, 300);
  v_e := public.org_entitlements(v_org);
  ASSERT (v_e->>'ia_usado')::int = 1,
    'la acción no se contó: usado=' || (v_e->>'ia_usado');
  ASSERT (v_e->>'ia_restante')::int = 299, 'el cupo no bajó al consumir';

  -- ── d. Dos acciones del mismo día suman, no se pisan ────────────────────
  -- ⚠️ El índice único es por (org, día, modelo, usuario): sin el ON CONFLICT
  -- que suma, la segunda acción del día habría fallado o reemplazado a la
  -- primera, y el cupo nunca se habría gastado.
  PERFORM public.ia_registrar_consumo(v_org, v_user, 'claude-test', 800, 200);
  v_e := public.org_entitlements(v_org);
  ASSERT (v_e->>'ia_usado')::int = 2,
    'la segunda acción del día no sumó: usado=' || (v_e->>'ia_usado');
  ASSERT (SELECT total_tokens FROM public.ai_usage_stats
           WHERE org_id = v_org AND model = 'claude-test') = 2500,
    'los tokens no se acumularon';

  -- ── e. Business no tiene tope, y eso NO es cero ─────────────────────────
  UPDATE public.organizations
     SET plan_id = (SELECT id FROM public.plans WHERE code = 'business')
   WHERE id = v_org;
  v_e := public.org_entitlements(v_org);
  ASSERT v_e->>'ia_restante' IS NULL,
    'sin tope se confundió con sin cupo: ' || COALESCE(v_e->>'ia_restante','NULL');

  -- ── f. ⚠️ Y un extraño NO puede leer el consumo del comercio ────────────
  -- En los dos sentidos: que el miembro pueda (arriba, b–e) y que el ajeno no.
  -- Un bloque DO corre como superusuario y bypassa todo, así que hay que
  -- ponerse el rol de verdad: sin esto la prueba pasaría con la puerta abierta.
  DECLARE
    v_ajeno uuid := gen_random_uuid();
    v_pudo  boolean := false;
  BEGIN
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', v_ajeno, 'role', 'authenticated')::text,
                       true);
    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM public.ia_consumo_del_mes(v_org);
      v_pudo := true;
    EXCEPTION WHEN insufficient_privilege OR OTHERS THEN
      v_pudo := false;
    END;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', NULL, true);

    ASSERT NOT v_pudo,
      'cualquiera puede leer cuánta IA consume un comercio ajeno';
  END;

  -- ── g. Sin restos ───────────────────────────────────────────────────────
  DELETE FROM public.ai_usage_stats WHERE org_id = v_org;
  DELETE FROM public.memberships    WHERE org_id = v_org;
  DELETE FROM public.organizations  WHERE id = v_org;
  SELECT count(*) INTO v_restos FROM public.organizations WHERE name = 'ZZ cupo ia';
  ASSERT v_restos = 0, 'quedaron restos ZZ';

  RAISE NOTICE 'OK: ningún plan pago ofrece menos que el trial, y el cupo de IA se mide';
END $verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260828000010', 'la_ia_tiene_techo_y_se_mide')
ON CONFLICT DO NOTHING;
