# Escáner de comprobantes de Gastos — evidencia 2026-08-30

## Alcance certificado

Este slice cierra dos fallos de ingeniería: Gastos llamaba al contrato SSE de
`ai-chat` como si fuera OCR JSON y Supabase tenía `extract-receipt` activa sin
fuente versionada. La función desplegada se recuperó, se comparó sin diferencias
con la fuente histórica encontrada y se endureció antes de volver a publicar.

La evidencia certifica contrato, seguridad, diseño de revisión, build y deploy.
**No certifica exactitud sobre comprobantes reales ni una llamada exitosa a
Anthropic:** tanto `ANTHROPIC_API_KEY` como
`EXPENSE_RECEIPT_EXTRACTION_ENABLED` están ausentes a propósito.

## Contrato y autoridad

- `ReceiptScanner` invoca `extract-receipt` con imagen, MIME, organización y las
  categorías reales; ya no arma un prompt de navegador ni llama a `ai-chat`.
- La Edge Function exige POST, persona autenticada, membresía del tenant,
  beneficio/cupo de IA, flag documental, clave, MIME/tamaño/base64 y rate limit
  antes del proveedor.
- La respuesta sale de una herramienta con esquema cerrado. Monto y fecha se
  vuelven a validar y una categoría inventada se descarta en servidor.
- El consumo de IA se registra sólo después de que el proveedor responde.
- El resultado lleva `reviewRequired=true`; la UI dice “Sugerencias listas para
  revisar” y “Aplicar sugerencias”. No escribe un gasto ni una compra.
- El error de la Edge llega a un `role=alert` visible y siempre conserva la
  alternativa de adjuntar el archivo y completar manualmente.

## Privacidad y custodia

La captura conserva el blob local. La imagen puede enviarse al proveedor sólo
al tocar **Extraer datos** y el archivo se sube al bucket privado únicamente al
confirmar el gasto; cerrar el formulario no deja un upload huérfano. La pantalla
declara el proveedor antes de ejecutar y la política de privacidad ya no afirma
“datos anonimizados”: un comprobante puede contener CUIT, medio de pago u otros
datos del negocio.

El patrón competitivo se verificó contra la documentación oficial de
[QuickBooks](https://quickbooks.intuit.com/learn-support/en-uk/help-article/import-transactions/upload-receipts-bills-quickbooks-online/L862MmZHn_GB_en_GB):
captura, extracción y estado “For review” antes de agregar o emparejar. Gestiona
adopta esa separación conceptual, no su interfaz. Anthropic documenta imágenes
base64, ubicación de imagen antes del texto y JPEG/PNG/GIF/WebP en
[Vision](https://platform.claude.com/docs/en/build-with-claude/vision); el
navegador comprime antes y el servidor restringe esos MIME.

## Evidencia de despliegue

| Comprobación | Resultado |
|---|---|
| `extract-receipt` | `ACTIVE`, versión 3, `verify_jwt=true` |
| `platform-admin-action` | `ACTIVE`, versión 48, `verify_jwt=true` |
| Llamada anónima a `extract-receipt` | HTTP 401, `Access-Control-Allow-Origin: *` |
| Funciones repo/remoto | 74 versionadas / 74 activas |
| `ANTHROPIC_API_KEY` | ausente |
| `EXPENSE_RECEIPT_EXTRACTION_ENABLED` | ausente |

Con las dos últimas filas ausentes, el flujo devuelve una explicación y permite
carga manual; no transmite el documento. `platform-admin-action` y System
Health ahora muestran el flag sin exponer ningún valor.

## Puerta local

- `npm run typecheck`: verde.
- `npm run lint`: 0 errores, 139 warnings históricos conocidos.
- `npm test`: 2.078/2.078 en 208 archivos.
- `npm run build`: Vite + PWA verde.
- `npm run check:functions`: 74/74 entradas Deno.
- Guardas nuevas: 6 escenarios de contrato/tenant/plan/flag/categoría/revisión,
  más las guardas existentes de autenticación, autoridad de plan, secretos y
  privacidad del bucket.

## Gate externo pendiente

Antes de habilitar documentos reales: aprobar DPA, región, subencargados,
exclusión de entrenamiento, retención y borrado; fijar proveedor/modelo; cargar
la clave y recién entonces el flag; ejecutar un corpus autorizado y etiquetado
con exactitud por campo, tasa de revisión, costo y latencia; validar el flujo
autenticado en 360/768/1024/1440. Una demo sintética no reemplaza esa evidencia.
