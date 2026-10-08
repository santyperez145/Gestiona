# Nerqia Intelligence — control plane operativo

**Estado:** arquitectura aprobada; búsqueda asistida de imágenes y prueba segura
de automatizaciones implementadas. **Revisión de límites:** 2026-10-01. **Owner:** CTO.

## 1. Resultado

Nerqia Intelligence convierte señales del Commerce OS en acciones seguras:
detecta una excepción, explica impacto, propone una acción, obtiene la
aprobación necesaria, ejecuta mediante un contrato tipado y verifica el
resultado. No será otro Core, un chatbot con acceso libre a la base ni una
promesa de autonomía sin controles.

Se inspira en el patrón de asistente administrativo de Shopify Sidekick y en
la operación financiera orientada a políticas de Mendel, pero conserva una
ventaja propia: catálogo, venta, stock, cobro, costo, gasto y margen comparten
el Business Graph de Nerqia.

## 2. Dos superficies, una infraestructura

- **Intelligence Core (por organización):** catálogo, ventas, stock, clientes,
  campañas, tienda y Finance. El tenant se deriva de la sesión y de membresías
  server-side; nunca de texto libre enviado por el navegador.
- **Intelligence Platform (staff):** salud de proveedores, fallos recurrentes,
  churn, soporte consentido y economics agregados. No hereda acceso al contenido
  de una organización ni puede mover dinero por ser staff.

Comparten gateway, registro de herramientas, motor de políticas, cola de jobs,
presupuesto de inferencia, trazas y evaluaciones. Sus permisos y datasets son
distintos.

Growth y Profit consumen este mismo gateway/runtime, registro de herramientas,
bus de eventos y políticas. No construyen otro engine de CRM ni agentes con
SQL libre. MCP reutiliza contratos tipados, tenant/scopes, presupuestos y trazas;
primero lectura. [ADR 004](ADR_004_GROWTH_PROFIT_SHARED_GRAPH.md).

## 3. Arquitectura objetivo

1. **Signal layer:** eventos del outbox, snapshots de KPIs y documentos
   normalizados; nada consulta tablas arbitrarias desde un prompt.
2. **Planner:** modelos intercambiables generan un plan estructurado contra un
   catálogo de herramientas versionado.
3. **Policy engine:** valida tenant, rol, entitlement, costo, sensibilidad,
   horario, límites y aprobación.
4. **Execution plane:** funciones/RPC idempotentes ejecutan una sola acción;
   ningún modelo recibe claves de proveedor.
5. **Verifier:** relee la fuente de verdad y compara resultado esperado/real.
6. **Audit:** conserva actor, modelo, prompt/versiones, inputs minimizados,
   herramienta, aprobación, costo, resultado y correlación.

Estados canónicos: `detected → proposed → awaiting_approval → executing →
verified`, con `rejected`, `failed`, `unknown` y `rolled_back`. Un timeout de
una escritura externa queda `unknown`; no se reintenta ni cambia de proveedor
sin garantía de no ejecución.

## 4. Matriz de autonomía

| Riesgo | Ejemplos | Política |
|---|---|---|
| Lectura | explicar caída de conversión, buscar faltantes | automática y auditada |
| Reversible bajo | crear borrador, etiqueta o tarea | automática con undo |
| Comercial | cambiar precio, publicar producto, enviar campaña | propuesta + aprobación del rol autorizado |
| Financiero/legal | pagar, devolver, facturar, cambiar política o permisos | aprobación reforzada; MFA cuando corresponda |
| Prohibido | inventar acreditación, custodiar fondos, eludir homologación | nunca disponible como herramienta |

Cada organización tendrá kill switch, tope diario/mensual, ventanas horarias y
modo `solo sugerencias`. Las automatizaciones empiezan en shadow mode y sólo
suben de autonomía con precisión, aceptación, reversión y ahorro medidos.

### Prueba segura antes de autonomía

Como Shopify Flow, Nerqia permite evaluar una regla con datos reales sin
ejecutar su acción. El servidor valida tenant, flujo y `marketing.edit`, permite
probar reglas pausadas, devuelve sólo cantidad y cinco ejemplos, y corta antes
de enviar mensajes, crear registros, escribir historial o actualizar la última
ejecución. Los flujos creados manualmente o desde plantilla nacen pausados.

La primera acción operativa endurecida es reposición: agrupa coincidencias por
proveedor y moneda, crea orden e ítems en una sola transacción y registra una
clave diaria por flujo. Un retry devuelve el recurso previo sin duplicarlo. Las
reglas de deuda usan saldo pendiente y las tareas respetan prioridad/vencimiento
del editor; fallos de lectura o escritura dejan de informarse como éxito.

La IA futura podrá proponer disparador, condiciones y acciones como borrador,
siguiendo el patrón de HubSpot, pero no recibirá permisos de escritura. Igual que
la separación Manager/Worker de Odoo, el modelo decide sobre herramientas
permitidas y el ejecutor determinístico conserva reglas, autorización y efectos.

## 5. Primeros agentes de producto

Las entradas siguientes son casos de producto, no agentes autónomos certificados.
Con Profit Foundation, Margin Guardian e Inventory Planner se evalúan en shadow
mode sobre hechos/cobertura actuales; Growth recibe propuestas sólo después de
consolidar CRM. Una observación antes/después no demuestra impacto causal.

1. **Catalog Steward:** identidad SKU/GTIN, duplicados, atributos, imágenes,
   publicación y SEO.
2. **Sales Operator:** oportunidades, carritos abandonados, pedidos trabados y
   follow-up aprobado.
3. **Inventory Planner:** quiebres, exceso, transferencia y compra sugerida con
   lead time real.
4. **Margin Guardian:** margen por orden, comisión, envío, promoción, devolución
   e impuestos; alerta antes de vender a pérdida.
5. **Finance Controller:** documento, política, aprobación, anomalía,
   conciliación y vencimiento; sin emitir tarjetas ni mover fondos sin partner.
6. **Merchant Copilot:** interfaz conversacional sobre esas herramientas, no
   una segunda implementación de las funciones.

## 6. Imágenes de producto

La jerarquía de proveedores evita elegir una foto visualmente atractiva pero
incorrecta:

1. imagen del conector de origen (Shopify, Tiendanube, ERP/CRM);
2. catálogo oficial por GTIN/EAN/MPN y marca, empezando por Icecat cuando haya
   contrato y credenciales;
3. feed autorizado de proveedor/marca;
4. búsqueda de contenido con licencia comercial (Openverse) con revisión;
5. carga manual, pegado o cámara, siempre disponibles.

La ficha busca en Openverse con sesión, membership owner/admin y permisos
`products.view` + `create`/`edit`. Ordena por tokens de nombre, marca y modelo;
son señales, nunca certeza ni porcentaje de precisión. Excluye watermark,
contenido maduro y fuentes no descargables. La copia actual admite sólo CC0/PDM
desde Wikimedia/Flickr permitidos: las demás licencias requieren completar
atribución pública antes de habilitarlas. Openverse no garantiza la licencia;
la persona revisa identidad/variante y derechos en la fuente, y confirma ambas.

`search-product-images` conserva una autoridad para búsqueda y adquisición:
recibe ID, no URL/licencia del cliente, relee metadata del proveedor y valida
cada redirect, HTTPS, tipo, firma, tamaño (4 MiB), dimensión (4 MP) y presupuesto
de lectura. ImageMagick WASM 0.0.44 decodifica, orienta, quita metadata y genera
WebP de hasta 1600 px. `catalog_image_sources` conserva fuente, licencia, actor,
fecha, hash y procesamiento; RLS limita lectura al catálogo de la organización
y sólo el servidor escribe. Paths `/catalog/` son inmutables para el navegador.
Dos selecciones concurrentes reutilizan el mismo hash y compensan la copia
sobrante; un error nunca se anuncia como producto actualizado. La ficha agrega
la copia propia únicamente tras éxito y publica sólo al guardar el producto.

Nombre/marca/org/sesión/cierre invalidan resultados y adquisiciones pendientes.
No se sigue un redirect arbitrario ni se conservan URLs externas en selecciones
nuevas. Los assets son reutilizables; cerrar sin guardar no los publica. Faltan
retención/limpieza de assets no referenciados, revisión pública de procedencia,
feeds autorizados y benchmark de identidad. No se corrigieron automáticamente
las URLs legacy ni se importó la planilla de otro negocio. El límite por usuario
y por IP es por instancia; no certifica un presupuesto distribuido de jobs.

### Bulk para 10.000 productos

El pipeline objetivo es asíncrono y reanudable:

`identify → source lookup → candidate ranking → rights check → image QA →
human review by exception → copy to Nerqia Storage → publish`.

Cada candidato conservará proveedor, URL fuente, GTIN/MPN, licencia,
atribución, hash perceptual, dimensiones, score y decisión. No se hotlinkea en
el estado final; se valida MIME/tamaño, se elimina metadata sensible, se crean
derivados WebP/AVIF y se mantiene el original. La importación masiva sólo
autoaceptará coincidencias exactas de fuente autorizada y umbral calibrado;
todo lo demás va a cola.

Google Custom Search no es una base candidata: está cerrado a clientes nuevos
y su producto actual finaliza para clientes existentes el 1 de enero de 2027.
No se hará scraping de Google Imágenes, marketplaces ni sitios de terceros.

## 7. Fases y gates

| Fase | Entrega | Gate |
|---|---|---|
| I0 | contratos, matriz de riesgo, observabilidad y eval dataset | cero acceso libre a DB/proveedores |
| I1 | Catalog Steward + búsqueda manual de imágenes | precisión y revisión visibles |
| I2 | jobs bulk, Icecat/feed de proveedor, storage y provenance | lote real, pausa/reanuda, rollback |
| I3 | Sales/Inventory/Margin en shadow mode | impacto medido sin escrituras autónomas |
| I4 | acciones reversibles con aprobación | idempotencia, verificación y kill switch |
| I5 | Finance Controller limitado | partner, legal, seguridad y evidencia externa |

KPIs: tiempo ahorrado, aceptación de propuestas, precisión, correcciones,
incidentes, costo por acción útil, productos publicables y margen protegido.
“Cantidad de prompts” no es un KPI de producto.

## 8. Pendientes inmediatos

**Carga asistida, 2026-10-08:** el autocompletado descarta respuestas tardías,
aisla caché por usuario/sesión/org/categorías y limita tiempo/tamaño de respuesta.
No propone ni aplica precios estimados; categoría/marca/descripción se aplican
sólo tras revisión, sin pisar campos ya completos. Errores permiten reintentar
o continuar manualmente. Esto no prueba precisión de un modelo ni reemplaza
la fuente del fabricante: fotos exactas, descripción completa, atributos,
SEO y duplicados masivos siguen el pipeline I2 con procedencia, presupuesto,
checkpoint y aprobación. Nunca inventar stock, costo, impuesto, certificados
o prestaciones del producto. Datos fiscales no pasan al modelo del catálogo.
El servidor arma el prompt de `catalog-suggestion`, exige ver/crear productos
y consulta sólo categorías propias; no carga ventas, clientes ni Finance.
El chat general exige rol administrativo y Analytics, verifica cada fuente
y el acceso a Finance; usa JWT/RLS, no service-role para obtener contexto.
Las muestras limitadas no se presentan como totales completos. Categorías y
slugs descartan respuestas de otro negocio y muestran errores recuperables.
Sin beneficio IA o con cupo agotado no se dispara autocompletado; el servidor
revalida el beneficio y el consumo. La carga manual no se restringe.

- ampliar procedencia/atribución a todas las fuentes autorizadas y licencias;
- agregar GTIN/MPN como claves de matching y conector Icecat detrás de flag;
- job bulk con presupuesto, checkpoint, retry y cola de excepciones;
- definir tool schemas y tablas de runs/steps/approvals;
- evals multi-tenant, prompt injection, fuga de datos y acciones de alto riesgo;
- modelo/hosting con política de datos compatible antes de habilitar contenido
  de clientes en producción.

## Referencias oficiales

- [Shopify Sidekick](https://help.shopify.com/en/manual/ai-powered-tools/sidekick)
- [Shopify Flow — probar un workflow sin efectos](https://help.shopify.com/en/manual/shopify-flow/manage/test-workflow)
- [HubSpot — workflows con IA, plantillas o desde cero](https://knowledge.hubspot.com/workflows/create-workflows)
- [Odoo — AI Manager separado de herramientas ejecutoras](https://www.odoo.com/documentation/19.0/applications/productivity/ai/server-actions.html)
- [Openverse API client y búsqueda](https://docs.openverse.org/packages/js/api_client/index.html)
- [Advertencia de licencia de Openverse](https://docs.openverse.org/_preview/4707/api/reference/made_with_ov.html)
- [Openverse API, búsqueda y detalle por ID](https://api.openverse.org/v1/)
- [ImageMagick WASM en Supabase Edge](https://supabase.com/docs/guides/functions/examples/image-manipulation)
- [Icecat para datos de producto](https://icecat.com/integrations/)
- [GS1 Product Image Specification](https://ref.gs1.org/standards/product-image-specification/3.7.0/)
- [Cierre de Google Custom Search JSON API](https://developers.google.com/custom-search/v1/overview)
