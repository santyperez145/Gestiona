# Estándar de experiencia competitiva

**Estado:** obligatorio. **Corte:** 2026-09-04.

Se aplica antes de cambiar una pantalla, tabla, modal, filtro, navegación,
dependencia o stack. Su objetivo es entregar trabajos completos y coherentes,
no acumular componentes.

## 1. Evidencia y traducción

- ✅ Verificado: fuente oficial, medición o prueba reproducible con fecha.
- 👁 Observado: inspección visual/flujo que puede cambiar.
- 📌 Decisión Nerqia: elección propia y su trade-off.
- ❓ Hipótesis: necesita validación; no se presenta como hecho.

### Traducción, no copia

Una referencia aporta anatomía, jerarquía, estados o expectativa. Nerqia la
traduce a su dominio, marca, datos y usuarios. No copia assets, textos,
componentes, navegación ni trade dress.

Antes de afirmar que un competidor tiene o no tiene algo:

1. consultar fuente oficial vigente;
2. registrar URL y fecha;
3. separar capacidad publicada de comportamiento observado;
4. describir el trabajo del usuario, no el nombre comercial;
5. decidir qué paridad, ventaja o exclusión corresponde.

## 2. Resultado de producto

Una pantalla existe para completar un trabajo. Debe declarar:

- actor, contexto y permiso;
- entrada y resultado observable;
- autoridad de datos;
- camino principal, reversa y recuperación;
- métrica de éxito;
- comportamiento mobile, teclado y lector;
- impacto de seguridad, privacidad y fraude.

No se crea una ruta si el trabajo ya vive en otra. Tabs separan vistas del
mismo trabajo; filtros reducen una población; un detalle amplía una entidad.

## 3. Gramática compartida

- Canvas claro, superficies blancas y separación sobria.
- Color de acción Nerqia; colores semánticos para estado, riesgo o canal.
- Tipografía compacta en workspaces y escala hero sólo en landing.
- Íconos Lucide; tooltips para acciones no obvias.
- Tabs para vistas, segmented control para modos, switch para binarios,
  input/stepper para números y menú/select para opciones.
- Radio de cards de 8 px o el token compartido; sin cards anidadas.
- Tablas y colas densas, escaneables y con dimensiones estables.
- Contexto persistente en URL o storage versionado.
- Nada se recarga automáticamente para “actualizar”.

## 4. Anatomía universal de una pantalla

1. Shell y orientación de superficie.
2. Breadcrumb sólo cuando aporta jerarquía real.
3. `PageHeader`: título, descripción breve, estado y acción primaria.
4. Selector persistente de organización, tienda, ubicación o período.
5. Tabs de vistas reales.
6. Búsqueda, filtros, columnas y bulk cuando hay una población.
7. Contenido según arquetipo.
8. Detalle sin perder el contexto.
9. Estado y recuperación explícitos.

Una pantalla larga se divide por trabajo, no por decoración. La información
secundaria se mueve a tabs, accordion o panel contextual sólo si conserva
descubribilidad y URL.

## 5. Arquetipos de pantalla

| Arquetipo | Obligatorio |
|---|---|
| Índice | Búsqueda, filtros, vistas, columnas, paginación/virtualización, bulk y detalle. |
| Cola | Estado, prioridad/SLA, responsable, próxima acción, error y retry. |
| Ficha 360 | Identidad, estado, hechos, relaciones, actividad y acciones auditables. |
| Dashboard | Período, fuente, comparación, drill-down, parcialidad y acción. |
| Formulario | Secciones, validación inline, dirty state, permisos y confirmación. |
| Wizard/importador | Origen, preview, mapeo, validación, progreso, resultado y rollback. |
| POS | Viewport estable, teclado/touch, stock, pago, offline y ticket. |
| Storefront | Producto real, variantes, confianza, entrega, pago y recuperación. |
| Revisión documental | Original, extracción, confianza, match, decisión y auditoría. |

No usar un dashboard como depósito de links ni una grilla de cards para
reemplazar una tabla operativa.

## 6. Overlays: modal, sheet, drawer, popover y feedback

| Patrón | Uso |
|---|---|
| Dialog | Decisión focal, corta y bloqueante. |
| Alert dialog | Acción destructiva o irreversible. |
| Sheet/drawer | Detalle o edición que conserva la población detrás. |
| Popover | Ayuda o selección breve, anclada a un control. |
| Toast | Confirmación no bloqueante; nunca único lugar del error. |
| Inline alert | Estado persistente que requiere comprensión o acción. |

Un overlay debe tener título accesible, foco inicial correcto, escape/cierre,
retorno de foco, submit único, loading estable y error recuperable. En móvil,
preferir sheet cuando un dialog no conserva espacio suficiente.

## 7. Vistas, filtros, segmentos, cohortes y colas

| Concepto | Significado |
|---|---|
| Filtro | Condición temporal sobre la población actual. |
| Vista guardada | Filtros, orden y columnas reutilizables. |
| Segmento | Membresía calculada por reglas de negocio. |
| Cohorte | Grupo fijado por evento/período para comparar comportamiento. |
| Cola | Trabajo pendiente ordenado por prioridad, SLA o riesgo. |

- Los filtros visibles sobreviven refresh y navegación.
- “Limpiar” restablece el contrato, no sólo borra inputs.
- Una vista guardada tiene dueño, nombre y definición.
- Un segmento no copia clientes; guarda reglas.
- Una cola muestra por qué algo está ahí y cuál es la próxima acción.
- Tabs no sustituyen filtros ni crean rutas duplicadas.

## 8. Tablas, formularios y acciones

Tablas:

- encabezado estable, orden explícito y unidad visible;
- skeleton con mismas columnas;
- selección y bulk con alcance claro;
- menú por fila para acciones secundarias;
- paginación server-side o virtualización cuando corresponde;
- responsive que conserva la decisión, no todas las columnas.

Formularios:

- label persistente y ayuda sólo donde reduce error;
- defaults seguros, nunca inventar rubro, categoría, impuesto o costo;
- validación por campo y resumen al enviar;
- guardar deshabilitado mientras no haya cambio o envío en curso;
- cambio de contexto con dirty state;
- acción destructiva separada.

Acciones:

- servidor vuelve a validar rol, tenant, estado e importe;
- doble clic no duplica;
- éxito actualiza caché sin recarga;
- error conserva entrada y ofrece retry seguro;
- efectos financieros muestran actor, motivo y resultado.

## 9. Estados completos y recuperación

Toda vista cubre los que apliquen:

1. Loading inicial con dimensiones estables.
2. Refresh sin vaciar datos previos.
3. Empty inicial con acción relevante.
4. Empty-filtered con resumen y “limpiar”.
5. Error con causa útil, correlación y retry.
6. Offline/Stale con última actualización.
7. Permission con explicación y salida segura.
8. Partial cuando una fuente falló; nunca mostrarlo como cero.
9. Success accesible y no sólo por color.
10. Dirty state antes de perder cambios.
11. Rate limited/degraded con espera y alternativa.
12. Conflict cuando cambió la entidad en paralelo.

## 10. Accesibilidad y responsive

- Objetivo WCAG 2.2 AA.
- Recorrido completo por teclado y foco visible.
- Nombre accesible para icon buttons.
- Contraste, zoom 200%, lector y `prefers-reduced-motion`.
- Acciones táctiles de 40–44 px.
- Sin solapamientos ni scroll horizontal accidental.
- Validar 360, 390, 768, 1024, 1280×720 y 1440 px.
- Textos largos, montos grandes, listas vacías y errores reales.

Playwright + Axe cubren automatizable; la revisión manual cubre orden de foco,
comprensión, feedback y gesto.

## 11. Rendimiento y persistencia

- Rutas privadas y vendors pesados son lazy.
- Landing/storefront no descargan Finance o el admin.
- Evitar refetch periódico sin señal; usar invalidación por evento/acción.
- Cancelar o ignorar respuestas viejas al cambiar contexto.
- Imágenes comprimidas, responsivas y con tamaño reservado.
- Presupuestos de campo: LCP ≤ 2,5 s, INP ≤ 200 ms y CLS ≤ 0,1 en percentil 75.
- Una actualización PWA se ofrece, no se fuerza.
- Medir peso inicial, requests, caché, errores y Core Web Vitals.

## 12. Seguridad de experiencia

- No exponer existencia de tenants, emails, costos, tokens o estados internos en
  mensajes públicos.
- Confirmar identidad y reautenticar operaciones sensibles.
- Enlaces externos seguros y URLs generadas/validadas por servidor.
- Uploads con tipo/tamaño real, cuarentena y nombre no confiable.
- Formularios públicos con rate limit, anti-replay y protección de abuso.
- Estados de pago salen del servidor; nunca del query string.
- Acciones de Platform y Finance muestran alcance y dejan auditoría.
- Diseñar contra phishing: dominio/merchant visibles y confirmación de cambios
  de cobro o beneficiario.

## 13. Tecnología

### Base aprobada al 2026-08-22

React 18, TypeScript, React Router, Vite, TanStack Query, Tailwind, Radix,
Lucide, Supabase/PostgreSQL, Vitest y Playwright. Recharts, jsPDF y SheetJS se
cargan sólo en rutas que los necesitan.

### Puerta para una dependencia nueva

Puntuar de 0 a 10 y multiplicar:

| Criterio | Peso |
|---|---:|
| Gap funcional real | 3 |
| Accesibilidad y UX | 2 |
| Seguridad/supply chain | 2 |
| Rendimiento | 1 |
| Mantenimiento/comunidad | 1 |
| Costo de salida | 1 |

**Umbral: 80/100.** Además debe existir benchmark, prueba mínima, owner,
rollback y criterio de éxito. “La usa una empresa grande” no es evaluación.

**Rewrite a otro framework/meta-framework:** sólo con medición que pruebe que
el stack actual impide un SLO, SEO, aislamiento o velocidad de equipo
necesarios. Reescribir por moda queda rechazado.

## 14. Referentes por dominio

- Commerce: Shopify, Tiendanube y Empretienda.
- Canal/pago local: Mercado Libre + Mercado Pago.
- Gestión argentina: Contabilium, Xubio y Colppy.
- Finance regional: Mendel, Clara Global, Rindegastos y SAP Concur Argentina.

Fuentes y fecha: [ESTRATEGIA.md](ESTRATEGIA.md).

📌 **Límite Finance:** Mendel define paridad de trabajo, no un permiso para
copiar su interfaz ni crear otro Core.

📌 **Paridad local obligatoria:** impuestos, moneda, medios de pago, privacidad,
arrepentimiento y lenguaje argentino se validan antes de declarar una capacidad.

Emitir tarjetas o mover dinero exige demanda, partner, legal, riesgo, soporte y
economics. Mientras tanto se integran tarjetas externas y controles de gasto
sobre el mismo Business Graph.

## 15. Definition of Done

Una experiencia se cierra cuando:

1. completa el trabajo y su reversa;
2. usa autoridad y permiso correctos;
3. cubre estados de la sección 9;
4. no duplica ruta, componente ni cálculo;
5. pasa teclado, responsive y contraste;
6. no agrega errores de consola, recargas ni requests innecesarios;
7. tiene tests proporcionales al riesgo;
8. fue inspeccionada con datos reales o fixture reversible;
9. mide el resultado;
10. queda documentada y publicada.
