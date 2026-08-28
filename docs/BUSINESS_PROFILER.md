# Business Profiler

**Corte:** 2026-08-28

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
  servidor, pero ahora es una autoridad interna: el navegador no puede saltar
  la orquestación.
- `product_types.source` distingue `custom` de `business_profile`. Si el equipo
  ya creó el mismo slug, el RPC devuelve `skipped_custom`: no lo sobreescribe ni
  le agrega atributos.
- Repetir el RPC no duplica tipos ni atributos. Cambiar de rubro no borra la
  estructura anterior ni reasigna productos existentes.
- `organization_business_profiles` guarda versión y resultado aplicado. Los
  miembros pueden leerlo por RLS; no pueden escribirlo directamente.
- `business_blueprint_preview` calcula el estado deseado, el SHA-256 y el diff
  sin escribir. Owner/admin puede revisar qué falta antes de confirmar.
- `provision_business_blueprint` coordina perfil/settings, permisos por rol,
  capabilities base, ubicación principal y pipeline CRM. Cada ejecución tiene
  key idempotente, progreso y checklist de cinco pasos.
- `complete_business_onboarding` entra por el mismo Blueprint y luego valida
  nombre, color y objetivo. Así onboarding y reconfiguración no divergen.

## Fallos y recuperación

Los cinco pasos se ejecutan dentro de una subtransacción de PostgreSQL. Si uno
falla, se revierten también los anteriores: no queda settings actualizado con
permisos o pipeline a medio crear. Afuera de ese rollback se conserva la
corrida fallida y el checklist indica qué se compensó, qué falló y qué se
omitió. Reintentar la misma key continúa la misma corrida; repetir una corrida
exitosa devuelve replay y no vuelve a mutar el negocio.

Las tablas `organization_blueprints`, `provisioning_runs` y
`provisioning_steps` son legibles por miembros vía RLS pero no admiten escritura
directa desde el navegador.

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
npx supabase db query --linked --file supabase/verificaciones/20260828_business_blueprint.sql
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

La prueba de Blueprint del 2026-08-28 agregó una falla controlada en el paso 4:
los tres pasos previos quedaron compensados, el dominio quedó vacío, el retry
2 terminó los cinco pasos y el replay conservó un solo run. Produjo 60+
permisos, una ubicación, seis etapas CRM y dos capabilities base, con outsider
bloqueado y 0 restos.

Línea de base después del rollback: 9 perfiles activos y 0 blueprints/runs/
steps reales. Es capacidad disponible, no adopción. La próxima evidencia válida
es un segundo comercio que elija un perfil, importe su catálogo y venda sin SQL
ni cambios de esquema.

## Comparación de producto

Los presets por rubro son paridad esperable frente a productos verticales y
ERPs configurables. El diferencial que Gestiona debe demostrar no es la lista
de campos: es que la adaptación es declarativa, idempotente y no destructiva
sobre el mismo stock, costo, orden, cliente y margen omnicanal. Hasta que otro
merchant lo use de punta a punta, esa ventaja es una hipótesis arquitectónica,
no tracción.
