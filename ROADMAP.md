# Roadmap de producto — Gestiona Cloud

**Corte:** 2026-08-21
**Estado:** roadmap integral nuevo. Define orden de inversión, puertas de salida
y evidencia; no es un catálogo de features ni promete fechas.

## 1. Norte de producto

Gestiona Cloud es el sistema operativo de un comercio omnicanal. Productos,
inventario, clientes, órdenes, costos, cobros, impuestos y margen son una única
verdad. POS, tienda, MercadoLibre, WhatsApp y los canales futuros son
interfaces de ese núcleo, no sistemas que vuelven a calcular sus propios datos.

La ambición es construir una plataforma conectada, no sumar secciones de ERP:

| Producto / superficie | Rol | Prioridad |
|---|---|---|
| **Gestiona Business** | Productos, stock, ventas, POS, clientes, compras y margen. | Actual: debe vender confiablemente. |
| **Gestiona Commerce** | Ventas online y canales sobre el Business Core. | Después de validar la base comercial. |
| **Gestiona Finance** | Comprobantes, gastos y cuentas por pagar convertidos en decisiones auditables. | MVP después de la puerta comercial. |
| **Gestiona Platform** | Organizaciones, integraciones, riesgo, soporte y economía de plataforma. | Sólo lo que destrabe comercios reales. |
| **Storefront** | Experiencia pública de compra aislada de datos privados. | Canal de Commerce, no el producto principal. |
| **Gestiona Intelligence** | Hallazgos que llevan a una acción y miden su resultado. | Cuando los datos operativos sean confiables. |
| **Pay, Ship, Developers y Apps** | Red, extensibilidad y servicios de plataforma. | Con tracción y condiciones regulatorias. |

La ventaja a demostrar no es ser un creador de tiendas más: es explicar y
mejorar el **margen real por canal**, reuniendo costo importado, comisión de
cobro, envío e impuestos. Finance añade una segunda ventaja: un comprobante se
captura una vez y se convierte en una compra, obligación, control o señal de
costo sin recarga manual.

## 2. Contratos de arquitectura y confianza

Cualquier iniciativa debe cumplir estas reglas; de lo contrario se rediseña o
queda congelada.

1. **Un Business Core.** Productos, variantes, stock, precios, clientes,
   movimientos, órdenes, pagos y costos existen una sola vez. Un canal o
   producto nuevo nunca crea su propio inventario, margen o cliente.
2. **Una identidad y una organización.** auth.users, organizations y
   memberships siguen compartidos. Finance podrá tener acceso y roles de
   producto, pero no usuarios, comercios, proveedores ni catálogos duplicados.
3. **Superficies separadas.** Organización (/), plataforma (/platform) y tienda
   pública (/tienda/:slug) mantienen chrome y permisos distintos. Finance será
   una superficie diferenciada sólo tras diseñar navegación, acceso y auditoría.
4. **El servidor es autoridad.** El navegador no escribe stock, precios,
   descuentos, totales ni secretos. Las transiciones de dinero e inventario se
   validan en la base.
5. **Documento no es asiento confirmado.** Finance puede crear borradores de
   compra o cuentas por pagar; sólo la revisión y el comando de dominio aprobado
   pueden afectar stock, deuda o contabilidad.
6. **IA limitada y auditable.** Puede clasificar, proponer y explicar; no
   insertar compras, pagar facturas, cambiar precios ni prometer a compradores.
   Toda recomendación tiene fuente, confianza, acción permitida y resultado.
7. **Seguridad y privacidad por defecto.** Credenciales por Edge Function,
   superficies públicas sin costos/márgenes/tokens, y compradores de tienda sin
   membresía accidental de una organización.
8. **Evidencia antes que marketing.** Una capacidad no se considera ventaja
   competitiva ni impacto de IA hasta guardar fuente, período, fórmula y
   resultado verificable.

## 3. Línea de base y bloqueos

Estado de referencia al **2026-08-21**. Los números se deben volver a medir
antes de reutilizarlos en producto, ventas o comunicación externa.

| Señal | Estado conocido |
|---|---|
| Núcleo | Productos, variantes, inventario por movimientos, ventas, POS, compras, clientes, tienda y canales comparten el Business Core. |
| Seguridad | Hay guardas de superficie pública y Edge Functions; las credenciales sensibles no se exponen al navegador. |
| Cobros | Checkout recalcula en servidor, sus transiciones son idempotentes y Checkout Brick admite pausa global o por organización con salida segura. |
| Plataforma | Existen Overview, registro de integraciones, Merchant 360, cola operativa sanitizada y activación por primera venta deduplicada por comercio. |
| Finance precursor | Existe OCR que prellena una orden de compra. Es un componente parcial: aún no prueba cadena de custodia, validación, duplicados, matching, aprobación ni borrador Finance. |
| Calidad técnica | 1.222 unit tests en este corte y las puertas typecheck, lint y build superadas; 63 Edge Functions pasan verificación de tipos. |
| Uso observado | 4 organizaciones, 1 comercio real, 34 registros POS, 6 online, 10 eventos de ledger, 0 asientos contables, 1 CAE de homologación, 0 CAE de producción y 2 pagos reales de prueba por ARS 1. Es una muestra, no product-market fit. |

La prioridad inmediata es comercial y de confianza: demostrar que se vende,
entrega, registra y explica el margen sin intervención técnica diaria.

### Bloqueos externos de F0

| Bloqueo | Riesgo que evita | Responsable |
|---|---|---|
| Certificado productivo ARCA y punto de venta Web Services | Homologación ya emitió un CAE; falta evidencia del ciclo productivo autorizado. | Dueño / responsable fiscal. |
| Razón social, CUIT, domicilio y publicación legal | No se publica una tienda legalmente incompleta. | Dueño del comercio. |
| Conteo físico y ajuste trazable | El antiguo doble movimiento dejó stock histórico no confiable. | Comercio. |
| Pesos, fotos, descripciones y tarifas | La cotización y conversión no representan la operación real. | Comercio, con carga asistida. |
| Contrato de correo y credenciales | La etiqueta por API no se puede validar contra operación real. | Comercio / transportista. |
| Cuenta comercial MercadoLibre | Publicar e importar órdenes reales requiere esa relación. | Comercio. |

Ningún bloqueo se marca resuelto con una pantalla o un dato de prueba: exige
fecha, responsable, evidencia y entorno usado.

## 4. Criterio de priorización

Cada slice pertenece a una fase y responde al menos una pregunta:

- ¿lleva a un segundo comercio real a su primera venta?
- ¿fortalece la verdad compartida de stock, cobro, costo o margen?
- ¿reduce riesgo legal, financiero, operativo o de seguridad?
- ¿crea una métrica de adopción, confiabilidad o impacto que antes no existía?

Si no responde ninguna, queda fuera. El orden de inversión es:

~~~text
comercio confiable → automatización financiera → canales profesionales
→ inteligencia → red / ecosistema
~~~

Las comparativas con otras plataformas no se harán con slogans. Cada revisión
trimestral verificará fuentes oficiales fechadas y marcará el dato como
**medido**, **criterio de producto** o **por verificar**.

## 5. Fases y condiciones de salida

Las fases son secuenciales por defecto. Sólo se explora la siguiente si no
retrasa la puerta vigente ni toca datos reales.

### F0 — Comercio confiable y vendible

**Objetivo:** que Gestiona Business venda de punta a punta para más de un
comercio sin soporte técnico cotidiano.

**Alcance**

- Resolver los bloqueos fiscal, legal, inventario físico, catálogo y envío.
- E2E seguros de POS, venta, checkout, pago, cancelación/devolución, compra,
  ajuste y tienda pública.
- Observabilidad de webhooks, cron, pagos y degradaciones, con recuperación
  idempotente y diagnóstico seguro.
- Backup y restore probados, no sólo configurados.
- Onboarding instrumentado: primer producto, canal, cobro y venta.
- Implementación acompañada de un segundo comercio, convirtiendo fricciones
  repetibles en mejoras del Core.

**No hacer:** otra línea de producto, Pay propio, builder visual amplio, agentes
autónomos o integraciones que no ayuden a la primera venta.

**Salida verificable**

1. Dos comercios completan el recorrido de venta acordado.
2. El ciclo ARCA de homologación ya está documentado; falta que el responsable
   habilite certificado y punto de venta productivos y valide ese recorrido.
3. Una muestra real reconcilia stock, pago, pedido y margen; las diferencias
   tienen causa y ajuste trazable.
4. Las rutas críticas tienen E2E seguro y las recuperaciones de pago/webhook/cron
   dejan evidencia.
5. Existe una prueba de restore y una métrica de tiempo a primera venta.

### F1 — Gestiona Finance MVP: comprobante a borrador correcto

**Objetivo:** que una factura real ingrese una vez y termine como un borrador
revisable de compra o cuenta por pagar, conectado a proveedores y productos
existentes.

**Alcance**

- Diseñar acceso, roles, segregación de funciones, retención y auditoría de
  Finance sobre identidad compartida. La eventual tabla user_product_access se
  decide mediante ADR; no se crea por intuición.
- Auditar y encapsular el OCR que hoy prellena compras como insumo potencial del
  pipeline; no promoverlo a Finance hasta que satisfaga los controles de esta
  fase.
- Crear la superficie Finance sin alterar los límites de las tres superficies
  actuales.
- Document Inbox con PDF/imagen, tipo, origen, estado, almacenamiento inmutable,
  validación de MIME/tamaño/malware.
- Pipeline: ingreso → clasificación/extracción → validación de esquema, fiscal
  y matemática → matching determinístico → confianza → revisión humana →
  comando de dominio.
- Campos mínimos: emisor, CUIT, tipo/número, fecha, vencimiento, moneda,
  impuestos, subtotal, total, ítems y adjunto.
- Duplicados por identidad fiscal, hash de archivo y reglas de negocio antes
  de crear un borrador.
- Matching por cascada: CUIT, SKU o código de barras exactos; luego aliases e
  historial; fuzzy/IA solamente como propuesta explicable.
- Al confirmar, aprender aliases proveedor-producto y crear sólo un borrador.
  La compra confirmada conserva los triggers de stock del Business Core.

**No hacer:** OCR multicanal, pago autónomo, contabilidad completa, conciliación
masiva o cambio automático de precios.

**Salida verificable**

1. Una factura de prueba llega a borrador correcto sin duplicar proveedor,
   producto, stock ni deuda.
2. Cada campo guarda valor, fuente, confianza, corrección humana y fecha.
3. Duplicados e inconsistencias fiscales/matemáticas son comprensibles y no se
   pierden en fallbacks silenciosos.
4. Un usuario sin permiso de aprobación no puede confirmar el cambio de dominio.

### F2 — Automatización financiera controlada

**Objetivo:** bajar trabajo administrativo sin que una predicción cause un
movimiento financiero irreversible.

**Alcance**

- Inbox por email, WhatsApp y API con la misma cadena de custodia.
- Three-way match de factura, orden de compra, recepción e importe.
- Calendario de cuentas por pagar, vencimientos, responsables y excepciones.
- Motor reusable de políticas/aprobaciones para gasto, compra, pago, descuento
  y cambios sensibles.
- Gastos, centros de costo y evidencia.
- Conciliación asistida de documentos, pagos y movimientos con reversión.
- Señales de costo por proveedor/producto que proponen precio o compra, sin
  actualizar nada automáticamente.

**Salida verificable**

1. Documentos de dos orígenes preservan la misma trazabilidad.
2. Las discrepancias de tres vías llegan a una persona y no cambian stock/deuda
   hasta resolverse.
3. Aprobaciones y conciliaciones guardan responsable, evidencia, historial y
   reversión autorizada.
4. Se miden correcciones de extracción, tiempo de revisión, duplicados
   bloqueados y pagos vencidos evitables.

### F3 — Commerce profesional sobre el Core

**Objetivo:** crecer online sin sacrificar verdad operativa, rendimiento,
margen ni conversión.

**Alcance, en orden**

1. Dominios con operación segura de DNS/SSL, diagnóstico y rollback.
2. Tienda first-class y multi-tienda sobre catálogo, stock, clientes, precios y
   órdenes compartidos.
3. Fundaciones de tema, páginas, navegación, SEO y medios con versiones,
   preview y publicación reversible.
4. Búsqueda, filtros, analytics de embudo y rendimiento público.
5. Builder asistido por IA que genera cambios revisables dentro del tema.
6. Experimentos de checkout/contenido sólo con tráfico y métrica predefinida.

**Salida verificable**

1. Un comercio conecta dominio, publica y revierte sin soporte técnico.
2. Dos tiendas no duplican inventario, clientes, cálculo de margen ni pagos.
3. SEO, rendimiento, conversión y errores de checkout tienen línea de base por
   tienda/canal.

### F4 — Gestiona Intelligence: hallazgo, acción e impacto

**Objetivo:** convertir datos confiables en decisiones que el comercio puede
aceptar, rechazar o delegar con límites.

**Alcance**

- AI Gateway, registro de modelos/agentes, versiones de prompt, costo,
  permisos, trazas y apagado seguro.
- Hallazgos de negocio con fuente, período, confianza, explicación, acción y
  estado.
- Secuencia recomendación → aprobación → acción → impacto para reposición,
  margen por canal, clientes inactivos, precio y promoción.
- Autonomía por niveles: informar, preparar, ejecutar con aprobación y,
  únicamente con evidencia estable, ejecutar dentro de una política.

**Salida verificable**

1. Las tres primeras recomendaciones útiles accionan una capacidad existente y
   registran aceptación/rechazo.
2. El impacto se compara con línea de base declarada.
3. Un administrador puede auditar, desactivar y revertir cada efecto permitido.

### F5 — Inteligencia de canales y economía unificada

**Objetivo:** decidir dónde vender, reponer y promocionar por margen real, no
por facturación bruta.

**Alcance**

- MercadoLibre: publicación controlada, importación de órdenes como ventas y
  sincronización multi-organización con trazas.
- Normalización de comisión, cobro, envío, impuestos, devolución, publicidad y
  costo por canal.
- Rentabilidad, publicación, stock comprometido y excepciones por SKU, pedido,
  tienda y canal.
- Recomendaciones de canal bajo las salvaguardas de F4.

**Salida verificable**

1. Una venta de cada canal habilitado se explica hasta su margen y fuente.
2. La importación es idempotente y no duplica stock, cliente ni cobro.
3. Hay evidencia de una decisión comercial tomada con el análisis.

### F6 — B2B y operación empresarial

**Objetivo:** soportar relaciones complejas sin empeorar el recorrido simple.

**Alcance:** cliente empresa, listas de precio, presupuestos, crédito,
aprobaciones, portal B2B, permisos por sucursal, auditoría/exportaciones y
multi-tienda/multi-depósito validados.

**Salida verificable:** un caso B2B real opera precio, crédito, pedido, cobro,
stock y aprobación sin planillas paralelas ni reglas ocultas.

### F7 — Pay y Ship como red, no como atajo

**Objetivo:** orquestar cobros y logística con valor medible, sin asumir riesgo
regulatorio antes de tiempo.

**Alcance condicionado**

- Health, routing, conciliación y recuperación de proveedores de pago.
- Etiquetas, tracking, tarifas y excepciones logísticas sobre órdenes compartidas.
- Saldo, adelantos, antifraude, custodia o adquirencia sólo con volumen,
  asesoría legal/compliance, capital, riesgo y operación responsable.

**Salida verificable:** mejora medida en cobro, costo logístico o tiempo de
resolución, y responsabilidad regulatoria aprobada fuera del código.

### F8 — Ecosistema de desarrolladores y aplicaciones

**Objetivo:** abrir extensiones sin abrir datos ni romper el Core.

**Alcance:** APIs/eventos versionados, scopes, OAuth/secretos, cuotas, logs,
revocación, webhooks con reintentos/DLQ/replay y marketplace sólo tras contrato
de compatibilidad y revisión.

**Salida verificable:** una integración externa usa scope mínimo, maneja replay
seguro y puede revocarse sin tocar datos internos.

### F9 — Escala regional y financiera

**Objetivo:** expandir únicamente lo que mantiene exactitud fiscal, operativa y
de margen por país.

**Alcance:** localización fiscal/impositiva, moneda, pagos, logística, términos,
privacidad, residencia de datos y soporte de acuerdo con demanda demostrada.

**Salida verificable:** cada país pasa una matriz legal, fiscal, operativa,
seguridad y soporte antes de recibir tráfico comercial.

## 6. Cola ejecutable

Se trabaja un slice a la vez. Esta tabla se actualiza en el mismo commit que
cambia el producto.

| # | Proyecto | Fase | Estado | Cierre exigido |
|---:|---|---|---|---|
| 1 | Cerrar recorrido real: fiscal, legal, stock físico, catálogo y envío. | F0 | Bloqueado externamente | Evidencia de responsable y reconciliación. |
| 2 | Medir onboarding, primera venta, error de checkout, recuperación y salud por comercio. | F0 | En curso: primera venta y tiempo a vender ya se calculan por comercio, sin duplicar organizaciones multi-tienda; faltan error de checkout y recuperación | platformMetrics.test.ts y panel Plataforma/Merchant 360; eventos y definiciones pendientes para el resto. |
| 3 | E2E seguros de venta/compra/devolución/checkout/tienda; backup y restore. | F0 | En curso | Suite verde y acta de restore sin datos reales. |
| 4 | Segundo comercio acompañado; convertir fricciones repetibles en fixes. | F0 | Pendiente | Primera venta y registro de resultados. |
| 5 | ADR de acceso, auditoría, retención y modelo de documentos Finance; auditar el OCR preexistente. | F1 | Pendiente; OCR parcial, no MVP; no implementar antes de F0 | ADR, amenaza/RLS y migración propuesta sin duplicar Core. |
| 6 | Finance Inbox y extracción estructurada con revisión humana. | F1 | Congelado hasta F0; reutilizar sólo lo que supere los controles | Documento de prueba → registro trazable. |
| 7 | Matching, duplicados y borrador compra/payable. | F1 | Congelado hasta Inbox | Factura → borrador correcto, sin impacto prematuro. |
| 8 | Entradas automáticas, three-way match, aprobaciones y AP Calendar. | F2 | Pendiente | Excepciones y aprobaciones auditables. |
| 9 | Dominios, Store first-class y tema/página reversible. | F3 | Pendiente | Publicación/rollback autónomos y datos compartidos. |
| 10 | Gateway de IA, hallazgos e impacto verificado. | F4 | Pendiente | Recomendación → acción → impacto medido. |
| 11 | MercadoLibre operativo y economía normalizada. | F5 | Parcial | Orden real idempotente y margen explicable. |
| 12 | B2B, Pay/Ship, Developers y expansión. | F6–F9 | Congelado por diseño | Puertas de demanda, volumen y regulación. |

La numeración no autoriza saltar fases. Un P0 de seguridad, datos, legal o
incidente se atiende antes y deja asentado su impacto sobre la fase vigente.

## 7. Diseño de referencia de Finance

Finance no bifurca el sistema. La primera arquitectura sigue esta cadena:

~~~text
archivo / email / WhatsApp / API
  → validación y almacenamiento inmutable
  → clasificación y extracción estructurada
  → validación fiscal, de esquema y matemática
  → deduplicación y matching explicable
  → confianza + revisión humana
  → borrador de compra o cuenta por pagar
  → aprobación / comando del Business Core
  → auditoría, conciliación y señal de costo
~~~

Reglas de implementación:

- El proveedor de extracción es intercambiable; el contrato interno de campos,
  confianza, versión y evidencia no lo es.
- La confianza se modela por campo y decisión, no como un número decorativo.
- Los aliases proveedor-producto surgen de confirmaciones, se auditan y se
  pueden corregir/desactivar.
- Un comprobante se bloquea antes de crear deuda mediante CUIT/tipo/número,
  hash y reglas complementarias.
- Una variación de costo genera alerta/propuesta; no actualiza precios sola.
- Documentos, aprobaciones, matching y cambios de estado conservan actor,
  momento, origen, versión de regla/modelo y motivo de reversión.
- Finance standalone para empresas con ERP externo es una hipótesis posterior;
  primero se valida integración profunda con el Business Core.

## 8. Estándar competitivo

El objetivo es una combinación que el comercio pueda comprobar; no una lista de
módulos. Esta matriz define el estándar propio, no afirma el estado de terceros.

| Dimensión | Estándar Gestiona | Señal para cliente e inversor |
|---|---|---|
| Operación | Stock, venta, compra, cliente y margen se reconcilian. | Menos planillas y diferencias sin explicación. |
| Omnicanalidad | Cada canal usa el mismo Core y muestra su costo/resultado. | Decisiones por margen real. |
| Commerce | Tienda rápida y extensible conectada al back-office. | Conversión sin carga manual paralela. |
| Finance | Documento a obligación correcta y revisable. | Menos tarea administrativa y costos visibles. |
| Plataforma | Integraciones, pagos, webhooks y soporte con evidencia. | Menor riesgo de fallas silenciosas. |
| Intelligence | Sugerencia accionable con impacto medible. | Automatización que demuestra valor. |
| Ecosistema | APIs/apps con permisos mínimos y observabilidad. | Canales nuevos sin perder control. |

Las comparativas públicas viven en docs/ESTRATEGIA.md con URL oficial, fecha y
etiqueta ✅/📌/❓. Este documento evita afirmaciones volátiles sobre competidores.

## 9. Métricas que deciden

Toda métrica tiene definición, fuente, dueño, período, denominador y consulta
reproducible antes de entrar a un tablero o pitch.

| Grupo | Métricas iniciales |
|---|---|
| Activación | Tiempo a primer producto, canal, cobro y venta; porcentaje por hito. |
| Confiabilidad | Éxito de checkout/pago, recuperaciones, diferencias de stock, restores e incidentes por organización. |
| Valor comercial | Recompra, GMV conciliado, margen por canal, quiebres/envíos y tiempo de resolución. |
| Finance | Documentos, correcciones, duplicados bloqueados, tiempo a borrador, excepciones y vencimientos. |
| IA | Cobertura de hallazgos, AI Action Rate, aceptación/rechazo, reversión e impacto contra línea base. |
| Plataforma | Organizaciones activas, segunda venta, integraciones sanas, cron/webhooks recuperados y costo de soporte. |
| Negocio | Comercios activos, retención, ingreso recurrente/transaccional, margen de contribución y costo de servir. |

F0 debe instrumentar la línea de base antes de fijar metas universales. No se
optimiza conversión, retención o IA sobre la muestra actual de un comercio.

## 10. Disciplina de ejecución

Cada cambio se entrega como slice: migración y verificación de base real cuando
aplique → UI/canal → pruebas de cálculo e integración → typecheck,
check:functions, lint, test y build → evidencia operativa → commit →
actualización de este roadmap.

Cada actualización debe registrar:

1. fase, proyecto de la cola y problema resuelto;
2. estado real: pendiente, en curso, bloqueado, parcial o hecho;
3. commit, migración, prueba, consulta o evidencia externa;
4. métrica nueva o resultado de la existente;
5. deuda, dependencia o decisión abierta.

Una fase sólo termina al cumplir todas sus salidas. Una UI, ticket o migración
sin verificación no cierra trabajo. Los conteos de tests y uso llevan fecha y
comando.

## 11. Congelado deliberadamente

Hasta abrir sus puertas, no se prioriza:

- ERP periférico que no reduzca riesgo ni ayude a vender;
- duplicar stock, precio, cliente, proveedor o pago por canal/producto;
- builders, experimentos o personalización visual sin tráfico y métrica;
- agentes que escriban dinero, inventario o precios sin aprobación;
- billetera, crédito, custodia, adquirencia o promesas financieras sin marco
  regulatorio, capital, riesgo y responsable operativo;
- marketplace de apps sin API estable, scopes, revocación y replay;
- expansión internacional sin matriz fiscal, legal, logística y de soporte;
- una segunda autenticación u organización para Finance.

## 12. Fuentes y revisión

- AGENTS.md: invariantes operativas, seguridad, migraciones y verificación.
- docs/ESTRATEGIA.md: tesis de margen omnicanal y comparativas verificables.
- docs/LEGAL.md: requisitos argentinos para precios, clientes y plataforma.
- Análisis estratégico de producto recibido el 2026-08-21: referencia para
  portfolio, Finance, plataforma e inteligencia.

Se revisa al cerrar el primer slice de F0 o ante un incidente/decisión que
cambie una puerta. El orden cambia con evidencia de comercio, riesgo o tracción,
no por una feature atractiva aislada.
