import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { esRechazoPorAutorizacion, porcentajeDelRechazo } from "@/components/pos/SupervisorApprovalDialog";

describe("autorización del encargado en caja", () => {
  it("reconoce el rechazo de la base y su porcentaje", () => {
    const mensaje = "El descuento de 20.00 % en «Taladro» supera el máximo de 10.00 %. Pedí la autorización del encargado.";
    expect(esRechazoPorAutorizacion(mensaje)).toBe(true);
    expect(porcentajeDelRechazo(mensaje)).toBe(20);
    expect(porcentajeDelRechazo("otro error")).toBeNull();
    expect(esRechazoPorAutorizacion("Sin stock")).toBe(false);
  });

  it("la base valida el descuento y nunca acepta la autorización del navegador", () => {
    const sql = readFileSync("supabase/migrations/20261009001000_autorizacion_encargado_pos.sql", "utf8");
    expect(sql).toContain("v_linea := v_linea - 'autorizacion_id' - 'price_override_approved_by';");
    expect(sql).toContain("a.cashier_id = auth.uid()");
    expect(sql).toContain("a.expires_at > now()");
    expect(sql).toContain("extensions.crypt(p_pin, extensions.gen_salt('bf', 10))");
    expect(sql).toContain("REVOKE ALL ON public.pos_supervisor_pins FROM PUBLIC, anon, authenticated;");
    expect(sql).toMatch(/Cinco PIN incorrectos/);
  });

  it("el POS reintenta la venta con la autorización y la olvida al cerrar el ticket", () => {
    const pos = readFileSync("src/pages/POSPage.tsx", "utf8");
    expect(pos).toContain("...(approvalRef.current ? { autorizacion_id: approvalRef.current } : {})");
    expect(pos).toContain("const clearCart = () => {\n    approvalRef.current = null;");
  });
});

describe("facturación automática en caja", () => {
  it("cada ticket arranca con la preferencia de la organización", () => {
    const pos = readFileSync("src/pages/POSPage.tsx", "utf8");
    expect(pos).toContain("Boolean(settings?.pos_factura_automatica)");
    expect(pos).toContain("setWantArcaInvoice(facturaPorDefecto);");
    expect(pos).toContain("if (selected.tax_id) setWantArcaInvoice(true);");
  });
});
