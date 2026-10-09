import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { accionDeTecla, ATAJOS_POS, medioSiguiente } from "@/lib/posShortcuts";

describe("atajos del POS", () => {
  it("las teclas F funcionan aunque el foco esté en el buscador", () => {
    const esperado = { F1: "ayuda", F2: "buscar", F3: "cliente", F4: "medio_siguiente", F5: "pantalla_completa", F6: "cupon", F7: "guardar_ticket", F8: "tickets_guardados", F9: "cobrar", F10: "factura_arca", F11: "pantalla_completa" };
    for (const [key, accion] of Object.entries(esperado)) {
      expect(accionDeTecla({ key }, true)).toBe(accion);
      expect(accionDeTecla({ key }, false)).toBe(accion);
    }
    expect(accionDeTecla({ key: "F12" }, false)).toBeNull();
  });

  it("Alt+1…4 eligen el medio de pago", () => {
    expect(accionDeTecla({ key: "1", altKey: true }, true)).toBe("medio_1");
    expect(accionDeTecla({ key: "4", altKey: true }, false)).toBe("medio_4");
    expect(accionDeTecla({ key: "5", altKey: true }, false)).toBeNull();
  });

  it("las teclas de texto no se roban caracteres mientras se escribe", () => {
    for (const key of ["+", "-", "?", "Delete"]) expect(accionDeTecla({ key }, true)).toBeNull();
    expect(accionDeTecla({ key: "+" }, false)).toBe("mas");
    expect(accionDeTecla({ key: "Delete" }, false)).toBe("quitar_ultimo");
    expect(accionDeTecla({ key: "Delete", ctrlKey: true }, false)).toBe("vaciar_carrito");
    expect(accionDeTecla({ key: "a" }, false)).toBeNull();
  });

  it("Escape ya no vacía el carrito", () => {
    expect(accionDeTecla({ key: "Escape" }, false)).toBe("escape");
    const pos = readFileSync("src/pages/POSPage.tsx", "utf8");
    const escape = pos.slice(pos.indexOf("    escape: () => {"), pos.indexOf("    escape: () => {") + 200);
    expect(escape).not.toContain("setCart");
  });

  it("el medio siguiente recorre sólo los visibles", () => {
    expect(medioSiguiente(["efectivo", "transferencia", "debito"], "transferencia")).toBe("debito");
    expect(medioSiguiente(["efectivo", "transferencia"], "transferencia")).toBe("efectivo");
    expect(medioSiguiente(["efectivo", "transferencia"], "fiado")).toBe("efectivo");
  });

  it("cada acción de la tabla tiene manejador en el POS", () => {
    const pos = readFileSync("src/pages/POSPage.tsx", "utf8");
    for (const { accion } of ATAJOS_POS) expect(pos, accion).toContain(`    ${accion}: () =>`);
  });
});
