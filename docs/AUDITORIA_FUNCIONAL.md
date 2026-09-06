# Auditoría funcional continua

**Corte:** 2026-09-05. **Entorno:** producción (`nerqia.app`) con sesión real y
tienda pública. Este documento es el registro vigente; los cortes anteriores
quedan en Git.

## Contrato

El barrido comprueba que cada ruta resuelva, termine de cargar, tenga contenido
útil, título, jerarquía accesible, ausencia de overflow horizontal y ausencia de
errores JavaScript propios de la aplicación. También se abren tabs, diálogos y
acciones de sólo lectura cubiertos por E2E.

Una navegación verde **no certifica una mutación**. Ventas, cobros, reintegros,
despachos, facturación, emails, invitaciones, cambios de plan y bajas se prueban
con fixtures reversibles, sandbox del proveedor o una operación real aprobada;
nunca se disparan contra datos productivos sólo para pintar este documento de
verde.

## Resultado por superficie

### Business y rutas públicas — 70/70 alcanzables

| Ruta | Resultado de lectura | Observación vigente |
|---|---|---|
| `/` | OK | Dashboard autenticado y landing pública resuelven según sesión. |
| `/tienda-online` | OK | Configuración Commerce y dominios cargan. |
| `/pedidos-online` | OK | Cola de pedidos carga. |
| `/caja` | OK | Selector de vendedor y POS sin overflow. |
| `/ventas` | OK | Historial carga. |
| `/productos` | Corregido | Timestamp ISO ya no puede mostrar `NaNd`. |
| `/clientes` | OK | CRM, identidad e insights cargan. |
| `/tareas` | OK | Agenda carga. |
| `/calendario` | OK | Vista mensual carga. |
| `/compras` | OK | Compras carga. |
| `/ordenes-compra` | OK | Cola de órdenes carga. |
| `/proveedores` | OK | Índice carga. |
| `/planificacion` | OK | Reposición carga. |
| `/kardex` | OK | Movimientos cargan. |
| `/transferencias` | OK | Transferencias cargan. |
| `/sucursales` | OK | Sucursales y depósitos cargan. |
| `/lotes` | OK | Lotes y vencimientos cargan. |
| `/bundles` | OK | Kits cargan. |
| `/listas-precios` | OK | Listas cargan. |
| `/valuacion-inventario` | OK | Valuación carga. |
| `/deudas` | OK | Cuentas por cobrar cargan. |
| `/cuotas` | OK | Planes de pago cargan. |
| `/presupuestos` | OK | Presupuestos cargan. |
| `/facturas` | OK | Comprobantes cargan. |
| `/devoluciones` | OK | Devoluciones cargan. |
| `/envios` | OK | Seguimiento carga. |
| `/links-de-pago` | OK | Índice carga. |
| `/mi-plan` | OK | Estado y planes cargan. |
| `/billetera` | OK | Saldo, movimientos y retiros cargan. |
| `/gastos` | OK | Resumen y comprobantes cargan. |
| `/cash-flow` | OK | Flujo carga. |
| `/pl-dashboard` | OK | P&L carga. |
| `/banco` | OK | Conciliación carga. |
| `/movimientos` | OK | Movimientos financieros cargan. |
| `/cheques` | OK | Cheques cargan. |
| `/comisiones` | OK | Comisiones de vendedores cargan. |
| `/impuestos` | OK | Gestión impositiva carga. |
| `/afip` | OK | Estado de facturación electrónica carga. |
| `/multi-divisa` | OK | FX carga. |
| `/suscripciones` | OK | Recurrencia carga. |
| `/marketing` | OK | Command center carga. |
| `/cupones` | OK | Reglas cargan. |
| `/promociones` | OK | Promociones cargan. |
| `/email-campaigns` | OK | Campañas cargan; envío real sigue gateado por Resend. |
| `/whatsapp-campaigns` | OK | Campañas cargan; envío real sigue gateado por Meta. |
| `/fidelidad` | OK | Programa y ranking cargan. |
| `/canjes` | OK | Canjes cargan. |
| `/influencers` | OK | Índice carga. |
| `/afiliados` | OK | Programa carga. |
| `/referidos` | OK | Configuración carga. |
| `/catalogo` | OK | Catálogo compartible carga. |
| `/reportes` | OK | Reportes cargan. |
| `/analytics` | OK | KPIs y gráficos cargan; contenido pesado queda en presupuesto. |
| `/ia` | OK | Insights cargan. |
| `/alertas` | OK | Motor de alertas carga. |
| `/integraciones` | OK | Registro y contratos cargan. |
| `/equipo` | OK | Miembros e invitación cargan. |
| `/ajustes` | OK | Workspace de ajustes carga. |
| `/perfil` | OK | Perfil y cambio de clave cargan. |
| `/admin` | OK | Rendimiento, roles y auditoría cargan. |
| `/calidad-datos` | OK | Identidad del catálogo carga. |
| `/libro` | Corregido | Conserva título propio y autoridad del ledger. |
| `/precios` | OK | Precios públicos y estado de cliente resuelven. |
| `/login` | Corregido | Título cambia con acceso, alta, OTP y recuperación. |
| `/reset-password` | Corregido | Enlace ausente muestra estado inválido y título propio. |
| `/privacidad` | OK | Documento carga; identidad legal sigue pendiente. |
| `/terminos` | OK | Documento carga; identidad legal sigue pendiente. |
| `/estado` | OK con incidencia | App y cron operativos; respaldos reportan verificación pendiente. |
| `/caja/turno` | OK | Apertura/cierre e historial cargan. |
| `/onboarding` | Corregido | Una organización configurada vuelve al inicio; no reescribe su blueprint. |

### Finance — 2/2 alcanzables

| Ruta | Resultado | Observación vigente |
|---|---|---|
| `/finance` | OK | Resumen y puentes al Core cargan; primera lectura puede tardar varios segundos. |
| `/finance/documentos` | OK | Inbox privado y captura cargan. |

### Platform — 14/14 alcanzables

| Ruta | Resultado | Observación vigente |
|---|---|---|
| `/platform` | Corregido | Ya no muestra ceros inventados antes de recibir métricas. |
| `/platform/orgs` | OK | Cuatro organizaciones reales en el corte. |
| `/platform/usuarios` | OK | Cuentas y roles cargan. |
| `/platform/metricas` | OK | Activación y adopción cargan. |
| `/platform/integraciones` | OK | Contratos y readiness cargan. |
| `/platform/operaciones` | OK | Incidentes y lanzamiento cargan. |
| `/platform/planes` | OK | Planes y límites cargan. |
| `/platform/negocio` | OK | GMV y comisión cargan desde evidencia. |
| `/platform/comisiones` | OK | Revenue carga; primera lectura puede tardar varios segundos. |
| `/platform/afip` | OK | Estado de certificado carga. |
| `/platform/soporte` | OK | Organizaciones y auditoría cargan. |
| `/platform/anuncios` | OK | Historial y editor cargan. |
| `/platform/sistema` | OK | Secrets y salud cargan. |
| `/platform/mensajeria` | OK | Readiness de correo y WhatsApp carga. |

### Storefront — 7/7 alcanzables

| URL relativa | Resultado | Observación vigente |
|---|---|---|
| `/` | OK | Home, navegación, promociones y productos cargan. |
| `/productos` | OK | 59 productos, filtros y orden cargan. |
| `/carrito` | OK | Empty state recuperable. |
| `/checkout` | Corregido | Carrito vacío ahora se anuncia como `h1`. |
| `/seguimiento` | OK | Consulta de pedido carga. |
| `/cuenta` | OK | Acceso, alta y recuperación cargan. |
| `/arrepentimiento` | OK | Formulario y derechos cargan; no se envió una solicitud real. |

## Hallazgos operativos que no son bugs de interfaz

- El comercio del corte tiene suscripción cancelada; Core conserva datos y
  comunica qué extras están apagados.
- El estado público reporta snapshots pendientes de verificación. Debe cerrarse
  con una corrida/restauración observada, no ocultando la incidencia.
- Resend/Auth SMTP, Mercado Pago, ARCA, transportista y Meta requieren matrices
  reales de éxito, rechazo, timeout, replay y recuperación.
- El siguiente barrido añade contratos de acción por página: cada CTA se
  clasifica como lectura, borrador reversible, sandbox proveedor o mutación
  productiva aprobada.

## Benchmark aplicado

El mapa mantiene el núcleo único que Shopify usa para pedidos, productos,
clientes, inventario, analítica, marketing y descuentos; adopta la continuidad
omnicanal de Shopify/Tiendanube y reserva a Finance el trabajo de evidencia,
política, aprobación y conciliación que caracteriza a Mendel. La comparación
ordena prioridades; no autoriza copiar interfaces ni prometer proveedores no
habilitados.
