import { describe, expect, it } from "vitest";
import { buildIdentityReviewCsv, identityReviewFilename } from "@/lib/identityExport";

describe("identity review CSV export", () => {
  it("exports product identity fields with a stable status", () => {
    const csv = buildIdentityReviewCsv("products", [{
      id: "p1", org_id: "o1", name: "Aromático", brand: "Marca",
      sku: null, barcode: null, sku_key: null, barcode_key: null,
      name_brand_key: "marca aromatico", sku_match_count: 0, barcode_match_count: 0,
      name_brand_match_count: 1, exact_conflict: false, review_required: false,
      identity_issue: null,
    }]);
    expect(csv).toContain('"id","nombre","marca","sku","ean","estado","problema"');
    expect(csv).toContain('"p1","Aromático","Marca","","","incompleta",""');
  });

  it("escapes quotes and neutralizes spreadsheet formulas", () => {
    const csv = buildIdentityReviewCsv("customers", [{
      id: "c1", org_id: "o1", name: "=IMPORTDATA(1)", email: "a\"b@example.com",
      phone: null, whatsapp_number: null, name_key: null, email_key: null,
      phone_key: null, whatsapp_key: null, name_match_count: 1, email_match_count: 1,
      phone_match_count: 0, whatsapp_match_count: 0, exact_conflict: false,
      review_required: false, missing_contact: false, identity_issue: null,
    }]);
    expect(csv).toContain('"c1","\'=IMPORTDATA(1)","a""b@example.com"');
  });

  it("names exports by entity and UTC date", () => {
    expect(identityReviewFilename("customers", new Date("2026-08-21T10:00:00Z")))
      .toBe("nerqia-identidad-customers-2026-08-21.csv");
  });
});
