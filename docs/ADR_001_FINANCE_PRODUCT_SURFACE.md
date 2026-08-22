# ADR 001 — Superficie y acceso de Gestiona Finance

- **Estado:** aceptado e implementado
- **Fecha:** 2026-08-22
- **Alcance:** F3.14 — acceso por producto, roles, segregación, sesión y shell

## Contexto

Gestiona ya tenía OCR dentro de Compras, proveedores, órdenes de compra,
obligaciones y un ledger financiero. Eso no constituía un producto Finance: el
OCR anterior manda el archivo al proveedor, prellena datos y carece de cadena de
custodia, original inmutable, validación por campo, duplicados y aprobación.

El primer límite debía responder cinco preguntas antes de aceptar documentos:

1. quién entra a Finance;
2. qué organización está operando;
3. quién habilita el producto y quién habilita a una persona;
4. qué entidades se comparten con Business;
5. cuándo justificar otra aplicación física o tecnología.

## Decisión

### 1. Una superficie distinta, todavía en el mismo deploy

Finance vive en `/finance` con `FinanceLayout`. No usa `AppLayout`, el onboarding
de Business ni la navegación de Platform. Sigue dentro del monolito modular y el
mismo build mientras no haya una mejora medida que justifique separar ciclo de
despliegue, SLO o equipo.

React 18, TypeScript, React Router y Vite se conservan porque ya resuelven el
shell y code splitting. PostgreSQL/Supabase sigue siendo autoridad para acceso y
agregados. No se agregó otra dependencia: una librería nueva no mejora este
límite y ampliaría superficie de supply chain sin beneficio.

### 2. Identidad y organización compartidas

Finance reutiliza `auth.users`, `profiles`, `organizations`, `memberships` y el
selector de organización. La sesión actual también es compartida y vuelve a
pasar por `MfaGate` según la configuración de la organización.

Staff de Platform sin una membresía real no puede entrar. Su superficie sigue
siendo `/platform`. Si Finance se extrae a otro subdominio, el siguiente ADR debe
usar PKCE o código de un solo uso para que cada app obtenga su propia sesión; no
se compartirán tokens mediante almacenamiento global.

### 3. Entitlement, permiso y feature flag son tres controles distintos

| Control | Pregunta | Autoridad |
|---|---|---|
| `organization_product_access` | ¿La organización tiene el producto? | Platform `finance`/`superadmin` |
| `role_permissions.finance` | ¿Esta persona puede usar Finanzas? | Owner/admin de la organización |
| `feature_flag_overrides` | ¿Qué implementación técnica se expone? | Superadmin de Platform |

Un owner/admin puede solicitar Finance, pero no autoaprobarlo. Platform decide
desde Merchant 360 con un motivo obligatorio. La transición se guarda en una
bitácora append-only y en `admin_audit_logs` dentro de la misma transacción.

La UI no lee ni escribe la tabla cruda. `product_surface_access` vuelve a validar
membresía, entitlement y `finance.view`; `finance_core_snapshot` repite el gate.
`anon`, outsiders y tenant clients no pueden ejecutar la mutación de Platform.

### 4. Un Business Core, no tablas Finance paralelas

El primer snapshot consume estas autoridades existentes:

- `suppliers`;
- `purchase_orders`;
- `supplier_debts`;
- `ledger_entries`;
- `ocr_documents`, sólo rotulado como precursor.

El navegador recibe conteos agregados mediante un RPC. Finance no crea
`finance_suppliers`, `finance_purchases`, `finance_payables` ni otro ledger. Los
borradores futuros referenciarán estas entidades y sólo producirán efectos
después de aprobación.

## Benchmark vigente

La comparación se hizo con documentación oficial el 2026-08-22:

- [Odoo 19 — Document digitization](https://www.odoo.com/documentation/19.0/applications/finance/accounting/vendor_bills/invoice_digitization.html)
  recibe facturas por carga o email, extrae campos, exige revisión y busca una
  orden de compra coincidente. Puede sugerir auto-post después de tres
  validaciones sin edición. Por lo tanto OCR, review y PO matching son paridad.
- [QuickBooks — Upload receipts and bills](https://quickbooks.intuit.com/learn-support/en-uk/help-article/import-transactions/upload-receipts-bills-quickbooks-online/L862MmZHn_GB_en_GB)
  soporta carga web, móvil y email, extrae y deja el documento “For review” antes
  de agregarlo o emparejarlo. Capturar no equivale a registrar.
- [QuickBooks — Bill approval workflows](https://quickbooks.intuit.com/learn-support/en-us/help-article/manage-workflows/set-use-bill-approval-payment-release-workflows/L1IOLL9hv_US_en_US)
  separa bill clerk, approver y payer y permite reglas por monto/proveedor. La
  segregación de funciones es paridad mínima del producto maduro.
- [Supabase — Private storage buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals)
  documenta buckets privados, restricciones de MIME/tamaño, RLS y acceso mediante
  JWT o URL firmada temporal. Es compatible con el stack actual para el próximo
  Document Inbox.

El diferencial que se buscará no es “tener OCR”. Es que el documento aprobado
use el proveedor, producto, compra, obligación, stock, costo y ledger del mismo
Core que ya opera POS y Commerce.

## Alternativas rechazadas

- **Convertir el OCR actual en la home de Finance:** confunde prefill con cadena
  documental y oculta deuda de seguridad.
- **Usar feature flags como entitlement:** mezcla rollout técnico con acceso
  comercial y permite estados imposibles de auditar.
- **Crear usuarios u organizaciones Finance:** rompe la única fuente de verdad y
  obliga a sincronizar identidad y permisos.
- **Crear una SPA o microservicio nuevo hoy:** duplica CI, auth y operación sin
  tráfico, equipo ni SLO que lo justifique.
- **Cambiar lenguaje por novedad:** el riesgo actual está en producto y evidencia,
  no en capacidad de TypeScript/PostgreSQL.

## Verificación y línea de base

`supabase/verificaciones/20260822_finance_product_surface.sql` creó una
organización `ZZ`, ejecutó el camino como owner, staff de Platform, outsider,
`authenticated` y `anon`, y revirtió todo:

- owner solicitó pero no pudo leer el snapshot antes de aprobación;
- Platform habilitó y deshabilitó;
- el snapshot leyó 1 proveedor, 1 orden, 1 obligación por ARS 123, 1 asiento y 1
  documento precursor del Core compartido;
- `finance.view=false`, outsider y anon quedaron bloqueados;
- hubo 3 eventos append-only;
- organizaciones y eventos `ZZ`: 0.

Producción al 2026-08-22: 4/4 organizaciones con Business habilitado, 4/4 con
Finance disponible, 0 solicitudes, 0 habilitaciones y 0 eventos. Es una puerta
técnica cerrada, no adopción.

## Consecuencias y siguiente gate

El siguiente slice autorizado es Document Inbox: bucket privado, original
inmutable, hash SHA-256, MIME/tamaño reales, cuarentena, versiones y auditoría.
Recién después se conecta extracción estructurada. Ningún documento moverá stock,
creará deuda ni asentará contabilidad antes de aprobación humana.
