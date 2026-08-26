-- ═══════════════════════════════════════════════════════════════════════════
-- P0-03 — qué contar primero
-- ═══════════════════════════════════════════════════════════════════════════
--
-- El circuito de toma física está completo: `abrir_conteo`, `registrar_conteo`,
-- `cerrar_conteo`, `cancelar_conteo`, la vista `conteo_varianzas` y la pestaña
-- en Inventario. Lo que falta es que alguien cuente, y eso no es código.
--
-- Pero contar 60 productos a ciegas y contar los que se sabe que están mal son
-- dos trabajos distintos. `CLAUDE.md` documenta la consulta que encuentra los
-- desalineados —medido: **15 productos**— y esa consulta vive en un documento,
-- así que hay que copiarla y pegarla en un cliente SQL para verla.
--
-- ── Por qué están desalineados ─────────────────────────────────────────────
--
-- Durante meses cada venta descontó el doble y cada compra sumó el doble
-- (arreglado en la sesión 91). Los números se venían corrigiendo a mano desde
-- la pantalla, que no deja asiento. El Kardex y el stock actual cuentan dos
-- historias y no hay forma de saber cuál es la buena sin contar.
--
-- ⚠️ Esto **no corrige nada**. Es deliberado: reconstruir el stock por código
-- exigiría saber qué ventas pasaron por el camino duplicado y cuáles no, y
-- adivinarlo es peor que el problema. La vista dice dónde mirar; el ajuste sale
-- de contar y pasa por `cerrar_conteo`, que sí deja asiento.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.kardex_contra_stock AS
WITH ultimo AS (
  SELECT DISTINCT ON (m.product_id)
         m.product_id, m.stock_after, m.created_at
    FROM public.stock_movements m
   WHERE m.product_id IS NOT NULL
   ORDER BY m.product_id, m.created_at DESC, m.id DESC
)
SELECT
  p.org_id,
  p.id            AS product_id,
  p.name          AS producto,
  p.sku,
  u.stock_after   AS kardex,
  p.stock         AS stock_actual,
  p.stock - u.stock_after AS diferencia,
  -- El impacto en plata: 3 unidades de un perfume caro importan más que 30 de
  -- una muestra. Sin esto, "15 productos" no dice por cuál empezar.
  ROUND(ABS(p.stock - u.stock_after) * COALESCE(p.sale_price_ars, 0), 2) AS impacto_ars,
  u.created_at    AS ultimo_movimiento,
  -- Un Kardex negativo con stock positivo es la firma del descuento doble.
  (u.stock_after < 0 AND p.stock >= 0) AS kardex_negativo
FROM ultimo u
JOIN public.products p ON p.id = u.product_id
WHERE p.stock <> u.stock_after
  AND public.is_org_member(p.org_id, auth.uid());

COMMENT ON VIEW public.kardex_contra_stock IS
  'Productos donde el Kardex y el stock actual no coinciden, ordenables por impacto en pesos. NO corrige: dice que contar primero. El ajuste sale de cerrar_conteo, que deja asiento.';

GRANT SELECT ON public.kardex_contra_stock TO authenticated;

-- ⚠️ Verificado: `anon` podia consultarla (devolvia 0 filas por el filtro de
-- tenant, pero el permiso estaba). Se revoca: la lista de productos de un
-- comercio no es superficie publica ni aunque salga vacia.
REVOKE ALL ON public.kardex_contra_stock FROM anon;
