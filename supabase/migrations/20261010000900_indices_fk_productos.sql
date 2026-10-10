-- Índices de las claves foráneas que apuntan a products.
--
-- Medido 2026-10-10: borrar los 7.378 productos de una organización agotaba el
-- tiempo del SQL Editor. product_import_rows (60.821 filas) referencia a
-- products por target_product_id y result_product_id sin índice, con ON
-- DELETE SET NULL: cada producto borrado recorría la tabla entera dos veces.
-- Otras 36 referencias tenían el mismo hueco. Con estos índices, borrar o
-- unificar productos (unificar_productos) busca por índice.
--
-- Sólo agrega índices; IF NOT EXISTS los hace idempotentes.

CREATE INDEX IF NOT EXISTS purchases_product_id_fk_idx ON public.purchases (product_id);
CREATE INDEX IF NOT EXISTS sales_product_id_fk_idx ON public.sales (product_id);
CREATE INDEX IF NOT EXISTS returns_product_id_fk_idx ON public.returns (product_id);
CREATE INDEX IF NOT EXISTS location_stock_product_id_fk_idx ON public.location_stock (product_id);
CREATE INDEX IF NOT EXISTS stock_transfers_product_id_fk_idx ON public.stock_transfers (product_id);
CREATE INDEX IF NOT EXISTS stock_history_product_id_fk_idx ON public.stock_history (product_id);
CREATE INDEX IF NOT EXISTS demand_signals_product_id_fk_idx ON public.demand_signals (product_id);
CREATE INDEX IF NOT EXISTS inventory_snapshots_product_id_fk_idx ON public.inventory_snapshots (product_id);
CREATE INDEX IF NOT EXISTS recommendation_events_trigger_product_id_fk_idx ON public.recommendation_events (trigger_product_id);
CREATE INDEX IF NOT EXISTS recommendation_events_recommended_product_id_fk_idx ON public.recommendation_events (recommended_product_id);
CREATE INDEX IF NOT EXISTS service_order_items_product_id_fk_idx ON public.service_order_items (product_id);
CREATE INDEX IF NOT EXISTS afip_alicuotas_producto_id_fk_idx ON public.afip_alicuotas (producto_id);
CREATE INDEX IF NOT EXISTS product_cooccurrences_product_a_id_fk_idx ON public.product_cooccurrences (product_a_id);
CREATE INDEX IF NOT EXISTS product_cooccurrences_product_b_id_fk_idx ON public.product_cooccurrences (product_b_id);
CREATE INDEX IF NOT EXISTS recommendation_rules_trigger_product_id_fk_idx ON public.recommendation_rules (trigger_product_id);
CREATE INDEX IF NOT EXISTS recommendation_rules_recommended_product_id_fk_idx ON public.recommendation_rules (recommended_product_id);
CREATE INDEX IF NOT EXISTS stock_count_items_product_id_fk_idx ON public.stock_count_items (product_id);
CREATE INDEX IF NOT EXISTS demand_forecasts_product_id_fk_idx ON public.demand_forecasts (product_id);
CREATE INDEX IF NOT EXISTS forecast_configs_product_id_fk_idx ON public.forecast_configs (product_id);
CREATE INDEX IF NOT EXISTS recipe_ingredients_ingredient_product_id_fk_idx ON public.recipe_ingredients (ingredient_product_id);
CREATE INDEX IF NOT EXISTS product_import_rows_target_product_id_fk_idx ON public.product_import_rows (target_product_id);
CREATE INDEX IF NOT EXISTS product_import_rows_result_product_id_fk_idx ON public.product_import_rows (result_product_id);
CREATE INDEX IF NOT EXISTS recipes_output_product_id_fk_idx ON public.recipes (output_product_id);
CREATE INDEX IF NOT EXISTS purchase_request_items_product_id_fk_idx ON public.purchase_request_items (product_id);
CREATE INDEX IF NOT EXISTS location_variant_stock_product_id_fk_idx ON public.location_variant_stock (product_id);
CREATE INDEX IF NOT EXISTS sales_forecasts_product_id_fk_idx ON public.sales_forecasts (product_id);
CREATE INDEX IF NOT EXISTS plm_products_product_id_fk_idx ON public.plm_products (product_id);
CREATE INDEX IF NOT EXISTS price_change_impact_events_product_id_fk_idx ON public.price_change_impact_events (product_id);
CREATE INDEX IF NOT EXISTS purchase_order_items_product_id_fk_idx ON public.purchase_order_items (product_id);
CREATE INDEX IF NOT EXISTS product_batches_product_id_fk_idx ON public.product_batches (product_id);
CREATE INDEX IF NOT EXISTS return_requests_product_id_fk_idx ON public.return_requests (product_id);
CREATE INDEX IF NOT EXISTS product_bundle_items_product_id_fk_idx ON public.product_bundle_items (product_id);
CREATE INDEX IF NOT EXISTS meli_listings_product_id_fk_idx ON public.meli_listings (product_id);
CREATE INDEX IF NOT EXISTS store_wishlists_product_id_fk_idx ON public.store_wishlists (product_id);
CREATE INDEX IF NOT EXISTS finance_product_aliases_product_id_fk_idx ON public.finance_product_aliases (product_id);
CREATE INDEX IF NOT EXISTS finance_document_line_matches_proposed_product_id_fk_idx ON public.finance_document_line_matches (proposed_product_id);
CREATE INDEX IF NOT EXISTS finance_document_line_matches_confirmed_product_id_fk_idx ON public.finance_document_line_matches (confirmed_product_id);
CREATE INDEX IF NOT EXISTS finance_purchase_draft_lines_product_id_fk_idx ON public.finance_purchase_draft_lines (product_id);
