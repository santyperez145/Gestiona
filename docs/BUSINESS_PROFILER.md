# Business Profiler

**Corte:** 2026-08-22

**Estado:** infraestructura productiva; adopción externa todavía no medida.

## Qué problema resuelve

Un comercio nuevo no debería recibir un catálogo vacío ni necesitar que
Gestiona programe una variante del producto para su rubro. El Business Profiler
convierte la elección de industria en tipos y atributos útiles sobre el mismo
Business Core.

No crea tablas por vertical. Productos, variantes, stock, costos, precios,
órdenes y clientes conservan sus autoridades actuales. El perfil sólo prepara
metadatos editables para describir y filtrar productos.

## Perfiles declarados

| Rubro | Tipos iniciales | Atributos principales |
|---|---|---|
| Perfumes | Perfume | marca, contenido, concentración, familia olfativa |
| Vapers | Dispositivo, E-liquid | marca/modelo/color y sabor/nicotina/contenido |
| Indumentaria | Prenda | marca, material, temporada, género |
| Tecnología | Tecnología | marca, modelo, garantía, conectividad |
| Cosmética | Cosmético | marca, contenido, tipo de piel, cruelty free |
| Alimentos | Alimento | marca, peso, conservación, aptitud |
| Otro | Producto | marca, modelo o línea |
| **Servicios** | Servicio *(no lleva stock)* | duración, modalidad, a cargo de |
| **Gastronomía** | Plato *(no lleva stock)*, Insumo | sección de carta, apto para, porciones / unidad de compra, conservación |

⚠️ **Gastronomía tiene DOS tipos a propósito, y ahí está el punto: un
restaurante no es un negocio sin stock.** El plato no se descuenta —se
prepara— pero la harina, la bebida y el descartable sí. Un rubro que marcara
todo como «sin stock» le rompería el inventario al día siguiente.

📌 **Por qué dos rubros y no los once que enumera la auditoría.** Se agregaron
los que hoy no se podían operar de ninguna forma, porque el Core descontaba
stock de algo que no lo tiene. Mayorista, ecommerce y retail ya funcionan con
los rubros de catálogo: no son un rubro distinto, son la misma mercadería
vendida por otro canal. Turnos, proyectos, alquileres y suscripciones
necesitan entidades que hoy no existen —una agenda, un contrato, un plazo—, así
que un preset suyo sería una promesa vacía.

Talle y color con stock propio continúan como variantes. Lotes y vencimientos
continúan en trazabilidad de inventario. El perfil no duplica esas funciones.

## Contrato y autoridad

- `industry_presets.product_type_templates` contiene JSON declarativo y
  versionado; el cliente sólo lo interpreta para mostrar una vista previa.
- `configure_business_profile` vuelve a validar y aplica el preset en el
  servidor. Sólo `owner` o `admin` puede ejecutarlo.
- `product_types.source` distingue `custom` de `business_profile`. Si el equipo
  ya creó el mismo slug, el RPC devuelve `skipped_custom`: no lo sobreescribe ni
  le agrega atributos.
- Repetir el RPC no duplica tipos ni atributos. Cambiar de rubro no borra la
  estructura anterior ni reasigna productos existentes.
- `organization_business_profiles` guarda versión y resultado aplicado. Los
  miembros pueden leerlo por RLS; no pueden escribirlo directamente.
- `complete_business_onboarding` valida nombre, color, objetivo y perfil, y
  actualiza organización + ajustes en una sola transacción. Así no existe un
  onboarding a medio guardar.

## Experiencia

Durante onboarding se explica antes de confirmar qué tipos y atributos se van a
crear. En Productos → Tipos y atributos, owner/admin puede aplicar o cambiar el
perfil. La pantalla muestra el perfil vigente, la versión y una vista previa;
los tipos sugeridos llevan el badge `Perfil` y siguen siendo editables.

Si falla la carga opcional de datos demo, la configuración transaccional se
conserva y la UI lo reporta como advertencia. Un servicio accesorio ya no hace
parecer que todo el onboarding falló.

## Verificación

~~~bash
npx supabase db query --linked --file supabase/verificaciones/20260822_business_profiler.sql
npx supabase db push --linked --dry-run
~~~

La prueba del 2026-08-22 usó un owner/admin real y una subtransacción con
rollback deliberado:

- primera aplicación: 1 tipo y 4 atributos;
- mismo retry: 0 tipos y 0 atributos nuevos;
- colisión con tipo propio: preservada y reportada;
- organización y ajustes: visibles juntos tras completar onboarding;
- usuario externo: bloqueado;
- restos de tipos, atributos, perfil y nombre `ZZ`: 0.

Línea de base después del rollback: 7 perfiles activos, 8 tipos y 28 atributos
declarados; 0 organizaciones configuradas y 0 tipos reales. Es capacidad
disponible, no adopción. La próxima evidencia válida es un segundo comercio que
elija un perfil, importe su catálogo y venda sin SQL ni cambios de esquema.

## Comparación de producto

Los presets por rubro son paridad esperable frente a productos verticales y
ERPs configurables. El diferencial que Gestiona debe demostrar no es la lista
de campos: es que la adaptación es declarativa, idempotente y no destructiva
sobre el mismo stock, costo, orden, cliente y margen omnicanal. Hasta que otro
merchant lo use de punta a punta, esa ventaja es una hipótesis arquitectónica,
no tracción.
