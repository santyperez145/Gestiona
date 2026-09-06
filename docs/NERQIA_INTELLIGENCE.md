# Nerqia Intelligence — control plane operativo

**Estado:** arquitectura aprobada; primer slice (búsqueda asistida de imágenes)
implementado. **Corte:** 2026-09-05.

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

## 5. Primeros agentes de producto

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

El slice actual agrega búsqueda Openverse server-side desde la ficha, exige
usuario owner/admin, limita abuso, excluye resultados marcados con watermark y
no aplica nada automáticamente. La persona abre la fuente, verifica identidad
y licencia, y elige. Openverse advierte que sus datos de licencia pueden ser
inexactos; por eso no sirve como auto-fill masivo sin revisión.

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

- persistir procedencia/licencia y copiar imágenes elegidas a Storage;
- agregar GTIN/MPN como claves de matching y conector Icecat detrás de flag;
- job bulk con presupuesto, checkpoint, retry y cola de excepciones;
- definir tool schemas y tablas de runs/steps/approvals;
- evals multi-tenant, prompt injection, fuga de datos y acciones de alto riesgo;
- modelo/hosting con política de datos compatible antes de habilitar contenido
  de clientes en producción.

## Referencias oficiales

- [Shopify Sidekick](https://help.shopify.com/en/manual/ai-powered-tools/sidekick)
- [Openverse API client y búsqueda](https://docs.openverse.org/packages/js/api_client/index.html)
- [Advertencia de licencia de Openverse](https://docs.openverse.org/_preview/4707/api/reference/made_with_ov.html)
- [Icecat para datos de producto](https://icecat.com/integrations/)
- [GS1 Product Image Specification](https://ref.gs1.org/standards/product-image-specification/3.7.0/)
- [Cierre de Google Custom Search JSON API](https://developers.google.com/custom-search/v1/overview)
