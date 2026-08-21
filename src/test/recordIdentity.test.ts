import { describe, expect, it } from "vitest";
import {
  normalizeIdentityEmail,
  normalizeIdentityPhone,
  normalizeIdentityText,
  normalizeProductBarcode,
  normalizeProductSku,
  summarizeCustomerIdentity,
  summarizeProductIdentity,
} from "@/lib/recordIdentity";

describe("record identity normalization", () => {
  it("normalizes names without collapsing meaningful words", () => {
    expect(normalizeIdentityText("  Ana  GÓMEZ / Centro ")).toBe("ana gomez centro");
  });

  it("normalizes contact fields conservatively", () => {
    expect(normalizeIdentityEmail(" Ana @ Example.COM ")).toBe("ana@example.com");
    expect(normalizeIdentityPhone("+54 (11) 5555-0101")).toBe("541155550101");
    expect(normalizeIdentityPhone("---")).toBeNull();
  });

  it("turns formatted SKU and barcodes into stable keys", () => {
    expect(normalizeProductSku("ar- 01 / azul")).toBe("AR01AZUL");
    expect(normalizeProductBarcode("779.123-456")).toBe("779123456");
  });
});

describe("identity review summaries", () => {
  it("separates exact product conflicts from name-only candidates", () => {
    const rows = [
      {
        id: "p1", org_id: "o1", name: "A", brand: "B", sku: "X", barcode: null,
        sku_key: "X", barcode_key: null, name_brand_key: "b a", sku_match_count: 2,
        barcode_match_count: 0, name_brand_match_count: 1, exact_conflict: true,
        review_required: true, identity_issue: "SKU compartido",
      },
      {
        id: "p2", org_id: "o1", name: "C", brand: "D", sku: null, barcode: null,
        sku_key: null, barcode_key: null, name_brand_key: "d c", sku_match_count: 0,
        barcode_match_count: 0, name_brand_match_count: 2, exact_conflict: false,
        review_required: true, identity_issue: "Nombre y marca compartidos",
      },
    ];
    const summary = summarizeProductIdentity(rows);
    expect(summary.exactConflictRows).toBe(1);
    expect(summary.softCandidateRows).toBe(1);
    expect(summary.missingPrimaryRows).toBe(1);
    expect(summary.coveragePercent).toBe(50);
  });

  it("does not call homonyms duplicate when contact keys are distinct", () => {
    const rows = [
      {
        id: "c1", org_id: "o1", name: "Ana Gómez", email: "a@example.com", phone: null, whatsapp_number: null,
        name_key: "ana gomez", email_key: "a@example.com", phone_key: null, whatsapp_key: null,
        name_match_count: 2, email_match_count: 1, phone_match_count: 0, whatsapp_match_count: 0,
        exact_conflict: false, review_required: true, missing_contact: false, identity_issue: null,
      },
      {
        id: "c2", org_id: "o1", name: "Ana Gomez", email: "b@example.com", phone: null, whatsapp_number: null,
        name_key: "ana gomez", email_key: "b@example.com", phone_key: null, whatsapp_key: null,
        name_match_count: 2, email_match_count: 1, phone_match_count: 0, whatsapp_match_count: 0,
        exact_conflict: false, review_required: true, missing_contact: false, identity_issue: null,
      },
    ];
    const summary = summarizeCustomerIdentity(rows);
    expect(summary.exactConflictRows).toBe(0);
    expect(summary.softCandidateRows).toBe(2);
    expect(summary.identifiedRows).toBe(2);
  });
});
