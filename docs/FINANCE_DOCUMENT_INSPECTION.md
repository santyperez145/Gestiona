# Finance Document Inbox — inspección y cuarentena

**Corte:** 2026-08-22
**Estado:** autoridad, migración, Edge Function y UI desplegadas; scanner privado
externo no configurado. La etapa posterior de extracción/revisión también está
desplegada, pero permanece deshabilitada para proveedores externos.

Este flujo existe para que un archivo elegido en el navegador nunca se convierta
en autoridad por su nombre, extensión, `Content-Type` o hash declarado. El
original queda privado y la extracción sólo se habilita cuando los bytes reales
superan integridad, política estructural y scanner.

## Flujo

~~~text
usuario con finance.edit
  → finance_document_begin_inspection (JWT/RLS/entitlement)
  → lease UUID de 5 minutos
  → Edge descarga el original con service_role
  → SHA-256 + tamaño + magic bytes
  → política PDF (sin JS, Launch, EmbeddedFile, OpenAction ni AA)
  → scanner privado
  → finance_document_complete_inspection (sólo service_role + lease)
  → ready_for_extraction | duplicate | scanner_unavailable | quarantined
~~~

La Edge Function no llama OCR. Ese límite es deliberado: inspeccionar y extraer
son etapas distintas, reintentables y auditables.

Una versión sólo puede entrar a la etapa posterior si queda exactamente
`ready_for_extraction` y `scanner_status = clean`. No hay un botón ni un RPC de
usuario que saltee ese gate. El contrato de extracción, confianza y revisión
append-only está en
[FINANCE_DOCUMENT_EXTRACTION.md](FINANCE_DOCUMENT_EXTRACTION.md).

## Estados

| Estado de versión | Significado | ¿Puede extraerse? |
|---|---|---|
| `pending` | Carga terminada, inspección no iniciada. | No |
| `scanning` | Lease vigente; hay una inspección en curso. | No |
| `scanner_unavailable` | Lectura o scanner falló/no está configurado. | No |
| `ready_for_extraction` | Hash, tamaño, MIME y scanner limpio. | Sí |
| `duplicate` | Mismos bytes que otra versión inspeccionada del mismo tenant. | No; requiere decisión humana |
| `quarantined` | Diferencia de integridad, tipo, tamaño o contenido riesgoso. | No |
| `rejected` | Resultado de inspección inválido/no aceptable. | No |

Un timeout viejo no puede cerrar un retry nuevo: el completion necesita el
`inspection_token` vigente. `inspection_attempts` y los eventos append-only
permiten reconstruir el recorrido sin exponer el contenido.

## Contrato del scanner privado

Secrets requeridos en Supabase:

- `FINANCE_DOCUMENT_SCANNER_URL`
- `FINANCE_DOCUMENT_SCANNER_TOKEN`

Mientras falte cualquiera, la función devuelve `unavailable` y la base conserva
`awaiting_inspection`. No existe bypass manual a `ready_for_extraction`.

Request:

~~~http
POST <FINANCE_DOCUMENT_SCANNER_URL>
Authorization: Bearer <token>
Content-Type: application/pdf | image/jpeg | image/png | image/webp
X-Content-SHA256: <sha256 real>

<bytes del original>
~~~

Respuesta aceptada:

~~~json
{
  "status": "clean | infected",
  "engine": "nombre/version",
  "reference": "id opaco opcional",
  "signature": "sólo cuando infected"
}
~~~

HTTP no exitoso, timeout de 20 segundos o JSON inválido producen `error`; nunca
`clean`.

## Requisitos antes de configurar un proveedor

Una factura puede contener CUIT, nombre, domicilio, importes y datos bancarios.
Por eso no se usa VirusTotal ni otro corpus público. El scanner debe:

- ser operado por Gestiona o contratado como encargado de tratamiento;
- no conservar muestras ni entrenar modelos con los documentos;
- cifrar tránsito y almacenamiento temporal;
- borrar los bytes después del análisis;
- declarar región/subencargados y proceso de incidentes;
- tener contrato/DPA validado para Ley 25.326 y transferencias internacionales;
- devolver sólo un estado y referencia opaca; nunca el contenido en logs.

Hasta cerrar esas condiciones, mantener los secrets ausentes es el estado seguro.

La aprobación del scanner no aprueba automáticamente un proveedor de extracción:
ambos procesan documentos con datos personales y fiscales y requieren su propio
contrato, retención, región, subencargados y evaluación. Los flags de extracción
se mantienen ausentes aunque la Edge Function ya esté desplegada.

## Verificación y operación

- `authenticated` puede ejecutar `finance_document_begin_inspection` sólo si
  la base confirma entitlement + `finance.edit`.
- `authenticated` no puede ejecutar `finance_document_complete_inspection`;
  sólo `service_role`.
- El objeto se descarga de `finance-documents`, nunca por URL pública.
- La deduplicación compara `actual_sha256` dentro de la misma organización.
- Cuarentena no borra el original: preserva evidencia privada y bloquea OCR.

Consultas operativas:

~~~sql
select inspection_status, scanner_status, count(*)
from public.finance_document_versions
group by 1, 2 order by 1, 2;

select count(*) as leases_vencidos
from public.finance_document_versions
where inspection_status = 'scanning'
  and inspection_started_at < now() - interval '5 minutes';
~~~

Ante fallos, revisar primero `scanner_unavailable`, la disponibilidad del
endpoint privado y los eventos `inspection_started`/`inspection_deferred`. No
reclasificar filas por SQL para destrabar OCR.
