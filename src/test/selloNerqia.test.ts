import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const leer = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("sello «Hecho con Nerqia» en lo que el comercio entrega (TESIS §5)", () => {
  it("una sola regla para ticket, factura y presupuesto", () => {
    const sello = leer("src/lib/selloNerqia.ts");
    expect(sello).toContain('supabase.rpc("org_entitlements", { p_org: orgId })');
    expect(sello).toContain("branding !== false");
    expect(leer("src/lib/posReceiptPrint.ts")).toContain("export const selloDelTicket = selloHechoConNerqia;");
  });

  it("la factura lo pone bajo el pie y el presupuesto al final de la página", () => {
    const factura = leer("src/pages/InvoicesPage.tsx");
    const presupuesto = leer("src/pages/PresupuestosPage.tsx");
    expect(factura).toContain("const sello = await selloHechoConNerqia(inv.org_id);");
    expect(factura.indexOf("selloHechoConNerqia(inv.org_id)")).toBeLessThan(factura.indexOf("doc.save(`factura-"));
    expect(presupuesto).toContain("const sello = orgId ? await selloHechoConNerqia(orgId) : null;");
    expect(presupuesto).toContain("generatePDF(q, orgName, activeOrg?.id)");
  });
});
