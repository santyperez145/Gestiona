import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260814000023_purchase_order_receipt_integrity.sql"),
  "utf8",
);

describe("integridad posterior a la recepción de una OC", () => {
  it("no permite convertir un estado en recepción sin pasar por el RPC", () => {
    expect(migration).toContain("NEW.status IN ('partially_received', 'received')");
    expect(migration).toContain("El estado de recepción sólo se actualiza al registrar mercadería");
    expect(migration).toContain("trg_guard_purchase_order_status_integrity");
  });

  it("inmoviliza los renglones con recibos y bloquea quantity_received directo", () => {
    expect(migration).toContain("quantity_received sólo cambia al registrar mercadería");
    expect(migration).toContain("No se puede borrar un renglón de una orden con recepción registrada");
    expect(migration).toContain("trg_guard_purchase_order_item_integrity");
  });

  it("sólo habilita los guards durante la recepción y cubre bypasses en ZZ", () => {
    expect(migration).toContain("set_config('gestiona.po_receipt_authority', 'on', true)");
    expect(migration).toContain("set_config('gestiona.po_receipt_authority', 'off', true)");
    expect(migration).toContain("gestiona.organization_deleting");
    expect(migration).toContain("La recepción parcial se pudo alterar fuera del RPC");
    expect(migration).not.toContain("UPDATE public.products SET stock");
  });
});
