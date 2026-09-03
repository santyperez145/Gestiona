import { describe, expect, it } from "vitest";
import {
  countFinanceInboxViews,
  filterFinanceInbox,
  financeDocumentAgeLabel,
  financeDocumentNextAction,
  parseFinanceInboxView,
} from "@/lib/financeDocumentInbox";
import type { FinanceDocument } from "@/lib/financeDocumentUpload";

function doc(partial: {
  status: FinanceDocument["status"];
  title?: string;
  inspection?: FinanceDocument["versions"][number]["inspectionStatus"];
  upload?: FinanceDocument["versions"][number]["uploadStatus"];
  extractionStatus?: NonNullable<FinanceDocument["versions"][number]["extraction"]>["status"];
  matchingStatus?: "proposed" | "confirmed";
  draftStatus?: "draft" | "approved";
  supplier?: string;
}): FinanceDocument {
  const extraction = partial.extractionStatus
    ? {
      id: "ex",
      versionId: "v1",
      attempt: 1,
      status: partial.extractionStatus,
      overallConfidence: 0.8,
      validationErrors: [],
      failureReason: null,
      provider: null,
      model: null,
      revisionNumber: 1,
      revisionSource: "model" as const,
      payload: {
        supplier_name: partial.supplier ?? "Proveedor ZZ",
        supplier_tax_id: "20123456789",
        document_number: "A-1",
        issue_date: "2026-09-01",
        currency: "ARS" as const,
        subtotal: 100,
        tax_total: 21,
        total: 121,
        items: [],
      },
      matching: partial.matchingStatus
        ? {
          runId: "r",
          extractionId: "ex",
          revisionNumber: 1,
          status: partial.matchingStatus,
          supplier: {
            extractedName: partial.supplier ?? "Proveedor ZZ",
            extractedTaxId: "20123456789",
            proposedSupplierId: null,
            confirmedSupplierId: null,
            selectedSupplierId: null,
            selectedSupplierName: null,
            matchMethod: "none" as const,
            candidateCount: 0,
          },
          lines: [],
        }
        : null,
      draft: partial.draftStatus
        ? { invoiceDraftId: "d", status: partial.draftStatus, revisionNumber: 1 }
        : null,
      updatedAt: "2026-09-01T00:00:00Z",
    }
    : null;

  return {
    id: "doc",
    orgId: "org",
    documentType: "supplier_invoice",
    title: partial.title ?? "Factura ZZ",
    status: partial.status,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T12:00:00Z",
    versions: [{
      id: "v1",
      documentId: "doc",
      versionNumber: 1,
      originalFilename: "factura.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1200,
      sha256: "abc",
      hashStatus: "verified",
      uploadStatus: partial.upload ?? "uploaded",
      inspectionStatus: partial.inspection ?? "pending",
      failureReason: null,
      storagePath: "path",
      createdAt: "2026-09-01T00:00:00Z",
      uploadedAt: "2026-09-01T00:00:00Z",
      extraction,
    }],
  };
}

describe("financeDocumentInbox", () => {
  it("no inventa una vista: un valor desconocido vuelve a Todos", () => {
    expect(parseFinanceInboxView("politica")).toBe("todos");
    expect(parseFinanceInboxView("revisar")).toBe("revisar");
  });

  it("prioriza la próxima acción real y no promete aprobación F5", () => {
    expect(financeDocumentNextAction(doc({ status: "awaiting_inspection" }))).toBe("Inspeccionar");
    expect(financeDocumentNextAction(doc({
      status: "in_review",
      inspection: "ready_for_extraction",
      extractionStatus: "ready_for_review",
    }))).toBe("Revisar datos");
    expect(financeDocumentNextAction(doc({
      status: "in_review",
      inspection: "clean",
      extractionStatus: "reviewed",
      matchingStatus: "proposed",
    }))).toBe("Confirmar coincidencias");
    expect(financeDocumentNextAction(doc({
      status: "approved",
      inspection: "clean",
      extractionStatus: "reviewed",
      matchingStatus: "confirmed",
      draftStatus: "approved",
    }))).toBe("Ver en operación");
  });

  it("cuenta cada vista sobre la cola cargada y busca sin inventar filas", () => {
    const rows = [
      doc({ status: "awaiting_inspection", title: "Ticket café" }),
      doc({
        status: "in_review",
        inspection: "clean",
        extractionStatus: "reviewed",
        matchingStatus: "proposed",
        supplier: "Acme",
      }),
      doc({
        status: "in_review",
        inspection: "clean",
        extractionStatus: "reviewed",
        matchingStatus: "confirmed",
        draftStatus: "draft",
      }),
      doc({
        status: "approved",
        inspection: "clean",
        extractionStatus: "reviewed",
        matchingStatus: "confirmed",
        draftStatus: "approved",
      }),
      doc({ status: "quarantined", inspection: "quarantined" }),
    ];
    const counts = countFinanceInboxViews(rows);
    expect(counts.todos).toBe(5);
    expect(counts.revisar).toBe(1);
    expect(counts.matching).toBe(1);
    expect(counts.borradores).toBe(1);
    expect(counts.aprobados).toBe(1);
    expect(counts.excepcion).toBe(1);
    expect(filterFinanceInbox(rows, "matching", "acme")).toHaveLength(1);
    expect(filterFinanceInbox(rows, "todos", "inexistente")).toEqual([]);
  });

  it("la antigüedad es textual, no un color solo", () => {
    const now = Date.parse("2026-09-03T12:00:00Z");
    expect(financeDocumentAgeLabel("2026-09-03T11:10:00Z", now)).toBe("hace 50 min");
    expect(financeDocumentAgeLabel("2026-09-01T12:00:00Z", now)).toBe("hace 2 días");
  });
});
