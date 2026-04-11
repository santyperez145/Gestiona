

# Plan Actualizado: Máquina de Ventas — Decants con IA, Precios Mayoristas Rentables

## Cambios respecto al plan anterior

1. **Descripciones generadas por IA** (no hardcodeadas): Usar Lovable AI (edge function) para generar descripciones de perfumes basadas en nombre, marca, categoría y género. Botón "Auto-generar" en ProductsPage que llama a la edge function.
2. **Márgenes de decants realistas**: Basados en el mercado argentino de decants (margen típico 200-400% sobre costo proporcional). Valores por defecto: 10ml = 250%, 5ml = 350%, 2.5ml = 500%. Configurables en Settings.
3. **Precio mayorista sobre precio con descuento**: El descuento mayorista se aplica sobre el `discount_price_ars` (precio efectivo/oferta), no sobre el precio de lista. Con un piso de rentabilidad: nunca menor al costo total + 20%.

---

## Parte 1: Migración SQL

Nuevos campos en `settings`:
```sql
volume_discount_threshold integer DEFAULT 3
volume_discount_percent numeric DEFAULT 10
decant_margin_10ml numeric DEFAULT 250
decant_margin_5ml numeric DEFAULT 350
decant_margin_2_5ml numeric DEFAULT 500
```

Nuevos campos en `products`:
```sql
content_ml integer DEFAULT 100
total_sold integer DEFAULT 0
```

Actualizar vista `products_public` para incluir `content_ml` y `total_sold`.

## Parte 2: Edge Function para descripciones con IA

**Archivo:** `supabase/functions/generate-description/index.ts`

- Recibe `{ name, brand, category, gender }` 
- Usa Lovable AI (gemini-3-flash-preview) con prompt: "Genera una descripción de venta para este perfume árabe: {name} de {brand}. Incluye notas olfativas probables, duración estimada, proyección y situaciones de uso recomendadas (citas, salir, diario). En español, máximo 3 oraciones, tono persuasivo de venta."
- Retorna `{ description: string }`

**En ProductsPage:** Botón "Generar descripción con IA" en el formulario de producto. Botón masivo "Auto-generar todas las descripciones faltantes" en la toolbar.

## Parte 3: Sistema de Decants

**En SettingsPage:** Nueva sección "Decants" con 3 campos de margen configurables:
- 10ml: 250% (default) — precio típico de mercado
- 5ml: 350%
- 2.5ml: 500%

**Fórmula:**
```
costo_proporcional = (total_cost_usd / content_ml) * ml_decant
precio_decant_ARS = costo_proporcional * exchange_rate * (1 + margen%)
```

**En PublicCatalogPage:** Para perfumes con content_ml > 0, mostrar tabs "Completo | 10ml | 5ml | 2.5ml" con precio calculado.

**En SalesPage:** Selector de tamaño al vender un perfume.

## Parte 4: Descuento Mayorista (sobre precio con descuento)

**Lógica:**
```
precio_base = discount_price_ars || sale_price_ars  // precio efectivo
precio_mayorista = precio_base * (1 - volume_discount_percent/100)
piso_minimo = total_cost_usd * exchange_rate * 1.20  // mínimo 20% ganancia
precio_final = Math.max(precio_mayorista, piso_minimo)
```

**En SalesPage:** Cuando qty >= threshold, aplicar automáticamente y mostrar badge "Precio mayorista -X%". Si el descuento bajaría por debajo del piso, mostrar warning.

**En PublicCatalogPage:** Texto "Llevá {X}+ y obtené {Y}% off sobre precio efectivo".

## Parte 5: Catálogo — Conversión Agresiva

Todo lo del plan anterior (secciones destacados, más vendidos, cross-sell vaper→perfume, escasez, countdown, compartir, animaciones) se mantiene igual.

## Parte 6: Dashboard + Admin

Ranking de margen, alertas, toggle featured, venta rápida — se mantiene igual del plan anterior.

---

## Archivos a modificar/crear

| Archivo | Cambio |
|---|---|
| Migración SQL | Campos en settings y products, actualizar vista |
| `supabase/functions/generate-description/index.ts` | **Nuevo** — IA para descripciones |
| `src/pages/SettingsPage.tsx` | Config decants margins + mayorista |
| `src/pages/ProductsPage.tsx` | Botón generar descripción IA, content_ml, featured |
| `src/pages/SalesPage.tsx` | Selector decant, descuento mayorista con piso, fix fecha, combobox clientes |
| `src/pages/PurchasesPage.tsx` | Fix fecha |
| `src/pages/DebtsPage.tsx` | Fix fecha |
| `src/pages/PublicCatalogPage.tsx` | Secciones, decants, precios psicológicos, cross-sell, animaciones |
| `src/pages/Dashboard.tsx` | Ranking margen, sparklines |
| `src/components/AppLayout.tsx` | Badge notificaciones |
| `src/lib/supabaseStore.ts` | Helpers decants + mayorista |

## Orden de implementación
1. Migración SQL
2. Edge function IA para descripciones
3. Settings: config decants + mayorista
4. Fix fechas en todas las páginas
5. Products: content_ml, generar descripciones IA, featured
6. Sales: combobox clientes, selector decant, descuento mayorista
7. Catálogo público: reestructura completa
8. Dashboard: ranking + alertas
9. Sidebar: badge notificaciones

