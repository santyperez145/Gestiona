-- ═══════════════════════════════════════════════════════════════════════════
-- El costo con aduana dejaba de ser secreto con la clave del bundle
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Segunda pasada de la auditoría del 2026-08-25, atacando con `SET ROLE anon`.
-- Con un par (organización, producto) que se corresponden —la primera prueba
-- usó un producto de otra organización y por eso "falló" sin probar nada—:
--
--     SELECT public.precio_pos_autoritativo(org, producto, NULL, 1);
--
--     {"costo_ars": 34628.80, "costo_usd": 21.643, "tipo_cambio": 1600,
--      "precio_lista": 69258.00, "precio_vigente": 55406.00}
--
-- ⚠️ **Eso es el costo landed y el tipo de cambio**, devueltos al rol de la
-- clave anónima — la que viaja en el bundle de la app y cualquiera lee desde el
-- navegador. Con el id de la organización y los de los productos, que la tienda
-- pública ya expone, se enumera el costo y el margen del catálogo entero.
--
-- Es exactamente el dato que `CONTRIBUTING.md` define como el diferencial del
-- producto: "un ecommerce no sabe el costo". Se sabía, y lo sabía cualquiera.
--
-- ── Por qué las guardas no lo vieron ───────────────────────────────────────
--
-- `publicSurface.test.ts` vigila que una **página pública** no lea una tabla
-- cruda ni pida una columna de costo o margen. Acá no hay página ni tabla: es
-- una función `SECURITY DEFINER` que nació con `EXECUTE` para PUBLIC, como
-- todas, y devuelve el costo calculado. La guarda miraba el estante
-- equivocado.
--
-- `audit_funciones_expuestas` sí la listaba, entre otras 114. Una guarda con
-- 115 entradas no se lee — por eso en la migración anterior se limpió.
--
-- ── El arreglo ─────────────────────────────────────────────────────────────
--
-- Nadie la llama desde el navegador ni desde una Edge Function: sus únicos dos
-- llamadores son `create_sales_transaction_v2` y
-- `apply_ai_offer_recommendation`, ambas `SECURITY DEFINER`. Cuando una función
-- `SECURITY DEFINER` llama a otra, el permiso se evalúa contra **su dueño**, no
-- contra quien inició la llamada. Así que se puede cerrar del todo sin romper
-- el POS.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- ⚠️ De PUBLIC además de anon: si el permiso viene por PUBLIC, revocarle a
-- `anon` no le saca nada. Es el error que dejó ocho funciones abiertas en el
-- primer endurecimiento de este repo.
REVOKE ALL ON FUNCTION public.precio_pos_autoritativo(uuid, uuid, uuid, numeric)
  FROM PUBLIC, anon, authenticated;

-- La comisión de la plataforma la calcula `store-pay`, que corre con
-- `service_role`. Que la pueda consultar un anónimo no filtra plata de un
-- comercio, pero expone la política comercial de la plataforma y no le sirve a
-- nadie del otro lado.
REVOKE ALL ON FUNCTION public.platform_commission_amount(uuid, numeric, text)
  FROM PUBLIC, anon, authenticated;

-- `usos_de_cupon_por_persona` la usa `check_store_coupon`, que es de la tienda
-- y es `SECURITY DEFINER`: sigue funcionando. Desde afuera sólo sirve para
-- contar cuánto usó un cupón una persona, que es dato de otro.
REVOKE ALL ON FUNCTION public.usos_de_cupon_por_persona(uuid, text)
  FROM PUBLIC, anon;

-- ── La guarda que faltaba ──────────────────────────────────────────────────
--
-- `publicSurface` mira páginas; `audit_funciones_expuestas` mira permisos. Lo
-- que no miraba nadie es **qué devuelve** una función que un anónimo puede
-- llamar. Esta vista cruza las dos cosas: invocable desde el navegador sin
-- sesión **y** su cuerpo menciona costo, margen o ganancia.

CREATE OR REPLACE VIEW public.audit_costo_expuesto AS
SELECT
  p.proname AS funcion,
  pg_get_function_identity_arguments(p.oid) AS argumentos,
  has_function_privilege('anon', p.oid, 'EXECUTE')          AS llama_anon,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS llama_authenticated
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind IN ('f', 'p')
  AND p.prorettype <> 'trigger'::regtype
  AND has_function_privilege('anon', p.oid, 'EXECUTE')
  -- ⚠️ Y que NO verifique permisos adentro. La primera version de esta vista no
  -- miraba esto y reportaba `ledger_resultado` y `ledger_resultado_diario`, que
  -- son anon-invocables pero rechazan al que no es miembro: se comprobo
  -- atacandolas y devuelven "No tenes permiso para ver el resultado de esta
  -- organizacion". Una guarda que nunca puede quedar vacia es exactamente el
  -- ruido que este mismo dia se descarto en otras dos guardas.
  AND pg_get_functiondef(p.oid) NOT ILIKE '%is_org_member%'
  AND pg_get_functiondef(p.oid) NOT ILIKE '%is_platform_admin%'
  AND pg_get_functiondef(p.oid) NOT ILIKE '%has_permission%'
  AND pg_get_functiondef(p.oid) NOT ILIKE '%has_org_role%'
  AND pg_get_functiondef(p.oid) NOT ILIKE '%has_platform_role%'
  AND pg_get_functiondef(p.oid) NOT ILIKE '%public.memberships%'
  AND (
    pg_get_functiondef(p.oid) ~* '\mcosto_'
    OR pg_get_functiondef(p.oid) ~* '\mcost_'
    OR pg_get_functiondef(p.oid) ~* '\mmargen\M'
    OR pg_get_functiondef(p.oid) ~* '\mprofit_'
    OR pg_get_functiondef(p.oid) ~* 'cost_per_unit'
    OR pg_get_functiondef(p.oid) ~* 'unit_cost'
  );

COMMENT ON VIEW public.audit_costo_expuesto IS
  'Funciones que un anonimo puede llamar, que tocan costo/margen/ganancia y que NO verifican permisos por ninguno de los cuatro caminos del repo. Deberia estar VACIA: el costo landed es el diferencial del producto y la clave anon viaja en el bundle. publicSurface.test.ts vigila paginas y tablas; esto vigila lo que devuelve un RPC.';

REVOKE ALL ON public.audit_costo_expuesto FROM anon, authenticated;
