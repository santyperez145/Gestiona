-- La traza distingue «se perdió plata» de «no lo puedo seguir»
--
-- ── Dos errores de la versión anterior, encontrados usándola ──────────────
--
-- ⚠️ **1. La auditoría decía 0 porque no veía nada.** `audit_pago_sin_llegar`
-- leía de `traza_de_pago`, que filtra por `is_org_member(org, auth.uid())`.
-- Consultada desde `npm run db` —sin sesión— devolvía **cero filas**, y cero
-- filas en una vista de auditoría se lee como «no hay problemas».
--
-- Es textual la regla de CLAUDE.md: un `?? []` convierte «no tengo permiso» en
-- «no hay nada», y son problemas opuestos. Una vista que existe para avisar no
-- puede quedarse muda cuando el que pregunta no tiene sesión.
--
-- ⚠️ **2. Decía que la plata no había llegado, y había llegado.** Los dos
-- cobros reales daban «hay orden y no hay venta». Medido: las dos ventas de $1
-- **existen** (2026-07-31, `source = tienda_online`). Lo que falta es el
-- enlace: `sales.ecommerce_order_id` está en NULL en esas filas, porque son
-- anteriores a la versión de `mark_store_order_paid` que lo escribe —esa
-- versión sí lo guarda, se verificó en el cuerpo de la función—.
--
-- 📌 **No se backfillean.** Emparejarlas por monto y fecha es adivinar, y
-- CLAUDE.md ya dejó escrito que no se tocan datos reales para que un reporte dé
-- limpio. Se las nombra por lo que son: operaciones que no se pueden seguir,
-- no plata perdida. Confundir las dos cosas hace que la próxima vez que
-- aparezca plata perdida de verdad, nadie le crea a la vista.

-- ⚠️ Se dropea antes de recrear: `CREATE OR REPLACE VIEW` no puede quitar
-- columnas, y la versión anterior de la auditoría heredaba todas las de la
-- traza. Y la auditoría va primero porque dependía de la traza.
DROP VIEW IF EXISTS public.audit_pago_sin_llegar;
DROP VIEW IF EXISTS public.traza_de_pago;

CREATE OR REPLACE VIEW public.traza_de_pago AS
WITH pago AS (
  SELECT pt.correlation_id,
         pt.org_id,
         pt.id            AS pago_id,
         pt.status        AS pago_estado,
         pt.gross_amount  AS monto,
         pt.external_id   AS id_del_proveedor,
         pt.provider,
         pt.created_at,
         CASE WHEN pt.source = 'ecommerce' THEN pt.source_id END AS orden_id
    FROM public.payment_transactions pt
   WHERE pt.correlation_id IS NOT NULL
)
SELECT p.correlation_id,
       p.org_id,
       p.created_at,
       p.provider,
       p.monto,
       p.pago_estado,
       p.id_del_proveedor,
       p.pago_id,
       o.id                         AS orden_id,
       o.payment_status             AS orden_estado,
       s.id                         AS venta_id,
       (SELECT count(*) FROM public.ledger_entries le
         WHERE le.referencia_tipo = 'venta' AND le.referencia_id = s.id) AS asientos,
       (SELECT count(*) FROM public.payment_operation_trace t
         WHERE t.correlation_id = p.correlation_id)                      AS pasos_registrados,
       CASE
         WHEN o.id IS NULL THEN 'se cobró y no hay orden'
         -- ⚠️ Antes esto decía «hay orden y no hay venta», y sonaba a plata
         -- perdida. Puede ser sólo que la venta no guarde el número de orden:
         -- el enlace se empezó a escribir después. Se dice lo que se observa.
         WHEN s.id IS NULL THEN 'no se puede seguir: la venta no guarda el número de orden'
         WHEN NOT EXISTS (SELECT 1 FROM public.ledger_entries le
                           WHERE le.referencia_tipo = 'venta' AND le.referencia_id = s.id)
              THEN 'hay venta y no llegó al libro'
         ELSE 'completo'
       END AS donde_se_corto
  FROM pago p
  LEFT JOIN public.ecommerce_orders o ON o.id = p.orden_id
  LEFT JOIN public.sales s            ON s.ecommerce_order_id = o.id
 WHERE public.is_org_member(p.org_id, auth.uid())
    OR public.is_platform_admin(auth.uid());

COMMENT ON VIEW public.traza_de_pago IS
  'Un pago y sus eslabones: cobro, orden, venta, asientos y pasos. '
  '`donde_se_corto` distingue plata que no llegó de una operación que no se '
  'puede seguir. No guarda nada: recorre los enlaces que ya existen.';

GRANT SELECT ON public.traza_de_pago TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- La auditoría no depende de tener sesión
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Se arma sobre las tablas, no sobre la vista filtrada, y sólo la puede leer
-- el staff. Así `npm run db` ve la verdad en vez de un cero tranquilizador.

CREATE OR REPLACE VIEW public.audit_pago_sin_llegar AS
SELECT pt.correlation_id,
       pt.org_id,
       pt.created_at,
       pt.gross_amount AS monto,
       pt.status       AS pago_estado,
       CASE WHEN o.id IS NULL THEN 'se cobró y no hay orden'
            ELSE 'hay venta y no llegó al libro' END AS problema
  FROM public.payment_transactions pt
  LEFT JOIN public.ecommerce_orders o
         ON o.id = CASE WHEN pt.source = 'ecommerce' THEN pt.source_id END
  LEFT JOIN public.sales s ON s.ecommerce_order_id = o.id
 WHERE pt.status IN ('approved', 'accredited', 'paid')
   -- Sólo lo que es plata que no llegó:
   AND (
     o.id IS NULL
     -- Hay orden Y hay venta enlazada, pero el libro no la tiene.
     OR (s.id IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM public.ledger_entries le
            WHERE le.referencia_tipo = 'venta' AND le.referencia_id = s.id))
   );
   -- 📌 Queda AFUERA el caso «no hay venta enlazada»: eso es una traza
   -- incompleta, no plata perdida, y mezclarlos hace que nadie le crea a la
   -- vista el día que aparezca una diferencia real.

COMMENT ON VIEW public.audit_pago_sin_llegar IS
  'Pagos aprobados que NO llegaron: sin orden, o con venta que el libro no '
  'registró. Tiene que estar vacía. No filtra por auth.uid() a propósito: una '
  'vista de auditoría que devuelve cero por falta de sesión se lee como «todo '
  'bien».';

REVOKE ALL ON public.audit_pago_sin_llegar FROM anon, authenticated;

-- ── Y lo que no se puede seguir, contado aparte ───────────────────────────

CREATE OR REPLACE VIEW public.audit_pago_sin_traza AS
SELECT pt.correlation_id, pt.org_id, pt.created_at, pt.gross_amount AS monto
  FROM public.payment_transactions pt
  LEFT JOIN public.ecommerce_orders o
         ON o.id = CASE WHEN pt.source = 'ecommerce' THEN pt.source_id END
  LEFT JOIN public.sales s ON s.ecommerce_order_id = o.id
 WHERE pt.status IN ('approved', 'accredited', 'paid')
   AND o.id IS NOT NULL AND s.id IS NULL;

COMMENT ON VIEW public.audit_pago_sin_traza IS
  'Cobros que llegaron pero no se pueden seguir: la venta existe y no guarda '
  'el número de orden. Son 2 al 2026-08-27, anteriores a que '
  'mark_store_order_paid escribiera el enlace. NO se backfillean: emparejarlas '
  'por monto y fecha es adivinar.';

REVOKE ALL ON public.audit_pago_sin_traza FROM anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación
-- ═══════════════════════════════════════════════════════════════════════════

DO $verif$
DECLARE v_perdidos int; v_sin_traza int;
BEGIN
  -- ⚠️ Se consulta SIN sesión, que es como la corre `npm run db`. Si la vista
  -- volviera a filtrar por auth.uid(), esto daría 0 por el motivo equivocado.
  SELECT count(*) INTO v_perdidos   FROM public.audit_pago_sin_llegar;
  SELECT count(*) INTO v_sin_traza  FROM public.audit_pago_sin_traza;

  RAISE NOTICE 'plata que no llegó: % | cobros que no se pueden seguir: %',
    v_perdidos, v_sin_traza;

  ASSERT v_perdidos = 0,
    'hay ' || v_perdidos || ' cobros aprobados que no llegaron al libro';

  -- Los 2 históricos son conocidos y están documentados. Si aparece un
  -- tercero, es que el enlace volvió a dejar de escribirse.
  ASSERT v_sin_traza <= 2,
    'aparecieron cobros nuevos sin enlace a su venta: ' || v_sin_traza
    || '. mark_store_order_paid dejó de guardar ecommerce_order_id.';
END $verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260827000260', 'la_traza_distingue_perder_de_no_poder_seguir')
ON CONFLICT DO NOTHING;
