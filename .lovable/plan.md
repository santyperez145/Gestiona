# Plan: Influencers Pro + Recomendador IA + Eliminar hardcodeos

## 1. Módulo Influencers Pro (con comisiones reales)

Hoy `influencer_exchanges` solo registra canjes/regalos. Lo expandimos a un sistema completo de afiliados con comisiones, tracking y ranking.

### Nuevas tablas

**`influencers`** (perfil maestro, separado de cada canje):
```
id, org_id, user_id, name, instagram, tiktok, phone, email,
followers_ig, followers_tiktok, engagement_rate (numeric),
tier (nano|micro|medio|macro), -- calculado por followers
commission_percent (numeric, default 10),
commission_type (porcentaje|monto_fijo|por_venta),
commission_fixed_ars (numeric),
referral_code (text, único por org), -- ej "ANDREA10"
status (activo|pausado|baneado),
total_generated_ars (numeric, denormalizado),
total_commissions_ars (numeric, denormalizado),
total_sales_count (int),
notes, created_at, updated_at
```

**`influencer_sales`** (vínculo venta ↔ influencer cuando se usa código):
```
id, org_id, sale_id, influencer_id, referral_code,
commission_ars (calculado al momento), paid (bool, default false),
paid_at, created_at
```

**`influencer_payouts`** (pagos a influencers):
```
id, org_id, influencer_id, amount_ars, period_start, period_end,
sales_count, payment_method, notes, paid_at, created_at
```

**Migrar `influencer_exchanges`**: agregar columna `influencer_id` (FK opcional) para vincular canjes existentes al nuevo perfil maestro.

### Lógica automática

- **Trigger SQL** `on_sale_with_referral`: si `sales` tiene `referral_code` (nueva columna), busca influencer activo, crea `influencer_sales` con comisión calculada, actualiza `total_*` denormalizados.
- **Tier automático**: función `calculate_influencer_tier(followers)` → nano (<10k), micro (10-100k), medio (100k-1M), macro (>1M). Actualizado por trigger en update de `followers_ig`.
- **Recálculo de engagement**: campo manual editable, futura integración API.

### Nueva columna en `sales`
- `referral_code text` (nullable). En el formulario de venta, campo opcional "Código de referido". Si existe y es válido, se aplica descuento configurable y se registra comisión.

### UI nueva: `/influencers`

Reemplaza/extiende `/canjes`:
- **Tab "Influencers"**: tabla con foto, tier, seguidores, código, comisión, ventas generadas, ROI. Botón crear/editar.
- **Tab "Canjes"** (lo actual, vinculado al influencer maestro).
- **Tab "Ventas con código"**: feed de ventas atribuidas, comisiones pendientes vs pagadas.
- **Tab "Pagos"**: generar liquidación por período (selecciona influencer + rango de fechas → calcula total → marca como pagado → exporta comprobante PDF).
- **Ranking**: top 5 influencers por ventas generadas, ROI (ventas / valor canjes), engagement.
- **Generador de link único**: cada influencer tiene `https://exentryimports.lovable.app/catalogo/{org_slug}?ref=ANDREA10` → guarda en localStorage y se aplica al checkout WhatsApp.

## 2. Recomendador de Ofertas con IA (sin hardcodeos)

Nueva edge function **`ai-offer-recommender`** que analiza datos REALES de la org y sugiere ofertas inteligentes. Cero reglas hardcodeadas.

### Inputs reales que consume:
- `products`: stock, costo USD, precio ARS, margen, fecha de creación, `total_sold`, días desde última venta.
- `sales` últimos 90 días: velocidad de venta por producto, estacionalidad por día de semana.
- `purchases`: lotes recientes (productos sobrestockeados).
- `settings`: `pasero_commission_percent`, `default_discount_percent`, `volume_discount_threshold`, `margin_alert_percent` (todo configurable, no hardcoded).
- `influencer_sales`: productos que mejor convierten con afiliados.

### Output (JSON estructurado vía tool calling):
```json
{
  "ofertas": [
    {
      "product_id": "uuid",
      "product_name": "...",
      "tipo": "liquidacion|combo|destacado|flash|mayorista|pack_decants",
      "razon": "Stock alto (15u) + 0 ventas en 45 días + margen 60%",
      "descuento_sugerido_percent": 25,
      "precio_sugerido_ars": 18000,
      "duracion_horas": 48,
      "margen_resultante_percent": 35,
      "probabilidad_venta": "alta|media|baja",
      "canal_recomendado": "instagram_story|whatsapp_status|catalogo_destacado|email_vip"
    }
  ],
  "combos": [
    { "products": ["uuid1", "uuid2"], "razon": "Se venden juntos en 8 ventas", "precio_combo_ars": 28000, "ahorro_ars": 4000 }
  ],
  "alertas": [
    { "tipo": "sobrestock|stock_dormido|margen_bajo", "product_id": "...", "accion": "..." }
  ]
}
```

### UI: Panel "Recomendador IA" en `/marketing`

- Botón "Generar recomendaciones ahora" (rate-limited a 1x cada 5 min).
- Cards con cada oferta sugerida + razón + botones de acción:
  - **Aplicar**: actualiza `discount_price_ars` y `offer_expires_at` del producto.
  - **Generar story**: abre `InstagramStoryGenerator` precargado.
  - **Marcar destacado**: setea `featured=true`.
  - **Crear combo**: registra en nueva tabla `product_combos`.
  - **Descartar**: oculta esa sugerencia.
- Histórico de recomendaciones aplicadas y su resultado (ventas generadas en X días).

### Sin hardcodeos
El system prompt de la IA recibe los **thresholds desde `settings`** de la org, no constantes en código. El usuario puede ajustar en Ajustes:
- Días para considerar "stock dormido" (default 30, configurable).
- Margen mínimo aceptable (ya existe).
- Stock máximo antes de sobrestock (nuevo, default 10).
- % descuento máximo permitido por IA (nuevo, default 35).

## 3. Eliminar hardcodeos detectados

Auditoría rápida hecha. Cambios:

### `src/pages/OnboardingPage.tsx`
- `RUBROS` y `COLORS` hardcoded → mover a tabla **`onboarding_options`** (rubros) o leer de `plans`/config global. Los colores van a `useBusinessConfig` ya parametrizable.
- Plantillas de configuración inicial por rubro (perfumes vs vapers) en tabla **`industry_presets`** con valores default de `settings` por industria.

### `src/components/marketing/InstagramStoryGenerator.tsx`
- Templates `promo|flash|nuevo|recomendado|limpio` hardcoded → tabla **`story_templates`** por org con: nombre, badge_text, badge_color, emoji, layout. Editables desde UI.
- CTA por defecto "ESCRIBINOS YA 📲" → leer de `settings.default_cta_text`.

### `src/pages/InfluencerExchangesPage.tsx`
- `STATUS_MAP`, `TYPE_MAP` hardcoded → tabla **`enum_labels`** o JSON en `settings.influencer_statuses` editable.

### `supabase/functions/ai-analysis/index.ts` y `generate-description/index.ts`
- Lista de marcas árabes hardcoded en system prompt → tabla **`brand_knowledge`** (org_id, brand, category, notes_typical, clones_of). Cargada al inicio del prompt.
- Tono "rioplatense" hardcoded → leer de `ai_presets` (del plan anterior, si lo implementamos) o `settings.ai_tone`.

### `src/lib/seedData.ts`
- Si tiene productos demo hardcoded, dejarlo SOLO para usuarios nuevos opt-in (botón "cargar demo") en lugar de auto-ejecutarse.

### Otros lugares con valores fijos:
- Umbrales de notificaciones (`low_stock_threshold` etc.) → ya están en `settings` ✓
- `pasero_commission_percent` → ya en `settings` ✓
- `discount_*_percent` por método de pago → ya en `settings` ✓
- Categorías de gastos → ya en `settings.expense_categories` ✓

## 4. Más formas de marketing (incluidas en esta sesión)

- **Combos automáticos** (tabla `product_combos`): UI para crear packs con descuento, generador IA sugiere combos que se venden juntos.
- **Modo "Flash Sale"**: countdown global en catálogo público con producto destacado por X horas (ya existe `offer_expires_at`, falta UI de programación masiva).
- **Cupones por influencer**: cada influencer puede tener cupón propio en `coupons` (vincular `coupons.influencer_id`).
- **Banner promocional editable** en catálogo público (tabla `catalog_banners`: imagen, texto, link, fecha vigencia).

## Resumen técnico

**Migraciones SQL**:
- `influencers`, `influencer_sales`, `influencer_payouts`, `product_combos`, `story_templates`, `industry_presets`, `brand_knowledge`, `catalog_banners`.
- `sales.referral_code`, `coupons.influencer_id`, `influencer_exchanges.influencer_id`.
- Triggers: `on_sale_with_referral`, `update_influencer_tier`.
- Settings: agregar `default_cta_text`, `stock_dormido_days`, `max_overstock`, `max_ai_discount_percent`, `ai_tone`.

**Edge functions**:
- `ai-offer-recommender` (nueva).
- `ai-analysis` y `generate-description` (modificar para leer `brand_knowledge` y `settings.ai_tone`).

**Páginas/componentes**:
- `/influencers` (refactor de `/canjes` con tabs).
- `OfferRecommenderPanel` en `/marketing`.
- `ComboBuilder`, `BannerEditor`, `StoryTemplatesAdmin` en `/ajustes`.
- Refactor de `OnboardingPage` (sin RUBROS/COLORS hardcoded).
- Refactor de `InstagramStoryGenerator` (templates desde DB).

**Archivos estimados**: ~12 nuevos + 8 modificados + 1 migración grande.

## Pregunta antes de arrancar

Esto es una sesión de tamaño medio-grande. ¿Vamos con todo el plan o priorizamos?

**Opción A — Todo junto**: influencers pro + recomendador IA + limpieza de hardcodeos (sesión larga, ~20 archivos).

**Opción B — Por orden de impacto**:
1. Recomendador IA + combos (más impacto en ventas, rápido).
2. Influencers Pro (siguiente sesión).
3. Limpieza de hardcodeos (sesión final, riesgo bajo).

**Opción C — Empezar por hardcodeos**: limpieza primero para que el resto se construya sobre base flexible.

Decime cuál y arranco.