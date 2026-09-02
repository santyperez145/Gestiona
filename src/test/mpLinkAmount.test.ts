import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseLinkExternalRef,
  parseQuoteExternalRef,
  pickCanonicalTotal,
} from "@/lib/mpLinkAmount";

const root = process.cwd();
const edge = () => readFileSync(join(root, "supabase/functions/mercadopago-link/index.ts"), "utf8");
const shared = () => readFileSync(join(root, "supabase/functions/_shared/mpLinkAmount.ts"), "utf8");
const mirror = () => readFileSync(join(root, "src/lib/mpLinkAmount.ts"), "utf8");

describe("mpLinkAmount (autoridad del monto)", () => {
  it("parsea quote: y link:", () => {
    const qid = "a1b2c3d4-e5f6-4789-a012-3456789abcde";
    expect(parseQuoteExternalRef(`quote:${qid}`)).toBe(qid);
    expect(parseLinkExternalRef(`link:${qid}`)).toBe(qid);
    expect(parseQuoteExternalRef("nope")).toBeNull();
  });

  it("con fuente del Core ignora el total del cliente", () => {
    const r = pickCanonicalTotal({
      coreTotal: 100,
      clientTotal: 1,
      source: { kind: "payment_link", id: "x" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.total).toBe(100);
  });

  it("sin fuente admite el total ad-hoc del cajero", () => {
    const r = pickCanonicalTotal({
      coreTotal: null,
      clientTotal: 55.5,
      source: { kind: "client_ad_hoc" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.total).toBe(55.5);
  });

  it("edge resuelve payment_links y quotes; espejo compartido", () => {
    const src = edge();
    expect(src).toContain('from("payment_links")');
    expect(src).toContain('from("quotes")');
    expect(src).toContain("pickCanonicalTotal");
    expect(src).toContain("amount_source");
    // Espejo: mismas funciones exportadas en shared y src/lib.
    for (const name of ["parseQuoteExternalRef", "pickCanonicalTotal", "validateChargeTotal"]) {
      expect(shared()).toContain(name);
      expect(mirror()).toContain(name);
    }
  });
});
