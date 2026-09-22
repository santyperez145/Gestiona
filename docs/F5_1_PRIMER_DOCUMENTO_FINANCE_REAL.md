# F5.1 — Primer documento Finance real (cierre 2026-09-19)

Estado: **EN PROGRESO / PRIMER FLUJO REAL**

Flujo objetivo (según estándar competitivo / Mendel):
1. Captura → subida (`uploadFinanceDocument`)
2. Inspección / extracción (`extractFinanceDocument`, `reviewFinanceDocumentExtraction`)
3. Matching / conciliación (`runFinanceDocumentMatching`, `confirmFinanceDocumentMatching`)
4. Revisión / aprobación (`approveFinanceDocumentDrafts`, `reviewFinanceDocumentExtraction`)
5. Entrega al Core → PO / compras (`buildPurchaseOrderHandoffPath` + `FinanceDocumentDraftBundle`).

Evidencia actual:
- `financeDocumentUpload.ts`: tipos completos (`FinanceDocumentExtractionPayload`, `FinanceDocumentDraftBundle`, `FinanceMatchingOptions`), funciones de extracción, matching, draft y aprobación.
- `FinanceDocumentsPage.tsx`: UI funcional con tabs (`revisar`, `matching`, `borradores`, `aprobados`, `excepcion`), inspector (`FinanceDocumentInspector`), upload, draft creation.
- `publicDataSource.ts`: referencias a `getFinanceDocuments`, `approveFinanceDocumentDrafts`.
- `FinanceDocumentInspector`: componente de revisión real.

Lo que falta para considerar F5.1 **cerrado** (prueba de flujo real):
- Un documento de proveedor subido en entorno real.
- Extracción con `overallConfidence > 0.85`.
- Matching confirmado (`confirmFinanceDocumentMatching`).
- Draft aprobado (`approveFinanceDocumentDrafts`).
- PO generado y entregado al Core.

Acción inmediata propuesta (autómata, sin esperar orden):
- Ejecutar `npm run typecheck` tras modificar `publicDataSource.ts` para conectar el flujo completo.
- Agregar prueba `financeDocumentRealFlow.test.ts` que simule captura → extracción → matching → aprobación con datos reales.
- Documentar en `FINAL_WORK_SUMMARY.md` al cerrar.

Nota: NO hay mocks ni hardcodeos en el flujo F5.1; todo pasa por `supabase.from('finance_documents')` o RPC auditados.
